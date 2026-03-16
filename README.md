# Derive MCP Server

An MCP (Model Context Protocol) server that gives AI assistants full access to [Derive](https://derive.xyz) (formerly Lyra) — the largest onchain options exchange.

**41 tools** covering options, perps, RFQ, portfolio management, and market data. Handles EIP-712 order signing automatically — your AI can research, quote, and execute derivatives trades in natural language.

## What Can It Do?

```
You:    "Show me the SOL options chain for March expiry, only liquid strikes"
Claude: [calls get_options_chain] → structured chain with bid/ask/IV/greeks

You:    "Buy 4x SOL Mar27 85 puts at the ask"
Claude: [calls place_order] → order filled, shows trade details

You:    "How's my portfolio looking?"
Claude: [calls get_portfolio_summary] → balance, positions, aggregate greeks, P&L
```

Works with Claude Code, Claude Desktop, Cursor, and any MCP-compatible client.

## Quick Start

### 1. Install

```bash
git clone https://github.com/yashhsm/derive-mcp-server.git
cd derive-mcp-server
npm install
npm run build
```

### 2. Configure credentials

Create `~/.config/derive-mcp/env` (or any path you prefer):

```bash
mkdir -p ~/.config/derive-mcp
cat > ~/.config/derive-mcp/env << 'EOF'
DERIVE_SESSION_PRIVATE_KEY=your_session_key_here
DERIVE_WALLET_ADDRESS=your_wallet_address_here
DERIVE_SUBACCOUNT_ID=your_subaccount_id_here
EOF
chmod 600 ~/.config/derive-mcp/env
```

**Getting credentials:**
- Go to [derive.xyz](https://derive.xyz), connect your wallet
- Create a session key from Account Settings
- Your subaccount ID is visible in the URL or account page

> **Read-only mode:** Omit `DERIVE_SESSION_PRIVATE_KEY` to use the server for market data only (no trading).

### 3. Create a launcher script

```bash
cat > ~/.local/bin/derive-mcp-launcher << 'SCRIPT'
#!/bin/bash
set -euo pipefail

DERIVE_SERVER="/path/to/derive-mcp-server/dist/index.js"
DERIVE_ENV_FILE="$HOME/.config/derive-mcp/env"

set -a
source "$DERIVE_ENV_FILE"
set +a

exec node "$DERIVE_SERVER" "$@"
SCRIPT

chmod +x ~/.local/bin/derive-mcp-launcher
```

### 4. Add to your MCP client

**Claude Code** (`~/.claude.json`):
```json
{
  "mcpServers": {
    "derive": {
      "type": "stdio",
      "command": "/path/to/derive-mcp-launcher"
    }
  }
}
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "derive": {
      "command": "/path/to/derive-mcp-launcher"
    }
  }
}
```

## Tools

### Market Data (public, no auth needed)

| Tool | Description |
|------|-------------|
| `get_options_chain` | Structured options chain — strikes as rows, calls/puts as columns, with bid/ask/IV/greeks/OI. **Start here for options analysis.** |
| `get_tickers` | Batch MM streaming quotes. Use `only_liquid=true` to filter dead strikes (89% noise reduction). |
| `get_ticker` | Single instrument details: mark, index, greeks, funding, OI, fees, tick size. |
| `get_instruments` | Discover available instruments. Use `compact=true` and strike filters to avoid huge responses. |
| `get_trade_history_public` | Public trade history. |
| `get_funding_rate_history` | Perp funding rate history. |
| `get_index_chart_data` | Spot/index OHLC candles. |
| `get_tradingview_chart_data` | Instrument OHLCV candles. |
| `get_liquidation_history` | Liquidation auction history. |
| `get_interest_rate_history` | USDC borrow/supply APY history. |
| `get_transaction` | Transaction status lookup. |
| `get_all_instruments` | Paginated list of all instruments. |

### Portfolio & Account (auth required)

| Tool | Description |
|------|-------------|
| `get_portfolio_summary` | **One-call portfolio overview**: USDC balance, all positions with greeks, and aggregate totals. Use this instead of separate calls. |
| `get_positions` | Active positions with greeks, PnL, margin, liquidation prices. |
| `get_collaterals` | Collateral holdings with mark values. |
| `get_margin` | Current margin info and trade simulation. |
| `get_subaccount` | Full subaccount snapshot. |
| `get_subaccounts` | List all subaccount IDs. |
| `get_account` | Account details: fee tiers, rate limits. |
| `get_open_orders` | All open orders. |
| `get_order_history` | Historical orders. |
| `get_trade_history_private` | Private trade fills with PnL and fees. |
| `get_notifications` | Account notifications. |
| `get_deposit_history` | Deposit history. |
| `get_withdrawal_history` | Withdrawal history. |
| `get_erc20_transfer_history` | ERC20 transfers between subaccounts. |
| `get_session_keys` | List session keys. |

### Trading (auth + EIP-712 signing)

| Tool | Description |
|------|-------------|
| `place_order` | Place limit/market orders. Handles EIP-712 signing automatically. Supports IOC, FOK, GTC, post-only. |
| `replace_order` | Atomic cancel + new order. |
| `cancel_order` | Cancel by order ID. |
| `cancel_by_instrument` | Cancel all orders for an instrument. |
| `cancel_by_label` | Cancel all orders with a label. |
| `cancel_all_orders` | Cancel all open orders. |
| `set_cancel_on_disconnect` | Auto-cancel on WebSocket disconnect. |

### RFQ (Request for Quote)

| Tool | Description |
|------|-------------|
| `send_rfq` | Send multi-leg RFQ to market makers. |
| `get_rfqs` | View active RFQs. |
| `get_quotes` | View received quotes. |
| `cancel_rfq` | Cancel an open RFQ. |

### Market Maker Protection

| Tool | Description |
|------|-------------|
| `get_mmp_config` | View MMP configuration. |
| `set_mmp_config` | Configure MMP parameters. |
| `reset_mmp` | Reset/unfreeze MMP. |

## LLM-Friendly Design

This server is built specifically for AI consumption, not just API wrapping:

- **`get_options_chain`** returns a structured chain that LLMs can reason about directly — no need to call `get_tickers` per expiry and manually build the chain
- **`get_portfolio_summary`** aggregates positions + collaterals + greeks in one call — saves tool calls and manual math
- **`only_liquid` filter** on `get_tickers` reduces response size by ~89%, keeping context windows clean
- **Precision rounding** — Derive API returns 40+ decimal places (`1.744970278569...`); this server rounds to 6 decimals for prices and uses scientific notation for very small values (greeks)
- **30s request timeout** — prevents hung API calls from freezing the MCP session
- **`compact` mode** on `get_instruments` returns only essential fields (name, strike, tick size, amount step)
- **Margin rules in tool descriptions** — `place_order` description explains SM vs PM margin behavior so LLMs don't accidentally place margin-insufficient trades

## Skills

The `skills/` directory contains Claude Code skills that extend this MCP server with higher-level capabilities:

| Skill | Status | Description |
|-------|--------|-------------|
| `intent-analyser` | Planned | Parses natural language trading intent into structured Derive orders — handles complex multi-leg strategies, validates sizing, and checks margin before execution. |
| `payoff-diagram` | Planned | Generates interactive HTML payoff diagrams for options strategies — shows P&L curves, breakevens, greeks heatmaps, and scenario analysis. |

Skills are designed to be installed into `~/.claude/skills/` and work alongside the MCP server.

## Repo Structure

```
derive-mcp-server/
├── src/
│   ├── index.ts                    # MCP server entry point
│   └── protocols/derive/
│       ├── client.ts               # API client, auth, request helpers
│       ├── signing.ts              # EIP-712 order signing
│       ├── types.ts                # Action/Protocol interfaces
│       ├── response-schemas.ts     # Zod response schemas
│       ├── index.ts                # Protocol registry (all 41 actions)
│       ├── public/                 # Market data tools (no auth)
│       │   ├── market-data/        # Instruments, tickers, options chain, trades
│       │   └── charts/             # OHLCV candle data
│       └── private/                # Authenticated tools
│           ├── account/            # Account info, subaccounts
│           ├── positions/          # Positions, collaterals, margin, portfolio
│           ├── orders/             # Place, cancel, replace, history
│           ├── rfq/                # Request for quote
│           ├── transfers/          # Deposits, withdrawals
│           ├── mmp/                # Market maker protection
│           └── session/            # Session key management
├── skills/                         # Claude Code skills (higher-level capabilities)
│   ├── intent-analyser/            # NL → structured trade orders
│   └── payoff-diagram/             # Interactive HTML payoff charts
├── dist/                           # Compiled output (gitignored)
├── package.json
├── tsconfig.json
├── LICENSE                         # MIT
└── .gitignore
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DERIVE_SESSION_PRIVATE_KEY` | For trading | Session key private key (hex) |
| `DERIVE_WALLET_ADDRESS` | For trading | Your wallet address |
| `DERIVE_SUBACCOUNT_ID` | For trading | Default subaccount ID |
| `DERIVE_API_KEY` | Alternative | API key (alternative to session key for read-only) |
| `DERIVE_API_URL` | No | Override API URL (default: `https://api.lyra.finance`) |
| `DERIVE_TESTNET` | No | Set to `"true"` for testnet (`https://api-demo.lyra.finance`) |

> **Security:** Never put credentials in the repo. Use the launcher script pattern above to source env vars at runtime from a secured file outside the project.

## Supported Markets

- **Options:** BTC, ETH, SOL, HYPE, ADA (strikes and expiries vary)
- **Perps:** BTC-PERP, ETH-PERP, SOL-PERP, and more
- **Collateral:** 21+ types including BTC, ETH, staked assets, yield-bearing tokens

## License

MIT
