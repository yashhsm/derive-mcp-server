import { z } from "zod";
import type { Action } from "../../types.js";
import { publicRequest } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  currency: z.string().describe("Currency (ETH, BTC)"),
  start_timestamp: z.number().describe("Start time (seconds)"),
  end_timestamp: z.number().describe("End time (seconds)"),
  period: z.number().describe("Candle period in seconds (60, 300, 900, 3600, 14400, 86400, 604800)"),
});

export const getIndexChartData: Action<typeof schema> = {
  name: "get_index_chart_data",
  protocol: "derive",
  description: "Get spot/index OHLC candle data for a currency.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "public",
  execute: async (params) => publicRequest("get_index_chart_data", params),
};
