import { z } from "zod";
import type { Action } from "../../types.js";
import { privateRequest, requireSubaccount } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  label: z.string().describe("Label to match"),
  instrument_name: z.string().optional().describe("Optional instrument filter"),
  subaccount_id: z.number().optional(),
});

export const cancelByLabel: Action<typeof schema> = {
  name: "cancel_by_label",
  protocol: "derive",
  description: "Cancel all orders with a specific label.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "write",
  execute: async (params) => {
    const q: Record<string, unknown> = { subaccount_id: requireSubaccount(params.subaccount_id), label: params.label };
    if (params.instrument_name) q.instrument_name = params.instrument_name;
    return privateRequest("cancel_by_label", q);
  },
};
