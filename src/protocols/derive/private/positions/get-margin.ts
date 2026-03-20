import { z } from "zod";
import type { Action } from "../../types.js";
import { privateRequest, publicRequest, requireSubaccount } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  subaccount_id: z.number().optional().describe("Subaccount ID (defaults to configured)"),
  simulated_position_changes: z.array(z.object({
    instrument_name: z.string(),
    amount: z.string(),
    entry_price: z.string(),
  })).optional().describe("Simulate position changes to check margin impact"),
  simulated_collateral_changes: z.array(z.object({
    asset_name: z.string(),
    amount: z.string(),
  })).optional().describe("Simulate collateral changes"),
});

/** Parse currency from instrument name (e.g., ETH-20260327-2000-P → ETH) */
function parseCurrency(name: string): string {
  return name.split("-")[0];
}

/** Check simulated amounts against instrument minimum_amount and amount_step */
async function validateInstrumentConstraints(
  changes: { instrument_name: string; amount: string }[]
): Promise<{ valid: boolean; violations: string[] }> {
  // Group by currency to batch instrument lookups
  const byCurrency = new Map<string, string[]>();
  for (const c of changes) {
    const currency = parseCurrency(c.instrument_name);
    if (!byCurrency.has(currency)) byCurrency.set(currency, []);
    byCurrency.get(currency)!.push(c.instrument_name);
  }

  // Fetch instruments for each currency
  const instrumentMap = new Map<string, { minimum_amount: string; amount_step: string }>();
  await Promise.all(
    Array.from(byCurrency.entries()).map(async ([currency, names]) => {
      try {
        // Determine instrument type from name pattern
        const isPerp = names.some(n => n.endsWith("-PERP"));
        const type = isPerp ? "perp" : "option";
        const instruments = await publicRequest<any[]>("get_instruments", {
          currency,
          instrument_type: type,
          expired: false,
        });
        for (const inst of instruments) {
          instrumentMap.set(inst.instrument_name, {
            minimum_amount: inst.minimum_amount,
            amount_step: inst.amount_step,
          });
        }
      } catch {
        // If lookup fails, skip validation for this currency
      }
    })
  );

  const violations: string[] = [];
  for (const change of changes) {
    const info = instrumentMap.get(change.instrument_name);
    if (!info) continue;

    const absAmount = Math.abs(parseFloat(change.amount));
    const minAmount = parseFloat(info.minimum_amount);
    const step = parseFloat(info.amount_step);

    if (absAmount < minAmount) {
      violations.push(
        `${change.instrument_name}: amount ${absAmount} below minimum_amount ${minAmount}`
      );
    } else if (step > 0) {
      const remainder = (absAmount * 1e8) % (step * 1e8); // avoid float issues
      if (remainder > 0.001) {
        violations.push(
          `${change.instrument_name}: amount ${absAmount} not aligned to amount_step ${step}`
        );
      }
    }
  }

  return { valid: violations.length === 0, violations };
}

export const getMargin: Action<typeof schema> = {
  name: "get_margin",
  protocol: "derive",
  description:
    "Get current margin. Optionally simulate position/collateral changes before trading. " +
    "Validates simulated amounts against instrument minimum_amount and amount_step — " +
    "if amounts violate constraints, returns is_valid_trade=false with violations (the real order would reject). " +
    "CRITICAL: Simulation evaluates all positions ATOMICALLY as a portfolio — but orders execute LEG BY LEG. " +
    "A multi-leg spread may show is_valid_trade=true in simulation but FAIL on execution because each leg is margined independently. " +
    "For multi-leg strategies: simulate EACH sell/short leg INDIVIDUALLY against current positions to verify it passes margin alone. " +
    "Standard Margin (SM) does NOT net spreads — short options require full naked margin. Portfolio Margin (PM/PM2) does net spreads. " +
    "Always check margin_type from get_subaccount before placing short option orders.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "read",
  execute: async (params) => {
    // Pre-validate instrument constraints if simulating position changes
    if (params.simulated_position_changes?.length) {
      const check = await validateInstrumentConstraints(params.simulated_position_changes);
      if (!check.valid) {
        return {
          subaccount_id: requireSubaccount(params.subaccount_id),
          pre_initial_margin: "0",
          pre_maintenance_margin: "0",
          post_initial_margin: "0",
          post_maintenance_margin: "0",
          is_valid_trade: false,
          instrument_violations: check.violations,
        };
      }
    }

    const q: Record<string, unknown> = { subaccount_id: requireSubaccount(params.subaccount_id) };
    if (params.simulated_position_changes) q.simulated_position_changes = params.simulated_position_changes;
    if (params.simulated_collateral_changes) q.simulated_collateral_changes = params.simulated_collateral_changes;
    return privateRequest("get_margin", q);
  },
};
