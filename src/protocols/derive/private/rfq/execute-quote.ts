import { z } from "zod";
import type { Action } from "../../types.js";
import { privateRequest, requireSubaccount } from "../../client.js";
import { signOrderPayload } from "../../signing.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  subaccount_id: z.number().optional(),
  quote_id: z.string().describe("Quote ID to accept (from get_quotes)"),
  legs: z.array(z.object({
    instrument_name: z.string(),
    direction: z.enum(["buy", "sell"]),
    amount: z.string(),
    limit_price: z.string(),
    max_fee: z.string().default("100"),
  })).describe("Legs to execute — must match the original RFQ legs. Prices come from the quote response."),
  label: z.string().optional().describe("Optional label for the resulting trades"),
});

export const executeQuote: Action<typeof schema> = {
  name: "execute_quote",
  protocol: "derive",
  description:
    "Accept and execute an RFQ quote. Completes the RFQ flow: send_rfq → get_quotes → execute_quote. " +
    "Each leg needs EIP-712 signing, which is handled automatically. " +
    "The quote_id ties the execution to the MM's quote, ensuring you get the quoted price.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "write",
  execute: async (params) => {
    const subId = requireSubaccount(params.subaccount_id);

    // Sign each leg
    const signedLegs = await Promise.all(
      params.legs.map(async (leg) => {
        const signed = await signOrderPayload({
          instrument_name: leg.instrument_name,
          direction: leg.direction,
          amount: leg.amount,
          limit_price: leg.limit_price,
          max_fee: leg.max_fee,
          order_type: "limit",
          time_in_force: "gtc",
        });
        return signed;
      })
    );

    const q: Record<string, unknown> = {
      subaccount_id: subId,
      quote_id: params.quote_id,
      legs: signedLegs,
    };
    if (params.label) q.label = params.label;

    return privateRequest("execute_quote", q);
  },
};
