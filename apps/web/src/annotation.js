// 個案研究筆記（網頁版）：與桌面版 services/annotationService.ts 相同的資料模型與規則。
// 標注保存在雲端的同步文件（/api/annotations，每位使用者一份，帶版本號；不含判決全文）。網頁版讀取、修改後以 baseRevision 寫回；
// 版本衝突（409）時重讀後重新套用同一個修改。打包為 js/annotation.js，掛到 window.JRAnnotation。
import {
  makeAnnotation, anchorStatus, reanchor, updateAnnotation, removeAnnotation, segmentText,
  HIGHLIGHT_COLORS, DEFAULT_COLOR_LABELS,
} from '@judge/core/dist/annotation/anchor.js';

export { HIGHLIGHT_COLORS, DEFAULT_COLOR_LABELS, segmentText };

export const COLOR_LABEL_MAX = 12;

export function resolveColorLabels(custom) {
  const out = Object.assign({}, DEFAULT_COLOR_LABELS);
  HIGHLIGHT_COLORS.forEach(function (c) {
    const v = custom && custom[c];
    if (typeof v === 'string' && v.trim()) out[c] = v.trim();
  });
  return out;
}

export function validateColorLabels(input, base) {
  if (!input || typeof input !== 'object') throw new Error('顏色名稱格式不正確');
  const out = Object.assign({}, base || DEFAULT_COLOR_LABELS);
  HIGHLIGHT_COLORS.forEach(function (c) {
    const v = input[c];
    if (v === undefined) return;
    if (typeof v !== 'string') throw new Error('顏色名稱必須是文字');
    const t = v.trim();
    if (!t) throw new Error('顏色名稱不可空白');
    if (t.length > COLOR_LABEL_MAX || /[\r\n]/.test(t)) throw new Error('顏色名稱最多 ' + COLOR_LABEL_MAX + ' 字，且不可換行');
    out[c] = t;
  });
  return out;
}

/** 同步文件（雲端）→ 本機的檔案形狀（judgments 為物件、tombstones 為物件）。 */
export function fileFromPayload(payload) {
  const file = { judgments: {}, tombstones: {} };
  if (payload && Array.isArray(payload.judgments)) {
    payload.judgments.forEach(function (j) {
      if (!j || !j.judgmentId) return;
      file.judgments[j.judgmentId] = { meta: j.meta, annotations: Array.isArray(j.annotations) ? j.annotations : [] };
    });
  }
  if (payload && Array.isArray(payload.tombstones)) {
    payload.tombstones.forEach(function (t) {
      if (t && t.id) file.tombstones[t.id] = { judgmentId: t.judgmentId, deletedAt: t.deletedAt };
    });
  }
  if (payload && payload.colorLabels) file.colorLabels = payload.colorLabels;
  return file;
}

/** 本機的檔案形狀 → 同步文件（與桌面版 buildSyncPayload 相同的欄位）。 */
export function payloadFromFile(file, now) {
  const out = {
    schemaVersion: 1,
    exportedAt: (now || new Date()).toISOString(),
    judgments: Object.keys(file.judgments || {}).map(function (id) {
      const e = file.judgments[id];
      return { judgmentId: id, meta: e.meta, annotations: e.annotations };
    }).filter(function (j) { return j.annotations.length > 0; }),
    tombstones: Object.keys(file.tombstones || {}).map(function (id) {
      const t = file.tombstones[id];
      return { id: id, judgmentId: t.judgmentId, deletedAt: t.deletedAt };
    }),
  };
  if (file.colorLabels) out.colorLabels = resolveColorLabels(file.colorLabels);
  return out;
}

export function withStatus(annotations, fullText) {
  return (annotations || []).map(function (a) { return Object.assign({}, a, { status: anchorStatus(a, fullText) }); });
}

export function addToFile(file, judgmentId, meta, input, fullText, now) {
  const annotation = makeAnnotation(Object.assign({}, input, { judgmentId: judgmentId }), fullText, now || new Date());
  const prev = file.judgments[judgmentId];
  const judgments = Object.assign({}, file.judgments);
  judgments[judgmentId] = { meta: meta, annotations: (prev ? prev.annotations : []).concat([annotation]) };
  return { file: Object.assign({}, file, { judgments: judgments }), annotation: annotation };
}

export function patchInFile(file, judgmentId, id, patch, now) {
  const entry = file.judgments[judgmentId];
  if (!entry || !entry.annotations.some(function (a) { return a.id === id; })) throw new Error('找不到這筆標注');
  const judgments = Object.assign({}, file.judgments);
  judgments[judgmentId] = Object.assign({}, entry, { annotations: updateAnnotation(entry.annotations, id, patch, now || new Date()) });
  return Object.assign({}, file, { judgments: judgments });
}

export function removeFromFile(file, judgmentId, id, now) {
  const entry = file.judgments[judgmentId];
  if (!entry || !entry.annotations.some(function (a) { return a.id === id; })) return { file: file, removed: false };
  const judgments = Object.assign({}, file.judgments);
  judgments[judgmentId] = Object.assign({}, entry, { annotations: removeAnnotation(entry.annotations, id) });
  const tombstones = Object.assign({}, file.tombstones || {});
  tombstones[id] = { judgmentId: judgmentId, deletedAt: (now || new Date()).toISOString() };
  return { file: Object.assign({}, file, { judgments: judgments, tombstones: tombstones }), removed: true };
}

export function listJudgments(file) {
  return Object.keys(file.judgments).map(function (id) {
    const e = file.judgments[id];
    return { judgmentId: id, meta: e.meta, count: e.annotations.length };
  }).sort(function (a, b) { return String(a.meta.title).localeCompare(String(b.meta.title)); });
}

export { anchorStatus, reanchor };
