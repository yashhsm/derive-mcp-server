import { z } from "zod";
import type { Action } from "../../types.js";
import { privateRequest, requireSubaccount } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  subaccount_id: z.number().optional().describe("Subaccount ID (defaults to configured)"),
});

interface PositionSummary {
  instrument: string;
  type: string;
  amount: number;
  entry_price: number;
  mark_price: number;
  value: number;
  unrealized_pnl: number;
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
}

export const getPortfolioSummary: Action<typeof schema> = {
  name: "get_portfolio_summary",
  protocol: "derive",
  description:
    "Get a complete portfolio overview in a single call: USDC balance, all positions with greeks, and aggregate totals. " +
    "Returns {balance, positions: [...], totals: {value, unrealized_pnl, delta, gamma, vega, theta}}. " +
    "Use this INSTEAD of calling get_collaterals + get_positions separately — saves a tool call and does the aggregation for you.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "read",
  execute: async (params) => {
    const subId = requireSubaccount(params.subaccount_id);

    // Fetch both in parallel
    const [collaterals, positions] = await Promise.all([
      privateRequest<{ collaterals: any[] }>("get_collaterals", { subaccount_id: subId }),
      privateRequest<{ positions: any[] }>("get_positions", { subaccount_id: subId }),
    ]);

    // Parse collateral
    const usdcCollateral = collaterals.collaterals.find((c: any) => c.currency === "USDC");
    const balance = parseFloat(usdcCollateral?.amount || "0");

    // Parse positions and aggregate greeks
    const totals = { value: 0, unrealized_pnl: 0, delta: 0, gamma: 0, vega: 0, theta: 0 };
    const positionSummaries: PositionSummary[] = [];

    for (const pos of positions.positions) {
      const amount = parseFloat(pos.amount || "0");
      if (amount === 0) continue;

      const markPrice = parseFloat(pos.mark_price || "0");
      const value = parseFloat(pos.mark_value || "0");
      const pnl = parseFloat(pos.unrealized_pnl_excl_fees || "0");
      const delta = parseFloat(pos.delta || "0");
      const gamma = parseFloat(pos.gamma || "0");
      const vega = parseFloat(pos.vega || "0");
      const theta = parseFloat(pos.theta || "0");

      const summary: PositionSummary = {
        instrument: pos.instrument_name,
        type: pos.instrument_type,
        amount: round(amount, 4),
        entry_price: round(parseFloat(pos.average_price_excl_fees || "0"), 4),
        mark_price: round(markPrice, 4),
        value: round(value, 2),
        unrealized_pnl: round(pnl, 2),
        delta: round(delta, 4),
        gamma: round(gamma, 6),
        vega: round(vega, 4),
        theta: round(theta, 4),
      };

      positionSummaries.push(summary);

      totals.value += value;
      totals.unrealized_pnl += pnl;
      totals.delta += delta;
      totals.gamma += gamma;
      totals.vega += vega;
      totals.theta += theta;
    }

    return {
      subaccount_id: subId,
      usdc_balance: round(balance, 2),
      total_equity: round(balance + totals.value, 2),
      positions: positionSummaries,
      totals: {
        positions_value: round(totals.value, 2),
        unrealized_pnl: round(totals.unrealized_pnl, 2),
        delta: round(totals.delta, 4),
        gamma: round(totals.gamma, 6),
        vega: round(totals.vega, 4),
        theta: round(totals.theta, 4),
      },
    };
  },
};

function round(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}
