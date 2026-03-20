// ============================================
// ORDER LIFECYCLE MANAGER — Types
// ============================================

// --- Result Envelope ---

export interface LifecycleResult<T> {
  submission: "accepted" | "rejected" | "unknown";
  receipt: T | null;
  warnings: string[];
  audit_persisted: boolean;
  error: OrderError | null;
}

// --- Errors ---

export type OrderError =
  | { code: "ZERO_LIQUIDITY"; message: string }
  | { code: "INSUFFICIENT_FUNDS"; message: string }
  | { code: "INSTRUMENT_INVALID"; message: string }
  | { code: "AMOUNT_INVALID"; message: string }
  | { code: "PRICE_OUT_OF_BOUNDS"; message: string }
  | { code: "SIGNING_FAILED"; message: string }
  | { code: "COST_EXCEEDS_LIMIT"; message: string }
  | { code: "TRANSPORT_ERROR"; message: string; raw: string }
  | { code: "API_ERROR"; message: string; raw: string };

// --- Order Receipt ---

export interface OrderReceipt {
  order_id: string;
  instrument_name: string;
  direction: "buy" | "sell";
  label: string;
  subaccount_id: number;

  order_type: "limit" | "market";
  time_in_force: string;
  limit_price: string;
  requested_amount: string;
  reduce_only: boolean;

  status: OrderStatus;
  cancel_reason: string | null;

  filled_amount: string;
  average_price: string;
  fee: string;

  filled_pct: number;
  is_fully_filled: boolean;
  is_partially_filled: boolean;

  trades: TradeRecord[];

  created_at: number;
  updated_at: number;

  settlement: {
    tx_status: "requested" | "settled" | null;
    tx_hash: string | null;
  };
}

export type OrderStatus = "OPEN" | "FILLED" | "PARTIAL" | "CANCELLED" | "EXPIRED";

export interface TradeRecord {
  trade_id: string;
  order_id: string;
  trade_price: string;
  trade_amount: string;
  fee: string;
  liquidity_role: "maker" | "taker";
  realized_pnl: string;
  timestamp: number;
  tx_status: "requested" | "settled";
  tx_hash: string | null;
}

// --- RFQ Receipt ---

export interface RfqReceipt {
  rfq_id: string;
  subaccount_id: number;
  status: "OPEN" | "QUOTED" | "EXECUTED" | "CANCELLED" | "EXPIRED" | "NO_QUOTES";
  cancel_reason: string | null;
  legs: RfqLeg[];
  quotes: RfqQuote[];
  execution: {
    trades: TradeRecord[];
    total_cost: string;
    total_fee: string;
  } | null;
  created_at: number;
  updated_at: number;
  valid_until: number;
}

export interface RfqLeg {
  instrument_name: string;
  direction: "buy" | "sell";
  amount: string;
}

export interface RfqQuote {
  quote_id: string;
  direction: "buy" | "sell";
  total_cost: string;
  legs: { instrument_name: string; price: string; amount: string }[];
  created_at: number;
  valid_until: number;
}

// --- Margin Check ---

export interface MarginCheckResult {
  subaccount_id: number;
  margin_type: "SM" | "PM" | "PM2";
  current_margin: {
    maintenance_margin: string;
    initial_margin: string;
    available_margin: string;
  };
  portfolio_simulation: {
    is_valid: boolean;
    post_initial_margin: string;
    post_available_margin: string;
    violations: string[];
  };
  sequential_simulation: {
    all_legs_pass: boolean;
    execution_order: string;
    legs: SequentialLegResult[];
  };
  warnings: string[];
}

export interface SequentialLegResult {
  step: number;
  instrument_name: string;
  direction: "buy" | "sell";
  amount: string;
  is_valid: boolean;
  cumulative_margin_used: string;
  available_after: string;
  error: string | null;
}

// --- Audit Events ---

export type AuditEvent =
  | OrderPlacedEvent
  | OrderFilledEvent
  | OrderPartialFillEvent
  | OrderCancelledEvent
  | OrderRejectedEvent
  | OrderUnknownEvent
  | OrderSettledEvent
  | OrderStatusCheckedEvent
  | OrderStatusCorrectedEvent
  | OrderBackfilledEvent
  | RfqCreatedEvent
  | RfqQuotedEvent
  | RfqExecutedEvent
  | RfqCancelledEvent;

interface BaseEvent {
  ts: number;
  subaccount_id: number;
}

export interface OrderPlacedEvent extends BaseEvent {
  event: "order_placed";
  order_id: string;
  instrument: string;
  direction: "buy" | "sell";
  amount: string;
  limit_price: string;
  tif: string;
  label: string;
}

export interface OrderFilledEvent extends BaseEvent {
  event: "order_filled";
  order_id: string;
  filled_amount: string;
  average_price: string;
  fee: string;
  trades: { trade_id: string; price: string; amount: string; tx_status: string }[];
}

export interface OrderPartialFillEvent extends BaseEvent {
  event: "order_partial_fill";
  order_id: string;
  filled_amount: string;
  total_filled: string;
  remaining: string;
  trade_id: string;
}

export interface OrderCancelledEvent extends BaseEvent {
  event: "order_cancelled";
  order_id: string;
  cancel_reason: string;
  filled_amount: string;
}

export interface OrderRejectedEvent extends BaseEvent {
  event: "order_rejected";
  instrument: string;
  direction: "buy" | "sell";
  amount: string;
  reason: string;
  tif: string;
}

export interface OrderUnknownEvent extends BaseEvent {
  event: "order_unknown";
  instrument: string;
  direction: "buy" | "sell";
  amount: string;
  error: string;
}

export interface OrderSettledEvent extends BaseEvent {
  event: "order_settled";
  order_id: string;
  trade_id: string;
  tx_status: "settled";
  tx_hash: string;
}

export interface OrderStatusCheckedEvent extends BaseEvent {
  event: "order_status_checked";
  order_id: string;
  status: string;
  filled_amount: string;
}

export interface OrderStatusCorrectedEvent extends BaseEvent {
  event: "order_status_corrected";
  order_id: string;
  old_status: string;
  new_status: string;
  source: "reconcile" | "verify_order";
  cancel_reason: string;
  filled_amount: string;
  average_price: string;
  fee: string;
}

export interface OrderBackfilledEvent extends BaseEvent {
  event: "order_backfilled";
  order_id: string;
  instrument: string;
  direction: string;
  amount: string;
  limit_price: string;
  filled_amount: string;
  average_price: string;
  fee: string;
  status: string;
  cancel_reason: string;
  time_in_force: string;
  label: string;
  from: "derive_order_history";
}

export interface RfqCreatedEvent extends BaseEvent {
  event: "rfq_created";
  rfq_id: string;
  legs: { instrument: string; direction: string; amount: string }[];
}

export interface RfqQuotedEvent extends BaseEvent {
  event: "rfq_quoted";
  rfq_id: string;
  quote_count: number;
  best_cost: string;
}

export interface RfqExecutedEvent extends BaseEvent {
  event: "rfq_executed";
  rfq_id: string;
  quote_id: string;
  trades: { trade_id: string; price: string; amount: string }[];
  total_cost: string;
  total_fee: string;
}

export interface RfqCancelledEvent extends BaseEvent {
  event: "rfq_cancelled";
  rfq_id: string;
  cancel_reason: string;
}
