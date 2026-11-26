'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const MMS = require('../js/engine.js');
const { Engine: E, Core: C, AI } = MMS;

const game = (players, extra) => E.createGame(Object.assign({ players, seed: 'ai-seed', handoff: false }, extra));

/** Play a solo bot game to the first win (or 200 months); returns the month or Infinity. */
function soloWinMonth(level, seed) {
  const s = E.createGame({ players: [{ name: 'B', bot: level }], seed });
  while (s.phase === 'handoff' && s.round <= 200) {
    const r = E.playBotTurn(s);
    assert.ok(r.ok, r.msg);
    if (r.recap.won) return s.round;
  }
  return Infinity;
}
const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];

test('players can be people or bots of a chosen level', () => {
  const s = game([{ name: 'Me' }, { name: 'Robo', bot: 'hard' }, { name: 'Odd', bot: 'nonsense' }]);
  assert.equal(s.players[0].bot, null);
  assert.equal(s.players[1].bot.level, 'hard');
  assert.equal(s.players[2].bot.level, 'normal', 'unknown levels fall back to normal');
  assert.deepEqual(E.humans(s).map((p) => p.name), ['Me']);
});

test('runBots plays every bot turn and stops at the next person', () => {
  const s = game([{ name: 'Me' }, { name: 'A', bot: 'easy' }, { name: 'B', bot: 'hard' }]);
  E.beginTurn(s);
  E.endTurn(s, { force: true });
  assert.equal(s.round, 1);
  const r = E.runBots(s);
  assert.equal(r.recaps.length, 2);
  assert.deepEqual(r.recaps.map((x) => C.getPlayer(s, x.playerId).name), ['A', 'B']);
  assert.equal(s.round, 2, 'the month ends after the last bot');
  assert.equal(s.phase, 'handoff');
  assert.equal(C.currentPlayer(s).name, 'Me');
  assert.equal(s.lastHumanId, s.players[0].id);
  for (const p of s.players.slice(1)) assert.equal(p.stats.turns, 1);
  // Nothing to do when it's a person's turn.
  assert.equal(E.runBots(s).recaps.length, 0);
  assert.equal(E.playBotTurn(s).ok, false);
});

test('a bot that goes first plays before the person', () => {
  const s = game([{ name: 'Robo', bot: 'normal' }, { name: 'Me' }]);
  E.runBots(s);
  assert.equal(C.currentPlayer(s).name, 'Me');
  assert.equal(s.round, 1);
});

test('bot recaps report payday and what the bot did', () => {
  const s = game([{ name: 'B', bot: 'hard' }, { name: 'Me' }]);
  const { recap } = E.playBotTurn(s);
  assert.equal(typeof recap.net, 'number');
  assert.ok(Array.isArray(recap.items));
  for (const it of recap.items) assert.equal(typeof it.text, 'string');
  assert.ok(Number.isFinite(recap.netWorth));
});

test('bots follow the rules: no crashes, no negative cash left unexplained, every required card settled', () => {
  for (const level of AI.LEVEL_IDS) {
    const s = E.createGame({ players: [{ name: 'X', bot: level }, { name: 'Y', bot: level }], seed: `rules-${level}`, timeLimit: 60 });
    let guard = 0;
    while (s.phase !== 'gameover' && guard++ < 500) {
      if (s.phase === 'victory') { E.continueGame(s); continue; }
      const r = E.playBotTurn(s);
      assert.ok(r.ok, r.msg);
      for (const p of s.players) assert.ok(p.cash >= -0.01, `${level}: cash went negative (${p.cash})`);
    }
    assert.equal(s.phase, 'gameover');
  }
});

test('a bot can win, and the game then waits on the remaining players', () => {
  const s = game([{ name: 'B', bot: 'hard' }, { name: 'Me' }]);
  const bot = s.players[0];
  // Make the bot rich in passive income.
  bot.businesses.push({ id: 'b-test', name: 'Money tree', icon: '🌳', kind: 'business', invested: 1, cashInvested: 1, base: 1e6, ret: 0, range: [0, 0], performance: 1, vol: 0, fail: false, risk: 'Low', rampLeft: 0, rampCashflow: 0, loan: null, boughtRound: 0 });
  const r = E.playBotTurn(s);
  assert.ok(r.recap.won);
  assert.equal(bot.place, 1);
  assert.equal(s.phase, 'victory');
  assert.ok(E.continueGame(s).ok);
  assert.equal(C.currentPlayer(s).name, 'Me');
});

test('finishGame ends an all-bot race', () => {
  const s = game([{ name: 'Me' }, { name: 'B', bot: 'normal' }]);
  assert.ok(E.finishGame(s).ok);
  assert.equal(s.phase, 'gameover');
  assert.equal(E.finishGame(s).ok, false);
});

test('harder bots reach freedom sooner', () => {
  const seeds = Array.from({ length: 24 }, (_, i) => `lvl-${i}`);
  const m = Object.fromEntries(AI.LEVEL_IDS.map((l) => [l, median(seeds.map((sd) => soloWinMonth(l, sd)))]));
  assert.ok(m.hard < m.normal, `hard ${m.hard} vs normal ${m.normal}`);
  assert.ok(m.normal < m.easy, `normal ${m.normal} vs easy ${m.easy}`);
});

test('bot games are reproducible from the seed', () => {
  const run = () => {
    const s = E.createGame({ players: [{ name: 'A', bot: 'easy' }, { name: 'B', bot: 'hard' }], seed: 'repro', timeLimit: 24 });
    while (s.phase !== 'gameover') { if (s.phase === 'victory') E.continueGame(s); else E.playBotTurn(s); }
    return s.players.map((p) => Math.round(C.summarize(s, p).netWorth));
  };
  assert.deepEqual(run(), run());
});

test('older saves without a bot field load as people', () => {
  const s = game([{ name: 'Me' }]);
  delete s.players[0].bot;
  const back = E.deserialize(JSON.stringify(s));
  assert.equal(back.players[0].bot, null);
});
