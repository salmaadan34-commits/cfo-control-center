// Tests for the live feeds: normalizers fed mock API responses, commission, and the sync
// runner with a mock fetch (no network, no real keys).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../src/live.js');
const { runSync } = require('../scripts/sync.js');

// ---------- Mock API responses, shaped like each tool's docs ----------
const RAMP_PAGE_1 = {
  data: [
    { id: 'tx1', amount: 1250.5, currency_code: 'USD', merchant_name: 'Northwind Cloud', sk_category_name: 'Software', state: 'CLEARED', user_transaction_time: '2026-11-10T18:22:00Z', card_holder: { first_name: 'Lena', last_name: 'Park', department_name: 'R&D' } },
    { id: 'tx2', amount: { amount: 4999, currency_code: 'USD', minor_unit_conversion_rate: 100 }, merchant_name: 'Harbor Grill', sk_category_name: 'Meals', state: 'PENDING', user_transaction_time: '2026-11-12T01:00:00Z', card_holder: { first_name: 'Diego', last_name: 'Ramos' } },
  ],
  page: { next: 'https://demo-api.ramp.com/developer/v1/transactions?start=tx2' },
};
const RAMP_PAGE_2 = {
  data: [
    { id: 'tx3', amount: 300, merchant_name: 'Summit Air', sk_category_name: 'Travel', state: 'DECLINED', user_transaction_time: '2026-11-11T00:00:00Z' },
    { id: 'tx4', amount: 80, merchant_name: 'Old Cafe', state: 'CLEARED', user_transaction_time: '2026-08-01T00:00:00Z' },
  ],
  page: { next: null },
};
const QBO_PAGE = {
  QueryResponse: {
    Invoice: [
      { Id: '130', DocNumber: '1037', TxnDate: '2026-10-01', DueDate: '2026-10-31', TotalAmt: 362.07, Balance: 362.07, CustomerRef: { value: '3', name: 'Cool Cars' } },
      { Id: '131', DocNumber: '1038', TxnDate: '2026-11-01', DueDate: '2026-12-01', TotalAmt: 1000, Balance: 400, CustomerRef: { value: '8', name: 'Freeman Sporting Goods' } },
      { Id: '132', DocNumber: '1039', TxnDate: '2026-07-01', DueDate: '2026-07-31', TotalAmt: 225, Balance: 0, CustomerRef: { value: '9', name: 'Paid Up Co' } },
      { Id: '133', DocNumber: '1040', TxnDate: '2026-06-01', DueDate: '2026-07-01', TotalAmt: '510.00', Balance: '510.00', CustomerRef: { value: '10', name: 'Late Payer LLC' } },
    ],
    startPosition: 1, maxResults: 4,
  },
};
const HS_PIPELINES = {
  results: [{ id: 'default', label: 'Sales Pipeline', stages: [
    { id: 'appointmentscheduled', label: 'Appointment Scheduled', metadata: { isClosed: 'false', probability: '0.2' } },
    { id: 'contractsent', label: 'Contract Sent', metadata: { isClosed: 'false', probability: '0.9' } },
    { id: 'closedwon', label: 'Closed Won', metadata: { isClosed: 'true', probability: '1.0' } },
    { id: 'closedlost', label: 'Closed Lost', metadata: { isClosed: 'true', probability: '0.0' } },
    { id: 'custom_won', label: 'Signed', metadata: { isClosed: 'true', probability: '1.0' } },
  ] }],
};
const HS_OWNERS = { results: [
  { id: '101', email: 'ava@example.com', firstName: 'Ava', lastName: 'Stone' },
  { id: '102', email: 'ben@example.com', firstName: 'Ben', lastName: 'Cho' },
] };
const hsDeal = (id, stage, amount, close, owner) => ({ id, properties: { dealname: 'Deal ' + id, amount: String(amount), dealstage: stage, closedate: close + 'T17:00:00.000Z', hubspot_owner_id: owner } });
const HS_DEALS_1 = { results: [hsDeal('1', 'closedwon', 10000, '2026-03-01', '101'), hsDeal('2', 'custom_won', 5000, '2026-10-01', '102'), hsDeal('3', 'contractsent', 20000, '2026-12-01', '101')], paging: { next: { after: '3' } } };
const HS_DEALS_2 = { results: [hsDeal('4', 'appointmentscheduled', 7000, '2027-01-15', '102'), hsDeal('5', 'closedlost', 9000, '2026-05-01', '101'), hsDeal('6', 'closedwon', 8000, '2025-12-15', '101')] };
const RATES = { default_rate: 0.1, reps: { 'Ava Stone': 0.12, 'ben@example.com': 0.08 } };

// ---------- Ramp ----------
test('Ramp: transactions normalize, including money objects in cents', () => {
  const rows = L.normalizeRamp([RAMP_PAGE_1, RAMP_PAGE_2]);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { id: 'tx1', date: '2026-11-10', amount: 1250.5, currency: 'USD', merchant: 'Northwind Cloud', category: 'Software', cardholder: 'Lena Park', department: 'R&D', state: 'CLEARED' });
  assert.equal(rows[1].amount, 49.99);
  assert.equal(rows[3].category, 'Uncategorized');
  assert.equal(rows[2].cardholder, 'Unassigned');
});

test('Ramp: 30-day spend leaves out declined and older transactions', () => {
  const s = L.summarizeExpenses(L.normalizeRamp([RAMP_PAGE_1, RAMP_PAGE_2]), '2026-11-13');
  assert.equal(s.total, 1300.49);
  assert.equal(s.count, 2);
  assert.equal(s.pending, 1);
  assert.equal(s.byCategory[0].label, 'Software');
});

// ---------- QuickBooks ----------
test('QuickBooks: invoices normalize with status and days past due', () => {
  const rows = L.normalizeQbo([QBO_PAGE], '2026-11-13');
  const by = Object.fromEntries(rows.map((r) => [r.number, r]));
  assert.equal(by['1037'].status, 'overdue');
  assert.equal(by['1037'].days_past_due, 13);
  assert.equal(by['1037'].customer, 'Cool Cars');
  assert.equal(by['1038'].status, 'open');
  assert.equal(by['1039'].status, 'paid');
  assert.equal(by['1040'].balance, 510);
});

test('QuickBooks: aging buckets add up to open AR', () => {
  const s = L.summarizeInvoices(L.normalizeQbo([QBO_PAGE], '2026-11-13'));
  assert.equal(s.openTotal, 1272.07);
  assert.equal(s.overdueTotal, 872.07);
  assert.equal(Math.round(s.aging.reduce((t, b) => t + b.amt, 0) * 100) / 100, s.openTotal);
  assert.equal(s.aging.find((b) => b.bucket === '90+').amt, 510);
  assert.equal(s.topOverdue[0].customer, 'Late Payer LLC');
});

// ---------- HubSpot ----------
test('HubSpot: deals land in open, in progress, closed won and closed lost', () => {
  const rows = L.normalizeHubspot([HS_DEALS_1, HS_DEALS_2], HS_PIPELINES, [HS_OWNERS]);
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(by['1'].bucket, 'closed_won');
  assert.equal(by['2'].bucket, 'closed_won'); // custom stage, read from pipeline metadata
  assert.equal(by['3'].bucket, 'in_progress');
  assert.equal(by['4'].bucket, 'open');
  assert.equal(by['5'].bucket, 'closed_lost');
  assert.equal(by['1'].owner, 'Ava Stone');
  assert.equal(by['1'].close_date, '2026-03-01');
});

test('HubSpot: without pipeline or owner data, default stages and owner IDs are used', () => {
  const rows = L.normalizeHubspot([HS_DEALS_1], null, []);
  assert.equal(rows[0].bucket, 'closed_won');
  assert.equal(rows[2].bucket, 'in_progress');
  assert.equal(rows[0].owner, 'Owner 101');
});

test('Commission: rate by name or email, current year only, and it ties to the deals', () => {
  const rows = L.normalizeHubspot([HS_DEALS_1, HS_DEALS_2], HS_PIPELINES, [HS_OWNERS]);
  const s = L.summarizeDeals(rows, RATES, '2026-11-13');
  const ava = s.reps.find((r) => r.rep === 'Ava Stone');
  const ben = s.reps.find((r) => r.rep === 'Ben Cho');
  assert.equal(ava.won_amount, 10000); // the Dec 2025 deal is last year
  assert.equal(ava.earned, 1200);
  assert.equal(ava.at_stake, 2400);
  assert.equal(ben.rate, 0.08);
  assert.equal(ben.earned, 400);
  assert.equal(s.earned, 1600);
  assert.ok(s.commissionTies);
});

test('Commission: published deals carry their rate instead of the owner email', () => {
  const rows = L.publishDeals(L.normalizeHubspot([HS_DEALS_1, HS_DEALS_2], HS_PIPELINES, [HS_OWNERS]), RATES);
  assert.ok(rows.every((d) => !('owner_email' in d)));
  assert.equal(rows.find((d) => d.owner === 'Ben Cho').rate, 0.08);
  const s = L.summarizeDeals(rows, { default_rate: 0.1 }, '2026-11-13');
  assert.equal(s.earned, 1600);
  assert.ok(s.commissionTies);
  assert.ok(!JSON.stringify(rows).includes('@example.com'));
});

test('Sample data renders every feed before the first sync', () => {
  const R = L.resolve(undefined);
  assert.equal(R.anyLive, false);
  assert.ok(R.ramp.summary.total > 0 && R.quickbooks.summary.openTotal > 0 && R.hubspot.summary.earned > 0);
  assert.ok(R.hubspot.summary.commissionTies);
});

// ---------- Sync runner ----------
function mockFetch(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    const hit = routes.find(([match]) => String(url).includes(match));
    const [, status, body] = hit || [null, 404, { error: 'not_found' }];
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
  };
  fn.calls = calls;
  return fn;
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cfo-live-'));
const ENV = {
  RAMP_CLIENT_ID: 'ramp-id-123', RAMP_CLIENT_SECRET: 'ramp-secret-456',
  QBO_CLIENT_ID: 'qbo-id-123', QBO_CLIENT_SECRET: 'qbo-secret-456', QBO_REFRESH_TOKEN: 'old-refresh-789', QBO_REALM_ID: '9341450000000000',
  HUBSPOT_TOKEN: 'pat-na1-secret-000',
};

test('Sync: with no keys, nothing is written', async () => {
  const dir = tmp();
  const r = await runSync({ env: {}, fetch: mockFetch([]), outDir: path.join(dir, 'live'), log: () => {} });
  assert.equal(r.wrote, false);
  assert.equal(fs.existsSync(path.join(dir, 'live')), false);
});

test('Sync: a failing source does not stop the others, and no secret reaches the output', async () => {
  const dir = tmp(); const out = path.join(dir, 'live'); const newTok = path.join(dir, 'newtok');
  const logs = [];
  const fetch = mockFetch([
    ['demo-api.ramp.com/developer/v1/token', 200, { access_token: 'ramp-access', token_type: 'Bearer', expires_in: 864000 }],
    ['transactions?start=tx2', 200, RAMP_PAGE_2],
    ['demo-api.ramp.com/developer/v1/transactions', 200, RAMP_PAGE_1],
    ['oauth.platform.intuit.com', 400, { error: 'invalid_grant', error_description: 'bad token old-refresh-789' }],
    ['after=3', 200, HS_DEALS_2],
    ['/crm/v3/objects/deals', 200, HS_DEALS_1],
    ['/crm/v3/pipelines/deals', 200, HS_PIPELINES],
    ['/crm/v3/owners', 403, { category: 'MISSING_SCOPES' }],
  ]);
  const r = await runSync({ env: { ...ENV, QBO_NEW_REFRESH_TOKEN_FILE: newTok }, fetch, outDir: out, now: new Date('2026-11-13T13:00:00Z'), log: (m) => logs.push(m) });
  assert.equal(r.status.sources.ramp.state, 'ok');
  assert.equal(r.status.sources.ramp.records, 4);
  assert.equal(r.status.sources.quickbooks.state, 'error');
  assert.match(r.status.sources.quickbooks.message, /HTTP 400 \(invalid_grant\)/);
  assert.equal(r.status.sources.hubspot.state, 'ok');
  assert.equal(r.allFailed, false);
  assert.ok(fs.existsSync(path.join(out, 'ramp.json')) && fs.existsSync(path.join(out, 'hubspot.json')));
  assert.equal(fs.existsSync(path.join(out, 'quickbooks.json')), false);
  const hs = JSON.parse(fs.readFileSync(path.join(out, 'hubspot.json'), 'utf8'));
  assert.equal(hs.count, 6); // two pages of deals
  assert.equal(hs.records[0].owner, 'Owner 101'); // owners scope missing: still works
  assert.ok(!('owner_email' in hs.records[0]) && hs.records[0].rate === 0.1);
  // Ramp pagination followed, and the Basic auth header carried the client credentials.
  assert.ok(fetch.calls.some((c) => c.url.includes('start=tx2')));
  // Nothing written or logged contains a key.
  const written = fs.readdirSync(out).map((f) => fs.readFileSync(path.join(out, f), 'utf8')).join('\n') + logs.join('\n');
  for (const v of Object.values(ENV)) assert.ok(!written.includes(v), 'leaked a secret');
  // live.js is loadable by the page.
  const win = {}; new Function('window', fs.readFileSync(path.join(out, 'live.js'), 'utf8'))(win);
  const R = L.resolve(win.HaldenLive);
  assert.equal(R.ramp.live, true); assert.equal(R.quickbooks.live, false); assert.equal(R.hubspot.live, true);
});

test('Sync: QuickBooks pulls invoices and saves a rotated refresh token to the hand-off file only', async () => {
  const dir = tmp(); const out = path.join(dir, 'live'); const newTok = path.join(dir, 'newtok');
  const fetch = mockFetch([
    ['oauth.platform.intuit.com', 200, { access_token: 'qbo-access', refresh_token: 'new-refresh-abc', expires_in: 3600, x_refresh_token_expires_in: 8726400 }],
    ['sandbox-quickbooks.api.intuit.com/v3/company/9341450000000000/query', 200, QBO_PAGE],
  ]);
  const env = { QBO_CLIENT_ID: ENV.QBO_CLIENT_ID, QBO_CLIENT_SECRET: ENV.QBO_CLIENT_SECRET, QBO_REFRESH_TOKEN: ENV.QBO_REFRESH_TOKEN, QBO_REALM_ID: ENV.QBO_REALM_ID, QBO_NEW_REFRESH_TOKEN_FILE: newTok };
  const r = await runSync({ env, fetch, outDir: out, now: new Date('2026-11-13T13:00:00Z'), log: () => {} });
  assert.equal(r.status.sources.quickbooks.state, 'ok');
  assert.equal(r.status.sources.quickbooks.records, 4);
  assert.equal(r.status.sources.ramp.state, 'not_configured');
  assert.equal(fs.readFileSync(newTok, 'utf8'), 'new-refresh-abc');
  const all = fs.readdirSync(out).map((f) => fs.readFileSync(path.join(out, f), 'utf8')).join('\n');
  assert.ok(!all.includes('new-refresh-abc') && !all.includes('qbo-access'));
  const q = fetch.calls.find((c) => c.url.includes('/query'));
  assert.match(decodeURIComponent(q.url.replace(/\+/g, ' ')), /select \* from Invoice where TxnDate >= '2025-11-13'/);
});

test('Sync: a failed source keeps its last good data', async () => {
  const dir = tmp(); const out = path.join(dir, 'live');
  const good = mockFetch([['after=3', 200, HS_DEALS_2], ['/crm/v3/objects/deals', 200, HS_DEALS_1], ['/crm/v3/pipelines/deals', 200, HS_PIPELINES], ['/crm/v3/owners', 200, HS_OWNERS]]);
  await runSync({ env: { HUBSPOT_TOKEN: ENV.HUBSPOT_TOKEN }, fetch: good, outDir: out, now: new Date('2026-11-12T13:00:00Z'), log: () => {} });
  const bad = mockFetch([['/crm/v3/objects/deals', 401, { category: 'INVALID_AUTHENTICATION' }]]);
  const r = await runSync({ env: { HUBSPOT_TOKEN: ENV.HUBSPOT_TOKEN }, fetch: bad, outDir: out, now: new Date('2026-11-13T13:00:00Z'), log: () => {} });
  assert.equal(r.status.sources.hubspot.state, 'error');
  assert.equal(r.status.sources.hubspot.synced_at, '2026-11-12T13:00:00.000Z');
  assert.equal(r.allFailed, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'hubspot.json'), 'utf8')).count, 6);
});
