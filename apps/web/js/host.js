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

  // 研究設計（雲端）：需要登入。runId 用來取消進行中的對話（AbortController）。
  var DESIGN_ENDPOINT = 'https://judge-remote-mcp-2026.web.app/api/design';
  var designAborts = {};
  var DESIGN_ERRORS = {
    subscription_required: '尚未訂閱或訂閱已到期。',
    monthly_quota_exceeded: '本月 AI 用量已用完。',
    upstream_auth_failed: '雲端 AI 暫時無法使用（上游金鑰未設定或無效）。',
    not_found: '找不到這筆研究設計，可能已被刪除。',
  };
  function designFetch(method, suffix, body, runId) {
    return window.JRAuth.getIdToken().then(function (token) {
      if (!token) return Promise.reject(new Error('請先登入。'));
      var init = { method: method, headers: { authorization: 'Bearer ' + token } };
      if (body !== undefined) {
        init.headers['content-type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      var ctrl = null;
      if (runId) {
        ctrl = new AbortController();
        designAborts[runId] = ctrl;
        init.signal = ctrl.signal;
      }
      return fetch(DESIGN_ENDPOINT + suffix, init).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          if (!res.ok) throw new Error(j.message || DESIGN_ERRORS[j.error] || ('研究設計失敗：HTTP ' + res.status));
          return j;
        });
      }, function (err) {
        if (err && err.name === 'AbortError') throw new Error('已取消。');
        throw err;
      }).finally(function () {
        if (runId) delete designAborts[runId];
      });
    });
  }

  // 檔案庫：登入後把結果保存到雲端（與桌面端「檔案」相同）。回傳 null 表示已保存，否則是失敗原因。
  var LIBRARY_ENDPOINT = 'https://judge-remote-mcp-2026.web.app/api/library';
  // 檔案庫的一般呼叫（需要登入）：失敗時拋出錯誤，訊息來自雲端。
  function libraryFetch(method, suffix, body) {
    return window.JRAuth.getIdToken().then(function (token) {
      if (!token) return Promise.reject(new Error('請先登入。'));
      var init = { method: method, headers: { authorization: 'Bearer ' + token } };
      if (body !== undefined) {
        init.headers['content-type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      return fetch(LIBRARY_ENDPOINT + suffix, init);
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok) throw new Error(j.message || ('檔案庫錯誤：HTTP ' + res.status));
        return j;
      });
    });
  }
  // 檔案列表的摘要（網頁版雲端只存中繼資料，摘要由內容推算）。
  function librarySummary(kind, p) {
    if (kind === 'list') return ((p.items || []).length) + ' 筆判決';
    if (kind === 'scope') return ((p.sheets || []).length) + ' 個法規';
    if (kind === 'brief') return '精讀文書';
    return '';
  }
  function saveLibrary(kind, title, payload) {
    return window.JRAuth.getIdToken().then(function (token) {
      if (!token) return '尚未登入，結果只顯示在本頁。';
      return fetch(LIBRARY_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
        body: JSON.stringify({ kind: kind, title: title, payload: payload }),
      }).then(function (res) {
        if (res.ok) return null;
        return res.json().catch(function () { return {}; }).then(function (j) {
          return '保存失敗：' + (j.message || ('HTTP ' + res.status)) + '（結果只顯示在本頁）';
        });
      });
    }).catch(function (err) {
      return '保存失敗：' + ((err && err.message) || '未知錯誤') + '（結果只顯示在本頁）';
    });
  }

  // 手動輸入：一行可以是判決網址（取 id 參數）或判決 ID。空行與明顯不是 ID 的內容回傳 null。
  function manualIdOf(line) {
    var s = String(line || '').trim();
    if (!s) return null;
    var m = /[?&]id=([^&#\s]+)/.exec(s);
    if (m) {
      try { s = decodeURIComponent(m[1]); } catch (e) { s = m[1]; }
    }
    return /^[^\s<>"']{3,200}$/.test(s) ? s : null;
  }

  // 範圍整理的分析欄位：只取勾選的；沒有設定時回傳 null（核心使用預設欄位）。
  function scopeFieldsFromArgs(args) {
    var list = (args && Array.isArray(args.fields)) ? args.fields : [];
    var picked = list.filter(function (f) { return f && f.enabled !== false && String(f.name || '').trim(); })
      .map(function (f) { return { id: String(f.id || f.name), name: String(f.name), description: String(f.description || '') }; });
    return picked.length ? picked : null;
  }
  // 把 MCP 回傳的判決列補齊成核心 ScopeRow 需要的欄位。
  function toScopeRow(r) {
    return Object.assign({
      id: '', title: '', court: null, dateIso: null, cause: '', result: '', citedArticles: [], lawNotes: [],
      historyPosition: '', excerpts: { main: '', citing: '' }, href: '',
    }, r, { citedArticles: (r && r.citedArticles) || [], lawNotes: (r && r.lawNotes) || [], excerpts: (r && r.excerpts) || { main: '', citing: '' } });
  }
  function scopeExplanation() {
    return {
      title: '範圍整理',
      paragraphs: ['依法規列出確實引用該法規的判決；逐案由 AI 依判決原文編碼，每格附逐字依據，對不上的標示為待覆核。網頁版的結果只顯示在本頁，請自行匯出。'],
    };
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
          var bdetail = json.detail;
          var bdoc = json.document;
          var btitle = (bdoc && bdoc.title) || (bdetail && bdetail.meta && bdetail.meta.title) || '精讀';
          return saveLibrary('brief', btitle, { detail: bdetail, doc: bdoc }).then(function (saveError) {
            return { detail: bdetail, doc: bdoc, saveError: saveError };
          });
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
    // 精讀文書匯出（Word）：雲端產生檔案，取得下載連結後直接下載。
    'brief.export': function (args) {
      return window.JRAuth.getIdToken().then(function (token) {
        if (!token) return Promise.reject(new Error('請先登入。'));
        return fetch('https://judge-remote-mcp-2026.web.app/api/export/brief', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
          body: JSON.stringify({ detail: (args && args.detail) || {}, doc: (args && args.doc) || {} }),
        });
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (json) {
          if (!res.ok) throw new Error(json.message || ('匯出失敗：HTTP ' + res.status));
          window.location.href = json.url;
          return { canceled: false, filePath: json.name };
        });
      });
    },
    // 手動輸入判決：每行一則網址或 ID，逐筆取得判決資料（MCP get_judgment_detail）；最多 20 則，單則失敗只記錄。
    'search.manual': function (args) {
      var lines = String((args && args.text) || '').split(/\n/).map(manualIdOf).filter(Boolean);
      var uniq = lines.filter(function (id, i) { return lines.indexOf(id) === i; }).slice(0, 20);
      var items = [];
      var details = {};
      var notes = [];
      if (uniq.length === 0) return Promise.resolve({ items: [], details: {}, cancelled: false, saveError: null, notes: [] });
      return uniq.reduce(function (chain, id) {
        return chain.then(function () {
          return client.call('get_judgment_detail', { judgment_id: id }).then(function (d) {
            var m = d.meta || {};
            details[id] = d;
            items.push({
              id: id,
              title: m.title || id,
              dateIso: m.dateIso || null,
              cause: m.cause || '',
              href: m.sourceUrl || null,
            });
          }).catch(function (err) {
            notes.push('「' + id + '」取得失敗：' + ((err && err.message) || '未知錯誤'));
          });
        });
      }, Promise.resolve()).then(function () {
        return saveLibrary('list', '手動輸入（' + items.length + ' 筆）', { items: items, details: details, keyword: '手動輸入' }).then(function (saveError) {
          return { items: items, details: details, cancelled: false, saveError: saveError, notes: notes };
        });
      });
    },
    // 檔案庫：列出（含完整內容，供開啟）、更新（加星、封存、移入垃圾桶、還原）、刪除。
    'library.list': function (args) {
      var status = args && args.status ? '?status=' + encodeURIComponent(args.status) : '';
      return libraryFetch('GET', '' + status).then(function (j) {
        var items = j.items || [];
        return Promise.all(items.map(function (it) {
          return libraryFetch('GET', '/' + encodeURIComponent(it.id)).then(function (full) {
            var p = full.payload || {};
            return Object.assign({}, it, { payload: p, summary: librarySummary(it.kind, p) });
          }, function () { return Object.assign({}, it, { summary: '' }); });
        }));
      });
    },
    'library.update': function (args) {
      return libraryFetch('PATCH', '/' + encodeURIComponent(args.id), { patch: args.patch || {} });
    },
    'library.remove': function (args) {
      return libraryFetch('DELETE', '/' + encodeURIComponent(args.id));
    },
    // 研究設計：多輪對話與欄位保存在雲端（/api/design）。AI 的回覆以結構化的 respond 送回（回覆文字＋選項）。
    'design.list': function () {
      return designFetch('GET', '').then(function (j) { return j.items || []; });
    },
    'design.get': function (args) {
      return designFetch('GET', '/' + encodeURIComponent(args.id));
    },
    'design.chat': function (args) {
      return designFetch('POST', '/chat', { id: (args && args.id) || undefined, text: String((args && args.text) || '') }, args && args.runId);
    },
    'design.setFields': function (args) {
      return designFetch('PATCH', '/' + encodeURIComponent(args.id), { fields: args.fields || {} });
    },
    'design.remove': function (args) {
      return designFetch('DELETE', '/' + encodeURIComponent(args.id));
    },
    'design.export': function (args) {
      return designFetch('POST', '/export', { id: args.id, format: args.format === 'txt' ? 'txt' : 'docx' }).then(function (json) {
        window.location.href = json.url;
        return { canceled: false, filePath: json.name };
      });
    },
    // 工作取消：以 runId 中止進行中的請求（網頁版的雲端工作）。
    'jobs.cancel': function (args) {
      var id = args && args.id;
      if (id && designAborts[id]) designAborts[id].abort();
      return Promise.resolve({ ok: true });
    },
    'jobs.list': function () { return Promise.resolve([]); },
    'jobs.onChanged': function () { /* 網頁版沒有背景工作橫幅 */ },
    // 設定頁「測試連線」：送一次極小的請求經雲端 AI，確認訂閱與上游可用。
    'settings.test': function () {
      return aiComplete('你是連線測試。只回覆「OK」兩個字。', '測試', 10).then(function (reply) {
        return { reply: String(reply || '').slice(0, 40) || '（空白回覆）' };
      });
    },
    // 背景工作通知（網頁版）：偏好保存在這個瀏覽器；測試通知使用瀏覽器的通知功能。
    'worker.settingsGet': function () {
      var s = {};
      try { s = JSON.parse(localStorage.getItem('jrWebWorker') || '{}') || {}; } catch (e) { s = {}; }
      return Promise.resolve({ enabled: !!s.enabled, style: s.style === 'system' ? 'system' : 'custom' });
    },
    'worker.settingsSet': function (patch) {
      var s = {};
      try { s = JSON.parse(localStorage.getItem('jrWebWorker') || '{}') || {}; } catch (e) { s = {}; }
      if (patch && typeof patch.enabled === 'boolean') s.enabled = patch.enabled;
      if (patch && (patch.style === 'system' || patch.style === 'custom')) s.style = patch.style;
      try { localStorage.setItem('jrWebWorker', JSON.stringify(s)); } catch (e) { /* 無法保存時只影響這次工作階段 */ }
      return Promise.resolve({ enabled: !!s.enabled, style: s.style === 'system' ? 'system' : 'custom' });
    },
    'worker.test': function () {
      var s = {};
      try { s = JSON.parse(localStorage.getItem('jrWebWorker') || '{}') || {}; } catch (e) { s = {}; }
      if (!s.enabled) return Promise.resolve({ channel: 'none' });
      if (!('Notification' in window)) return Promise.reject(new Error('這個瀏覽器不支援通知。'));
      var show = function () { new Notification('司法院裁判研究', { body: '這是測試通知。' }); return { channel: 'custom' }; };
      if (Notification.permission === 'granted') return Promise.resolve(show());
      if (Notification.permission === 'denied') return Promise.reject(new Error('瀏覽器已封鎖通知，請到網站設定中允許。'));
      return Notification.requestPermission().then(function (p) {
        if (p !== 'granted') throw new Error('未允許通知。');
        return show();
      });
    },
    'worker.list': function () { return Promise.resolve([]); },
    'worker.onChanged': function () { /* 網頁版沒有背景工作 */ },
    'worker.onOpen': function () { /* 網頁版沒有背景工作 */ },
    // 範圍整理：按鈕可用狀態（核心 scopeUiState，與桌面端相同的規則）。
    'scope.controls': function (args) {
      return Promise.resolve(window.JRScope.scopeUiState(args || {}));
    },
    // 依據原文：取得判決全文，找出依據（逐字）的位置。找不到時照實說明，不猜。
    'scope.judgmentText': function (args) {
      var id = String(args && args.id || '');
      var quote = String(args && args.quote || '');
      return client.call('get_judgment_detail', { judgment_id: id }).then(function (d) {
        var text = String(d.fullText || '');
        var title = (d.meta && (d.meta.title || d.meta.id)) || id;
        if (!text) return { ok: false, title: title, text: '', error: '這則判決沒有可用的原文。' };
        var at = quote ? text.indexOf(quote) : -1;
        if (at < 0) {
          return { ok: false, title: title, text: text, error: '在判決原文中找不到這段依據（可能是 AI 改寫過，請以原文為準）。' };
        }
        return { ok: true, title: title, text: text, span: { start: at, end: at + quote.length }, message: '已在原文中標示依據。' };
      });
    },
    // 範圍整理匯出：Excel（xlsx）由雲端產生；Word（docx）尚未對應，照實回報。
    'scope.export': function (args) {
      var wantDocx = !!(args && args.format === 'docx');
      return window.JRAuth.getIdToken().then(function (token) {
        if (!token) return Promise.reject(new Error('請先登入。'));
        return fetch('https://judge-remote-mcp-2026.web.app/api/export/scope', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
          body: JSON.stringify({ sheets: (args && args.sheets) || [], format: wantDocx ? 'docx' : 'xlsx' }),
        });
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (json) {
          if (!res.ok) throw new Error(json.message || ('匯出失敗：HTTP ' + res.status));
          window.location.href = json.url;
          return { canceled: false, filePath: json.name };
        });
      });
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
    // 範圍整理（標編碼標注工序）：每個法規以 MCP scope_table 列出判決，逐案取得全文，
    // 由核心 analyzeCase 分析（AI 經 aiProxy），最後以 synthesizeScope 綜合。在瀏覽器依序執行，每次請求都在限時內。
    'scope.run': function (args) {
      var statutes = Array.isArray(args && args.statutes) ? args.statutes : String((args && args.statutes) || '').split(/\n/);
      statutes = statutes.map(function (s) { return String(s || '').trim(); }).filter(Boolean);
      var fields = scopeFieldsFromArgs(args);
      var fieldList = fields || window.JRScope.DEFAULT_CODING_FIELDS;
      var max = Math.min(10, Math.max(1, Number(args && args.maxItems) || 5));
      var sheets = [];
      var notes = [];
      if (statutes.length === 0) {
        return Promise.resolve({ status: 'done', sheets: [], explanation: scopeExplanation(), flow: null, libraryId: null, notes: ['請輸入至少一部法規。'], cancelled: false, saveError: null });
      }
      return statutes.reduce(function (chain, statute) {
        return chain.then(function () {
          return client.call('scope_table', {
            statute: statute,
            year_from: args.yearFrom || undefined,
            year_to: args.yearTo || undefined,
            max_items: max,
          }).then(function (tbl) {
            var rows = (tbl.rows || []).map(toScopeRow);
            var analyses = [];
            return rows.reduce(function (q, row) {
              return q.then(function () {
                return client.call('get_judgment_detail', { judgment_id: row.id }).then(function (detail) {
                  return window.JRScope.analyzeCase(aiComplete, statute, row, detail, fields ? { fields: fields } : {});
                }).then(function (a) {
                  analyses.push(a);
                }).catch(function (err) {
                  notes.push('「' + row.title + '」未能分析：' + ((err && err.message) || '未知錯誤'));
                });
              });
            }, Promise.resolve()).then(function () {
              var sheet = { statute: statute, fields: fieldList, rows: rows, analyses: analyses };
              if (analyses.length === 0) return sheet;
              return window.JRScope.synthesizeScope(aiComplete, statute, analyses).then(function (syn) {
                sheet.synthesis = syn;
                return sheet;
              }).catch(function (err) {
                notes.push('綜合分析未完成：' + ((err && err.message) || '未知錯誤'));
                return sheet;
              });
            });
          }).then(function (sheet) {
            sheets.push(sheet);
          });
        });
      }, Promise.resolve()).then(function () {
        var sheetTitle = '範圍整理：' + statutes.join('、');
        return saveLibrary('scope', sheetTitle, { sheets: sheets, explanation: scopeExplanation(), flow: null, yearFrom: args.yearFrom || null, yearTo: args.yearTo || null }).then(function (saveError) {
          return { status: 'done', sheets: sheets, explanation: scopeExplanation(), flow: null, libraryId: null, notes: notes, cancelled: false, saveError: saveError };
        });
      });
    },
    // 覆核：摘要（待覆核數、高信心數），或套用一個覆核操作（接受、修改、拒絕、批次接受、還原）。
    'scope.review': function (args) {
      var J = window.JRScope;
      var sheets = (args && args.sheets) || [];
      if (args && args.op) {
        var applied = J.applyReviewOp(sheets, args.op);
        return Promise.resolve({ sheets: applied.sheets, changed: applied.changed, summaries: applied.sheets.map(function (s) { return J.summarizeReview(s); }) });
      }
      return Promise.resolve({ summaries: sheets.map(function (s) { return J.summarizeReview(s); }) });
    },
    'nl.criteria': function (args) {
      return window.JRNl.interpretCriteria(getAi, String(args && args.text || ''));
    },
    'search.run': function (args) {
      var max = Math.min(20, Number(args && args.maxItems) || 20);
      return client.call('quick_search', { keyword: String(args && args.keyword || ''), max_items: max }).then(function (d) {
        var listItems = (d.items || []).map(toItem);
        var kw = String(args && args.keyword || '');
        return saveLibrary('list', '搜尋：' + (kw || '（無關鍵字）'), { items: listItems, details: {}, keyword: kw }).then(function (saveError) {
          return { items: listItems, details: null, cancelled: false, saveError: saveError };
        });
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
