import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import yahooFinance from 'yahoo-finance2';
import { subDays, format } from 'date-fns';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route: Fetch stock data and calculate indicators
  app.get('/api/stock/:symbol', async (req, res) => {
    try {
      let symbol = req.params.symbol.toUpperCase();
      
      // Auto-append .TW if it's a 4-digit numeric code (Taiwan stock)
      if (/^\d{4}$/.test(symbol)) {
        symbol = `${symbol}.TW`;
      } else if (!symbol.includes('.')) {
        // Fallback for other Taiwan stocks like 2330.TWO
        symbol = `${symbol}.TW`;
      }

      // Fetch historical data for the last 1.5 years to calculate 200MA and 52-week high/low
      const endDate = new Date();
      const startDate = subDays(endDate, 550); // ~1.5 years

      const queryOptions = {
        period1: startDate,
        period2: endDate,
        interval: '1d' as const,
      };

      const result = await yahooFinance.historical(symbol, queryOptions) as any[];
      
      if (!result || result.length === 0) {
        return res.status(404).json({ error: '找不到該股票數據' });
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

      // 52-week data (approx 252 trading days)
      const lastYearData = data.slice(-252);
      const high52w = Math.max(...lastYearData.map(d => d.high));
      const low52w = Math.min(...lastYearData.map(d => d.low));

      // Trend Template Logic
      // 1. 收盤價 > 50MA > 150MA > 200MA
      const condition1 = currentPrice > (ma50 || 0) && (ma50 || 0) > (ma150 || 0) && (ma150 || 0) > (ma200 || 0);
      
      // 2. 目前股價距離 52 週高點在 25% 以內
      const distFromHigh = (high52w - currentPrice) / high52w;
      const condition2 = distFromHigh <= 0.25;

      // 3. 高於 52 週低點 30%
      const distFromLow = (currentPrice - low52w) / low52w;
      const condition3 = distFromLow >= 0.30;

      // 4. 200MA is trending up (extra check for Minervini)
      const ma200_prev = calculateSMA(closes.slice(0, -20), 200); // 200MA from 20 days ago
      const condition4 = ma200 && ma200_prev ? ma200 > ma200_prev : false;

      const isTemplateMet = condition1 && condition2 && condition3;

      res.json({
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
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
