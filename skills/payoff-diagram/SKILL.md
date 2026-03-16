---
name: payoff-diagram
description: Generate interactive HTML payoff diagrams for options strategies on Derive. Auto-triggers after trades or invoke manually. Shows P&L curves at multiple DTEs, greeks, breakevens, IV sensitivity, and scenario analysis.
user-invocable: true
---

# Payoff Diagram Skill

Generate a standalone interactive HTML payoff diagram for options positions on Derive.

## When to Trigger

1. **After any trade execution** via Derive MCP (`place_order` that fills) — auto-generate and inform the user
2. **Manual invocation** — user says "payoff", "show me the payoff", "diagram", "P&L chart", etc.
3. **Position analysis** — user asks "what does my position look like", "show my risk", "breakevens"

## How to Generate

### Step 1: Gather Position Data

Call `get_portfolio_summary` (or `get_positions`) via Derive MCP to get current positions. For each option position, you need:
- `instrument_name` (e.g., `SOL-20260327-85-P`)
- `amount` (positive = long, negative = short)
- `average_price_excl_fees` (entry price per contract)
- `mark_price` (current mark)
- Greeks: `delta`, `gamma`, `vega`, `theta`

Also get spot price from the perp ticker (`get_ticker` for `{CURRENCY}-PERP` → `index_price`).

If Derive MCP is unavailable, ask the user for leg details manually.

### Step 2: Parse Instruments

From each `instrument_name`, extract:
- `currency` (e.g., SOL)
- `expiry` (e.g., 20260327 → "Mar 27, 2026")
- `strike` (e.g., 85)
- `type` ("C" or "P")

### Step 3: Build the Data Object

Create a JavaScript object with this structure:

```javascript
const POSITION_DATA = {
  currency: "SOL",
  spotPrice: 93.40,
  generatedAt: "2026-03-16T23:00:00Z",
  legs: [
    {
      instrument: "SOL-20260327-85-P",
      type: "put",        // "call" or "put"
      strike: 85,
      expiry: "2026-03-27",
      expiryLabel: "Mar 27",
      dte: 11,
      amount: 4,          // positive = long, negative = short
      entryPrice: 2.00,   // price paid/received per contract
      markPrice: 1.73,
      delta: -0.22,
      gamma: 0.023,
      vega: 0.047,
      theta: -0.18,
      iv: 0.81
    },
    // ... more legs
  ],
  // Optional: Derive API base URL for live refresh
  deriveApiUrl: "https://api.lyra.finance"
};
```

### Step 4: Generate HTML

Read the template from `skills/payoff-diagram/template.html` in this repo. Replace the `POSITION_DATA` placeholder object with the actual data from Step 3.

### Step 5: Save and Inform

Save the generated HTML file to `derive-mcp-server/output/payoff-{currency}-{timestamp}.html`.

Create the output directory if it doesn't exist.

Tell the user: "Payoff diagram saved to `output/payoff-SOL-1710626400.html`" and offer to open it.

## Output Directory

```
derive-mcp-server/output/
  payoff-SOL-1710626400.html
  payoff-ETH-1710626500.html
  ...
```

## Design System

Follow suzi-fe design tokens adapted to CSS custom properties:
- Dark theme by default
- `--bg-page: #0a0a0b` (page background)
- `--bg-weak: #141415` (card background)
- `--bg-soft: #1e1e20` (hover/sub-panel)
- `--text-strong: #fafafa` (headings)
- `--text-sub: #a3a3a3` (secondary)
- `--text-soft: #737373` (hints)
- `--border-soft: #262628` (subtle borders)
- `--primary: #ec4899` (pink accent — suzi brand)
- `--success: #22c55e` (profit/green)
- `--error: #ef4444` (loss/red)
- `--warning: #eab308` (yellow)

## Key UX Requirements

1. **Multiple P&L curves** — show at expiry (solid), at 50% DTE (dashed), and today (dotted)
2. **Hover tooltip** — show exact P&L, price, and profit zone at any point
3. **Breakeven markers** — highlighted vertical lines with labels
4. **Current spot marker** — vertical dashed line at current price
5. **Greeks panel** — per-leg and aggregate, color-coded
6. **IV sensitivity slider** — shift IV ±50% and see P&L impact
7. **Leg table** — editable legs with add/remove capability
8. **Responsive** — works on any screen size
9. **Zero dependencies** — pure HTML/CSS/JS, no CDN imports, fully offline-capable
10. **Derive API refresh button** — if API URL is provided, can fetch live prices
