# judge-shared

司法院裁判研究的共用套件，供桌面版（judge-desktop）與網站版共同依賴。以版本號管理，各應用程式釘住指定版本。

- `packages/core`：`@judge/core`，檢索解析、範圍整理、AI 分析、圖表計算等純邏輯（TypeScript）。

## 發版

版本標籤格式：`core-vX.Y.Z`。發版時在 `packages/core` 執行 `npm pack`，並把產生的 `.tgz` 附在對應的 GitHub Release。應用程式以 Release 的 tarball 網址依賴，不需要套件註冊中心。
