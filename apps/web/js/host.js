// 網頁版外殼：提供與桌面版相同形狀的 api（window.api 的契約），並把平台設為 web。
// 目前尚未接上雲端（judge-remote-mcp）的端點：每個呼叫都會回報「尚未連接」，之後逐一改為 HTTP 呼叫即可。
(function () {
  'use strict';
  function unavailable(path) {
    return Promise.reject(new Error('網頁版尚未連接雲端服務：' + path));
  }
  function make(path) {
    return new Proxy(function () {}, {
      get: function (_target, prop) {
        if (prop === 'then') return undefined;
        return make(path ? path + '.' + String(prop) : String(prop));
      },
      apply: function () { return unavailable(path); },
    });
  }
  window.__JR_HOST = { api: make(''), platform: 'web' };
})();
