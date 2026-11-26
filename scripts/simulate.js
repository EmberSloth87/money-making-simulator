#!/usr/bin/env node
/*
 * Balance simulator: plays many all-bot games with the game's own computer
 * opponents (js/ai.js) and reports how long it takes to reach financial freedom.
 *
 *   node scripts/simulate.js [games=200] [players=2] [level=normal|easy|hard|mix]
 */
'use strict';
const MMS = require('../js/engine.js');
const { Engine: E, Core: C, AI } = MMS;

const GAMES = Number(process.argv[2]) || 200;
const PLAYERS = Number(process.argv[3]) || 2;
const LEVEL = process.argv[4] || 'normal';
const MAX_ROUNDS = 200;
if (LEVEL !== 'mix' && !AI.LEVELS[LEVEL]) {
  console.error(`Unknown level "${LEVEL}". Use ${AI.LEVEL_IDS.join(', ')} or mix.`);
  process.exit(2);
}

const results = [];
const winsByLevel = {};
let errors = 0;
for (let g = 0; g < GAMES; g++) {
  const players = Array.from({ length: PLAYERS }, (_, i) => ({
    name: `Bot ${i + 1}`,
    bot: LEVEL === 'mix' ? AI.LEVEL_IDS[(g + i) % AI.LEVEL_IDS.length] : LEVEL
  }));
  const state = E.createGame({ players, seed: `sim-${g}`, handoff: false });
  try {
    while (state.phase === 'handoff' && state.round <= MAX_ROUNDS) {
      const r = E.playBotTurn(state);
      if (!r.ok) throw new Error(r.msg);
      if (r.recap.won) {
        const p = C.getPlayer(state, r.recap.playerId);
        results.push({ round: state.round, level: p.bot.level });
        winsByLevel[p.bot.level] = (winsByLevel[p.bot.level] || 0) + 1;
        break;
      }
    }
    if (!state.winners.length) results.push({ round: Infinity });
  } catch (e) {
    errors++;
    console.error(`Game ${g} crashed:`, e);
  }
}

const won = results.filter((r) => Number.isFinite(r.round)).map((r) => r.round).sort((a, b) => a - b);
const q = (f) => won[Math.min(won.length - 1, Math.floor(f * won.length))];
console.log(`${GAMES} games, ${PLAYERS} players each, ${LEVEL} bots`);
console.log(`  first win reached in ${won.length}/${GAMES} games (within ${MAX_ROUNDS} months)`);
if (won.length) console.log(`  month of first win — 10%: ${q(0.1)}  median: ${q(0.5)}  90%: ${q(0.9)}`);
if (LEVEL === 'mix') console.log(`  first wins by level: ${AI.LEVEL_IDS.map((l) => `${l} ${winsByLevel[l] || 0}`).join(', ')}`);
console.log(`  crashes: ${errors}`);
process.exitCode = errors ? 1 : 0;
