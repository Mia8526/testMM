import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import yf from 'yahoo-finance2';
import { subDays, format } from 'date-fns';

/**
 * Utility functions for technical indicators (Inlined for reliability)
 */
function calculateSMA(prices: (number | null | undefined)[], period: number): number | null {
  if (!prices || !Array.isArray(prices) || period <= 0) return null;
  const validPrices = prices.filter((p): p is number => typeof p === 'number' && !isNaN(p));
  if (validPrices.length < period) return null;
  const slice = validPrices.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

function calculateEMA(prices: (number | null | undefined)[], period: number): number | null {
  if (!prices || !Array.isArray(prices) || period <= 0) return null;
  const validPrices = prices.filter((p): p is number => typeof p === 'number' && !isNaN(p));
  if (validPrices.length < period) return null;
  const multiplier = 2 / (period + 1);
  const firstPeriod = validPrices.slice(0, period);
  let ema = firstPeriod.reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < validPrices.length; i++) {
    ema = (validPrices[i] - ema) * multiplier + ema;
  }
  return ema;
}

function percentile(values: number[], p: number): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const idx = (sorted.length - 1) * p;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

function detectRangeBox(data: any[], currentPrice: number) {
  const lookbackDays = 45;
  const minDays = 25;
  const recent = data.slice(-lookbackDays).filter((d) =>
    Number.isFinite(d.high) && Number.isFinite(d.low) && Number.isFinite(d.close)
  );

  if (recent.length < minDays || !Number.isFinite(currentPrice) || currentPrice <= 0) {
    return {
      isBoxRange: false,
      lookbackDays: recent.length,
      upper: null,
      lower: null,
      widthPct: null,
      currentPositionPct: null,
      status: '資料不足',
      action: '近 45 日資料不足，先不用硬判斷箱型。',
    };
  }

  const highs = recent.map((d) => Number(d.high));
  const lows = recent.map((d) => Number(d.low));
  const closes = recent.map((d) => Number(d.close));
  const upper = percentile(highs, 0.9);
  const lower = percentile(lows, 0.1);

  if (upper === null || lower === null || upper <= lower) {
    return {
      isBoxRange: false,
      lookbackDays: recent.length,
      upper: null,
      lower: null,
      widthPct: null,
      currentPositionPct: null,
      status: '尚無明確箱型',
      action: '上下緣不清楚，先看均線與樞紐訊號。',
    };
  }

  const mid = (upper + lower) / 2;
  const width = upper - lower;
  const widthPct = (width / mid) * 100;
  const tolerance = Math.max(width * 0.12, currentPrice * 0.015);
  const upperTouches = highs.filter((v) => v >= upper - tolerance).length;
  const lowerTouches = lows.filter((v) => v <= lower + tolerance).length;
  const first10 = closes.slice(0, 10);
  const last10 = closes.slice(-10);
  const firstAvg = first10.reduce((s, v) => s + v, 0) / first10.length;
  const lastAvg = last10.reduce((s, v) => s + v, 0) / last10.length;
  const slopePct = ((lastAvg - firstAvg) / mid) * 100;
  const isWidthOk = widthPct >= 4 && widthPct <= 30;
  const hasEnoughTouches = upperTouches >= 2 && lowerTouches >= 2;
  const isSlopeOk = Math.abs(slopePct) <= 18;
  const isBoxRange = isWidthOk && hasEnoughTouches && isSlopeOk;
  const rawPositionPct = ((currentPrice - lower) / width) * 100;
  const currentPositionPct = Math.max(0, Math.min(100, rawPositionPct));

  let status = '尚無明確箱型';
  let action = `近 ${recent.length} 日參考區間約 ${lower.toFixed(2)}～${upper.toFixed(2)}，但箱型訊號還不夠明確，不畫箱型。`;

  if (!isBoxRange) {
    if (currentPrice > upper * 1.03 || slopePct > 18) {
      status = '非箱型：趨勢太強';
      action = `這比較像單邊上攻，不是箱型。近 ${recent.length} 日漲勢斜率約 ${slopePct.toFixed(1)}%，區間寬度 ${widthPct.toFixed(1)}%；不要用箱頂/箱底模型低接，先等整理或回測。`;
    } else if (slopePct < -18) {
      status = '非箱型：下降趨勢明顯';
      action = `這比較像下行趨勢，不是箱型。近 ${recent.length} 日斜率約 ${slopePct.toFixed(1)}%，先等止跌與上下緣重新成形。`;
    } else if (!isWidthOk) {
      status = widthPct > 30 ? '非箱型：波動過大' : '非箱型：區間太窄';
      action = `近 ${recent.length} 日區間寬度 ${widthPct.toFixed(1)}%，不適合標成箱型；先當成參考高低位，不當成買賣箱。`;
    } else if (!hasEnoughTouches) {
      status = '非箱型：上下緣碰觸不足';
      action = `上下緣碰觸次數不足（上緣 ${upperTouches} 次、下緣 ${lowerTouches} 次），還不能確認是箱型。`;
    }
  } else if (currentPrice > upper * 1.03) {
    status = '箱型突破確認中';
    action = `已高於箱型上緣 ${upper.toFixed(2)} 超過 3%，下一步看回測是否守住上緣，不建議追在急拉尖端。`;
  } else if (currentPrice > upper) {
    status = '測試箱型上緣';
    action = `正在測試上緣 ${upper.toFixed(2)}，等收盤站穩或回測不破再當突破，避免買在箱頂。`;
  } else if (currentPositionPct >= 80) {
    status = '箱型上緣壓力區';
    action = `接近上緣 ${upper.toFixed(2)}，風險是把箱頂誤判成突破；較佳策略是等有效突破或拉回靠近中下緣。`;
  } else if (currentPositionPct <= 25) {
    status = '箱型下緣支撐區';
    action = `接近下緣 ${lower.toFixed(2)}，若量縮守住可觀察；跌破下緣要小心箱型失效。`;
  } else {
    status = '箱型中段整理';
    action = `目前在箱型中段，先看 ${lower.toFixed(2)}～${upper.toFixed(2)} 區間，不必急著追價。`;
  }

  return {
    isBoxRange,
    lookbackDays: recent.length,
    upper,
    lower,
    widthPct,
    currentPositionPct,
    status,
    action,
  };
}

function getYahooFinance() {
  let mod: any = yf;
  if (mod.default) mod = mod.default;
  if (typeof mod === 'function') return new mod();
  return mod;
}
const yahooFinance = getYahooFinance();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let listedNameMapCache: Record<string, string> | null = null;
let listedNameMapPromise: Promise<Record<string, string>> | null = null;
let otcNameMapCache: Record<string, string> | null = null;
let otcNameMapPromise: Promise<Record<string, string>> | null = null;

async function fetchJsonArray(url: string): Promise<Record<string, string>[]> {
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
      },
    });
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data) ? data : data?.data ?? [];
  } catch {
    return [];
  }
}

function parseOptionalNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).replace(/[,\s]/g, '').trim();
  if (!cleaned || cleaned === '-' || cleaned === '—') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

type ExchangeValuation = {
  trailingPE: number | null;
  referencePrice: number | null;
  source: 'TWSE' | 'TPEX';
};

let listedValuationMapCache: Record<string, ExchangeValuation> | null = null;
let listedValuationMapPromise: Promise<Record<string, ExchangeValuation>> | null = null;
let otcValuationMapCache: Record<string, ExchangeValuation> | null = null;
let otcValuationMapPromise: Promise<Record<string, ExchangeValuation>> | null = null;

async function getListedValuationMap(): Promise<Record<string, ExchangeValuation>> {
  if (listedValuationMapCache) return listedValuationMapCache;
  if (!listedValuationMapPromise) {
    listedValuationMapPromise = (async () => {
      const [rows, closeRows] = await Promise.all([
        fetchJsonArray('https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL'),
        fetchJsonArray('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'),
      ]);
      const closeMap: Record<string, number> = {};
      for (const row of closeRows) {
        const code = String(row.Code ?? row['證券代號'] ?? '').trim();
        const close = parseOptionalNumber(row.ClosingPrice ?? row['收盤價']);
        if (code && close !== null && close > 0) closeMap[code] = close;
      }
      const map: Record<string, ExchangeValuation> = {};

      for (const row of rows) {
        const code = String(row.Code ?? row['股票代號'] ?? '').trim();
        const trailingPE = parseOptionalNumber(row.PEratio ?? row['本益比']);
        if (code && trailingPE !== null && trailingPE > 0) {
          map[code] = { trailingPE, referencePrice: closeMap[code] ?? null, source: 'TWSE' };
        }
      }

      listedValuationMapCache = map;
      return map;
    })().finally(() => {
      listedValuationMapPromise = null;
    });
  }
  return listedValuationMapPromise;
}

async function getOtcValuationMap(): Promise<Record<string, ExchangeValuation>> {
  if (otcValuationMapCache) return otcValuationMapCache;
  if (!otcValuationMapPromise) {
    otcValuationMapPromise = (async () => {
      const [rows, closeRows] = await Promise.all([
        fetchJsonArray('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis'),
        fetchJsonArray('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'),
      ]);
      const closeMap: Record<string, number> = {};
      for (const row of closeRows) {
        const code = String(row.SecuritiesCompanyCode ?? row.Code ?? '').trim();
        const close = parseOptionalNumber(row.Close ?? row.ClosePrice ?? row['收盤價']);
        if (code && close !== null && close > 0) closeMap[code] = close;
      }
      const map: Record<string, ExchangeValuation> = {};

      for (const row of rows) {
        const code = String(row.SecuritiesCompanyCode ?? row.Code ?? '').trim();
        const trailingPE = parseOptionalNumber(row.PriceEarningRatio ?? row.PEratio ?? row['本益比']);
        if (code && trailingPE !== null && trailingPE > 0) {
          map[code] = { trailingPE, referencePrice: closeMap[code] ?? null, source: 'TPEX' };
        }
      }

      otcValuationMapCache = map;
      return map;
    })().finally(() => {
      otcValuationMapPromise = null;
    });
  }
  return otcValuationMapPromise;
}

async function getExchangeValuation(code: string, marketType: string): Promise<ExchangeValuation | null> {
  if (marketType === '上市') {
    const map = await getListedValuationMap();
    return map[code] ?? null;
  }
  if (marketType === '上櫃') {
    const map = await getOtcValuationMap();
    return map[code] ?? null;
  }
  return null;
}

async function getListedNameMap(): Promise<Record<string, string>> {
  if (listedNameMapCache) return listedNameMapCache;
  if (!listedNameMapPromise) {
    listedNameMapPromise = (async () => {
      const listed = await fetchJsonArray('https://openapi.twse.com.tw/v1/opendata/t187ap03_L');
      const map: Record<string, string> = {};

      for (const row of listed) {
        const rowCode = String(row['公司代號'] ?? '').trim();
        const name = String(row['公司簡稱'] ?? '').trim();
        if (rowCode && name) map[rowCode] = name;
      }

      listedNameMapCache = map;
      return map;
    })().finally(() => {
      listedNameMapPromise = null;
    });
  }
  return listedNameMapPromise;
}

async function getOtcNameMap(): Promise<Record<string, string>> {
  if (otcNameMapCache) return otcNameMapCache;
  if (!otcNameMapPromise) {
    otcNameMapPromise = (async () => {
      const [otc, otcDaily] = await Promise.all([
        fetchJsonArray('https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O'),
        fetchJsonArray('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'),
      ]);
      const map: Record<string, string> = {};

      for (const row of otc) {
        const rowCode = String(row.SecuritiesCompanyCode ?? row['公司代號'] ?? '').trim();
        const rawName = String(row.CompanyAbbreviation ?? row.CompanyName ?? row['公司簡稱'] ?? '').trim();
        const name = rawName
          .replace(/股份有限公司$/, '')
          .replace(/有限公司$/, '')
          .trim();
        if (rowCode && name) map[rowCode] = name;
      }

      for (const row of otcDaily) {
        const rowCode = String(row.SecuritiesCompanyCode ?? row.Code ?? '').trim();
        const name = String(row.CompanyName ?? row.Name ?? '').trim();
        if (rowCode && name && !map[rowCode]) map[rowCode] = name;
      }

      otcNameMapCache = map;
      return map;
    })().finally(() => {
      otcNameMapPromise = null;
    });
  }
  return otcNameMapPromise;
}

async function getTaiwanShortName(code: string, marketType: string): Promise<string | null> {
  const map = marketType === '上櫃'
    ? await getOtcNameMap()
    : await getListedNameMap();

  return map[code] ?? null;
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise
      .then((value) => resolve(value))
      .catch(() => resolve(fallback))
      .finally(() => clearTimeout(timer));
  });
}

async function getTaiwanShortNameFast(code: string, marketType: string): Promise<string | null> {
  // The displayed name is user-facing. Give the exchange name map a little
  // more time than suffix detection so OTC stocks do not fall back to Yahoo's
  // English company names on cold start.
  return withTimeout(getTaiwanShortName(code, marketType), 2000, null);
}

async function inferTaiwanSuffix(code: string): Promise<'TW' | 'TWO' | null> {
  const [listedMap, otcMap] = await Promise.all([
    getListedNameMap(),
    getOtcNameMap(),
  ]);

  if (listedMap[code]) return 'TW';
  if (otcMap[code]) return 'TWO';
  return null;
}

async function inferTaiwanSuffixFast(code: string): Promise<'TW' | 'TWO' | null> {
  return withTimeout(inferTaiwanSuffix(code), 400, null);
}

async function startServer(): Promise<void> {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.use('/api/stock', (_req, res, next) => {
    res.setHeader('Cache-Control', 'public, max-age=60');
    next();
  });

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // API Route: Fetch stock data and calculate indicators
  app.get('/api/stock', async (req, res) => {
    const ticker = (req.query.ticker as string || '').trim();
    const requestId = Math.random().toString(36).substring(7);
    console.log(`[${requestId}] API Request received for ticker: ${ticker}`);
    try {
      if (!ticker) {
        return res.status(400).json({ error: '請提供股票代碼 (ticker)' });
      }
      let symbol = ticker.toUpperCase();
      let result: any[] = [];
      let marketType = '';
      let shortName = '';
      let currency = 'NT$';

      // Helper to fetch data with fallback. Historical prices are required;
      // quote is nice-to-have, so fetch both concurrently instead of waiting
      // for historical first and quote second.
      const fetchData = async (sym: string) => {
        try {
          console.log(`[${requestId}] Fetching data for: ${sym}`);
          const endDate = new Date();
          const startDate = subDays(endDate, 550);
          const queryOptions = {
            period1: format(startDate, 'yyyy-MM-dd'),
            period2: format(endDate, 'yyyy-MM-dd'),
            interval: '1d' as const,
          };
          const [historicalResult, quoteResult] = await Promise.allSettled([
            yahooFinance.historical(sym, queryOptions),
            yahooFinance.quote(sym),
          ]);

          if (historicalResult.status === 'rejected') {
            throw historicalResult.reason;
          }

          const historical: any = historicalResult.value;
          const quote = quoteResult.status === 'fulfilled' ? quoteResult.value : null;
          if (quoteResult.status === 'rejected') {
            console.error(`fetchData: Quote fetch failed for ${sym} but historical is OK`, quoteResult.reason);
          }
          console.log(`[${requestId}] Successfully fetched ${sym}. Historical points: ${historical?.length ?? 0}`);
          return { historical, quote };
        } catch (e: any) {
          console.error(`[${requestId}] Error fetching ${sym}:`, e.message || e);
          return { error: e.message || String(e) };
        }
      };

      let fetchResult: any = null;
      let lastError = '';

      const tryFetch = async (sym: string) => {
        try {
          console.log(`[${requestId}] tryFetch: ${sym}`);
          const res = await fetchData(sym);
          if (res && !('error' in res) && res.historical && res.historical.length > 0) return res;
          
          if (res && 'error' in res) {
            lastError = res.error;
            console.log(`[${requestId}] fetchData error for ${sym}: ${lastError}`);
          }
          
          // Fallback to chart if historical fails or is empty
          console.log(`[${requestId}] Attempting chart fallback for ${sym}`);
          const chartData = await yahooFinance.chart(sym, {
            period1: format(subDays(new Date(), 550), 'yyyy-MM-dd'),
            period2: format(new Date(), 'yyyy-MM-dd'),
            interval: '1d'
          });
          
          if (chartData && chartData.quotes && chartData.quotes.length > 0) {
            const quoteResult = await Promise.allSettled([yahooFinance.quote(sym)]);
            const quote = quoteResult[0].status === 'fulfilled' ? quoteResult[0].value : null;
            if (quoteResult[0].status === 'rejected') {
              console.error(`Quote fetch failed for ${sym} but chart data is OK`, quoteResult[0].reason);
            }
            const historical = chartData.quotes
              .filter((q: any) => q.close !== null && q.close !== undefined)
              .map((q: any) => ({
                date: q.date,
                open: q.open,
                high: q.high,
                low: q.low,
                close: q.close,
                volume: q.volume,
                adjClose: q.adjclose
              }));
            
            if (historical.length > 0) {
              return { historical, quote };
            }
          }
          
          return null;
        } catch (e: any) {
          lastError = e.message || String(e);
          console.error(`[${requestId}] tryFetch FATAL error for ${sym}:`, lastError);
          return null;
        }
      };

      // Detect market and symbol
      const isTaiwanNumeric = /^\d{4,6}(\.(TW|TWO))?$/i.test(symbol);
      
      if (isTaiwanNumeric) {
        const pureCode = symbol.split('.')[0];
        const hasExplicitSuffix = symbol.includes('.');
        const explicitSuffix = hasExplicitSuffix ? symbol.split('.')[1].toUpperCase() : '';
        const inferredSuffixPromise = hasExplicitSuffix
          ? Promise.resolve(explicitSuffix as 'TW' | 'TWO')
          : inferTaiwanSuffixFast(pureCode);
        const defaultTwFetchPromise = hasExplicitSuffix ? null : tryFetch(`${pureCode}.TW`);
        const inferredSuffix = await inferredSuffixPromise;
        const preferredSuffix = inferredSuffix || 'TW';
        const alternativeSuffix = preferredSuffix === 'TW' ? 'TWO' : 'TW';
        
        console.log(`[${requestId}] Detected Taiwan numeric symbol: ${pureCode}. Trying ${preferredSuffix} first.`);
        fetchResult = !hasExplicitSuffix && preferredSuffix === 'TW' && defaultTwFetchPromise
          ? await defaultTwFetchPromise
          : await tryFetch(`${pureCode}.${preferredSuffix}`);
        
        if (!fetchResult || !fetchResult.historical || fetchResult.historical.length === 0) {
          console.log(`[${requestId}] ${preferredSuffix} failed or empty, trying ${alternativeSuffix}.`);
          fetchResult = await tryFetch(`${pureCode}.${alternativeSuffix}`);
          if (fetchResult && fetchResult.historical && fetchResult.historical.length > 0) {
            symbol = `${pureCode}.${alternativeSuffix}`;
            marketType = alternativeSuffix === 'TW' ? '上市' : '上櫃';
          }
        } else {
          symbol = `${pureCode}.${preferredSuffix}`;
          marketType = preferredSuffix === 'TW' ? '上市' : '上櫃';
        }

        // Final attempt: Search if both failed
        if (!fetchResult) {
          console.log(`[${requestId}] Both suffixes failed for ${pureCode}. Attempting general search.`);
          try {
            const searchResults = await yahooFinance.search(pureCode);
            const bestMatch = searchResults.quotes.find((q: any) => 
              q.symbol.startsWith(pureCode) && (q.symbol.endsWith('.TW') || q.symbol.endsWith('.TWO'))
            );
            if (bestMatch) {
              console.log(`[${requestId}] Search found better symbol: ${bestMatch.symbol}`);
              fetchResult = await tryFetch(bestMatch.symbol);
              if (fetchResult && fetchResult.historical && fetchResult.historical.length > 0) {
                symbol = bestMatch.symbol;
                marketType = symbol.endsWith('.TW') ? '上市' : '上櫃';
              }
            }
          } catch (se) {
            console.error(`[${requestId}] Search fallback failed:`, se);
          }
        }
      } else {
        // Non-numeric or other market logic (US, HK, etc.)
        fetchResult = await tryFetch(symbol);
        
        // If direct fetch fails and it looks like it might be a Taiwan stock missing a suffix
        if ((!fetchResult || !fetchResult.historical) && /^\d+$/.test(symbol)) {
          console.log(`[${requestId}] Numeric symbol failed as US. Retrying as Taiwan (${symbol}.TW)...`);
          fetchResult = await tryFetch(`${symbol}.TW`);
          if (fetchResult && fetchResult.historical && fetchResult.historical.length > 0) {
            symbol = `${symbol}.TW`;
            marketType = '上市';
          } else {
            fetchResult = await tryFetch(`${symbol}.TWO`);
            if (fetchResult && fetchResult.historical && fetchResult.historical.length > 0) {
              symbol = `${symbol}.TWO`;
              marketType = '上櫃';
            }
          }
        }
        
        if (fetchResult && !marketType) {
          marketType = symbol.endsWith('.TW') ? '上市' : (symbol.endsWith('.TWO') ? '上櫃' : '美股');
          if (marketType === '美股') currency = '$';
        }
      }

      if (!fetchResult || !fetchResult.historical || fetchResult.historical.length === 0) {
        return res.status(404).json({ 
          error: `找不到股票數據: ${ticker}`,
          details: lastError 
        });
      }

      result = fetchResult.historical;
      
      // Name Logic: Taiwan stocks -> Chinese, US stocks -> English
      if (marketType === '上市' || marketType === '上櫃') {
        const pureCode = symbol.split('.')[0];
        shortName = await getTaiwanShortNameFast(pureCode, marketType)
          || fetchResult?.quote?.displayName
          || fetchResult?.quote?.shortName
          || fetchResult?.quote?.longName
          || symbol;
      } else {
        // For US stocks, shortName/longName are naturally English
        shortName = fetchResult?.quote?.shortName || fetchResult?.quote?.longName || symbol;
      }

      // Sort by date ascending
      const data = result.filter((d: any) => d.close !== null).sort((a: any, b: any) => a.date.getTime() - b.date.getTime());
      
      const closes = data.map(d => d.close);
      
      // Use the latest quote price if available, otherwise fallback to the last historical close
      const latestQuotePrice = fetchResult?.quote?.regularMarketPrice;
      const currentPrice = latestQuotePrice !== undefined && latestQuotePrice !== null ? latestQuotePrice : closes[closes.length - 1];

      // Fundamental: EPS & PE
      let epsForward: number | null = null;
      let epsGrowth: number | null = null;
      let trailingEps: number | null = null;
      let trailingPE: number | null = null;
      let trailingPESource: 'TWSE' | 'TPEX' | 'Yahoo' | null = null;
      let recentEpsGrowth: string | null = null;
      
      try {
        const pureCode = symbol.split('.')[0];
        const exchangeValuation = await getExchangeValuation(pureCode, marketType);
        const yahooForwardEps = parseOptionalNumber(fetchResult?.quote?.epsForward);
        const epsCurrentYear = parseOptionalNumber(fetchResult?.quote?.epsCurrentYear);
        const yahooTrailingPE = parseOptionalNumber(fetchResult?.quote?.trailingPE);
        const yahooTrailingEps = parseOptionalNumber(
          fetchResult?.quote?.trailingEps ?? fetchResult?.quote?.epsTrailingTwelveMonths
        );

        // 台股本益比優先採交易所官方資料（上市 TWSE、上櫃 TPEX），避免 Yahoo 台股 EPS/PE 延遲或單位異常。
        // 若官方 PE 附有官方收盤價，先反推出近 12 月 EPS，再用即時/最新股價換算目前 PE，避免把前一日 PE 直接套在盤中股價。
        const exchangeTrailingEps = exchangeValuation?.trailingPE && exchangeValuation.referencePrice
          ? exchangeValuation.referencePrice / exchangeValuation.trailingPE
          : null;
        trailingEps = exchangeTrailingEps ?? yahooTrailingEps;
        if (trailingEps !== null && trailingEps > 0 && currentPrice > 0) {
          trailingPE = currentPrice / trailingEps;
        } else {
          trailingPE = exchangeValuation?.trailingPE ?? yahooTrailingPE;
          if (trailingEps === null && trailingPE !== null && trailingPE > 0 && currentPrice > 0) {
            trailingEps = currentPrice / trailingPE;
          }
        }
        trailingPESource = exchangeValuation?.source ?? (yahooTrailingPE !== null ? 'Yahoo' : null);

        // 只有在 Yahoo 有同步的年度 EPS 或沒有更可靠的 trailing EPS 時才採 Forward EPS。
        const forwardLooksReliable = yahooForwardEps !== null && (
          epsCurrentYear !== null ||
          trailingEps === null ||
          yahooForwardEps >= trailingEps * 0.7
        );
        epsForward = forwardLooksReliable ? yahooForwardEps : null;
        
        if (epsForward !== null && epsCurrentYear !== null && epsCurrentYear !== 0) {
          epsGrowth = ((epsForward - epsCurrentYear) / Math.abs(epsCurrentYear)) * 100;
        }

        const earningsGrowth = parseOptionalNumber(fetchResult?.quote?.earningsGrowth);
        if (earningsGrowth !== null) {
          recentEpsGrowth = (earningsGrowth * 100).toFixed(2);
        }
      } catch (e) {
        console.error("Error fetching/calculating EPS:", e);
      }

      // If we have a newer quote price, ensure it's used for SMA calculations by updating the last element 
      // or appending it if it represents a newer timeframe
      if (latestQuotePrice !== undefined && latestQuotePrice !== null && closes.length > 0) {
        closes[closes.length - 1] = latestQuotePrice;
      }

      const ma50 = calculateSMA(closes, 50);
      const ma150 = calculateSMA(closes, 150);
      const ma200 = calculateSMA(closes, 200);
      const ma20 = calculateSMA(closes, 20);

      // Volume Contraction Logic
      const volumes = data.map(d => d.volume || 0);
      const vol5 = calculateSMA(volumes, 5) || 0;
      const vol20 = calculateSMA(volumes, 20) || 0;
      // [FIXED] 量縮改為必要條件，門檻從 0.8 收緊至 0.75
      const isVolumeContracted = vol5 > 0 && vol20 > 0 ? vol5 < vol20 * 0.75 : false;
      const currentVolume = volumes[volumes.length - 1];
      const isMomentumStock = vol5 > 0 && vol20 > 0 && vol5 > vol20 * 1.5;

      const last250Days = data.slice(-250);
      const high52w = Math.max(...last250Days.map(d => d.high));
      const low52w = Math.min(...last250Days.map(d => d.low));

      // ── 1. Pivot 識別邏輯 ─────────────────────────────────────────
      // 規則：
      //   a) 90 天內的局部高點（左右各 5 根都更低）
      //   b) 必須是「上漲突破後」的高點：左側 20 天均價需低於候選 Pivot
      //   c) Pivot 後已有 ≥5% 回撤，且現價 > Pivot × 75%
      //   d) searchEnd = data.length - 15，確保有足夠空間形成回撤 + 把手
      let pivotPrice = 0;
      let pivotIdx = -1;

      const searchStart = Math.max(25, data.length - 90); // 往回最多找 90 天
      const searchEnd = data.length - 15;                 // [FIXED] 至少留 15 天給回撤+把手

      for (let i = searchEnd; i >= searchStart; i--) {
        // 局部高點：左右各 5 根 K 棒都低於此點
        const leftBars = data.slice(Math.max(0, i - 5), i);
        const rightBars = data.slice(i + 1, Math.min(data.length, i + 6));
        if (leftBars.length < 3 || rightBars.length < 3) continue;

        const candidateHigh = data[i].high;
        const isLocalPeak =
          leftBars.every(d => d.high <= candidateHigh) &&
          rightBars.every(d => d.high <= candidateHigh);

        if (!isLocalPeak) continue;

        // [FIXED] 確認是「上漲突破後」的高點：左側 20 天均價需低於 Pivot
        // 排除下跌趨勢中的反彈高點（例如 8114 從高點跌落途中的局部反彈）
        const left20 = data.slice(Math.max(0, i - 20), i);
        const left20AvgClose = left20.reduce((s, d) => s + d.close, 0) / left20.length;
        if (left20AvgClose >= candidateHigh * 0.97) continue; // 均價需低於 Pivot 3% 以上

        // 確認 Pivot 後已有至少 5% 回撤
        const afterPivotSlice = data.slice(i + 1);
        if (afterPivotSlice.length === 0) continue;
        const lowestAfter = Math.min(...afterPivotSlice.map(d => d.low));
        const pullbackFromPeak = (candidateHigh - lowestAfter) / candidateHigh;
        if (pullbackFromPeak < 0.05) continue;

        // 確認現價不低於 Pivot 的 75%（沒有崩跌）
        const recentPrice = data[data.length - 1].close;
        if (recentPrice < candidateHigh * 0.75) continue;

        pivotPrice = candidateHigh;
        pivotIdx = i;
        break;
      }

      // ── 2. VCP 結構識別（Pivot → 回撤 → 把手）────────────────────
      let vcpHigh: number | null = null;
      let pullbackPercentage = 0;

      if (pivotIdx !== -1 && pivotIdx < data.length - 8) {
        const afterPivotData = data.slice(pivotIdx + 1);
        let pullbackLow = pivotPrice;
        let pullbackIdxInAfterPivot = -1;

        for (let i = 0; i < afterPivotData.length; i++) {
          if (afterPivotData[i].low < pullbackLow) {
            pullbackLow = afterPivotData[i].low;
            pullbackIdxInAfterPivot = i;
          }
        }

        const absolutePullbackIdx = pivotIdx + 1 + pullbackIdxInAfterPivot;
        pullbackPercentage = (pivotPrice - pullbackLow) / pivotPrice;

        if (pullbackPercentage >= 0.05 && pullbackPercentage <= 0.40) {

          // [FIXED] isStabilized：回撤低點「之後」至少有 3 天收盤 > 低點 × 1.03
          // 避免用全局最後 3 天（可能仍在回撤中）
          const afterTroughData = data.slice(absolutePullbackIdx + 1);
          const stabilizedDays = afterTroughData.filter(d => d.close > pullbackLow * 1.03).length;
          const isStabilized = stabilizedDays >= 3;

          if (isStabilized) {
            // [FIXED] 把手最少 5 天（原為 3 天）
            for (let i = data.length - 1; i > absolutePullbackIdx; i--) {
              if (i - absolutePullbackIdx < 4) break; // 確保至少 5 根 K

              for (let windowSize = 5; windowSize <= 10; windowSize++) {
                const startIdx = i - windowSize + 1;
                if (startIdx <= absolutePullbackIdx) continue;

                const window = data.slice(startIdx, i + 1);
                const maxHigh = Math.max(...window.map(d => d.high));
                const minLow = Math.min(...window.map(d => d.low));
                const windowVols = window.map(d => d.volume || 0);
                const avgWindowVol = windowVols.reduce((a, b) => a + b, 0) / windowSize;
                const volatility = (maxHigh - minLow) / minLow;

                const volMA20AtPoint = calculateSMA(volumes.slice(0, i + 1), 20) || vol20;

                // [FIXED] 量縮為必要條件（vol5 < vol20 × 0.75）
                const isLowVolume = avgWindowVol < volMA20AtPoint * 0.75;
                // 把手需在 Pivot 的 88%~110% 之間
                const isNearPivot = maxHigh <= pivotPrice * 1.10 && minLow >= pivotPrice * 0.88;
                // [FIXED] 把手波動收緊至 6%（原為 7%）
                const isTight = volatility < 0.06;
                const isNotSameAsPivot = Math.abs(maxHigh - pivotPrice) / pivotPrice > 0.005;

                if (isNearPivot && isTight && isLowVolume && isNotSameAsPivot) {
                  vcpHigh = maxHigh;
                  break;
                }
              }
              if (vcpHigh !== null) break;
            }
          }
        }
      }

      // 3. Extension Check
      const ma50Extension = ma50 ? ((currentPrice - ma50) / ma50) * 100 : 0;
      const breakoutPrice = vcpHigh || pivotPrice;
      const isExtended = breakoutPrice > 0
        ? currentPrice > breakoutPrice * 1.25 || ma50Extension > 20
        : ma50Extension > 20;

      const localPivot = vcpHigh || 0;
      const isLocalPivotExtended = isExtended;

      const buyZoneMax = breakoutPrice > 0 ? breakoutPrice * 1.05 : 0;
      const suggestedStopLoss = breakoutPrice > 0 ? breakoutPrice * 0.92 : 0;
      const priceGap = breakoutPrice > 0 ? breakoutPrice - currentPrice : 0;
      const distFromPivot = breakoutPrice > 0 ? ((currentPrice - breakoutPrice) / breakoutPrice) * 100 : 0;

      // [FIXED] VCP 狀態更細緻
      let vcpStatus = "整理中";
      if (vcpHigh && currentPrice > vcpHigh && isVolumeContracted) vcpStatus = "帶量突破";
      else if (vcpHigh && isVolumeContracted) vcpStatus = "量縮盤整";
      else if (pivotIdx !== -1 && !vcpHigh) vcpStatus = "等待把手";

      // Trend Template Logic (Minervini)
      const cond1 = currentPrice > (ma150 || 0) && currentPrice > (ma200 || 0);
      const cond2 = (ma150 || 0) > (ma200 || 0);
      const ma200_prev = calculateSMA(closes.slice(0, -22), 200);
      // [FIXED] MA200 資料不足（新上市股票 < 200 天）時直接設 cond3 = true
      // 理由：新上市股本來就沒有 MA200，不應被此條件懲罰
      const hasEnoughDataFor200 = closes.length >= 200;
      const cond3 = !hasEnoughDataFor200
        ? true
        : (ma200 && ma200_prev ? ma200 > ma200_prev : false);
      const cond4 = (ma50 || 0) > (ma150 || 0) && (ma50 || 0) > (ma200 || 0);
      const cond5 = currentPrice > (ma50 || 0);
      const distFromLow = (currentPrice - low52w) / low52w;
      const cond6 = distFromLow >= 0.30;
      const distFromHigh = (high52w - currentPrice) / high52w;
      // [FIXED] 從 25% 放寬至 30%，強勢股急漲後整理距高點 25~30% 屬正常
      const cond7 = distFromHigh <= 0.30;

      const isTemplateMet = cond1 && cond2 && cond3 && cond4 && cond5 && cond6 && cond7;
      const reasons = [
        ...(!cond1 ? ["股價未高於 MA150 與 MA200"] : []),
        ...(!cond2 ? ["150MA 未能高於 200MA"] : []),
        ...(!cond3 && hasEnoughDataFor200 ? ["200MA 趨勢未能在最近一個月內呈現上揚"] : []),
        ...(!cond4 ? ["50MA 未能高於 150MA 與 200MA"] : []),
        ...(!cond5 ? ["股價未高於 50MA"] : []),
        ...(!cond6 ? ["股價距離 52週低點未達 30%"] : []),
        ...(!cond7 ? [`股價距離 52週高點超過 30% (目前: ${(distFromHigh * 100).toFixed(1)}%)`] : []),
      ];
      const fundamentalStatus = isTemplateMet
        ? "趨勢模板符合，基本面資料請輔助判斷"
        : `趨勢模板未完全符合：${reasons.slice(0, 2).join("、")}`;

      // Base Detection Logic (Minervini/O'Neil style)
      let baseHigh = 0;
      let baseDays = 0;
      // Iterate backwards to find how many days the price has stayed within 15% of the local high
      for (let i = data.length - 1; i >= 0; i--) {
        const dayHigh = data[i].high;
        const dayLow = data[i].low;
        if (dayHigh > baseHigh) baseHigh = dayHigh;
        
        if (dayLow < baseHigh * 0.85) {
          break; // Base broken: price dropped more than 15% from its highest point in this window
        }
        baseDays++;
      }

      let baseType = "None";
      let baseLabel = "";
      if (baseDays > 50) {
        baseType = "Major";
        baseLabel = "長期整理";
      } else if (baseDays >= 25) {
        baseType = "Normal";
        baseLabel = "標準整理";
      }

      const rangeBox = detectRangeBox(data, currentPrice);

      res.json({
        symbol,
        shortName,
        marketType,
        currency,
        currentPrice,
        ma50,
        ma150,
        ma200,
        baseDays,
        baseType,
        baseLabel,
        rangeBox,
        vcpHigh,
        isExtended,
        ma50Extension: ma50Extension.toFixed(2),
        extensionFrom50MA: ma50Extension.toFixed(2),
        isVolumeContracted,
        localPivot,
        isLocalPivotExtended,
        vcpStatus,
        isMomentumStock,
        basePivotPrice: pivotPrice,
        pivotPrice: breakoutPrice,
        buyZoneMax,
        suggestedStopLoss,
        priceGap,
        distanceFromPivot: distFromPivot.toFixed(2),
        pullbackPercentage: (pullbackPercentage * 100).toFixed(1),
        hasEnoughDataFor200,
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
        fundamentalStatus,
        isTemplateMet,
        reasons,
        epsForward,
        epsGrowth: epsGrowth !== null ? epsGrowth.toFixed(2) : null,
        trailingEps,
        trailingPE: trailingPE !== null ? Math.round(trailingPE * 10) / 10 : null,
        trailingPESource,
        recentEpsGrowth,
        chartData: data.slice(-200).map((d, i, arr) => {
          // Calculate MA indices more efficiently
          const dataIndex = data.length - arr.length + i;
          const subCloses = closes.slice(0, dataIndex + 1);
          return {
            date: format(d.date, 'yyyy-MM-dd'),
            price: d.close,
            ma50: calculateSMA(subCloses, 50),
            ma150: calculateSMA(subCloses, 150),
            ma200: calculateSMA(subCloses, 200),
          };
        })
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
try {
  await startServer();
  console.log('>>> Server started. Running Yahoo Finance connectivity test...');
  const testTicker = 'AAPL';
  try {
    await yahooFinance.quoteSummary(testTicker, { modules: ['price'] });
    console.log(`>>> Connectivity test PASSED for ${testTicker}`);
  } catch (err: any) {
    console.error(`>>> Connectivity test FAILED for ${testTicker}:`, err.message);
    if (err.message.includes('404')) {
      console.warn('>>> Received 404. This might be a false positive if AAPL is not reachable, but check your network.');
    }
  }
} catch (err) {
  console.error('>>> Server failed to start:', err);
}
