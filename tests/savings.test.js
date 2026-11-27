'use strict';
/*
 * CDs, the financial statement, the Fear & Greed market mood, and the in-depth learning guide.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const MMS = require('../js/engine.js');
const { Engine: E, Core: C, Market: M, Savings: SV, Events: EV, RNG } = MMS;

const newGame = (n, extra) => E.createGame(Object.assign({ players: Array.from({ length: n || 1 }, (_, i) => ({ name: `P${i + 1}` })), seed: 'cd-seed', handoff: false }, extra));
/** Start the current player's turn with no random cards, so the test controls what happens. */
function quietTurn(s) {
  E.beginTurn(s);
  s.turn.cards = [];
  s.pendingWin = null;
  return C.currentPlayer(s);
}
function nextTurn(s) {
  s.pendingWin = null;
  E.endTurn(s, { force: true });
  return quietTurn(s);
}
const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 0.02 : eps);

// ------------------------------------------------------------------ CD rates
test('CD rates follow the central bank rate, differ by bank and by term', () => {
  const s = newGame(1);
  const offers = SV.offers(s);
  assert.equal(offers.filter((o) => !o.promo).length, SV.TERMS.length * SV.BANKS.length);
  for (const t of SV.TERMS) {
    const at = (bank) => offers.find((o) => o.term === t && o.bank === bank && !o.promo).apy;
    assert.ok(at('online') > at('big') + 0.8, `online banks pay much more than big banks (${t} mo)`);
  }
  for (const o of offers) assert.ok(Math.abs(o.apy - s.market.rate) < 3, `${o.id} ${o.apy}% is near the ${s.market.rate}% central rate`);
  // Same month, same rates: rebuilding the board changes nothing.
  assert.deepEqual(SV.refreshOffers(s), offers);

  // Low rates → an upward-sloping curve; high rates → inverted.
  const curve = (rate) => {
    s.market.rate = rate; s.market.economy = 'stable';
    const o = SV.refreshOffers(s).filter((x) => x.bank === 'online' && !x.promo);
    return o.find((x) => x.term === 60).apy - o.find((x) => x.term === 3).apy;
  };
  assert.ok(curve(1.5) > 0.6, 'long CDs pay more when rates are low');
  assert.ok(curve(7) < -0.3, 'the curve inverts when rates are high');
});

test('CD rates change from month to month', () => {
  const s = newGame(1, { seed: 'cd-months' });
  const seen = new Set();
  for (let i = 0; i < 12; i++) {
    quietTurn(s);
    seen.add(SV.bestOffer(s, 12).apy);
    s.pendingWin = null;
    E.endTurn(s, { force: true });
  }
  assert.ok(seen.size >= 3, `12-month rates varied: ${[...seen].join(', ')}`);
});

// ------------------------------------------------------------------ opening & holding CDs
test('opening a CD moves cash into it; minimums and cash are checked', () => {
  const s = newGame(1);
  const p = quietTurn(s);
  p.cash = 20000;
  const o = SV.offers(s).find((x) => x.id === 'cu-12');
  assert.equal(E.openCD(s, o.id, o.min - 1, 'monthly').ok, false, 'below the minimum');
  assert.equal(E.openCD(s, o.id, 25000, 'monthly').ok, false, 'more than your cash');
  assert.equal(E.openCD(s, 'nope', 5000, 'monthly').ok, false, 'unknown offer');
  const before = C.summarize(s, p).netWorth;
  const r = E.openCD(s, o.id, 10000, 'monthly');
  assert.ok(r.ok, r.msg);
  assert.equal(p.cash, 10000);
  assert.equal(p.cds.length, 1);
  assert.equal(p.cds[0].apy, o.apy);
  assert.ok(near(C.summarize(s, p).netWorth, before), 'net worth is unchanged: cash just moved into the CD');
  assert.equal(C.summarize(s, p).cdValue, 10000);
});

test('monthly-payout CDs pay passive income; compounding CDs grow instead', () => {
  const s = newGame(1);
  const p = quietTurn(s);
  p.cash = 50000;
  const o = SV.offers(s).find((x) => x.id === 'online-12');
  E.openCD(s, o.id, 20000, 'monthly');
  E.openCD(s, o.id, 20000, 'compound');
  const [monthly, compound] = p.cds;
  const expected = 20000 * (Math.pow(1 + o.apy / 100, 1 / 12) - 1);
  const sum = C.summarize(s, p);
  assert.ok(near(sum.cdInterest, expected, 0.01), 'only the monthly-payout CD counts as passive income');
  assert.ok(sum.passive >= sum.cdInterest - 0.01);

  nextTurn(s);
  const line = s.turn.payday.lines.find((l) => l.label === 'Interest (CDs)');
  assert.ok(line && near(line.amount, expected, 0.01), 'payday pays the monthly interest');
  assert.equal(monthly.principal, 20000);
  assert.ok(near(compound.accrued, expected, 0.01), 'the compounding CD keeps its interest');
  assert.equal(monthly.monthsLeft, 11);
  assert.ok(p.stats.cdInterest > 2 * expected - 0.05, 'both CDs count toward lifetime CD interest');
});

test('a CD returns its money at maturity', () => {
  const s = newGame(1);
  let p = quietTurn(s);
  p.cash = 10000;
  const o = SV.offers(s).find((x) => x.id === 'online-3');
  E.openCD(s, o.id, 10000, 'compound');
  const expected = 10000 * Math.pow(1 + o.apy / 100, 3 / 12);
  for (let i = 0; i < 3; i++) p = nextTurn(s);
  assert.equal(p.cds.length, 0, 'the CD is gone after 3 months');
  const back = s.turn.payday.lines.find((l) => /CDs matured/.test(l.label));
  assert.ok(back && near(back.amount, expected, 0.05), `got back ${back && back.amount}, expected ${expected.toFixed(2)}`);
  assert.ok(s.turn.payday.notes.some((n) => /matured/.test(n)));
});

test('cashing out a CD early costs months of interest', () => {
  assert.equal(SV.penaltyMonths(3), 3);
  assert.equal(SV.penaltyMonths(6), 3);
  assert.equal(SV.penaltyMonths(12), 6);
  assert.equal(SV.penaltyMonths(24), 6);
  assert.equal(SV.penaltyMonths(36), 12);
  assert.equal(SV.penaltyMonths(60), 12);
  const s = newGame(1);
  const p = quietTurn(s);
  p.cash = 10000;
  const o = SV.offers(s).find((x) => x.id === 'online-60');
  E.openCD(s, o.id, 10000, 'monthly');
  const w = SV.earlyWithdrawal(p.cds[0]);
  assert.ok(near(w.penalty, 10000 * SV.monthlyRate(o.apy) * 12, 0.01));
  const r = E.breakCD(s, p.cds[0].id);
  assert.ok(r.ok, r.msg);
  assert.ok(p.cash < 10000, 'breaking a brand-new 5-year CD eats into the deposit');
  assert.ok(near(p.cash, 10000 - w.penalty, 0.01));
  assert.equal(p.cds.length, 0);
  assert.equal(E.breakCD(s, 'gone').ok, false);
});

test('a divorce splits CDs like other savings', () => {
  const s = newGame(1);
  const p = quietTurn(s);
  p.cash = 30000;
  E.openCD(s, 'online-24', 20000, 'monthly');
  p.relationship = Object.assign(C.newRelationship(), { status: 'married', partner: { name: 'Sam', emoji: '🙂' }, since: 1 });
  const card = { id: 'x', type: 'divorce', required: true, data: { legal: 1000, counseling: 500 } };
  s.turn.cards.push(card);
  EV.resolve(s, p, card, 'divorce');
  assert.equal(p.cds[0].principal, 10000);
  assert.match(card.outcome, /half of your CDs/);
});

test('computer savers put spare cash into CDs when rates are decent', () => {
  let opened = 0;
  for (let g = 0; g < 6 && !opened; g++) {
    const s = E.createGame({ players: [{ name: 'Bot', bot: 'normal' }, { name: 'Me' }], seed: `cd-bot-${g}`, handoff: false });
    for (let i = 0; i < 40 && s.phase !== 'gameover'; i++) {
      E.runBots(s);
      if (s.phase !== 'handoff') break;
      quietTurn(s); s.pendingWin = null; E.endTurn(s, { force: true });
      opened += s.players[0].cds.length + (s.players[0].stats.cdInterest > 0 ? 1 : 0);
    }
  }
  assert.ok(opened > 0, 'the steady saver opened at least one CD');
});

// ------------------------------------------------------------------ financial statement
test('the financial statement adds up to the same totals as the summary', () => {
  for (let g = 0; g < 8; g++) {
    const s = newGame(3, { seed: `stmt-${g}` });
    for (let t = 0; t < 30 * 3 && s.phase !== 'gameover'; t++) {
      if (s.phase === 'handoff') E.beginTurn(s);
      if (s.phase !== 'turn') break;
      const p = C.currentPlayer(s);
      for (const c of s.turn.cards) if (c.kind === 'deal' && !c.resolved && p.cash > (c.deal.cash || 0)) E.resolveCard(s, c.id, 'buy');
      if (p.cash > 3000 && t % 4 === 0) E.openCD(s, 'cu-6', 1000, t % 8 ? 'monthly' : 'compound');
      for (const q of s.players) {
        const st = C.statement(s, q), sm = C.summarize(s, q);
        const groups = (gs) => gs.reduce((a, gr) => a + gr.items.reduce((b, it) => b + it.amount, 0), 0);
        assert.ok(near(groups(st.earned), sm.salary + sm.gigs, 0.05), 'earned income');
        assert.ok(near(groups(st.passive), sm.passive, 0.05), `passive ${groups(st.passive)} vs ${sm.passive}`);
        assert.ok(near(groups(st.expenses), sm.expenses, 1.01), `expenses ${groups(st.expenses)} vs ${sm.expenses}`);
        assert.ok(near(st.assets.reduce((a, x) => a + x.amount, 0), sm.assets, 0.05), 'assets');
        assert.ok(near(st.liabilities.reduce((a, x) => a + x.amount, 0), sm.liabilities, 0.05), 'liabilities');
        const debt = st.expenses.find((x) => x.id === 'debt');
        if (debt) for (const d of debt.items) assert.ok(near(d.interest + d.principal, d.amount, 0.01), 'interest + principal = payment');
      }
      s.pendingWin = null;
      E.endTurn(s, { force: true });
    }
  }
});

test('turn snapshots record income and expenses for the history chart', () => {
  const s = newGame(1);
  quietTurn(s);
  E.endTurn(s, { force: true });
  const h = s.players[0].history[s.players[0].history.length - 1];
  assert.ok(Number.isFinite(h.income) && Number.isFinite(h.expenses) && Number.isFinite(h.cashflow));
});

// ------------------------------------------------------------------ fear & greed
function runMarket(seed, months) {
  const st = { seed, rngState: RNG.seedFromString(seed), players: [], round: 0, log: [] };
  const rng = RNG.makeRng(st);
  M.initMarket(st, rng);
  const out = [];
  for (let t = 0; t < months; t++) {
    st.round = t + 1;
    const headlines = M.update(st, rng);
    out.push({ mood: M.sentimentMood(st.market.sentiment).id, v: st.market.sentiment, idx: st.market.securities.idx.price, gold: st.market.securities.aurm.price, headlines });
  }
  return { st, out };
}

test('the Fear & Greed index swings between fear and greed and stays within 0–100', () => {
  const counts = {};
  let moodNews = 0;
  for (let g = 0; g < 40; g++) {
    const { st, out } = runMarket(`fg-${g}`, 120);
    for (const o of out) {
      assert.ok(o.v >= 0 && o.v <= 100);
      counts[o.mood] = (counts[o.mood] || 0) + 1;
      moodNews += o.headlines.filter((h) => /Fear & Greed index/.test(h.text)).length;
    }
    assert.ok(st.market.sentimentHistory.length > 100);
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  for (const id of ['xfear', 'fear', 'neutral', 'greed', 'xgreed']) assert.ok(counts[id] / total > 0.03, `${id} happens (${counts[id]})`);
  assert.ok(counts.xfear / total < 0.3 && counts.xgreed / total < 0.3, 'extremes are not the norm');
  assert.ok(moodNews > 20, 'entering an extreme makes the news');
});

test('stocks do better after extreme fear than after extreme greed, as in real markets', () => {
  const fwd = { xfear: [], xgreed: [] };
  for (let g = 0; g < 80; g++) {
    const { out } = runMarket(`fwd-${g}`, 240);
    for (let t = 0; t + 12 < out.length; t++) if (fwd[out[t].mood]) fwd[out[t].mood].push(out[t + 12].idx / out[t].idx - 1);
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(avg(fwd.xfear) > avg(fwd.xgreed) + 0.01, `after fear ${avg(fwd.xfear).toFixed(3)} vs after greed ${avg(fwd.xgreed).toFixed(3)}`);
});

test('greed pushes stocks up and fear sends money to gold', () => {
  const s = newGame(1);
  const m = s.market;
  const move = (sentiment) => {
    const copy = JSON.parse(JSON.stringify(s));
    copy.market.sentiment = sentiment;
    copy.market.froth = 0;
    copy.round = 5; // no earnings season
    const before = { idx: copy.market.securities.idx.price, gold: copy.market.securities.aurm.price };
    copy.rngState = 12345; // same dice either way
    M.update(copy, RNG.makeRng(copy));
    return { idx: copy.market.securities.idx.price / before.idx, gold: copy.market.securities.aurm.price / before.gold };
  };
  const greedy = move(95), fearful = move(5);
  assert.ok(greedy.idx > fearful.idx * 1.03, 'stocks rise more in greed');
  assert.ok(fearful.gold > greedy.gold, 'gold does better in fear');
  assert.equal(m.sentiment != null, true);
});

test('saves from before CDs and Fear & Greed still load', () => {
  const s = newGame(2);
  for (let i = 0; i < 3; i++) { E.beginTurn(s); s.pendingWin = null; E.endTurn(s, { force: true }); }
  const old = JSON.parse(E.serialize(s));
  delete old.market.sentiment; delete old.market.sentimentHistory; delete old.market.froth; delete old.market.cds;
  for (const id in old.market.securities) delete old.market.securities[id].sent;
  for (const p of old.players) { delete p.cds; delete p.stats.cdInterest; delete p.stats.cdPenalties; }
  const loaded = E.deserialize(JSON.stringify(old));
  assert.equal(loaded.market.sentiment, 50);
  for (const p of loaded.players) {
    assert.deepEqual(p.cds, []);
    assert.equal(p.stats.cdInterest, 0);
    assert.ok(Number.isFinite(C.summarize(loaded, p).netWorth));
  }
  assert.ok(SV.offers(loaded).length > 0, 'the CD board is rebuilt');
  for (let i = 0; i < 4; i++) { E.beginTurn(loaded); loaded.pendingWin = null; assert.equal(E.endTurn(loaded, { force: true }).ok, true); }
});

// ------------------------------------------------------------------ the in-depth guide
test('every Learn-tab "Read more" link has a section in the in-depth guide', () => {
  const root = path.join(__dirname, '..');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const guide = fs.readFileSync(path.join(root, 'learn.html'), 'utf8');
  const ids = new Set([...guide.matchAll(/\sid="([^"]+)"/g)].map((x) => x[1]));
  const anchorBlock = ui.match(/const anchors = \{([\s\S]*?)\};/)[1];
  const anchors = [...anchorBlock.matchAll(/:\s*'([a-z-]+)'/g)].map((x) => x[1]);
  assert.ok(anchors.length >= 20);
  const linked = [...ui.matchAll(/learn\.html#([a-z-]+)/g)].map((x) => x[1]);
  for (const a of anchors.concat(linked)) assert.ok(ids.has(a), `learn.html has #${a}`);
  for (const a of [...guide.matchAll(/href="#([a-z-]+)"/g)].map((x) => x[1])) assert.ok(ids.has(a), `contents link #${a} exists`);
});
