// netlify/functions/cme-oi.js
// Uses Yahoo Finance for futures OI - proven reliable

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const YAHOO_SYMS = { ES:'ES=F', YM:'YM=F', NQ:'NQ=F', GC:'GC=F', CL:'CL=F', DX:'DX-Y.NYB' };
const NAMES = { ES:'E-Mini S&P 500', YM:'E-Mini Dow Jones', NQ:'E-Mini Nasdaq 100', GC:'Gold Futures', CL:'Crude Oil WTI', DX:'US Dollar Index' };
const TYPICAL_OI = { ES:2000000, YM:120000, NQ:500000, GC:450000, CL:1600000, DX:50000 };

async function fetchYahoo(sym, ySym) {
  try {
    // Chart endpoint for price and volume
    const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?interval=1d&range=5d`;
    const chartRes = await fetch(chartUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
    if (!chartRes.ok) throw new Error('Chart HTTP ' + chartRes.status);
    const chartData = await chartRes.json();
    const meta = chartData.chart?.result?.[0]?.meta;
    if (!meta) throw new Error('No meta');

    const price = meta.regularMarketPrice || meta.previousClose || null;
    const volume = meta.regularMarketVolume || null;
    let oi = meta.openInterest || null;

    // Try quoteSummary for OI
    if (!oi) {
      try {
        const sumUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ySym)}?modules=summaryDetail`;
        const sumRes = await fetch(sumUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
          signal: AbortSignal.timeout(8000)
        });
        if (sumRes.ok) {
          const sumData = await sumRes.json();
          oi = sumData.quoteSummary?.result?.[0]?.summaryDetail?.openInterest?.raw || null;
        }
      } catch(e2) {}
    }

    return { symbol: sym, openInterest: oi, volume, lastPrice: price, source: 'yahoo', fetchedAt: new Date().toISOString() };
  } catch(e) {
    return { symbol: sym, openInterest: null, volume: null, lastPrice: null, source: 'failed', error: e.message, fetchedAt: new Date().toISOString() };
  }
}

function oiSig(sym, oi) {
  const ref = TYPICAL_OI[sym]; if (!ref || !oi) return 'NO_DATA';
  const r = oi / ref;
  return r > 1.15 ? 'ABOVE_AVERAGE' : r > 0.85 ? 'AVERAGE' : 'BELOW_AVERAGE';
}

function volSig(vol, oi) {
  if (!vol) return 'UNKNOWN';
  if (!oi) return vol > 500000 ? 'HIGH' : vol > 100000 ? 'NORMAL' : 'LOW';
  const r = vol / oi;
  return r > 0.5 ? 'HIGH_VS_OI' : r > 0.2 ? 'NORMAL' : 'LOW_VS_OI';
}

function analyse(results) {
  const expanding = [], contracting = [], traps = [], signals = [];
  Object.keys(results).forEach(sym => {
    const d = results[sym];
    if (d.oiSignal === 'ABOVE_AVERAGE') expanding.push(sym);
    if (d.oiSignal === 'BELOW_AVERAGE') {
      contracting.push(sym);
      if (d.volumeSignal === 'HIGH_VS_OI') {
        traps.push(sym);
        signals.push(sym + ': HIGH VOL + LOW OI = LIQUIDITY TRAP');
      }
    }
  });
  const hasOI = Object.values(results).some(d => d.openInterest);
  return {
    expanding, contracting, liquidityTrapFlags: traps, signals, hasOIData: hasOI,
    summary: signals.length ? signals.join(' | ') : 'OI normal. Expanding: ' + (expanding.join(',') || 'none') + '. Contracting: ' + (contracting.join(',') || 'none') + '.'
  };
}

export default async (req, context) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: HEADERS });

  const results = {};
  const errors = [];

  await Promise.all(Object.keys(YAHOO_SYMS).map(async sym => {
    const d = await fetchYahoo(sym, YAHOO_SYMS[sym]);
    results[sym] = { ...d, productName: NAMES[sym], oiSignal: oiSig(sym, d.openInterest), volumeSignal: volSig(d.volume, d.openInterest) };
    if (d.source === 'failed') errors.push(sym);
  }));

  return new Response(JSON.stringify({
    success: true,
    timestamp: new Date().toISOString(),
    data: results,
    analysis: analyse(results),
    errors,
    note: 'Data from Yahoo Finance futures'
  }), { status: 200, headers: HEADERS });
};

export const config = { path: '/api/cme-oi' };
