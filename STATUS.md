# testMM Status

- 2026-07-01: Investigated slow data fetch on 趨勢分析 (`/api/stock`).
- 2026-07-01: Simplified `2027 情境估值` to auto-fill EPS/PE and reduce manual inputs from 12 to 2 optional overrides.
- 2026-07-01: Fixed OTC stock names in 趨勢分析 so 上櫃 stocks wait longer for exchange Chinese name mapping instead of falling back to Yahoo English names on cold start.
- 2026-07-02: Fixed 3167 趨勢分析 EPS/PE underestimation by preferring TWSE official PE and treating stale/too-low Yahoo forward EPS as unreliable.
- Latest verification: `pnpm run lint`, `pnpm run build`, API smoke tests for 3167/2330, and browser smoke test for 3167 passed.
