# Order Lifecycle Manager — Design Document

## Status: DRAFT v2 (post-review)
## Date: 2026-03-20
## Reviewed by: Codex (8 findings incorporated)

---

## 1. Motivation

After building agents across Polymarket, Hyperliquid, Phoenix, and Meteora, we identified 10 recurring problems (see Problem Statement). While Derive's API is significantly cleaner than other venues — canonical order status, inline fill reporting, explicit cancel reasons — agents still need:

- **Composite operations** that collapse multi-step patterns into single calls
- **A local audit trail** of all orders/fills for PnL calculation and debugging
- **Multi-leg safety** that prevents the SM-vs-PM margin trap on leg-by-leg execution
- **Normalized responses** that eliminate format quirks (e.g., `"0E-18"` vs `"0"`)

### What Derive Already Solves

| Problem (from statement) | Derive status |
|---|---|
| #1 Order-gone = filled fallacy | **Solved.** `get_order` returns `cancel_reason: "user_request"` — cancelled and filled are distinguishable. |
| #2 Success != executed | **Partially solved.** IOC/FOK that can't match throws an error (no phantom order). But IOC that partially fills returns `filled` status — needs no extra verification. |
| #3 No single source of truth | **Solved.** `get_positions` is Derive-managed. No agent KV needed. |
| #5 No fill verification | **Solved.** `place_order` returns `trades[]` inline with `trade_price`, `trade_fee`. `get_order` confirms fill state. |
| #6 Approximate PnL | **Solved.** `get_trade_history_private` has actual `trade_price`, `realized_pnl`, `trade_fee`. |
| #4 Non-atomic state transitions | **Partially solved.** `replace_order` is atomic cancel+place. But close-then-open-new is still two calls. |
| #7 No health metrics | **Not solved.** No built-in fill rate, slippage, or success rate. |
| #8 Ad-hoc credentials | **Solved by MCP.** EIP-712 signing is handled in `signing.ts`. |
| #9 Store key proliferation | **N/A for MCP.** But audit log needs thoughtful storage design. |
| #10 Inconsistent order types | **Partially solved.** Derive has clean TIF semantics, but agents need guidance on which to use when. |

### What This Layer Adds

The lifecycle manager adds **new composite MCP tools** on top of the existing ones. Agents call these instead of raw `place_order`/`get_order` and get lifecycle guarantees, audit logging, and margin safety baked in.

### Live Testing Results (2026-03-20)

These findings are from live mainnet testing and inform the design:

| Test | Result | Design implication |
|---|---|---|
| GTC limit far from market | `order_status: "open"`, `filled_amount: "0"` | Resting orders are clean. |
| Cancel resting order | `order_status: "cancelled"`, `cancel_reason: "user_request"` | Cancelled vs filled always distinguishable. |
| IOC below ask | **API error** `"Zero liquidity"` — no order_id created | Rejections = errors, not phantom orders. Must handle no-order-id case. |
| GTC crossing ask | Immediate `"filled"`, `trades[]` inline, `average_price` correct | No sleep-then-check needed. |
| `get_order` after fill | Deterministic — same data, no timing issues | Reliable for verification. |
| `tx_status` progression | `"requested"` → `"settled"` within seconds, `tx_hash` appears | Settlement is fast but async. |
| `filled_amount` format | `"0E-18"` in some responses vs `"0"` in others | Must normalize numeric strings. |
| RFQ send | Returns `rfq_id`, `status: "open"`, `valid_until` | ~30min validity window. |
| RFQ no quotes | 0 quotes after 25s on 0.1 and 1.0 lot sizes | Small sizes don't attract MMs. |
| RFQ cancel | `"ok"`, then `get_rfqs` shows `"cancelled"`, `cancel_reason: "user_request"` | Same cancel pattern as orders. |
| Multi-leg RFQ with short | `"Insufficient funds"` | SM margin check at RFQ submission time. |

---

## 2. Architecture

```
Agent (Suzi / Claude)
  │
  ├── place_and_verify          ← NEW composite tools
  ├── create_rfq                ←
  ├── await_rfq_quotes          ←
  ├── accept_rfq_quote          ←
  ├── check_multi_leg_margin    ←
  ├── order_audit_log           ←
  ├── reconcile                 ←
  │
  ├── place_order               ← existing raw tools (still available)
  ├── get_order                 ←
  ├── get_positions             ←
  └── ...                       ←

MCP Server (derive-mcp-server)
  │
  ├── Lifecycle module (NEW)
  │   ├── Composite tool handlers
  │   ├── Response normalizer
  │   └── Event-sourced audit logger
  │
  ├── Existing protocol actions
  │   ├── Orders (place, cancel, get, replace)
  │   ├── Positions (get_positions, get_margin, get_portfolio_summary)
  │   ├── RFQ (send, get_quotes, execute)
  │   └── ...
  │
  └── Audit store (local file)
      └── ~/.config/derive-mcp/audit/<subaccount_id>.jsonl  (events)
      └── (in-memory materialized state from events)
```

### Principles

1. **Additive, not breaking.** All existing tools remain. Lifecycle tools are new additions.
2. **Trust Derive for positions.** `get_positions` is the SSOT. We never maintain our own position state.
3. **Event-sourced audit.** JSONL file is append-only events. Current state is materialized in memory. "Updates" are new events, never mutations.
4. **Preserve precision.** Audit log stores raw string values from Derive. Display types normalize for readability but never lose precision below what Derive provides.
5. **Fail loudly.** Surface margin type, leg-by-leg margin failures, and rejection reasons clearly.
6. **Explicit subaccounts.** Every lifecycle tool accepts optional `subaccount_id`, defaulting to env var. Audit log is per-subaccount.

---

## 3. Normalized Types

### LifecycleResult<T> — Result Envelope

Every lifecycle tool wraps its response in this envelope, separating submission state from the receipt. This handles the no-order-id rejection case cleanly.

```typescript
interface LifecycleResult<T> {
  // Did the submission reach the exchange and get accepted?
  submission: "accepted" | "rejected" | "unknown";

  // The receipt (null only if submission is "rejected" with no order created)
  receipt: T | null;

  // Warnings (e.g., margin type, partial fill notes)
  warnings: string[];

  // Was the event persisted to the audit log?
  audit_persisted: boolean;

  // Error details (null if accepted)
  error: OrderError | null;
}
```

This means:
- IOC rejected with `"Zero liquidity"` → `{ submission: "rejected", receipt: null, error: { code: "ZERO_LIQUIDITY", ... } }`
- GTC placed and resting → `{ submission: "accepted", receipt: { status: "OPEN", ... }, ... }`
- GTC placed and filled → `{ submission: "accepted", receipt: { status: "FILLED", ... }, ... }`
- Transport timeout (unknown if order hit the exchange) → `{ submission: "unknown", receipt: null, error: { code: "TRANSPORT_ERROR", ... } }`

### OrderReceipt

```typescript
interface OrderReceipt {
  // Identity
  order_id: string;             // Always present (only in accepted submissions)
  instrument_name: string;
  direction: "buy" | "sell";
  label: string;
  subaccount_id: number;

  // Order params
  order_type: "limit" | "market";
  time_in_force: "gtc" | "post_only" | "fok" | "ioc";
  limit_price: string;          // Raw string from Derive — preserves precision
  requested_amount: string;     // Raw string from Derive
  reduce_only: boolean;

  // Status
  status: "OPEN" | "FILLED" | "PARTIAL" | "CANCELLED" | "EXPIRED";
  cancel_reason: string | null; // "user_request", "mmp", etc.

  // Fill details
  filled_amount: string;        // Raw string
  average_price: string;        // Raw string. "0" if unfilled
  fee: string;                  // Raw string

  // Derived convenience fields (parsed numbers for easy comparison)
  filled_pct: number;           // filled_amount / requested_amount * 100
  is_fully_filled: boolean;     // filled_amount == requested_amount
  is_partially_filled: boolean; // filled_amount > 0 && filled_amount < requested_amount

  // Trades (inline from place_order response)
  trades: TradeRecord[];

  // Timestamps
  created_at: number;           // ms
  updated_at: number;           // ms

  // Settlement (latest from trades)
  settlement: {
    tx_status: "requested" | "settled" | null;
    tx_hash: string | null;
  };
}

interface TradeRecord {
  trade_id: string;
  order_id: string;             // Link back to parent order
  trade_price: string;          // Raw string
  trade_amount: string;         // Raw string
  fee: string;                  // Raw string
  liquidity_role: "maker" | "taker";
  realized_pnl: string;        // Raw string
  timestamp: number;
  tx_status: "requested" | "settled";
  tx_hash: string | null;
}
```

**Partial fill semantics:**
- `status: "PARTIAL"` is set when `filled_amount > 0 && filled_amount < requested_amount` AND the order is no longer open (cancelled or time-expired after partial fill)
- A GTC order with `filled_amount > 0` but still `order_status: "open"` on Derive → `status: "OPEN"`, `is_partially_filled: true`
- An IOC that fills 60% → Derive returns `order_status: "filled"` (misleadingly, since it's fully executed from Derive's perspective — the IOC completed). Lifecycle layer checks: if `filled_amount < requested_amount`, set `status: "PARTIAL"` and `is_fully_filled: false`

### RfqReceipt

```typescript
interface RfqReceipt {
  rfq_id: string;
  subaccount_id: number;
  status: "OPEN" | "QUOTED" | "EXECUTED" | "CANCELLED" | "EXPIRED" | "NO_QUOTES";
  cancel_reason: string | null;
  legs: RfqLeg[];

  // All quotes received (not just best — let the caller decide)
  quotes: RfqQuote[];

  // Execution details (if executed)
  execution: {
    trades: TradeRecord[];
    total_cost: string;
    total_fee: string;
  } | null;

  created_at: number;
  updated_at: number;
  valid_until: number;
}

interface RfqLeg {
  instrument_name: string;
  direction: "buy" | "sell";
  amount: string;
}

interface RfqQuote {
  quote_id: string;
  direction: "buy" | "sell";
  total_cost: string;
  legs: { instrument_name: string; price: string; amount: string }[];
  created_at: number;
  valid_until: number;
}
```

### MarginCheckResult

```typescript
interface MarginCheckResult {
  subaccount_id: number;
  margin_type: "SM" | "PM" | "PM2";
  current_margin: {
    maintenance_margin: string;
    initial_margin: string;
    available_margin: string;
  };

  // Portfolio-level simulation (how Derive's get_margin evaluates it atomically)
  portfolio_simulation: {
    is_valid: boolean;
    post_initial_margin: string;
    post_available_margin: string;
    violations: string[];       // From Derive's is_valid_trade check
  };

  // Sequential leg simulation (how execution actually works — leg by leg)
  sequential_simulation: {
    all_legs_pass: boolean;
    execution_order: string;    // "recommended" execution order description
    legs: {
      step: number;             // Execution order (1, 2, 3...)
      instrument_name: string;
      direction: "buy" | "sell";
      amount: string;
      is_valid: boolean;
      cumulative_margin_used: string;
      available_after: string;
      error: string | null;
    }[];
  };

  // Warnings
  warnings: string[];
  // e.g., "SM does not net spreads — sell legs margined as naked"
  // e.g., "Portfolio simulation passes but leg 3 (sell ETH-20260327-2400-C) fails individually"
  // e.g., "Leg 2 passes alone but fails after leg 1 consumes $X margin"
}
```

---

## 4. New Tools

### 4.1 `place_and_verify`

**Purpose:** Single-call order placement with automatic fill verification and audit logging.

```
Input:
  instrument_name: string       (required)
  direction: "buy" | "sell"     (required)
  amount: string                (required)
  limit_price: string           (required)
  order_type: "limit" | "market"          (default: "limit")
  time_in_force: "gtc" | "post_only" | "fok" | "ioc"  (default: "gtc")
  reduce_only: boolean          (default: false)
  label: string                 (optional)
  max_fee: string               (default: "100")
  subaccount_id: number         (optional, defaults to env)

Output: LifecycleResult<OrderReceipt>
```

**Behavior:**

1. Resolve `subaccount_id` (param or env default)
2. Call `place_order` with signed payload
3. **If API error:**
   - Classify error (see Error Classification)
   - If classifiable (zero liquidity, insufficient funds, etc.) → return `{ submission: "rejected", receipt: null, error: { code, message } }`
   - If transport/timeout error → return `{ submission: "unknown", receipt: null, error: { code: "TRANSPORT_ERROR", ... } }`
   - Append `order_rejected` or `order_unknown` event to audit log
4. **If order returned with `order_status: "open"`:**
   - Normalize to `OrderReceipt` with `status: "OPEN"`
   - Append `order_placed` event
   - Return `{ submission: "accepted", receipt }`
5. **If order returned with `order_status: "filled"`:**
   - Check `filled_amount` vs `amount` to determine FILLED vs PARTIAL
   - Normalize with fill details from inline `trades[]`
   - Append `order_placed` + `order_filled` events
   - Return `{ submission: "accepted", receipt }`

**Why this matters:** Eliminates the pattern where agents call `place_order`, parse the raw response differently, sometimes forget to check `trades[]`, and don't handle the error cases consistently.

---

### 4.2 `verify_order`

**Purpose:** Check current state of any order and return normalized OrderReceipt.

```
Input:
  order_id: string              (required)
  subaccount_id: number         (optional, defaults to env)
  include_settlement: boolean   (default: false)

Output: LifecycleResult<OrderReceipt>
```

**Behavior:**

1. Call `get_order(order_id)`
2. Normalize the response into OrderReceipt
3. If `include_settlement: true` and status is "FILLED" or "PARTIAL":
   - Call `get_trade_history_private` filtered by `instrument_name` + time window around `created_at`
   - Match trades by `order_id` field (Derive includes `order_id` in each trade record)
   - Populate `settlement.tx_status` and `settlement.tx_hash` from matched trades
4. Append `order_status_checked` event to audit log (never mutate prior events)

**Note on trade matching:** Derive's `get_trade_history_private` returns `order_id` in each trade. We filter client-side after fetching by instrument + time range. A future improvement is adding `order_id` as a direct filter param to the raw wrapper.

---

### 4.3 `create_rfq`

**Purpose:** Send an RFQ and return immediately. Does NOT poll or auto-execute.

```
Input:
  legs: { instrument_name: string, direction: "buy" | "sell", amount: string }[]
  label: string                 (optional)
  subaccount_id: number         (optional, defaults to env)

Output: LifecycleResult<RfqReceipt>
```

**Behavior:**

1. Call `send_rfq` with legs
2. If error (insufficient funds, invalid instrument) → return rejected result
3. Return `{ submission: "accepted", receipt: { status: "OPEN", quotes: [], ... } }`
4. Append `rfq_created` event

---

### 4.4 `await_rfq_quotes`

**Purpose:** Poll for quotes on an open RFQ. Does NOT execute — just returns what quotes are available.

```
Input:
  rfq_id: string                (required)
  max_wait_seconds: number      (default: 30)
  poll_interval_seconds: number (default: 2)
  subaccount_id: number         (optional, defaults to env)

Output: RfqReceipt
```

**Behavior:**

1. Poll `get_quotes(rfq_id)` every `poll_interval_seconds`
2. If quotes received → return immediately with `status: "QUOTED"` and all quotes listed
3. If `max_wait_seconds` exceeded with no quotes → return `status: "OPEN"` (NOT "NO_QUOTES" — the RFQ is still alive on Derive)
4. Does NOT cancel the RFQ. The RFQ remains open until `valid_until` or explicit cancel.
5. Append `rfq_quotes_polled` event with count

**Design note:** Splitting RFQ into create/await/accept gives agents fine-grained control. An agent can create an RFQ, do other work, and check for quotes later. No destructive auto-cancel.

---

### 4.5 `accept_rfq_quote`

**Purpose:** Execute a quote from an RFQ.

```
Input:
  rfq_id: string                (required)
  quote_id: string              (required)
  max_total_cost: string        (optional — safety bound, reject if exceeds)
  subaccount_id: number         (optional, defaults to env)

Output: LifecycleResult<RfqReceipt>
```

**Behavior:**

1. Call `get_quotes(rfq_id)` to fetch the latest quote details for `quote_id`
2. Extract legs with prices from the quote response (agent does NOT need to replay legs manually)
3. If `max_total_cost` set and quote's total cost exceeds it → return rejected with `COST_EXCEEDS_LIMIT`
4. Call `execute_quote` with legs from the quote (auto-signed)
5. Return `{ submission: "accepted", receipt: { status: "EXECUTED", execution: { trades, ... } } }`
6. Append `rfq_executed` event with trade details

**Key improvement over v1:** The caller only provides `rfq_id` + `quote_id`. Legs and prices come from the quote itself — no mismatch hazard.

---

### 4.6 `check_multi_leg_margin`

**Purpose:** Pre-flight margin check that simulates legs BOTH as a portfolio AND sequentially, exposing the SM trap.

```
Input:
  legs: {
    instrument_name: string,
    direction: "buy" | "sell",    ← REQUIRED (was missing in v1)
    amount: string,
    entry_price: string
  }[]
  subaccount_id: number         (optional, defaults to env)

Output: MarginCheckResult
```

**Behavior:**

1. Call `get_subaccount` to determine `margin_type` (SM/PM/PM2)
2. **Portfolio simulation:** Call `get_margin` with ALL legs as `simulated_position_changes` → atomic portfolio view
3. **Sequential simulation:** Simulate execution order (buy legs first, then sell legs):
   - Step 1: Simulate leg 1 alone against current positions
   - Step 2: Simulate legs 1+2 together (leg 1 is now "part of portfolio")
   - Step 3: Simulate legs 1+2+3 together
   - ...and so on for each leg
   - This catches: "leg 3 passes alone but fails after legs 1+2 consume margin"
4. **Compare results:**
   - If portfolio passes but sequential fails → `warnings` explains which leg and why
   - If SM and any short option legs → warn about naked margin requirement
   - If SM → recommend RFQ for atomic execution
5. Return `MarginCheckResult` with both perspectives

**Why sequential, not just isolated:**
- v1 simulated each sell leg independently against current portfolio. This missed the case where leg N passes alone but fails after legs 1..N-1 have consumed margin.
- Sequential simulation mirrors actual execution order and catches cascading margin failures.

**Execution order heuristic:**
1. Buy legs sorted by lowest premium first (consume least margin first)
2. Sell legs sorted by highest margin requirement first (most constrained first)
3. This order maximizes probability of all legs passing

---

### 4.7 `order_audit_log`

**Purpose:** Query the local audit trail.

```
Input:
  instrument_name: string       (optional filter)
  status: string                (optional filter — "FILLED", "CANCELLED", "PARTIAL", "REJECTED", etc.)
  label: string                 (optional filter — supports prefix match)
  from_timestamp: number        (optional)
  to_timestamp: number          (optional)
  limit: number                 (default: 50)
  subaccount_id: number         (optional, defaults to env)

Output: {
  entries: OrderReceipt[];
  summary: {
    total_orders: number;
    filled: number;             // fully filled
    partial: number;            // partially filled (filled_amount > 0 but < requested)
    cancelled: number;          // cancelled (may have partial fills)
    rejected: number;           // never reached exchange
    expired: number;
    total_fees: string;         // sum as string to preserve precision
    total_volume: string;       // sum of filled_amount * average_price
    fill_rate: number;          // (filled + partial) / total_orders * 100
    full_fill_rate: number;     // filled / total_orders * 100
  };
}
```

**Note:** This only covers orders placed through lifecycle tools. Orders placed via raw `place_order` won't appear unless `reconcile` is used to backfill.

---

### 4.8 `reconcile`

**Purpose:** Compare local audit log against Derive's actual state. Detect desync.

```
Input:
  auto_fix: boolean             (default: false)
  subaccount_id: number         (optional, defaults to env)

Output: {
  status: "in_sync" | "desync_detected";
  local_open_orders: string[];
  derive_open_orders: string[];
  missing_from_local: string[];     // on Derive but not in our log (placed via raw tools)
  stale_in_local: string[];         // in our log as open but Derive says filled/cancelled
  fixes_applied: string[];          // if auto_fix, what correction events were appended
}
```

**Behavior:**

1. Fetch `get_open_orders` from Derive
2. Fetch `get_order_history` for recent orders
3. Compare against in-memory materialized state
4. Report discrepancies
5. If `auto_fix: true`, **append correction events** to the JSONL log (never mutate):
   - `order_status_corrected` events for stale entries
   - `order_backfilled` events for orders found on Derive but not in local log
6. Re-materialize in-memory state from updated event stream

---

## 5. Audit Log — Event-Sourced Model

### Core Principle
The JSONL file is an **append-only event log**. Current state is materialized in memory from the event stream. There are no "updates" — only new events that supersede prior state.

### Location
```
~/.config/derive-mcp/audit/<subaccount_id>.jsonl
```

### Event Types

```jsonl
// Order lifecycle events
{"ts":1774001693072,"event":"order_placed","order_id":"6fe9afac-...","instrument":"ETH-20260327-2300-C","direction":"buy","amount":"0.1","limit_price":"30","tif":"gtc","label":"lifecycle_test_gtc_fill","subaccount_id":59757}
{"ts":1774001693072,"event":"order_filled","order_id":"6fe9afac-...","filled_amount":"0.1","average_price":"29.6","fee":"0.564074","trades":[{"trade_id":"004c83b6-...","price":"29.6","amount":"0.1","tx_status":"requested"}]}
{"ts":1774001693200,"event":"order_settled","order_id":"6fe9afac-...","trade_id":"004c83b6-...","tx_status":"settled","tx_hash":"0x2c4a..."}
{"ts":1774001670975,"event":"order_cancelled","order_id":"95f0eb3f-...","cancel_reason":"user_request","filled_amount":"0"}
{"ts":1774001693072,"event":"order_rejected","instrument":"ETH-20260327-2300-C","direction":"buy","amount":"0.1","reason":"ZERO_LIQUIDITY","tif":"ioc","subaccount_id":59757}

// Partial fill events
{"ts":1774001693072,"event":"order_partial_fill","order_id":"abc-...","filled_amount":"0.06","total_filled":"0.06","remaining":"0.04","trade_id":"xyz-..."}

// RFQ lifecycle events
{"ts":1774001998029,"event":"rfq_created","rfq_id":"56b6666a-...","legs":[{"instrument":"ETH-20260327-2500-C","direction":"buy","amount":"1"}],"subaccount_id":59757}
{"ts":1774002010000,"event":"rfq_quoted","rfq_id":"56b6666a-...","quote_count":2,"best_cost":"7.50"}
{"ts":1774002015000,"event":"rfq_executed","rfq_id":"56b6666a-...","quote_id":"q-123","trades":[...],"total_cost":"7.50","total_fee":"0.12"}
{"ts":1774002042543,"event":"rfq_cancelled","rfq_id":"56b6666a-...","cancel_reason":"user_request"}

// Correction events (from reconcile)
{"ts":1774003000000,"event":"order_status_corrected","order_id":"abc-...","old_status":"OPEN","new_status":"CANCELLED","source":"reconcile","cancel_reason":"user_request"}
{"ts":1774003000000,"event":"order_backfilled","order_id":"def-...","instrument":"BTC-PERP","direction":"sell","from":"derive_order_history","subaccount_id":59757}

// Verification events
{"ts":1774002000000,"event":"order_status_checked","order_id":"6fe9afac-...","status":"FILLED","filled_amount":"0.1"}
```

### In-Memory Materialization

On MCP server start:
1. Read the JSONL file for the default `subaccount_id`
2. Replay events to build in-memory state: `Map<order_id, MaterializedOrder>`
3. A `MaterializedOrder` is the latest state for each order, derived from its event chain

```typescript
interface MaterializedOrder {
  order_id: string;
  instrument_name: string;
  direction: "buy" | "sell";
  amount: string;
  limit_price: string;
  time_in_force: string;
  label: string;
  subaccount_id: number;

  // Derived from latest events
  status: "OPEN" | "FILLED" | "PARTIAL" | "CANCELLED" | "EXPIRED" | "REJECTED";
  filled_amount: string;
  average_price: string;
  fee: string;
  cancel_reason: string | null;
  trades: TradeRecord[];

  // Event chain
  events: string[];  // List of event types in order, e.g., ["order_placed", "order_filled", "order_settled"]
  first_event_ts: number;
  last_event_ts: number;
}
```

### Atomicity Concern

The gap between "order succeeded on Derive" and "local append succeeded" is real. If the process crashes between the two:
- The order exists on Derive but not in the local log
- `reconcile` detects this and can backfill
- This is acceptable because Derive is the SSOT for positions — the audit log is a convenience/metrics layer, not a safety-critical store

### Rotation
- Log files are per-subaccount, naturally bounded by trading volume
- No automatic rotation needed for typical agent use (even 1000 orders/day = ~500KB/day)
- Manual rotation: rename the file, server creates a new one on next write

---

## 6. Numeric Handling

### Strategy: Preserve raw, provide convenience

Derive returns numbers as strings with inconsistent precision:
- `"0"`, `"0E-18"`, `"0.000000000000000000"` → all mean zero
- `"29.600000000000000000"` → should display as `29.6`
- `"0.564074"` → keep as-is

**In audit log:** Store raw strings exactly as Derive returns them. Never lose precision.

**In OrderReceipt/RfqReceipt fields:** Use `string` type for all price/amount/fee fields (matching Derive's convention). Add convenience `number` fields where useful:
- `filled_pct: number` — percentage, safe as float
- `is_fully_filled: boolean` — comparison, safe as boolean

**Display normalization** (for MCP tool output, not storage):
```typescript
function displayNumeric(value: string): string {
  if (!value || value === "0" || value === "0E-18") return "0";
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  // Trim trailing zeros but preserve meaningful precision
  return num.toPrecision(8).replace(/\.?0+$/, "");
}
```

This runs in the MCP response formatter (like the existing `roundingReplacer`), not in the data layer.

---

## 7. Error Handling

### Error Classification

```typescript
type OrderError =
  // Exchange rejections (Derive returned a clear error)
  | { code: "ZERO_LIQUIDITY"; message: string }        // IOC/FOK no match
  | { code: "INSUFFICIENT_FUNDS"; message: string }     // Margin rejection
  | { code: "INSTRUMENT_INVALID"; message: string }     // Bad instrument name
  | { code: "AMOUNT_INVALID"; message: string }         // Below minimum or wrong step
  | { code: "PRICE_OUT_OF_BOUNDS"; message: string }    // Outside min_price/max_price
  | { code: "SIGNING_FAILED"; message: string }         // EIP-712 signing error
  // Transport/infra errors (unknown if order reached exchange)
  | { code: "TRANSPORT_ERROR"; message: string; raw: string }  // Timeout, network error
  | { code: "API_ERROR"; message: string; raw: string }        // Unknown API error (5xx, unexpected format)
```

### Error → Code Mapping

The classifier parses Derive's error messages:
```typescript
function classifyError(err: Error): OrderError {
  const msg = err.message;
  if (msg.includes("Zero liquidity")) return { code: "ZERO_LIQUIDITY", message: msg };
  if (msg.includes("Insufficient funds")) return { code: "INSUFFICIENT_FUNDS", message: msg };
  if (msg.includes("Invalid instrument")) return { code: "INSTRUMENT_INVALID", message: msg };
  // ... etc
  if (msg.includes("timeout") || msg.includes("ETIMEDOUT") || msg.includes("ECONNREFUSED"))
    return { code: "TRANSPORT_ERROR", message: msg, raw: msg };
  return { code: "API_ERROR", message: msg, raw: msg };
}
```

### `submission: "unknown"` Handling

When a transport error occurs, we don't know if the order reached Derive:
- Return `{ submission: "unknown" }` — caller must decide whether to retry or check
- Append `order_unknown` event to audit log
- Caller can use `verify_order` (if they have an order_id from a nonce-based lookup) or `reconcile` to resolve

---

## 8. Multi-Leg Execution Safety

### The Problem (Proven by Testing)

Standard Margin (SM) evaluates orders leg-by-leg. A 6-leg options spread can pass `get_margin` simulation (portfolio view) but fail on execution because the sell leg alone requires naked margin.

### The Solution: `check_multi_leg_margin`

Before any multi-leg strategy:

1. Agent calls `check_multi_leg_margin` with all legs (including `direction`)
2. Tool returns both portfolio (atomic) and sequential (realistic) margin views
3. If SM and any sell leg fails in sequence → tool returns clear warning
4. Agent can then:
   - Switch to PM (if eligible)
   - Restructure to avoid short legs
   - Use RFQ for atomic multi-leg execution
   - Execute only the legs that pass

### Sequential Simulation Algorithm

```
Given legs [L1, L2, L3, L4]:

1. Sort legs: buys first (lowest premium), then sells (highest margin)
   Result: [L2(buy), L4(buy), L1(sell), L3(sell)]

2. Sequential margin check:
   Step 1: simulate L2 alone against current portfolio → pass/fail
   Step 2: simulate L2+L4 together against current portfolio → pass/fail
   Step 3: simulate L2+L4+L1 together → pass/fail
   Step 4: simulate L2+L4+L1+L3 together → pass/fail

3. If any step fails:
   - Report which step failed
   - Report cumulative margin consumption at each step
   - Suggest alternative (RFQ, or remove failing legs)
```

### Execution Order Recommendation

The `MarginCheckResult` includes a recommended execution order and explains why:
- Buy legs first: only cost premium, don't require margin on SM
- Sell legs after buys: on PM, having the buy leg already helps margin netting
- On SM: sell legs are always naked regardless of order, so warn accordingly

---

## 9. Tool Registration

New tools are registered in `src/index.ts` alongside existing auto-registered tools:

```
src/
  protocols/
    derive/
      lifecycle/                     ← NEW
        index.ts                     ← exports all lifecycle tools
        types.ts                     ← LifecycleResult, OrderReceipt, RfqReceipt, etc.
        normalize.ts                 ← numeric normalization, error classification
        audit-store.ts               ← JSONL event read/write + in-memory materialization
        place-and-verify.ts
        verify-order.ts
        create-rfq.ts
        await-rfq-quotes.ts
        accept-rfq-quote.ts
        check-multi-leg-margin.ts
        order-audit-log.ts
        reconcile.ts
```

Lifecycle tools call existing action `execute()` functions directly (not via HTTP — they're in the same process). This means zero overhead.

In `src/index.ts`, lifecycle tools are registered after the auto-registered raw tools:
```typescript
import { lifecycleTools } from "./protocols/derive/lifecycle/index.js";

// After existing auto-registration loop...
for (const [name, tool] of Object.entries(lifecycleTools)) {
  server.tool(name, tool.description, tool.schema, tool.handler);
}
```

---

## 10. Migration Path

### For Existing Agents (Suzi)
- Existing `ctx.actions.derive.place_order` still works. No breaking change.
- New tools appear as additional MCP tools: `place_and_verify`, `create_rfq`, etc.
- Agents can migrate at their own pace.

### For Claude (Interactive Use)
- Claude can use `place_and_verify` instead of `place_order` + manual `get_order` follow-up.
- `check_multi_leg_margin` should be used before any strategy involving short options.
- `order_audit_log` replaces manual `get_order_history` + `get_trade_history_private` calls.

### Recommended Migration Order
1. Start using `place_and_verify` for all new orders (immediate benefit: normalized responses + audit)
2. Add `check_multi_leg_margin` before any multi-leg strategies
3. Switch RFQ workflows to `create_rfq` → `await_rfq_quotes` → `accept_rfq_quote`
4. Run `reconcile` periodically to catch any orders placed via raw tools

---

## 11. Future: Venue-Agnostic Extraction

The `LifecycleResult<T>`, `OrderReceipt`, and `RfqReceipt` types are intentionally venue-agnostic. When we add Hyperliquid or Phoenix lifecycle tools, they'll return the same types. The plan:

1. **Now:** Build for Derive in `src/protocols/derive/lifecycle/`
2. **Later:** Extract shared types into `src/lifecycle/types.ts`
3. **Later:** Each venue implements the same tool names with venue-specific internals

---

## 12. Resolved Questions (from v1)

| Question | Resolution |
|---|---|
| Audit log cleanup | Manual file deletion sufficient. No `clear_audit_log` tool needed — it would be dangerous. |
| RFQ polling interval | 2s default, configurable via `poll_interval_seconds`. |
| Settlement verification | Return immediately on match engine confirm. Settlement is async — use `verify_order(include_settlement: true)` to check later. |
| Label conventions | No auto-prefix. Labels are pass-through. Agents choose their own convention. |
| Rate limiting | Composite tools do NOT handle rate limits internally. Let errors propagate and be classified as `API_ERROR`. |

## 13. Open Questions (v2)

1. **Audit log scope:** Currently only covers orders placed through lifecycle tools. Should raw `place_order` calls also be intercepted and logged? (This would require wrapping the raw tool, which changes the "additive, not breaking" principle.)
2. **RFQ quote ranking:** For multi-leg packages, "best quote" is ambiguous (net credit vs net debit, different leg prices). Current design returns ALL quotes and lets the caller decide. Is this sufficient?
3. **Concurrent orders:** If two lifecycle calls are in-flight simultaneously, the audit log append is not mutex-protected. In practice, MCP tools are called sequentially by the LLM, but programmatic agents could hit this. Worth adding a write lock?
