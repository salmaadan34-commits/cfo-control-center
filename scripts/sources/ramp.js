// Ramp card transactions, from Ramp's developer sandbox (demo-api.ramp.com) only.
// Auth: OAuth 2.0 client credentials with the transactions:read scope.
'use strict';
const { request, basic } = require('./http');
const L = require('../../src/live.js');

const BASE = 'https://demo-api.ramp.com';
const MAX_PAGES = 50;

const required = ['RAMP_CLIENT_ID', 'RAMP_CLIENT_SECRET'];

async function pull({ env, fetch, asOf, lookbackDays = 90 }) {
  const token = await request(fetch, 'Ramp token', `${BASE}/developer/v1/token`, {
    method: 'POST',
    headers: { Authorization: basic(env.RAMP_CLIENT_ID, env.RAMP_CLIENT_SECRET), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'transactions:read' }).toString(),
  });
  if (!token.access_token) throw new Error('Ramp did not return an access token');
  const from = new Date(Date.parse(asOf) - lookbackDays * 86400000).toISOString();
  let url = `${BASE}/developer/v1/transactions?` + new URLSearchParams({ from_date: from, page_size: '100' });
  const pages = [];
  for (let i = 0; url && i < MAX_PAGES; i++) {
    const page = await request(fetch, 'Ramp transactions', url, { headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' } });
    pages.push(page);
    const next = page.page && page.page.next;
    // Only follow pagination links that stay on Ramp's sandbox host.
    url = typeof next === 'string' && next.startsWith(BASE + '/') ? next : null;
  }
  return { records: L.normalizeRamp(pages) };
}

module.exports = { key: 'ramp', label: 'Ramp', required, secrets: required, pull };
