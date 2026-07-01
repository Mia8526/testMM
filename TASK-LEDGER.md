# testMM Task Ledger

## 2026-07-01 — 趨勢分析資料撈取速度

- [x] 確認入口：趨勢分析 tab 使用 `/api/stock?ticker=...`。
- [x] 建立量測：本機 dev server + curl timing + JSON smoke check。
- [x] 根因：歷史價格與 quote 原本串行等待；台股未帶後綴時容易先試 `.TW` 再 fallback `.TWO`；股票名稱對照表可能拖慢冷啟動。
- [x] 修正：歷史價格/quote 並行、台股 suffix 快速推斷、名稱對照加 400ms timeout fallback、Vercel API 加 60 秒快取。
- [x] 驗證：TypeScript lint、production build、2330/8299/8299.TWO/3661 API smoke tests。

## 2026-07-01 — 簡化 2027 情境估值

- [x] 檢查原本欄位：營收、毛利率、費用、業外、稅率、股本、年化倍數、EPS、合理/FOMO/法人/產業 PE，共 12 個輸入。
- [x] 簡化設計：預設自動採用 Yahoo Forward EPS；沒有則用 trailing EPS。PE 預設採用 trailing PE；沒有則用 35x。
- [x] 手動欄位縮成 2 個：`2027E EPS（可選）`、`合理 PE（可選）`。
- [x] 輸出改為保守/合理/樂觀三段目標價與空間。
- [x] 驗證：`pnpm run lint`、`pnpm run build`、瀏覽器查詢 2330 並手動覆寫 EPS/PE。
