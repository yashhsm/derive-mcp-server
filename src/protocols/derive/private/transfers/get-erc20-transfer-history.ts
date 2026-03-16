import { z } from "zod";
import type { Action } from "../../types.js";
import { privateRequest, requireSubaccount } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  subaccount_id: z.number().optional(),
  wallet: z.string().optional(),
  start_timestamp: z.number().optional(),
  end_timestamp: z.number().optional(),
});

export const getErc20TransferHistory: Action<typeof schema> = {
  name: "get_erc20_transfer_history",
  protocol: "derive",
  description: "Get ERC20 transfer history between subaccounts.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "read",
  execute: async (params) => {
    const q: Record<string, unknown> = {};
    if (params.subaccount_id) q.subaccount_id = params.subaccount_id;
    else if (params.wallet) q.wallet = params.wallet;
    else q.subaccount_id = requireSubaccount();
    if (params.start_timestamp) q.start_timestamp = params.start_timestamp;
    if (params.end_timestamp) q.end_timestamp = params.end_timestamp;
    return privateRequest("get_erc20_transfer_history", q);
  },
};
