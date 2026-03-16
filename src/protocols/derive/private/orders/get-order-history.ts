import { z } from "zod";
import type { Action } from "../../types.js";
import { privateRequest, requireSubaccount } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  subaccount_id: z.number().optional(),
  wallet: z.string().optional(),
  from_timestamp: z.number().optional(),
  to_timestamp: z.number().optional(),
  page: z.number().optional(),
  page_size: z.number().optional(),
});

export const getOrderHistory: Action<typeof schema> = {
  name: "get_order_history",
  protocol: "derive",
  description: "Get historical orders for a subaccount or wallet.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "read",
  execute: async (params) => {
    const q: Record<string, unknown> = {};
    if (params.subaccount_id) q.subaccount_id = params.subaccount_id;
    else if (params.wallet) q.wallet = params.wallet;
    else q.subaccount_id = requireSubaccount();
    if (params.from_timestamp) q.from_timestamp = params.from_timestamp;
    if (params.to_timestamp) q.to_timestamp = params.to_timestamp;
    if (params.page) q.page = params.page;
    if (params.page_size) q.page_size = params.page_size;
    return privateRequest("get_order_history", q);
  },
};
