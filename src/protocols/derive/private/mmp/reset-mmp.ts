import { z } from "zod";
import type { Action } from "../../types.js";
import { privateRequest, requireSubaccount } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  subaccount_id: z.number().optional(),
  currency: z.string().optional(),
});

export const resetMmp: Action<typeof schema> = {
  name: "reset_mmp",
  protocol: "derive",
  description: "Manually reset/unfreeze MMP.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "write",
  execute: async (params) => {
    const q: Record<string, unknown> = { subaccount_id: requireSubaccount(params.subaccount_id) };
    if (params.currency) q.currency = params.currency;
    return privateRequest("reset_mmp", q);
  },
};
