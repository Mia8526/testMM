import type { VercelRequest, VercelResponse } from '@vercel/node';
import yf from 'yahoo-finance2';

function getYahooFinance() {
  let mod: any = yf;
  if (mod.default) mod = mod.default;
  if (typeof mod === 'function') return new mod();
  return mod;
}
const yahooFinance = getYahooFinance();
import { subDays, format } from 'date-fns';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set CORS headers for Vercel
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const ticker = req.query.ticker as string;
    
    if (!ticker) {
      return res.status(400).json({ error: '請提供股票代碼 (ticker)' });
    }

    let symbol = ticker.toUpperCase();
    let result: any[] = [];
    let marketType = '';
    let shortName = '';
    let currency = 'NT$';

    // Helper to fetch data with fallback
    const fetchData = async (sym: string) => {
      try {
        const endDate = new Date();
        const startDate = subDays(endDate, 550);
        const queryOptions = {
          period1: format(startDate, 'yyyy-MM-dd'),
          period2: format(endDate, 'yyyy-MM-dd'),
          interval: '1d' as const,
        };
        const historical: any = await yahooFinance.historical(sym, queryOptions);
        const quote = await yahooFinance.quote(sym);
        return { historical, quote };
      } catch (e: any) {
        return { error: e.message || String(e) };
      }
    };

    let fetchResult: any = null;
    let lastError = '';

    const tryFetch = async (sym: string) => {
      try {
        const res = await fetchData(sym);
        if (res && !('error' in res)) return res;
        if (res && 'error' in res) lastError = res.error;
        
        // Fallback to chart if historical fails
        const chartData = await yahooFinance.chart(sym, {
          period1: format(subDays(new Date(), 550), 'yyyy-MM-dd'),
          period2: format(new Date(), 'yyyy-MM-dd'),
          interval: '1d'
        });
        
        if (chartData && chartData.quotes && chartData.quotes.length > 0) {
          const quote = await yahooFinance.quote(sym);
          const historical = chartData.quotes.map((q: any) => ({
            date: q.date,
            open: q.open,
            high: q.high,
            low: q.low,
            close: q.close,
            volume: q.volume,
            adjClose: q.adjclose
          }));
          return { historical, quote };
        }
        
        return null;
      } catch (e: any) {
        lastError = e.message || String(e);
        return null;
      }
    };

    // Detect market and symbol
    if (/^\d+(\.(TW|TWO))?$/i.test(symbol)) {
      // Taiwan stock: either pure numeric or has .TW/.TWO
      const pureCode = symbol.split('.')[0];
      
      // Try TW first
      fetchResult = await tryFetch(`${pureCode}.TW`);
      if (fetchResult) {
        symbol = `${pureCode}.TW`;
        marketType = '上市';
      } else {
        // Fallback to TWO
        fetchResult = await tryFetch(`${pureCode}.TWO`);
        if (fetchResult) {
          symbol = `${pureCode}.TWO`;
          marketType = '上櫃';
        }
      }
    } else {
      // Non-numeric or other US stock logic
      fetchResult = await tryFetch(symbol);
      if (fetchResult) {
        marketType = '美股';
        currency = '$';
      }
    }

    if (!fetchResult || !fetchResult.historical || fetchResult.historical.length === 0) {
      return res.status(404).json({ 
        error: `找不到股票數據: ${ticker}`,
        details: lastError
      });
    }

    result = fetchResult.historical;
    shortName = fetchResult.quote.shortName || fetchResult.quote.longName || symbol;

    // Sort by date ascending
    const data = result.filter((d: any) => d.close !== null).sort((a: any, b: any) => a.date.getTime() - b.date.getTime());
    
    const closes = data.map(d => d.close);
    const currentPrice = closes[closes.length - 1];

    // Helper to calculate Simple Moving Average
    const calculateSMA = (prices: number[], period: number) => {
      if (prices.length < period) return null;
      const slice = prices.slice(-period);
      return slice.reduce((a, b) => a + b, 0) / period;
    };

    const ma50 = calculateSMA(closes, 50);
    const ma150 = calculateSMA(closes, 150);
    const ma200 = calculateSMA(closes, 200);

    // Volume Contraction Logic
    const volumes = data.map(d => d.volume || 0);
    const calculateAvg = (vals: number[], period: number) => {
      if (vals.length < period) return 0;
      return vals.slice(-period).reduce((a, b) => a + b, 0) / period;
    };
    const vol5 = calculateAvg(volumes, 5);
    const vol20 = calculateAvg(volumes, 20);
    const isVolumeContracted = vol5 > 0 && vol20 > 0 ? vol5 < vol20 * 0.8 : false;
    const currentVolume = volumes[volumes.length - 1];

    // 1. Static Local Pivot Logic (VCP Tightening Filter)
    let localPivot = 0;
    // Search backwards in the last 10 days for a stable tight area (5 days < 5% range)
    for (let i = data.length - 1; i >= Math.max(0, data.length - 10); i--) {
      if (i < 4) continue;
      const window = data.slice(i - 4, i + 1);
      const windowCloses = window.map(d => d.close);
      const windowVolatility = (Math.max(...window.map(d => d.high)) - Math.min(...window.map(d => d.low))) / Math.min(...window.map(d => d.low));

      if (windowVolatility < 0.05) {
        localPivot = Math.max(...windowCloses);
        break;
      }
    }
    
    // Fallback: If no strict VCP, use max of last 5 days
    if (localPivot === 0) {
      localPivot = Math.max(...data.slice(-5).map(d => d.close));
    }

    const isLocalPivotExtended = currentPrice > localPivot * 1.03;

    // Extension from 50MA Calculation
    const ma50Extension = ma50 ? ((currentPrice - ma50) / ma50) * 100 : 0;

    // Static Anchor Pivot Logic (Searching back 60 days for a stable base)
    const last250Days = data.slice(-250);
    const high52w = Math.max(...last250Days.map(d => d.high));
    const low52w = Math.min(...last250Days.map(d => d.low));

    let anchorPivot = 0;
    // Search backwards from current to 60 days ago to find the most recent consolidation base
    for (let i = data.length - 1; i >= Math.max(0, data.length - 60); i--) {
      if (i < 4) continue;
      const window = data.slice(i - 4, i + 1);
      const volatility = (Math.max(...window.map(d => d.high)) - Math.min(...window.map(d => d.low))) / Math.min(...window.map(d => d.low));
      if (volatility < 0.08) {
        anchorPivot = Math.max(...window.map(d => d.close));
        break;
      }
    }

    // If no consolidation found in 60 days, fallback to 52-week high close
    const pivotPrice = anchorPivot > 0 ? anchorPivot : Math.max(...last250Days.map(d => d.close));
    
    const buyZoneMax = pivotPrice * 1.05;
    const suggestedStopLoss = pivotPrice * 0.92;
    const priceGap = pivotPrice - currentPrice;
    const distFromPivot = ((currentPrice - pivotPrice) / pivotPrice) * 100;

    // Basic VCP status for API consistency
    let vcpStatus = "整理中";
    if (currentPrice > localPivot && isVolumeContracted) vcpStatus = "帶量突破";
    else if (isVolumeContracted) vcpStatus = "量縮盤整";

    // Trend Template Logic (Minervini)
    const cond1 = currentPrice > (ma150 || 0) && currentPrice > (ma200 || 0);
    const cond2 = (ma150 || 0) > (ma200 || 0);
    const ma200_prev = calculateSMA(closes.slice(0, -22), 200); // ~1 month ago
    const cond3 = ma200 && ma200_prev ? ma200 > ma200_prev : false;
    const cond4 = (ma50 || 0) > (ma150 || 0) && (ma50 || 0) > (ma200 || 0);
    const cond5 = currentPrice > (ma50 || 0);
    const distFromLow = (currentPrice - low52w) / low52w;
    const cond6 = distFromLow >= 0.30;
    const distFromHigh = (high52w - currentPrice) / high52w;
    const cond7 = distFromHigh <= 0.25;

    const isTemplateMet = cond1 && cond2 && cond3 && cond4 && cond5 && cond6 && cond7;

    res.status(200).json({
      symbol,
      shortName,
      marketType,
      currency,
      currentPrice,
      ma50,
      ma150,
      ma200,
      ma50Extension: ma50Extension.toFixed(2),
      extensionFrom50MA: ma50Extension.toFixed(2),
      isVolumeContracted,
      localPivot,
      isLocalPivotExtended,
      vcpStatus,
      pivotPrice,
      buyZoneMax,
      suggestedStopLoss,
      priceGap,
      distanceFromPivot: distFromPivot.toFixed(2),
      high52w,
      low52w,
      distFromHigh: (distFromHigh * 100).toFixed(2),
      distFromLow: (distFromLow * 100).toFixed(2),
      conditions: {
        priceAboveMAs: cond1,
        ma150Above200: cond2,
        ma200Trending: cond3,
        ma50AboveOthers: cond4,
        priceAbove50MA: cond5,
        aboveLow30: cond6,
        nearHigh25: cond7
      },
      fundamentalStatus: "技術面符合，等待財報數據串接",
      isTemplateMet,
      chartData: data.slice(-200).map(d => ({
        date: format(d.date, 'yyyy-MM-dd'),
        price: d.close,
        ma50: calculateSMA(closes.slice(0, data.indexOf(d) + 1), 50),
        ma150: calculateSMA(closes.slice(0, data.indexOf(d) + 1), 150),
        ma200: calculateSMA(closes.slice(0, data.indexOf(d) + 1), 200),
      }))
    });
  } catch (error) {
    console.error('Vercel API Error:', error);
    res.status(500).json({ error: '抓取數據失敗' });
  }
}
