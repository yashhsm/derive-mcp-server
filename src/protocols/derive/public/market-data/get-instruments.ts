import { z } from "zod";
import type { Action } from "../../types.js";
import { publicRequest } from "../../client.js";
import { rawResponseSchema } from "../../response-schemas.js";

export const schema = z.object({
  currency: z.string().describe("Underlying currency (e.g., ETH, BTC)"),
  instrument_type: z.enum(["option", "perp", "erc20"]).describe("Instrument type"),
  expired: z.boolean().default(false).describe("Include expired instruments"),
  strike_min: z.number().optional().describe("For options: minimum strike price filter. Reduces response size dramatically — use this to avoid huge responses."),
  strike_max: z.number().optional().describe("For options: maximum strike price filter. Combine with strike_min to focus on a specific price range (e.g., ±30% from current spot)."),
  expiry_date: z.string().optional().describe("For options: filter to a single expiry (YYYYMMDD). Reduces response from hundreds of instruments to just one expiry."),
  compact: z.boolean().default(false).describe("If true, return only essential fields (instrument_name, strike, expiry, option_type, tick_size, minimum_amount, amount_step) instead of full instrument details. Recommended when you just need to know what's available."),
});

/** Parse strike from instrument name like SOL-20260327-85-P */
function parseStrike(name: string): number | null {
  const parts = name.split("-");
  if (parts.length >= 3) {
    const strike = parseFloat(parts[2]);
    if (!isNaN(strike)) return strike;
  }
  return null;
}

/** Parse expiry from instrument name like SOL-20260327-85-P */
function parseExpiry(name: string): string | null {
  const parts = name.split("-");
  if (parts.length >= 2 && /^\d{8}$/.test(parts[1])) return parts[1];
  return null;
}

export const getInstruments: Action<typeof schema> = {
  name: "get_instruments",
  protocol: "derive",
  description:
    "Get active instruments for a currency and type. For options, this can return hundreds of instruments — " +
    "use strike_min/strike_max and/or expiry_date to filter, and compact=true for minimal output. " +
    "Without filters, the response can be very large (200KB+).",
  schema,
  responseSchema: rawResponseSchema,
  auth: "public",
  execute: async (params) => {
    const apiParams: Record<string, unknown> = {
      currency: params.currency,
      instrument_type: params.instrument_type,
      expired: params.expired,
    };
    const result = await publicRequest<unknown[]>("get_instruments", apiParams);

    let instruments = result;

    // Apply client-side filters for options
    if (params.instrument_type === "option") {
      if (params.strike_min != null || params.strike_max != null) {
        instruments = instruments.filter((inst: any) => {
          const strike = parseStrike(inst.instrument_name);
          if (strike == null) return true;
          if (params.strike_min != null && strike < params.strike_min) return false;
          if (params.strike_max != null && strike > params.strike_max) return false;
          return true;
        });
      }

      if (params.expiry_date) {
        instruments = instruments.filter((inst: any) => {
          const expiry = parseExpiry(inst.instrument_name);
          return expiry === params.expiry_date;
        });
      }
    }

    // Compact mode: return only essential fields
    if (params.compact) {
      instruments = instruments.map((inst: any) => {
        const compact: Record<string, unknown> = {
          instrument_name: inst.instrument_name,
          tick_size: inst.tick_size,
          minimum_amount: inst.minimum_amount,
          amount_step: inst.amount_step,
        };
        if (inst.option_details) {
          compact.strike = inst.option_details.strike;
          compact.expiry = inst.option_details.expiry;
          compact.option_type = inst.option_details.option_type;
        }
        return compact;
      });
    }

    return instruments;
  },
};
