import { z } from "zod";
import type { Action } from "../../types.js";
import { privateRequest, requireSubaccount } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  subaccount_id: z.number().optional().describe("Subaccount ID (defaults to configured)"),
});

export const getPositions: Action<typeof schema> = {
  name: "get_positions",
  protocol: "derive",
  description: "Get all active positions with Greeks, PnL, margin, and liquidation prices.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "read",
  execute: async (params) => privateRequest("get_positions", { subaccount_id: requireSubaccount(params.subaccount_id) }),
};
