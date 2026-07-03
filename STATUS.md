# testMM Status

- 2026-07-01: Investigated slow data fetch on 趨勢分析 (`/api/stock`).
- 2026-07-01: Simplified `2027 情境估值` to auto-fill EPS/PE and reduce manual inputs from 12 to 2 optional overrides.
- 2026-07-01: Fixed OTC stock names in 趨勢分析 so 上櫃 stocks wait longer for exchange Chinese name mapping instead of falling back to Yahoo English names on cold start.
- 2026-07-02: Fixed 3167 趨勢分析 EPS/PE underestimation by preferring TWSE official PE and treating stale/too-low Yahoo forward EPS as unreliable.
- 2026-07-02: Fixed 3189 情境估值 overstatement by not using extreme trailing PE (>100x) as the automatic fair PE; default valuation PE falls back to 35x while keeping manual override.
- 2026-07-02: Reviewed 每日強勢股分類; relaxed 底部啟動 from c14<5/vol5>100/range10<15 to c14<8/vol5>80/range10≤18, renamed high-volatility rebound to 轉強反彈, and added usage guidance.
- 2026-07-03: Removed unused 每日強勢股 industry bar chart and made industry category cards clickable, showing per-category stock detail rows.
- Latest verification: `pnpm run lint`, `pnpm run build`, API smoke tests for 3189/3167/2330, standalone surge-classification data check, and browser smoke tests for 3189 auto/default PE + manual PE override passed. Latest UI change verified with `pnpm run lint`, `pnpm run build`, and local browser click smoke test for industry details.
