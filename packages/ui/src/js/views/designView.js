// 視圖：研究設計的畫面繪製（只接收資料，不呼叫 IPC）。所有使用者文字一律用 textContent 寫入。
(function (JR) {
  'use strict';
  var $ = JR.$;
  var FIELD_IDS = ['question', 'subject', 'variable', 'yearFrom', 'yearTo', 'statute', 'caseType', 'courtLevel'];
  var WELCOME = '描述你想研究的問題即可開始。例如：「我覺得消費者訴訟的判決都對消費者不利，想知道是不是真的」。助理會追問需要確認的條件，並可替你填入欄位、試搜尋判決數。';

  var optionHandler = null;

  function turnNode(role, text) {
    var item = JR.el('div', 'design-turn design-turn-' + role);
    item.appendChild(JR.el('div', 'design-turn-who', role === 'user' ? '你' : '助理'));
    if (role === 'guide') {
      // 助理回覆：Markdown（安全的子集，不執行任何標記）。
      var body = JR.el('div', 'design-turn-text', '');
      body.appendChild(JR.components.markdown(text));
      item.appendChild(body);
    } else {
      item.appendChild(JR.el('div', 'design-turn-text', text));
    }
    return item;
  }

  /** 助理給的選項：按鈕，點選後由控制器當成使用者的回答送出。 */
  function optionBar(options) {
    var bar = JR.el('div', 'design-options', '');
    options.forEach(function (o) {
      var b = JR.el('button', 'btn small design-option', o.label);
      b.type = 'button';
      b.addEventListener('click', function () { if (optionHandler) optionHandler(o); });
      bar.appendChild(b);
    });
    return bar;
  }

  function scrollLog() {
    var log = $('designLog');
    log.scrollTop = log.scrollHeight;
  }

  function fillFields(values) {
    FIELD_IDS.forEach(function (k) {
      var el = $('designF-' + k);
      if (el) el.value = values[k] !== undefined && values[k] !== null ? String(values[k]) : '';
    });
  }

  function readFields() {
    var out = {};
    FIELD_IDS.forEach(function (k) {
      var el = $('designF-' + k);
      out[k] = el ? el.value.trim() : '';
    });
    return out;
  }

  function renderSelect(items, currentId) {
    var sel = $('designSelect');
    sel.textContent = '';
    sel.appendChild(new Option(items.length ? '請選擇一筆' : '尚無紀錄', ''));
    items.forEach(function (it) {
      var label = it.title + '（' + JR.fmtTime(it.updatedAt) + '）';
      sel.appendChild(new Option(label, it.id, false, it.id === currentId));
    });
    sel.value = currentId || '';
  }

  JR.views.design = {
    renderSelect: renderSelect,
    /** 空白狀態（尚未選定或新建）：顯示歡迎語，欄位清空。 */
    showEmpty: function () {
      var log = $('designLog');
      log.textContent = '';
      log.appendChild(JR.el('p', 'design-welcome', WELCOME));
      fillFields({});
      $('designSummary').textContent = '';
      $('designToScope').disabled = true;
      $('designRemove').disabled = true;
    },
    /** 顯示完整對話與欄位。 */
    renderWork: function (view) {
      var log = $('designLog');
      log.textContent = '';
      var turns = view.session.turns;
      turns.forEach(function (t, i) {
        var node = turnNode(t.role, t.text);
        // 只有最後一則助理回覆的選項可以點（較早的選項已過時）。
        if (t.role === 'guide' && i === turns.length - 1 && t.options && t.options.length) {
          node.appendChild(optionBar(t.options));
        }
        log.appendChild(node);
      });
      fillFields(view.fields);
      $('designSummary').textContent = view.summaryText;
      $('designToScope').disabled = !view.scopeOptions;
      $('designRemove').disabled = false;
      scrollLog();
    },
    /** 送出時先把使用者的話顯示出來（AI 回覆前）。 */
    appendPending: function (text) {
      var log = $('designLog');
      var welcome = log.querySelector('.design-welcome');
      if (welcome) log.textContent = '';
      log.appendChild(turnNode('user', text));
      log.appendChild(JR.el('div', 'design-turn design-turn-guide design-turn-pending', '助理思考中…'));
      scrollLog();
    },
    fillFields: fillFields,
    readFields: readFields,
    setOptionHandler: function (fn) { optionHandler = fn; }
  };
})(window.JR);
