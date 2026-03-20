// ============================================
// ORDER LIFECYCLE MANAGER — order_audit_log
// ============================================

import { z } from "zod";
import { queryOrders, getAllOrders } from "./audit-store.js";
import { requireSubaccount } from "../client.js";
import type { MaterializedOrder } from "./audit-store.js";

export const orderAuditLogSchema = z.object({
  instrument_name: z.string().optional().describe("Filter by instrument"),
  status: z.string().optional().describe("Filter by status (OPEN, FILLED, PARTIAL, CANCELLED, REJECTED, EXPIRED)"),
  label: z.string().optional().describe("Filter by label prefix"),
  from_timestamp: z.number().optional().describe("Start time (ms)"),
  to_timestamp: z.number().optional().describe("End time (ms)"),
  limit: z.number().default(50).describe("Max results (default 50)"),
  subaccount_id: z.number().optional().describe("Subaccount ID (defaults to configured)"),
});

export const orderAuditLogDescription =
  "Query the local audit trail of orders placed through lifecycle tools. " +
  "Returns filtered order history with a summary including fill rate, total fees, and volume. " +
  "Note: only orders placed via place_and_verify or rfq tools are tracked. " +
  "Use reconcile to backfill orders placed via raw place_order.";

interface AuditLogResult {
  entries: MaterializedOrder[];
  summary: {
    total_orders: number;
    filled: number;
    partial: number;
    cancelled: number;
    rejected: number;
    expired: number;
    total_fees: string;
    total_volume: string;
    fill_rate: number;
    full_fill_rate: number;
  };
}

export async function executeOrderAuditLog(
  params: z.infer<typeof orderAuditLogSchema>,
): Promise<AuditLogResult> {
  const subaccountId = requireSubaccount(params.subaccount_id);

  const entries = queryOrders(subaccountId, {
    instrument_name: params.instrument_name,
    status: params.status,
    label: params.label,
    from_timestamp: params.from_timestamp,
    to_timestamp: params.to_timestamp,
    limit: params.limit,
  });

  // Compute summary from ALL matching orders (not just the limited page)
  const allOrders = params.limit
    ? queryOrders(subaccountId, {
        instrument_name: params.instrument_name,
        status: params.status,
        label: params.label,
        from_timestamp: params.from_timestamp,
        to_timestamp: params.to_timestamp,
        limit: 10000, // Get all for summary
      })
    : entries;

  const summary = computeSummary(allOrders);

  return { entries, summary };
}

function computeSummary(orders: MaterializedOrder[]) {
  let filled = 0;
  let partial = 0;
  let cancelled = 0;
  let rejected = 0;
  let expired = 0;
  let totalFees = 0;
  let totalVolume = 0;

  for (const order of orders) {
    switch (order.status) {
      case "FILLED":
        filled++;
        break;
      case "PARTIAL":
        partial++;
        break;
      case "CANCELLED":
        cancelled++;
        break;
      case "REJECTED":
        rejected++;
        break;
      case "EXPIRED":
        expired++;
        break;
    }

    const fee = parseFloat(order.fee || "0");
    if (!isNaN(fee)) totalFees += fee;

    const filledAmt = parseFloat(order.filled_amount || "0");
    const avgPrice = parseFloat(order.average_price || "0");
    if (!isNaN(filledAmt) && !isNaN(avgPrice)) {
      totalVolume += filledAmt * avgPrice;
    }
  }

  const total = orders.length;
  // fill_rate = (filled + partial) / total_orders — as documented
  const fillRate = total > 0 ? ((filled + partial) / total) * 100 : 0;
  const fullFillRate = total > 0 ? (filled / total) * 100 : 0;

  return {
    total_orders: total,
    filled,
    partial,
    cancelled,
    rejected,
    expired,
    total_fees: totalFees.toFixed(6),
    total_volume: totalVolume.toFixed(2),
    fill_rate: Math.round(fillRate * 100) / 100,
    full_fill_rate: Math.round(fullFillRate * 100) / 100,
  };
}
