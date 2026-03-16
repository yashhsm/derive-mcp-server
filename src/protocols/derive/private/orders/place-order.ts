import { z } from "zod";
import type { Action } from "../../types.js";
import { privateRequest } from "../../client.js";
import { signOrderPayload } from "../../signing.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  instrument_name: z.string().describe("Instrument (e.g., ETH-PERP, ETH-20260320-3000-C)"),
  direction: z.enum(["buy", "sell"]).describe("Order direction"),
  amount: z.string().describe("Order amount (in contracts)"),
  limit_price: z.string().describe("Limit price (in USD)"),
  max_fee: z.string().default("100").describe("Maximum fee willing to pay (USDC)"),
  order_type: z.enum(["limit", "market"]).default("limit").describe("Order type"),
  time_in_force: z.enum(["gtc", "post_only", "fok", "ioc"]).default("gtc").describe("Time in force"),
  reduce_only: z.boolean().default(false).describe("Reduce-only order"),
  label: z.string().optional().describe("Optional label"),
});

export const placeOrder: Action<typeof schema> = {
  name: "place_order",
  protocol: "derive",
  description:
    "Place an order. Handles EIP-712 signing automatically. Returns order status and any immediate fills. " +
    "MARGIN RULES: Selling/shorting options requires margin. On Standard Margin (SM), short options are treated as NAKED — " +
    "the full margin is required even if you hold a protective long leg. SM does NOT recognize spreads. " +
    "Credit spreads (bull put, bear call) ONLY work on Portfolio Margin (PM/PM2). " +
    "Before selling options: 1) check margin_type via get_subaccount, 2) simulate the sell leg ALONE via get_margin, " +
    "3) if SM, only sell options if you have enough margin for naked exposure. " +
    "Buying options only requires the premium — no additional margin needed.",
  schema,
  responseSchema: rawResponseSchema,
  auth: "write",
  execute: async (params) => {
    const signedPayload = await signOrderPayload(params);
    return privateRequest("order", signedPayload);
  },
};
