// ============================================
// ORDER LIFECYCLE MANAGER — Normalization
// ============================================

import type { OrderError, OrderReceipt, OrderStatus, TradeRecord } from "./types.js";

// --- Numeric ---

/**
 * Clean Derive's inconsistent numeric strings for display.
 * "0E-18", "0.000000000000000000" → "0"
 * "29.600000000000000000" → "29.6"
 * Preserves meaningful precision up to 8 significant digits.
 */
export function displayNumeric(value: string): string {
  if (!value || value === "0" || value === "0E-18") return "0";
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  if (num === 0) return "0";
  // For very small numbers, use exponential
  if (Math.abs(num) < 0.000001 && num !== 0) return num.toExponential(2);
  return num.toPrecision(8).replace(/\.?0+$/, "");
}

/**
 * Parse a numeric string to a JS number safely.
 * Used only for derived convenience fields (filled_pct, etc.), never for prices/amounts.
 */
export function parseNum(value: string): number {
  if (!value) return 0;
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}

// --- Error Classification ---

export function classifyError(err: unknown): OrderError {
  const msg = err instanceof Error ? err.message : String(err);

  if (msg.includes("Zero liquidity"))
    return { code: "ZERO_LIQUIDITY", message: msg };
  if (msg.includes("Insufficient funds"))
    return { code: "INSUFFICIENT_FUNDS", message: msg };
  if (msg.includes("Invalid instrument") || msg.includes("not found"))
    return { code: "INSTRUMENT_INVALID", message: msg };
  if (msg.includes("minimum_amount") || msg.includes("amount_step") || msg.includes("Invalid amount"))
    return { code: "AMOUNT_INVALID", message: msg };
  if (msg.includes("price") && (msg.includes("out of") || msg.includes("min_price") || msg.includes("max_price")))
    return { code: "PRICE_OUT_OF_BOUNDS", message: msg };
  if (msg.includes("signing") || msg.includes("signature") || msg.includes("EIP-712"))
    return { code: "SIGNING_FAILED", message: msg };
  if (msg.includes("timeout") || msg.includes("ETIMEDOUT") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND") || msg.includes("AbortError"))
    return { code: "TRANSPORT_ERROR", message: msg, raw: msg };

  return { code: "API_ERROR", message: msg, raw: msg };
}

export function isTransportError(error: OrderError): boolean {
  return error.code === "TRANSPORT_ERROR";
}

// --- Order Response Normalization ---

/**
 * Convert a raw Derive order response into a normalized OrderReceipt.
 */
export function normalizeOrderResponse(
  raw: Record<string, any>,
  rawTrades: Record<string, any>[] = [],
  subaccountId: number,
): OrderReceipt {
  const amount = raw.amount ?? "0";
  const filledAmount = cleanNumericString(raw.filled_amount);
  const requestedAmount = cleanNumericString(amount);

  const filledNum = parseNum(filledAmount);
  const requestedNum = parseNum(requestedAmount);
  const filledPct = requestedNum > 0 ? (filledNum / requestedNum) * 100 : 0;
  const isFullyFilled = filledNum > 0 && filledNum >= requestedNum;
  const isPartiallyFilled = filledNum > 0 && filledNum < requestedNum;

  const status = deriveOrderStatus(raw.order_status, isFullyFilled, isPartiallyFilled);

  const trades: TradeRecord[] = rawTrades.map((t) => ({
    trade_id: t.trade_id ?? "",
    order_id: t.order_id ?? raw.order_id ?? "",
    trade_price: cleanNumericString(t.trade_price),
    trade_amount: cleanNumericString(t.trade_amount),
    fee: cleanNumericString(t.trade_fee),
    liquidity_role: t.liquidity_role ?? "taker",
    realized_pnl: cleanNumericString(t.realized_pnl),
    timestamp: t.timestamp ?? 0,
    tx_status: t.tx_status === "settled" ? "settled" : "requested",
    tx_hash: t.tx_hash ?? null,
  }));

  // Settlement: use latest trade's tx info
  const latestTrade = trades.length > 0 ? trades[trades.length - 1] : null;

  return {
    order_id: raw.order_id ?? "",
    instrument_name: raw.instrument_name ?? "",
    direction: raw.direction ?? "buy",
    label: raw.label ?? "",
    subaccount_id: subaccountId,
    order_type: raw.order_type ?? "limit",
    time_in_force: raw.time_in_force ?? "gtc",
    limit_price: cleanNumericString(raw.limit_price),
    requested_amount: requestedAmount,
    reduce_only: raw.reduce_only ?? false,
    status,
    cancel_reason: raw.cancel_reason || null,
    filled_amount: filledAmount,
    average_price: cleanNumericString(raw.average_price),
    fee: cleanNumericString(raw.order_fee),
    filled_pct: Math.round(filledPct * 100) / 100,
    is_fully_filled: isFullyFilled,
    is_partially_filled: isPartiallyFilled,
    trades,
    created_at: raw.creation_timestamp ?? 0,
    updated_at: raw.last_update_timestamp ?? 0,
    settlement: {
      tx_status: latestTrade?.tx_status ?? null,
      tx_hash: latestTrade?.tx_hash ?? null,
    },
  };
}

// --- Helpers ---

/**
 * Map Derive's order_status to our canonical OrderStatus.
 * Derive marks IOC partial fills as "filled" — we correct to "PARTIAL".
 */
function deriveOrderStatus(
  deriveStatus: string,
  isFullyFilled: boolean,
  isPartiallyFilled: boolean,
): OrderStatus {
  switch (deriveStatus) {
    case "open":
      return "OPEN";
    case "filled":
      // Derive says "filled" but amount < requested → PARTIAL
      return isPartiallyFilled && !isFullyFilled ? "PARTIAL" : "FILLED";
    case "cancelled":
      // Cancelled with partial fills → PARTIAL
      return isPartiallyFilled ? "PARTIAL" : "CANCELLED";
    case "expired":
      return isPartiallyFilled ? "PARTIAL" : "EXPIRED";
    default:
      return "OPEN";
  }
}

/**
 * Clean Derive's numeric string quirks: "0E-18" → "0", etc.
 * Keeps the raw precision — just normalizes representation.
 */
function cleanNumericString(value: unknown): string {
  if (value === null || value === undefined) return "0";
  const s = String(value);
  if (!s || s === "0E-18" || s === "0E+0") return "0";
  // Check if it's a numeric string with excessive trailing zeros
  if (/^-?\d+\.0{6,}$/.test(s)) {
    return s.replace(/\.0+$/, "");
  }
  // Trim trailing zeros after decimal (keep at least one meaningful digit)
  if (s.includes(".")) {
    return s.replace(/0+$/, "").replace(/\.$/, "");
  }
  return s;
}
