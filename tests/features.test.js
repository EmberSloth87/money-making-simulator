'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const MMS = require('../js/engine.js');
const { Engine: E, Core: C, RNG, Options: O, Deals, Events: EV } = MMS;

const newGame = (n, extra) => E.createGame(Object.assign({ players: Array.from({ length: n || 1 }, (_, i) => ({ name: `P${i + 1}` })), seed: 'feature-seed', handoff: false }, extra));
/** Start a turn with an empty card list so tests control exactly what happens. */
function quietTurn(s) {
  E.beginTurn(s);
  s.turn.cards = [];
  s.pendingWin = null;
  return C.currentPlayer(s);
}
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
const cardOf = (s, type) => s.turn.cards.find((c) => c.type === type);

// ------------------------------------------------------------------ market table
test('the 1-year return uses the last 12 monthly prices', () => {
  const s = newGame(1);
  const sec = s.market.securities.idx;
  const h = sec.history;
  assert.ok(near(MMS.Market.periodReturn(sec, 12), sec.price / h[h.length - 13] - 1, 1e-9));
});

// ------------------------------------------------------------------ options
test('Black–Scholes prices satisfy put–call parity', () => {
  const S = 100, K = 95, T = 0.25, sig = 0.3, r = 0.04, q = 0.01;
  const call = O.blackScholes('call', S, K, T, sig, r, q);
  const put = O.blackScholes('put', S, K, T, sig, r, q);
  assert.ok(near(call - put, S * Math.exp(-q * T) - K * Math.exp(-r * T), 1e-4));
  assert.ok(near(O.blackScholes('straddle', S, K, T, sig, r, q), call + put, 1e-9));
  assert.ok(O.blackScholes('call', S, K, 0.5, sig, r, q) > call, 'more time is worth more');
  assert.ok(O.blackScholes('call', S, K, T, 0.6, r, q) > call, 'more volatility is worth more');
});

test('a call that finishes in the money pays its intrinsic value at expiry', () => {
  const s = newGame(1);
  const p = quietTurn(s);
  p.cash = 1e6;
  const sec = s.market.securities.mega;
  const K = O.strikes(sec)[2];
  assert.equal(E.buyOption(s, 'mega', 'call', K, 1, 2).ok, true);
  const opt = p.options[0];
  assert.equal(opt.shares, 200);
  assert.equal(opt.expiresRound, s.round + 1);
  E.endTurn(s, { force: true });          // the month ends and prices move
  sec.price = K + 10;                     // pin the expiry price for the test
  const cashBefore = p.cash;
  E.beginTurn(s);
  assert.equal(p.options.length, 0, 'the option settled');
  const line = s.turn.payday.lines.find((l) => l.label === 'Options expiring');
  assert.ok(line && near(line.amount, 2000), 'paid (S − K) × 200 shares');
  assert.ok(s.turn.cards.some((c) => /Option expired/.test(c.title)), 'expiry is announced with a pop-up');
  assert.ok(p.cash > cashBefore - 1e5);
});

test('puts expire worthless above the strike; straddles pay on a move either way', () => {
  assert.equal(O.intrinsic('put', 110, 100), 0);
  assert.equal(O.intrinsic('put', 90, 100), 10);
  assert.equal(O.intrinsic('straddle', 90, 100), 10);
  assert.equal(O.intrinsic('straddle', 115, 100), 15);
});

test('options can be sold back early at the bid, and stale strikes are rejected', () => {
  const s = newGame(1);
  const p = quietTurn(s);
  p.cash = 50000;
  const sec = s.market.securities.idx;
  const K = O.strikes(sec)[2];
  assert.equal(E.buyOption(s, 'idx', 'put', K + 0.123, 3, 1).ok, false);
  assert.equal(E.buyOption(s, 'idx', 'straddle', K, 3, 1).ok, true);
  const o = p.options[0];
  const bid = O.optionBid(s, o);
  assert.ok(bid < o.cost, 'selling right away loses the bid/ask spread');
  const before = p.cash;
  assert.equal(E.sellOption(s, o.id).ok, true);
  assert.ok(near(p.cash, before + bid));
  assert.equal(p.options.length, 0);
});

test('stock splits adjust option strikes and short positions', () => {
  const s = newGame(1);
  const p = quietTurn(s);
  p.cash = 1e6;
  const sec = s.market.securities.mega;
  const K = O.strikes(sec)[2];
  E.buyOption(s, 'mega', 'call', K, 6, 1);
  E.shortSell(s, 'mega', 10);
  const valueBefore = O.optionValue(s, p.options[0]);
  O.applySplit(s, 'mega', 10);
  sec.price /= 10;
  sec.div /= 10;
  assert.equal(p.options[0].shares, 1000);
  assert.ok(near(p.options[0].strike, K / 10, 1e-6));
  assert.equal(p.shorts.mega.shares, 100);
  assert.ok(near(O.optionValue(s, p.options[0]), valueBefore, 1), 'a split does not change what the option is worth');
});

// ------------------------------------------------------------------ short selling
test('short selling: margin deposit, profit when the price falls', () => {
  const s = newGame(1);
  const p = quietTurn(s);
  p.cash = 10000;
  const sec = s.market.securities.frsh;
  sec.price = 40;
  assert.equal(E.shortSell(s, 'frsh', 1000).ok, false, 'needs a 50% margin deposit');
  assert.equal(E.shortSell(s, 'frsh', 100).ok, true);
  assert.ok(near(p.cash, 10000 - 2000));
  assert.ok(near(p.shorts.frsh.collateral, 6000));
  const nw = C.summarize(s, p).netWorth;
  sec.price = 30;
  assert.ok(near(C.summarize(s, p).netWorth - nw, 1000), 'a $10 fall on 100 shares is +$1,000');
  assert.equal(E.coverShort(s, 'frsh', 100).ok, true);
  assert.ok(near(p.cash, 11000));
  assert.equal(p.shorts.frsh, undefined);
});

test('a short that rises too far gets a margin call at payday', () => {
  const s = newGame(1);
  const p = quietTurn(s);
  p.cash = 10000;
  const sec = s.market.securities.kryx;
  sec.price = 100;
  E.shortSell(s, 'kryx', 50);
  E.endTurn(s, { force: true });
  sec.price = 130; // +30%: collateral (7,500) < 130% of 6,500
  E.beginTurn(s);
  assert.equal(p.shorts.kryx, undefined, 'position was force-closed');
  assert.ok(s.turn.cards.some((c) => /Margin call/.test(c.title)));
  assert.ok(s.turn.payday.lines.some((l) => /Margin call/.test(l.label)));
});

test('shorts cost borrow fees and dividends each month', () => {
  const s = newGame(1);
  const p = quietTurn(s);
  p.cash = 1e5;
  E.shortSell(s, 'keyr', 500);
  const sec = s.market.securities.keyr;
  const carry = O.shortCarry(s, p);
  assert.ok(near(carry, 500 * (sec.price * O.borrowRate(sec) + sec.div), 1e-6));
  assert.ok(near(C.summarize(s, p).shortCarry, -carry, 1e-6));
});

test('bankruptcy settles penny-stock options and shorts at $0', () => {
  const s = newGame(1);
  const p = quietTurn(s);
  p.cash = 1e5;
  const pn = s.market.securities.penny;
  const K = O.strikes(pn)[2];
  E.buyOption(s, 'penny', 'put', K, 6, 1);
  E.shortSell(s, 'penny', 1000);
  const cash = p.cash;
  const collateral = p.shorts.penny.collateral;
  O.applyBankruptcy(s, 'penny');
  assert.equal(p.options.length, 0);
  assert.equal(p.shorts.penny, undefined);
  assert.ok(near(p.cash, cash + K * 100 + collateral));
});

// ------------------------------------------------------------------ housing
test('property and home values drift with their neighborhoods', () => {
  const s = newGame(1, { seed: 'drift' });
  const p = s.players[0];
  p.home = { name: 'Test home', value: 300000, reIndex: s.market.reIndex, localMult: 1, boughtRound: 0, purchasePrice: 300000 };
  p.ownsHome = true;
  for (let i = 0; i < 12; i++) { E.beginTurn(s); s.pendingWin = null; E.endTurn(s, { force: true }); }
  assert.notEqual(p.home.localMult, 1, 'the home has its own neighborhood factor');
  assert.ok(near(C.homeValue(s, p), 300000 * p.home.localMult * s.market.reIndex / p.home.reIndex, 0.001));
});

test('selling your home pays off the mortgage and makes you a renter', () => {
  let s, p;
  for (let g = 0; g < 50; g++) {
    s = newGame(4, { seed: `home-${g}` });
    p = s.players.find((x) => x.home && C.homeMortgage(x));
    if (p) break;
  }
  while (C.currentPlayer(s) !== p) { E.beginTurn(s); s.pendingWin = null; E.endTurn(s, { force: true }); }
  quietTurn(s);
  const sale = C.homeSale(s, p);
  const cash = p.cash;
  assert.equal(E.sellHome(s, 'similar').ok, true);
  assert.equal(p.ownsHome, false);
  assert.equal(p.home, null);
  assert.equal(C.homeMortgage(p), null);
  assert.ok(near(p.cash, cash + sale.net, 0.02));
  assert.equal(p.expenses.housing, C.roundTo(Deals.rentFor(sale.value), 5));
});

test('renters can buy a listed home if they have the cash and the income', () => {
  const s = newGame(1, { seed: 'buyer' });
  const p = quietTurn(s);
  if (p.home) Deals.sellHome(s, p, { rent: 'similar' });
  const h = s.turn.homes.find((x) => x.tier === 'starter');
  assert.ok(h, 'three listings every turn');
  assert.equal(s.turn.homes.length, 3);
  p.cash = 0;
  assert.equal(E.buyHome(s, h.id, 0.2).ok, false, 'needs a down payment');
  p.cash = h.price;
  const t = Deals.homePurchaseTerms(s, p, h, 0.1);
  const r = E.buyHome(s, h.id, 0.1);
  assert.equal(r.ok, !t.reason, r.msg);
  if (r.ok) {
    assert.equal(p.ownsHome, true);
    assert.equal(p.expenses.housing, h.ownerCosts);
    assert.ok(near(C.homeMortgage(p).balance, h.price - t.down));
    assert.ok(near(p.cash, h.price - t.down - t.closing));
  }
  // The bank refuses when debt payments would exceed 43% of income.
  const big = { id: 'x', tier: 'upgrade', name: 'Mansion', price: 5e6, rate: 6, ownerCosts: 6000 };
  p.cash = 2e6;
  assert.match(Deals.homePurchaseTerms(s, p, big, 0.2).reason || '', /43%/);
});

// ------------------------------------------------------------------ startups
test('startup outcomes are announced with a pop-up', () => {
  const s = newGame(1);
  const p = s.players[0];
  p.businesses.push({ id: 'st', name: 'Test Startup', icon: '🚀', kind: 'startup', invested: 10000, cashInvested: 10000, monthsLeft: 1, base: 0, performance: 1, vol: 0, loan: null, rampLeft: 0 });
  E.beginTurn(s);
  assert.equal(p.businesses.length, 0);
  const pop = s.turn.cards.find((c) => /Test Startup/.test(c.title));
  assert.ok(pop, 'a pop-up card announces the result');
  assert.equal(pop.seen, false, 'it pops up for the player');
  assert.ok(['good', 'bad', 'neutral'].includes(pop.tone));
});

// ------------------------------------------------------------------ jobs: downsizing, raises, networking
test('layoffs last anywhere from 1 to 6 months; networking shortens them', () => {
  const s = newGame(1);
  const p = s.players[0];
  const rng = RNG.makeRng({ rngState: 12345 });
  const lengths = (level) => {
    p.network = { club: level >= 1 ? { name: 'Club', dues: 100 } : null, conferenceTurns: level >= 2 ? 5 : 0, conferences: 0 };
    const seen = new Set();
    for (let i = 0; i < 600; i++) {
      p.unemployedTurns = 0;
      s.turn = { cards: [] };
      const min = EV.maxJobSearch(p);
      // Downsizing draws uniformly from 1..maxJobSearch.
      const t = rng.int(1, min);
      seen.add(t);
    }
    return [...seen].sort((a, b) => a - b);
  };
  assert.deepEqual(lengths(0), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(lengths(1), [1, 2, 3, 4]);
  assert.deepEqual(lengths(2), [1, 2]);
  // And the real event, end to end:
  const counts = {};
  for (let g = 0; g < 120; g++) {
    const st = newGame(1, { seed: `layoff-${g}`, timeLimit: 120 });
    while (st.phase !== 'gameover') {
      E.beginTurn(st);
      for (const c of st.turn.cards) if (c.title === 'Downsized!') { const m = c.text.match(/go (\d+) turn/); counts[m[1]] = (counts[m[1]] || 0) + 1; }
      st.pendingWin = null;
      E.endTurn(st, { force: true });
    }
  }
  assert.deepEqual(Object.keys(counts).sort(), ['1', '2', '3', '4', '5', '6']);
});

test('raises are small and permanent; promotions are bigger', () => {
  let raises = 0, promos = 0, raisePct = [], promoPct = [];
  for (let g = 0; g < 40; g++) {
    const s = newGame(1, { seed: `raise-${g}`, timeLimit: 60 });
    const p = s.players[0];
    while (s.phase !== 'gameover') {
      const before = p.job.salary;
      E.beginTurn(s);
      for (const c of s.turn.cards) {
        if (/raise|adjustment/i.test(c.title) && c.icon === '📈') { raises++; raisePct.push(p.job.salary / before - 1); }
        if (c.icon === '🎖️') { promos++; promoPct.push(p.job.salary / before - 1); }
      }
      s.pendingWin = null;
      E.endTurn(s, { force: true });
    }
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(raises > 20, `raises happen (${raises})`);
  assert.ok(Math.max(...raisePct) <= 0.06, 'raises are small');
  assert.ok(avg(raisePct) < avg(promoPct), 'raises are smaller than promotions');
});

test('networking: conference is one-time, club dues are a monthly expense you can cancel', () => {
  const s = newGame(1);
  const p = quietTurn(s);
  p.cash = 1e5;
  s.turn.cards.push({ id: 'cf', kind: 'event', type: 'conference', title: 'Conf', text: '', required: false, resolved: false, seen: false, data: { name: 'Conf', cost: 2000 }, choices: [] });
  s.turn.cards.push({ id: 'cl', kind: 'event', type: 'club', title: 'Club', text: '', required: false, resolved: false, seen: false, data: { name: 'Club', joinFee: 1000, dues: 300 }, choices: [] });
  const exp = C.summarize(s, p).expenses;
  assert.equal(E.resolveCard(s, 'cf', 'attend').ok, true);
  assert.equal(p.network.conferenceTurns, 12);
  assert.equal(C.networkLevel(p), 1);
  assert.equal(E.resolveCard(s, 'cl', 'join').ok, true);
  assert.equal(C.networkLevel(p), 2);
  assert.ok(near(p.cash, 1e5 - 3000));
  assert.ok(near(C.summarize(s, p).expenses, exp + 300), 'dues count as an expense');
  assert.equal(EV.maxJobSearch(p), 2);
  assert.equal(E.cancelClub(s).ok, true);
  assert.ok(near(C.summarize(s, p).expenses, exp));
});

// ------------------------------------------------------------------ relationships
test('everyone starts single with no children', () => {
  for (let g = 0; g < 20; g++) for (const p of newGame(4, { seed: `single-${g}` }).players) {
    assert.equal(p.relationship.status, 'single');
    assert.equal(p.children, 0);
  }
});

test('dating → marriage splits the bills → children → divorce', () => {
  const s = newGame(1);
  const p = quietTurn(s);
  p.cash = 1e5;
  const single = C.summarize(s, p);
  const push = (type, data) => { const id = `c-${type}-${s.nextId++}`; s.turn.cards.push({ id, kind: 'event', type, title: type, text: '', required: type === 'divorce', resolved: false, seen: false, data, choices: [] }); return id; };

  assert.equal(E.resolveCard(s, push('meet', { partner: { name: 'Robin', emoji: '🌻' }, cost: 250 }), 'date').ok, true);
  assert.equal(p.relationship.status, 'dating');
  assert.ok(near(C.summarize(s, p).expenses, single.expenses + 250), 'dating costs money every month');

  const living = C.livingExpenses(p);
  const r = E.resolveCard(s, push('propose', { ring: 3000, wedding: 20000, simple: 1000, apr: 12, loanPay: 527 }), 'finance');
  assert.equal(r.ok, true);
  assert.equal(p.relationship.status, 'married');
  assert.ok(p.debts.some((d) => d.name === 'Wedding loan' && d.payment === 527), 'the wedding was financed');
  const married = C.summarize(s, p);
  assert.ok(near(C.livingExpenses(p), living * 1.5, 40), 'a household of two costs ~1.5×');
  const homeLoan = C.homeMortgage(p) ? C.homeMortgage(p).payment : 0;
  assert.ok(near(married.partner, (C.livingExpenses(p) + homeLoan) * 0.5, 1), 'the spouse pays half the bills and the home mortgage');
  assert.ok(married.living - married.partner + homeLoan / 2 < living, 'your share is lower than living alone');

  assert.equal(E.resolveCard(s, push('baby', { half: Math.round(p.childCost / 2) }), 'yes').ok, true);
  assert.equal(p.children, 1);
  assert.ok(near(C.childExpenses(p), p.childCost / 2, 1), 'parents split child costs');

  const shares = (p.holdings.idx = { shares: 100, costBasis: 1000 }).shares;
  const cashBefore = p.cash;
  assert.equal(E.resolveCard(s, push('divorce', { counseling: 1000, legal: 5000, counselWorks: false }), 'divorce').ok, true);
  assert.equal(p.relationship.status, 'single');
  assert.equal(p.relationship.divorces, 1);
  assert.ok(near(p.cash, (cashBefore - 5000) / 2, 0.02), 'legal fees, then half the cash goes to the ex');
  assert.equal(p.holdings.idx.shares, shares / 2);
  assert.equal(C.partnerShare(p), 0);
  assert.ok(near(C.livingExpenses(p), living, 40), 'household costs go back to one person');
});

test('dating relationships can end, and babies only come after marriage', () => {
  let breakups = 0, babiesWhileSingle = 0, meets = 0;
  for (let g = 0; g < 40; g++) {
    const s = newGame(1, { seed: `love-${g}`, timeLimit: 100 });
    const p = s.players[0];
    while (s.phase !== 'gameover') {
      E.beginTurn(s);
      for (const c of s.turn.cards) {
        if (c.type === 'meet') { meets++; E.resolveCard(s, c.id, 'date'); }
        if (c.type === 'propose') E.resolveCard(s, c.id, 'wait');
        if (c.title === 'The spark is gone') breakups++;
        if (c.type === 'baby' && p.relationship.status !== 'married') babiesWhileSingle++;
      }
      s.pendingWin = null;
      E.endTurn(s, { force: true });
    }
  }
  assert.ok(meets > 10, `people meet partners (${meets})`);
  assert.ok(breakups > 0, 'some dating relationships end');
  assert.equal(babiesWhileSingle, 0);
});

// ------------------------------------------------------------------ saves
test('old (version 1) saves load with every new field filled in', () => {
  const s = newGame(2);
  for (let i = 0; i < 3; i++) { E.beginTurn(s); s.pendingWin = null; E.endTurn(s, { force: true }); }
  const old = JSON.parse(E.serialize(s));
  old.version = 1;
  for (const p of old.players) { delete p.relationship; delete p.network; delete p.options; delete p.shorts; delete p.childShare; delete p.stats.raises; if (p.home) delete p.home.localMult; }
  const loaded = E.deserialize(JSON.stringify(old));
  assert.equal(loaded.version, 2);
  for (const p of loaded.players) {
    assert.equal(p.relationship.status, 'single');
    assert.deepEqual(p.options, []);
    assert.equal(p.stats.raises, 0);
    assert.ok(Number.isFinite(C.summarize(loaded, p).netWorth));
  }
  E.beginTurn(loaded);
  assert.equal(E.endTurn(loaded, { force: true }).ok, true);
});
