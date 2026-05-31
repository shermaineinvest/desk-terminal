// netlify/functions/proxy.js
// Reliable CORS proxy using native fetch - no dependencies

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const ALLOWED = [
  'cdn.cboe.com',
  'publicreporting.cftc.gov',
  'fred.stlouisfed.org',
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
  'www.barchart.com'
];

export default async (req, context) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 200, headers: HEADERS });
  }

  const url = new URL(req.url);
  const target = url.searchParams.get('url');

  if (!target) {
    return new Response(JSON.stringify({ error: 'Missing url parameter' }), { status: 400, headers: HEADERS });
  }

  let parsed;
  try {
    parsed = new URL(decodeURIComponent(target));
  } catch(e) {
    return new Response(JSON.stringify({ error: 'Invalid URL' }), { status: 400, headers: HEADERS });
  }

  const allowed = ALLOWED.some(d => parsed.hostname === d || parsed.hostname.endsWith('.' + d));
  if (!allowed) {
    return new Response(JSON.stringify({ error: 'Domain not allowed: ' + parsed.hostname }), { status: 403, headers: HEADERS });
  }

  try {
    const res = await fetch(decodeURIComponent(target), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/csv, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache'
      },
      signal: AbortSignal.timeout(12000)
    });

    const contentType = res.headers.get('content-type') || '';
    const body = await res.text();

    return new Response(body, {
      status: res.status,
      headers: {
        ...HEADERS,
        'Content-Type': contentType || 'text/plain'
      }
    });
  } catch(e) {
    return new Response(
      JSON.stringify({ error: 'Fetch failed: ' + e.message }),
      { status: 502, headers: HEADERS }
    );
  }
};

export const config = { path: '/api/proxy' };
