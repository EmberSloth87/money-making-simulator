/*
 * deals.js — Random investment opportunities and what happens when you buy them.
 * Categories: real estate, businesses, startups, side projects, lending notes,
 * collectibles and stock tips.
 */
(function (global) {
  'use strict';
  const MMS = global.MMS || (global.MMS = {});
  const C = () => MMS.Core;
  const D = () => MMS.Data;

  const PLEX = { 3: 'Triplex', 4: 'Fourplex' };

  /** How much buying power a player has: cash + stocks + what the bank would lend. */
  function capacity(state, p) {
    const c = C();
    return Math.max(0, p.cash) + c.stocksValue(state, p) + c.loanLimit(state, p);
  }

  /** Draw a random deal sized to what the player could plausibly afford. */
  function generate(state, p, rng) {
    const { clamp } = C();
    const cap = capacity(state, p);
    const sizes = [['small', 1], ['medium', clamp(cap / 30000, 0.15, 1.2)], ['big', clamp(cap / 120000, 0.05, 1.2)]];
    const size = rng.weighted(sizes, (s) => s[1])[0];
    const pool = D().DEALS.filter((t) => t.sizes.includes(size));
    const t = rng.weighted(pool, (x) => x.w);
    return build(state, p, rng, t, size);
  }

  function build(state, p, rng, t, size) {
    switch (t.cat) {
      case 'realestate': return buildRealEstate(state, p, rng, t, size);
      case 'business': return buildBusiness(state, p, rng, t, size);
      case 'startup': return buildStartup(state, p, rng, t, size);
      case 'side': return buildSide(state, p, rng, t, size);
      case 'lending': return buildNote(state, p, rng, t, size);
      case 'collectible': return buildCollectible(state, p, rng, t, size);
      case 'tip': return { cat: 'tip' };
      default: throw new Error('Unknown deal category ' + t.cat);
    }
  }

  function buildRealEstate(state, p, rng, t, size) {
    const { roundTo, amortPayment, luckyRoll, lerp } = C();
    const econMult = { boom: 1.08, stable: 1, recession: 0.88 }[state.market.economy];
    const units = Array.isArray(t.units) ? rng.int(t.units[0], t.units[1]) : (t.units || 0);
    let price = t.pricePerUnit ? units * rng.range(t.pricePerUnit) : rng.range(t.priceBySize ? t.priceBySize[size] : t.price);
    price = roundTo(price * econMult, 500);
    const title = rng.pick(t.names).replace('{n}', units).replace('{plex}', PLEX[units] || 'Multiplex');
    const desc = rng.pick(D().SELLER_STORIES);
    const base = { cat: 'realestate', template: t.id, icon: t.icon, title, desc, size, price, units };

    if (t.land) {
      const upkeep = roundTo(Math.max(15, price * rng.float(0.0008, 0.0015)), 5);
      return Object.assign(base, {
        land: true, down: price, loan: 0, rate: 0, payment: 0, rent: 0, opex: upkeep,
        cashflow: -upkeep, cash: price, roi: 0,
        note: 'No income, but developers sometimes pay a big premium for land.'
      });
    }

    const down = roundTo(price * rng.range(t.down), 100);
    const loan = price - down;
    const rate = MMS.Market.mortgageRate(state, rng);
    const payment = Math.round(amortPayment(loan, rate, 360));
    let fixer = null;
    let rentBase = price;
    if (t.fixer) {
      fixer = { rehab: roundTo(price * rng.range(t.rehab), 500), turns: rng.int(t.rehabTurns[0], t.rehabTurns[1]), arvMult: Math.round(rng.range(t.arv) * 100) / 100 };
      rentBase = price * fixer.arvMult;
    }
    const rent = roundTo(rentBase * lerp(t.rent, luckyRoll(p, rng)), 5);
    const opex = roundTo(rent * rng.range(t.opex), 5);
    const cashflow = rent - opex - payment;
    const cash = down + (fixer ? fixer.rehab : 0);
    let note = '';
    if (t.str) note = 'Short-term rental: income swings from month to month with bookings.';
    if (fixer) note = `Needs ${C().money(fixer.rehab)} of renovations taking ${fixer.turns} turns (no rent meanwhile). Afterward it should be worth ~${C().money(price * fixer.arvMult)}.`;
    return Object.assign(base, { down, loan, rate, payment, rent, opex, cashflow, cash, str: !!t.str, fixer, roi: cash > 0 ? cashflow * 12 / cash : 0, note });
  }

  function buildBusiness(state, p, rng, t, size) {
    const { roundTo, amortPayment, luckyRoll, lerp } = C();
    const costRange = t.costBySize ? t.costBySize[size] : t.cost;
    const cost = roundTo(rng.range(costRange), costRange[1] > 20000 ? 1000 : 100);
    let loan = 0, loanRate = 0, loanPayment = 0;
    if (t.loan) {
      loan = roundTo(cost * rng.range(t.loan), 1000);
      loanRate = roundTo(state.market.rate + 3.75 + rng.float(-0.25, 0.5), 0.25);
      loanPayment = Math.round(amortPayment(loan, loanRate, 120));
    }
    const ramp = t.ramp ? rng.int(t.ramp[0], t.ramp[1]) : 0;
    const known = !ramp;
    const base = known ? Math.round(cost * lerp(t.ret, luckyRoll(p, rng))) : null;
    const range = [Math.round(cost * t.ret[0]), Math.round(cost * t.ret[1])];
    const cash = cost - loan;
    return {
      cat: 'business', kind: 'business', template: t.id, icon: t.icon, title: rng.pick(t.names), desc: rng.pick(D().BIZ_STORIES), size,
      cost, cash, loan, loanRate, loanPayment, base, range, ramp, ret: t.ret, vol: t.vol, risk: t.risk, fail: !!t.fail,
      cashflow: known ? base - loanPayment : null,
      roi: known && cash > 0 ? (base - loanPayment) * 12 / cash : null,
      note: ramp ? `Takes ${ramp} turn${ramp > 1 ? 's' : ''} to get going. Real profit is revealed once it opens.` : ''
    };
  }

  function buildStartup(state, p, rng, t, size) {
    const { roundTo } = C();
    const cost = roundTo(rng.range(t.costBySize[size]), 1000);
    const months = rng.int(t.months[0], t.months[1]);
    return {
      cat: 'startup', template: t.id, icon: t.icon, title: rng.pick(t.names), size, cost, cash: cost, months,
      desc: 'Early-stage equity: no monthly income. In roughly a year it will either fail or get bought out.',
      note: `Resolves in ~${months} turns. Roughly: 55% fail, 22% small return, 17% 2–6×, 6% 10–25×.`
    };
  }

  function buildSide(state, p, rng, t, size) {
    const { roundTo } = C();
    const cost = roundTo(rng.range(t.cost), 100);
    const ramp = rng.int(t.ramp[0], t.ramp[1]);
    return {
      cat: 'business', kind: 'side', template: t.id, icon: t.icon, title: rng.pick(t.names), size, cost, cash: cost, loan: 0, loanPayment: 0,
      base: null, range: [0, Math.round(cost * 0.6)], ramp, vol: t.vol, risk: 'High', fail: false, cashflow: null, roi: null,
      desc: 'A small creative project that could earn royalties for years — or nothing at all.',
      note: `Takes ${ramp} turns to launch. Most projects earn little; a few become hits.`
    };
  }

  function buildNote(state, p, rng, t, size) {
    const { roundTo, clamp } = C();
    const cost = roundTo(rng.range(t.costBySize[size]), 1000);
    const rate = roundTo(rng.range(t.rate), 0.5);
    const months = rng.int(t.months[0], t.months[1]);
    const defaultRisk = clamp(0.002 + (rate - 8) / 6 * 0.008 + rng.float(-0.001, 0.002), 0.001, 0.015);
    const monthly = Math.round(cost * rate / 1200);
    return {
      cat: 'lending', template: t.id, icon: t.icon, title: rng.pick(t.names), size, cost, cash: cost, rate, months, defaultRisk, monthly,
      cashflow: monthly, roi: rate / 100,
      desc: 'You lend the money and collect interest every month. Your principal comes back at the end of the term.',
      note: `Risk of default ≈ ${(defaultRisk * 100).toFixed(1)}% per month (you'd recover 30–70%).`
    };
  }

  function buildCollectible(state, p, rng, t, size) {
    const { roundTo } = C();
    const items = t.items.filter((it) => !it.sizes || it.sizes.includes(size));
    const it = rng.pick(items);
    const cost = roundTo(rng.range(it.cost), 100);
    const upkeep = it.upkeep ? roundTo(rng.range(it.upkeep), 5) : 0;
    return {
      cat: 'collectible', template: t.id, icon: it.icon, title: it.name, size, cost, cash: cost,
      vol: Math.round(rng.range(t.vol) * 1000) / 1000, drift: Math.round(rng.range(t.drift) * 10000) / 10000, upkeep,
      cashflow: -upkeep,
      desc: 'No income — you are betting it will be worth more later. Selling costs a 10% auction fee.',
      note: upkeep ? `Storage & insurance cost ${C().money(upkeep)}/mo.` : ''
    };
  }

  /** Buy a deal. Returns { ok, msg }. */
  function purchase(state, p, deal) {
    const c = C();
    if (p.cash + 0.001 < deal.cash) {
      return { ok: false, msg: `You need ${c.money(deal.cash)} in cash but only have ${c.money(p.cash)}.` };
    }
    p.cash = c.cents(p.cash - deal.cash);
    p.stats.deals++;
    const id = c.nextId(state, 'a');
    switch (deal.cat) {
      case 'realestate':
        p.properties.push({
          id, name: deal.title, icon: deal.icon, template: deal.template, units: deal.units,
          purchasePrice: deal.price, cost: deal.cash, reIndexAtPurchase: state.market.reIndex, valueMult: 1, localMult: 1,
          rent: deal.rent, opex: deal.opex, str: !!deal.str, land: !!deal.land,
          mortgage: deal.loan > 0 ? { balance: deal.loan, apr: deal.rate, payment: deal.payment } : null,
          rehabLeft: deal.fixer ? deal.fixer.turns : 0, arvMult: deal.fixer ? deal.fixer.arvMult : 1,
          boughtRound: state.round
        });
        break;
      case 'business':
        p.businesses.push({
          id, name: deal.title, icon: deal.icon, template: deal.template, kind: deal.kind, invested: deal.cost, cashInvested: deal.cash,
          base: deal.base, ret: deal.ret, range: deal.range, performance: 1, vol: deal.vol, fail: deal.fail, risk: deal.risk,
          rampLeft: deal.ramp, rampCashflow: deal.ramp ? -Math.round(deal.cost * (deal.kind === 'side' ? 0 : 0.005)) : 0,
          loan: deal.loan > 0 ? { balance: deal.loan, apr: deal.loanRate, payment: deal.loanPayment } : null,
          boughtRound: state.round
        });
        break;
      case 'startup':
        p.businesses.push({
          id, name: deal.title, icon: deal.icon, template: deal.template, kind: 'startup', invested: deal.cost, cashInvested: deal.cost,
          monthsLeft: deal.months, base: 0, performance: 1, vol: 0, loan: null, rampLeft: 0, boughtRound: state.round
        });
        break;
      case 'lending':
        p.notes.push({ id, name: deal.title, icon: deal.icon, principal: deal.cost, rate: deal.rate, monthsLeft: deal.months, defaultRisk: deal.defaultRisk, boughtRound: state.round });
        break;
      case 'collectible':
        p.collectibles.push({ id, name: deal.title, icon: deal.icon, cost: deal.cost, value: deal.cost, vol: deal.vol, drift: deal.drift, upkeep: deal.upkeep, boughtRound: state.round });
        break;
      default:
        return { ok: false, msg: 'That deal cannot be bought.' };
    }
    c.log(state, `${p.name} bought ${deal.title} for ${c.money(deal.cash)}${deal.cat === 'realestate' && deal.loan ? ' down' : ''}.`, 'good', p.id);
    return { ok: true, msg: `You bought ${deal.title}!` };
  }

  // ------------------------------------------------------------------ selling
  function gainText(c, net, invested) {
    const gain = net - invested;
    return `${gain >= 0 ? 'a gain' : 'a loss'} of ${c.money(Math.abs(gain))} on the ${c.money(invested)} you put in`;
  }

  /** Sell a property at market value, or at `gross` (a buyer's offer). */
  function sellProperty(state, p, prop, gross) {
    const c = C();
    const value = gross != null ? gross : c.propertyValue(state, prop);
    const fees = value * (prop.land ? 0.03 : 0.06);
    const loan = prop.mortgage ? prop.mortgage.balance : 0;
    const net = c.cents(value - fees - loan);
    if (net < 0 && p.cash < -net) {
      return { ok: false, msg: `Selling would leave ${c.money(-net)} of the mortgage unpaid, and you don't have the cash to cover it.` };
    }
    p.cash = c.cents(p.cash + net);
    p.properties = p.properties.filter((x) => x !== prop);
    c.log(state, `${p.name} sold ${prop.name} for ${c.money(value)}.`, 'neutral', p.id);
    return { ok: true, msg: `Sold ${prop.name} for ${c.money(value)}. After costs${loan ? ' and paying off the mortgage' : ''} you received ${c.money(net)} — ${gainText(c, net, prop.cost)}.` };
  }

  function sellBusiness(state, p, b, gross) {
    const c = C();
    const sale = c.businessSale(b);
    const value = gross != null ? gross : sale.value;
    const net = c.cents(value - sale.loan);
    if (net < 0 && p.cash < -net) {
      return { ok: false, msg: `Selling would leave ${c.money(-net)} of the business loan unpaid, and you don't have the cash to cover it.` };
    }
    p.cash = c.cents(p.cash + net);
    p.businesses = p.businesses.filter((x) => x !== b);
    c.log(state, `${p.name} sold ${b.name} for ${c.money(value)}.`, 'neutral', p.id);
    return { ok: true, msg: `Sold ${b.name} for ${c.money(value)}${sale.loan ? ' (after repaying its loan)' : ''}. You received ${c.money(net)} — ${gainText(c, net, b.cashInvested)}.` };
  }

  function sellCollectible(state, p, item) {
    const c = C();
    const net = c.cents(item.value * 0.9);
    p.cash = c.cents(p.cash + net);
    p.collectibles = p.collectibles.filter((x) => x !== item);
    c.log(state, `${p.name} auctioned off a ${item.name} for ${c.money(item.value)}.`, 'neutral', p.id);
    return { ok: true, msg: `Sold your ${item.name} at auction for ${c.money(item.value)} (minus a 10% fee): ${c.money(net)} — ${gainText(c, net, item.cost)}.` };
  }

  function sellNote(state, p, note) {
    const c = C();
    const net = c.cents(note.principal * 0.95);
    p.cash = c.cents(p.cash + net);
    p.notes = p.notes.filter((x) => x !== note);
    c.log(state, `${p.name} sold their ${note.name} early.`, 'neutral', p.id);
    return { ok: true, msg: `Sold your ${note.name} to another investor for ${c.money(net)} (a 5% discount for selling early).` };
  }

  // ------------------------------------------------------------------ the home you live in
  const DOWN_OPTIONS = [0.05, 0.1, 0.2];
  const DOWN_RATE_BUMP = { 0.05: 0.375, 0.1: 0.125, 0.2: 0 }; // smaller down payment → riskier loan → higher rate
  const BUY_CLOSING = 0.03;
  const SELL_COSTS = 0.06;
  const MAX_DTI = 0.43;

  /** Typical monthly rent for a home worth `value` (a price-to-rent ratio of about 18.5). */
  function rentFor(value) { return C().roundTo(value * 0.0045, 5); }

  /** Monthly income lenders count: salary, side gigs and positive passive income. */
  function qualifyingIncome(state, p) {
    const s = C().summarize(state, p);
    return s.salary + s.gigs + Math.max(0, s.passive);
  }

  /** Three homes for sale this turn — a starter, a similar and an upgrade — sized to the player's pay. */
  function homeListings(state, p, rng) {
    const { roundTo, amortPayment, nextId } = C();
    const rate = MMS.Market.baseMortgageRate(state);
    const income = Math.max(p.job.salary, p.job.startSalary);
    const perDollar = 0.9 * amortPayment(1, rate, 360) + 0.0013;   // monthly cost of $1 of home, 10% down
    const base = income * 0.28 / perDollar * state.market.reIndex / 100; // the "28% of income" guideline
    const tiers = [['starter', 0.65], ['similar', 1], ['upgrade', 1.5]];
    return tiers.map(([tier, mult]) => {
      const price = roundTo(base * mult * rng.float(0.88, 1.12), 1000);
      return {
        id: nextId(state, 'h'), tier, name: rng.pick(D().HOME_LISTINGS[tier]), price, rate,
        ownerCosts: roundTo(price * rng.float(0.0011, 0.0016), 5)
      };
    });
  }

  /** Everything about buying `listing` with `downPct` down (and selling the current home first, if any). */
  function homePurchaseTerms(state, p, listing, downPct) {
    const { roundTo, amortPayment, homeSale, homeMortgage, debtPayments } = C();
    const rate = listing.rate + (DOWN_RATE_BUMP[downPct] || 0);
    const down = roundTo(listing.price * downPct, 100);
    const closing = roundTo(listing.price * BUY_CLOSING, 100);
    const loan = listing.price - down;
    const payment = Math.round(amortPayment(loan, rate, 360));
    const sale = p.home ? homeSale(state, p) : null;
    const oldMortgage = homeMortgage(p);
    const available = p.cash + (sale ? sale.net : 0);
    const income = qualifyingIncome(state, p);
    // Buying always sells the current home first, so its mortgage drops out. A spouse pays half the new one.
    const share = C().isMarried(p) ? 0.5 : 1;
    const otherDebt = debtPayments(p) - (oldMortgage ? oldMortgage.payment : 0);
    const newDebt = otherDebt + payment * share;
    const dti = income > 0 ? newDebt / income : Infinity;
    let reason = null;
    if (!DOWN_OPTIONS.includes(downPct)) reason = 'Choose a 5%, 10% or 20% down payment.';
    else if (available < down + closing) reason = `You need ${C().money(down + closing)} for the down payment and closing costs${sale ? ' (counting what your current home would sell for)' : ''}, but have ${C().money(available)}.`;
    else if (dti > MAX_DTI) reason = `The bank says no: all your debt payments would be ${Math.round(dti * 100)}% of your income. Lenders usually cap that at ${Math.round(MAX_DTI * 100)}%.`;
    return { rate, down, closing, loan, payment, sale, available, dti, reason, monthly: payment + listing.ownerCosts };
  }

  function buyHome(state, p, listing, downPct) {
    const c = C();
    const t = homePurchaseTerms(state, p, listing, downPct);
    if (t.reason) return { ok: false, msg: t.reason };
    let soldMsg = '';
    if (p.home) {
      const r = sellHome(state, p, { rent: 'none' });
      if (!r.ok) return r;
      soldMsg = `${r.msg} `;
    }
    p.cash = c.cents(p.cash - t.down - t.closing);
    c.addDebt(state, p, { type: 'mortgage', name: 'Home mortgage', balance: t.loan, apr: t.rate, payment: t.payment });
    p.home = { name: listing.name, value: listing.price, reIndex: state.market.reIndex, localMult: 1, boughtRound: state.round, purchasePrice: listing.price };
    p.ownsHome = true;
    p.expenses.housing = listing.ownerCosts;
    c.log(state, `${p.name} bought a home: ${listing.name} for ${c.money(listing.price)}.`, 'good', p.id);
    return { ok: true, msg: `${soldMsg}🏡 You bought the ${listing.name} for ${c.money(listing.price)}: ${c.money(t.down)} down + ${c.money(t.closing)} closing costs, and a ${c.money(t.loan)} mortgage at ${t.rate.toFixed(3)}% (${c.money(t.payment)}/mo). Taxes, insurance and upkeep add ${c.money(listing.ownerCosts)}/mo.` };
  }

  /**
   * Sell the home you live in. opts.gross = a buyer's offer (default: market value).
   * opts.rent = 'similar' | 'smaller' (move into a rental) or 'none' (buying another home).
   */
  function sellHome(state, p, opts) {
    const c = C();
    opts = opts || {};
    if (!p.home) return { ok: false, msg: 'You don\'t own a home.' };
    const market = c.homeValue(state, p);
    const value = opts.gross != null ? opts.gross : market;
    const fees = value * SELL_COSTS;
    const m = c.homeMortgage(p);
    const loan = m ? m.balance : 0;
    const net = c.cents(value - fees - loan);
    if (net < 0 && p.cash < -net) return { ok: false, msg: `Your home is "underwater": selling would leave ${c.money(-net)} of the mortgage unpaid, and you don't have the cash to cover it.` };
    const gain = value - p.home.purchasePrice;
    const name = p.home.name || 'your home';
    p.cash = c.cents(p.cash + net);
    if (m) p.debts = p.debts.filter((d) => d !== m);
    p.home = null;
    p.ownsHome = false;
    let rentMsg = '';
    if (opts.rent !== 'none') {
      const rent = c.roundTo(rentFor(market) * (opts.rent === 'smaller' ? 0.7 : 1), 5);
      p.expenses.housing = rent;
      rentMsg = ` You moved into a ${opts.rent === 'smaller' ? 'smaller ' : ''}rental for ${c.money(rent)}/mo.`;
    }
    c.log(state, `${p.name} sold their home for ${c.money(value)}.`, 'neutral', p.id);
    return { ok: true, msg: `Sold ${name === 'Your home' ? 'your home' : `the ${name}`} for ${c.money(value)} (${gain >= 0 ? 'up' : 'down'} ${c.money(Math.abs(gain))} from what it cost). After ${c.money(fees)} in selling costs${loan ? ' and paying off the mortgage' : ''} you received ${c.money(net)}.${rentMsg}` };
  }

  // ------------------------------------------------------------------ analysis (educational)
  const METRIC_HELP = {
    coc: 'Cash-on-cash return: yearly cashflow ÷ the cash you put in. It tells you how hard YOUR money is working. Stock-market average is ~7–10%/yr.',
    cap: 'Cap rate: yearly net operating income (rent − expenses, before the mortgage) ÷ price. It compares properties as if bought with all cash.',
    onePct: 'The "1% rule" of thumb: monthly rent should be at least 1% of the price for a rental to cashflow well.',
    dscr: 'Debt-service coverage: net operating income ÷ mortgage payment. Above 1.25× means rent comfortably covers the loan.',
    payback: 'Payback period: how many months of cashflow it takes to earn back your cash.',
    ltv: 'Loan-to-value: how much of the price is borrowed. Leverage multiplies both gains and losses.',
    multiple: 'Price ÷ annual profit. Lower is cheaper: a 3× multiple means you pay three years of profit.',
    yield: 'Yearly interest ÷ amount lent.'
  };

  function verdict(roi) {
    if (roi == null) return { label: 'Uncertain', tone: 'neutral' };
    if (roi <= 0) return { label: 'Loses money', tone: 'bad' };
    if (roi < 0.05) return { label: 'Weak', tone: 'bad' };
    if (roi < 0.15) return { label: 'Fair', tone: 'neutral' };
    if (roi < 0.3) return { label: 'Good', tone: 'good' };
    return { label: 'Excellent', tone: 'good' };
  }

  /** Key metrics for a deal, each with a plain-English explanation. */
  function analyze(deal) {
    const c = C();
    const pct = (x) => `${(x * 100).toFixed(1)}%`;
    const metrics = [];
    if (deal.cat === 'realestate' && !deal.land) {
      const noi = deal.rent - deal.opex;
      metrics.push({ label: 'Cash-on-cash return', value: pct(deal.roi), help: METRIC_HELP.coc, tone: deal.roi > 0.15 ? 'good' : deal.roi > 0 ? 'neutral' : 'bad' });
      metrics.push({ label: 'Cap rate', value: pct(noi * 12 / (deal.price * (deal.fixer ? deal.fixer.arvMult : 1))), help: METRIC_HELP.cap });
      const onePct = deal.rent / (deal.price + (deal.fixer ? deal.fixer.rehab : 0));
      metrics.push({ label: '1% rule', value: `${(onePct * 100).toFixed(2)}% ${onePct >= 0.01 ? '✓' : '✗'}`, help: METRIC_HELP.onePct, tone: onePct >= 0.01 ? 'good' : 'bad' });
      if (deal.payment > 0) metrics.push({ label: 'Debt coverage', value: `${(noi / deal.payment).toFixed(2)}×`, help: METRIC_HELP.dscr, tone: noi / deal.payment >= 1.25 ? 'good' : 'bad' });
      metrics.push({ label: 'Loan-to-value', value: pct(deal.loan / deal.price), help: METRIC_HELP.ltv });
      if (deal.cashflow > 0) metrics.push({ label: 'Payback period', value: `${Math.ceil(deal.cash / deal.cashflow)} months`, help: METRIC_HELP.payback });
    } else if (deal.cat === 'business' && deal.base != null) {
      metrics.push({ label: 'Cash-on-cash return', value: pct(deal.roi), help: METRIC_HELP.coc, tone: deal.roi > 0.15 ? 'good' : deal.roi > 0 ? 'neutral' : 'bad' });
      if (deal.base > 0) metrics.push({ label: 'Price ÷ annual profit', value: `${(deal.cost / (deal.base * 12)).toFixed(1)}×`, help: METRIC_HELP.multiple });
      if (deal.cashflow > 0) metrics.push({ label: 'Payback period', value: `${Math.ceil(deal.cash / deal.cashflow)} months`, help: METRIC_HELP.payback });
      if (deal.loan) metrics.push({ label: 'Financed', value: pct(deal.loan / deal.cost), help: METRIC_HELP.ltv });
    } else if (deal.cat === 'lending') {
      metrics.push({ label: 'Annual yield', value: pct(deal.rate / 100), help: METRIC_HELP.yield, tone: 'good' });
      metrics.push({ label: 'Total interest', value: c.money(deal.monthly * deal.months), help: 'What you collect over the full term if the borrower pays every month.' });
    }
    const v = deal.cat === 'realestate' && deal.land ? { label: 'Speculative', tone: 'neutral' }
      : deal.cat === 'startup' || deal.cat === 'collectible' ? { label: 'Speculative', tone: 'neutral' }
      : verdict(deal.roi);
    return { metrics, verdict: v };
  }

  MMS.Deals = {
    generate, build, purchase, capacity, sellProperty, sellBusiness, sellCollectible, sellNote, analyze, METRIC_HELP,
    rentFor, homeListings, homePurchaseTerms, buyHome, sellHome, DOWN_OPTIONS, MAX_DTI
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = MMS.Deals;
})(typeof window !== 'undefined' ? window : globalThis);
