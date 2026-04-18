import React, { useState } from 'react';
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
  LayoutDashboard
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
  ReferenceLine
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
  localPivot: number;
  isLocalPivotExtended: boolean;
  vcpStatus: string;
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
  chartData: any[];
}

interface WatchlistItem {
  id: string;
  date: string;
  symbol: string;
  shortName: string;
  price: number;
  currency: string;
  pivotPrice: number;
  suggestedStopLoss: number;
  ma50Extension: string;
  extensionText: string;
  failedConditions: string[];
}

export default function App() {
  const [symbol, setSymbol] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<StockData | null>(null);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'analysis' | 'watchlist'>('analysis');
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>(() => {
    const saved = localStorage.getItem('trendpulse_watchlist');
    return saved ? JSON.parse(saved) : [];
  });

  const saveWatchlist = (items: WatchlistItem[]) => {
    setWatchlist(items);
    localStorage.setItem('trendpulse_watchlist', JSON.stringify(items));
  };

  const addToWatchlist = () => {
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

    saveWatchlist([newItem, ...watchlist]);
  };

  const removeFromWatchlist = (id: string) => {
    saveWatchlist(watchlist.filter(item => item.id !== id));
  };

  const reAnalyze = (ticker: string) => {
    setSymbol(ticker);
    setActiveTab('analysis');
    // We need to trigger the search. Since handleSearch uses the 'symbol' state, 
    // we'll use a small trick or just call it if we refactor. 
    // For now, let's just set the symbol and the user can click search, 
    // or we can trigger it via a useEffect if symbol changes from this specific action.
    setTimeout(() => {
      const btn = document.getElementById('search-btn');
      btn?.click();
    }, 100);
  };

  const exportToCSV = () => {
    if (watchlist.length === 0) return;
    
    const headers = ["紀錄時間", "代號", "名稱", "當前價格", "突破目標價", "建議停損", "50MA 乖離率", "警示文字", "未通過條件"];
    const rows = watchlist.map(item => [
      item.date,
      item.symbol,
      item.shortName,
      `${item.currency} ${item.price}`,
      item.pivotPrice > 0 ? `${item.currency} ${item.pivotPrice.toFixed(2)}` : "尚未形成平台",
      item.suggestedStopLoss > 0 ? `${item.currency} ${item.suggestedStopLoss.toFixed(2)}` : "-",
      `${item.ma50Extension}%`,
      item.extensionText,
      item.failedConditions.join('; ')
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

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!symbol) return;

    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/stock?ticker=${symbol}`);
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

  return (
    <div className="flex min-h-screen bg-[#f1f5f9]">
      {/* Sidebar */}
      <aside className="w-[280px] bg-white border-r border-[#e2e8f0] p-6 flex flex-col gap-6 shrink-0 fixed h-full">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-6 h-6 bg-[#2563eb] rounded-sm flex items-center justify-center">
            <TrendingUp className="text-white w-4 h-4" />
          </div>
          <h1 className="font-bold text-lg tracking-tight text-[#0f172a]">TrendPulse TW</h1>
        </div>

        <div className="space-y-4">
          <h2 className="text-[14px] font-semibold text-[#64748b] uppercase tracking-wider">導覽</h2>
          <nav className="space-y-1">
            <button 
              onClick={() => setActiveTab('analysis')}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                activeTab === 'analysis' ? "bg-blue-50 text-blue-600" : "text-slate-600 hover:bg-slate-50"
              )}
            >
              <LayoutDashboard className="w-4 h-4" />
              趨勢分析
            </button>
            <button 
              onClick={() => setActiveTab('watchlist')}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                activeTab === 'watchlist' ? "bg-blue-50 text-blue-600" : "text-slate-600 hover:bg-slate-50"
              )}
            >
              <History className="w-4 h-4" />
              觀察日誌
              {watchlist.length > 0 && (
                <span className="ml-auto bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full text-[10px]">
                  {watchlist.length}
                </span>
              )}
            </button>
          </nav>
        </div>

        {activeTab === 'analysis' && (
          <div className="space-y-4">
            <h2 className="text-[14px] font-semibold text-[#64748b] uppercase tracking-wider">參數設定</h2>
            <form onSubmit={handleSearch} className="space-y-4">
              <div className="space-y-2">
                <label className="text-[13px] font-medium text-[#475569]">股票代碼</label>
                <input
                  type="text"
                  placeholder="e.g. 2330 or NVDA"
                  className="sleek-input"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                />
              </div>
              <button
                id="search-btn"
                type="submit"
                disabled={loading}
                className="sleek-btn w-full flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : '開始分析'}
              </button>
            </form>
          </div>
        )}

        <div className="mt-auto pt-6 border-t border-slate-100 overflow-y-auto">
          {data ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[12px] font-bold text-[#64748b] uppercase tracking-wider">趨勢模板檢查 (Minervini)</h2>
                <div className={cn(
                  "px-2 py-0.5 rounded text-[10px] font-bold",
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
                    <div key={key} className="flex items-center justify-between text-[11px]">
                      <span className={cn("font-medium", met ? "text-slate-600" : "text-slate-400")}>
                        {labels[key] || key}
                      </span>
                      {met ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                      ) : (
                        <XCircle className="w-3 h-3 text-rose-300" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-[#94a3b8] space-y-2 leading-relaxed">
              <p className="font-bold uppercase tracking-tight">趨勢模板標準 (Minervini):</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Price &gt; 150 & 200 MA</li>
                <li>150 MA &gt; 200 MA</li>
                <li>200 MA trending up</li>
                <li>50 MA &gt; 150 & 200 MA</li>
                <li>Price &gt; 50 MA</li>
                <li>Price &gt; 52W Low +30%</li>
                <li>Price within 25% of 52W High</li>
              </ol>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 ml-[280px] p-8 min-w-0">
        <AnimatePresence mode="wait">
          {activeTab === 'watchlist' ? (
            <motion.div
              key="watchlist"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-[#0f172a]">觀察日誌</h2>
                  <p className="text-sm text-slate-500 mt-1">記錄您感興趣的股票及其當時的分析狀態</p>
                </div>
                {watchlist.length > 0 && (
                  <button 
                    onClick={exportToCSV}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    匯出 CSV
                  </button>
                )}
              </div>

              {watchlist.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-20 flex flex-col items-center text-center">
                  <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mb-6">
                    <History className="text-slate-300 w-8 h-8" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900">目前尚無紀錄</h3>
                  <p className="text-slate-500 mt-2 max-w-xs">
                    快去搜尋感興趣的股票吧！在分析結果頁面點擊「➕ 存入觀察日誌」即可在此查看。
                  </p>
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-6 py-4 text-[12px] font-bold text-slate-500 uppercase tracking-wider">日期</th>
                        <th className="px-6 py-4 text-[12px] font-bold text-slate-500 uppercase tracking-wider">股票</th>
                        <th className="px-6 py-4 text-[12px] font-bold text-slate-500 uppercase tracking-wider">價格</th>
                        <th className="px-6 py-4 text-[12px] font-bold text-slate-500 uppercase tracking-wider">突破目標價</th>
                        <th className="px-6 py-4 text-[12px] font-bold text-slate-500 uppercase tracking-wider">建議停損</th>
                        <th className="px-6 py-4 text-[12px] font-bold text-slate-500 uppercase tracking-wider">乖離率</th>
                        <th className="px-6 py-4 text-[12px] font-bold text-slate-500 uppercase tracking-wider">待滿足條件</th>
                        <th className="px-6 py-4 text-[12px] font-bold text-slate-500 uppercase tracking-wider text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {watchlist.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 text-sm text-slate-500 whitespace-nowrap">{item.date}</td>
                          <td className="px-6 py-4">
                            <div className="font-bold text-slate-900">{item.shortName}</div>
                            <div className="text-xs text-slate-400">{item.symbol}</div>
                          </td>
                          <td className="px-6 py-4 text-sm font-medium text-slate-700">{item.currency} {item.price}</td>
                          <td className="px-6 py-4 text-sm font-bold text-slate-900">
                            {item.pivotPrice > 0 ? `${item.currency} ${item.pivotPrice.toFixed(2)}` : "-"}
                          </td>
                          <td className="px-6 py-4 text-sm font-bold text-rose-600">
                            {item.suggestedStopLoss > 0 ? `${item.currency} ${item.suggestedStopLoss.toFixed(2)}` : "-"}
                          </td>
                          <td className="px-6 py-4">
                            <div className={cn("text-sm font-bold", getExtensionAlert(parseFloat(item.ma50Extension)).color)}>
                              {item.ma50Extension}%
                            </div>
                            <div className={cn("text-[10px] font-bold", getExtensionAlert(parseFloat(item.ma50Extension)).color)}>
                              {item.extensionText}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            {item.failedConditions.length === 0 ? (
                              <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">全數通過 ✓</span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {item.failedConditions.map((c, i) => (
                                  <span key={i} className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-medium">
                                    {c}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button 
                                onClick={() => reAnalyze(item.symbol)}
                                className="p-2 text-blue-400 hover:text-blue-600 transition-colors"
                                title="重新查詢"
                              >
                                <Search className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => removeFromWatchlist(item.id)}
                                className="p-2 text-slate-300 hover:text-rose-500 transition-colors"
                                title="刪除"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div key="analysis_view" className="space-y-6">
              {!data && !loading && (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="h-full flex flex-col items-center justify-center text-center py-20"
                >
                  <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mb-6">
                    <Search className="text-blue-600 w-8 h-8" />
                  </div>
                  <h2 className="text-3xl font-extrabold text-[#0f172a] mb-3">準備好發掘強勢股了嗎？</h2>
                  <p className="text-[#64748b] max-w-md">
                    在左側輸入台股代碼或美股代號，我們將根據 Minervini 的第二階段趨勢模板為您進行深度分析。
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
                  className="space-y-6"
                >
                  {/* Header Card */}
                  <div className="sleek-card flex flex-col md:flex-row items-end justify-between gap-6">
                    <div className="space-y-1">
                      <div className="flex items-center gap-3">
                        <span className="text-[14px] text-[#64748b] font-medium uppercase tracking-wider">{data.symbol}</span>
                        <span className={cn(
                          "px-2 py-0.5 text-[11px] font-bold rounded uppercase",
                          data.marketType === '美股' ? "bg-blue-50 text-blue-600" : 
                          data.marketType === '上市' ? "bg-blue-100 text-blue-700" :
                          "bg-purple-100 text-purple-700"
                        )}>{data.marketType}</span>
                      </div>
                      <div className="flex items-baseline gap-3">
                        <h2 className="text-3xl font-extrabold text-[#0f172a]">{data.shortName}</h2>
                        <span className="text-lg font-semibold text-slate-400">分析報告</span>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <Info className="w-4 h-4 text-amber-500" />
                        <span className="text-sm text-amber-600 font-medium">{data.fundamentalStatus}</span>
                      </div>
                    </div>
                      <div className="text-right space-y-2">
                        <div className="flex items-center justify-end gap-2">
                          <button 
                            onClick={addToWatchlist}
                            className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-full text-[13px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors mr-2"
                          >
                            <BookmarkPlus className="w-4 h-4" />
                            觀察
                          </button>
                          {parseFloat(data.ma50Extension) > 25 && (
                            <div className="px-3 py-1 bg-rose-50 text-rose-600 text-[12px] font-bold rounded-full border border-rose-100">
                              🚨 過熱
                            </div>
                          )}
                        </div>
                        <div className="text-3xl font-bold text-[#0f172a]">
                          <span className="text-xs text-slate-400 font-medium block mb-1">昨日收盤價 (Last Close)</span>
                          {data.currency} {data.currentPrice.toFixed(2)}
                        </div>
                      </div>
                  </div>

                  {/* Grid Layout - 3 Columns */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* MA Card */}
                    <div className="sleek-card">
                      <div className="flex justify-between items-center mb-4">
                        <span className="text-[12px] font-semibold text-[#64748b] uppercase tracking-wider">移動平均線 (MA)</span>
                        {data.isVolumeContracted && (
                          <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-[10px] font-bold rounded border border-blue-100 animate-pulse">
                            量縮中
                          </span>
                        )}
                      </div>
                      <div className="space-y-3">
                        <IndicatorRow label="50 MA" value={`${data.currency} ${data.ma50?.toFixed(2) || '-'}`} />
                        <IndicatorRow label="150 MA" value={`${data.currency} ${data.ma150?.toFixed(2) || '-'}`} />
                        <IndicatorRow label="200 MA" value={`${data.currency} ${data.ma200?.toFixed(2) || '-'}`} />
                        <div className="pt-3 border-t border-slate-50">
                          <div className="flex justify-between items-center">
                            <span className="text-[13px] text-[#64748b] font-medium">50MA 乖離率</span>
                            <span className={cn("text-[15px] font-bold", getExtensionAlert(parseFloat(data.ma50Extension)).color)}>
                              {data.ma50Extension}%
                            </span>
                          </div>
                          <div className={cn(
                            "mt-2 p-2 rounded-lg border text-center transition-all duration-500",
                            getExtensionAlert(parseFloat(data.ma50Extension)).bg
                          )}>
                            <p className={cn("text-[11px] font-bold", getExtensionAlert(parseFloat(data.ma50Extension)).color)}>
                              {getExtensionAlert(parseFloat(data.ma50Extension)).text}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 樞紐雷達 - 三行核心資訊 (Static Anchor) */}
                    <div className="bg-white p-4 sm:p-6 rounded-xl border border-slate-200 lg:col-span-2 shadow-sm">
                      <h3 className="text-[12px] font-semibold text-[#64748b] uppercase tracking-wider mb-6">🎯 樞紐雷達核心資訊</h3>
                      <div className="space-y-5 sm:space-y-6 max-w-lg mx-auto">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 sm:gap-0">
                          <span className="text-sm text-slate-500 font-medium whitespace-nowrap">突破目標價</span>
                          <span className="text-lg sm:text-xl font-black text-blue-600">
                            NT$ {data.pivotPrice.toFixed(2)}
                          </span>
                        </div>
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 sm:gap-0 py-4 border-y border-slate-50">
                          <span className="text-sm text-slate-500 font-medium whitespace-nowrap">最佳進場區 (Pivot ~ +5%)</span>
                          <span className="text-lg sm:text-xl font-black text-emerald-600">
                            NT$ {data.pivotPrice.toFixed(2)} ~ NT$ {(data.pivotPrice * 1.05).toFixed(2)}
                          </span>
                        </div>
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 sm:gap-0">
                           <span className="text-sm text-slate-500 font-bold whitespace-nowrap">參考停損 (-8%)</span>
                           <span className="text-lg sm:text-xl font-black text-red-700">NT$ {(data.pivotPrice * 0.92).toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Chart Card */}
                  <div className="sleek-card">
                    <div className="flex items-center justify-between mb-6">
                      <span className="text-[12px] font-semibold text-[#64748b] uppercase tracking-wider">趨勢視覺化 (近 200 日)</span>
                      <div className="flex gap-4 text-[10px] font-bold uppercase tracking-tight">
                        <div className="flex items-center gap-1.5"><span className="w-2.5 h-0.5 bg-[#2563eb]"></span> 價格</div>
                        <div className="flex items-center gap-1.5"><span className="w-2.5 h-0.5 bg-amber-500"></span> MA50</div>
                        <div className="flex items-center gap-1.5"><span className="w-2.5 h-0.5 bg-emerald-500"></span> MA150</div>
                        <div className="flex items-center gap-1.5"><span className="w-2.5 h-0.5 bg-rose-500"></span> MA200</div>
                        <div className="flex items-center gap-1.5"><span className="w-2.5 h-0.5 border-t border-dashed border-slate-400"></span> 52W HIGH</div>
                        <div className="flex items-center gap-1.5"><span className="w-2.5 h-0.5 border-t border-dashed border-sky-300"></span> VCP 高點</div>
                      </div>
                    </div>
                    
                    <div className="h-[300px] w-full bg-[#f8fafc] rounded-lg border border-[#e2e8f0] p-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={data.chartData}>
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
                          {data.pivotPrice > 0 && (
                            <ReferenceLine 
                              y={data.pivotPrice} 
                              stroke="#f43f5e" 
                              strokeDasharray="3 3" 
                              label={{ 
                                position: 'insideRight', 
                                value: `突破點 (${data.pivotPrice.toFixed(2)})`, 
                                fill: '#f43f5e', 
                                fontSize: 9, 
                                fontWeight: 'bold' 
                              }} 
                            />
                          )}
                          {data.localPivot > 0 && (
                            <ReferenceLine 
                               y={data.localPivot} 
                               stroke="#7dd3fc" 
                               strokeDasharray="3 3" 
                               label={{ 
                                 position: 'insideLeft', 
                                 value: `VCP 高點 (${data.localPivot.toFixed(2)})`, 
                                 fill: '#0ea5e9', 
                                 fontSize: 9, 
                                 fontWeight: 'bold' 
                               }} 
                             />
                          )}
                          <Line type="monotone" dataKey="price" stroke="#2563eb" strokeWidth={2.5} dot={false} name="收盤價" />
                          <Line type="monotone" dataKey="ma50" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="50MA" strokeDasharray="4 4" />
                          <Line type="monotone" dataKey="ma150" stroke="#10b981" strokeWidth={1.5} dot={false} name="150MA" strokeDasharray="4 4" />
                          <Line type="monotone" dataKey="ma200" stroke="#f43f5e" strokeWidth={1.5} dot={false} name="200MA" strokeDasharray="4 4" />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Watchlist Table Section - Always visible in analysis if records exist */}
                  {watchlist.length > 0 && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-bold text-[#0f172a]">觀察日誌儀表板</h3>
                        <button 
                          onClick={exportToCSV}
                          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                        >
                          <Download className="w-4 h-4" />
                          匯出為 CSV 檔案
                        </button>
                      </div>
                      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200">
                              <th className="px-6 py-4 text-[12px] font-bold text-slate-500 uppercase tracking-wider">日期</th>
                              <th className="px-6 py-4 text-[12px] font-bold text-slate-500 uppercase tracking-wider">股票</th>
                              <th className="px-6 py-4 text-[12px] font-bold text-slate-500 uppercase tracking-wider">價格</th>
                              <th className="px-6 py-4 text-[12px] font-bold text-slate-500 uppercase tracking-wider">突破目標價</th>
                              <th className="px-6 py-4 text-[12px] font-bold text-slate-500 uppercase tracking-wider">乖離率</th>
                              <th className="px-6 py-4 text-[12px] font-bold text-slate-500 uppercase tracking-wider">待滿足條件</th>
                              <th className="px-6 py-4 text-[12px] font-bold text-slate-500 uppercase tracking-wider text-right">操作</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {watchlist.map((item) => (
                              <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                                <td className="px-6 py-4 text-sm text-slate-500 whitespace-nowrap">{item.date}</td>
                                <td className="px-6 py-4">
                                  <div className="font-bold text-slate-900">{item.shortName}</div>
                                  <div className="text-xs text-slate-400">{item.symbol}</div>
                                </td>
                                <td className="px-6 py-4 text-sm font-medium text-slate-700">{item.currency} {item.price <= 100 ? item.price.toFixed(2) : item.price}</td>
                                <td className="px-6 py-4 text-sm font-bold text-slate-900">
                                  {item.pivotPrice > 0 ? `${item.currency} ${item.pivotPrice <= 100 ? item.pivotPrice.toFixed(2) : item.pivotPrice.toFixed(2)}` : "-"}
                                </td>
                                <td className="px-6 py-4">
                                  <div className={cn("text-sm font-bold", getExtensionAlert(parseFloat(item.ma50Extension)).color)}>
                                    {item.ma50Extension}%
                                  </div>
                                  <div className={cn("text-[10px] font-bold", getExtensionAlert(parseFloat(item.ma50Extension)).color)}>
                                    {item.extensionText}
                                  </div>
                                </td>
                                <td className="px-6 py-4">
                                  {item.failedConditions.length === 0 ? (
                                    <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">全數通過 ✓</span>
                                  ) : (
                                    <div className="flex flex-wrap gap-1">
                                      {item.failedConditions.map((c, i) => (
                                        <span key={i} className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-medium">
                                          {c}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </td>
                                <td className="px-6 py-4 text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    <button 
                                      onClick={() => reAnalyze(item.symbol)}
                                      className="p-2 text-blue-400 hover:text-blue-600 transition-colors"
                                      title="重新查詢"
                                    >
                                      <Search className="w-4 h-4" />
                                    </button>
                                    <button 
                                      onClick={() => removeFromWatchlist(item.id)}
                                      className="p-2 text-slate-300 hover:text-rose-500 transition-colors"
                                      title="刪除"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function IndicatorRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center pb-2 border-bottom border-[#f1f5f9]">
      <span className="text-[14px] text-[#475569] font-medium">{label}</span>
      <span className="text-[16px] font-bold text-[#0f172a]">{value}</span>
    </div>
  );
}

function CheckItem({ label, met }: { label: string; met: boolean }) {
  return (
    <div className="flex justify-between items-center pb-2 border-bottom border-[#f1f5f9]">
      <span className="text-[14px] text-[#475569] font-medium">{label}</span>
      <span className={cn("text-[14px] font-bold", met ? "text-[#10b981]" : "text-slate-300")}>
        {met ? '✓' : '✕'}
      </span>
    </div>
  );
}


function ConditionItem({ label, met, detail }: { label: string; met: boolean; detail: string }) {
  return (
    <div className="flex gap-3">
      <div className="mt-1">
        {met ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-500" />
        ) : (
          <XCircle className="w-5 h-5 text-slate-300" />
        )}
      </div>
      <div>
        <p className={cn("text-sm font-bold", met ? "text-slate-900" : "text-slate-500")}>
          {label}
        </p>
        <p className="text-xs text-slate-400 mt-0.5">{detail}</p>
      </div>
    </div>
  );
}

