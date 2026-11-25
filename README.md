# 💰 Money Making Simulator

A turn-based board-game-style simulation about **building passive income and reaching financial freedom**.
1–8 players share one device and take turns (pass-and-play). Everyone starts with a random job, lifestyle,
savings and pile of debts — the first player whose **passive income reaches 2× their monthly expenses**
quits their job and wins.

The game is built to teach: every event carries a short money lesson, every deal is broken down with real
investing metrics, every debt shows what it is costing you, and the stock market behaves like the real thing.

## Running it

No install, no build step, no dependencies.

| Option | How |
|---|---|
| **Just open it** | Double-click `index.html` (or drag it into any modern browser). |
| **Node.js** (18+) | From the repo root: `npm start`, then open <http://localhost:8080> (`PORT=3000 npm start` for another port). |
| **Python 3** | From the repo root: `python3 -m http.server 8080`, then open <http://localhost:8080>. |

The game autosaves in your browser after every action. Use **☰ Menu → Download save file** to move a game
to another computer and **Load a save file** to continue it there.

Other commands:

```bash
npm test           # engine + market tests (Node's built-in test runner)
npm run simulate   # play 200 bot games and report how long freedom takes: npm run simulate -- 300 4
```

## How to play

Each turn:

1. **Payday** — collect your salary plus all passive income; pay living expenses, children and debt payments.
   If you can't cover the bills, the shortfall goes on a credit card.
2. **Pop-ups** — random events appear, but not every turn:
   - **Deals** (about half of turns): real estate, businesses, startups, side projects, lending notes, collectibles and stock tips.
   - **Luxury temptations** and **emergencies** — pay cash or put them on a credit card.
   - **Downsizing** — no paycheck for 1–6 turns. **Promotions**, raises, bonuses, side gigs, new babies, lifestyle creep and more.
   - **Charity** — donate 10% of your monthly income for 3 turns of good karma (better deals, more good luck, fewer layoffs).
   - **Buyer offers** for your properties and businesses, repairs, vacancies and expansion opportunities.
3. **Act** — buy deals, trade stocks, pay down debt, borrow from the bank, sell assets or downshift your lifestyle.
4. **End your turn** and pass the device. When everyone has played, the month ends and the market moves.

**Winning:** passive income (dividends + rental cashflow + business profit + interest) ≥ 2× total monthly
expenses (living + children + debt payments). Paying off debt lowers your expenses *and* your target.
After someone wins, the others can keep playing for 2nd, 3rd… Optional time limits (36/60/100 months) rank
players by progress, and the freedom goal can be set to 1.5× or 3× for shorter or longer games.

## What's in it

- **12 fictional investments**: Liberty 500 index fund, MegaByte (big tech), NeuraLux (AI), Vitalis (healthcare),
  FreshCart (grocery chain), Voltrive (EVs), Helios (energy), Keystone REIT, a Treasury bond fund, a gold trust,
  Kryptonix (crypto) and a penny stock that can go bankrupt.
- **Real estate**: condos, houses, mobile homes, duplexes, triplexes/fourplexes, 8–48-unit apartment complexes,
  vacation rentals, fixer-uppers (renovate, then the value jumps), commercial buildings and land.
- **Businesses**: vending and ATM routes, e-commerce, lawn care, food trucks, coffee shops, billboards,
  partnerships, laundromats, car washes, franchises and daycares — some take a few turns to launch before their
  real profit is revealed. Plus startup investments, side projects, lending notes and collectibles.
- **26 jobs** (barista to doctor), 4 lifestyles, and starting debts across credit cards, auto, student,
  mortgage, personal, medical, buy-now-pay-later and boat loans.
- **A bank** that lends as long as the payment fits your cashflow.

## The learning side

- **Money lessons** on every event, deal and market headline.
- **Deal analyzer**: cash-on-cash return, cap rate, the 1% rule, debt-service coverage, loan-to-value,
  payback period and a verdict — each with a plain-English tooltip — plus how the deal would move your freedom meter.
- **Debt tab**: interest charged this month, months to payoff, interest left to pay, avalanche vs. snowball,
  and how extra payments shorten a loan.
- **Money coach**: tips based on *your* numbers (expensive debt, emergency fund, concentration risk, idle cash…).
- **Learn tab**: 17 core ideas (compound growth, leverage, volatility, diversification, bonds and rates…)
  with your own numbers plugged in.
- **End-of-game report card**: interest paid, luxury spending, donations, passive income earned.

## How the market works

Prices update once per month (after every player's turn), so everyone trades at the same prices. The model is
tuned so each asset behaves like its real-world class:

| Asset | Annual volatility | Behavior |
|---|---|---|
| Treasury bond fund | ~5% | Falls when interest rates rise (duration ≈ 6); payouts drift toward current rates |
| FreshCart / Vitalis | ~13% / ~18% | Defensive — hold up in recessions |
| Liberty 500 index | ~15% | ~7%/yr price growth + dividends |
| MegaByte / Helios / REIT | ~19–26% | REIT and energy pay high dividends; REIT is rate-sensitive |
| Voltrive / NeuraLux | ~45% / ~58% | Cyclical growth stocks with big earnings surprises |
| Kryptonix | ~75% | No income; extreme swings and drawdowns |
| Penny stock | ~100% | Usually drifts down; can 10× on news or go bankrupt |

Under the hood: correlated returns through a common market factor, GARCH-style volatility clustering,
a market "fear gauge" that spikes in crashes and recessions, rare fat-tailed jumps, an economy that cycles
between boom, stable and recession, interest-rate moves, quarterly earnings seasons, dividend growth,
stock splits, and calibration so news, earnings and jumps add up to each asset's target volatility.

## Project layout

```
index.html          the page (plain <script> tags, so it works straight from disk)
css/styles.css      styles (dark theme, colorblind-safe player colors)
js/rng.js           seeded random numbers (same seed → same game)
js/data.js          jobs, lifestyles, securities, news, events and deal templates
js/core.js          finance math, player generation, income/expenses, payday
js/market.js        stock market, economy cycle, interest rates, statistics
js/deals.js         deal generation, buying/selling, deal analysis
js/events.js        random events, charity, offers, lessons
js/engine.js        game setup, turn flow, player actions, money coach, save/load
js/ui.js            rendering and input
server.js           optional zero-dependency local web server
tests/              node --test suite
scripts/simulate.js balance simulator
```

All companies, people and events are fictional. This is an educational game, not financial advice.
