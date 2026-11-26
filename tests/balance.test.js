'use strict';
/*
 * Balance rules: student loans by degree, everyone starts renting, family odds,
 * charity while laid off, surprise bills, and trading between players.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const MMS = require('../js/engine.js');
const { Engine: E, Core: C, Data: D, Events: EV, Trade: T, RNG } = MMS;

const newGame = (players, extra) => E.createGame(Object.assign({ players, seed: 'balance-seed', handoff: false }, extra));
const people = (n) => Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}` }));
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
/** Start the current player's turn with no random cards, so the test controls what happens. */
function quietTurn(s) {
  E.beginTurn(s);
  s.turn.cards = [];
  s.pendingWin = null;
  return C.currentPlayer(s);
}
/** Play months for a solo game, calling onCard for every card and settling the rest by default. */
function playMonths(s, months, onCard) {
  for (let i = 0; i < months && s.phase !== 'gameover'; i++) {
    const p = C.currentPlayer(s);
    if (onCard && onCard.before) onCard.before(p);
    E.beginTurn(s);
    for (const c of s.turn.cards.slice()) if (onCard && onCard.card) onCard.card(c, p);
    s.pendingWin = null;
    E.endTurn(s, { force: true });
  }
}
/** A player built from a specific job, created inside a fresh game. */
function playerWithJob(title, seed) {
  const s = newGame(people(1), { seed });
  const job = D.JOBS.find((j) => j.title === title);
  return C.createPlayer(s, RNG.makeRng(s), { name: 'T', emoji: '🦊', color: '#3987e5' }, job);
}
const studentDebt = (p) => p.debts.filter((d) => d.type === 'student').reduce((t, d) => t + d.balance, 0);

// ------------------------------------------------------------------ student loans
test('every job that needs a degree starts with student loans', () => {
  for (const job of D.JOBS.filter((j) => j.degree)) {
    for (let g = 0; g < 25; g++) {
      const p = playerWithJob(job.title, `deg-${job.title}-${g}`);
      assert.ok(studentDebt(p) > 0, `${job.title} #${g} has student loans`);
    }
  }
  for (const title of ['Software Engineer', 'Data Scientist', 'Accountant', 'Registered Nurse', 'Teacher']) {
    assert.equal(D.JOBS.find((j) => j.title === title).degree, 'bachelor', `${title} needs a bachelor's degree`);
  }
});

test('doctors owe about 5× the student loans of a bachelor\'s degree', () => {
  const avg = (title) => {
    let t = 0;
    for (let g = 0; g < 200; g++) t += studentDebt(playerWithJob(title, `avg-${title}-${g}`));
    return t / 200;
  };
  const undergrad = (avg('Accountant') + avg('Teacher') + avg('Software Engineer')) / 3;
  const doctor = avg('Doctor');
  assert.ok(undergrad > 22000 && undergrad < 38000, `undergrad average ${Math.round(undergrad)}`);
  assert.ok(doctor / undergrad > 4.6 && doctor / undergrad < 5.4, `doctor ÷ undergrad = ${(doctor / undergrad).toFixed(2)}`);
  assert.equal(D.DEGREES.medical.loanMult, 5);
});

test('degree holders still start with positive cashflow', () => {
  for (const job of D.JOBS.filter((j) => j.degree)) {
    for (let g = 0; g < 15; g++) {
      const s = E.createGame({ players: [{ name: 'A' }], seed: `cf-${job.title}-${g}` });
      const p = C.createPlayer(s, RNG.makeRng(s), { name: 'T' }, job);
      s.players = [p];
      assert.ok(C.summarize(s, p).cashflow > 0, `${job.title} starts in the black`);
    }
  }
});

// ------------------------------------------------------------------ renting
test('everyone starts as a renter, and can still buy a home later', () => {
  for (let g = 0; g < 30; g++) {
    for (const p of newGame(people(8), { seed: `rent-${g}` }).players) {
      assert.equal(p.ownsHome, false);
      assert.equal(p.home, undefined);
      assert.equal(C.homeMortgage(p), null);
    }
  }
  const s = newGame(people(1), { seed: 'rent-buy' });
  const p = quietTurn(s);
  p.cash = 1e6;
  assert.equal(s.turn.homes.length, 3, 'homes are listed for sale every turn');
  assert.equal(E.buyHome(s, s.turn.homes[0].id, 0.2).ok, true);
  assert.equal(p.ownsHome, true);
});

// ------------------------------------------------------------------ family odds
test('married couples are asked about children often', () => {
  let asks = 0, couples = 0;
  for (let g = 0; g < 30; g++) {
    const s = newGame(people(1), { seed: `baby-${g}` });
    const p = s.players[0];
    Object.assign(p.relationship, { status: 'married', partner: { name: 'Robin', emoji: '🌻' }, since: 1, nextBabyAsk: 3 });
    p.childShare = 0.5;
    couples++;
    playMonths(s, 24, {
      before: (pl) => { if (pl.relationship.status !== 'married') Object.assign(pl.relationship, { status: 'married', partner: { name: 'Robin', emoji: '🌻' } }); },
      card: (c) => { if (c.type === 'baby') { asks++; E.resolveCard(s, c.id, 'no'); } }
    });
  }
  // About one ask every ~11 months when always declined (4-month wait + 15%/month) → ~2 in two years.
  const perCouple = asks / couples;
  assert.ok(perCouple > 1.5, `baby questions per couple in 2 years: ${perCouple.toFixed(2)}`);
});

test('saying yes to a baby waits 9 months before the next ask', () => {
  const s = newGame(people(1), { seed: 'baby-gap' });
  const p = quietTurn(s);
  Object.assign(p.relationship, { status: 'married', partner: { name: 'Robin', emoji: '🌻' }, since: 1 });
  s.turn.cards.push({ id: 'bb', kind: 'event', type: 'baby', title: 'Baby', text: '', required: false, resolved: false, seen: false, data: { half: 300 }, choices: [] });
  assert.equal(E.resolveCard(s, 'bb', 'yes').ok, true);
  assert.equal(p.children, 1);
  assert.equal(p.relationship.nextBabyAsk, s.round + 9);
});

test('dating relationships break up about 5% of months', () => {
  let months = 0, breakups = 0;
  for (let g = 0; g < 40; g++) {
    const s = newGame(people(1), { seed: `breakup-${g}` });
    playMonths(s, 40, {
      // Keep everyone freshly dating (no proposals yet, none declined) to measure the base rate.
      before: (p) => Object.assign(p.relationship, { status: 'dating', partner: { name: 'Sam', emoji: '🎸' }, since: s.round, datingCost: 100, declined: 0 }),
      card: (c) => { if (c.title === 'The spark is gone') breakups++; }
    });
    months += 40;
  }
  const rate = breakups / months;
  assert.ok(rate > 0.035 && rate < 0.07, `breakup rate ${rate.toFixed(3)}/month`);
  assert.ok(EV.BREAKUP_BASE > 0.022, 'more common than before');
});

// ------------------------------------------------------------------ charity
test('charity while laid off asks for 10% of the salary you would normally earn', () => {
  const s = newGame(people(1), { seed: 'charity-layoff' });
  const p = quietTurn(s);
  p.sideGigs = [];
  const employed = EV.charityAmount(s, p);
  p.unemployedTurns = 3;
  assert.equal(C.summarize(s, p).salary, 0, 'no paycheck right now');
  const laidOff = EV.charityAmount(s, p);
  assert.equal(laidOff, employed, 'being between jobs does not make good karma cheaper');
  const passive = Math.max(0, C.summarize(s, p).passive);
  assert.equal(laidOff, Math.max(50, C.roundTo((p.job.salary + passive) * 0.1, 5)));
});

// ------------------------------------------------------------------ surprise bills
test('surprise bills pop up on roughly a quarter of turns', () => {
  let turns = 0, bills = 0;
  const titles = new Set(D.EMERGENCIES.map((e) => e.title));
  for (let g = 0; g < 30; g++) {
    const s = newGame(people(1), { seed: `bills-${g}`, timeLimit: 60 });
    playMonths(s, 60, { card: (c) => { if (c.type === 'expense' && titles.has(c.title)) bills++; } });
    turns += 60;
  }
  const rate = bills / turns;
  assert.ok(rate > 0.18 && rate < 0.32, `surprise bills per turn: ${rate.toFixed(3)}`);
});

test('kid, boat and home bills only hit people who have them', () => {
  const s = newGame(people(1), { seed: 'pool' });
  const p = s.players[0];
  p.children = 0; p.ownsHome = false; p.debts = p.debts.filter((d) => d.type !== 'boat');
  assert.ok(EV.emergencyPool(p).every((e) => !e.kids && !e.boat && !e.homeowner));
  p.children = 2; p.ownsHome = true;
  C.addDebt(s, p, { type: 'boat', name: 'Boat loan', balance: 10000, apr: 8, termMonths: 60 });
  const pool = EV.emergencyPool(p);
  assert.ok(pool.some((e) => e.kids) && pool.some((e) => e.boat) && pool.some((e) => e.homeowner));
});

// ------------------------------------------------------------------ luxury temptations
test('luxury temptations show up on roughly a quarter of turns, more often for lavish spenders', () => {
  const rate = (lifestyle) => {
    let turns = 0, lux = 0;
    for (let g = 0; g < 30; g++) {
      const s = newGame(people(1), { seed: `lux-${lifestyle}-${g}`, timeLimit: 60 });
      s.players[0].lifestyle = lifestyle;
      playMonths(s, 60, { card: (c) => { if (c.data && c.data.flavor === 'luxury') lux++; } });
      turns += 60;
    }
    return lux / turns;
  };
  const frugal = rate(0), lavish = rate(3);
  assert.ok(frugal > 0.13 && frugal < 0.26, `frugal temptations per turn: ${frugal.toFixed(3)}`);
  assert.ok(lavish > 0.22 && lavish < 0.38, `lavish temptations per turn: ${lavish.toFixed(3)}`);
  assert.ok(lavish > frugal * 1.3);
  const s = newGame(people(1), { seed: 'lux-chance' });
  const p = s.players[0];
  const working = EV.temptationChance(p);
  p.unemployedTurns = 3;
  assert.ok(near(EV.temptationChance(p), working / 2, 1e-9), 'temptation halves while out of work');
});

test('a new-car splurge only tempts people whose car is paid off, and it adds a 5-year auto loan', () => {
  const s = newGame(people(1), { seed: 'car' });
  const p = quietTurn(s);
  p.debts = p.debts.filter((d) => d.type !== 'auto');
  // Every other luxury has already been shown this turn, so the car is the one left to pick.
  s.turn.cards = EV.luxuryPool(p).filter((l) => !l.carLoan).map((l) => ({ title: l.title }));
  const card = EV.temptation(s, p, RNG.makeRng(s));
  const loan = p.debts.find((d) => d.type === 'auto');
  assert.equal(card.title, 'New-car fever');
  assert.equal(card.type, 'expense');
  assert.equal(card.data.flavor, 'luxury');
  assert.ok(loan && loan.balance > 5000 && loan.payment > 0, 'the car comes with a loan');
  assert.ok(card.text.includes(C.money(loan.payment)), card.text);
  assert.ok(!EV.luxuryPool(p).some((l) => l.carLoan), 'no new-car temptation while a car loan is open');
});

// ------------------------------------------------------------------ trading
function tradeGame(players) {
  const s = newGame(players || people(2), { seed: 'trade' });
  const a = quietTurn(s);
  const b = s.players.find((x) => x !== a);
  a.cash = 50000; b.cash = 80000;
  a.holdings = {}; b.holdings = {};
  a.properties.push({ id: 'rent1', name: 'Test Duplex', icon: '🏘️', units: 2, purchasePrice: 200000, cost: 30000, reIndexAtPurchase: s.market.reIndex, valueMult: 1, localMult: 1,
    rent: 2400, opex: 700, str: false, land: false, mortgage: { balance: 150000, apr: 6, payment: 900 }, rehabLeft: 0, arvMult: 1, boughtRound: 0 });
  return { s, a, b };
}

test('a person can sell a rental to another person at their own price; the mortgage goes with it', () => {
  const { s, a, b } = tradeGame();
  const offer = { to: b.id, give: { items: [{ kind: 'property', id: 'rent1' }] }, get: { cash: 60000 } };
  const r = E.proposeTrade(s, offer);
  assert.equal(r.ok, true);
  assert.equal(r.pending, true, 'the other person has to answer');
  assert.equal(E.endTurn(s).ok, false, 'the turn can\'t end while an offer is waiting');
  assert.equal(E.proposeTrade(s, offer).ok, false, 'one offer at a time');
  const ans = E.answerTrade(s, true);
  assert.equal(ans.ok, true, ans.msg);
  assert.equal(a.properties.length, 0);
  const prop = b.properties.find((x) => x.id === 'rent1');
  assert.ok(prop, 'the buyer owns it now');
  assert.equal(prop.mortgage.balance, 150000, 'the mortgage came with it');
  assert.equal(prop.cost, 60000, 'the buyer\'s cost is what they paid');
  assert.equal(prop.acquiredFrom, a.name);
  assert.ok(near(a.cash, 110000));
  assert.ok(near(b.cash, 20000));
  assert.equal(C.summarize(s, b).realEstate, 800, 'the rent now goes to the buyer');
  assert.equal(a.stats.trades, 1);
  assert.equal(E.endTurn(s).ok, true);
});

test('declining a trade changes nothing', () => {
  const { s, a, b } = tradeGame();
  const before = E.serialize(s);
  assert.equal(E.proposeTrade(s, { to: b.id, give: { items: [{ kind: 'property', id: 'rent1' }] }, get: { cash: 1000 } }).pending, true);
  const r = E.answerTrade(s, false);
  assert.equal(r.ok, true);
  assert.equal(r.accepted, false);
  const after = JSON.parse(E.serialize(s));
  const was = JSON.parse(before);
  assert.deepEqual(after.players, was.players);
});

test('swaps can mix assets, shares of stock and cash on both sides', () => {
  const { s, a, b } = tradeGame();
  const idx = s.market.securities.idx;
  b.holdings.idx = { shares: 100, costBasis: 9000 };
  b.notes.push({ id: 'n1', name: 'Test Note', icon: '📜', principal: 20000, rate: 10, monthsLeft: 24, defaultRisk: 0 });
  const r = E.proposeTrade(s, { to: b.id, give: { cash: 5000, items: [{ kind: 'property', id: 'rent1' }] }, get: { items: [{ kind: 'stock', id: 'idx', shares: 40 }, { kind: 'note', id: 'n1' }] } });
  assert.equal(r.pending, true);
  assert.equal(E.answerTrade(s, true).ok, true);
  assert.equal(a.holdings.idx.shares, 40);
  assert.equal(b.holdings.idx.shares, 60);
  assert.ok(near(b.holdings.idx.costBasis, 5400), 'the seller keeps the cost basis of the shares it kept');
  assert.ok(a.notes.some((n) => n.id === 'n1'));
  assert.ok(b.properties.some((x) => x.id === 'rent1'));
  // What a paid (cash + the duplex's equity) is split across what it got, in proportion to value.
  const paid = 5000 + (C.propertyValue(s, b.properties[0]) - 150000);
  assert.ok(near(a.holdings.idx.costBasis, paid * (40 * idx.price) / (40 * idx.price + 20000), 0.02));
});

test('trades are checked: you can only trade what you own and the cash you have', () => {
  const { s, a, b } = tradeGame(people(3));
  const c = s.players.find((x) => x !== a && x !== b);
  const bad = (offer, why) => { const r = E.proposeTrade(s, offer); assert.equal(r.ok, false, why); return r.msg; };
  bad({ to: b.id, give: {}, get: { cash: 100 } }, 'cash alone is not a trade');
  bad({ to: b.id, give: { items: [{ kind: 'property', id: 'rent1' }] }, get: { cash: 1e9 } }, 'the buyer can\'t pay');
  bad({ to: b.id, give: { cash: 1e9, items: [{ kind: 'property', id: 'rent1' }] } }, 'you can\'t pay');
  bad({ to: b.id, give: { items: [{ kind: 'property', id: 'nope' }] } }, 'not yours');
  bad({ to: b.id, give: { items: [{ kind: 'property', id: 'rent1' }, { kind: 'property', id: 'rent1' }] } }, 'listed twice');
  bad({ to: b.id, give: { items: [{ kind: 'stock', id: 'idx', shares: 5 }] } }, 'no shares to give');
  bad({ to: b.id, give: { cash: -5, items: [{ kind: 'property', id: 'rent1' }] } }, 'negative cash');
  bad({ to: a.id, give: { items: [{ kind: 'property', id: 'rent1' }] } }, 'not with yourself');
  c.finished = true;
  bad({ to: c.id, give: { items: [{ kind: 'property', id: 'rent1' }] } }, 'finished players are out of the race');
  s.phase = 'handoff';
  bad({ to: b.id, give: { items: [{ kind: 'property', id: 'rent1' }] } }, 'only during your turn');
});

test('computer opponents accept trades that leave them better off and refuse lowballs', () => {
  for (const level of ['easy', 'normal', 'hard']) {
    const { s, a, b } = tradeGame([{ name: 'Me' }, { name: 'Bot', bot: level }]);
    const equity = C.propertyValue(s, a.properties[0]) - 150000;
    const low = E.proposeTrade(s, { to: b.id, give: {}, get: { items: [] } });
    assert.equal(low.ok, false);
    // A bargain for the bot: it gets the duplex's equity for half price.
    const r = E.proposeTrade(s, { to: b.id, give: { items: [{ kind: 'property', id: 'rent1' }] }, get: { cash: Math.round(equity / 2) } });
    assert.equal(r.ok, true);
    assert.equal(r.accepted, true, `${level} bot takes a bargain`);
    assert.ok(b.properties.some((x) => x.id === 'rent1'));
    // Now try to buy it back for a tenth of its equity.
    const back = E.proposeTrade(s, { to: b.id, give: { cash: Math.round(equity / 10) }, get: { items: [{ kind: 'property', id: 'rent1' }] } });
    assert.equal(back.ok, true);
    assert.equal(back.accepted, false, `${level} bot refuses a lowball`);
  }
});

test('a bot stops listening after three turned-down offers in one turn', () => {
  const { s, a, b } = tradeGame([{ name: 'Me' }, { name: 'Bot', bot: 'hard' }]);
  b.notes.push({ id: 'n2', name: 'Note', icon: '📜', principal: 30000, rate: 10, monthsLeft: 24, defaultRisk: 0 });
  const lowball = { to: b.id, give: { cash: 100 }, get: { items: [{ kind: 'note', id: 'n2' }] } };
  for (let i = 0; i < E.MAX_BOT_OFFERS; i++) assert.equal(E.proposeTrade(s, lowball).accepted, false);
  const r = E.proposeTrade(s, { to: b.id, give: { cash: 40000 }, get: { items: [{ kind: 'note', id: 'n2' }] } });
  assert.equal(r.ok, false);
  assert.match(r.msg, /won't hear more/);
});

test('a waiting trade offer survives a save and load', () => {
  const { s, b } = tradeGame();
  E.proposeTrade(s, { to: b.id, give: { items: [{ kind: 'property', id: 'rent1' }] }, get: { cash: 1000 } });
  const loaded = E.deserialize(E.serialize(s));
  assert.ok(loaded.turn.pendingTrade);
  assert.equal(E.answerTrade(loaded, true).ok, true);
  assert.ok(C.getPlayer(loaded, b.id).properties.some((x) => x.id === 'rent1'));
});

test('tradeable assets list everything but your home, options and shorts', () => {
  const { s, a } = tradeGame();
  a.holdings.idx = { shares: 10, costBasis: 1000 };
  a.collectibles.push({ id: 'cl', name: 'Watch', icon: '⌚', cost: 5000, value: 6000, vol: 0.05, drift: 0, upkeep: 0 });
  const kinds = T.tradeableAssets(s, a).map((x) => x.kind).sort();
  assert.deepEqual(kinds, ['collectible', 'property', 'stock']);
});
