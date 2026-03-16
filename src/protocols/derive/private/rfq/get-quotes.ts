import { z } from "zod";
import type { Action } from "../../types.js";
import { privateRequest, requireSubaccount } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  subaccount_id: z.number().optional(),
  rfq_id: z.string().optional(),
  quote_id: z.string().optional(),
  status: z.string().optional(),
  page: z.number().optional(),
  page_size: z.number().optional(),
});

export const getQuotes: Action<typeof schema> = {
  name: "get_quotes",
  protocol: "derive",
  description: "Get quotes for a subaccount. Filter by RFQ, quote ID, or status.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "read",
  execute: async (params) => {
    const q: Record<string, unknown> = { subaccount_id: requireSubaccount(params.subaccount_id) };
    if (params.rfq_id) q.rfq_id = params.rfq_id;
    if (params.quote_id) q.quote_id = params.quote_id;
    if (params.status) q.status = params.status;
    if (params.page) q.page = params.page;
    if (params.page_size) q.page_size = params.page_size;
    return privateRequest("get_quotes", q);
  },
};
