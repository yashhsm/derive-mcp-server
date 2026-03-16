import { z } from "zod";
import type { Action } from "../../types.js";
import { publicRequest } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  instrument_type: z.enum(["option", "perp", "erc20"]).describe("Instrument type"),
  currency: z.string().optional().describe("Currency filter (required for options)"),
  expiry_date: z.string().optional().describe("Expiry date YYYYMMDD (required for options)"),
  only_liquid: z.boolean().default(false).describe("If true, only return instruments with non-zero bid OR ask (filters out illiquid/dead strikes). Highly recommended for options to reduce noise."),
  min_delta: z.number().optional().describe("Filter options by minimum absolute delta (e.g., 0.05 to exclude near-zero delta far OTM). Useful for focusing on tradeable strikes."),
  max_delta: z.number().optional().describe("Filter options by maximum absolute delta (e.g., 0.90 to exclude deep ITM). Combine with min_delta for a range like 0.10-0.50 for OTM options."),
});

/**
 * Normalize abbreviated ticker keys from the batch API into readable names.
 * Raw format: {b, a, B, A, M, t, option_pricing: {d, i, g, v, t, ...}}
 * Normalized:  {bid, ask, bid_size, ask_size, mark, timestamp, delta, iv, ...}
 */
function normalizeTicker(raw: Record<string, unknown>): Record<string, unknown> {
  const op = raw.option_pricing as Record<string, unknown> | null;
  const stats = raw.stats as Record<string, unknown> | null;
  const result: Record<string, unknown> = {
    bid: raw.b ?? null,
    ask: raw.a ?? null,
    bid_size: raw.B ?? null,
    ask_size: raw.A ?? null,
    mark: raw.M ?? null,
    index: raw.I ?? null,
    timestamp: raw.t ?? null,
    funding_rate: raw.f ?? null,
    min_price: raw.minp ?? null,
    max_price: raw.maxp ?? null,
  };

  if (op) {
    result.delta = op.d ?? null;
    result.gamma = op.g ?? null;
    result.theta = op.t ?? null;
    result.vega = op.v ?? null;
    result.iv = op.i ?? null;
    result.rho = op.r ?? null;
    result.forward_price = op.f ?? null;
    result.mark_price = op.m ?? null;
    result.bid_iv = op.bi ?? null;
    result.ask_iv = op.ai ?? null;
  }

  if (stats) {
    result.volume_24h = stats.v ?? null;
    result.open_interest = stats.oi ?? null;
    result.num_trades = stats.n ?? null;
    result.high_24h = stats.h ?? null;
    result.low_24h = stats.l ?? null;
  }

  return result;
}

export const getTickers: Action<typeof schema> = {
  name: "get_tickers",
  protocol: "derive",
  description:
    "Batch pricing for all instruments of a type. Returns MM streaming quotes (bid/ask/mark/greeks). " +
    "This is the PRIMARY pricing tool — shows real market maker quotes unlike get_ticker which only shows CLOB resting orders. " +
    "For options: currency AND expiry_date (YYYYMMDD) are required. " +
    "Use only_liquid=true to filter out dead strikes with no quotes (recommended — reduces response by ~60%). " +
    "Use min_delta/max_delta to focus on specific moneyness ranges. " +
    "Response: {tickers: {instrument_name: {bid, ask, bid_size, ask_size, mark, delta, iv, ...}}}",
  schema,
  responseSchema: rawResponseSchema,
  auth: "public",
  execute: async (params) => {
    const query: Record<string, unknown> = { instrument_type: params.instrument_type };
    if (params.currency) query.currency = params.currency;
    if (params.expiry_date) query.expiry_date = params.expiry_date;

    const raw = await publicRequest<{ tickers: Record<string, Record<string, unknown>> }>(
      "get_tickers",
      query
    );

    // Normalize abbreviated keys and apply filters
    const normalized: Record<string, Record<string, unknown>> = {};
    for (const [name, ticker] of Object.entries(raw.tickers)) {
      const norm = normalizeTicker(ticker);

      // Filter: only_liquid — skip instruments with zero bid AND zero ask
      if (params.only_liquid) {
        const bid = parseFloat(norm.bid as string || "0");
        const ask = parseFloat(norm.ask as string || "0");
        if (bid === 0 && ask === 0) continue;
      }

      // Filter: delta range (for options)
      if (norm.delta != null && (params.min_delta != null || params.max_delta != null)) {
        const absDelta = Math.abs(parseFloat(norm.delta as string || "0"));
        if (params.min_delta != null && absDelta < params.min_delta) continue;
        if (params.max_delta != null && absDelta > params.max_delta) continue;
      }

      normalized[name] = norm;
    }

    return { tickers: normalized };
  },
};
