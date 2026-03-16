import { z } from "zod";
import type { Action } from "../../types.js";
import { privateRequest, WALLET_ADDRESS } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  enabled: z.boolean().describe("Enable/disable cancel-on-disconnect"),
  wallet: z.string().optional().describe("Wallet address (defaults to configured)"),
});

export const setCancelOnDisconnect: Action<typeof schema> = {
  name: "set_cancel_on_disconnect",
  protocol: "derive",
  description: "Enable/disable auto-cancel all orders on WebSocket disconnect.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "write",
  execute: async (params) => {
    const w = params.wallet || WALLET_ADDRESS;
    if (!w) throw new Error("Wallet address required");
    return privateRequest("set_cancel_on_disconnect", { wallet: w, enabled: params.enabled });
  },
};
