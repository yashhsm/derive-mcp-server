import { z } from "zod";
import type { Action } from "../../types.js";
import { privateRequest, requireSubaccount } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  rfq_id: z.string().describe("RFQ ID to cancel"),
  subaccount_id: z.number().optional(),
});

export const cancelRfq: Action<typeof schema> = {
  name: "cancel_rfq",
  protocol: "derive",
  description: "Cancel an open RFQ.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "write",
  execute: async (params) => privateRequest("cancel_rfq", {
    rfq_id: params.rfq_id,
    subaccount_id: requireSubaccount(params.subaccount_id),
  }),
};
