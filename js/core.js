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
  function propertyValue(state, prop) {
    return prop.purchasePrice * prop.valueMult * state.market.reIndex / prop.reIndexAtPurchase;
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
    return p.home ? p.home.value * state.market.reIndex / p.home.reIndex : 0;
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

  function livingExpenses(p) { return sum(Object.values(p.expenses)); }
  function childExpenses(p) { return p.children * p.childCost; }
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
    const passive = dividends + realEstate + business + side + interest + collectibles;
    const living = livingExpenses(p);
    const children = childExpenses(p);
    const debt = debtPayments(p);
    const expenses = living + children + debt;
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
    const assets = p.cash + sv + propValue + bizValue + notesValue + collValue + home;
    const liabilities = debtBalance + propDebt + bizDebt;

    return {
      salary, gigs, dividends, realEstate, business, side, interest, collectibles, passive,
      living, children, debt, expenses, income, cashflow, target,
      progress: target > 0 ? Math.max(0, passive) / target : 0,
      free: passive > 0 && passive >= target,
      stocksValue: sv, propValue, propDebt, bizValue, bizDebt, notesValue, collValue, debtBalance, home,
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
      cash: 0,
      debts: [],
      holdings: {},
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
      stats: { turns: 0, donated: 0, deals: 0, good: 0, bad: 0, timesDownsized: 0, promotions: 0, interestPaid: 0, passiveEarned: 0, realizedGains: 0, luxurySpent: 0 },
      history: []
    };

    for (const cat of Dt.EXPENSES) {
      p.expenses[cat.id] = roundTo(livingTotal * cat.share * rng.float(0.85, 1.15), 5);
    }

    // Home: renters pay rent in "housing"; owners pay a mortgage plus taxes & upkeep.
    p.ownsHome = rng.chance(Math.min(0.75, 0.2 + Math.max(0, (salary - 2500) / 14000)));
    if (p.ownsHome) {
      const rentEquivalent = p.expenses.housing;
      p.expenses.housing = roundTo(rentEquivalent * rng.float(0.25, 0.35), 5);
      const apr = cents(rng.float(3.0, 7.0));
      const term = rng.int(180, 340);
      const pay = rentEquivalent * rng.float(0.8, 1.1);
      const loan = addDebt(state, p, { type: 'mortgage', name: 'Home mortgage', balance: principalFromPayment(pay, apr, term), apr, termMonths: term });
      // The home itself is worth more than the mortgage (some equity) and tracks the housing market.
      p.home = { value: roundTo(loan.balance * rng.float(1.15, 1.6), 1000), reIndex: state.market.reIndex };
    }

    // Starting debts of various kinds.
    if (rng.chance(0.85)) {
      addDebt(state, p, { type: 'credit', name: rng.pick(Dt.CARD_NAMES), balance: roundTo(salary * rng.float(0.2, 2.5), 50), apr: cents(rng.float(19.99, 27.99)), revolving: true });
    }
    if (rng.chance(0.7)) {
      const apr = cents(rng.float(4.5, 9.5)), term = rng.int(18, 60);
      addDebt(state, p, { type: 'auto', name: `Auto loan (${rng.pick(Dt.CAR_TYPES)})`, balance: principalFromPayment(salary * rng.float(0.05, 0.11), apr, term), apr, termMonths: term });
    }
    if (rng.chance(job.student)) {
      const apr = cents(rng.float(4.0, 7.5)), term = rng.int(60, 150);
      const share = salary > 9000 ? rng.float(0.05, 0.12) : rng.float(0.03, 0.09);
      addDebt(state, p, { type: 'student', name: 'Student loans', balance: principalFromPayment(salary * share, apr, term), apr, termMonths: term });
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

    if (rng.chance(0.3)) p.children = rng.int(1, 2);

    // Keep the starting cashflow healthy: 10%–38% of salary.
    const cf = () => salary - livingExpenses(p) - childExpenses(p) - debtPayments(p);
    const minCf = salary * rng.float(0.1, 0.16);
    if (cf() < minCf) {
      const living = livingExpenses(p);
      const factor = Math.max(0.7, (living - (minCf - cf())) / living);
      for (const k in p.expenses) p.expenses[k] = roundTo(p.expenses[k] * factor, 5);
      while (cf() < minCf) {
        const removable = p.debts.filter((d) => d.type !== 'mortgage').sort((a, b) => b.payment - a.payment);
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
  function resolveStartup(state, p, b, rng, notes) {
    const lucky = p.karmaTurns > 0;
    const outcomes = [
      { id: 'fail', w: lucky ? 0.45 : 0.55, mult: [0, 0] },
      { id: 'meh', w: 0.22, mult: [0.3, 1.2] },
      { id: 'good', w: lucky ? 0.22 : 0.17, mult: [2, 6] },
      { id: 'huge', w: lucky ? 0.09 : 0.06, mult: [10, 25] }
    ];
    const o = rng.weighted(outcomes, (x) => x.w);
    const payout = roundTo(b.invested * rng.range(o.mult), 100);
    p.cash += payout;
    p.businesses = p.businesses.filter((x) => x !== b);
    const msg = {
      fail: `💀 ${b.name} ran out of money and shut down. Your ${money(b.invested)} investment is gone.`,
      meh: `😐 ${b.name} was acquired for a modest price. You got back ${money(payout)} on your ${money(b.invested)} investment.`,
      good: `🎉 ${b.name} was acquired! Your ${money(b.invested)} stake paid out ${money(payout)}.`,
      huge: `🦄 ${b.name} became a unicorn! Your ${money(b.invested)} stake is now worth ${money(payout)} — cashed out!`
    }[o.id];
    notes.push(msg);
    log(state, `${p.name}: ${msg}`, o.id === 'fail' ? 'bad' : o.id === 'meh' ? 'neutral' : 'good', p.id);
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

  function closeBusiness(state, p, b, rng, notes) {
    const salvage = roundTo(b.invested * rng.float(0.05, 0.2), 100);
    const loanBal = b.loan ? b.loan.balance : 0;
    p.businesses = p.businesses.filter((x) => x !== b);
    let msg = `😞 ${b.name} went out of business. You salvaged ${money(salvage)} from the equipment.`;
    if (salvage >= loanBal) {
      p.cash += salvage - loanBal;
    } else {
      addDebt(state, p, { type: 'business', name: `Leftover loan (${b.name})`, balance: loanBal - salvage, apr: b.loan.apr, termMonths: 60 });
      msg += ` ${money(loanBal - salvage)} of its loan is still owed.`;
    }
    notes.push(msg);
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
    }
    add('Real estate (net)', re);

    let biz = 0, side = 0;
    for (const b of p.businesses.slice()) {
      if (b.kind === 'startup') {
        b.monthsLeft--;
        if (b.monthsLeft <= 0) resolveStartup(state, p, b, rng, notes);
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
          closeBusiness(state, p, b, rng, notes);
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

    // Expenses
    add('Living expenses', -livingExpenses(p));
    if (p.children > 0) add(`Children (${p.children})`, -childExpenses(p));
    add('Debt payments', -processDebts(state, p, notes));

    p.cash = cents(p.cash);
    if (p.cash < 0) {
      const short = -p.cash;
      chargeCredit(state, p, short);
      p.cash = 0;
      notes.push(`⚠️ You couldn't cover your bills, so ${money(short)} went on your credit card.`);
      log(state, `${p.name} had to put ${money(short)} of bills on a credit card.`, 'bad', p.id);
    }
    return { lines, notes, net: cents(p.cash - before), before, after: p.cash };
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
    salaryIncome, gigIncome, dividendIncome, livingExpenses, childExpenses, debtPayments, stocksValue, summarize,
    bankRate, loanLimit, createPlayer, payday, snapshot, revealBusiness
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = MMS.Core;
})(typeof window !== 'undefined' ? window : globalThis);
