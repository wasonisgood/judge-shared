// 網頁版雲端用戶端的單元測試（以本機模擬伺服器，不連正式環境）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createClient, createPkce, base64url } = require('../js/mcpClient.js');

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => handler(req, res, body ? JSON.parse(body) : null));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('call：帶 Bearer 權杖送出 tools/call，並回傳 data', async () => {
  let seen;
  const server = await serve((req, res, body) => {
    seen = { auth: req.headers.authorization, body };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: { schema: 'judge-mcp/v1', tool: 'quick_search', ok: true, data: { items: [{ id: 'A' }], count: 1 } } } }));
  });
  const client = createClient({ endpoint: `http://127.0.0.1:${server.address().port}/mcp`, getToken: () => 'tok123' });
  const data = await client.call('quick_search', { keyword: '國家賠償' });
  server.close();
  assert.equal(seen.auth, 'Bearer tok123');
  assert.equal(seen.body.method, 'tools/call');
  assert.equal(seen.body.params.name, 'quick_search');
  assert.deepEqual(seen.body.params.arguments, { keyword: '國家賠償' });
  assert.equal(data.count, 1);
});

test('call：沒有權杖直接回報需要登入，不送出請求', async () => {
  let called = false;
  const client = createClient({ endpoint: 'http://unused', getToken: () => null, fetch: () => { called = true; } });
  await assert.rejects(client.call('quick_search', {}), (e) => e.code === 'auth_required');
  assert.equal(called, false);
});

test('call：401 視為登入過期；ok=false 帶出訊息', async () => {
  const server = await serve((req, res, body) => {
    if (req.headers.authorization === 'Bearer expired') { res.statusCode = 401; return res.end('{}'); }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: { ok: false, data: { message: '關鍵字不可為空' } } } }));
  });
  const ep = `http://127.0.0.1:${server.address().port}/mcp`;
  await assert.rejects(createClient({ endpoint: ep, getToken: () => 'expired' }).call('quick_search', {}), (e) => e.code === 'auth_required');
  await assert.rejects(createClient({ endpoint: ep, getToken: () => 'ok' }).call('quick_search', {}), /關鍵字不可為空/);
  server.close();
});

test('PKCE：challenge 等於 base64url(SHA-256(verifier))，verifier 長度足夠', async () => {
  const { createHash } = await import('node:crypto');
  const p = await createPkce();
  assert.equal(p.method, 'S256');
  assert.ok(p.verifier.length >= 43);
  assert.equal(p.challenge, base64url(createHash('sha256').update(p.verifier).digest()));
});
