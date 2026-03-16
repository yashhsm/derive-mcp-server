import { z } from "zod";
import type { Action } from "../../types.js";
import { privateRequest, requireSubaccount } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  subaccount_id: z.number().optional().describe("Subaccount ID (defaults to configured)"),
});

export const getSubaccount: Action<typeof schema> = {
  name: "get_subaccount",
  protocol: "derive",
  description:
    "Full subaccount snapshot: collaterals, open orders, positions, margin, portfolio value. " +
    "IMPORTANT: Check margin_type field (SM = Standard Margin, PM/PM2 = Portfolio Margin). " +
    "SM: short options require full naked margin, spreads NOT netted. Only long options and perps practical. " +
    "PM/PM2: spreads are netted, credit spreads work, lower margin for hedged positions. " +
    "Always check margin_type BEFORE planning any strategy involving short options.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "read",
  execute: async (params) => privateRequest("get_subaccount", { subaccount_id: requireSubaccount(params.subaccount_id) }),
};
