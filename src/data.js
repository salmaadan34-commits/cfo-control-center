/*
 * Sample data for the Halden CFO control center.
 * Halden Systems, Inc. is fictional; every figure here is synthetic.
 * Amounts are USD thousands. Months are fiscal 2026 (calendar year), closed through October.
 * Works in the browser (window.HaldenData) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  const COMPANY = {
    name: 'Halden Systems, Inc.',
    blurb: 'Fictional B2B SaaS company, about 140 employees',
    fiscalYear: 2026,
    closedThrough: '2026-10',
    openingCash: 10400,        // Dec 31, 2025
    openingArr: 18900,         // Jan 1, 2026
    minimumCash: 1500,         // treasury policy floor, same as the 13-week forecast
    revolverCommitment: 4000,  // undrawn $4.0M facility at 7.25%
    closeTargetDays: 5,        // business days
  };

  // Hand-off from the 13-week cash flow forecast (base case, as of Fri Nov 13, 2026).
  const CASH_FORECAST = {
    asOf: '2026-11-13',
    openingCash: 4750,
    lowPoint: 1718, lowPointWeek: '2027-01-29',
    week13Cash: 3435, week13Date: '2027-02-12',
    downsideRevolverPeak: 1750,
  };

  const PNL_LINES = [
    { id: 'subscription',    label: 'Subscription revenue',            group: 'revenue' },
    { id: 'usage',           label: 'Usage & services revenue',        group: 'revenue' },
    { id: 'hosting',         label: 'Cloud hosting',                   group: 'cogs' },
    { id: 'support_people',  label: 'Support & onboarding team',       group: 'cogs', dept: 'support' },
    { id: 'data_feeds',      label: 'Third-party data',                group: 'cogs' },
    { id: 'rd_people',       label: 'R&D team',                        group: 'opex', dept: 'rd' },
    { id: 'rd_other',        label: 'R&D contractors & tools',         group: 'opex', dept: 'rd' },
    { id: 'sm_people',       label: 'Sales & marketing team',          group: 'opex', dept: 'sm' },
    { id: 'sm_programs',     label: 'Marketing programs',              group: 'opex', dept: 'sm' },
    { id: 'sm_commissions',  label: 'Sales commissions',               group: 'opex', dept: 'sm' },
    { id: 'ga_people',       label: 'G&A team',                        group: 'opex', dept: 'ga' },
    { id: 'ga_facilities',   label: 'Rent & facilities',               group: 'opex', dept: 'ga' },
    { id: 'ga_professional', label: 'Legal, audit & professional fees', group: 'opex', dept: 'ga' },
    { id: 'ga_other',        label: 'Software, insurance & other',     group: 'opex', dept: 'ga' },
    { id: 'da',              label: 'Depreciation & amortization',     group: 'da' },
  ];

  const DEPTS = [
    { id: 'support', label: 'Support & onboarding' },
    { id: 'rd',      label: 'Research & development' },
    { id: 'sm',      label: 'Sales & marketing' },
    { id: 'ga',      label: 'General & administrative' },
  ];

  const TABLES = {
    // P&L by month, columns in PNL_LINES order: subscription, usage, hosting, support_people, data_feeds, rd_people, rd_other, sm_people, sm_programs, sm_commissions, ga_people, ga_facilities, ga_professional, ga_other, da
    PNL_ACTUAL: [
      ['2026-01', 1587, 400, 175, 154, 34, 724, 95, 464, 120, 41, 335, 156, 38, 64, 35],
      ['2026-02', 1615, 410, 178, 154, 34, 739, 98, 464, 135, 47, 335, 156, 42, 63, 35],
      ['2026-03', 1645, 445, 183, 154, 34, 739, 102, 476, 150, 51, 335, 156, 85, 66, 35],
      ['2026-04', 1672, 430, 182, 163, 34, 755, 96, 488, 128, 42, 335, 156, 40, 65, 35],
      ['2026-05', 1700, 455, 186, 163, 34, 770, 104, 488, 142, 51, 347, 156, 36, 67, 35],
      ['2026-06', 1735, 470, 190, 163, 34, 770, 110, 500, 165, 55, 347, 156, 44, 66, 35],
      ['2026-07', 1759, 440, 188, 163, 34, 785, 99, 500, 118, 39, 347, 156, 39, 68, 35],
      ['2026-08', 1778, 465, 192, 173, 34, 785, 101, 512, 130, 47, 347, 156, 62, 70, 35],
      ['2026-09', 1809, 480, 195, 173, 34, 801, 97, 512, 175, 52, 347, 156, 41, 69, 35],
      ['2026-10', 1830, 455, 196, 173, 34, 801, 99, 512, 160, 41, 347, 156, 48, 72, 35],
    ],
    PNL_BUDGET: [
      ['2026-01', 1590, 430, 166, 154, 34, 724, 95, 464, 140, 47, 335, 156, 45, 66, 35],
      ['2026-02', 1621, 440, 169, 154, 34, 739, 95, 476, 140, 50, 335, 156, 45, 66, 35],
      ['2026-03', 1655, 450, 173, 163, 34, 755, 95, 488, 140, 53, 335, 156, 80, 66, 35],
      ['2026-04', 1690, 460, 176, 163, 34, 770, 95, 500, 140, 51, 347, 156, 45, 66, 35],
      ['2026-05', 1725, 470, 180, 173, 34, 785, 95, 512, 140, 53, 347, 156, 45, 66, 35],
      ['2026-06', 1763, 480, 184, 173, 34, 801, 95, 525, 140, 56, 347, 156, 45, 66, 35],
      ['2026-07', 1799, 490, 188, 173, 34, 816, 95, 537, 130, 51, 347, 156, 45, 66, 35],
      ['2026-08', 1834, 500, 191, 182, 34, 832, 95, 549, 130, 53, 347, 156, 45, 66, 35],
      ['2026-09', 1870, 510, 195, 182, 34, 847, 95, 561, 140, 55, 347, 156, 45, 66, 35],
      ['2026-10', 1908, 520, 199, 182, 34, 847, 95, 561, 150, 56, 347, 156, 45, 66, 35],
    ],
    // ARR roll-forward: month, new, expansion, contraction, churn
    ARR_ACTUAL: [
      ['2026-01', 310, 140, -50, -120],
      ['2026-02', 360, 160, -40, -90],
      ['2026-03', 420, 150, -70, -160],
      ['2026-04', 300, 170, -55, -110],
      ['2026-05', 380, 190, -60, -140],
      ['2026-06', 450, 160, -45, -100],
      ['2026-07', 280, 150, -80, -230],
      ['2026-08', 340, 180, -50, -130],
      ['2026-09', 410, 170, -65, -120],
      ['2026-10', 290, 160, -70, -260],
    ],
    ARR_PLAN: [
      ['2026-01', 350, 170, -50, -110],
      ['2026-02', 380, 170, -50, -110],
      ['2026-03', 420, 170, -50, -110],
      ['2026-04', 400, 170, -50, -110],
      ['2026-05', 420, 170, -50, -110],
      ['2026-06', 450, 170, -50, -110],
      ['2026-07', 400, 170, -50, -110],
      ['2026-08', 420, 170, -50, -110],
      ['2026-09', 440, 170, -50, -110],
      ['2026-10', 450, 170, -50, -110],
    ],
    // Headcount at month end: month, support, rd, sm, ga
    HC_ACTUAL: [
      ['2026-01', 16, 47, 38, 27],
      ['2026-02', 16, 48, 38, 27],
      ['2026-03', 16, 48, 39, 27],
      ['2026-04', 17, 49, 40, 27],
      ['2026-05', 17, 50, 40, 28],
      ['2026-06', 17, 50, 41, 28],
      ['2026-07', 17, 51, 41, 28],
      ['2026-08', 18, 51, 42, 28],
      ['2026-09', 18, 52, 42, 28],
      ['2026-10', 18, 52, 42, 28],
    ],
    HC_BUDGET: [
      ['2026-01', 16, 47, 38, 27],
      ['2026-02', 16, 48, 39, 27],
      ['2026-03', 17, 49, 40, 27],
      ['2026-04', 17, 50, 41, 28],
      ['2026-05', 18, 51, 42, 28],
      ['2026-06', 18, 52, 43, 28],
      ['2026-07', 18, 53, 44, 28],
      ['2026-08', 19, 54, 45, 28],
      ['2026-09', 19, 55, 46, 28],
      ['2026-10', 19, 55, 46, 28],
    ],
    // Month-end balances: month, cash, accounts receivable, accounts payable, deferred revenue
    BALANCES: [
      ['2026-01', 9187, 3950, 880, 1220],
      ['2026-02', 9943, 2640, 910, 1120],
      ['2026-03', 9306, 2720, 960, 1020],
      ['2026-04', 8585, 2810, 900, 920],
      ['2026-05', 8016, 2860, 930, 820],
      ['2026-06', 7436, 2930, 980, 720],
      ['2026-07', 6786, 3010, 920, 620],
      ['2026-08', 6217, 3080, 950, 520],
      ['2026-09', 5658, 3150, 990, 420],
      ['2026-10', 4995, 3260, 960, 320],
    ],

    // ARR at each month end of the prior year (2025), for year-over-year growth.
    ARR_PRIOR_YEAR: [15420, 15660, 15890, 16150, 16400, 16700, 17010, 17340, 17690, 18030],

    // Close and controls KPIs: month, business days to close, open reconciling items,
    // reconciling items older than 60 days, manual journal entries, post-close adjustments,
    // balance sheet accounts reconciled on time (%)
    CLOSE: [
      ['2026-01', 9, 24, 7, 142, 3, 82],
      ['2026-02', 8, 21, 6, 131, 2, 85],
      ['2026-03', 8, 19, 6, 128, 2, 87],
      ['2026-04', 7, 17, 5, 120, 2, 90],
      ['2026-05', 7, 15, 4, 114, 1, 92],
      ['2026-06', 6, 12, 3, 105, 1, 94],
      ['2026-07', 6, 11, 3, 101, 1, 95],
      ['2026-08', 5, 9, 2, 96, 0, 97],
      ['2026-09', 6, 8, 2, 93, 1, 97],
      ['2026-10', 5, 6, 1, 88, 0, 98],
    ],

    // AR aging by bucket at Nov 13, 2026: the same invoices as the 13-week cash forecast.
    AR_AGING: [
      ['Current', 2295.1],
      ['1–30', 601.95],
      ['31–60', 295.4],
      ['61–90', 114.15],
      ['90+', 78.35],
    ],
  };

  // Variance notes written at close, as a controller would for the month-end pack.
  const NOTES = [
    { month: '2026-03', line: 'subscription', text: 'Two enterprise deals slipped from Q1 into April.' },
    { month: '2026-06', line: 'sm_programs', text: 'Spring demand campaign ran two weeks longer than planned.' },
    { month: '2026-07', line: 'subscription', text: 'Quarry Hill Builders and Redfern Studios churned; both still carry 90+ day balances in AR.' },
    { month: '2026-07', line: 'sm_programs', text: 'Summer events moved to September.' },
    { month: '2026-08', line: 'ga_professional', text: 'Outside counsel on commercial contract renewals, not in the budget.' },
    { month: '2026-09', line: 'sm_programs', text: 'Industry conference sponsorship pulled forward from Q4.' },
    { month: '2026-10', line: 'subscription', text: 'Orchard & Vine Hospitality churned and Harbor Lane Hotels downgraded; both are past due in AR.' },
  ];

  const API = { COMPANY, CASH_FORECAST, PNL_LINES, DEPTS, TABLES, NOTES };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.HaldenData = API;
})(typeof window !== 'undefined' ? window : this);
