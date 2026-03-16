import { z } from "zod";
import type { Action } from "../../types.js";
import { privateRequest, requireSubaccount } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  subaccount_id: z.number().optional(),
  currency: z.string().describe("Currency to configure MMP for"),
  mmp_interval: z.number().describe("MMP check interval (ms). 0 = disabled"),
  mmp_frozen_time: z.number().describe("Freeze duration (ms). 0 = manual reset only"),
  mmp_amount_limit: z.string().optional(),
  mmp_delta_limit: z.string().optional(),
});

export const setMmpConfig: Action<typeof schema> = {
  name: "set_mmp_config",
  protocol: "derive",
  description: "Configure MMP. Set interval=0 to disable, frozen_time=0 for manual-only reset.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "write",
  execute: async (params) => {
    const q: Record<string, unknown> = {
      subaccount_id: requireSubaccount(params.subaccount_id),
      currency: params.currency,
      mmp_interval: params.mmp_interval,
      mmp_frozen_time: params.mmp_frozen_time,
    };
    if (params.mmp_amount_limit) q.mmp_amount_limit = params.mmp_amount_limit;
    if (params.mmp_delta_limit) q.mmp_delta_limit = params.mmp_delta_limit;
    return privateRequest("set_mmp_config", q);
  },
};
