# testMM Task Ledger

## 2026-07-01 — 趨勢分析資料撈取速度

- [x] 確認入口：趨勢分析 tab 使用 `/api/stock?ticker=...`。
- [x] 建立量測：本機 dev server + curl timing + JSON smoke check。
- [x] 根因：歷史價格與 quote 原本串行等待；台股未帶後綴時容易先試 `.TW` 再 fallback `.TWO`；股票名稱對照表可能拖慢冷啟動。
- [x] 修正：歷史價格/quote 並行、台股 suffix 快速推斷、名稱對照加 400ms timeout fallback、Vercel API 加 60 秒快取。
- [x] 驗證：TypeScript lint、production build、2330/8299/8299.TWO/3661 API smoke tests。
