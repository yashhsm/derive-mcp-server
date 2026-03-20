import { z } from "zod";
import type { Action } from "../../types.js";
import { publicRequest } from "../../client.js";
import { tickerSchema } from "../../response-schemas.js";

export const schema = z.object({
  instrument_name: z.string().describe("Instrument name (e.g., ETH-PERP, ETH-20260320-3000-C)"),
});

export const getTicker: Action<typeof schema> = {
  name: "get_ticker",
  protocol: "derive",
  description:
    "Get detailed instrument data: mark price, index, Greeks, funding, open interest, fees, tick size, minimum_amount, amount_step. " +
    "WARNING FOR OPTIONS: bid/ask here are CLOB resting orders only — options trade primarily via MM streaming quotes, " +
    "so CLOB bid/ask is often $0 or wildly off-market. For option pricing/execution, ALWAYS use get_tickers instead. " +
    "For PERPS: bid/ask from get_ticker is fine — perps have active CLOB liquidity. " +
    "Use this tool for: perp pricing, instrument metadata (tick_size, minimum_amount, amount_step), and funding rates.",
  schema,
  responseSchema: tickerSchema,
  auth: "public",
  execute: async (params) => publicRequest("get_ticker", params),
};
