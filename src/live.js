/*
 * Live feeds for the CFO control center: Ramp card spend, QuickBooks invoices and HubSpot deals.
 *
 * - Normalizers turn raw API responses into small, flat records. scripts/sync.js uses them
 *   in Node; the tests feed them mock API responses.
 * - Summaries turn those records into what the page shows.
 * - Sample records (fictional Halden data) are used for any source that has not synced yet,
 *   so the page always renders.
 *
 * Amounts here are whole US dollars, not thousands like the rest of the dashboard.
 * Works in the browser (window.CfoLive) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  const DAY = 86400000;
  const isoDay = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');
  const toNum = (v) => { const n = typeof v === 'string' ? Number(v.replace(/[$,]/g, '')) : Number(v); return Number.isFinite(n) ? n : 0; };
  const round2 = (v) => Math.round(v * 100) / 100;
  const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
  const sum = (a, f = (x) => x) => round2(a.reduce((s, x) => s + f(x), 0));

  // ---------------------------------------------------------------- Ramp
  // GET /developer/v1/transactions returns { data: [...], page: { next } }.
  function rampAmount(a) {
    if (typeof a === 'number') return a;
    if (a && typeof a === 'object' && a.amount != null) {
      // Newer Ramp money objects carry minor units (cents) plus a conversion rate.
      const rate = toNum(a.minor_unit_conversion_rate) || 100;
      return toNum(a.amount) / rate;
    }
    return toNum(a);
  }

  function normalizeRampTransaction(t) {
    const holder = t.card_holder || {};
    const name = [holder.first_name, holder.last_name].filter(Boolean).join(' ');
    return {
      id: String(t.id || ''),
      date: isoDay(t.user_transaction_time) || isoDay(t.settlement_date) || isoDay(t.accounting_date),
      amount: round2(rampAmount(t.amount)),
      currency: t.currency_code || (t.amount && t.amount.currency_code) || 'USD',
      merchant: t.merchant_name || t.merchant_descriptor || 'Unknown merchant',
      category: t.sk_category_name || 'Uncategorized',
      cardholder: name || 'Unassigned',
      department: holder.department_name || '',
      state: String(t.state || '').toUpperCase(),
    };
  }

  function normalizeRamp(pages) {
    const rows = [].concat(...pages.map((p) => (p && Array.isArray(p.data) ? p.data : [])));
    return rows.map(normalizeRampTransaction).filter((r) => r.id && r.date);
  }

  // ---------------------------------------------------------------- QuickBooks Online
  // /v3/company/{realm}/query returns { QueryResponse: { Invoice: [...] } }.
  function normalizeQboInvoice(inv, asOf) {
    const total = round2(toNum(inv.TotalAmt));
    const balance = round2(toNum(inv.Balance));
    const due = isoDay(inv.DueDate) || isoDay(inv.TxnDate);
    const late = balance > 0 && due ? Math.max(0, daysBetween(due, asOf)) : 0;
    return {
      id: String(inv.Id || ''),
      number: inv.DocNumber || '',
      customer: (inv.CustomerRef && (inv.CustomerRef.name || inv.CustomerRef.value)) || 'Unknown customer',
      date: isoDay(inv.TxnDate),
      due_date: due,
      total,
      balance,
      status: balance <= 0 ? 'paid' : late > 0 ? 'overdue' : 'open',
      days_past_due: late,
    };
  }

  function normalizeQbo(pages, asOf) {
    const rows = [].concat(...pages.map((p) => (p && p.QueryResponse && Array.isArray(p.QueryResponse.Invoice) ? p.QueryResponse.Invoice : [])));
    return rows.map((r) => normalizeQboInvoice(r, asOf)).filter((r) => r.id);
  }

  // ---------------------------------------------------------------- HubSpot
  // Stage ids of HubSpot's default sales pipeline, used when pipeline metadata is unavailable.
  const DEFAULT_STAGES = {
    appointmentscheduled: { label: 'Appointment scheduled', probability: 0.2, isClosed: false },
    qualifiedtobuy: { label: 'Qualified to buy', probability: 0.4, isClosed: false },
    presentationscheduled: { label: 'Presentation scheduled', probability: 0.6, isClosed: false },
    decisionmakerboughtin: { label: 'Decision maker bought in', probability: 0.8, isClosed: false },
    contractsent: { label: 'Contract sent', probability: 0.9, isClosed: false },
    closedwon: { label: 'Closed won', probability: 1, isClosed: true },
    closedlost: { label: 'Closed lost', probability: 0, isClosed: true },
  };

  // { results: [ { id, label, stages: [ { id, label, metadata: { isClosed, probability } } ] } ] }
  function stageMap(pipelinesResponse) {
    const map = {};
    for (const [id, s] of Object.entries(DEFAULT_STAGES)) map[id] = { ...s };
    const list = (pipelinesResponse && pipelinesResponse.results) || [];
    for (const p of list) {
      for (const s of p.stages || []) {
        const md = s.metadata || {};
        const prob = md.probability == null || md.probability === '' ? null : toNum(md.probability);
        map[s.id] = { label: s.label || s.id, probability: prob, isClosed: String(md.isClosed) === 'true', pipeline: p.label || p.id };
      }
    }
    return map;
  }

  // Open = early stages (under 50% likely), In progress = later stages, then closed won / lost.
  function dealBucket(stage) {
    if (!stage) return 'open';
    if (stage.isClosed) {
      if (stage.probability != null) return stage.probability >= 1 ? 'closed_won' : 'closed_lost';
      return /won/i.test(stage.label || '') ? 'closed_won' : 'closed_lost';
    }
    return stage.probability != null && stage.probability >= 0.5 ? 'in_progress' : 'open';
  }

  function ownerMap(ownersPages) {
    const map = {};
    for (const p of ownersPages || []) {
      for (const o of (p && p.results) || []) {
        const name = [o.firstName, o.lastName].filter(Boolean).join(' ');
        map[String(o.id)] = { name: name || 'Owner ' + o.id, email: o.email || '' };
      }
    }
    return map;
  }

  function normalizeHubspotDeal(d, stages, owners) {
    const p = d.properties || {};
    const stage = stages[p.dealstage];
    const owner = owners[String(p.hubspot_owner_id || '')];
    return {
      id: String(d.id || ''),
      name: p.dealname || 'Untitled deal',
      amount: round2(toNum(p.amount)),
      stage: (stage && stage.label) || p.dealstage || 'Unknown stage',
      bucket: dealBucket(stage),
      close_date: isoDay(p.closedate),
      owner: owner ? owner.name : p.hubspot_owner_id ? 'Owner ' + p.hubspot_owner_id : 'Unassigned',
      owner_email: owner ? owner.email : '',
    };
  }

  function normalizeHubspot(dealPages, pipelinesResponse, ownersPages) {
    const stages = stageMap(pipelinesResponse);
    const owners = ownerMap(ownersPages);
    const rows = [].concat(...dealPages.map((p) => (p && Array.isArray(p.results) ? p.results : [])));
    return rows.map((d) => normalizeHubspotDeal(d, stages, owners)).filter((r) => r.id);
  }

  // ---------------------------------------------------------------- Commission
  // rates: { default_rate, reps: { "<name or email>": rate } }. Commission is earned on
  // closed-won amount with a close date in the calendar year of asOf. In-progress deals show
  // the commission at stake if they close.
  // A deal may carry its own rate (set at sync time, so owner emails never need to be published).
  function dealRate(rates, d) { return d.rate != null ? toNum(d.rate) : rateFor(rates, d.owner, d.owner_email); }

  // Public output: replace the owner's email with the rate it maps to.
  function publishDeals(deals, rates) {
    return deals.map(({ owner_email, ...d }) => ({ ...d, rate: rateFor(rates, d.owner, owner_email) }));
  }

  function rateFor(rates, owner, email) {
    const reps = (rates && rates.reps) || {};
    const key = Object.keys(reps).find((k) => k.toLowerCase() === String(owner).toLowerCase() || (email && k.toLowerCase() === email.toLowerCase()));
    return key != null ? toNum(reps[key]) : toNum(rates && rates.default_rate);
  }

  function commissionByRep(deals, rates, asOf) {
    const year = String(asOf).slice(0, 4);
    const by = {};
    for (const d of deals) {
      const r = by[d.owner] || (by[d.owner] = { rep: d.owner, rate: dealRate(rates, d), won_count: 0, won_amount: 0, earned: 0, in_progress_amount: 0, at_stake: 0, open_amount: 0 });
      if (d.bucket === 'closed_won' && d.close_date.slice(0, 4) === year) { r.won_count += 1; r.won_amount += d.amount; }
      if (d.bucket === 'in_progress') r.in_progress_amount += d.amount;
      if (d.bucket === 'open') r.open_amount += d.amount;
    }
    return Object.values(by).map((r) => ({
      ...r,
      won_amount: round2(r.won_amount),
      in_progress_amount: round2(r.in_progress_amount),
      open_amount: round2(r.open_amount),
      earned: round2(r.won_amount * r.rate),
      at_stake: round2(r.in_progress_amount * r.rate),
    })).sort((a, b) => b.earned - a.earned || b.in_progress_amount - a.in_progress_amount || a.rep.localeCompare(b.rep));
  }

  // ---------------------------------------------------------------- Summaries
  function topBy(rows, key, n) {
    const by = {};
    rows.forEach((r) => { by[r[key]] = (by[r[key]] || 0) + r.amount; });
    return Object.entries(by).map(([label, amount]) => ({ label, amount: round2(amount) })).sort((a, b) => b.amount - a.amount).slice(0, n);
  }

  function summarizeExpenses(rows, asOf, days = 30) {
    const from = new Date(Date.parse(asOf) - days * DAY).toISOString().slice(0, 10);
    const spend = rows.filter((r) => r.state !== 'DECLINED' && r.date > from && r.date <= asOf);
    return {
      days,
      total: sum(spend, (r) => r.amount),
      count: spend.length,
      pending: spend.filter((r) => r.state === 'PENDING').length,
      byCategory: topBy(spend, 'category', 6),
      byMerchant: topBy(spend, 'merchant', 5),
    };
  }

  const AGING = [['Current', -Infinity, 0], ['1–30', 1, 30], ['31–60', 31, 60], ['61–90', 61, 90], ['90+', 91, Infinity]];
  function summarizeInvoices(rows) {
    const open = rows.filter((r) => r.balance > 0);
    return {
      openTotal: sum(open, (r) => r.balance),
      openCount: open.length,
      overdueTotal: sum(open.filter((r) => r.status === 'overdue'), (r) => r.balance),
      overdueCount: open.filter((r) => r.status === 'overdue').length,
      aging: AGING.map(([bucket, lo, hi]) => ({ bucket, amt: sum(open.filter((r) => r.days_past_due >= lo && r.days_past_due <= hi), (r) => r.balance) })),
      topOverdue: open.filter((r) => r.status === 'overdue').sort((a, b) => b.balance - a.balance).slice(0, 5),
    };
  }

  function summarizeDeals(rows, rates, asOf) {
    const buckets = ['open', 'in_progress', 'closed_won', 'closed_lost'].map((b) => {
      const list = rows.filter((r) => r.bucket === b);
      return { bucket: b, count: list.length, amount: sum(list, (r) => r.amount) };
    });
    const reps = commissionByRep(rows, rates, asOf);
    const year = String(asOf).slice(0, 4);
    const wonThisYear = rows.filter((r) => r.bucket === 'closed_won' && r.close_date.slice(0, 4) === year);
    // Control: commission by rep must tie back to closed-won deals × each rep's rate.
    const expected = round2(wonThisYear.reduce((s, d) => s + d.amount * dealRate(rates, d), 0));
    const earned = sum(reps, (r) => r.earned);
    return { buckets, reps, earned, atStake: sum(reps, (r) => r.at_stake), commissionTies: Math.abs(earned - expected) < 0.05, year };
  }

  // ---------------------------------------------------------------- Sample data (fictional)
  const SAMPLE_AS_OF = '2026-11-13';
  const SAMPLE_RATES = { default_rate: 0.1, reps: { 'Maya Okafor': 0.12, 'Diego Ramos': 0.1, 'Priya Natarajan': 0.1, 'Tom Becker': 0.08 } };
  const ex = (id, date, amount, merchant, category, cardholder, department, state = 'CLEARED') => ({ id, date, amount, currency: 'USD', merchant, category, cardholder, department, state });
  const SAMPLE_EXPENSES = [
    ex('s-e01', '2026-11-12', 18420.5, 'Northwind Cloud', 'Software', 'Lena Park', 'R&D'),
    ex('s-e02', '2026-11-11', 2380, 'Summit Air', 'Travel', 'Maya Okafor', 'Sales'),
    ex('s-e03', '2026-11-10', 640.25, 'Harbor Grill', 'Meals', 'Diego Ramos', 'Sales'),
    ex('s-e04', '2026-11-09', 4200, 'Brightline Events', 'Marketing', 'Ana Silva', 'Marketing'),
    ex('s-e05', '2026-11-06', 1290, 'Pine Street Hotel', 'Lodging', 'Maya Okafor', 'Sales'),
    ex('s-e06', '2026-11-05', 6150, 'Datapoint Feeds', 'Software', 'Lena Park', 'R&D'),
    ex('s-e07', '2026-11-03', 315.8, 'Office Depot Co', 'Office supplies', 'Sam Lee', 'G&A'),
    ex('s-e08', '2026-10-30', 9800, 'Lumen Ads', 'Marketing', 'Ana Silva', 'Marketing'),
    ex('s-e09', '2026-10-28', 1875, 'Summit Air', 'Travel', 'Tom Becker', 'Sales'),
    ex('s-e10', '2026-10-24', 2450, 'Clearview Legal', 'Professional services', 'Sam Lee', 'G&A'),
    ex('s-e11', '2026-10-21', 410, 'Harbor Grill', 'Meals', 'Priya Natarajan', 'Sales'),
    ex('s-e12', '2026-11-13', 960, 'Northwind Cloud', 'Software', 'Lena Park', 'R&D', 'PENDING'),
  ];
  const inv = (id, number, customer, date, due, total, balance) => normalizeQboInvoice({ Id: id, DocNumber: number, CustomerRef: { name: customer }, TxnDate: date, DueDate: due, TotalAmt: total, Balance: balance }, SAMPLE_AS_OF);
  const SAMPLE_INVOICES = [
    inv('s-i01', 'H-1041', 'Granite Peak Logistics', '2026-11-01', '2026-12-01', 48500, 48500),
    inv('s-i02', 'H-1042', 'Bluewater Health', '2026-11-01', '2026-12-01', 36200, 36200),
    inv('s-i03', 'H-1036', 'Cedar & Finch', '2026-10-01', '2026-10-31', 22750, 22750),
    inv('s-i04', 'H-1033', 'Northgate Freight', '2026-09-20', '2026-10-20', 15400, 15400),
    inv('s-i05', 'H-1029', 'Harbor Lane Hotels', '2026-08-25', '2026-09-24', 12900, 12900),
    inv('s-i06', 'H-1021', 'Orchard & Vine Hospitality', '2026-07-15', '2026-08-14', 9850, 9850),
    inv('s-i07', 'H-1039', 'Meridian Labs', '2026-10-15', '2026-11-14', 27300, 27300),
    inv('s-i08', 'H-1030', 'Silverline Retail', '2026-09-01', '2026-10-01', 31000, 0),
  ];
  const deal = (id, name, amount, stageId, close, owner) => ({ id, name, amount, stage: DEFAULT_STAGES[stageId].label, bucket: dealBucket(DEFAULT_STAGES[stageId]), close_date: close, owner, owner_email: '' });
  const SAMPLE_DEALS = [
    deal('s-d01', 'Granite Peak: platform renewal + 40 seats', 96000, 'closedwon', '2026-10-28', 'Maya Okafor'),
    deal('s-d02', 'Bluewater Health: analytics add-on', 54000, 'closedwon', '2026-09-30', 'Diego Ramos'),
    deal('s-d03', 'Meridian Labs: new logo', 72000, 'closedwon', '2026-08-14', 'Maya Okafor'),
    deal('s-d04', 'Cedar & Finch: usage tier upgrade', 18500, 'closedwon', '2026-11-06', 'Priya Natarajan'),
    deal('s-d05', 'Northgate Freight: multi-year', 120000, 'contractsent', '2026-12-15', 'Tom Becker'),
    deal('s-d06', 'Silverline Retail: expansion', 38000, 'decisionmakerboughtin', '2026-12-20', 'Diego Ramos'),
    deal('s-d07', 'Lakeshore Clinics: new logo', 64000, 'presentationscheduled', '2027-01-31', 'Priya Natarajan'),
    deal('s-d08', 'Redwood Mutual: pilot', 22000, 'qualifiedtobuy', '2027-02-15', 'Maya Okafor'),
    deal('s-d09', 'Atlas Foods: new logo', 45000, 'appointmentscheduled', '2027-03-01', 'Tom Becker'),
    deal('s-d10', 'Quarry Hill Builders: win-back', 30000, 'closedlost', '2026-10-10', 'Diego Ramos'),
  ];

  // ---------------------------------------------------------------- Resolve live vs sample
  // live: window.HaldenLive written by scripts/sync.js, or undefined before the first sync.
  function resolve(live) {
    const L = live || {};
    const status = L.status || {};
    const src = status.sources || {};
    const asOf = isoDay(status.last_run) || SAMPLE_AS_OF;
    const pick = (key, liveRows) => {
      const st = src[key] || {};
      const hasLive = Array.isArray(liveRows) && st.synced_at;
      return { live: !!hasLive, state: st.state || 'not_configured', syncedAt: st.synced_at || null, message: st.message || '' };
    };
    const ramp = pick('ramp', L.ramp && L.ramp.records);
    const qbo = pick('quickbooks', L.quickbooks && L.quickbooks.records);
    const hs = pick('hubspot', L.hubspot && L.hubspot.records);
    const rates = (L.hubspot && L.hubspot.commission_rates) || SAMPLE_RATES;
    return {
      lastRun: status.last_run || null,
      anyLive: ramp.live || qbo.live || hs.live,
      ramp: { ...ramp, asOf: ramp.live ? asOf : SAMPLE_AS_OF, summary: summarizeExpenses(ramp.live ? L.ramp.records : SAMPLE_EXPENSES, ramp.live ? asOf : SAMPLE_AS_OF) },
      quickbooks: { ...qbo, summary: summarizeInvoices(qbo.live ? L.quickbooks.records : SAMPLE_INVOICES) },
      hubspot: { ...hs, summary: hs.live ? summarizeDeals(L.hubspot.records, rates, asOf) : summarizeDeals(SAMPLE_DEALS, SAMPLE_RATES, SAMPLE_AS_OF) },
    };
  }

  const API = {
    normalizeRampTransaction, normalizeRamp,
    normalizeQboInvoice, normalizeQbo,
    stageMap, dealBucket, ownerMap, normalizeHubspotDeal, normalizeHubspot,
    rateFor, dealRate, publishDeals, commissionByRep,
    summarizeExpenses, summarizeInvoices, summarizeDeals,
    resolve,
    SAMPLE: { AS_OF: SAMPLE_AS_OF, RATES: SAMPLE_RATES, EXPENSES: SAMPLE_EXPENSES, INVOICES: SAMPLE_INVOICES, DEALS: SAMPLE_DEALS },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.CfoLive = API;
})(typeof window !== 'undefined' ? window : this);
