
// netlify/functions/cme-oi.js
const fetch = require('node-fetch');

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const CME_PRODUCTS = {
  ES: { code: 'ES', name: 'E-Mini S&P 500', exchange: 'CME' },
  YM: { code: 'YM', name: 'E-Mini Dow Jones', exchange: 'CBOT' },
  NQ: { code: 'NQ', name: 'E-Mini Nasdaq 100', exchange: 'CME' },
  GC: { code: 'GC', name: 'Gold Futures', exchange: 'COMEX' },
  CL: { code: 'CL', name: 'Crude Oil WTI', exchange: 'NYMEX' },
  DX: { code: 'DX', name: 'US Dollar Index', exchange: 'ICE' }
};

async function fetchBarchartOI(symbol) {
  try {
    const url = `https://www.barchart.com/proxies/core-api/v1/quotes/get?symbols=${symbol}&fields=symbol,lastPrice,priceChange,percentChange,openInterest,volume,tradeTime&groupBy=none&hasOptions=true&raw=1`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DESK-Terminal/6.0)',
        'Accept': 'application/json',
        'Referer': 'https://www.barchart.com'
      }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const quote = data.data && data.data[0] && data.data[0].raw;
    if (!quote) return null;
    return {
      symbol, openInterest: quote.openInterest || null,
      volume: quote.volume || null, lastPrice: quote.lastPrice || null,
      source: 'barchart'
    };
  } catch (e) { return null; }
}

async function fetchCMEDirect(symbol) {
  try {
    const ids = { ES: 4499, NQ: 4500, YM: 4488, GC: 437, CL: 425, DX: 4148 };
    const url = `https://www.cmegroup.com/CmeWS/mvc/Quotes/Future/${ids[symbol]}/G?quoteCodes=null&_=1`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DESK-Terminal/6.0)',
        'Accept': 'application/json',
        'Referer': 'https://www.cmegroup.com'
      }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const quote = data.quotes && data.quotes[0];
    if (!quote) return null;
    return {
      symbol, openInterest: parseInt(quote.openInterest) || null,
      volume: parseInt(quote.volume) || null,
      lastPrice: parseFloat(quote.last) || null, source: 'cme'
    };
  } catch (e) { return null; }
}

function interpretOI(symbol, oi, volume) {
  const typicalOI = { ES: 2000000, YM: 120000, NQ: 500000, GC: 450000, CL: 1600000, DX: 50000 };
  const ref = typicalOI[symbol];
  if (!ref) return 'UNKNOWN';
  const ratio = oi / ref;
  if (ratio > 1.15) return 'ABOVE_AVERAGE';
  if (ratio > 0.85) return 'AVERAGE';
  return 'BELOW_AVERAGE';
}

function generateOIAnalysis(results) {
  const signals = [], liquidityTraps = [], expanding = [], contracting = [];
  Object.keys(results).forEach(sym => {
    const d = results[sym];
    if (!d.openInterest) return;
    if (d.volume && d.openInterest) {
      const volOIRatio = d.volume / d.openInterest;
      if (volOIRatio > 0.4 && d.oiSignal === 'BELOW_AVERAGE') {
        liquidityTraps.push(sym);
        signals.push(`${sym}: HIGH VOLUME + BELOW-AVG OI = POTENTIAL LIQUIDITY TRAP`);
      }
    }
    if (d.oiSignal === 'ABOVE_AVERAGE') expanding.push(sym);
    if (d.oiSignal === 'BELOW_AVERAGE') contracting.push(sym);
  });
  return {
    expanding, contracting, liquidityTrapFlags: liquidityTraps, signals,
    summary: signals.length > 0 ? signals.join(' | ')
      : `OI normal: ${expanding.join(',') || 'none'} above avg; ${contracting.join(',') || 'none'} below avg`
  };
}

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  const results = {}, errors = [];
  const bcSymMap = { ES: 'ESM25', YM: 'YMM25', NQ: 'NQM25', GC: 'GCM25', CL: 'CLM25', DX: 'DXM25' };
  await Promise.all(['ES','YM','NQ','GC','CL','DX'].map(async (sym) => {
    try {
      let data = await fetchBarchartOI(bcSymMap[sym]);
      if (!data) data = await fetchCMEDirect(sym);
      if (data) {
        results[sym] = { ...data, productName: CME_PRODUCTS[sym].name,
          oiSignal: data.openInterest > 0 ? interpretOI(sym, data.openInterest, data.volume) : 'NO_DATA',
          fetchedAt: new Date().toISOString() };
      } else {
        results[sym] = { symbol: sym, productName: CME_PRODUCTS[sym].name,
          openInterest: null, volume: null, oiSignal: 'FETCH_FAILED',
          fetchedAt: new Date().toISOString() };
        errors.push(sym);
      }
    } catch (e) {
      results[sym] = { symbol: sym, error: e.message, oiSignal: 'ERROR', fetchedAt: new Date().toISOString() };
      errors.push(sym);
    }
  }));
  return {
    statusCode: 200, headers: HEADERS,
    body: JSON.stringify({ success: true, timestamp: new Date().toISOString(),
      data: results, analysis: generateOIAnalysis(results), errors,
      note: errors.length > 0 ? `${errors.length} failed: ${errors.join(', ')}` : 'All fetched successfully' })
  };
};
