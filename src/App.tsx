import React, { useEffect, useState } from 'react';
import { 
  Search, 
  TrendingUp, 
  TrendingDown, 
  CheckCircle2, 
  XCircle, 
  Info,
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
  BookmarkPlus,
  Trash2,
  Download,
  History,
  LayoutDashboard,
  Flame,
  Menu,
  X
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
  ReferenceArea
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import StockSurge from './lib/StockSurge';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface RangeBox {
  isBoxRange: boolean;
  breakdown: boolean;
  quality: 'standard' | 'wide' | null;
  lookbackDays: number;
  upper: number | null;
  lower: number | null;
  widthPct: number | null;
  currentPositionPct: number | null;
  status: string;
  action: string;
}

interface StockData {
  symbol: string;
  shortName: string;
  marketType: string;
  currency: string;
  currentPrice: number;
  ma50: number;
  ma150: number;
  ma200: number;
  ma50Extension: string;
  extensionFrom50MA: string;
  isVolumeContracted: boolean;
  isMomentumStock: boolean;
  localPivot: number;
  vcpHigh: number | null;
  isExtended: boolean;
  isLocalPivotExtended: boolean;
  vcpStatus: string;
  baseDays: number;
  baseType: string;
  baseLabel: string;
  rangeBox: RangeBox;
  pivotPrice: number;
  buyZoneMax: number;
  suggestedStopLoss: number;
  priceGap: number;
  distanceFromPivot: string;
  high52w: number;
  low52w: number;
  distFromHigh: string;
  distFromLow: string;
  conditions: {
    priceAboveMAs: boolean;
    ma150Above200: boolean;
    ma200Trending: boolean;
    ma50AboveOthers: boolean;
    priceAbove50MA: boolean;
    aboveLow30: boolean;
    nearHigh25: boolean;
  };
  fundamentalStatus: string;
  isTemplateMet: boolean;
  hasEnoughDataFor200: boolean;
  reasons: string[];
  epsForward: number | null;
  epsGrowth: string | null;
  trailingEps: number | null;
  trailingPE: number | null;
  trailingPESource: 'TWSE' | 'TPEX' | 'Yahoo' | null;
  recentEpsGrowth: string | null;
  chartData: any[];
}

interface WatchlistItem {
  id: string;
  date: string;
  source?: 'analysis' | 'surge';
  symbol: string;
  shortName: string;
  price: number;
  currency: string;
  market?: string;
  industry?: string;
  todayChange?: number | null;
  c14?: number | null;
  vol5?: number | null;
  vol14?: number | null;
  amount?: number | null;
  surgeMode?: string;
  attention?: boolean;
  disposition?: boolean;
  flagReason?: string;
  flagPeriod?: string;
  pivotPrice: number;
  suggestedStopLoss: number;
  ma50Extension: string;
  extensionText: string;
  failedConditions: string[];
}

type AppTab = 'analysis' | 'watchlist' | 'surge';

export default function App() {
  const [symbol, setSymbol] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<StockData | null>(null);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<AppTab>('analysis');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [valuationInputs, setValuationInputs] = useState({
    eps2027: '',
    fairPe: '',
  });
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>(() => {
    const saved = localStorage.getItem('trendpulse_watchlist');
    return saved ? JSON.parse(saved) : [];
  });

  const switchTab = (tab: AppTab) => {
    setActiveTab(tab);
    setMobileNavOpen(false);
  };

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileNavOpen]);

  useEffect(() => {
    document.body.style.overflow = mobileNavOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileNavOpen]);

  const updateValuationInput = (key: keyof typeof valuationInputs, value: string) => {
    setValuationInputs(prev => ({ ...prev, [key]: value }));
  };

  const saveWatchlist = (items: WatchlistItem[]) => {
    setWatchlist(items);
    localStorage.setItem('trendpulse_watchlist', JSON.stringify(items));
  };

  const saveUniqueWatchlistItem = (item: WatchlistItem) => {
    const exists = watchlist.some((w) => w.symbol === item.symbol);
    saveWatchlist(exists ? watchlist : [item, ...watchlist]);
  };

  const addToWatchlist = (item?: WatchlistItem) => {
    if (item) {
      saveUniqueWatchlistItem(item);
      return;
    }

    if (!data) return;

    const failed = Object.entries(data.conditions)
      .filter(([_, met]) => !met)
      .map(([key]) => {
        const labels: Record<string, string> = {
          priceAboveMAs: "價格未在 150/200MA 之上",
          ma150Above200: "150MA 未在 200MA 之上",
          ma200Trending: "200MA 未向上趨勢",
          ma50AboveOthers: "50MA 未在 150/200MA 之上",
          priceAbove50MA: "價格未在 50MA 之上",
          aboveLow30: "未高於 52W 低點 30%",
          nearHigh25: "未在 52W 高點 25% 以內"
        };
        return labels[key] || key;
      });

    const newItem: WatchlistItem = {
      id: Date.now().toString(),
      date: new Date().toLocaleString('zh-TW', { hour12: false }),
      source: 'analysis',
      symbol: data.symbol,
      shortName: data.shortName,
      price: data.currentPrice,
      currency: data.currency,
      pivotPrice: data.pivotPrice,
      suggestedStopLoss: data.suggestedStopLoss,
      ma50Extension: data.ma50Extension,
      extensionText: getExtensionAlert(parseFloat(data.ma50Extension)).text,
      failedConditions: failed
    };

    saveUniqueWatchlistItem(newItem);
  };

  const removeFromWatchlist = (id: string) => {
    saveWatchlist(watchlist.filter(item => item.id !== id));
  };

  const reAnalyze = (ticker: string) => {
    setSymbol(ticker);
    switchTab('analysis');
    void handleSearch(undefined, ticker);
  };

  const exportToCSV = () => {
    if (watchlist.length === 0) return;
    
    const headers = ["紀錄時間", "來源", "代號", "名稱", "當前價格", "市場/產業", "強勢資訊", "成交金額", "風險標籤", "突破買點", "建議停損", "50MA 乖離率", "警示文字", "未通過條件"];
    const rows = watchlist.map(item => [
      item.date,
      item.source === 'surge' ? `每日強勢股${item.surgeMode ? `-${item.surgeMode}` : ''}` : '趨勢分析',
      item.symbol,
      item.shortName,
      `${item.currency} ${item.price}`,
      item.source === 'surge' ? `${item.market ?? '-'} / ${item.industry ?? '-'}` : '-',
      item.source === 'surge'
        ? `今日 ${formatPct(item.todayChange)}; 14日 ${formatPct(item.c14)}; 5日量 ${formatPct(item.vol5)}; 14日量 ${formatPct(item.vol14)}`
        : '-',
      item.source === 'surge' ? formatAmount(item.amount) : '-',
      item.source === 'surge'
        ? [
            item.disposition ? '處置' : '',
            item.attention ? '注意' : '',
            item.flagPeriod ? `期間 ${item.flagPeriod}` : ''
          ].filter(Boolean).join('; ') || '-'
        : '-',
      item.pivotPrice > 0 ? `${item.currency} ${item.pivotPrice.toFixed(2)}` : "尚未形成平台",
      item.suggestedStopLoss > 0 ? `${item.currency} ${item.suggestedStopLoss.toFixed(2)}` : "-",
      `${item.ma50Extension}%`,
      item.extensionText,
      (item.failedConditions ?? []).join('; ')
    ]);

    const csvContent = [headers, ...rows]
      .map(e => e.map(cell => `"${cell}"`).join(","))
      .join("\n");

    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `觀察日誌_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSearch = async (e?: React.FormEvent, overrideSymbol?: string) => {
    if (e) e.preventDefault();
    const query = (overrideSymbol ?? symbol).trim();
    if (!query) return;
    if (overrideSymbol) setSymbol(overrideSymbol);

    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/stock?ticker=${encodeURIComponent(query)}`);
      const contentType = response.headers.get("content-type");
      
      if (!response.ok) {
        const text = await response.text();
        let errorMessage = '查詢失敗';
        try {
          const json = JSON.parse(text);
          errorMessage = json.error || errorMessage;
          if (json.details) {
            errorMessage += `\n詳情: ${json.details}`;
          }
        } catch (e) {
          errorMessage = `伺服器錯誤 (${response.status}): ${text.substring(0, 50)}...`;
        }
        throw new Error(errorMessage);
      }

      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        throw new Error(`非預期的回應格式: ${text.substring(0, 50)}...`);
      }
      
      const result = await response.json();
      setData(result);
    } catch (err: any) {
      setError(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  // Helper to get range bar color
  const getRangeBarColor = (current: number, low: number, high: number) => {
    const percent = ((current - low) / (high - low)) * 100;
    if (percent > 75) return "bg-emerald-500";
    if (percent >= 50) return "bg-blue-500";
    return "bg-slate-400";
  };

  // Helper to get pivot message
  const getPivotMessage = (dist: number, pivotPrice: number) => {
    if (pivotPrice === 0) return { text: "尚未形成新平台 (起漲噴發中)", color: "text-amber-600 bg-amber-50" };
    if (dist > 10) return { text: "已遠離樞紐點，風險過高，請勿追價", color: "text-rose-600 bg-rose-50" };
    if (dist >= 0 && dist <= 2) return { text: "🚀 樞紐點突破，符合進場區！", color: "text-emerald-600 bg-emerald-50" };
    if (dist < 0 && dist >= -3) return { text: "靠近樞紐點，觀察放量突破", color: "text-blue-600 bg-blue-50" };
    if (dist > 5) return { text: "⚠️ 已過度伸展，請勿追高", color: "text-rose-600 bg-rose-50" };
    if (dist < -5) return { text: "目前處於整理區，距離突破點尚有段距離", color: "text-slate-500 bg-slate-50" };
    return null;
  };

  // Helper to get extension alert
  const getExtensionAlert = (ext: number) => {
    if (ext < 15) return { 
      text: "✅ 股價位階健康", 
      color: "text-emerald-700", 
      bg: "bg-emerald-50 border-emerald-100" 
    };
    if (ext >= 15 && ext <= 25) return { 
      text: "⚠️ 股價已過度伸展，請謹慎追高", 
      color: "text-amber-700", 
      bg: "bg-amber-50 border-amber-100" 
    };
    return { 
      text: "🚨 過熱", 
      color: "text-rose-700", 
      bg: "bg-rose-50 border-rose-100 animate-pulse" 
    };
  };

  const formatPct = (value?: number | null) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return "-";
    return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
  };

  const formatAmount = (value?: number | null) => {
    if (value === null || value === undefined || value <= 0 || !Number.isFinite(value)) return "-";
    if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}億`;
    return `${Math.round(value / 10_000).toLocaleString()}萬`;
  };

  const parseInputNumber = (value: string) => {
    const cleaned = value.replace(/,/g, '').trim();
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  };

  const formatValue = (value: number | null | undefined, digits = 2) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    return value.toFixed(digits);
  };

  const formatTargetPrice = (value: number | null | undefined, currency = 'NT$') => {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    return `${currency} ${value.toFixed(2)}`;
  };

  const getValuation = (stock: StockData) => {
    const manualEps = parseInputNumber(valuationInputs.eps2027);
    const manualPe = parseInputNumber(valuationInputs.fairPe);
    const autoEps = stock.epsForward ?? stock.trailingEps;
    const scenarioEps = manualEps ?? autoEps;
    const forwardGrowthRatio = stock.epsForward != null
      && stock.trailingEps != null
      && stock.trailingEps > 0
      ? stock.epsForward / stock.trailingEps
      : null;
    const lowBasePeMismatch = stock.trailingPE != null && forwardGrowthRatio != null && (
      (forwardGrowthRatio >= 1.5 && stock.trailingPE > 50)
      || (forwardGrowthRatio >= 2 && stock.trailingPE > 35)
    );
    const autoPeTooHigh = stock.trailingPE != null && (
      stock.trailingPE > 100 || lowBasePeMismatch
    );
    const trailingPeSourceLabel = stock.trailingPESource === 'TWSE'
      ? "TWSE 官方本益比換算"
      : stock.trailingPESource === 'TPEX'
        ? "櫃買中心官方本益比換算"
        : stock.trailingPESource === 'Yahoo'
          ? "Yahoo trailing PE"
          : "目前 trailing PE";
    const referencePe = manualPe ?? (
      stock.trailingPE != null && !autoPeTooHigh
        ? stock.trailingPE
        : 35
    );

    const epsSource = manualEps !== null
      ? "手動 2027E EPS"
      : stock.epsForward != null
        ? "Yahoo Forward EPS"
        : stock.trailingEps != null
          ? "近 12 個月 EPS"
          : "尚無 EPS 資料";
    const peSource = manualPe !== null
      ? "手動合理 PE"
      : autoPeTooHigh
        ? lowBasePeMismatch && stock.trailingPE != null
          ? `目前 PE ${stock.trailingPE.toFixed(1)}x 是低 EPS 基期，避免與高成長 EPS 混用，改用預設 35x`
          : `目前 PE ${stock.trailingPE?.toFixed(1)}x 過高，改用預設 35x`
        : stock.trailingPE != null
          ? trailingPeSourceLabel
          : "預設 35x";

    const conservativeTarget = scenarioEps !== null ? scenarioEps * referencePe * 0.85 : null;
    const fairTarget = scenarioEps !== null ? scenarioEps * referencePe : null;
    const optimisticTarget = scenarioEps !== null ? scenarioEps * referencePe * 1.15 : null;
    const currentScenarioPe = scenarioEps !== null && scenarioEps > 0
      ? stock.currentPrice / scenarioEps
      : null;
    const fairUpside = fairTarget !== null && stock.currentPrice > 0
      ? ((fairTarget - stock.currentPrice) / stock.currentPrice) * 100
      : null;
    const optimisticUpside = optimisticTarget !== null && stock.currentPrice > 0
      ? ((optimisticTarget - stock.currentPrice) / stock.currentPrice) * 100
      : null;

    return {
      scenarioEps,
      epsSource,
      referencePe,
      peSource,
      conservativeTarget,
      fairTarget,
      optimisticTarget,
      currentScenarioPe,
      fairUpside,
      optimisticUpside,
    };
  };

  const isSurgeItem = (item: WatchlistItem) => item.source === 'surge';

  const renderWatchlistSetup = (item: WatchlistItem) => {
    if (isSurgeItem(item)) {
      return (
        <div className="space-y-1">
          <div className="text-sm font-bold text-rose-600">今日 {formatPct(item.todayChange)}</div>
          <div className="text-[11px] text-slate-500">14日 {formatPct(item.c14)}</div>
          <div className="text-[11px] text-slate-500">成交 {formatAmount(item.amount)}</div>
        </div>
      );
    }

    return (
      <span className="text-sm font-bold text-slate-900">
        {item.pivotPrice > 0 ? `${item.currency} ${item.pivotPrice.toFixed(2)}` : "-"}
      </span>
    );
  };

  const renderWatchlistRisk = (item: WatchlistItem) => {
    if (isSurgeItem(item)) {
      if (item.disposition) return <span className="rounded bg-rose-50 px-2 py-1 text-xs font-bold text-rose-600">處置</span>;
      if (item.attention) return <span className="rounded bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">注意</span>;
      if (item.surgeMode?.includes("過熱")) return <span className="rounded bg-rose-50 px-2 py-1 text-xs font-bold text-rose-600">不追高</span>;
      return <span className="text-xs font-medium text-slate-400">一般</span>;
    }

    return (
      <span className="text-sm font-bold text-rose-600">
        {item.suggestedStopLoss > 0 ? `${item.currency} ${item.suggestedStopLoss.toFixed(2)}` : "-"}
      </span>
    );
  };

  const renderWatchlistSignal = (item: WatchlistItem) => {
    if (isSurgeItem(item)) {
      return (
        <div className="space-y-1">
          {item.surgeMode && (
            <span className="inline-flex rounded bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">{item.surgeMode}</span>
          )}
          <div className="text-[11px] font-semibold text-rose-600">今日 {formatPct(item.todayChange)}</div>
        </div>
      );
    }

    const ext = parseFloat(item.ma50Extension);
    return <span className={cn("text-xs font-bold", getExtensionAlert(ext).color)}>{item.extensionText}</span>;
  };

  const renderWatchlistConditions = (item: WatchlistItem) => {
    if (isSurgeItem(item)) {
      return (
        <div className="flex flex-wrap gap-1">
          {item.disposition && (
            <span className="text-[10px] bg-rose-50 text-rose-600 px-2 py-0.5 rounded font-bold">
              處置
            </span>
          )}
          {!item.disposition && item.attention && (
            <span className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded font-bold">
              注意
            </span>
          )}
          <span className="text-[10px] bg-rose-50 text-rose-600 px-2 py-0.5 rounded font-medium">
            漲幅 {formatPct(item.todayChange)}
          </span>
          <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-medium">
            成交 {formatAmount(item.amount)}
          </span>
          {item.c14 !== null && item.c14 !== undefined && (
            <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-medium">
              14日 {formatPct(item.c14)}
            </span>
          )}
          {item.vol5 !== null && item.vol5 !== undefined && (
            <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-medium">
              5日量 {formatPct(item.vol5)}
            </span>
          )}
        </div>
      );
    }

    const failedConditions = item.failedConditions ?? [];

    return failedConditions.length === 0 ? (
      <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">全數通過 ✓</span>
    ) : (
      <div className="flex flex-wrap gap-1">
        {failedConditions.map((c, i) => (
          <span key={i} className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-medium">
            {c}
          </span>
        ))}
      </div>
    );
  };


  const tabMeta: Record<AppTab, { label: string; short: string }> = {
    analysis: { label: '趨勢分析', short: '分析' },
    watchlist: { label: '觀察日誌', short: '日誌' },
    surge: { label: '每日強勢股', short: '強勢' },
  };

  const renderWatchlistActions = (item: WatchlistItem) => (
    <div className="flex items-center justify-end gap-1">
      <button
        onClick={() => reAnalyze(item.symbol)}
        className="rounded-lg p-2 text-blue-400 transition-colors hover:bg-blue-50 hover:text-blue-600"
        title="重新查詢"
      >
        <Search className="h-4 w-4" />
      </button>
      <button
        onClick={() => removeFromWatchlist(item.id)}
        className="rounded-lg p-2 text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-500"
        title="刪除"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );

  const renderWatchlistCards = (highlightSymbol?: string) => (
    <div className="space-y-3 md:hidden">
      {watchlist.map((item) => (
        <div
          key={item.id}
          className={cn(
            "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm",
            highlightSymbol && item.symbol === highlightSymbol && "border-blue-200 bg-blue-50/50"
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-base font-bold text-slate-900">{item.shortName}</div>
              <div className="mt-0.5 text-xs text-slate-400">{item.symbol} · {item.date}</div>
            </div>
            {renderWatchlistActions(item)}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">加入價格</div>
              <div className="mt-1 text-sm font-semibold text-slate-800">{item.currency} {item.price}</div>
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">風險</div>
              <div className="mt-1">{renderWatchlistRisk(item)}</div>
            </div>
            <div className="col-span-2">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">目前訊號</div>
              <div className="mt-1">{renderWatchlistSignal(item)}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  const renderWatchlistTable = (highlightSymbol?: string) => (
    <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:block">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="px-4 py-3 text-[12px] font-bold uppercase tracking-wider text-slate-500 lg:px-6 lg:py-4">股票</th>
              <th className="px-4 py-3 text-[12px] font-bold uppercase tracking-wider text-slate-500 lg:px-6 lg:py-4">加入日期</th>
              <th className="px-4 py-3 text-[12px] font-bold uppercase tracking-wider text-slate-500 lg:px-6 lg:py-4">加入價格</th>
              <th className="px-4 py-3 text-[12px] font-bold uppercase tracking-wider text-slate-500 lg:px-6 lg:py-4">目前訊號</th>
              <th className="px-4 py-3 text-[12px] font-bold uppercase tracking-wider text-slate-500 lg:px-6 lg:py-4">風險</th>
              <th className="px-4 py-3 text-right text-[12px] font-bold uppercase tracking-wider text-slate-500 lg:px-6 lg:py-4">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {watchlist.map((item) => (
              <tr
                key={item.id}
                className={cn(
                  "transition-colors hover:bg-slate-50",
                  highlightSymbol && item.symbol === highlightSymbol && "bg-blue-50/60"
                )}
              >
                <td className="px-4 py-3 lg:px-6 lg:py-4">
                  <div className="font-bold text-slate-900">{item.shortName}</div>
                  <div className="text-xs text-slate-400">{item.symbol}</div>
                </td>
                <td className="px-4 py-3 text-xs font-medium text-slate-500 lg:px-6 lg:py-4">{item.date}</td>
                <td className="px-4 py-3 text-sm font-medium text-slate-700 lg:px-6 lg:py-4">{item.currency} {item.price}</td>
                <td className="px-4 py-3 lg:px-6 lg:py-4">{renderWatchlistSignal(item)}</td>
                <td className="px-4 py-3 lg:px-6 lg:py-4">{renderWatchlistRisk(item)}</td>
                <td className="px-4 py-3 text-right lg:px-6 lg:py-4">{renderWatchlistActions(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const templateChecklist = (
    <div className="space-y-4">
      {data ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[12px] font-bold uppercase tracking-wider text-[#64748b]">趨勢模板檢查</h2>
            <div className={cn(
              "rounded px-2 py-0.5 text-[10px] font-bold",
              data.isTemplateMet ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"
            )}>
              {data.isTemplateMet ? "符合" : "待達標"}
            </div>
          </div>
          <div className="space-y-2">
            {Object.entries(data.conditions).map(([key, met]) => {
              const labels: Record<string, string> = {
                priceAboveMAs: "價格 > 150/200MA",
                ma150Above200: "150MA > 200MA",
                ma200Trending: "200MA 向上趨勢",
                ma50AboveOthers: "50MA > 150/200MA",
                priceAbove50MA: "價格 > 50MA",
                aboveLow30: "距離 52W 低點 > 30%",
                nearHigh25: "距離 52W 高點 < 25%"
              };
              return (
                <div key={key} className="flex items-center justify-between gap-3 text-[11px]">
                  <span className={cn("font-medium", met ? "text-slate-600" : "text-slate-400")}>
                    {labels[key] || key}
                  </span>
                  {met ? (
                    <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
                  ) : (
                    <XCircle className="h-3 w-3 shrink-0 text-rose-300" />
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="space-y-2 text-[11px] leading-relaxed text-[#94a3b8]">
          <p className="font-bold uppercase tracking-tight">趨勢模板標準</p>
          <ol className="list-inside list-decimal space-y-1">
            <li>Price &gt; 150 &amp; 200 MA</li>
            <li>150 MA &gt; 200 MA</li>
            <li>200 MA trending up</li>
            <li>50 MA &gt; 150 &amp; 200 MA</li>
            <li>Price &gt; 50 MA</li>
            <li>Price &gt; 52W Low +30%</li>
            <li>Price within 25% of 52W High</li>
          </ol>
        </div>
      )}
    </div>
  );

  const analysisSearchForm = (
    <form onSubmit={handleSearch} className="space-y-3">
      <div className="space-y-2">
        <label className="text-[13px] font-medium text-[#475569]">股票代碼</label>
        <input
          type="text"
          inputMode="search"
          enterKeyHint="search"
          autoCapitalize="characters"
          autoCorrect="off"
          placeholder="e.g. 2330 or NVDA"
          className="sleek-input"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="sleek-btn flex w-full items-center justify-center gap-2"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : '開始分析'}
      </button>
    </form>
  );

  return (
    <div className="min-h-screen bg-[#f1f5f9]">
      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#2563eb]">
              <TrendingUp className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-bold tracking-tight text-[#0f172a]">TrendPulse TW</div>
              <div className="text-[11px] font-medium text-slate-400">{tabMeta[activeTab].label}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="rounded-xl border border-slate-200 p-2 text-slate-600"
            aria-label="開啟選單"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>

        {activeTab === 'analysis' && (
          <form
            onSubmit={handleSearch}
            className="mt-3 flex items-center gap-2"
          >
            <input
              type="text"
              inputMode="search"
              enterKeyHint="search"
              autoCapitalize="characters"
              autoCorrect="off"
              placeholder="輸入股票代碼"
              className="sleek-input min-w-0 flex-1"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
            />
            <button
              type="submit"
              disabled={loading}
              className="sleek-btn shrink-0 px-3"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </button>
          </form>
        )}
      </header>

      {/* Mobile drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40"
            aria-label="關閉選單"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-[min(86vw,320px)] flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-4">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-sm bg-[#2563eb]">
                  <TrendingUp className="h-4 w-4 text-white" />
                </div>
                <h1 className="text-base font-bold tracking-tight text-[#0f172a]">TrendPulse TW</h1>
              </div>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="rounded-lg p-2 text-slate-500"
                aria-label="關閉"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto p-4">
              <div className="space-y-2">
                <h2 className="text-[12px] font-semibold uppercase tracking-wider text-[#64748b]">導覽</h2>
                <nav className="space-y-1">
                  <button
                    onClick={() => switchTab('analysis')}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      activeTab === 'analysis' ? "bg-blue-50 text-blue-600" : "text-slate-600 hover:bg-slate-50"
                    )}
                  >
                    <LayoutDashboard className="h-4 w-4" />
                    趨勢分析
                  </button>
                  <button
                    onClick={() => switchTab('watchlist')}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      activeTab === 'watchlist' ? "bg-blue-50 text-blue-600" : "text-slate-600 hover:bg-slate-50"
                    )}
                  >
                    <History className="h-4 w-4" />
                    觀察日誌
                    {watchlist.length > 0 && (
                      <span className="ml-auto rounded-full bg-blue-100 px-2 py-0.5 text-[10px] text-blue-600">
                        {watchlist.length}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => switchTab('surge')}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      activeTab === 'surge' ? "bg-rose-50 text-rose-500" : "text-slate-600 hover:bg-slate-50"
                    )}
                  >
                    <Flame className="h-4 w-4" />
                    每日強勢股
                  </button>
                </nav>
              </div>

              {activeTab === 'analysis' && (
                <div className="space-y-3">
                  <h2 className="text-[12px] font-semibold uppercase tracking-wider text-[#64748b]">參數設定</h2>
                  {analysisSearchForm}
                </div>
              )}

              <div className="border-t border-slate-100 pt-4">
                {templateChecklist}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[280px] shrink-0 flex-col gap-6 border-r border-[#e2e8f0] bg-white p-6 md:flex">
        <div className="mb-2 flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-sm bg-[#2563eb]">
            <TrendingUp className="h-4 w-4 text-white" />
          </div>
          <h1 className="text-lg font-bold tracking-tight text-[#0f172a]">TrendPulse TW</h1>
        </div>

        <div className="space-y-4">
          <h2 className="text-[14px] font-semibold uppercase tracking-wider text-[#64748b]">導覽</h2>
          <nav className="space-y-1">
            <button
              onClick={() => switchTab('analysis')}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                activeTab === 'analysis' ? "bg-blue-50 text-blue-600" : "text-slate-600 hover:bg-slate-50"
              )}
            >
              <LayoutDashboard className="h-4 w-4" />
              趨勢分析
            </button>
            <button
              onClick={() => switchTab('watchlist')}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                activeTab === 'watchlist' ? "bg-blue-50 text-blue-600" : "text-slate-600 hover:bg-slate-50"
              )}
            >
              <History className="h-4 w-4" />
              觀察日誌
              {watchlist.length > 0 && (
                <span className="ml-auto rounded-full bg-blue-100 px-2 py-0.5 text-[10px] text-blue-600">
                  {watchlist.length}
                </span>
              )}
            </button>
            <button
              onClick={() => switchTab('surge')}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                activeTab === 'surge' ? "bg-rose-50 text-rose-500" : "text-slate-600 hover:bg-slate-50"
              )}
            >
              <Flame className="h-4 w-4" />
              每日強勢股
            </button>
          </nav>
        </div>

        {activeTab === 'analysis' && (
          <div className="space-y-4">
            <h2 className="text-[14px] font-semibold uppercase tracking-wider text-[#64748b]">參數設定</h2>
            {analysisSearchForm}
          </div>
        )}

        <div className="mt-auto overflow-y-auto border-t border-slate-100 pt-6">
          {templateChecklist}
        </div>
      </aside>

      {/* Main Content */}
      <main className="min-w-0 md:ml-[280px]">
        <div className="pb-[calc(4.75rem+env(safe-area-inset-bottom))] md:pb-0">
        <AnimatePresence mode="wait">
          {activeTab === 'surge' ? (
            <motion.div key="surge" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <StockSurge onAddToWatchlist={addToWatchlist} />
            </motion.div>
          ) : activeTab === 'watchlist' ? (
            <motion.div
              key="watchlist"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-6 p-4 sm:p-6 md:p-8"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-[#0f172a]">觀察日誌</h2>
                  <p className="mt-1 text-sm text-slate-500">記錄您感興趣的股票及其當時的分析狀態</p>
                </div>
                {watchlist.length > 0 && (
                  <button
                    onClick={exportToCSV}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    <Download className="h-4 w-4" />
                    匯出 CSV
                  </button>
                )}
              </div>

              {watchlist.length === 0 ? (
                <div className="flex flex-col items-center rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center sm:p-20">
                  <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-50">
                    <History className="h-8 w-8 text-slate-300" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900">目前尚無紀錄</h3>
                  <p className="mt-2 max-w-xs text-slate-500">
                    可以從分析結果或每日強勢股點擊「加入」收藏，之後在這裡追蹤。
                  </p>
                </div>
              ) : (
                <>
                  {renderWatchlistCards()}
                  {renderWatchlistTable()}
                </>
              )}
            </motion.div>
          ) : (
            <motion.div key="analysis_view" className="space-y-6 p-4 sm:p-6 md:p-8">
              {!data && !loading && (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex h-full flex-col items-center justify-center px-2 py-16 text-center sm:py-20"
                >
                  <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50">
                    <Search className="h-8 w-8 text-blue-600" />
                  </div>
                  <h2 className="mb-3 text-2xl font-extrabold text-[#0f172a] sm:text-3xl">準備好發掘強勢股了嗎？</h2>
                  <p className="max-w-md text-sm text-[#64748b] sm:text-base">
                    在上方或左側輸入台股代碼或美股代號，我們將根據 Minervini 的第二階段趨勢模板為您進行深度分析。
                  </p>
                </motion.div>
              )}

              {loading && (
                <div className="h-full flex flex-col items-center justify-center py-32">
                  <Loader2 className="w-10 h-10 text-blue-600 animate-spin mb-4" />
                  <p className="text-slate-500 font-medium">正在分析市場數據...</p>
                </div>
              )}

              {error && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="max-w-md mx-auto p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3 text-red-700"
                >
                  <XCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <p className="text-sm font-medium whitespace-pre-wrap">{error}</p>
                </motion.div>
              )}

              {data && !loading && (
                <motion.div
                  key="content"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col gap-6"
                >
                  {/* Header Card */}
                  <div className="sleek-card order-1 flex flex-col gap-4 sm:gap-6 md:flex-row md:items-end md:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="text-[13px] font-medium uppercase tracking-wider text-[#64748b] sm:text-[14px]">{data.symbol}</div>
                      <h2 className="break-words text-2xl font-extrabold text-[#0f172a] sm:text-3xl">{data.shortName}</h2>
                      <div className="mt-2 flex items-start gap-2">
                        <Info className={cn("mt-0.5 h-4 w-4 shrink-0", data.isTemplateMet ? "text-emerald-500" : "text-amber-500")} />
                        <span className={cn("text-sm font-medium leading-5", data.isTemplateMet ? "text-emerald-600" : "text-amber-600")}>
                          {data.fundamentalStatus}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-end justify-between gap-4 sm:block sm:space-y-3 sm:text-right">
                      <div className="text-left sm:text-right">
                        <span className="mb-1 block text-xs font-medium text-slate-400">收盤價</span>
                        <div className="text-2xl font-bold text-[#0f172a] sm:text-3xl">
                          {data.currency} {data.currentPrice?.toFixed(2) ?? '-'}
                        </div>
                      </div>
                      <button
                        onClick={() => addToWatchlist()}
                        className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                      >
                        <BookmarkPlus className="h-4 w-4" />
                        觀察
                      </button>
                    </div>
                  </div>

                  {/* MA、Pivot 與箱型合併，避免同一價格重複出現 */}
                  <div className="sleek-card order-2">
                    <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-[13px] font-bold uppercase tracking-wider text-[#64748b]">關鍵位置</h3>
                        <p className="mt-1 text-xs text-slate-500">先判斷能不能追，再看突破與防守位置。</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {data.isVolumeContracted && <span className="rounded border border-blue-100 bg-blue-50 px-2 py-1 text-[11px] font-bold text-blue-600">量縮中</span>}
                        <span className={cn("rounded border px-2 py-1 text-[11px] font-bold", getExtensionAlert(parseFloat(data.ma50Extension)).bg, getExtensionAlert(parseFloat(data.ma50Extension)).color)}>
                          50MA乖離 {data.ma50Extension}%
                        </span>
                      </div>
                    </div>

                    <div className={cn("mt-4 grid gap-3", data.rangeBox?.isBoxRange ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" : "grid-cols-1 sm:grid-cols-3")}>
                      <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                        <div className="text-[11px] font-bold text-slate-500">突破價</div>
                        <div className="mt-1 break-all text-base font-black text-blue-700 sm:text-lg">{data.pivotPrice > 0 ? formatTargetPrice(data.pivotPrice, data.currency) : "—"}</div>
                      </div>
                      <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                        <div className="text-[11px] font-bold text-slate-500">進場上限</div>
                        <div className="mt-1 break-all text-base font-black text-emerald-700 sm:text-lg">{data.pivotPrice > 0 && !data.isExtended ? formatTargetPrice(data.buyZoneMax, data.currency) : "—"}</div>
                      </div>
                      <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                        <div className="text-[11px] font-bold text-slate-500">停損參考</div>
                        <div className="mt-1 break-all text-base font-black text-rose-700 sm:text-lg">{data.pivotPrice > 0 && (!data.isExtended || data.isMomentumStock) ? formatTargetPrice(data.suggestedStopLoss, data.currency) : "—"}</div>
                      </div>
                      {data.rangeBox?.isBoxRange && <>
                        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                          <div className="text-[11px] font-bold text-slate-500">箱底</div>
                          <div className="mt-1 break-all text-base font-black text-emerald-700 sm:text-lg">{formatTargetPrice(data.rangeBox.lower, data.currency)}</div>
                        </div>
                        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                          <div className="text-[11px] font-bold text-slate-500">箱頂</div>
                          <div className="mt-1 break-all text-base font-black text-amber-700 sm:text-lg">{formatTargetPrice(data.rangeBox.upper, data.currency)}</div>
                        </div>
                      </>}
                    </div>

                    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700">
                      {data.isExtended && !data.isMomentumStock
                        ? "目前乖離偏高，先等回測，不追價。"
                        : data.rangeBox?.isBoxRange
                          ? data.rangeBox.action
                          : data.pivotPrice > 0
                            ? "觀察突破是否站穩；未突破前不預設已轉強。"
                            : "尚未形成明確平台，先觀察。"}
                    </div>
                  </div>

                  {/* 2027 情境估值 */}
                  {(() => {
                    const valuation = getValuation(data);
                    const pureCode = data.symbol.split('.')[0];
                    const links = [
                      {
                        label: "法人本益比",
                        href: `https://www.cmoney.tw/finance/${pureCode}/f00032`,
                      },
                      {
                        label: "產業本益比",
                        href: `http://jsjustweb.jihsun.com.tw/z/zc/zca/zca_${pureCode}.djhtm`,
                      },
                      {
                        label: "HiStock 財報",
                        href: `https://histock.tw/stock/${pureCode}/%E8%B2%A1%E5%8B%99%E5%A0%B1%E8%A1%A8`,
                      },
                    ];
                    const inputClass = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100";
                    const labelClass = "mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500";
                    const field = (
                      key: keyof typeof valuationInputs,
                      label: string,
                      placeholder: string,
                      helper: string
                    ) => (
                      <label>
                        <span className={labelClass}>{label}</span>
                        <input
                          value={valuationInputs[key]}
                          onChange={(e) => updateValuationInput(key, e.target.value)}
                          placeholder={placeholder}
                          inputMode="decimal"
                          className={inputClass}
                        />
                        <span className="mt-1 block text-[11px] font-medium text-slate-400">{helper}</span>
                      </label>
                    );
                    const quickSet = (label: string, onClick: () => void) => (
                      <button
                        type="button"
                        onClick={onClick}
                        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-blue-50 hover:text-blue-700"
                      >
                        {label}
                      </button>
                    );

                    return (
                      <div className="sleek-card order-4">
                        <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 md:flex-row md:items-start md:justify-between">
                          <div>
                            <h3 className="text-[13px] font-bold uppercase tracking-wider text-[#64748b]">2027／2028 目標價情境</h3>
                            <p className="mt-1 text-xs leading-5 text-slate-500">
                              先看未來價格區間；回檔時仍須確認營收與基本面沒有轉弱。
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {links.map(link => (
                              <a
                                key={link.label}
                                href={link.href}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                              >
                                {link.label}
                                <ArrowUpRight className="h-3 w-3" />
                              </a>
                            ))}
                          </div>
                        </div>

                        <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[0.9fr_1.1fr]">
                          <div className="space-y-4">
                            <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-xs leading-5 text-slate-600">
                              <span className="font-black text-blue-700">空白即自動估算。</span>
                              <span> 高 PE 或低基期時先降回 35x；需要時再手動調整。</span>
                            </div>

                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                              {field(
                                "eps2027",
                                "2027E EPS（可選）",
                                (data.epsForward ?? data.trailingEps) != null ? (data.epsForward ?? data.trailingEps)!.toFixed(2) : "自動",
                                `目前採用：${formatValue(valuation.scenarioEps)} · ${valuation.epsSource}`
                              )}
                              {field(
                                "fairPe",
                                "合理 PE（可選）",
                                valuation.referencePe != null ? valuation.referencePe.toFixed(1) : "35",
                                `目前採用：${formatValue(valuation.referencePe, 1)}x · ${valuation.peSource}`
                              )}
                            </div>

                            <div className="flex flex-wrap gap-2">
                              {quickSet("清空改自動", () => setValuationInputs({ eps2027: '', fairPe: '' }))}
                            </div>
                          </div>

                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                            <div className="mb-3 flex items-center justify-between">
                              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">未來目標價</span>
                              <span className="rounded-md bg-white px-2 py-1 text-[11px] font-bold text-slate-500">非目前合理價</span>
                            </div>

                            <div className="grid grid-cols-3 gap-3 text-sm">
                              <div>
                                <div className="text-[11px] text-slate-500">採用 EPS</div>
                                <div className="font-black text-blue-700">{formatValue(valuation.scenarioEps)}</div>
                              </div>
                              <div>
                                <div className="text-[11px] text-slate-500">採用 PE</div>
                                <div className="font-black text-slate-900">{formatValue(valuation.referencePe, 1)}x</div>
                              </div>
                              <div>
                                <div className="text-[11px] text-slate-500">2027E PE</div>
                                <div className="font-black text-slate-900">{formatValue(valuation.currentScenarioPe, 1)}x</div>
                              </div>
                            </div>

                            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                              <div className="rounded-xl border border-slate-200 bg-white p-3">
                                <div className="text-[11px] font-bold text-slate-500">保守目標</div>
                                <div className="mt-1 text-lg font-black text-slate-700">{formatTargetPrice(valuation.conservativeTarget, data.currency)}</div>
                                <div className="mt-1 text-[11px] text-slate-400">基準 × 0.85</div>
                              </div>
                              <div className="rounded-xl border border-emerald-100 bg-white p-3">
                                <div className="text-[11px] font-bold text-slate-500">基準目標</div>
                                <div className="mt-1 text-lg font-black text-emerald-700">{formatTargetPrice(valuation.fairTarget, data.currency)}</div>
                                <div className="mt-1 text-[11px] text-slate-400">空間 {formatValue(valuation.fairUpside, 1)}%</div>
                              </div>
                              <div className="rounded-xl border border-rose-100 bg-white p-3">
                                <div className="text-[11px] font-bold text-slate-500">FOMO 目標</div>
                                <div className="mt-1 text-lg font-black text-rose-700">{formatTargetPrice(valuation.optimisticTarget, data.currency)}</div>
                                <div className="mt-1 text-[11px] text-slate-400">空間 {formatValue(valuation.optimisticUpside, 1)}%</div>
                              </div>
                            </div>

                            <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3 text-xs font-semibold text-slate-600">
                              先看營收、獲利與毛利率；基本面轉弱時，目標價需下修。
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Chart Card */}
                  <div className="sleek-card order-3">
                    <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <span className="text-[12px] font-semibold uppercase tracking-wider text-[#64748b]">趨勢視覺化（近200日）</span>
                        <p className="mt-1 text-[11px] text-slate-400">粗實線看股價；均線只判斷趨勢；水平線看突破與箱型。</p>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-2 text-[10px] font-bold uppercase tracking-tight">
                        <div className="flex items-center gap-1.5"><span className="h-1 w-4 rounded bg-[#0f4c81]"></span> 股價</div>
                        <div className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-[#f59e0b]"></span> MA50</div>
                        <div className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-[#14b8a6]"></span> MA150</div>
                        <div className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dotted border-[#7c3aed]"></span> MA200</div>
                        <div className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-[#dc2626]"></span> Pivot</div>
                        {data.vcpHigh && !data.isExtended && (data.pivotPrice <= 0 || Math.abs(data.vcpHigh - data.pivotPrice) / data.pivotPrice > 0.015) && (
                          <div className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dotted border-[#0891b2]"></span> VCP</div>
                        )}
                        {data.rangeBox?.isBoxRange && data.rangeBox?.upper != null && data.rangeBox?.lower != null && (
                          <div className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm border border-slate-400 bg-slate-200/70"></span> 箱型</div>
                        )}
                      </div>
                    </div>
                    
                    <div className="h-[240px] w-full rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-2 sm:h-[300px] sm:p-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={data.chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="date" hide />
                          <YAxis 
                            domain={['auto', 'auto']} 
                            orientation="right"
                            tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }}
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(tick) => typeof tick === 'number' ? tick.toFixed(2) : tick}
                          />
                          <Tooltip 
                            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '12px' }}
                            formatter={(value: any) => typeof value === 'number' ? value.toFixed(2) : value}
                          />
                          {data.rangeBox?.isBoxRange && data.rangeBox?.upper != null && data.rangeBox?.lower != null && (
                            <ReferenceArea
                              y1={data.rangeBox.lower}
                              y2={data.rangeBox.upper}
                              label={{
                                position: 'insideTopLeft',
                                value: `箱型 ${data.rangeBox.lower.toFixed(2)}-${data.rangeBox.upper.toFixed(2)}`,
                                fill: '#64748b',
                                fontSize: 10,
                                fontWeight: 'bold'
                              }}
                            />
                          )}
                          {data.rangeBox?.isBoxRange && data.rangeBox?.upper != null && (
                            <ReferenceLine
                              y={data.rangeBox.upper}
                              stroke="#64748b"
                              strokeDasharray="7 5"
                              label={{ position: 'insideRight', value: `箱頂 ${data.rangeBox.upper.toFixed(2)}`, fill: '#475569', fontSize: 9, fontWeight: 'bold' }}
                            />
                          )}
                          {data.rangeBox?.isBoxRange && data.rangeBox?.lower != null && (
                            <ReferenceLine
                              y={data.rangeBox.lower}
                              stroke="#94a3b8"
                              strokeDasharray="7 5"
                              label={{ position: 'insideRight', value: `箱底 ${data.rangeBox.lower.toFixed(2)}`, fill: '#64748b', fontSize: 9, fontWeight: 'bold' }}
                            />
                          )}
                          {data.pivotPrice > 0 && (
                            <ReferenceLine 
                              y={data.pivotPrice} 
                              stroke="#dc2626"
                              strokeWidth={1.8}
                              strokeDasharray="8 4"
                              label={{ 
                                position: 'insideRight', 
                                value: `PIVOT ${data.baseType !== 'None' ? `(${data.baseType} Base)` : ''} (${data.pivotPrice?.toFixed(2) ?? 0})`, 
                                fill: '#b91c1c',
                                fontSize: 9, 
                                fontWeight: 'bold' 
                              }} 
                            />
                          )}
                          {data.vcpHigh && !data.isExtended && (data.pivotPrice <= 0 || Math.abs(data.vcpHigh - data.pivotPrice) / data.pivotPrice > 0.015) && (
                            <ReferenceLine 
                               y={data.vcpHigh} 
                               stroke="#0891b2"
                               strokeDasharray="2 5"
                               label={{ 
                                 position: 'insideLeft', 
                                 value: `VCP ${data.isVolumeContracted ? '(Tight)' : ''} (${data.vcpHigh?.toFixed(2) ?? ''})`, 
                                 fill: '#0e7490',
                                 fontSize: 9, 
                                 fontWeight: 'bold' 
                               }} 
                             />
                          )}
                          <Line type="monotone" dataKey="price" stroke="#0f4c81" strokeWidth={3} dot={false} name="收盤價" />
                          <Line type="monotone" dataKey="ma50" stroke="#f59e0b" strokeWidth={1.8} dot={false} name="50MA" />
                          <Line type="monotone" dataKey="ma150" stroke="#14b8a6" strokeWidth={1.7} dot={false} name="150MA" strokeDasharray="8 4" />
                          <Line type="monotone" dataKey="ma200" stroke="#7c3aed" strokeWidth={1.7} dot={false} name="200MA" strokeDasharray="2 5" />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* 保留在分析頁底部，方便直接切換觀察中的股票 */}
                  {watchlist.length > 0 && (
                    <div className="order-5 space-y-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="text-lg font-bold text-[#0f172a]">觀察日誌</h3>
                          <p className="mt-1 text-xs text-slate-500">點放大鏡可直接切換並重新分析股票。</p>
                        </div>
                        <button
                          onClick={() => switchTab('watchlist')}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
                        >
                          開啟完整日誌
                        </button>
                      </div>
                      {renderWatchlistCards(data.symbol)}
                      {renderWatchlistTable(data.symbol)}
                    </div>
                  )}

                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        </div>
      </main>

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-2 pb-[env(safe-area-inset-bottom)] pt-1 backdrop-blur md:hidden">
        <div className="grid grid-cols-3 gap-1">
          {([
            { key: 'analysis' as const, icon: LayoutDashboard, label: tabMeta.analysis.short },
            { key: 'surge' as const, icon: Flame, label: tabMeta.surge.short },
            { key: 'watchlist' as const, icon: History, label: tabMeta.watchlist.short },
          ]).map((item) => {
            const active = activeTab === item.key;
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => switchTab(item.key)}
                className={cn(
                  "relative flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] font-bold transition-colors",
                  active
                    ? item.key === 'surge'
                      ? "bg-rose-50 text-rose-600"
                      : "bg-blue-50 text-blue-600"
                    : "text-slate-500"
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
                {item.key === 'watchlist' && watchlist.length > 0 && (
                  <span className="absolute right-3 top-1 rounded-full bg-blue-100 px-1.5 text-[9px] font-bold text-blue-600">
                    {watchlist.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
