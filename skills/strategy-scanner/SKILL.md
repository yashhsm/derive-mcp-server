---
name: strategy-scanner
description: Scan Derive options chains for trade opportunities. Use when user asks to "find trades", "scan for edge", "what looks good", "find opportunities", or any request to discover options strategies.
user-invocable: true
---

# Strategy Scanner Skill

Scan live Derive options data to find trade opportunities and present them in plain language that any crypto trader can understand.

## When to Trigger

User says anything like:
- "scan SOL options", "find me trades", "what looks good on ETH"
- "find edge", "any opportunities?", "scan for setups"
- "what's cheap?", "what's overpriced?", "where's the value?"
- "find me yield", "income ideas", "what can I sell?"
- "bearish setups", "bullish plays", "hedge ideas"

## How It Works

### Step 1: Understand What the User Wants

Parse the user's request into a simple intent. Don't ask them to pick from a menu — interpret naturally:

| User says | Intent | Scan focus |
|-----------|--------|------------|
| "find me trades" / "scan SOL" | General scan | Run all scans, rank by conviction |
| "what's cheap?" / "find value" | Underpriced options | Look for low IV relative to recent, cheap OTM with good R:R |
| "yield ideas" / "what can I sell?" | Income / premium selling | High theta strategies — covered calls, cash-secured puts, condors |
| "bearish plays" / "hedge my SOL" | Directional bearish | Put spreads, outright puts, protective structures |
| "bullish plays" / "upside exposure" | Directional bullish | Call spreads, outright calls, risk reversals |
| "vol play" / "IV looks high/low" | Volatility | Straddles/strangles if IV low, iron condors/butterflies if IV high |

If the intent is ambiguous, default to a general scan and present a mix.

### Step 2: Fetch Data

Use these Derive MCP tools:

```
1. get_options_chain(currency, only_liquid=true)
   → Gets the full chain with bid/ask/IV/greeks for all liquid strikes

2. get_ticker({currency}-PERP)
   → Gets current spot price, funding rate

3. get_funding_rate_history({currency}-PERP)
   → Recent funding trend (bullish/bearish signal)

4. get_portfolio_summary()  [if user has positions]
   → Current positions to avoid conflicts or find hedges
```

### Step 3: Analyze

Run these scans on the chain data. Not all scans apply to every intent — pick the relevant ones.

#### Scan A: IV Skew Analysis
Compare put IV vs call IV at similar deltas (e.g., 25-delta put vs 25-delta call):
- **Put skew steep** (put IV >> call IV): Market is pricing downside fear. Puts are expensive → sell put spreads, or buy call spreads (relatively cheap).
- **Call skew steep** (call IV >> put IV): Unusual upside demand. Calls are expensive → sell call spreads, or buy puts (relatively cheap).
- **Flat skew**: No strong directional bias in options pricing.

Present as: "Put IV is 85% vs Call IV at 72% — the market is pricing in 18% more downside fear. Puts look expensive, calls look relatively cheap."

#### Scan B: Term Structure
Compare ATM IV across expiries:
- **Backwardation** (near IV > far IV): Short-term uncertainty. Calendar spreads (sell near, buy far) can capture the differential. Or sell near-dated premium.
- **Contango** (far IV > near IV): Normal structure. Near-dated options are cheap for gamma plays.

Present as: "Mar 27 IV is 81% but Apr 24 IV is only 72% — that's a 9-point backwardation. Short-term fear is elevated. Calendar spreads could exploit this."

#### Scan C: Unusual Activity
Flag strikes with:
- OI > 2x the average OI across the chain
- Volume spikes (any strike with volume > 0 when most have 0)
- Wide bid-ask spreads (illiquidity warning)

Present as: "The SOL 90C Mar 27 has 2,550 OI — 10x the average. Someone has a large position here."

#### Scan D: Yield Screen (for income intent)
Find the highest theta-per-dollar-at-risk for:
- **Cash-secured puts**: OTM puts where `premium / strike` gives the best annualized yield
- **Covered calls**: OTM calls where `premium / spot` gives the best yield
- **Iron condors**: Sell OTM put spread + OTM call spread, find the widest range with best credit

Present as: "Sell the SOL Apr 24 $80 put at $3.30 — that's a 39% annualized yield, and SOL would need to drop 14% for you to get assigned."

#### Scan E: Cheap Lottery Tickets (for directional intent)
Find far OTM options with:
- Low absolute premium (<$1)
- But reasonable delta (>0.05) — not completely dead
- Good potential payout ratio (max profit / cost > 5:1)

Present as: "SOL Mar 27 $105 call at $1.70 — costs $1.70/contract, pays $unlimited if SOL rallies past $107. That's 12% upside needed."

#### Scan F: Hedge Ideas (if user has positions)
If the user has existing positions (from `get_portfolio_summary`):
- Suggest protective puts if they're long the underlying
- Suggest collar (buy put + sell call) for cost-neutral downside protection
- Suggest tail hedges (cheap far OTM puts) for black swan protection

### Step 4: Rank & Present

Present the top 3-5 ideas, ranked by conviction. For each idea:

```
## 💡 [Strategy Name] — [One-line thesis]

**What:** [Plain English description of the trade]
**Legs:**
| Action | Instrument | Price | Size suggestion |
|--------|-----------|-------|-----------------|
| Buy/Sell | SOL-... | $X.XX (bid/ask) | 1-5x |

**Why it works:** [2-3 sentences on the edge — why NOW, what's the catalyst]
**Risk:** [What goes wrong, max loss]
**Reward:** [Target profit, breakeven]
**Confidence:** ⭐⭐⭐ (Low/Medium/High — based on data quality)
```

### Important Rules

1. **Always use live prices** from `get_options_chain` — NEVER guess or assume prices
2. **Only suggest liquid strikes** — if bid is 0 and ask is 0, skip it
3. **Show bid for sells, ask for buys** — always use executable prices
4. **Explain WHY, not just WHAT** — every idea needs a thesis
5. **Include the risk** — never present just the upside
6. **Size appropriately** — suggest small sizes (1-5 contracts) unless user specifies
7. **Don't overwhelm** — 3-5 ideas max, ranked by conviction
8. **Plain language** — "sell the 80 put" not "initiate a short position in the March OTM put"
9. **If nothing looks good, say so** — "The chain looks fairly priced right now. No clear edge. Consider waiting for a vol catalyst."
10. **Offer to execute** — end with "Want me to execute any of these?" since we have the Derive MCP

### Example Output

```
## Scanning SOL options for opportunities...

**Market context:** SOL at $93.40 | Perp funding: -0.03%/hr (neutral) | Near-term IV: 81% | Far-term IV: 72%

---

### 1. 📉 Calendar Spread — Sell expensive near-dated vol

**What:** Sell Mar 27 $95 call, buy Apr 24 $95 call
**Why:** Near-term IV is 9 points higher than far-dated (81% vs 72%). You're selling expensive short-dated theta and buying cheaper long-dated exposure.
**Net cost:** ~$2.50 debit
**Max profit:** ~$5-8 if SOL sits near $95 at Mar 27 expiry
**Risk:** Large SOL move in either direction. Max loss = $2.50 debit.
**Confidence:** ⭐⭐⭐ (clear term structure signal)

### 2. 💰 Cash-Secured Put — Earn yield at $80

**What:** Sell 1x Apr 24 $80 put at $3.30
**Why:** 39% annualized yield. SOL needs to drop 14% for assignment. If assigned, you buy SOL at effective $76.70 — a level not seen since [date].
**Risk:** SOL crashes below $80 — you own SOL at $76.70.
**Confidence:** ⭐⭐ (good yield but no hedging)

### 3. 🎯 OTM Strangle — Bet on a big move

**What:** Buy 2x Mar 27 $85 put ($2.00) + Buy 2x Mar 27 $105 call ($1.70)
**Why:** Total cost $7.40. SOL needs to move ±12% to profit. With funding neutral and macro uncertainty, a move is plausible.
**Risk:** SOL stays between $85-$105 — lose $7.40.
**Confidence:** ⭐⭐ (requires conviction on vol expansion)

---

Want me to execute any of these? I can place the orders via Derive.
```

### Combining with Payoff Diagram

After presenting ideas, if the user shows interest in a specific strategy, automatically generate a payoff diagram for it using the payoff-diagram skill. Say: "Want me to generate a payoff diagram for this strategy?"
