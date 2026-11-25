#!/usr/bin/env node
/*
 * Balance simulator: plays many games with simple bot strategies and reports
 * how long it takes to reach financial freedom.
 *
 *   node scripts/simulate.js [games=200] [players=2]
 */
'use strict';
const MMS = require('../js/engine.js');
const { Engine: E, Core: C } = MMS;

const GAMES = Number(process.argv[2]) || 200;
const PLAYERS = Number(process.argv[3]) || 2;
const MAX_ROUNDS = 200;

/** A sensible-but-simple investor: buys cash-flowing deals, kills expensive debt. */
function playTurn(state) {
  const p = C.currentPlayer(state);
  for (const c of state.turn.cards) {
    if (c.resolved) continue;
    if (c.type === 'expense') E.resolveCard(state, c.id, p.cash >= c.data.cost + 500 ? 'cash' : 'credit');
    else if (c.type === 'charity') E.resolveCard(state, c.id, p.cash > c.data.amount * 6 ? 'donate' : 'decline');
    else if (c.type === 'sidegig') E.resolveCard(state, c.id, 'accept');
    else if (c.type === 'propoffer' || c.type === 'bizoffer') E.resolveCard(state, c.id, 'accept');
    else if (c.type === 'refi') E.resolveCard(state, c.id, 'accept');
    else if (c.type === 'expand') E.resolveCard(state, c.id, p.cash > c.data.cost * 1.5 ? 'invest' : 'decline');
    else if (c.type === 'deal') {
      const d = c.deal;
      const reserve = 1000;
      let want = false;
      if (d.cat === 'realestate' && !d.land) want = d.roi > 0.15;
      else if (d.cat === 'business' && d.kind === 'business') want = d.base != null ? d.roi > 0.15 : d.cash < p.cash * 0.3;
      else if (d.cat === 'business' && d.kind === 'side') want = d.cash < p.cash * 0.15;
      else if (d.cat === 'lending') want = p.cash > d.cash * 2;
      if (want && p.cash < d.cash + reserve) {
        const need = Math.ceil((d.cash + reserve - p.cash) / 1000) * 1000;
        if (need <= C.loanLimit(state, p)) E.borrow(state, need);
      }
      E.resolveCard(state, c.id, want && p.cash >= d.cash ? 'buy' : 'pass');
    } else E.resolveCard(state, c.id, c.choices[0].id);
    if (state.pendingWin) return;
  }
  // Pay off high-interest debt with spare cash.
  for (const d of p.debts.slice().sort((a, b) => b.apr - a.apr)) {
    if (d.apr >= 10 && p.cash > 3000) E.payDebt(state, d.id, Math.min(d.balance, p.cash - 3000));
  }
}

const results = [];
let errors = 0;
for (let g = 0; g < GAMES; g++) {
  const players = Array.from({ length: PLAYERS }, (_, i) => ({ name: `Bot ${i + 1}` }));
  const state = E.createGame({ players, seed: `sim-${g}`, handoff: false });
  try {
    while (state.phase !== 'gameover' && state.round <= MAX_ROUNDS) {
      if (state.phase === 'handoff') E.beginTurn(state);
      if (state.phase === 'turn') {
        if (!state.pendingWin) playTurn(state);
        if (state.pendingWin) {
          E.claimFreedom(state);
          results.push({ round: state.round, job: C.getPlayer(state, state.winners[state.winners.length - 1].id).job.title });
          break;
        }
        const r = E.endTurn(state, { force: true });
        if (!r.ok) throw new Error(r.msg);
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
console.log(`${GAMES} games, ${PLAYERS} players each, bot strategy`);
console.log(`  first win reached in ${won.length}/${GAMES} games (within ${MAX_ROUNDS} months)`);
if (won.length) console.log(`  month of first win — 10%: ${q(0.1)}  median: ${q(0.5)}  90%: ${q(0.9)}`);
console.log(`  crashes: ${errors}`);
process.exitCode = errors ? 1 : 0;
