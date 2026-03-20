#!/usr/bin/env node
/**
 * SOL Options Momentum Scalper (RFQ mode)
 *
 * Strategy:
 * - Monitors SOL price via Derive index
 * - When SOL moves >ENTRY_THRESHOLD from baseline, requests RFQ for options in that direction
 * - If MM quotes received, buys at quoted price
 * - Exits on profit target, stop loss, or time limit (also via RFQ)
 * - Budget: $2-3 per trade, 7 DTE nearest expiry
 *
 * Uses RFQ because SOL options have no CLOB liquidity (bid/ask = 0).
 *
 * Usage:
 *   node --env-file=$HOME/.config/derive-mcp/env agents/sol-momentum-scalper.js
 *   node --env-file=$HOME/.config/derive-mcp/env agents/sol-momentum-scalper.js --dry-run
 */

import { executeCreateRfq } from "../dist/protocols/derive/lifecycle/create-rfq.js";
import { executeAwaitRfqQuotes } from "../dist/protocols/derive/lifecycle/await-rfq-quotes.js";
import { executeAcceptRfqQuote } from "../dist/protocols/derive/lifecycle/accept-rfq-quote.js";
import { executePlaceAndVerify } from "../dist/protocols/derive/lifecycle/place-and-verify.js";
import { executeOrderAuditLog } from "../dist/protocols/derive/lifecycle/order-audit-log.js";
import { getOptionsChain } from "../dist/protocols/derive/public/market-data/get-options-chain.js";
import { getTicker } from "../dist/protocols/derive/public/market-data/get-ticker.js";

// ============================================
// CONFIG
// ============================================

const CONFIG = {
  currency: "SOL",
  max_budget_per_trade: 3,       // Max $3 per trade
  entry_threshold_pct: 2,        // SOL must move >2% from baseline to trigger
  profit_target_pct: 40,         // Exit at +40% premium gain
  stop_loss_pct: 25,             // Exit at -25% premium loss
  max_hold_hours: 4,             // Max 4 hours holding
  poll_interval_sec: 30,         // Check price/position every 30s
  baseline_window_minutes: 120,  // 2-hour baseline window for momentum
  min_dte: 3,                    // Minimum days to expiry
  max_dte: 10,                   // Maximum days to expiry
  strike_offset_pct: 3,          // Buy ~3% OTM for leverage
  rfq_wait_sec: 20,              // Wait up to 20s for MM quotes
  rfq_poll_sec: 3,               // Poll every 3s for quotes
  label_prefix: "sol-scalper",
};

const DRY_RUN = process.argv.includes("--dry-run");

// ============================================
// STATE
// ============================================

type AgentState = "SCANNING" | "HOLDING" | "COOLDOWN";

interface Position {
  instrument_name: string;
  entry_price: number;
  amount: number;
  entry_time: number;
}

let state: AgentState = "SCANNING";
let currentPosition: Position | null = null;
let priceHistory: { ts: number; price: number }[] = [];
let cooldownUntil = 0;
let tradeCount = 0;

// ============================================
// HELPERS
// ============================================

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function getSolPrice(): Promise<number> {
  const ticker = await getTicker.execute({ instrument_name: "SOL-PERP" }) as Record<string, any>;
  return parseFloat(ticker.index_price);
}

function getBaseline(): number | null {
  const cutoff = Date.now() - CONFIG.baseline_window_minutes * 60 * 1000;
  const recent = priceHistory.filter((p) => p.ts >= cutoff);
  if (recent.length < 3) return null;
  return recent.reduce((sum, p) => sum + p.price, 0) / recent.length;
}

function getMomentum(currentPrice: number, baseline: number): { direction: "up" | "down"; pct: number } {
  const pct = ((currentPrice - baseline) / baseline) * 100;
  return { direction: pct > 0 ? "up" : "down", pct: Math.abs(pct) };
}

// ============================================
// STRIKE SELECTION
// ============================================

async function selectStrike(
  direction: "up" | "down",
  currentPrice: number,
): Promise<{ instrument: string; mark: number; strike: number; expiry: string } | null> {
  const chain = await getOptionsChain.execute({
    currency: CONFIG.currency,
    only_liquid: false,  // SOL has no CLOB liquidity — use mark prices
  }) as Record<string, any>;

  // Filter expiries by DTE
  const validExpiries = (chain.expiries || []).filter((exp: any) =>
    exp.dte >= CONFIG.min_dte && exp.dte <= CONFIG.max_dte,
  );

  if (validExpiries.length === 0) {
    log("No expiries in target DTE range");
    return null;
  }

  const expiry = validExpiries[0];
  const optionType = direction === "up" ? "call" : "put";
  const targetStrike = direction === "up"
    ? currentPrice * (1 + CONFIG.strike_offset_pct / 100)
    : currentPrice * (1 - CONFIG.strike_offset_pct / 100);

  let bestMatch: { instrument: string; mark: number; strike: number } | null = null;
  let bestDist = Infinity;

  for (const row of expiry.chain || []) {
    const opt = row[optionType];
    if (!opt || !opt.mark || opt.mark <= 0) continue;

    // Min lot for SOL options is 0.1
    const cost = opt.mark * 0.1;
    if (cost > CONFIG.max_budget_per_trade) continue;
    if (cost < 0.05) continue; // Too cheap — likely worthless

    // Must be OTM
    if (direction === "up" && row.strike <= currentPrice) continue;
    if (direction === "down" && row.strike >= currentPrice) continue;

    const dist = Math.abs(row.strike - targetStrike);
    if (dist < bestDist) {
      bestDist = dist;
      bestMatch = { instrument: opt.instrument, mark: opt.mark, strike: row.strike };
    }
  }

  if (!bestMatch) {
    log(`No suitable ${optionType} found within budget`);
    return null;
  }

  return { ...bestMatch, expiry: expiry.expiry };
}

// ============================================
// RFQ ENTRY
// ============================================

async function executeEntry(
  direction: "up" | "down",
  currentPrice: number,
  momentum: number,
): Promise<boolean> {
  const strike = await selectStrike(direction, currentPrice);
  if (!strike) return false;

  const optionType = direction === "up" ? "call" : "put";
  const estCost = strike.mark * 0.1;

  log(`Signal: SOL ${direction} ${momentum.toFixed(1)}% | ${optionType} ${strike.instrument} mark=$${strike.mark} | est cost: $${estCost.toFixed(2)}`);

  if (DRY_RUN) {
    log("[DRY RUN] Would send RFQ — skipping");
    return false;
  }

  // Step 1: Create RFQ
  log(`Sending RFQ for ${strike.instrument}...`);
  const rfq = await executeCreateRfq({
    legs: [{ instrument_name: strike.instrument, direction: "buy", amount: "0.1" }],
    label: `${CONFIG.label_prefix}-${optionType}-${Date.now()}`,
  });

  if (rfq.submission !== "accepted" || !rfq.receipt) {
    log(`RFQ failed: ${rfq.error?.code} — ${rfq.error?.message}`);
    return false;
  }

  // Step 2: Wait for quotes
  log(`RFQ ${rfq.receipt.rfq_id} open — waiting for MM quotes (${CONFIG.rfq_wait_sec}s)...`);
  const quotes = await executeAwaitRfqQuotes({
    rfq_id: rfq.receipt.rfq_id,
    max_wait_seconds: CONFIG.rfq_wait_sec,
    poll_interval_seconds: CONFIG.rfq_poll_sec,
  });

  if (quotes.quotes.length === 0) {
    log(`No quotes received for ${strike.instrument} — MMs not quoting this strike/size`);
    return false;
  }

  // Step 3: Pick best quote and check cost
  const bestQuote = quotes.quotes[0]; // First quote
  const quoteCost = parseFloat(bestQuote.total_cost || "0");

  log(`Quote received: ${bestQuote.quote_id} | cost: $${quoteCost.toFixed(2)}`);

  if (quoteCost > CONFIG.max_budget_per_trade) {
    log(`Quote cost $${quoteCost.toFixed(2)} exceeds budget $${CONFIG.max_budget_per_trade} — skipping`);
    return false;
  }

  // Step 4: Execute
  const exec = await executeAcceptRfqQuote({
    rfq_id: rfq.receipt.rfq_id,
    quote_id: bestQuote.quote_id,
    max_total_cost: CONFIG.max_budget_per_trade.toString(),
  });

  if (exec.submission !== "accepted" || !exec.receipt?.execution) {
    log(`RFQ execution failed: ${exec.error?.code} — ${exec.error?.message}`);
    return false;
  }

  const trades = exec.receipt.execution.trades;
  const avgPrice = trades.length > 0 ? parseFloat(trades[0].trade_price) : quoteCost / 0.1;

  currentPosition = {
    instrument_name: strike.instrument,
    entry_price: avgPrice,
    amount: 0.1,
    entry_time: Date.now(),
  };

  state = "HOLDING";
  tradeCount++;

  log(`ENTRY via RFQ: ${strike.instrument} | 0.1 @ $${avgPrice.toFixed(2)} | cost: $${quoteCost.toFixed(2)} | trade #${tradeCount}`);
  return true;
}

// ============================================
// EXIT MONITORING
// ============================================

async function checkExit(): Promise<boolean> {
  if (!currentPosition) return false;

  try {
    const ticker = await getTicker.execute({
      instrument_name: currentPosition.instrument_name,
    }) as Record<string, any>;

    const markPrice = parseFloat(ticker.mark_price || "0");
    if (markPrice <= 0) return false;

    const pnlPct = ((markPrice - currentPosition.entry_price) / currentPosition.entry_price) * 100;
    const holdMinutes = (Date.now() - currentPosition.entry_time) / 60000;

    let exitReason: string | null = null;

    if (pnlPct >= CONFIG.profit_target_pct) {
      exitReason = `PROFIT TARGET +${pnlPct.toFixed(1)}%`;
    } else if (pnlPct <= -CONFIG.stop_loss_pct) {
      exitReason = `STOP LOSS ${pnlPct.toFixed(1)}%`;
    } else if (holdMinutes >= CONFIG.max_hold_hours * 60) {
      exitReason = `TIME LIMIT (${holdMinutes.toFixed(0)}min)`;
    }

    if (!exitReason) {
      if (Math.random() < 0.2) {
        log(`HOLDING: ${currentPosition.instrument_name} | mark: $${markPrice.toFixed(2)} | entry: $${currentPosition.entry_price.toFixed(2)} | PnL: ${pnlPct.toFixed(1)}% | ${holdMinutes.toFixed(0)}min`);
      }
      return false;
    }

    log(`EXIT SIGNAL: ${exitReason}`);

    if (DRY_RUN) {
      log("[DRY RUN] Would exit — skipping");
      state = "SCANNING";
      currentPosition = null;
      return true;
    }

    return await executeExit(markPrice, exitReason);
  } catch (err) {
    log(`Error checking exit: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

async function executeExit(markPrice: number, reason: string): Promise<boolean> {
  if (!currentPosition) return false;

  // Try RFQ exit first
  log(`Sending exit RFQ for ${currentPosition.instrument_name}...`);
  const rfq = await executeCreateRfq({
    legs: [{
      instrument_name: currentPosition.instrument_name,
      direction: "sell",
      amount: currentPosition.amount.toString(),
    }],
    label: `${CONFIG.label_prefix}-exit-${Date.now()}`,
  });

  if (rfq.submission !== "accepted" || !rfq.receipt) {
    log(`Exit RFQ failed — trying CLOB IOC as fallback`);
    return await exitViaCLOB(markPrice, reason);
  }

  const quotes = await executeAwaitRfqQuotes({
    rfq_id: rfq.receipt.rfq_id,
    max_wait_seconds: CONFIG.rfq_wait_sec,
    poll_interval_seconds: CONFIG.rfq_poll_sec,
  });

  if (quotes.quotes.length === 0) {
    log(`No exit quotes — trying CLOB IOC as fallback`);
    return await exitViaCLOB(markPrice, reason);
  }

  const bestQuote = quotes.quotes[0];
  const exec = await executeAcceptRfqQuote({
    rfq_id: rfq.receipt.rfq_id,
    quote_id: bestQuote.quote_id,
  });

  if (exec.submission !== "accepted") {
    log(`Exit RFQ execution failed — trying CLOB IOC as fallback`);
    return await exitViaCLOB(markPrice, reason);
  }

  const exitPrice = exec.receipt?.execution?.trades?.[0]
    ? parseFloat(exec.receipt.execution.trades[0].trade_price)
    : markPrice;

  logExit(exitPrice, reason);
  return true;
}

async function exitViaCLOB(markPrice: number, reason: string): Promise<boolean> {
  if (!currentPosition) return false;

  // Aggressive IOC sell at well below mark to ensure fill
  const limitPrice = (markPrice * 0.90).toFixed(2);

  const result = await executePlaceAndVerify({
    instrument_name: currentPosition.instrument_name,
    direction: "sell",
    amount: currentPosition.amount.toString(),
    limit_price: limitPrice,
    time_in_force: "ioc",
    label: `${CONFIG.label_prefix}-exit-clob-${Date.now()}`,
    order_type: "limit",
    reduce_only: true,
    max_fee: "1",
  });

  if (result.submission !== "accepted" || !result.receipt?.is_fully_filled) {
    log(`CLOB exit also failed — position remains open. Manual intervention needed.`);
    log(`Position: ${currentPosition.instrument_name} x${currentPosition.amount}`);
    return false;
  }

  const exitPrice = parseFloat(result.receipt.average_price);
  logExit(exitPrice, reason);
  return true;
}

function logExit(exitPrice: number, reason: string) {
  if (!currentPosition) return;
  const pnl = (exitPrice - currentPosition.entry_price) * currentPosition.amount;
  const pnlPct = ((exitPrice - currentPosition.entry_price) / currentPosition.entry_price) * 100;

  log(`EXIT: ${currentPosition.instrument_name} | $${exitPrice.toFixed(2)} | PnL: $${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%) | reason: ${reason}`);

  currentPosition = null;
  state = "COOLDOWN";
  cooldownUntil = Date.now() + 60000;
}

// ============================================
// MAIN LOOP
// ============================================

async function tick() {
  const price = await getSolPrice();
  priceHistory.push({ ts: Date.now(), price });

  // Trim old prices
  const cutoff = Date.now() - 4 * 60 * 60 * 1000;
  priceHistory = priceHistory.filter((p) => p.ts >= cutoff);

  switch (state) {
    case "SCANNING": {
      const baseline = getBaseline();
      if (!baseline) {
        log(`Collecting prices... (${priceHistory.length} samples, SOL=$${price.toFixed(2)})`);
        break;
      }

      const { direction, pct } = getMomentum(price, baseline);

      if (pct >= CONFIG.entry_threshold_pct) {
        log(`Momentum: SOL ${direction} ${pct.toFixed(2)}% from baseline $${baseline.toFixed(2)}`);
        await executeEntry(direction, price, pct);
      }
      break;
    }

    case "HOLDING": {
      await checkExit();
      break;
    }

    case "COOLDOWN": {
      if (Date.now() >= cooldownUntil) {
        log("Cooldown complete — resuming scan");
        state = "SCANNING";
      }
      break;
    }
  }
}

async function main() {
  log("=== SOL Options Momentum Scalper (RFQ Mode) ===");
  log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  log(`Config: budget=$${CONFIG.max_budget_per_trade}, entry=${CONFIG.entry_threshold_pct}%, profit=${CONFIG.profit_target_pct}%, stop=${CONFIG.stop_loss_pct}%`);
  log(`RFQ: wait=${CONFIG.rfq_wait_sec}s, poll=${CONFIG.rfq_poll_sec}s`);
  log("");

  const price = await getSolPrice();
  log(`SOL index: $${price.toFixed(2)}`);

  // Pre-flight: show available options
  const strikeUp = await selectStrike("up", price);
  if (strikeUp) {
    log(`Sample call: ${strikeUp.instrument} mark=$${strikeUp.mark} (est: $${(strikeUp.mark * 0.1).toFixed(2)} for 0.1)`);
  }
  const strikeDown = await selectStrike("down", price);
  if (strikeDown) {
    log(`Sample put:  ${strikeDown.instrument} mark=$${strikeDown.mark} (est: $${(strikeDown.mark * 0.1).toFixed(2)} for 0.1)`);
  }

  log("");
  log("Starting scan loop... (Ctrl+C to stop)");
  log("");

  while (true) {
    try {
      await tick();
    } catch (err) {
      log(`Tick error: ${err instanceof Error ? err.message : err}`);
    }
    await sleep(CONFIG.poll_interval_sec * 1000);
  }
}

process.on("SIGINT", async () => {
  log("\nShutting down...");

  if (currentPosition && !DRY_RUN) {
    log(`WARNING: Open position — ${currentPosition.instrument_name} x${currentPosition.amount}`);
  }

  const audit = await executeOrderAuditLog({ label: CONFIG.label_prefix, limit: 100 });
  log("\n=== Session Summary ===");
  log(`Trades: ${audit.summary.total_orders} | Filled: ${audit.summary.filled} | Rejected: ${audit.summary.rejected}`);
  log(`Fees: $${audit.summary.total_fees} | Fill rate: ${audit.summary.fill_rate}%`);

  process.exit(0);
});

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
