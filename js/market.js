/*
 * market.js — The shared market: fictional securities, the economy cycle,
 * interest rates, the real-estate price index and monthly news.
 *
 * Prices move once per round (after every player has had a turn). The model
 * aims for realistic behavior:
 *   • every security has its own volatility (bonds barely move, crypto swings wildly)
 *   • returns are correlated through a common "market" factor
 *   • volatility clusters (calm months follow calm months, wild follow wild)
 *   • a market-wide fear gauge spikes in crashes and recessions
 *   • rare sudden jumps give "fat tails"
 *   • cyclical stocks suffer in recessions; defensive stocks, bonds and gold hold up
 *   • bond and REIT prices fall when interest rates rise (duration)
 *   • companies report quarterly earnings surprises
 *   • dividends grow over time and the bond fund's payout tracks interest rates
 *   • a Fear & Greed index (0–100) captures investors' mood: greed makes the herd chase
 *     prices higher (and calms volatility), fear makes it dump stocks for bonds and gold
 *     (and makes every swing bigger). Moves driven purely by mood fade over the following
 *     months, so extreme greed tends to precede weak returns and extreme fear strong ones.
 */
(function (global) {
  'use strict';
  const MMS = global.MMS || (global.MMS = {});
  const C = () => MMS.Core;
  const D = () => MMS.Data;

  // Booms add to returns and recessions subtract; weighted by how often each occurs, they roughly cancel.
  const ECON_DRIFT = { boom: 0.009, stable: 0, recession: -0.012 };
  const RE_DRIFT = { boom: 0.005, stable: 0.0025, recession: -0.006 };
  const FEAR_TARGET = { boom: 0.85, stable: 0.95, recession: 1.25 };
  const NEWS_PER_MONTH = 0.4 * 1.2; // 40% chance of news; 20% of those months have two stories
  const ECON_LABELS = {
    boom: { label: 'Booming', icon: '🚀', tone: 'good', desc: 'Jobs are plentiful, profits are rising and stocks tend to climb. Cyclical stocks (EVs, tech, AI) do best.' },
    stable: { label: 'Stable', icon: '🌤️', tone: 'neutral', desc: 'Normal growth. Markets drift upward over time with ordinary ups and downs.' },
    recession: { label: 'Recession', icon: '🌧️', tone: 'bad', desc: 'Layoffs are more common and stocks tend to fall — especially cyclical ones. Bonds, gold, groceries and healthcare hold up better. Real estate deals get cheaper.' }
  };

  // A short "why it matters" for each kind of headline.
  const NEWS_LESSONS = {
    rate_cut: 'Lower rates make borrowing cheaper. Bond prices rise (existing bonds pay more than new ones) and growth stocks and real estate usually benefit.',
    rate_hike: 'Higher rates make borrowing pricier. Existing bonds lose value, REITs and growth stocks often fall, and new mortgages cost more.',
    market_crash: 'Crashes are scary but normal. Historically, diversified investors who held on recovered; panic-selling locks in losses.',
    bull_rally: 'Rallies feel great, but chasing hot markets often means buying high. Steady, regular investing beats trying to time the market.',
    ai_bubble: 'A "bubble" is when prices run far ahead of real profits. Bubbles can keep inflating for a long time before they pop.',
    crypto_crash: 'Crypto has no earnings or dividends to anchor its price, so sentiment swings can be extreme.',
    crypto_rally: 'Crypto rallies can be spectacular — and so can the crashes that follow. Only invest what you can afford to lose.',
    helios_div_cut: 'Dividends are not guaranteed. Companies under pressure can cut them, and the stock price usually falls too.',
    grocery_record: 'Dividend growth is powerful: if you buy and hold, your income rises even though you never buy another share.',
    penny_scandal: 'Small companies get less scrutiny. Fraud and bankruptcy are much more common among penny stocks.',
    penny_contract: 'Penny stocks can rocket on a single headline — and fall just as fast.',
    housing_boom: 'Rising home prices grow your equity, but they also make new deals more expensive.',
    housing_slump: 'Falling prices hurt sellers, but they create bargains for buyers with cash ready.',
    oil_spike: 'Energy prices ripple through the economy: energy companies win, while everyone else pays more.',
    recession_warning: 'Markets move on expectations. Prices often fall before a recession officially begins.'
  };

  // ------------------------------------------------------------------ Fear & Greed
  // Mood leans a little greedy in booms and fearful in recessions, but it is driven mostly by
  // recent price moves and scary (or exciting) news.
  const SENT_BIAS = { boom: 3, stable: 2, recession: -3 };
  const SENT_TILT = 0.03;     // monthly herd push at the very extremes (±3% for a beta-1 stock)
  const SENT_REVERT = 0.25;   // share of the mood-driven "froth" that unwinds each month
  // Tuned so that, as in real markets, the year after extreme fear has tended to be better for
  // stocks than the year after extreme greed, while long-run average returns are unchanged.
  const MOODS = [
    { max: 25, id: 'xfear', label: 'Extreme fear', icon: '😱', tone: 'bad',
      desc: 'Investors are panicking: selling stocks at almost any price and piling into bonds and gold. Swings are bigger than usual. Historically, extreme fear has often been a better time to buy than to sell — prices pushed down by panic tend to bounce back.' },
    { max: 45, id: 'fear', label: 'Fear', icon: '😨', tone: 'bad',
      desc: 'Investors are nervous. Stocks lean lower, safe havens (bonds, gold) lean higher, and volatility is above normal.' },
    { max: 56, id: 'neutral', label: 'Neutral', icon: '😐', tone: 'neutral',
      desc: 'Neither fear nor greed is in charge. Prices mostly follow earnings, interest rates and the economy.' },
    { max: 76, id: 'greed', label: 'Greed', icon: '😎', tone: 'good',
      desc: 'Investors are confident. Rising prices pull in more buyers, so stocks (and especially crypto and speculative names) lean higher and the market feels calm.' },
    { max: 101, id: 'xgreed', label: 'Extreme greed', icon: '🤑', tone: 'good',
      desc: 'Euphoria: everyone is chasing hot stocks and crypto, and the market feels like it can only go up. Prices run ahead of profits, so the gains often fade later — and bubbles and crashes become more likely.' }
  ];
  const SENT_LESSONS = {
    xfear: 'The Fear & Greed index has hit "extreme fear". Panic-selling locks in losses; long-term investors who keep buying when others are fearful have historically been rewarded. "Be greedy when others are fearful."',
    xgreed: 'The Fear & Greed index has hit "extreme greed". When everyone is euphoric, prices often run ahead of real profits — this is when bubbles form. "Be fearful when others are greedy": it\'s a good time to check that you\'re diversified, not to bet the farm.'
  };
  const sentimentOf = (m) => (m.sentiment == null ? 50 : m.sentiment);
  function sentimentMood(v) { return MOODS.find((x) => v < x.max) || MOODS[MOODS.length - 1]; }
  /** Mood as a number from −1 (extreme fear) to +1 (extreme greed). */
  const greed = (m) => (sentimentOf(m) - 50) / 50;
  /** How strongly a security rides the mood: stocks by beta, crypto most, bonds and gold the other way. */
  function sentExposure(s) {
    if (s.equity) return s.beta;
    if (s.crypto) return 2.2;
    if (s.bond) return -0.3;
    return s.cyc < 0 ? -0.5 : 0;
  }

  /**
   * One month of mood. It drifts back toward its normal level for the economy, but this month's
   * market return feeds it (rising prices breed greed, falling prices breed fear), and so do news
   * shocks (`push`). Returns a headline when the market enters an extreme.
   */
  function stepSentiment(state, rng, push) {
    const { clamp } = C();
    const m = state.market;
    const idx = m.securities.idx;
    const ret = idx && idx.prevPrice ? Math.log(idx.price / idx.prevPrice) : 0;
    const target = 50 + SENT_BIAS[m.economy];
    const before = sentimentMood(sentimentOf(m));
    const v = target + 0.72 * (sentimentOf(m) - target) + 180 * (ret - 0.006) + 7 * rng.normal() + (push || 0);
    m.sentiment = clamp(v, 1, 99);
    (m.sentimentHistory || (m.sentimentHistory = [])).push(Math.round(m.sentiment));
    if (m.sentimentHistory.length > 120) m.sentimentHistory.shift();
    const after = sentimentMood(m.sentiment);
    if (after.id !== before.id && (after.id === 'xfear' || after.id === 'xgreed')) {
      return {
        text: after.id === 'xfear'
          ? `😱 Extreme fear grips the market (Fear & Greed index: ${Math.round(m.sentiment)}). Investors are dumping stocks for bonds and gold.`
          : `🤑 Extreme greed! Everyone is talking about stocks and crypto (Fear & Greed index: ${Math.round(m.sentiment)}).`,
        tone: after.id === 'xfear' ? 'bad' : 'good',
        lesson: SENT_LESSONS[after.id]
      };
    }
    return null;
  }

  /** Weight multiplier for a news story given the mood: euphoria breeds bubbles and crashes, fear sends money to gold. */
  function newsMoodWeight(state, n) {
    const g = greed(state.market), gp = Math.max(0, g), fp = Math.max(0, -g);
    switch (n.id) {
      case 'market_crash': return 1 + 2 * gp * gp;
      case 'ai_bubble': case 'crypto_crash': return 1 + gp;
      case 'bull_rally': case 'crypto_rally': return 1 + 0.8 * gp;
      case 'gold_rush': return 1 + 1.5 * fp;
      default: return 1;
    }
  }

  const combine = (a, b) => (1 + (a || 0)) * (1 + b) - 1;

  /*
   * Calibration. Each security's `vol` is its target TOTAL volatility. News, earnings,
   * interest-rate moves and jumps all add variance on top of the everyday random
   * "diffusion", so the diffusion gets only what is left over. Likewise the expected
   * effect of news and jumps is backed out of the drift, so the long-run average
   * return matches `drift`.
   */
  function calibrate(s) {
    const news = D().NEWS;
    const totalW = news.reduce((a, n) => a + n.w, 0);
    let newsMean = 0, newsM2 = 0, rateM2 = 0.12 * 0.25 * 0.25;
    for (const n of news) {
      const p = NEWS_PER_MONTH * n.w / totalW;
      const parts = [];
      if (n.equity && s.equity) parts.push([n.equity[0] * s.beta, n.equity[1] * s.beta]);
      if (n.shocks && n.shocks[s.id]) parts.push(n.shocks[s.id]);
      if (n.rate) rateM2 += p * Math.pow((n.rate[0] + n.rate[1]) / 2, 2);
      if (!parts.length) continue;
      const m1 = parts.reduce((a, r) => a + (r[0] + r[1]) / 2, 0);
      const v = parts.reduce((a, r) => a + Math.pow(r[1] - r[0], 2) / 12, 0);
      newsMean += p * m1;
      newsM2 += p * (m1 * m1 + v);
    }
    const newsVar = newsM2 - newsMean * newsMean;
    const earnVar = (s.earnVol * s.earnVol) / 3;            // one surprise per quarter
    const rateVar = Math.pow(s.rateSens / 100, 2) * rateM2;  // duration × rate changes
    const jumpVar = s.jump * 9.33 * s.vol * s.vol;           // jumps of 2–4σ
    const jumpMean = s.jump * (0.45 - 0.55) * 3 * s.vol;     // slightly more down-jumps than up
    const total = s.vol * s.vol;
    s.dvol = Math.sqrt(Math.max(0.3 * total, total - newsVar - earnVar - rateVar - jumpVar));
    s.dDrift = s.drift - newsMean - jumpMean;
  }

  function initMarket(state, rng) {
    const { cents, roundTo } = C();
    const m = {
      securities: {},
      order: [],
      reIndex: 100,
      rate: roundTo(rng.float(3.25, 4.75), 0.25),
      rateHistory: [],
      economy: 'stable',
      fear: 1,
      sentiment: 50,
      sentimentHistory: [],
      froth: 0,
      pendingShocks: [],
      pennyGeneration: 0,
      movers: []
    };
    for (const s of D().SECURITIES) {
      const price = cents(rng.range(s.price));
      m.securities[s.id] = {
        id: s.id, ticker: s.ticker, name: s.name, sector: s.sector, icon: s.icon, desc: s.desc,
        vol: s.vol, drift: s.drift, corr: s.corr, beta: s.beta, cyc: s.cyc, rateSens: s.rateSens,
        jump: s.jump, earnVol: s.earnVol, yield: s.yield, divGrowth: s.divGrowth,
        equity: !!s.equity, crypto: !!s.crypto, penny: !!s.penny, bond: !!s.bond,
        price, prevPrice: price, div: 0, v: 1, history: []
      };
      m.securities[s.id].sent = sentExposure(m.securities[s.id]);
      calibrate(m.securities[s.id]);
      m.order.push(s.id);
    }
    state.market = m;
    // Warm up two years of price history so charts and statistics have data.
    for (let i = 0; i < 24; i++) {
      stepPrices(state, rng, {}, 0);
      stepSentiment(state, rng, 0);
      m.rateHistory.push(m.rate);
    }
    for (const id of m.order) {
      const s = m.securities[id];
      s.div = s.yield ? s.price * s.yield / 12 : 0; // fixed $/share per month; grows over time
    }
  }

  function fearImpact(state, s) {
    const fear = state.market.fear;
    return s.equity || s.crypto ? fear : 1 + (fear - 1) * 0.3;
  }

  /** Volatility right now (target × clustering × market fear) — what the UI shows. */
  function currentVol(state, s) { return s.vol * Math.sqrt(s.v) * fearImpact(state, s); }

  function stepPrices(state, rng, shocks, rateDelta) {
    const { cents, clamp } = C();
    const m = state.market;
    const zm = rng.normal();
    m.movers = [];
    // Mood: this month's herd push, minus part of the froth built up by earlier mood swings.
    const g = greed(m);
    const sentMove = SENT_TILT * g - SENT_REVERT * (m.froth || 0);
    m.froth = (m.froth || 0) + sentMove;
    for (const id of m.order) {
      const s = m.securities[id];
      const sigma = s.dvol * Math.sqrt(s.v) * fearImpact(state, s);
      const z = s.corr * zm + Math.sqrt(Math.max(0, 1 - s.corr * s.corr)) * rng.normal();
      let r = s.dDrift + ECON_DRIFT[m.economy] * s.cyc - (sigma * sigma) / 2 + sigma * z;
      r += sentMove * (s.sent != null ? s.sent : sentExposure(s));
      // Fat tails: rare sudden jumps, more likely when fear is high (and more often down than up).
      let jumped = false;
      if (s.jump && rng.chance(s.jump * m.fear)) {
        r += (rng.chance(0.45) ? 1 : -1) * rng.float(2, 4) * s.vol;
        jumped = true;
      }
      if (rateDelta) r += Math.log(Math.max(0.05, 1 + s.rateSens * rateDelta / 100));
      if (shocks[id]) r += Math.log(Math.max(0.02, 1 + shocks[id]));
      // Volatility clustering (GARCH-style): v' = ω + α·ε² + β·v with ω=0.1, α=0.1, β=0.8, where
      // ε is this month's whole surprise measured against the target volatility. A big move raises
      // next month's volatility, calm stretches lower it, and the long-run average stays at v = 1.
      const eps = (r - s.drift) / (s.vol * fearImpact(state, s));
      s.v = clamp(0.1 + 0.1 * Math.min(eps * eps, 9) + 0.8 * s.v, 0.5, 3);
      s.prevPrice = s.price;
      s.price = Math.max(0.05, cents(s.price * Math.exp(r)));
      s.history.push(s.price);
      if (s.history.length > 120) s.history.shift();
      if (jumped) m.movers.push(id);
    }
    let reR = RE_DRIFT[m.economy] + 0.008 * rng.normal();
    if (rateDelta) reR -= rateDelta * 0.01;
    if (shocks.__re) reR += Math.log(1 + shocks.__re);
    m.reIndex = m.reIndex * Math.exp(reR);
    // Fear gauge relaxes toward its normal level for the current economy.
    // Greed calms the market (complacency); fear makes it jumpier.
    const fearTarget = FEAR_TARGET[m.economy] - 0.12 * g;
    m.fear = clamp(fearTarget + 0.7 * (m.fear - fearTarget), 0.7, 2.5);
  }

  function applyNews(state, rng, n, shocks, headlines) {
    const { clamp, roundTo } = C();
    const m = state.market;
    if (n.equity) {
      const v = rng.range(n.equity);
      for (const id of m.order) {
        const s = m.securities[id];
        if (s.equity) shocks[id] = combine(shocks[id], v * s.beta);
      }
    }
    if (n.shocks) for (const id in n.shocks) shocks[id] = combine(shocks[id], rng.range(n.shocks[id]));
    if (n.re) shocks.__re = combine(shocks.__re, rng.range(n.re));
    if (n.rate) {
      let d = roundTo(rng.range(n.rate), 0.25);
      if (d === 0) d = n.rate[0] < 0 ? -0.25 : 0.25;
      m.rate = clamp(m.rate + d, 0.25, 9);
    }
    if (n.div) for (const id in n.div) m.securities[id].div *= 1 + n.div[id];
    if (n.fear) {
      m.fear = clamp(m.fear + n.fear, 0.7, 2.5);
      m.sentPush = (m.sentPush || 0) - 45 * n.fear;
    }
    const penny = m.securities.penny;
    const text = n.text.replace('{rate}', m.rate.toFixed(2)).replace('{penny}', `${penny.name} (${penny.ticker})`);
    headlines.push({ text, tone: n.tone, lesson: NEWS_LESSONS[n.id] || '' });
    if (n.econ && m.economy !== n.econ) {
      headlines.push(econHeadline(n.econ, m.economy));
      m.economy = n.econ;
    }
  }

  function econHeadline(to, from) {
    if (to === 'boom') return { text: '📈 The economy is booming! Hiring is up and markets are hot.', tone: 'good', lesson: ECON_LABELS.boom.desc };
    if (to === 'recession') return { text: '📉 Recession! Layoffs are spreading and businesses are struggling.', tone: 'bad', lesson: ECON_LABELS.recession.desc };
    if (from === 'recession') return { text: '🌤️ The recession is over — the economy is stabilizing.', tone: 'good', lesson: 'Recoveries often begin while the news still feels gloomy. Markets look ahead.' };
    return { text: '🌥️ The boom is cooling off; growth returns to normal.', tone: 'neutral', lesson: ECON_LABELS.stable.desc };
  }

  /** Advance the market by one month. Returns this month's headlines. */
  function update(state, rng) {
    const { cents, clamp, log } = C();
    const m = state.market;
    const headlines = [];
    const rateBefore = m.rate;

    // 1. Economy cycle
    const transitions = {
      stable: [['boom', 0.035], ['recession', 0.025]],
      boom: [['stable', 0.08], ['recession', 0.02]],
      recession: [['stable', 0.1]]
    }[m.economy];
    let x = rng.next();
    for (const [to, prob] of transitions) {
      if (x < prob) {
        headlines.push(econHeadline(to, m.economy));
        if (to === 'recession') { m.fear = clamp(m.fear + 0.4, 0.7, 2.5); m.sentPush = (m.sentPush || 0) - 15; }
        m.economy = to;
        break;
      }
      x -= prob;
    }

    // 2. News
    const shocks = {};
    m.sentPush = 0;
    const count = rng.chance(0.4) ? (rng.chance(0.2) ? 2 : 1) : 0;
    const used = new Set();
    for (let i = 0; i < count; i++) {
      const pool = D().NEWS.filter((n) => !used.has(n.id));
      const n = rng.weighted(pool, (it) => it.w * ((it.econW && it.econW[m.economy]) || 1) * newsMoodWeight(state, it));
      used.add(n.id);
      applyNews(state, rng, n, shocks, headlines);
    }

    // 3. Rumors (stock tips) that play out this month
    for (const ps of m.pendingShocks) {
      shocks[ps.sec] = combine(shocks[ps.sec], ps.pct);
      const s = m.securities[ps.sec];
      if (s) {
        headlines.push(ps.pct > 0
          ? { text: `${s.name} (${s.ticker}) jumps — the rumors were true!`, tone: 'good', lesson: '' }
          : { text: `${s.name} (${s.ticker}) slides — the rumors turned out to be false.`, tone: 'bad', lesson: 'This is why rumors are risky: the "sure thing" often isn\'t.' });
      }
    }
    m.pendingShocks = [];

    // 4. Quarterly earnings season for individual companies
    if (state.round % 3 === 0) {
      const results = [];
      for (const id of m.order) {
        const s = m.securities[id];
        if (!s.earnVol) continue;
        const surprise = clamp(rng.normal() * s.earnVol, -0.45, 0.6);
        shocks[id] = combine(shocks[id], surprise);
        results.push({ s, surprise });
      }
      results.sort((a, b) => b.surprise - a.surprise);
      const best = results[0], worst = results[results.length - 1];
      if (best && worst) {
        const pctTxt = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
        headlines.push({
          text: `📊 Earnings season: ${best.s.name} ${best.surprise > 0 ? 'beat' : 'missed'} expectations (${pctTxt(best.surprise)}); ${worst.s.name} ${worst.surprise > 0 ? 'beat' : 'missed'} (${pctTxt(worst.surprise)}).`,
          tone: 'neutral',
          lesson: 'Every quarter companies report their profits. Prices jump or drop based on how results compare with what investors expected.'
        });
      }
    }

    // 5. Gentle interest-rate drift toward ~4%
    if (rng.chance(0.12)) {
      const dir = m.rate > 4.5 ? -1 : m.rate < 3 ? 1 : rng.chance(0.5) ? 1 : -1;
      m.rate = clamp(m.rate + dir * 0.25, 0.25, 9);
    }
    m.rateHistory.push(m.rate);
    if (m.rateHistory.length > 120) m.rateHistory.shift();

    // 6. Prices (including the effect of any interest-rate change)
    stepPrices(state, rng, shocks, m.rate - rateBefore);
    const moodHeadline = stepSentiment(state, rng, m.sentPush);
    m.sentPush = 0;
    if (moodHeadline) headlines.push(moodHeadline);

    // 7. Dividends: companies raise them slowly (not in recessions); bond payouts track rates.
    for (const id of m.order) {
      const s = m.securities[id];
      if (s.bond) {
        const target = s.price * (m.rate + 0.3) / 1200;
        s.div = s.div + (target - s.div) * 0.1;
      } else if (s.div > 0 && s.divGrowth && m.economy !== 'recession') {
        s.div *= 1 + s.divGrowth / 12;
      }
    }

    // 8. Stock splits keep share prices friendly
    for (const id of m.order) {
      const s = m.securities[id];
      if (s.price >= 1000) {
        const k = 10;
        s.price = cents(s.price / k);
        s.prevPrice = s.prevPrice / k;
        s.div = s.div / k;
        s.history = s.history.map((h) => cents(h / k));
        for (const p of state.players) {
          const h = p.holdings[id];
          if (h) h.shares *= k;
        }
        if (MMS.Options) MMS.Options.applySplit(state, id, k);
        headlines.push({ text: `✂️ ${s.name} (${s.ticker}) does a 10-for-1 split.`, tone: 'neutral', lesson: 'A split changes nothing about what you own: 10× the shares at 1/10th the price. It just makes shares cheaper to buy.' });
      }
    }

    // 9. Penny stocks can go bankrupt
    const pn = m.securities.penny;
    if (pn.price < 0.4 && rng.chance(0.25)) {
      headlines.push({ text: `💥 ${pn.name} (${pn.ticker}) files for bankruptcy. Shareholders are wiped out.`, tone: 'bad', lesson: 'When a company goes bankrupt, lenders get paid first. Shareholders are last in line and usually get nothing.' });
      for (const p of state.players) {
        const h = p.holdings.penny;
        if (h && h.shares > 0) log(state, `${p.name} lost ${h.shares.toLocaleString('en-US')} shares of ${pn.ticker} in the bankruptcy.`, 'bad', p.id);
        delete p.holdings.penny;
      }
      if (MMS.Options) MMS.Options.applyBankruptcy(state, 'penny');
      const relist = D().PENNY_RELISTS[m.pennyGeneration % D().PENNY_RELISTS.length];
      m.pennyGeneration++;
      const price = cents(rng.float(1.5, 4));
      Object.assign(pn, { ticker: relist.ticker, name: relist.name, price, prevPrice: price, history: [price], v: 1 });
      headlines.push({ text: `🆕 New listing: ${pn.name} (${pn.ticker}) starts trading at $${price.toFixed(2)}.`, tone: 'neutral', lesson: '' });
    }
    return headlines;
  }

  /** Today's typical 30-year mortgage rate (deals add a little random spread). */
  function baseMortgageRate(state) { return C().roundTo(state.market.rate + 2.6, 0.125); }
  function mortgageRate(state, rng) { return C().roundTo(state.market.rate + 2.4 + rng.float(-0.2, 0.6), 0.125); }

  // ------------------------------------------------------------------ statistics (for the UI)
  function monthlyReturns(s, n) {
    const h = s.history.slice(-(n + 1));
    const out = [];
    for (let i = 1; i < h.length; i++) out.push(Math.log(h[i] / h[i - 1]));
    return out;
  }

  /** Realized annualized volatility over the last two years. */
  function annualVol(s) {
    const r = monthlyReturns(s, 24);
    if (r.length < 6) return s.vol * Math.sqrt(12);
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    const v = r.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (r.length - 1);
    return Math.sqrt(v * 12);
  }

  function periodReturn(s, months) {
    const h = s.history;
    if (h.length < 2) return 0;
    const start = h[Math.max(0, h.length - 1 - months)];
    return s.price / start - 1;
  }

  function maxDrawdown(s) {
    let peak = -Infinity, mdd = 0;
    for (const x of s.history) {
      peak = Math.max(peak, x);
      mdd = Math.min(mdd, x / peak - 1);
    }
    return mdd;
  }

  function currentYield(s) { return s.price > 0 ? s.div * 12 / s.price : 0; }

  const RISK_LEVELS = [
    { max: 0.02, n: 1, label: 'Very low' },
    { max: 0.05, n: 2, label: 'Low' },
    { max: 0.08, n: 3, label: 'Medium' },
    { max: 0.15, n: 4, label: 'High' },
    { max: Infinity, n: 5, label: 'Very high' }
  ];
  function riskLevel(s) { return RISK_LEVELS.find((r) => s.vol < r.max); }

  MMS.Market = {
    initMarket, update, calibrate, mortgageRate, baseMortgageRate, currentVol,
    annualVol, periodReturn, maxDrawdown, currentYield, riskLevel,
    ECON_LABELS, NEWS_LESSONS, MOODS, sentimentMood, sentExposure, greed,
    sentiment: (state) => sentimentOf(state.market)
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = MMS.Market;
})(typeof window !== 'undefined' ? window : globalThis);
