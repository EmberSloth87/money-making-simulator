'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const MMS = require('../js/engine.js');
const { Engine: E, Core: C, RNG, Market: M } = MMS;

const players = (n) => Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}` }));
const newGame = (n, extra) => E.createGame(Object.assign({ players: players(n), seed: 'test-seed', handoff: false }, extra));

/** Finish the current turn, settling every open card with its first/default choice. */
function playThrough(state) {
  if (state.phase === 'handoff') E.beginTurn(state);
  if (state.pendingWin) E.claimFreedom(state);
  if (state.phase === 'victory') return E.continueGame(state);
  return E.endTurn(state, { force: true });
}

test('creates games for 1 to 8 players with random jobs, expenses and debts', () => {
  for (const n of [1, 2, 6, 8]) {
    const s = newGame(n, { seed: `size-${n}` });
    assert.equal(s.players.length, n);
    const jobs = new Set(s.players.map((p) => p.job.title));
    assert.equal(jobs.size, n, 'every player gets a different job');
    for (const p of s.players) {
      const sum = C.summarize(s, p);
      assert.ok(p.job.salary > 0);
      assert.ok(sum.cashflow > 0, 'everyone starts with positive cashflow');
      assert.ok(sum.living > 0);
      assert.ok(Array.isArray(p.debts));
    }
  }
  // Across many games, players start with several kinds of debt.
  const kinds = new Set();
  for (let g = 0; g < 40; g++) for (const p of newGame(4, { seed: `debts-${g}` }).players) p.debts.forEach((d) => kinds.add(d.type));
  for (const k of ['credit', 'auto', 'student']) assert.ok(kinds.has(k), `some player starts with ${k} debt`);
});

test('the same seed produces the same game', () => {
  const a = newGame(3, { seed: 'repeatable' });
  const b = newGame(3, { seed: 'repeatable' });
  for (let i = 0; i < 30; i++) { playThrough(a); playThrough(b); }
  assert.equal(E.serialize(a), E.serialize(b));
});

test('players take turns in order and the month advances after everyone has played', () => {
  const s = newGame(3);
  const seen = [];
  for (let i = 0; i < 7; i++) {
    E.beginTurn(s);
    seen.push([s.round, s.currentIndex]);
    E.endTurn(s, { force: true });
  }
  assert.deepEqual(seen, [[1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2], [3, 0]]);
  assert.equal(s.phase, 'handoff');
});

test('payday pays salary and passive income and charges expenses', () => {
  const s = newGame(1);
  const p = s.players[0];
  p.businesses = []; p.properties = []; p.notes = []; p.collectibles = []; p.holdings = {};
  const before = p.cash;
  const sum = C.summarize(s, p);
  E.beginTurn(s);
  const expected = before + sum.salary - sum.living - sum.children - sum.debt;
  assert.ok(Math.abs(s.turn.payday.before - before) < 0.01);
  // Debt payments can be slightly less than the scheduled amount on a final payment.
  assert.ok(s.turn.payday.after >= expected - 0.01 || s.turn.payday.after === 0);
});

test('a downsized player gets no salary for the stated number of turns', () => {
  const s = newGame(1);
  const p = s.players[0];
  p.unemployedTurns = 2;
  const salaryLines = [];
  for (let i = 0; i < 3; i++) {
    E.beginTurn(s);
    salaryLines.push(s.turn.payday.lines.find((l) => l.label.startsWith('Salary')).amount);
    p.unemployedTurns = Math.min(p.unemployedTurns, i === 0 ? 1 : 0); // ignore new random downsizings
    E.endTurn(s, { force: true });
  }
  assert.equal(salaryLines[0], 0);
  assert.equal(salaryLines[1], 0);
  assert.equal(salaryLines[2], p.job.salary);
});

test('deals arrive randomly — on many turns, but not on every turn', () => {
  const s = newGame(1, { seed: 'deal-frequency' });
  let withDeal = 0, turns = 0;
  for (let i = 0; i < 300 && s.phase !== 'gameover'; i++) {
    E.beginTurn(s);
    if (s.turn.cards.some((c) => c.kind === 'deal' || c.type === 'tip')) withDeal++;
    turns++;
    s.pendingWin = null;
    E.endTurn(s, { force: true });
  }
  const share = withDeal / turns;
  assert.ok(share > 0.35 && share < 0.85, `deal share ${share}`);
});

test('an unavoidable expense must be paid before the turn can end', () => {
  const s = newGame(1);
  E.beginTurn(s);
  s.turn.cards = [];
  const card = { id: 'c-test', kind: 'event', type: 'expense', title: 'Car trouble', text: '', tone: 'bad', required: true, resolved: false, seen: false, data: { cost: 500 }, choices: [{ id: 'cash' }, { id: 'credit' }] };
  s.turn.cards.push(card);
  assert.equal(E.endTurn(s).ok, false);
  const p = s.players[0];
  p.cash = 1000;
  assert.equal(E.resolveCard(s, 'c-test', 'cash').ok, true);
  assert.equal(p.cash, 500);
  assert.equal(E.endTurn(s).ok, true);
});

test('charity costs 10% of income and grants three turns of good karma', () => {
  const s = newGame(1);
  E.beginTurn(s);
  const p = s.players[0];
  p.cash = 100000;
  const sum = C.summarize(s, p);
  const amount = Math.max(50, C.roundTo((sum.salary + sum.gigs + Math.max(0, sum.passive)) * 0.1, 5));
  s.turn.cards = [{ id: 'c-char', kind: 'event', type: 'charity', title: 'Charity', text: '', required: false, resolved: false, seen: false, data: { amount, cause: 'test' }, choices: [] }];
  E.resolveCard(s, 'c-char', 'donate');
  assert.equal(p.karmaTurns, 3);
  assert.equal(p.cash, 100000 - amount);
});

test('paying off a debt removes its payment and lowers expenses', () => {
  const s = newGame(1, { seed: 'debt' });
  E.beginTurn(s);
  const p = s.players[0];
  p.cash = 1e7;
  const d = p.debts[0] || C.addDebt(s, p, { type: 'credit', balance: 2000, apr: 24.99, revolving: true });
  const before = C.summarize(s, p).expenses;
  const r = E.payDebt(s, d.id, d.balance);
  assert.equal(r.ok, true);
  assert.ok(!p.debts.includes(d));
  assert.ok(Math.abs(C.summarize(s, p).expenses - (before - d.payment)) < 0.01);
});

test('loan math is consistent', () => {
  const pay = C.amortPayment(100000, 6, 360);
  assert.ok(Math.abs(pay - 599.55) < 0.01);
  assert.ok(Math.abs(C.principalFromPayment(pay, 6, 360) - 100000) < 0.01);
  assert.equal(C.monthsToPayoff(100000, 6, pay), 360);
  assert.equal(C.monthsToPayoff(1000, 24, 10), Infinity, 'a payment below the interest never pays off');
});

test('stocks: buy, sell, and no overspending', () => {
  const s = newGame(1);
  E.beginTurn(s);
  const p = s.players[0];
  p.cash = 10000;
  const price = s.market.securities.idx.price;
  assert.equal(E.buyStock(s, 'idx', Math.floor(20000 / price)).ok, false);
  const had = p.holdings.idx ? p.holdings.idx.shares : 0;
  assert.equal(E.buyStock(s, 'idx', 10).ok, true);
  assert.ok(Math.abs(p.cash - (10000 - 10 * price)) < 0.01);
  assert.equal(E.sellStock(s, 'idx', had + 11).ok, false);
  assert.equal(E.sellStock(s, 'idx', 10).ok, true);
  assert.ok(Math.abs(p.cash - 10000) < 0.01);
});

test('the bank only lends what your cashflow can support', () => {
  const s = newGame(1);
  E.beginTurn(s);
  const p = s.players[0];
  const limit = C.loanLimit(s, p);
  assert.equal(E.borrow(s, limit + 1000).ok, false);
  if (limit >= 1000) {
    const cash = p.cash;
    assert.equal(E.borrow(s, 1000).ok, true);
    assert.equal(p.cash, cash + 1000);
    assert.ok(p.debts.some((d) => d.type === 'bank'));
  }
});

test('reaching passive income of 2× expenses wins; others may keep playing', () => {
  const s = newGame(2);
  E.beginTurn(s);
  const p = s.players[0];
  const need = C.summarize(s, p).target + 100;
  p.properties.push({ id: 'big', name: 'Test Tower', icon: '🏢', units: 50, purchasePrice: 1e6, cost: 1, reIndexAtPurchase: s.market.reIndex, valueMult: 1, rent: need, opex: 0, mortgage: null, rehabLeft: 0, arvMult: 1 });
  E.checkFreedom(s);
  assert.equal(s.pendingWin, p.id);
  E.claimFreedom(s);
  assert.equal(p.finished, true);
  assert.equal(p.place, 1);
  assert.equal(s.phase, 'victory');
  E.continueGame(s);
  for (let i = 0; i < 4; i++) {
    assert.equal(C.currentPlayer(s).id, s.players[1].id, 'the winner is skipped');
    playThrough(s);
  }
});

test('a solo win ends the game', () => {
  const s = newGame(1);
  E.beginTurn(s);
  const p = s.players[0];
  p.notes.push({ id: 'n', name: 'Huge note', icon: '📜', principal: 1e9, rate: 12, monthsLeft: 100, defaultRisk: 0 });
  E.checkFreedom(s);
  E.claimFreedom(s);
  assert.equal(s.phase, 'gameover');
});

test('a time limit ends the game', () => {
  const s = newGame(2, { timeLimit: 3 });
  for (let i = 0; i < 20 && s.phase !== 'gameover'; i++) {
    E.beginTurn(s);
    s.pendingWin = null;
    E.endTurn(s, { force: true });
  }
  assert.equal(s.phase, 'gameover');
  assert.equal(s.endReason, 'time');
  assert.equal(s.round, 3);
});

test('save files round-trip and bad files are rejected', () => {
  const s = newGame(2);
  for (let i = 0; i < 5; i++) playThrough(s);
  const copy = E.deserialize(E.serialize(s));
  assert.deepEqual(copy, JSON.parse(JSON.stringify(s)));
  assert.throws(() => E.deserialize('{"hello":1}'));
  assert.throws(() => E.deserialize('not json'));
});

test('stocks have realistic, distinct volatility', () => {
  const vols = {};
  for (let g = 0; g < 40; g++) {
    const st = { rngState: RNG.seedFromString(`vol-${g}`), players: [], round: 0, log: [] };
    const rng = RNG.makeRng(st);
    M.initMarket(st, rng);
    const r = {};
    for (let t = 0; t < 120; t++) {
      st.round = t + 1;
      M.update(st, rng);
      for (const id of st.market.order) {
        const sec = st.market.securities[id];
        if (sec.penny && sec.history.length === 1) continue; // relisted after bankruptcy
        (r[id] = r[id] || []).push(Math.log(sec.price / sec.prevPrice));
      }
    }
    for (const id in r) {
      const x = r[id], m = x.reduce((a, b) => a + b, 0) / x.length;
      (vols[id] = vols[id] || []).push(Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1) * 12));
    }
  }
  const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
  const v = Object.fromEntries(Object.entries(vols).map(([k, a]) => [k, med(a)]));
  const order = ['tbnd', 'frsh', 'idx', 'mega', 'volt', 'nrlx', 'kryx'];
  for (let i = 1; i < order.length; i++) assert.ok(v[order[i - 1]] < v[order[i]], `${order[i - 1]} (${v[order[i - 1]].toFixed(3)}) should be calmer than ${order[i]} (${v[order[i]].toFixed(3)})`);
  assert.ok(v.tbnd < 0.08, 'bonds are low-volatility');
  assert.ok(v.idx > 0.1 && v.idx < 0.2, 'the index fund swings ~15% a year');
  assert.ok(v.kryx > 0.55, 'crypto is extremely volatile');
});

test('full games run to completion without errors', () => {
  for (let g = 0; g < 10; g++) {
    const s = newGame(1 + (g % 6), { seed: `full-${g}`, timeLimit: 120 });
    let guard = 0;
    while (s.phase !== 'gameover' && guard++ < 2000) {
      const r = playThrough(s);
      assert.ok(r.ok, r.msg);
    }
    assert.equal(s.phase, 'gameover');
  }
});
