/* Page rendering for the Halden CFO control center. Reads only from window.CfoEngine. */
(function () {
  'use strict';
  const E = window.CfoEngine;
  const $ = (id) => document.getElementById(id);
  const { fmtK, fmtPct } = E;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = (v) => { const r = Math.round(v); return r < 0 ? '(' + Math.abs(r).toLocaleString('en-US') + ')' : r.toLocaleString('en-US'); };
  const signPct = (v) => (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(1) + '%';
  const M = (v) => '$' + (v / 1000).toFixed(1) + 'M';

  const STORE = 'halden-cfo-view';
  const S = { m: E.N - 1, mode: 'month' };
  try { const saved = JSON.parse(localStorage.getItem(STORE) || 'null'); if (saved && saved.m >= 0 && saved.m < E.N) Object.assign(S, saved); } catch (e) { /* storage unavailable */ }
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { /* ignore */ } };

  // ---------- Controls ----------
  $('month').innerHTML = E.MONTHS.map((_, i) => `<option value="${i}">${E.monthName(i)} 2026</option>`).join('');
  $('month').addEventListener('change', (e) => { S.m = Number(e.target.value); save(); render(); });
  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { S.mode = b.dataset.mode; save(); render(); }));

  function render() {
    $('month').value = String(S.m);
    document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode)));
    $('period-chip').textContent = E.periodLabel(S.m, S.mode);
    renderSummary(); renderKpis(); renderArr(); renderBridge(); renderBva(); renderCash(); renderWc(); renderPeople(); renderClose(); renderChecks();
  }

  // ---------- Summary ----------
  function renderSummary() {
    const sm = E.summary(S.m, S.mode);
    $('summary-text').textContent = sm.sentences.join(' ');
    const label = { bad: 'Act', warn: 'Watch', good: 'On track' };
    $('watch').innerHTML = sm.watch.length ? sm.watch.map((w) => `<li><span class="chip ${w.level}">${label[w.level]}</span><b>${esc(w.title)}</b><span>${esc(w.text)}</span></li>`).join('')
      : '<li><span class="chip good">On track</span><b>Nothing above the watch thresholds</b><span>No runway, bookings, churn, DSO or close issues this period.</span></li>';
  }

  // ---------- KPI tiles ----------
  function spark(values, opts = {}) {
    const W = 160, H = 30, p = 3;
    const v = values.filter((x) => Number.isFinite(x));
    if (v.length < 2) return '';
    const lo = Math.min(...v, opts.floor ?? Infinity), hi = Math.max(...v);
    const x = (i) => p + (i / (values.length - 1)) * (W - 2 * p);
    const y = (val) => H - p - ((val - lo) / (hi - lo || 1)) * (H - 2 * p);
    const pts = values.map((val, i) => [x(i), y(Number.isFinite(val) ? val : hi)]);
    const d = pts.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('');
    const last = pts[pts.length - 1];
    const area = d + `L${last[0].toFixed(1)} ${H - p}L${pts[0][0].toFixed(1)} ${H - p}Z`;
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${area}" fill="var(--accent-soft)" stroke="none"/><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="1.75" stroke-linejoin="round" vector-effect="non-scaling-stroke"/><circle cx="${last[0]}" cy="${last[1]}" r="2.5" fill="var(--accent)"/></svg>`;
  }

  function tile(name, value, sub, def, chip, sp) {
    return `<div class="kpi"><div class="top-row"><span class="eyebrow">${name}</span>${chip ? `<span class="chip ${chip[0]}">${chip[1]}</span>` : ''}</div><div class="v">${value}</div><div class="s">${sub}</div><div class="def">${def}</div>${sp || ''}</div>`;
  }

  function renderKpis() {
    const K = E.kpis(S.m, S.mode);
    const per = S.mode === 'ytd' ? 'YTD' : E.monthShort(S.m);
    const vs = (d, good) => (d >= 0 === good ? 'good' : 'bad');
    const t = [];
    t.push(tile('ARR', M(K.arr.value), `${signPct(K.arr.yoy)} year over year · ${signPct(K.arr.vsPlan)} vs plan`, `Plan ${M(K.arr.plan)} at ${E.monthShort(S.m)} month end`, [K.arr.vsPlan >= -0.02 ? 'good' : 'warn', K.arr.vsPlan >= -0.02 ? 'On plan' : 'Behind plan'], spark(K.arr.spark)));
    t.push(tile(`Revenue, ${per}`, fmtK(K.revenue.value), `${signPct(K.revenue.vsBudget)} vs budget of ${fmtK(K.revenue.budget)}`, 'Subscription plus usage & services', [vs(K.revenue.vsBudget + 0.02, true), K.revenue.vsBudget >= -0.02 ? 'On budget' : 'Below budget'], spark(K.revenue.spark)));
    const gmD = K.grossMargin.value - K.grossMargin.budget;
    t.push(tile(`Gross margin, ${per}`, fmtPct(K.grossMargin.value), `${(gmD >= 0 ? '+' : '−') + Math.abs(gmD * 100).toFixed(1)} pts vs budget of ${fmtPct(K.grossMargin.budget)}`, 'After hosting, support and data costs', null, spark(K.grossMargin.spark)));
    const ebD = K.ebitda.value - K.ebitda.budget;
    t.push(tile(`EBITDA, ${per}`, fmtK(K.ebitda.value), `${ebD >= 0 ? fmtK(ebD) + ' better' : fmtK(-ebD) + ' worse'} than budget · ${fmtPct(K.ebitda.margin)} margin`, `Budget ${fmtK(K.ebitda.budget)}`, [ebD >= 0 ? 'good' : 'warn', ebD >= 0 ? 'Ahead' : 'Behind'], spark(K.ebitda.spark)));
    t.push(tile('Net burn', fmtK(K.burn.value) + '/mo', 'Average monthly fall in cash, last three months', S.m === 0 ? 'January includes the $480k 2025 bonus payout' : 'Includes debt service and working capital', null, spark(K.burn.spark)));
    t.push(tile('Runway', K.runway.value.toFixed(1) + ' months', `${K.runway.withRevolver.toFixed(1)} months with the undrawn $4.0M revolver`, `${fmtK(K.runway.cash)} cash at ${E.monthShort(S.m)} month end`, [K.runway.value >= 12 ? 'good' : K.runway.value >= 9 ? 'warn' : 'bad', K.runway.value >= 12 ? 'Over 12 mo' : 'Under 12 mo'], spark(K.runway.spark, { floor: 0 })));
    const bm = K.burnMultiple.value;
    t.push(tile('Burn multiple', Number.isFinite(bm) ? bm.toFixed(1) + '×' : 'n/a', `Net burn ÷ net new ARR of ${fmtK(K.burnMultiple.netNew)}/mo`, 'Three-month basis; under 1.5× is efficient', [bm <= 1.5 ? 'good' : bm <= 2 ? 'warn' : 'bad', bm <= 1.5 ? 'Efficient' : bm <= 2 ? 'Watch' : 'High']));
    t.push(tile('Rule of 40', Math.round(K.ruleOf40.value * 100) + '%', `${fmtPct(K.ruleOf40.growth, 0)} ARR growth ${K.ruleOf40.margin < 0 ? '−' : '+'} ${fmtPct(Math.abs(K.ruleOf40.margin), 0)} EBITDA margin`, `Net revenue retention ${fmtPct(K.nrr, 0)}, YTD annualized`, [K.ruleOf40.value >= 0.4 ? 'good' : K.ruleOf40.value >= 0.2 ? 'warn' : 'bad', K.ruleOf40.value >= 0.4 ? 'Above 40' : 'Below 40']));
    $('kpis').innerHTML = t.join('');
  }

  // ---------- Generic chart scaffolding ----------
  function scale(lo, hi, steps = 4) {
    const span = hi - lo, raw = span / steps, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw);
    const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
    const ticks = []; for (let v = a; v <= b + step / 2; v += step) ticks.push(v);
    return { a, b, ticks };
  }

  function grid(ticks, y, x0, x1, fmt) {
    return ticks.map((t) => `<line x1="${x0}" x2="${x1}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="${x0 - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${fmt(t)}</text>`).join('');
  }

  function hover(box, readout, text, fallback) {
    const svg = box.querySelector('svg');
    const hits = svg.querySelectorAll('.hit');
    hits.forEach((h) => {
      const show = () => { readout.innerHTML = text(Number(h.dataset.i)); };
      h.addEventListener('pointerenter', show); h.addEventListener('focus', show);
    });
    svg.addEventListener('pointerleave', () => { readout.innerHTML = fallback(); });
    readout.innerHTML = fallback();
  }

  // ---------- ARR chart ----------
  function renderArr() {
    const A = E.ARR.actual, P = E.ARR.plan, n = E.N;
    const W = 720, H = 250, m = { l: 56, r: 56, t: 12, b: 28 };
    const lo = Math.min(...A.map((x) => x.begin), ...P.map((x) => x.end)), hi = Math.max(...A.map((x) => x.end), ...P.map((x) => x.end));
    const sc = scale(lo - 200, hi + 200);
    const x = (i) => m.l + (i / (n - 1)) * (W - m.l - m.r);
    const y = (v) => m.t + (1 - (v - sc.a) / (sc.b - sc.a)) * (H - m.t - m.b);
    const pa = A.map((r, i) => (i ? 'L' : 'M') + x(i) + ' ' + y(r.end)).join('');
    const pp = P.map((r, i) => (i ? 'L' : 'M') + x(i) + ' ' + y(r.end)).join('');
    const sel = S.m;
    const sub = A.slice(0, sel + 1).map((r, i) => (i ? 'L' : 'M') + x(i) + ' ' + y(r.end)).join('') + `L${x(sel)} ${y(sc.a)}L${x(0)} ${y(sc.a)}Z`;
    const xl = E.MONTHS.map((_, i) => `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="${i === sel ? 'var(--ink)' : 'var(--muted)'}" font-weight="${i === sel ? 600 : 400}">${E.monthShort(i)}</text>`).join('');
    const dots = A.map((r, i) => `<circle cx="${x(i)}" cy="${y(r.end)}" r="${i === sel ? 5 : 3}" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>`).join('');
    const ends = `<text x="${x(n - 1) + 8}" y="${y(A[n - 1].end) + 4}" font-size="11.5" font-weight="600" fill="var(--ink)">${M(A[n - 1].end)}</text><text x="${x(n - 1) + 8}" y="${y(P[n - 1].end) + 4}" font-size="11.5" fill="var(--ink-2)">${M(P[n - 1].end)}</text>`;
    const colW = (W - m.l - m.r) / (n - 1);
    const hits = E.MONTHS.map((_, i) => `<rect class="hit" data-i="${i}" tabindex="0" x="${x(i) - colW / 2}" y="${m.t}" width="${colW}" height="${H - m.t - m.b}" fill="transparent"/>`).join('');
    $('arr-chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="ARR actual against plan by month">${grid(sc.ticks, y, m.l, W - m.r, M)}<line x1="${x(sel)}" x2="${x(sel)}" y1="${m.t}" y2="${H - m.b}" stroke="var(--line-strong)" stroke-dasharray="2 3"/><path d="${sub}" fill="var(--accent-soft)" opacity="0.7"/><path d="${pp}" fill="none" stroke="var(--plan)" stroke-width="2" stroke-dasharray="6 4"/><path d="${pa}" fill="none" stroke="var(--accent)" stroke-width="2.25" stroke-linejoin="round"/>${dots}${ends}${xl}${hits}</svg>`;
    const txt = (i) => `<b>${E.monthName(i)}</b> · ARR ${M(A[i].end)} vs plan ${M(P[i].end)} (${signPct(A[i].end / P[i].end - 1)}) · net new ${fmtK(A[i].end - A[i].begin)} vs ${fmtK(P[i].end - P[i].begin)} plan`;
    hover($('arr-chart'), $('arr-readout'), txt, () => txt(sel));
    $('arr-table').innerHTML = `<table class="mini"><thead><tr><th>Month</th><th>Opening</th><th>New</th><th>Expansion</th><th>Contraction</th><th>Churn</th><th>Closing</th><th>Plan</th></tr></thead><tbody>${A.map((r, i) => `<tr><td>${E.monthShort(i)}</td><td>${num(r.begin)}</td><td>${num(r.new)}</td><td>${num(r.expansion)}</td><td>${num(r.contraction)}</td><td>${num(r.churn)}</td><td>${num(r.end)}</td><td>${num(P[i].end)}</td></tr>`).join('')}</tbody></table>`;
  }

  // ---------- ARR bridge (waterfall) ----------
  function renderBridge() {
    const B = E.arrBridge(S.m, S.mode), a = B.actual;
    $('bridge-sub').textContent = E.periodLabel(S.m, S.mode);
    const steps = [
      { k: 'Opening', v: a.begin, total: true },
      { k: 'New', v: a.new }, { k: 'Expansion', v: a.expansion },
      { k: 'Contraction', v: a.contraction }, { k: 'Churn', v: a.churn },
      { k: 'Closing', v: a.end, total: true },
    ];
    let run = 0;
    steps.forEach((s) => { if (s.total) { s.from = 0; s.to = s.v; run = s.v; } else { s.from = run; s.to = run + s.v; run = s.to; } });
    const W = 440, H = 250, m = { l: 52, r: 12, t: 22, b: 28 };
    const vals = steps.flatMap((s) => (s.total ? [s.v] : [s.from, s.to])).concat(B.plan.end);
    const sc = scale(Math.min(...vals) - (Math.max(...vals) - Math.min(...vals)) * 0.25, Math.max(...vals));
    const y = (v) => m.t + (1 - (Math.max(v, sc.a) - sc.a) / (sc.b - sc.a)) * (H - m.t - m.b);
    const bw = (W - m.l - m.r) / steps.length;
    const bars = steps.map((s, i) => {
      const x = m.l + i * bw + bw * 0.18, w = bw * 0.64;
      const top = y(Math.max(s.from, s.to)), bot = s.total ? y(sc.a) : y(Math.min(s.from, s.to));
      const fill = s.total ? 'var(--ink-2)' : s.v >= 0 ? 'var(--accent)' : 'var(--bad)';
      const lbl = s.total ? M(s.v) : (s.v >= 0 ? '+' : '−') + fmtK(Math.abs(s.v));
      const conn = i < steps.length - 1 ? `<line x1="${x + w}" x2="${x + bw}" y1="${y(s.to)}" y2="${y(s.to)}" stroke="var(--line-strong)" stroke-dasharray="2 2"/>` : '';
      return `<rect x="${x}" y="${top}" width="${w}" height="${Math.max(2, bot - top)}" rx="3" fill="${fill}"><title>${s.k}: ${lbl}</title></rect><text x="${x + w / 2}" y="${top - 6}" text-anchor="middle" font-size="11" font-weight="600" fill="var(--ink)">${lbl}</text><text x="${x + w / 2}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--muted)">${s.k}</text>${conn}`;
    }).join('');
    const lastX = m.l + 5 * bw + bw * 0.1;
    const planLine = `<line x1="${lastX}" x2="${lastX + bw * 0.8}" y1="${y(B.plan.end)}" y2="${y(B.plan.end)}" stroke="var(--plan)" stroke-width="2" stroke-dasharray="4 3"/><text x="${lastX + bw * 0.4}" y="${y(B.plan.end) - 5}" text-anchor="middle" font-size="10.5" fill="var(--ink-2)">Plan ${M(B.plan.end)}</text>`;
    $('bridge-chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="ARR bridge from opening to closing ARR">${grid(sc.ticks, y, m.l, W - m.r, M)}${bars}${planLine}<text x="${m.l}" y="${m.t - 9}" font-size="10.5" fill="var(--muted)">Axis starts at ${M(sc.a)}</text></svg>`;
    const lbl = B.months > 1 ? 'annualized' : 'monthly, annualized';
    $('bridge-stats').innerHTML = [
      ['Net new ARR', fmtK(a.end - a.begin), `Plan ${fmtK(B.plan.end - B.plan.begin)}`],
      ['Gross retention', fmtPct(a.grr, 0), lbl],
      ['Net retention', fmtPct(a.nrr, 0), lbl],
    ].map(([k, v, s]) => `<div class="stat"><span>${k}</span><b>${v}</b><span>${s}</span></div>`).join('');
  }

  // ---------- Budget vs actual ----------
  function renderBva() {
    const { rows } = E.budgetVsActual(S.m, S.mode);
    const T = E.THRESHOLD[S.mode === 'ytd' ? 'ytd' : 'month'];
    $('bva-sub').textContent = `${E.periodLabel(S.m, S.mode)}. Variance is favourable when positive and shown in parentheses when unfavourable.`;
    const flagged = rows.filter((r) => r.flag).length;
    $('bva-flags').textContent = flagged ? `${flagged} line${flagged === 1 ? '' : 's'} over the review threshold` : 'No lines over the review threshold';
    $('bva-flags').className = 'chip ' + (flagged ? 'warn' : 'good');
    const sec = { subscription: 'Revenue', hosting: 'Cost of revenue', rd_people: 'Operating expenses', da: 'Below EBITDA' };
    const html = rows.map((r) => {
      const head = sec[r.id] ? `<tr class="sec"><td colspan="6">${sec[r.id]}</td></tr>` : '';
      const cls = [r.subtotal ? 'sub' : '', r.id === 'ebitda' ? 'key' : '', r.flag ? 'flag' : ''].join(' ');
      const vc = Math.abs(r.var) < 0.5 ? '' : r.var > 0 ? 'fav' : 'unfav';
      const marg = r.margin ? `<span class="m">${fmtPct(r.margin[0])} vs ${fmtPct(r.margin[1])} budget</span>` : '';
      const pctTxt = r.budget ? (r.var >= 0 ? '' : '(') + Math.abs(r.varPct * 100).toFixed(1) + '%' + (r.var >= 0 ? '' : ')') : '–';
      return `${head}<tr class="${cls}"><td>${esc(r.label)}${marg}</td><td>${num(r.actual)}</td><td>${num(r.budget)}</td><td class="${vc}">${num(r.var)}</td><td class="${vc}">${pctTxt}</td><td class="note">${r.flag ? esc(r.comment) : ''}</td></tr>`;
    }).join('');
    $('bva').innerHTML = `<table class="bva"><thead><tr><th>Line</th><th>Actual</th><th>Budget</th><th>Fav / (unfav)</th><th>%</th><th class="note">Variance commentary</th></tr></thead><tbody>${html}</tbody></table>`;
    $('bva-note').textContent = `Review threshold: variances of $${T.abs}k or more, or 10% of budget and at least $${T.floor}k, get commentary. A stripe on the left marks each one.`;
  }

  // ---------- Cash ----------
  function renderCash() {
    const C = E.COMPANY, F = E.CASH_FORECAST;
    const pts = [{ k: 'Dec', full: 'Dec 31, 2025', v: C.openingCash, kind: 'open' }]
      .concat(E.MONTHS.map((_, i) => ({ k: E.monthShort(i), full: `${E.monthShort(i)} month end`, v: E.BAL[i].cash, i })))
      .concat([{ k: 'Nov 13', full: 'Nov 13 (13-week forecast opening)', v: F.openingCash, kind: 'fc' }]);
    const W = 560, H = 230, m = { l: 48, r: 8, t: 14, b: 28 };
    const sc = scale(0, Math.max(...pts.map((p) => p.v)));
    const y = (v) => m.t + (1 - (v - sc.a) / (sc.b - sc.a)) * (H - m.t - m.b);
    const bw = (W - m.l - m.r) / pts.length;
    const bars = pts.map((p, j) => {
      const x = m.l + j * bw + bw * 0.16, w = bw * 0.68;
      const sel = p.i === S.m;
      const fill = p.kind === 'fc' ? 'var(--warn)' : p.kind === 'open' ? 'var(--line-strong)' : 'var(--accent)';
      const op = p.i != null && p.i > S.m ? 0.35 : 1;
      return `<path d="M${x} ${y(0)}V${y(p.v) + 4}q0 -4 4 -4h${w - 8}q4 0 4 4V${y(0)}Z" fill="${fill}" opacity="${op}"/>${sel ? `<text x="${x + w / 2}" y="${y(p.v) - 6}" text-anchor="middle" font-size="11" font-weight="600" fill="var(--ink)">${M(p.v)}</text>` : ''}<text x="${x + w / 2}" y="${H - 8}" text-anchor="middle" font-size="10.5" fill="${sel ? 'var(--ink)' : 'var(--muted)'}" font-weight="${sel ? 600 : 400}">${p.k}</text><rect class="hit" data-i="${j}" tabindex="0" x="${m.l + j * bw}" y="${m.t}" width="${bw}" height="${H - m.t - m.b}" fill="transparent"/>`;
    }).join('');
    const minL = `<line x1="${m.l}" x2="${W - m.r}" y1="${y(C.minimumCash)}" y2="${y(C.minimumCash)}" stroke="var(--bad)" stroke-width="1.5" stroke-dasharray="5 4"/>`;
    $('cash-chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cash balance by month with the Nov 13 forecast opening balance">${grid(sc.ticks, y, m.l, W - m.r, M)}${bars}${minL}</svg>`;
    const sel = pts.findIndex((p) => p.i === S.m);
    hover($('cash-chart'), $('cash-readout'), (j) => `<b>${pts[j].full}</b> · ${fmtK(pts[j].v)}${j > 0 ? ` · change ${fmtK(pts[j].v - pts[j - 1].v)}` : ''}`, () => `<b>${pts[sel].full}</b> · ${fmtK(pts[sel].v)} · minimum cash policy ${fmtK(C.minimumCash)}`);
    const L = E.liquidity(S.m);
    $('cash-stats').innerHTML = [
      ['Runway on cash', L.runway.toFixed(1) + ' mo', `${fmtK(L.burn)}/mo net burn`],
      ['With revolver', L.withRevolver.toFixed(1) + ' mo', '$4.0M undrawn at 7.25%'],
      ['13-week low point', fmtK(F.lowPoint), 'Jan 29, base case'],
      ['Downside revolver peak', fmtK(F.downsideRevolverPeak), 'Drawn from late January'],
    ].map(([k, v, s]) => `<div class="stat"><span>${k}</span><b>${v}</b><span>${s}</span></div>`).join('');
  }

  // ---------- Working capital ----------
  function renderWc() {
    const W0 = E.workingCapital(S.m), now = W0.now;
    $('wc-stats').innerHTML = [
      ['Accounts receivable', fmtK(now.ar), `DSO ${now.dso.toFixed(0)} days`],
      ['Accounts payable', fmtK(now.ap), `DPO ${now.dpo.toFixed(0)} days`],
      ['Deferred revenue', fmtK(now.deferred), 'Annual renewals, unearned'],
    ].map(([k, v, s]) => `<div class="stat"><span>${k}</span><b>${v}</b><span>${s}</span></div>`).join('');
    const ser = W0.series.slice(1); // January excluded: AR includes $1.2M of annual renewals billed Jan 1
    const box = $('wc-chart');
    if (ser.length < 2) {
      box.innerHTML = '<p class="table-note">The trend starts in February: January AR includes $1.2M of annual renewals billed on Jan 1 and collected in February.</p>';
      $('wc-readout').textContent = '';
    } else {
      const W = 560, H = 170, m = { l: 40, r: 50, t: 12, b: 26 };
      const sc = scale(30, 50, 4);
      const x = (k) => m.l + (k / (ser.length - 1)) * (W - m.l - m.r);
      const y = (v) => m.t + (1 - (v - sc.a) / (sc.b - sc.a)) * (H - m.t - m.b);
      const path = (f) => ser.map((s, k) => (k ? 'L' : 'M') + x(k) + ' ' + y(f(s))).join('');
      const last = ser[ser.length - 1];
      const xl = ser.map((s, k) => `<text x="${x(k)}" y="${H - 8}" text-anchor="middle" font-size="10.5" fill="var(--muted)">${E.monthShort(s.i)}</text>`).join('');
      const colW = (W - m.l - m.r) / Math.max(1, ser.length - 1);
      const hits = ser.map((s, k) => `<rect class="hit" data-i="${k}" tabindex="0" x="${x(k) - colW / 2}" y="${m.t}" width="${colW}" height="${H - m.t - m.b}" fill="transparent"/>`).join('');
      box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="DSO and DPO by month">${grid(sc.ticks, y, m.l, W - m.r, (v) => v + 'd')}<path d="${path((s) => s.dpo)}" fill="none" stroke="var(--plan)" stroke-width="2" stroke-dasharray="6 4"/><path d="${path((s) => s.dso)}" fill="none" stroke="var(--accent)" stroke-width="2.25"/><circle cx="${x(ser.length - 1)}" cy="${y(last.dso)}" r="4" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/><text x="${x(ser.length - 1) + 8}" y="${y(last.dso) + 4}" font-size="11" font-weight="600" fill="var(--ink)">${last.dso.toFixed(0)}d</text><text x="${x(ser.length - 1) + 8}" y="${y(last.dpo) + 4}" font-size="11" fill="var(--ink-2)">${last.dpo.toFixed(0)}d</text>${xl}${hits}</svg>`;
      hover(box, $('wc-readout'), (k) => `<b>${E.monthName(ser[k].i)}</b> · DSO ${ser[k].dso.toFixed(1)} days on AR of ${fmtK(ser[k].ar)} · DPO ${ser[k].dpo.toFixed(1)} days on AP of ${fmtK(ser[k].ap)}`,
        () => 'DSO = AR ÷ month revenue × days. DPO = AP ÷ month non-payroll spend × days. January is left out of the trend because of annual renewal billing.');
    }
    const colors = ['var(--accent)', 'var(--line-strong)', 'var(--warn)', 'var(--bad)', 'var(--ink)'];
    $('aging-sub').textContent = `${fmtK(W0.agingTotal)} open across 21 invoices; ${fmtPct(W0.pastDuePct, 0)} (${fmtK(W0.pastDue)}) is past due. Same invoices as the 13-week cash forecast.`;
    $('aging').setAttribute('aria-label', 'AR aging by bucket: ' + W0.aging.map((b) => `${b.bucket} ${fmtK(b.amt)}`).join(', '));
    $('aging').innerHTML = W0.aging.map((b, k) => `<span style="flex:${b.amt} 1 0;background:${colors[k]}" title="${b.bucket}: ${fmtK(b.amt)}"></span>`).join('');
    $('aging-legend').innerHTML = W0.aging.map((b, k) => `<div><span><i style="background:${colors[k]}"></i>${b.bucket}</span><b>${fmtK(b.amt)}</b></div>`).join('');
  }

  // ---------- People and spend ----------
  function renderPeople() {
    const D = E.departments(S.m, S.mode);
    const max = Math.max(...D.map((d) => Math.max(d.spend, d.spendBudget)));
    $('depts').innerHTML = D.map((d) => {
      const v = d.var, cls = v >= 0 ? 'fav' : 'unfav';
      return `<div class="dept"><div class="h"><b>${d.label}</b><span>${fmtK(d.spend)} vs ${fmtK(d.spendBudget)} · <span style="color:var(--${cls === 'fav' ? 'good' : 'bad'})">${v >= 0 ? fmtK(v) + ' under' : fmtK(-v) + ' over'}</span></span></div><div class="bar" role="img" aria-label="${d.label} spend ${fmtK(d.spend)} against budget ${fmtK(d.spendBudget)}"><div class="fill" style="width:${(d.spend / max * 100).toFixed(1)}%"></div><div class="tick" style="left:calc(${(d.spendBudget / max * 100).toFixed(1)}% - 1px)"></div></div></div>`;
    }).join('');
    const tot = D.reduce((s, d) => s + d.heads, 0), totB = D.reduce((s, d) => s + d.headsBudget, 0);
    $('hc-chip').textContent = `${tot} employees · ${totB - tot} open roles vs budget`;
    $('hc-chip').className = 'chip ' + (totB - tot > 5 ? 'warn' : 'good');
    $('hc-table').innerHTML = `<table class="mini"><thead><tr><th>Headcount at ${E.monthShort(S.m)} month end</th><th>Actual</th><th>Budget</th><th>Open</th></tr></thead><tbody>${D.map((d) => `<tr><td>${d.label}</td><td>${d.heads}</td><td>${d.headsBudget}</td><td>${d.headsBudget - d.heads}</td></tr>`).join('')}<tr class="sub"><td><b>Total</b></td><td><b>${tot}</b></td><td><b>${totB}</b></td><td><b>${totB - tot}</b></td></tr></tbody></table>`;
  }

  // ---------- Close ----------
  function renderClose() {
    const C = E.close(S.m), n = C.now, p = C.prev;
    const delta = (a, b, unit = '') => (b == null ? 'First month tracked' : a === b ? 'Same as last month' : `${a < b ? 'Down' : 'Up'} ${Math.abs(a - b)}${unit} from last month`);
    $('close-stats').innerHTML = [
      ['Days to close', n.days + ' days', delta(n.days, p && p.days)],
      ['Open reconciling items', n.openItems, `${n.agedItems} older than 60 days`],
      ['Manual journal entries', n.manualJEs, delta(n.manualJEs, p && p.manualJEs)],
      ['Post-close adjustments', n.postClose, `${n.onTimePct}% of accounts reconciled on time`],
    ].map(([k, v, s]) => `<div class="stat"><span>${k}</span><b>${v}</b><span>${s}</span></div>`).join('');
    const ser = C.series;
    const W = 560, H = 160, m = { l: 34, r: 8, t: 12, b: 26 };
    const sc = { a: 0, b: 10, ticks: [0, 5, 10] };
    const y = (v) => m.t + (1 - v / sc.b) * (H - m.t - m.b);
    const bw = (W - m.l - m.r) / E.N;
    const bars = E.CLOSE.map((c, i) => {
      const x = m.l + i * bw + bw * 0.2, w = bw * 0.6, on = i <= S.m;
      return `<path d="M${x} ${y(0)}V${y(c.days) + 4}q0 -4 4 -4h${w - 8}q4 0 4 4V${y(0)}Z" fill="${c.days <= C.target ? 'var(--accent)' : 'var(--line-strong)'}" opacity="${on ? 1 : 0.3}"/><text x="${x + w / 2}" y="${H - 8}" text-anchor="middle" font-size="10.5" fill="${i === S.m ? 'var(--ink)' : 'var(--muted)'}" font-weight="${i === S.m ? 600 : 400}">${E.monthShort(i)}</text><rect class="hit" data-i="${i}" tabindex="0" x="${m.l + i * bw}" y="${m.t}" width="${bw}" height="${H - m.t - m.b}" fill="transparent"/>`;
    }).join('');
    const tgt = `<line x1="${m.l}" x2="${W - m.r}" y1="${y(C.target)}" y2="${y(C.target)}" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="5 4"/>`;
    $('close-chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Business days to close by month against the five-day target">${grid(sc.ticks, y, m.l, W - m.r, (v) => v + 'd')}${bars}${tgt}</svg>`;
    hover($('close-chart'), $('close-readout'), (i) => { const c = E.CLOSE[i]; return `<b>${E.monthName(i)} close</b> · ${c.days} business days · ${c.openItems} open reconciling items · ${c.manualJEs} manual JEs · ${c.postClose} post-close adjustments`; },
      () => `Close went from ${E.CLOSE[0].days} days in January to ${n.days} in ${E.monthName(S.m)}. Teal bars met the ${C.target}-day target.`);
  }

  // ---------- Checks ----------
  function renderChecks() {
    const ch = E.checks(S.m);
    const ok = ch.every((c) => c.pass);
    $('checks-chip').textContent = ok ? `All ${ch.length} checks pass` : `${ch.filter((c) => !c.pass).length} check(s) failed`;
    $('checks-chip').className = 'chip ' + (ok ? 'good' : 'bad');
    $('checks').innerHTML = ch.map((c) => `<li><span class="chip ${c.pass ? 'good' : 'bad'}">${c.pass ? 'Pass' : 'Fail'}</span><b>${esc(c.name)}</b><span>${esc(c.detail)}</span></li>`).join('');
  }

  render();
})();
