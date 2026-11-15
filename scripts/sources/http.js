// Small fetch helpers shared by the sync sources. Node 18+ (global fetch), no dependencies.
'use strict';

class HttpError extends Error {
  constructor(source, status, detail) {
    super(`${source} returned HTTP ${status}${detail ? ` (${detail})` : ''}`);
    this.status = status;
  }
}

// Pull a short, safe error code out of an API error body. Never echo the whole body.
function errorDetail(text) {
  try {
    const j = JSON.parse(text);
    const code = j.error || j.category || j.code || (j.Fault && j.Fault.type) || (j.errors && j.errors[0] && (j.errors[0].code || j.errors[0].type));
    return typeof code === 'string' ? code.slice(0, 60) : '';
  } catch (e) { return ''; }
}

async function request(fetchFn, source, url, opts = {}) {
  const res = await fetchFn(url, { ...opts, signal: AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined });
  const text = await res.text();
  if (!res.ok) throw new HttpError(source, res.status, errorDetail(text));
  try { return JSON.parse(text); } catch (e) { throw new Error(`${source} sent a response that is not JSON`); }
}

const basic = (id, secret) => 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');

module.exports = { request, basic, HttpError };
