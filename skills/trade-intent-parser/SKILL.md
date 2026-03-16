---
name: trade-intent-parser
description: Parse natural language trading intent into structured Derive orders. Use when user describes a trade in plain English — validates instruments, checks liquidity, simulates margin, shows preview, and executes after confirmation.
user-invocable: true
---

# Trade Intent Parser Skill

Convert natural language trade descriptions into validated, executable Derive orders.

## When to Trigger

User says anything that describes a trade they want to make:
- "buy 5 SOL 90 puts expiring March"
- "sell the 95/100 call spread on ETH"
- "iron condor on SOL, 80/85/105/110, April expiry"
- "short straddle at 95"
- "buy 2x Mar 85 puts and 3x Apr 110 calls"
- "close my SOL puts"
- "roll my March puts to April"

Do NOT trigger for research questions like "what's the price of the 90 call" — use the MCP tools directly for those.

## How It Works

### Step 1: Parse Intent

Extract from the user's natural language:

```
{
  currency: string,         // SOL, ETH, BTC (infer from context if not stated)
  legs: [{
    direction: "buy" | "sell",
    type: "call" | "put",
    strike: number,
    expiry: string | null,   // "March", "Mar 27", "20260327", or null (nearest)
    amount: number,           // number of contracts
  }],
  strategy_name: string | null,  // "iron condor", "straddle", etc. if recognized
}
```

**Parsing rules:**
- "long" / "buy" → direction: "buy"
- "short" / "sell" / "write" → direction: "sell"
- If no direction specified for a recognized strategy, infer from strategy type:
  - "iron condor" → sell inner legs, buy outer legs
  - "straddle" / "strangle" → default to "buy" unless "short/sell" prefix
  - "bull call spread" → buy lower strike call, sell higher strike call
  - "bear put spread" → buy higher strike put, sell lower strike put
  - "butterfly" → buy outer wings, sell 2x middle
  - "calendar spread" → sell near-dated, buy far-dated
  - "covered call" → implies user already holds underlying, just sell the call
  - "collar" → buy put + sell call
  - "risk reversal" → sell put + buy call (or vice versa if bearish)
- If no amount specified, default to 1 per leg
- If no expiry specified, use the nearest liquid expiry
- If strike is relative ("ATM", "10% OTM"), resolve against current spot

**Strategy expansion:**

| User says | Legs |
|-----------|------|
| "iron condor 80/85/105/110" | Buy 80P, Sell 85P, Sell 105C, Buy 110C |
| "butterfly at 95" | Buy 90P, Sell 2x 95P, Buy 100P (5-wide, centered) |
| "straddle at 95" | Buy 95C + Buy 95P |
| "strangle 85/105" | Buy 85P + Buy 105C |
| "bull call spread 90/100" | Buy 90C, Sell 100C |
| "bear put spread 95/85" | Buy 95P, Sell 85P |
| "calendar 95 Mar/Apr" | Sell Mar 95C, Buy Apr 95C |
| "jade lizard 85/105/110" | Sell 85P, Sell 105C, Buy 110C |
| "ratio spread 90/100 1x2" | Buy 1x 90C, Sell 2x 100C |

### Step 2: Resolve Instruments

For each leg, find the exact Derive instrument:

1. Call `get_options_chain(currency, only_liquid=true)` to get available instruments
2. Match each leg to the closest available instrument:
   - Match strike exactly, or find the nearest available strike
   - Match expiry: resolve "March" → find March expiry dates, pick the one with most liquidity
   - If no exact match, tell the user what's available

3. If an instrument doesn't exist or has zero liquidity, **stop and inform the user**:
   ```
   ⚠️ The SOL Mar 27 $115 call exists but has no quotes (0 bid / 0 ask).
   Nearest liquid strikes: $105C (bid: $1.10, ask: $1.70) or $110C (bid: $3.20, ask: $3.80).
   Want me to adjust?
   ```

### Step 3: Fetch Live Prices

For each resolved instrument, get the executable price:
- **Buying:** use the **ask** price (what you pay)
- **Selling:** use the **bid** price (what you receive)
- If bid or ask is 0, flag as illiquid

Calculate:
- **Net debit/credit** — sum of all leg costs
- **Per-leg cost** — price × amount for each leg
- **Total fees** — estimate using Derive's fee schedule (taker: 0.075%, maker: -0.05%)

### Step 4: Validate

Check for issues before presenting:

1. **Margin check (for short legs):**
   - If any leg is a sell, call `get_subaccount` to check margin_type
   - If Standard Margin (SM): warn that short options need naked margin, even in spreads
   - Call `get_margin` with `simulated_position_changes` to check if the trade is possible
   - If insufficient margin, tell the user exactly how much more they need

2. **Balance check:**
   - For debit trades: check if USDC balance ≥ net debit + estimated fees
   - Call `get_collaterals` to verify

3. **Size sanity check:**
   - If total position value > 50% of portfolio, warn about concentration
   - If buying options with > $100 premium, double-check the user meant that size

4. **Liquidity check:**
   - If bid-ask spread > 20% of mid price, warn about wide spreads
   - If available size < requested amount, warn about partial fills

### Step 5: Present Order Preview

Show a clear preview table before executing:

```
## 📋 Order Preview: Bull Call Spread on SOL

| Leg | Action | Instrument | Price | Qty | Cost |
|-----|--------|-----------|-------|-----|------|
| 1 | BUY | SOL-20260327-90-C | $7.20 (ask) | 2 | -$14.40 |
| 2 | SELL | SOL-20260327-100-C | $2.10 (bid) | 2 | +$4.20 |

**Net debit:** $10.20
**Est. fees:** ~$0.15
**Total cost:** $10.35
**Max profit:** $9.80 (at SOL > $100)
**Max loss:** $10.20 (at SOL < $90)
**Breakeven:** $95.10

**Your balance:** $43.96 USDC → $33.61 after trade

⚠️ Heads up: You're on Standard Margin — the short 100C is margined as a naked call, not as part of the spread. Margin required: ~$XX.

Ready to execute? (yes / adjust / cancel)
```

### Step 6: Execute

On user confirmation ("yes", "go", "execute", "do it", "lfg"):

1. Place each leg as a separate order via `place_order`:
   - Use `time_in_force: "ioc"` for market-like execution at limit price
   - Set `limit_price` to the bid (sells) or ask (buys) from the preview
   - Set `max_fee` to a reasonable amount (e.g., $1-5 per leg)
   - Use a descriptive `label` (e.g., "bull-call-spread-leg1")

2. Execute legs in this order:
   - **Buy legs first** (they only cost premium, no margin risk)
   - **Sell legs second** (in case margin is tight, buys establish the protective leg first)

3. After all fills, show execution summary:
   ```
   ✅ Bull Call Spread executed!

   | Leg | Instrument | Filled | Price | Fee |
   |-----|-----------|--------|-------|-----|
   | 1 | SOL-20260327-90-C | 2/2 | $7.20 | $0.08 |
   | 2 | SOL-20260327-100-C | 2/2 | $2.10 | $0.05 |

   Total spent: $10.33 (including $0.13 fees)
   ```

4. **Auto-trigger payoff diagram** — generate a payoff diagram for the new position using the payoff-diagram skill.

### Step 7: Handle Edge Cases

**Partial fills:**
```
⚠️ Leg 2 only filled 1 of 2 contracts. The remaining 1 contract had no liquidity.
You now have an unbalanced spread (2x long 90C, 1x short 100C).
Want me to: (1) Cancel the extra long leg, (2) Try again for the remaining fill, (3) Leave as-is?
```

**Price moved:**
```
⚠️ The ask price for SOL-20260327-90-C moved from $7.20 to $7.50 since the preview.
Updated net debit: $10.80 (was $10.20). Proceed at new price?
```

**Closing positions:**
If user says "close my puts" or "exit the spread":
1. Call `get_positions` to find matching positions
2. Create opposite orders (if long, sell; if short, buy)
3. Use `reduce_only: true`

**Rolling positions:**
If user says "roll my March puts to April":
1. Close the March position (sell to close)
2. Open the April position (buy to open) at same or adjusted strike
3. Show the net cost of the roll

### Important Rules

1. **ALWAYS show preview before executing** — never place orders without user confirmation
2. **Use live prices** — fetch fresh prices right before the preview, not cached data
3. **Warn about margin** — especially on SM accounts with short legs
4. **Buy before sell** — when executing multi-leg strategies
5. **Label orders** — use descriptive labels for tracking
6. **IOC for immediate fills** — unless user asks for GTC limit orders
7. **Round sizes** — respect the instrument's `amount_step`
8. **Never exceed balance** — check before executing
9. **Auto-generate payoff diagram** after successful execution
10. **If parsing fails, ask** — don't guess. "I understood you want to buy SOL calls, but which strike and expiry? Here's what's available: [chain summary]"
