// 網頁版的雲端用戶端（judge-remote-mcp 的 JSON-RPC over HTTP）。
// 瀏覽器與 Node 測試共用：在瀏覽器掛到 window.JRMcp，在 Node 以 module.exports 匯出。
(function (root) {
  'use strict';

  function authRequired(message) {
    var e = new Error(message || '請先登入。');
    e.code = 'auth_required';
    return e;
  }

  // 呼叫單一工具（tools/call）。回應形狀為 { schema, tool, ok, data, next }，本函式只回傳 data。
  // getToken 可回傳權杖或其 Promise（Firebase ID Token 需要非同步取得）。
  function createClient(opts) {
    var endpoint = opts.endpoint;
    var fetchImpl = opts.fetch || (typeof fetch === 'function' ? fetch : null);
    var nextId = 1;
    return {
      call: function (tool, args) {
        return Promise.resolve(opts.getToken ? opts.getToken() : null).then(function (token) {
          if (!token) throw authRequired();
          var body = JSON.stringify({
            jsonrpc: '2.0', id: nextId++, method: 'tools/call',
            params: { name: tool, arguments: args || {} },
          });
          return fetchImpl(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json', authorization: 'Bearer ' + token },
            body: body,
          });
        }).then(function (res) {
          if (res.status === 401) throw authRequired('登入已過期，請重新登入。');
          if (!res.ok) throw new Error('雲端服務回應錯誤：HTTP ' + res.status);
          return res.json();
        }).then(function (rpc) {
          if (rpc.error) throw new Error(rpc.error.message || '雲端服務錯誤');
          var env = rpc.result && (rpc.result.structuredContent ||
            (rpc.result.content && rpc.result.content[0] && JSON.parse(rpc.result.content[0].text)));
          if (!env) throw new Error('雲端服務回傳格式不正確');
          if (!env.ok) throw new Error((env.data && env.data.message) || '工具執行失敗：' + tool);
          return env.data;
        });
      },
    };
  }

  // PKCE（S256）：產生 verifier 與 challenge。需要 crypto.subtle（瀏覽器與 Node 22 皆有）。
  function base64url(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    var b64 = typeof btoa === 'function' ? btoa(s) : Buffer.from(bytes).toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function createPkce(cryptoImpl) {
    var c = cryptoImpl || (typeof crypto !== 'undefined' ? crypto : globalThis.crypto);
    var raw = new Uint8Array(32);
    c.getRandomValues(raw);
    var verifier = base64url(raw);
    return c.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(function (digest) {
      return { verifier: verifier, challenge: base64url(new Uint8Array(digest)), method: 'S256' };
    });
  }

  var api = { createClient: createClient, createPkce: createPkce, base64url: base64url, authRequired: authRequired };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JRMcp = api;
})(typeof window !== 'undefined' ? window : globalThis);
