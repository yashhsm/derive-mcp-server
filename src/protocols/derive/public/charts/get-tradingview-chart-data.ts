import { z } from "zod";
import type { Action } from "../../types.js";
import { publicRequest } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  instrument_name: z.string().describe("Instrument name"),
  start_timestamp: z.number().describe("Start time (seconds)"),
  end_timestamp: z.number().describe("End time (seconds)"),
  period: z.number().describe("Candle period in seconds"),
});

export const getTradingviewChartData: Action<typeof schema> = {
  name: "get_tradingview_chart_data",
  protocol: "derive",
  description: "Get OHLCV candle data for a specific instrument (trades-based).",
  schema,
  responseSchema: rawResponseSchema,
  auth: "public",
  execute: async (params) => publicRequest("get_tradingview_chart_data", params),
};
