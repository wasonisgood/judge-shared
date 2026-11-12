// 判決列表的智慧搜尋與 AI 篩選（網頁版）：與桌面版相同的核心邏輯（有上限的查詢輪次、相關性判斷），
// 在瀏覽器執行；AI 呼叫由 host.js 注入（經雲端 aiProxy），判決搜尋由 MCP 工具 quick_search 取得。
// 打包為 js/search.js，掛到 window.JRSearch。
export { runQueryRounds } from '@judge/core/dist/pipeline/queryRounds.js';
export { proposeQueries } from '@judge/core/dist/pipeline/proposeQueries.js';
export { screenRelevance } from '@judge/core/dist/ai/analysis.js';
export { newTrace, addStep, explainTrace } from '@judge/core/dist/pipeline/trace.js';
