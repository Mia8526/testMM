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

## 2026-07-01 — 修正上櫃股名顯示英文

- [x] Repro：冷啟動查詢 `8299` 時，API 曾回 `PHISON ELECTRONICS CORP`，不含中文。
- [x] 根因：前次為了速度把 `getTaiwanShortNameFast` timeout 設成 400ms；上櫃中文名稱對照表冷啟動時可能尚未載入完成，導致 fallback 到 Yahoo 英文名稱。
- [x] 修正：保留 suffix 判斷快速 timeout，但使用者看到的股名把中文名稱等待時間提高到 2000ms。
- [x] 驗證：API 查詢 `8299`、`6488`、`3081` 都回中文；瀏覽器趨勢分析查詢 `8299` 顯示 `群聯`。

## 2026-07-02 — 修正 3167 趨勢分析 EPS / PE 低估

- [x] Repro：本機 `/api/stock?ticker=3167` 回 `epsForward=4.54`，本機 dev API 原本也沒回 `trailingPE/trailingEps`；Yahoo quote 對 3167 回 `trailingPE=105.25`、`trailingEps=8`。
- [x] 對照：TWSE `BWIBBU_ALL` 對 3167 官方本益比為 `82.07`，以現價 `842` 反推近 12 月 EPS 約 `10.26`。
- [x] 根因：Yahoo 台股 forward EPS 可能過舊/偏低；上市股 PE 用 Yahoo 會與 TWSE 官方資料不一致；local `server.ts` 與 Vercel `api/stock.ts` EPS/PE 邏輯不同步。
- [x] 修正：上市股優先用 TWSE 官方 PE，反推近 12 月 EPS；若 Yahoo forward EPS 明顯低於 trailing EPS 且缺少同步年度預估，視為不可靠並改用 trailing EPS；同步修正 local 與 Vercel API。
- [x] UI：EPS badge 改為可信 forward EPS 或 `近12月EPS`，估值文案改為可信 EPS + 交易所/Yahoo PE。
- [x] 驗證：3167 顯示 `本益比 82.1x`、`近12月EPS 10.26`；2330 仍保留可信 `epsForward=125.52`；`pnpm run lint`、`pnpm run build`、瀏覽器查詢 3167 passed.

## 2026-07-02 — 修正 3189 情境估值過高

- [x] Repro：本機 `/api/stock?ticker=3189.TW` 回 `epsForward=23.6392`、`trailingPE=250.1`；原 UI 用 `23.64 × 250.1`，合理價會被放大到約 `NT$5,912`。
- [x] 對照：TWSE `BWIBBU_ALL` 對 3189 官方本益比為 `250.14`、股價 `888`；Goodinfo / TWSE Q1 顯示 2026Q1 EPS 約 `1.17`，目前高 PE 主要是近 12 月 EPS 低基期造成。
- [x] 根因：Forward EPS 可作為成長假設，但不能直接搭配受低基期扭曲的 trailing PE 當「合理 PE」。
- [x] 修正：若自動 PE 超過 `100x`，估值卡保留顯示目前本益比，但「採用 PE」改用預設 `35x`，並在 helper 顯示 `目前 PE 250.1x 過高，改用預設 35x`；手動 PE 仍可覆寫。
- [x] 驗證：3189 自動估值改為 EPS `23.64` × PE `35.0x`，合理價約 `NT$827.37`、空間約 `-0.3%`；手動 PE `50x` 可即時改為合理價約 `NT$1,181.96`；`pnpm run lint`、`pnpm run build` passed.
