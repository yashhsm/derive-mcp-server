// ============================================
// ORDER LIFECYCLE MANAGER — create_rfq
// ============================================

import { z } from "zod";
import type { LifecycleResult, RfqReceipt } from "./types.js";
import { classifyError, isTransportError } from "./normalize.js";
import { appendEvent } from "./audit-store.js";
import { sendRfq } from "../private/rfq/send-rfq.js";
import { requireSubaccount } from "../client.js";

export const createRfqSchema = z.object({
  legs: z.array(z.object({
    instrument_name: z.string(),
    direction: z.enum(["buy", "sell"]),
    amount: z.string(),
  })).describe("RFQ legs — each with instrument, direction, and amount"),
  label: z.string().optional().describe("Optional label"),
  subaccount_id: z.number().optional().describe("Subaccount ID (defaults to configured)"),
});

export const createRfqDescription =
  "Send an RFQ (Request for Quote) to market makers and return immediately. " +
  "Does NOT poll for quotes or auto-execute — use await_rfq_quotes and accept_rfq_quote for that. " +
  "RFQs remain open until valid_until (~30 min) or explicit cancel. " +
  "For multi-leg options strategies, this is the preferred path for atomic execution.";

export async function executeCreateRfq(
  params: z.infer<typeof createRfqSchema>,
): Promise<LifecycleResult<RfqReceipt>> {
  const subaccountId = requireSubaccount(params.subaccount_id);

  try {
    const raw = await sendRfq.execute({
      legs: params.legs,
      label: params.label,
      subaccount_id: subaccountId,
    }) as Record<string, any>;

    const receipt: RfqReceipt = {
      rfq_id: raw.rfq_id ?? "",
      subaccount_id: subaccountId,
      status: "OPEN",
      cancel_reason: null,
      legs: params.legs.map((l) => ({
        instrument_name: l.instrument_name,
        direction: l.direction,
        amount: l.amount,
      })),
      quotes: [],
      execution: null,
      created_at: raw.creation_timestamp ?? Date.now(),
      updated_at: raw.last_update_timestamp ?? Date.now(),
      valid_until: raw.valid_until ?? 0,
    };

    const persisted = appendEvent({
      ts: receipt.created_at,
      event: "rfq_created",
      subaccount_id: subaccountId,
      rfq_id: receipt.rfq_id,
      legs: params.legs.map((l) => ({
        instrument: l.instrument_name,
        direction: l.direction,
        amount: l.amount,
      })),
    });

    return {
      submission: "accepted",
      receipt,
      warnings: [],
      audit_persisted: persisted,
      error: null,
    };
  } catch (err) {
    const classified = classifyError(err);
    return {
      submission: isTransportError(classified) ? "unknown" : "rejected",
      receipt: null,
      warnings: [],
      audit_persisted: false,
      error: classified,
    };
  }
}
