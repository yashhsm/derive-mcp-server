import { z } from "zod";
import type { Action } from "../../types.js";
import { publicRequest } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  instrument_name: z.string().describe("Perp instrument (e.g., ETH-PERP)"),
  start_timestamp: z.number().optional().describe("Start time (ms)"),
  end_timestamp: z.number().optional().describe("End time (ms)"),
  period: z.number().optional().describe("Aggregation period in seconds (900/3600/14400/28800/86400)"),
});

export const getFundingRateHistory: Action<typeof schema> = {
  name: "get_funding_rate_history",
  protocol: "derive",
  description: "Get funding rate history for a perp instrument. Max 30 days lookback.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "public",
  execute: async (params) => publicRequest("get_funding_rate_history", params),
};
