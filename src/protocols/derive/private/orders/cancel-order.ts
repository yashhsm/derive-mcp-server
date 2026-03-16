import { z } from "zod";
import type { Action } from "../../types.js";
import { privateRequest, requireSubaccount } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  order_id: z.string().describe("Order ID to cancel"),
  instrument_name: z.string().describe("Instrument name of the order"),
  subaccount_id: z.number().optional().describe("Subaccount ID (defaults to configured)"),
});

export const cancelOrder: Action<typeof schema> = {
  name: "cancel_order",
  protocol: "derive",
  description: "Cancel a single order by order ID.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "write",
  execute: async (params) => privateRequest("cancel", {
    subaccount_id: requireSubaccount(params.subaccount_id),
    order_id: params.order_id,
    instrument_name: params.instrument_name,
  }),
};
