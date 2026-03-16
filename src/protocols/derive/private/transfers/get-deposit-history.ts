import { z } from "zod";
import type { Action } from "../../types.js";
import { privateRequest, requireSubaccount } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  subaccount_id: z.number().optional(),
  start_timestamp: z.number().optional(),
  end_timestamp: z.number().optional(),
});

export const getDepositHistory: Action<typeof schema> = {
  name: "get_deposit_history",
  protocol: "derive",
  description: "Get deposit history for a subaccount.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "read",
  execute: async (params) => {
    const q: Record<string, unknown> = { subaccount_id: requireSubaccount(params.subaccount_id) };
    if (params.start_timestamp) q.start_timestamp = params.start_timestamp;
    if (params.end_timestamp) q.end_timestamp = params.end_timestamp;
    return privateRequest("get_deposit_history", q);
  },
};
