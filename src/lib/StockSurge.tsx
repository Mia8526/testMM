// StockSurge v5 - 2026/06/11
import { useEffect, useState, useCallback, type CSSProperties } from "react";
import { RefreshCw, TrendingUp, AlertCircle, BookmarkPlus, Check } from "lucide-react";
import {
  calcJulyRecovery,
  type HistoryBar,
  type RecoveryKind,
} from "./julyRecovery";

// ─── 型別定義 ─────────────────────────────────────────────────────────────────

type StockFlagType = "attention" | "disposition";

interface StockRow {
  code: string;
  name: string;
  market: "上市" | "上櫃";
  price: number;
  chg: number;
  amount: number | null;
  c14: number | null;
  vol5: number | null;
  vol14: number | null;
  range10: number | null;
  cap: number | null;
  ind: string;
  attention: boolean;
  disposition: boolean;
  flagReason?: string;
  flagPeriod?: string;
  priorHigh?: number | null;
  julyOpen?: number | null;
  julyLow?: number | null;
  recoveredPriorHigh?: boolean;
  recoveredJulyOpen?: boolean;
  recoveryKind?: RecoveryKind | null;
  vsPriorHighPct?: number | null;
  vsJulyOpenPct?: number | null;
  /** 近端頸線／整理高點（不含今日） */
  neckline?: number | null;
  /** 今日開盤相對昨收跳空 % */
  gapPct?: number | null;
  /** 今日量 / 近20日均量 */
  volRatio?: number | null;
  brokeNeckline?: boolean;
  gappedUp?: boolean;
  volumeSurge?: boolean;
}

type ViewMode = "try" | "skip";
type ActionLabel = "隔日可試" | "別追" | null;

const MIN_PRICE = 10;
const MIN_AMOUNT = 50_000_000;
const LIST_LIMIT = 30;
const MIN_OVERHEAT_C14 = 20;
const MIN_OVERHEAT_RANGE10 = 30;
/** 跳空至少 1% 才算有力 */
const MIN_GAP_PCT = 1;
/** 今日量至少 1.5 倍近20日均量 */
const MIN_VOL_RATIO = 1.5;
/** 收盤相對頸線容差 */
const NECKLINE_TOL = 0.002;
/** 已高出頸線太多 = 追晚了，不算隔日可試 */
const MAX_ABOVE_NECK_PCT = 8;
const CACHE_KEY = "trendpulse_surge_cache_v11";
const CACHE_VERSION = 11;
const REFRESH_HOUR = 15;
const REFRESH_MINUTE = 45;

interface SurgeCache {
  version: number;
  savedAt: string;
  dataDate: string;
  stocks: StockRow[];
}

function getLocalDateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isAfterRefreshTime(date = new Date()): boolean {
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes >= REFRESH_HOUR * 60 + REFRESH_MINUTE;
}

function isWeekend(date = new Date()): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getExpectedDataDate(date = new Date()): string {
  let expected = date;
  const day = date.getDay();
  if (day === 6) expected = addDays(date, -1);
  else if (day === 0) expected = addDays(date, -2);
  else if (!isAfterRefreshTime(date)) expected = addDays(date, -1);

  while (expected.getDay() === 0 || expected.getDay() === 6) {
    expected = addDays(expected, -1);
  }
  return getLocalDateKey(expected).replace(/-/g, "/");
}

function isCacheDataFresh(cache: SurgeCache): boolean {
  return cache.dataDate >= getExpectedDataDate();
}

function readSurgeCache(): SurgeCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SurgeCache;
    if (
      parsed?.version !== CACHE_VERSION ||
      !parsed.savedAt ||
      !Array.isArray(parsed.stocks)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeSurgeCache(cache: SurgeCache): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage 可能被瀏覽器隱私模式阻擋，忽略即可。
  }
}

function shouldUseCache(cache: SurgeCache | null, forceRefresh: boolean): boolean {
  if (!cache || forceRefresh) return false;
  if (!isCacheDataFresh(cache)) return false;
  const savedAt = new Date(cache.savedAt);
  const savedDate = getLocalDateKey(savedAt);
  if (savedDate === getLocalDateKey()) {
    return !isAfterRefreshTime() || isAfterRefreshTime(savedAt);
  }
  if (isWeekend()) return true;
  return !isAfterRefreshTime();
}

function formatCacheTime(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// ─── 產業代碼對照表 ───────────────────────────────────────────────────────────

const IND_MAP: Record<string, string> = {
  "01": "水泥工業", "02": "食品工業", "03": "塑膠工業", "04": "紡織纖維",
  "05": "電機機械", "06": "電器電纜", "08": "玻璃陶瓷", "09": "造紙工業",
  "10": "鋼鐵工業", "11": "橡膠工業", "12": "汽車工業", "13": "電子工業",
  "14": "建材營造業", "15": "航運業", "16": "觀光餐旅", "17": "金融保險業",
  "18": "貿易百貨業", "19": "綜合", "20": "其他業", "21": "化學工業",
  "22": "生技醫療業", "23": "油電燃氣業", "24": "半導體業",
  "25": "電腦及週邊設備業", "26": "光電業", "27": "通信網路業",
  "28": "電子零組件業", "29": "電子通路業", "30": "資訊服務業",
  "31": "其他電子業", "32": "文化創意業", "33": "農業科技業",
  "35": "綠能環保", "36": "數位雲端", "37": "運動休閒", "38": "居家生活",
  "91": "存託憑證",
};

function normalizeIndustry(value?: string | number): string {
  if (value === undefined || value === null) return "其他";
  const raw = String(value).trim();
  if (!raw) return "其他";
  if (/^\d+$/.test(raw)) return IND_MAP[raw.padStart(2, "0")] ?? "其他";
  const cleaned = raw
    .replace("類", "")
    .trim();
  return cleaned || "其他";
}

function parseNumber(value?: string | number | null): number | null {
  if (value === undefined || value === null) return null;
  const parsed = Number(String(value).replace(/[,+\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(
  source: Record<string, string>,
  keys: string[]
): number | null {
  for (const key of keys) {
    const value = parseNumber(source[key]);
    if (value !== null) return value;
  }
  return null;
}

function rowKey(code: string, market: "上市" | "上櫃"): string {
  return `${market}:${code}`;
}

// ─── API：上市當日行情 ────────────────────────────────────────────────────────

async function fetchTWSE(): Promise<{ rows: StockRow[]; date: string }> {
  const res = await fetch(`/api/twse-daily?ts=${Date.now()}`, { cache: "no-store" })
  if (!res.ok) throw new Error(`TWSE proxy 失敗 (${res.status})`)
  const data = await res.json()
  const rows: StockRow[] = [];
  let date = "";
  // DEBUG：印出前兩筆確認欄位名稱
  if (data.length > 0) {
    console.log("[TWSE DEBUG] 所有欄位名稱:", Object.keys(data[0]));
    // 印出前 5 筆 4-5 碼股票
    const samples = data.filter((s: Record<string,string>) => /^\d{4,5}$/.test(String(s.Code ?? ""))).slice(0, 5);
    console.log("[TWSE DEBUG] 前5筆一般股票:", JSON.stringify(samples));
  }

  // 先從第一筆取日期（不管代碼類型）
  for (const s of data) {
    if (s.Date) {
      const d = String(s.Date).replace(/\//g, "").trim();
      if (d.length === 7) {
        const y = parseInt(d.slice(0, 3)) + 1911;
        date = `${y}/${d.slice(3, 5)}/${d.slice(5, 7)}`;
      } else if (d.length === 8) {
        date = `${d.slice(0,4)}/${d.slice(4,6)}/${d.slice(6,8)}`;
      }
      break;
    }
  }

  for (const s of data) {
    const code = String(s.Code ?? "").trim();
    // 一般股票：4-5 碼純數字，且不以 0 開頭（0 開頭為 ETF/指數基金）
    if (!/^\d{4,5}$/.test(code)) continue;
    if (code.startsWith("0")) continue;

    const price = parseFloat(String(s.ClosingPrice).replace(/,/g, ""));
    if (isNaN(price) || price < 1) continue;
    const changeRaw = String(s.Change ?? "").replace(/,/g, "").trim();
    if (!changeRaw || changeRaw === "----" || changeRaw === "--") continue;
    const change = parseFloat(changeRaw);
    if (isNaN(change)) continue;
    const base = price - change;
    if (base <= 0) continue;
    const chg = (change / base) * 100;
    if (chg < 5) continue;
    const amount = parseNumber(s.TradeValue);
    rows.push({
      code,
      name: s.Name?.trim() ?? "",
      market: "上市",
      price,
      chg,
      amount,
      c14: null,
      vol5: null,
      vol14: null,
      range10: null,
      cap: null,
      ind: "載入中",  // 產業由 fetchIndustryMap 補上
      attention: false,
      disposition: false,
    });
  }
  return { rows, date };
}

// ─── API：上櫃當日行情 ────────────────────────────────────────────────────────

async function fetchTPEx(): Promise<StockRow[]> {
  const res = await fetch(`/api/tpex-daily?ts=${Date.now()}`, { cache: "no-store" })
  if (!res.ok) throw new Error(`TPEx proxy 失敗 (${res.status})`)
  const raw = await res.json()
  const data: Record<string, string>[] = Array.isArray(raw) ? raw : raw?.data ?? [];
  const rows: StockRow[] = [];
  if (data.length > 0) {
    console.log("[TPEx DEBUG] 第一筆原始資料:", JSON.stringify(data[0]));
  }
  for (const s of data) {
    // 過濾權證/ETF：只保留 4-5 碼純數字，且不以 0 開頭
    const code = String(s.SecuritiesCompanyCode ?? s.Code ?? "").trim();
    if (!/^\d{4,5}$/.test(code)) continue;
    if (code.startsWith("0")) continue;

    const price = parseFloat(String(s.Close ?? s.ClosingPrice ?? "").replace(/,/g, ""));
    if (price < 1) continue; // 過濾股價過低
    // TPEx Change 格式："+1.78" 或 "-1.78"
    const changeRaw = String(s.Change ?? "").replace(/,/g, "").trim();
    if (!changeRaw || changeRaw === "----" || changeRaw === "--") continue;
    const change = parseFloat(changeRaw);
    if (isNaN(price) || isNaN(change) || price <= 0) continue;
    const base = price - change;
    if (base <= 0) continue;
    const chg = (change / base) * 100;
    if (chg < 5) continue;
    const amount = firstNumber(s, [
      "TransactionAmount",
      "TradingValue",
      "TradeValue",
      "Amount",
      "Value",
      "TradingMoney",
      "TradingAmount",
    ]);
    rows.push({
      code: s.SecuritiesCompanyCode ?? s.Code ?? "",
      name: (s.CompanyName ?? s.Name ?? "").trim(),
      market: "上櫃",
      price,
      chg,
      amount,
      c14: null,
      vol5: null,
      vol14: null,
      range10: null,
      cap: null,
      ind: normalizeIndustry(s.Industry),
      attention: false,
      disposition: false,
    });
  }
  return rows;
}

// ─── 產業對照表（從 TWSE 個股基本資料 API 取得）────────────────────────────

async function fetchIndustryMap(): Promise<Record<string, { ind: string; cap: number | null }>> {
  try {
    const res = await fetch("/api/twse-industry");
    if (!res.ok) return {};
    const data = await res.json();
    const map: Record<string, { ind: string; cap: number | null }> = {};
    if (Array.isArray(data)) {
      for (const s of data) {
        const code = String(s["公司代號"] ?? s.SecuritiesCompanyCode ?? "").trim();
        const indCode = String(s["產業別"] ?? s.SecuritiesIndustryCode ?? "").trim();
        const capRaw = parseFloat(String(s["實收資本額"] ?? s["Paidin.Capital.NTDollars"] ?? "0"));
        const cap = !isNaN(capRaw) && capRaw > 0 ? parseFloat((capRaw / 1e8).toFixed(1)) : null;
        const ind = normalizeIndustry(indCode);
        if (code) map[code] = { ind, cap };
      }
    }
    console.log("[IND DEBUG] 產業對照筆數:", Object.keys(map).length,
      "範例:", JSON.stringify(Object.entries(map).slice(0, 2)));
    return map;
  } catch (e) {
    console.error("[IND DEBUG] 產業對照失敗:", e);
    return {};
  }
}

async function fetchStockFlagMap(): Promise<Record<string, {
  attention: boolean;
  disposition: boolean;
  reason?: string;
  period?: string;
}>> {
  try {
    const res = await fetch("/api/stock-flags");
    if (!res.ok) return {};
    const data: {
      code: string;
      market: "上市" | "上櫃";
      type: StockFlagType;
      reason?: string;
      period?: string;
    }[] = await res.json();
    const map: Record<string, {
      attention: boolean;
      disposition: boolean;
      reason?: string;
      period?: string;
    }> = {};

    if (Array.isArray(data)) {
      for (const item of data) {
        if (!item.code || !item.market) continue;
        const key = rowKey(String(item.code).trim(), item.market);
        const current = map[key] ?? { attention: false, disposition: false };
        if (item.type === "attention") current.attention = true;
        if (item.type === "disposition") current.disposition = true;
        current.reason = current.reason || item.reason;
        current.period = current.period || item.period;
        map[key] = current;
      }
    }

    return map;
  } catch {
    return {};
  }
}



function calcHistoryMetrics(
  rows: { date?: string; open?: number; close: number; volume: number; high?: number; low?: number }[],
  currentPrice?: number
): {
  c14: number | null;
  vol5: number | null;
  vol14: number | null;
  range10: number | null;
  priorHigh: number | null;
  julyOpen: number | null;
  julyLow: number | null;
  recoveredPriorHigh: boolean;
  recoveredJulyOpen: boolean;
  recoveryKind: RecoveryKind | null;
  vsPriorHighPct: number | null;
  vsJulyOpenPct: number | null;
  neckline: number | null;
  gapPct: number | null;
  volRatio: number | null;
  brokeNeckline: boolean;
  gappedUp: boolean;
  volumeSurge: boolean;
} {
  const emptyRecovery = {
    priorHigh: null,
    julyOpen: null,
    julyLow: null,
    recoveredPriorHigh: false,
    recoveredJulyOpen: false,
    recoveryKind: null as RecoveryKind | null,
    vsPriorHighPct: null,
    vsJulyOpenPct: null,
    neckline: null,
    gapPct: null,
    volRatio: null,
    brokeNeckline: false,
    gappedUp: false,
    volumeSurge: false,
  };
  const allRows = rows
    .filter((row) => Number.isFinite(row.close) && row.close > 0);
  const recent = allRows.slice(-40);
  if (recent.length < 5) {
    return { c14: null, vol5: null, vol14: null, range10: null, ...emptyRecovery };
  }

  const n = recent.length;
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  const p0 = recent[Math.max(0, n - 14)].close;
  const p1 = recent[n - 1].close;
  const c14 = p0 > 0 ? parseFloat(((p1 - p0) / p0 * 100).toFixed(1)) : null;

  const volumes = recent.map((row) => row.volume || 0);
  const recent5 = volumes.slice(-5);
  const prev5 = volumes.slice(Math.max(0, n - 10), n - 5);
  const vol5 =
    prev5.length >= 5 && recent5.length >= 5 && avg(prev5) > 0
      ? Math.round(((avg(recent5) - avg(prev5)) / avg(prev5)) * 100)
      : null;

  const recent14 = volumes.slice(-14);
  const prev14 = volumes.slice(Math.max(0, n - 28), n - 14);
  const vol14 =
    prev14.length >= 14 && recent14.length >= 14 && avg(prev14) > 0
      ? Math.round(((avg(recent14) - avg(prev14)) / avg(prev14)) * 100)
      : null;

  const recent10 = recent.slice(-10);
  const range10 = recent10.length >= 10
    ? (() => {
        const highs = recent10.map((row) => Number.isFinite(row.high) ? row.high as number : row.close);
        const lows = recent10.map((row) => Number.isFinite(row.low) ? row.low as number : row.close);
        const high = Math.max(...highs);
        const low = Math.min(...lows);
        return low > 0 ? parseFloat((((high - low) / low) * 100).toFixed(1)) : null;
      })()
    : null;

  const historyBars: HistoryBar[] = allRows
    .filter((row) => row.date)
    .map((row) => ({
      date: String(row.date),
      open: Number.isFinite(row.open) ? Number(row.open) : row.close,
      high: Number.isFinite(row.high) ? Number(row.high) : row.close,
      low: Number.isFinite(row.low) ? Number(row.low) : row.close,
      close: row.close,
      volume: row.volume || 0,
    }));
  const recovery = calcJulyRecovery(historyBars, currentPrice);

  // 今日 vs 近端整理：頸線=不含今日的近20日最高價；跳空=今開/昨收；放量=今日量/近20日均量
  const today = recent[n - 1];
  const prev = n >= 2 ? recent[n - 2] : null;
  const lookback = recent.slice(Math.max(0, n - 21), n - 1);
  const neckline = lookback.length >= 5
    ? Math.max(...lookback.map((row) => (Number.isFinite(row.high) ? Number(row.high) : row.close)))
    : null;
  const todayClose = today.close;
  const todayOpen = Number.isFinite(today.open) ? Number(today.open) : todayClose;
  const todayVol = today.volume || 0;
  const baseVols = lookback.map((row) => row.volume || 0).filter((v) => v > 0);
  const baseVolAvg = baseVols.length >= 5 ? avg(baseVols) : 0;
  const volRatio = baseVolAvg > 0 ? parseFloat((todayVol / baseVolAvg).toFixed(2)) : null;
  const gapPct = prev && prev.close > 0
    ? parseFloat((((todayOpen - prev.close) / prev.close) * 100).toFixed(2))
    : null;
  const brokeNeckline = neckline != null && neckline > 0
    ? todayClose >= neckline * (1 - NECKLINE_TOL)
    : false;
  const gappedUp = gapPct != null ? gapPct >= MIN_GAP_PCT : false;
  const volumeSurge = volRatio != null ? volRatio >= MIN_VOL_RATIO : false;

  return {
    c14,
    vol5,
    vol14,
    range10,
    priorHigh: recovery.priorHigh,
    julyOpen: recovery.julyOpen,
    julyLow: recovery.julyLow,
    recoveredPriorHigh: recovery.recoveredPriorHigh,
    recoveredJulyOpen: recovery.recoveredJulyOpen,
    recoveryKind: recovery.recoveryKind,
    vsPriorHighPct: recovery.vsPriorHighPct,
    vsJulyOpenPct: recovery.vsJulyOpenPct,
    neckline: neckline != null ? parseFloat(neckline.toFixed(2)) : null,
    gapPct,
    volRatio,
    brokeNeckline,
    gappedUp,
    volumeSurge,
  };
}

function emptyHistoryMetrics() {
  return {
    c14: null,
    vol5: null,
    vol14: null,
    range10: null,
    priorHigh: null,
    julyOpen: null,
    julyLow: null,
    recoveredPriorHigh: false,
    recoveredJulyOpen: false,
    recoveryKind: null as RecoveryKind | null,
    vsPriorHighPct: null,
    vsJulyOpenPct: null,
    neckline: null,
    gapPct: null,
    volRatio: null,
    brokeNeckline: false,
    gappedUp: false,
    volumeSurge: false,
  };
}

async function fetchTwseMonthRows(code: string, year: number, month: number): Promise<string[][]> {
  const ym = `${year}${String(month).padStart(2, "0")}01`;
  const r = await fetch(`/api/twse-history?date=${ym}&stockNo=${code}`);
  const d = r.ok ? await r.json() : null;
  return d?.stat === "OK" && Array.isArray(d.data) ? d.data : [];
}

async function fetchHistory(
  code: string,
  market: "上市" | "上櫃",
  currentPrice?: number
): Promise<ReturnType<typeof emptyHistoryMetrics>> {
  try {
    if (market === "上櫃") {
      const r = await fetch(`/api/yahoo-history?symbol=${code}.TWO&days=160`);
      const d = r.ok ? await r.json() : null;
      const rows = d?.stat === "OK" && Array.isArray(d.data)
        ? d.data.map((row: {
          date?: string;
          open?: number;
          close: number;
          volume: number;
          high?: number;
          low?: number;
        }) => ({
            date: row.date ? String(row.date).slice(0, 10) : undefined,
            open: Number(row.open ?? row.close),
            close: Number(row.close),
            volume: Number(row.volume || 0),
            high: Number(row.high || row.close),
            low: Number(row.low || row.close),
          }))
        : [];
      return calcHistoryMetrics(rows, currentPrice);
    }

    const now = new Date();
    // Need June prior-high + July open/low + current month for recovery signals.
    const months: { year: number; month: number }[] = [];
    for (let back = 3; back >= 0; back -= 1) {
      const dt = new Date(now.getFullYear(), now.getMonth() - back, 1);
      months.push({ year: dt.getFullYear(), month: dt.getMonth() + 1 });
    }
    const monthChunks = await Promise.all(
      months.map(({ year, month }) => fetchTwseMonthRows(code, year, month))
    );
    const rows = monthChunks.flat().map((row) => ({
      date: String(row[0] ?? ""),
      open: parseFloat(row[3]?.replace(/,/g, "") ?? "0"),
      high: parseFloat(row[4]?.replace(/,/g, "") ?? "0"),
      low: parseFloat(row[5]?.replace(/,/g, "") ?? "0"),
      close: parseFloat(row[6]?.replace(/,/g, "") ?? "0"),
      volume: parseInt(row[1]?.replace(/,/g, "") ?? "0", 10),
    }));
    return calcHistoryMetrics(rows, currentPrice);
  } catch {
    return emptyHistoryMetrics();
  }
}

// ─── 可行動訊號：隔日可試 / 別追 ─────────────────────────────────────────────
// Grace 規則：破頸線 + 量能加大 + 跳空 → 隔日小量可試
// 已噴一段、沒有乾淨突破 → 別追；其餘不進榜，避免再堆觀察名單

function isLiquid(s: StockRow): boolean {
  return s.price > MIN_PRICE && (s.amount ?? 0) >= MIN_AMOUNT;
}

function isExtended(s: StockRow): boolean {
  return (
    (s.c14 !== null && s.c14 >= MIN_OVERHEAT_C14) ||
    (s.range10 !== null && s.range10 >= MIN_OVERHEAT_RANGE10)
  );
}

function necklineOf(s: StockRow): number | null {
  if (s.neckline != null && s.neckline > 0) return s.neckline;
  if (s.priorHigh != null && s.priorHigh > 0) return s.priorHigh;
  return null;
}

function aboveNeckPct(s: StockRow): number | null {
  const neck = necklineOf(s);
  if (neck == null || neck <= 0 || s.price <= 0) return null;
  return ((s.price - neck) / neck) * 100;
}

/** 盤後確認：破頸線 + 放量 + 跳空，且尚未追太遠 → 隔日可小量試 */
function isTryNext(s: StockRow): boolean {
  if (!isLiquid(s) || s.disposition) return false;
  if (!s.brokeNeckline || !s.volumeSurge || !s.gappedUp) return false;
  const above = aboveNeckPct(s);
  if (above != null && above > MAX_ABOVE_NECK_PCT) return false;
  return true;
}

/** 已噴多、沒有乾淨隔日試單條件 → 別追 */
function isSkip(s: StockRow): boolean {
  return isLiquid(s) && isExtended(s) && !isTryNext(s);
}

function triggerPriceOf(s: StockRow): number | null {
  return necklineOf(s);
}

function getActionLabel(s: StockRow): ActionLabel {
  if (isTryNext(s)) return "隔日可試";
  if (isSkip(s)) return "別追";
  return null;
}

function fmtPrice(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function tryScore(s: StockRow): number {
  const gap = Math.max(s.gapPct ?? 0, 0);
  const vol = Math.max(s.volRatio ?? 0, 0) * 10;
  const chg = s.chg * 2;
  const above = aboveNeckPct(s);
  const latePenalty = above != null && above > 3 ? (above - 3) * 2 : 0;
  return gap * 3 + vol + chg - latePenalty;
}

function skipScore(s: StockRow): number {
  return Math.max(s.c14 ?? 0, 0) * 2 + Math.max(s.range10 ?? 0, 0);
}

function RiskBadge({ type, title }: { type: StockFlagType; title?: string }) {
  const isDisposition = type === "disposition";
  return (
    <span
      title={title}
      style={{
        marginLeft: 6,
        display: "inline-flex",
        alignItems: "center",
        fontSize: 10,
        padding: "1px 6px",
        borderRadius: 4,
        background: isDisposition ? "rgba(240,92,92,0.16)" : "rgba(245,158,11,0.16)",
        color: isDisposition ? "var(--c-up)" : "var(--c-amber)",
        border: `1px solid ${isDisposition ? "rgba(240,92,92,0.28)" : "rgba(245,158,11,0.28)"}`,
      }}
    >
      {isDisposition ? "處置" : "注意"}
    </span>
  );
}

function ActionBadge({ label }: { label: ActionLabel }) {
  if (!label) return null;
  const styleByLabel: Record<Exclude<ActionLabel, null>, {
    bg: string;
    color: string;
    border: string;
  }> = {
    "隔日可試": {
      bg: "rgba(43,189,142,0.14)",
      color: "var(--c-dn)",
      border: "rgba(43,189,142,0.28)",
    },
    "別追": {
      bg: "rgba(240,92,92,0.12)",
      color: "var(--c-up)",
      border: "rgba(240,92,92,0.26)",
    },
  };
  const style = styleByLabel[label];
  return (
    <span style={{
      marginLeft: 6,
      display: "inline-flex",
      alignItems: "center",
      fontSize: 10,
      padding: "1px 6px",
      borderRadius: 4,
      background: style.bg,
      color: style.color,
      border: `1px solid ${style.border}`,
    }}>
      {label}
    </span>
  );
}

// ─── 子元件：排序欄位標題 ─────────────────────────────────────────────────────

type SortKey = keyof StockRow | "rankScore";

function SortTh({
  label, sk, sortKey, sortAsc, onSort, style,
}: {
  label: string; sk: SortKey; sortKey: SortKey; sortAsc: boolean;
  onSort: (k: SortKey) => void; style?: CSSProperties;
}) {
  const active = sortKey === sk;
  return (
    <th
      onClick={() => onSort(sk)}
      style={{
        padding: "10px 12px", textAlign: "left", fontSize: 12, fontWeight: 500,
        whiteSpace: "nowrap", cursor: "pointer", userSelect: "none",
        color: active ? "var(--c-up)" : "var(--c-muted)",
        ...style,
      }}
    >
      {label}
      <span style={{ marginLeft: 3, opacity: 0.6 }}>
        {active ? (sortAsc ? "↑" : "↓") : "↕"}
      </span>
    </th>
  );
}

// ─── 主元件 ───────────────────────────────────────────────────────────────────

export default function StockSurge({ onAddToWatchlist }: {
  onAddToWatchlist?: (item: {
    id: string; date: string; symbol: string; shortName: string;
    source?: 'analysis' | 'surge'; price: number; currency: string;
    market?: string; industry?: string; todayChange?: number | null;
    c14?: number | null; vol5?: number | null; vol14?: number | null;
    amount?: number | null; surgeMode?: string;
    attention?: boolean; disposition?: boolean; flagReason?: string; flagPeriod?: string;
    pivotPrice: number;
    suggestedStopLoss: number; ma50Extension: string;
    extensionText: string; failedConditions: string[];
  }) => void;
}) {
  const [stocks, setStocks] = useState<StockRow[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");
  const [loadNote, setLoadNote] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("rankScore");
  const [sortAsc, setSortAsc] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("try");
  const [dataDate, setDataDate] = useState("");
  const [cacheSavedAt, setCacheSavedAt] = useState("");
  const [usingCache, setUsingCache] = useState(false);
  const [addedCodes, setAddedCodes] = useState<Set<string>>(new Set());

  // ── 主要資料載入邏輯 ──────────────────────────────────────────────────────

  const loadData = useCallback(async (forceRefresh = false) => {
    const cached = readSurgeCache();

    setErrMsg("");

    if (cached && !forceRefresh) {
      setStocks(cached.stocks);
      setDataDate(cached.dataDate);
      setCacheSavedAt(cached.savedAt);
      setUsingCache(true);
      setStatus("done");

      if (shouldUseCache(cached, false)) {
        setLoadNote(isAfterRefreshTime() || isWeekend()
          ? "使用暫存資料；手動重新整理可強制更新。"
          : "使用暫存資料；盤後 15:45 後會自動更新。");
        return;
      }

      setLoadNote("暫存已過期，正在更新今日盤後資料...");
    } else {
      setStatus("loading");
      setStocks([]);
      setDataDate("");
      setCacheSavedAt("");
      setUsingCache(false);
      setLoadNote("連線台灣證交所與櫃買中心...");
    }

    try {
      const [twseRes, tpexRes, indRes] = await Promise.allSettled([
        fetchTWSE(),
        fetchTPEx(),
        fetchIndustryMap(),
      ]);
      let all: StockRow[] = [];
      let apiDate = "";
      const sourceWarnings: string[] = [];
      const indMap = indRes.status === "fulfilled" ? indRes.value : {};

      if (twseRes.status === "fulfilled") {
        const rows = twseRes.value.rows.map(s => ({
          ...s,
          ind: indMap[s.code]?.ind ?? "其他",
          cap: indMap[s.code]?.cap ?? null,
        }));
        all = all.concat(rows);
        if (twseRes.value.date) apiDate = twseRes.value.date;
      }
      if (tpexRes.status === "fulfilled") {
        const rows = tpexRes.value.map(s => ({
          ...s,
          ind: indMap[s.code]?.ind ?? s.ind ?? "其他",
          cap: indMap[s.code]?.cap ?? null,
        }));
        all = all.concat(rows);
      } else {
        sourceWarnings.push("上櫃資料暫時抓取失敗，清單可能缺少上櫃股票。");
      }

      if (twseRes.status === "rejected") {
        sourceWarnings.push("上市資料暫時抓取失敗。");
      }

      if (indRes.status === "rejected") {
        sourceWarnings.push("產業資料暫時抓取失敗，產業分類可能不完整。");
      }

      if (all.length === 0) {
        // 嘗試判斷是否為非交易日（週六日）
        const now = new Date();
        const day = now.getDay();
        const isWeekend = day === 0 || day === 6;
        const isBeforeClose = !isAfterRefreshTime(now);
        let msg = "今日無漲幅超過 5% 的股票。";
        if (isWeekend) msg = "今日為週末非交易日，顯示最近一個交易日資料。若仍無資料，請稍後再試。";
        else if (isBeforeClose) msg = "盤後資料約 15:45 後更新，目前顯示前一交易日資料。";
        setStatus("error");
        setErrMsg(msg);
        if (cached) {
          setStocks(cached.stocks);
          setDataDate(cached.dataDate);
          setCacheSavedAt(cached.savedAt);
          setUsingCache(true);
          setStatus("done");
          setErrMsg("");
          setLoadNote("今日資料尚未取回，先顯示暫存資料。");
        }
        return;
      }

      setLoadNote("比對注意股與處置股...");
      const flagMap = await fetchStockFlagMap();
      all = all.map((s) => {
        const flag = flagMap[rowKey(s.code, s.market)];
        return flag
          ? {
              ...s,
              attention: flag.attention,
              disposition: flag.disposition,
              flagReason: flag.reason,
              flagPeriod: flag.period,
            }
          : s;
      });

      all.sort((a, b) => b.chg - a.chg);
      let enriched = all;
      setStocks(all);
      setDataDate(apiDate);
      setStatus("done");
      setUsingCache(false);

      // 批次抓歷史資料（上市走 TWSE；上櫃走 Yahoo Finance .TWO）
      const historyTargets = all;
      const total = historyTargets.length;
      const BATCH = 5;

      for (let i = 0; i < total; i += BATCH) {
        setLoadNote(`抓取歷史資料 ${Math.min(i + BATCH, total)} / ${total}...`);
        const batch = historyTargets.slice(i, i + BATCH);
        const histResults = await Promise.all(
          batch.map(async (s) => {
            const hist = await fetchHistory(s.code, s.market, s.price);
            return { code: s.code, market: s.market, hist };
          })
        );
        enriched = enriched.map((row) => {
          const found = histResults.find((item) => item.code === row.code && item.market === row.market);
          return found ? { ...row, ...found.hist } : row;
        });
        setStocks(enriched);
        // 小延遲避免 rate limit
        if (i + BATCH < total) await new Promise((r) => setTimeout(r, 300));
      }
      const savedAt = new Date().toISOString();
      writeSurgeCache({
        version: CACHE_VERSION,
        savedAt,
        dataDate: apiDate,
        stocks: enriched,
      });
      setCacheSavedAt(savedAt);
      setUsingCache(false);
      setLoadNote(sourceWarnings.join(" "));
    } catch (e) {
      if (cached) {
        setStocks(cached.stocks);
        setDataDate(cached.dataDate);
        setCacheSavedAt(cached.savedAt);
        setUsingCache(true);
        setStatus("done");
        setErrMsg("");
        setLoadNote("更新失敗，先顯示暫存資料。");
        return;
      }
      setStatus("error");
      setErrMsg(e instanceof Error ? e.message : "未知錯誤，請稍後再試");
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleAddToWatchlist = useCallback((s: StockRow) => {
    if (!onAddToWatchlist) return;
    onAddToWatchlist({
      id: Date.now().toString(),
      date: new Date().toLocaleString('zh-TW', { hour12: false }),
      source: "surge",
      symbol: s.code + (s.market === "上櫃" ? ".TWO" : ".TW"),
      shortName: s.name,
      price: s.price,
      currency: "NT$",
      market: s.market,
      industry: s.ind,
      todayChange: s.chg,
      c14: s.c14,
      vol5: s.vol5,
      vol14: s.vol14,
      amount: s.amount,
      surgeMode: getActionLabel(s) ?? "符合訊號",
      attention: s.attention,
      disposition: s.disposition,
      flagReason: s.flagReason,
      flagPeriod: s.flagPeriod,
      pivotPrice: triggerPriceOf(s) ?? 0,
      suggestedStopLoss: 0,
      ma50Extension: "0",
      extensionText: getActionLabel(s) ?? "",
      failedConditions: [],
    });
    setAddedCodes(prev => new Set(prev).add(s.code));
  }, [onAddToWatchlist]);

  // ── 排序 ─────────────────────────────────────────────────────────────────

  const handleSort = (k: SortKey) => {
    if (sortKey === k) setSortAsc(!sortAsc);
    else {
      setSortKey(k);
      setSortAsc(k === "code" || k === "name" || k === "ind");
    }
  };

  const tryRows = stocks
    .filter(isTryNext)
    .sort((a, b) => tryScore(b) - tryScore(a))
    .slice(0, LIST_LIMIT);
  const skipRows = stocks
    .filter(isSkip)
    .sort((a, b) => skipScore(b) - skipScore(a))
    .slice(0, LIST_LIMIT);
  const modeRows = viewMode === "try" ? tryRows : skipRows;

  const sorted = [...modeRows].sort((a, b) => {
    const rankOf = (row: StockRow) =>
      viewMode === "try" ? tryScore(row) : skipScore(row);
    const va = sortKey === "rankScore"
      ? rankOf(a)
      : a[sortKey as keyof StockRow] as number | string | null | undefined;
    const vb = sortKey === "rankScore"
      ? rankOf(b)
      : b[sortKey as keyof StockRow] as number | string | null | undefined;
    if (va === null || va === undefined) {
      if (vb === null || vb === undefined) return 0;
      return 1;
    }
    if (vb === null || vb === undefined) return -1;
    if (typeof va === "string")
      return sortAsc ? va.localeCompare(String(vb)) : String(vb).localeCompare(va);
    return sortAsc ? (va as number) - (vb as number) : (vb as number) - (va as number);
  });

  // ── 統計 ─────────────────────────────────────────────────────────────────

  const tryCount = stocks.filter(isTryNext).length;
  const skipCount = stocks.filter(isSkip).length;
  const isRefreshing =
    status === "loading" ||
    loadNote.includes("連線") ||
    loadNote.includes("正在") ||
    loadNote.includes("抓取");

  // ── CSS 變數（深色金融風格）────────────────────────────────────────────────

  const cssVars = `
    .stock-surge {
      --c-bg: #0d0f14;
      --c-surface: #13161e;
      --c-surface2: #1c2030;
      --c-border: #252a3a;
      --c-text: #e4e8f0;
      --c-muted: #6b7394;
      --c-up: #f05c5c;
      --c-dn: #2bbd8e;
      --c-amber: #f59e0b;
      --c-blue: #60a5fa;
    }
    .stock-surge table { border-collapse: collapse; width: 100%; min-width: 640px; }
    .stock-surge tbody tr:hover { background: rgba(255,255,255,0.03) !important; }
    .stock-surge .spin { animation: spin 1s linear infinite; }
    .stock-surge .desktop-table { display: none; }
    .stock-surge .mobile-cards { display: grid; gap: 10px; }
    @media (min-width: 768px) {
      .stock-surge .desktop-table { display: block; }
      .stock-surge .mobile-cards { display: none; }
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `;

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <div
      className="stock-surge"
      style={{
        minHeight: "100vh",
        padding: "16px 12px 28px",
        background: "var(--c-bg)",
        color: "var(--c-text)",
        fontFamily: "'IBM Plex Sans TC', 'Noto Sans TC', 'PingFang TC', sans-serif",
      }}
    >
      <style>{cssVars}</style>

      {/* ── 標頭 ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10, flexShrink: 0,
            background: "rgba(240,92,92,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <TrendingUp size={18} color="var(--c-up)" />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "0.02em" }}>每日強勢股追蹤</div>
            <div style={{ fontSize: 12, color: "var(--c-muted)", marginTop: 2, lineHeight: 1.45 }}>
              {dataDate ? `資料日期：${dataDate}` : "載入中..."} · 上市＋上櫃 · 漲幅 &gt;5%
              {cacheSavedAt ? ` · ${usingCache ? "暫存" : "更新"}：${formatCacheTime(cacheSavedAt)}` : ""}
            </div>
          </div>
        </div>
        <button
          onClick={() => loadData(true)}
          disabled={status === "loading"}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "8px 14px", borderRadius: 8, fontSize: 13, cursor: "pointer",
            background: "var(--c-surface)", border: "1px solid var(--c-border)",
            color: "var(--c-text)", opacity: status === "loading" ? 0.5 : 1,
          }}
        >
          <RefreshCw size={13} className={status === "loading" ? "spin" : ""} />
          重新整理
        </button>
      </div>

      {/* ── 載入中 ── */}
      {status === "loading" && stocks.length === 0 && (
        <div style={{
          background: "var(--c-surface)", border: "1px solid var(--c-border)",
          borderRadius: 12, padding: "48px 24px", textAlign: "center",
          color: "var(--c-muted)", fontSize: 14,
        }}>
          <RefreshCw size={22} className="spin" style={{ margin: "0 auto 12px" }} />
          <div>連線中，請稍候...</div>
        </div>
      )}

      {/* ── 錯誤 ── */}
      {status === "error" && (
        <div style={{
          background: "var(--c-surface)", border: "1px solid var(--c-border)",
          borderRadius: 12, padding: "40px 24px", textAlign: "center",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
        }}>
          <AlertCircle size={26} color="var(--c-up)" />
          <div style={{ fontSize: 14, color: "var(--c-muted)" }}>{errMsg}</div>
          <button
            onClick={() => loadData(true)}
            style={{
              marginTop: 8, padding: "6px 18px", borderRadius: 8, fontSize: 13,
              background: "var(--c-surface2)", border: "1px solid var(--c-border)",
              color: "var(--c-text)", cursor: "pointer",
            }}
          >
            重試
          </button>
        </div>
      )}

      {/* ── 表格區 ── */}
      {stocks.length > 0 && (
        <>
          {loadNote && (
            <div style={{ fontSize: 12, color: "var(--c-muted)", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
              <RefreshCw size={11} className={isRefreshing ? "spin" : ""} />
              {loadNote}
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
            <div style={{
              display: "inline-flex", padding: 3, borderRadius: 8,
              background: "var(--c-surface)", border: "1px solid var(--c-border)",
            }}>
              {[
                { key: "try" as const, label: "隔日可試", count: Math.min(tryCount, LIST_LIMIT) },
                { key: "skip" as const, label: "別追", count: Math.min(skipCount, LIST_LIMIT) },
              ].map((item) => {
                const active = viewMode === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => {
                      setViewMode(item.key);
                      setSortKey("rankScore");
                      setSortAsc(false);
                    }}
                    style={{
                      border: 0, borderRadius: 6, cursor: "pointer",
                      padding: "7px 14px", fontSize: 12, fontWeight: 600,
                      background: active ? "var(--c-surface2)" : "transparent",
                      color: active ? "var(--c-text)" : "var(--c-muted)",
                    }}
                  >
                    {item.label}
                    <span style={{ marginLeft: 6, color: active ? "var(--c-up)" : "var(--c-muted)" }}>
                      {item.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{
            border: "1px solid var(--c-border)", borderRadius: 12,
            overflow: "hidden", marginBottom: 24,
          }}>
            <div className="mobile-cards" style={{ padding: 10 }}>
              {sorted.map((s) => {
                const label = getActionLabel(s);
                const neck = necklineOf(s);
                return (
                  <div
                    key={`m-${s.code}-${s.market}`}
                    style={{
                      border: "1px solid var(--c-border)",
                      borderRadius: 12,
                      background: "var(--c-surface)",
                      padding: "12px 12px 10px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{s.code}</span>
                          <span style={{ fontSize: 14, fontWeight: 600 }}>{s.name}</span>
                          <ActionBadge label={label} />
                          {s.disposition && (
                            <RiskBadge type="disposition" title={s.flagPeriod ? `處置期間：${s.flagPeriod}` : s.flagReason} />
                          )}
                          {!s.disposition && s.attention && (
                            <RiskBadge type="attention" title={s.flagReason} />
                          )}
                        </div>
                        <div style={{ marginTop: 8, fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                          {s.price.toLocaleString()}
                        </div>
                      </div>
                      {onAddToWatchlist && (
                        <button
                          onClick={() => handleAddToWatchlist(s)}
                          title="加入"
                          style={{
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            width: 34, height: 34, borderRadius: 8, cursor: "pointer", flexShrink: 0,
                            border: addedCodes.has(s.code) ? "1px solid var(--c-dn)" : "1px solid var(--c-border)",
                            background: addedCodes.has(s.code) ? "rgba(43,189,142,0.12)" : "var(--c-surface2)",
                            color: addedCodes.has(s.code) ? "var(--c-dn)" : "var(--c-muted)",
                          }}
                        >
                          {addedCodes.has(s.code) ? <Check size={14} /> : <BookmarkPlus size={14} />}
                        </button>
                      )}
                    </div>

                    <div style={{
                      marginTop: 12,
                      display: "grid",
                      gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                      gap: 8,
                    }}>
                      {[
                        { label: "股本", value: s.cap == null ? "—" : `${s.cap}億`, color: "var(--c-text)" },
                        {
                          label: "跳空",
                          value: s.gapPct == null ? "—" : `${s.gapPct >= 0 ? "+" : ""}${s.gapPct}%`,
                          color: s.gapPct == null ? "var(--c-muted)" : s.gapPct >= MIN_GAP_PCT ? "var(--c-up)" : "var(--c-muted)",
                        },
                        {
                          label: "量比",
                          value: s.volRatio == null ? "—" : `${s.volRatio}x`,
                          color: s.volRatio == null ? "var(--c-muted)" : s.volRatio >= MIN_VOL_RATIO ? "var(--c-up)" : "var(--c-muted)",
                        },
                        { label: "頸線", value: neck != null ? fmtPrice(neck) : "—", color: "var(--c-text)" },
                      ].map((cell) => (
                        <div
                          key={cell.label}
                          style={{
                            borderRadius: 8,
                            background: "var(--c-surface2)",
                            padding: "8px 6px",
                            textAlign: "center",
                          }}
                        >
                          <div style={{ fontSize: 10, color: "var(--c-muted)", marginBottom: 4 }}>{cell.label}</div>
                          <div style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: cell.color }}>
                            {cell.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="desktop-table" style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr style={{ background: "var(--c-surface2)", borderBottom: "1px solid var(--c-border)" }}>
                    <SortTh label="代號" sk="code" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} style={{ width: 64 }} />
                    <SortTh label="股名" sk="name" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} style={{ width: 100 }} />
                    <SortTh label="股價" sk="price" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} style={{ width: 72 }} />
                    <SortTh label="股本" sk="cap" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} style={{ width: 72 }} />
                    <th style={{ padding: "10px 12px", fontSize: 12, fontWeight: 500, color: "var(--c-muted)", whiteSpace: "nowrap", width: 72 }}>跳空</th>
                    <th style={{ padding: "10px 12px", fontSize: 12, fontWeight: 500, color: "var(--c-muted)", whiteSpace: "nowrap", width: 64 }}>量比</th>
                    <th style={{ padding: "10px 12px", fontSize: 12, fontWeight: 500, color: "var(--c-muted)", whiteSpace: "nowrap", width: 80 }}>頸線</th>
                    {onAddToWatchlist && (
                      <th style={{ padding: "10px 12px", fontSize: 12, fontWeight: 500, color: "var(--c-muted)", width: 52 }} />
                    )}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((s, i) => {
                    const label = getActionLabel(s);
                    const neck = necklineOf(s);
                    return (
                      <tr
                        key={`${s.code}-${s.market}`}
                        style={{
                          borderTop: "1px solid var(--c-border)",
                          background: i % 2 === 0 ? "var(--c-surface)" : "transparent",
                        }}
                      >
                        <td style={{ padding: "9px 12px", fontWeight: 600, fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
                          {s.code}
                        </td>
                        <td style={{ padding: "9px 12px", fontSize: 13, whiteSpace: "nowrap" }}>
                          {s.name}
                          <ActionBadge label={label} />
                          {s.disposition && (
                            <RiskBadge type="disposition" title={s.flagPeriod ? `處置期間：${s.flagPeriod}` : s.flagReason} />
                          )}
                          {!s.disposition && s.attention && (
                            <RiskBadge type="attention" title={s.flagReason} />
                          )}
                        </td>
                        <td style={{ padding: "9px 12px", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
                          {s.price.toLocaleString()}
                        </td>
                        <td style={{
                          padding: "9px 12px", fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums",
                          color: s.cap == null ? "var(--c-muted)" : "var(--c-text)",
                        }}>
                          {s.cap == null ? "—" : `${s.cap}億`}
                        </td>
                        <td style={{
                          padding: "9px 12px", fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums",
                          color: s.gapPct == null ? "var(--c-muted)" : s.gapPct >= MIN_GAP_PCT ? "var(--c-up)" : "var(--c-muted)",
                        }}>
                          {s.gapPct == null ? "—" : `${s.gapPct >= 0 ? "+" : ""}${s.gapPct}%`}
                        </td>
                        <td style={{
                          padding: "9px 12px", fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums",
                          color: s.volRatio == null ? "var(--c-muted)" : s.volRatio >= MIN_VOL_RATIO ? "var(--c-up)" : "var(--c-muted)",
                        }}>
                          {s.volRatio == null ? "—" : `${s.volRatio}x`}
                        </td>
                        <td style={{ padding: "9px 12px", fontSize: 13, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                          {neck != null ? fmtPrice(neck) : "—"}
                        </td>
                        {onAddToWatchlist && (
                          <td style={{ padding: "9px 12px", textAlign: "center" }}>
                            <button
                              onClick={() => handleAddToWatchlist(s)}
                              title="加入"
                              style={{
                                display: "inline-flex", alignItems: "center", justifyContent: "center",
                                width: 28, height: 28, borderRadius: 6, cursor: "pointer",
                                border: addedCodes.has(s.code) ? "1px solid var(--c-dn)" : "1px solid var(--c-border)",
                                background: addedCodes.has(s.code) ? "rgba(43,189,142,0.12)" : "var(--c-surface2)",
                                color: addedCodes.has(s.code) ? "var(--c-dn)" : "var(--c-muted)",
                                transition: "all 0.2s",
                              }}
                            >
                              {addedCodes.has(s.code)
                                ? <Check size={13} />
                                : <BookmarkPlus size={13} />
                              }
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
