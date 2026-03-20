// ============================================
// ORDER LIFECYCLE MANAGER — check_multi_leg_margin
// ============================================

import { z } from "zod";
import type { MarginCheckResult, SequentialLegResult } from "./types.js";
import { getSubaccount } from "../private/account/get-subaccount.js";
import { getMargin } from "../private/positions/get-margin.js";
import { requireSubaccount } from "../client.js";

export const checkMultiLegMarginSchema = z.object({
  legs: z.array(z.object({
    instrument_name: z.string(),
    direction: z.enum(["buy", "sell"]).describe("Buy or sell — required to identify short/sell legs for margin analysis"),
    amount: z.string(),
    entry_price: z.string(),
  })).describe("Legs to simulate. Direction is REQUIRED for correct margin analysis."),
  subaccount_id: z.number().optional().describe("Subaccount ID (defaults to configured)"),
});

export const checkMultiLegMarginDescription =
  "Pre-flight margin check for multi-leg strategies. Simulates BOTH as an atomic portfolio AND sequentially " +
  "(leg-by-leg in execution order). CRITICAL for Standard Margin (SM) which does NOT net spreads — " +
  "short options require full naked margin even with protective long legs. " +
  "Returns warnings when portfolio simulation passes but sequential execution would fail. " +
  "Execution order: buy legs first (lowest premium), then sell legs (highest margin). " +
  "For atomic multi-leg execution, use RFQ instead of CLOB.";

export async function executeCheckMultiLegMargin(
  params: z.infer<typeof checkMultiLegMarginSchema>,
): Promise<MarginCheckResult> {
  const subaccountId = requireSubaccount(params.subaccount_id);
  const warnings: string[] = [];

  // 1. Get margin type
  const subaccount = await getSubaccount.execute({
    subaccount_id: subaccountId,
  }) as Record<string, any>;

  const marginType = detectMarginType(subaccount);

  // SM warning for short options
  const sellLegs = params.legs.filter((l) => l.direction === "sell");
  if (marginType === "SM" && sellLegs.length > 0) {
    warnings.push(
      `Standard Margin (SM) does NOT net spreads — ${sellLegs.length} sell leg(s) will be margined as naked. ` +
      `Consider Portfolio Margin (PM/PM2) or use RFQ for atomic execution.`,
    );
  }

  // 2. Current margin state
  const currentMargin = await getMargin.execute({
    subaccount_id: subaccountId,
  }) as Record<string, any>;

  const currentMarginInfo = {
    maintenance_margin: currentMargin.maintenance_margin ?? "0",
    initial_margin: currentMargin.initial_margin ?? "0",
    available_margin: currentMargin.available_margin ?? "0",
  };

  // 3. Portfolio simulation (atomic — all legs at once)
  let portfolioSimulation: MarginCheckResult["portfolio_simulation"];
  try {
    const portfolioResult = await getMargin.execute({
      subaccount_id: subaccountId,
      simulated_position_changes: params.legs.map((l) => ({
        instrument_name: l.instrument_name,
        amount: l.direction === "sell" ? `-${l.amount}` : l.amount,
        entry_price: l.entry_price,
      })),
    }) as Record<string, any>;

    portfolioSimulation = {
      is_valid: portfolioResult.is_valid_trade !== false,
      post_initial_margin: portfolioResult.initial_margin ?? "0",
      post_available_margin: portfolioResult.available_margin ?? "0",
      violations: portfolioResult.violations || [],
    };
  } catch (err) {
    portfolioSimulation = {
      is_valid: false,
      post_initial_margin: "0",
      post_available_margin: "0",
      violations: [err instanceof Error ? err.message : String(err)],
    };
  }

  // 4. Sequential simulation (leg by leg, in execution order)
  // Order: buy legs first (sorted by premium asc), then sell legs (sorted by margin desc)
  const buyLegs = params.legs
    .filter((l) => l.direction === "buy")
    .map((l, i) => ({ ...l, originalIndex: params.legs.indexOf(l) }))
    .sort((a, b) => parseFloat(a.entry_price) * parseFloat(a.amount) - parseFloat(b.entry_price) * parseFloat(b.amount));

  const sellLegsSorted = params.legs
    .filter((l) => l.direction === "sell")
    .map((l, i) => ({ ...l, originalIndex: params.legs.indexOf(l) }))
    .sort((a, b) => parseFloat(b.entry_price) * parseFloat(b.amount) - parseFloat(a.entry_price) * parseFloat(a.amount));

  const orderedLegs = [...buyLegs, ...sellLegsSorted];
  const sequentialLegs: SequentialLegResult[] = [];
  let allPass = true;
  const cumulativeLegs: { instrument_name: string; amount: string; entry_price: string }[] = [];

  for (let step = 0; step < orderedLegs.length; step++) {
    const leg = orderedLegs[step];
    const signedAmount = leg.direction === "sell" ? `-${leg.amount}` : leg.amount;

    cumulativeLegs.push({
      instrument_name: leg.instrument_name,
      amount: signedAmount,
      entry_price: leg.entry_price,
    });

    let legResult: SequentialLegResult;
    try {
      const marginResult = await getMargin.execute({
        subaccount_id: subaccountId,
        simulated_position_changes: cumulativeLegs,
      }) as Record<string, any>;

      const isValid = marginResult.is_valid_trade !== false;
      if (!isValid) allPass = false;

      legResult = {
        step: step + 1,
        instrument_name: leg.instrument_name,
        direction: leg.direction,
        amount: leg.amount,
        is_valid: isValid,
        cumulative_margin_used: marginResult.initial_margin ?? "0",
        available_after: marginResult.available_margin ?? "0",
        error: isValid ? null : (marginResult.violations?.[0] ?? "Insufficient margin"),
      };
    } catch (err) {
      allPass = false;
      legResult = {
        step: step + 1,
        instrument_name: leg.instrument_name,
        direction: leg.direction,
        amount: leg.amount,
        is_valid: false,
        cumulative_margin_used: "0",
        available_after: "0",
        error: err instanceof Error ? err.message : String(err),
      };
    }

    sequentialLegs.push(legResult);
  }

  // 5. Compare portfolio vs sequential
  if (portfolioSimulation.is_valid && !allPass) {
    const failedSteps = sequentialLegs.filter((l) => !l.is_valid);
    for (const failed of failedSteps) {
      warnings.push(
        `Portfolio simulation passes but step ${failed.step} (${failed.direction} ${failed.instrument_name}) fails sequentially. ` +
        `Error: ${failed.error}. Use RFQ for atomic execution.`,
      );
    }
  }

  const executionOrderDesc = orderedLegs
    .map((l, i) => `${i + 1}. ${l.direction} ${l.instrument_name} ${l.amount}`)
    .join(", ");

  return {
    subaccount_id: subaccountId,
    margin_type: marginType,
    current_margin: currentMarginInfo,
    portfolio_simulation: portfolioSimulation,
    sequential_simulation: {
      all_legs_pass: allPass,
      execution_order: executionOrderDesc,
      legs: sequentialLegs,
    },
    warnings,
  };
}

function detectMarginType(subaccount: Record<string, any>): "SM" | "PM" | "PM2" {
  const mt = subaccount.margin_type ?? subaccount.portfolio_margin_type ?? "";
  if (typeof mt === "string") {
    const upper = mt.toUpperCase();
    if (upper.includes("PM2")) return "PM2";
    if (upper.includes("PM") || upper.includes("PORTFOLIO")) return "PM";
  }
  return "SM";
}
