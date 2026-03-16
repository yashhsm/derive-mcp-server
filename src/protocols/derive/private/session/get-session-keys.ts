import { z } from "zod";
import type { Action } from "../../types.js";
import { privateRequest, WALLET_ADDRESS } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  wallet: z.string().optional(),
});

export const getSessionKeys: Action<typeof schema> = {
  name: "get_session_keys",
  protocol: "derive",
  description: "List all session keys for a wallet.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "read",
  execute: async (params) => {
    const w = params.wallet || WALLET_ADDRESS;
    if (!w) throw new Error("Wallet address required");
    return privateRequest("session_keys", { wallet: w });
  },
};
