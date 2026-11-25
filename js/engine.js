/*
 * engine.js — Game setup, turn flow and every action a player can take.
 * The UI calls these functions; they mutate the plain-JSON game state and
 * return { ok, msg } results. Safe to run in Node for tests and simulations.
 */
(function (global) {
  'use strict';
  if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
    require('./rng.js'); require('./data.js'); require('./core.js');
    require('./market.js'); require('./deals.js'); require('./events.js');
  }
  const MMS = global.MMS || (global.MMS = {});
  const C = MMS.Core, D = MMS.Data, RNG = MMS.RNG;

  const SAVE_VERSION = 1;
  const fail = (msg) => ({ ok: false, msg });

  // ------------------------------------------------------------------ setup
  /**
   * config: { players: [{ name, emoji, color }], seed?, timeLimit?, handoff?, freedomMultiple? }
   */
  function createGame(config) {
    const players = (config.players || []).filter(Boolean);
    if (players.length < 1) throw new Error('At least one player is required.');
    const seed = String(config.seed || '').trim() || `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    const state = {
      version: SAVE_VERSION,
      seed,
      rngState: RNG.seedFromString(seed),
      nextId: 0,
      settings: {
        timeLimit: Number(config.timeLimit) || 0,
        handoff: config.handoff !== false,
        freedomMultiple: Number(config.freedomMultiple) || 2
      },
      round: 1,
      currentIndex: 0,
      phase: 'handoff',
      players: [],
      market: null,
      turn: null,
      news: [],
      log: [],
      winners: [],
      pendingWin: null,
      endReason: null,
      createdAt: Date.now()
    };
    const rng = RNG.makeRng(state);
    MMS.Market.initMarket(state, rng);
    const jobs = rng.shuffle(D.JOBS);
    players.forEach((cfg, i) => {
      const p = C.createPlayer(state, rng, {
        name: String(cfg.name || `Player ${i + 1}`).slice(0, 24),
        emoji: cfg.emoji || D.AVATARS[i % D.AVATARS.length],
        color: cfg.color || D.COLORS[i % D.COLORS.length]
      }, jobs[i % jobs.length]);
      state.players.push(p);
    });
    state.round = 0;
    for (const p of state.players) p.history.push(C.snapshot(state, p));
    state.round = 1;
    state.news = [{ text: '🏁 Month 1 begins. Prices update at the end of every month, after each player has had a turn.', tone: 'neutral', lesson: '' }];
    C.log(state, `A new game begins with ${players.length} player${players.length > 1 ? 's' : ''}.`, 'neutral');
    return state;
  }

  // ------------------------------------------------------------------ helpers
  const current = (state) => C.currentPlayer(state);
  const activePlayers = (state) => state.players.filter((p) => !p.finished);

  function requireTurn(state) {
    if (state.phase !== 'turn') return fail('It is not time to act right now.');
    return null;
  }

  function checkFreedom(state) {
    if (state.phase !== 'turn') return false;
    const p = current(state);
    if (!p.finished && C.summarize(state, p).free) {
      state.pendingWin = p.id;
      return true;
    }
    state.pendingWin = null;
    return false;
  }

  function done(state, r) {
    if (r && r.ok) checkFreedom(state);
    return r;
  }

  // ------------------------------------------------------------------ turn flow
  /** Start the current player's turn: payday, then this turn's random events and deals. */
  function beginTurn(state) {
    if (state.phase !== 'handoff') return fail('A turn is already in progress.');
    const p = current(state);
    const rng = RNG.makeRng(state);
    const payday = C.payday(state, p, rng);
    state.turn = { round: state.round, playerId: p.id, payday, cards: [] };
    MMS.Events.generate(state, p, rng);
    state.phase = 'turn';
    checkFreedom(state);
    return { ok: true };
  }

  function findCard(state, cardId) {
    return state.turn && state.turn.cards.find((c) => c.id === cardId);
  }

  function resolveCard(state, cardId, choice) {
    const bad = requireTurn(state); if (bad) return bad;
    const c = findCard(state, cardId);
    if (!c) return fail('That card is gone.');
    if (c.type === 'info') { c.seen = true; return { ok: true }; }
    if (c.resolved) { c.seen = true; return fail('Already decided.'); }
    const p = current(state);
    const r = MMS.Events.resolve(state, p, c, choice);
    if (!r.ok) return r;
    c.seen = true;
    if (!r.later) c.resolved = true;
    return done(state, r);
  }

  /** Mark a card as viewed without deciding (deals can wait until the end of the turn). */
  function markSeen(state, cardId) {
    const c = findCard(state, cardId);
    if (c) c.seen = true;
  }

  function canEndTurn(state) {
    if (state.phase !== 'turn') return fail('No turn in progress.');
    const open = state.turn.cards.find((c) => c.required && !c.resolved);
    if (open) return fail(`First decide how to pay for "${open.title}".`);
    return { ok: true };
  }

  function nextActiveIndex(state, from) {
    const n = state.players.length;
    for (let k = 1; k <= n; k++) {
      const i = (from + k) % n;
      if (!state.players[i].finished) return { index: i, wrapped: from + k >= n };
    }
    return null;
  }

  function advanceRound(state) {
    const rng = RNG.makeRng(state);
    state.round++;
    const headlines = MMS.Market.update(state, rng);
    state.news = headlines;
    for (const h of headlines) C.log(state, h.text, h.tone);
    if (state.settings.timeLimit && state.round > state.settings.timeLimit) {
      state.round = state.settings.timeLimit;
      state.phase = 'gameover';
      state.endReason = 'time';
      C.log(state, '⏰ Time is up! The game is over.', 'neutral');
    }
  }

  /** End the turn. With { force: true }, open cards are settled with their default choice. */
  function endTurn(state, opts) {
    opts = opts || {};
    if (state.phase !== 'turn') return fail('No turn in progress.');
    const p = current(state);
    for (const c of state.turn.cards) {
      if (c.resolved) continue;
      if (c.required && !opts.force) return canEndTurn(state);
      const choice = MMS.Events.defaultChoice(c, p);
      const r = MMS.Events.resolve(state, p, c, choice);
      if (!r.ok && c.type === 'expense') MMS.Events.resolve(state, p, c, 'credit');
      if (!c.outcome) c.outcome = c.kind === 'deal' ? 'Passed' : 'Declined';
      c.resolved = true;
      c.seen = true;
    }
    p.stats.turns++;
    state.lastPlayerId = p.id;
    p.history.push(C.snapshot(state, p));
    if (p.history.length > 400) p.history.shift();
    state.pendingWin = null;

    const nxt = nextActiveIndex(state, state.currentIndex);
    if (!nxt) {
      state.phase = 'gameover';
      state.endReason = state.endReason || 'freedom';
      return { ok: true };
    }
    if (nxt.wrapped) advanceRound(state);
    state.turn = null;
    if (state.phase === 'gameover') return { ok: true };
    state.currentIndex = nxt.index;
    state.phase = 'handoff';
    return { ok: true };
  }

  /** The current player quits their job: they have achieved financial freedom. */
  function claimFreedom(state) {
    const p = C.getPlayer(state, state.pendingWin);
    if (!p || p.finished) return fail('No one has reached financial freedom yet.');
    p.finished = true;
    p.retired = true;
    p.place = state.winners.length + 1;
    state.winners.push({ id: p.id, round: state.round, place: p.place });
    state.pendingWin = null;
    C.log(state, `🏆 ${p.name} achieved FINANCIAL FREEDOM in month ${state.round} and quit their job!`, 'good', p.id);
    if (activePlayers(state).length >= 1 && state.players.length > 1) {
      state.phase = 'victory';
    } else {
      state.phase = 'gameover';
      state.endReason = 'freedom';
    }
    return { ok: true };
  }

  /** After a win, let the remaining players keep racing for the next places. */
  function continueGame(state) {
    if (state.phase !== 'victory') return fail('Nothing to continue.');
    state.phase = 'turn';
    return endTurn(state, { force: true });
  }

  function standings(state) {
    const rows = state.players.map((p) => ({ p, s: C.summarize(state, p) }));
    rows.sort((a, b) => {
      if (a.p.place && b.p.place) return a.p.place - b.p.place;
      if (a.p.place) return -1;
      if (b.p.place) return 1;
      return (b.s.progress - a.s.progress) || (b.s.netWorth - a.s.netWorth);
    });
    return rows;
  }

  // ------------------------------------------------------------------ stock market
  function buyStock(state, secId, shares) {
    const bad = requireTurn(state); if (bad) return bad;
    const p = current(state);
    const s = state.market.securities[secId];
    shares = Math.floor(Number(shares));
    if (!s) return fail('Unknown security.');
    if (!(shares >= 1)) return fail('Enter how many shares to buy.');
    const cost = C.cents(shares * s.price);
    if (cost > p.cash + 0.001) return fail(`${shares.toLocaleString('en-US')} shares cost ${C.money(cost)}, but you have ${C.money(p.cash)}. You can afford ${Math.floor(p.cash / s.price).toLocaleString('en-US')}.`);
    p.cash = C.cents(p.cash - cost);
    const h = p.holdings[secId] || (p.holdings[secId] = { shares: 0, costBasis: 0 });
    h.shares += shares;
    h.costBasis = C.cents(h.costBasis + cost);
    C.log(state, `${p.name} bought ${shares.toLocaleString('en-US')} ${s.ticker} @ $${s.price.toFixed(2)}.`, 'neutral', p.id);
    const divAmt = shares * s.div;
    const divTxt = s.div > 0 ? ` It adds about ${divAmt < 10 ? `$${divAmt.toFixed(2)}` : C.money(divAmt)}/mo in dividends.` : '';
    return done(state, { ok: true, msg: `Bought ${shares.toLocaleString('en-US')} ${s.ticker} for ${C.money(cost)}.${divTxt}` });
  }

  function sellStock(state, secId, shares) {
    const bad = requireTurn(state); if (bad) return bad;
    const p = current(state);
    const s = state.market.securities[secId];
    const h = p.holdings[secId];
    shares = Math.floor(Number(shares));
    if (!s) return fail('Unknown security.');
    if (!h || h.shares <= 0) return fail(`You don't own any ${s.ticker}.`);
    if (!(shares >= 1)) return fail('Enter how many shares to sell.');
    if (shares > h.shares) return fail(`You only own ${h.shares.toLocaleString('en-US')} shares.`);
    const proceeds = C.cents(shares * s.price);
    const basis = C.cents(h.costBasis * shares / h.shares);
    const gain = proceeds - basis;
    h.shares -= shares;
    h.costBasis = C.cents(h.costBasis - basis);
    if (h.shares === 0) delete p.holdings[secId];
    p.cash = C.cents(p.cash + proceeds);
    p.stats.realizedGains += gain;
    C.log(state, `${p.name} sold ${shares.toLocaleString('en-US')} ${s.ticker} @ $${s.price.toFixed(2)}.`, 'neutral', p.id);
    return done(state, { ok: true, msg: `Sold ${shares.toLocaleString('en-US')} ${s.ticker} for ${C.money(proceeds)} — ${gain >= 0 ? 'a profit' : 'a loss'} of ${C.money(Math.abs(gain))}.` });
  }

  // ------------------------------------------------------------------ debts & bank
  function interestLeft(balance, apr, payment) {
    const n = C.monthsToPayoff(balance, apr, payment);
    return Number.isFinite(n) ? Math.max(0, payment * n - balance) : Infinity;
  }

  function payLoan(state, p, loan, amount, label, onPaidOff) {
    amount = C.cents(Math.min(Number(amount) || 0, loan.balance, p.cash));
    if (!(amount > 0)) return fail(p.cash <= 0 ? 'You have no cash to pay with.' : 'Enter an amount to pay.');
    const beforeMonths = C.monthsToPayoff(loan.balance, loan.apr, loan.payment);
    const beforeInterest = interestLeft(loan.balance, loan.apr, loan.payment);
    p.cash = C.cents(p.cash - amount);
    loan.balance = C.cents(loan.balance - amount);
    if (loan.balance < 0.5) {
      const freed = loan.payment;
      onPaidOff();
      C.log(state, `${p.name} paid off ${label}.`, 'good', p.id);
      return { ok: true, msg: `🎉 ${label} is paid off! That frees up ${C.money(freed)} every month.` };
    }
    if (loan.revolving) {
      const old = loan.payment;
      loan.payment = C.revolvingPayment(loan);
      return { ok: true, msg: `Paid ${C.money(amount)}. Your minimum payment drops from ${C.money(old)} to ${C.money(loan.payment)}/mo.` };
    }
    const afterMonths = C.monthsToPayoff(loan.balance, loan.apr, loan.payment);
    const saved = beforeInterest - interestLeft(loan.balance, loan.apr, loan.payment);
    const sooner = Number.isFinite(beforeMonths) ? beforeMonths - afterMonths : 0;
    return {
      ok: true,
      msg: `Paid ${C.money(amount)}. The payment stays ${C.money(loan.payment)}/mo, but you'll be done ${sooner} month${sooner === 1 ? '' : 's'} sooner and save about ${C.money(Number.isFinite(saved) ? saved : 0)} in interest.`
    };
  }

  function payDebt(state, debtId, amount) {
    const bad = requireTurn(state); if (bad) return bad;
    const p = current(state);
    const d = p.debts.find((x) => x.id === debtId);
    if (!d) return fail('That debt no longer exists.');
    return done(state, payLoan(state, p, d, amount, `your ${d.name}`, () => { p.debts = p.debts.filter((x) => x !== d); }));
  }

  /** Pay down a rental mortgage or a business loan (raises that asset's cashflow once paid off). */
  function payAssetLoan(state, kind, id, amount) {
    const bad = requireTurn(state); if (bad) return bad;
    const p = current(state);
    if (kind === 'property') {
      const prop = p.properties.find((x) => x.id === id);
      if (!prop || !prop.mortgage) return fail('No mortgage to pay.');
      return done(state, payLoan(state, p, prop.mortgage, amount, `the mortgage on ${prop.name}`, () => { prop.mortgage = null; }));
    }
    const b = p.businesses.find((x) => x.id === id);
    if (!b || !b.loan) return fail('No loan to pay.');
    return done(state, payLoan(state, p, b.loan, amount, `the loan on ${b.name}`, () => { b.loan = null; }));
  }

  function borrow(state, amount) {
    const bad = requireTurn(state); if (bad) return bad;
    const p = current(state);
    amount = Math.floor((Number(amount) || 0) / 1000) * 1000;
    const limit = C.loanLimit(state, p);
    if (amount < 1000) return fail('Borrow in multiples of $1,000.');
    if (amount > limit) return fail(limit > 0 ? `The bank will lend you up to ${C.money(limit)} right now.` : 'The bank won\'t lend to you right now — your monthly cashflow is too low.');
    const apr = C.bankRate(state);
    const addPay = Math.round(C.amortPayment(amount, apr, 60));
    let d = p.debts.find((x) => x.type === 'bank');
    if (d) {
      d.apr = Math.round(((d.apr * d.balance + apr * amount) / (d.balance + amount)) * 100) / 100;
      d.balance = C.cents(d.balance + amount);
      d.payment += addPay;
    } else {
      d = C.addDebt(state, p, { type: 'bank', name: 'Bank loan', balance: amount, apr, termMonths: 60 });
    }
    p.cash = C.cents(p.cash + amount);
    C.log(state, `${p.name} borrowed ${C.money(amount)} from the bank.`, 'neutral', p.id);
    return done(state, { ok: true, msg: `Borrowed ${C.money(amount)} at ${apr.toFixed(2)}% APR. Your payments rise by ${C.money(addPay)}/mo for 5 years — that also raises your freedom target by ${C.money(addPay * state.settings.freedomMultiple)}/mo.` });
  }

  // ------------------------------------------------------------------ assets
  function sellAsset(state, kind, id) {
    const bad = requireTurn(state); if (bad) return bad;
    const p = current(state);
    if (kind === 'property') {
      const prop = p.properties.find((x) => x.id === id);
      if (!prop) return fail('Property not found.');
      if (prop.rehabLeft > 0) return fail('Finish the renovation before selling.');
      return done(state, MMS.Deals.sellProperty(state, p, prop));
    }
    if (kind === 'business') {
      const b = p.businesses.find((x) => x.id === id);
      if (!b) return fail('Business not found.');
      return done(state, MMS.Deals.sellBusiness(state, p, b));
    }
    if (kind === 'collectible') {
      const item = p.collectibles.find((x) => x.id === id);
      if (!item) return fail('Item not found.');
      return done(state, MMS.Deals.sellCollectible(state, p, item));
    }
    if (kind === 'note') {
      const n = p.notes.find((x) => x.id === id);
      if (!n) return fail('Note not found.');
      return done(state, MMS.Deals.sellNote(state, p, n));
    }
    return fail('Unknown asset.');
  }

  // ------------------------------------------------------------------ lifestyle
  const DOWNSHIFT_COOLDOWN = 6;
  const DOWNSHIFT_FACTOR = 0.85;

  function downshiftInfo(state, p) {
    const living = C.livingExpenses(p);
    const cost = C.roundTo(living * 0.5, 50);
    const savings = Math.round(living * (1 - DOWNSHIFT_FACTOR));
    const wait = DOWNSHIFT_COOLDOWN - (state.round - p.lastDownshift);
    let reason = null;
    if (p.lifestyle <= 0) reason = 'You are already living frugally.';
    else if (wait > 0) reason = `You moved recently. You can downshift again in ${wait} month${wait === 1 ? '' : 's'}.`;
    else if (p.cash < cost) reason = `Moving and selling stuff costs ${C.money(cost)} up front.`;
    return { cost, savings, reason, next: D.LIFESTYLES[Math.max(0, p.lifestyle - 1)] };
  }

  function downshift(state) {
    const bad = requireTurn(state); if (bad) return bad;
    const p = current(state);
    const info = downshiftInfo(state, p);
    if (info.reason) return fail(info.reason);
    p.cash = C.cents(p.cash - info.cost);
    for (const k in p.expenses) p.expenses[k] = C.roundTo(p.expenses[k] * DOWNSHIFT_FACTOR, 5);
    p.lifestyle--;
    p.lastDownshift = state.round;
    C.log(state, `${p.name} downshifted to a ${info.next.name} lifestyle.`, 'good', p.id);
    return done(state, { ok: true, msg: `You moved to a ${info.next.name.toLowerCase()} lifestyle. Living expenses drop by ~${C.money(info.savings)}/mo, and your freedom target drops by ~${C.money(info.savings * state.settings.freedomMultiple)}/mo.` });
  }

  // ------------------------------------------------------------------ money coach (educational)
  /** Personalized tips based on the player's actual finances. */
  function coachTips(state, p) {
    const s = C.summarize(state, p);
    const tips = [];
    const add = (priority, icon, text) => tips.push({ priority, icon, text });
    const monthsCash = s.expenses > 0 ? p.cash / s.expenses : 99;

    const worst = p.debts.slice().sort((a, b) => b.apr - a.apr)[0];
    if (worst && worst.apr >= 15 && p.cash > 200) {
      add(9, '💳', `Your ${worst.name} charges ${worst.apr.toFixed(1)}% interest (about ${C.money(worst.balance * worst.apr / 1200)} this month). Paying it off is a guaranteed ${worst.apr.toFixed(0)}% return — better than almost any investment.`);
    }
    if (!C.isEmployed(p) && !p.retired) {
      add(10, '🧯', 'No paycheck right now. Avoid big purchases; your cash and passive income are your safety net until you are re-hired.');
    } else if (monthsCash < 3 && s.expenses > 0) {
      add(7, '🛟', `You have ${monthsCash.toFixed(1)} months of expenses in cash. A 3–6 month emergency fund keeps surprise bills off high-interest credit cards.`);
    }
    const losers = [...p.properties.filter((x) => x.rehabLeft === 0 && C.propertyCashflow(x) < 0).map((x) => [x.name, C.propertyCashflow(x)]),
      ...p.businesses.filter((b) => b.kind !== 'startup' && b.rampLeft === 0 && C.businessCashflow(b) < 0).map((b) => [b.name, C.businessCashflow(b)])];
    if (losers.length) add(8, '🩸', `${losers[0][0]} is losing ${C.money(-losers[0][1])}/mo. Assets that cost you money each month work against financial freedom — consider selling.`);

    const sv = s.stocksValue;
    if (sv > 5000) {
      let top = null, topVal = 0;
      for (const id in p.holdings) {
        const v = p.holdings[id].shares * state.market.securities[id].price;
        if (v > topVal) { topVal = v; top = state.market.securities[id]; }
      }
      if (top && top.id !== 'idx' && topVal / sv > 0.6) add(6, '🧺', `${Math.round(topVal / sv * 100)}% of your stocks are in ${top.name}. Spreading money across many companies (like an index fund) lowers risk without giving up much return.`);
      const spec = (['kryx', 'penny', 'nrlx'].reduce((a, id) => a + (p.holdings[id] ? p.holdings[id].shares * state.market.securities[id].price : 0), 0));
      if (s.netWorth > 0 && spec / Math.max(1, s.assets) > 0.3) add(6, '🎢', 'Over 30% of your assets are in very volatile investments (crypto, AI, penny stocks). Great when they rise — painful when they fall.');
    }
    const gap = s.target - s.passive;
    if (gap > 0 && !p.finished) {
      add(4, '🎯', `You need ${C.money(gap)}/mo more passive income. At a 20% cash-on-cash return that takes about ${C.money(gap * 12 / 0.2)} invested — or less if you also cut expenses (each $1 cut lowers the target by $${state.settings.freedomMultiple}).`);
    }
    if (monthsCash > 12 && p.cash > 20000) {
      const bond = state.market.securities.tbnd;
      add(5, '💤', `${C.money(p.cash)} of cash is sitting idle and earning nothing. The bond fund yields ~${(MMS.Market.currentYield(bond) * 100).toFixed(1)}%/yr, or keep some ready for the next good deal.`);
    }
    const smallest = p.debts.filter((d) => !d.revolving || d.balance > 0).sort((a, b) => a.balance - b.balance)[0];
    if (smallest && smallest.balance <= p.cash && smallest.balance > 0) {
      add(5, '❄️', `You could pay off your ${smallest.name} (${C.money(smallest.balance)}) today. That cuts expenses by ${C.money(smallest.payment)}/mo and your freedom target by ${C.money(smallest.payment * state.settings.freedomMultiple)}/mo.`);
    }
    if (p.lifestyle >= 2 && s.progress < 0.4) {
      add(3, '🏡', 'A more modest lifestyle lowers your expenses AND your freedom target. Check "Downshift lifestyle" in the Debt & Budget tab.');
    }
    if (s.passive <= 0 && state.round > 3) {
      add(6, '🌱', 'You have no passive income yet. Even a small rental, a vending route or dividend stocks gets the snowball rolling.');
    }
    tips.sort((a, b) => b.priority - a.priority);
    return tips.slice(0, 4);
  }

  // ------------------------------------------------------------------ save / load
  function serialize(state) { return JSON.stringify(state); }

  function deserialize(json) {
    const s = typeof json === 'string' ? JSON.parse(json) : json;
    if (!s || s.version !== SAVE_VERSION || !Array.isArray(s.players) || !s.players.length || !s.market || !s.market.securities) {
      throw new Error('This does not look like a Money Making Simulator save file.');
    }
    return s;
  }

  MMS.Engine = {
    createGame, beginTurn, resolveCard, markSeen, canEndTurn, endTurn, claimFreedom, continueGame,
    buyStock, sellStock, payDebt, payAssetLoan, borrow, sellAsset, downshift, downshiftInfo,
    coachTips, standings, activePlayers, checkFreedom, serialize, deserialize, interestLeft
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = MMS;
})(typeof window !== 'undefined' ? window : globalThis);
