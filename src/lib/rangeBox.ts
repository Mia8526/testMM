export interface OhlcBar { date?: string | Date; high: number; low: number; close: number; volume?: number | null }
export interface RangeBox { isBoxRange: boolean; breakdown: boolean; quality: 'standard' | 'wide' | null; lookbackDays: number; upper: number | null; lower: number | null; widthPct: number | null; currentPositionPct: number | null; status: string; action: string }

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a,b)=>a-b); const n=(s.length-1)*p, a=Math.floor(n), b=Math.ceil(n); return s[a]+(s[b]-s[a])*(n-a); };

export function detectRangeBox(data: OhlcBar[], currentPrice: number): RangeBox {
  const valid = data.filter(d => Number.isFinite(d.high) && Number.isFinite(d.low) && Number.isFinite(d.close) && d.volume !== 0).slice(-60);
  const empty = (status: string, action: string): RangeBox => ({ isBoxRange:false, breakdown:false,quality:null,lookbackDays:valid.length,upper:null,lower:null,widthPct:null,currentPositionPct:null,status,action });
  if (valid.length < 25 || !Number.isFinite(currentPrice) || currentPrice <= 0) return empty('資料不足','有效成交資料不足，先不用硬判斷箱型。');
  // Evaluate trailing endpoints newest-first. This finds the most recent completed
  // consolidation and deliberately leaves subsequent breakout/breakdown bars out.
  let chosen: OhlcBar[] | null = null, upper=0, lower=0;
  for (let end=valid.length; end>=25 && !chosen; end--) for (let len=Math.min(45,end); len>=25; len--) {
    const w=valid.slice(end-len,end), highs=w.map(x=>x.high), lows=w.map(x=>x.low), closes=w.map(x=>x.close);
    const u=pct(highs,.9), l=pct(lows,.1), mid=(u+l)/2, width=(u-l)/mid*100;
    const tol=Math.max((u-l)*.12,mid*.015), touchesH=highs.filter(x=>x>=u-tol).length, touchesL=lows.filter(x=>x<=l+tol).length;
    const k=Math.min(10,Math.floor(len/3)), first=closes.slice(0,k).reduce((a,b)=>a+b,0)/k, last=closes.slice(-k).reduce((a,b)=>a+b,0)/k;
    const maxDrift = width <= 22 ? 12 : 10;
    if (width>=4 && width<=30 && touchesH>=2 && touchesL>=2 && Math.abs((last-first)/mid*100)<=maxDrift) { chosen=w; upper=u; lower=l; break; }
  }
  if (!chosen) return empty('尚無明確箱型','近期沒有結構完整的整理區間。');
  const after=valid.slice(valid.indexOf(chosen[chosen.length-1])+1);
  const breakdown=currentPrice<lower*.97 && valid.slice(-3).filter(x=>x.close<lower*.97).length>=2;
  const widthPct=(upper-lower)/((upper+lower)/2)*100, raw=(currentPrice-lower)/(upper-lower)*100, currentPositionPct=Math.max(0,Math.min(100,raw));
  const quality: RangeBox['quality'] = widthPct <= 22 ? 'standard' : 'wide';
  const prefix = quality === 'wide' ? '寬幅整理' : '箱型';
  let status=`${prefix}中段`, action=`目前參考${prefix} ${lower.toFixed(2)}～${upper.toFixed(2)}。`;
  if (breakdown) { status='箱型跌破確認'; action=`已確認跌破原箱底 ${lower.toFixed(2)}；保留原箱型供風險判讀，勿把跌破後低點當新箱底。`; }
  else if (currentPrice<lower) { status='箱底失守觀察'; action=`現價已低於箱底 ${lower.toFixed(2)}，但尚未確認跌破；觀察能否快速收回。`; }
  else if (currentPrice>upper*1.03) { status='箱型突破確認中'; action=`已高於箱型上緣 ${upper.toFixed(2)} 超過 3%。`; }
  else if (currentPositionPct>=80) status=`${prefix}上緣壓力區`; else if(currentPositionPct<=25) status=`${prefix}下緣支撐區`;
  return {isBoxRange:true,breakdown,quality,lookbackDays:valid.length,upper,lower,widthPct,currentPositionPct,status,action};
}
