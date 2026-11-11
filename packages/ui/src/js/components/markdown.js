// 元件：把助理回覆的 Markdown（子集：**粗體**、- 條列、換行）轉成 DOM。只用 createElement 與 textContent，不使用 innerHTML，因此不會執行回覆中的任何標記。
(function (JR) {
  'use strict';

  function inline(parent, text) {
    String(text).split(/(\*\*[^*]+\*\*)/).forEach(function (part) {
      if (!part) return;
      if (part.length > 4 && part.slice(0, 2) === '**' && part.slice(-2) === '**') {
        parent.appendChild(JR.el('strong', '', part.slice(2, -2)));
      } else {
        parent.appendChild(document.createTextNode(part));
      }
    });
  }

  JR.components.markdown = function (text) {
    var root = JR.el('div', 'md');
    var list = null;
    var para = null;
    String(text || '').replace(/\r/g, '').split('\n').forEach(function (line) {
      // 無序條列（- * ・）與有序條列（1. 1、 1)）；同種清單連續出現時放在同一個清單內。
      var bullet = line.match(/^\s*[-*・]\s+(.*)$/);
      var numbered = line.match(/^\s*(\d{1,2})[.、)]\s+(.*)$/);
      if (bullet || numbered) {
        para = null;
        var kind = bullet ? 'ul' : 'ol';
        if (!list || list.tagName.toLowerCase() !== kind) {
          list = JR.el(kind, 'md-list', '');
          root.appendChild(list);
        }
        var li = JR.el('li', '', '');
        inline(li, bullet ? bullet[1] : numbered[2]);
        list.appendChild(li);
        return;
      }
      list = null;
      if (!line.trim()) { para = null; return; }
      if (!para) { para = JR.el('p', 'md-p'); root.appendChild(para); } else { para.appendChild(document.createElement('br')); }
      inline(para, line);
    });
    return root;
  };
})(window.JR);
