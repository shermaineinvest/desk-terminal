
// netlify/functions/proxy.js
// Generic CORS proxy for financial data APIs that block browsers
// Called as: /api/proxy?url=ENCODED_URL

const fetch = require('node-fetch');

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

// Allowlist of domains we permit proxying (security)
const ALLOWED_DOMAINS = [
  'www.cmegroup.com',
  'cmegroup.com',
  'cdn.cboe.com',
  'publicreporting.cftc.gov',
  'fred.stlouisfed.org',
  'ticdata.treasury.gov',
  'www.barchart.com',
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com'
];

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  const targetUrl = event.queryStringParameters && event.queryStringParameters.url;
  if (!targetUrl) {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ error: 'Missing url parameter' })
    };
  }

  // Security: only allow whitelisted domains
  let parsedUrl;
  try {
    parsedUrl = new URL(decodeURIComponent(targetUrl));
  } catch (e) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid URL' }) };
  }

  const domainAllowed = ALLOWED_DOMAINS.some(d => parsedUrl.hostname === d || parsedUrl.hostname.endsWith('.' + d));
  if (!domainAllowed) {
    return {
      statusCode: 403,
      headers: HEADERS,
      body: JSON.stringify({ error: `Domain not allowed: ${parsedUrl.hostname}` })
    };
  }

  try {
    const res = await fetch(decodeURIComponent(targetUrl), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DESK-Terminal/6.0; Institutional Research Tool)',
        'Accept': 'application/json, text/csv, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': parsedUrl.origin
      },
      timeout: 10000
    });

    const contentType = res.headers.get('content-type') || '';
    let body;
    if (contentType.includes('application/json')) {
      body = await res.json();
      return {
        statusCode: res.status,
        headers: { ...HEADERS },
        body: JSON.stringify(body)
      };
    } else {
      // CSV, text, HTML
      body = await res.text();
      return {
        statusCode: res.status,
        headers: { ...HEADERS, 'Content-Type': 'text/plain' },
        body: body
      };
    }
  } catch (e) {
    return {
      statusCode: 502,
      headers: HEADERS,
      body: JSON.stringify({ error: 'Upstream fetch failed: ' + e.message })
    };
  }
};
