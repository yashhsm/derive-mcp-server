import { z } from "zod";
import type { Action } from "../../types.js";
import { publicRequest } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  subaccount_id: z.number().optional().describe("Filter by subaccount"),
  start_timestamp: z.number().optional().describe("Start time (ms)"),
  end_timestamp: z.number().optional().describe("End time (ms)"),
  page: z.number().optional().describe("Page number"),
  page_size: z.number().optional().describe("Results per page"),
});

export const getLiquidationHistory: Action<typeof schema> = {
  name: "get_liquidation_history",
  protocol: "derive",
  description: "Get liquidation auction history.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "public",
  execute: async (params) => publicRequest("get_liquidation_history", params),
};
