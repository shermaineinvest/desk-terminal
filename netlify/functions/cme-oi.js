// netlify/functions/cme-oi.js
// Uses native fetch (Node 18+) - no dependencies needed

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const CME_PRODUCTS = {
  ES: { name: 'E-Mini S&P 500' },
  YM: { name: 'E-Mini Dow Jones' },
  NQ: { name: 'E-Mini Nasdaq 100' },
  GC: { name: 'Gold Futures' },
  CL: { name: 'Crude Oil WTI' },
  DX: { name: 'US Dollar Index' }
};

// Barchart continuous contract symbols (update quarterly)
const BC_SYMS = {
  ES: 'ESU25', YM: 'YMU25', NQ: 'NQU25',
  GC: 'GCQ25', CL: 'CLN25', DX: 'DXU25'
};

async function fetchBarchart(symbol) {
  try {
    const url = `https://www.barchart.com/proxies/core-api/v1/quotes/get?symbols=${symbol}&fields=symbol,lastPrice,openInterest,volume,tradeTime&raw=1`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DESK/6.0)',
        'Accept': 'application/json',
        'Referer': 'https://www.barchart.com'
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const q = data.data && data.data[0] && data.data[0].raw;
    if (!q) return null;
    return {
      openInterest: q.openInterest || null,
      volume: q.volume || null,
      lastPrice: q.lastPrice || null,
      source: 'barchart'
    };
  } catch(e) { return null; }
}

async function fetchCME(sym) {
  const ids = { ES: 4499, NQ: 4500, YM: 4488, GC: 437, CL: 425, DX: 4148 };
  const id = ids[sym];
  if (!id) return null;
  try {
    const url = `https://www.cmegroup.com/CmeWS/mvc/Quotes/Future/${id}/G?quoteCodes=null`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DESK/6.0)',
        'Accept': 'application/json',
        'Referer': 'https://www.cmegroup.com'
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const q = data.quotes && data.quotes[0];
    if (!q) return null;
    return {
      openInterest: parseInt(q.openInterest) || null,
      volume: parseInt(q.volume) || null,
      lastPrice: parseFloat(q.last) || null,
      source: 'cme'
    };
  } catch(e) { return null; }
}

function interpretOI(sym, oi) {
  const typical = { ES: 2000000, YM: 120000, NQ: 500000, GC: 450000, CL: 1600000, DX: 50000 };
  const ref = typical[sym];
  if (!ref || !oi) return 'UNKNOWN';
  const r = oi / ref;
  if (r > 1.15) return 'ABOVE_AVERAGE';
  if (r > 0.85) return 'AVERAGE';
  return 'BELOW_AVERAGE';
}

function analyse(results) {
  const expanding = [], contracting = [], traps = [], signals = [];
  Object.keys(results).forEach(sym => {
    const d = results[sym];
    if (!d.openInterest) return;
    if (d.oiSignal === 'ABOVE_AVERAGE') expanding.push(sym);
    if (d.oiSignal === 'BELOW_AVERAGE') {
      contracting.push(sym);
      if (d.volume && (d.volume / d.openInterest) > 0.4) {
        traps.push(sym);
        signals.push(`${sym}: HIGH VOL + LOW OI = LIQUIDITY TRAP`);
      }
    }
  });
  return {
    expanding, contracting,
    liquidityTrapFlags: traps,
    signals,
    summary: signals.length
      ? signals.join(' | ')
      : `OI normal. Expanding: ${expanding.join(',') || 'none'}. Contracting: ${contracting.join(',') || 'none'}.`
  };
}

export default async (req, context) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 200, headers: HEADERS });
  }

  const results = {};
  const errors = [];

  await Promise.all(Object.keys(CME_PRODUCTS).map(async sym => {
    try {
      let d = await fetchBarchart(BC_SYMS[sym]);
      if (!d) d = await fetchCME(sym);
      if (d) {
        results[sym] = {
          ...d,
          symbol: sym,
          productName: CME_PRODUCTS[sym].name,
          oiSignal: interpretOI(sym, d.openInterest),
          fetchedAt: new Date().toISOString()
        };
      } else {
        results[sym] = { symbol: sym, openInterest: null, volume: null, oiSignal: 'FETCH_FAILED', fetchedAt: new Date().toISOString() };
        errors.push(sym);
      }
    } catch(e) {
      results[sym] = { symbol: sym, oiSignal: 'ERROR', error: e.message, fetchedAt: new Date().toISOString() };
      errors.push(sym);
    }
  }));

  return new Response(JSON.stringify({
    success: true,
    timestamp: new Date().toISOString(),
    data: results,
    analysis: analyse(results),
    errors,
    note: errors.length ? `${errors.length} failed: ${errors.join(', ')}` : 'All fetched'
  }), { status: 200, headers: HEADERS });
};

export const config = { path: '/api/cme-oi' };
