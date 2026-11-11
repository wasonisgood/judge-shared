# judge-shared

司法院裁判研究的共用套件，供桌面版（judge-desktop）與網頁版共同依賴。以版本號管理，各應用程式釘住指定版本。

- `packages/core`：`@judge/core`，檢索解析、範圍整理、AI 分析、圖表計算等純邏輯（Node，TypeScript）。網頁版不直接執行它，改由雲端（judge-remote-mcp）呼叫。
- `packages/ui`：`@judge/ui`，畫面（頁面、元件、控制器）與樣式，桌面版與網頁版共用。外殼需先設定 `window.__JR_HOST = { api, platform }`，再載入 `dist/ui.js` 與 `dist/ui.css`。

## 發版

- core：推送標籤 `core-vX.Y.Z`
- ui：推送標籤 `ui-vX.Y.Z`

標籤與 `package.json` 的版本必須一致，否則 Action 會失敗。發版 Action 會建立 GitHub Release 並附上 tarball。應用程式以 Release 的 tarball 網址依賴，不需要套件註冊中心。
