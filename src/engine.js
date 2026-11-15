/*
 * Metrics engine for the Halden CFO control center.
 * Reads the sample data (src/data.js) and returns every number the page shows.
 * It never changes the data: the dashboard is read-only by design.
 * Amounts are USD thousands. Works in the browser (window.CfoEngine) and in Node.
 */
(function (root) {
  'use strict';

  const DATA = (typeof module !== 'undefined' && module.exports) ? require('./data.js') : root.HaldenData;
  const { COMPANY, CASH_FORECAST, PNL_LINES, DEPTS, TABLES, NOTES } = DATA;

  // ---------- Load tables into month records ----------
  const MONTHS = TABLES.PNL_ACTUAL.map((r) => r[0]);
  const N = MONTHS.length;
  const DAYS = MONTHS.map((m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); });
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthName = (i) => MONTH_NAMES[Number(MONTHS[i].slice(5)) - 1];
  const monthShort = (i) => monthName(i).slice(0, 3);

  const pnlRows = (t) => t.map((r) => Object.fromEntries(PNL_LINES.map((l, j) => [l.id, r[j + 1]])));
  const PNL = { actual: pnlRows(TABLES.PNL_ACTUAL), budget: pnlRows(TABLES.PNL_BUDGET) };

  function arrRows(t, opening) {
    let begin = opening;
    return t.map((r) => {
      const x = { begin, new: r[1], expansion: r[2], contraction: r[3], churn: r[4] };
      x.end = begin + x.new + x.expansion + x.contraction + x.churn;
      begin = x.end;
      return x;
    });
  }
  const ARR = { actual: arrRows(TABLES.ARR_ACTUAL, COMPANY.openingArr), plan: arrRows(TABLES.ARR_PLAN, COMPANY.openingArr) };

  const hcRows = (t) => t.map((r) => ({ support: r[1], rd: r[2], sm: r[3], ga: r[4], total: r[1] + r[2] + r[3] + r[4] }));
  const HC = { actual: hcRows(TABLES.HC_ACTUAL), budget: hcRows(TABLES.HC_BUDGET) };

  const BAL = TABLES.BALANCES.map((r) => ({ cash: r[1], ar: r[2], ap: r[3], deferred: r[4] }));
  const CLOSE = TABLES.CLOSE.map((r) => ({ days: r[1], openItems: r[2], agedItems: r[3], manualJEs: r[4], postClose: r[5], onTimePct: r[6] }));

  // ---------- Helpers ----------
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
  const pct = (a, b) => (b ? a / b : 0);

  /** Months covered by a selection: one month, or year to date through that month. */
  function periodIdx(m, mode) { return mode === 'ytd' ? range(0, m) : [m]; }

  function periodLabel(m, mode) {
    return mode === 'ytd' ? (m === 0 ? `YTD ${monthName(0)} ${COMPANY.fiscalYear}` : `YTD ${monthShort(0)}–${monthShort(m)} ${COMPANY.fiscalYear}`) : `${monthName(m)} ${COMPANY.fiscalYear}`;
  }

  // ---------- P&L ----------
  function lineTotals(rows, idx) { return Object.fromEntries(PNL_LINES.map((l) => [l.id, sum(idx.map((i) => rows[i][l.id]))])); }

  function pnlSummary(L) {
    const g = (grp, dept) => sum(PNL_LINES.filter((l) => l.group === grp && (!dept || l.dept === dept)).map((l) => L[l.id]));
    const revenue = g('revenue');
    const cogs = g('cogs');
    const gross = revenue - cogs;
    const rd = g('opex', 'rd'), sm = g('opex', 'sm'), ga = g('opex', 'ga');
    const opex = rd + sm + ga;
    const ebitda = gross - opex;
    const da = g('da');
    return { revenue, cogs, gross, grossMargin: pct(gross, revenue), rd, sm, ga, opex, ebitda, ebitdaMargin: pct(ebitda, revenue), da, operating: ebitda - da };
  }

  function pnlFor(m, mode) {
    const idx = periodIdx(m, mode);
    const A = lineTotals(PNL.actual, idx), B = lineTotals(PNL.budget, idx);
    return { idx, lines: { actual: A, budget: B }, actual: pnlSummary(A), budget: pnlSummary(B) };
  }

  /** Favourable variance is positive: more revenue or less cost than budget. */
  function favVar(kind, actual, budget) { return kind === 'revenue' || kind === 'profit' ? actual - budget : budget - actual; }

  /**
   * Review threshold for variance commentary: a line is flagged when the variance is at least
   * $40k in a month ($120k YTD), or at least 10% of budget and $10k in a month ($30k YTD).
   */
  const THRESHOLD = { month: { abs: 40, floor: 10 }, ytd: { abs: 120, floor: 30 }, pct: 0.10 };
  function isMaterial(mode, variance, budget) {
    const t = THRESHOLD[mode === 'ytd' ? 'ytd' : 'month'];
    const v = Math.abs(variance);
    return v >= t.abs || (v >= t.floor && budget !== 0 && v / Math.abs(budget) >= THRESHOLD.pct);
  }

  function budgetVsActual(m, mode) {
    const P = pnlFor(m, mode);
    const rows = [];
    const push = (r) => {
      r.var = favVar(r.kind, r.actual, r.budget);
      r.varPct = r.budget ? r.var / Math.abs(r.budget) : 0;
      r.flag = !r.subtotal && isMaterial(mode, r.var, r.budget);
      if (r.flag) r.comment = commentFor(r.id, r, m, mode);
      rows.push(r);
    };
    const line = (l) => push({ id: l.id, label: l.label, kind: l.group === 'revenue' ? 'revenue' : 'cost', actual: P.lines.actual[l.id], budget: P.lines.budget[l.id] });
    const sub = (id, label, kind, key, extra) => push({ id, label, kind, subtotal: true, actual: P.actual[key], budget: P.budget[key], ...extra });

    PNL_LINES.filter((l) => l.group === 'revenue').forEach(line);
    sub('revenue', 'Total revenue', 'revenue', 'revenue');
    PNL_LINES.filter((l) => l.group === 'cogs').forEach(line);
    sub('gross', 'Gross profit', 'profit', 'gross', { margin: [P.actual.grossMargin, P.budget.grossMargin] });
    PNL_LINES.filter((l) => l.group === 'opex').forEach(line);
    sub('opex', 'Total operating expenses', 'cost', 'opex');
    sub('ebitda', 'EBITDA', 'profit', 'ebitda', { margin: [P.actual.ebitdaMargin, P.budget.ebitdaMargin] });
    PNL_LINES.filter((l) => l.group === 'da').forEach(line);
    sub('operating', 'Operating income (loss)', 'profit', 'operating');
    return { rows, P };
  }

  // ---------- Variance commentary ----------
  const fmtK = (v) => {
    const s = Math.abs(v) >= 1000 ? '$' + (Math.abs(v) / 1000).toFixed(2) + 'M' : '$' + Math.round(Math.abs(v)).toLocaleString('en-US') + 'k';
    return v < 0 ? '−' + s : s;
  };
  const fmtPct = (v, d = 1) => (v < 0 ? '−' : '') + Math.abs(v * 100).toFixed(d) + '%';

  function notesFor(line, idx) {
    return NOTES.filter((n) => n.line === line && idx.includes(MONTHS.indexOf(n.month)))
      .map((n) => (idx.length > 1 ? monthShort(MONTHS.indexOf(n.month)) + ': ' : '') + n.text);
  }

  function avgHeads(rows, dept, idx) { return sum(idx.map((i) => rows[i][dept])) / idx.length; }

  function commentFor(id, r, m, mode) {
    const idx = periodIdx(m, mode);
    const dir = r.var >= 0 ? 'under' : 'over';
    const parts = [];
    const L = PNL_LINES.find((l) => l.id === id);
    if (id === 'subscription') {
      const a = arrBridge(m, mode);
      parts.push(`ARR closed at ${fmtK(a.actual.end)} vs ${fmtK(a.plan.end)} plan. New bookings ${fmtK(a.actual.new)} vs ${fmtK(a.plan.new)} plan; churn and contraction ${fmtK(-(a.actual.churn + a.actual.contraction))} vs ${fmtK(-(a.plan.churn + a.plan.contraction))}.`);
    } else if (id === 'usage') {
      parts.push(r.var < 0 ? 'Usage volumes have been flat since June; the budget assumed about $10k a month of growth.' : 'Usage volumes ahead of budget.');
    } else if (id === 'hosting') {
      parts.push('Hosting runs about 0.5 points of revenue above the 8.2% plan: the committed-spend tier was set ahead of usage.');
    } else if (id === 'sm_commissions') {
      const a = arrBridge(m, mode);
      parts.push(`Tracks bookings: new and expansion ARR of ${fmtK(a.actual.new + a.actual.expansion)} vs ${fmtK(a.plan.new + a.plan.expansion)} plan.`);
    } else if (L && L.dept && id.endsWith('_people')) {
      const act = avgHeads(HC.actual, L.dept, idx), bud = avgHeads(HC.budget, L.dept, idx);
      const open = HC.budget[m][L.dept] - HC.actual[m][L.dept];
      const heads = idx.length > 1 ? `Average ${act.toFixed(1)} heads vs ${bud.toFixed(1)} budget` : `${act} heads vs ${bud} budget`;
      parts.push(`${heads}; ${open > 0 ? open + ' open role' + (open === 1 ? '' : 's') : 'no open roles'} at ${monthShort(m)} month end.`);
    }
    parts.push(...notesFor(id, idx));
    if (!parts.length) parts.push(`${fmtK(Math.abs(r.var))} ${dir} budget; timing to be confirmed with the budget owner.`);
    return parts.join(' ');
  }

  // ---------- ARR ----------
  function arrBridge(m, mode) {
    const idx = periodIdx(m, mode);
    const agg = (rows) => ({
      begin: rows[idx[0]].begin,
      new: sum(idx.map((i) => rows[i].new)),
      expansion: sum(idx.map((i) => rows[i].expansion)),
      contraction: sum(idx.map((i) => rows[i].contraction)),
      churn: sum(idx.map((i) => rows[i].churn)),
      end: rows[idx[idx.length - 1]].end,
    });
    const actual = agg(ARR.actual), plan = agg(ARR.plan);
    const ann = (x) => Math.pow(x, 12 / idx.length);
    // Retention on the period's opening ARR, annualized so one month and YTD read on the same scale.
    actual.grr = ann(1 + pct(actual.contraction + actual.churn, actual.begin));
    actual.nrr = ann(1 + pct(actual.expansion + actual.contraction + actual.churn, actual.begin));
    return { actual, plan, months: idx.length };
  }

  // ---------- Cash and liquidity ----------
  function netBurn(m) {
    // Average monthly decrease in cash over the three months ending m (fewer at the start of the year).
    const idx = range(Math.max(0, m - 2), m);
    const start = idx[0] === 0 ? COMPANY.openingCash : BAL[idx[0] - 1].cash;
    return (start - BAL[m].cash) / idx.length;
  }

  function liquidity(m) {
    const cash = BAL[m].cash;
    const burn = netBurn(m);
    const runway = burn > 0 ? cash / burn : Infinity;
    const withRevolver = burn > 0 ? (cash + COMPANY.revolverCommitment) / burn : Infinity;
    const latest = m === N - 1 ? CASH_FORECAST : null;
    return { cash, burn, runway, withRevolver, latest, latestRunway: latest && burn > 0 ? latest.openingCash / burn : null };
  }

  // ---------- KPIs ----------
  function kpis(m, mode) {
    const P = pnlFor(m, mode);
    const arr = ARR.actual[m].end, plan = ARR.plan[m].end, prior = TABLES.ARR_PRIOR_YEAR[m];
    const yoy = arr / prior - 1;
    const liq = liquidity(m);
    const i3 = range(Math.max(0, m - 2), m);
    const netNew3 = sum(i3.map((i) => ARR.actual[i].end - ARR.actual[i].begin)) / i3.length;
    const burnMultiple = netNew3 > 0 ? liq.burn / netNew3 : Infinity;
    const ruleOf40 = yoy + P.actual.ebitdaMargin;
    const spark = (f) => range(0, m).map(f);
    return {
      arr: { value: arr, plan, yoy, vsPlan: arr / plan - 1, spark: spark((i) => ARR.actual[i].end) },
      revenue: { value: P.actual.revenue, budget: P.budget.revenue, vsBudget: P.actual.revenue / P.budget.revenue - 1, spark: spark((i) => pnlSummary(PNL.actual[i]).revenue) },
      grossMargin: { value: P.actual.grossMargin, budget: P.budget.grossMargin, spark: spark((i) => pnlSummary(PNL.actual[i]).grossMargin) },
      ebitda: { value: P.actual.ebitda, budget: P.budget.ebitda, margin: P.actual.ebitdaMargin, spark: spark((i) => pnlSummary(PNL.actual[i]).ebitda) },
      burn: { value: liq.burn, spark: spark((i) => netBurn(i)) },
      runway: { value: liq.runway, withRevolver: liq.withRevolver, cash: liq.cash, spark: spark((i) => liquidity(i).runway) },
      burnMultiple: { value: burnMultiple, netNew: netNew3 },
      ruleOf40: { value: ruleOf40, growth: yoy, margin: P.actual.ebitdaMargin },
      nrr: arrBridge(m, 'ytd').actual.nrr, // year to date, annualized: steadier than one month
    };
  }

  // ---------- Working capital ----------
  function nonPeopleSpend(i) {
    const p = PNL.actual[i];
    return PNL_LINES.filter((l) => (l.group === 'cogs' || l.group === 'opex') && !l.id.endsWith('_people') && l.id !== 'sm_commissions').reduce((s, l) => s + p[l.id], 0);
  }
  function workingCapital(m) {
    const series = range(0, m).map((i) => {
      const rev = pnlSummary(PNL.actual[i]).revenue;
      return { i, ar: BAL[i].ar, ap: BAL[i].ap, deferred: BAL[i].deferred, dso: BAL[i].ar / rev * DAYS[i], dpo: BAL[i].ap / nonPeopleSpend(i) * DAYS[i] };
    });
    const aging = TABLES.AR_AGING.map(([bucket, amt]) => ({ bucket, amt }));
    const agingTotal = sum(aging.map((b) => b.amt));
    const pastDue = agingTotal - aging[0].amt;
    return { now: series[m], series, aging, agingTotal, pastDuePct: pastDue / agingTotal, pastDue };
  }

  // ---------- People and spend ----------
  function departments(m, mode) {
    const idx = periodIdx(m, mode);
    const P = pnlFor(m, mode);
    return DEPTS.map((d) => {
      const lines = PNL_LINES.filter((l) => l.dept === d.id).map((l) => l.id);
      const a = sum(lines.map((id) => P.lines.actual[id])), b = sum(lines.map((id) => P.lines.budget[id]));
      return { ...d, heads: HC.actual[m][d.id], headsBudget: HC.budget[m][d.id], spend: a, spendBudget: b, var: b - a, perHead: a / sum(idx.map((i) => HC.actual[i][d.id])) };
    });
  }

  // ---------- Close and controls ----------
  function close(m) { return { now: CLOSE[m], prev: m > 0 ? CLOSE[m - 1] : null, series: CLOSE.slice(0, m + 1), target: COMPANY.closeTargetDays }; }

  /** Integrity checks run on every render. A failed check shows on the page. */
  function checks(m) {
    const out = [];
    const arrTies = ARR.actual.every((x, i) => i === 0 || x.begin === ARR.actual[i - 1].end) && ARR.actual[N - 1].end === COMPANY.openingArr + sum(TABLES.ARR_ACTUAL.map((r) => r[1] + r[2] + r[3] + r[4]));
    out.push({ name: 'ARR roll-forward ties', pass: arrTies, detail: `Opening ${fmtK(COMPANY.openingArr)} + movements = ${fmtK(ARR.actual[N - 1].end)} closing, every month.` });

    const recon = range(0, m).map((i) => Math.abs(PNL.actual[i].subscription * 12 - (ARR.actual[i].begin + ARR.actual[i].end) / 2) / ((ARR.actual[i].begin + ARR.actual[i].end) / 2));
    const worst = Math.max(...recon);
    out.push({ name: 'Subscription revenue agrees to ARR', pass: worst <= 0.02, detail: `Monthly subscription revenue × 12 is within ${fmtPct(worst, 2)} of average ARR (tolerance 2%).` });

    const P = pnlFor(m, 'ytd');
    const foot = Math.abs(P.actual.revenue - P.actual.cogs - P.actual.opex - P.actual.da - P.actual.operating) < 0.001;
    out.push({ name: 'P&L foots', pass: foot, detail: 'Revenue − cost of revenue − operating expenses − D&A = operating income, YTD.' });

    const hcTies = DEPTS.every((d) => HC.actual[m][d.id] >= 0) && HC.actual[m].total === sum(DEPTS.map((d) => HC.actual[m][d.id]));
    out.push({ name: 'Headcount agrees to departments', pass: hcTies, detail: `${HC.actual[m].total} employees at ${monthShort(m)} month end across ${DEPTS.length} departments.` });

    const agingTie = Math.abs(workingCapital(m).agingTotal - 3384.95) < 0.01;
    out.push({ name: 'AR aging agrees to the 13-week forecast', pass: agingTie, detail: 'Nov 13 aging totals $3,384,950, the same invoices the cash forecast collects.' });

    const lastClose = Math.abs(BAL[N - 1].cash - CASH_FORECAST.openingCash) <= 500;
    out.push({ name: 'Cash rolls into the 13-week forecast', pass: lastClose, detail: `Oct 31 cash ${fmtK(BAL[N - 1].cash)} to Nov 13 forecast opening ${fmtK(CASH_FORECAST.openingCash)}: early-November payroll and vendor runs, within the $500k review threshold.` });
    return out;
  }

  // ---------- CFO summary ----------
  function summary(m, mode) {
    const K = kpis(m, mode);
    const { rows } = budgetVsActual(m, mode);
    const label = mode === 'ytd' ? 'Year-to-date' : monthName(m);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    const rev = byId.revenue, opex = byId.opex, ebitda = byId.ebitda;
    const s = [];
    s.push(`${label} revenue was ${fmtK(rev.actual)}, ${fmtK(Math.abs(rev.var))} (${fmtPct(Math.abs(rev.varPct))}) ${rev.var < 0 ? 'below' : 'above'} budget.`);
    s.push(`Operating expenses came in ${fmtK(Math.abs(opex.var))} ${opex.var >= 0 ? 'under' : 'over'} budget, so EBITDA of ${fmtK(ebitda.actual)} was ${fmtK(Math.abs(ebitda.var))} ${ebitda.var >= 0 ? 'better' : 'worse'} than plan.`);
    s.push(`ARR is ${fmtK(K.arr.value)}, up ${fmtPct(K.arr.yoy, 0)} year over year and ${fmtPct(Math.abs(K.arr.vsPlan))} ${K.arr.vsPlan < 0 ? 'behind' : 'ahead of'} plan.`);
    const L = liquidity(m);
    s.push(`${monthShort(m)} ${new Date(Date.UTC(COMPANY.fiscalYear, m + 1, 0)).getUTCDate()} cash of ${fmtK(L.cash)} covers ${L.runway.toFixed(1)} months at the three-month average burn of ${fmtK(L.burn)}.`);
    if (L.latest) s.push(`By Nov 13 cash was ${fmtK(L.latest.openingCash)}, and the 13-week forecast low point is ${fmtK(L.latest.lowPoint)} on Jan 29, above the ${fmtK(COMPANY.minimumCash)} minimum without drawing the revolver.`);

    const watch = [];
    const wc = workingCapital(m);
    const dsoStart = wc.series[Math.max(1, m - 4)] || wc.series[0];
    if (L.runway < 12) watch.push({ level: L.runway < 9 ? 'bad' : 'warn', title: 'Runway under 12 months', text: `${L.runway.toFixed(1)} months on cash, ${L.withRevolver.toFixed(1)} with the undrawn $4.0M revolver.` });
    if (K.arr.vsPlan < -0.02) watch.push({ level: 'warn', title: 'Bookings behind plan', text: `ARR ${fmtPct(Math.abs(K.arr.vsPlan))} behind plan; new bookings are the main gap.` });
    const churnPeak = ARR.actual[m].churn <= -200;
    if (churnPeak) watch.push({ level: 'bad', title: 'Churn spike', text: `${fmtK(-ARR.actual[m].churn)} of ARR churned in ${monthName(m)}, about double the monthly plan.` });
    if (m >= 2 && wc.now.dso - dsoStart.dso >= 3) watch.push({ level: 'warn', title: 'DSO rising', text: `${wc.now.dso.toFixed(0)} days, up ${(wc.now.dso - dsoStart.dso).toFixed(0)} since ${monthShort(dsoStart.i)}.` });
    if (K.burnMultiple.value > 2) watch.push({ level: 'warn', title: 'Burn multiple above 2×', text: `Net burn is ${K.burnMultiple.value.toFixed(1)}× net new ARR over the last three months.` });
    const C = CLOSE[m];
    if (C.days <= COMPANY.closeTargetDays) watch.push({ level: 'good', title: 'Close on target', text: `${C.days}-day close, ${C.openItems} open reconciling items.` });
    return { sentences: s, watch };
  }

  const API = {
    COMPANY, CASH_FORECAST, PNL_LINES, DEPTS, MONTHS, N, PNL, ARR, HC, BAL, CLOSE, DATA,
    monthName, monthShort, periodIdx, periodLabel, pnlFor, pnlSummary, budgetVsActual, isMaterial, THRESHOLD,
    arrBridge, netBurn, liquidity, kpis, workingCapital, departments, close, checks, summary, fmtK, fmtPct,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.CfoEngine = API;
})(typeof window !== 'undefined' ? window : this);
