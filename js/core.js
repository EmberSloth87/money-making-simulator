/*
 * core.js — Finance math, player generation, debts, income/expense calculations
 * and the per-turn payday. No DOM access: runs in the browser and in Node.
 */
(function (global) {
  'use strict';
  const MMS = global.MMS || (global.MMS = {});
  const D = () => MMS.Data;

  // ---------------------------------------------------------------- helpers
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const roundTo = (x, step) => Math.round(x / step) * step;
  const cents = (x) => Math.round(x * 100) / 100;
  const sum = (arr, f) => arr.reduce((a, x) => a + (f ? f(x) : x), 0);
  const lerp = (r, u) => r[0] + (r[1] - r[0]) * u;

  function money(n) {
    const neg = n < 0;
    return (neg ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US');
  }

  function nextId(state, prefix) {
    state.nextId = (state.nextId || 0) + 1;
    return (prefix || 'x') + state.nextId;
  }

  function log(state, text, tone, playerId) {
    state.log.push({ round: state.round, pid: playerId || null, text, tone: tone || 'neutral' });
    if (state.log.length > 600) state.log.splice(0, state.log.length - 600);
  }

  /** Luck-adjusted uniform draw: players with good karma get the better of two rolls. */
  function luckyRoll(p, rng) {
    return p.karmaTurns > 0 ? Math.max(rng.next(), rng.next()) : rng.next();
  }

  // ---------------------------------------------------------------- finance math
  function amortPayment(principal, aprPct, months) {
    if (principal <= 0) return 0;
    const r = aprPct / 100 / 12;
    if (r === 0) return principal / months;
    return principal * r / (1 - Math.pow(1 + r, -months));
  }

  function principalFromPayment(payment, aprPct, months) {
    if (payment <= 0) return 0;
    const r = aprPct / 100 / 12;
    if (r === 0) return payment * months;
    return payment * (1 - Math.pow(1 + r, -months)) / r;
  }

  /** Months until a balance is paid off at a fixed payment (Infinity if it never is). */
  function monthsToPayoff(balance, aprPct, payment) {
    if (balance <= 0) return 0;
    if (payment <= 0) return Infinity;
    const r = aprPct / 100 / 12;
    if (r === 0) return Math.ceil(balance / payment);
    const x = 1 - balance * r / payment;
    if (x <= 0) return Infinity;
    return Math.ceil(-Math.log(x) / Math.log(1 + r));
  }

  /** Apply one month of interest and payment to {balance, apr, payment}. Returns the amount paid. */
  function amortizeLoan(loan) {
    if (!loan || loan.balance <= 0) return 0;
    const interest = loan.balance * loan.apr / 1200;
    const pay = Math.min(loan.payment, loan.balance + interest);
    loan.balance = cents(loan.balance + interest - pay);
    if (loan.balance < 0.5) loan.balance = 0;
    return cents(pay);
  }

  // ---------------------------------------------------------------- players
  function currentPlayer(state) { return state.players[state.currentIndex]; }
  function getPlayer(state, id) { return state.players.find((p) => p.id === id); }
  function jobTitle(p) { return (D().JOB_LEVELS[p.job.level] || '') + p.job.title; }
  function lifestyleOf(p) { return D().LIFESTYLES[p.lifestyle]; }
  function isEmployed(p) { return !p.retired && p.unemployedTurns <= 0; }

  // ---------------------------------------------------------------- debts
  function revolvingPayment(d) {
    if (d.balance <= 0) return 0;
    return Math.min(Math.ceil(d.balance), Math.max(d.minFloor || 25, Math.round(d.balance * (d.minPct || 0.03))));
  }

  function addDebt(state, p, spec) {
    const d = {
      id: nextId(state, 'd'),
      type: spec.type,
      name: spec.name || D().DEBT_TYPES[spec.type].label,
      balance: cents(spec.balance),
      apr: spec.apr,
      revolving: !!spec.revolving,
      minPct: spec.minPct || 0.03,
      minFloor: spec.minFloor || 25,
      payment: 0
    };
    d.payment = d.revolving ? revolvingPayment(d) : Math.round(spec.payment || amortPayment(d.balance, d.apr, spec.termMonths));
    p.debts.push(d);
    return d;
  }

  /** Put an amount on the player's credit card (opening one if needed). */
  function chargeCredit(state, p, amount) {
    let card = p.debts.find((d) => d.type === 'credit');
    if (!card) card = addDebt(state, p, { type: 'credit', name: 'Credit card', balance: 0, apr: 24.99, revolving: true });
    card.balance = cents(card.balance + amount);
    card.payment = revolvingPayment(card);
    return card;
  }

  function processDebts(state, p, notes) {
    let total = 0;
    for (const d of p.debts.slice()) {
      const oldPayment = d.payment;
      p.stats.interestPaid += d.balance * d.apr / 1200;
      total += amortizeLoan(d);
      if (d.revolving) d.payment = revolvingPayment(d);
      if (d.balance <= 0) {
        p.debts = p.debts.filter((x) => x !== d);
        notes.push(`✅ Your ${d.name} is paid off! That frees up ${money(oldPayment)}/mo.`);
        log(state, `${p.name} paid off their ${d.name}.`, 'good', p.id);
      }
    }
    return total;
  }

  // ---------------------------------------------------------------- assets
  /**
   * Property values follow the regional housing market (reIndex) times the property's
   * own neighborhood factor (localMult), which drifts randomly and jumps on local news.
   */
  function propertyValue(state, prop) {
    return prop.purchasePrice * prop.valueMult * (prop.localMult || 1) * state.market.reIndex / prop.reIndexAtPurchase;
  }

  /** One month of neighborhood-level drift (~±4%/yr on top of the regional market). */
  function driftLocal(obj, rng) {
    obj.localMult = clamp((obj.localMult || 1) * Math.exp(0.011 * rng.normal() - 0.00006), 0.5, 2.5);
  }

  function propertyCashflow(prop) {
    const renovating = prop.rehabLeft > 0;
    const rent = renovating ? 0 : prop.rent;
    const opex = renovating ? Math.round(prop.opex * 0.5) : prop.opex;
    return rent - opex - (prop.mortgage ? prop.mortgage.payment : 0);
  }

  function propertySale(state, prop) {
    const value = propertyValue(state, prop);
    const fees = prop.land ? value * 0.03 : value * 0.06;
    const loan = prop.mortgage ? prop.mortgage.balance : 0;
    return { value, fees, loan, net: value - fees - loan };
  }

  function businessProfit(b) {
    if (b.kind === 'startup') return 0;
    if (b.rampLeft > 0) return b.rampCashflow;
    return Math.round(b.base * b.performance);
  }

  function businessCashflow(b) { return businessProfit(b) - (b.loan ? b.loan.payment : 0); }

  function businessValue(b) {
    if (b.kind === 'startup') return b.invested;
    if (b.rampLeft > 0) return Math.round(b.invested * 0.6);
    const profit = businessProfit(b);
    const months = b.kind === 'side' ? 18 : 30;
    return profit > 0 ? Math.round(Math.max(profit * months, b.invested * 0.15)) : Math.round(b.invested * 0.15);
  }

  function businessSale(b) {
    const value = b.kind === 'startup' ? Math.round(b.invested * 0.5) : businessValue(b);
    const loan = b.loan ? b.loan.balance : 0;
    return { value, loan, net: value - loan };
  }

  function noteIncome(n) { return Math.round(n.principal * n.rate / 1200); }

  /** Value of the player's own home (counts toward net worth, never toward passive income). */
  function homeValue(state, p) {
    return p.home ? p.home.value * (p.home.localMult || 1) * state.market.reIndex / p.home.reIndex : 0;
  }

  /** The mortgage on the player's own home (a personal debt), if any. */
  function homeMortgage(p) { return p.debts.find((d) => d.type === 'mortgage') || null; }

  /** What selling your own home would bring: 6% selling costs, then the mortgage is repaid. */
  function homeSale(state, p) {
    const value = homeValue(state, p);
    const fees = value * 0.06;
    const m = homeMortgage(p);
    const loan = m ? m.balance : 0;
    return { value, fees, loan, net: value - fees - loan };
  }

  // ---------------------------------------------------------------- relationships & networking
  const relStatus = (p) => (p.relationship ? p.relationship.status : 'single');
  const isMarried = (p) => relStatus(p) === 'married';
  /** Monthly networking strength: +1 for a recent conference, +1 for a club membership. */
  function networkLevel(p) {
    const n = p.network;
    if (!n) return 0;
    return (n.conferenceTurns > 0 ? 1 : 0) + (n.club ? 1 : 0);
  }

  // ---------------------------------------------------------------- income & expenses
  function salaryIncome(p) { return isEmployed(p) ? p.job.salary : 0; }
  function gigIncome(p) { return sum(p.sideGigs, (g) => g.income); }

  function dividendIncome(state, p) {
    let t = 0;
    for (const id in p.holdings) {
      const h = p.holdings[id];
      const s = state.market.securities[id];
      if (s && h.shares > 0) t += h.shares * s.div;
    }
    return t;
  }

  /** The whole household's living costs (before a spouse's share). */
  function livingExpenses(p) { return sum(Object.values(p.expenses)); }
  /** A spouse pays half of the household's living costs, including the mortgage on the home you share. */
  function partnerShare(p) {
    if (!isMarried(p)) return 0;
    const m = homeMortgage(p);
    return Math.round((livingExpenses(p) + (m ? m.payment : 0)) * 0.5);
  }
  /** Children's costs; parents split them (childShare = 0.5 once you've had kids together). */
  function childExpenses(p) { return Math.round(p.children * p.childCost * (p.childShare == null ? 1 : p.childShare)); }
  function datingCost(p) { return relStatus(p) === 'dating' ? p.relationship.datingCost : 0; }
  function clubDues(p) { return p.network && p.network.club ? p.network.club.dues : 0; }
  function debtPayments(p) { return sum(p.debts, (d) => d.payment); }

  function stocksValue(state, p) {
    let t = 0;
    for (const id in p.holdings) {
      const s = state.market.securities[id];
      if (s) t += p.holdings[id].shares * s.price;
    }
    return t;
  }

  /** Everything the UI and the rules need to know about a player's finances. */
  function summarize(state, p) {
    const salary = salaryIncome(p);
    const gigs = gigIncome(p);
    const dividends = dividendIncome(state, p);
    const realEstate = sum(p.properties, propertyCashflow);
    const business = sum(p.businesses.filter((b) => b.kind === 'business'), businessCashflow);
    const side = sum(p.businesses.filter((b) => b.kind === 'side'), businessCashflow);
    const interest = sum(p.notes, noteIncome);
    const collectibles = -sum(p.collectibles, (c) => c.upkeep || 0);
    const O = MMS.Options;
    const shortCarry = O ? -O.shortCarry(state, p) : 0;
    const passive = dividends + realEstate + business + side + interest + collectibles + shortCarry;
    const living = livingExpenses(p);
    const partner = partnerShare(p);
    const children = childExpenses(p);
    const dating = datingCost(p);
    const dues = clubDues(p);
    const debt = debtPayments(p);
    const expenses = living - partner + children + dating + dues + debt;
    const income = salary + gigs + passive;
    const cashflow = income - expenses;
    const target = expenses * state.settings.freedomMultiple;

    const sv = stocksValue(state, p);
    const propValue = sum(p.properties, (pr) => propertyValue(state, pr));
    const propDebt = sum(p.properties, (pr) => (pr.mortgage ? pr.mortgage.balance : 0));
    const bizValue = sum(p.businesses, businessValue);
    const bizDebt = sum(p.businesses, (b) => (b.loan ? b.loan.balance : 0));
    const notesValue = sum(p.notes, (n) => n.principal);
    const collValue = sum(p.collectibles, (c) => c.value);
    const debtBalance = sum(p.debts, (d) => d.balance);
    const home = homeValue(state, p);
    const optionsValue = O ? sum(p.options || [], (o) => O.optionValue(state, o)) : 0;
    const shortCollateral = O ? O.shortCollateral(p) : 0;
    const shortLiability = O ? O.shortLiability(state, p) : 0;
    const assets = p.cash + sv + propValue + bizValue + notesValue + collValue + home + optionsValue + shortCollateral;
    const liabilities = debtBalance + propDebt + bizDebt + shortLiability;

    return {
      salary, gigs, dividends, realEstate, business, side, interest, collectibles, shortCarry, passive,
      living, partner, children, dating, dues, debt, expenses, income, cashflow, target,
      progress: target > 0 ? Math.max(0, passive) / target : 0,
      free: passive > 0 && passive >= target,
      stocksValue: sv, propValue, propDebt, bizValue, bizDebt, notesValue, collValue, debtBalance, home,
      optionsValue, shortCollateral, shortLiability,
      assets, liabilities, netWorth: assets - liabilities
    };
  }

  // ---------------------------------------------------------------- bank
  function bankRate(state) { return roundTo(state.market.rate + 6.5, 0.25); }

  /** The bank lends as long as the new 60-month payment fits in 60% of current cashflow. */
  function loanLimit(state, p) {
    const s = summarize(state, p);
    const room = Math.max(0, s.cashflow) * 0.6;
    const max = principalFromPayment(room, bankRate(state), 60);
    return Math.max(0, Math.floor(max / 1000) * 1000);
  }

  // ---------------------------------------------------------------- player creation
  function newRelationship() {
    return { status: 'single', partner: null, since: 0, datingCost: 0, declined: 0, lastBabyAsk: -99, nextBabyAsk: 0, breakups: 0, marriages: 0, divorces: 0 };
  }

  function newStats() {
    return {
      turns: 0, donated: 0, deals: 0, good: 0, bad: 0, timesDownsized: 0, promotions: 0, raises: 0, interestPaid: 0,
      passiveEarned: 0, realizedGains: 0, luxurySpent: 0, weddingSpent: 0, datingSpent: 0, networkingSpent: 0, optionTrades: 0, trades: 0
    };
  }

  /** Fill in fields added after a save was made, so older save files keep working. */
  function migratePlayer(p) {
    if (!p.relationship) p.relationship = newRelationship();
    if (p.relationship.nextBabyAsk == null) p.relationship.nextBabyAsk = (p.relationship.lastBabyAsk || 0) + 4;
    if (!p.network) p.network = { club: null, conferenceTurns: 0, conferences: 0 };
    if (!Array.isArray(p.options)) p.options = [];
    if (!p.shorts) p.shorts = {};
    if (p.childShare == null) p.childShare = 1;
    if (p.bot === undefined) p.bot = null;
    p.stats = Object.assign(newStats(), p.stats);
    if (p.home) {
      if (p.home.localMult == null) p.home.localMult = 1;
      if (p.home.purchasePrice == null) p.home.purchasePrice = p.home.value;
      if (p.home.boughtRound == null) p.home.boughtRound = 0;
      if (!p.home.name) p.home.name = 'Your home';
    }
    for (const pr of p.properties) if (pr.localMult == null) pr.localMult = 1;
  }

  /**
   * Student loans. Jobs that need a degree always come with them: about $22k–$38k for a bachelor's,
   * multiplied for graduate school (a doctor's ~6 extra years of school ≈ 5×). Professional-school
   * loans are repaid over a longer term. Other jobs sometimes carry a smaller loan from some college.
   */
  function addStudentLoans(state, p, rng, job) {
    const Dt = D();
    const degree = job.degree ? Dt.DEGREES[job.degree] : null;
    if (!degree && !rng.chance(job.student || 0)) return null;
    const base = rng.range(Dt.UNDERGRAD_LOAN);
    const balance = roundTo(base * (degree ? degree.loanMult : rng.range(Dt.SOME_COLLEGE_LOAN)), 100);
    const apr = cents(degree && degree.extraYears ? rng.float(5.5, 7.5) : rng.float(4.0, 6.5));
    const term = degree && degree.extraYears ? rng.int(144, 240) : rng.int(96, 144);
    const name = degree ? `Student loans (${degree.label})` : 'Student loans (some college)';
    return addDebt(state, p, { type: 'student', name, balance, apr, termMonths: term });
  }

  function createPlayer(state, rng, cfg, job) {
    const Dt = D();
    const salary = roundTo(rng.range(job.salary), 50);
    const lifeIndex = Dt.LIFESTYLES.indexOf(rng.weighted(Dt.LIFESTYLES, (l) => l.weight));
    const life = Dt.LIFESTYLES[lifeIndex];
    const livingTotal = salary * rng.range(life.living);

    const p = {
      id: nextId(state, 'p'),
      name: cfg.name,
      emoji: cfg.emoji,
      color: cfg.color,
      job: { title: job.title, icon: job.icon, salary, startSalary: salary, level: 0 },
      lifestyle: lifeIndex,
      startLifestyle: lifeIndex,
      lastDownshift: -99,
      expenses: {},
      ownsHome: false,
      children: 0,
      childCost: roundTo(clamp(salary * rng.float(0.07, 0.1), 300, 1400), 10),
      childShare: 1,
      relationship: newRelationship(),
      network: { club: null, conferenceTurns: 0, conferences: 0 },
      cash: 0,
      debts: [],
      holdings: {},
      options: [],
      shorts: {},
      properties: [],
      businesses: [],
      notes: [],
      collectibles: [],
      sideGigs: [],
      unemployedTurns: 0,
      karmaTurns: 0,
      retired: false,
      finished: false,
      place: null,
      stats: newStats(),
      history: []
    };

    for (const cat of Dt.EXPENSES) {
      p.expenses[cat.id] = roundTo(livingTotal * cat.share * rng.float(0.85, 1.15), 5);
    }

    // Everyone starts out renting: "housing" is their rent. Homes for sale are listed every turn
    // in the Portfolio tab, so players can buy one later.

    // Student loans come first: anyone whose job needs a degree always has them, sized to the schooling.
    addStudentLoans(state, p, rng, job);

    // Other starting debts of various kinds.
    if (rng.chance(0.85)) {
      addDebt(state, p, { type: 'credit', name: rng.pick(Dt.CARD_NAMES), balance: roundTo(salary * rng.float(0.2, 2.5), 50), apr: cents(rng.float(19.99, 27.99)), revolving: true });
    }
    if (rng.chance(0.7)) {
      const apr = cents(rng.float(4.5, 9.5)), term = rng.int(18, 60);
      addDebt(state, p, { type: 'auto', name: `Auto loan (${rng.pick(Dt.CAR_TYPES)})`, balance: principalFromPayment(salary * rng.float(0.05, 0.11), apr, term), apr, termMonths: term });
    }
    if (rng.chance(0.2)) {
      const apr = cents(rng.float(9, 17)), term = rng.int(12, 48);
      addDebt(state, p, { type: 'personal', name: 'Personal loan', balance: principalFromPayment(salary * rng.float(0.02, 0.05), apr, term), apr, termMonths: term });
    }
    if (rng.chance(0.12)) {
      const term = rng.int(12, 36);
      addDebt(state, p, { type: 'medical', name: 'Medical debt', balance: roundTo(rng.float(800, 6000), 50), apr: 0, termMonths: term });
    }
    if (rng.chance(0.18)) {
      const term = rng.int(6, 12);
      addDebt(state, p, { type: 'bnpl', name: 'Buy-now-pay-later (furniture)', balance: roundTo(rng.float(600, 3500), 50), apr: 0, termMonths: term });
    }
    if (life.id === 'lavish' && rng.chance(0.4)) {
      const apr = cents(rng.float(6, 10)), term = rng.int(36, 120);
      addDebt(state, p, { type: 'boat', name: 'Boat loan', balance: principalFromPayment(salary * rng.float(0.03, 0.06), apr, term), apr, termMonths: term });
    }

    // Everyone starts single with no children; relationships and kids come through life events.

    // Keep the starting cashflow healthy: 10%–38% of salary.
    const cf = () => salary - livingExpenses(p) - childExpenses(p) - debtPayments(p);
    const minCf = salary * rng.float(0.1, 0.16);
    if (cf() < minCf) {
      const living = livingExpenses(p);
      const factor = Math.max(0.7, (living - (minCf - cf())) / living);
      for (const k in p.expenses) p.expenses[k] = roundTo(p.expenses[k] * factor, 5);
      // Trim optional starting debts, never the student loans a degree job requires.
      while (cf() < minCf) {
        const removable = p.debts.filter((d) => d.type !== 'mortgage' && !(d.type === 'student' && job.degree)).sort((a, b) => b.payment - a.payment);
        if (!removable.length) break;
        p.debts = p.debts.filter((d) => d !== removable[0]);
      }
      if (cf() < minCf && p.children > 0) p.children = 0;
    }
    const maxCf = salary * 0.38;
    if (cf() > maxCf) {
      const living = livingExpenses(p);
      const factor = (living + (cf() - maxCf)) / living;
      for (const k in p.expenses) p.expenses[k] = roundTo(p.expenses[k] * factor, 5);
    }

    p.cash = roundTo(salary * rng.float(0.4, 2.5), 100);

    // Some players start with a little in the index fund (an old retirement account).
    if (rng.chance(0.35)) {
      const idx = state.market.securities.idx;
      const shares = Math.floor(salary * rng.float(0.5, 3) / idx.price);
      if (shares > 0) p.holdings.idx = { shares, costBasis: cents(shares * idx.price) };
    }
    return p;
  }

  // ---------------------------------------------------------------- payday
  /** A startup reaches its outcome. Returns the payout; the result is announced with a pop-up. */
  function resolveStartup(state, p, b, rng, popups) {
    const lucky = p.karmaTurns > 0;
    const outcomes = [
      { id: 'fail', w: lucky ? 0.45 : 0.55, mult: [0, 0] },
      { id: 'meh', w: 0.22, mult: [0.3, 1.2] },
      { id: 'good', w: lucky ? 0.22 : 0.17, mult: [2, 6] },
      { id: 'huge', w: lucky ? 0.09 : 0.06, mult: [10, 25] }
    ];
    const o = rng.weighted(outcomes, (x) => x.w);
    const payout = roundTo(b.invested * rng.range(o.mult), 100);
    p.businesses = p.businesses.filter((x) => x !== b);
    const gain = payout - b.invested;
    p.stats.realizedGains += gain;
    const pop = {
      fail: { icon: '💀', title: `${b.name} failed`, text: `${b.name} ran out of money and shut down. Your ${money(b.invested)} investment is gone.` },
      meh: { icon: '😐', title: `${b.name} was acquired (barely)`, text: `${b.name} was bought for a modest price. You got back ${money(payout)} on your ${money(b.invested)} investment — ${gain >= 0 ? 'a small gain' : 'a loss'} of ${money(Math.abs(gain))}.` },
      good: { icon: '🎉', title: `${b.name} succeeded!`, text: `${b.name} was acquired! Your ${money(b.invested)} stake paid out ${money(payout)} — about ${(payout / b.invested).toFixed(1)}× your money.` },
      huge: { icon: '🦄', title: `${b.name} became a unicorn!`, text: `${b.name} is now worth over a billion dollars. Your ${money(b.invested)} stake cashed out for ${money(payout)} — ${(payout / b.invested).toFixed(0)}× your money!` }
    }[o.id];
    const tone = o.id === 'fail' ? 'bad' : o.id === 'meh' ? (gain >= 0 ? 'neutral' : 'bad') : 'good';
    popups.push(Object.assign(pop, {
      tone,
      lesson: o.id === 'fail' || o.id === 'meh'
        ? 'More than half of startups fail. Angel investors expect most bets to lose and hope one big winner pays for all of them — so never put in more than you can afford to lose.'
        : 'This is the startup "power law": a few huge winners make up for many losers. The cash is a one-time windfall — investing it in income-producing assets turns it into passive income.'
    }));
    log(state, `${p.name}: ${pop.text}`, tone, p.id);
    return payout;
  }

  /** Reveal a ramping business' real monthly profit once it opens. */
  function revealBusiness(p, b, rng) {
    const u = luckyRoll(p, rng);
    if (b.kind === 'side') {
      const tiers = [[0.35, [0, 0.01]], [0.35, [0.03, 0.08]], [0.22, [0.08, 0.2]], [0.08, [0.25, 0.6]]];
      let acc = 0, chosen = tiers[tiers.length - 1];
      for (const t of tiers) { acc += t[0]; if (u < acc) { chosen = t; break; } }
      b.base = Math.round(b.invested * rng.range(chosen[1]));
    } else {
      b.base = Math.round(b.invested * lerp(b.ret, u));
    }
    b.performance = 1;
  }

  function closeBusiness(state, p, b, rng, popups) {
    const salvage = roundTo(b.invested * rng.float(0.05, 0.2), 100);
    const loanBal = b.loan ? b.loan.balance : 0;
    p.businesses = p.businesses.filter((x) => x !== b);
    let msg = `${b.name} went out of business. You salvaged ${money(salvage)} from the equipment.`;
    if (salvage >= loanBal) {
      p.cash += salvage - loanBal;
    } else {
      addDebt(state, p, { type: 'business', name: `Leftover loan (${b.name})`, balance: loanBal - salvage, apr: b.loan.apr, termMonths: 60 });
      msg += ` ${money(loanBal - salvage)} of its loan is still owed.`;
    }
    popups.push({ icon: '😞', tone: 'bad', title: `${b.name} closed`, text: msg, lesson: 'About one in five small businesses fail in their first year. Risky businesses should be a small slice of your portfolio — and any loan you signed for is still yours to repay.' });
    log(state, `${p.name}: ${msg}`, 'bad', p.id);
  }

  /**
   * Collect income and pay expenses at the start of a player's turn.
   * Returns a report for the UI: { lines, notes, net, before, after }.
   */
  function payday(state, p, rng) {
    const before = p.cash;
    const lines = [];
    const notes = [];
    const popups = []; // big moments (startup exits, closures, option expiries) shown as pop-up cards
    const add = (label, amount) => { if (amount !== 0 || label.startsWith('Salary')) lines.push({ label, amount: cents(amount) }); p.cash += amount; };

    // Earned income
    if (!p.retired) {
      if (p.unemployedTurns > 0) {
        lines.push({ label: 'Salary (unemployed)', amount: 0 });
        p.unemployedTurns--;
        if (p.unemployedTurns === 0) {
          notes.push(`💼 Good news — you landed a new ${p.job.title} job! Your paychecks restart next turn.`);
          log(state, `${p.name} is back at work.`, 'good', p.id);
        } else {
          notes.push(`🔎 Still job hunting: ${p.unemployedTurns} more turn${p.unemployedTurns === 1 ? '' : 's'} without a paycheck.`);
        }
      } else {
        add(`Salary — ${jobTitle(p)}`, p.job.salary);
      }
    }
    let gigs = 0;
    for (const g of p.sideGigs.slice()) {
      gigs += g.income;
      g.turnsLeft--;
      if (g.turnsLeft <= 0) {
        p.sideGigs = p.sideGigs.filter((x) => x !== g);
        notes.push(`👋 Your ${g.title} side gig has wrapped up.`);
      }
    }
    add('Side gigs', gigs);

    // Passive income
    add('Dividends', cents(dividendIncome(state, p)));

    let re = 0;
    for (const prop of p.properties) {
      let rent = 0;
      let opex = prop.opex;
      if (prop.rehabLeft > 0) {
        opex = Math.round(prop.opex * 0.5);
        prop.rehabLeft--;
        if (prop.rehabLeft === 0) {
          prop.valueMult = prop.arvMult;
          notes.push(`🔨 Renovations on ${prop.name} are done! It's now worth about ${money(propertyValue(state, prop))} and rents for ${money(prop.rent)}/mo.`);
        }
      } else {
        rent = prop.str ? Math.round(prop.rent * rng.float(0.55, 1.45)) : prop.rent;
      }
      const mpay = prop.mortgage ? amortizeLoan(prop.mortgage) : 0;
      if (prop.mortgage && prop.mortgage.balance <= 0) {
        prop.mortgage = null;
        notes.push(`🏠 The mortgage on ${prop.name} is paid off!`);
      }
      re += rent - opex - mpay;
      driftLocal(prop, rng);
    }
    add('Real estate (net)', re);
    if (p.home) driftLocal(p.home, rng);

    let biz = 0, side = 0, exits = 0;
    for (const b of p.businesses.slice()) {
      if (b.kind === 'startup') {
        b.monthsLeft--;
        if (b.monthsLeft <= 0) exits += resolveStartup(state, p, b, rng, popups);
        continue;
      }
      let profit;
      if (b.rampLeft > 0) {
        profit = b.rampCashflow;
        b.rampLeft--;
        if (b.rampLeft === 0) {
          revealBusiness(p, b, rng);
          const verdict = b.base > 0 ? `It's bringing in about ${money(b.base)}/mo.` : `Uh oh — it's losing about ${money(-b.base)}/mo.`;
          notes.push(`${b.icon} ${b.name} is up and running! ${verdict}`);
        }
      } else {
        b.performance = clamp(b.performance + b.vol * 0.6 * rng.normal() + 0.15 * (1 - b.performance), 0.2, 2.2);
        profit = businessProfit(b);
        if (b.fail && (b.base <= 0 || b.performance < 0.55) && rng.chance(b.base <= 0 ? 0.15 : 0.2)) {
          const loanPay = b.loan ? amortizeLoan(b.loan) : 0;
          biz += profit - loanPay;
          closeBusiness(state, p, b, rng, popups);
          continue;
        }
      }
      const loanPay = b.loan ? amortizeLoan(b.loan) : 0;
      if (b.loan && b.loan.balance <= 0) {
        b.loan = null;
        notes.push(`🏦 The business loan on ${b.name} is paid off!`);
      }
      if (b.kind === 'side') side += profit - loanPay; else biz += profit - loanPay;
    }
    add('Businesses (net)', biz);
    add('Side projects', side);
    add('Startup exits', exits);

    let interest = 0;
    for (const n of p.notes.slice()) {
      if (rng.chance(n.defaultRisk)) {
        const recovery = roundTo(n.principal * rng.float(0.3, 0.7), 100);
        p.cash += recovery;
        p.notes = p.notes.filter((x) => x !== n);
        notes.push(`⚠️ The borrower on your ${n.name} defaulted! You recovered ${money(recovery)} of ${money(n.principal)}.`);
        log(state, `${p.name}'s ${n.name} defaulted.`, 'bad', p.id);
        continue;
      }
      interest += noteIncome(n);
      n.monthsLeft--;
      if (n.monthsLeft <= 0) {
        p.cash += n.principal;
        p.notes = p.notes.filter((x) => x !== n);
        notes.push(`📜 Your ${n.name} matured — ${money(n.principal)} principal returned to you.`);
      }
    }
    add('Interest (notes)', interest);

    let upkeep = 0;
    for (const c of p.collectibles) {
      c.value = Math.max(50, Math.round(c.value * Math.exp(c.drift - (c.vol * c.vol) / 2 + c.vol * rng.normal())));
      upkeep += c.upkeep || 0;
    }
    add('Collectible upkeep', -upkeep);
    p.stats.passiveEarned += lines
      .filter((l) => /^(Dividends|Real estate|Businesses|Side projects|Interest|Collectible)/.test(l.label))
      .reduce((a, l) => a + l.amount, 0);

    // Options & short positions
    if (MMS.Options) {
      const cashBefore = p.cash;
      const st = MMS.Options.settle(state, p, notes);
      const marginCash = cents(p.cash - cashBefore); // forced buy-backs settle straight from collateral
      if (marginCash) lines.push({ label: 'Margin call (forced buy-back)', amount: marginCash });
      add('Options expiring', st.optionCash);
      add('Short positions (fees & dividends)', -st.carry);
      popups.push(...st.popups);
    }

    // Expenses
    add('Living expenses', -livingExpenses(p));
    const share = partnerShare(p);
    if (share) add(`${p.relationship.partner.name} pays half the household bills`, share);
    if (p.children > 0) add(`Children (${p.children})${p.childShare < 1 ? ' — your half' : ''}`, -childExpenses(p));
    const dating = datingCost(p);
    if (dating) { add(`Dating ${p.relationship.partner.name}`, -dating); p.stats.datingSpent += dating; }
    const dues = clubDues(p);
    if (dues) { add(`${p.network.club.name} dues`, -dues); p.stats.networkingSpent += dues; }
    add('Debt payments', -processDebts(state, p, notes));

    p.cash = cents(p.cash);
    if (p.cash < 0) {
      const short = -p.cash;
      chargeCredit(state, p, short);
      p.cash = 0;
      notes.push(`⚠️ You couldn't cover your bills, so ${money(short)} went on your credit card.`);
      log(state, `${p.name} had to put ${money(short)} of bills on a credit card.`, 'bad', p.id);
    }
    return { lines, notes, popups, net: cents(p.cash - before), before, after: p.cash };
  }

  function snapshot(state, p) {
    const s = summarize(state, p);
    return { round: state.round, netWorth: Math.round(s.netWorth), passive: Math.round(s.passive), target: Math.round(s.target), cash: Math.round(p.cash), progress: s.progress };
  }

  MMS.Core = {
    clamp, roundTo, cents, sum, lerp, money, nextId, log, luckyRoll,
    amortPayment, principalFromPayment, monthsToPayoff, amortizeLoan,
    currentPlayer, getPlayer, jobTitle, lifestyleOf, isEmployed,
    revolvingPayment, addDebt, chargeCredit, processDebts,
    propertyValue, propertyCashflow, propertySale, businessProfit, businessCashflow, businessValue, businessSale, noteIncome, homeValue,
    homeMortgage, homeSale, relStatus, isMarried, networkLevel,
    salaryIncome, gigIncome, dividendIncome, livingExpenses, partnerShare, childExpenses, datingCost, clubDues, debtPayments, stocksValue, summarize,
    bankRate, loanLimit, addStudentLoans, createPlayer, migratePlayer, newRelationship, payday, snapshot, revealBusiness
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = MMS.Core;
})(typeof window !== 'undefined' ? window : globalThis);
