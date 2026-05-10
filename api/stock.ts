import type { VercelRequest, VercelResponse } from '@vercel/node';
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
    const ticker = (req.query.ticker as string || '').trim();
    const requestId = Math.random().toString(36).substring(7);
    
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
        let quote = null;
        let summary = null;
        try {
          quote = await yahooFinance.quote(sym);
        } catch (qe) {
          // Quietly log quote failure if historical worked
        }
        try {
          summary = await yahooFinance.quoteSummary(sym, { modules: ['summaryDetail', 'defaultKeyStatistics'] });
        } catch (se) {
          // Summary might fail for some tickers
        }
        return { historical, quote, summary };
      } catch (e: any) {
        return { error: e.message || String(e) };
      }
    };

    let fetchResult: any = null;
    let lastError = '';

    const tryFetch = async (sym: string) => {
      try {
        // Quietly try fetching
        const res = await fetchData(sym);
        if (res && !('error' in res) && res.historical && res.historical.length > 0) {
          return res;
        }
        
        if (res && 'error' in res) {
          lastError = res.error;
        } else if (res && (!res.historical || res.historical.length === 0)) {
          lastError = 'No historical data found';
        }
        
        // Fallback to chart if historical fails or is empty
        try {
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
              // Ignore quote error for chart fallback
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
        } catch (chartError: any) {
          lastError = chartError.message || String(chartError);
        }
        
        return null;
      } catch (e: any) {
        lastError = e.message || String(e);
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
      
      if (!fetchResult) {
        console.log(`[${requestId}] ${preferredSuffix} failed for ${pureCode}, trying ${alternativeSuffix}.`);
        fetchResult = await tryFetch(`${pureCode}.${alternativeSuffix}`);
        if (fetchResult) {
          symbol = `${pureCode}.${alternativeSuffix}`;
          marketType = alternativeSuffix === 'TW' ? '上市' : '上櫃';
        }
      } else {
        symbol = `${pureCode}.${preferredSuffix}`;
        marketType = preferredSuffix === 'TW' ? '上市' : '上櫃';
      }

      // Final attempt: Search if both failed
      if (!fetchResult) {
        console.log(`[${requestId}] Both standard suffixes failed for ${pureCode}. Attempting search fallback.`);
        try {
          const searchResults = await yahooFinance.search(pureCode);
          const bestMatch = searchResults.quotes.find((q: any) => 
            (q.symbol.startsWith(pureCode) || q.symbol === pureCode) && 
            (q.symbol.endsWith('.TW') || q.symbol.endsWith('.TWO') || q.exchDisp === 'Taiwan' || q.exchDisp === 'Taipei Exchange')
          );
          if (bestMatch) {
            console.log(`[${requestId}] Search found viable match: ${bestMatch.symbol}`);
            fetchResult = await tryFetch(bestMatch.symbol);
            if (fetchResult) {
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
      // For Taiwan stocks, displayName or shortName usually contains the Chinese name
      shortName = fetchResult?.quote?.displayName || fetchResult?.quote?.shortName || fetchResult?.quote?.longName || symbol;
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
    let epsTrailing = null;
    let peRatio = null;
    
    try {
      // Use optional chaining for everything
      const quote = fetchResult?.quote;
      const summary = fetchResult?.summary;
      
      epsTrailing = quote?.trailingEps || summary?.defaultKeyStatistics?.trailingEps || null;
      epsForward = quote?.forwardEps || summary?.defaultKeyStatistics?.forwardEps || epsTrailing || null;
      const epsCurrentYear = quote?.epsCurrentYear || null;
      
      // Try to get PE directly from quote or summary
      peRatio = quote?.trailingPE || summary?.summaryDetail?.trailingPE || quote?.peRatio || null;

      if (epsForward !== null && epsCurrentYear !== null && epsCurrentYear !== 0) {
        epsGrowth = ((epsForward - epsCurrentYear) / Math.abs(epsCurrentYear)) * 100;
      }

      // If peRatio still null, calculate it
      if (peRatio === null && epsTrailing && epsTrailing !== 0) {
        peRatio = currentPrice / epsTrailing;
      }
      
      // Final fallback for peRatio if still null but we have forward data
      if (peRatio === null && epsForward && epsForward !== 0) {
        peRatio = currentPrice / epsForward;
      }
    } catch (e) {
      console.error("Error fetching/calculating EPS/PE:", e);
    }

    // If we have a newer quote price, ensure it's used for SMA calculations
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
    const isVolumeContracted = vol5 > 0 && vol20 > 0 ? vol5 < vol20 * 0.8 : false;
    const currentVolume = volumes[volumes.length - 1];

    // 1. Pivot Detection (Refined for stocks at/near new highs)
    const last250Days = data.slice(-250);
    const high52w = Math.max(...last250Days.map(d => d.high));
    const low52w = Math.min(...last250Days.map(d => d.low));

    let anchorPivot = 0;
    let pivotIdx = -1;

    // Use a multi-pass approach to find a valid "Rim" (Ceiling)
    const peakSearchWindow = data.slice(-120);
    const absolutePeak = Math.max(...peakSearchWindow.map(d => d.high));
    
    // Find the last index of the absolute peak
    let absolutePeakIdxInWindow = -1;
    for (let i = peakSearchWindow.length - 1; i >= 0; i--) {
      if (peakSearchWindow[i].high === absolutePeak) {
        absolutePeakIdxInWindow = i;
        break;
      }
    }
    const absolutePeakIdx = (data.length - 120) + absolutePeakIdxInWindow;
    
    // REFINEMENT: If the absolute peak is very old (> 70 days ago), 
    // it might not be the relevant "Rim" for the current base.
    // We check if there's a more recent significant local peak.
    if (absolutePeakIdxInWindow < peakSearchWindow.length - 70) {
      const recentWindow = peakSearchWindow.slice(-60);
      const recentPeak = Math.max(...recentWindow.map(d => d.high));
      // If recent peak is within a reasonable distance (e.g., > 85% of absolute peak), use it instead
      if (recentPeak >= absolutePeak * 0.85) {
        anchorPivot = recentPeak;
        let recentPeakIdx = -1;
        for (let i = recentWindow.length - 1; i >= 0; i--) {
          if (recentWindow[i].high === recentPeak) {
            recentPeakIdx = i;
            break;
          }
        }
        pivotIdx = (data.length - 60) + recentPeakIdx;
      } else {
        anchorPivot = absolutePeak;
        pivotIdx = absolutePeakIdx;
      }
    } else if (absolutePeakIdx > data.length - 15) {
      // Current breakout scenario: seek the rim that occurred BEFORE the current surge
      const lookbackForRim = peakSearchWindow.slice(0, Math.max(0, absolutePeakIdxInWindow - 15));
      if (lookbackForRim.length > 10) {
        const rimPrice = Math.max(...lookbackForRim.map(d => d.high));
        let rimIdxInLookback = -1;
        for (let i = lookbackForRim.length - 1; i >= 0; i--) {
          if (lookbackForRim[i].high === rimPrice) {
            rimIdxInLookback = i;
            break;
          }
        }
        anchorPivot = rimPrice;
        pivotIdx = (data.length - 120) + rimIdxInLookback;
      } else {
        anchorPivot = absolutePeak;
        pivotIdx = absolutePeakIdx;
      }
    } else {
      anchorPivot = absolutePeak;
      pivotIdx = absolutePeakIdx;
    }

    // Final sanity check: Anchor pivot should be the ceiling price used for breakout
    const pivotPrice = anchorPivot;

    // 2. Strict VCP Identification Logic
    let vcpHigh = null;
    let vcpHighIdx = -1;
    let handleStartIdx = -1;
    let pullbackIdx = -1;
    const volMA20 = vol20;

    // A VCP sequence MUST happen AFTER the pivot peak
    if (pivotIdx !== -1 && pivotIdx < data.length - 3) {
      // Step 2: Seek the "Pullback Low" after the pivot
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
      pullbackIdx = absolutePullbackIdx;
      const pullbackPercentage = (pivotPrice - pullbackLow) / pivotPrice;

      // Rule: Must have at least a slight pullback (Relaxed to 2% for strong stocks)
      if (pullbackPercentage >= 0.02) {
        // Step 3: Seek tight handle strictly to the RIGHT of the pullback trough
        for (let i = data.length - 1; i > absolutePullbackIdx; i--) {
          if (i - absolutePullbackIdx < 2) break;

          const windowSize = Math.min(8, i - absolutePullbackIdx);
          if (windowSize < 3) continue;

          const startIdx = i - windowSize + 1;
          const window = data.slice(startIdx, i + 1);
          const maxHigh = Math.max(...window.map(d => d.high));
          const minLow = Math.min(...window.map(d => d.low));
          const avgVol = window.reduce((sum, d) => sum + (d.volume || 0), 0) / windowSize;
          const volatility = (maxHigh - minLow) / minLow;

          // Refined constraints for more precise VCP identification
          const isTight = volatility < 0.08; 
          const isNearPivot = maxHigh <= pivotPrice * 1.10 && minLow >= pivotPrice * 0.85;
          const volMA20AtPoint = calculateSMA(volumes.slice(0, i + 1), 20) || volMA20;
          const isLowVolume = avgVol < volMA20AtPoint; 

          if (isTight && isNearPivot && isLowVolume) {
            vcpHigh = maxHigh;
            vcpHighIdx = i;
            handleStartIdx = startIdx;
            break;
          }
        }
      }
    }

    // 3. Extension Check
    const ma50Extension = ma50 ? ((currentPrice - ma50) / ma50) * 100 : 0;
    const isExtended = currentPrice > pivotPrice * 1.25 || ma50Extension > 20;

    // Use localPivot for backward compatibility if needed, but we prefer vcpHigh
    const localPivot = vcpHigh || 0;
    const isLocalPivotExtended = isExtended;

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
    
    const reasons: string[] = [];
    if (!cond1) reasons.push("價格未能在 150MA 與 200MA 之上");
    if (!cond2) reasons.push("150MA 未能高於 200MA");
    if (!cond3) reasons.push("200MA 趨勢未能在最近一個月內呈現上揚");
    if (!cond4) reasons.push("50MA 未能高於 150MA 與 200MA");
    if (!cond5) reasons.push("價格未能在 50MA 之上");
    if (!cond6) reasons.push(`股價距離 52週低點漲幅不足 30% (目前: ${(distFromLow * 100).toFixed(1)}%)`);
    if (!cond7) reasons.push(`股價距離 52週高點超過 25% (目前: ${(distFromHigh * 100).toFixed(1)}%)`);

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
      baseLabel = "🌋 主力大底";
    } else if (baseDays >= 25) {
      baseType = "Normal";
      baseLabel = "⚖️ 標準基地";
    }

    res.status(200).json({
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
      reasons,
      epsForward,
      epsTrailing,
      peRatio,
      epsGrowth: epsGrowth !== null ? epsGrowth.toFixed(2) : null,
      vcpPoints: {
        pivotIdx,
        pullbackIdx,
        handleStartIdx,
        handleEndIdx: vcpHighIdx,
        pivotDate: pivotIdx !== -1 ? format(data[pivotIdx].date, 'yyyy-MM-dd') : null,
        pullbackDate: pullbackIdx !== -1 ? format(data[pullbackIdx].date, 'yyyy-MM-dd') : null,
        handleStartDate: handleStartIdx !== -1 ? format(data[handleStartIdx].date, 'yyyy-MM-dd') : null,
        handleEndDate: vcpHighIdx !== -1 ? format(data[vcpHighIdx].date, 'yyyy-MM-dd') : null,
      },
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
    console.error('Vercel API Error:', error);
    res.status(500).json({ error: '抓取數據失敗' });
  }
}
