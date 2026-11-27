/*
 * savings.js — Certificates of deposit (CDs): a safe place to park cash for a fixed term.
 *
 * How CDs work here (and in real life):
 *   • You lock up money for a term (3 months to 5 years) at a fixed APY.
 *   • Rates follow the central bank's rate, differ from bank to bank, and depend on the term:
 *     when rates are low, longer CDs pay more; when rates are high, the "yield curve" flattens
 *     or inverts and long CDs can pay LESS (banks expect rates to fall).
 *   • Interest is either paid out every month (passive income — it counts toward freedom)
 *     or left to compound inside the CD (grows faster, but you see none of it until maturity).
 *   • Cashing out early costs an early-withdrawal penalty of several months of interest.
 *   • Bank deposits are insured, so a CD can't lose money unless you break it early.
 *
 * CD rates for a month are derived from the game seed and the month, so they don't
 * disturb any other random draws, and every player sees the same rates.
 */
(function (global) {
  'use strict';
  const MMS = global.MMS || (global.MMS = {});
  const C = () => MMS.Core;

  /** Fictional banks. `spread` is how far their CD rates sit from the central bank rate. */
  const BANKS = [
    { id: 'online', name: 'BrightPath Online Bank', short: 'BrightPath (online)', icon: '💻', spread: -0.1, min: 1000,
      desc: 'An online-only bank: no branches to pay for, so it usually pays the best rates.' },
    { id: 'cu', name: 'Hometown Credit Union', short: 'Hometown CU', icon: '🏘️', spread: -0.4, min: 500,
      desc: 'A member-owned credit union: competitive rates and a low minimum deposit.' },
    { id: 'big', name: 'Big National Bank', short: 'Big National', icon: '🏛️', spread: -1.7, min: 1000,
      desc: 'A huge bank with branches everywhere — and famously stingy CD rates. It pays to shop around.' }
  ];
  const TERMS = [3, 6, 12, 24, 36, 60];
  const PROMO_TERMS = [7, 11, 13, 15, 18];

  const termLabel = (m) => (m % 12 === 0 && m >= 12 ? `${m / 12} year${m === 12 ? '' : 's'}` : `${m} months`);
  /** The term as an adjective: "a 2-year CD", "a 6-month CD". */
  const termAdj = (m) => (m % 12 === 0 && m >= 12 ? `${m / 12}-year` : `${m}-month`);

  /** Months of interest you forfeit for cashing out early (typical bank rules). */
  function penaltyMonths(term) {
    if (term < 12) return 3;
    if (term <= 24) return 6;
    return 12;
  }

  /** Monthly growth rate that compounds to the APY over a year. */
  const monthlyRate = (apy) => Math.pow(1 + apy / 100, 1 / 12) - 1;

  /**
   * How much extra (or less) a longer CD pays. Slope of the yield curve: steep and upward
   * when rates are low, flat or inverted when rates are high or a recession is expected.
   */
  function curveSlope(state) {
    const m = state.market;
    let slope = C().clamp(1.0 - 0.4 * (m.rate - 2.5), -0.8, 1.3);
    if (m.economy === 'recession') slope -= 0.25;
    if (m.economy === 'boom') slope += 0.1;
    return slope;
  }

  /** Build this month's CD rate board. */
  function buildOffers(state) {
    const { clamp, roundTo } = C();
    const m = state.market;
    const rng = MMS.RNG.makeRng({ rngState: MMS.RNG.seedFromString(`${state.seed}:cd:${state.round}:${m.rate}`) });
    const slope = curveSlope(state);
    const offers = [];
    const rateFor = (bank, term, extra) => {
      const premium = slope * Math.log(term / 3) / Math.log(20); // 3 mo → 0, 60 mo → full slope
      const noise = rng.float(-0.15, 0.15);
      return clamp(roundTo(m.rate + bank.spread + premium + noise + (extra || 0), 0.05), 0.05, 12);
    };
    for (const term of TERMS) {
      for (const bank of BANKS) {
        offers.push({ id: `${bank.id}-${term}`, bank: bank.id, term, apy: rateFor(bank, term), min: bank.min, promo: false });
      }
    }
    // Now and then a bank runs a "special": an odd term at a higher rate, with a bigger minimum.
    if (rng.chance(0.4)) {
      const bank = rng.pick(BANKS.slice(0, 2));
      const term = rng.pick(PROMO_TERMS);
      const best = Math.max(...offers.map((o) => o.apy));
      offers.push({ id: `promo-${bank.id}-${term}`, bank: bank.id, term, apy: clamp(roundTo(Math.max(best, rateFor(bank, term)) + rng.float(0.25, 0.7), 0.05), 0.1, 12.5), min: 5000, promo: true });
    }
    return { round: state.round, rate: m.rate, offers };
  }

  /** This month's CD offers (rebuilt when the month or the central bank rate changes). */
  function offers(state) {
    const m = state.market;
    if (!m.cds || m.cds.round !== state.round || m.cds.rate !== m.rate) m.cds = buildOffers(state);
    return m.cds.offers;
  }

  function refreshOffers(state) { state.market.cds = buildOffers(state); return state.market.cds.offers; }

  const bankOf = (id) => BANKS.find((b) => b.id === id) || BANKS[0];

  /** The best rate on the board for a term (or the best overall). */
  function bestOffer(state, term) {
    const list = offers(state).filter((o) => term == null || o.term === term);
    return list.reduce((a, o) => (!a || o.apy > a.apy ? o : a), null);
  }

  // ------------------------------------------------------------------ a player's CDs
  const cdValue = (cd) => cd.principal + (cd.accrued || 0);
  /** Interest the CD earns this month. */
  function cdMonthlyInterest(cd) {
    const r = monthlyRate(cd.apy);
    return cd.payout === 'monthly' ? cd.principal * r : cdValue(cd) * r;
  }
  /** Passive income from CDs: only interest that is paid out to you counts. */
  function cdIncome(p) {
    return C().sum(p.cds || [], (cd) => (cd.payout === 'monthly' ? Math.round(cdMonthlyInterest(cd) * 100) / 100 : 0));
  }
  function cdsValue(p) { return C().sum(p.cds || [], cdValue); }

  /** What breaking a CD today would cost and return. */
  function earlyWithdrawal(cd) {
    const months = penaltyMonths(cd.term);
    const penalty = C().cents(cd.principal * monthlyRate(cd.apy) * months);
    const value = cdValue(cd);
    return { months, penalty, value, net: C().cents(Math.max(0, value - penalty)) };
  }

  /** Value at maturity if left alone. */
  function maturityValue(cd) {
    if (cd.payout === 'monthly') return cd.principal;
    return cdValue(cd) * Math.pow(1 + monthlyRate(cd.apy), cd.monthsLeft);
  }

  /** Projection for a new CD: monthly income or the amount at maturity, and total interest. */
  function project(offer, amount, payout) {
    const r = monthlyRate(offer.apy);
    if (payout === 'monthly') {
      const monthly = amount * r;
      return { monthly, atMaturity: amount, interest: monthly * offer.term };
    }
    const atMaturity = amount * Math.pow(1 + r, offer.term);
    return { monthly: 0, atMaturity, interest: atMaturity - amount };
  }

  function openCD(state, p, offerId, amount, payout) {
    const { cents, money, nextId, log } = C();
    const o = offers(state).find((x) => x.id === offerId);
    if (!o) return { ok: false, msg: 'That CD offer is no longer available.' };
    amount = Math.floor(Number(amount) || 0);
    payout = payout === 'compound' ? 'compound' : 'monthly';
    if (amount < o.min) return { ok: false, msg: `This CD needs at least ${money(o.min)}.` };
    if (amount > p.cash + 0.001) return { ok: false, msg: `You only have ${money(p.cash)} in cash.` };
    const bank = bankOf(o.bank);
    const cd = {
      id: nextId(state, 'cd'), bank: bank.id, bankName: bank.name, icon: bank.icon, term: o.term, apy: o.apy,
      principal: amount, accrued: 0, monthsLeft: o.term, openedRound: state.round, payout, promo: !!o.promo, interestEarned: 0
    };
    p.cash = cents(p.cash - amount);
    (p.cds || (p.cds = [])).push(cd);
    log(state, `${p.name} opened a ${termAdj(o.term)} CD at ${bank.name}: ${money(amount)} at ${o.apy.toFixed(2)}% APY.`, 'good', p.id);
    const proj = project(o, amount, payout);
    const how = payout === 'monthly'
      ? `It pays you about ${money(proj.monthly)}/mo in interest (passive income) and returns your ${money(amount)} in ${termLabel(o.term)}.`
      : `Interest compounds inside the CD: it should be worth about ${money(proj.atMaturity)} in ${termLabel(o.term)}.`;
    return { ok: true, msg: `Opened a ${termAdj(o.term)} CD for ${money(amount)} at ${o.apy.toFixed(2)}% APY. ${how}` };
  }

  function breakCD(state, p, cdId) {
    const { cents, money, log } = C();
    const cd = (p.cds || []).find((x) => x.id === cdId);
    if (!cd) return { ok: false, msg: 'That CD no longer exists.' };
    const w = earlyWithdrawal(cd);
    p.cds = p.cds.filter((x) => x !== cd);
    p.cash = cents(p.cash + w.net);
    p.stats.cdPenalties = (p.stats.cdPenalties || 0) + Math.min(w.penalty, w.value);
    log(state, `${p.name} cashed out a CD early and paid a ${money(w.penalty)} penalty.`, 'bad', p.id);
    return { ok: true, msg: `Cashed out your ${cd.bankName} CD early: ${money(w.value)} minus a ${money(w.penalty)} penalty (${w.months} months of interest) = ${money(w.net)}.` };
  }

  /**
   * Payday for CDs: pay or compound interest, and return the money from CDs that mature.
   * Returns { interest, matured } — the cash paid out as interest and as matured CDs.
   */
  function settle(state, p, notes) {
    const { cents, money } = C();
    let interest = 0, matured = 0;
    for (const cd of (p.cds || []).slice()) {
      const earned = cents(cdMonthlyInterest(cd));
      cd.interestEarned = cents((cd.interestEarned || 0) + earned);
      p.stats.cdInterest = cents((p.stats.cdInterest || 0) + earned);
      if (cd.payout === 'monthly') interest += earned;
      else cd.accrued = cents((cd.accrued || 0) + earned);
      cd.monthsLeft--;
      if (cd.monthsLeft <= 0) {
        const value = cents(cdValue(cd));
        matured += value;
        p.cds = p.cds.filter((x) => x !== cd);
        notes.push(`🏦 Your ${termAdj(cd.term)} CD at ${cd.bankName} matured: ${money(value)} is back in your cash (${money(cd.interestEarned)} of interest earned in all). Open a new one in the Savings & CDs tab if you like.`);
      }
    }
    return { interest: cents(interest), matured: cents(matured) };
  }

  /** Divorce splits CDs like other savings: each CD is cut in half. Returns the amount given up. */
  function splitCDs(p) {
    const { cents } = C();
    let given = 0;
    for (const cd of p.cds || []) {
      const half = cents(cd.principal / 2), halfAcc = cents((cd.accrued || 0) / 2);
      given += half + halfAcc;
      cd.principal = cents(cd.principal - half);
      cd.accrued = cents((cd.accrued || 0) - halfAcc);
    }
    p.cds = (p.cds || []).filter((cd) => cd.principal >= 1);
    return given;
  }

  MMS.Savings = {
    BANKS, TERMS, termLabel, termAdj, penaltyMonths, monthlyRate, curveSlope, offers, refreshOffers, bestOffer, bankOf,
    cdValue, cdMonthlyInterest, cdIncome, cdsValue, earlyWithdrawal, maturityValue, project, openCD, breakCD, settle, splitCDs
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = MMS.Savings;
})(typeof window !== 'undefined' ? window : globalThis);
