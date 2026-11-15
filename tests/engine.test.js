// Run with: npm test   (Node 18+, no dependencies)
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');
const last = E.N - 1;

test('every integrity check passes for every month', () => {
  for (let m = 0; m < E.N; m++) E.checks(m).forEach((c) => assert.ok(c.pass, `${E.monthShort(m)}: ${c.name}`));
});

test('ARR roll-forward ties month to month and to the closing balance', () => {
  E.ARR.actual.forEach((x, i) => {
    assert.equal(x.end, x.begin + x.new + x.expansion + x.contraction + x.churn);
    if (i) assert.equal(x.begin, E.ARR.actual[i - 1].end);
  });
  assert.equal(E.ARR.actual[last].end, 22025);
});

test('year to date equals the sum of the months', () => {
  const ytd = E.pnlFor(last, 'ytd').actual;
  let rev = 0, ebitda = 0;
  for (let m = 0; m < E.N; m++) { const p = E.pnlFor(m, 'month').actual; rev += p.revenue; ebitda += p.ebitda; }
  assert.equal(ytd.revenue, rev);
  assert.equal(ytd.ebitda, ebitda);
});

test('variance sign: favourable is positive for revenue and for cost savings', () => {
  const { rows } = E.budgetVsActual(last, 'month');
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(by.revenue.var, by.revenue.actual - by.revenue.budget);
  assert.equal(by.opex.var, by.opex.budget - by.opex.actual);
  assert.ok(by.revenue.var < 0 && by.opex.var > 0);
});

test('every flagged line has commentary, and only lines over the threshold are flagged', () => {
  for (const mode of ['month', 'ytd']) {
    for (let m = 0; m < E.N; m++) {
      E.budgetVsActual(m, mode).rows.forEach((r) => {
        if (r.subtotal) return assert.ok(!r.flag);
        assert.equal(r.flag, E.isMaterial(mode, r.var, r.budget));
        if (r.flag) assert.ok(r.comment && r.comment.length > 20, `${r.id} ${m} ${mode} needs commentary`);
      });
    }
  }
});

test('runway and burn use the three-month average fall in cash', () => {
  const L = E.liquidity(last);
  assert.equal(L.burn, (E.BAL[last - 3].cash - E.BAL[last].cash) / 3);
  assert.ok(Math.abs(L.runway - L.cash / L.burn) < 1e-9);
  assert.ok(L.runway < 12 && L.withRevolver > 12);
});

test('cash and AR hand off to the 13-week forecast', () => {
  assert.equal(E.CASH_FORECAST.openingCash, 4750);
  const wc = E.workingCapital(last);
  assert.ok(Math.abs(wc.agingTotal - 3384.95) < 0.01);
  assert.ok(E.CASH_FORECAST.lowPoint > E.COMPANY.minimumCash);
});

test('the engine never changes the source data', () => {
  const before = JSON.stringify(E.DATA.TABLES);
  for (let m = 0; m < E.N; m++) { E.summary(m, 'month'); E.summary(m, 'ytd'); E.kpis(m, 'ytd'); E.departments(m, 'ytd'); }
  assert.equal(JSON.stringify(E.DATA.TABLES), before);
});
