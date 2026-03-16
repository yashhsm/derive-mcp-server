import { z } from "zod";
import type { Action } from "../../types.js";
import { privateRequest, requireSubaccount } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  subaccount_id: z.number().optional(),
  currency: z.string().optional(),
});

export const getMmpConfig: Action<typeof schema> = {
  name: "get_mmp_config",
  protocol: "derive",
  description: "Get MMP (Market Maker Protection) configuration.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "read",
  execute: async (params) => {
    const q: Record<string, unknown> = { subaccount_id: requireSubaccount(params.subaccount_id) };
    if (params.currency) q.currency = params.currency;
    return privateRequest("get_mmp_config", q);
  },
};
