// Pulls live data from Ramp, QuickBooks Online and HubSpot test accounts into data/live/.
//
//   node scripts/sync.js
//
// Each source runs only when its keys are set (see SETUP.md) and fails on its own: one
// failing source never stops the others, and its last good file is kept. With no keys
// at all, nothing is written and the dashboard keeps showing its sample data.
// Keys are read from environment variables only and are never written or printed.
'use strict';
const fs = require('fs');
const path = require('path');

const SOURCES = [require('./sources/ramp'), require('./sources/quickbooks'), require('./sources/hubspot')];
const ROOT = path.join(__dirname, '..');

const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; } };
const writeJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');

function redact(message, env, names) {
  let m = String(message || 'Unknown error');
  for (const n of names) { const v = env[n]; if (v && String(v).length >= 4) m = m.split(String(v)).join('***'); }
  return m.slice(0, 200);
}

async function runSync({ env = process.env, fetch = globalThis.fetch, outDir = path.join(ROOT, 'data', 'live'), ratesFile = path.join(ROOT, 'data', 'commission_rates.json'), now = new Date(), log = console.log } = {}) {
  const configured = SOURCES.filter((s) => s.required.every((k) => env[k] && String(env[k]).trim()));
  const statusFile = path.join(outDir, 'status.json');
  if (!configured.length && !fs.existsSync(statusFile)) {
    log('No API keys are set, so nothing was pulled. The dashboard keeps its sample data. See SETUP.md.');
    return { wrote: false, results: {} };
  }
  fs.mkdirSync(outDir, { recursive: true });
  const prev = readJson(statusFile, { sources: {} });
  const rates = readJson(ratesFile, { default_rate: 0.1, reps: {} });
  const asOf = now.toISOString().slice(0, 10);
  const status = { last_run: now.toISOString(), sources: {} };
  const allSecretNames = [...new Set(SOURCES.flatMap((s) => s.secrets))];

  for (const s of SOURCES) {
    const file = path.join(outDir, `${s.key}.json`);
    const before = (prev.sources && prev.sources[s.key]) || {};
    if (!configured.includes(s)) {
      if (fs.existsSync(file)) fs.unlinkSync(file); // keys removed: go back to sample data
      status.sources[s.key] = { state: 'not_configured', synced_at: null, records: 0, message: `Add ${s.required.join(', ')} to use live ${s.label} data` };
      log(`${s.label}: not configured, skipped.`);
      continue;
    }
    try {
      const out = await s.pull({ env, fetch, asOf, rates, log: (m) => log(`${s.label}: ${redact(m, env, allSecretNames)}`) });
      const data = { source: s.label, synced_at: now.toISOString(), count: out.records.length, records: out.records };
      if (out.commission_rates) data.commission_rates = out.commission_rates;
      writeJson(file, data);
      status.sources[s.key] = { state: 'ok', synced_at: now.toISOString(), records: out.records.length, message: '' };
      log(`${s.label}: ${out.records.length} records.`);
    } catch (e) {
      const message = redact(e && e.message, env, allSecretNames);
      const kept = fs.existsSync(file);
      status.sources[s.key] = { state: 'error', synced_at: kept ? before.synced_at || null : null, records: kept ? before.records || 0 : 0, message };
      log(`${s.label}: failed: ${message}${kept ? ' (kept the last good data)' : ''}`);
      if (env.GITHUB_ACTIONS) process.stdout.write(`::warning title=${s.label} sync failed::${message}\n`);
    }
  }

  writeJson(statusFile, status);
  // One browser script with everything, so the static page needs no extra requests.
  const bundle = { status };
  for (const s of SOURCES) { const d = readJson(path.join(outDir, `${s.key}.json`), null); if (d) bundle[s.key] = d; }
  fs.writeFileSync(path.join(outDir, 'live.js'), `// Written by scripts/sync.js. Do not edit by hand.\nwindow.HaldenLive = ${JSON.stringify(bundle)};\n`);

  const failed = configured.filter((s) => status.sources[s.key].state === 'error');
  return { wrote: true, status, allFailed: configured.length > 0 && failed.length === configured.length };
}

module.exports = { runSync, redact, SOURCES };

if (require.main === module) {
  runSync().then((r) => { if (r.allFailed) process.exitCode = 1; }).catch((e) => { console.error('Sync stopped:', e.message); process.exitCode = 1; });
}
