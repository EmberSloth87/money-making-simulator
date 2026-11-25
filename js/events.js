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
  function downsize(state, p, rng) {
    const { roundTo, money, log } = C();
    const turns = rng.int(1, 6);
    p.unemployedTurns = turns;
    p.stats.timesDownsized++;
    let text = `Your company is restructuring and your position was eliminated. You'll go ${plural(turns, 'turn')} without a paycheck while you look for work.`;
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

  // ------------------------------------------------------------------ good life events
  const GOOD = [
    { id: 'bonus', w: 6, ok: (s, p) => C().isEmployed(p), make(state, p, rng) {
      const amt = C().roundTo(p.job.salary * rng.float(0.3, 1.5), 50);
      p.cash += amt;
      return { icon: '💰', title: 'Performance bonus!', text: `Your hard work paid off — your boss handed you a ${C().money(amt)} bonus.`, lesson: LESSONS.windfall };
    } },
    { id: 'raise', w: 4, ok: (s, p) => C().isEmployed(p), make(state, p, rng) {
      const old = p.job.salary;
      p.job.salary = C().roundTo(old * (1 + rng.float(0.03, 0.06)), 25);
      return { icon: '📈', title: 'Cost-of-living raise', text: `Your employer bumped everyone's pay. You now earn ${C().money(p.job.salary)}/mo (was ${C().money(old)}).`, lesson: 'Inflation slowly raises prices. Raises that keep up with it protect your buying power.' };
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
    { id: 'sidegig', w: 4, ok: (s, p) => !p.retired && p.sideGigs.length < 2, make(state, p, rng) {
      const g = rng.pick(D().SIDE_GIGS);
      const income = C().roundTo(Math.max(250, p.job.startSalary * rng.float(0.08, 0.2)), 25);
      const turns = rng.int(3, 8);
      return {
        type: 'sidegig', resolved: false, icon: '🛠️', title: `Side gig: ${g.title}`,
        text: `${g.text} It pays about ${C().money(income)}/mo for the next ${plural(turns, 'turn')}.`,
        data: { title: g.title, income, turns },
        choices: [{ id: 'accept', label: `Take the gig (+${C().money(income)}/mo)`, style: 'primary' }, { id: 'decline', label: 'No thanks' }],
        lesson: 'Side gigs boost cashflow, but they are still earned income — they don\'t count toward financial freedom. Invest the extra money!'
      };
    } },
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
    { id: 'baby', w: 2, ok: (s, p) => p.children < 3 && !p.retired, make(state, p) {
      p.children++;
      return { tone: 'neutral', icon: '👶', title: 'Congratulations — a new baby!', text: `Your family is growing! Diapers, daycare and doctor visits add ${C().money(p.childCost)}/mo to your expenses.`, lesson: 'Higher expenses raise your freedom target too (you need passive income of 2× expenses). Families plan for this by growing assets early.' };
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
    const e = rng.weighted(list, (x) => x.w);
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
    if (props.length && rng.chance(0.06 * boost)) return propertyOffer(state, p, rng, rng.pick(props));
    const sellable = bizs.filter((b) => businessProfit(b) > 0);
    if (sellable.length && rng.chance(0.04 * boost)) return businessOffer(state, p, rng, rng.pick(sellable));
    for (const pr of rng.shuffle(props)) if (rng.chance(0.07)) return propertyEvent(state, p, rng, pr, karma);
    for (const b of rng.shuffle(bizs)) if (rng.chance(0.08)) return businessEvent(state, p, rng, b, karma);
    return null;
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

    if (C().isEmployed(p)) {
      const downP = 0.03 * { boom: 0.6, stable: 1, recession: 2.5 }[econ] * (karma ? 0.35 : 1);
      const promoP = 0.045 * { boom: 1.3, stable: 1, recession: 0.6 }[econ] * (karma ? 1.8 : 1);
      if (rng.chance(downP)) cards.push(downsize(state, p, rng));
      else if (rng.chance(promoP)) cards.push(promotion(state, p, rng));
    }

    if (rng.chance(0.5)) cards.push(lifeEvent(state, p, rng, rng.chance(karma ? 0.72 : 0.45)));

    const ac = assetEvent(state, p, rng, karma);
    if (ac) cards.push(ac);

    if (!karma && !p.retired && rng.chance(0.1)) cards.push(charity(state, p, rng));

    let deals = 0;
    if (rng.chance(0.55 + (karma ? 0.15 : 0) + (econ === 'recession' ? 0.05 : 0))) deals = rng.chance(karma ? 0.3 : 0.2) ? 2 : 1;
    for (let i = 0; i < deals; i++) cards.push(dealCard(state, p, rng));

    if (p.karmaTurns > 0) p.karmaTurns--;
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
    return 'decline';
  }

  MMS.Events = { generate, resolve, defaultChoice, LESSONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = MMS.Events;
})(typeof window !== 'undefined' ? window : globalThis);
