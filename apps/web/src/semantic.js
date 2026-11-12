// 段落檢索（網頁版）：與桌面版 services/semanticService.ts 相同的流程（關鍵字取候選 → 條件篩選 → 逐筆取內文切段 → AI 段落重排），
// 在瀏覽器執行；AI 經雲端 aiProxy（由 host.js 注入），候選與內文由 MCP 工具取得。打包為 js/semantic.js，掛到 window.JRSemantic。
// 網頁版一次最多讀取 WEB_MAX_CANDIDATES 筆內文（每筆都要向司法院取內頁，桌面版上限為 500 筆）。
import { splitPassages } from '@judge/core/dist/court/passages.js';
import { rankPassages, groupByCase } from '@judge/core/dist/ai/semanticRank.js';
import { askScopedQuestion } from '@judge/core/dist/ai/scopedQa.js';
export { splitPassages, rankPassages, groupByCase, askScopedQuestion };

export const WEB_MAX_CANDIDATES = 40;

const COURT_PATTERN = { supreme: /最高法院/, high: /高等(行政)?法院/, district: /地方法院/ };
const CASE_TYPE_PATTERN = { criminal: /刑事/, civil: /民事/, family: /家事/, administrative: /行政法院|行政訴訟/ };

export function normalizeFilter(raw) {
  const r = raw || {};
  const courtLevel = r.courtLevel && r.courtLevel in COURT_PATTERN ? r.courtLevel : 'all';
  const caseType = r.caseType && r.caseType in CASE_TYPE_PATTERN ? r.caseType : 'all';
  const year = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 1900 && v < 2200 ? Math.floor(v) : undefined);
  return { courtLevel: courtLevel, caseType: caseType, yearFrom: year(r.yearFrom), yearTo: year(r.yearTo) };
}

/** 依標題（法院與字號、判決類型）與年份篩選搜尋結果；年份缺漏的筆數不因年份被排除。 */
export function filterSummaries(items, filter) {
  return items.filter(function (it) {
    if (filter.courtLevel !== 'all' && !COURT_PATTERN[filter.courtLevel].test(it.title)) return false;
    if (filter.caseType !== 'all' && !CASE_TYPE_PATTERN[filter.caseType].test(it.title)) return false;
    const year = it.dateIso ? Number(String(it.dateIso).slice(0, 4)) : null;
    if (filter.yearFrom && year && year < filter.yearFrom) return false;
    if (filter.yearTo && year && year > filter.yearTo) return false;
    return true;
  });
}

/**
 * 段落檢索的主流程。deps：{ search(keyword, max) → 候選, detail(id) → 判決內文, ai?, aiError?, signal, onProgress? }。
 * 與桌面版相同的回傳形狀（hits、bySimilarity、byCaseNo、sources、notes、notice、scoreSource、cancelled）。
 */
export async function runSemanticSearch(args, deps) {
  const max = Math.min(Math.max(args.maxCandidates || WEB_MAX_CANDIDATES, 1), WEB_MAX_CANDIDATES);
  const found = await deps.search(args.keyword, max);
  const considered = filterSummaries(found, args.filter).slice(0, max);
  const notes = [];
  const cands = [];
  const sources = {};
  let done = 0;
  for (const it of considered) {
    if (deps.signal.aborted) break;
    done++;
    if (deps.onProgress) deps.onProgress({ done: done, total: considered.length, phase: '讀取判決內文' });
    try {
      const d = await deps.detail(it.id);
      if (deps.signal.aborted) break;
      const meta = d.meta || {};
      cands.push({
        caseId: it.id,
        caseNo: meta.caseNo || null,
        dateIso: meta.dateIso || it.dateIso,
        fullText: d.fullText || '',
        passages: splitPassages(it.id, d.sections || {}),
      });
      sources[it.id] = { title: meta.title || it.title, court: meta.court || null, href: meta.sourceUrl || it.href || null };
    } catch (err) {
      notes.push(it.id + '：' + ((err && err.message) || '取得內文失敗'));
    }
  }
  if (found.length > considered.length) notes.push('網頁版一次最多讀取 ' + WEB_MAX_CANDIDATES + ' 筆內文，其餘未讀取。');
  const base = { candidates: found.length, considered: considered.length, fetched: cands.length, sources: sources, notes: notes };
  if (deps.signal.aborted) {
    return Object.assign(base, { hits: [], scoreSource: 'keyword', notice: '已取消，未完成段落排序。', discarded: 0, bySimilarity: [], byCaseNo: [], cancelled: true });
  }
  const r = await rankPassages(deps.ai, args.query, args.kind, cands);
  const notice = !deps.ai && deps.aiError ? deps.aiError + '，已改以關鍵字排序（非語意）。' : r.notice;
  return Object.assign(base, {
    hits: r.hits,
    scoreSource: r.scoreSource,
    notice: notice,
    discarded: r.discarded,
    bySimilarity: groupByCase(r.hits, 'similarity'),
    byCaseNo: groupByCase(r.hits, 'caseNo'),
    cancelled: false,
  });
}
