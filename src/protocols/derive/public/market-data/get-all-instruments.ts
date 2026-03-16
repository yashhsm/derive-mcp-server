import { z } from "zod";
import type { Action } from "../../types.js";
import { publicRequest } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  instrument_type: z.enum(["option", "perp", "erc20"]).describe("Instrument type"),
  expired: z.boolean().default(false).describe("Include expired instruments"),
  page: z.number().optional().describe("Page number (default 1)"),
  page_size: z.number().optional().describe("Results per page (default 100)"),
});

export const getAllInstruments: Action<typeof schema> = {
  name: "get_all_instruments",
  protocol: "derive",
  description: "Paginated list of all instruments across currencies. Returns {instruments, pagination}.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "public",
  execute: async (params) => {
    const query: Record<string, unknown> = { instrument_type: params.instrument_type, expired: params.expired };
    if (params.page) query.page = params.page;
    if (params.page_size) query.page_size = params.page_size;
    return publicRequest("get_all_instruments", query);
  },
};
