# 💰 Money Making Simulator

A turn-based board-game-style simulation about **building passive income and reaching financial freedom**.
1–8 players share one device and take turns (pass-and-play), and any seat can be a computer opponent, so you can
also play alone against bots. Everyone starts with a random job, lifestyle,
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
| **Python 3** | From the repo root: `python3 wsgi.py` (or `python3 -m http.server 8080`), then open <http://localhost:8080>. |

The game autosaves in your browser after every action. Use **☰ Menu → Download save file** to move a game
to another computer and **Load a save file** to continue it there.

Other commands:

```bash
npm test           # engine + market tests (Node's built-in test runner)
npm run test:wsgi  # tests for the WSGI deployment entry point (Python 3)
npm run simulate   # play 200 bot games and report how long freedom takes
                   # npm run simulate -- [games] [players] [easy|normal|hard|mix], e.g. npm run simulate -- 300 3 mix
```

## How to play

Each turn:

1. **Payday** — collect your salary plus all passive income; pay living expenses, children and debt payments.
   If you can't cover the bills, the shortfall goes on a credit card.
2. **Pop-ups** — random events appear, but not every turn:
   - **Deals** (about half of turns): real estate, businesses, startups, side projects, lending notes, collectibles and stock tips.
   - **Luxury temptations** (about one turn in four) — vacations, gadgets, shopping sprees, and a new car once
     yours is paid off (a down payment plus a 5-year loan). The more lavish your lifestyle, the more often temptation knocks.
   - **Surprise bills** (about one turn in four) — car repairs, medical bills and more. Owning a home, a boat or having
     kids brings its own kinds of bills. Pay cash or put them on a credit card.
   - **Downsizing** — no paycheck for 1–6 turns (networking shortens it). **Promotions**, smaller permanent **raises**, bonuses, side gigs, lifestyle creep and more.
   - **Networking** — a one-time conference fee or a monthly club subscription makes raises, promotions and side gigs more likely and shortens job searches.
   - **Relationships** — meet someone and date (about 5% of dating months end in a breakup, more if you keep putting off marriage),
     get married (pay cash for the wedding, finance it, or keep it simple), have children (married couples are asked often), or divorce.
   - **Startup results** — a pop-up tells you when a startup you backed succeeds or fails.
   - **Charity** — donate 10% of your monthly income for 3 turns of good karma (better deals, more good luck, fewer layoffs).
     If you've been laid off, it's still 10% of your usual salary.
   - **Buyer offers** for your properties and businesses, repairs, vacancies and expansion opportunities.
3. **Act** — buy deals, trade stocks, options and short positions, open CDs, pay down debt, borrow from the bank, sell assets,
   trade assets with other players, buy or sell the home you live in, or downshift your lifestyle.
4. **End your turn** and pass the device. When everyone has played, the month ends and the market moves.

**Computer opponents:** on the setup screen, switch any seat from *Person* to a bot, or press
*Add a computer opponent*. Bots play by exactly the same rules and get their own random cards; their turns
are instant, and your payday screen shows what each one did since your last turn.

| Level | Personality | How it plays |
|---|---|---|
| Easy | The Spender | Thin savings, luxuries on the credit card, chases hot tips and panic-sells (more in fearful markets, chasing more in greedy ones), finances a big wedding, rarely buys deals. |
| Normal | The Steady Saver | Buys deals with solid cashflow, pays off debt above 10% APR, keeps extra cash in an index fund and 12-month CDs. |
| Hard | The Investor | Pays off debt above 7% APR, sells stocks or borrows to fund strong deals, trims a pricey lifestyle, invests spare cash in dividend stocks. |

In all-bot test games, Hard wins about two-thirds of three-way races against Normal and Easy. If every person
has finished, you can let the bots race for the remaining places or end the game.

**Winning:** passive income (dividends + rental cashflow + business profit + interest, including CD interest paid out monthly) ≥ 2× total monthly
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
  personal, medical, buy-now-pay-later and boat loans. Everyone starts out renting.
- **Student loans by degree**: every job that needs a college degree (teacher, nurse, accountant, engineer,
  software engineer, data scientist…) starts with about $22k–$38k of student loans. Graduate school multiplies it —
  lawyers 3×, pharmacists 3.5×, dentists 4×, and doctors (about 6 more years of school and training) 5×. Other jobs
  sometimes carry a smaller loan from some college.
- **Trading between players** (2+ players): in the Trade tab, offer any mix of rentals, land, businesses, startup
  stakes, lending notes, collectibles, shares and cash for any of another player's, at whatever price you agree on.
  Loans on an asset go with it. People accept or decline on the shared device; bots answer instantly and only accept
  trades that leave them better off (3 offers per bot per turn).
- **A bank** that lends as long as the payment fits your cashflow.
- **CDs (certificates of deposit)**: in the Savings & CDs tab, three fictional banks (an online bank, a credit union and a
  big branch bank) quote rates for 3-month to 5-year CDs, plus occasional higher-rate specials. Rates track the central bank
  rate, change every month and follow a yield curve that slopes up when rates are low and inverts when they're high.
  Take interest monthly (passive income) or let it compound; cashing out early costs 3–12 months of interest.
- **Options & short selling**: calls, puts and straddles (1-, 3- and 6-month expiries, 100 shares per contract) priced with
  Black–Scholes from each stock's live volatility, with a bid/ask spread and a payoff chart; short sales with a 50% margin deposit,
  monthly borrow fees and dividends owed, and automatic margin calls.
- **Your home**: every home and rental has its own neighborhood value on top of the regional housing market, plus local news
  that moves it. Everyone starts as a renter and can buy from three listings each turn (5–20% down, 3% closing costs, 43% debt-to-income limit).
- **Relationships**: everyone starts single. Dating costs money each month; a spouse splits household bills (a couple's household
  costs about 1.5× a single person's), children's costs are shared, and divorce costs legal fees plus half your cash and stocks.
- **Networking**: conferences (one-time, ~12 months of benefit) and clubs (joining fee + monthly dues, cancel any time).

## The learning side

- **Money lessons** on every event, deal and market headline.
- **Deal analyzer**: cash-on-cash return, cap rate, the 1% rule, debt-service coverage, loan-to-value,
  payback period and a verdict — each with a plain-English tooltip — plus how the deal would move your freedom meter.
- **Debt tab**: interest charged this month, months to payoff, interest left to pay, avalanche vs. snowball,
  and how extra payments shorten a loan.
- **Financials tab**: your personal income statement (every rental, business, dividend, note and CD; every expense,
  with each debt payment split into interest and principal), balance sheet, key ratios (savings rate, debt-to-income,
  housing cost, emergency fund) and income vs. expenses over time.
- **Money coach**: tips based on *your* numbers (expensive debt, emergency fund, concentration risk, idle cash…).
- **Learn tab**: 25 core ideas (compound growth, leverage, volatility, diversification, bonds and rates, CDs,
  fear & greed, financial statements…) with your own numbers plugged in, each linking to the
  **in-depth guide** (`learn.html`): step-by-step lessons, worked examples, debt/compound-growth/CD calculators
  and a searchable glossary. It opens in a new tab so the game stays put.
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

**Fear & Greed.** A 0–100 investor-mood index (top bar and Stocks tab) rises with prices and exciting news and falls
after drops, crashes and scary headlines. Greed gives stocks an extra push up (crypto and speculative stocks most),
calms volatility and makes bubbles and crashes more likely; fear pushes stocks down, sends money to bonds and gold, and
makes swings bigger. Moves driven purely by mood unwind over the following months, so long-run returns are unchanged and,
as in real markets, the year after extreme fear has tended to beat the year after extreme greed.

## Deploying it

The game runs entirely in the browser; a server only has to hand out `index.html`, `learn.html`, `css/` and `js/`.
`wsgi.py` is a standard [WSGI](https://peps.python.org/pep-3333/) app for doing that from any Python host.
It uses only the Python standard library, and it serves nothing else (not the server code, tests, or `.git`).
Each player's saved game stays in their own browser, so the server keeps no data and needs no database.

| Host | How |
|---|---|
| **gunicorn** (Linux/macOS) | `pip install gunicorn`, then `gunicorn -b 0.0.0.0:8080 wsgi:application` |
| **waitress** (Windows or anywhere) | `pip install waitress`, then `waitress-serve --port=8080 wsgi:application` |
| **Render / Heroku / Railway** | Put `gunicorn` in a `requirements.txt` and use the start command (or `Procfile` line) `web: gunicorn -b 0.0.0.0:$PORT wsgi:application` |
| **PythonAnywhere** | In the Web tab's WSGI file: `import sys; sys.path.insert(0, '/home/<you>/money-making-simulator'); from wsgi import application` |
| **Apache mod_wsgi** | `WSGIScriptAlias /game /path/to/money-making-simulator/wsgi.py` |

- **Health check:** `GET /healthz` answers `200 ok`, for load balancers and uptime monitors.
- **Under a path:** it works mounted under a prefix like `/game`, which redirects to `/game/`.
- **Caching:** files are sent with `Cache-Control: no-cache` plus an `ETag`. Browsers check back cheaply (a `304`) on each load,
  so players get the new version right after a deploy.
- **HTTPS:** let the host or a reverse proxy (nginx, Caddy, the platform's load balancer) handle it.

## Project layout

```
index.html          the page (plain <script> tags, so it works straight from disk)
learn.html          the in-depth money guide (lessons, calculators, glossary), linked from the Learn tab
css/styles.css      styles (dark theme, colorblind-safe player colors)
js/rng.js           seeded random numbers (same seed → same game)
js/data.js          jobs, lifestyles, securities, news, events and deal templates
js/core.js          finance math, player generation, income/expenses, financial statement, payday
js/market.js        stock market, economy cycle, interest rates, Fear & Greed mood, statistics
js/savings.js       CDs: monthly rate board, opening, interest, maturity, early-withdrawal penalties
js/options.js       options pricing (Black–Scholes), option & short positions, settlement, margin calls
js/deals.js         deal generation, buying/selling, deal analysis, buying/selling your own home
js/trade.js         trades between players: valuing, checking and carrying out offers
js/events.js        random events, raises, networking, relationships, charity, offers, lessons
js/ai.js            computer opponents (easy / normal / hard)
js/engine.js        game setup, turn flow, bot turns, player actions, money coach, save/load
js/ui.js            rendering and input
server.js           optional zero-dependency local web server
wsgi.py             WSGI entry point for deploying on a Python host (standard library only)
tests/              node --test suite, plus tests/test_wsgi.py (python3 -m unittest)
scripts/simulate.js balance simulator
```

All companies, people and events are fictional. This is an educational game, not financial advice.
