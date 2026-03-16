import { z } from "zod";
import type { Action } from "../../types.js";
import { privateRequest, requireSubaccount } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  instrument_name: z.string().describe("Instrument name"),
  subaccount_id: z.number().optional(),
});

export const cancelByInstrument: Action<typeof schema> = {
  name: "cancel_by_instrument",
  protocol: "derive",
  description: "Cancel all orders for a specific instrument.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "write",
  execute: async (params) => privateRequest("cancel_by_instrument", {
    subaccount_id: requireSubaccount(params.subaccount_id),
    instrument_name: params.instrument_name,
  }),
};
