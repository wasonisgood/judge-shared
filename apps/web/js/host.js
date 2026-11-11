// 網頁版外殼：提供與桌面版相同形狀的 api（window.api 的契約），平台為 web。
// - 登入：Firebase Auth（window.JRAuth，見 src/auth.js），在網頁內完成，不跳轉到 MCP。
// - 雲端：judge-remote-mcp 的 tools/call，權杖為 Firebase ID Token（雲端以 verifyIdToken 驗證）。
// 尚未對應的功能會回報「網頁版尚未支援」；事件訂閱（onXxx）回傳空的取消函式。
(function () {
  'use strict';
  var MCP_ENDPOINT = 'https://judge-remote-mcp-2026.web.app/mcp';
  var client = window.JRMcp.createClient({
    endpoint: MCP_ENDPOINT,
    getToken: function () { return window.JRAuth.getIdToken(); },
  });

  // AI 模型（OpenAI 相容的模型名稱，需在雲端 ALLOWED_MODELS 內）。
  var WEB_AI_MODEL = 'anthropic/claude-haiku-4.5';
  var aiComplete = window.JRMcp.createAiComplete({
    endpoint: 'https://judge-remote-mcp-2026.web.app/aiProxy',
    model: WEB_AI_MODEL,
    getToken: function () { return window.JRAuth.getIdToken(); },
  });
  var agentChat = window.JRMcp.createAgentChat({
    endpoint: 'https://judge-remote-mcp-2026.web.app/api/agent',
    model: WEB_AI_MODEL,
    getToken: function () { return window.JRAuth.getIdToken(); },
  });
  // core 的 interpret* 介面需要 () => Promise<AiComplete>。
  function getAi() { return Promise.resolve(aiComplete); }

  // 網頁版的設定預設值（精讀欄位取自核心的預設欄位）。
  var WEB_SETTINGS_DEFAULTS = {
    aiProvider: 'anthropic',
    aiAuthMode: 'cloud',
    aiBaseUrl: '',
    aiModel: WEB_AI_MODEL,
    hasKey: true,
    cacheDays: 7,
    defaultJurisdiction: 'tw',
    federation: {},
    scopeReviewPolicy: null,
    briefFields: [
      { name: '一、案件事實', description: '', enabled: true },
      { name: '二、爭點', description: '', enabled: true },
      { name: '三、當事人主張', description: '', enabled: true },
      { name: '四、法院見解', description: '', enabled: true },
      { name: '五、結論', description: '', enabled: true },
      { name: '六、與使用者重點相關的整理', description: '', enabled: true },
    ],
  };
  var WEB_SETTINGS_KEY = 'jrWebSettings';
  function readWebSettings() {
    try { return JSON.parse(window.localStorage.getItem(WEB_SETTINGS_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function writeWebSettings(obj) {
    try { window.localStorage.setItem(WEB_SETTINGS_KEY, JSON.stringify(obj)); } catch (e) { /* 無法保存時仍可在本次開啟中使用 */ }
  }

  function toItem(it) {
    return { id: it.id, title: it.title, dateIso: it.date_iso || null, cause: it.cause || '', href: it.href || null };
  }

  var handlers = {
    'auth.status': function () {
      return window.JRAuth.waitReady().then(function (u) {
        return u ? { signedIn: true, message: '', user: u } : { signedIn: false, message: '' };
      });
    },
    'auth.start': function () {
      return window.JRAuth.signInGoogle().then(function (u) {
        return { signedIn: !!u, message: '' };
      }).catch(function (err) {
        return { signedIn: false, message: '登入失敗：' + ((err && err.message) || '未知錯誤') };
      });
    },
    'auth.cancel': function () { return Promise.resolve({ signedIn: false, message: '已取消登入。' }); },
    'auth.signOut': function () { return window.JRAuth.signOut().then(function () { return { ok: true }; }); },
    // 自然語言解析：與桌面端相同的 core 邏輯（window.JRNl），AI 經雲端 aiProxy 呼叫。
    'nl.interpret': function (args) {
      return window.JRNl.interpretInput(getAi, String(args && args.page || 'list'), String(args && args.text || ''));
    },
    // 助理：對話交給雲端代理（工具呼叫查判決、設定欄位、切頁）。畫面操作由共用畫面的助理控制器套用。
    'assistant.chat': function (args) {
      var history = (args && args.history) || [];
      var msgs = history.filter(function (h) { return h && (h.role === 'user' || h.role === 'assistant') && h.text; })
        .map(function (h) { return { role: h.role, content: String(h.text) }; });
      msgs.push({ role: 'user', content: String((args && args.text) || '') });
      var catalog = (window.JR && JR.aiBridge && JR.aiBridge.catalog) ? JR.aiBridge.catalog() : [];
      var context = JSON.stringify(catalog).slice(0, 12000);
      return agentChat(msgs, context).then(function (r) {
        var reply = r.text || '（沒有回覆）';
        if (r.stopped === 'max_steps') reply += '\n\n（已達查詢步數上限，若結果不完整請縮小問題再問一次。）';
        return { reply: reply, navigate: r.navigate || null, ui: r.ui || [], pending: [] };
      });
    },
    // 精讀：雲端取得判決原文，由 AI 依欄位整理成文書（核心 briefJudgment）。
    'brief.run': function (args) {
      return window.JRAuth.getIdToken().then(function (token) {
        if (!token) return Promise.reject(new Error('請先登入。'));
        var fields = (args && args.fields) || [];
        return fetch('https://judge-remote-mcp-2026.web.app/api/brief', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
          body: JSON.stringify({
            judgmentId: String(args && args.judgmentId || ''),
            focus: String(args && args.focus || ''),
            length: String(args && args.lengthHint || '一般'),
            fields: fields,
          }),
        });
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (json) {
          if (!res.ok) {
            var map = { subscription_required: '尚未訂閱或訂閱已到期。', monthly_quota_exceeded: '本月 AI 用量已用完。', upstream_auth_failed: '雲端 AI 暫時無法使用（上游金鑰未設定或無效）。', no_body: '這則判決沒有可用的原文。' };
            throw new Error(json.message || map[json.error] || ('精讀失敗：HTTP ' + res.status));
          }
          return { detail: json.detail, doc: json.document };
        });
      });
    },
    // 設定（網頁版）：AI 由雲端與訂閱提供，不需要本機金鑰。欄位與偏好只保存在這個瀏覽器（不含任何金鑰）。
    'settings.get': function () {
      return Promise.resolve(Object.assign({}, WEB_SETTINGS_DEFAULTS, readWebSettings()));
    },
    'settings.set': function (patch) {
      var current = readWebSettings();
      var next = Object.assign({}, current, patch || {});
      delete next.apiKey;
      writeWebSettings(next);
      return Promise.resolve(Object.assign({}, WEB_SETTINGS_DEFAULTS, next));
    },
    'jurisdictions.list': function () {
      return Promise.resolve([{ id: 'tw', name: '司法院裁判書查詢系統', country: '台灣' }]);
    },
    // 判決列表匯出（Excel）：雲端產生檔案，取得下載連結後直接下載。
    'exportList': function (args) {
      return window.JRAuth.getIdToken().then(function (token) {
        if (!token) return Promise.reject(new Error('請先登入。'));
        return fetch('https://judge-remote-mcp-2026.web.app/api/export/list', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
          body: JSON.stringify({ keyword: String(args && args.keyword || ''), items: (args && args.items) || [] }),
        });
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (json) {
          if (!res.ok) throw new Error(json.message || ('匯出失敗：HTTP ' + res.status));
          window.location.href = json.url;
          return { canceled: false, filePath: json.name };
        });
      });
    },
    'nl.criteria': function (args) {
      return window.JRNl.interpretCriteria(getAi, String(args && args.text || ''));
    },
    'search.run': function (args) {
      var max = Math.min(20, Number(args && args.maxItems) || 20);
      return client.call('quick_search', { keyword: String(args && args.keyword || ''), max_items: max }).then(function (d) {
        return { items: (d.items || []).map(toItem), details: null, cancelled: false, saveError: null };
      });
    },
  };

  function make(path) {
    var last = path.split('.').pop();
    return new Proxy(function () {}, {
      get: function (_target, prop) {
        if (prop === 'then') return undefined;
        return make(path ? path + '.' + String(prop) : String(prop));
      },
      apply: function (_target, _this, args) {
        if (handlers[path]) return handlers[path].apply(null, args);
        if (/^on[A-Z]/.test(last)) return function () {};
        return Promise.reject(new Error('網頁版尚未支援：' + path));
      },
    });
  }

  window.__JR_HOST = { api: make(''), platform: 'web' };
})();
