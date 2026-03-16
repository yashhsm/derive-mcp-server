import { z } from "zod";
import type { Action } from "../../types.js";
import { privateRequest, requireSubaccount } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  subaccount_id: z.number().optional().describe("Subaccount ID (defaults to configured)"),
});

export const getCollaterals: Action<typeof schema> = {
  name: "get_collaterals",
  protocol: "derive",
  description: "Get all collateral holdings with mark values, interest, and PnL.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "read",
  execute: async (params) => privateRequest("get_collaterals", { subaccount_id: requireSubaccount(params.subaccount_id) }),
};
