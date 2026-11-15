// Writes the sample data in src/data.js to CSV files in data/, so it can be reviewed in Excel.
// Amounts are USD thousands. Usage: npm run data
const fs = require('fs');
const path = require('path');
const { COMPANY, CASH_FORECAST, PNL_LINES, TABLES, NOTES } = require('../src/data.js');
const out = path.join(__dirname, '..', 'data');
fs.mkdirSync(out, { recursive: true });

const cell = (v) => (typeof v === 'string' && /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : String(v));
const write = (name, header, rows) => {
  fs.writeFileSync(path.join(out, name), [header, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n');
  console.log('Wrote data/' + name, rows.length + ' rows');
};

// P&L in long format (month, line, actual, budget), the shape a GL export usually takes.
const pnl = [];
TABLES.PNL_ACTUAL.forEach((r, i) => PNL_LINES.forEach((l, j) => pnl.push([r[0], l.id, l.label, l.group, l.dept || '', r[j + 1], TABLES.PNL_BUDGET[i][j + 1]])));
write('pnl_by_month.csv', ['month', 'line_id', 'line', 'group', 'department', 'actual_usd_k', 'budget_usd_k'], pnl);

write('arr_rollforward.csv', ['month', 'scenario', 'new', 'expansion', 'contraction', 'churn'],
  [...TABLES.ARR_ACTUAL.map((r) => [r[0], 'actual', ...r.slice(1)]), ...TABLES.ARR_PLAN.map((r) => [r[0], 'plan', ...r.slice(1)])]);
write('arr_prior_year.csv', ['month', 'arr_usd_k'], TABLES.ARR_PRIOR_YEAR.map((v, i) => [`2025-${String(i + 1).padStart(2, '0')}`, v]));
write('headcount.csv', ['month', 'scenario', 'support', 'rd', 'sm', 'ga'],
  [...TABLES.HC_ACTUAL.map((r) => [r[0], 'actual', ...r.slice(1)]), ...TABLES.HC_BUDGET.map((r) => [r[0], 'budget', ...r.slice(1)])]);
write('balances.csv', ['month', 'cash_usd_k', 'accounts_receivable_usd_k', 'accounts_payable_usd_k', 'deferred_revenue_usd_k'], TABLES.BALANCES);
write('close_kpis.csv', ['month', 'days_to_close', 'open_reconciling_items', 'items_over_60_days', 'manual_journal_entries', 'post_close_adjustments', 'accounts_reconciled_on_time_pct'], TABLES.CLOSE);
write('ar_aging_nov13.csv', ['bucket', 'balance_usd_k'], TABLES.AR_AGING);
write('variance_notes.csv', ['month', 'line_id', 'note'], NOTES.map((n) => [n.month, n.line, n.text]));
write('company.csv', ['item', 'value'], [...Object.entries(COMPANY), ...Object.entries(CASH_FORECAST).map(([k, v]) => ['cash_forecast_' + k, v])]);
