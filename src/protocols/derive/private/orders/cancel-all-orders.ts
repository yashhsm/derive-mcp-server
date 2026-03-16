import { z } from "zod";
import type { Action } from "../../types.js";
import { privateRequest, requireSubaccount } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  subaccount_id: z.number().optional(),
  cancel_trigger_orders: z.boolean().optional().describe("Also cancel trigger (stop/TP) orders"),
});

export const cancelAllOrders: Action<typeof schema> = {
  name: "cancel_all_orders",
  protocol: "derive",
  description: "Cancel ALL open orders for a subaccount. Use with caution.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "write",
  execute: async (params) => {
    const q: Record<string, unknown> = { subaccount_id: requireSubaccount(params.subaccount_id) };
    if (params.cancel_trigger_orders !== undefined) q.cancel_trigger_orders = params.cancel_trigger_orders;
    return privateRequest("cancel_all", q);
  },
};
