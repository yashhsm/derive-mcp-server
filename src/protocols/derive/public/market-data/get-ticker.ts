import { z } from "zod";
import type { Action } from "../../types.js";
import { publicRequest } from "../../client.js";
import { tickerSchema } from "../../response-schemas.js";

export const schema = z.object({
  instrument_name: z.string().describe("Instrument name (e.g., ETH-PERP, ETH-20260320-3000-C)"),
});

export const getTicker: Action<typeof schema> = {
  name: "get_ticker",
  protocol: "derive",
  description: "Get detailed instrument data: mark price, index, Greeks, funding, open interest, fees, tick size. NOTE: bid/ask here are CLOB resting orders only — for MM streaming quotes (what the UI shows), use get_tickers batch endpoint instead.",
  schema,
  responseSchema: tickerSchema,
  auth: "public",
  execute: async (params) => publicRequest("get_ticker", params),
};
