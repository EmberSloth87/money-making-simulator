/*
 * events.js — Each turn's pop-up "cards": job news, life events, luxury temptations,
 * emergencies, charity, asset events, buyer offers, stock tips and deals.
 * Every card carries a short money lesson for the educational side of the game.
 */
(function (global) {
  'use strict';
  const MMS = global.MMS || (global.MMS = {});
  const C = () => MMS.Core;
  const D = () => MMS.Data;

  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  function card(state, props) {
    return Object.assign({
      id: C().nextId(state, 'c'),
      kind: 'event',
      type: 'info',
      icon: 'ℹ️',
      title: '',
      text: '',
      tone: 'neutral',
      lesson: '',
      choices: [{ id: 'ok', label: 'OK' }],
      required: false,
      resolved: false,
      seen: false,
      outcome: null,
      data: {}
    }, props);
  }

  /** Info cards apply their effect immediately; the player just acknowledges them. */
  function info(state, p, props) {
    const c = card(state, Object.assign({ resolved: true }, props));
    if (props.tone === 'good') p.stats.good++;
    if (props.tone === 'bad') p.stats.bad++;
    return c;
  }

  function expenseCard(state, p, props, cost) {
    if (props.tone === 'bad') p.stats.bad++;
    return card(state, Object.assign({
      type: 'expense',
      required: true,
      data: { cost },
      choices: [
        { id: 'cash', label: `Pay cash (${C().money(cost)})`, style: 'primary' },
        { id: 'credit', label: 'Put it on a credit card' }
      ]
    }, props));
  }

  const LESSONS = {
    emergencyFund: 'An emergency fund of 3–6 months of expenses keeps surprises like this off high-interest credit cards.',
    luxury: 'A luxury on a ~25% APR credit card can cost far more than the sticker price if you only make minimum payments.',
    windfall: 'Windfalls are best used to pay off high-interest debt or to invest in assets that pay you every month.',
    creep: 'Small recurring costs add up: +$100/mo is $1,200 a year, and it raises your freedom target by $200/mo (2× expenses).'
  };

  // ------------------------------------------------------------------ job events
  /** Longest possible job search: 6 months, cut by 2 for each level of networking (a conference, a club). */
  function maxJobSearch(p) { return 6 - 2 * C().networkLevel(p); }

  function downsize(state, p, rng) {
    const { roundTo, money, log, networkLevel } = C();
    const turns = rng.int(1, maxJobSearch(p));
    p.unemployedTurns = turns;
    p.stats.timesDownsized++;
    let text = `Your company is restructuring and your position was eliminated. You'll go ${plural(turns, 'turn')} without a paycheck while you look for work.`;
    if (networkLevel(p) > 0) text += ` Your professional network is already passing your name around, so the search should be shorter than usual (1–${maxJobSearch(p)} months instead of 1–6).`;
    if (rng.chance(0.5)) {
      const sev = roundTo(p.job.salary * rng.float(0.5, 2), 100);
      p.cash += sev;
      text += ` At least they paid you ${money(sev)} in severance.`;
    }
    log(state, `${p.name} was downsized for ${plural(turns, 'turn')}.`, 'bad', p.id);
    return info(state, p, {
      icon: '📦', title: 'Downsized!', tone: 'bad', text,
      lesson: 'Losing a job is the #1 reason people fall into debt. Passive income keeps paying even when the paycheck stops — and so does a healthy emergency fund.'
    });
  }

  function promotion(state, p, rng) {
    const { roundTo, money, jobTitle, log } = C();
    const old = p.job.salary;
    p.job.salary = roundTo(old * (1 + rng.float(0.08, 0.2)), 50);
    p.stats.promotions++;
    let title = 'Big raise!';
    let text = `You're the top performer on your team. Your pay rises from ${money(old)} to ${money(p.job.salary)}/mo.`;
    if (p.job.level < D().JOB_LEVELS.length - 1) {
      p.job.level++;
      title = 'Promotion!';
      text = `You've been promoted to ${jobTitle(p)}! Your pay rises from ${money(old)} to ${money(p.job.salary)}/mo.`;
    }
    log(state, `${p.name} got a promotion (${money(old)} → ${money(p.job.salary)}/mo).`, 'good', p.id);
    return info(state, p, {
      icon: '🎖️', title, tone: 'good', text,
      lesson: 'Raises are a chance to save more, not spend more. If your expenses stay flat, every extra dollar can go toward assets.'
    });
  }

  /** A small, permanent bump in pay — smaller than a promotion, and no new title. */
  function raise(state, p, rng) {
    const { roundTo, money, log } = C();
    const old = p.job.salary;
    const why = rng.pick([
      ['Merit raise', 'Your annual review went well'],
      ['Cost-of-living raise', 'Prices have been rising, so your employer bumped everyone\'s pay'],
      ['Raise', 'You asked for a raise — and got it'],
      ['Market adjustment', 'HR noticed you were paid below the market rate for your role']
    ]);
    p.job.salary = Math.max(old + 25, roundTo(old * (1 + rng.float(0.02, 0.04)), 25));
    p.stats.raises++;
    log(state, `${p.name} got a raise (${money(old)} → ${money(p.job.salary)}/mo).`, 'good', p.id);
    return info(state, p, {
      icon: '📈', title: why[0], tone: 'good',
      text: `${why[1]}. Your pay rises by ${money(p.job.salary - old)}/mo, from ${money(old)} to ${money(p.job.salary)}/mo — for good.`,
      lesson: `Small raises compound: ${money(p.job.salary - old)}/mo is ${money((p.job.salary - old) * 12)} a year, every year. Investing a raise instead of spending it is one of the easiest ways to build wealth.`
    });
  }

  function sideGigOffer(state, p, rng) {
    const g = rng.pick(D().SIDE_GIGS);
    const income = C().roundTo(Math.max(250, p.job.startSalary * rng.float(0.08, 0.2)), 25);
    const turns = rng.int(3, 8);
    const viaNetwork = C().networkLevel(p) > 0 && rng.chance(0.5);
    return {
      type: 'sidegig', resolved: false, icon: '🛠️', title: `Side gig: ${g.title}`,
      text: `${viaNetwork ? 'Someone you met through networking passed this along: ' : ''}${g.text} It pays about ${C().money(income)}/mo for the next ${plural(turns, 'turn')}.`,
      data: { title: g.title, income, turns },
      choices: [{ id: 'accept', label: `Take the gig (+${C().money(income)}/mo)`, style: 'primary' }, { id: 'decline', label: 'No thanks' }],
      lesson: 'Side gigs boost cashflow, but they are still earned income — they don\'t count toward financial freedom. Invest the extra money!'
    };
  }

  // ------------------------------------------------------------------ good life events
  const GOOD = [
    { id: 'bonus', w: 6, ok: (s, p) => C().isEmployed(p), make(state, p, rng) {
      const amt = C().roundTo(p.job.salary * rng.float(0.3, 1.5), 50);
      p.cash += amt;
      return { icon: '💰', title: 'Performance bonus!', text: `Your hard work paid off — your boss handed you a ${C().money(amt)} bonus.`, lesson: LESSONS.windfall };
    } },
    { id: 'refund', w: 5, make(state, p, rng) {
      const amt = C().roundTo(Math.max(200, p.job.salary * rng.float(0.1, 0.6)), 10);
      p.cash += amt;
      return { icon: '🧾', title: 'Tax refund', text: `The tax office sent you a refund of ${C().money(amt)}.`, lesson: 'A big refund means you over-paid during the year — effectively an interest-free loan to the government.' };
    } },
    { id: 'freelance', w: 5, ok: (s, p) => !p.retired, make(state, p, rng) {
      const amt = C().roundTo(rng.float(400, 3500) * C().clamp(p.job.startSalary / 5000, 0.6, 2), 50);
      p.cash += amt;
      return { icon: '🧑‍💻', title: 'Freelance gig', text: `A former client needed help with a weekend project and paid you ${C().money(amt)}.`, lesson: 'Freelance work is earned income: it stops when you stop working. Investing it turns it into passive income.' };
    } },
    { id: 'inheritance', w: 1, make(state, p, rng) {
      const amt = C().roundTo(rng.float(5000, 40000), 500);
      p.cash += amt;
      return { icon: '📜', title: 'Inheritance', text: `A distant great-aunt left you ${C().money(amt)} in her will.`, lesson: 'Most windfalls are spent within a few years. Putting them to work in income-producing assets makes them last.' };
    } },
    { id: 'scratch', w: 1.5, make(state, p, rng) {
      const amt = rng.pick([100, 100, 250, 500, 1000, 2500]);
      p.cash += amt;
      return { icon: '🎟️', title: 'Lucky scratch ticket', text: `A friend gave you a scratch-off ticket for your birthday. You won ${C().money(amt)}!`, lesson: 'Lotteries pay back far less than they take in on average. Enjoy the luck, but don\'t make it a plan.' };
    } },
    { id: 'sidegig', w: 4, ok: (s, p) => !p.retired && p.sideGigs.length < 2, make: sideGigOffer },
    { id: 'cutbill', w: 3, make(state, p, rng) {
      if (rng.chance(0.5)) {
        const cut = C().roundTo(p.expenses.insurance * rng.float(0.08, 0.2), 5);
        p.expenses.insurance = Math.max(0, p.expenses.insurance - cut);
        return { icon: '🔍', title: 'You shopped around for insurance', text: `Switching providers saves you ${C().money(cut)}/mo for the same coverage.`, lesson: 'Cutting a recurring bill is powerful: it raises your cashflow AND lowers the passive income you need to be free.' };
      }
      const cut = C().roundTo(Math.min(p.expenses.misc * 0.3, rng.float(30, 120)), 5);
      p.expenses.misc = Math.max(0, p.expenses.misc - cut);
      return { icon: '✂️', title: 'Subscription purge', text: `You found six subscriptions you never use. Cancelling them saves ${C().money(cut)}/mo.`, lesson: 'Audit recurring charges once in a while — they quietly raise your cost of living.' };
    } },
    { id: 'rewards', w: 2.5, make(state, p, rng) {
      const amt = C().roundTo(rng.float(100, 600), 10);
      p.cash += amt;
      return { icon: '🎁', title: 'Surprise check', text: `A class-action settlement you forgot about sent you ${C().money(amt)}.`, lesson: LESSONS.windfall };
    } },
    { id: 'refi', w: 2, ok: (state, p) => {
      const m = p.debts.find((d) => d.type === 'mortgage');
      return m && m.balance > 20000 && MMS.Market.baseMortgageRate(state) < m.apr - 0.75;
    }, make(state, p, rng) {
      const { roundTo, amortPayment, money } = C();
      const m = p.debts.find((d) => d.type === 'mortgage');
      const rate = MMS.Market.baseMortgageRate(state);
      const newPay = Math.round(amortPayment(m.balance, rate, 360));
      const fee = roundTo(m.balance * 0.02, 100);
      const save = m.payment - newPay;
      return {
        type: 'refi', resolved: false, icon: '🏦', title: 'Refinance offer',
        text: `Rates have dropped. Your lender offers to refinance your ${money(m.balance)} home mortgage from ${m.apr.toFixed(2)}% to ${rate.toFixed(2)}% (new 30-year term). Your payment would fall from ${money(m.payment)} to ${money(newPay)}/mo. Closing costs: ${money(fee)}.`,
        data: { debtId: m.id, rate, newPay, fee },
        choices: [{ id: 'accept', label: `Refinance (pay ${money(fee)})`, style: 'primary' }, { id: 'decline', label: 'Keep my current loan' }],
        lesson: `Break-even = closing costs ÷ monthly savings = about ${save > 0 ? Math.ceil(fee / save) : '∞'} months. After that, the savings are pure profit.`
      };
    } }
  ];

  // ------------------------------------------------------------------ bad life events
  const BAD = [
    { id: 'luxury', w: 10, make(state, p, rng) {
      const life = C().lifestyleOf(p);
      const pool = D().LUXURIES.filter((l) => (!l.minLifestyle || p.lifestyle >= l.minLifestyle) && (!l.homeowner || p.ownsHome));
      const l = rng.pick(pool);
      const scale = life.luxury * C().clamp(p.job.startSalary / 5000, 0.6, 2.2);
      const cost = C().roundTo(rng.range(l.cost) * scale, 10);
      return { expense: cost, icon: l.icon, title: l.title, text: `${l.text} Cost: ${C().money(cost)}.`, lesson: LESSONS.luxury, flavor: 'luxury' };
    } },
    { id: 'emergency', w: 10, make(state, p, rng) {
      const pool = D().EMERGENCIES.filter((e) => !e.homeowner || p.ownsHome);
      const e = rng.pick(pool);
      const cost = C().roundTo(rng.range(e.cost) * C().clamp(p.job.startSalary / 5000, 0.7, 1.6), 10);
      return { expense: cost, icon: e.icon, title: e.title, text: `${e.text} Cost: ${C().money(cost)}.`, lesson: LESSONS.emergencyFund };
    } },
    { id: 'creep', w: 3, make(state, p, rng) {
      const options = [
        ['transport', 'Your car insurance premium jumped after a fender-bender.'],
        ['fun', 'You started a pricey new hobby that comes with monthly fees.'],
        ['food', 'You\'ve gotten used to ordering takeout most nights.'],
        ['utilities', 'Your utility company raised its rates.'],
        ['misc', 'You signed up for a monthly gym, a meal kit and a streaming bundle.']
      ];
      const [cat, why] = rng.pick(options);
      const amt = C().roundTo(rng.float(40, 220) * C().clamp(p.job.startSalary / 5000, 0.6, 2), 5);
      p.expenses[cat] += amt;
      return { icon: '📈', title: 'Lifestyle creep', text: `${why} Your monthly expenses rise by ${C().money(amt)}.`, lesson: LESSONS.creep };
    } },
    { id: 'scam', w: 1, make(state, p, rng) {
      const amt = C().roundTo(rng.float(300, 2500), 10);
      if (p.cash >= amt) p.cash -= amt; else C().chargeCredit(state, p, amt);
      return { icon: '🎣', title: 'Scammed!', text: `A convincing "bank fraud department" call tricked you into sending ${C().money(amt)}.`, lesson: 'Real banks never ask you to move money or share codes over the phone. If it feels urgent and unusual, hang up and call back on the official number.' };
    } },
    { id: 'renthike', w: 2.5, ok: (s, p) => !p.ownsHome, make(state, p, rng) {
      const amt = C().roundTo(p.expenses.housing * rng.float(0.04, 0.09), 5);
      p.expenses.housing += amt;
      return { icon: '🏚️', title: 'Rent increase', text: `Your landlord raised your rent by ${C().money(amt)}/mo when your lease renewed.`, lesson: 'Rents tend to rise with inflation. Homeowners with a fixed-rate mortgage lock in their payment — and landlords collect the increases.' };
    } }
  ];

  function lifeEvent(state, p, rng, good) {
    const list = (good ? GOOD : BAD).filter((e) => !e.ok || e.ok(state, p));
    const net = C().networkLevel(p);
    const e = rng.weighted(list, (x) => x.w * (x.id === 'sidegig' ? 1 + net : 1));
    const r = e.make(state, p, rng);
    const tone = r.tone || (good ? 'good' : 'bad');
    if (r.expense != null) return expenseCard(state, p, { icon: r.icon, title: r.title, text: r.text, tone, lesson: r.lesson, data: { cost: r.expense, flavor: r.flavor } }, r.expense);
    if (r.type) {
      return card(state, Object.assign({ tone }, r));
    }
    return info(state, p, { icon: r.icon, title: r.title, text: r.text, tone, lesson: r.lesson });
  }

  // ------------------------------------------------------------------ asset events
  function propertyOffer(state, p, rng, prop) {
    const { roundTo, money, propertyValue, luckyRoll, lerp } = C();
    const value = propertyValue(state, prop);
    const mult = lerp(prop.land ? [1.4, 3.0] : [1.08, 1.35], luckyRoll(p, rng));
    const offer = roundTo(value * mult, 500);
    const fees = offer * (prop.land ? 0.03 : 0.06);
    const loan = prop.mortgage ? prop.mortgage.balance : 0;
    const net = offer - fees - loan;
    const buyer = prop.land ? 'A developer' : rng.pick(['An investor', 'A young family', 'A big rental company', 'A relocating executive']);
    return card(state, {
      type: 'propoffer', icon: '🤝', tone: 'good', title: `Offer for your ${prop.name}`,
      text: `${buyer} offers ${money(offer)} for your ${prop.name} (market value ≈ ${money(value)}). After ${money(fees)} in selling costs${loan ? ` and paying off the ${money(loan)} mortgage` : ''}, you'd pocket ${money(net)}.`,
      data: { propId: prop.id, offer },
      choices: [{ id: 'accept', label: `Sell for ${money(offer)}`, style: 'primary' }, { id: 'decline', label: 'Keep it' }],
      lesson: 'Selling turns equity into cash you can reinvest — but you give up the monthly cashflow. Compare what the cash could earn elsewhere.'
    });
  }

  function businessOffer(state, p, rng, b) {
    const { roundTo, money, businessProfit, luckyRoll, lerp } = C();
    const profit = businessProfit(b);
    const offer = roundTo(Math.max(profit * 12 * lerp([2.5, 5], luckyRoll(p, rng)), b.invested * 0.5), 500);
    const loan = b.loan ? b.loan.balance : 0;
    return card(state, {
      type: 'bizoffer', icon: '💼', tone: 'good', title: `Buyout offer for ${b.name}`,
      text: `A competitor wants to buy ${b.name} for ${money(offer)} — about ${(offer / Math.max(1, profit * 12)).toFixed(1)}× its annual profit of ${money(profit * 12)}.${loan ? ` After paying off the ${money(loan)} loan you'd pocket ${money(offer - loan)}.` : ''}`,
      data: { bizId: b.id, offer },
      choices: [{ id: 'accept', label: `Sell for ${money(offer)}`, style: 'primary' }, { id: 'decline', label: 'Keep it' }],
      lesson: 'Small businesses usually sell for 2–5× their annual profit. That multiple tells you how many years of profit a buyer is paying for.'
    });
  }

  function propertyEvent(state, p, rng, prop, karma) {
    const { roundTo, money, clamp, chargeCredit } = C();
    if (prop.land) {
      const amt = roundTo(prop.opex * rng.float(0.1, 0.3), 5) || 5;
      prop.opex += amt;
      return info(state, p, { icon: '🏛️', tone: 'bad', title: 'Property tax reassessment', text: `The county reassessed your ${prop.name}. Taxes rise by ${money(amt)}/mo.`, lesson: 'Land produces no income, so its carrying costs come straight out of your pocket while you wait for it to appreciate.' });
    }
    const scale = clamp(Math.sqrt(prop.purchasePrice / 150000), 0.5, 5);
    if (rng.chance(karma ? 0.6 : 0.35)) {
      if (rng.chance(0.65)) {
        const pct = rng.float(0.03, 0.08);
        const amt = roundTo(prop.rent * pct, 5);
        prop.rent += amt;
        return info(state, p, { icon: '📈', tone: 'good', title: 'Rent increase', text: `Local rents are rising. You raise the rent on ${prop.name} by ${money(amt)}/mo.`, lesson: 'Rents tend to rise over time while a fixed-rate mortgage payment stays the same — that is how a rental\'s cashflow grows.' });
      }
      const amt = roundTo(rng.float(300, 1500) * scale, 50);
      p.cash += amt;
      return info(state, p, { icon: '🧾', tone: 'good', title: 'Lease-break fee', text: `A tenant at ${prop.name} paid ${money(amt)} to break their lease early, and you found a new tenant right away.`, lesson: 'Good leases protect landlords. Fees and deposits cover the cost of turnover.' });
    }
    const roll = rng.next();
    if (roll < 0.45) {
      const why = rng.pick(['The roof is leaking', 'The HVAC system died', 'A pipe burst behind the walls', 'The last tenants trashed the place', 'The city requires new safety upgrades']);
      const cost = roundTo(rng.float(500, 3500) * scale, 50);
      return expenseCard(state, p, { icon: '🛠️', tone: 'bad', title: `Repairs at ${prop.name}`, text: `${why}. Repairs cost ${money(cost)}.`, lesson: 'Landlords should budget 5–10% of rent for repairs and keep cash reserves, so surprises don\'t go on a credit card.' }, cost);
    }
    if (roll < 0.8) {
      const months = rng.int(1, 2);
      const lost = roundTo(prop.rent / Math.max(1, prop.units) * months, 5);
      if (p.cash >= lost) p.cash -= lost; else chargeCredit(state, p, lost);
      return info(state, p, { icon: '🚪', tone: 'bad', title: 'Vacancy', text: `A unit at ${prop.name} sat empty for ${plural(months, 'month')} between tenants. You lost ${money(lost)} of rent.`, lesson: 'Vacancies are a normal cost of owning rentals. Smart investors assume a few percent of rent will be lost to them each year.' });
    }
    const amt = roundTo(prop.opex * rng.float(0.05, 0.12), 5);
    prop.opex += amt;
    return info(state, p, { icon: '🏛️', tone: 'bad', title: 'Higher taxes & insurance', text: `Property taxes and insurance on ${prop.name} rose by ${money(amt)}/mo.`, lesson: 'Operating expenses (taxes, insurance, maintenance) tend to rise over time. A deal with thin cashflow can turn negative.' });
  }

  function businessEvent(state, p, rng, b, karma) {
    const { roundTo, money, clamp, businessProfit } = C();
    const roll = rng.next();
    const goodOdds = karma ? 0.6 : 0.4;
    if (roll < goodOdds * 0.6) {
      const boost = rng.float(0.2, 0.45);
      b.performance = clamp(b.performance + boost, 0.2, 2.2);
      const what = b.kind === 'side' ? 'Your project went viral online' : rng.pick(['A local influencer raved about you', 'You landed a big corporate customer', 'A newspaper wrote a glowing feature']);
      return info(state, p, { icon: '🔥', tone: 'good', title: `${b.name} is on fire`, text: `${what}! Profit is up — now about ${money(businessProfit(b))}/mo.`, lesson: 'Business income is less predictable than rent or bond interest. Good months and bad months average out over time.' });
    }
    if (roll < goodOdds && b.kind === 'business') {
      const cost = roundTo(b.invested * rng.float(0.25, 0.5), 500);
      const boost = Math.round(rng.float(0.25, 0.45) * 100) / 100;
      const extra = Math.round(b.base * boost);
      return card(state, {
        type: 'expand', icon: '🏗️', tone: 'good', title: `Expansion opportunity: ${b.name}`,
        text: `You could expand ${b.name} for ${money(cost)}. That should add about ${money(extra)}/mo of profit.`,
        data: { bizId: b.id, cost, boost },
        choices: [{ id: 'invest', label: `Expand (${money(cost)})`, style: 'primary' }, { id: 'decline', label: 'Not now' }],
        lesson: `Payback period = cost ÷ extra monthly profit ≈ ${extra > 0 ? Math.ceil(cost / extra) : '∞'} months. The shorter the payback, the better the investment.`
      });
    }
    if (roll < 0.75) {
      const drop = rng.float(0.15, 0.3);
      b.performance = clamp(b.performance - drop, 0.2, 2.2);
      const what = b.kind === 'side' ? 'A platform algorithm change buried your content' : rng.pick(['A competitor opened across the street', 'Your best manager quit', 'A string of bad online reviews scared customers off']);
      return info(state, p, { icon: '📉', tone: 'bad', title: `Rough patch for ${b.name}`, text: `${what}. Profit drops to about ${money(businessProfit(b))}/mo.`, lesson: 'Concentration risk: relying on one business (or one customer) for income is risky. Diversified income streams are sturdier.' });
    }
    const cost = roundTo(b.invested * rng.float(0.02, 0.07), 50);
    return expenseCard(state, p, { icon: '🔧', tone: 'bad', title: `Equipment breakdown at ${b.name}`, text: `Critical equipment failed. Repairs cost ${money(cost)}.`, lesson: 'Businesses need cash reserves for repairs. Owners who spend every dollar of profit get caught short.' }, cost);
  }

  function assetEvent(state, p, rng, karma) {
    const { businessProfit } = C();
    const props = p.properties.filter((pr) => pr.rehabLeft === 0);
    const bizs = p.businesses.filter((b) => b.kind !== 'startup' && b.rampLeft === 0);
    const boost = karma ? 1.5 : 1;
    if (p.home && rng.chance(0.035)) return neighborhoodEvent(state, p, rng, p.home, true, karma);
    if (p.home && rng.chance(0.015 * boost)) return homeOffer(state, p, rng);
    const valued = props.filter((pr) => !pr.land);
    if (valued.length && rng.chance(0.03)) return neighborhoodEvent(state, p, rng, rng.pick(valued), false, karma);
    if (props.length && rng.chance(0.06 * boost)) return propertyOffer(state, p, rng, rng.pick(props));
    const sellable = bizs.filter((b) => businessProfit(b) > 0);
    if (sellable.length && rng.chance(0.04 * boost)) return businessOffer(state, p, rng, rng.pick(sellable));
    for (const pr of rng.shuffle(props)) if (rng.chance(0.07)) return propertyEvent(state, p, rng, pr, karma);
    for (const b of rng.shuffle(bizs)) if (rng.chance(0.08)) return businessEvent(state, p, rng, b, karma);
    return null;
  }

  // ------------------------------------------------------------------ neighborhood news & home offers
  /** Local news moves the value of one home or rental by 4–12%, up or down. */
  function neighborhoodEvent(state, p, rng, target, isHome, karma) {
    const { money, propertyValue, homeValue } = C();
    const valueOf = () => (isHome ? homeValue(state, p) : propertyValue(state, target));
    const before = valueOf();
    const up = rng.chance(karma ? 0.65 : 0.5);
    const pct = rng.float(0.04, 0.12);
    target.localMult = (target.localMult || 1) * (up ? 1 + pct : 1 - pct);
    const after = valueOf();
    const name = isHome ? 'your home' : target.name;
    const text = `${rng.pick(D().NEIGHBORHOOD_NEWS[up ? 'up' : 'down']).replace('{name}', name)} ${isHome ? 'Your home' : `${target.name}`} is now worth about ${money(after)} (was ${money(before)}).`;
    return info(state, p, {
      icon: up ? '🏘️' : '🚧', tone: up ? 'good' : 'bad',
      title: up ? (isHome ? 'Your home value jumped' : 'Neighborhood on the rise') : (isHome ? 'Your home value dropped' : 'Neighborhood troubles'),
      text: text.charAt(0).toUpperCase() + text.slice(1),
      lesson: isHome
        ? 'A home\'s value depends on its location as much as the house itself. Gains and losses are only "on paper" until you sell — and selling costs about 6%, plus you still need somewhere to live.'
        : '"Location, location, location": the same building can be worth very different amounts depending on schools, jobs, transit and safety nearby.'
    });
  }

  function homeOffer(state, p, rng) {
    const { roundTo, money, homeValue, homeMortgage, luckyRoll, lerp } = C();
    const value = homeValue(state, p);
    const offer = roundTo(value * lerp([1.04, 1.18], luckyRoll(p, rng)), 1000);
    const m = homeMortgage(p);
    const net = offer * 0.94 - (m ? m.balance : 0);
    const rent = MMS.Deals.rentFor(value);
    return card(state, {
      type: 'homeoffer', icon: '📬', tone: 'good', title: 'Someone wants to buy your home',
      text: `A buyer who loves your neighborhood sent an unsolicited offer of ${money(offer)} for your home (market value ≈ ${money(value)}). After 6% selling costs${m ? ` and paying off your ${money(m.balance)} mortgage` : ''} you'd pocket about ${money(net)}. You'd need to move: a similar rental runs about ${money(rent)}/mo, a smaller one about ${money(rent * 0.7)}/mo — or you can buy another home from the listings in the Portfolio tab.`,
      data: { offer },
      choices: [
        { id: 'similar', label: `Sell & rent a similar place (~${money(rent)}/mo)`, style: 'primary' },
        { id: 'smaller', label: `Sell & rent smaller (~${money(rent * 0.7)}/mo)` },
        { id: 'decline', label: 'Keep my home' }
      ],
      lesson: 'Selling your home unlocks your equity to invest, but you trade a mortgage (which builds equity) for rent (which doesn\'t). It\'s a good trade only if the money earns more than your new housing costs.'
    });
  }

  // ------------------------------------------------------------------ networking
  function conferenceOffer(state, p, rng) {
    const { roundTo, clamp, money } = C();
    const name = rng.pick(D().CONFERENCES);
    const cost = roundTo(clamp(p.job.salary * rng.float(0.3, 0.55), 500, 6000), 50);
    return card(state, {
      type: 'conference', icon: '🎤', tone: 'neutral', title: `Networking conference: ${name}`,
      text: `Registration, travel and the hotel for the ${name} come to ${money(cost)}. Attending is a one-time cost, and the contacts you make help for about a year: raises and promotions come more often, more side-gig offers come your way, and if you're ever laid off, your job search is shorter.`,
      data: { name, cost },
      choices: [{ id: 'attend', label: `Attend (${money(cost)})`, style: 'primary' }, { id: 'decline', label: 'Skip it' }],
      lesson: 'Spending on your own skills and relationships is "investing in human capital". It can pay off through a higher salary — but only if it actually leads to opportunities.'
    });
  }

  function clubOffer(state, p, rng) {
    const { roundTo, clamp, money } = C();
    const name = rng.pick(D().CLUBS);
    const joinFee = roundTo(clamp(p.job.salary * rng.float(0.2, 0.35), 300, 5000), 50);
    const dues = roundTo(clamp(p.job.salary * rng.float(0.035, 0.055), 75, 800), 5);
    return card(state, {
      type: 'club', icon: '🥂', tone: 'neutral', title: `Invitation: ${name}`,
      text: `You've been invited to join the ${name}: ${money(joinFee)} to join, then ${money(dues)}/mo in dues. As long as you're a member, raises and promotions come more often, you hear about more side gigs, and a layoff means a shorter job search. You can cancel any time from the Debt & Budget tab.`,
      data: { name, joinFee, dues },
      choices: [{ id: 'join', label: `Join (${money(joinFee)} + ${money(dues)}/mo)`, style: 'primary' }, { id: 'decline', label: 'No thanks' }],
      lesson: `Subscriptions are expenses too: ${money(dues)}/mo of dues raises your freedom target by ${money(dues * state.settings.freedomMultiple)}/mo. It's worth it only if the raises it brings outpace the dues.`
    });
  }

  // ------------------------------------------------------------------ relationships
  function partnerName(p, rng) {
    const avoid = new Set([p.name]);
    const pool = D().PARTNER_NAMES.filter((n) => !avoid.has(n));
    return { name: rng.pick(pool), emoji: rng.pick(D().PARTNER_EMOJI) };
  }

  function meetSomeone(state, p, rng) {
    const { roundTo, clamp, money, lifestyleOf } = C();
    const partner = partnerName(p, rng);
    const cost = roundTo(clamp(p.job.startSalary * rng.float(0.035, 0.06), 120, 900) * Math.sqrt(lifestyleOf(p).luxury), 5);
    return card(state, {
      type: 'meet', icon: '💘', tone: 'good', title: `You met ${partner.name}`,
      text: `${rng.pick(D().MEET_STORIES).replace(/\{name\}/g, partner.name)} Do you want to start dating? Dinners, movies and weekend trips would run about ${money(cost)}/mo.`,
      data: { partner, cost },
      choices: [{ id: 'date', label: `Start dating ${partner.name} (~${money(cost)}/mo)`, style: 'primary' }, { id: 'decline', label: 'Not right now' }],
      lesson: 'Relationships are priceless, but dating has real costs. Planning for them in your budget beats putting date nights on a credit card.'
    });
  }

  function breakup(state, p, rng) {
    const { log } = C();
    const r = p.relationship;
    const name = r.partner.name;
    const text = rng.pick(D().BREAKUP_STORIES).replace(/\{name\}/g, name);
    Object.assign(r, { status: 'single', partner: null, datingCost: 0, declined: 0, since: state.round });
    r.breakups++;
    log(state, `${p.name} and ${name} broke up.`, 'bad', p.id);
    return info(state, p, {
      icon: '💔', tone: 'bad', title: 'The spark is gone', text: `${text} You're single again, and your dating costs stop.`,
      lesson: 'Breakups are hard, but financially it helps that you kept your money separate while dating — untangling shared leases, loans or accounts is much harder.'
    });
  }

  function proposal(state, p, rng) {
    const { roundTo, clamp, money, lifestyleOf } = C();
    const r = p.relationship;
    const lux = lifestyleOf(p).luxury;
    const ring = roundTo(clamp(p.job.startSalary * rng.float(0.5, 1.1), 1000, 15000) * lux, 50);
    const wedding = roundTo(clamp(p.job.startSalary * rng.float(2.5, 5), 8000, 60000) * lux, 100);
    const simple = roundTo(rng.float(600, 2500), 50);
    const apr = C().roundTo(state.market.rate + rng.float(7, 10), 0.25);
    const loanPay = Math.round(C().amortPayment(wedding, apr, 48));
    const months = state.round - r.since;
    return card(state, {
      type: 'propose', icon: '💍', tone: 'good', title: `Marry ${r.partner.name}?`,
      text: `After ${plural(months, 'month')} together, you and ${r.partner.name} are talking about getting married. An engagement ring costs about ${money(ring)}. A big wedding with guests, venue and catering would cost ${money(wedding)} more — or you could keep it simple at the courthouse with a nice dinner for ${money(simple)}. Once married, your household spends more (about 1.5× for two people), but ${r.partner.name} pays half — so your share of living costs drops to about 75% of what you pay alone.`,
      data: { ring, wedding, simple, apr, loanPay },
      choices: [
        { id: 'cash', label: `Big wedding — pay cash (${money(ring + wedding)})`, style: 'primary' },
        { id: 'finance', label: `Big wedding — finance it (${money(loanPay)}/mo for 4 yrs)` },
        { id: 'simple', label: `Simple wedding (${money(ring + simple)})` },
        { id: 'wait', label: 'Not ready yet' }
      ],
      lesson: `The average wedding costs about as much as a new car. Financing ${money(wedding)} at ${apr.toFixed(2)}% for 4 years costs ${money(loanPay * 48 - wedding)} in interest — and adds ${money(loanPay)}/mo to your expenses (and ${money(loanPay * state.settings.freedomMultiple)}/mo to your freedom target).`
    });
  }

  function babyOffer(state, p) {
    const { money } = C();
    const r = p.relationship;
    r.lastBabyAsk = state.round;
    const half = Math.round(p.childCost * 0.5);
    return card(state, {
      type: 'baby', icon: '👶', tone: 'neutral', title: `${r.partner.name} asks about having a baby`,
      text: `You and ${r.partner.name} have been talking about starting${p.children ? ' — or growing —' : ''} a family. A child costs about ${money(p.childCost)}/mo for diapers, daycare, food and doctor visits; split between the two of you, your half is ${money(half)}/mo.`,
      data: { half },
      choices: [{ id: 'yes', label: p.children ? 'Have another baby' : 'Start a family', style: 'primary' }, { id: 'no', label: 'Not right now' }],
      lesson: `Children raise your monthly expenses for many years — and your freedom target with them (+${money(half * state.settings.freedomMultiple)}/mo here). Families who build assets early handle it best.`
    });
  }

  function marriageTrouble(state, p, rng) {
    const { roundTo, money } = C();
    const r = p.relationship;
    const counseling = roundTo(rng.float(600, 2000), 50);
    const legal = roundTo(C().clamp(p.job.startSalary * rng.float(1, 2.5), 3000, 25000), 100);
    const stressed = moneyStress(state, p);
    return card(state, {
      type: 'divorce', icon: '💔', tone: 'bad', required: true, title: `Trouble with ${r.partner.name}`,
      text: `${stressed ? 'Money worries have led to constant arguments' : 'You and ' + r.partner.name + ' have grown apart'}, and ${r.partner.name} has mentioned divorce. Couples counseling costs about ${money(counseling)} and saves many marriages. A divorce would cost about ${money(legal)} in legal fees, and your ex would receive half of your cash and half of your stocks. You'd also go back to paying the household bills alone.`,
      data: { counseling, legal, counselWorks: rng.chance(0.65) },
      choices: [{ id: 'counsel', label: `Try couples counseling (${money(counseling)})`, style: 'primary' }, { id: 'divorce', label: 'Agree to divorce' }],
      lesson: 'Money fights are one of the most common reasons couples split. Talking openly about budgets, debt and goals — before they become a crisis — protects your relationship and your finances.'
    });
  }

  function moneyStress(state, p) {
    const s = C().summarize(state, p);
    const cc = p.debts.find((d) => d.type === 'credit');
    return s.cashflow < 0 || (!C().isEmployed(p) && !p.retired) || !!(cc && cc.balance > p.job.startSalary * 1.5);
  }

  function relationshipEvent(state, p, rng) {
    const r = p.relationship;
    if (!r) return null;
    if (r.status === 'single') return rng.chance(0.045) ? meetSomeone(state, p, rng) : null;
    if (r.status === 'dating') {
      if (rng.chance(0.022 + (r.declined ? 0.03 : 0))) return breakup(state, p, rng);
      if (state.round - r.since >= 4 && rng.chance(0.09)) return proposal(state, p, rng);
      return null;
    }
    if (r.status === 'married') {
      if (rng.chance(0.0035 * (moneyStress(state, p) ? 2.5 : 1))) return marriageTrouble(state, p, rng);
      if (p.children < 4 && state.round - r.lastBabyAsk >= 6 && rng.chance(0.06)) return babyOffer(state, p);
    }
    return null;
  }

  /**
   * A second adult doesn't double a household's costs: by the common OECD rule of thumb a couple
   * spends about 1.5× what one person does (shared rent, utilities, car…). Spouses split that 50/50.
   */
  const HOUSEHOLD_SCALE = 1.5;
  function scaleHousehold(p, k) {
    for (const key in p.expenses) p.expenses[key] = C().roundTo(p.expenses[key] * k, 5);
  }

  function divorce(state, p, c) {
    const { money, cents, chargeCredit, log } = C();
    const r = p.relationship;
    const name = r.partner.name;
    const legal = c.data.legal;
    if (p.cash >= legal) p.cash = cents(p.cash - legal); else { chargeCredit(state, p, legal - Math.max(0, p.cash)); p.cash = 0; }
    const cashSplit = cents(Math.max(0, p.cash) / 2);
    p.cash = cents(p.cash - cashSplit);
    let stockSplit = 0;
    for (const id of Object.keys(p.holdings)) {
      const h = p.holdings[id];
      const give = Math.floor(h.shares / 2);
      if (give <= 0) continue;
      stockSplit += give * state.market.securities[id].price;
      h.costBasis = cents(h.costBasis * (h.shares - give) / h.shares);
      h.shares -= give;
      if (h.shares <= 0) delete p.holdings[id];
    }
    Object.assign(r, { status: 'single', partner: null, datingCost: 0, declined: 0, since: state.round });
    scaleHousehold(p, 1 / HOUSEHOLD_SCALE);
    r.divorces++;
    log(state, `${p.name} and ${name} divorced.`, 'bad', p.id);
    return `Divorced. Legal fees ${money(legal)}; ${name} received ${money(cashSplit)} in cash${stockSplit ? ` and ${money(stockSplit)} of stock` : ''}.${p.children ? ' You share custody and keep paying half of the children\'s costs.' : ''}`;
  }

  /** Turn a payday highlight (startup exit, business closure, option expiry) into a pop-up card. */
  function popup(state, p, pu) {
    return info(state, p, { icon: pu.icon, title: pu.title, text: pu.text, tone: pu.tone || 'neutral', lesson: pu.lesson || '' });
  }

  // ------------------------------------------------------------------ charity
  function charity(state, p, rng) {
    const { roundTo, money, summarize } = C();
    const s = summarize(state, p);
    const income = s.salary + s.gigs + Math.max(0, s.passive);
    const amt = Math.max(50, roundTo(income * 0.1, 5));
    const cause = rng.pick(['the local food bank', 'a children\'s hospital', 'the animal shelter', 'disaster relief', 'a literacy nonprofit', 'clean-water wells abroad', 'a youth sports league']);
    return card(state, {
      type: 'charity', icon: '💝', tone: 'neutral', title: 'Charity drive',
      text: `A friend is raising money for ${cause}. Donate 10% of your monthly income (${money(amt)}) and good things may come your way: for your next 3 turns, good events and great deals become more likely and bad luck less likely.`,
      data: { amount: amt, cause },
      choices: [{ id: 'donate', label: `Donate ${money(amt)}`, style: 'primary' }, { id: 'decline', label: 'Not this time' }],
      lesson: 'Many people give a set share of their income to causes they care about. In this game, generosity also earns you good karma.'
    });
  }

  // ------------------------------------------------------------------ deals & tips
  const DEAL_LESSONS = {
    realestate: 'Leverage: a small down payment plus the bank\'s money controls a large asset. Look for positive cashflow AFTER the mortgage and all expenses.',
    business: 'A business is only passive if someone else runs it. Judge it by profit after any loan payments, and by how many months it takes to earn back your cash.',
    side: 'Side projects are cheap lottery tickets: most earn little, a few earn a lot for years.',
    startup: 'Most startups fail. Investors spread small bets across many companies, expecting a few big winners to pay for the losers.',
    lending: 'Higher interest usually means a higher chance the borrower can\'t pay. Interest is income; the principal comes back at the end.',
    collectible: 'Collectibles produce no income. Their value depends entirely on what the next buyer will pay.'
  };

  function dealCard(state, p, rng) {
    const deal = MMS.Deals.generate(state, p, rng);
    if (deal.cat === 'tip') return tipCard(state, p, rng);
    const lessonKey = deal.cat === 'business' && deal.kind === 'side' ? 'side' : deal.cat;
    return card(state, {
      kind: 'deal', type: 'deal', icon: deal.icon, title: deal.title, text: deal.desc, tone: 'deal', deal,
      lesson: DEAL_LESSONS[lessonKey] || '',
      choices: [
        { id: 'buy', label: `Buy (${C().money(deal.cash)}${deal.cat === 'realestate' && deal.loan ? ' down' : ''})`, style: 'primary' },
        { id: 'later', label: 'Decide later this turn' },
        { id: 'pass', label: 'Pass' }
      ]
    });
  }

  function tipCard(state, p, rng) {
    const tip = rng.pick(D().STOCK_TIPS);
    const s = state.market.securities[tip.sec];
    const truthy = rng.chance(p.karmaTurns > 0 ? 0.78 : 0.6);
    const pct = truthy ? (s.penny ? rng.float(0.4, 1.5) : rng.float(0.12, 0.4)) : -(s.penny ? rng.float(0.3, 0.6) : rng.float(0.08, 0.22));
    state.market.pendingShocks.push({ sec: tip.sec, pct });
    const text = tip.text.replace('{penny}', `${s.name} (${s.ticker})`) +
      ` If it's true, ${s.ticker} could jump when the month ends (prices update after every player has had a turn). Rumors aren't always right…`;
    return card(state, {
      type: 'tip', icon: '🕵️', tone: 'neutral', title: `Hot tip: ${s.name}`, text,
      data: { sec: tip.sec },
      choices: [{ id: 'market', label: 'Open the stock market', style: 'primary' }, { id: 'ignore', label: 'Ignore it' }],
      lesson: 'Acting on rumors is speculation, not investing. Tips are often wrong — and trading on real inside information is illegal.'
    });
  }

  // ------------------------------------------------------------------ turn generation
  /** Generate this turn's cards for player p. Deals are random — not every turn has one. */
  function generate(state, p, rng) {
    const cards = state.turn.cards;
    const karma = p.karmaTurns > 0;
    const econ = state.market.economy;

    const net = C().networkLevel(p);
    if (C().isEmployed(p)) {
      const downP = 0.03 * { boom: 0.6, stable: 1, recession: 2.5 }[econ] * (karma ? 0.35 : 1);
      const promoP = 0.045 * { boom: 1.3, stable: 1, recession: 0.6 }[econ] * (karma ? 1.8 : 1) * (1 + 0.4 * net);
      const raiseP = 0.05 * { boom: 1.3, stable: 1, recession: 0.5 }[econ] * (karma ? 1.4 : 1) * (1 + 0.5 * net);
      if (rng.chance(downP)) cards.push(downsize(state, p, rng));
      else if (rng.chance(promoP)) cards.push(promotion(state, p, rng));
      else if (rng.chance(raiseP)) cards.push(raise(state, p, rng));
    }

    if (rng.chance(0.5)) cards.push(lifeEvent(state, p, rng, rng.chance(karma ? 0.72 : 0.45)));

    // Your network sends extra side-gig offers your way.
    if (net && !p.retired && p.sideGigs.length < 2 && rng.chance(0.035 * net) && !cards.some((c) => c.type === 'sidegig')) {
      cards.push(card(state, Object.assign({ tone: 'good' }, sideGigOffer(state, p, rng))));
    }

    const rel = relationshipEvent(state, p, rng);
    if (rel) cards.push(rel);

    const ac = assetEvent(state, p, rng, karma);
    if (ac) cards.push(ac);

    if (C().isEmployed(p)) {
      if (p.network.conferenceTurns <= 0 && rng.chance(0.04)) cards.push(conferenceOffer(state, p, rng));
      else if (!p.network.club && rng.chance(0.025)) cards.push(clubOffer(state, p, rng));
    }

    if (!karma && !p.retired && rng.chance(0.1)) cards.push(charity(state, p, rng));

    let deals = 0;
    if (rng.chance(0.55 + (karma ? 0.15 : 0) + (econ === 'recession' ? 0.05 : 0))) deals = rng.chance(karma ? 0.3 : 0.2) ? 2 : 1;
    for (let i = 0; i < deals; i++) cards.push(dealCard(state, p, rng));

    if (p.karmaTurns > 0) p.karmaTurns--;
    if (p.network.conferenceTurns > 0) p.network.conferenceTurns--;
  }

  // ------------------------------------------------------------------ resolution
  /** Apply the player's choice on a card. Returns { ok, msg, keepOpen? }. */
  function resolve(state, p, c, choice) {
    const { money, chargeCredit, log } = C();
    switch (c.type) {
      case 'info':
        return { ok: true };
      case 'tip':
        c.outcome = choice === 'market' ? 'Checked the market' : 'Ignored';
        return { ok: true, openTab: choice === 'market' ? 'market' : null };
      case 'expense': {
        const cost = c.data.cost;
        if (choice === 'cash') {
          if (p.cash < cost) return { ok: false, msg: `You only have ${money(p.cash)} in cash.` };
          p.cash -= cost;
          c.outcome = `Paid ${money(cost)} in cash`;
        } else {
          chargeCredit(state, p, cost);
          c.outcome = `Charged ${money(cost)} to a credit card`;
        }
        if (c.data.flavor === 'luxury') p.stats.luxurySpent += cost;
        log(state, `${p.name}: ${c.title} — ${c.outcome.toLowerCase()}.`, 'bad', p.id);
        return { ok: true };
      }
      case 'charity': {
        if (choice === 'donate') {
          const amt = c.data.amount;
          if (p.cash < amt) return { ok: false, msg: `You need ${money(amt)} in cash to donate.` };
          p.cash -= amt;
          p.karmaTurns = 3;
          p.stats.donated += amt;
          c.outcome = `Donated ${money(amt)} — good karma for 3 turns 😇`;
          log(state, `${p.name} donated ${money(amt)} to ${c.data.cause}.`, 'good', p.id);
        } else c.outcome = 'Declined';
        return { ok: true };
      }
      case 'sidegig': {
        if (choice === 'accept') {
          p.sideGigs.push({ title: c.data.title, income: c.data.income, turnsLeft: c.data.turns });
          c.outcome = `Took the gig (+${money(c.data.income)}/mo)`;
        } else c.outcome = 'Declined';
        return { ok: true };
      }
      case 'refi': {
        if (choice === 'accept') {
          const d = p.debts.find((x) => x.id === c.data.debtId);
          if (!d) return { ok: false, msg: 'That mortgage no longer exists.' };
          if (p.cash < c.data.fee) return { ok: false, msg: `You need ${money(c.data.fee)} for closing costs.` };
          p.cash -= c.data.fee;
          d.apr = c.data.rate;
          d.payment = c.data.newPay;
          c.outcome = `Refinanced — new payment ${money(d.payment)}/mo`;
          log(state, `${p.name} refinanced their home mortgage.`, 'good', p.id);
        } else c.outcome = 'Declined';
        return { ok: true };
      }
      case 'propoffer': {
        if (choice !== 'accept') { c.outcome = 'Declined'; return { ok: true }; }
        const prop = p.properties.find((x) => x.id === c.data.propId);
        if (!prop) return { ok: false, msg: 'You no longer own that property.' };
        const r = MMS.Deals.sellProperty(state, p, prop, c.data.offer);
        if (r.ok) c.outcome = r.msg;
        return r;
      }
      case 'bizoffer': {
        if (choice !== 'accept') { c.outcome = 'Declined'; return { ok: true }; }
        const b = p.businesses.find((x) => x.id === c.data.bizId);
        if (!b) return { ok: false, msg: 'You no longer own that business.' };
        const r = MMS.Deals.sellBusiness(state, p, b, c.data.offer);
        if (r.ok) c.outcome = r.msg;
        return r;
      }
      case 'expand': {
        if (choice !== 'invest') { c.outcome = 'Declined'; return { ok: true }; }
        const b = p.businesses.find((x) => x.id === c.data.bizId);
        if (!b) return { ok: false, msg: 'You no longer own that business.' };
        if (p.cash < c.data.cost) return { ok: false, msg: `You need ${money(c.data.cost)} in cash.` };
        p.cash -= c.data.cost;
        b.invested += c.data.cost;
        b.cashInvested += c.data.cost;
        b.base = Math.round(b.base * (1 + c.data.boost));
        c.outcome = `Expanded — base profit now ${money(b.base)}/mo`;
        log(state, `${p.name} expanded ${b.name}.`, 'good', p.id);
        return { ok: true };
      }
      case 'homeoffer': {
        if (choice !== 'similar' && choice !== 'smaller') { c.outcome = 'Kept my home'; return { ok: true }; }
        if (!p.home) return { ok: false, msg: 'You no longer own a home.' };
        const r = MMS.Deals.sellHome(state, p, { gross: c.data.offer, rent: choice });
        if (r.ok) c.outcome = r.msg;
        return r;
      }
      case 'conference': {
        if (choice !== 'attend') { c.outcome = 'Skipped'; return { ok: true }; }
        if (p.cash < c.data.cost) return { ok: false, msg: `You need ${money(c.data.cost)} in cash.` };
        p.cash -= c.data.cost;
        p.network.conferenceTurns = 12;
        p.network.conferences++;
        p.stats.networkingSpent += c.data.cost;
        c.outcome = `Attended — networking boost for 12 turns 🤝`;
        log(state, `${p.name} attended the ${c.data.name}.`, 'good', p.id);
        return { ok: true };
      }
      case 'club': {
        if (choice !== 'join') { c.outcome = 'Declined'; return { ok: true }; }
        if (p.network.club) return { ok: false, msg: 'You already belong to a networking club.' };
        if (p.cash < c.data.joinFee) return { ok: false, msg: `You need ${money(c.data.joinFee)} in cash for the joining fee.` };
        p.cash -= c.data.joinFee;
        p.network.club = { name: c.data.name, dues: c.data.dues, joinedRound: state.round };
        p.stats.networkingSpent += c.data.joinFee;
        c.outcome = `Joined — ${money(c.data.dues)}/mo dues`;
        log(state, `${p.name} joined the ${c.data.name}.`, 'good', p.id);
        return { ok: true };
      }
      case 'meet': {
        if (choice !== 'date') { c.outcome = 'Not right now'; return { ok: true }; }
        if (p.relationship.status !== 'single') { c.outcome = 'You are already in a relationship'; return { ok: true }; }
        Object.assign(p.relationship, { status: 'dating', partner: c.data.partner, since: state.round, datingCost: c.data.cost, declined: 0 });
        c.outcome = `You're dating ${c.data.partner.name} 💕 (~${money(c.data.cost)}/mo)`;
        log(state, `${p.name} started dating ${c.data.partner.name}.`, 'good', p.id);
        return { ok: true };
      }
      case 'propose': {
        const r = p.relationship;
        if (r.status !== 'dating') { c.outcome = 'That relationship has ended'; return { ok: true }; }
        const { ring, wedding, simple, apr, loanPay } = c.data;
        const payOrCharge = (amt) => {
          if (p.cash >= amt) { p.cash -= amt; return ''; }
          const short = amt - Math.max(0, p.cash);
          p.cash = 0;
          chargeCredit(state, p, short);
          return ` (${money(short)} went on a credit card)`;
        };
        let how;
        if (choice === 'wait') {
          r.declined++;
          c.outcome = 'Not ready yet';
          return { ok: true };
        } else if (choice === 'cash') {
          if (p.cash < ring + wedding) return { ok: false, msg: `The ring and big wedding cost ${money(ring + wedding)}; you have ${money(p.cash)}.` };
          p.cash -= ring + wedding;
          p.stats.weddingSpent += ring + wedding;
          how = `Big wedding, paid in cash (${money(ring + wedding)})`;
        } else if (choice === 'finance') {
          const extra = payOrCharge(ring);
          C().addDebt(state, p, { type: 'personal', name: 'Wedding loan', balance: wedding, apr, payment: loanPay });
          p.stats.weddingSpent += ring + wedding;
          how = `Big wedding on a ${money(wedding)} loan (${money(loanPay)}/mo)${extra}`;
        } else {
          const extra = payOrCharge(ring + simple);
          p.stats.weddingSpent += ring + simple;
          how = `Simple wedding (${money(ring + simple)})${extra}`;
        }
        const before = C().livingExpenses(p);
        scaleHousehold(p, HOUSEHOLD_SCALE);
        Object.assign(r, { status: 'married', datingCost: 0, declined: 0, since: state.round, lastBabyAsk: state.round });
        r.marriages++;
        p.childShare = 0.5;
        c.outcome = `💒 Married ${r.partner.name}! ${how}. Your household now spends ${money(C().livingExpenses(p))}/mo instead of ${money(before)}, and ${r.partner.name} pays half — your share is ${money(C().livingExpenses(p) - C().partnerShare(p))}/mo.`;
        log(state, `${p.name} married ${r.partner.name}!`, 'good', p.id);
        return { ok: true, msg: c.outcome };
      }
      case 'baby': {
        if (choice !== 'yes') { c.outcome = 'Not right now'; return { ok: true }; }
        if (p.relationship.status !== 'married') { c.outcome = 'That relationship has ended'; return { ok: true }; }
        p.children++;
        c.outcome = `👶 Welcome to the family! Your half of the costs: +${money(c.data.half)}/mo`;
        log(state, `${p.name} and ${p.relationship.partner.name} had a baby!`, 'good', p.id);
        return { ok: true };
      }
      case 'divorce': {
        if (p.relationship.status !== 'married') { c.outcome = 'Resolved'; return { ok: true }; }
        if (choice === 'counsel') {
          const cost = c.data.counseling;
          if (p.cash >= cost) p.cash -= cost; else { chargeCredit(state, p, cost - Math.max(0, p.cash)); p.cash = 0; }
          if (c.data.counselWorks) {
            c.outcome = `Counseling worked — you and ${p.relationship.partner.name} are stronger than ever ❤️`;
            log(state, `${p.name} and ${p.relationship.partner.name} saved their marriage with counseling.`, 'good', p.id);
            return { ok: true, msg: c.outcome };
          }
          c.outcome = `Counseling didn't work out. ${divorce(state, p, c)}`;
          return { ok: true, msg: c.outcome };
        }
        c.outcome = divorce(state, p, c);
        return { ok: true, msg: c.outcome };
      }
      case 'deal': {
        if (choice === 'later') return { ok: true, later: true };
        if (choice === 'pass') { c.outcome = 'Passed'; return { ok: true }; }
        const r = MMS.Deals.purchase(state, p, c.deal);
        if (r.ok) c.outcome = 'Bought ✔';
        return r;
      }
      default:
        return { ok: false, msg: 'Unknown card.' };
    }
  }

  /** The default choice when a turn ends with a card still open. */
  function defaultChoice(c, p) {
    if (c.type === 'expense') return p.cash >= c.data.cost ? 'cash' : 'credit';
    if (c.type === 'deal') return 'pass';
    if (c.type === 'tip') return 'ignore';
    if (c.type === 'expand') return 'decline';
    if (c.type === 'propose') return 'wait';
    if (c.type === 'baby') return 'no';
    if (c.type === 'divorce') return 'counsel';
    return 'decline';
  }

  MMS.Events = { generate, resolve, defaultChoice, popup, maxJobSearch, LESSONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = MMS.Events;
})(typeof window !== 'undefined' ? window : globalThis);
