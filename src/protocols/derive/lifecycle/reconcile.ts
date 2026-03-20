// ============================================
// ORDER LIFECYCLE MANAGER — reconcile
// ============================================

import { z } from "zod";
import { getOpenOrders, getAllOrders, appendEvent, getOrder as getLocalOrder } from "./audit-store.js";
import { getOpenOrders as getOpenOrdersAction } from "../private/orders/get-open-orders.js";
import { getOrderHistory as getOrderHistoryAction } from "../private/orders/get-order-history.js";
import { requireSubaccount } from "../client.js";

export const reconcileSchema = z.object({
  auto_fix: z.boolean().default(false).describe(
    "If true, append correction events to sync local audit log with Derive state. " +
    "Does NOT mutate existing events — only appends new correction/backfill events.",
  ),
  subaccount_id: z.number().optional().describe("Subaccount ID (defaults to configured)"),
});

export const reconcileDescription =
  "Compare local audit log against Derive's actual order state. " +
  "Detects: orders on Derive not in local log (placed via raw tools), " +
  "local orders marked as open that Derive shows as filled/cancelled. " +
  "With auto_fix=true, appends correction events to bring local log in sync.";

interface ReconcileResult {
  status: "in_sync" | "desync_detected";
  local_open_orders: string[];
  derive_open_orders: string[];
  missing_from_local: string[];
  stale_in_local: string[];
  fixes_applied: string[];
}

export async function executeReconcile(
  params: z.infer<typeof reconcileSchema>,
): Promise<ReconcileResult> {
  const subaccountId = requireSubaccount(params.subaccount_id);
  const fixes: string[] = [];

  // 1. Get Derive's current open orders
  const deriveOpen = await getOpenOrdersAction.execute({
    subaccount_id: subaccountId,
  }) as { orders: Record<string, any>[] };
  const deriveOpenIds = new Set(
    (deriveOpen.orders || []).map((o: Record<string, any>) => o.order_id as string),
  );

  // 2. Get Derive's recent order history (last 100)
  const deriveHistory = await getOrderHistoryAction.execute({
    subaccount_id: subaccountId,
    page_size: 100,
  }) as { orders: Record<string, any>[] };
  const deriveHistoryMap = new Map<string, Record<string, any>>();
  for (const order of deriveHistory.orders || []) {
    deriveHistoryMap.set(order.order_id, order);
  }

  // 3. Get local state
  const localOpenOrders = getOpenOrders(subaccountId);
  const localOpenIds = new Set(localOpenOrders.map((o) => o.order_id));
  const allLocalOrders = getAllOrders(subaccountId);
  const allLocalIds = new Set(allLocalOrders.map((o) => o.order_id));

  // 4. Find discrepancies

  // Orders on Derive but not in local log
  const missingFromLocal: string[] = [];
  for (const [orderId] of deriveHistoryMap) {
    if (!allLocalIds.has(orderId)) {
      missingFromLocal.push(orderId);
    }
  }

  // Local orders marked as open but Derive says they're filled/cancelled
  const staleInLocal: string[] = [];
  for (const localOrder of localOpenOrders) {
    if (!deriveOpenIds.has(localOrder.order_id)) {
      // Not in Derive's open orders — check history
      const deriveOrder = deriveHistoryMap.get(localOrder.order_id);
      if (deriveOrder && deriveOrder.order_status !== "open") {
        staleInLocal.push(localOrder.order_id);
      }
    }
  }

  // 5. Auto-fix if requested
  if (params.auto_fix) {
    // Fix stale local orders
    for (const orderId of staleInLocal) {
      const deriveOrder = deriveHistoryMap.get(orderId);
      if (deriveOrder) {
        const newStatus = mapDeriveStatus(deriveOrder.order_status, deriveOrder.filled_amount, deriveOrder.amount);
        const persisted = appendEvent({
          ts: Date.now(),
          event: "order_status_corrected",
          subaccount_id: subaccountId,
          order_id: orderId,
          old_status: "OPEN",
          new_status: newStatus,
          source: "reconcile" as const,
          cancel_reason: deriveOrder.cancel_reason || "",
          filled_amount: deriveOrder.filled_amount || "0",
          average_price: deriveOrder.average_price || "0",
          fee: deriveOrder.order_fee || "0",
        });
        if (persisted) fixes.push(`corrected ${orderId}: OPEN → ${newStatus}`);
      }
    }

    // Backfill missing orders with full state from Derive
    for (const orderId of missingFromLocal) {
      const d = deriveHistoryMap.get(orderId);
      if (d) {
        const persisted = appendEvent({
          ts: Date.now(),
          event: "order_backfilled",
          subaccount_id: subaccountId,
          order_id: orderId,
          instrument: d.instrument_name ?? "",
          direction: d.direction ?? "buy",
          amount: d.amount ?? "0",
          limit_price: d.limit_price ?? "0",
          filled_amount: d.filled_amount ?? "0",
          average_price: d.average_price ?? "0",
          fee: d.order_fee ?? "0",
          status: d.order_status ?? "open",
          cancel_reason: d.cancel_reason ?? "",
          time_in_force: d.time_in_force ?? "",
          label: d.label ?? "",
          from: "derive_order_history" as const,
        });
        if (persisted) fixes.push(`backfilled ${orderId}: ${d.order_status} (filled: ${d.filled_amount ?? "0"})`);
      }
    }
  }

  const hasDesync = missingFromLocal.length > 0 || staleInLocal.length > 0;

  return {
    status: hasDesync ? "desync_detected" : "in_sync",
    local_open_orders: [...localOpenIds],
    derive_open_orders: [...deriveOpenIds],
    missing_from_local: missingFromLocal,
    stale_in_local: staleInLocal,
    fixes_applied: fixes,
  };
}

function mapDeriveStatus(deriveStatus: string, filledAmount?: string, amount?: string): string {
  const filled = parseFloat(filledAmount || "0");
  const requested = parseFloat(amount || "0");
  const isPartial = filled > 0 && requested > 0 && filled < requested;

  switch (deriveStatus) {
    case "filled":
      return isPartial ? "PARTIAL" : "FILLED";
    case "cancelled":
      return isPartial ? "PARTIAL" : "CANCELLED";
    case "expired":
      return isPartial ? "PARTIAL" : "EXPIRED";
    default:
      return "OPEN";
  }
}
