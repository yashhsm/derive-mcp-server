import { z } from "zod";
import type { Action } from "../../types.js";
import { publicRequest } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  currency: z.string().optional().describe("Currency (ETH, BTC)"),
  instrument_name: z.string().optional().describe("Specific instrument name"),
  instrument_type: z.enum(["option", "perp", "erc20"]).optional().describe("Instrument type"),
  page: z.number().optional().describe("Page number"),
  page_size: z.number().optional().describe("Results per page"),
});

export const getTradeHistoryPublic: Action<typeof schema> = {
  name: "get_trade_history_public",
  protocol: "derive",
  description: "Get public trade history. Filter by currency, instrument, type, or time range.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "public",
  execute: async (params) => publicRequest("get_trade_history", params),
};
