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
  Loader2
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Legend
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface StockData {
  symbol: string;
  currentPrice: number;
  ma50: number;
  ma150: number;
  ma200: number;
  high52w: number;
  low52w: number;
  distFromHigh: string;
  distFromLow: string;
  conditions: {
    maAlignment: boolean;
    nearHigh: boolean;
    aboveLow: boolean;
    ma200Trending: boolean;
  };
  isTemplateMet: boolean;
  chartData: any[];
}

export default function App() {
  const [symbol, setSymbol] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<StockData | null>(null);
  const [error, setError] = useState('');

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
          <h2 className="text-[14px] font-semibold text-[#64748b] uppercase tracking-wider">參數設定</h2>
          <form onSubmit={handleSearch} className="space-y-4">
            <div className="space-y-2">
              <label className="text-[13px] font-medium text-[#475569]">股票代碼</label>
              <input
                type="text"
                placeholder="e.g. 2330"
                className="sleek-input"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="sleek-btn w-full flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : '開始分析'}
            </button>
          </form>
        </div>

        <div className="mt-auto pt-6 border-t border-slate-100">
          <div className="text-[11px] text-[#94a3b8] space-y-2 leading-relaxed">
            <p className="font-bold uppercase tracking-tight">趨勢模板標準 (Minervini):</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Price &gt; 150 & 200 MA</li>
              <li>150 MA &gt; 200 MA</li>
              <li>200 MA trending up</li>
              <li>50 MA &gt; 150 & 200 MA</li>
            </ol>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 ml-[280px] p-8 min-w-0">
        <AnimatePresence mode="wait">
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
                在左側輸入台股代碼，我們將根據 Minervini 的第二階段趨勢模板為您進行深度分析。
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
              <p className="text-sm font-medium">{error}</p>
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
                  <span className="text-[14px] text-[#64748b] font-medium uppercase tracking-wider">{data.symbol}</span>
                  <h2 className="text-3xl font-extrabold text-[#0f172a]">台股分析報告</h2>
                </div>
                <div className="text-right space-y-2">
                  <div className={cn(
                    "inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[14px] font-bold",
                    data.isTemplateMet ? "bg-[#dcfce7] text-[#15803d]" : "bg-slate-100 text-slate-500"
                  )}>
                    {data.isTemplateMet ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                    {data.isTemplateMet ? '符合趨勢模板 ✓' : '未符合模板'}
                  </div>
                  <div className="text-3xl font-bold text-[#0f172a]">$ {data.currentPrice.toFixed(2)}</div>
                </div>
              </div>

              {/* Grid Layout */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* MA Card */}
                <div className="sleek-card">
                  <span className="text-[12px] font-semibold text-[#64748b] uppercase tracking-wider block mb-4">移動平均線 (MA)</span>
                  <div className="space-y-3">
                    <IndicatorRow label="50 MA" value={data.ma50?.toFixed(1) || '-'} />
                    <IndicatorRow label="150 MA" value={data.ma150?.toFixed(1) || '-'} />
                    <IndicatorRow label="200 MA" value={data.ma200?.toFixed(1) || '-'} />
                  </div>
                </div>

                {/* 52W Range Card */}
                <div className="sleek-card">
                  <span className="text-[12px] font-semibold text-[#64748b] uppercase tracking-wider block mb-4">52 週股價區間</span>
                  <div className="space-y-3">
                    <IndicatorRow label="52W 最高" value={data.high52w.toFixed(2)} />
                    <IndicatorRow label="52W 最低" value={data.low52w.toFixed(2)} />
                    <div className="pt-2">
                      <span className="text-[10px] text-[#64748b] font-bold uppercase">目前位置</span>
                      <div className="h-2 bg-[#e2e8f0] rounded-full mt-2 relative overflow-hidden">
                        <div 
                          className="absolute h-full bg-[#2563eb] rounded-full" 
                          style={{ width: `${Math.min(100, Math.max(0, ((data.currentPrice - data.low52w) / (data.high52w - data.low52w)) * 100))}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-[#94a3b8] mt-1 font-medium">
                        <span>Low</span>
                        <span>Current</span>
                        <span>High</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Checklist Card */}
                <div className="sleek-card">
                  <span className="text-[12px] font-semibold text-[#64748b] uppercase tracking-wider block mb-4">符合條件清單</span>
                  <div className="space-y-3">
                    <CheckItem label="收盤價 > 50 > 150 > 200" met={data.conditions.maAlignment} />
                    <CheckItem label="距離 52W 高點 < 25%" met={data.conditions.nearHigh} />
                    <CheckItem label="高於 52W 低點 > 30%" met={data.conditions.aboveLow} />
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
                      />
                      <Tooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '12px' }}
                      />
                      <Line type="monotone" dataKey="price" stroke="#2563eb" strokeWidth={2.5} dot={false} name="收盤價" />
                      <Line type="monotone" dataKey="ma50" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="50MA" strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="ma150" stroke="#10b981" strokeWidth={1.5} dot={false} name="150MA" strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="ma200" stroke="#f43f5e" strokeWidth={1.5} dot={false} name="200MA" strokeDasharray="4 4" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function IndicatorRow({ label, value }: { label: string; value: string }) {
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

