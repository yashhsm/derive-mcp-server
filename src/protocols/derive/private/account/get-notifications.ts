import { z } from "zod";
import type { Action } from "../../types.js";
import { privateRequest, requireSubaccount } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  subaccount_id: z.number().optional(),
  wallet: z.string().optional(),
  status: z.string().optional(),
  type: z.string().optional(),
  page: z.number().optional(),
  page_size: z.number().optional(),
});

export const getNotifications: Action<typeof schema> = {
  name: "get_notifications",
  protocol: "derive",
  description: "Get account notifications.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "read",
  execute: async (params) => {
    const q: Record<string, unknown> = {};
    if (params.subaccount_id) q.subaccount_id = params.subaccount_id;
    else if (params.wallet) q.wallet = params.wallet;
    else q.subaccount_id = requireSubaccount();
    if (params.status) q.status = params.status;
    if (params.type) q.type = params.type;
    if (params.page) q.page = params.page;
    if (params.page_size) q.page_size = params.page_size;
    return privateRequest("get_notifications", q);
  },
};
