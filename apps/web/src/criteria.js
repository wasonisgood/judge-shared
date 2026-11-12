// 納入／排除核查（網頁版）：與桌面版相同的核心邏輯（規劃、核查、檢閱、比較），在瀏覽器執行；AI 經雲端 aiProxy（host.js 注入）。
// 打包為 js/criteria.js，掛到 window.JRCriteria。
import { runCriteria, planRun, reviewRerun, appendRun, compareRuns, validateCriteria } from '@judge/core/dist/pipeline/criteria.js';
import { suggestCriteria } from '@judge/core/dist/ai/nlIntent.js';

const SPLIT_KEYWORDS = /[,，、;；\n]+/;

/** 整理畫面送來的標準列表（與桌面版 criteriaLogic.parseCriteriaInput 相同）。 */
export function parseCriteriaInput(raw) {
  if (!Array.isArray(raw)) throw new Error('標準格式不正確');
  const rows = raw
    .map(function (r) { return r && typeof r === 'object' ? r : {}; })
    .map(function (x) {
      return {
        kind: x.kind === 'exclude' ? 'exclude' : 'include',
        text: String(x.text == null ? '' : x.text).trim(),
        method: x.method === 'program' ? 'program' : 'ai',
        keywords: (Array.isArray(x.keywords) ? x.keywords.map(String) : String(x.keywords == null ? '' : x.keywords).split(SPLIT_KEYWORDS))
          .map(function (k) { return k.trim(); }).filter(Boolean),
        keywordMode: x.keywordMode === 'all' ? 'all' : 'any',
      };
    })
    .filter(function (x) { return x.text || x.keywords.length; });
  const criteria = rows.map(function (x, i) {
    return x.method === 'program'
      ? { id: 'c' + (i + 1), kind: x.kind, text: x.text, method: 'program', keywords: x.keywords, keywordMode: x.keywordMode }
      : { id: 'c' + (i + 1), kind: x.kind, text: x.text, method: 'ai' };
  });
  const errors = validateCriteria(criteria);
  if (errors.length) throw new Error(errors.join('；'));
  return criteria;
}

/** 從已保存的「檔案」項目取出候選判決 id（列表取 items，範圍整理取各工作表的判決列）。 */
export function candidateIdsOf(kind, payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  let ids = [];
  if (kind === 'list') {
    ids = (Array.isArray(p.items) ? p.items : []).map(function (it) { return String(it && it.id || ''); });
  } else if (kind === 'scope') {
    ids = (Array.isArray(p.sheets) ? p.sheets : []).reduce(function (acc, s) {
      const rows = s && Array.isArray(s.rows) ? s.rows : [];
      return acc.concat(rows.map(function (r) { return String(r && r.id || ''); }));
    }, []);
  }
  return ids.filter(function (x, i) { return x && ids.indexOf(x) === i; });
}

export function needsFetch(id, details) {
  const d = details[id];
  return !(d && d.fullText && String(d.fullText).trim());
}

/** 組出核心需要的候選案件（沒有全文時 fullText 為空，核心會把該案判斷為無法判斷）。 */
export function toCaseInput(id, detail, summary) {
  const meta = detail && detail.meta || {};
  return {
    id: id,
    caseNo: meta.caseNo != null ? meta.caseNo : (meta.title != null ? meta.title : (summary && summary.title) || null),
    dateIso: meta.dateIso != null ? meta.dateIso : (summary && summary.dateIso) || null,
    fullText: (detail && detail.fullText) || '',
  };
}

export { runCriteria, planRun, reviewRerun, appendRun, compareRuns, suggestCriteria };

/** 匯出的 CSV（每案每條標準一列，與 Excel「依據」明細相同的欄位）。 */
export function runToCsv(run) {
  const byId = {};
  (run.criteria || []).forEach(function (c) { byId[c.id] = c; });
  const esc = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
  const lines = [['判決', '標準', '判斷方式', '結果', '依據', '原文引文', '依據有效性'].map(esc).join(',')];
  (run.outcomes || []).forEach(function (o) {
    (o.results || []).forEach(function (r) {
      const c = byId[r.criterionId];
      lines.push([
        o.caseNo || o.id,
        c ? (c.kind === 'include' ? '納入' : '排除') + '：' + c.text : r.criterionId,
        r.method === 'program' ? '程式判斷' : 'AI 判斷',
        r.verdict === 'met' ? '符合' : r.verdict === 'not_met' ? '不符合' : '無法判斷',
        r.basis,
        (r.quotes || []).join('\n'),
        r.invalidEvidence ? '無效（找不到逐字依據）' : '有效',
      ].map(esc).join(','));
    });
  });
  return '﻿' + lines.join('\r\n');
}
