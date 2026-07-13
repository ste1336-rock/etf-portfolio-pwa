# ETF 投資追蹤 PWA

Google Sheets 當資料庫、Apps Script 當 API、GitHub Pages 託管的單檔 PWA。
架構完全複製家庭帳本模式（`~/個人資料/家庭收支紀錄/PROJECT_TECH_STACK.md`）。
資料模型與金融計算規則繼承自 `~/ETF-Portfolio-App/` 的 Master Spec 與 DECISIONS.md。

## 檔案結構

| 檔案 | 用途 | 放哪裡 |
|---|---|---|
| `index.html` | 整個前端 App（單檔） | GitHub repo → Pages |
| `manifest.json` | PWA 設定（加入主畫面） | GitHub repo |
| `icons/` | App 圖示（180/192/512） | GitHub repo |
| `apps-script/Code.gs` | API 後端 | 貼到 Google Apps Script（不需要在 Pages 上，但留在 repo 做版本紀錄，內含零機密） |
| `tests/` | 金額定點運算與 GAS 純函式測試 | repo（`node tests/money.test.mjs && node tests/gas.test.mjs`） |

## 一次性安裝步驟

### A. Google 端（手動）
1. 到 sheets.new 建一份新 Google Sheet，命名 `ETF_Portfolio_PWA`。
2. 擴充功能 → Apps Script → 把 `apps-script/Code.gs` 全文貼進去（覆蓋預設內容）→ 儲存。
3. 函式選單選 `setup` → 執行 → 完成授權（會自動建立 Transactions / Prices / Settings 三分頁與標題列）。
4. 齒輪「專案設定」→「指令碼屬性」→ 新增 `SECRET_KEY` = 自訂長亂碼（≥12 字元，建議 30+）。
5. 部署 → 新增部署作業 → 網頁應用程式 → 執行身分「我」、存取權「所有人」→ 複製 `/exec` 網址。

### B. GitHub 端（手動）
1. 建 public repo（例：`etf-portfolio-pwa`），上傳 `index.html`、`manifest.json`、`icons/`（`apps-script/`、`tests/` 可一併上傳）。
2. Settings → Pages → Branch 選 `main` → Save。
3. App 網址：`https://<帳號>.github.io/<repo>/index.html`。

### C. iPhone 端（手動）
1. Safari 開 `https://<帳號>.github.io/<repo>/index.html?v=1`（**網址必須含 `/index.html`**，iOS PWA 會記住加入時的網址）。
2. 到「設定」分頁填入 Apps Script `/exec` 網址與 Secret Key → 儲存 → 測試連線。
3. 分享 → 加入主畫面。

## 維運注意（教訓正本，違反必踩雷）

- **Apps Script 改完程式碼必須「部署 → 管理部署作業 → 編輯 → 新版本」才生效**，只按儲存沒用。
- **GitHub Pages 有快取**：更新 `index.html` 後，網址加 `?v=數字`（遞增）強制刷新。
- **Secret Key 永遠不進 repo**（repo 是 public）：Key 只存在 Apps Script 指令碼屬性與手機 localStorage。
- **日期一律純數字**：`tradeDate` 存 `20260712`，時間戳存 epoch 毫秒——絕不存 `2026-07-12` 字串，Google Sheets 會自動轉成日期物件。
- **台股日期是民國曆**：TWSE 回 `1150709` = 2026-07-09，`parseROCDateToMs_` 已處理並有測試。

## 金融計算裁決（繼承自原生 App，改動前先看）

- **金額運算**：字串解析 → BigInt 定點（8 位小數）→ 最後一步才格式化，全程不經浮點。迴歸測試鎖住 `123.456789012345`。
- **加權平均成本不含手續費**（原生 App Phase 1 `AverageCostTests` 裁決）：均價 = Σ(價×量)/Σ量；未實現損益 = 市值 −（價×量成本）。手續費有記錄但 v1 不納入報酬計算（原 Master Spec 把手續費併入 Total Return 屬 Phase 4 範圍）。
- **TWD/USD 分開顯示、禁止相加**（無匯率換算前跨幣別相加是計算錯誤，不是風格選擇）。
- **API 失敗**：顯示最後成功價 + 更新時間 + 「非即時」徽章；完全無價 → 「無報價」徽章且該部位不計入總資產（卡片上明示）。不假裝舊價即時、不空白、不崩潰。
- **禁止**：AI 股價預測、跨幣別總資產相加。

## Mac 桌面圖示（可選）

兩種方式：

**A. Safari 加入 Dock（最像原生 App，推薦）**
Safari 開 App 網址 → 選單「檔案 → 加入 Dock」→ 加入。獨立視窗、有綠色圖示。

**B. 桌面 `.app`（雙擊用預設瀏覽器開）**
執行 `scripts/build-mac-app.sh`（一鍵重建，換電腦時可重跑）：

```bash
bash scripts/build-mac-app.sh
```

會用 `icons/icon-512.png` 產生 `.icns`，在桌面建立 `ETF投資追蹤.app`。首次雙擊若被 Gatekeeper 擋，右鍵 →「打開」放行一次即可。

## v1.1 新增

- **改／刪交易**：交易分頁點任一筆 → 進編輯（可改或刪）；原始建立時間保留。
- **持倉明細**：總覽點任一持倉 → 明細（股數/均價/總成本/已付手續費/市值/未實現損益/報酬率＋每一筆買入紀錄，點紀錄可編輯）。
- **累積手續費**：各幣別卡片顯示已付手續費（維持不計入成本與報酬——與原生 App 均價不含手續費的裁決一致，含手續費的 Total Return 屬 Phase 4）。
- **配置佔比＋集中度提醒**：每檔顯示在「同幣別內」的權重（不跨幣別相加）；單一持倉佔該幣別 ≥60% 時提醒分散。

## v1 範圍（刻意不做，附理由）

- **股息、賣出、Total Return**：屬 Master Spec Phase 4，需 Dividends 分頁與稅前/預扣/實收結構，下一版專做。
- **匯率換算成單一總資產**：需匯率來源，無匯率前跨幣別相加是錯的（Phase 4）。
- **年化報酬（XIRR）**：分批買入的資金加權年化易算錯，寧可不顯示也不給假精確值。
- **投資理由／停利停損／觸價提醒**：需 per-asset 結構，與股息一併做。
- **今日損益**（需前收價）、**Service Worker 離線快取**（家庭帳本經驗：快取問題大於收益）。
