// 把網頁版產物（apps/web/dist）放進雲端的 hosting 目錄，供 firebase deploy 使用。
// 用法：node scripts/stage-hosting.mjs <judge-remote-mcp 的根目錄>
// 只覆蓋首頁、landing 檔案與 app/ 目錄；hosting/cimd 等既有檔案保留。
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '..', 'apps', 'web', 'dist');
const remote = process.argv[2];
if (!remote) {
  console.error('用法：node scripts/stage-hosting.mjs <judge-remote-mcp 根目錄>');
  process.exit(2);
}
if (!existsSync(join(dist, 'index.html')) || !existsSync(join(dist, 'app', 'index.html'))) {
  console.error('找不到網頁版產物，請先執行 apps/web 的 npm run build。');
  process.exit(2);
}

const hosting = join(remote, 'hosting');
mkdirSync(hosting, { recursive: true });
cpSync(join(dist, 'index.html'), join(hosting, 'index.html'));
cpSync(join(dist, 'landing.css'), join(hosting, 'landing.css'));
cpSync(join(dist, 'landing.js'), join(hosting, 'landing.js'));
rmSync(join(hosting, 'app'), { recursive: true, force: true });
cpSync(join(dist, 'app'), join(hosting, 'app'), { recursive: true });
cpSync(join(dist, 'brand'), join(hosting, 'brand'), { recursive: true });
console.log('hosting staged at', hosting);
