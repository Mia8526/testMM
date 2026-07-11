export interface OhlcBar { date?: string | Date; high: number; low: number; close: number; volume?: number | null }
export interface RangeBox { isBoxRange: boolean; breakdown: boolean; lookbackDays: number; upper: number | null; lower: number | null; widthPct: number | null; currentPositionPct: number | null; status: string; action: string }

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a,b)=>a-b); const n=(s.length-1)*p, a=Math.floor(n), b=Math.ceil(n); return s[a]+(s[b]-s[a])*(n-a); };

export function detectRangeBox(data: OhlcBar[], currentPrice: number): RangeBox {
  const valid = data.filter(d => Number.isFinite(d.high) && Number.isFinite(d.low) && Number.isFinite(d.close) && d.volume !== 0).slice(-60);
  const empty = (status: string, action: string): RangeBox => ({ isBoxRange:false, breakdown:false, lookbackDays:valid.length, upper:null, lower:null, widthPct:null, currentPositionPct:null, status, action });
  if (valid.length < 25 || !Number.isFinite(currentPrice) || currentPrice <= 0) return empty('資料不足','有效成交資料不足，先不用硬判斷箱型。');
  // Evaluate trailing endpoints newest-first. This finds the most recent completed
  // consolidation and deliberately leaves subsequent breakout/breakdown bars out.
  let chosen: OhlcBar[] | null = null, upper=0, lower=0;
  for (let end=valid.length; end>=25 && !chosen; end--) for (let len=Math.min(45,end); len>=25; len--) {
    const w=valid.slice(end-len,end), highs=w.map(x=>x.high), lows=w.map(x=>x.low), closes=w.map(x=>x.close);
    const u=pct(highs,.9), l=pct(lows,.1), mid=(u+l)/2, width=(u-l)/mid*100;
    const tol=Math.max((u-l)*.12,mid*.015), touchesH=highs.filter(x=>x>=u-tol).length, touchesL=lows.filter(x=>x<=l+tol).length;
    const k=Math.min(10,Math.floor(len/3)), first=closes.slice(0,k).reduce((a,b)=>a+b,0)/k, last=closes.slice(-k).reduce((a,b)=>a+b,0)/k;
    if (width>=4 && width<=30 && touchesH>=2 && touchesL>=2 && Math.abs((last-first)/mid*100)<=18) { chosen=w; upper=u; lower=l; break; }
  }
  if (!chosen) return empty('尚無明確箱型','近期沒有結構完整的整理區間。');
  const after=valid.slice(valid.indexOf(chosen[chosen.length-1])+1);
  const breakdown=currentPrice<lower*.97 && valid.slice(-3).filter(x=>x.close<lower*.97).length>=2;
  const widthPct=(upper-lower)/((upper+lower)/2)*100, raw=(currentPrice-lower)/(upper-lower)*100, currentPositionPct=Math.max(0,Math.min(100,raw));
  let status='箱型中段整理', action=`目前參考箱型 ${lower.toFixed(2)}～${upper.toFixed(2)}。`;
  if (breakdown) { status='箱型跌破確認'; action=`已確認跌破原箱底 ${lower.toFixed(2)}；保留原箱型供風險判讀，勿把跌破後低點當新箱底。`; }
  else if (currentPrice>upper*1.03) { status='箱型突破確認中'; action=`已高於箱型上緣 ${upper.toFixed(2)} 超過 3%。`; }
  else if (currentPositionPct>=80) status='箱型上緣壓力區'; else if(currentPositionPct<=25) status='箱型下緣支撐區';
  return {isBoxRange:true,breakdown,lookbackDays:valid.length,upper,lower,widthPct,currentPositionPct,status,action};
}
