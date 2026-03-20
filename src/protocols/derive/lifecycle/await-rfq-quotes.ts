// ============================================
// ORDER LIFECYCLE MANAGER — await_rfq_quotes
// ============================================

import { z } from "zod";
import type { RfqReceipt, RfqQuote } from "./types.js";
import { appendEvent } from "./audit-store.js";
import { getQuotes } from "../private/rfq/get-quotes.js";
import { getRfqs } from "../private/rfq/get-rfqs.js";
import { requireSubaccount } from "../client.js";

export const awaitRfqQuotesSchema = z.object({
  rfq_id: z.string().describe("RFQ ID to poll for quotes"),
  max_wait_seconds: z.number().default(30).describe("Maximum seconds to wait for quotes (default 30)"),
  poll_interval_seconds: z.number().default(2).describe("Seconds between polls (default 2)"),
  subaccount_id: z.number().optional().describe("Subaccount ID (defaults to configured)"),
});

export const awaitRfqQuotesDescription =
  "Poll for quotes on an open RFQ. Returns all received quotes without executing any. " +
  "Does NOT cancel the RFQ on timeout — it remains open until valid_until or explicit cancel. " +
  "If quotes are found, status is 'QUOTED'. If timeout with no quotes, status remains 'OPEN'. " +
  "Use accept_rfq_quote to execute a specific quote.";

export async function executeAwaitRfqQuotes(
  params: z.infer<typeof awaitRfqQuotesSchema>,
): Promise<RfqReceipt> {
  const subaccountId = requireSubaccount(params.subaccount_id);
  const maxWaitMs = params.max_wait_seconds * 1000;
  const pollIntervalMs = params.poll_interval_seconds * 1000;
  const startTime = Date.now();

  let quotes: RfqQuote[] = [];

  // Poll for quotes
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const raw = await getQuotes.execute({
        rfq_id: params.rfq_id,
        subaccount_id: subaccountId,
      }) as { quotes: Record<string, any>[] };

      if (raw.quotes && raw.quotes.length > 0) {
        quotes = raw.quotes.map(normalizeQuote);
        break;
      }
    } catch {
      // Polling error — continue
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  // Fetch current RFQ state
  let rfqStatus: "OPEN" | "QUOTED" | "CANCELLED" | "EXPIRED" = quotes.length > 0 ? "QUOTED" : "OPEN";
  let rfqData: Record<string, any> = {};
  try {
    const rfqs = await getRfqs.execute({
      rfq_id: params.rfq_id,
      subaccount_id: subaccountId,
    }) as { rfqs: Record<string, any>[] };
    if (rfqs.rfqs?.[0]) {
      rfqData = rfqs.rfqs[0];
      if (rfqData.status === "cancelled") rfqStatus = "CANCELLED";
      if (rfqData.status === "expired") rfqStatus = "EXPIRED";
    }
  } catch {
    // Can't fetch RFQ state — use what we know
  }

  const receipt: RfqReceipt = {
    rfq_id: params.rfq_id,
    subaccount_id: subaccountId,
    status: rfqStatus,
    cancel_reason: rfqData.cancel_reason || null,
    legs: (rfqData.legs || []).map((l: Record<string, any>) => ({
      instrument_name: l.instrument_name ?? "",
      direction: l.direction ?? "buy",
      amount: l.amount ?? "0",
    })),
    quotes,
    execution: null,
    created_at: rfqData.creation_timestamp ?? 0,
    updated_at: rfqData.last_update_timestamp ?? Date.now(),
    valid_until: rfqData.valid_until ?? 0,
  };

  // Audit: quotes polled event
  if (quotes.length > 0) {
    // Find best cost (lowest for buys)
    const costs = quotes.map((q) => parseFloat(q.total_cost || "0")).filter((n) => !isNaN(n));
    const bestCost = costs.length > 0 ? Math.min(...costs).toString() : "0";

    appendEvent({
      ts: Date.now(),
      event: "rfq_quoted",
      subaccount_id: subaccountId,
      rfq_id: params.rfq_id,
      quote_count: quotes.length,
      best_cost: bestCost,
    });
  }

  return receipt;
}

function normalizeQuote(raw: Record<string, any>): RfqQuote {
  return {
    quote_id: raw.quote_id ?? "",
    direction: raw.direction ?? "buy",
    total_cost: raw.total_cost ?? "0",
    legs: (raw.legs || []).map((l: Record<string, any>) => ({
      instrument_name: l.instrument_name ?? "",
      price: l.price ?? "0",
      amount: l.amount ?? "0",
    })),
    created_at: raw.creation_timestamp ?? 0,
    valid_until: raw.valid_until ?? 0,
  };
}
