import { z } from "zod";
import type { Action } from "../../types.js";
import { privateRequest, requireSubaccount } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  subaccount_id: z.number().optional(),
  rfq_id: z.string().optional(),
  status: z.string().optional(),
  page: z.number().optional(),
  page_size: z.number().optional(),
});

export const getRfqs: Action<typeof schema> = {
  name: "get_rfqs",
  protocol: "derive",
  description: "Get RFQs for a subaccount. Filter by status or time.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "read",
  execute: async (params) => {
    const q: Record<string, unknown> = { subaccount_id: requireSubaccount(params.subaccount_id) };
    if (params.rfq_id) q.rfq_id = params.rfq_id;
    if (params.status) q.status = params.status;
    if (params.page) q.page = params.page;
    if (params.page_size) q.page_size = params.page_size;
    return privateRequest("get_rfqs", q);
  },
};
