# 架構總覽（給接手的人）

更新：2026-11-11。本文件描述三個存儲庫如何分工、如何發版與部署、雲端端點的對照表，以及目前的限制。
進度與未完成事項見 [STATUS.md](STATUS.md)。

## 1. 三個存儲庫

| 存儲庫 | 公開？ | 內容 | 發版／部署方式 |
|---|---|---|---|
| `wasonisgood/judge-desktop` | 公開 | Electron 桌面端（主程序 `apps/desktop/src/main`、外殼與精靈） | 推送 `vX.Y.Z` 標籤 → GitHub Action 建立 Release（安裝檔、macOS、Linux）；`latest.json` 供應用程式內更新 |
| `wasonisgood/judge-shared` | 公開 | 共用套件 `@judge/core`（純邏輯）、`@judge/ui`（畫面）、網頁版 `apps/web`（網站與登入）、部署腳本 | `core-vX.Y.Z`、`ui-vX.Y.Z` 標籤 → Action 建立 Release 並附 tarball；網站透過手動的 `deploy-cloud.yml` 部署 |
| `wasonisgood/judge-remote-mcp` | 私有 | Firebase 雲端：Functions（MCP、AI 代理、助理、精讀、匯出、上傳）、Hosting 設定、授權頁、`firebase.json` | 手動 `firebase deploy`（或 `deploy-cloud.yml`，需要祕密）。雲端程式以 `@judge/core` 的釘住版本依賴 |

重要：三個存儲庫之間**只透過版本化的 tarball 依賴**相連，不再複製原始碼。
- 桌面端：`@judge/core` 與 `@judge/ui` 以 GitHub Release 的 tarball 網址釘住版本（見 `apps/desktop/package.json`）。
- 雲端：`@judge/core` 以 tarball 網址釘住（見 `functions/package.json`）。
- 網頁版：直接從 `judge-shared/packages/ui` 與 `packages/core` 建置（同一個倉庫）。

## 2. 共用套件

### `@judge/core`（`packages/core`）
純 TypeScript，無畫面。Node 與雲端皆可執行。內容：司法院檢索與解析、判決內頁、法規、範圍整理流程、AI 分析（`analyzeCase`、`synthesizeScope`、`briefJudgment`）、自然語言解析（`nlIntent`，0.1.2 起）、圖表計算、管轄區與知識庫、增量更新規劃（`updateDiff`）。
- 注入式設計：AI 呼叫以 `AiComplete(system, user, maxTokens)` 注入，因此同一份程式可以跑在桌面（本機金鑰）與雲端（代理）。
- 單元測試：`npm test`（445 項，1 項跳過）。`npm run test:live` 會實際連到司法院網站（唯讀）。

### `@judge/ui`（`packages/ui`）
原本的桌面畫面，改為共用套件：61 個 JS、11 個 CSS，依 `order.txt` 的順序打包成 `dist/ui.js` 與 `dist/ui.css`。
- 外殼需先設定 `window.__JR_HOST = { api, platform }` 再載入 `ui.js`。`platform` 為 `desktop` 或 `web`。
- `shell.js` 在載入時插入外殼；桌面專屬的元素標示 `data-desktop-only`，非桌面端自動隱藏。
- 畫面仍是原生 JS（全域 `window.JR`，檔案以 IIFE 寫法依序合併），**尚未改為 React 或 ES module**。
- 桌面端的 `api`（`src/renderer/js/host.js`）透過 preload 的 IPC；網頁版的 `api` 在 `apps/web/js/host.js`。

## 3. 網頁版（`apps/web`）

- `app/`：網頁版工具，產物在 `dist/app/`。入口 `index.html` 依序載入 `auth.js`（Firebase 登入）、`mcpClient.js`（雲端用戶端、AI 與代理用戶端）、`nl.js`（核心的自然語言解析）、`host.js`（`window.api` 的網頁版實作）、`ui/ui.js`。
- `landing/`：產品介紹頁（首頁），桌面下載連結透過 GitHub API 指向最新 Release。
- `src/auth.js`：Firebase Auth（Google 登入）。登入在網頁內完成，不跳轉到 MCP。取權杖一律 `getIdToken(true)`。
- `js/host.js`：網頁版 `api` 的對應表。已實作的方法見 [STATUS.md](STATUS.md)；未實作的呼叫會回報「網頁版尚未支援：<方法>」。
- 建置：`node apps/web/build.mjs`（先建 `packages/ui`，再組出 `dist/`）。測試：`npm test`（在 `apps/web`）。
- 部署：`scripts/stage-hosting.mjs <judge-remote-mcp 根目錄>` 把 `dist/` 放進雲端 hosting 目錄，再 `firebase deploy`。

## 4. 雲端（`judge-remote-mcp`）

Firebase 專案：`judge-remote-mcp-2026`，區域 `asia-east1`。Hosting 的 `firebase.json` 把以下路徑轉送到函式：

| 路徑 | 函式 | 用途 | 驗證 |
|---|---|---|---|
| `/mcp` | `mcp` | MCP JSON-RPC（搜尋、全文、範圍整理等 9 個工具；網頁版也用同一組工具） | OAuth 權杖（`jma_`）或 Firebase ID Token |
| `/oauth/**`、`/.well-known/**` | `mcp` | OAuth 2.1 授權頁、權杖、探索 | 授權頁用 Firebase Auth |
| `/aiProxy` | `aiProxy` | OpenAI 相容的 AI 代理（預設上游 Anthropic 原生；可設 OpenRouter） | ID Token＋有效訂閱＋月度用量 |
| `/api/agent` | `agent` | 助理：Anthropic tool use 呼叫 MCP 工具、檔案工具、畫面操作工具 | 同上 |
| `/api/brief` | `brief` | 精讀：核心 `briefJudgment` 整理成文書 | 同上 |
| `/api/upload` | `upload` | 文字檔上傳（Storage，10 MB，僅 txt／csv／md） | 同上 |
| `/api/export/list` | `exportList` | 判決列表匯出 Excel（Storage 下載連結） | ID Token（不需訂閱） |
| `/api/export/brief` | `exportBrief` | 精讀文書匯出 Word（Storage 下載連結） | ID Token（不需訂閱） |
| `/api/export/scope` | `exportScope` | 範圍整理匯出 Excel（每法規一表；Storage 下載連結） | ID Token（不需訂閱） |

注意：範圍整理的「分析」不在雲端端點執行。網頁版在瀏覽器用核心的 `analyzeCase`（打包為 `js/scope.js`），AI 經 `/aiProxy`；判決資料經 MCP `scope_table`、`get_judgment_detail`。因此範圍整理沒有 `/api/scope` 端點。
| `/api/annotations` | `mcp` | 個案研究筆記雲端同步 | ID Token |
| `ocr`、`probe`、`billingCheckout`、`billingWebhook` | 同名 | OCR、探測、金流（Beta，預設關閉） | 各自 |

資料：
- Firestore：`subscriptions/{uid}`（訂閱）、`usage/{uid}_{yyyymm}`（月度用量）、`files/{id}`（上傳與匯出檔的中繼資料）、`oauth_*`（OAuth）、`judgments/{id}`、搜尋快取。
- Storage：`uploads/{uid}/{id}/{name}`、`exports/{uid}/{id}/{name}`。下載連結為 Storage 的下載權杖網址（沒有到期時間，尚未設定清理規則）。

AI 代理的設定（函式參數，見 `functions/.env` 與 `defineString`/`defineSecret`）：
- `UPSTREAM_PROVIDER`：`anthropic`（預設）或 `openai`（OpenRouter，不作為預設、不測）。
- `UPSTREAM_BASE_URL`、`ALLOWED_MODELS`（降級鏈，逗號分隔，例如 `anthropic/claude-haiku-4.5,anthropic/claude-haiku-5.5`）。
- 祕密 `UPSTREAM_API_KEY`（設定指令：`firebase functions:secrets:set UPSTREAM_API_KEY --project judge-remote-mcp-2026`，由人工在終端機輸入，**不要貼進對話或程式**）。
- 模型退役：上游回報 404／not found 時自動換下一個模型，並寫入 `model_retired` 警告日誌。
- `ALLOWED_WEB_ORIGINS`：允許呼叫 `/mcp` 等端點的瀏覽器來源（CORS 白名單）。

## 5. 發版與部署流程

1. 改程式 → 本機建置與測試（各存儲庫的 `npm run build`、`npm test`）。
2. 共用套件：修改 `packages/core` 或 `packages/ui` → 升版（`package.json` 的 `version`）→ 提交 → 推送標籤 `core-vX.Y.Z` 或 `ui-vX.Y.Z` → 等 Action 完成（會建立 Release 與 tarball）。
3. 桌面端：把 `package.json` 的 `@judge/core`、`@judge/ui` 網址改為新版本 → `npm install` → 建置與測試 → 提交。發版時升 `apps/desktop/package.json` 版本，推送 `vX.Y.Z` 標籤。
4. 雲端：`functions` 的 `@judge/core` 網址改版本 → `npm install` → `npm run build` → 測試。部署：在暫存副本（不含 `.env` 以外的私密檔案）執行 `firebase deploy --only functions:<名稱>,hosting`。
   - Windows 上 `firebase.json` 的 `predeploy` 鉤子會失敗（`$RESOURCE_DIR`），可在暫存副本先編譯並移除 `predeploy` 再部署。
   - Hosting 的 HTML、JS、CSS 已設定不快取。
5. 網頁版：`apps/web/build.mjs` → `stage-hosting.mjs` → hosting 部署。

## 6. 限制與注意事項

- 網頁版目前只實作了部分的 `api` 方法（見 STATUS.md）；其餘的功能在網頁版不可用。
- AI 功能需要有效訂閱與設定好的上游金鑰；目前測試帳號的訂閱為手動建立（`source: manual-test`）。
- 司法院網站的抓取目前在雲端執行（與 `docs/SPEC.md` §10 的舊決策不同，該決策需要重新確認）。
- 精讀的 AI 輸出偶爾格式錯誤：已加入 JSON 修補（補逗號、跳脫字串內的引號與換行）；修補後仍可能失敗。
- 雲端 AI 的上游金鑰在 Secret Manager 中；不要在任何檔案或對話中寫入金鑰。
