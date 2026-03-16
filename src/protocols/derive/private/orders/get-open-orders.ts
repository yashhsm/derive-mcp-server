import { z } from "zod";
import type { Action } from "../../types.js";
import { privateRequest, requireSubaccount } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  subaccount_id: z.number().optional(),
});

export const getOpenOrders: Action<typeof schema> = {
  name: "get_open_orders",
  protocol: "derive",
  description: "Get all open orders for a subaccount.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "read",
  execute: async (params) => privateRequest("get_open_orders", { subaccount_id: requireSubaccount(params.subaccount_id) }),
};
