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

function getYahooFinance() {
  let mod: any = yf;
  if (mod.default) mod = mod.default;
  if (typeof mod === 'function') return new mod();
  return mod;
}
const yahooFinance = getYahooFinance();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let taiwanNameMapCache: Record<string, string> | null = null;

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

async function getTaiwanShortName(code: string): Promise<string | null> {
  if (!taiwanNameMapCache) {
    const [listed, otc, otcDaily] = await Promise.all([
      fetchJsonArray('https://openapi.twse.com.tw/v1/opendata/t187ap03_L'),
      fetchJsonArray('https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O'),
      fetchJsonArray('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'),
    ]);
    const map: Record<string, string> = {};

    for (const row of listed) {
      const rowCode = String(row['公司代號'] ?? '').trim();
      const name = String(row['公司簡稱'] ?? '').trim();
      if (rowCode && name) map[rowCode] = name;
    }

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

    taiwanNameMapCache = map;
  }

  return taiwanNameMapCache[code] ?? null;
}

async function startServer(): Promise<void> {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

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

      // Helper to fetch data with fallback
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
          const historical: any = await yahooFinance.historical(sym, queryOptions);
          let quote = null;
          try {
            quote = await yahooFinance.quote(sym);
          } catch (qe) {
            console.error(`fetchData: Quote fetch failed for ${sym} but historical is OK`, qe);
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
            let quote = null;
            try {
              quote = await yahooFinance.quote(sym);
            } catch (qe) {
              console.error(`Quote fetch failed for ${sym} but chart data is OK`, qe);
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
        const preferredSuffix = symbol.includes('.') ? symbol.split('.')[1].toUpperCase() : 'TW';
        const alternativeSuffix = preferredSuffix === 'TW' ? 'TWO' : 'TW';
        
        console.log(`[${requestId}] Detected Taiwan numeric symbol: ${pureCode}. Trying ${preferredSuffix} first.`);
        fetchResult = await tryFetch(`${pureCode}.${preferredSuffix}`);
        
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
        shortName = await getTaiwanShortName(pureCode)
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

      // Fundamental Extension: Forward EPS & Growth (Robust Error Handling)
      let epsForward = null;
      let epsGrowth = null;
      
      try {
        // Use optional chaining for everything
        epsForward = fetchResult?.quote?.epsForward ?? fetchResult?.quote?.trailingEps ?? null;
        const epsCurrentYear = fetchResult?.quote?.epsCurrentYear ?? null;
        
        if (epsForward !== null && epsCurrentYear !== null && epsCurrentYear !== 0) {
          epsGrowth = ((epsForward - epsCurrentYear) / Math.abs(epsCurrentYear)) * 100;
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
      const isExtended = currentPrice > pivotPrice * 1.25 || ma50Extension > 20;

      const localPivot = vcpHigh || 0;
      const isLocalPivotExtended = isExtended;

      const buyZoneMax = pivotPrice > 0 ? pivotPrice * 1.05 : 0;
      const suggestedStopLoss = pivotPrice > 0 ? pivotPrice * 0.92 : 0;
      const priceGap = pivotPrice > 0 ? pivotPrice - currentPrice : 0;
      const distFromPivot = pivotPrice > 0 ? ((currentPrice - pivotPrice) / pivotPrice) * 100 : 0;

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
        vcpHigh,
        isExtended,
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
