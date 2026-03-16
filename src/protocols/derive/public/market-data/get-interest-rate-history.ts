import { z } from "zod";
import type { Action } from "../../types.js";
import { publicRequest } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  from_timestamp_sec: z.number().describe("Start time (seconds)"),
  to_timestamp_sec: z.number().describe("End time (seconds)"),
  page: z.number().optional().describe("Page number"),
  page_size: z.number().optional().describe("Results per page"),
});

export const getInterestRateHistory: Action<typeof schema> = {
  name: "get_interest_rate_history",
  protocol: "derive",
  description: "Get USDC borrow/supply APY history.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "public",
  execute: async (params) => publicRequest("get_interest_rate_history", params),
};
