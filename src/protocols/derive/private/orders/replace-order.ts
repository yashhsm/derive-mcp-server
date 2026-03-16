import { z } from "zod";
import type { Action } from "../../types.js";
import { privateRequest } from "../../client.js";
import { signOrderPayload } from "../../signing.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  order_id_to_cancel: z.string().describe("Order ID to cancel"),
  instrument_name: z.string().describe("Instrument name"),
  direction: z.enum(["buy", "sell"]).describe("Order direction"),
  amount: z.string().describe("New order amount"),
  limit_price: z.string().describe("New limit price"),
  max_fee: z.string().default("100").describe("Maximum fee"),
  order_type: z.enum(["limit", "market"]).default("limit"),
  time_in_force: z.enum(["gtc", "post_only", "fok", "ioc"]).default("gtc"),
  reduce_only: z.boolean().default(false),
  expected_filled_amount: z.string().optional(),
});

export const replaceOrder: Action<typeof schema> = {
  name: "replace_order",
  protocol: "derive",
  description: "Atomically cancel an existing order and create a new one. If cancel fails, the new order is not placed.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "write",
  execute: async (params) => {
    const signedPayload = await signOrderPayload({
      instrument_name: params.instrument_name,
      direction: params.direction,
      amount: params.amount,
      limit_price: params.limit_price,
      max_fee: params.max_fee,
      order_type: params.order_type,
      time_in_force: params.time_in_force,
      reduce_only: params.reduce_only,
    });
    (signedPayload as any).order_id_to_cancel = params.order_id_to_cancel;
    if (params.expected_filled_amount) (signedPayload as any).expected_filled_amount = params.expected_filled_amount;
    return privateRequest("replace", signedPayload);
  },
};
