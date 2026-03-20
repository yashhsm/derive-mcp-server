// ============================================
// ORDER LIFECYCLE MANAGER — Event-Sourced Audit Store
// ============================================

import { readFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { AuditEvent, OrderReceipt, OrderStatus, TradeRecord } from "./types.js";

// --- Materialized Order State ---

export interface MaterializedOrder {
  order_id: string;
  instrument_name: string;
  direction: "buy" | "sell";
  amount: string;
  limit_price: string;
  time_in_force: string;
  label: string;
  subaccount_id: number;
  status: OrderStatus | "REJECTED";
  filled_amount: string;
  average_price: string;
  fee: string;
  cancel_reason: string | null;
  trades: { trade_id: string; price: string; amount: string; tx_status: string; tx_hash?: string }[];
  events: string[];
  first_event_ts: number;
  last_event_ts: number;
}

// --- Store ---

const AUDIT_DIR = join(homedir(), ".config", "derive-mcp", "audit");
const MAX_MEMORY_ENTRIES = 1000;

// In-memory state per subaccount
const stores = new Map<number, {
  orders: Map<string, MaterializedOrder>;
  filePath: string;
  loaded: boolean;
}>();

function getStore(subaccountId: number) {
  let store = stores.get(subaccountId);
  if (!store) {
    store = {
      orders: new Map(),
      filePath: join(AUDIT_DIR, `${subaccountId}.jsonl`),
      loaded: false,
    };
    stores.set(subaccountId, store);
  }
  if (!store.loaded) {
    loadFromDisk(store);
    store.loaded = true;
  }
  return store;
}

function ensureDir() {
  if (!existsSync(AUDIT_DIR)) {
    mkdirSync(AUDIT_DIR, { recursive: true });
  }
}

// --- Append Event ---

export function appendEvent(event: AuditEvent): boolean {
  try {
    ensureDir();
    const store = getStore(event.subaccount_id);
    const line = JSON.stringify(event) + "\n";
    appendFileSync(store.filePath, line, "utf-8");
    applyEvent(store.orders, event);
    trimMemory(store.orders);
    return true;
  } catch {
    return false;
  }
}

// --- Query ---

export function getOrder(subaccountId: number, orderId: string): MaterializedOrder | undefined {
  const store = getStore(subaccountId);
  return store.orders.get(orderId);
}

export function getOpenOrders(subaccountId: number): MaterializedOrder[] {
  const store = getStore(subaccountId);
  return [...store.orders.values()].filter((o) => o.status === "OPEN");
}

export function queryOrders(
  subaccountId: number,
  filters: {
    instrument_name?: string;
    status?: string;
    label?: string;
    from_timestamp?: number;
    to_timestamp?: number;
    limit?: number;
  },
): MaterializedOrder[] {
  const store = getStore(subaccountId);
  let results = [...store.orders.values()];

  if (filters.instrument_name) {
    results = results.filter((o) => o.instrument_name === filters.instrument_name);
  }
  if (filters.status) {
    results = results.filter((o) => o.status === filters.status);
  }
  if (filters.label) {
    results = results.filter((o) => o.label.startsWith(filters.label!));
  }
  if (filters.from_timestamp) {
    results = results.filter((o) => o.first_event_ts >= filters.from_timestamp!);
  }
  if (filters.to_timestamp) {
    results = results.filter((o) => o.last_event_ts <= filters.to_timestamp!);
  }

  // Sort by most recent first
  results.sort((a, b) => b.last_event_ts - a.last_event_ts);

  const limit = filters.limit ?? 50;
  return results.slice(0, limit);
}

export function getAllOrders(subaccountId: number): MaterializedOrder[] {
  const store = getStore(subaccountId);
  return [...store.orders.values()];
}

// --- Event Application (state materialization) ---

function applyEvent(orders: Map<string, MaterializedOrder>, event: AuditEvent) {
  switch (event.event) {
    case "order_placed": {
      orders.set(event.order_id, {
        order_id: event.order_id,
        instrument_name: event.instrument,
        direction: event.direction,
        amount: event.amount,
        limit_price: event.limit_price,
        time_in_force: event.tif,
        label: event.label,
        subaccount_id: event.subaccount_id,
        status: "OPEN",
        filled_amount: "0",
        average_price: "0",
        fee: "0",
        cancel_reason: null,
        trades: [],
        events: ["order_placed"],
        first_event_ts: event.ts,
        last_event_ts: event.ts,
      });
      break;
    }
    case "order_filled": {
      const order = orders.get(event.order_id);
      if (order) {
        order.filled_amount = event.filled_amount;
        order.average_price = event.average_price;
        order.fee = event.fee;
        // Determine if this is a full or partial fill
        const filledNum = parseFloat(event.filled_amount || "0");
        const requestedNum = parseFloat(order.amount || "0");
        order.status = (filledNum > 0 && requestedNum > 0 && filledNum < requestedNum) ? "PARTIAL" : "FILLED";
        order.trades.push(...event.trades.map((t) => ({ ...t, tx_hash: undefined })));
        order.events.push("order_filled");
        order.last_event_ts = event.ts;
      }
      break;
    }
    case "order_partial_fill": {
      const order = orders.get(event.order_id);
      if (order) {
        order.filled_amount = event.total_filled;
        order.trades.push({ trade_id: event.trade_id, price: "0", amount: event.filled_amount, tx_status: "requested" });
        order.events.push("order_partial_fill");
        order.last_event_ts = event.ts;
      }
      break;
    }
    case "order_cancelled": {
      const order = orders.get(event.order_id);
      if (order) {
        const filledNum = parseFloat(event.filled_amount || "0");
        order.status = filledNum > 0 ? "PARTIAL" : "CANCELLED";
        order.cancel_reason = event.cancel_reason;
        order.filled_amount = event.filled_amount;
        order.events.push("order_cancelled");
        order.last_event_ts = event.ts;
      }
      break;
    }
    case "order_settled": {
      const order = orders.get(event.order_id);
      if (order) {
        const trade = order.trades.find((t) => t.trade_id === event.trade_id);
        if (trade) {
          trade.tx_status = "settled";
          trade.tx_hash = event.tx_hash;
        }
        order.events.push("order_settled");
        order.last_event_ts = event.ts;
      }
      break;
    }
    case "order_status_corrected": {
      const order = orders.get(event.order_id);
      if (order) {
        order.status = event.new_status as OrderStatus;
        order.cancel_reason = event.cancel_reason || order.cancel_reason;
        if (event.filled_amount) order.filled_amount = event.filled_amount;
        if (event.average_price) order.average_price = event.average_price;
        if (event.fee) order.fee = event.fee;
        order.events.push("order_status_corrected");
        order.last_event_ts = event.ts;
      }
      break;
    }
    case "order_backfilled": {
      const status = mapBackfillStatus(event.status, event.filled_amount, event.amount);
      if (!orders.has(event.order_id)) {
        orders.set(event.order_id, {
          order_id: event.order_id,
          instrument_name: event.instrument,
          direction: event.direction as "buy" | "sell",
          amount: event.amount || "0",
          limit_price: event.limit_price || "0",
          time_in_force: event.time_in_force || "",
          label: event.label || "",
          subaccount_id: event.subaccount_id,
          status,
          filled_amount: event.filled_amount || "0",
          average_price: event.average_price || "0",
          fee: event.fee || "0",
          cancel_reason: event.cancel_reason || null,
          trades: [],
          events: ["order_backfilled"],
          first_event_ts: event.ts,
          last_event_ts: event.ts,
        });
      }
      break;
    }
    // RFQ events and status checks don't affect order materialization
    case "order_rejected":
    case "order_unknown":
    case "order_status_checked":
    case "rfq_created":
    case "rfq_quoted":
    case "rfq_executed":
    case "rfq_cancelled":
      break;
  }
}

// --- Helpers ---

function mapBackfillStatus(deriveStatus: string, filledAmount?: string, amount?: string): OrderStatus {
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
    case "open":
      return "OPEN";
    default:
      return "OPEN";
  }
}

// --- Disk I/O ---

function loadFromDisk(store: { orders: Map<string, MaterializedOrder>; filePath: string }) {
  if (!existsSync(store.filePath)) return;

  try {
    const content = readFileSync(store.filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    // Only load last N lines for memory efficiency
    const startIdx = Math.max(0, lines.length - MAX_MEMORY_ENTRIES);
    for (let i = startIdx; i < lines.length; i++) {
      try {
        const event = JSON.parse(lines[i]) as AuditEvent;
        applyEvent(store.orders, event);
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // File doesn't exist or can't be read — start fresh
  }
}

function trimMemory(orders: Map<string, MaterializedOrder>) {
  if (orders.size <= MAX_MEMORY_ENTRIES) return;
  // Remove oldest entries (by first_event_ts)
  const sorted = [...orders.entries()].sort((a, b) => a[1].first_event_ts - b[1].first_event_ts);
  const toRemove = sorted.length - MAX_MEMORY_ENTRIES;
  for (let i = 0; i < toRemove; i++) {
    orders.delete(sorted[i][0]);
  }
}
