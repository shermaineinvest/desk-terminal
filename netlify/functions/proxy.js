// netlify/functions/proxy.js
// Generic CORS proxy - native fetch, no dependencies

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const ALLOWED = [
  'www.cmegroup.com', 'cmegroup.com',
  'cdn.cboe.com', 'publicreporting.cftc.gov',
  'fred.stlouisfed.org', 'www.barchart.com',
  'query1.finance.yahoo.com', 'query2.finance.yahoo.com'
];

export default async (req, context) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: HEADERS });

  const url = new URL(req.url);
  const target = url.searchParams.get('url');
  if (!target) return new Response(JSON.stringify({ error: 'Missing url' }), { status: 400, headers: HEADERS });

  let parsed;
  try { parsed = new URL(decodeURIComponent(target)); } catch(e) {
    return new Response(JSON.stringify({ error: 'Invalid URL' }), { status: 400, headers: HEADERS });
  }

  const allowed = ALLOWED.some(d => parsed.hostname === d || parsed.hostname.endsWith('.' + d));
  if (!allowed) return new Response(JSON.stringify({ error: 'Domain not allowed: ' + parsed.hostname }), { status: 403, headers: HEADERS });

  try {
    const res = await fetch(decodeURIComponent(target), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DESK/6.0)',
        'Accept': 'application/json, text/csv, text/plain, */*',
        'Referer': parsed.origin
      },
      signal: AbortSignal.timeout(10000)
    });
    const ct = res.headers.get('content-type') || '';
    const body = ct.includes('json') ? await res.json() : await res.text();
    return new Response(
      typeof body === 'string' ? body : JSON.stringify(body),
      { status: res.status, headers: { ...HEADERS, 'Content-Type': ct || 'text/plain' } }
    );
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: HEADERS });
  }
};

export const config = { path: '/api/proxy' };
