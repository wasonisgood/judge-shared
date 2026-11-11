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
    // 助理：對話交給雲端代理（工具呼叫查判決後回答）。畫面操作（填欄位、切頁）尚未對應，回傳空的 ui／navigate。
    'assistant.chat': function (args) {
      var history = (args && args.history) || [];
      var msgs = history.filter(function (h) { return h && (h.role === 'user' || h.role === 'assistant') && h.text; })
        .map(function (h) { return { role: h.role, content: String(h.text) }; });
      msgs.push({ role: 'user', content: String((args && args.text) || '') });
      return agentChat(msgs).then(function (r) {
        var reply = r.text || '（沒有回覆）';
        if (r.stopped === 'max_steps') reply += '\n\n（已達查詢步數上限，若結果不完整請縮小問題再問一次。）';
        return { reply: reply, navigate: null, ui: [], pending: [] };
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
