// 視圖：把頁面模板掛載到 #pages（需在控制器綁定事件之前執行）。
(function (JR) {
  'use strict';

  // authGate 是覆蓋畫面的登入閘門（不是頁面，但與頁面同樣以模板掛載）。
  // 頁面順序依研究流程：研究設計 → 列表 → 段落檢索 → 標編碼 → 納入排除 → 單一判決 → 圖表 → 檔案（結果承接）→ 工具 → 設定。
  // crawl 是「工具」的子頁，不在導覽列；authGate 是覆蓋畫面的登入閘門。
  var ORDER = ['home', 'design', 'list', 'semantic', 'scope', 'criteria', 'brief', 'chart', 'files', 'tools', 'crawl', 'settings', 'authGate'];

  JR.views.mountPages = function () {
    var html = ORDER.map(function (n) { return JR.templates[n + 'Page']; }).join('\n');
    // 設定頁的工作負載身分聯盟引導面板（v3.7.0），以佔位符標示插入位置。
    html = html.replace('@@FED_PANEL@@', function () { return JR.templates.fedPanel; });
    // 網頁版的 AI 由雲端與訂閱提供，不需要本機金鑰；桌面版的提示保持原樣。
    if (JR.platform !== 'desktop') {
      html = html.split('請先在「設定」輸入 AI 金鑰').join('網頁版由雲端提供 AI，不需要金鑰');
      // 網頁版的納入排除匯出是 CSV（桌面版為 Excel）。
      html = html.split('id="critExport" disabled>匯出 Excel').join('id="critExport" disabled>匯出 CSV');
    }
    JR.$('pages').innerHTML = html;
    // 頁面模板是在外殼之後才插入的，所以桌面專用的區塊要在這裡隱藏（網頁版）。
    if (JR.platform !== 'desktop') {
      JR.$('pages').querySelectorAll('[data-desktop-only]').forEach(function (el) { el.hidden = true; el.style.display = 'none'; });
    }
  };
})(window.JR);
