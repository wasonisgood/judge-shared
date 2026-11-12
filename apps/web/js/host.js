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
  var semanticListeners = [];
  // 納入排除：目前讀取的一組候選判決（只在這個頁面的工作階段）；核查紀錄保存在這個瀏覽器。
  var criteriaPrep = null;
  var criteriaListeners = [];
  var CRITERIA_RUNS_KEY = 'jrWebCriteriaRuns';
  function requireCriteriaPrep(prepId) {
    if (!criteriaPrep || criteriaPrep.prepId !== prepId) throw new Error('候選判決已更新或已清除，請重新讀取候選判決。');
    return criteriaPrep;
  }
  function readCriteriaRuns() {
    try { return JSON.parse(localStorage.getItem(CRITERIA_RUNS_KEY) || '[]') || []; } catch (e) { return []; }
  }
  function writeCriteriaRuns(runs) {
    localStorage.setItem(CRITERIA_RUNS_KEY, JSON.stringify(runs));
  }
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

  // 個案研究筆記的共用函式（網頁版）。
  var ANN_ENDPOINT = 'https://judge-remote-mcp-2026.web.app/api/annotations';
  function annCheckChoice(color, mode) {
    if (window.JRAnnotation.HIGHLIGHT_COLORS.indexOf(color) < 0) throw new Error('不支援的螢光顏色');
    if (['highlight', 'highlight_note'].indexOf(mode) < 0) throw new Error('不支援的標注模式');
  }
  // 判決的資料（全文、主文、顯示資訊）：經 MCP 取得。
  function annDetail(judgmentId) {
    return client.call('get_judgment_detail', { judgment_id: String(judgmentId || '') }).then(function (d) {
      var m = d.meta || {};
      if (!String(d.fullText || '').trim()) throw new Error('這則判決沒有可用的原文，無法標注。');
      return {
        fullText: d.fullText,
        mainText: (d.sections || {})['主文'] || '',
        meta: {
          title: m.title || m.id || judgmentId, caseNo: m.caseNo || '', court: m.court || '',
          dateIso: m.dateIso || m.dateMinguo || '', cause: m.cause || '', sourceUrl: m.sourceUrl || '', jurisdiction: '',
        },
      };
    });
  }
  function annFetch(method, body) {
    return window.JRAuth.getIdToken().then(function (token) {
      if (!token) throw new Error('請先登入。');
      var init = { method: method, headers: { authorization: 'Bearer ' + token } };
      if (body !== undefined) {
        init.headers['content-type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      return fetch(ANN_ENDPOINT, init);
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) { return { status: res.status, body: j }; });
    });
  }
  /** 讀取目前的標注文件：檔案形狀與版本號。 */
  function annRead() {
    return annFetch('GET').then(function (r) {
      if (r.status !== 200) throw new Error(r.body.message || ('無法讀取標注（HTTP ' + r.status + '）。'));
      return { file: window.JRAnnotation.fileFromPayload(r.body.payload), revision: r.body.revision || 0 };
    });
  }
  /** 讀取 → 套用修改 → 以版本號寫回；版本衝突（409）時重讀後重新套用。mutator 回傳 { file, result } 或 { skip, result }。 */
  function annMutate(mutator, attempt) {
    attempt = attempt || 0;
    return annRead().then(function (cur) {
      var out = mutator(cur.file);
      if (out.skip) return out.result;
      return annFetch('PUT', { baseRevision: cur.revision, payload: window.JRAnnotation.payloadFromFile(out.file) }).then(function (r) {
        if (r.status === 200) return out.result;
        if (r.status === 409 && attempt < 2) return annMutate(mutator, attempt + 1);
        throw new Error(r.body.message || ('標注保存失敗（HTTP ' + r.status + '）。'));
      });
    });
  }
  /** 匯出 Word：由雲端依版面產生（與桌面版相同），完成後下載。 */
  function annExport(judgmentIds) {
    return Promise.all(judgmentIds.map(function (id) {
      return annDetail(id).then(function (det) {
        return annRead().then(function (cur) {
          var entry = cur.file.judgments[id];
          var all = window.JRAnnotation.withStatus(entry ? entry.annotations : [], det.fullText);
          return {
            meta: det.meta,
            fullText: det.fullText,
            annotations: all.filter(function (a) { return a.status === 'ok'; }),
            stale: all.filter(function (a) { return a.status !== 'ok'; }),
          };
        });
      });
    })).then(function (cases) {
      return annRead().then(function (cur) {
        return window.JRAuth.getIdToken().then(function (token) {
          if (!token) throw new Error('請先登入。');
          return fetch('https://judge-remote-mcp-2026.web.app/api/export/annotated', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
            body: JSON.stringify({ cases: cases, colorLabels: window.JRAnnotation.resolveColorLabels(cur.file.colorLabels) }),
          });
        }).then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (j) {
            if (!res.ok) throw new Error(j.message || ('匯出失敗：HTTP ' + res.status));
            downloadFile(j.url, j.name);
            return { canceled: false, filePath: j.name };
          });
        });
      });
    });
  }

  // 下載匯出的檔案：先取得內容，再以本機網址下載，不離開應用程式（跨網域的下載網址無法直接用 download 屬性）。
  function downloadFile(url, name) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('下載失敗：HTTP ' + r.status);
      return r.blob();
    }).then(function (blob) {
      var u = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = u;
      a.download = name || 'download';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(u); }, 2000);
    });
  }

  // base64 轉 UTF-8 文字（純文字檔的匯入用）。
  function decodeBase64Text(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
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
      paragraphs: ['依法規列出確實引用該法規的判決；逐案由 AI 依判決原文編碼，每格附逐字依據，對不上的標示為待覆核。結果會存入「檔案」，也可以匯出 Excel 或 Word。'],
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
          downloadFile(json.url, json.name);
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
            // 查不到判決（沒有標題與內文）時不列入，避免把無效的 ID 當成成功結果。
            if (!m.title && !(d.fullText || '').trim()) {
              notes.push('「' + id + '」查無此判決，請確認網址或 ID 是否正確。');
              return;
            }
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
        downloadFile(json.url, json.name);
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
          downloadFile(json.url, json.name);
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
          downloadFile(json.url, json.name);
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
    // 智慧搜尋（網頁版）：與桌面版相同的查詢輪次（核心 runQueryRounds，最多 3 輪），關鍵字由 AI 提議；判決搜尋用 quick_search。
    'search.smart': function (args) {
      var request = String((args && args.request) || '').trim();
      var statute = String((args && args.statute) || '').trim();
      var maxItems = Math.min(20, Number(args && args.maxItems) || 20);
      var runId = args && args.runId;
      var S = window.JRSearch;
      if (!request) return Promise.resolve({ status: 'done', items: [], details: null, notes: [], cancelled: false, saveError: null, explanation: S.explainTrace(S.newTrace('判決列表')) });
      var trace = S.newTrace('判決列表');
      var notes = [];
      var ctrl = new AbortController();
      if (runId) designAborts[runId] = ctrl;
      if (statute) notes.push('網頁版目前不讀入法規條文，關鍵字只依需求與法規名稱提議。');
      var first = statute ? request + '（相關法規：' + statute + '）' : request;
      return S.runQueryRounds({
        feature: '判決搜尋',
        trace: trace,
        module: 'ai',
        initialQueries: [first],
        maxRounds: 3,
        signal: ctrl.signal,
        search: function (q) {
          return client.call('quick_search', { keyword: q, max_items: maxItems }).then(function (d) {
            return (d.items || []).map(toItem);
          });
        },
        keyOf: function (it) { return it.id; },
        sufficient: function (kept) { return kept.length >= maxItems; },
        propose: function (st) {
          return S.proposeQueries(aiComplete, { request: request, tried: st.tried, keptCount: st.kept.length, round: st.round, lawContext: statute ? '法規名稱：' + statute : undefined });
        },
        onError: function (q) { notes.push('查詢「' + q + '」失敗，已略過。'); },
        onProposeError: function () { notes.push('AI 無法提議新的關鍵字，已用目前的結果。'); },
      }).then(function (r) {
        if (runId) delete designAborts[runId];
        if (r.status === 'ask') notes.push(r.question + '（網頁版請改用更具體的需求再搜尋。）');
        if (r.status === 'capped' && r.advice) notes.push(r.advice);
        var items = (r.items || []).slice(0, maxItems);
        var cancelled = r.status === 'cancelled';
        return saveLibrary('list', '智慧搜尋：' + request, { items: items, details: {}, keyword: request, tried: r.tried || [] }).then(function (saveError) {
          return { status: 'done', items: items, details: null, tried: r.tried || [], notes: notes, cancelled: cancelled, saveError: saveError, explanation: S.explainTrace(trace) };
        });
      }, function (err) {
        if (runId) delete designAborts[runId];
        throw err;
      });
    },
    // AI 篩選：判斷每一筆判決是否與研究主題相關（核心 screenRelevance；AI 漏掉的一律視為不相關）。
    'search.screen': function (args) {
      var items = (args && args.items) || [];
      if (!items.length) return Promise.resolve({});
      return window.JRSearch.screenRelevance(aiComplete, String((args && args.topic) || ''), items.map(function (it) {
        return { id: it.id, title: it.title, cause: it.cause || '', dateIso: it.dateIso || null };
      }));
    },
    // 段落檢索（網頁版）：與桌面版相同的流程（核心段落重排），在瀏覽器執行；AI 經雲端。
    'semantic.run': function (args) {
      var S = window.JRSemantic;
      var runId = args && args.runId;
      var keyword = String((args && args.keyword) || '').trim();
      var query = String((args && args.query) || '').trim();
      if (!keyword) return Promise.reject(new Error('請輸入搜尋關鍵字'));
      if (!query) return Promise.reject(new Error('請輸入研究問題（用來排序段落）'));
      var ctrl = new AbortController();
      if (runId) designAborts[runId] = ctrl;
      var done = function () { if (runId) delete designAborts[runId]; };
      return S.runSemanticSearch({
        keyword: keyword,
        query: query,
        kind: args.kind === 'opinion' ? 'opinion' : 'fact',
        filter: S.normalizeFilter(args.filter),
        maxCandidates: Number(args.maxCandidates) || undefined,
      }, {
        search: function (kw, max) {
          return client.call('quick_search', { keyword: kw, max_items: Math.min(20, max) }).then(function (d) {
            return (d.items || []).map(function (it) { return { id: it.id, title: it.title, dateIso: it.date_iso || null, cause: it.cause || '', href: it.href || null }; });
          });
        },
        detail: function (id) { return client.call('get_judgment_detail', { judgment_id: id }); },
        ai: aiComplete,
        signal: ctrl.signal,
        onProgress: function (p) { semanticListeners.forEach(function (fn) { fn(p); }); },
      }).then(function (r) { done(); return r; }, function (err) { done(); throw err; });
    },
    'semantic.fullText': function (args) {
      return client.call('get_judgment_detail', { judgment_id: String((args && args.id) || '') }).then(function (d) {
        return { title: (d.meta || {}).title || '', sourceUrl: (d.meta || {}).sourceUrl || null, fullText: d.fullText || '' };
      });
    },
    'semantic.ask': function (args) {
      var runId = args && args.runId;
      var ctrl = new AbortController();
      if (runId) designAborts[runId] = ctrl;
      var cases = (args && args.cases) || [];
      return window.JRSemantic.askScopedQuestion(aiComplete, String((args && args.question) || ''), cases).then(function (r) {
        if (runId) delete designAborts[runId];
        return r;
      }, function (err) { if (runId) delete designAborts[runId]; throw err; });
    },
    'semantic.onProgress': function (fn) {
      if (typeof fn === 'function') semanticListeners.push(fn);
      return function () { semanticListeners = semanticListeners.filter(function (x) { return x !== fn; }); };
    },
    // 納入／排除核查（網頁版）：候選判決來自檔案或重新檢索；核查與檢閱用核心邏輯，AI 經雲端；結果保存在這個瀏覽器（localStorage）。
    'criteria.fetch': function (args) {
      var C = window.JRCriteria;
      var runId = args && args.runId;
      var src = (args && args.source) || {};
      var ctrl = new AbortController();
      if (runId) designAborts[runId] = ctrl;
      var done = function () { if (runId) delete designAborts[runId]; };
      var summaries = {};
      var details = {};
      var ids = [];
      var query = '';
      var label = '';
      var prep = null;
      var source;
      if (src.kind === 'library') {
        source = libraryFetch('GET', '/' + encodeURIComponent(src.id)).then(function (item) {
          if (item.kind !== 'list' && item.kind !== 'scope') throw new Error('只能以判決列表或範圍整理的結果作為候選判決。');
          var p = item.payload || {};
          ids = C.candidateIdsOf(item.kind, p);
          details = p.details || {};
          (Array.isArray(p.items) ? p.items : []).forEach(function (it) { summaries[it.id] = { title: it.title, dateIso: it.dateIso }; });
          (Array.isArray(p.sheets) ? p.sheets : []).forEach(function (s) {
            (Array.isArray(s && s.rows) ? s.rows : []).forEach(function (r) { summaries[r.id] = { title: r.title, dateIso: r.dateIso }; });
          });
          query = String(p.keyword || item.title);
          label = item.title;
        });
      } else {
        var q = String(src.query || '').trim();
        if (!q) return Promise.reject(new Error('請輸入重新檢索的關鍵字。'));
        source = client.call('quick_search', { keyword: q, max_items: Math.min(20, Math.max(1, Number(src.maxItems) || 20)) }).then(function (d) {
          var items = (d.items || []).map(toItem);
          ids = items.map(function (it) { return it.id; });
          items.forEach(function (it) { summaries[it.id] = { title: it.title, dateIso: it.dateIso }; });
          query = q;
          label = '重新檢索：' + q;
        });
      }
      return source.then(function () {
        var cases = [];
        var notes = [];
        var cancelled = false;
        var chain = Promise.resolve();
        ids.forEach(function (id, i) {
          chain = chain.then(function () {
            if (cancelled || ctrl.signal.aborted) { cancelled = true; return; }
            criteriaListeners.forEach(function (fn) { fn({ phase: 'fetch', done: i + 1, total: ids.length }); });
            if (!C.needsFetch(id, details)) { cases.push(C.toCaseInput(id, details[id], summaries[id])); return; }
            return client.call('get_judgment_detail', { judgment_id: id }).then(function (d) {
              cases.push(C.toCaseInput(id, { meta: d.meta, fullText: d.fullText }, summaries[id]));
            }, function (err) {
              notes.push(id + '：' + ((err && err.message) || '取得失敗'));
              cases.push(C.toCaseInput(id, undefined, summaries[id]));
            });
          });
        });
        return chain.then(function () {
          done();
          if (cancelled) return { cancelled: true, prepId: null, label: label, query: query, total: 0, withoutText: 0, notes: notes };
          prep = { prepId: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), query: query, label: label, cases: cases, notes: notes };
          criteriaPrep = prep;
          return {
            cancelled: false,
            prepId: prep.prepId,
            label: label,
            query: query,
            total: cases.length,
            withoutText: cases.filter(function (c) { return !String(c.fullText || '').trim(); }).length,
            notes: notes,
          };
        });
      }).catch(function (err) { done(); throw err; });
    },
    'criteria.suggest': function (args) {
      var p = requireCriteriaPrep(args && args.prepId);
      return window.JRCriteria.suggestCriteria(aiComplete, p.query, p.cases.map(function (c) {
        return { caseNo: c.caseNo, head: String(c.fullText || '').slice(0, 300) };
      })).then(function (criteria) { return { criteria: criteria }; });
    },
    'criteria.plan': function (args) {
      var C = window.JRCriteria;
      var p = requireCriteriaPrep(args && args.prepId);
      var criteria = C.parseCriteriaInput(args.criteria);
      return Promise.resolve({ plan: C.planRun(criteria, p.cases), hasAi: criteria.some(function (c) { return c.method === 'ai'; }), total: p.cases.length });
    },
    'criteria.run': function (args) {
      var C = window.JRCriteria;
      var runId = args && args.runId;
      var p = requireCriteriaPrep(args && args.prepId);
      var criteria = C.parseCriteriaInput(args.criteria);
      var ctrl = new AbortController();
      if (runId) designAborts[runId] = ctrl;
      var done = function () { if (runId) delete designAborts[runId]; };
      var useAi = criteria.some(function (c) { return c.method === 'ai'; });
      return Promise.resolve().then(function () {
        return C.runCriteria({ query: p.query, criteria: criteria, cases: p.cases }, {
          ai: useAi ? aiComplete : undefined,
          signal: ctrl.signal,
          onProgress: function (d, t) { criteriaListeners.forEach(function (fn) { fn({ phase: 'run', done: d, total: t }); }); },
        });
      }).then(function (result) {
        done();
        var runNo = result.runNo; // eslint-disable-line no-unused-vars
        var unsaved = Object.assign({}, result);
        delete unsaved.runNo;
        var runs = readCriteriaRuns();
        var next = C.appendRun(runs, unsaved);
        var saved = next[next.length - 1];
        var saveError = null;
        try { writeCriteriaRuns(next); } catch (e) { saveError = '未能保存這次核查（' + ((e && e.message) || '瀏覽器儲存空間不足') + '），結果仍顯示於畫面，請及時匯出。'; }
        return { cancelled: false, run: saved, saveError: saveError };
      }, function (err) {
        done();
        if (ctrl.signal.aborted) return { cancelled: true, run: null, saveError: null };
        throw err;
      });
    },
    'criteria.review': function (args) {
      var runNo = Number(args && args.runNo);
      var runs = readCriteriaRuns();
      var idx = runs.findIndex(function (r) { return r.runNo === runNo; });
      if (idx < 0) return Promise.reject(new Error('找不到這次核查的紀錄。'));
      return window.JRCriteria.reviewRerun(aiComplete, runs[idx]).then(function (review) {
        runs[idx] = Object.assign({}, runs[idx], { review: review });
        writeCriteriaRuns(runs);
        return { review: review, runNo: runNo };
      });
    },
    'criteria.runs': function () { return Promise.resolve(readCriteriaRuns()); },
    'criteria.compare': function (args) {
      var runs = readCriteriaRuns();
      var a = runs.find(function (r) { return r.runNo === args.aNo; });
      var b = runs.find(function (r) { return r.runNo === args.bNo; });
      if (!a || !b) return Promise.reject(new Error('找不到要比較的核查紀錄。'));
      return Promise.resolve(window.JRCriteria.compareRuns(a, b));
    },
    'criteria.export': function (args) {
      var runs = readCriteriaRuns();
      var run = runs.find(function (r) { return r.runNo === (args && args.runNo); });
      if (!run) return Promise.reject(new Error('找不到這次核查的紀錄。'));
      var name = '納入排除核查_第' + run.runNo + '次.csv';
      var blob = new Blob([window.JRCriteria.runToCsv(run)], { type: 'text/csv;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      return Promise.resolve({ canceled: false, filePath: name });
    },
    'criteria.onProgress': function (fn) {
      if (typeof fn === 'function') criteriaListeners.push(fn);
      return function () { criteriaListeners = criteriaListeners.filter(function (x) { return x !== fn; }); };
    },
    // 匯入判決清單（網頁版）：Excel、CSV、TSV、TXT、Word、PDF 皆可，與桌面版相同的規則。
    // 解析與欄位判斷在雲端（/api/import/table）；純文字且每行是判決網址或 ID 的檔案不需要 AI，直接走手動輸入的流程。
    'importFile': function () {
      return new Promise(function (resolve, reject) {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.xlsx,.csv,.tsv,.txt,.docx,.pdf,.md';
        input.addEventListener('cancel', function () { resolve({ canceled: true }); });
        input.addEventListener('change', function () {
          var f = input.files && input.files[0];
          if (!f) { resolve({ canceled: true }); return; }
          if (f.size > 8 * 1024 * 1024) { reject(new Error('檔案超過 8 MB，請分成較小的檔案。')); return; }
          var reader = new FileReader();
          reader.onerror = function () { reject(new Error('無法讀取檔案。')); };
          reader.onload = function () {
            var dataUrl = String(reader.result || '');
            var b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
            var isLineText = /\.(txt|md)$/i.test(f.name);
            var text = isLineText ? decodeBase64Text(b64) : '';
            var ids = [];
            if (isLineText) {
              text.split(/\r?\n/).forEach(function (line) {
                var urls = line.match(/https?:\/\/[^\s",]+/g) || [];
                urls.forEach(function (u) { ids.push(manualIdOf(u)); });
                var m = /^\s*([A-Z]{2,5}[,_]\d[^\s"]*)/.exec(line);
                if (m && !urls.length) ids.push(m[1]);
              });
              ids = ids.filter(function (x, i, all) { return x && all.indexOf(x) === i; });
            }
            var linesTotal = text.split(/\r?\n/).filter(function (l) { return l.trim(); }).length;
            if (ids.length && ids.length === linesTotal) {
              // 每行都是判決網址或 ID：沿用手動輸入（不需要 AI）。
              handlers['search.manual']({ text: ids.join('\n') }).then(function (m) {
                resolve({ canceled: false, count: (m.items || []).length, fileName: f.name, saveError: m.saveError || null, notes: m.notes || [] });
              }, reject);
              return;
            }
            // 其他格式：交給雲端解析與判斷欄位，再保存為判決清單。
            window.JRAuth.getIdToken().then(function (token) {
              if (!token) throw new Error('請先登入。');
              return fetch('https://judge-remote-mcp-2026.web.app/api/import/table', {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
                body: JSON.stringify({ name: f.name, data: dataUrl.slice(dataUrl.indexOf(',') + 1) }),
              });
            }).then(function (res) {
              return res.json().catch(function () { return {}; }).then(function (j) {
                if (!res.ok) throw new Error(j.message || ('匯入失敗：HTTP ' + res.status));
                return j;
              });
            }).then(function (j) {
              var items = j.items || [];
              return saveLibrary('list', '匯入：' + f.name, { items: items, details: {}, keyword: '匯入' }).then(function (saveError) {
                resolve({ canceled: false, count: items.length, rowCount: j.rowCount, fileName: f.name, saveError: saveError, notes: [] });
              });
            }).catch(reject);
          };
          reader.readAsDataURL(f);
        });
        input.click();
      });
    },
    // 個案研究筆記（網頁版）：標注保存在雲端同步文件（/api/annotations，與桌面版同一份，帶版本號；不含全文）。
    // 每次修改都先讀取、套用、再以 baseRevision 寫回；版本衝突時重讀後重新套用。
    'annotation.load': function (args) {
      var A = window.JRAnnotation;
      var includeAi = !(args && args.includeAi === false);
      return annDetail(args.judgmentId).then(function (det) {
        return annRead().then(function (cur) {
          var entry = cur.file.judgments[args.judgmentId];
          var list = A.withStatus(entry ? entry.annotations : [], det.fullText);
          var shown = list.filter(function (a) { return a.status === 'ok' && (includeAi || a.origin !== 'ai'); });
          return {
            meta: det.meta,
            fullText: det.fullText,
            mainText: det.mainText,
            annotations: list,
            segments: A.segmentText(det.fullText, shown).map(function (s) { return { start: s.start, end: s.end, color: s.color, annotationIds: s.annotationIds }; }),
            colorLabels: A.resolveColorLabels(cur.file.colorLabels),
          };
        });
      });
    },
    'annotation.add': function (args) {
      var A = window.JRAnnotation;
      annCheckChoice(args.color, args.mode);
      return annDetail(args.judgmentId).then(function (det) {
        return annMutate(function (file) {
          var r = A.addToFile(file, args.judgmentId, det.meta, {
            judgmentId: args.judgmentId, start: args.start, end: args.end, color: args.color, mode: args.mode, note: args.note || '', origin: 'manual',
          }, det.fullText);
          return { file: r.file, result: Object.assign({}, r.annotation, { status: 'ok' }) };
        });
      });
    },
    'annotation.update': function (args) {
      var A = window.JRAnnotation;
      var patch = args.patch || {};
      if (patch.color !== undefined && window.JRAnnotation.HIGHLIGHT_COLORS.indexOf(patch.color) < 0) return Promise.reject(new Error('不支援的螢光顏色'));
      if (patch.mode !== undefined && ['highlight', 'highlight_note'].indexOf(patch.mode) < 0) return Promise.reject(new Error('不支援的標注模式'));
      return annMutate(function (file) {
        return { file: A.patchInFile(file, args.judgmentId, args.id, patch), result: { ok: true } };
      });
    },
    'annotation.remove': function (args) {
      var A = window.JRAnnotation;
      return annMutate(function (file) {
        var r = A.removeFromFile(file, args.judgmentId, args.id);
        return { file: r.file, result: { removed: r.removed } };
      });
    },
    'annotation.reanchor': function (args) {
      var A = window.JRAnnotation;
      return annDetail(args.judgmentId).then(function (det) {
        return annMutate(function (file) {
          var entry = file.judgments[args.judgmentId];
          var target = entry && entry.annotations.filter(function (a) { return a.id === args.id; })[0];
          if (!entry || !target) throw new Error('找不到這筆標注');
          var moved = A.reanchor(target, det.fullText);
          if (!moved) return { skip: true, result: { ok: false, annotation: null } };
          var judgments = Object.assign({}, file.judgments);
          judgments[args.judgmentId] = Object.assign({}, entry, {
            annotations: entry.annotations.map(function (a) { return a.id === args.id ? moved : a; }),
          });
          return { file: Object.assign({}, file, { judgments: judgments }), result: { ok: true, annotation: Object.assign({}, moved, { status: 'ok' }) } };
        });
      });
    },
    // AI 引文標注：驗證過的引文（逐字存在於全文）轉為 origin 為 ai 的螢光標注，與人工標注分開。
    'annotation.importAi': function (args) {
      var A = window.JRAnnotation;
      var quotes = (args && args.quotes) || [];
      return annDetail(args.judgmentId).then(function (det) {
        return annMutate(function (file) {
          var added = 0, skipped = 0;
          var cur = file;
          quotes.filter(function (q, i, all) { return all.indexOf(q) === i; }).forEach(function (quote) {
            var start = quote ? det.fullText.indexOf(quote) : -1;
            if (start < 0) { skipped++; return; }
            var end = start + quote.length;
            var entry = cur.judgments[args.judgmentId];
            if (entry && entry.annotations.some(function (a) { return a.origin === 'ai' && a.start === start && a.end === end; })) { skipped++; return; }
            cur = A.addToFile(cur, args.judgmentId, det.meta, { judgmentId: args.judgmentId, start: start, end: end, color: 'yellow', mode: 'highlight', origin: 'ai' }, det.fullText).file;
            added++;
          });
          return { file: cur, result: { added: added, skipped: skipped } };
        });
      });
    },
    'annotation.judgments': function () {
      return annRead().then(function (cur) { return window.JRAnnotation.listJudgments(cur.file); });
    },
    'annotation.labels.get': function () {
      return annRead().then(function (cur) { return window.JRAnnotation.resolveColorLabels(cur.file.colorLabels); });
    },
    'annotation.labels.set': function (args) {
      var A = window.JRAnnotation;
      return annMutate(function (file) {
        var labels = A.validateColorLabels(args && args.labels, A.resolveColorLabels(file.colorLabels));
        return { file: Object.assign({}, file, { colorLabels: labels }), result: labels };
      });
    },
    'annotation.syncStatus': function () {
      return window.JRAuth.getIdToken().then(function (t) {
        return { available: !!t, reason: t ? '' : '請先登入。' };
      });
    },
    // 網頁版的標注直接保存在雲端，「同步」即是讀取目前的版本。
    'annotation.syncNow': function () {
      return annRead().then(function (cur) {
        var count = window.JRAnnotation.listJudgments(cur.file).reduce(function (n, j) { return n + j.count; }, 0);
        return { merged: false, revision: cur.revision, annotations: count };
      });
    },
    'annotation.export': function (args) {
      return annExport([args.judgmentId]);
    },
    'annotation.exportMany': function (args) {
      var ids = ((args && args.targets) || []).map(function (t) { return t.judgmentId; });
      if (!ids.length) return Promise.reject(new Error('請先勾選要匯出的案件'));
      if (ids.length > 50) return Promise.reject(new Error('一次最多合併 50 案'));
      return annExport(ids);
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
