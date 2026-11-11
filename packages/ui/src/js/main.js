// 啟動：掛載頁面、綁定各控制器，最後讀取設定與應用程式資訊。
(function (JR) {
  'use strict';
  var api = JR.api;

  JR.views.mountPages();
  JR.controllers.chrome.bind();
  JR.controllers.settings.bind();
  JR.controllers.federation.bind();
  JR.controllers.list.bind();
  JR.controllers.semantic.bind();
  JR.controllers.criteria.bind();
  JR.controllers.scope.bind();
  JR.controllers.brief.bind();
  JR.controllers.design.bind();
  JR.controllers.annotation.bind();
  JR.controllers.files.bind();
  JR.controllers.assistant.bind();
  JR.controllers.auth.bind();
  if (JR.platform === 'desktop') {
    JR.controllers.crawl.bind();
    JR.controllers.localAi.bind();
    JR.controllers.chart.bind();
    JR.controllers.worker.bind();
  }
  JR.jobs.init();

  if (JR.platform === 'desktop') {
    api.appInfo().then(function (info) {
      JR.$('versionInfo').textContent = '版本 ' + info.version + (info.packaged ? '' : '（開發版）');
    }).catch(function () {});
  }
  JR.controllers.settings.load();
  // 未登入時顯示登入閘門，覆蓋主畫面。
  JR.controllers.auth.checkOnStart();
})(window.JR);
