import { z } from "zod";
import type { Action } from "../../types.js";
import { privateRequest, requireSubaccount } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  subaccount_id: z.number().optional().describe("Subaccount ID (defaults to configured)"),
  order_id: z.string().describe("Order ID to look up (returned by place_order)"),
});

export const getOrder: Action<typeof schema> = {
  name: "get_order",
  protocol: "derive",
  description:
    "Get a single order's current state: status, filled_amount, average_price, fees. " +
    "Use this after place_order to confirm fills — especially for IOC orders which vanish from get_open_orders immediately. " +
    "Returns: order_id, status (open/filled/cancelled/expired), filled_amount, average_price, limit_price, direction, label, creation_timestamp.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "read",
  execute: async (params) => {
    return privateRequest("get_order", {
      subaccount_id: requireSubaccount(params.subaccount_id),
      order_id: params.order_id,
    });
  },
};
