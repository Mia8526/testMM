export interface OhlcBar { date?: string | Date; high: number; low: number; close: number; volume?: number | null }
export interface RangeBox {
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

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const n = (s.length - 1) * p;
  const a = Math.floor(n);
  const b = Math.ceil(n);
  return s[a] + (s[b] - s[a]) * (n - a);
};

/**
 * 剔除「已被放棄的舊低」：
 * - 最低點落在視窗前半
 * - 後半段低點整體抬高（新的近端棚架）
 * 則箱底改用後半段低點，不再吃 7 月急殺。
 */
function effectiveLows(lows: number[]): number[] {
  if (lows.length < 12) return lows;
  const minAll = Math.min(...lows);
  const minIdx = lows.indexOf(minAll);
  const split = Math.floor(lows.length * 0.45);
  // 極端低點在前半，且只是少數離群
  if (minIdx > split) return lows;

  const later = lows.slice(split);
  const laterMin = Math.min(...later);
  // 後半最低點明顯高於總最低點 → 舊低已放棄
  if (laterMin >= minAll * 1.06) {
    // 若前半還有「接近 laterMin 的防守」則合併；否則只用後半
    const shelf = laterMin;
    const nearShelf = lows.filter((x) => x <= shelf * 1.02 && x >= shelf * 0.98).length;
    if (nearShelf >= 2) {
      // 用「靠近近端棚架」的低點集計算，丟掉遠低於棚架的崩潰低
      const kept = lows.filter((x) => x >= shelf * 0.97);
      return kept.length >= 8 ? kept : later;
    }
    return later;
  }
  return lows;
}

function windowStats(w: OhlcBar[]) {
  const highs = w.map((x) => x.high);
  const lows = w.map((x) => x.low);
  const closes = w.map((x) => x.close);
  const useLows = effectiveLows(lows);
  const u = pct(highs, 0.9);
  const l = pct(useLows, 0.1);
  const mid = (u + l) / 2;
  const width = mid > 0 ? ((u - l) / mid) * 100 : 999;
  const tol = Math.max((u - l) * 0.12, mid * 0.015);
  const touchesH = highs.filter((x) => x >= u - tol).length;
  const touchesL = useLows.filter((x) => x <= l + tol).length;
  const k = Math.min(10, Math.floor(w.length / 3));
  const first = closes.slice(0, k).reduce((a, b) => a + b, 0) / k;
  const last = closes.slice(-k).reduce((a, b) => a + b, 0) / k;
  const drift = Math.abs(((last - first) / mid) * 100);
  return { u, l, mid, width, touchesH, touchesL, drift, lows, useLows };
}

type Candidate = {
  upper: number;
  lower: number;
  width: number;
  quality: 'standard' | 'wide';
  endi: number;
  len: number;
  drift: number;
  containsPrice: boolean;
  recentShelf: boolean;
};

export function detectRangeBox(data: OhlcBar[], currentPrice: number): RangeBox {
  const valid = data
    .filter((d) => Number.isFinite(d.high) && Number.isFinite(d.low) && Number.isFinite(d.close) && d.volume !== 0)
    .slice(-60);
  const empty = (status: string, action: string): RangeBox => ({
    isBoxRange: false,
    breakdown: false,
    quality: null,
    lookbackDays: valid.length,
    upper: null,
    lower: null,
    widthPct: null,
    currentPositionPct: null,
    status,
    action,
  });
  if (valid.length < 25 || !Number.isFinite(currentPrice) || currentPrice <= 0) {
    return empty('資料不足', '有效成交資料不足，先不用硬判斷箱型。');
  }

  // 若尾端已連續破底，箱型窗先不要把破底 K 線吃進去（保留跌破前結構）
  let scanEnd = valid.length;
  const tail = valid.slice(-3);
  const pre = valid.slice(0, -3);
  if (pre.length >= 25) {
    const preLow = Math.min(...pre.slice(-20).map((x) => x.low));
    const brokenTail = tail.filter((x) => x.close < preLow * 0.97).length >= 2;
    if (brokenTail) scanEnd = valid.length - 3;
  }

  const candidates: Candidate[] = [];
  for (let end = scanEnd; end >= 25; end--) {
    for (let len = Math.min(45, end); len >= 25; len--) {
      const w = valid.slice(end - len, end);
      const s = windowStats(w);
      if (!(s.width >= 4 && s.width <= 30) || !(s.mid > 0)) continue;
      const maxDrift = s.width <= 22 ? 12 : 10;
      if (s.touchesH < 2 || s.touchesL < 2 || s.drift > maxDrift) continue;

      const quality: 'standard' | 'wide' = s.width <= 22 ? 'standard' : 'wide';
      const containsPrice = currentPrice >= s.l * 0.97 && currentPrice <= s.u * 1.03;
      // 近端棚架：最近 12 根低點靠近箱底（代表箱底是現在還在測的）
      const recentLows = w.slice(-12).map((x) => x.low);
      const recentShelf = recentLows.some((x) => x <= s.l * 1.03) && Math.min(...recentLows) >= s.l * 0.97;
      candidates.push({
        upper: s.u,
        lower: s.l,
        width: s.width,
        quality,
        endi: end,
        len,
        drift: s.drift,
        containsPrice,
        recentShelf,
      });
    }
  }

  if (!candidates.length) return empty('尚無明確箱型', '近期沒有結構完整的整理區間。');

  const scoreOf = (c: Candidate) => {
    let s = 0;
    s += c.quality === 'standard' ? 1000 : 100;
    s += c.containsPrice ? 250 : 0;
    s += c.recentShelf ? 400 : 0; // 近端還在測的箱底優先
    s += c.endi * 3; // 越近端越好
    s += Math.max(0, 30 - c.width) * 4;
    s += Math.max(0, 12 - c.drift);
    // 箱底離現價過遠的寬幅／舊結構降權
    if (c.lower > 0) {
      const dist = ((currentPrice - c.lower) / c.lower) * 100;
      if (dist > 20) s -= Math.min(500, (dist - 20) * 20);
    }
    // 同樣條件下，較高的近端箱底加分（避免 7 月低點）
    s += Math.min(80, (c.lower / currentPrice) * 40);
    return s;
  };

  candidates.sort((a, b) => scoreOf(b) - scoreOf(a));
  // 若有「標準 + 現價在內/近上緣 + 近端棚架」直接優先
  const preferred =
    candidates.find((c) => c.quality === 'standard' && c.recentShelf && (c.containsPrice || currentPrice > c.upper)) ||
    candidates.find((c) => c.quality === 'standard' && c.containsPrice) ||
    candidates[0];
  const chosen = preferred;

  const upper = chosen.upper;
  const lower = chosen.lower;
  const breakdown =
    currentPrice < lower * 0.97 && valid.slice(-3).filter((x) => x.close < lower * 0.97).length >= 2;
  const widthPct = ((upper - lower) / ((upper + lower) / 2)) * 100;
  const raw = ((currentPrice - lower) / Math.max(upper - lower, 1e-9)) * 100;
  const currentPositionPct = Math.max(0, Math.min(100, raw));
  const quality: RangeBox['quality'] = widthPct <= 22 ? 'standard' : 'wide';
  const prefix = quality === 'wide' ? '寬幅整理' : '箱型';
  let status = `${prefix}中段`;
  let action = `目前參考${prefix} ${lower.toFixed(2)}～${upper.toFixed(2)}。`;
  if (breakdown) {
    status = '箱型跌破確認';
    action = `已確認跌破原箱底 ${lower.toFixed(2)}；保留原箱型供風險判讀，勿把跌破後低點當新箱底。`;
  } else if (currentPrice < lower) {
    status = '箱底失守觀察';
    action = `現價已低於箱底 ${lower.toFixed(2)}，但尚未確認跌破；觀察能否快速收回。`;
  } else if (currentPrice > upper * 1.03) {
    status = '箱型突破確認中';
    action = `已高於箱型上緣 ${upper.toFixed(2)} 超過 3%。`;
  } else if (currentPositionPct >= 80) status = `${prefix}上緣壓力區`;
  else if (currentPositionPct <= 25) status = `${prefix}下緣支撐區`;

  if (quality === 'wide' && lower > 0 && (currentPrice - lower) / lower > 0.18 && !breakdown) {
    action = `寬幅整理 ${lower.toFixed(2)}～${upper.toFixed(2)}（箱底偏遠，防守請改看近端支撐／均線）。`;
  }

  return {
    isBoxRange: true,
    breakdown,
    quality,
    lookbackDays: valid.length,
    upper,
    lower,
    widthPct,
    currentPositionPct,
    status,
    action,
  };
}
