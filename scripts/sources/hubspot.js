// HubSpot deals, owners and deal pipelines, from a HubSpot developer test account.
// Auth: a service key or private app access token (Bearer), read-only CRM scopes.
'use strict';
const { request } = require('./http');
const L = require('../../src/live.js');

const BASE = 'https://api.hubapi.com';
const MAX_PAGES = 50;
const PROPS = 'dealname,amount,dealstage,pipeline,closedate,hubspot_owner_id';
// HubSpot is moving to date-versioned paths; try the long-standing v3 path first.
const PATHS = {
  deals: ['/crm/v3/objects/deals', '/crm/objects/2026-09/deals'],
  owners: ['/crm/v3/owners', '/crm/owners/2026-09'],
  pipelines: ['/crm/v3/pipelines/deals', '/crm/pipelines/2026-09/deals'],
};

const required = ['HUBSPOT_TOKEN'];

async function getAny(fetch, label, paths, query, headers) {
  let lastErr;
  for (const p of paths) {
    try { return await request(fetch, label, `${BASE}${p}${query ? '?' + query : ''}`, { headers }); }
    catch (e) { lastErr = e; if (e.status !== 404) throw e; }
  }
  throw lastErr;
}

async function pages(fetch, label, paths, params, headers) {
  const out = [];
  let after = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const q = new URLSearchParams({ ...params, limit: '100', ...(after ? { after } : {}) }).toString();
    const page = await getAny(fetch, label, paths, q, headers);
    out.push(page);
    after = page.paging && page.paging.next && page.paging.next.after;
    if (!after) break;
  }
  return out;
}

async function pull({ env, fetch, rates, log = () => {} }) {
  const headers = { Authorization: `Bearer ${env.HUBSPOT_TOKEN}`, Accept: 'application/json' };
  const deals = await pages(fetch, 'HubSpot deals', PATHS.deals, { properties: PROPS, archived: 'false' }, headers);
  // Owners and pipelines make the output nicer but are not essential: fall back if either fails.
  let pipelines = null, owners = [];
  try { pipelines = await getAny(fetch, 'HubSpot pipelines', PATHS.pipelines, '', headers); }
  catch (e) { log(`HubSpot pipelines unavailable (${e.message}); using default stage names.`); }
  try { owners = await pages(fetch, 'HubSpot owners', PATHS.owners, {}, headers); }
  catch (e) { log(`HubSpot owners unavailable (${e.message}); showing owner IDs instead of names.`); }
  // Owner emails are used to look up rates, then dropped: the repo and its data are public.
  return { records: L.publishDeals(L.normalizeHubspot(deals, pipelines, owners), rates), commission_rates: { default_rate: rates.default_rate } };
}

module.exports = { key: 'hubspot', label: 'HubSpot', required, secrets: required, pull };
