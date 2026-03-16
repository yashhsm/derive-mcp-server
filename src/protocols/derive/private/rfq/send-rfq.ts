import { z } from "zod";
import type { Action } from "../../types.js";
import { privateRequest, requireSubaccount } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  subaccount_id: z.number().optional(),
  legs: z.array(z.object({
    instrument_name: z.string(),
    direction: z.enum(["buy", "sell"]),
    amount: z.string(),
  })).describe("RFQ legs"),
  label: z.string().optional(),
});

export const sendRfq: Action<typeof schema> = {
  name: "send_rfq",
  protocol: "derive",
  description: "Send a Request for Quote (multi-leg) to market makers.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "write",
  execute: async (params) => {
    const q: Record<string, unknown> = { subaccount_id: requireSubaccount(params.subaccount_id), legs: params.legs };
    if (params.label) q.label = params.label;
    return privateRequest("send_rfq", q);
  },
};
