// ============================================
// ORDER LIFECYCLE MANAGER — accept_rfq_quote
// ============================================

import { z } from "zod";
import type { LifecycleResult, RfqReceipt, TradeRecord } from "./types.js";
import { classifyError, isTransportError } from "./normalize.js";
import { appendEvent } from "./audit-store.js";
import { getQuotes } from "../private/rfq/get-quotes.js";
import { executeQuote } from "../private/rfq/execute-quote.js";
import { requireSubaccount } from "../client.js";

export const acceptRfqQuoteSchema = z.object({
  rfq_id: z.string().describe("RFQ ID"),
  quote_id: z.string().describe("Quote ID to accept (from await_rfq_quotes)"),
  max_total_cost: z.string().optional().describe("Safety bound: reject if total cost exceeds this (USDC)"),
  subaccount_id: z.number().optional().describe("Subaccount ID (defaults to configured)"),
});

export const acceptRfqQuoteDescription =
  "Execute a specific quote from an RFQ. Fetches the quote details automatically — " +
  "you only need rfq_id and quote_id (no need to replay legs). " +
  "Optional max_total_cost safety bound prevents execution if quote cost exceeds limit. " +
  "Returns LifecycleResult<RfqReceipt> with trade details on success.";

export async function executeAcceptRfqQuote(
  params: z.infer<typeof acceptRfqQuoteSchema>,
): Promise<LifecycleResult<RfqReceipt>> {
  const subaccountId = requireSubaccount(params.subaccount_id);

  try {
    // 1. Fetch the quote to get legs and prices
    const quotesResult = await getQuotes.execute({
      rfq_id: params.rfq_id,
      quote_id: params.quote_id,
      subaccount_id: subaccountId,
    }) as { quotes: Record<string, any>[] };

    const quote = quotesResult.quotes?.find(
      (q: Record<string, any>) => q.quote_id === params.quote_id,
    );
    if (!quote) {
      return {
        submission: "rejected",
        receipt: null,
        warnings: [],
        audit_persisted: false,
        error: { code: "API_ERROR", message: `Quote ${params.quote_id} not found`, raw: "" },
      };
    }

    // 2. Check max_total_cost safety bound
    if (params.max_total_cost) {
      const quoteCost = parseFloat(quote.total_cost || "0");
      const maxCost = parseFloat(params.max_total_cost);
      if (!isNaN(quoteCost) && !isNaN(maxCost) && quoteCost > maxCost) {
        return {
          submission: "rejected",
          receipt: null,
          warnings: [`Quote cost ${quote.total_cost} exceeds max_total_cost ${params.max_total_cost}`],
          audit_persisted: false,
          error: {
            code: "COST_EXCEEDS_LIMIT",
            message: `Quote cost ${quote.total_cost} exceeds limit ${params.max_total_cost}`,
          },
        };
      }
    }

    // 3. Build legs from quote (no manual replay needed)
    const legs = (quote.legs || []).map((l: Record<string, any>) => ({
      instrument_name: l.instrument_name as string,
      direction: l.direction as "buy" | "sell",
      amount: l.amount as string,
      limit_price: l.price as string,
      max_fee: "100",
    }));

    // 4. Execute the quote
    const execResult = await executeQuote.execute({
      quote_id: params.quote_id,
      legs,
      subaccount_id: subaccountId,
    }) as Record<string, any>;

    // 5. Normalize trades
    const rawTrades = execResult.trades || [];
    const trades: TradeRecord[] = rawTrades.map((t: Record<string, any>) => ({
      trade_id: t.trade_id ?? "",
      order_id: t.order_id ?? "",
      trade_price: t.trade_price ?? "0",
      trade_amount: t.trade_amount ?? "0",
      fee: t.trade_fee ?? "0",
      liquidity_role: t.liquidity_role ?? "taker",
      realized_pnl: t.realized_pnl ?? "0",
      timestamp: t.timestamp ?? Date.now(),
      tx_status: t.tx_status === "settled" ? "settled" as const : "requested" as const,
      tx_hash: t.tx_hash ?? null,
    }));

    const totalFee = trades.reduce((sum, t) => sum + parseFloat(t.fee || "0"), 0);

    const receipt: RfqReceipt = {
      rfq_id: params.rfq_id,
      subaccount_id: subaccountId,
      status: "EXECUTED",
      cancel_reason: null,
      legs: legs.map((l: { instrument_name: string; direction: "buy" | "sell"; amount: string }) => ({
        instrument_name: l.instrument_name,
        direction: l.direction,
        amount: l.amount,
      })),
      quotes: [{
        quote_id: params.quote_id,
        direction: quote.direction ?? "buy",
        total_cost: quote.total_cost ?? "0",
        legs: (quote.legs || []).map((l: Record<string, any>) => ({
          instrument_name: l.instrument_name ?? "",
          price: l.price ?? "0",
          amount: l.amount ?? "0",
        })),
        created_at: quote.creation_timestamp ?? 0,
        valid_until: quote.valid_until ?? 0,
      }],
      execution: {
        trades,
        total_cost: quote.total_cost ?? "0",
        total_fee: totalFee.toString(),
      },
      created_at: quote.creation_timestamp ?? 0,
      updated_at: Date.now(),
      valid_until: quote.valid_until ?? 0,
    };

    // Audit
    const persisted = appendEvent({
      ts: Date.now(),
      event: "rfq_executed",
      subaccount_id: subaccountId,
      rfq_id: params.rfq_id,
      quote_id: params.quote_id,
      trades: trades.map((t) => ({
        trade_id: t.trade_id,
        price: t.trade_price,
        amount: t.trade_amount,
      })),
      total_cost: quote.total_cost ?? "0",
      total_fee: totalFee.toString(),
    });

    return {
      submission: "accepted",
      receipt,
      warnings: [],
      audit_persisted: persisted,
      error: null,
    };
  } catch (err) {
    const classified = classifyError(err);
    return {
      submission: isTransportError(classified) ? "unknown" : "rejected",
      receipt: null,
      warnings: [],
      audit_persisted: false,
      error: classified,
    };
  }
}
