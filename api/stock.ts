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
    
    // Auto-append .TW if it's a 4-digit numeric code (Taiwan stock)
    if (/^\d{4}$/.test(symbol)) {
      symbol = `${symbol}.TW`;
    } else if (!symbol.includes('.')) {
      symbol = `${symbol}.TW`;
    }

    // Fetch historical data for the last 1.5 years
    const endDate = new Date();
    const startDate = subDays(endDate, 550);

    const queryOptions = {
      period1: startDate,
      period2: endDate,
      interval: '1d' as const,
    };

    const result = await yahooFinance.historical(symbol, queryOptions) as any[];
    
    if (!result || result.length === 0) {
      return res.status(404).json({ error: `找不到股票數據: ${symbol}` });
    }

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

    // 52-week data
    const lastYearData = data.slice(-252);
    const high52w = Math.max(...lastYearData.map(d => d.high));
    const low52w = Math.min(...lastYearData.map(d => d.low));

    // Trend Template Logic
    const condition1 = currentPrice > (ma50 || 0) && (ma50 || 0) > (ma150 || 0) && (ma150 || 0) > (ma200 || 0);
    const distFromHigh = (high52w - currentPrice) / high52w;
    const condition2 = distFromHigh <= 0.25;
    const distFromLow = (currentPrice - low52w) / low52w;
    const condition3 = distFromLow >= 0.30;
    const ma200_prev = calculateSMA(closes.slice(0, -20), 200);
    const condition4 = ma200 && ma200_prev ? ma200 > ma200_prev : false;

    const isTemplateMet = condition1 && condition2 && condition3;

    res.status(200).json({
      symbol,
      currentPrice,
      ma50,
      ma150,
      ma200,
      high52w,
      low52w,
      distFromHigh: (distFromHigh * 100).toFixed(2),
      distFromLow: (distFromLow * 100).toFixed(2),
      conditions: {
        maAlignment: condition1,
        nearHigh: condition2,
        aboveLow: condition3,
        ma200Trending: condition4
      },
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
