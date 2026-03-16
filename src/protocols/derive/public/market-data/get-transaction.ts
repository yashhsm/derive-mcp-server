import { z } from "zod";
import type { Action } from "../../types.js";
import { publicRequest } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  transaction_id: z.string().describe("The transaction ID to look up"),
});

export const getTransaction: Action<typeof schema> = {
  name: "get_transaction",
  protocol: "derive",
  description: "Look up transaction status: requested, pending, settled, reverted, ignored, or timed_out.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "public",
  execute: async (params) => publicRequest("get_transaction", params),
};
