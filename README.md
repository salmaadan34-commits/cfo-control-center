# CFO Control Center

A one-page CFO dashboard for a mid-size B2B SaaS company. It puts the numbers a CFO reviews after month-end close in one place: ARR against plan, budget vs actual with variance commentary, cash runway, working capital, headcount and spend by department, and close and controls KPIs.

Everything runs in the browser with no dependencies. All company, customer and financial data is synthetic.

**Live demo:** [salmaadan34-commits.github.io/cfo-control-center](https://salmaadan34-commits.github.io/cfo-control-center/)

Companion project: the [13-week cash flow forecast](https://github.com/salmaadan34-commits/13-week-cash-flow) for the same company. The two share cash, AR and treasury policy figures, and this dashboard checks that they agree.

---

## What it shows

| Section | What a reviewer sees |
| --- | --- |
| CFO summary | Four or five plain-English sentences on revenue, spend, EBITDA, ARR and cash, written from the numbers, plus a watch list with Act / Watch / On track status |
| KPI tiles | ARR, revenue, gross margin, EBITDA, net burn, runway, burn multiple and Rule of 40, each against budget or a benchmark, with a sparkline |
| ARR vs plan | Monthly ARR against the board plan, with hover detail and the underlying roll-forward as a table |
| ARR bridge | Opening ARR, new, expansion, contraction, churn and closing ARR for the period, with gross and net revenue retention |
| Budget vs actual | Full P&L by line with favourable / (unfavourable) variance and automatic commentary on every line over the review threshold |
| Cash and runway | Month-end cash, the Nov 13 balance from the 13-week forecast, minimum cash policy, runway with and without the revolver |
| Working capital | AR, DSO, AP, DPO and deferred revenue, a DSO/DPO trend and the AR aging by bucket |
| People and spend | Headcount and open roles by department, and department spend against budget |
| Close and controls | Days to close against a five-day target, open reconciling items, manual journal entries, post-close adjustments |
| Data integrity checks | Six checks run on every render: ARR roll-forward, revenue-to-ARR, P&L footing, headcount, AR aging and cash hand-off to the forecast |

Filters: any closed month from January to October 2026, as a single month or year to date. The choice is remembered in the browser.

## The sample company

**Halden Systems, Inc.** is a fictional B2B SaaS company with about 140 employees. Fiscal 2026 is the calendar year, and the books are closed through October.

- ARR of $22.0M at October 31, up 22% year over year but 4.8% behind the board plan of $23.1M
- Revenue of $2.29M in October: $1.83M subscription and $0.46M usage and services
- Gross margin around 82%; EBITDA around −$0.35M a month
- Cash of $5.0M at October 31 and $4.75M at November 13, with an undrawn $4.0M revolver
- 140 employees against a budget of 148, across support, R&D, sales and marketing, and G&A

The story in the data: bookings and usage revenue are behind plan, hiring is behind plan too, so spending is under budget and EBITDA lands close to plan. Runway is 8.4 months on cash alone, churn spiked in July and October, and DSO has crept up from 40 to 44 days. The close has improved from nine days in January to five in October.

The CSV files in [`data/`](data/) contain the same sample data so it can be reviewed in Excel.

## How the numbers work

All amounts are in USD thousands.

**ARR and retention**
- ARR rolls forward each month: opening + new + expansion − contraction − churn = closing.
- Subscription revenue for a month equals average ARR for the month ÷ 12. An integrity check holds this within 2%.
- Gross and net revenue retention are measured on the period's opening ARR and annualized, so a single month and year to date read on the same scale.

**Budget vs actual**
- Variance is favourable when positive: revenue above budget or cost below budget. Unfavourable variances show in parentheses.
- A line gets commentary when its variance is at least $40k in a month ($120k year to date), or at least 10% of budget and $10k ($30k year to date).
- Commentary is built from the drivers: ARR movements for subscription revenue, headcount against budget for payroll lines, bookings for commissions, and notes recorded at close for one-off items.

**Cash, burn and efficiency**
- Net burn is the average monthly fall in cash over the last three months, including debt service and working capital.
- Runway is month-end cash ÷ net burn, shown with and without the undrawn revolver.
- Burn multiple is net burn ÷ average monthly net new ARR over the same three months.
- Rule of 40 is year-over-year ARR growth plus EBITDA margin for the period.

**Working capital**
- DSO = AR ÷ month revenue × days in the month. DPO = AP ÷ month non-payroll spend × days in the month.
- January is left out of the DSO trend because AR includes $1.2M of annual renewals billed on January 1 and collected in February.

**Link to the 13-week cash flow forecast**
- The Nov 13 cash balance ($4,750k), the forecast low point ($1,718k on Jan 29), the minimum cash policy ($1,500k) and the AR aging ($3,384,950 across 21 invoices) come from the companion forecast. Integrity checks confirm the AR aging total and that October 31 cash rolls to the Nov 13 opening balance within a $500k review threshold.

## Controls

A dashboard that executives read needs the same discipline as the close itself:

- **Synthetic data only.** No real ledger, payroll or bank data is used.
- **Read-only.** Filters change the view, never the data. A test confirms the engine leaves the source tables unchanged.
- **One source of truth.** The summary, tiles, charts and P&L are all computed from the same month-end tables, so they can't disagree.
- **Integrity checks on every render.** A failed check shows in red on the page.
- **Written review threshold.** Which variances need commentary is a stated rule, not a judgment made line by line.
- **Defined metrics.** Every KPI has a written definition on the page and in this README.
- **Automated tests.** `npm test` checks the roll-forwards, year-to-date totals, variance signs, commentary coverage, runway math and the hand-off to the cash forecast.

## Run it

Requires Node.js 18 or later. There are no packages to install.

```bash
npm run build     # bundles src/ into one self-contained file: dist/index.html
npm test          # runs the engine tests
npm run data      # regenerates the CSVs in data/ from the sample data
```

Open `dist/index.html` in any browser after building. To work on the source files directly, serve the folder (for example `npx serve .`) and open `index.html`.

The live demo is served by GitHub Pages straight from the repository root on `main`: `index.html` loads the files in `src/` as they are, so there is no build step to publish.

## Project structure

```
cfo-control-center/
├── index.html            Development entry point (loads src/)
├── src/
│   ├── data.js           Sample month-end tables: P&L, budget, ARR, headcount, balances, close KPIs
│   ├── engine.js         Metrics, variance commentary, summary, watch list and integrity checks
│   ├── app.js            Page rendering, charts and filters
│   ├── body.html         Page markup
│   └── styles.css        Light and dark themes
├── data/                 Sample data as CSV
├── scripts/
│   ├── build.js          Bundles everything into dist/index.html
│   └── export-csv.js     Writes data/*.csv from src/data.js
├── tests/
│   └── engine.test.js    Node test runner tests
└── docs/                 Screenshot for this README
```

## Possible next steps

- Load month-end trial balance and budget exports (CSV) from an ERP such as NetSuite in place of the sample data
- Add a balance sheet and cash flow statement view
- Forecast the rest of the year (actuals plus reforecast) against the full-year plan
- Department drill-down to vendor-level spend

## Disclaimer

Portfolio project. Halden Systems and every customer, vendor and figure in this repository are fictional and for demonstration only.
