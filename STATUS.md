# testMM Status

- 2026-07-01: Investigated slow data fetch on 趨勢分析 (`/api/stock`).
- 2026-07-01: Simplified `2027 情境估值` to auto-fill EPS/PE and reduce manual inputs from 12 to 2 optional overrides.
- 2026-07-01: Fixed OTC stock names in 趨勢分析 so 上櫃 stocks wait longer for exchange Chinese name mapping instead of falling back to Yahoo English names on cold start.
- 2026-07-02: Fixed 3167 趨勢分析 EPS/PE underestimation by preferring TWSE official PE and treating stale/too-low Yahoo forward EPS as unreliable.
- 2026-07-02: Fixed 3189 情境估值 overstatement by not using extreme trailing PE (>100x) as the automatic fair PE; default valuation PE falls back to 35x while keeping manual override.
- 2026-07-02: Reviewed 每日強勢股分類; relaxed 底部啟動 from c14<5/vol5>100/range10<15 to c14<8/vol5>80/range10≤18, renamed high-volatility rebound to 轉強反彈, and added usage guidance.
- 2026-07-03: Removed unused 每日強勢股 industry bar chart and made industry category cards clickable, showing per-category stock detail rows.
- 2026-07-09: Updated 情境估值 PE/EPS source handling for 上櫃 stocks; 8383 now uses TPEX official PE + official close to infer trailing EPS, then recalculates current implied PE from the latest quote.
- 2026-07-09: Added 趨勢視覺化 box-range detection; the analysis page now shows 箱型上下緣、目前位置、區間寬度、操作提醒, and overlays box top/bottom on the 200-day chart.
- 2026-07-09: Refined box-range detection so strong one-way trend stocks such as 4556 are marked `非箱型：趨勢太強` and no box overlay is drawn.
- Latest verification: `pnpm run lint`, `pnpm run build`, API smoke tests for 4556/8383/2301/2449/3413 rangeBox output, and browser smoke test for 4556 non-box UI passed.
