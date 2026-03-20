// ============================================
// ORDER LIFECYCLE MANAGER — verify_order
// ============================================

import { z } from "zod";
import type { LifecycleResult, OrderReceipt } from "./types.js";
import { classifyError, isTransportError, normalizeOrderResponse } from "./normalize.js";
import { appendEvent, getOrder as getLocalOrder } from "./audit-store.js";
import { getOrder } from "../private/orders/get-order.js";
import { getTradeHistoryPrivate } from "../private/orders/get-trade-history.js";
import { requireSubaccount } from "../client.js";

export const verifyOrderSchema = z.object({
  order_id: z.string().describe("Order ID to verify (returned by place_order or place_and_verify)"),
  subaccount_id: z.number().optional().describe("Subaccount ID (defaults to configured)"),
  include_settlement: z.boolean().default(false).describe(
    "If true and order is filled, fetch settlement details (tx_status, tx_hash) from trade history. Adds one extra API call.",
  ),
});

export const verifyOrderDescription =
  "Check current state of any order and return normalized OrderReceipt. " +
  "If the order's status changed since last check (e.g., OPEN → FILLED), emits a correction event to the audit log. " +
  "Use after place_and_verify to check if a GTC order has been filled, or to get settlement details. " +
  "With include_settlement=true, fetches tx_hash from trade history for filled orders.";

export async function executeVerifyOrder(
  params: z.infer<typeof verifyOrderSchema>,
): Promise<LifecycleResult<OrderReceipt>> {
  const subaccountId = requireSubaccount(params.subaccount_id);

  try {
    const raw = await getOrder.execute({
      order_id: params.order_id,
      subaccount_id: subaccountId,
    }) as Record<string, any>;

    let rawTrades: Record<string, any>[] = [];

    // If filled and settlement details requested, fetch trade history
    if (params.include_settlement && (raw.order_status === "filled" || parseFloat(raw.filled_amount || "0") > 0)) {
      try {
        const tradeHistory = await getTradeHistoryPrivate.execute({
          subaccount_id: subaccountId,
          instrument_name: raw.instrument_name,
          from_timestamp: (raw.creation_timestamp || 0) - 3600000,
          to_timestamp: (raw.last_update_timestamp || Date.now()) + 3600000,
          page_size: 50,
        }) as { trades: Record<string, any>[] };

        rawTrades = (tradeHistory.trades || []).filter(
          (t: Record<string, any>) => t.order_id === params.order_id,
        );
      } catch {
        // Settlement lookup failed — continue without it
      }
    }

    const receipt = normalizeOrderResponse(raw, rawTrades, subaccountId);

    // Check if status changed from what we have locally
    const localOrder = getLocalOrder(subaccountId, params.order_id);
    let persisted = false;

    if (localOrder && localOrder.status !== receipt.status && localOrder.status === "OPEN") {
      // Status changed — emit a state-change event, not just a status check
      if (receipt.status === "FILLED" || receipt.status === "PARTIAL") {
        persisted = appendEvent({
          ts: Date.now(),
          event: "order_filled",
          subaccount_id: subaccountId,
          order_id: params.order_id,
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
      } else if (receipt.status === "CANCELLED" || receipt.status === "EXPIRED") {
        persisted = appendEvent({
          ts: Date.now(),
          event: "order_cancelled",
          subaccount_id: subaccountId,
          order_id: params.order_id,
          cancel_reason: receipt.cancel_reason || receipt.status.toLowerCase(),
          filled_amount: receipt.filled_amount,
        });
      } else {
        persisted = appendEvent({
          ts: Date.now(),
          event: "order_status_checked",
          subaccount_id: subaccountId,
          order_id: params.order_id,
          status: receipt.status,
          filled_amount: receipt.filled_amount,
        });
      }
    } else {
      // No status change, or no local record — just log the check
      persisted = appendEvent({
        ts: Date.now(),
        event: "order_status_checked",
        subaccount_id: subaccountId,
        order_id: params.order_id,
        status: receipt.status,
        filled_amount: receipt.filled_amount,
      });
    }

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
