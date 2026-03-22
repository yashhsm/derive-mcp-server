# Derive MCP Server

> [!WARNING]
> Experimental version. This MCP server is still experimental and should not be treated as production-grade trading infrastructure. Tool names, response shapes, lifecycle helpers, and operational behavior may change. Review every action carefully before using it with live funds.

An MCP (Model Context Protocol) server for [Derive](https://derive.xyz) (formerly Lyra), built for AI assistants that need structured market data, account visibility, raw execution primitives, and safer lifecycle helpers for derivatives trading.

This repo currently exposes **52 tools total**:

- **43 core Derive tools** mapped from the API
- **8 lifecycle and audit tools** layered on top
- **1 `auth_status` meta tool** for runtime capability checks

It works with Claude Code, Claude Desktop, and any MCP client that supports `stdio`.

## What It Covers

- Public market data: options chains, tickers, instruments, trade history, charts, funding, liquidations, rates
- Authenticated account data: subaccounts, notifications, positions, portfolio summary, margin, transfers, session keys
- Raw execution: place/replace/cancel orders, RFQ flows, open orders, order history, private trade history
- Operational controls: cancel-on-disconnect and market maker protection (MMP)
- Lifecycle helpers: normalized receipts, audit logging, RFQ polling, quote acceptance, multi-leg margin checks, reconciliation

## What It Looks Like In Use

```text
You:    "Show me the liquid SOL options chain for the nearest expiry"
Client: [calls get_options_chain] -> structured chain with bid/ask/mark/IV/greeks

You:    "Check my current Derive portfolio"
Client: [calls get_portfolio_summary] -> balance, positions, aggregate greeks, PnL

You:    "Buy 0.1 of this contract and verify the fill"
Client: [calls place_and_verify] -> normalized receipt, warnings, audit log event

You:    "Price this two-leg spread through RFQ and execute the best quote"
Client: [calls create_rfq -> await_rfq_quotes -> accept_rfq_quote]
```

## Quick Start

### 1. Install

```bash
git clone https://github.com/yashhsm/derive-mcp-server.git
cd derive-mcp-server
npm install
npm run build
```

Requires Node.js `>=18`.

### 2. Choose an auth mode

You can run the server in three modes:

| Mode | Required env | What it unlocks |
|---|---|---|
| Public only | none | Public market data and chart tools only |
| API key | `DERIVE_API_KEY` | Authenticated private requests that do not require local EIP-712 signing |
| Session-key trading | `DERIVE_SESSION_PRIVATE_KEY`, `DERIVE_WALLET_ADDRESS`, `DERIVE_SUBACCOUNT_ID` | Signed order placement and RFQ quote execution |

Notes:

- `DERIVE_SUBACCOUNT_ID` is effectively required for signed trading flows because order signing uses the default subaccount from env.
- Legacy aliases are also supported: `LYRA_SESSION_PRIVATE_KEY`, `LYRA_WALLET_ADDRESS`, `LYRA_SUBACCOUNT_ID`.
- `DERIVE_TESTNET=true` switches the server to `https://api-demo.lyra.finance`.
- `DERIVE_API_URL` can override the base URL directly.

Example env file:

```bash
mkdir -p ~/.config/derive-mcp
cat > ~/.config/derive-mcp/env << 'EOF'
# Signed trading mode
DERIVE_SESSION_PRIVATE_KEY=your_session_key_here
DERIVE_WALLET_ADDRESS=0xyourwallet
DERIVE_SUBACCOUNT_ID=123

# Optional alternatives / overrides
# DERIVE_API_KEY=your_api_key_here
# DERIVE_TESTNET=true
# DERIVE_API_URL=https://api.lyra.finance
EOF
chmod 600 ~/.config/derive-mcp/env
```

### 3. Create a launcher script

This keeps secrets out of repo config and works for public-only mode too.

```bash
mkdir -p ~/.local/bin
cat > ~/.local/bin/derive-mcp-launcher << 'SCRIPT'
#!/bin/bash
set -euo pipefail

DERIVE_SERVER="/absolute/path/to/derive-mcp-server/dist/index.js"
DERIVE_ENV_FILE="${DERIVE_ENV_FILE:-$HOME/.config/derive-mcp/env}"

if [ -f "$DERIVE_ENV_FILE" ]; then
  set -a
  . "$DERIVE_ENV_FILE"
  set +a
fi

exec node "$DERIVE_SERVER" "$@"
SCRIPT

chmod +x ~/.local/bin/derive-mcp-launcher
```

### 4. Add it to your MCP client

Generic `stdio` example:

```json
{
  "mcpServers": {
    "derive": {
      "command": "/Users/you/.local/bin/derive-mcp-launcher"
    }
  }
}
```

**Claude Code** (`~/.claude.json`):

```json
{
  "mcpServers": {
    "derive": {
      "type": "stdio",
      "command": "/Users/you/.local/bin/derive-mcp-launcher"
    }
  }
}
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "derive": {
      "command": "/Users/you/.local/bin/derive-mcp-launcher"
    }
  }
}
```

## Recommended Tooling Patterns

If you are building an agent on top of this server, these are the safest defaults:

- Start with `auth_status` to see which capabilities are actually available at runtime.
- Start with `get_options_chain` for options analysis, not `get_ticker`.
- Use `get_tickers` for executable options quotes from market makers; use `get_instruments(compact=true)` alongside it when you need lot sizes.
- Prefer `place_and_verify` over raw `place_order` if you want normalized receipts, error classification, and audit logging.
- Prefer `create_rfq`, `await_rfq_quotes`, and `accept_rfq_quote` over raw RFQ tools if you want a complete multi-step flow.
- Run `check_multi_leg_margin` before any short-leg or spread strategy, especially on Standard Margin accounts.
- Use `order_audit_log` and `reconcile` if you want a local operational history of orders placed through lifecycle tools.

## Tool Surface

### Public Market Data And Charts (12)

| Tool | Description |
|---|---|
| `get_options_chain` | Structured options chain with strikes as rows and call/put columns. Best starting point for options analysis. |
| `get_tickers` | Batch pricing with market-maker quotes, greeks, IV, and liquidity filtering. Primary pricing tool for options. |
| `get_ticker` | Detailed single-instrument metadata. Best for perps and instrument metadata, not option bid/ask discovery. |
| `get_instruments` | Active instruments for a currency and type, with useful filters for options. |
| `get_all_instruments` | Paginated list of all instruments across currencies. |
| `get_trade_history_public` | Public trade history. |
| `get_funding_rate_history` | Historical perp funding rates. |
| `get_interest_rate_history` | Historical USDC borrow and supply APY. |
| `get_liquidation_history` | Liquidation auction history. |
| `get_transaction` | Transaction status lookup. |
| `get_index_chart_data` | Spot or index OHLC candles. |
| `get_tradingview_chart_data` | Instrument OHLCV candle data. |

### Account, Portfolio, Transfers, And Session (12)

| Tool | Description |
|---|---|
| `get_account` | Account details such as fee tier, rate limits, and subaccount info. |
| `get_subaccounts` | List available subaccount IDs. |
| `get_subaccount` | Full subaccount snapshot including margin type, positions, open orders, and value. |
| `get_notifications` | Account notifications. |
| `get_positions` | All active positions with greeks, PnL, margin, and liquidation data. |
| `get_collaterals` | Collateral holdings with mark values and interest. |
| `get_margin` | Current margin plus optional position or collateral simulation. |
| `get_portfolio_summary` | One-call portfolio summary with balance, positions, and aggregate greeks. |
| `get_deposit_history` | Deposit history. |
| `get_withdrawal_history` | Withdrawal history. |
| `get_erc20_transfer_history` | ERC20 transfer history between subaccounts. |
| `get_session_keys` | Session keys for the configured wallet. |

### Raw Orders, RFQ, And Account Controls (16)

| Tool | Description |
|---|---|
| `place_order` | Raw order placement with automatic EIP-712 signing. |
| `replace_order` | Atomic cancel-and-replace for an existing order. |
| `cancel_order` | Cancel a single order. |
| `cancel_by_instrument` | Cancel all open orders for one instrument. |
| `cancel_by_label` | Cancel open orders by label. |
| `cancel_all_orders` | Cancel all open orders for a subaccount. |
| `get_open_orders` | Current open orders. |
| `get_order` | Current state of a single order. |
| `get_order_history` | Historical orders. |
| `get_trade_history_private` | Private trade fills with fees and realized PnL. |
| `send_rfq` | Send a request for quote. |
| `get_rfqs` | Retrieve RFQs. |
| `get_quotes` | Retrieve quotes for an RFQ. |
| `execute_quote` | Execute a specific RFQ quote with signed legs. |
| `cancel_rfq` | Cancel an RFQ. |
| `set_cancel_on_disconnect` | Enable or disable auto-cancel on disconnect. |

### Market Maker Protection (3)

| Tool | Description |
|---|---|
| `get_mmp_config` | Read current MMP configuration. |
| `set_mmp_config` | Configure MMP thresholds and freeze behavior. |
| `reset_mmp` | Manually reset or unfreeze MMP. |

### Lifecycle And Audit Helpers (8)

These are composite tools built in this repo on top of the raw Derive endpoints.

| Tool | Description |
|---|---|
| `place_and_verify` | Preferred order placement wrapper with normalized receipts, fill verification, and audit logging. |
| `verify_order` | Re-check any order and emit audit corrections if the state changed. |
| `create_rfq` | Open an RFQ and immediately return a normalized receipt. |
| `await_rfq_quotes` | Poll an RFQ for quotes without executing them. |
| `accept_rfq_quote` | Execute a chosen RFQ quote by `rfq_id` and `quote_id` without replaying legs manually. |
| `check_multi_leg_margin` | Compare atomic and sequential margin behavior for multi-leg strategies. |
| `order_audit_log` | Query the local append-only audit trail with summary stats. |
| `reconcile` | Compare the local audit log with Derive state and optionally backfill corrections. |

### Meta (1)

| Tool | Description |
|---|---|
| `auth_status` | Reports the configured auth mode, API URL, default subaccount, and available capabilities. |

## Important Behavior Notes

### Public vs signed trading tools

- Public tools require no auth.
- Most authenticated read paths use the private API and can run with an API key or session-key auth.
- Signed trading flows require `DERIVE_SESSION_PRIVATE_KEY`, `DERIVE_WALLET_ADDRESS`, and `DERIVE_SUBACCOUNT_ID`.
- In practice, signed order execution includes `place_order`, `execute_quote`, and lifecycle tools that depend on them such as `place_and_verify` and `accept_rfq_quote`.

### Options pricing

- `get_options_chain` and `get_tickers` are the primary options analysis and pricing tools.
- `get_ticker` exposes CLOB resting bid and ask, which can be misleading for options because options trade primarily through market-maker streaming quotes.
- When placing orders, use `get_instruments(compact=true)` or `get_ticker` for `minimum_amount`, `amount_step`, and `tick_size`.

### Margin and spread safety

- Standard Margin (`SM`) does not net option spreads.
- Portfolio Margin (`PM` / `PM2`) does.
- For short options or credit spreads, inspect `margin_type` via `get_subaccount`, simulate with `get_margin`, and prefer `check_multi_leg_margin` or RFQ-based execution when appropriate.

### Local audit log

Lifecycle tools write an append-only JSONL audit trail to:

```text
~/.config/derive-mcp/audit/<subaccount_id>.jsonl
```

This is local state owned by the MCP server process. It is useful for:

- debugging order outcomes
- reconstructing lifecycle receipts
- tracking fill rate and fees
- reconciling raw orders that bypassed lifecycle tools

## LLM-Friendly Design Choices

This server is not a thin API wrapper. It includes several choices specifically made for AI agents:

- `get_options_chain` returns a structured chain instead of forcing callers to stitch together raw ticker data.
- `get_portfolio_summary` collapses balance, positions, and aggregate greeks into one call.
- `get_tickers(only_liquid=true)` keeps option responses smaller and more relevant.
- Numeric strings are rounded for MCP display when Derive returns excessive precision, while the lifecycle audit log retains the underlying raw values that matter operationally.
- Lifecycle tools normalize common failure cases such as zero liquidity, insufficient funds, transport errors, and partially filled orders.

## Included Skills

The repo also includes higher-level Claude Code skills that pair with this MCP server:

| Skill | Description |
|---|---|
| `payoff-diagram` | Interactive HTML payoff diagrams with PnL curves, DTE views, scenario analysis, and plain-English strategy summaries. |
| `strategy-scanner` | Live options chain scanning for trade ideas across skew, term structure, unusual activity, yield screens, and lottery-ticket setups. |
| `trade-intent-parser` | Natural-language trade parsing that validates instruments, checks liquidity and margin, previews the trade, and can hand off to execution flows. |

## Repo Layout

```text
derive-mcp-server/
├── src/
│   ├── index.ts
│   └── protocols/derive/
│       ├── client.ts
│       ├── signing.ts
│       ├── response-schemas.ts
│       ├── public/
│       ├── private/
│       └── lifecycle/
├── docs/
│   └── ORDER_LIFECYCLE_MANAGER.md
├── skills/
│   ├── payoff-diagram/
│   ├── strategy-scanner/
│   └── trade-intent-parser/
├── agents/
│   └── sol-momentum-scalper.ts
├── dist/
├── package.json
└── tsconfig.json
```

## Extra Docs And Examples

- [`docs/ORDER_LIFECYCLE_MANAGER.md`](./docs/ORDER_LIFECYCLE_MANAGER.md): design notes for the lifecycle layer, audit model, and normalized receipts
- [`agents/sol-momentum-scalper.ts`](./agents/sol-momentum-scalper.ts): experimental example agent using the lifecycle and RFQ tools
- [`skills/`](./skills): higher-level Claude Code skills that pair with this server

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DERIVE_SESSION_PRIVATE_KEY` | Signed trading | Session key private key used for EIP-712 order signing |
| `DERIVE_WALLET_ADDRESS` | Signed trading | Wallet address associated with the Derive session key |
| `DERIVE_SUBACCOUNT_ID` | Signed trading / useful elsewhere | Default subaccount used by signed trading flows and as the fallback for tools that accept `subaccount_id` |
| `DERIVE_API_KEY` | Optional | Alternative auth path for authenticated private requests that do not require local signing |
| `DERIVE_API_URL` | Optional | Override the base API URL directly |
| `DERIVE_TESTNET` | Optional | Set to `"true"` to use `https://api-demo.lyra.finance` |
| `LYRA_SESSION_PRIVATE_KEY` | Optional | Legacy alias for `DERIVE_SESSION_PRIVATE_KEY` |
| `LYRA_WALLET_ADDRESS` | Optional | Legacy alias for `DERIVE_WALLET_ADDRESS` |
| `LYRA_SUBACCOUNT_ID` | Optional | Legacy alias for `DERIVE_SUBACCOUNT_ID` |

## Market Coverage

Market listings on Derive change over time. Instead of relying on a static README list, use:

- `get_instruments`
- `get_all_instruments`
- `get_options_chain`

to discover the current set of live options, perps, strikes, expiries, and collateral-supported markets.

## License

MIT
