// 建置畫面套件：依 order.txt 的順序（與原 index.html 的載入順序相同）合併 JS 與 CSS。
// 產物：dist/ui.js、dist/ui.css。外殼需先設定 window.__JR_HOST = { api, platform }，再載入 ui.js。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const order = readFileSync(join(root, 'order.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
const read = (p) => readFileSync(join(root, 'src', p), 'utf8');

const js = order.filter((p) => p.endsWith('.js')).map((p) => `/* ${p} */\n${read(p)}\n`).join('');
const css = order.filter((p) => p.endsWith('.css')).map((p) => `/* ${p} */\n${read(p)}\n`).join('');

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'ui.js'), js);
writeFileSync(join(root, 'dist', 'ui.css'), css);
console.log(`ui: ${order.filter((p) => p.endsWith('.js')).length} js, ${order.filter((p) => p.endsWith('.css')).length} css`);
