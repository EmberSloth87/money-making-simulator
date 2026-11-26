/*
 * ui.js — Renders the game in the browser and wires up every button.
 * All game rules live in the engine; this file only draws state and forwards clicks.
 */
(function () {
  'use strict';
  const { Engine: E, Core: C, Data: D, Market: M, Deals, Options: O, AI } = window.MMS;
  const SAVE_KEY = 'mms.save.v1';
  const SETUP_KEY = 'mms.setup.v1';
  const $app = document.getElementById('app');
  const $modal = document.getElementById('modal-root');
  const $toasts = document.getElementById('toast-root');
  const $tip = document.getElementById('tooltip');

  let S = null; // the game state
  const ui = {
    screen: 'title',
    tab: 'month',
    showPayday: false,
    modal: null,
    intro: false,
    review: false,
    chartMetric: 'netWorth',
    logFilter: 'all',
    expand: {},
    opt: { sec: 'idx', kind: 'call', strike: 2, months: 3, contracts: 1 },
    botRecap: [],   // recent computer turns, each tagged with a sequence number
    recapSeen: {},  // person id → last recap sequence they've seen
    recapSeq: 0,
    setup: loadSetup()
  };

  // ================================================================ formatting
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  function money(n, dp) {
    if (!Number.isFinite(n)) return '—';
    dp = dp || 0;
    const abs = Math.abs(n);
    const s = '$' + abs.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
    return (n < 0 && abs >= (dp ? 0.005 : 0.5) ? '−' : '') + s;
  }
  function signed(n) {
    if (!Number.isFinite(n)) return '—';
    const r = Math.round(n);
    return (r > 0 ? '+' : r < 0 ? '−' : '') + '$' + Math.abs(r).toLocaleString('en-US');
  }
  function compact(n) {
    const abs = Math.abs(n), sign = n < 0 ? '−' : '';
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(abs >= 1e7 ? 1 : 2)}M`;
    if (abs >= 1e4) return `${sign}$${Math.round(abs / 1e3)}k`;
    return money(n);
  }
  const pct = (x, dp = 1) => `${(x * 100).toFixed(dp)}%`;
  const spct = (x, dp = 1) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(dp)}%`;
  const toneOf = (n) => (n > 0.0001 ? 'pos' : n < -0.0001 ? 'neg' : '');
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const tip = (text) => `<span class="tip" tabindex="0" role="img" aria-label="${esc(text)}" data-tip="${esc(text)}">?</span>`;
  const mult = () => S.settings.freedomMultiple;
  const fmtMult = (x) => `${Number(x).toString()}×`;
  const botLevel = (p) => (p && p.bot ? AI.LEVELS[p.bot.level] || AI.LEVELS.normal : null);
  const botTag = (p) => (p && p.bot ? ` <span class="bot-tag" data-tip="${esc(`Computer opponent · ${botLevel(p).name}: ${botLevel(p).desc}`)}">🤖 ${esc(botLevel(p).label)}</span>` : '');

  // ================================================================ storage
  function save() {
    if (!S) return;
    try { localStorage.setItem(SAVE_KEY, E.serialize(S)); } catch (e) { /* storage unavailable (e.g. private mode) */ }
  }
  function loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? E.deserialize(raw) : null;
    } catch (e) { return null; }
  }
  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } }
  function defaultSetup() {
    return {
      players: [0, 1].map((i) => ({ name: `Player ${i + 1}`, emoji: D.AVATARS[i], color: D.COLORS[i] })),
      timeLimit: 0, handoff: true, multiple: 2, seed: ''
    };
  }
  function loadSetup() {
    try {
      const s = JSON.parse(localStorage.getItem(SETUP_KEY));
      if (s && Array.isArray(s.players) && s.players.length) return Object.assign(defaultSetup(), s);
    } catch (e) { /* ignore */ }
    return defaultSetup();
  }
  function saveSetup() { try { localStorage.setItem(SETUP_KEY, JSON.stringify(ui.setup)); } catch (e) { /* ignore */ } }

  // ================================================================ toasts & tooltip
  function toast(msg, tone) {
    if (!msg) return;
    const el = document.createElement('div');
    el.className = `toast ${tone || ''}`;
    el.textContent = msg;
    $toasts.appendChild(el);
    setTimeout(() => el.classList.add('leaving'), 5200);
    setTimeout(() => el.remove(), 5600);
  }

  function showTip(target, build) {
    $tip.replaceChildren();
    if (typeof build === 'string') $tip.textContent = build; else build($tip);
    $tip.hidden = false;
    const r = target.getBoundingClientRect ? target.getBoundingClientRect() : target;
    const tw = $tip.offsetWidth, th = $tip.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2;
    let y = r.top - th - 10;
    if (y < 8) y = r.bottom + 10;
    x = Math.max(8, Math.min(window.innerWidth - tw - 8, x));
    $tip.style.left = `${x + window.scrollX}px`;
    $tip.style.top = `${y + window.scrollY}px`;
  }
  function hideTip() { $tip.hidden = true; }

  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest('[data-tip]');
    if (t) showTip(t, t.dataset.tip);
  });
  document.addEventListener('mouseout', (e) => {
    const t = e.target.closest('[data-tip]');
    if (t && !t.contains(e.relatedTarget)) hideTip();
  });
  document.addEventListener('focusin', (e) => {
    const t = e.target.closest('[data-tip]');
    if (t) showTip(t, t.dataset.tip);
  });
  document.addEventListener('focusout', (e) => { if (e.target.closest('[data-tip]')) hideTip(); });

  // ================================================================ charts
  const charts = {};

  function niceTicks(min, max, count) {
    const span = max - min || 1;
    const step0 = span / Math.max(1, count - 1);
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const norm = step0 / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const ticks = [];
    for (let v = Math.floor(min / step) * step; v <= Math.ceil(max / step) * step + step / 2; v += step) ticks.push(Math.round(v / step) * step);
    return ticks;
  }

  function sparkline(values, w, h) {
    w = w || 112; h = h || 30;
    if (!values || values.length < 2) return '';
    const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
    const pts = values.map((v, i) => `${(2 + i / (values.length - 1) * (w - 4)).toFixed(1)},${(h - 3 - (v - min) / span * (h - 6)).toFixed(1)}`).join(' ');
    const up = values[values.length - 1] >= values[0];
    return `<svg class="spark ${up ? 'up' : 'down'}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}"/></svg>`;
  }

  /**
   * Multi-line chart with a crosshair tooltip.
   * series: [{ name, color, values: [{ x, y }] }]
   */
  function lineChart(id, series, o) {
    o = o || {};
    const W = 720, H = o.height || 260;
    const endLabels = series.length > 1 && series.length <= 4;
    const padL = 62, padR = endLabels ? 112 : 18, padT = 14, padB = 30;
    const xs = Array.from(new Set(series.flatMap((s) => s.values.map((v) => v.x)))).sort((a, b) => a - b);
    if (!xs.length) return '<p class="muted">Not enough history yet.</p>';
    const ys = series.flatMap((s) => s.values.map((v) => v.y));
    if (o.ref != null) ys.push(o.ref.y);
    let yMin = Math.min(...ys), yMax = Math.max(...ys);
    if (o.zero) yMin = Math.min(0, yMin);
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    const ticks = niceTicks(yMin, yMax, 5);
    yMin = ticks[0]; yMax = ticks[ticks.length - 1];
    const xMin = xs[0], xMax = xs[xs.length - 1] === xs[0] ? xs[0] + 1 : xs[xs.length - 1];
    const sx = (x) => padL + (x - xMin) / (xMax - xMin) * (W - padL - padR);
    const sy = (y) => padT + (1 - (y - yMin) / (yMax - yMin)) * (H - padT - padB);
    const yFmt = o.yFmt || ((v) => compact(v));
    const xFmt = o.xFmt || ((v) => String(v));

    let g = '';
    for (const t of ticks) {
      g += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${sy(t)}" y2="${sy(t)}"/>`;
      g += `<text class="axis-label" x="${padL - 8}" y="${sy(t) + 4}" text-anchor="end">${esc(yFmt(t))}</text>`;
    }
    const base = yMin <= 0 && yMax >= 0 ? 0 : yMin;
    g += `<line class="baseline" x1="${padL}" x2="${W - padR}" y1="${sy(base)}" y2="${sy(base)}"/>`;
    const nLabels = Math.min(6, xs.length);
    for (let i = 0; i < nLabels; i++) {
      const x = xs[Math.round(i * (xs.length - 1) / Math.max(1, nLabels - 1))];
      g += `<text class="axis-label" x="${sx(x)}" y="${H - 8}" text-anchor="middle">${esc(xFmt(x))}</text>`;
    }
    if (o.ref) {
      g += `<line class="refline" x1="${padL}" x2="${W - padR}" y1="${sy(o.ref.y)}" y2="${sy(o.ref.y)}"/>`;
      g += `<text class="axis-label ref" x="${padL + 6}" y="${sy(o.ref.y) - 6}">${esc(o.ref.label)}</text>`;
    }
    for (const s of series) {
      if (!s.values.length) continue;
      const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${sx(v.x).toFixed(1)},${sy(v.y).toFixed(1)}`).join('');
      if (o.area && series.length === 1) {
        const first = s.values[0], last = s.values[s.values.length - 1];
        g += `<path class="area" fill="${s.color}" d="${d}L${sx(last.x).toFixed(1)},${sy(base)}L${sx(first.x).toFixed(1)},${sy(base)}Z"/>`;
      }
      g += `<path class="series-line" stroke="${s.color}" d="${d}"/>`;
    }
    if (endLabels) {
      const labels = series.filter((s) => s.values.length).map((s) => ({ s, y: sy(s.values[s.values.length - 1].y), x: sx(s.values[s.values.length - 1].x) }));
      labels.sort((a, b) => a.y - b.y);
      for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 15) labels[i].y = labels[i - 1].y + 15;
      const over = labels.length ? labels[labels.length - 1].y - (H - padB - 4) : 0;
      if (over > 0) labels.forEach((l) => { l.y -= over; });
      labels.forEach((l) => { l.y = Math.max(padT + 6, l.y); });
      for (const l of labels) {
        g += `<line class="label-key" x1="${l.x + 6}" x2="${l.x + 16}" y1="${l.y}" y2="${l.y}" stroke="${l.s.color}"/>`;
        g += `<text class="direct-label" x="${l.x + 20}" y="${l.y + 4}">${esc(l.s.name)}</text>`;
      }
    }
    g += `<g class="hover-layer" data-hover="${id}" visibility="hidden"><line class="crosshair" y1="${padT}" y2="${H - padB}"/>`;
    series.forEach((s, i) => { g += `<circle class="hover-dot" data-i="${i}" r="4.5" fill="${s.color}"/>`; });
    g += '</g>';
    g += `<rect class="hit" data-chart="${id}" x="${padL}" y="${padT}" width="${W - padL - padR}" height="${H - padT - padB}" tabindex="0" aria-label="${esc(o.label || 'chart')} — use arrow keys to read values"/>`;
    charts[id] = { series, xs, sx, sy, W, yFmt, xFmt, idx: xs.length - 1 };
    const legend = series.length > 1
      ? `<div class="legend">${series.map((s) => `<span class="legend-item"><svg width="16" height="8" aria-hidden="true"><line x1="1" x2="15" y1="4" y2="4" stroke="${s.color}" stroke-width="2.5" stroke-linecap="round"/></svg>${esc(s.name)}</span>`).join('')}</div>`
      : '';
    return `<div class="chart-wrap">${legend}<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label || 'chart')}">${g}</svg></div>`;
  }

  function chartReadout(rect, idx, clientX, clientY) {
    const id = rect.dataset.chart;
    const ch = charts[id];
    if (!ch) return;
    ch.idx = idx;
    const x = ch.xs[idx];
    const layer = rect.ownerSVGElement.querySelector(`[data-hover="${id}"]`);
    layer.setAttribute('visibility', 'visible');
    const cl = layer.querySelector('.crosshair');
    cl.setAttribute('x1', ch.sx(x)); cl.setAttribute('x2', ch.sx(x));
    const rows = [];
    ch.series.forEach((s, i) => {
      const dot = layer.querySelector(`.hover-dot[data-i="${i}"]`);
      const pt = s.values.find((v) => v.x === x);
      if (pt) {
        dot.setAttribute('cx', ch.sx(x)); dot.setAttribute('cy', ch.sy(pt.y)); dot.setAttribute('visibility', 'visible');
        rows.push({ s, y: pt.y });
      } else dot.setAttribute('visibility', 'hidden');
    });
    rows.sort((a, b) => b.y - a.y);
    const anchor = clientX != null ? { left: clientX, right: clientX, top: clientY - 8, bottom: clientY + 8, width: 0 } : rect.getBoundingClientRect();
    showTip(anchor, (el) => {
      const h = document.createElement('div');
      h.className = 'tt-head';
      h.textContent = ch.xFmt(x);
      el.appendChild(h);
      for (const r of rows) {
        const row = document.createElement('div');
        row.className = 'tt-row';
        const key = document.createElement('span');
        key.className = 'tt-key';
        key.style.background = r.s.color;
        const v = document.createElement('b');
        v.textContent = ch.yFmt(r.y);
        const n = document.createElement('span');
        n.className = 'tt-name';
        n.textContent = r.s.name;
        row.append(key, v, n);
        el.appendChild(row);
      }
    });
  }

  function nearestIndex(ch, rect, clientX) {
    const box = rect.ownerSVGElement.getBoundingClientRect();
    const vx = (clientX - box.left) / box.width * ch.W;
    let best = 0, bd = Infinity;
    ch.xs.forEach((x, i) => { const d = Math.abs(ch.sx(x) - vx); if (d < bd) { bd = d; best = i; } });
    return best;
  }

  document.addEventListener('pointermove', (e) => {
    const rect = e.target.closest && e.target.closest('rect.hit');
    if (!rect) return;
    const ch = charts[rect.dataset.chart];
    if (ch) chartReadout(rect, nearestIndex(ch, rect, e.clientX), e.clientX, e.clientY);
  });
  document.addEventListener('pointerout', (e) => {
    const rect = e.target.closest && e.target.closest('rect.hit');
    if (!rect) return;
    const layer = rect.ownerSVGElement.querySelector(`[data-hover="${rect.dataset.chart}"]`);
    if (layer) layer.setAttribute('visibility', 'hidden');
    hideTip();
  });
  document.addEventListener('keydown', (e) => {
    const rect = e.target.closest && e.target.closest('rect.hit');
    if (!rect || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const ch = charts[rect.dataset.chart];
    if (!ch) return;
    e.preventDefault();
    let i = ch.idx;
    if (e.key === 'ArrowLeft') i = Math.max(0, i - 1);
    if (e.key === 'ArrowRight') i = Math.min(ch.xs.length - 1, i + 1);
    if (e.key === 'Home') i = 0;
    if (e.key === 'End') i = ch.xs.length - 1;
    chartReadout(rect, i);
  });
  document.addEventListener('focusin', (e) => {
    const rect = e.target.closest && e.target.closest('rect.hit');
    if (rect && charts[rect.dataset.chart]) chartReadout(rect, charts[rect.dataset.chart].idx);
  });

  // Allocation bar (100% stacked, fixed color per category).
  const ALLOC_COLORS = { cash: D.COLORS[0], stocks: D.COLORS[1], realestate: D.COLORS[2], business: D.COLORS[3], notes: D.COLORS[4], collect: D.COLORS[5], home: D.COLORS[6], options: D.COLORS[7] };
  function allocationBar(parts) {
    const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0);
    if (total <= 0) return '';
    const segs = parts.filter((p) => p.value > 0).map((p) => {
      const share = p.value / total;
      return `<div class="seg" style="flex:${share};background:${p.color}" data-tip="${esc(`${p.label}: ${money(p.value)} (${pct(share, 0)})`)}" tabindex="0"></div>`;
    }).join('');
    const legend = parts.filter((p) => p.value > 0).map((p) => `<span class="legend-item"><span class="legend-box" style="background:${p.color}"></span>${esc(p.label)} <b>${pct(p.value / total, 0)}</b> <span class="muted">${compact(p.value)}</span></span>`).join('');
    return `<div class="alloc">${segs}</div><div class="legend">${legend}</div>`;
  }

  // ================================================================ title / setup screen
  const setupHumans = () => ui.setup.players.filter((pl) => !pl.bot).length;
  function playerRow(pl, i) {
    const lastHuman = !pl.bot && setupHumans() <= 1;
    const opt = (v, label) => `<option value="${v}" ${(pl.bot || '') === v ? 'selected' : ''}>${label}</option>`;
    return `<div class="prow ${pl.bot ? 'is-bot' : ''}">
      <button class="avatar-btn" data-action="setup-emoji" data-i="${i}" style="--pc:${pl.color}" aria-label="Change avatar">${esc(pl.emoji)}</button>
      <input class="pname" data-i="${i}" value="${esc(pl.name)}" maxlength="24" aria-label="Player ${i + 1} name">
      <select class="ptype" data-i="${i}" aria-label="Who controls ${esc(pl.name)}" ${lastHuman ? 'disabled data-tip="At least one person has to play"' : ''}>
        ${opt('', '🧑 Person')}${AI.LEVEL_IDS.map((id) => opt(id, `🤖 Bot · ${AI.LEVELS[id].label}`)).join('')}
      </select>
      <button class="swatch" data-action="setup-color" data-i="${i}" style="background:${pl.color}" aria-label="Change color" data-tip="Change color"></button>
      ${ui.setup.players.length > 1 && !lastHuman ? `<button class="btn icon" data-action="setup-remove" data-i="${i}" aria-label="Remove player">✕</button>` : '<span class="icon-spacer"></span>'}
    </div>`;
  }

  function renderTitle() {
    const saved = loadSave();
    const st = ui.setup;
    const sel = (v, cur) => (String(v) === String(cur) ? 'selected' : '');
    $app.innerHTML = `
    <div class="title-wrap">
      <header class="hero">
        <div class="hero-logo" aria-hidden="true">💰</div>
        <h1>Money Making Simulator</h1>
        <p class="tagline">Turn a paycheck into passive income, escape the 9-to-5, and race your friends to <strong>financial freedom</strong>.</p>
      </header>
      ${saved ? `<section class="card resume">
        <div><div class="eyebrow">Saved game</div>
        <div class="resume-title">Month ${saved.round} · ${saved.players.map((p) => `${esc(p.emoji)} ${esc(p.name)}${p.bot ? ' 🤖' : ''}`).join(', ')}</div></div>
        <div class="btn-row"><button class="btn primary" data-action="resume">▶ Continue</button><button class="btn ghost" data-action="discard-save">Discard</button></div>
      </section>` : ''}
      <section class="card setup">
        <h2>Who's playing?</h2>
        <p class="muted">1 to 8 players. Play solo, against computer opponents, or pass-and-play with friends on this device.</p>
        <div class="prows">${st.players.map(playerRow).join('')}</div>
        ${st.players.length < 8 ? '<div class="btn-row"><button class="btn ghost" data-action="setup-add">＋ Add a person</button><button class="btn ghost" data-action="setup-add-bot">＋ Add a computer opponent 🤖</button></div>' : ''}
        ${st.players.some((pl) => pl.bot) ? `<ul class="bot-levels muted small">${AI.LEVEL_IDS.map((id) => `<li><b>🤖 ${AI.LEVELS[id].label} — ${AI.LEVELS[id].name}:</b> ${esc(AI.LEVELS[id].desc)}</li>`).join('')}</ul>` : ''}
        <h3>Options</h3>
        <div class="opts">
          <label class="opt"><span>Game length</span>
            <select data-setup="timeLimit">
              <option value="0" ${sel(0, st.timeLimit)}>No limit — play until someone is free</option>
              <option value="36" ${sel(36, st.timeLimit)}>36 months (quick)</option>
              <option value="60" ${sel(60, st.timeLimit)}>60 months</option>
              <option value="100" ${sel(100, st.timeLimit)}>100 months</option>
            </select></label>
          <label class="opt"><span>Freedom goal</span>
            <select data-setup="multiple">
              <option value="1.5" ${sel(1.5, st.multiple)}>Passive income ≥ 1.5× expenses (shorter game)</option>
              <option value="2" ${sel(2, st.multiple)}>Passive income ≥ 2× expenses (standard)</option>
              <option value="3" ${sel(3, st.multiple)}>Passive income ≥ 3× expenses (marathon)</option>
            </select></label>
          <label class="opt"><span>Random seed <small class="muted">(optional — the same seed deals the same game)</small></span>
            <input data-setup="seed" value="${esc(st.seed)}" placeholder="leave blank for a random game" maxlength="40"></label>
          <label class="opt check"><input type="checkbox" data-setup="handoff" ${st.handoff ? 'checked' : ''}> <span>Show a “pass the device” screen between turns</span></label>
        </div>
        <button class="btn primary big" data-action="start-game">Start game ▶</button>
      </section>
      <section class="card how">
        <h2>How it works</h2>
        <ol class="how-list">
          <li><b>Payday every turn.</b> Collect your salary and passive income, then pay living expenses and debts.</li>
          <li><b>Random pop-ups.</b> Deals, luxury temptations, emergencies, layoffs, promotions and charity drives appear at random — not every turn.</li>
          <li><b>Build assets.</b> Buy stocks, real estate and businesses, pay down debt, borrow when it makes sense.</li>
          <li><b>Escape.</b> When your <em>passive</em> income reaches 2× your monthly expenses you can quit your job. First to do it wins!</li>
        </ol>
        <button class="btn ghost" data-action="open-rules">📖 Full rules &amp; tips</button>
      </section>
      <footer class="foot muted">All companies, people and events are fictional. Made for learning about money — not financial advice.
        <div><button class="btn ghost sm" data-action="open-menu">📂 Load a save file</button></div></footer>
    </div>`;
  }

  // ================================================================ game screen
  function econInfo() { return M.ECON_LABELS[S.market.economy]; }
  function mood(fear) {
    if (fear < 0.95) return { icon: '😌', label: 'Calm' };
    if (fear < 1.15) return { icon: '🙂', label: 'Normal' };
    if (fear < 1.5) return { icon: '😟', label: 'Nervous' };
    return { icon: '😱', label: 'Panicked' };
  }

  /** Whose board to show: the current player during a turn, otherwise the last person who played. */
  function viewPlayer() {
    const cur = C.currentPlayer(S);
    if (!cur.bot || S.phase === 'turn') return cur;
    return C.getPlayer(S, S.lastHumanId) || E.humans(S)[0] || cur;
  }

  function renderGame() {
    const p = viewPlayer();
    const s = C.summarize(S, p);
    const econ = econInfo();
    const md = mood(S.market.fear);
    const open = S.turn ? S.turn.cards.filter((c) => !c.resolved).length : 0;
    const tabs = [
      ['month', '📬 This Month', open],
      ['market', '📈 Stocks'],
      ['options', '🎯 Options & Shorts'],
      ['portfolio', '🏠 Portfolio'],
      ['debt', '💳 Debt & Budget'],
      ['standings', '🏆 Standings'],
      ['learn', '🎓 Learn'],
      ['log', '📜 Log']
    ];
    $app.innerHTML = `
    <header class="topbar">
      <div class="brand"><span aria-hidden="true">💰</span> Money Making Simulator</div>
      <div class="topinfo">
        <span class="pill">📅 Month ${S.round}${S.settings.timeLimit ? ` of ${S.settings.timeLimit}` : ''}</span>
        <span class="pill tone-${econ.tone}" data-tip="${esc(econ.desc)}">${econ.icon} Economy: ${econ.label}</span>
        <span class="pill" data-tip="The central bank's interest rate. It drives mortgage rates, bank-loan rates and bond prices.">🏦 Rate ${S.market.rate.toFixed(2)}%</span>
        <span class="pill" data-tip="The market's fear gauge. When investors are nervous, every stock swings harder.">${md.icon} Market mood: ${md.label}</span>
      </div>
      <div class="topactions">
        <button class="btn ghost sm" data-action="open-rules">📖 Rules</button>
        <button class="btn ghost sm" data-action="open-menu">☰ Menu</button>
      </div>
    </header>
    ${ui.review ? `<div class="review-banner">🏁 The game is over. <button class="btn sm primary" data-action="show-results">Show results</button> <button class="btn sm ghost" data-action="new-game">New game</button></div>` : ''}
    ${renderStrip()}
    <main class="layout">
      <aside class="side">${renderStatement(p, s)}</aside>
      <section class="content">
        <nav class="tabs" role="tablist">${tabs.map(([id, label, badge]) => `<button role="tab" class="tab ${ui.tab === id ? 'active' : ''}" aria-selected="${ui.tab === id}" data-action="tab" data-tab="${id}">${label}${badge ? `<span class="badge">${badge}</span>` : ''}</button>`).join('')}</nav>
        <div class="tab-body">${renderTab(p, s)}</div>
      </section>
    </main>
    ${S.phase === 'turn' && !ui.review ? renderTurnBar(p) : ''}`;
  }

  function renderStrip() {
    if (S.players.length < 2) return '';
    return `<div class="strip">${S.players.map((p, i) => {
      const s = C.summarize(S, p);
      const cur = i === S.currentIndex && !p.finished;
      return `<div class="chip ${cur ? 'current' : ''} ${p.finished ? 'finished' : ''}" style="--pc:${p.color}">
        <span class="chip-av">${esc(p.emoji)}</span>
        <div class="chip-body">
          <div class="chip-name">${esc(p.name)}${p.bot ? ' 🤖' : ''}${p.finished ? ` · 🏆 #${p.place}` : cur ? ' · now playing' : ''}</div>
          <div class="mini-meter"><div style="width:${Math.min(100, s.progress * 100).toFixed(1)}%"></div></div>
          <div class="chip-sub">${pct(Math.min(9.99, s.progress), 0)} free · ${compact(s.netWorth)} net worth</div>
        </div></div>`;
    }).join('')}</div>`;
  }

  function renderTurnBar(p) {
    const req = S.turn.cards.find((c) => c.required && !c.resolved);
    const deals = S.turn.cards.filter((c) => c.kind === 'deal' && !c.resolved).length;
    const hint = req ? (req.type === 'expense' ? `⚠️ Decide how to pay for “${esc(req.title)}” first` : `⚠️ Make a decision on “${esc(req.title)}” first`)
      : deals ? `🤝 ${plural(deals, 'deal')} still on the table — they expire when you end your turn`
      : 'Trade stocks, pay off debt or review your portfolio — then end your turn.';
    return `<div class="turnbar" style="--pc:${p.color}">
      <div class="tb-who"><span class="chip-av">${esc(p.emoji)}</span><b>${esc(p.name)}</b><span class="muted">· Month ${S.round}</span></div>
      <div class="tb-hint">${hint}</div>
      <button class="btn primary" data-action="end-turn" ${req ? 'aria-disabled="true"' : ''}>End turn ▶</button>
    </div>`;
  }

  function row(label, value, cls, extra) {
    return `<div class="frow ${cls || ''}"><span>${label}</span><span class="num">${value}</span>${extra || ''}</div>`;
  }

  function renderStatement(p, s) {
    const life = C.lifestyleOf(p);
    const badges = [];
    if (p.finished) badges.push(['good', `🏆 Financially free (#${p.place})`]);
    if (p.unemployedTurns > 0) badges.push(['bad', `🔎 Unemployed · ${plural(p.unemployedTurns, 'turn')} left`]);
    if (p.karmaTurns > 0) badges.push(['good', `😇 Good karma · ${plural(p.karmaTurns, 'more turn')}`]);
    for (const g of p.sideGigs) badges.push(['neutral', `🛠️ ${g.title} · ${g.turnsLeft} left`]);
    badges.push(['neutral', p.ownsHome ? '🏠 Homeowner' : '🔑 Renter']);
    const rel = p.relationship;
    if (rel && rel.status === 'dating') badges.push(['good', `💕 Dating ${rel.partner.emoji} ${rel.partner.name}`]);
    else if (rel && rel.status === 'married') badges.push(['good', `💍 Married to ${rel.partner.emoji} ${rel.partner.name}`]);
    else badges.push(['neutral', rel && rel.divorces ? '💔 Single (divorced)' : '🙋 Single']);
    if (p.children) badges.push(['neutral', `👶 ${plural(p.children, 'kid')}`]);
    if (p.network && p.network.club) badges.push(['good', `🥂 ${p.network.club.name}`]);
    if (p.network && p.network.conferenceTurns > 0) badges.push(['good', `🎤 Conference contacts · ${plural(p.network.conferenceTurns, 'turn')}`]);
    const nOpts = (p.options || []).length, nShorts = Object.keys(p.shorts || {}).length;
    if (nOpts || nShorts) badges.push(['neutral', `🎯 ${[nOpts ? plural(nOpts, 'option') : '', nShorts ? plural(nShorts, 'short') : ''].filter(Boolean).join(' · ')}`]);
    const progress = Math.min(1, s.progress);
    const ex = ui.expand;
    const passiveRows = [
      ['Dividends', s.dividends], ['Real estate', s.realEstate], ['Businesses', s.business],
      ['Side projects', s.side], ['Interest (notes)', s.interest], ['Collectible upkeep', s.collectibles], ['Short positions (fees)', s.shortCarry]
    ].filter(([, v]) => Math.abs(v) >= 0.5);
    const livingRows = D.EXPENSES.map((cat) => [cat.id === 'housing' ? (p.ownsHome ? 'Housing (taxes, insurance, upkeep)' : 'Housing (rent)') : cat.label, p.expenses[cat.id]]);
    return `<div class="card statement" style="--pc:${p.color}">
      <div class="who">
        <div class="avatar-lg">${esc(p.emoji)}</div>
        <div class="who-text"><div class="who-name">${esc(p.name)}</div>
          <div class="muted">${esc(p.job.icon)} ${esc(C.jobTitle(p))}${p.retired ? ' (retired!)' : ''}</div>
          <div class="muted">${life.icon} ${life.name} lifestyle</div></div>
      </div>
      <div class="badges">${badges.map(([t, l]) => `<span class="badge-pill ${t}">${esc(l)}</span>`).join('')}</div>
      <div class="cash-box"><span>Cash</span><b>${money(p.cash)}</b></div>
      <div class="freedom">
        <div class="freedom-head"><span>Freedom meter ${tip(`You win when PASSIVE income (money that arrives without working) reaches ${fmtMult(mult())} your total monthly expenses.`)}</span><b>${pct(s.progress, 0)}</b></div>
        <div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress * 100)}" aria-label="Progress to financial freedom"><div style="width:${(progress * 100).toFixed(1)}%"></div></div>
        <div class="freedom-sub"><b>${money(s.passive)}</b> passive of <b>${money(s.target)}</b>/mo goal <span class="muted">(${fmtMult(mult())} × ${money(s.expenses)} expenses)</span></div>
      </div>
      <div class="fin">
        <div class="fsec">Monthly income</div>
        ${row(`Salary${C.isEmployed(p) ? '' : p.retired ? ' (retired)' : ' (unemployed)'}`, money(s.salary))}
        ${s.gigs ? row('Side gigs', money(s.gigs)) : ''}
        <button class="frow toggle" data-action="toggle" data-key="passive" aria-expanded="${!!ex.passive}"><span>${ex.passive ? '▾' : '▸'} Passive income ${tip('Income from assets: dividends, rent, business profits and interest. Only this counts toward freedom.')}</span><span class="num ${toneOf(s.passive)}">${money(s.passive)}</span></button>
        ${ex.passive ? `<div class="sub-rows">${passiveRows.length ? passiveRows.map(([l, v]) => row(l, money(v), 'sub')).join('') : '<div class="frow sub muted"><span>No passive income yet</span></div>'}</div>` : ''}
        ${row('Total income', money(s.income), 'total')}
        <div class="fsec">Monthly expenses</div>
        <button class="frow toggle" data-action="toggle" data-key="living" aria-expanded="${!!ex.living}"><span>${ex.living ? '▾' : '▸'} Living expenses</span><span class="num">${money(s.living)}</span></button>
        ${ex.living ? `<div class="sub-rows">${livingRows.map(([l, v]) => row(esc(l), money(v), 'sub')).join('')}</div>` : ''}
        ${s.partner ? row(`${esc(p.relationship.partner.name)} pays half ${tip('Married couples split the household bills — living expenses and the mortgage on your home — so you pay half.')}`, `−${money(s.partner)}`, 'pos') : ''}
        ${s.children ? row(`Children (${p.children})${p.childShare < 1 ? ' — your half' : ''}`, money(s.children)) : ''}
        ${s.dating ? row(`Dating ${esc(p.relationship.partner.name)}`, money(s.dating)) : ''}
        ${s.dues ? row('Networking club dues', money(s.dues)) : ''}
        <button class="frow toggle" data-action="toggle" data-key="debt" aria-expanded="${!!ex.debt}"><span>${ex.debt ? '▾' : '▸'} Debt payments</span><span class="num">${money(s.debt)}</span></button>
        ${ex.debt ? `<div class="sub-rows">${p.debts.length ? p.debts.map((d) => row(esc(d.name), money(d.payment), 'sub')).join('') : '<div class="frow sub muted"><span>Debt-free! 🎉</span></div>'}</div>` : ''}
        ${row('Total expenses', money(s.expenses), 'total')}
        <div class="frow big"><span>Monthly cashflow ${tip('Income minus expenses. This is the money you have each month to invest or pay down debt.')}</span><span class="num ${toneOf(s.cashflow)}">${signed(s.cashflow)}</span></div>
        <div class="frow big"><span>Net worth ${tip('Everything you own (cash, stocks, property, businesses, your home) minus everything you owe.')}</span><span class="num ${toneOf(s.netWorth)}">${money(s.netWorth)}</span></div>
      </div>
    </div>`;
  }

  function renderTab(p, s) {
    switch (ui.tab) {
      case 'market': return renderMarket(p, s);
      case 'options': return renderOptions(p, s);
      case 'portfolio': return renderPortfolio(p, s);
      case 'debt': return renderDebt(p, s);
      case 'standings': return renderStandings();
      case 'learn': return renderLearn(p, s);
      case 'log': return renderLog();
      default: return renderMonth(p, s);
    }
  }

  // ---------------------------------------------------------------- This Month
  function renderPaydayLines(pd) {
    return `<div class="payday">${pd.lines.map((l) => `<div class="frow"><span>${esc(l.label)}</span><span class="num ${toneOf(l.amount)}">${signed(l.amount)}</span></div>`).join('')}
      <div class="frow total"><span>Net this payday</span><span class="num ${toneOf(pd.net)}">${signed(pd.net)}</span></div></div>
      ${pd.notes.length ? `<ul class="notes">${pd.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}`;
  }

  function renderHeadlines() {
    const news = S.news || [];
    const m = S.market;
    const movers = m.order.map((id) => m.securities[id]).map((sec) => ({ sec, ch: sec.prevPrice ? sec.price / sec.prevPrice - 1 : 0 }))
      .sort((a, b) => b.ch - a.ch);
    const top = movers.slice(0, 2), bottom = movers.slice(-2).reverse();
    const mv = (x) => `<span class="mover">${esc(x.sec.icon)} ${esc(x.sec.ticker)} <b class="${toneOf(x.ch)}">${spct(x.ch)}</b></span>`;
    return `${news.length ? `<ul class="news">${news.map((n) => `<li class="tone-${n.tone}"><div>${esc(n.text)}</div>${n.lesson ? `<div class="lesson sm">💡 ${esc(n.lesson)}</div>` : ''}</li>`).join('')}</ul>` : '<p class="muted">A quiet month in the markets.</p>'}
      ${S.round > 1 ? `<div class="movers"><span class="muted">Biggest movers last month:</span> ${top.map(mv).join(' ')} · ${bottom.map(mv).join(' ')}</div>` : ''}`;
  }

  function choiceButtons(c, p) {
    if (c.type === 'info') return '';
    return c.choices.map((ch) => {
      let disabled = false, why = '';
      if (c.type === 'expense' && ch.id === 'cash' && p.cash < c.data.cost) { disabled = true; why = 'Not enough cash'; }
      if (c.type === 'charity' && ch.id === 'donate' && p.cash < c.data.amount) { disabled = true; why = 'Not enough cash'; }
      if (c.type === 'refi' && ch.id === 'accept' && p.cash < c.data.fee) { disabled = true; why = 'Not enough cash'; }
      if (c.type === 'expand' && ch.id === 'invest' && p.cash < c.data.cost) { disabled = true; why = 'Not enough cash'; }
      if (c.type === 'deal' && ch.id === 'buy' && p.cash < c.deal.cash) { disabled = true; why = 'Not enough cash'; }
      if (c.type === 'conference' && ch.id === 'attend' && p.cash < c.data.cost) { disabled = true; why = 'Not enough cash'; }
      if (c.type === 'club' && ch.id === 'join' && p.cash < c.data.joinFee) { disabled = true; why = 'Not enough cash for the joining fee'; }
      if (c.type === 'propose' && ch.id === 'cash' && p.cash < c.data.ring + c.data.wedding) { disabled = true; why = 'Not enough cash'; }
      return `<button class="btn ${ch.style === 'primary' ? 'primary' : 'ghost'} sm" data-action="choose" data-card="${c.id}" data-choice="${ch.id}" ${disabled ? `disabled data-tip="${why}"` : ''}>${esc(ch.label)}</button>`;
    }).join('');
  }

  function affordHelp(c, p) {
    if (c.type !== 'deal' || c.resolved || p.cash >= c.deal.cash) return '';
    const need = c.deal.cash - p.cash;
    const borrowAmt = Math.ceil(need / 1000) * 1000;
    const limit = C.loanLimit(S, p);
    return `<div class="afford">You're <b>${money(need)}</b> short. You could sell stocks or other assets, or borrow from the bank (it will lend you up to ${money(limit)}).
      ${borrowAmt <= limit ? `<button class="btn sm" data-action="borrow-buy" data-card="${c.id}">🏦 Borrow ${money(borrowAmt)} &amp; buy</button>` : ''}</div>`;
  }

  function renderEventItem(c, p) {
    return `<div class="event tone-${c.tone} ${c.resolved ? 'done' : ''}">
      <div class="ev-icon" aria-hidden="true">${esc(c.icon)}</div>
      <div class="ev-body">
        <div class="ev-title">${esc(c.title)}</div>
        <div class="ev-text">${esc(c.text)}</div>
        ${c.outcome ? `<div class="ev-outcome">✔ ${esc(c.outcome)}</div>` : ''}
        ${!c.resolved ? `<div class="btn-row">${choiceButtons(c, p)}</div>` : ''}
        ${c.lesson ? `<div class="lesson">💡 ${esc(c.lesson)}</div>` : ''}
      </div></div>`;
  }

  const CAT_LABELS = { realestate: 'Real estate', business: 'Business', side: 'Side project', startup: 'Startup investment', lending: 'Lending', collectible: 'Collectible' };
  function dealCategory(d) { return d.cat === 'business' && d.kind === 'side' ? CAT_LABELS.side : CAT_LABELS[d.cat]; }

  function kv(label, value, cls, help) {
    return `<div class="kv ${cls || ''}"><span>${label}${help ? ' ' + tip(help) : ''}</span><b>${value}</b></div>`;
  }

  function dealBody(d, p) {
    const s = C.summarize(S, p);
    let rows = '';
    if (d.cat === 'realestate' && d.land) {
      rows += kv('Price (all cash)', money(d.price)) + kv('Property taxes', `${money(d.opex)}/mo`) + kv('Monthly cashflow', signed(d.cashflow), 'neg');
    } else if (d.cat === 'realestate') {
      rows += kv('Price', money(d.price)) + kv('Down payment', `${money(d.down)} (${pct(d.down / d.price, 0)})`);
      if (d.fixer) rows += kv('Renovation', `${money(d.fixer.rehab)} · ${plural(d.fixer.turns, 'turn')}`) + kv('Value after repairs', money(d.price * d.fixer.arvMult));
      rows += kv('Mortgage', `${money(d.loan)} @ ${d.rate.toFixed(2)}%, 30 yrs`, '', 'The bank pays the rest of the price. You repay it monthly with interest; the payment is included below.');
      rows += kv(`Rent${d.units > 1 ? ` (${d.units} units)` : ''}${d.str ? ' (avg.)' : ''}`, `${money(d.rent)}/mo`);
      rows += kv('Operating expenses', `−${money(d.opex)}/mo`, '', 'Property taxes, insurance, repairs, management and vacancies.');
      rows += kv('Mortgage payment', `−${money(d.payment)}/mo`);
      rows += kv('Monthly cashflow', signed(d.cashflow), toneOf(d.cashflow) + ' strong');
    } else if (d.cat === 'business') {
      rows += kv('Price', money(d.cost));
      if (d.loan) rows += kv('Business loan', `${money(d.loan)} @ ${d.loanRate.toFixed(2)}%, 10 yrs (−${money(d.loanPayment)}/mo)`) + kv('Cash needed', money(d.cash));
      if (d.base != null) {
        rows += kv('Monthly profit', `${money(d.base)}/mo`);
        if (d.loan) rows += kv('Cashflow after loan', signed(d.cashflow), toneOf(d.cashflow) + ' strong');
      } else {
        rows += kv(d.kind === 'side' ? 'Possible income' : 'Projected profit', `${signed(d.range[0])} to ${signed(d.range[1])}/mo`, '', 'Unknown until it launches. The real number is revealed after the ramp-up.');
      }
      rows += kv('Risk', esc(d.risk));
    } else if (d.cat === 'startup') {
      rows += kv('Investment', money(d.cost)) + kv('Monthly income', '$0') + kv('Resolves in', `~${plural(d.months, 'turn')}`);
    } else if (d.cat === 'lending') {
      rows += kv('Amount to lend', money(d.cost)) + kv('Interest rate', `${d.rate.toFixed(1)}%/yr`) + kv('Monthly interest', `+${money(d.monthly)}/mo`, 'pos strong') + kv('Term', `${plural(d.months, 'month')}, then your principal is returned`);
    } else if (d.cat === 'collectible') {
      rows += kv('Price', money(d.cost)) + kv('Volatility', `±${pct(d.vol * Math.sqrt(12), 0)}/yr`) + kv('Auction fee when sold', '10%');
      if (d.upkeep) rows += kv('Storage & insurance', `−${money(d.upkeep)}/mo`, 'neg');
    }
    const an = Deals.analyze(d);
    const metrics = an.metrics.map((m) => `<div class="metric ${m.tone || ''}"><span>${esc(m.label)} ${tip(m.help)}</span><b>${esc(m.value)}</b></div>`).join('');
    let impact = '';
    if (d.cashflow != null && !p.finished) {
      const newPassive = s.passive + d.cashflow;
      impact = `<div class="impact">If you buy: passive income ${money(s.passive)} → <b>${money(newPassive)}</b>/mo · freedom meter ${pct(s.progress, 0)} → <b>${pct(s.target > 0 ? Math.max(0, newPassive) / s.target : 0, 0)}</b> · cash left ${money(p.cash - d.cash)}</div>`;
    }
    return `<div class="deal-meta"><span class="tag">${esc(dealCategory(d))}</span><span class="tag">${esc(d.size)} deal</span><span class="verdict ${an.verdict.tone}">${esc(an.verdict.label)}</span></div>
      <div class="kv-grid">${rows}</div>
      ${metrics ? `<div class="metrics">${metrics}</div>` : ''}
      ${d.note ? `<div class="note">ℹ️ ${esc(d.note)}</div>` : ''}
      ${impact}`;
  }

  function renderDealItem(c, p) {
    const d = c.deal;
    return `<div class="deal ${c.resolved ? 'done' : ''}">
      <div class="deal-head"><span class="deal-icon" aria-hidden="true">${esc(c.icon)}</span><div><div class="deal-title">${esc(c.title)}</div><div class="muted small">${esc(c.text)}</div></div></div>
      ${dealBody(d, p)}
      ${c.outcome ? `<div class="ev-outcome">✔ ${esc(c.outcome)}</div>` : `<div class="btn-row">${choiceButtons(Object.assign({}, c, { choices: c.choices.filter((x) => x.id !== 'later') }), p)}</div>${affordHelp(c, p)}`}
      ${c.lesson ? `<div class="lesson">💡 ${esc(c.lesson)}</div>` : ''}
    </div>`;
  }

  function renderCoach(p) {
    const tips = E.coachTips(S, p);
    if (!tips.length) return '';
    return `<div class="card coach"><h3>🧑‍🏫 Money coach <span class="muted small">— tips based on your numbers</span></h3>
      <ul class="tips">${tips.map((t) => `<li><span aria-hidden="true">${t.icon}</span><span>${esc(t.text)}</span></li>`).join('')}</ul></div>`;
  }

  function renderMonth(p, s) {
    if (!S.turn) return '<div class="card"><p class="muted">Waiting for the next turn…</p></div>';
    const events = S.turn.cards.filter((c) => c.kind !== 'deal');
    const deals = S.turn.cards.filter((c) => c.kind === 'deal');
    return `<div class="grid-2">
        <div class="card"><h3>💵 Payday</h3>${renderPaydayLines(S.turn.payday)}</div>
        <div class="card"><h3>📰 Headlines this month</h3>${renderHeadlines()}</div>
      </div>
      <div class="card"><h3>🃏 Events this turn</h3>
        ${events.length ? events.map((c) => renderEventItem(c, p)).join('') : '<p class="muted">No surprises this turn. Enjoy the calm!</p>'}
      </div>
      <div class="card"><h3>🤝 Deals on the table</h3>
        ${deals.length ? deals.map((c) => renderDealItem(c, p)).join('') : '<p class="muted">No deals came your way this turn. Deals show up at random — keep some cash ready for when one does.</p>'}
      </div>
      ${renderCoach(p)}`;
  }

  // ---------------------------------------------------------------- Stocks
  function riskDots(sec) {
    const r = M.riskLevel(sec);
    return `<span class="risk" data-tip="${esc(`${r.label} risk · typical swing about ±${pct(sec.vol * Math.sqrt(12), 0)} a year`)}">${'●'.repeat(r.n)}<span class="dim">${'●'.repeat(5 - r.n)}</span></span>`;
  }

  function renderMarket(p, s) {
    const m = S.market;
    const rows = m.order.map((id) => {
      const sec = m.securities[id];
      const h = p.holdings[id];
      const ch = sec.prevPrice ? sec.price / sec.prevPrice - 1 : 0;
      const yr = M.periodReturn(sec, 12);
      const value = h ? h.shares * sec.price : 0;
      const gain = h ? value - h.costBasis : 0;
      const y = M.currentYield(sec);
      return `<tr>
        <td><button class="sec-link" data-action="stock-detail" data-id="${id}"><span class="sec-icon" aria-hidden="true">${esc(sec.icon)}</span><span><b>${esc(sec.ticker)}</b> <span class="sec-name">${esc(sec.name)}</span><br><span class="muted small">${esc(sec.sector)}</span></span></button></td>
        <td class="num">${money(sec.price, 2)}</td>
        <td class="num ${toneOf(ch)}">${spct(ch)}</td>
        <td class="num ${toneOf(yr)}"><b>${spct(yr)}</b></td>
        <td class="spark-cell">${sparkline(sec.history.slice(-13))}</td>
        <td>${riskDots(sec)}</td>
        <td class="num">${y > 0 ? `${pct(y)}<br><span class="muted small">${money(sec.div, 3)}/sh/mo</span>` : '<span class="muted">—</span>'}</td>
        <td class="num">${h ? `${h.shares.toLocaleString('en-US')} sh<br><span class="small">${money(value)} <span class="${toneOf(gain)}">(${spct(h.costBasis ? gain / h.costBasis : 0, 0)})</span></span>` : '<span class="muted">—</span>'}</td>
        <td class="trade">${S.phase === 'turn' && !p.finished ? `<input type="number" min="1" step="1" inputmode="numeric" class="qty" id="qty-${id}" placeholder="Qty" aria-label="Shares of ${esc(sec.ticker)}">
          <div class="trade-btns"><button class="btn sm primary" data-action="buy" data-id="${id}">Buy</button><button class="btn sm ghost" data-action="max-buy" data-id="${id}" data-tip="Fill in the most you can afford">Max</button>${h ? `<button class="btn sm" data-action="sell" data-id="${id}">Sell</button><button class="btn sm ghost" data-action="max-sell" data-id="${id}" data-tip="Fill in all your shares">All</button>` : ''}</div>` : ''}</td>
      </tr>`;
    }).join('');
    const md = mood(m.fear);
    return `<div class="card">
      <div class="card-head"><h3>📈 Stock market</h3><div class="muted small">Cash: <b>${money(p.cash)}</b> · Stocks: <b>${money(s.stocksValue)}</b> · Dividends: <b>${money(s.dividends)}/mo</b></div></div>
      <p class="muted small">Prices update once a month, after every player has had a turn — so this month's prices are the same for everyone. Click any investment for its full chart and risk statistics. ${md.icon} Market mood is <b>${md.label.toLowerCase()}</b>.</p>
      <div class="table-wrap"><table class="data market">
        <thead><tr><th>Investment</th><th class="num">Price</th><th class="num">1 mo ${tip('Price change since last month.')}</th><th class="num">1 yr ${tip('Price change over the last 12 months — the longer-term trend. (Dividends are paid on top.)')}</th><th>1-year trend</th><th>Risk ${tip('Based on volatility: how much the price typically swings. More dots = bigger swings, both up and down.')}</th><th class="num">Dividend ${tip('Dividend yield: yearly dividends ÷ price. Paid to you every payday as passive income.')}</th><th class="num">You own</th><th>Trade</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
    </div>
    <div class="card learn-inline"><h3>🎓 Reading the market</h3>
      <ul class="tips">
        <li><span>🎢</span><span><b>Volatility differs a lot.</b> The bond fund rarely moves more than a percent or two a month; Kryptonix can move 30%+. Higher volatility means bigger potential gains <em>and</em> losses.</span></li>
        <li><span>🧺</span><span><b>Diversify.</b> One company can crash on bad news, but an index fund of 500 companies rarely moves more than a few percent. Gold and bonds often rise when stocks fall.</span></li>
        <li><span>🔄</span><span><b>The economy matters.</b> In recessions, cyclical stocks (EVs, AI, penny stocks) fall hardest while groceries, healthcare, bonds and gold hold up.</span></li>
        <li><span>🏛️</span><span><b>Interest rates move bonds.</b> When rates rise, bond and REIT prices fall — and their payouts slowly rise.</span></li>
        <li><span>💸</span><span><b>Growth vs. income.</b> Most stocks pay little or no dividend, so they won't help your freedom meter until you sell them and buy income-producing assets.</span></li>
      </ul></div>`;
  }

  function stockDetail(id) {
    const p = C.currentPlayer(S);
    const sec = S.market.securities[id];
    const h = p.holdings[id];
    const hist = sec.history;
    const n = hist.length;
    const values = hist.map((y, i) => ({ x: i - (n - 1), y }));
    const avgCost = h && h.shares ? h.costBasis / h.shares : null;
    const chart = lineChart(`stock-${id}`, [{ name: sec.ticker, color: D.COLORS[0], values }], {
      area: true, label: `${sec.name} price history`, height: 240,
      yFmt: (v) => money(v, v < 10 ? 2 : 0), xFmt: (x) => (x === 0 ? 'now' : `${x} mo`),
      ref: avgCost ? { y: avgCost, label: `your average cost ${money(avgCost, 2)}` } : null
    });
    const vol = M.annualVol(sec);
    const r = M.riskLevel(sec);
    const y = M.currentYield(sec);
    const sigmaM = sec.vol;
    const badYear = Math.exp(sec.drift * 12 - 1.65 * sigmaM * Math.sqrt(12)) - 1;
    const goodYear = Math.exp(sec.drift * 12 + 1.65 * sigmaM * Math.sqrt(12)) - 1;
    const cyc = sec.cyc >= 1.3 ? 'High — a "cyclical" investment: it booms with the economy and suffers in recessions.'
      : sec.cyc >= 0.7 ? 'Average — moves with the overall economy.'
      : sec.cyc >= 0 ? 'Low — a "defensive" investment that holds up relatively well in recessions.'
      : 'Inverse — a "safe haven" that tends to rise when the economy struggles.';
    const stats = [
      ['1-month change', spct(sec.prevPrice ? sec.price / sec.prevPrice - 1 : 0)],
      ['1-year change', spct(M.periodReturn(sec, 12))],
      ['2-year change', spct(M.periodReturn(sec, 24))],
      ['Volatility (last 2 yrs)', `±${pct(vol, 0)}/yr`, 'Annualized standard deviation of monthly returns. Roughly two-thirds of years land within this range of the average.'],
      ['Risk level', `${r.label} (${r.n}/5)`],
      ['Worst drop from a peak', pct(M.maxDrawdown(sec), 0), 'Maximum drawdown: the biggest fall from a high point to a later low in the chart above.'],
      ['Dividend yield', y > 0 ? `${pct(y)} (${money(sec.div, 3)}/share/mo)` : 'None'],
      ['Interest-rate sensitivity', `${sec.rateSens > 0 ? '+' : ''}${sec.rateSens.toFixed(1)}% per +1 pt`, 'How much the price tends to change when interest rates rise one percentage point.']
    ];
    const pos = h ? `<div class="position">You own <b>${h.shares.toLocaleString('en-US')}</b> shares worth <b>${money(h.shares * sec.price)}</b> (cost ${money(h.costBasis)}, ${spct(h.costBasis ? (h.shares * sec.price - h.costBasis) / h.costBasis : 0)}). They pay about <b>${money(h.shares * sec.div)}/mo</b> in dividends.</div>` : '';
    const trade = S.phase === 'turn' && !p.finished ? `<div class="trade-row"><input type="number" min="1" step="1" inputmode="numeric" class="qty" id="qty-${id}" placeholder="Shares" aria-label="Shares">
      <button class="btn primary" data-action="buy" data-id="${id}">Buy</button><button class="btn ghost" data-action="max-buy" data-id="${id}">Max</button>
      ${h ? `<button class="btn" data-action="sell" data-id="${id}">Sell</button><button class="btn ghost" data-action="max-sell" data-id="${id}">All</button>` : ''}
      <span class="muted small">Cash ${money(p.cash)}</span></div>
      <div class="trade-row"><button class="btn ghost sm" data-action="trade-options" data-id="${id}">🎯 Trade options or short ${esc(sec.ticker)}</button></div>` : '';
    return {
      title: `${sec.name} (${sec.ticker})`, icon: sec.icon, wide: true, dismissible: true,
      body: `<p class="muted">${esc(sec.sector)} · ${money(sec.price, 2)} per share</p>
        <p>${esc(sec.desc)}</p>
        ${chart}
        <div class="kv-grid">${stats.map(([l, v, hlp]) => kv(esc(l), esc(v), '', hlp)).join('')}</div>
        <div class="lesson">💡 <b>What a year might look like:</b> with ±${pct(sigmaM * Math.sqrt(12), 0)} volatility, a bad year (1 in 20) could see roughly <b>${spct(badYear, 0)}</b> and a great year <b>${spct(goodYear, 0)}</b>. Sensitivity to the economy: ${esc(cyc)}</div>
        ${pos}${trade}`,
      footer: '<button class="btn" data-action="close-modal">Close</button>'
    };
  }

  // ---------------------------------------------------------------- Options & short selling
  const KIND_LABELS = { call: '📈 Call', put: '📉 Put', straddle: '↕️ Straddle', short: '🔻 Short sell' };
  const KIND_HELP = {
    call: 'The right to BUY 100 shares at the strike price until expiry. Pays off if the price rises above the strike.',
    put: 'The right to SELL 100 shares at the strike price until expiry. Pays off if the price falls below the strike — often used as insurance.',
    straddle: 'A call and a put at the same strike. Pays off if the price makes a big move in EITHER direction; loses if it sits still.',
    short: 'Borrow shares and sell them now, hoping to buy them back cheaper later. Profits if the price falls — but losses are unlimited if it rises.'
  };

  function payoffChart(o, sec, q) {
    const shares = O.CONTRACT; // per contract
    const spread = Math.min(0.8, Math.max(0.3, 2.5 * q.sigma * Math.sqrt(q.T)));
    const lo = Math.max(0.01, sec.price * (1 - spread)), hi = sec.price * (1 + spread);
    const values = [];
    for (let i = 0; i <= 40; i++) {
      const x = lo + (hi - lo) * i / 40;
      values.push({ x, y: (O.intrinsic(o.kind, x, q.strike) - q.ask) * shares });
    }
    return `<div class="muted small">Profit or loss per contract if held to expiry, by ${esc(sec.ticker)}'s price that month (today ${money(sec.price, 2)}):</div>` + lineChart('payoff', [{ name: 'Profit / loss per contract', color: D.COLORS[2], values }], {
      label: 'Profit or loss at expiry by share price', height: 200, area: true,
      yFmt: (v) => compact(v), xFmt: (x) => `${sec.ticker} at ${money(x, x < 10 ? 2 : 0)}`
    });
  }

  function renderOptions(p, s) {
    const canAct = S.phase === 'turn' && !p.finished;
    const o = ui.opt;
    const sec = S.market.securities[o.sec] || S.market.securities.idx;
    const secSelect = `<select data-opt="sec" aria-label="Security">${S.market.order.map((id) => {
      const x = S.market.securities[id];
      return `<option value="${id}" ${id === sec.id ? 'selected' : ''}>${esc(x.icon)} ${esc(x.ticker)} — ${esc(x.name)} · ${money(x.price, 2)}</option>`;
    }).join('')}</select>`;
    const kinds = `<div class="seg-control" role="group" aria-label="Strategy">${Object.keys(KIND_LABELS).map((k) => `<button class="btn sm ${o.kind === k ? 'primary' : 'ghost'}" data-action="opt-kind" data-kind="${k}" aria-pressed="${o.kind === k}" data-tip="${esc(KIND_HELP[k])}">${KIND_LABELS[k]}</button>`).join('')}</div>`;
    let ticket;
    if (o.kind === 'short') {
      const marginPS = sec.price * O.SHORT_MARGIN;
      const callAt = sec.price * (1 + O.SHORT_MARGIN) / O.MAINTENANCE;
      const feePS = sec.price * O.borrowRate(sec) + sec.div;
      ticket = `<p>${esc(KIND_HELP.short)}</p>
        <div class="kv-grid">${kv('Sell price now', money(sec.price, 2))}${kv('Margin deposit', `${money(marginPS, 2)}/share`, '', 'You must set aside 50% of the position\'s value in cash. It is held with the sale proceeds as collateral.')}
          ${kv('Borrow fee + dividends owed', `${money(feePS, 3)}/share/mo`, '', `The lender charges ${pct(O.borrowRate(sec) * 12, 0)}/yr to borrow this stock${sec.div > 0 ? ', and you must pay them the dividends they miss' : ''}.`)}
          ${kv('Margin call if the price reaches', money(callAt, 2), 'neg', `About ${spct(callAt / sec.price - 1, 0)} from here. Your broker would force you to buy back every share at that price.`)}
          ${kv('Most you could short', `${Math.floor(Math.max(0, p.cash) / marginPS).toLocaleString('en-US')} shares`)}</div>
        ${canAct ? `<div class="trade-row"><input type="number" min="1" step="1" inputmode="numeric" class="qty" id="short-qty" placeholder="Shares" aria-label="Shares to short"><button class="btn primary" data-action="short-sell">Short ${esc(sec.ticker)}</button><span class="muted small">Cash ${money(p.cash)}</span></div>` : ''}`;
    } else {
      const strikes = O.strikes(sec);
      const si = Math.min(o.strike, strikes.length - 1);
      const K = strikes[si];
      const q = O.quote(S, sec.id, o.kind, K, o.months);
      const contracts = Math.max(1, Math.floor(Number(o.contracts) || 1));
      const dsc = O.describe(q, contracts);
      const rel = (k) => (Math.abs(k / sec.price - 1) < 0.005 ? 'at the money' : `${spct(k / sec.price - 1, 0)} vs. today`);
      ticket = `<p>${esc(KIND_HELP[o.kind])}</p>
        <div class="opt-row">
          <label class="opt"><span>Strike price ${tip('The price at which the option lets you buy (call) or sell (put) the stock.')}</span><select data-opt="strike">${strikes.map((k, i) => `<option value="${i}" ${i === si ? 'selected' : ''}>${money(k, 2)} (${rel(k)})</option>`).join('')}</select></label>
          <label class="opt"><span>Expires in</span><select data-opt="months">${O.EXPIRIES.map((m) => `<option value="${m}" ${m === o.months ? 'selected' : ''}>${plural(m, 'month')} (month ${S.round + m})</option>`).join('')}</select></label>
          <label class="opt"><span>Contracts ${tip('One contract covers 100 shares.')}</span><input type="number" min="1" step="1" inputmode="numeric" class="qty" id="opt-contracts" data-ask="${q.ask}" data-put-max="${o.kind === 'put' ? Math.max(0, K - q.ask) : ''}" value="${contracts}"></label>
        </div>
        <div class="kv-grid">${kv('Premium per share', money(q.ask, 2), '', `Fair value by the Black–Scholes formula is ${money(q.fair, 2)}/share; you buy at the ask, slightly above it. If you sell early you get the bid, slightly below.`)}${kv('Per contract (100 shares)', money(q.ask * O.CONTRACT))}
          ${kv('Total cost', `<span id="opt-total">${money(dsc.cost)}</span>`, 'strong')}${kv('Break-even at expiry', dsc.breakeven.map((b) => money(b, 2)).join(' or '))}
          ${kv('Most you can lose', `<span id="opt-maxloss">${money(dsc.maxLoss)}</span>`, 'neg')}${kv('Most you can gain', Number.isFinite(dsc.maxGain) ? `<span id="opt-maxgain">${money(dsc.maxGain)}</span>` : 'Unlimited', 'pos')}
          ${kv('Volatility used', `±${pct(q.sigma, 0)}/yr`, '', 'Higher volatility makes options more expensive: a bigger chance of a big move.')}</div>
        <div class="note">ℹ️ ${esc(dsc.story)}</div>
        ${payoffChart(o, sec, q)}
        ${canAct ? `<div class="trade-row"><button class="btn primary" data-action="buy-option" id="opt-buy">Buy ${esc(sec.ticker)} ${KIND_LABELS[o.kind].split(' ')[1].toLowerCase()}s · <span id="opt-buy-cost">${money(dsc.cost)}</span></button><span class="muted small">Cash ${money(p.cash)}</span></div>` : ''}`;
    }

    const optRows = (p.options || []).map((x) => {
      const xs = S.market.securities[x.secId];
      const bid = O.optionBid(S, x);
      const pl = bid - x.cost;
      const left = O.monthsLeft(S, x);
      const intr = O.intrinsic(x.kind, xs.price, x.strike) * x.shares;
      return `<tr><td><b>${esc(O.optionLabel(x))}</b><br><span class="muted small">${x.contracts} contract${x.contracts > 1 ? 's' : ''} · ${x.shares.toLocaleString('en-US')} shares · ${esc(xs.ticker)} now ${money(xs.price, 2)}</span></td>
        <td class="num">${money(x.cost)}</td><td class="num">${money(bid)}</td><td class="num ${toneOf(pl)}"><b>${signed(pl)}</b></td>
        <td class="num">${money(intr)}</td><td>Month ${x.expiresRound}<br><span class="muted small">${plural(left, 'month')} left</span></td>
        <td>${canAct ? `<button class="btn sm" data-action="sell-option" data-id="${x.id}">Sell · ${money(bid)}</button>` : ''}</td></tr>`;
    }).join('');
    const shortPL = Object.keys(p.shorts || {}).reduce((a, id) => a + p.shorts[id].proceeds - p.shorts[id].shares * S.market.securities[id].price, 0);
    const shortRows = Object.keys(p.shorts || {}).map((id) => {
      const sh = p.shorts[id];
      const xs = S.market.securities[id];
      const owe = sh.shares * xs.price;
      const pl = sh.proceeds - owe;
      return `<tr><td><b>${esc(xs.icon)} ${esc(xs.ticker)}</b><br><span class="muted small">${sh.shares.toLocaleString('en-US')} shares short</span></td>
        <td class="num">${money(sh.proceeds / sh.shares, 2)}</td><td class="num">${money(xs.price, 2)}</td><td class="num ${toneOf(pl)}"><b>${signed(pl)}</b></td>
        <td class="num">${money(sh.collateral)}</td><td class="num neg">${money(O.marginCallPrice(sh), 2)}</td>
        <td class="trade">${canAct ? `<input type="number" min="1" step="1" inputmode="numeric" class="qty" id="cover-${id}" placeholder="Qty" aria-label="Shares to buy back">
          <div class="trade-btns"><button class="btn sm primary" data-action="cover" data-id="${id}">Buy back</button><button class="btn sm ghost" data-action="cover-all" data-id="${id}" data-tip="Fill in every share">All</button></div>` : ''}</td></tr>`;
    }).join('');

    return `<div class="card"><div class="card-head"><h3>🎯 Options &amp; short selling</h3><div class="muted small">Cash: <b>${money(p.cash)}</b> · Options: <b>${money(s.optionsValue)}</b> · Shorts P/L: <b class="${toneOf(shortPL)}">${signed(shortPL)}</b></div></div>
        <p class="muted small">Advanced and risky: these let you bet on prices going up, down, or moving a lot — with leverage. None of it is passive income. Options settle automatically at the payday of the month they expire.</p>
        <div class="opt-row">${secSelect}${kinds}</div>
        ${ticket}</div>
      ${optRows ? `<div class="card"><h3>Your options</h3><div class="table-wrap"><table class="data"><thead><tr><th>Contract</th><th class="num">Paid</th><th class="num">Sell now ${tip('What you would get selling today, at the bid price.')}</th><th class="num">Profit / loss</th><th class="num">Intrinsic ${tip('What the option would pay if it expired right now.')}</th><th>Expires</th><th></th></tr></thead><tbody>${optRows}</tbody></table></div></div>` : ''}
      ${shortRows ? `<div class="card"><h3>Your short positions</h3><p class="muted small">Each payday you pay borrow fees and any dividends (${money(-s.shortCarry)}/mo total). If a price climbs to its margin-call level, your broker buys the shares back for you at a loss.</p><div class="table-wrap"><table class="data"><thead><tr><th>Stock</th><th class="num">Sold at</th><th class="num">Price now</th><th class="num">Profit / loss</th><th class="num">Collateral</th><th class="num">Margin call at</th><th>Buy back</th></tr></thead><tbody>${shortRows}</tbody></table></div></div>` : ''}
      <div class="card learn-inline"><h3>🎓 How these work</h3>
        <ul class="tips">
          <li><span>📈</span><span><b>Calls</b> rise in value when the stock rises. For a small premium you control 100 shares — leverage that can multiply your money or lose all of it.</span></li>
          <li><span>📉</span><span><b>Puts</b> rise when the stock falls. Investors buy them as <i>insurance</i> on stocks they own, the way you insure a house.</span></li>
          <li><span>↕️</span><span><b>Straddles</b> (a call + a put) bet on volatility, not direction — popular before earnings seasons (every third month here).</span></li>
          <li><span>⌛</span><span><b>Time decay:</b> an option loses value every month the stock doesn't move. That's why most options bought by small investors expire worthless.</span></li>
          <li><span>🔻</span><span><b>Short selling</b> profits when prices fall, but a stock can rise forever — losses are unlimited, and you pay fees and dividends while you wait.</span></li>
        </ul></div>`;
  }

  // ---------------------------------------------------------------- Portfolio
  function renderPortfolio(p, s) {
    const canAct = S.phase === 'turn' && !p.finished;
    const props = p.properties.map((pr) => {
      const sale = C.propertySale(S, pr);
      const cf = C.propertyCashflow(pr);
      const status = pr.rehabLeft > 0 ? `<span class="badge-pill neutral">🔨 Renovating · ${plural(pr.rehabLeft, 'turn')}</span>` : pr.str ? '<span class="badge-pill neutral">Short-term rental</span>' : '';
      return `<tr><td><b>${esc(pr.icon)} ${esc(pr.name)}</b><br>${status}<span class="muted small">Bought month ${pr.boughtRound} for ${money(pr.purchasePrice)}</span></td>
        <td class="num">${money(sale.value)}${pr.rehabLeft ? '' : `<br><span class="small ${toneOf(sale.value - pr.purchasePrice)}">${spct(sale.value / pr.purchasePrice - 1)} since bought</span>`}</td><td class="num">${pr.mortgage ? money(pr.mortgage.balance) : '—'}</td><td class="num">${money(sale.value - sale.loan)}</td>
        <td class="num">${pr.land ? '—' : money(pr.rehabLeft ? 0 : pr.rent)}</td><td class="num">−${money(pr.rehabLeft ? Math.round(pr.opex * 0.5) : pr.opex)}${pr.mortgage ? `<br><span class="muted small">−${money(pr.mortgage.payment)} mortgage</span>` : ''}</td>
        <td class="num ${toneOf(cf)}"><b>${signed(cf)}</b></td>
        <td>${canAct && !pr.rehabLeft ? `<button class="btn sm" data-action="sell-asset" data-kind="property" data-id="${pr.id}">Sell · net ${money(sale.net)}</button>` : ''}</td></tr>`;
    }).join('');
    const bizs = p.businesses.filter((b) => b.kind !== 'startup').map((b) => {
      const cf = C.businessCashflow(b);
      const sale = C.businessSale(b);
      const status = b.rampLeft > 0 ? `🚧 Launching · ${plural(b.rampLeft, 'turn')}` : `Performance ${Math.round(b.performance * 100)}% ${tip('100% = normal. Business income drifts up and down from month to month.')}`;
      return `<tr><td><b>${esc(b.icon)} ${esc(b.name)}</b><br><span class="muted small">${b.kind === 'side' ? 'Side project' : 'Business'} · risk ${esc(b.risk || '—')}</span></td>
        <td>${status}</td><td class="num">${money(C.businessProfit(b))}</td><td class="num">${b.loan ? `−${money(b.loan.payment)}` : '—'}</td>
        <td class="num ${toneOf(cf)}"><b>${signed(cf)}</b></td><td class="num">${money(sale.value)}</td>
        <td>${canAct ? `<button class="btn sm" data-action="sell-asset" data-kind="business" data-id="${b.id}">Sell · net ${money(sale.net)}</button>` : ''}</td></tr>`;
    }).join('');
    const startups = p.businesses.filter((b) => b.kind === 'startup').map((b) => `<tr><td><b>${esc(b.icon)} ${esc(b.name)}</b></td><td class="num">${money(b.invested)}</td><td>~${plural(Math.max(0, b.monthsLeft), 'turn')}</td>
      <td>${canAct ? `<button class="btn sm" data-action="sell-asset" data-kind="business" data-id="${b.id}" data-tip="Early investors can sometimes sell their stake to someone else — at a steep discount.">Sell stake · ${money(b.invested * 0.5)}</button>` : ''}</td></tr>`).join('');
    const notes = p.notes.map((n) => `<tr><td><b>${esc(n.icon)} ${esc(n.name)}</b></td><td class="num">${money(n.principal)}</td><td class="num">${n.rate.toFixed(1)}%</td><td class="num pos">+${money(C.noteIncome(n))}</td><td>${plural(n.monthsLeft, 'month')}</td>
      <td>${canAct ? `<button class="btn sm" data-action="sell-asset" data-kind="note" data-id="${n.id}">Sell · ${money(n.principal * 0.95)}</button>` : ''}</td></tr>`).join('');
    const coll = p.collectibles.map((c) => `<tr><td><b>${esc(c.icon)} ${esc(c.name)}</b></td><td class="num">${money(c.cost)}</td><td class="num ${toneOf(c.value - c.cost)}">${money(c.value)}</td><td class="num">${c.upkeep ? `−${money(c.upkeep)}` : '—'}</td>
      <td>${canAct ? `<button class="btn sm" data-action="sell-asset" data-kind="collectible" data-id="${c.id}">Auction · ${money(c.value * 0.9)}</button>` : ''}</td></tr>`).join('');
    const empty = !props && !bizs && !startups && !notes && !coll;
    const alloc = allocationBar([
      { label: 'Cash', value: Math.max(0, p.cash), color: ALLOC_COLORS.cash },
      { label: 'Stocks', value: s.stocksValue, color: ALLOC_COLORS.stocks },
      { label: 'Real estate equity', value: s.propValue - s.propDebt, color: ALLOC_COLORS.realestate },
      { label: 'Businesses', value: s.bizValue - s.bizDebt, color: ALLOC_COLORS.business },
      { label: 'Lending notes', value: s.notesValue, color: ALLOC_COLORS.notes },
      { label: 'Collectibles', value: s.collValue, color: ALLOC_COLORS.collect },
      { label: 'Your home (equity)', value: s.home - (p.debts.find((d) => d.type === 'mortgage') || { balance: 0 }).balance, color: ALLOC_COLORS.home },
      { label: 'Options & shorts', value: s.optionsValue + s.shortCollateral - s.shortLiability, color: ALLOC_COLORS.options }
    ]);
    const homeCard = renderHousing(p, s, canAct);
    const table = (title, head, body) => (body ? `<div class="card"><h3>${title}</h3><div class="table-wrap"><table class="data"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div></div>` : '');
    return `<div class="card"><h3>🧭 Where your money is ${tip('Asset allocation: how your wealth is split across types of assets. Spreading it out (diversifying) lowers the risk of one bad event sinking you.')}</h3>
        ${alloc || '<p class="muted">Nothing yet.</p>'}
        <div class="kv-grid">${kv('Passive income', `${money(s.passive)}/mo`, toneOf(s.passive))}${kv('Freedom goal', `${money(s.target)}/mo`)}${kv('Total assets', money(s.assets))}${kv('Total debts', money(s.liabilities))}</div></div>
      ${homeCard}
      ${empty ? '<div class="card"><p class="muted">You don\'t own any real estate, businesses or other investments yet. Deals appear at random at the start of turns — watch the <b>This Month</b> tab. Stocks are always available in the <b>Stocks</b> tab.</p></div>' : ''}
      ${table('🏘️ Real estate', ['Property', 'Value', 'Mortgage', 'Equity ' + tip('Value minus what you still owe — the part you actually own.'), 'Rent', 'Expenses', 'Cashflow', ''], props)}
      ${table('🏪 Businesses & side projects', ['Business', 'Status', 'Profit', 'Loan', 'Cashflow', 'Value ' + tip('Roughly 2.5 years of profit for businesses (1.5 for side projects).'), ''], bizs)}
      ${table('🚀 Startup investments', ['Company', 'Invested', 'Outcome in', ''], startups)}
      ${table('📜 Lending notes', ['Note', 'Principal', 'Rate', 'Interest', 'Matures in', ''], notes)}
      ${table('💎 Collectibles', ['Item', 'Paid', 'Est. value', 'Upkeep', ''], coll)}`;
  }

  // ---------------------------------------------------------------- Housing (the home you live in)
  function renderHousing(p, s, canAct) {
    const mort = C.homeMortgage(p);
    const listings = (S.turn && S.turn.playerId === p.id && S.turn.homes) || [];
    let top;
    if (p.home) {
      const sale = C.homeSale(S, p);
      const change = s.home - p.home.purchasePrice;
      const rent = Deals.rentFor(s.home);
      top = `<p><b>${esc(p.home.name || 'Your home')}</b> — you own it${p.home.boughtRound ? ` (bought in month ${p.home.boughtRound})` : ''}.</p>
        <div class="kv-grid">${kv('Estimated value', money(s.home))}${kv(p.home.boughtRound ? 'Change since you bought it' : 'Change since the game began', `${signed(change)} (${spct(change / p.home.purchasePrice)})`, toneOf(change), 'Your home moves with the regional housing market and with its own neighborhood. It is only a real gain once you sell.')}
        ${kv('Mortgage owed', mort ? money(mort.balance) : '$0 — paid off!')}${kv('Your equity', money(s.home - (mort ? mort.balance : 0)), '', 'Value minus the mortgage: the part of the house you actually own.')}
        ${kv('Monthly cost', `${money((mort ? mort.payment : 0) + p.expenses.housing)}/mo`, '', 'Mortgage payment plus property taxes, insurance and upkeep.')}${kv('If you sold today', `${money(sale.net)} after 6% costs${mort ? ' & the mortgage' : ''}`)}</div>
        ${canAct ? `<div class="btn-row"><button class="btn sm" data-action="sell-home" data-rent="similar" ${sale.net < 0 && p.cash < -sale.net ? 'disabled data-tip="Your home is underwater and you can\'t cover the difference"' : ''}>Sell &amp; rent a similar place (~${money(rent)}/mo)</button>
          <button class="btn sm ghost" data-action="sell-home" data-rent="smaller" ${sale.net < 0 && p.cash < -sale.net ? 'disabled' : ''}>Sell &amp; rent smaller (~${money(rent * 0.7)}/mo)</button></div>` : ''}`;
    } else {
      top = `<p>You rent your home for <b>${money(p.expenses.housing)}/mo</b>${C.isMarried(p) ? ' (split with your spouse)' : ''}. Renting is flexible and has no upkeep surprises, but rent tends to rise and builds no equity.</p>`;
    }
    const rows = listings.map((h) => {
      const opts = Deals.DOWN_OPTIONS.map((dp) => {
        const t = Deals.homePurchaseTerms(S, p, h, dp);
        return `<button class="btn sm ${dp === 0.2 ? 'primary' : 'ghost'}" data-action="buy-home" data-id="${h.id}" data-down="${dp}" ${!canAct || t.reason ? `disabled data-tip="${esc(t.reason || 'Not your turn')}"` : `data-tip="${esc(`${money(t.loan)} mortgage at ${t.rate.toFixed(3)}%. DTI after: ${Math.round(t.dti * 100)}%`)}"`}>${pct(dp, 0)} down: ${money(t.down + t.closing)} now · ${money(t.monthly)}/mo</button>`;
      }).join('');
      return `<tr><td><b>${esc(h.name)}</b><br><span class="muted small">${{ starter: 'Starter home', similar: 'Similar to now', upgrade: 'Upgrade' }[h.tier]} · taxes &amp; upkeep ${money(h.ownerCosts)}/mo</span></td>
        <td class="num">${money(h.price)}</td><td><div class="btn-row">${opts}</div></td></tr>`;
    }).join('');
    return `<div class="card"><h3>🏡 Where you live</h3>${top}
      ${rows ? `<h4>Homes for sale this month ${tip('New listings appear every turn. The price includes 3% closing costs on top of the down payment. Smaller down payments come with a higher interest rate.')}</h4>
        ${p.home ? '<p class="muted small">Buying another home sells your current one first — the money from the sale goes toward the new down payment.</p>' : ''}
        <div class="table-wrap"><table class="data"><thead><tr><th>Home</th><th class="num">Price</th><th>Cash now · monthly cost (mortgage + taxes &amp; upkeep)</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
      <div class="lesson">💡 <b>Rent vs. buy.</b> Your home counts toward net worth, but it isn't passive income — it costs you every month. Owning builds equity and locks in your payment; renting keeps cash free to invest and lets you move cheaply. Banks usually cap all debt payments at ${pct(Deals.MAX_DTI, 0)} of income ("debt-to-income").</div></div>`;
  }

  // ---------------------------------------------------------------- Debt & budget
  function renderDebt(p, s) {
    const canAct = S.phase === 'turn' && !p.finished;
    const debts = p.debts.slice().sort((a, b) => b.apr - a.apr).map((d) => {
      const months = C.monthsToPayoff(d.balance, d.apr, d.payment);
      const left = E.interestLeft(d.balance, d.apr, d.payment);
      return `<tr><td><b>${esc(D.DEBT_TYPES[d.type] ? D.DEBT_TYPES[d.type].icon : '💳')} ${esc(d.name)}</b>${d.revolving ? `<br><span class="muted small">Minimum payment = 3% of balance</span>` : ''}</td>
        <td class="num">${money(d.balance)}</td><td class="num ${d.apr >= 15 ? 'neg' : ''}">${d.apr.toFixed(2)}%</td><td class="num">${money(d.payment)}</td>
        <td class="num">${money(d.balance * d.apr / 1200)}</td>
        <td>${Number.isFinite(months) ? `${plural(months, 'month')}<br><span class="muted small">${money(left)} interest to go</span>` : 'Never at this rate'}</td>
        <td class="trade">${canAct ? `<input type="number" min="1" step="1" class="qty" id="pay-${d.id}" placeholder="$" aria-label="Amount to pay">
          <div class="trade-btns"><button class="btn sm" data-action="pay-debt" data-id="${d.id}">Pay</button><button class="btn sm primary" data-action="payoff-debt" data-id="${d.id}" ${p.cash < d.balance ? 'disabled data-tip="Not enough cash to pay it all"' : ''}>Pay off ${money(d.balance)}</button></div>` : ''}</td></tr>`;
    }).join('');
    const loans = [
      ...p.properties.filter((x) => x.mortgage).map((x) => ({ kind: 'property', id: x.id, name: `${x.icon} ${x.name}`, loan: x.mortgage })),
      ...p.businesses.filter((x) => x.loan).map((x) => ({ kind: 'business', id: x.id, name: `${x.icon} ${x.name}`, loan: x.loan }))
    ].map((l) => {
      const months = C.monthsToPayoff(l.loan.balance, l.loan.apr, l.loan.payment);
      return `<tr><td><b>${esc(l.name)}</b></td><td class="num">${money(l.loan.balance)}</td><td class="num">${l.loan.apr.toFixed(2)}%</td><td class="num">${money(l.loan.payment)}</td>
        <td>${Number.isFinite(months) ? plural(months, 'month') : '—'}</td>
        <td class="trade">${canAct ? `<input type="number" min="1" step="1" class="qty" id="pay-${l.id}" placeholder="$" aria-label="Amount to pay">
          <div class="trade-btns"><button class="btn sm" data-action="pay-asset" data-kind="${l.kind}" data-id="${l.id}">Pay</button><button class="btn sm primary" data-action="payoff-asset" data-kind="${l.kind}" data-id="${l.id}" ${p.cash < l.loan.balance ? 'disabled data-tip="Not enough cash to pay it all"' : ''}>Pay off</button></div>` : ''}</td></tr>`;
    }).join('');
    const limit = C.loanLimit(S, p);
    const rate = C.bankRate(S);
    const ds = E.downshiftInfo(S, p);
    const life = C.lifestyleOf(p);
    return `<div class="card"><h3>💳 Personal debts</h3>
        ${debts ? `<div class="table-wrap"><table class="data"><thead><tr><th>Debt</th><th class="num">Balance</th><th class="num">APR ${tip('Annual percentage rate: the yearly interest charged on the balance.')}</th><th class="num">Payment</th><th class="num">Interest this month</th><th>Paid off in</th><th>Pay down</th></tr></thead><tbody>${debts}</tbody></table></div>
        <p class="muted small">Total owed: <b>${money(s.debtBalance)}</b> · Monthly payments: <b>${money(s.debt)}</b>. Every dollar of payments you eliminate lowers your freedom target by ${money(mult())}.</p>
        <div class="lesson">💡 <b>Two ways to pay off debt.</b> The <i>avalanche</i> method pays the highest interest rate first (sorted above) and saves the most money. The <i>snowball</i> method pays the smallest balance first for quick wins — and here, each loan paid off immediately frees up its whole monthly payment. Extra payments on fixed loans don't lower the monthly payment; they finish the loan sooner and save interest.</div>`
        : '<p>🎉 You have no personal debt. Your money is all yours!</p>'}
      </div>
      ${loans ? `<div class="card"><h3>🏘️ Investment loans</h3><p class="muted small">Mortgages and loans on your investments. Their payments are already subtracted from each asset's cashflow — paying one off turns that payment into extra passive income.</p>
        <div class="table-wrap"><table class="data"><thead><tr><th>Asset</th><th class="num">Balance</th><th class="num">APR</th><th class="num">Payment</th><th>Paid off in</th><th>Pay down</th></tr></thead><tbody>${loans}</tbody></table></div></div>` : ''}
      <div class="card"><h3>🏦 The bank</h3>
        <p>Bank loans cost <b>${rate.toFixed(2)}% APR</b> (the central bank rate + 6.5%) and are repaid over 5 years. The bank will lend you up to <b>${money(limit)}</b> — it makes sure the new payment fits within 60% of your monthly cashflow.</p>
        ${canAct ? `<div class="trade-row"><input type="number" min="1000" step="1000" class="qty wide" id="borrow-amt" placeholder="Amount (multiples of $1,000)" aria-label="Amount to borrow"><button class="btn primary" data-action="borrow" ${limit < 1000 ? 'disabled' : ''}>Borrow</button></div>` : ''}
        <div class="lesson">💡 Borrowing raises your monthly expenses, which raises your freedom target. It only makes sense if what you buy pays you more each month than the loan costs — that's "good debt".</div>
      </div>
      <div class="card"><h3>🏡 Lifestyle & budget</h3>
        <p>You live a <b>${life.icon} ${life.name}</b> lifestyle: ${esc(life.desc)} Living expenses are <b>${money(s.living)}</b>/mo${s.children ? ` plus ${money(s.children)}/mo for your children` : ''}.</p>
        <div class="kv-grid">${D.EXPENSES.map((cat) => kv(esc(cat.id === 'housing' ? (p.ownsHome ? 'Housing (taxes, insurance, upkeep)' : 'Housing (rent)') : cat.label), money(p.expenses[cat.id]))).join('')}</div>
        ${p.lifestyle > 0 ? `<p>Downshift to a <b>${ds.next.icon} ${ds.next.name}</b> lifestyle: a one-time moving cost of <b>${money(ds.cost)}</b>, then <b>${money(ds.savings)}/mo</b> lower expenses — and a <b>${money(ds.savings * mult())}/mo</b> lower freedom target.</p>
          ${canAct ? `<button class="btn" data-action="downshift" ${ds.reason ? `disabled data-tip="${esc(ds.reason)}"` : ''}>Downshift lifestyle</button>` : ''}` : '<p class="muted">You\'re already living as frugally as possible.</p>'}
      </div>
      ${renderFamilyNetwork(p, s, canAct)}`;
  }

  function renderFamilyNetwork(p, s, canAct) {
    const r = p.relationship;
    const net = p.network;
    let rel;
    if (r.status === 'dating') rel = `You're dating <b>${esc(r.partner.emoji)} ${esc(r.partner.name)}</b> (since month ${r.since}). Dates cost about <b>${money(r.datingCost)}/mo</b>. After a while together, you may get the chance to marry.`;
    else if (r.status === 'married') rel = `You're married to <b>${esc(r.partner.emoji)} ${esc(r.partner.name)}</b> (since month ${r.since}). ${esc(r.partner.name)} pays half the household bills${C.homeMortgage(p) ? ' (including the mortgage)' : ''} — <b>${money(s.partner)}/mo</b>${p.children ? ` — and half of the children's costs` : ''}.`;
    else rel = `You're single${r.divorces ? ' (divorced)' : ''}. You might meet someone at any time.`;
    const level = C.networkLevel(p);
    const parts = [];
    if (net.club) parts.push(`a member of the <b>${esc(net.club.name)}</b> (${money(net.club.dues)}/mo)`);
    if (net.conferenceTurns > 0) parts.push(`riding <b>${plural(net.conferenceTurns, 'more turn')}</b> of conference contacts`);
    const netText = level
      ? `You're ${parts.join(' and ')}. Networking level <b>${level}/2</b>: raises are ${pct(0.5 * level, 0)} more likely, promotions ${pct(0.4 * level, 0)} more likely, side gigs come more often, and a layoff would last at most ${plural(MMS.Events.maxJobSearch(p), 'month')} (instead of 6).`
      : 'No networking right now. Conference and club invitations show up at random while you have a job.';
    return `<div class="card"><h3>💞 Family &amp; network</h3>
      <p>${rel}</p>${p.children ? `<p>👶 ${p.children} ${p.children === 1 ? 'child' : 'children'} — ${money(s.children)}/mo${p.childShare < 1 ? ' (your half)' : ''}.</p>` : ''}
      <p>${netText}</p>
      ${net.club && canAct ? `<button class="btn sm" data-action="cancel-club">Cancel club membership (save ${money(net.club.dues)}/mo)</button>` : ''}
      <div class="lesson">💡 Life choices are money choices: dating, a wedding and children all raise your expenses — while a spouse who shares the bills lowers them. Networking costs money up front but can raise your pay for years.</div></div>`;
  }

  // ---------------------------------------------------------------- Standings
  function renderStandings() {
    const rows = E.standings(S).map(({ p, s }, i) => `<tr class="${p.id === viewPlayer().id ? 'cur' : ''}">
      <td>${p.place ? `🏆 ${p.place}` : i + 1}</td>
      <td><span class="dot" style="background:${p.color}"></span> ${esc(p.emoji)} <b>${esc(p.name)}</b>${botTag(p)}<br><span class="muted small">${esc(C.jobTitle(p))}</span></td>
      <td class="num">${money(p.cash)}</td><td class="num">${money(s.netWorth)}</td><td class="num">${money(s.passive)}</td><td class="num">${money(s.target)}</td>
      <td><div class="mini-meter wide" style="--pc:${p.color}"><div style="width:${Math.min(100, s.progress * 100).toFixed(1)}%"></div></div><span class="small">${pct(s.progress, 0)}</span></td></tr>`).join('');
    const metrics = { netWorth: ['Net worth', (v) => compact(v)], passive: ['Passive income / mo', (v) => compact(v)], progress: ['Freedom meter', (v) => pct(v, 0)] };
    const [mlabel, mfmt] = metrics[ui.chartMetric];
    const series = S.players.map((p) => {
      const pts = p.history.map((h) => ({ x: h.round, y: h[ui.chartMetric] }));
      const live = C.summarize(S, p);
      const lastRound = pts.length ? pts[pts.length - 1].x : -1;
      if (lastRound < S.round && !p.finished) pts.push({ x: S.round, y: ui.chartMetric === 'netWorth' ? live.netWorth : ui.chartMetric === 'passive' ? live.passive : live.progress });
      return { name: p.name, color: p.color, values: pts };
    });
    return `<div class="card"><h3>🏆 Standings</h3>
        <div class="table-wrap"><table class="data"><thead><tr><th>#</th><th>Player</th><th class="num">Cash</th><th class="num">Net worth</th><th class="num">Passive/mo</th><th class="num">Goal/mo</th><th>Freedom</th></tr></thead><tbody>${rows}</tbody></table></div></div>
      <div class="card"><div class="card-head"><h3>📉 Progress over time</h3>
        <div class="seg-control" role="group" aria-label="Chart metric">${Object.entries(metrics).map(([k, [l]]) => `<button class="btn sm ${ui.chartMetric === k ? 'primary' : 'ghost'}" data-action="chart-metric" data-metric="${k}" aria-pressed="${ui.chartMetric === k}">${l}</button>`).join('')}</div></div>
        ${lineChart('standings', series, { label: `${mlabel} by month`, yFmt: mfmt, xFmt: (x) => `Month ${x}`, zero: true })}
      </div>`;
  }

  // ---------------------------------------------------------------- Learn
  function corrOf(a, b) {
    const n = Math.min(a.history.length, b.history.length, 25);
    const ra = [], rb = [];
    for (let i = a.history.length - n + 1, j = b.history.length - n + 1; i < a.history.length; i++, j++) {
      ra.push(Math.log(a.history[i] / a.history[i - 1]));
      rb.push(Math.log(b.history[j] / b.history[j - 1]));
    }
    const ma = ra.reduce((x, y) => x + y, 0) / ra.length, mb = rb.reduce((x, y) => x + y, 0) / rb.length;
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < ra.length; i++) { sab += (ra[i] - ma) * (rb[i] - mb); saa += (ra[i] - ma) ** 2; sbb += (rb[i] - mb) ** 2; }
    return sab / Math.sqrt(saa * sbb || 1);
  }

  function renderLearn(p, s) {
    const sec = S.market.securities;
    const worst = p.debts.slice().sort((a, b) => b.apr - a.apr)[0];
    const monthly = Math.max(100, Math.round(s.cashflow / 50) * 50);
    const fv = (years) => { const r = 0.1 / 12, n = years * 12; return monthly * ((Math.pow(1 + r, n) - 1) / r); };
    const months = s.expenses > 0 ? p.cash / s.expenses : 0;
    const ec = econInfo();
    const corr = corrOf(sec.aurm, sec.idx);
    const keyrYield = M.currentYield(sec.keyr);
    const topics = [
      ['🏁', 'Financial freedom', 'You are financially free when <b>passive income</b> — money that arrives whether or not you work — covers your expenses. This game asks for a safety margin of ' + fmtMult(mult()) + ' your expenses.',
        `Your passive income is ${money(s.passive)}/mo. Your goal is ${money(s.target)}/mo (${fmtMult(mult())} × ${money(s.expenses)} of expenses).`],
      ['💵', 'Cashflow', 'Income minus expenses each month. Positive cashflow is the fuel you invest; negative cashflow drains your savings.', `Your monthly cashflow is ${signed(s.cashflow)}.`],
      ['⚖️', 'Assets vs. liabilities', 'An asset puts money in your pocket every month (rentals, dividend stocks, businesses). A liability takes money out (car loans, credit cards, a boat). Wealth comes from buying assets, not liabilities.', `You own ${money(s.assets)} of assets and owe ${money(s.liabilities)}.`],
      ['❄️', 'Compound growth', 'When investment income is reinvested, it earns income of its own — a snowball. <b>Rule of 72:</b> divide 72 by your yearly return to see how many years your money takes to double (72 ÷ 8% = 9 years).', `Investing ${money(monthly)} a month at 10% a year grows to about ${money(fv(10))} in 10 years and ${money(fv(20))} in 20.`],
      ['💳', 'Interest & APR', 'APR is the yearly interest rate on a debt. Credit cards (20–28%) are some of the most expensive money you can borrow. Paying off a 25% card is like earning a guaranteed 25% return.', worst ? `Your most expensive debt is your ${worst.name} at ${worst.apr.toFixed(1)}% — about ${money(worst.balance * worst.apr / 1200)} of interest this month alone.` : 'You have no personal debt — nice!'],
      ['🏗️', 'Good debt vs. bad debt', '"Good" debt buys something that earns more than the debt costs — like a rental whose rent covers its mortgage with money left over. "Bad" debt buys things that lose value, like vacations and gadgets on a credit card.', `So far you've paid ${money(p.stats.interestPaid)} of interest on personal debts this game.`],
      ['🏠', 'Leverage', 'Using borrowed money to control a bigger asset. Put 10% down on a property and a 10% rise in its value doubles your money — but a 10% fall wipes it out. Leverage magnifies both directions.', ''],
      ['📐', 'Judging a deal', '<b>Cash-on-cash return</b> = yearly cashflow ÷ cash invested. <b>Cap rate</b> = yearly (rent − expenses) ÷ price. <b>1% rule:</b> monthly rent should be ≥ 1% of the price. <b>Payback period</b> = months to earn your cash back.', 'Every deal shows these numbers — hover the ? icons for explanations.'],
      ['🎢', 'Volatility & risk', 'Volatility measures how much a price swings. Investments with higher expected returns usually come with bigger swings; you are paid for taking risk, not guaranteed.', `Over the last two years: ${sec.tbnd.name} ±${pct(M.annualVol(sec.tbnd), 0)}/yr, ${sec.idx.name} ±${pct(M.annualVol(sec.idx), 0)}/yr, ${sec.kryx.name} ±${pct(M.annualVol(sec.kryx), 0)}/yr.`],
      ['🧺', 'Diversification', 'Owning many different investments so no single disaster can sink you. Combining assets that don\'t move together smooths out the ride.', `Over the last two years, gold's monthly moves had a correlation of ${corr.toFixed(2)} with the index fund (1 = always together, 0 = unrelated, −1 = opposite).`],
      ['🗽', 'Index funds', 'An index fund owns a slice of hundreds of companies at once with very low fees. Over long periods, most professional stock-pickers fail to beat a simple index fund.', ''],
      ['💸', 'Dividends & yield', 'Dividends are profits a company pays its shareholders. Yield = yearly dividends ÷ price. Healthy companies raise dividends over time, so your income grows even if you never buy another share.', `${sec.keyr.name} yields ${pct(keyrYield)}: every $10,000 invested pays about ${money(10000 * keyrYield / 12)}/mo.`],
      ['🏛️', 'Interest rates & bonds', 'When interest rates rise, older bonds paying lower rates lose value. A bond fund with a "duration" of 6 falls about 6% for every 1-point rise in rates — but its future payouts rise.', `The central bank rate is ${S.market.rate.toFixed(2)}%; a typical 30-year mortgage costs about ${M.baseMortgageRate(S).toFixed(2)}%.`],
      ['🛟', 'Emergency fund', 'Keep 3–6 months of expenses in cash. It turns a layoff or a surprise bill into an inconvenience instead of a credit-card disaster.', `You have ${months.toFixed(1)} months of expenses in cash.`],
      ['📈', 'Lifestyle creep', 'As income rises, spending tends to rise with it — which is why some people with big salaries are still broke. Keeping expenses steady while income grows is a superpower.', `You've spent ${money(p.stats.luxurySpent)} on luxuries this game. Each $100/mo you cut lowers your freedom target by ${money(100 * mult())}/mo.`],
      ['🔄', 'Economic cycles', 'Economies alternate between expansions and recessions. Recessions bring layoffs and falling prices — but also bargains for people with cash ready.', `Right now the economy is ${ec.label.toLowerCase()}: ${ec.desc}`],
      ['🎯', 'Options', 'An option is a contract: a <b>call</b> gives the right to buy 100 shares at a set "strike" price before it expires; a <b>put</b> gives the right to sell. A small premium controls a lot of stock, so options are leverage. Their price depends on the stock price, the strike, the time left and — most of all — volatility (the Black–Scholes formula).', `A 3-month at-the-money call on ${sec.idx.name} costs about ${money(O.quote(S, 'idx', 'call', O.strikes(sec.idx)[2], 3).ask * 100)} per contract right now.`],
      ['🔻', 'Short selling', 'Shorting means borrowing shares, selling them, and buying them back later — profiting if the price falls. Because a price can rise without limit, so can a short seller\'s losses. Brokers demand collateral and issue margin calls when a short goes against you.', ''],
      ['🏡', 'Rent vs. buy', 'Owning builds equity and fixes your payment, but costs a down payment, closing costs, upkeep and 6% to sell. Renting is flexible and keeps cash free to invest. Neither is always better — compare the monthly cost AND what your cash could earn elsewhere.', p.home ? `Your home is worth about ${money(s.home)}; renting a similar place would cost about ${money(Deals.rentFor(s.home))}/mo.` : `You rent for ${money(p.expenses.housing)}/mo.`],
      ['💼', 'Your earning power', 'Your salary is often your biggest asset early on. Small raises compound over a career, and networking, skills and relationships ("human capital") are investments that can pay off for decades.', `You've had ${plural(p.stats.promotions, 'promotion')} and ${plural(p.stats.raises || 0, 'raise')} this game.`],
      ['💞', 'Money & relationships', 'Couples who share a household split rent, utilities and groceries — a big financial advantage. But weddings, children and especially divorce are some of life\'s biggest expenses, and money stress is a leading cause of breakups. Talk about money early.', p.relationship.status === 'married' ? `Your spouse covers ${money(s.partner)}/mo of household bills.` : ''],
      ['🎰', 'Speculation vs. investing', 'Investing means buying something for the income or value it produces. Speculating means betting on a price move — crypto, penny stocks, hot tips. Speculation can pay off, but it isn\'t a plan.', '']
    ];
    return `<div class="card"><h3>🎓 Money lessons</h3><p class="muted">The ideas behind the game, with your own numbers plugged in.</p></div>
      <div class="learn-grid">${topics.map(([icon, title, body, you]) => `<div class="card learn-card"><h4>${icon} ${title}</h4><p>${body}</p>${you ? `<p class="you">👉 ${esc(you)}</p>` : ''}</div>`).join('')}</div>`;
  }

  // ---------------------------------------------------------------- Log
  function renderLog() {
    const cur = C.currentPlayer(S);
    const entries = S.log.slice().reverse().filter((l) => ui.logFilter === 'all' || (ui.logFilter === 'me' ? l.pid === cur.id : !l.pid));
    const who = (pid) => { const p = pid && C.getPlayer(S, pid); return p ? `<span class="dot" style="background:${p.color}"></span>${esc(p.emoji)}` : '📰'; };
    const f = (id, label) => `<button class="btn sm ${ui.logFilter === id ? 'primary' : 'ghost'}" data-action="log-filter" data-filter="${id}" aria-pressed="${ui.logFilter === id}">${label}</button>`;
    return `<div class="card"><div class="card-head"><h3>📜 Game log</h3><div class="seg-control">${f('all', 'Everything')}${f('me', esc(cur.name))}${f('news', 'Market news')}</div></div>
      <ul class="log">${entries.slice(0, 250).map((l) => `<li class="tone-${l.tone}"><span class="log-month">M${l.round}</span><span class="log-who">${who(l.pid)}</span><span>${esc(l.text)}</span></li>`).join('') || '<li class="muted">Nothing yet.</li>'}</ul></div>`;
  }

  // ================================================================ modals
  function shell(m) {
    return `<div class="backdrop ${m.dismissible ? 'dismissible' : ''} ${m.overlay || ''}" data-backdrop>
      <div class="modal ${m.wide ? 'wide' : ''} tone-${m.tone || 'neutral'}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        ${m.dismissible ? '<button class="modal-x" data-action="close-modal" aria-label="Close">✕</button>' : ''}
        <div class="modal-head">${m.icon ? `<div class="modal-icon" aria-hidden="true">${esc(m.icon)}</div>` : ''}<h2 id="modal-title">${esc(m.title)}</h2></div>
        <div class="modal-body">${m.body}</div>
        ${m.footer ? `<div class="modal-foot">${m.footer}</div>` : ''}
      </div></div>`;
  }

  function cardModal(c) {
    const p = C.currentPlayer(S);
    const okLabel = c.tone === 'good' ? 'Nice!' : c.tone === 'bad' ? 'Ugh. OK' : 'OK';
    let footer;
    if (c.type === 'info') footer = `<button class="btn primary" data-action="choose" data-card="${c.id}" data-choice="ok">${okLabel}</button>`;
    else footer = choiceButtons(c, p).replace(/ sm"/g, '"');
    let body = `<p class="lead">${esc(c.text)}</p>`;
    if (c.kind === 'deal') body += dealBody(c.deal, p) + affordHelp(c, p);
    if (c.type === 'expense') body += `<div class="note">You have ${money(p.cash)} in cash.${p.cash < c.data.cost ? ' Not enough — it will have to go on a credit card.' : ''}</div>`;
    if (c.lesson) body += `<div class="lesson">💡 ${esc(c.lesson)}</div>`;
    const kindLabel = c.kind === 'deal' ? '🤝 Deal opportunity' : c.type === 'expense' ? 'Unavoidable expense' : c.required ? 'You must decide' : '';
    return {
      title: c.title, icon: c.icon, tone: c.tone, wide: c.kind === 'deal',
      dismissible: !c.required,
      body: (kindLabel ? `<div class="eyebrow">${kindLabel}</div>` : '') + body,
      footer
    };
  }

  function paydayModal() {
    const pd = S.turn.payday;
    const p = C.currentPlayer(S);
    return {
      title: `Payday — Month ${S.round}`, icon: '💵', tone: pd.net >= 0 ? 'good' : 'bad', dismissible: false,
      body: `<p class="muted">${esc(p.emoji)} ${esc(p.name)} · cash ${money(pd.before)} → <b>${money(pd.after)}</b></p>${renderPaydayLines(pd)}${renderBotRecap()}`,
      footer: '<button class="btn primary" data-action="payday-ok">Continue</button>'
    };
  }

  /** What the computer opponents did since this person's last turn. */
  function renderBotRecap() {
    const me = C.currentPlayer(S).id;
    const list = ui.botRecap.filter((r) => r.seq > (ui.recapSeen[me] || 0));
    if (!list.length) return '';
    const shown = list.slice(-8);
    const items = shown.map((r) => {
      const p = C.getPlayer(S, r.playerId);
      if (!p) return '';
      const lines = r.items.slice(0, 6).map((it) => `<li class="tone-${esc(it.tone || 'neutral')}">${esc(it.text.length > 140 ? `${it.text.slice(0, 137)}…` : it.text)}</li>`).join('');
      const more = r.items.length > 6 ? `<li class="muted">…and ${r.items.length - 6} more</li>` : '';
      const status = r.won ? '🏆 reached financial freedom!' : `${pct(Math.min(9.99, r.progress || 0), 0)} free · ${compact(r.netWorth || 0)} net worth`;
      return `<div class="recap" style="--pc:${p.color}"><div class="recap-head">${esc(p.emoji)} <b>${esc(p.name)}</b> 🤖 <span class="muted small">Month ${r.round} · payday ${signed(r.net)} · ${status}</span></div>
        ${lines || more ? `<ul>${lines}${more}</ul>` : '<div class="muted small">A quiet month — no big moves.</div>'}</div>`;
    }).join('');
    return `<h3 class="recap-title">🤖 Your rivals' turns</h3>${list.length > shown.length ? `<p class="muted small">Showing the last ${shown.length} of ${list.length} turns.</p>` : ''}${items}`;
  }

  function handoffScreen() {
    const p = C.currentPlayer(S);
    const s = C.summarize(S, p);
    const news = (S.news || []).slice(0, 4);
    return `<div class="handoff" style="--pc:${p.color}">
      <div class="handoff-card">
        <div class="eyebrow">Month ${S.round}${S.settings.timeLimit ? ` of ${S.settings.timeLimit}` : ''}</div>
        <div class="avatar-xl">${esc(p.emoji)}</div>
        <h2>${esc(p.name)}'s turn</h2>
        <p>Pass the device to <b>${esc(p.name)}</b>.</p>
        <div class="handoff-stats"><span>Freedom <b>${pct(s.progress, 0)}</b></span><span>Cash <b>${money(p.cash)}</b></span><span>Net worth <b>${money(s.netWorth)}</b></span></div>
        ${news.length ? `<div class="handoff-news"><div class="muted small">This month's headlines</div><ul>${news.map((n) => `<li class="tone-${n.tone}">${esc(n.text)}</li>`).join('')}</ul></div>` : ''}
        <button class="btn primary big" data-action="start-turn">I'm ${esc(p.name)} — start my turn ▶</button>
        <button class="btn ghost sm" data-action="open-menu">☰ Menu</button>
      </div></div>`;
  }

  function introModal() {
    const cards = S.players.map((p) => {
      const s = C.summarize(S, p);
      const life = C.lifestyleOf(p);
      return `<div class="intro-card" style="--pc:${p.color}">
        <div class="intro-head"><span class="avatar-lg">${esc(p.emoji)}</span><div><b>${esc(p.name)}</b>${botTag(p)}<div class="muted small">${esc(p.job.icon)} ${esc(p.job.title)} · ${life.icon} ${life.name}</div></div></div>
        ${kv('Salary', `${money(p.job.salary)}/mo`)}${kv('Living expenses', `${money(s.living + s.children)}/mo`)}${kv('Debt payments', `${money(s.debt)}/mo`)}
        ${kv('Cashflow', signed(s.cashflow), toneOf(s.cashflow))}${kv('Starting cash', money(p.cash))}${kv('Total debt', money(s.debtBalance))}
        <div class="small muted">${p.debts.map((d) => `${esc(d.name)} ${money(d.balance)} @ ${d.apr.toFixed(1)}%`).join(' · ') || 'No debts'}</div>
        <div class="intro-goal">🎯 Freedom goal: <b>${money(s.target)}/mo</b> passive</div></div>`;
    }).join('');
    return {
      title: S.players.length > 1 ? 'Meet the players' : 'Your starting life', icon: '🎲', wide: true, dismissible: false,
      body: `<p>Jobs, lifestyles, savings and debts were dealt at random. Everyone is chasing the same thing: <b>passive income of ${fmtMult(mult())} their monthly expenses</b>. Bigger salaries usually come with bigger expenses — and bigger goals.</p><div class="intro-grid">${cards}</div>`,
      footer: '<button class="btn primary big" data-action="intro-ok">Let\'s play ▶</button>'
    };
  }

  function winModal() {
    const p = C.getPlayer(S, S.pendingWin);
    const s = C.summarize(S, p);
    return {
      title: 'Financial freedom!', icon: '🎉', tone: 'good', dismissible: false, overlay: 'confetti-host',
      body: `${confetti()}<p class="lead">${esc(p.emoji)} <b>${esc(p.name)}</b>, your passive income of <b>${money(s.passive)}/mo</b> now covers ${fmtMult(mult())} your expenses of ${money(s.expenses)}/mo.</p>
        <p>Your investments pay your bills — with plenty to spare. You can quit your job and never work for money again.</p>`,
      footer: '<button class="btn primary big" data-action="claim">Quit my job &amp; claim freedom 🏆</button>'
    };
  }

  function reportCard(p) {
    const s = C.summarize(S, p);
    return `<div class="report" style="--pc:${p.color}"><div class="report-head">${esc(p.emoji)} <b>${esc(p.name)}</b>${botTag(p)} ${p.place ? `· 🏆 #${p.place}` : `· ${pct(s.progress, 0)} free`}</div>
      <div class="kv-grid">${kv('Net worth', money(s.netWorth))}${kv('Passive income', `${money(s.passive)}/mo`)}${kv('Passive income earned', money(p.stats.passiveEarned))}
      ${kv('Interest paid on debts', money(p.stats.interestPaid))}${kv('Spent on luxuries', money(p.stats.luxurySpent))}${kv('Donated to charity', money(p.stats.donated))}
      ${kv('Deals bought', String(p.stats.deals))}${kv('Times downsized', String(p.stats.timesDownsized))}${kv('Promotions', String(p.stats.promotions))}${kv('Raises', String(p.stats.raises || 0))}
      ${p.stats.networkingSpent ? kv('Spent on networking', money(p.stats.networkingSpent)) : ''}${p.stats.weddingSpent ? kv('Spent on the wedding', money(p.stats.weddingSpent)) : ''}${p.stats.datingSpent ? kv('Spent on dates', money(p.stats.datingSpent)) : ''}
      ${kv('Relationship', p.relationship.status === 'married' ? `Married to ${esc(p.relationship.partner.name)}` : p.relationship.status === 'dating' ? `Dating ${esc(p.relationship.partner.name)}` : 'Single')}${p.children ? kv('Children', String(p.children)) : ''}</div></div>`;
  }

  function resultsModal() {
    const rows = E.standings(S);
    const winner = S.winners.length ? C.getPlayer(S, S.winners[S.winners.length - 1].id) : null;
    const over = S.phase === 'gameover';
    let title, intro;
    if (S.endReason === 'time') {
      const top = rows[0].p;
      title = `${top.name} wins on time!`;
      intro = `<p class="lead">Time's up after ${S.round} months. ${S.winners.length ? '' : 'Nobody quite reached financial freedom, so '}the ranking goes by progress toward freedom.</p>`;
    } else if (winner) {
      title = winner.place === 1 ? `${winner.name} wins!` : `${winner.name} takes #${winner.place}!`;
      intro = `<p class="lead">${esc(winner.emoji)} <b>${esc(winner.name)}</b> reached financial freedom in month ${S.winners[S.winners.length - 1].round}${winner.place === 1 ? ' — first to escape the 9-to-5!' : '.'}</p>`;
    } else { title = 'Game over'; intro = ''; }
    if (winner && winner.bot && winner.place === 1) intro += `<p>Beaten by a bot! ${esc(winner.name)} plays as <b>${esc(botLevel(winner).name)}</b>: ${esc(botLevel(winner).desc)} Compare its report card with yours below.</p>`;
    const remaining = E.activePlayers(S).length;
    const onlyBots = !over && !E.activeHumans(S).length;
    const footer = over
      ? '<button class="btn primary" data-action="new-game">New game</button><button class="btn ghost" data-action="review">Look at the board</button>'
      : onlyBots
        ? `<button class="btn primary" data-action="continue">Let the bots race for #${S.winners.length + 1} 🤖</button><button class="btn ghost" data-action="finish-game">End the game here</button>`
        : `<button class="btn primary" data-action="continue">Keep playing for #${S.winners.length + 1}${remaining === 1 ? ' (solo)' : ''}</button><button class="btn ghost" data-action="new-game">New game</button>`;
    return {
      title, icon: '🏆', tone: 'good', wide: true, dismissible: false,
      body: `${confetti()}${intro}<h3>Final report cards</h3><div class="report-grid">${rows.map(({ p }) => reportCard(p)).join('')}</div>
        <div class="lesson">💡 Notice the interest paid and money spent on luxuries — every dollar there was a dollar that couldn't be invested.</div>`,
      footer
    };
  }

  function confetti() {
    const bits = ['💵', '🎉', '💰', '✨', '🪙', '🎊'];
    let h = '<div class="confetti" aria-hidden="true">';
    for (let i = 0; i < 36; i++) h += `<span style="left:${(i * 37) % 100}%;animation-delay:${((i * 0.13) % 2.4).toFixed(2)}s;animation-duration:${(2.6 + (i % 5) * 0.4).toFixed(1)}s">${bits[i % bits.length]}</span>`;
    return h + '</div>';
  }

  function rulesModal() {
    return {
      title: 'How to play', icon: '📖', wide: true, dismissible: true,
      body: `<div class="rules">
        <h3>🎯 Goal</h3><p>Be the first to reach <b>financial freedom</b>: passive income (from investments) of at least <b>2× your total monthly expenses</b> (living costs + children + debt payments). When you get there, you quit your job and win. Other players can keep playing for 2nd, 3rd…</p>
        <h3>🔁 A turn</h3><ol>
          <li><b>Payday.</b> You collect your salary (unless you've been downsized) plus all passive income, then pay living expenses and debt payments. If you can't cover your bills, the shortfall goes on a credit card.</li>
          <li><b>Pop-ups.</b> Random events appear — not every turn: deals, luxury temptations, emergencies, layoffs (1–6 turns without pay), raises and promotions, side gigs, buyer offers, networking invitations, dates and family news, charity drives — plus announcements when a startup you backed succeeds or fails.</li>
          <li><b>Act.</b> Buy deals, trade stocks, pay off debt, borrow from the bank, sell assets or downshift your lifestyle — as much as you like.</li>
          <li><b>End your turn</b> and pass the device. When everyone has played, the month ends and the market moves.</li></ol>
        <h3>💼 Your starting life</h3><p>Each player gets a random job (salary), lifestyle (expenses), savings and a mix of debts — credit cards, auto loans, student loans, a mortgage and more. Paying a debt off removes its monthly payment, which lowers your expenses <i>and</i> your freedom target.</p>
        <h3>💰 Ways to make money</h3><ul>
          <li><b>Stocks</b> — 12 fictional investments, from a steady index fund and bonds to big tech, AI, healthcare, a grocery chain, energy, a REIT, gold, crypto and a penny stock. Each has its own volatility, and only dividends count as passive income.</li>
          <li><b>Real estate</b> — condos, houses, duplexes, triplexes and fourplexes, apartment complexes, vacation rentals, fixer-uppers, commercial buildings and land. Most use a mortgage; check the cashflow after all costs.</li>
          <li><b>Businesses</b> — vending routes, ATMs, food trucks, laundromats, franchises, partnerships and more. Some take a few turns to launch before you see their real profit.</li>
          <li><b>Side projects, startups, lending notes and collectibles</b> — from cheap lottery tickets to steady interest.</li></ul>
        <h3>🏡 Your home</h3><p>Homes rise and fall in value with the regional housing market <i>and</i> their own neighborhood. Homeowners can sell (6% selling costs, then the mortgage is repaid) and move into a rental — or buy one of the homes listed each turn in the Portfolio tab. Buying needs a down payment (5–20%) plus 3% closing costs, and the bank caps all your debt payments at 43% of your income.</p>
        <h3>📈 Raises &amp; 🤝 networking</h3><p>Raises are small, permanent bumps in pay (2–5%); promotions are bigger (8–20%) and come with a new title. Networking conferences (a one-time fee, helps for 12 months) and networking clubs (a joining fee plus monthly dues, cancel any time) make raises, promotions and side gigs more likely and cut the longest possible job search after a layoff from 6 months to 4 (one of them) or 2 (both).</p>
        <h3>💞 Relationships</h3><p>Everyone starts single. You may meet someone and start dating (dates cost money each month). After a while, you may get the chance to marry — with a big wedding paid in cash or financed, or a simple one. A spouse pays half of the household bills. Married couples may decide to have children (each parent pays half), and marriages can hit trouble: counseling often helps, but a divorce costs legal fees plus half your cash and stocks. Dating couples can also simply break up.</p>
        <h3>🎯 Options &amp; short selling</h3><p>In the Options &amp; Shorts tab you can buy <b>calls</b> (bet on a rise), <b>puts</b> (bet on a fall, or insure shares you own) and <b>straddles</b> (bet on a big move either way). One contract covers 100 shares; options expire in 1, 3 or 6 months and pay out automatically at that month's payday if they finish in the money. <b>Short selling</b> borrows shares to sell now and buy back later: you need a 50% margin deposit, pay monthly borrow fees and dividends, and get a forced buy-back (margin call) if the price rises about 15%.</p>
        <h3>🤖 Computer opponents</h3><p>Playing alone? Add computer opponents on the setup screen. They follow exactly the same rules and get their own random cards. <b>Easy</b> bots spend freely and chase hot tips, <b>Normal</b> bots save steadily and buy solid deals, and <b>Hard</b> bots run a disciplined investor playbook. Their turns are played instantly; your payday screen shows what they did since your last turn.</p>
        <h3>😇 Charity</h3><p>Sometimes a charity drive asks for 10% of your monthly income. Donating gives you good karma for 3 turns: better deals, more good events, fewer bad ones, and lower odds of being downsized.</p>
        <h3>🏦 The bank</h3><p>You can borrow in $1,000 steps as long as the payment fits within 60% of your monthly cashflow. Borrowed money raises your expenses (and freedom target), so use it for assets that pay more than they cost.</p>
        <h3>🧠 Tips</h3><ul><li>Kill high-interest credit-card debt early — it's a guaranteed return.</li><li>Keep an emergency fund so layoffs and emergencies don't snowball into debt.</li><li>Look for deals with strong cash-on-cash returns and positive cashflow.</li><li>Growth stocks don't pay your bills; sell winners and buy income-producing assets.</li><li>Watch the <b>Money coach</b> in the This Month tab and the <b>Learn</b> tab.</li></ul>
        <p class="muted small">All companies and events are fictional. This is an educational game, not financial advice.</p></div>`,
      footer: '<button class="btn primary" data-action="close-modal">Got it</button>'
    };
  }

  function menuModal() {
    const inGame = ui.screen === 'game' && S;
    return {
      title: 'Menu', icon: '☰', dismissible: true,
      body: `<div class="menu-list">
        ${inGame ? `<button class="btn" data-action="export">💾 Download save file</button>` : ''}
        <label class="btn file-btn">📂 Load a save file<input type="file" accept=".json,application/json" id="import-file" hidden></label>
        ${inGame ? `<label class="opt check"><input type="checkbox" id="toggle-handoff" ${S.settings.handoff ? 'checked' : ''}> <span>Show the “pass the device” screen between turns</span></label>
        <p class="muted small">Your game saves automatically in this browser after every action. Seed: <code>${esc(S.seed)}</code></p>
        <button class="btn ghost" data-action="quit">🚪 Quit to title (keeps your save)</button>
        <button class="btn danger" data-action="new-game">🆕 Start a new game</button>` : ''}
      </div>`,
      footer: '<button class="btn" data-action="close-modal">Close</button>'
    };
  }

  function confirmModal(title, body, label, onConfirm, tone) {
    ui.modal = { type: 'confirm', title, body, label, onConfirm, tone };
  }

  function nextAutoModal() {
    if (ui.screen !== 'game' || !S) return null;
    if (ui.intro) return { type: 'intro', auto: true };
    if (ui.review) return null;
    if (S.phase === 'handoff') return { type: 'handoff', auto: true };
    if (S.phase === 'victory' || S.phase === 'gameover') return { type: 'results', auto: true };
    if (ui.showPayday) return { type: 'payday', auto: true };
    if (S.pendingWin) return { type: 'win', auto: true };
    const c = S.turn && S.turn.cards.find((x) => !x.seen);
    if (c) return { type: 'card', cardId: c.id, auto: true };
    return null;
  }

  function renderModal() {
    if (!ui.modal || ui.modal.auto) ui.modal = nextAutoModal();
    const m = ui.modal;
    if (!m) { $modal.innerHTML = ''; document.body.classList.remove('modal-open'); return; }
    let spec;
    switch (m.type) {
      case 'handoff': $modal.innerHTML = handoffScreen(); document.body.classList.add('modal-open'); focusPrimary(); return;
      case 'intro': spec = introModal(); break;
      case 'payday': spec = paydayModal(); break;
      case 'card': {
        const c = S.turn && S.turn.cards.find((x) => x.id === m.cardId);
        if (!c) { ui.modal = null; return renderModal(); }
        spec = cardModal(c); break;
      }
      case 'win': spec = winModal(); break;
      case 'results': spec = resultsModal(); break;
      case 'rules': spec = rulesModal(); break;
      case 'menu': spec = menuModal(); break;
      case 'stock': spec = stockDetail(m.id); break;
      case 'confirm':
        spec = { title: m.title, icon: '❓', dismissible: true, tone: m.tone, body: m.body, footer: `<button class="btn ghost" data-action="close-modal">Cancel</button><button class="btn primary" data-action="confirm">${esc(m.label)}</button>` };
        break;
      default: ui.modal = null; return renderModal();
    }
    $modal.innerHTML = shell(spec);
    document.body.classList.add('modal-open');
    focusPrimary();
  }

  function focusPrimary() {
    const el = $modal.querySelector('.modal-foot .btn.primary:not([disabled]), .handoff .btn.primary, .modal-foot .btn');
    if (el) el.focus({ preventScroll: true });
  }

  // ================================================================ flow
  /** Show "pass the device" whenever the device has to change hands. */
  function useHandoff() {
    const last = S.lastHumanId !== undefined ? S.lastHumanId : S.lastPlayerId;
    return S.settings.handoff && E.humans(S).length > 1 && last !== C.currentPlayer(S).id;
  }

  function autoAdvance() {
    if (ui.screen !== 'game' || !S || ui.intro) return;
    // Computer opponents play their turns instantly; their recap shows at the next person's payday.
    if (S.phase === 'handoff' && E.isBot(C.currentPlayer(S))) {
      const r = E.runBots(S);
      for (const rc of r.recaps) ui.botRecap.push(Object.assign(rc, { seq: ++ui.recapSeq }));
      if (ui.botRecap.length > 200) ui.botRecap.splice(0, ui.botRecap.length - 200);
      if (r.stalled && !E.activeHumans(S).length) E.finishGame(S);
      save();
    }
    if (S.phase === 'handoff' && !useHandoff()) {
      E.beginTurn(S);
      ui.showPayday = true;
      ui.tab = 'month';
      save();
    }
  }

  function refresh() {
    hideTip();
    if (ui.screen === 'title' || !S) { renderTitle(); renderModal(); return; }
    autoAdvance();
    renderGame();
    renderModal();
  }

  function after(r) {
    if (r && r.msg) toast(r.msg, r.ok ? 'good' : 'bad');
    save();
    refresh();
  }

  function closeModal() {
    const m = ui.modal;
    if (m && m.type === 'card') E.markSeen(S, m.cardId);
    ui.modal = null;
    save();
    refresh();
  }

  function startGame() {
    const st = ui.setup;
    if (!st.players.some((pl) => !pl.bot)) return toast('At least one person has to play.', 'bad');
    const players = st.players.map((pl, i) => ({ name: (pl.name || '').trim() || `Player ${i + 1}`, emoji: pl.emoji, color: pl.color, bot: pl.bot || null }));
    S = E.createGame({ players, seed: st.seed, timeLimit: Number(st.timeLimit), handoff: !!st.handoff, freedomMultiple: Number(st.multiple) });
    ui.screen = 'game'; ui.intro = true; ui.tab = 'month'; ui.review = false; ui.showPayday = false; ui.modal = null; ui.botRecap = []; ui.recapSeen = {}; ui.recapSeq = 0;
    saveSetup();
    save();
    refresh();
  }

  function doEndTurn() {
    const r = E.endTurn(S);
    if (!r.ok) return after(r);
    ui.tab = 'month';
    ui.showPayday = false;
    ui.modal = null;
    save();
    refresh();
    window.scrollTo({ top: 0 });
  }

  function qtyValue(id) {
    const el = document.getElementById(id);
    return el ? Number(el.value) : 0;
  }

  function freeBotName() {
    const used = new Set(ui.setup.players.map((p) => p.name));
    return AI.BOT_NAMES.find((n) => !used.has(n)) || `Bot ${ui.setup.players.length + 1}`;
  }

  // ================================================================ actions
  const actions = {
    'setup-add'() {
      const used = new Set(ui.setup.players.map((p) => p.color));
      const i = ui.setup.players.length;
      ui.setup.players.push({ name: `Player ${i + 1}`, emoji: D.AVATARS[i % D.AVATARS.length], color: D.COLORS.find((c) => !used.has(c)) || D.COLORS[i % D.COLORS.length] });
      saveSetup(); refresh();
    },
    'setup-add-bot'() {
      const used = new Set(ui.setup.players.map((p) => p.color));
      const i = ui.setup.players.length;
      ui.setup.players.push({ name: freeBotName(), emoji: D.AVATARS[i % D.AVATARS.length], color: D.COLORS.find((c) => !used.has(c)) || D.COLORS[i % D.COLORS.length], bot: 'normal' });
      saveSetup(); refresh();
    },
    'setup-remove'(el) {
      const pl = ui.setup.players[Number(el.dataset.i)];
      if (pl && !pl.bot && setupHumans() <= 1) return toast('At least one person has to play.', 'bad');
      ui.setup.players.splice(Number(el.dataset.i), 1); saveSetup(); refresh();
    },
    'setup-emoji'(el) {
      const pl = ui.setup.players[Number(el.dataset.i)];
      pl.emoji = D.AVATARS[(D.AVATARS.indexOf(pl.emoji) + 1) % D.AVATARS.length];
      saveSetup(); refresh();
    },
    'setup-color'(el) {
      const pl = ui.setup.players[Number(el.dataset.i)];
      pl.color = D.COLORS[(D.COLORS.indexOf(pl.color) + 1) % D.COLORS.length];
      saveSetup(); refresh();
    },
    'start-game'() {
      if (loadSave()) confirmModal('Start a new game?', '<p>This replaces your saved game.</p>', 'Start new game', () => { clearSave(); startGame(); });
      else startGame();
      refresh();
    },
    resume() {
      const s = loadSave();
      if (!s) return toast('No saved game found.', 'bad');
      S = s; ui.screen = 'game'; ui.intro = false; ui.review = false; ui.showPayday = false; ui.modal = null; ui.tab = 'month';
      refresh();
    },
    'discard-save'() { confirmModal('Discard saved game?', '<p>This can\'t be undone.</p>', 'Discard', () => { clearSave(); refresh(); }, 'bad'); refresh(); },
    'intro-ok'() { ui.intro = false; ui.modal = null; refresh(); },
    'start-turn'() { if (S.phase !== 'handoff') return refresh(); E.beginTurn(S); ui.showPayday = true; ui.tab = 'month'; ui.modal = null; save(); refresh(); window.scrollTo({ top: 0 }); },
    'payday-ok'() { ui.showPayday = false; ui.recapSeen[C.currentPlayer(S).id] = ui.recapSeq; ui.modal = null; refresh(); },
    'finish-game'() { E.finishGame(S); ui.modal = null; save(); refresh(); },
    tab(el) { ui.tab = el.dataset.tab; refresh(); },
    toggle(el) { ui.expand[el.dataset.key] = !ui.expand[el.dataset.key]; refresh(); },
    choose(el) {
      const r = E.resolveCard(S, el.dataset.card, el.dataset.choice);
      if (r.ok) {
        if (r.openTab) ui.tab = r.openTab;
        if (ui.modal && ui.modal.type === 'card') ui.modal = null;
      }
      after(r);
    },
    'borrow-buy'(el) {
      const p = C.currentPlayer(S);
      const c = S.turn.cards.find((x) => x.id === el.dataset.card);
      if (!c) return;
      const need = Math.ceil((c.deal.cash - p.cash) / 1000) * 1000;
      const b = E.borrow(S, need);
      if (!b.ok) return after(b);
      const r = E.resolveCard(S, c.id, 'buy');
      if (r.ok && ui.modal && ui.modal.type === 'card') ui.modal = null;
      after(r.ok ? { ok: true, msg: `${b.msg} ${r.msg}` } : r);
    },
    'end-turn'() {
      const can = E.canEndTurn(S);
      if (!can.ok) { ui.tab = 'month'; return after(can); }
      const open = S.turn.cards.filter((c) => c.kind === 'deal' && !c.resolved).length;
      if (open) {
        confirmModal('End your turn?', `<p>You still have ${plural(open, 'deal')} on the table. ${open === 1 ? 'It' : 'They'} will be gone when your turn ends.</p>`, 'End turn & pass', doEndTurn);
        return refresh();
      }
      doEndTurn();
    },
    buy(el) { after(E.buyStock(S, el.dataset.id, qtyValue(`qty-${el.dataset.id}`))); },
    sell(el) { after(E.sellStock(S, el.dataset.id, qtyValue(`qty-${el.dataset.id}`))); },
    'max-buy'(el) {
      const sec = S.market.securities[el.dataset.id];
      const input = document.getElementById(`qty-${el.dataset.id}`);
      if (input) { input.value = Math.max(0, Math.floor(C.currentPlayer(S).cash / sec.price)); input.focus(); }
    },
    'max-sell'(el) {
      const h = C.currentPlayer(S).holdings[el.dataset.id];
      const input = document.getElementById(`qty-${el.dataset.id}`);
      if (input && h) { input.value = h.shares; input.focus(); }
    },
    'stock-detail'(el) { ui.modal = { type: 'stock', id: el.dataset.id }; refresh(); },
    'pay-debt'(el) { after(E.payDebt(S, el.dataset.id, qtyValue(`pay-${el.dataset.id}`))); },
    'payoff-debt'(el) {
      const d = C.currentPlayer(S).debts.find((x) => x.id === el.dataset.id);
      if (d) after(E.payDebt(S, d.id, d.balance));
    },
    'pay-asset'(el) { after(E.payAssetLoan(S, el.dataset.kind, el.dataset.id, qtyValue(`pay-${el.dataset.id}`))); },
    'payoff-asset'(el) { after(E.payAssetLoan(S, el.dataset.kind, el.dataset.id, Infinity)); },
    borrow() { after(E.borrow(S, qtyValue('borrow-amt'))); },
    downshift() {
      const info = E.downshiftInfo(S, C.currentPlayer(S));
      confirmModal('Downshift your lifestyle?', `<p>Move to a ${info.next.icon} <b>${info.next.name}</b> lifestyle for a one-time cost of <b>${money(info.cost)}</b>. Your living expenses drop by about <b>${money(info.savings)}/mo</b> for good.</p>`, 'Downshift', () => after(E.downshift(S)));
      refresh();
    },
    'sell-asset'(el) {
      const p = C.currentPlayer(S);
      const { kind, id } = el.dataset;
      let name = '', detail = '';
      if (kind === 'property') {
        const pr = p.properties.find((x) => x.id === id); if (!pr) return;
        const sale = C.propertySale(S, pr);
        name = pr.name;
        detail = `${kv('Market value', money(sale.value))}${kv(`Selling costs (${pr.land ? 3 : 6}%)`, `−${money(sale.fees)}`)}${sale.loan ? kv('Pay off mortgage', `−${money(sale.loan)}`) : ''}${kv('You receive', money(sale.net), 'strong')}${kv('Monthly cashflow lost', signed(-C.propertyCashflow(pr)))}`;
      } else if (kind === 'business') {
        const b = p.businesses.find((x) => x.id === id); if (!b) return;
        const sale = C.businessSale(b);
        name = b.name;
        detail = `${kv('Sale price', money(sale.value))}${sale.loan ? kv('Pay off loan', `−${money(sale.loan)}`) : ''}${kv('You receive', money(sale.net), 'strong')}${b.kind !== 'startup' ? kv('Monthly cashflow lost', signed(-C.businessCashflow(b))) : ''}`;
      } else if (kind === 'collectible') {
        const c = p.collectibles.find((x) => x.id === id); if (!c) return;
        name = c.name;
        detail = `${kv('Estimated value', money(c.value))}${kv('Auction fee (10%)', `−${money(c.value * 0.1)}`)}${kv('You receive', money(c.value * 0.9), 'strong')}`;
      } else if (kind === 'note') {
        const n = p.notes.find((x) => x.id === id); if (!n) return;
        name = n.name;
        detail = `${kv('Principal', money(n.principal))}${kv('Early-sale discount (5%)', `−${money(n.principal * 0.05)}`)}${kv('You receive', money(n.principal * 0.95), 'strong')}${kv('Monthly interest lost', signed(-C.noteIncome(n)))}`;
      }
      confirmModal(`Sell ${name}?`, `<div class="kv-grid">${detail}</div>`, 'Sell', () => after(E.sellAsset(S, kind, id)));
      refresh();
    },
    'opt-kind'(el) { ui.opt.kind = el.dataset.kind; refresh(); },
    'trade-options'(el) { ui.opt.sec = el.dataset.id; ui.opt.strike = 2; ui.tab = 'options'; ui.modal = null; refresh(); },
    'buy-option'() {
      const sec = S.market.securities[ui.opt.sec];
      const strikes = O.strikes(sec);
      const K = strikes[Math.min(ui.opt.strike, strikes.length - 1)];
      const n = qtyValue('opt-contracts');
      ui.opt.contracts = n || 1;
      after(E.buyOption(S, ui.opt.sec, ui.opt.kind, K, ui.opt.months, n));
    },
    'sell-option'(el) { after(E.sellOption(S, el.dataset.id)); },
    'short-sell'() { after(E.shortSell(S, ui.opt.sec, qtyValue('short-qty'))); },
    cover(el) { after(E.coverShort(S, el.dataset.id, qtyValue(`cover-${el.dataset.id}`))); },
    'cover-all'(el) {
      const sh = C.currentPlayer(S).shorts[el.dataset.id];
      const input = document.getElementById(`cover-${el.dataset.id}`);
      if (input && sh) { input.value = sh.shares; input.focus(); }
    },
    'sell-home'(el) {
      const p = C.currentPlayer(S);
      const rent = el.dataset.rent;
      const sale = C.homeSale(S, p);
      const newRent = C.roundTo(Deals.rentFor(sale.value) * (rent === 'smaller' ? 0.7 : 1), 5);
      const m = C.homeMortgage(p);
      const oldCost = (m ? m.payment : 0) + p.expenses.housing;
      confirmModal('Sell your home?', `<div class="kv-grid">${kv('Market value', money(sale.value))}${kv('Selling costs (6%)', `−${money(sale.fees)}`)}${sale.loan ? kv('Pay off mortgage', `−${money(sale.loan)}`) : ''}${kv('You receive', money(sale.net), 'strong')}
        ${kv('Housing cost now', `${money(oldCost)}/mo`)}${kv(rent === 'smaller' ? 'New rent (smaller place)' : 'New rent (similar place)', `${money(newRent)}/mo`)}</div>
        <p class="muted small">You still need somewhere to live: you'll move into a rental. You can buy another home later from the listings.</p>`, 'Sell & move', () => after(E.sellHome(S, rent)));
      refresh();
    },
    'buy-home'(el) {
      const p = C.currentPlayer(S);
      const h = S.turn.homes.find((x) => x.id === el.dataset.id);
      if (!h) return;
      const dp = Number(el.dataset.down);
      const t = Deals.homePurchaseTerms(S, p, h, dp);
      confirmModal(`Buy the ${h.name}?`, `<div class="kv-grid">${kv('Price', money(h.price))}${t.sale ? kv('Your current home sells for (net)', money(t.sale.net), 'pos') : ''}${kv(`Down payment (${pct(dp, 0)})`, money(t.down))}${kv('Closing costs (3%)', money(t.closing))}
        ${kv('Mortgage', `${money(t.loan)} at ${t.rate.toFixed(3)}%, 30 yrs`)}${kv('Mortgage payment', `${money(t.payment)}/mo`)}${kv('Taxes, insurance & upkeep', `${money(h.ownerCosts)}/mo`)}${kv('Debt-to-income after', pct(t.dti, 0))}</div>
        ${dp < 0.2 ? '<p class="muted small">With less than 20% down, lenders charge a higher rate because the loan is riskier.</p>' : ''}`, 'Buy this home', () => after(E.buyHome(S, h.id, dp)));
      refresh();
    },
    'cancel-club'() {
      const club = C.currentPlayer(S).network.club;
      if (!club) return;
      confirmModal('Cancel your membership?', `<p>You'll stop paying ${money(club.dues)}/mo in dues, but lose the networking boost. The joining fee is not refunded — if you rejoin later, you'd pay it again.</p>`, 'Cancel membership', () => after(E.cancelClub(S)));
      refresh();
    },
    'chart-metric'(el) { ui.chartMetric = el.dataset.metric; refresh(); },
    'log-filter'(el) { ui.logFilter = el.dataset.filter; refresh(); },
    claim() { E.claimFreedom(S); ui.modal = null; save(); refresh(); },
    continue() { E.continueGame(S); ui.modal = null; ui.tab = 'month'; save(); refresh(); },
    review() { ui.review = true; ui.modal = null; refresh(); },
    'show-results'() { ui.review = false; ui.modal = null; refresh(); },
    'new-game'() {
      const go = () => { S = null; clearSave(); ui.screen = 'title'; ui.modal = null; ui.review = false; refresh(); };
      if (S && S.phase !== 'gameover') confirmModal('Start a new game?', '<p>Your current game will be deleted.</p>', 'Yes, new game', go, 'bad');
      else go();
      refresh();
    },
    quit() { save(); S = null; ui.screen = 'title'; ui.modal = null; ui.review = false; refresh(); },
    'open-rules'() { ui.modal = { type: 'rules' }; refresh(); },
    'open-menu'() { ui.modal = { type: 'menu' }; refresh(); },
    'close-modal'() { closeModal(); },
    confirm() { const fn = ui.modal && ui.modal.onConfirm; ui.modal = null; if (fn) fn(); else refresh(); },
    export() {
      const blob = new Blob([E.serialize(S)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `money-sim-month-${S.round}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  };

  document.addEventListener('click', (e) => {
    const bd = e.target.closest('[data-backdrop]');
    if (bd && e.target === bd && bd.classList.contains('dismissible')) return closeModal();
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true' && el.dataset.action !== 'end-turn') return;
    const fn = actions[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el, e); }
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'opt-contracts') {
      // Live-update the order ticket without re-rendering (so the Buy button keeps working).
      const n = Math.max(0, Math.floor(Number(t.value) || 0));
      ui.opt.contracts = n || 1;
      const cost = Number(t.dataset.ask) * O.CONTRACT * n;
      for (const id of ['opt-total', 'opt-maxloss', 'opt-buy-cost']) { const el = document.getElementById(id); if (el) el.textContent = money(cost); }
      const mg = document.getElementById('opt-maxgain');
      if (mg && t.dataset.putMax !== '') mg.textContent = money(Number(t.dataset.putMax) * O.CONTRACT * n);
      return;
    }
    if (t.classList.contains('pname')) { ui.setup.players[Number(t.dataset.i)].name = t.value; saveSetup(); }
    else if (t.dataset.setup) {
      ui.setup[t.dataset.setup] = t.type === 'checkbox' ? t.checked : t.value;
      saveSetup();
    }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.setup) { ui.setup[t.dataset.setup] = t.type === 'checkbox' ? t.checked : t.value; saveSetup(); }
    if (t.classList.contains('ptype')) {
      const i = Number(t.dataset.i), pl = ui.setup.players[i];
      const bot = t.value || null;
      if (!bot === !pl.bot) pl.bot = bot; // only the difficulty changed
      else if (bot) {
        if (setupHumans() <= 1) { toast('At least one person has to play.', 'bad'); return refresh(); }
        if (/^Player \d+$/.test(pl.name.trim())) pl.name = freeBotName();
        pl.bot = bot;
      } else {
        if (AI.BOT_NAMES.includes(pl.name) || /^Bot \d+$/.test(pl.name)) pl.name = `Player ${i + 1}`;
        pl.bot = null;
      }
      saveSetup(); refresh();
    }
    if (t.id === 'toggle-handoff' && S) { S.settings.handoff = t.checked; save(); }
    if (t.dataset.opt) {
      const k = t.dataset.opt;
      if (k === 'sec') { ui.opt.sec = t.value; ui.opt.strike = 2; } else ui.opt[k] = Number(t.value);
      refresh();
    }
    if (t.id === 'import-file' && t.files && t.files[0]) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          S = E.deserialize(String(reader.result));
          ui.screen = 'game'; ui.intro = false; ui.review = false; ui.showPayday = false; ui.modal = null; ui.tab = 'month';
          save(); toast('Save file loaded.', 'good'); refresh();
        } catch (err) { toast(err.message || 'Could not read that file.', 'bad'); }
      };
      reader.readAsText(t.files[0]);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ui.modal && !ui.modal.auto) { closeModal(); return; }
    if (e.key === 'Escape' && ui.modal && ui.modal.type === 'card') {
      const c = S.turn && S.turn.cards.find((x) => x.id === ui.modal.cardId);
      if (c && !c.required && c.type !== 'info') closeModal();
      return;
    }
    if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('qty')) {
      const btn = e.target.id === 'opt-contracts' ? document.getElementById('opt-buy')
        : e.target.parentElement.querySelector('[data-action="buy"], [data-action="pay-debt"], [data-action="pay-asset"], [data-action="borrow"], [data-action="short-sell"], [data-action="cover"]');
      if (btn) btn.click();
    }
  });

  // ================================================================ boot
  const saved = loadSave();
  if (saved && location.hash === '#continue') { S = saved; ui.screen = 'game'; }
  refresh();
})();
