// StockSurge v5 - 2026/06/11
import { useEffect, useState, useCallback, type CSSProperties } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { RefreshCw, TrendingUp, Flame, AlertCircle, BookmarkPlus, Check } from "lucide-react";

// ─── 型別定義 ─────────────────────────────────────────────────────────────────

interface StockRow {
  code: string;
  name: string;
  market: "上市" | "上櫃";
  price: number;
  chg: number;
  c14: number | null;
  vol5: number | null;
  vol14: number | null;
  cap: number | null;
  ind: string;
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

// ─── API：上市當日行情 ────────────────────────────────────────────────────────

async function fetchTWSE(): Promise<{ rows: StockRow[]; date: string }> {
  const res = await fetch('/api/twse-daily')
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
    rows.push({
      code,
      name: s.Name?.trim() ?? "",
      market: "上市",
      price,
      chg,
      c14: null,
      vol5: null,
      vol14: null,
      cap: null,
      ind: "載入中",  // 產業由 fetchIndustryMap 補上
    });
  }
  return { rows, date };
}

// ─── API：上櫃當日行情 ────────────────────────────────────────────────────────

async function fetchTPEx(): Promise<StockRow[]> {
  const res = await fetch('/api/tpex-daily')
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
    rows.push({
      code: s.SecuritiesCompanyCode ?? s.Code ?? "",
      name: (s.CompanyName ?? s.Name ?? "").trim(),
      market: "上櫃",
      price,
      chg,
      c14: null,
      vol5: null,
      vol14: null,
      cap: null,
      ind: normalizeIndustry(s.Industry),
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



function calcHistoryMetrics(
  rows: { close: number; volume: number }[]
): { c14: number | null; vol5: number | null; vol14: number | null } {
  const allRows = rows
    .filter((row) => Number.isFinite(row.close) && row.close > 0)
    .slice(-40);
  if (allRows.length < 5) return { c14: null, vol5: null, vol14: null };

  const n = allRows.length;
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  const p0 = allRows[Math.max(0, n - 14)].close;
  const p1 = allRows[n - 1].close;
  const c14 = p0 > 0 ? parseFloat(((p1 - p0) / p0 * 100).toFixed(1)) : null;

  const volumes = allRows.map((row) => row.volume || 0);
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

  return { c14, vol5, vol14 };
}

async function fetchHistory(
  code: string,
  market: "上市" | "上櫃"
): Promise<{ c14: number | null; vol5: number | null; vol14: number | null }> {
  try {
    if (market === "上櫃") {
      const r = await fetch(`/api/yahoo-history?symbol=${code}.TWO`);
      const d = r.ok ? await r.json() : null;
      const rows = d?.stat === "OK" && Array.isArray(d.data)
        ? d.data.map((row: { close: number; volume: number }) => ({
            close: Number(row.close),
            volume: Number(row.volume || 0),
          }))
        : [];
      return calcHistoryMetrics(rows);
    }

    const now = new Date();

    // 抓本月資料
    const ymThis = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}01`;
    const r1 = await fetch(`/api/twse-history?date=${ymThis}&stockNo=${code}`);
    const d1 = r1.ok ? await r1.json() : null;
    const thisRows: string[][] = d1?.stat === "OK" && Array.isArray(d1.data) ? d1.data : [];

    // 如果本月資料不足 28 筆，補抓上個月
    let prevRows: string[][] = [];
    if (thisRows.length < 28) {
      const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const ymPrev = `${prevDate.getFullYear()}${String(prevDate.getMonth() + 1).padStart(2, "0")}01`;
      const r2 = await fetch(`/api/twse-history?date=${ymPrev}&stockNo=${code}`);
      const d2 = r2.ok ? await r2.json() : null;
      prevRows = d2?.stat === "OK" && Array.isArray(d2.data) ? d2.data : [];
    }

    const rows = [...prevRows, ...thisRows].map((row) => ({
      close: parseFloat(row[6]?.replace(/,/g, "") ?? "0"),
      volume: parseInt(row[2]?.replace(/,/g, "") ?? "0", 10),
    }));
    return calcHistoryMetrics(rows);
  } catch {
    return { c14: null, vol5: null, vol14: null };
  }
}

// ─── 底部啟動判斷 ─────────────────────────────────────────────────────────────

function isBottom(s: StockRow): boolean {
  return (s.c14 !== null ? s.c14 < 5 : false) && (s.vol5 !== null ? s.vol5 > 100 : false);
}

// ─── 子元件：量能進度條 ───────────────────────────────────────────────────────

function VolBar({ value }: { value: number | null }) {
  if (value === null)
    return <span style={{ color: "var(--c-muted)", fontSize: 12 }}>—</span>;
  const up = value >= 0;
  const w = Math.min(Math.abs(value), 500) / 500 * 100;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 110 }}>
      <div style={{ flex: 1, height: 3, borderRadius: 2, background: "var(--c-surface2)" }}>
        <div style={{
          height: 3, borderRadius: 2,
          width: `${w.toFixed(0)}%`,
          background: up ? "var(--c-up)" : "var(--c-dn)",
        }} />
      </div>
      <span style={{
        fontSize: 12, fontWeight: 600, minWidth: 52, textAlign: "right",
        color: up ? "var(--c-up)" : "var(--c-dn)",
        fontVariantNumeric: "tabular-nums",
      }}>
        {up ? "+" : ""}{value}%
      </span>
    </div>
  );
}

// ─── 子元件：排序欄位標題 ─────────────────────────────────────────────────────

type SortKey = keyof StockRow;

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
    price: number; currency: string; pivotPrice: number;
    suggestedStopLoss: number; ma50Extension: string;
    extensionText: string; failedConditions: string[];
  }) => void;
}) {
  const [stocks, setStocks] = useState<StockRow[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");
  const [loadNote, setLoadNote] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("chg");
  const [sortAsc, setSortAsc] = useState(false);
  const [dataDate, setDataDate] = useState("");
  const [addedCodes, setAddedCodes] = useState<Set<string>>(new Set());

  // ── 主要資料載入邏輯 ──────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setStatus("loading");
    setStocks([]);
    setErrMsg("");
    setDataDate("");
    setLoadNote("連線台灣證交所與櫃買中心...");

    try {
      const [twseRes, tpexRes, indRes] = await Promise.allSettled([
        fetchTWSE(),
        fetchTPEx(),
        fetchIndustryMap(),
      ]);
      let all: StockRow[] = [];
      let apiDate = "";
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
      }

      if (all.length === 0) {
        // 嘗試判斷是否為非交易日（週六日）
        const now = new Date();
        const day = now.getDay();
        const isWeekend = day === 0 || day === 6;
        const isBeforeClose = now.getHours() < 15 || (now.getHours() === 15 && now.getMinutes() < 30);
        let msg = "今日無漲幅超過 5% 的股票。";
        if (isWeekend) msg = "今日為週末非交易日，顯示最近一個交易日資料。若仍無資料，請稍後再試。";
        else if (isBeforeClose) msg = "盤後資料約 15:30 後更新，目前顯示前一交易日資料。";
        setStatus("error");
        setErrMsg(msg);
        return;
      }

      all.sort((a, b) => b.chg - a.chg);
      setStocks(all);
      setDataDate(apiDate);
      setStatus("done");

      // 批次抓歷史資料（上市走 TWSE；上櫃走 Yahoo Finance .TWO）
      const historyTargets = all;
      const total = historyTargets.length;
      const BATCH = 5;

      for (let i = 0; i < total; i += BATCH) {
        setLoadNote(`抓取歷史資料 ${Math.min(i + BATCH, total)} / ${total}...`);
        const batch = historyTargets.slice(i, i + BATCH);
        await Promise.all(
          batch.map(async (s) => {
            const hist = await fetchHistory(s.code, s.market);
            setStocks((prev) =>
              prev.map((r) =>
                r.code === s.code && r.market === s.market ? { ...r, ...hist } : r
              )
            );
          })
        );
        // 小延遲避免 rate limit
        if (i + BATCH < total) await new Promise((r) => setTimeout(r, 300));
      }
      setLoadNote("");
    } catch (e) {
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
      symbol: s.code + (s.market === "上櫃" ? ".TWO" : ".TW"),
      shortName: s.name,
      price: s.price,
      currency: "NT$",
      pivotPrice: 0,
      suggestedStopLoss: 0,
      ma50Extension: "0",
      extensionText: "從強勢股追蹤加入",
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

  const sorted = [...stocks].sort((a, b) => {
    const va = a[sortKey] as number | string | null;
    const vb = b[sortKey] as number | string | null;
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (typeof va === "string")
      return sortAsc ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
    return sortAsc ? (va as number) - (vb as number) : (vb as number) - (va as number);
  });

  // ── 統計 ─────────────────────────────────────────────────────────────────

  const indMap: Record<string, number> = {};
  stocks.forEach((s) => { indMap[s.ind] = (indMap[s.ind] ?? 0) + 1; });
  const indEntries = Object.entries(indMap).sort((a, b) => b[1] - a[1]);
  const maxInd = indEntries[0]?.[1] ?? 1;
  const bottomCount = stocks.filter(isBottom).length;
  const chartData = indEntries.slice(0, 12).map(([name, count]) => ({ name, count }));

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
    .stock-surge table { border-collapse: collapse; width: 100%; }
    .stock-surge tbody tr:hover { background: rgba(255,255,255,0.03) !important; }
    .stock-surge .spin { animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  `;

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <div
      className="stock-surge"
      style={{
        minHeight: "100vh",
        padding: "24px 16px",
        background: "var(--c-bg)",
        color: "var(--c-text)",
        fontFamily: "'IBM Plex Sans TC', 'Noto Sans TC', 'PingFang TC', sans-serif",
      }}
    >
      <style>{cssVars}</style>

      {/* ── 標頭 ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: "rgba(240,92,92,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <TrendingUp size={18} color="var(--c-up)" />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "0.02em" }}>每日強勢股追蹤</div>
            <div style={{ fontSize: 12, color: "var(--c-muted)", marginTop: 2 }}>
              {dataDate ? `資料日期：${dataDate}` : "載入中..."} · 上市＋上櫃 · 漲幅 &gt;5%
            </div>
          </div>
        </div>
        <button
          onClick={loadData}
          disabled={status === "loading"}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "7px 16px", borderRadius: 8, fontSize: 13, cursor: "pointer",
            background: "var(--c-surface)", border: "1px solid var(--c-border)",
            color: "var(--c-text)", opacity: status === "loading" ? 0.5 : 1,
          }}
        >
          <RefreshCw size={13} className={status === "loading" ? "spin" : ""} />
          重新整理
        </button>
      </div>

      {/* ── 指標卡 ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 24 }}>
        {[
          { label: "漲幅>5% 股數", value: stocks.length || "—", color: "var(--c-up)" },
          { label: "上市", value: stocks.filter(s => s.market === "上市").length || "—", color: "var(--c-text)" },
          { label: "上櫃", value: stocks.filter(s => s.market === "上櫃").length || "—", color: "var(--c-text)" },
          { label: "🔥 底部啟動", value: bottomCount || "—", color: "var(--c-amber)" },
          { label: "涵蓋產業", value: indEntries.length || "—", color: "var(--c-dn)" },
        ].map((m) => (
          <div key={m.label} style={{
            background: "var(--c-surface)", border: "1px solid var(--c-border)",
            borderRadius: 12, padding: "14px 16px",
          }}>
            <div style={{ fontSize: 12, color: "var(--c-muted)", marginBottom: 6 }}>{m.label}</div>
            <div style={{ fontSize: 24, fontWeight: 600, color: m.color }}>{m.value}</div>
          </div>
        ))}
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
            onClick={loadData}
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
          {/* 進度提示 */}
          {loadNote && (
            <div style={{ fontSize: 12, color: "var(--c-muted)", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
              <RefreshCw size={11} className="spin" />
              {loadNote}
            </div>
          )}

          {/* 圖例說明 */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--c-muted)" }}>
              當日漲幅超過 5% 個股
            </div>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: 11, padding: "2px 8px", borderRadius: 5,
              background: "rgba(245,158,11,0.12)", color: "var(--c-amber)",
            }}>
              <Flame size={11} />
              底部啟動：14日漲幅 &lt;5% 且 5日量能 &gt;100%
            </span>
            <span style={{ fontSize: 11, color: "var(--c-muted)" }}>點欄位標題可排序</span>
          </div>

          {/* 表格 */}
          <div style={{
            border: "1px solid var(--c-border)", borderRadius: 12,
            overflow: "hidden", marginBottom: 24,
          }}>
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr style={{ background: "var(--c-surface2)", borderBottom: "1px solid var(--c-border)" }}>
                    <SortTh label="代號" sk="code" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} style={{ width: 64 }} />
                    <SortTh label="股名" sk="name" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} style={{ width: 90 }} />
                    <th style={{ padding: "10px 12px", fontSize: 12, fontWeight: 500, color: "var(--c-muted)", whiteSpace: "nowrap", width: 52 }}>市場</th>
                    <SortTh label="股價" sk="price" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} style={{ width: 70 }} />
                    <SortTh label="今日漲幅" sk="chg" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} style={{ width: 80 }} />
                    <SortTh label="14日漲幅" sk="c14" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} style={{ width: 80 }} />
                    <SortTh label="量能(5日)" sk="vol5" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} style={{ width: 130 }} />
                    <SortTh label="量能(14日)" sk="vol14" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} style={{ width: 130 }} />
                    <SortTh label="股本(億)" sk="cap" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} style={{ width: 80 }} />
                    <SortTh label="產業" sk="ind" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
                    {onAddToWatchlist && (
                      <th style={{ padding: "10px 12px", fontSize: 12, fontWeight: 500, color: "var(--c-muted)", width: 60 }}>加入</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((s, i) => {
                    const bottom = isBottom(s);
                    return (
                      <tr
                        key={`${s.code}-${s.market}`}
                        style={{
                          borderTop: "1px solid var(--c-border)",
                          background: bottom
                            ? "rgba(245,158,11,0.05)"
                            : i % 2 === 0 ? "var(--c-surface)" : "transparent",
                        }}
                      >
                        {/* 代號 */}
                        <td style={{ padding: "9px 12px", fontWeight: 600, fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
                          {s.code}
                        </td>
                        {/* 股名 */}
                        <td style={{ padding: "9px 12px", fontSize: 13, whiteSpace: "nowrap" }}>
                          {s.name}
                          {bottom && (
                            <span style={{
                              marginLeft: 6, display: "inline-flex", alignItems: "center", gap: 3,
                              fontSize: 10, padding: "1px 6px", borderRadius: 4,
                              background: "rgba(245,158,11,0.15)", color: "var(--c-amber)",
                            }}>
                              <Flame size={9} /> 底部
                            </span>
                          )}
                        </td>
                        {/* 市場 */}
                        <td style={{ padding: "9px 12px" }}>
                          <span style={{
                            fontSize: 11, padding: "2px 7px", borderRadius: 4,
                            background: s.market === "上市" ? "rgba(96,165,250,0.15)" : "rgba(43,189,142,0.15)",
                            color: s.market === "上市" ? "var(--c-blue)" : "var(--c-dn)",
                          }}>
                            {s.market}
                          </span>
                        </td>
                        {/* 股價 */}
                        <td style={{ padding: "9px 12px", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
                          {s.price.toLocaleString()}
                        </td>
                        {/* 今日漲幅 */}
                        <td style={{ padding: "9px 12px", fontSize: 13, fontWeight: 600, color: "var(--c-up)", fontVariantNumeric: "tabular-nums" }}>
                          +{s.chg.toFixed(2)}%
                        </td>
                        {/* 14日漲幅 */}
                        <td style={{
                          padding: "9px 12px", fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums",
                          color: s.c14 === null ? "var(--c-muted)" : s.c14 >= 0 ? "var(--c-up)" : "var(--c-dn)",
                        }}>
                          {s.c14 === null ? "—" : `${s.c14 >= 0 ? "+" : ""}${s.c14}%`}
                        </td>
                        {/* 量能 5日 */}
                        <td style={{ padding: "9px 12px" }}><VolBar value={s.vol5} /></td>
                        {/* 量能 14日 */}
                        <td style={{ padding: "9px 12px" }}><VolBar value={s.vol14} /></td>
                        {/* 股本 */}
                        <td style={{ padding: "9px 12px", fontSize: 12, color: "var(--c-muted)", fontVariantNumeric: "tabular-nums" }}>
                          {s.cap !== null ? s.cap.toFixed(1) : "—"}
                        </td>
                        {/* 產業 */}
                        <td style={{ padding: "9px 12px" }}>
                          <span style={{
                            fontSize: 11, padding: "2px 8px", borderRadius: 4,
                            background: "var(--c-surface2)", color: "var(--c-muted)",
                            whiteSpace: "nowrap",
                          }}>
                            {s.ind}
                          </span>
                        </td>
                        {/* 加入觀察日誌 */}
                        {onAddToWatchlist && (
                          <td style={{ padding: "9px 12px", textAlign: "center" }}>
                            <button
                              onClick={() => handleAddToWatchlist(s)}
                              title="加入觀察日誌"
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

          {/* ── 產業卡片 ── */}
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--c-muted)", marginBottom: 10 }}>
            今日強勢股產業分布
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
            gap: 8, marginBottom: 24,
          }}>
            {indEntries.map(([ind, cnt]) => (
              <div key={ind} style={{
                background: "var(--c-surface)", border: "1px solid var(--c-border)",
                borderRadius: 10, padding: "10px 12px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 13 }}>{ind}</span>
                  <span style={{ fontSize: 20, fontWeight: 600, color: "var(--c-up)" }}>{cnt}</span>
                </div>
                <div style={{ height: 3, borderRadius: 2, background: "var(--c-surface2)" }}>
                  <div style={{
                    height: 3, borderRadius: 2, background: "var(--c-up)",
                    width: `${(cnt / maxInd) * 100}%`,
                  }} />
                </div>
              </div>
            ))}
          </div>

          {/* ── 長條圖 ── */}
          <div style={{
            background: "var(--c-surface)", border: "1px solid var(--c-border)",
            borderRadius: 12, padding: "20px 20px 16px", marginBottom: 16,
          }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--c-muted)", marginBottom: 16 }}>
              產業分布（前 12 名）
            </div>
            <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 36)}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 28, top: 0, bottom: 0 }}>
                <XAxis type="number" tick={{ fill: "#6b7394", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: "#9ca3b0", fontSize: 12 }} axisLine={false} tickLine={false} width={82} />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.03)" }}
                  contentStyle={{
                    background: "#1c2030", border: "1px solid #252a3a",
                    borderRadius: 8, color: "#e4e8f0", fontSize: 12,
                  }}
                  formatter={(v: number) => [`${v} 支`, "股數"]}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={18}>
                  {chartData.map((_, idx) => (
                    <Cell key={idx} fill={`rgba(240,92,92,${Math.max(0.4, 1 - idx * 0.055)})`} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* 備注 */}
          <div style={{ fontSize: 11, color: "var(--c-muted)", lineHeight: 1.9 }}>
            * 資料來源：台灣證交所（TWSE）、櫃買中心（TPEx）官方盤後 API，盤後約 15:30 更新。<br />
            * 量能變化 = 近N日均量 ÷ 前N日均量 − 1，正值代表量能放大，負值代表萎縮。<br />
            * 底部啟動條件：14日漲幅 &lt;5% 且 5日量能變化 &gt;100%（資金突然湧入、股價尚在低位）。<br />
            * 上市歷史資料使用 TWSE；上櫃歷史資料使用 Yahoo Finance 補齊，若資料源暫時缺值才會顯示「—」。
          </div>
        </>
      )}
    </div>
  );
}
