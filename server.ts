import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance();
import { subDays, format } from 'date-fns';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // API Route: Fetch stock data and calculate indicators
  app.get('/api/stock', async (req, res) => {
    const ticker = req.query.ticker as string;
    console.log(`API Request received for ticker: ${ticker}`);
    try {
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
          console.error(`Error fetching ${sym}:`, e);
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

      // Extension from 50MA Calculation
      const ma50Extension = ma50 ? ((currentPrice - ma50) / ma50) * 100 : 0;

      // Pivot Radar Logic (Simplified as per user request)
      const last20Days = data.slice(-20);
      const last20DaysClose = last20Days.map(d => d.close);
      const pivotPrice = Math.max(...last20DaysClose);
      const buyZoneMax = pivotPrice * 1.05;
      const suggestedStopLoss = pivotPrice * 0.92;
      const priceGap = pivotPrice - currentPrice;
      const distFromPivot = ((currentPrice - pivotPrice) / pivotPrice) * 100;

      // 52-week data (approx 252 trading days)
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

      res.json({
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
      console.error('API Error:', error);
      res.status(500).json({ error: '抓取數據失敗' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`>>> Server is listening on 0.0.0.0:${PORT}`);
    console.log(`>>> NODE_ENV: ${process.env.NODE_ENV}`);
  });
}

console.log('>>> Starting server...');
startServer().catch(err => {
  console.error('>>> Server failed to start:', err);
});
