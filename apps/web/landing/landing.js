// 產品介紹頁：桌面版下載連結自動指向最新 Release（GitHub API）；失敗時保留 Release 頁面的連結。
(function () {
  'use strict';
  var API = 'https://api.github.com/repos/wasonisgood/judge-desktop/releases/latest';
  var RELEASES = 'https://github.com/wasonisgood/judge-desktop/releases/latest';

  function setMeta(text) { document.getElementById('download-meta').textContent = text; }

  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  }

  fetch(API, { headers: { accept: 'application/vnd.github+json' } })
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (rel) {
      var asset = (rel.assets || []).filter(function (a) { return /Setup\.exe$/i.test(a.name); })[0];
      if (!asset) throw new Error('找不到安裝檔');
      var link = document.getElementById('download-link');
      link.href = asset.browser_download_url;
      link.textContent = '下載 ' + (rel.tag_name || '最新版');
      document.querySelectorAll('[data-download-cta]').forEach(function (a) { a.href = asset.browser_download_url; });
      var date = fmtDate(rel.published_at);
      setMeta('最新版本 ' + (rel.tag_name || '') + (date ? '（' + date + '）' : '') + ' · Windows 10 以後');
    })
    .catch(function () {
      document.getElementById('download-link').href = RELEASES;
      setMeta('無法自動確認最新版本，請到 GitHub Releases 下載。');
    });

  var copy = document.getElementById('copy-mcp');
  copy.addEventListener('click', function () {
    var url = document.getElementById('mcp-url').textContent;
    if (!navigator.clipboard) { copy.textContent = '請手動複製'; return; }
    navigator.clipboard.writeText(url).then(function () {
      copy.textContent = '已複製';
      setTimeout(function () { copy.textContent = '複製網址'; }, 1600);
    }, function () { copy.textContent = '請手動複製'; });
  });
})();
