import { z } from "zod";
import type { Action } from "../../types.js";
import { privateRequest, requireSubaccount } from "../../client.js";
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

export const getMargin: Action<typeof schema> = {
  name: "get_margin",
  protocol: "derive",
  description:
    "Get current margin. Optionally simulate position/collateral changes before trading. " +
    "CRITICAL: Simulation evaluates all positions ATOMICALLY as a portfolio — but orders execute LEG BY LEG. " +
    "A multi-leg spread may show is_valid_trade=true in simulation but FAIL on execution because each leg is margined independently. " +
    "For multi-leg strategies: simulate EACH sell/short leg INDIVIDUALLY against current positions to verify it passes margin alone. " +
    "Standard Margin (SM) does NOT net spreads — short options require full naked margin. Portfolio Margin (PM/PM2) does net spreads. " +
    "Always check margin_type from get_subaccount before placing short option orders.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "read",
  execute: async (params) => {
    const q: Record<string, unknown> = { subaccount_id: requireSubaccount(params.subaccount_id) };
    if (params.simulated_position_changes) q.simulated_position_changes = params.simulated_position_changes;
    if (params.simulated_collateral_changes) q.simulated_collateral_changes = params.simulated_collateral_changes;
    return privateRequest("get_margin", q);
  },
};
