import { z } from "zod";
import type { Action } from "../../types.js";
import { publicRequest } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  currency: z.string().describe("Underlying currency (e.g., SOL, ETH, BTC)"),
  expiry_date: z.string().optional().describe("Single expiry to show (YYYYMMDD). If omitted, returns all expiries."),
  strike_min: z.number().optional().describe("Minimum strike price. Defaults to -30% from index price."),
  strike_max: z.number().optional().describe("Maximum strike price. Defaults to +30% from index price."),
  only_liquid: z.boolean().default(true).describe("Only show strikes with at least one side quoted (default true)."),
});

interface RawTicker {
  b?: string; a?: string; B?: string; A?: string; M?: string;
  I?: string; t?: number; minp?: string; maxp?: string;
  option_pricing?: {
    d?: string; g?: string; t?: string; v?: string;
    i?: string; m?: string; bi?: string; ai?: string;
  };
  stats?: { v?: string; oi?: string; n?: number };
}

interface ChainRow {
  strike: number;
  call: OptionQuote | null;
  put: OptionQuote | null;
}

interface OptionQuote {
  instrument: string;
  bid: number;
  ask: number;
  mark: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  oi: number;
  volume: number;
}

function parseQuote(name: string, raw: RawTicker): OptionQuote | null {
  const op = raw.option_pricing;
  return {
    instrument: name,
    bid: parseFloat(raw.b || "0"),
    ask: parseFloat(raw.a || "0"),
    mark: parseFloat(raw.M || op?.m || "0"),
    iv: parseFloat(op?.i || "0"),
    delta: parseFloat(op?.d || "0"),
    gamma: parseFloat(op?.g || "0"),
    theta: parseFloat(op?.t || "0"),
    vega: parseFloat(op?.v || "0"),
    oi: parseFloat(raw.stats?.oi || "0"),
    volume: parseFloat(raw.stats?.v || "0"),
  };
}

function parseInstrumentParts(name: string): { expiry: string; strike: number; type: "C" | "P" } | null {
  const parts = name.split("-");
  if (parts.length !== 4) return null;
  const strike = parseFloat(parts[2]);
  const type = parts[3] as "C" | "P";
  if (isNaN(strike) || (type !== "C" && type !== "P")) return null;
  return { expiry: parts[1], strike, type };
}

export const getOptionsChain: Action<typeof schema> = {
  name: "get_options_chain",
  protocol: "derive",
  description:
    "Get a structured options chain for a currency — strikes as rows, calls and puts as columns, with bid/ask/mark/IV/greeks/OI. " +
    "This is the RECOMMENDED tool for analyzing options. Returns a compact, pre-filtered chain instead of raw ticker data. " +
    "Defaults to only_liquid=true and ±30% from spot. " +
    "Response: {index_price, expiries: [{expiry, chain: [{strike, call: {bid,ask,mark,iv,delta,...}, put: {...}}]}]}",
  schema,
  responseSchema: rawResponseSchema,
  auth: "public",
  execute: async (params) => {
    // First get the index price from the perp
    let indexPrice: number;
    try {
      const perp = await publicRequest<{ index_price: string }>("get_ticker", {
        instrument_name: `${params.currency}-PERP`,
      });
      indexPrice = parseFloat(perp.index_price);
    } catch {
      indexPrice = 0;
    }

    // Determine which expiries to fetch
    let expiries: string[];
    if (params.expiry_date) {
      expiries = [params.expiry_date];
    } else {
      // Get all instruments to discover expiries
      const instruments = await publicRequest<any[]>("get_instruments", {
        currency: params.currency,
        instrument_type: "option",
        expired: false,
      });
      const expirySet = new Set<string>();
      for (const inst of instruments) {
        const parsed = parseInstrumentParts(inst.instrument_name);
        if (parsed) expirySet.add(parsed.expiry);
      }
      expiries = Array.from(expirySet).sort();
    }

    // Determine strike range
    const strikeMin = params.strike_min ?? (indexPrice > 0 ? Math.floor(indexPrice * 0.7) : 0);
    const strikeMax = params.strike_max ?? (indexPrice > 0 ? Math.ceil(indexPrice * 1.3) : Infinity);

    // Fetch tickers for all expiries in parallel
    const rawResults = await Promise.all(
      expiries.map(async (expiry) => {
        const raw = await publicRequest<{ tickers: Record<string, RawTicker> }>(
          "get_tickers",
          { instrument_type: "option", currency: params.currency, expiry_date: expiry }
        );
        return { expiry, raw };
      })
    );

    // Build chain from results
    const result: {
      expiry: string;
      dte: number;
      chain: ChainRow[];
    }[] = [];

    for (const { expiry, raw } of rawResults) {
      // Group by strike
      const strikeMap = new Map<number, { call?: OptionQuote; put?: OptionQuote }>();

      for (const [name, ticker] of Object.entries(raw.tickers)) {
        const parsed = parseInstrumentParts(name);
        if (!parsed) continue;
        if (parsed.strike < strikeMin || parsed.strike > strikeMax) continue;

        const quote = parseQuote(name, ticker);
        if (!quote) continue;

        // Filter illiquid
        if (params.only_liquid && quote.bid === 0 && quote.ask === 0) continue;

        if (!strikeMap.has(parsed.strike)) strikeMap.set(parsed.strike, {});
        const entry = strikeMap.get(parsed.strike)!;
        if (parsed.type === "C") entry.call = quote;
        else entry.put = quote;
      }

      // Build sorted chain rows
      const chain: ChainRow[] = Array.from(strikeMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([strike, { call, put }]) => ({ strike, call: call ?? null, put: put ?? null }));

      if (chain.length === 0) continue;

      // Calculate DTE
      const year = parseInt(expiry.slice(0, 4));
      const month = parseInt(expiry.slice(4, 6)) - 1;
      const day = parseInt(expiry.slice(6, 8));
      const expiryDate = new Date(Date.UTC(year, month, day, 8, 0, 0)); // 08:00 UTC settlement
      const dte = Math.max(0, Math.ceil((expiryDate.getTime() - Date.now()) / 86400000));

      result.push({ expiry, dte, chain });
    }

    return {
      currency: params.currency,
      index_price: parseFloat(indexPrice.toFixed(2)),
      expiries: result,
    };
  },
};
