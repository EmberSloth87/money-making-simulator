/*
 * trade.js — Player-to-player trades (multiplayer).
 *
 * The player whose turn it is offers a trade to any other player still in the race. Each side
 * can put in any of its assets (rentals, land, businesses, side projects, startup stakes,
 * lending notes, collectibles, shares of stock) plus cash, priced however the two of them like.
 * A loan attached to an asset — a rental's mortgage or a business loan — goes with it, so the
 * new owner takes over its payments. No DOM access: runs in the browser and in Node.
 */
(function (global) {
  'use strict';
  const MMS = global.MMS || (global.MMS = {});
  const C = () => MMS.Core;

  const KINDS = ['property', 'business', 'note', 'collectible', 'stock'];
  const LISTS = { property: 'properties', business: 'businesses', note: 'notes', collectible: 'collectibles' };

  // ------------------------------------------------------------------ what can be traded
  /**
   * Everything a player could trade away. `value` is the market value, `loan` any debt that
   * comes with it, `equity` = value − loan, `cashflow` = what it adds to (or costs) its owner per month.
   */
  function tradeableAssets(state, p) {
    const c = C();
    const out = [];
    for (const pr of p.properties) {
      const value = c.propertyValue(state, pr);
      const loan = pr.mortgage ? pr.mortgage.balance : 0;
      out.push({ kind: 'property', id: pr.id, icon: pr.icon, name: pr.name, value, loan, equity: value - loan, cashflow: c.propertyCashflow(pr),
        note: pr.rehabLeft > 0 ? `renovating, ${pr.rehabLeft} turn${pr.rehabLeft === 1 ? '' : 's'} left` : pr.land ? 'land' : '' });
    }
    for (const b of p.businesses) {
      const value = c.businessValue(b);
      const loan = b.loan ? b.loan.balance : 0;
      out.push({ kind: 'business', id: b.id, icon: b.icon, name: b.name, value, loan, equity: value - loan,
        cashflow: b.kind === 'startup' ? 0 : c.businessCashflow(b),
        note: b.kind === 'startup' ? `startup stake, outcome in ~${Math.max(0, b.monthsLeft)} turns` : b.rampLeft > 0 ? `launching, ${b.rampLeft} turn${b.rampLeft === 1 ? '' : 's'} left` : b.kind === 'side' ? 'side project' : '' });
    }
    for (const n of p.notes) {
      out.push({ kind: 'note', id: n.id, icon: n.icon, name: n.name, value: n.principal, loan: 0, equity: n.principal, cashflow: c.noteIncome(n),
        note: `${n.rate.toFixed(1)}%, ${n.monthsLeft} months left` });
    }
    for (const it of p.collectibles) {
      out.push({ kind: 'collectible', id: it.id, icon: it.icon, name: it.name, value: it.value, loan: 0, equity: it.value, cashflow: -(it.upkeep || 0), note: '' });
    }
    for (const id of Object.keys(p.holdings)) {
      const h = p.holdings[id];
      const sec = state.market.securities[id];
      if (!sec || sec.delisted || !(h.shares > 0)) continue;
      out.push({ kind: 'stock', id, icon: sec.icon, name: `${sec.ticker} · ${sec.name}`, ticker: sec.ticker, maxShares: h.shares, price: sec.price, divPerShare: sec.div,
        value: h.shares * sec.price, loan: 0, equity: h.shares * sec.price, cashflow: h.shares * sec.div, note: `${h.shares.toLocaleString('en-US')} shares` });
    }
    return out;
  }

  // ------------------------------------------------------------------ checking an offer
  const cleanCash = (x) => {
    const n = Number(x || 0);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  };

  /** Resolve one side of an offer against what its owner actually holds. */
  function resolveSide(state, owner, side, problems) {
    const assets = tradeableAssets(state, owner);
    const items = [];
    const seen = new Set();
    for (const raw of (side && side.items) || []) {
      if (!raw || !KINDS.includes(raw.kind)) { problems.push('Unknown kind of asset.'); continue; }
      const key = `${raw.kind}:${raw.id}`;
      if (seen.has(key)) { problems.push('The same asset is listed twice.'); continue; }
      seen.add(key);
      const a = assets.find((x) => x.kind === raw.kind && x.id === raw.id);
      if (!a) { problems.push(`${owner.name} doesn't own that asset anymore.`); continue; }
      if (raw.kind === 'stock') {
        const shares = Math.floor(Number(raw.shares));
        if (!(shares >= 1)) continue; // zero shares = not part of the trade
        if (shares > a.maxShares) { problems.push(`${owner.name} only owns ${a.maxShares.toLocaleString('en-US')} ${a.ticker}.`); continue; }
        items.push(Object.assign({}, a, { shares, value: shares * a.price, equity: shares * a.price, cashflow: shares * a.divPerShare, note: `${shares.toLocaleString('en-US')} shares` }));
      } else {
        items.push(a);
      }
    }
    const cash = cleanCash(side && side.cash);
    if (!(cash >= 0)) problems.push('Cash amounts must be zero or more.');
    else if (cash > owner.cash + 0.001) problems.push(`${owner.name} only has ${C().money(owner.cash)} in cash.`);
    const sum = (f) => items.reduce((t, x) => t + f(x), 0);
    return { cash: cash >= 0 ? cash : 0, items, value: sum((x) => x.value), loan: sum((x) => x.loan), equity: sum((x) => x.equity), cashflow: sum((x) => x.cashflow) };
  }

  /**
   * Check an offer { from, to, give: { cash, items }, get: { cash, items } } and work out everything
   * about it. `give` is what `from` hands over; `get` is what `from` receives from `to`.
   * Items are { kind, id } — plus { shares } for stock.
   */
  function describe(state, offer) {
    const c = C();
    const from = offer && c.getPlayer(state, offer.from);
    const to = offer && c.getPlayer(state, offer.to);
    const problems = [];
    if (!from || !to) return { ok: false, reason: 'Choose who to trade with.' };
    if (from === to) return { ok: false, reason: 'You can\'t trade with yourself.' };
    if (from.finished || to.finished) return { ok: false, reason: 'Players who have reached financial freedom are out of the race and can\'t trade.' };
    const give = resolveSide(state, from, offer.give, problems);
    const get = resolveSide(state, to, offer.get, problems);
    if (!problems.length && !give.items.length && !get.items.length) problems.push('Add at least one asset to the trade.');
    return {
      ok: !problems.length, reason: problems[0] || null,
      from, to, give, get,
      // From the proposer's side: positive = they come out ahead at market value.
      netValue: (get.equity + get.cash) - (give.equity + give.cash),
      netCashflow: get.cashflow - give.cashflow
    };
  }

  /** The same trade seen by one of the two players: { gives, gets, netValue, netCashflow }. */
  function perspective(d, playerId) {
    const mine = d.from.id === playerId;
    return {
      me: mine ? d.from : d.to, other: mine ? d.to : d.from,
      gives: mine ? d.give : d.get, gets: mine ? d.get : d.give,
      netValue: mine ? d.netValue : -d.netValue,
      netCashflow: mine ? d.netCashflow : -d.netCashflow
    };
  }

  // ------------------------------------------------------------------ carrying it out
  function takeItem(p, it) {
    if (it.kind === 'stock') {
      const h = p.holdings[it.id];
      const basis = h.costBasis * it.shares / h.shares;
      h.shares -= it.shares;
      h.costBasis = C().cents(h.costBasis - basis);
      if (h.shares <= 0) delete p.holdings[it.id];
      return { shares: it.shares };
    }
    const list = p[LISTS[it.kind]];
    const i = list.findIndex((x) => x.id === it.id);
    return list.splice(i, 1)[0];
  }

  /** Hand an asset to its new owner. `basis` = what they paid for it (their share of the price). */
  function putItem(state, p, it, obj, basis, fromName) {
    const c = C();
    basis = c.cents(basis);
    if (it.kind === 'stock') {
      const h = p.holdings[it.id] || (p.holdings[it.id] = { shares: 0, costBasis: 0 });
      h.shares += obj.shares;
      h.costBasis = c.cents(h.costBasis + basis);
      return;
    }
    obj.boughtRound = state.round;
    obj.acquiredFrom = fromName;
    if (it.kind === 'property') obj.cost = basis;
    if (it.kind === 'business') obj.cashInvested = basis;
    if (it.kind === 'collectible') obj.cost = basis;
    p[LISTS[it.kind]].push(obj);
  }

  /**
   * What each side paid for what it receives: the cash it hands over plus the market value of the
   * assets it gives up, split across the incoming assets in proportion to their value.
   */
  function allocate(items, paid) {
    const w = items.map((x) => Math.max(1, x.equity));
    const total = w.reduce((a, b) => a + b, 0);
    return items.map((_, i) => paid * w[i] / total);
  }

  function itemLabel(it) {
    if (it.kind === 'stock') return `${it.shares.toLocaleString('en-US')} ${it.ticker}`;
    return `${it.name}${it.loan > 0 ? ` (with its ${C().money(it.loan)} loan)` : ''}`;
  }

  function sideText(side) {
    const parts = side.items.map(itemLabel);
    if (side.cash > 0) parts.push(C().money(side.cash));
    return parts.length ? parts.join(', ') : 'nothing';
  }

  /** Carry out a trade both players agreed to. Returns { ok, msg }. */
  function execute(state, offer) {
    const c = C();
    const d = describe(state, offer);
    if (!d.ok) return { ok: false, msg: d.reason };
    const { from, to, give, get } = d;
    const fromPaid = give.cash + give.items.reduce((t, x) => t + Math.max(0, x.equity), 0);
    const toPaid = get.cash + get.items.reduce((t, x) => t + Math.max(0, x.equity), 0);
    const fromBasis = allocate(get.items, fromPaid);
    const toBasis = allocate(give.items, toPaid);

    // Take everything off both sides first, then hand it over.
    const giveObjs = give.items.map((it) => takeItem(from, it));
    const getObjs = get.items.map((it) => takeItem(to, it));
    give.items.forEach((it, i) => putItem(state, to, it, giveObjs[i], toBasis[i], from.name));
    get.items.forEach((it, i) => putItem(state, from, it, getObjs[i], fromBasis[i], to.name));
    from.cash = c.cents(from.cash - give.cash + get.cash);
    to.cash = c.cents(to.cash - get.cash + give.cash);
    from.stats.trades = (from.stats.trades || 0) + 1;
    to.stats.trades = (to.stats.trades || 0) + 1;

    const gave = sideText(give), got = sideText(get);
    c.log(state, `🤝 ${from.name} traded ${gave} to ${to.name} for ${got}.`, 'neutral', from.id);
    const cf = d.netCashflow;
    return {
      ok: true,
      msg: `🤝 Trade done with ${to.name}: you gave ${gave} and got ${got}. Your monthly cashflow ${Math.abs(cf) < 0.5 ? 'is unchanged' : `${cf > 0 ? 'rises' : 'falls'} by ${c.money(Math.abs(cf))}`}.`
    };
  }

  MMS.Trade = { KINDS, tradeableAssets, describe, perspective, execute, itemLabel, sideText };
  if (typeof module !== 'undefined' && module.exports) module.exports = MMS.Trade;
})(typeof window !== 'undefined' ? window : globalThis);
