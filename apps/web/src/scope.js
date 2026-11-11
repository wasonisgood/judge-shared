// 範圍整理（網頁版）：與桌面版相同的核心邏輯（逐案分析、綜合分析、覆核），在瀏覽器執行；
// AI 呼叫由 host.js 注入（經雲端 aiProxy），判決資料由 MCP 工具取得。打包為 js/scope.js，掛到 window.JRScope。
export {
  analyzeCase,
  synthesizeScope,
} from '@judge/core/dist/ai/analysis.js';
export {
  DEFAULT_CODING_FIELDS,
  normalizeCodingFields,
  countPendingReview,
} from '@judge/core/dist/pipeline/coding.js';
export {
  summarizeReview,
  applyReviewOp,
  DEFAULT_REVIEW_POLICY,
  normalizeReviewPolicy,
} from '@judge/core/dist/pipeline/coding-review.js';
export { scopeUiState, scopeControlStates } from '@judge/core/dist/pipeline/scopeFlow.js';
