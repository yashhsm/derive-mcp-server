// ============================================
// ORDER LIFECYCLE MANAGER — place_and_verify
// ============================================

import { z } from "zod";
import type { LifecycleResult, OrderReceipt } from "./types.js";
import { classifyError, isTransportError, normalizeOrderResponse, parseNum } from "./normalize.js";
import { appendEvent } from "./audit-store.js";
import { placeOrder } from "../private/orders/place-order.js";
import { requireSubaccount } from "../client.js";

export const placeAndVerifySchema = z.object({
  instrument_name: z.string().describe("Instrument (e.g., ETH-PERP, ETH-20260327-3000-C)"),
  direction: z.enum(["buy", "sell"]).describe("Order direction"),
  amount: z.string().describe("Order amount (in contracts)"),
  limit_price: z.string().describe("Limit price (in USD)"),
  order_type: z.enum(["limit", "market"]).default("limit").describe("Order type"),
  time_in_force: z.enum(["gtc", "post_only", "fok", "ioc"]).default("gtc").describe("Time in force"),
  reduce_only: z.boolean().default(false).describe("Reduce-only order"),
  label: z.string().optional().describe("Optional label"),
  max_fee: z.string().default("100").describe("Maximum fee willing to pay (USDC)"),
  subaccount_id: z.number().optional().describe("Subaccount ID (defaults to configured)"),
});

export const placeAndVerifyDescription =
  "Place an order with automatic fill verification, error classification, and audit logging. " +
  "Returns a LifecycleResult<OrderReceipt> — never throws for expected failures (zero liquidity, insufficient funds). " +
  "Submission states: 'accepted' (order on exchange), 'rejected' (exchange rejected), 'unknown' (transport error). " +
  "For IOC/FOK that can't match, returns rejected with ZERO_LIQUIDITY — no phantom order created. " +
  "For GTC that crosses the spread, returns filled with trades inline. " +
  "All events are appended to the audit log.";

export async function executePlaceAndVerify(
  params: z.infer<typeof placeAndVerifySchema>,
): Promise<LifecycleResult<OrderReceipt>> {
  const subaccountId = requireSubaccount(params.subaccount_id);
  const warnings: string[] = [];

  try {
    const result = await placeOrder.execute({
      instrument_name: params.instrument_name,
      direction: params.direction,
      amount: params.amount,
      limit_price: params.limit_price,
      order_type: params.order_type,
      time_in_force: params.time_in_force,
      reduce_only: params.reduce_only,
      label: params.label,
      max_fee: params.max_fee,
    }) as { order: Record<string, any>; trades: Record<string, any>[] };

    const receipt = normalizeOrderResponse(result.order, result.trades, subaccountId);

    // Partial fill warning
    if (receipt.is_partially_filled) {
      warnings.push(
        `Partial fill: ${receipt.filled_amount}/${receipt.requested_amount} filled (${receipt.filled_pct}%)`,
      );
    }

    // Audit: order_placed event
    const placedPersisted = appendEvent({
      ts: receipt.created_at || Date.now(),
      event: "order_placed",
      subaccount_id: subaccountId,
      order_id: receipt.order_id,
      instrument: receipt.instrument_name,
      direction: receipt.direction,
      amount: receipt.requested_amount,
      limit_price: receipt.limit_price,
      tif: receipt.time_in_force,
      label: receipt.label,
    });

    // Audit: order_filled event (if filled immediately)
    let fillPersisted = true;
    if (receipt.status === "FILLED" || receipt.status === "PARTIAL") {
      fillPersisted = appendEvent({
        ts: receipt.updated_at || Date.now(),
        event: "order_filled",
        subaccount_id: subaccountId,
        order_id: receipt.order_id,
        filled_amount: receipt.filled_amount,
        average_price: receipt.average_price,
        fee: receipt.fee,
        trades: receipt.trades.map((t) => ({
          trade_id: t.trade_id,
          price: t.trade_price,
          amount: t.trade_amount,
          tx_status: t.tx_status,
        })),
      });
    }

    return {
      submission: "accepted",
      receipt,
      warnings,
      audit_persisted: placedPersisted && fillPersisted,
      error: null,
    };
  } catch (err) {
    const classified = classifyError(err);
    const submission = isTransportError(classified) ? "unknown" as const : "rejected" as const;

    // Audit: rejection or unknown event
    const eventType = submission === "unknown" ? "order_unknown" : "order_rejected";
    const persisted = appendEvent({
      ts: Date.now(),
      event: eventType,
      subaccount_id: subaccountId,
      instrument: params.instrument_name,
      direction: params.direction,
      amount: params.amount,
      reason: classified.code,
      tif: params.time_in_force,
      ...(eventType === "order_unknown" ? { error: classified.message } : {}),
    } as any);

    return {
      submission,
      receipt: null,
      warnings,
      audit_persisted: persisted,
      error: classified,
    };
  }
}
