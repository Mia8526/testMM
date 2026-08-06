export type HistoryBar = {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type RecoveryKind = "雙收復" | "收復前高" | "收復7月開盤";

export interface JulyRecoveryMetrics {
  priorHigh: number | null;
  priorHighDate: string | null;
  julyOpen: number | null;
  julyOpenDate: string | null;
  julyLow: number | null;
  julyLowDate: string | null;
  drawdownFromPriorPct: number | null;
  drawdownFromJulyOpenPct: number | null;
  recoveredPriorHigh: boolean;
  recoveredJulyOpen: boolean;
  recoveryKind: RecoveryKind | null;
  vsPriorHighPct: number | null;
  vsJulyOpenPct: number | null;
}

export interface JulyRecoveryOptions {
  /** Anchor month for the pullback, 1-12. Default: 7 (July). */
  pullbackMonth?: number;
  /** Year of the pullback month. Default: year of the latest bar. */
  year?: number;
  /**
   * Require a meaningful pullback before counting recovery.
   * prior-high path: july low must be at least this % below prior high.
   */
  minPriorDrawdownPct?: number;
  /**
   * July-open path: july low must be at least this % below July open.
   */
  minJulyOpenDrawdownPct?: number;
  /** Price tolerance for "at/above" level (0.002 = 0.2%). */
  touchTolerancePct?: number;
}

function toDateKey(value: string | Date): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  // 2026-07-01 / 2026/07/01 / 20260701
  const iso = raw.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // 115/07/01 (ROC)
  const roc = raw.match(/^(\d{2,3})\/(\d{1,2})\/(\d{1,2})/);
  if (roc) {
    const y = Number(roc[1]) + 1911;
    const m = String(Number(roc[2])).padStart(2, "0");
    const d = String(Number(roc[3])).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return null;
}

function monthOf(dateKey: string): number {
  return Number(dateKey.slice(5, 7));
}

function yearOf(dateKey: string): number {
  return Number(dateKey.slice(0, 4));
}

function pctChange(from: number, to: number): number {
  return parseFloat((((to - from) / from) * 100).toFixed(2));
}

/**
 * Classify whether the latest close has recovered:
 * 1) the pre-July swing high, and/or
 * 2) the first July session open (full recovery of July decline).
 *
 * Stocks that never pulled back are excluded so the list stays actionable.
 */
export function calcJulyRecovery(
  bars: HistoryBar[],
  currentPrice?: number | null,
  options: JulyRecoveryOptions = {}
): JulyRecoveryMetrics {
  const empty: JulyRecoveryMetrics = {
    priorHigh: null,
    priorHighDate: null,
    julyOpen: null,
    julyOpenDate: null,
    julyLow: null,
    julyLowDate: null,
    drawdownFromPriorPct: null,
    drawdownFromJulyOpenPct: null,
    recoveredPriorHigh: false,
    recoveredJulyOpen: false,
    recoveryKind: null,
    vsPriorHighPct: null,
    vsJulyOpenPct: null,
  };

  const clean = bars
    .map((bar) => {
      const date = toDateKey(bar.date);
      if (!date) return null;
      const open = Number(bar.open);
      const high = Number(bar.high);
      const low = Number(bar.low);
      const close = Number(bar.close);
      if (![open, high, low, close].every((n) => Number.isFinite(n) && n > 0)) return null;
      return { date, open, high, low, close, volume: bar.volume };
    })
    .filter((bar): bar is NonNullable<typeof bar> => bar !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (clean.length === 0) return empty;

  const latest = clean[clean.length - 1];
  const price =
    currentPrice != null && Number.isFinite(currentPrice) && currentPrice > 0
      ? Number(currentPrice)
      : latest.close;

  const pullbackMonth = options.pullbackMonth ?? 7;
  const year = options.year ?? yearOf(latest.date);
  const minPriorDrawdownPct = options.minPriorDrawdownPct ?? 8;
  const minJulyOpenDrawdownPct = options.minJulyOpenDrawdownPct ?? 5;
  const touchTolerancePct = options.touchTolerancePct ?? 0.002;

  const priorBars = clean.filter((bar) => {
    const y = yearOf(bar.date);
    const m = monthOf(bar.date);
    return y < year || (y === year && m < pullbackMonth);
  });
  // Use the most recent ~40 pre-July sessions so "前高" tracks the swing into July,
  // not a distant multi-year high.
  const priorWindow = priorBars.slice(-40);
  if (priorWindow.length === 0) return empty;

  let priorHigh = -Infinity;
  let priorHighDate: string | null = null;
  for (const bar of priorWindow) {
    if (bar.high >= priorHigh) {
      priorHigh = bar.high;
      priorHighDate = bar.date;
    }
  }
  if (!Number.isFinite(priorHigh) || priorHigh <= 0) return empty;

  const julyBars = clean.filter(
    (bar) => yearOf(bar.date) === year && monthOf(bar.date) === pullbackMonth
  );
  if (julyBars.length === 0) {
    return {
      ...empty,
      priorHigh: parseFloat(priorHigh.toFixed(2)),
      priorHighDate,
    };
  }

  const julyOpenBar = julyBars[0];
  const julyOpen = julyOpenBar.open;
  const julyOpenDate = julyOpenBar.date;

  let julyLow = Infinity;
  let julyLowDate: string | null = null;
  for (const bar of julyBars) {
    if (bar.low <= julyLow) {
      julyLow = bar.low;
      julyLowDate = bar.date;
    }
  }

  const drawdownFromPriorPct = pctChange(priorHigh, julyLow);
  const drawdownFromJulyOpenPct = pctChange(julyOpen, julyLow);

  const hadPriorPullback = drawdownFromPriorPct <= -minPriorDrawdownPct;
  const hadJulyOpenPullback = drawdownFromJulyOpenPct <= -minJulyOpenDrawdownPct;

  const priorTouch = priorHigh * (1 - touchTolerancePct);
  const julyTouch = julyOpen * (1 - touchTolerancePct);

  const recoveredPriorHigh = hadPriorPullback && price >= priorTouch;
  const recoveredJulyOpen = hadJulyOpenPullback && price >= julyTouch;

  let recoveryKind: RecoveryKind | null = null;
  if (recoveredPriorHigh && recoveredJulyOpen) recoveryKind = "雙收復";
  else if (recoveredPriorHigh) recoveryKind = "收復前高";
  else if (recoveredJulyOpen) recoveryKind = "收復7月開盤";

  return {
    priorHigh: parseFloat(priorHigh.toFixed(2)),
    priorHighDate,
    julyOpen: parseFloat(julyOpen.toFixed(2)),
    julyOpenDate,
    julyLow: parseFloat(julyLow.toFixed(2)),
    julyLowDate,
    drawdownFromPriorPct,
    drawdownFromJulyOpenPct,
    recoveredPriorHigh,
    recoveredJulyOpen,
    recoveryKind,
    vsPriorHighPct: pctChange(priorHigh, price),
    vsJulyOpenPct: pctChange(julyOpen, price),
  };
}

export function isJulyRecovery(metrics: Pick<JulyRecoveryMetrics, "recoveryKind">): boolean {
  return metrics.recoveryKind != null;
}

export function recoveryScore(input: {
  chg: number;
  recoveryKind: RecoveryKind | null;
  vsPriorHighPct: number | null;
  vsJulyOpenPct: number | null;
  vol5?: number | null;
}): number {
  if (!input.recoveryKind) return -Infinity;
  const kindBonus =
    input.recoveryKind === "雙收復" ? 30 : input.recoveryKind === "收復前高" ? 18 : 10;
  const levelScore = Math.max(input.vsPriorHighPct ?? -999, input.vsJulyOpenPct ?? -999);
  // Prefer just-recovered names over ones already far above the level.
  const extensionPenalty = levelScore > 8 ? (levelScore - 8) * 1.5 : 0;
  const volScore = Math.max(input.vol5 ?? 0, 0) * 0.05;
  return input.chg * 2 + kindBonus + Math.min(levelScore, 8) + volScore - extensionPenalty;
}
