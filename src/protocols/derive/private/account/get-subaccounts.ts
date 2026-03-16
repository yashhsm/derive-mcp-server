import { z } from "zod";
import type { Action } from "../../types.js";
import { privateRequest, WALLET_ADDRESS } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  wallet: z.string().optional().describe("Wallet address (defaults to configured)"),
});

export const getSubaccounts: Action<typeof schema> = {
  name: "get_subaccounts",
  protocol: "derive",
  description: "List all subaccount IDs for a wallet.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "read",
  execute: async (params) => {
    const w = params.wallet || WALLET_ADDRESS;
    if (!w) throw new Error("Wallet address required");
    return privateRequest("get_subaccounts", { wallet: w });
  },
};
