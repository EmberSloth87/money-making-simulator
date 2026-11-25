/*
 * data.js — Static game content: jobs, lifestyles, debts, securities, market news,
 * life events and deal templates. All names here are fictional.
 */
(function (global) {
  'use strict';
  const MMS = global.MMS || (global.MMS = {});

  // Monthly take-home pay ranges. `student` = chance of starting with student loans.
  const JOBS = [
    { title: 'Barista', icon: '☕', salary: [2100, 2700], student: 0.25 },
    { title: 'Retail Associate', icon: '🛍️', salary: [2200, 2900], student: 0.2 },
    { title: 'Warehouse Associate', icon: '📦', salary: [2700, 3400], student: 0.1 },
    { title: 'Custodian', icon: '🧹', salary: [2400, 3100], student: 0.05 },
    { title: 'Line Cook', icon: '🍳', salary: [2500, 3200], student: 0.1 },
    { title: 'Administrative Assistant', icon: '🗂️', salary: [2900, 3700], student: 0.35 },
    { title: 'Truck Driver', icon: '🚚', salary: [4000, 5200], student: 0.05 },
    { title: 'Auto Mechanic', icon: '🔧', salary: [3500, 4600], student: 0.15 },
    { title: 'Electrician', icon: '⚡', salary: [4400, 6000], student: 0.15 },
    { title: 'Plumber', icon: '🚰', salary: [4200, 5800], student: 0.1 },
    { title: 'Teacher', icon: '🍎', salary: [3500, 4700], student: 0.75 },
    { title: 'Social Worker', icon: '🤝', salary: [3300, 4200], student: 0.8 },
    { title: 'Police Officer', icon: '👮', salary: [4500, 5800], student: 0.3 },
    { title: 'Firefighter', icon: '🚒', salary: [4300, 5600], student: 0.25 },
    { title: 'Registered Nurse', icon: '🩺', salary: [5400, 7000], student: 0.7 },
    { title: 'Accountant', icon: '🧮', salary: [5000, 6600], student: 0.65 },
    { title: 'Graphic Designer', icon: '🎨', salary: [3700, 5000], student: 0.6 },
    { title: 'Marketing Manager', icon: '📣', salary: [6000, 8000], student: 0.55 },
    { title: 'Civil Engineer', icon: '🏗️', salary: [6400, 8400], student: 0.65 },
    { title: 'Software Engineer', icon: '💻', salary: [8500, 12000], student: 0.5 },
    { title: 'Data Scientist', icon: '📊', salary: [8000, 11000], student: 0.6 },
    { title: 'Pharmacist', icon: '💊', salary: [8400, 10400], student: 0.9 },
    { title: 'Airline Pilot', icon: '✈️', salary: [9000, 14000], student: 0.4 },
    { title: 'Lawyer', icon: '⚖️', salary: [9000, 14500], student: 0.95 },
    { title: 'Dentist', icon: '🦷', salary: [10500, 15000], student: 0.95 },
    { title: 'Doctor', icon: '🩻', salary: [13000, 19000], student: 0.95 }
  ];

  // Title prefixes earned through promotions.
  const JOB_LEVELS = ['', 'Senior ', 'Lead ', 'Head '];

  // Ordered cheapest → most expensive. `living` = share of salary spent on living expenses.
  const LIFESTYLES = [
    { id: 'frugal', name: 'Frugal', icon: '🥫', living: [0.38, 0.45], luxury: 0.6, weight: 0.2, desc: 'Coupons, thrift stores and home-cooked meals.' },
    { id: 'modest', name: 'Modest', icon: '🏠', living: [0.45, 0.52], luxury: 0.85, weight: 0.35, desc: 'Comfortable, but careful with money.' },
    { id: 'comfortable', name: 'Comfortable', icon: '🛋️', living: [0.52, 0.6], luxury: 1.1, weight: 0.3, desc: 'A nice car and regular dinners out.' },
    { id: 'lavish', name: 'Lavish', icon: '🥂', living: [0.6, 0.68], luxury: 1.5, weight: 0.15, desc: 'Designer labels and first-class tickets.' }
  ];

  // Living-expense categories and their typical share of the living budget.
  const EXPENSES = [
    { id: 'housing', label: 'Housing', share: 0.34 },
    { id: 'food', label: 'Food & groceries', share: 0.15 },
    { id: 'transport', label: 'Transportation', share: 0.12 },
    { id: 'utilities', label: 'Utilities & phone', share: 0.08 },
    { id: 'insurance', label: 'Insurance & healthcare', share: 0.10 },
    { id: 'fun', label: 'Entertainment & dining', share: 0.09 },
    { id: 'misc', label: 'Shopping & misc.', share: 0.12 }
  ];

  const DEBT_TYPES = {
    credit: { label: 'Credit card', icon: '💳' },
    auto: { label: 'Auto loan', icon: '🚗' },
    student: { label: 'Student loan', icon: '🎓' },
    mortgage: { label: 'Home mortgage', icon: '🏠' },
    personal: { label: 'Personal loan', icon: '🧾' },
    medical: { label: 'Medical debt', icon: '🏥' },
    bnpl: { label: 'Buy-now-pay-later', icon: '🛋️' },
    boat: { label: 'Boat loan', icon: '🛥️' },
    bank: { label: 'Bank loan', icon: '🏦' },
    business: { label: 'Leftover business loan', icon: '📉' }
  };

  const CAR_TYPES = ['SUV', 'pickup truck', 'sedan', 'minivan', 'hybrid hatchback', 'sports coupe', 'crossover'];
  const CARD_NAMES = ['Platinum Rewards card', 'Store credit card', 'Travel rewards card', 'Cash-back card', 'Gold Visa-style card'];

  /*
   * Fictional securities, tuned to behave like their real-world asset classes.
   *   vol      target TOTAL monthly volatility (× √12 ≈ annual): bonds ~5%, index ~15%, AI ~55%, crypto ~75%
   *   drift    expected monthly price return (dividends are paid on top)
   *   corr     correlation with the overall stock market
   *   beta     sensitivity to market-wide news (crashes, rallies)
   *   cyc      sensitivity to the economy (booms & recessions); negative = safe haven
   *   rateSens % price change per 1-point rise in interest rates (bond "duration")
   *   jump     chance per month of a sudden, unexplained jump (fat tails)
   *   earnVol  size of quarterly earnings surprises (individual companies only)
   *   yield    annual dividend yield at the starting price; divGrowth = annual dividend growth
   */
  const SECURITIES = [
    { id: 'idx', ticker: 'L500', name: 'Liberty 500 Index Fund', sector: 'Index Fund', icon: '🗽', price: [95, 110],
      vol: 0.043, drift: 0.0072, corr: 0.98, beta: 1.0, cyc: 1.0, rateSens: -1.5, jump: 0.01, earnVol: 0, yield: 0.015, divGrowth: 0.05, equity: true,
      desc: 'Owns a slice of 500 large companies at once. Instant diversification, low fees, and historically about 7–10% a year — with bumpy years along the way.' },
    { id: 'mega', ticker: 'MGBT', name: 'MegaByte Technologies', sector: 'Big Tech', icon: '🖥️', price: [160, 220],
      vol: 0.075, drift: 0.0088, corr: 0.75, beta: 1.15, cyc: 1.1, rateSens: -2, jump: 0.015, earnVol: 0.05, yield: 0.006, divGrowth: 0.08, equity: true,
      desc: 'A profitable tech giant (cloud, phones, search). Grows faster than the market but swings harder, and pays only a tiny dividend.' },
    { id: 'nrlx', ticker: 'NRLX', name: 'NeuraLux AI', sector: 'Artificial Intelligence', icon: '🤖', price: [35, 60],
      vol: 0.16, drift: 0.016, corr: 0.55, beta: 1.6, cyc: 1.6, rateSens: -3.5, jump: 0.03, earnVol: 0.12, yield: 0, divGrowth: 0, equity: true,
      desc: 'A red-hot AI "growth stock". Priced on future dreams, so it can double or halve in months. Pays no dividend.' },
    { id: 'vitl', ticker: 'VITL', name: 'Vitalis Health', sector: 'Healthcare', icon: '🩺', price: [65, 90],
      vol: 0.052, drift: 0.0065, corr: 0.5, beta: 0.7, cyc: 0.4, rateSens: -0.8, jump: 0.015, earnVol: 0.04, yield: 0.021, divGrowth: 0.05, equity: true,
      desc: 'Hospitals and drugs. People need healthcare in good times and bad, so it\'s fairly "defensive" — except around drug-trial news.' },
    { id: 'frsh', ticker: 'FRSH', name: 'FreshCart Grocers', sector: 'Grocery Chain', icon: '🛒', price: [30, 48],
      vol: 0.0375, drift: 0.0057, corr: 0.4, beta: 0.5, cyc: 0.2, rateSens: -0.8, jump: 0.01, earnVol: 0.03, yield: 0.033, divGrowth: 0.04, equity: true,
      desc: 'Everybody buys groceries, even in a recession. A slow-growing, low-volatility "consumer staples" stock with a reliable dividend.' },
    { id: 'volt', ticker: 'VLTV', name: 'Voltrive Motors', sector: 'Electric Vehicles', icon: '🚘', price: [40, 80],
      vol: 0.13, drift: 0.012, corr: 0.6, beta: 1.5, cyc: 1.7, rateSens: -3, jump: 0.025, earnVol: 0.1, yield: 0, divGrowth: 0, equity: true,
      desc: 'An EV upstart. Car sales are "cyclical" — they boom with the economy and crater in recessions. Very volatile.' },
    { id: 'hlio', ticker: 'HLIO', name: 'Helios Energy', sector: 'Energy', icon: '⛽', price: [25, 40],
      vol: 0.07, drift: 0.0057, corr: 0.45, beta: 0.85, cyc: 0.9, rateSens: -1, jump: 0.015, earnVol: 0.05, yield: 0.048, divGrowth: 0.02, equity: true,
      desc: 'Oil, gas and solar farms. Moves with energy prices and pays a high dividend — which can be cut when times are tough.' },
    { id: 'keyr', ticker: 'KEYR', name: 'Keystone Realty REIT', sector: 'Real Estate Trust', icon: '🏙️', price: [20, 30],
      vol: 0.055, drift: 0.0035, corr: 0.55, beta: 0.9, cyc: 0.9, rateSens: -4, jump: 0.01, earnVol: 0.03, yield: 0.068, divGrowth: 0.03, equity: true,
      desc: 'A Real Estate Investment Trust: owns apartments and malls and must pay out most of its rent as dividends. Sensitive to interest rates.' },
    { id: 'tbnd', ticker: 'TBND', name: 'Steadfast Treasury Bond Fund', sector: 'Bonds', icon: '🏛️', price: [48, 52],
      vol: 0.0145, drift: 0.0012, corr: -0.15, beta: 0, cyc: -0.3, rateSens: -6, jump: 0, earnVol: 0, yield: 0.045, divGrowth: 0, equity: false, bond: true,
      desc: 'Government bonds: very low risk. When interest rates rise, bond prices fall (and vice versa), but the fund\'s payouts drift toward current rates.' },
    { id: 'aurm', ticker: 'AURM', name: 'Aurum Gold Trust', sector: 'Gold', icon: '🥇', price: [80, 100],
      vol: 0.046, drift: 0.004, corr: -0.15, beta: 0, cyc: -0.5, rateSens: -1, jump: 0.01, earnVol: 0, yield: 0, divGrowth: 0, equity: false,
      desc: 'Physical gold. Pays nothing, but often rises when markets panic — a classic "safe haven" and diversifier.' },
    { id: 'kryx', ticker: 'KRYX', name: 'Kryptonix', sector: 'Cryptocurrency', icon: '🪙', price: [90, 160],
      vol: 0.216, drift: 0.028, corr: 0.35, beta: 0, cyc: 1.5, rateSens: -3, jump: 0.04, earnVol: 0, yield: 0, divGrowth: 0, equity: false, crypto: true,
      desc: 'A digital currency with no earnings or dividends — its price is pure supply and demand. Extreme swings of 30%+ in a month are common.' },
    { id: 'penny', ticker: 'QLWD', name: 'QuantumLeap Widgets', sector: 'Penny Stock', icon: '🎲', price: [1.5, 4],
      vol: 0.275, drift: 0.01, corr: 0.3, beta: 1.5, cyc: 2.0, rateSens: -2, jump: 0.05, earnVol: 0.2, yield: 0, divGrowth: 0, equity: true, penny: true,
      desc: 'A tiny speculative company. Penny stocks can 10× on hype — or go bankrupt and wipe out shareholders entirely.' }
  ];

  // Replacement penny stocks listed after a bankruptcy.
  const PENNY_RELISTS = [
    { ticker: 'ZNTH', name: 'Zenith Biotech' },
    { ticker: 'NVDR', name: 'NovaDrone Robotics' },
    { ticker: 'HYPF', name: 'HyperFreight Logistics' },
    { ticker: 'FSPK', name: 'FusionSpark Energy' },
    { ticker: 'MNGO', name: 'MangoMobile' },
    { ticker: 'ASTM', name: 'AstroMine Resources' }
  ];

  /*
   * Market news. shocks: per-security % move ranges. equity: market-wide move (scaled by beta).
   * re: real-estate price move. rate: interest-rate change. div: dividend change. econ: economy shift.
   * econW: weight multipliers depending on the current economy.
   */
  const NEWS = [
    { id: 'ai_breakthrough', w: 3, tone: 'good', text: 'NeuraLux AI unveils a breakthrough model — AI stocks soar.', shocks: { nrlx: [0.18, 0.45], mega: [0.03, 0.08] } },
    { id: 'ai_bubble', w: 2.5, tone: 'bad', text: 'Analysts warn of an AI bubble; investors rush for the exits.', shocks: { nrlx: [-0.35, -0.15], mega: [-0.08, -0.02] }, fear: 0.1 },
    { id: 'ai_regulation', w: 1.5, tone: 'bad', text: 'New AI safety regulations will slow product launches.', shocks: { nrlx: [-0.2, -0.08] } },
    { id: 'rate_cut', w: 2, tone: 'good', text: 'The central bank cuts interest rates to {rate}%.', rate: [-0.5, -0.25], equity: [0.005, 0.025], re: [0.01, 0.025], fear: -0.1, econW: { recession: 2.5, boom: 0.4 } },
    { id: 'rate_hike', w: 2, tone: 'bad', text: 'The central bank hikes interest rates to {rate}%.', rate: [0.25, 0.5], equity: [-0.025, -0.005], re: [-0.025, -0.005], fear: 0.1, econW: { boom: 2.5, recession: 0.3 } },
    { id: 'crypto_crash', w: 1.5, tone: 'bad', text: 'A major crypto exchange collapses. Kryptonix plunges.', shocks: { kryx: [-0.55, -0.25] } },
    { id: 'crypto_rally', w: 2, tone: 'good', text: 'A big payment network starts accepting Kryptonix — crypto rallies!', shocks: { kryx: [0.25, 0.7] } },
    { id: 'crypto_hack', w: 1, tone: 'bad', text: 'Hackers drain a popular crypto wallet app. Confidence in crypto slips.', shocks: { kryx: [-0.3, -0.12] } },
    { id: 'tech_earnings', w: 2, tone: 'good', text: 'MegaByte crushes earnings estimates on booming cloud sales.', shocks: { mega: [0.07, 0.16] } },
    { id: 'tech_antitrust', w: 1.5, tone: 'bad', text: 'Regulators sue MegaByte Technologies over antitrust concerns.', shocks: { mega: [-0.15, -0.06] } },
    { id: 'drug_approval', w: 1.5, tone: 'good', text: 'Vitalis Health wins approval for a blockbuster new drug.', shocks: { vitl: [0.08, 0.2] } },
    { id: 'health_reform', w: 1.2, tone: 'bad', text: 'Healthcare reform squeezes hospital profits.', shocks: { vitl: [-0.14, -0.05] } },
    { id: 'grocery_record', w: 1.2, tone: 'good', text: 'FreshCart posts record sales and raises its dividend.', shocks: { frsh: [0.04, 0.1] }, div: { frsh: 0.08 } },
    { id: 'grocery_war', w: 1.2, tone: 'bad', text: 'A grocery price war erupts; FreshCart margins get crushed.', shocks: { frsh: [-0.12, -0.05] } },
    { id: 'oil_spike', w: 1.5, tone: 'neutral', text: 'Oil prices spike on supply fears. Energy up, everything else down.', shocks: { hlio: [0.12, 0.25] }, equity: [-0.03, -0.01] },
    { id: 'energy_glut', w: 1.2, tone: 'bad', text: 'An energy glut sends oil and gas prices tumbling.', shocks: { hlio: [-0.18, -0.07] } },
    { id: 'helios_div_cut', w: 0.8, tone: 'bad', text: 'Helios Energy slashes its dividend by 35%.', shocks: { hlio: [-0.12, -0.05] }, div: { hlio: -0.35 } },
    { id: 'ev_credits', w: 1.5, tone: 'good', text: 'Expanded EV tax credits spark a buying frenzy at Voltrive.', shocks: { volt: [0.15, 0.35] } },
    { id: 'ev_recall', w: 1.2, tone: 'bad', text: 'Voltrive recalls 200,000 vehicles over battery fires.', shocks: { volt: [-0.3, -0.12] } },
    { id: 'gold_rush', w: 1.2, tone: 'good', text: 'Nervous investors pile into gold as a safe haven.', shocks: { aurm: [0.06, 0.14] } },
    { id: 'reit_boom', w: 1, tone: 'good', text: 'Keystone Realty REIT raises its dividend after strong leasing.', shocks: { keyr: [0.05, 0.11] }, div: { keyr: 0.06 } },
    { id: 'housing_boom', w: 1.5, tone: 'good', text: 'Housing boom! Home prices jump as buyers bid up listings.', re: [0.03, 0.07], shocks: { keyr: [0.03, 0.07] } },
    { id: 'housing_slump', w: 1.3, tone: 'bad', text: 'Housing slump: listings pile up and prices fall.', re: [-0.09, -0.03], shocks: { keyr: [-0.09, -0.03] } },
    { id: 'penny_contract', w: 1, tone: 'good', text: '{penny} lands a surprise government contract!', shocks: { penny: [0.5, 1.6] } },
    { id: 'penny_scandal', w: 1, tone: 'bad', text: '{penny} is under investigation for accounting fraud.', shocks: { penny: [-0.6, -0.3] } },
    { id: 'market_crash', w: 0.7, tone: 'bad', text: '🚨 Stock market crash! Panic selling wipes out trillions.', equity: [-0.28, -0.14], shocks: { kryx: [-0.45, -0.2], aurm: [0.04, 0.1], tbnd: [0.01, 0.03] }, re: [-0.05, -0.01], econ: 'recession', fear: 0.9, econW: { boom: 1.8, recession: 0.3 } },
    { id: 'bull_rally', w: 1.5, tone: 'good', text: 'Bull run! Stocks rally to record highs.', equity: [0.05, 0.11], shocks: { kryx: [0.05, 0.2] }, fear: -0.2, econW: { boom: 1.5, recession: 0.5 } },
    { id: 'jobs_report', w: 1.5, tone: 'good', text: 'Blowout jobs report: unemployment hits a record low.', equity: [0.01, 0.03] },
    { id: 'recession_warning', w: 1.2, tone: 'bad', text: 'Economists warn a recession may be coming.', equity: [-0.06, -0.02], fear: 0.2 }
  ];

  // Luxury temptations (forced spending — choose to pay cash or put it on a credit card).
  const LUXURIES = [
    { icon: '📱', title: 'The newest smartphone just dropped', text: 'Your phone is "ancient" (two years old). You cave and buy the latest flagship.', cost: [900, 1600] },
    { icon: '🎰', title: 'Spontaneous Vegas weekend', text: 'Your friends planned a weekend in Las Vegas and you couldn\'t say no.', cost: [700, 2500] },
    { icon: '👜', title: 'Designer handbag', text: 'It was on display, it was beautiful, and now it\'s yours.', cost: [1200, 4500] },
    { icon: '📺', title: 'Big-screen TV & surround sound', text: 'Game day will never be the same.', cost: [1200, 3500] },
    { icon: '💒', title: 'Friend\'s destination wedding', text: 'Flights, hotel, a gift, and a new outfit for a wedding in Tulum.', cost: [1500, 4000] },
    { icon: '💆', title: 'Luxury spa retreat', text: 'You deserve it… right?', cost: [800, 2200] },
    { icon: '🛳️', title: 'Caribbean cruise', text: 'Seven days of buffets and sunburns.', cost: [2500, 6500] },
    { icon: '🎮', title: 'High-end gaming PC', text: 'Ray tracing at 240 frames per second. Totally necessary.', cost: [1500, 3200] },
    { icon: '⛳', title: 'Golf clubs & country club fees', text: 'Networking on the links (mostly losing balls in the pond).', cost: [1200, 3000] },
    { icon: '🎤', title: 'Concert tickets & VIP dinner', text: 'Front-row seats to see your favorite band.', cost: [300, 900] },
    { icon: '🚤', title: 'A jet ski', text: 'Summer is coming and the dealer had a "deal".', cost: [7000, 14000], minLifestyle: 2 },
    { icon: '👗', title: 'Wardrobe refresh', text: 'Nothing in your closet "sparks joy" anymore.', cost: [1000, 3500] },
    { icon: '☕', title: 'Fancy espresso machine', text: 'It will pay for itself in lattes. Eventually.', cost: [600, 1800] },
    { icon: '🛁', title: 'Backyard hot tub', text: 'The neighbors got one, so…', cost: [4000, 9000], homeowner: true },
    { icon: '🎿', title: 'Ski trip with friends', text: 'Lift tickets, lodge, rentals and après-ski.', cost: [1200, 3500] }
  ];

  // Unexpected expenses (forced — pay cash or charge it).
  const EMERGENCIES = [
    { icon: '🚗', title: 'Car trouble', text: 'Your transmission gave out on the highway.', cost: [600, 3200] },
    { icon: '🏥', title: 'Medical bill', text: 'An unexpected trip to the ER. Insurance covered some of it…', cost: [500, 4500] },
    { icon: '🦷', title: 'Dental work', text: 'You need a root canal and a crown.', cost: [900, 2800] },
    { icon: '🐕', title: 'Vet bills', text: 'Your dog swallowed a sock. Surgery was required.', cost: [400, 2500] },
    { icon: '💻', title: 'Laptop died', text: 'It won\'t turn on, and you need it for work.', cost: [500, 1500] },
    { icon: '🔧', title: 'Home repair', text: 'The water heater burst and flooded the basement.', cost: [1200, 6000], homeowner: true },
    { icon: '🚓', title: 'Traffic ticket', text: 'Caught going 15 over in a school zone.', cost: [150, 450] },
    { icon: '🧾', title: 'Surprise tax bill', text: 'You under-withheld last year and owe the tax man.', cost: [500, 3500] },
    { icon: '✈️', title: 'Family emergency', text: 'You flew across the country on short notice to help family.', cost: [700, 2200] },
    { icon: '📱', title: 'Shattered phone screen', text: 'Face-down on the sidewalk. Of course.', cost: [200, 450] }
  ];

  const SIDE_GIGS = [
    { title: 'Weekend delivery driver', text: 'A delivery app is desperate for weekend drivers in your area.' },
    { title: 'Evening tutoring', text: 'A neighbor asks if you can tutor their kids a few evenings a week.' },
    { title: 'Wedding-season bartender', text: 'A catering company needs bartenders for wedding season.' },
    { title: 'Freelance consulting', text: 'A small company wants your expertise a few hours a week.' },
    { title: 'Dog walking & pet sitting', text: 'Your building is full of busy dog owners.' },
    { title: 'Weekend handyman', text: 'Friends keep asking you to fix things — why not charge for it?' }
  ];

  const SELLER_STORIES = [
    'The seller is relocating for work and wants a quick close.',
    'Bank-owned foreclosure, sold as-is.',
    'Estate sale — the heirs just want it sold.',
    'Motivated seller going through a divorce.',
    'A retiring landlord wants out of the business.',
    'It has sat on the market for months and the price was just cut.',
    'An off-market tip from a real-estate agent friend.',
    'Tired landlord with long-term tenants already in place.',
    'The out-of-state owner has never even seen it.'
  ];

  const BIZ_STORIES = [
    'The owner is retiring after 20 years and wants it in good hands.',
    'The founders are moving out of state.',
    'An established customer base and trained staff are in place.',
    'The books look solid, but you will want to keep a close eye on it.',
    'A friend of a friend is selling to fund a new venture.'
  ];

  /*
   * Deal templates. Deals are drawn at random (not every turn) in three sizes:
   * small, medium and big. Bigger deals show up more often for wealthier players.
   */
  const DEALS = [
    // ---------------- Real estate ----------------
    { id: 'condo', cat: 'realestate', icon: '🏢', w: 1.1, sizes: ['small'], units: 1, price: [60000, 140000], down: [0.08, 0.15], rent: [0.0085, 0.017], opex: [0.25, 0.38],
      names: ['1BR Condo by the Riverwalk', '2BR Condo near Downtown', 'Studio Condo near the University', 'Corner-unit Condo with a Balcony', '2BR Garden Condo'] },
    { id: 'house', cat: 'realestate', icon: '🏡', w: 1.3, sizes: ['small', 'medium'], units: 1, priceBySize: { small: [95000, 170000], medium: [170000, 300000] }, down: [0.08, 0.2], rent: [0.0085, 0.016], opex: [0.22, 0.34],
      names: ['3BR/2BA Ranch House', '2BR/1BA Bungalow', '4BR Colonial in the Suburbs', '3BR/2BA Split-level with Garage', '3BR Craftsman near the Park'] },
    { id: 'mobile', cat: 'realestate', icon: '🏕️', w: 0.6, sizes: ['small'], units: 1, price: [15000, 45000], down: [0.2, 0.4], rent: [0.018, 0.03], opex: [0.22, 0.35],
      names: ['Double-wide Mobile Home', 'Mobile Home in Sunny Acres Park', 'Single-wide on a Quarter-acre Lot'] },
    { id: 'duplex', cat: 'realestate', icon: '🏘️', w: 1, sizes: ['medium'], units: 2, price: [150000, 320000], down: [0.1, 0.2], rent: [0.009, 0.017], opex: [0.26, 0.38],
      names: ['Side-by-side Duplex', 'Up/Down Duplex near the Hospital', 'Brick Duplex on a Corner Lot'] },
    { id: 'plex', cat: 'realestate', icon: '🏘️', w: 0.9, sizes: ['medium'], units: [3, 4], pricePerUnit: [70000, 115000], down: [0.15, 0.22], rent: [0.009, 0.016], opex: [0.28, 0.4],
      names: ['{plex} near the College', '{plex} in an Up-and-coming Neighborhood', 'Victorian {plex}'] },
    { id: 'cabin', cat: 'realestate', icon: '🛖', w: 0.5, sizes: ['medium'], units: 1, price: [160000, 360000], down: [0.15, 0.25], rent: [0.012, 0.022], opex: [0.38, 0.5], str: true,
      names: ['Lakeside Vacation Cabin', 'Mountain A-frame Getaway', 'Beach Cottage Rental'] },
    { id: 'fixer', cat: 'realestate', icon: '🔨', w: 0.7, sizes: ['medium'], units: 1, price: [55000, 140000], down: [0.15, 0.25], fixer: true, rehab: [0.15, 0.35], rehabTurns: [2, 4], arv: [1.3, 1.7], rent: [0.009, 0.015], opex: [0.24, 0.34],
      names: ['Fixer-upper: 3BR That Needs Everything', 'Fixer-upper: Fire-damaged Bungalow', 'Fixer-upper: Dated 1970s Split-level'] },
    { id: 'apartments', cat: 'realestate', icon: '🏬', w: 1, sizes: ['big'], units: [8, 48], pricePerUnit: [50000, 90000], down: [0.2, 0.28], rent: [0.011, 0.017], opex: [0.33, 0.43],
      names: ['{n}-unit Apartment Complex', 'Garden-style Apartments ({n} units)', '{n}-unit Brick Walk-up'] },
    { id: 'commercial', cat: 'realestate', icon: '🏪', w: 0.6, sizes: ['big'], units: 1, price: [400000, 1800000], down: [0.25, 0.32], rent: [0.01, 0.015], opex: [0.25, 0.35],
      names: ['Neighborhood Strip Mall', 'Self-storage Facility', 'Medical Office Building', 'Small Warehouse with a Long-term Tenant'] },
    { id: 'land', cat: 'realestate', icon: '🌾', w: 0.5, sizes: ['small', 'medium'], land: true, priceBySize: { small: [8000, 30000], medium: [30000, 90000] },
      names: ['5 Acres of Undeveloped Land', 'Vacant Lot near a Planned Highway Exit', '20 Acres of Farmland', 'Wooded Lot on the Edge of Town'] },

    // ---------------- Businesses (ret = monthly operating profit as a share of total cost) ----------------
    { id: 'vending', cat: 'business', icon: '🥤', w: 0.9, sizes: ['small'], cost: [3000, 8000], ret: [0.025, 0.055], vol: 0.07, risk: 'Low',
      names: ['Vending Machine Route (4 machines)', 'Snack & Soda Vending Route', 'Healthy-snack Vending in Office Parks'] },
    { id: 'atm', cat: 'business', icon: '🏧', w: 0.6, sizes: ['small'], cost: [4000, 12000], ret: [0.02, 0.04], vol: 0.05, risk: 'Low',
      names: ['ATMs in Three Local Bars', 'Gas-station ATM Route', 'ATM Route in a Busy Mall'] },
    { id: 'ecom', cat: 'business', icon: '📦', w: 0.8, sizes: ['small'], cost: [2000, 9000], ramp: [1, 3], ret: [-0.02, 0.12], vol: 0.18, risk: 'High', fail: true,
      names: ['Online Pet-supplies Store', 'Handmade Candle Shop (online)', 'Drop-shipping Fitness Gear Store', 'Vintage Clothing Resale Shop'] },
    { id: 'lawn', cat: 'business', icon: '🌱', w: 0.6, sizes: ['small', 'medium'], costBySize: { small: [12000, 20000], medium: [20000, 35000] }, ret: [0.03, 0.06], vol: 0.1, risk: 'Medium',
      names: ['Lawn-care Company (with crew)', 'Pressure-washing Business', 'Holiday-lights Installation Company'] },
    { id: 'foodtruck', cat: 'business', icon: '🌮', w: 0.7, sizes: ['medium'], cost: [25000, 60000], ramp: [1, 2], ret: [-0.01, 0.07], vol: 0.16, risk: 'High', fail: true,
      names: ['Taco Food Truck', 'Gourmet Grilled-cheese Truck', 'Korean BBQ Food Truck', 'Wood-fired Pizza Trailer'] },
    { id: 'coffee', cat: 'business', icon: '☕', w: 0.6, sizes: ['medium'], cost: [50000, 120000], loan: [0.4, 0.6], ramp: [1, 3], ret: [-0.005, 0.04], vol: 0.12, risk: 'High', fail: true,
      names: ['Corner Coffee Shop', 'Drive-thru Coffee Kiosk', 'Café & Bakery'] },
    { id: 'billboard', cat: 'business', icon: '🪧', w: 0.5, sizes: ['medium'], cost: [15000, 45000], ret: [0.012, 0.022], vol: 0.03, risk: 'Low',
      names: ['Highway Billboard Lease', 'Two Digital Billboards', 'Billboard near the Stadium'] },
    { id: 'partnership', cat: 'business', icon: '🤝', w: 0.7, sizes: ['medium', 'big'], costBySize: { medium: [20000, 50000], big: [50000, 150000] }, ret: [0.008, 0.013], vol: 0.02, risk: 'Low',
      names: ['Limited-partner Stake in a 200-unit Apartment Fund', 'Silent Partner in a Regional HVAC Company', 'Stake in a Local Self-storage Fund'] },
    { id: 'laundromat', cat: 'business', icon: '🧺', w: 0.8, sizes: ['big'], cost: [80000, 180000], loan: [0.5, 0.7], ret: [0.014, 0.026], vol: 0.05, risk: 'Low',
      names: ['Laundromat (24 washers, 20 dryers)', 'Coin Laundry near Student Housing'] },
    { id: 'carwash', cat: 'business', icon: '🚿', w: 0.6, sizes: ['big'], cost: [150000, 350000], loan: [0.5, 0.7], ret: [0.013, 0.025], vol: 0.07, risk: 'Medium',
      names: ['Express Tunnel Car Wash', 'Self-serve Car Wash (6 bays)'] },
    { id: 'franchise', cat: 'business', icon: '🥪', w: 0.6, sizes: ['big'], cost: [150000, 400000], loan: [0.5, 0.7], ret: [0.012, 0.022], vol: 0.05, risk: 'Medium',
      names: ['Sub-sandwich Franchise', 'Fitness-studio Franchise', 'Pizza Franchise Location'] },
    { id: 'daycare', cat: 'business', icon: '🧸', w: 0.4, sizes: ['big'], cost: [150000, 350000], loan: [0.5, 0.7], ret: [0.013, 0.023], vol: 0.04, risk: 'Low',
      names: ['Licensed Daycare Center', 'Early Learning Academy'] },

    // ---------------- Startups, side projects, lending, collectibles, stock tips ----------------
    { id: 'startup', cat: 'startup', icon: '🚀', w: 0.7, sizes: ['small', 'medium'], costBySize: { small: [5000, 15000], medium: [15000, 50000] }, months: [6, 18],
      names: ['Seed Round: AI Scheduling App', 'Angel Round: Plant-based Snack Brand', 'Pre-seed: Drone Delivery Startup', 'Crowdfunding: Smart-home Gadget', 'Seed Round: Pet-tech Subscription Box', 'Angel Round: Electric-bike Startup'] },
    { id: 'side', cat: 'side', icon: '💡', w: 0.9, sizes: ['small'], cost: [500, 6000], ramp: [2, 4], vol: 0.12,
      names: ['Write & Self-publish an E-book', 'Launch an Online Course', 'Start a YouTube Channel', 'Build a Budgeting Mobile App', 'Start a Niche Podcast', 'Open a Print-on-demand T-shirt Store', 'Sell a Stock-photography Portfolio'] },
    { id: 'note', cat: 'lending', icon: '📜', w: 0.6, sizes: ['small', 'medium'], costBySize: { small: [5000, 20000], medium: [20000, 75000] }, rate: [8, 14], months: [12, 48],
      names: ['Private Mortgage Note', 'Hard-money Loan to a House Flipper', 'Peer-to-peer Lending Portfolio', 'Small-business Promissory Note'] },
    { id: 'collectible', cat: 'collectible', icon: '💎', w: 0.45, sizes: ['small', 'medium'],
      items: [
        { name: 'Vintage Swiss Watch', icon: '⌚', cost: [2000, 15000] },
        { name: '1967 Classic Muscle Car', icon: '🏎️', cost: [25000, 60000], upkeep: [80, 200], sizes: ['medium'] },
        { name: 'Rare First-edition Comic Book', icon: '📚', cost: [1000, 8000] },
        { name: 'Limited-edition Art Print', icon: '🖼️', cost: [1500, 12000] },
        { name: 'Graded Rare Coin Collection', icon: '🪙', cost: [2000, 20000] },
        { name: 'Signed Championship Jersey', icon: '🏆', cost: [1000, 6000] }
      ], vol: [0.05, 0.12], drift: [-0.003, 0.01] },
    { id: 'tip', cat: 'tip', icon: '🕵️', w: 0.55, sizes: ['small', 'medium', 'big'] }
  ];

  const STOCK_TIPS = [
    { sec: 'nrlx', text: 'A friend at a chip maker says NeuraLux AI is about to sign a massive cloud contract.' },
    { sec: 'volt', text: 'Your neighbor, a Voltrive engineer, hints the new battery tech is "a total game changer."' },
    { sec: 'kryx', text: 'Crypto forums are buzzing: a major retailer may start accepting Kryptonix.' },
    { sec: 'penny', text: 'A stranger on a message board swears {penny} is about to land a huge contract.' },
    { sec: 'mega', text: 'Industry insiders expect MegaByte to blow past its earnings estimates.' },
    { sec: 'vitl', text: 'A doctor friend says the Vitalis Health drug-trial results look incredible.' },
    { sec: 'hlio', text: 'Rumor has it Helios Energy just struck an enormous natural-gas field.' }
  ];

  const AVATARS = ['🦊', '🐼', '🐯', '🐸', '🦉', '🐙', '🦄', '🐢', '🐝', '🦁', '🐧', '🐨', '🦖', '🐳'];
  // Player identity colors: a validated categorical palette for dark surfaces, used in this fixed order
  // (colorblind-safe for neighboring slots). Every player also has an emoji and name, so color is never alone.
  const COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'];

  MMS.Data = {
    JOBS, JOB_LEVELS, LIFESTYLES, EXPENSES, DEBT_TYPES, CAR_TYPES, CARD_NAMES,
    SECURITIES, PENNY_RELISTS, NEWS, LUXURIES, EMERGENCIES, SIDE_GIGS,
    SELLER_STORIES, BIZ_STORIES, DEALS, STOCK_TIPS, AVATARS, COLORS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = MMS.Data;
})(typeof window !== 'undefined' ? window : globalThis);
