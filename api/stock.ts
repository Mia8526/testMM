import type { VercelRequest, VercelResponse } from '@vercel/node';
import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance();
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
          period1: startDate,
          period2: endDate,
          interval: '1d' as const,
        };
        const historical = await yahooFinance.historical(sym, queryOptions);
        const quote = await yahooFinance.quote(sym);
        return { historical, quote };
      } catch (e) {
        return null;
      }
    };

    let fetchResult = null;

    if (/^\d+$/.test(symbol)) {
      // Pure numeric: Taiwan stock logic
      fetchResult = await fetchData(`${symbol}.TW`);
      if (fetchResult) {
        symbol = `${symbol}.TW`;
        marketType = '上市';
      } else {
        fetchResult = await fetchData(`${symbol}.TWO`);
        if (fetchResult) {
          symbol = `${symbol}.TWO`;
          marketType = '上櫃';
        }
      }
    } else {
      // Contains letters: US stock logic
      fetchResult = await fetchData(symbol);
      if (fetchResult) {
        marketType = '美股';
        currency = '$';
      }
    }

    if (!fetchResult || !fetchResult.historical || fetchResult.historical.length === 0) {
      return res.status(404).json({ error: `找不到股票數據: ${ticker}` });
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

    // Local Pivot (last 5 days high)
    const last5Days = data.slice(-5);
    const localPivot = Math.max(...last5Days.map(d => d.high));

    // VCP Status
    let vcpStatus = "整理中";
    const isNearLocalPivot = currentPrice >= localPivot * 0.98 && currentPrice <= localPivot * 1.02;
    if (currentPrice > localPivot && currentVolume > vol20) {
      vcpStatus = "突破 VCP 買點！";
    } else if (isNearLocalPivot && isVolumeContracted) {
      vcpStatus = "緊縮：等待突破";
    }

    // Extension from 50MA Calculation
    const ma50Extension = ma50 ? ((currentPrice - ma50) / ma50) * 100 : 0;

    // Advanced Pivot Radar Logic (Stable Base Finding)
    const last60Days = data.slice(-60);
    let pivotPrice = 0;
    let foundBase = false;

    // 1. Check for Trend Break (Price below 50MA for > 3 days)
    const recentCloses = data.slice(-3);
    const isTrendBroken = ma50 ? recentCloses.every(d => d.close < ma50) : false;

    // 2. Search for the most recent "Stable Base" (5 days, < 8% volatility)
    // We search backwards to find the most recent consolidation
    for (let i = data.length - 1; i >= Math.max(0, data.length - 60); i--) {
      if (i < 4) continue;
      
      const window = data.slice(i - 4, i + 1);
      const highs = window.map(d => d.high);
      const lows = window.map(d => d.low);
      const windowCloses = window.map(d => d.close);
      
      const maxHigh = Math.max(...highs);
      const minLow = Math.min(...lows);
      const volatility = (maxHigh - minLow) / minLow;

      if (volatility < 0.08) {
        pivotPrice = Math.max(...windowCloses);
        foundBase = true;
        // If we found a base, and the price hasn't broken the trend since then, 
        // we lock this pivot. We stop at the first (most recent) base found.
        break;
      }
    }

    // 3. Fallback or Reset logic
    if (!foundBase || isTrendBroken) {
      // If no base found in 60 days or trend is broken, 
      // use the standard 20-day high as a temporary pivot
      const last20Days = data.slice(-20);
      pivotPrice = Math.max(...last20Days.map(d => d.close));
    }
    
    const buyZoneMax = pivotPrice * 1.05;
    const suggestedStopLoss = pivotPrice * 0.92;
    const priceGap = pivotPrice - currentPrice;
    const distFromPivot = ((currentPrice - pivotPrice) / pivotPrice) * 100;

    // 52-week data
    const lastYearData = data.slice(-252);
    const high52w = Math.max(...lastYearData.map(d => d.high));
    const low52w = Math.min(...lastYearData.map(d => d.low));

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
