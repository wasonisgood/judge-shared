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

  // AI 呼叫（雲端 aiProxy，OpenAI 相容）。回傳 AiComplete(system, user, maxTokens) => Promise<string>，
  // 與桌面端 core 的 AiComplete 同一個介面，因此 core 的自然語言解析可直接使用。
  var AI_ERRORS = {
    402: '尚未訂閱或訂閱已到期，無法使用 AI 功能。',
    429: '本月 AI 用量已用完。',
    502: '雲端 AI 暫時無法使用（上游金鑰未設定或無效，或服務忙碌）。',
    503: '雲端 AI 尚未設定。',
  };
  function createAiComplete(opts) {
    var fetchImpl = opts.fetch || (typeof fetch === 'function' ? fetch : null);
    return function (system, user, maxTokens) {
      return Promise.resolve(opts.getToken ? opts.getToken() : null).then(function (token) {
        if (!token) throw authRequired();
        return fetchImpl(opts.endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json', authorization: 'Bearer ' + token },
          body: JSON.stringify({
            model: opts.model,
            max_tokens: maxTokens,
            messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          }),
        });
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (json) {
          if (res.status === 401) throw authRequired('登入已過期，請重新登入。');
          if (!res.ok) {
            var detail = (json.error && (json.error.message || json.error)) || '';
            throw new Error((AI_ERRORS[res.status] || ('AI 服務回應錯誤：HTTP ' + res.status)) + (typeof detail === 'string' && detail ? '（' + detail + '）' : ''));
          }
          var msg = json.choices && json.choices[0] && json.choices[0].message;
          return String((msg && msg.content) || '').trim();
        });
      });
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

  var api = { createClient: createClient, createAiComplete: createAiComplete, createPkce: createPkce, base64url: base64url, authRequired: authRequired };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JRMcp = api;
})(typeof window !== 'undefined' ? window : globalThis);
