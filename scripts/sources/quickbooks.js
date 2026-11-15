// QuickBooks Online invoices, from an Intuit developer sandbox company only.
// Auth: OAuth 2.0 refresh token. Intuit can issue a new refresh token on each refresh,
// so the new one is written to QBO_NEW_REFRESH_TOKEN_FILE for the workflow to save as a secret.
'use strict';
const fs = require('fs');
const { request, basic } = require('./http');
const L = require('../../src/live.js');

const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const BASE = 'https://sandbox-quickbooks.api.intuit.com';
const MINOR_VERSION = '75';
const PAGE = 1000;

const required = ['QBO_CLIENT_ID', 'QBO_CLIENT_SECRET', 'QBO_REFRESH_TOKEN', 'QBO_REALM_ID'];

async function pull({ env, fetch, asOf, lookbackDays = 365, log = () => {} }) {
  if (!/^\d+$/.test(String(env.QBO_REALM_ID).trim())) throw new Error('QBO_REALM_ID should be the numeric company ID');
  const tok = await request(fetch, 'QuickBooks token', TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basic(env.QBO_CLIENT_ID, env.QBO_CLIENT_SECRET), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: env.QBO_REFRESH_TOKEN }).toString(),
  });
  if (!tok.access_token) throw new Error('QuickBooks did not return an access token');
  const rotated = tok.refresh_token && tok.refresh_token !== env.QBO_REFRESH_TOKEN ? tok.refresh_token : null;
  if (rotated) {
    if (process.env.GITHUB_ACTIONS) process.stdout.write(`::add-mask::${rotated}\n`);
    if (env.QBO_NEW_REFRESH_TOKEN_FILE) { fs.writeFileSync(env.QBO_NEW_REFRESH_TOKEN_FILE, rotated, { mode: 0o600 }); log('QuickBooks issued a new refresh token; the workflow will save it.'); }
    else log('QuickBooks issued a new refresh token, but QBO_NEW_REFRESH_TOKEN_FILE is not set, so it was not saved.');
  }
  const since = new Date(Date.parse(asOf) - lookbackDays * 86400000).toISOString().slice(0, 10);
  const realm = String(env.QBO_REALM_ID).trim();
  const pages = [];
  for (let start = 1; start < 20 * PAGE; start += PAGE) {
    const query = `select * from Invoice where TxnDate >= '${since}' startposition ${start} maxresults ${PAGE}`;
    const url = `${BASE}/v3/company/${realm}/query?` + new URLSearchParams({ query, minorversion: MINOR_VERSION });
    const page = await request(fetch, 'QuickBooks invoices', url, { headers: { Authorization: `Bearer ${tok.access_token}`, Accept: 'application/json' } });
    pages.push(page);
    const got = (page.QueryResponse && page.QueryResponse.Invoice) || [];
    if (got.length < PAGE) break;
  }
  return { records: L.normalizeQbo(pages, asOf), rotatedRefreshToken: !!rotated };
}

module.exports = { key: 'quickbooks', label: 'QuickBooks', required, secrets: required, pull };
