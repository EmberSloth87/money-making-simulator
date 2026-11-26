/*
 * options.js — Options contracts (calls, puts, straddles) and short selling.
 *
 *   • Options are priced with the Black–Scholes formula, using each security's
 *     current volatility, the central-bank rate and its dividend yield. Players
 *     buy at the "ask" and sell back at the "bid", so the bid/ask spread is a real cost.
 *   • One contract covers 100 shares. Options are cash-settled at the expiry month's
 *     payday: an option that finishes "in the money" pays its intrinsic value; one
 *     that finishes "out of the money" expires worthless.
 *   • Short selling: borrow shares and sell them now, hoping to buy them back cheaper.
 *     The sale proceeds plus a 50% margin deposit are held as collateral. Short sellers
 *     pay a monthly borrow fee and any dividends, and get a margin call (forced buy-back)
 *     if the price rises too far.
 */
(function (global) {
  'use strict';
  const MMS = global.MMS || (global.MMS = {});
  const C = () => MMS.Core;

  const CONTRACT = 100;            // shares per contract
  const EXPIRIES = [1, 3, 6];      // months
  const STRIKE_STEPS = [-0.1, -0.05, 0, 0.05, 0.1];
  const SPREAD = 0.04;             // ±4% around fair value
  const SHORT_MARGIN = 0.5;        // initial margin: 50% of the position, on top of the proceeds
  const MAINTENANCE = 1.3;         // margin call once collateral < 130% of the cost to buy back

  // ------------------------------------------------------------------ math
  /** Standard normal CDF (Abramowitz & Stegun 7.1.26, error < 1.5e-7). */
  function normCdf(x) {
    const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
    return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
  }

  /** Black–Scholes price per share. sigma & r & q are annual; T in years. */
  function blackScholes(kind, S, K, T, sigma, r, q) {
    if (kind === 'straddle') return blackScholes('call', S, K, T, sigma, r, q) + blackScholes('put', S, K, T, sigma, r, q);
    if (T <= 0 || sigma <= 0) return intrinsic(kind, S, K);
    const sq = sigma * Math.sqrt(T);
    const d1 = (Math.log(S / K) + (r - q + sigma * sigma / 2) * T) / sq;
    const d2 = d1 - sq;
    if (kind === 'call') return S * Math.exp(-q * T) * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
    return K * Math.exp(-r * T) * normCdf(-d2) - S * Math.exp(-q * T) * normCdf(-d1);
  }

  function intrinsic(kind, S, K) {
    if (kind === 'call') return Math.max(0, S - K);
    if (kind === 'put') return Math.max(0, K - S);
    return Math.abs(S - K);
  }

  /** Annual volatility used for pricing: the security's volatility right now. */
  function pricingVol(state, s) { return MMS.Market.currentVol(state, s) * Math.sqrt(12); }

  /** A "nice" strike spacing of at most 5% of the price, so there are always five distinct strikes. */
  function strikeStep(price) {
    const steps = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 2.5, 5, 10, 25, 50];
    let best = steps[0];
    for (const st of steps) if (st <= price * 0.05) best = st;
    return best;
  }

  /** Five strikes around today's price (about 10% below to 10% above). */
  function strikes(s) {
    const step = strikeStep(s.price);
    return STRIKE_STEPS.map((k) => Math.round(Math.max(step, Math.round(s.price * (1 + k) / step) * step) * 100) / 100);
  }

  /** A full quote for one contract type: fair value, bid and ask per share. */
  function quote(state, secId, kind, strike, months) {
    const s = state.market.securities[secId];
    const T = Math.max(0, months) / 12;
    const sigma = pricingVol(state, s);
    const r = state.market.rate / 100;
    const q = MMS.Market.currentYield(s);
    const fair = blackScholes(kind, s.price, strike, T, sigma, r, q);
    const legs = kind === 'straddle' ? 2 : 1;
    const ask = Math.max(0.01 * legs, fair * (1 + SPREAD) + 0.01 * legs);
    const bid = Math.max(0, fair * (1 - SPREAD) - 0.01 * legs);
    return { fair, bid, ask, sigma, T, price: s.price, strike, kind, months };
  }

  function monthsLeft(state, o) { return Math.max(0, o.expiresRound - state.round); }

  /** What an option position would fetch if sold now (at the bid). */
  function optionBid(state, o) {
    const s = state.market.securities[o.secId];
    if (!s) return 0;
    const m = monthsLeft(state, o);
    if (m <= 0) return intrinsic(o.kind, s.price, o.strike) * o.shares;
    return quote(state, o.secId, o.kind, o.strike, m).bid * o.shares;
  }

  /** Fair (mid) value of an option position, used for net worth. */
  function optionValue(state, o) {
    const s = state.market.securities[o.secId];
    if (!s) return 0;
    const m = monthsLeft(state, o);
    if (m <= 0) return intrinsic(o.kind, s.price, o.strike) * o.shares;
    return quote(state, o.secId, o.kind, o.strike, m).fair * o.shares;
  }

  function optionLabel(o) {
    const kind = { call: 'Call', put: 'Put', straddle: 'Straddle' }[o.kind];
    return `${o.ticker} $${o.strike.toFixed(o.strike < 10 ? 2 : 0)} ${kind}`;
  }

  /** Educational summary of a prospective trade: cost, break-even, max loss/gain. */
  function describe(q, contracts) {
    const shares = contracts * CONTRACT;
    const cost = q.ask * shares;
    const K = q.strike;
    const prem = q.ask;
    const out = { cost, shares, maxLoss: cost };
    if (q.kind === 'call') {
      out.breakeven = [K + prem];
      out.maxGain = Infinity;
      out.story = `You profit if the price is above $${(K + prem).toFixed(2)} when the option expires. If it ends below $${K.toFixed(2)}, the option expires worthless and you lose the ${C().money(cost)} you paid.`;
    } else if (q.kind === 'put') {
      out.breakeven = [K - prem];
      out.maxGain = Math.max(0, (K - prem) * shares);
      out.story = `You profit if the price falls below $${Math.max(0, K - prem).toFixed(2)} by expiry. If it ends above $${K.toFixed(2)}, the option expires worthless and you lose the ${C().money(cost)} you paid.`;
    } else {
      out.breakeven = [Math.max(0, K - prem), K + prem];
      out.maxGain = Infinity;
      out.story = `A bet on a BIG move in either direction: you profit if the price ends below $${Math.max(0, K - prem).toFixed(2)} or above $${(K + prem).toFixed(2)}. If the price barely moves, you lose most of the ${C().money(cost)}.`;
    }
    return out;
  }

  // ------------------------------------------------------------------ trading
  function buyOption(state, p, secId, kind, strike, months, contracts) {
    const { cents, money, log, nextId } = C();
    const s = state.market.securities[secId];
    contracts = Math.floor(Number(contracts));
    months = Number(months);
    strike = Number(strike);
    if (!s) return { ok: false, msg: 'Unknown security.' };
    if (!['call', 'put', 'straddle'].includes(kind)) return { ok: false, msg: 'Unknown option type.' };
    if (!EXPIRIES.includes(months)) return { ok: false, msg: 'Pick an expiry of 1, 3 or 6 months.' };
    if (!strikes(s).includes(strike)) return { ok: false, msg: 'That strike price is no longer offered — prices have moved.' };
    if (!(contracts >= 1)) return { ok: false, msg: 'Enter how many contracts to buy.' };
    const q = quote(state, secId, kind, strike, months);
    const cost = cents(q.ask * contracts * CONTRACT);
    if (cost > p.cash + 0.001) return { ok: false, msg: `${contracts} contract${contracts > 1 ? 's' : ''} cost ${money(cost)}, but you have ${money(p.cash)}.` };
    p.cash = cents(p.cash - cost);
    const o = {
      id: nextId(state, 'o'), secId, ticker: s.ticker, kind, strike, contracts, shares: contracts * CONTRACT,
      cost, boughtRound: state.round, expiresRound: state.round + months
    };
    p.options.push(o);
    p.stats.optionTrades = (p.stats.optionTrades || 0) + 1;
    log(state, `${p.name} bought ${contracts} ${optionLabel(o)} contract${contracts > 1 ? 's' : ''} for ${money(cost)}.`, 'neutral', p.id);
    return { ok: true, msg: `Bought ${contracts} ${optionLabel(o)} contract${contracts > 1 ? 's' : ''} (${o.shares.toLocaleString('en-US')} shares) for ${money(cost)}, expiring in ${months} month${months > 1 ? 's' : ''}.` };
  }

  function sellOption(state, p, optionId) {
    const { cents, money, log } = C();
    const o = p.options.find((x) => x.id === optionId);
    if (!o) return { ok: false, msg: 'That option position is gone.' };
    const proceeds = cents(optionBid(state, o));
    const gain = proceeds - o.cost;
    p.cash = cents(p.cash + proceeds);
    p.options = p.options.filter((x) => x !== o);
    p.stats.realizedGains += gain;
    log(state, `${p.name} sold ${optionLabel(o)} for ${money(proceeds)}.`, 'neutral', p.id);
    return { ok: true, msg: `Sold your ${optionLabel(o)} for ${money(proceeds)} — ${gain >= 0 ? 'a profit' : 'a loss'} of ${money(Math.abs(gain))}.` };
  }

  function shortSell(state, p, secId, shares) {
    const { cents, money, log } = C();
    const s = state.market.securities[secId];
    shares = Math.floor(Number(shares));
    if (!s) return { ok: false, msg: 'Unknown security.' };
    if (!(shares >= 1)) return { ok: false, msg: 'Enter how many shares to short.' };
    const value = cents(shares * s.price);
    const margin = cents(value * SHORT_MARGIN);
    if (margin > p.cash + 0.001) return { ok: false, msg: `Shorting ${shares.toLocaleString('en-US')} shares needs a ${money(margin)} margin deposit, but you have ${money(p.cash)}. You can short up to ${Math.floor(p.cash / (s.price * SHORT_MARGIN)).toLocaleString('en-US')}.` };
    p.cash = cents(p.cash - margin);
    const sh = p.shorts[secId] || (p.shorts[secId] = { shares: 0, proceeds: 0, collateral: 0, openedRound: state.round });
    sh.shares += shares;
    sh.proceeds = cents(sh.proceeds + value);
    sh.collateral = cents(sh.collateral + value + margin);
    log(state, `${p.name} shorted ${shares.toLocaleString('en-US')} ${s.ticker} @ $${s.price.toFixed(2)}.`, 'neutral', p.id);
    return { ok: true, msg: `Shorted ${shares.toLocaleString('en-US')} ${s.ticker} at $${s.price.toFixed(2)}. ${money(value + margin)} is held as collateral (the sale plus your ${money(margin)} deposit). You profit if ${s.ticker} falls.` };
  }

  /** Buy back shorted shares. Returns the realized gain on the covered part. */
  function closeShort(state, p, secId, shares, price) {
    const { cents } = C();
    const sh = p.shorts[secId];
    const frac = shares / sh.shares;
    const release = cents(sh.collateral * frac);
    const proceedsPart = cents(sh.proceeds * frac);
    const cost = cents(shares * price);
    p.cash = cents(p.cash + release - cost);
    sh.shares -= shares;
    sh.collateral = cents(sh.collateral - release);
    sh.proceeds = cents(sh.proceeds - proceedsPart);
    if (sh.shares <= 0) delete p.shorts[secId];
    const gain = proceedsPart - cost;
    p.stats.realizedGains += gain;
    return { gain, cost, release };
  }

  function coverShort(state, p, secId, shares) {
    const { money, log } = C();
    const s = state.market.securities[secId];
    const sh = p.shorts[secId];
    shares = Math.floor(Number(shares));
    if (!s || !sh) return { ok: false, msg: 'You have no short position there.' };
    if (!(shares >= 1)) return { ok: false, msg: 'Enter how many shares to buy back.' };
    if (shares > sh.shares) return { ok: false, msg: `You are only short ${sh.shares.toLocaleString('en-US')} shares.` };
    const r = closeShort(state, p, secId, shares, s.price);
    log(state, `${p.name} covered ${shares.toLocaleString('en-US')} ${s.ticker} short @ $${s.price.toFixed(2)}.`, 'neutral', p.id);
    return { ok: true, msg: `Bought back ${shares.toLocaleString('en-US')} ${s.ticker} for ${money(r.cost)} — ${r.gain >= 0 ? 'a profit' : 'a loss'} of ${money(Math.abs(r.gain))} on the short.` };
  }

  function borrowRate(s) { return s.penny || s.crypto ? 0.015 : s.vol > 0.1 ? 0.006 : 0.0025; }

  /** Monthly cost of holding short positions: borrow fees + dividends owed to the lender. */
  function shortCarry(state, p) {
    let t = 0;
    for (const id in p.shorts || {}) {
      const s = state.market.securities[id];
      const sh = p.shorts[id];
      if (s) t += sh.shares * (s.price * borrowRate(s) + s.div);
    }
    return t;
  }

  function shortLiability(state, p) {
    let t = 0;
    for (const id in p.shorts || {}) {
      const s = state.market.securities[id];
      if (s) t += p.shorts[id].shares * s.price;
    }
    return t;
  }

  function shortCollateral(p) {
    let t = 0;
    for (const id in p.shorts || {}) t += p.shorts[id].collateral;
    return t;
  }

  /** Price at which a short position gets a margin call. */
  function marginCallPrice(sh) { return sh.collateral / MAINTENANCE / sh.shares; }

  /**
   * Payday processing: expire options, charge short carry, enforce margin calls.
   * Returns { optionCash, carry, popups }.
   */
  function settle(state, p, notes) {
    const { cents, money, log } = C();
    const popups = [];
    let optionCash = 0;
    for (const o of (p.options || []).slice()) {
      if (state.round < o.expiresRound) continue;
      const s = state.market.securities[o.secId];
      const px = s ? s.price : 0;
      const pay = cents(intrinsic(o.kind, px, o.strike) * o.shares);
      const gain = pay - o.cost;
      optionCash += pay;
      p.stats.realizedGains += gain;
      p.options = p.options.filter((x) => x !== o);
      const label = optionLabel(o);
      const text = pay > 0
        ? `${o.ticker} finished at $${px.toFixed(2)}, so your ${label} expired in the money and paid ${money(pay)}. You had paid ${money(o.cost)} — ${gain >= 0 ? 'a profit' : 'a loss'} of ${money(Math.abs(gain))}.`
        : `${o.ticker} finished at $${px.toFixed(2)}, so your ${label} expired worthless. The ${money(o.cost)} premium is gone.`;
      popups.push({
        icon: pay > o.cost ? '🎯' : '⌛', tone: gain >= 0 ? 'good' : 'bad',
        title: `Option expired: ${label}`, text,
        lesson: 'Options are "wasting assets": as time runs out, the chance of a big move shrinks, so their value decays. Most options bought by small investors expire worthless.'
      });
      log(state, `${p.name}'s ${label} expired (${pay > 0 ? `paid ${money(pay)}` : 'worthless'}).`, gain >= 0 ? 'good' : 'bad', p.id);
    }

    const carry = cents(shortCarry(state, p));
    for (const id of Object.keys(p.shorts || {})) {
      const s = state.market.securities[id];
      const sh = p.shorts[id];
      if (!s) continue;
      if (sh.shares * s.price * MAINTENANCE > sh.collateral) {
        const shares = sh.shares;
        const r = closeShort(state, p, id, shares, s.price);
        const shortfall = Math.max(0, r.cost - r.release);
        popups.push({
          icon: '🚨', tone: 'bad', title: `Margin call: ${s.ticker}`,
          text: `${s.ticker} rose to $${s.price.toFixed(2)}, and your collateral no longer covered the risk. Your broker forced you to buy back all ${shares.toLocaleString('en-US')} shares for ${money(r.cost)}. Loss on the short: ${money(Math.abs(r.gain))}.${shortfall > 0 ? ` Your collateral fell ${money(shortfall)} short, which came out of your cash.` : ''}`,
          lesson: 'A stock can only fall to $0, but it can rise without limit — so a short seller\'s possible loss is unlimited. Margin calls force you to sell at the worst moment.'
        });
        log(state, `${p.name} got a margin call on their ${s.ticker} short (${money(r.gain)}).`, 'bad', p.id);
      }
    }
    if (notes && carry > 0) notes.push(`📉 Your short positions cost ${money(carry)} this month in borrow fees and dividends owed to the share lender.`);
    return { optionCash, carry, popups };
  }

  /** Called by the market when a security splits k-for-1. */
  function applySplit(state, id, k) {
    for (const p of state.players) {
      for (const o of p.options || []) if (o.secId === id) { o.shares *= k; o.strike = Math.round(o.strike / k * 10000) / 10000; }
      if (p.shorts && p.shorts[id]) p.shorts[id].shares *= k;
    }
  }

  /** Called by the market when a company goes bankrupt (price → 0) before it is replaced. */
  function applyBankruptcy(state, id) {
    const { cents, money, log } = C();
    for (const p of state.players) {
      for (const o of (p.options || []).slice()) {
        if (o.secId !== id) continue;
        const pay = cents(intrinsic(o.kind, 0, o.strike) * o.shares);
        p.cash = cents(p.cash + pay);
        p.stats.realizedGains += pay - o.cost;
        p.options = p.options.filter((x) => x !== o);
        log(state, `${p.name}'s ${optionLabel(o)} settled at $0 after the bankruptcy: ${pay > 0 ? `paid ${money(pay)}` : 'worthless'}.`, pay > o.cost ? 'good' : 'bad', p.id);
      }
      if (p.shorts && p.shorts[id]) {
        const sh = p.shorts[id];
        const r = closeShort(state, p, id, sh.shares, 0);
        log(state, `${p.name}'s short on the bankrupt company closed at $0 — a profit of ${money(r.gain)}.`, 'good', p.id);
      }
    }
  }

  MMS.Options = {
    CONTRACT, EXPIRIES, SHORT_MARGIN, MAINTENANCE,
    normCdf, blackScholes, intrinsic, pricingVol, strikes, quote, describe, monthsLeft,
    optionBid, optionValue, optionLabel, buyOption, sellOption, shortSell, coverShort,
    borrowRate, shortCarry, shortLiability, shortCollateral, marginCallPrice, settle, applySplit, applyBankruptcy
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = MMS.Options;
})(typeof window !== 'undefined' ? window : globalThis);
