/*
 * ai.js — Computer opponents. A bot plays its turn through the same engine
 * actions a person uses, so it follows exactly the same rules.
 *
 * Three difficulty levels, each a recognizable money personality:
 *   easy   — "The Spender": thin savings, pays minimums, chases hot tips and
 *            panic-sells, finances a big wedding. Rarely buys deals.
 *   normal — "The Steady Saver": buys deals with solid cashflow, kills
 *            high-interest debt, parks extra cash in an index fund.
 *   hard   — "The Investor": pays off anything above 7% APR, sells stocks or
 *            borrows to fund strong deals, trims a pricey lifestyle, and invests
 *            spare cash in dividend payers so idle money earns passive income.
 *
 * A bot's own coin flips use its own seeded stream (p.bot.rngState), so games
 * stay reproducible from the seed without bots disturbing the market's dice.
 */
(function (global) {
  'use strict';
  const MMS = global.MMS || (global.MMS = {});
  const C = () => MMS.Core;
  const E = () => MMS.Engine;

  const LEVELS = {
    easy: {
      label: 'Easy', name: 'The Spender',
      desc: 'Spends freely, carries credit-card debt, chases hot tips and rarely buys deals.',
      reserveMonths: 0.5, dealRoi: 0.3, dealChance: 0.4, borrow: false, sellForDeals: false,
      payDebtApr: Infinity, invest: 'speculate', creditLuxury: 0.6, donate: 0.4, conference: 0.3,
      club: true, dateChance: 1, wedding: 'finance', maxKids: 3
    },
    normal: {
      label: 'Normal', name: 'The Steady Saver',
      desc: 'Buys deals with solid cashflow, pays off high-interest debt and keeps extra cash in an index fund.',
      reserveMonths: 1, dealRoi: 0.15, dealChance: 1, borrow: true, sellForDeals: false,
      payDebtApr: 10, invest: 'index', creditLuxury: 0, donate: 1, conference: 1,
      club: false, dateChance: 0.9, wedding: 'simple', maxKids: 2
    },
    hard: {
      label: 'Hard', name: 'The Investor',
      desc: 'Kills debt, sells stocks or borrows for strong deals, trims a pricey lifestyle and invests spare cash for income.',
      reserveMonths: 0.5, dealRoi: 0.1, dealChance: 1, borrow: true, sellForDeals: true,
      payDebtApr: 7, invest: 'income', creditLuxury: 0, donate: 1, conference: 1,
      club: 'smart', dateChance: 0.75, wedding: 'simple', maxKids: 2, downshiftTo: 1
    }
  };
  const LEVEL_IDS = Object.keys(LEVELS);

  const BOT_NAMES = ['Ada Ledger', 'Max Margin', 'Penny Wise', 'Bea Bullish', 'Rex Return', 'Ivy Index', 'Cash Cogsworth', 'Dot Dividend', 'Barry Bond', 'Sunny Savings'];
  const SPECULATIVE = ['kryx', 'penny', 'nrlx', 'volt'];
  const INCOME_MIX = [['keyr', 0.35], ['tbnd', 0.25], ['hlio', 0.2], ['frsh', 0.2]];

  const level = (p) => LEVELS[(p.bot && p.bot.level) || 'normal'] || LEVELS.normal;
  const isBot = (p) => !!(p && p.bot);

  /** Make the bot settings stored on a player. */
  function makeBot(levelId, seed) {
    const id = LEVELS[levelId] ? levelId : 'normal';
    return { level: id, rngState: MMS.RNG.seedFromString(`bot:${id}:${seed}`) };
  }

  /** Play the current bot's turn (cards, trades, debt). Returns a list of notable actions. */
  function playTurn(state) {
    const p = C().currentPlayer(state);
    const L = level(p);
    const rng = MMS.RNG.makeRng(p.bot);
    const did = [];
    const act = (r, text, tone) => { if (r && r.ok) did.push({ text, tone: tone || 'neutral' }); return r && r.ok; };
    const s = () => C().summarize(state, p);
    const reserve = () => Math.max(1000, s().expenses * L.reserveMonths);

    // ---- 1. Decide every card
    for (const c of state.turn.cards) {
      if (state.pendingWin) break;
      if (c.resolved) { c.seen = true; continue; }
      const choice = decide(state, p, c, L, rng, reserve, did);
      if (choice == null) continue;
      const r = E().resolveCard(state, c.id, choice);
      if (!r.ok && c.type === 'expense') E().resolveCard(state, c.id, 'credit');
    }
    if (state.pendingWin) return did;

    // ---- 2. Pay off expensive debt
    for (const d of p.debts.slice().sort((a, b) => b.apr - a.apr)) {
      if (d.apr < L.payDebtApr) break;
      const spare = p.cash - reserve() * 1.5;
      if (spare < 100) break;
      const amt = Math.min(d.balance, Math.floor(spare));
      const paidOff = amt >= d.balance - 0.005;
      if (act(E().payDebt(state, d.id, amt), paidOff ? `Paid off ${d.name}` : `Paid ${C().money(amt)} toward ${d.name}`, 'good')) {
        if (state.pendingWin) return did;
      }
    }

    // ---- 3. The investor trims a comfortable-or-better lifestyle once it has cash to spare
    if (L.downshiftTo != null && p.lifestyle > L.downshiftTo) {
      const info = E().downshiftInfo(state, p);
      if (!info.reason && p.cash > info.cost + reserve() * 2) {
        if (act(E().downshift(state), `Downshifted to a ${info.next.name.toLowerCase()} lifestyle (−${C().money(info.savings)}/mo)`, 'good') && state.pendingWin) return did;
      }
    }

    // ---- 4. Invest what's left
    invest(state, p, L, rng, reserve, act);
    return did;
  }

  /** How much a deal should be worth to this bot. Returns true to buy. */
  function wantsDeal(state, p, d, L, rng) {
    const liquid = p.cash + stockValue(state, p);
    if (!rng.chance(L.dealChance)) return false;
    if (d.cat === 'realestate') return !d.land && d.cashflow > 0 && d.roi >= L.dealRoi;
    if (d.cat === 'business' && d.kind === 'business') return d.roi != null ? d.roi >= L.dealRoi + 0.03 : d.cash < liquid * 0.25;
    if (d.cat === 'business' && d.kind === 'side') return d.cash < liquid * (L === LEVELS.easy ? 0.3 : 0.1);
    if (d.cat === 'lending') return d.rate >= 7 && d.cash < liquid * 0.35;
    if (d.cat === 'startup') return d.cash < liquid * (L === LEVELS.easy ? 0.25 : 0.06);
    if (d.cat === 'collectible') return L === LEVELS.easy && d.cash < p.cash * 0.2;
    return false;
  }

  /** Raise cash for a deal: sell stocks first (hard), then borrow if the deal clearly beats the loan rate. */
  function fund(state, p, d, L, reserve, did) {
    let need = d.cash + reserve() - p.cash;
    if (need <= 0) return true;
    if (L.sellForDeals) {
      const held = Object.keys(p.holdings).map((id) => state.market.securities[id]).filter(Boolean)
        .sort((a, b) => (a.div / a.price) - (b.div / b.price));
      for (const sec of held) {
        if (need <= 0) break;
        const h = p.holdings[sec.id];
        const shares = Math.min(h.shares, Math.ceil(need / sec.price));
        const r = E().sellStock(state, sec.id, shares);
        if (r.ok) { did.push({ text: `Sold ${shares.toLocaleString('en-US')} ${sec.ticker} to fund a deal`, tone: 'neutral' }); need -= shares * sec.price; }
      }
    }
    if (need > 0 && L.borrow && (d.roi == null || d.roi > C().bankRate(state) / 100 + 0.04)) {
      const amt = Math.ceil(need / 1000) * 1000;
      if (amt <= C().loanLimit(state, p)) {
        const r = E().borrow(state, amt);
        if (r.ok) { did.push({ text: `Borrowed ${C().money(amt)} from the bank`, tone: 'neutral' }); need -= amt; }
      }
    }
    return p.cash >= d.cash;
  }

  function stockValue(state, p) {
    let v = 0;
    for (const [id, h] of Object.entries(p.holdings)) v += h.shares * state.market.securities[id].price;
    return v;
  }

  function decide(state, p, c, L, rng, reserve, did) {
    const cash = p.cash;
    const d = c.data || {};
    switch (c.type) {
      case 'info': return 'ok';
      case 'expense':
        if (d.flavor === 'luxury' && rng.chance(L.creditLuxury)) return 'credit';
        return cash >= d.cost + (L === LEVELS.normal ? 500 : 0) ? 'cash' : 'credit';
      case 'charity':
        if (L === LEVELS.easy) return cash >= d.amount && rng.chance(L.donate) ? 'donate' : 'decline';
        return cash > (L === LEVELS.hard ? reserve() + d.amount : d.amount * 6) ? 'donate' : 'decline';
      case 'sidegig': return 'accept';
      case 'refi': return cash >= d.fee + reserve() ? 'accept' : 'decline';
      case 'propoffer': case 'bizoffer': return L === LEVELS.easy && !rng.chance(0.5) ? 'decline' : 'accept';
      case 'expand': return cash > d.cost + reserve() * 1.5 ? 'invest' : 'decline';
      case 'homeoffer': return 'decline';
      case 'conference':
        if (!C().isEmployed(p)) return 'decline';
        if (L === LEVELS.easy) return cash > d.cost && rng.chance(L.conference) ? 'attend' : 'decline';
        return cash > d.cost * (L === LEVELS.hard ? 3 : 5) + reserve() ? 'attend' : 'decline';
      case 'club':
        if (L.club === true) return cash > d.joinFee ? 'join' : 'decline';
        if (L.club === 'smart') return C().isEmployed(p) && cash > d.joinFee * 4 + reserve() && C().summarize(state, p).cashflow > d.dues * 5 ? 'join' : 'decline';
        return 'decline';
      case 'meet': return rng.chance(L.dateChance) ? 'date' : 'decline';
      case 'propose':
        if (L.wedding === 'finance') return cash >= (d.ring + d.wedding) * 1.2 ? 'cash' : 'finance';
        if (L === LEVELS.normal && cash > (d.ring + d.wedding) * 4) return 'cash';
        return 'simple';
      case 'baby': {
        if (p.children >= L.maxKids) return 'no';
        if (L === LEVELS.hard && C().summarize(state, p).cashflow < d.half * 3) return 'no';
        return 'yes';
      }
      case 'divorce': return 'counsel';
      case 'tip':
        if (L.invest === 'speculate' && !state.market.securities[d.sec].delisted) {
          const sec = state.market.securities[d.sec];
          const shares = Math.floor((cash - reserve()) * 0.3 / sec.price);
          if (shares >= 1 && E().buyStock(state, d.sec, shares).ok) did.push({ text: `Bet on a hot tip: bought ${shares.toLocaleString('en-US')} ${sec.ticker}`, tone: 'bad' });
        }
        return 'ignore';
      case 'deal': {
        const deal = c.deal;
        if (!wantsDeal(state, p, deal, L, rng)) return 'pass';
        if (!fund(state, p, deal, L, reserve, did)) return 'pass';
        const r = E().resolveCard(state, c.id, 'buy');
        if (r.ok) did.push({ text: `Bought ${deal.icon} ${deal.title} (${C().money(deal.cash)}${deal.cashflow != null ? `, ${C().money(deal.cashflow)}/mo` : ''})`, tone: 'good' });
        return r.ok ? null : 'pass';
      }
      default:
        return MMS.Events.defaultChoice(c, p);
    }
  }

  function invest(state, p, L, rng, reserve, act) {
    const secs = state.market.securities;
    const s = C().summarize(state, p);
    if (L.invest === 'speculate') {
      // Panic-sell big losers…
      for (const [id, h] of Object.entries(p.holdings)) {
        const sec = secs[id];
        if (h.shares * sec.price < h.costBasis * 0.75 && rng.chance(0.6)) {
          act(E().sellStock(state, id, h.shares), `Panic-sold ${sec.ticker} at a loss`, 'bad');
        }
      }
      // …and chase something exciting now and then.
      if (rng.chance(0.15)) {
        const sec = secs[rng.pick(SPECULATIVE)];
        const shares = Math.floor((p.cash - reserve()) * 0.25 / sec.price);
        if (sec && !sec.delisted && shares >= 1) act(E().buyStock(state, sec.id, shares), `Bought ${shares.toLocaleString('en-US')} ${sec.ticker} hoping for a quick win`, 'bad');
      }
      return;
    }
    if (L.invest === 'index') {
      const spare = p.cash - Math.max(3000, s.expenses * 6);
      const sec = secs.idx;
      const shares = Math.floor(spare * 0.5 / sec.price);
      if (shares >= 1) act(E().buyStock(state, 'idx', shares), `Invested ${C().money(shares * sec.price)} in ${sec.ticker}`, 'good');
      return;
    }
    // income: keep ~3 months of expenses, invest the rest in dividend payers.
    const spare = p.cash - Math.max(2500, s.expenses * 2);
    if (spare < 1000) return;
    let spent = 0;
    for (const [id, w] of INCOME_MIX) {
      const sec = secs[id];
      if (!sec || sec.delisted) continue;
      const shares = Math.floor(spare * 0.8 * w / sec.price);
      if (shares >= 1 && E().buyStock(state, id, shares).ok) spent += shares * sec.price;
      if (state.pendingWin) break;
    }
    if (spent) act({ ok: true }, `Invested ${C().money(spent)} in dividend stocks`, 'good');
  }

  // ------------------------------------------------------------------ trade offers from other players
  /** Extra value a bot wants to come out ahead by before it agrees to a trade. */
  const TRADE_EDGE = { easy: -0.05, normal: 0.05, hard: 0.1 };

  /**
   * What an asset is worth to this bot: its equity (value minus any loan that comes with it).
   * Every bot marks down an asset that loses money by a year of its losses. The investor also
   * values steady passive income at no less than three years of it — that income is how it wins.
   */
  function tradeWorth(it, L) {
    let w = it.equity;
    if (it.cashflow < 0) w += it.cashflow * 12;
    else if (L === LEVELS.hard) w = Math.max(w, it.cashflow * 36);
    return w;
  }

  /**
   * Decide on a trade another player offered. `v` is the trade from this bot's side:
   * { gives, gets } as built by MMS.Trade.perspective. Returns { accept, reason }.
   */
  function considerTrade(state, p, v) {
    const L = level(p);
    const rng = MMS.RNG.makeRng(p.bot);
    const worth = (side) => side.cash + side.items.reduce((t, it) => t + tradeWorth(it, L), 0);
    const give = worth(v.gives), get = worth(v.gets);
    const cashAfter = p.cash - v.gives.cash + v.gets.cash;
    const reserve = Math.max(1000, C().summarize(state, p).expenses * L.reserveMonths);
    if (v.gives.cash > 0 && cashAfter < reserve) return { accept: false, reason: 'I can\'t spare that much cash right now.' };
    const cfAfter = C().summarize(state, p).cashflow + v.gets.cashflow - v.gives.cashflow;
    if (cfAfter < 0 && L !== LEVELS.easy) return { accept: false, reason: 'That would leave me losing money every month.' };
    const edge = TRADE_EDGE[p.bot.level] != null ? TRADE_EDGE[p.bot.level] : TRADE_EDGE.normal;
    const need = give * (1 + edge) + (give > 0 && L !== LEVELS.easy ? 250 : 0);
    if (get >= need) return { accept: true, reason: 'Deal!' };
    // The spender sometimes takes a slightly bad deal anyway.
    if (L === LEVELS.easy && get >= give * 0.85 && rng.chance(0.4)) return { accept: true, reason: 'Eh, why not!' };
    const short = Math.max(0, need - get);
    return { accept: false, reason: short < 2000 ? 'Close, but not quite worth it to me.' : 'That\'s not worth it to me.' };
  }

  MMS.AI = { LEVELS, LEVEL_IDS, BOT_NAMES, isBot, makeBot, playTurn, considerTrade, tradeWorth };
  if (typeof module !== 'undefined' && module.exports) module.exports = MMS.AI;
})(typeof window !== 'undefined' ? window : globalThis);
