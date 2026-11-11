// 網頁版 AI 用戶端的單元測試（模擬 fetch，不連正式環境）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAiComplete } = require('../js/mcpClient.js');

const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('AI：帶 Firebase ID Token 送出 chat/completions，回傳第一個回覆的文字', async () => {
  let seen;
  const ai = createAiComplete({
    endpoint: 'https://example.test/aiProxy',
    model: 'm1',
    getToken: async () => 'idtok',
    fetch: async (url, init) => {
      seen = { url, init, body: JSON.parse(init.body) };
      return jsonRes(200, { choices: [{ message: { content: '  {"keyword":"國家賠償"}  ' } }] });
    },
  });
  const out = await ai('SYS', 'USER', 512);
  assert.equal(seen.url, 'https://example.test/aiProxy');
  assert.equal(seen.init.headers.authorization, 'Bearer idtok');
  assert.equal(seen.body.model, 'm1');
  assert.equal(seen.body.max_tokens, 512);
  assert.deepEqual(seen.body.messages, [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'USER' }]);
  assert.equal(out, '{"keyword":"國家賠償"}');
});

test('AI：沒有登入不送出請求', async () => {
  let called = false;
  const ai = createAiComplete({ endpoint: 'x', model: 'm', getToken: async () => null, fetch: async () => { called = true; } });
  await assert.rejects(ai('s', 'u', 10), (e) => e.code === 'auth_required');
  assert.equal(called, false);
});

test('AI：402／429／503 翻成中文訊息', async () => {
  const cases = [[402, /尚未訂閱/], [429, /用量已用完/], [503, /尚未設定/]];
  for (const [status, re] of cases) {
    const ai = createAiComplete({ endpoint: 'x', model: 'm', getToken: async () => 't', fetch: async () => jsonRes(status, { error: 'x' }) });
    await assert.rejects(ai('s', 'u', 10), re);
  }
});

test('AI：502（上游金鑰無效）顯示中文說明，不被當成登入過期', async () => {
  const ai = createAiComplete({ endpoint: 'x', model: 'm', getToken: async () => 't', fetch: async () => jsonRes(502, { error: 'upstream_auth_failed' }) });
  await assert.rejects(ai('s', 'u', 10), (e) => /上游金鑰/.test(e.message) && e.code !== 'auth_required');
});

test('助理代理：送出對話（含 user/assistant 歷史）並回傳 JSON；401 視為登入過期', async () => {
  const { createAgentChat } = require('../js/mcpClient.js');
  let seen;
  const chat = createAgentChat({
    endpoint: 'https://example.test/api/agent', model: 'm', getToken: async () => 'tok',
    fetch: async (url, init) => { seen = { url, body: JSON.parse(init.body), auth: init.headers.authorization }; return jsonRes(200, { text: '找到 2 筆', steps: 2, stopped: 'done', trace: [] }); },
  });
  const out = await chat([{ role: 'user', content: '前一句' }, { role: 'assistant', content: '好' }, { role: 'user', content: '找國賠' }]);
  assert.equal(seen.url, 'https://example.test/api/agent');
  assert.equal(seen.auth, 'Bearer tok');
  assert.equal(seen.body.messages.length, 3);
  assert.equal(out.text, '找到 2 筆');
  const expired = createAgentChat({ endpoint: 'x', model: 'm', getToken: async () => 't', fetch: async () => jsonRes(401, {}) });
  await assert.rejects(expired([{ role: 'user', content: 'q' }]), (e) => e.code === 'auth_required');
});
