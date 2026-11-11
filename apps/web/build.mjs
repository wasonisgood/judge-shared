// 建置網頁版（與桌面端共用同一份 packages/ui）。
// 產物（與 judge-remote-mcp 的 hosting 目錄結構相同，可直接複製過去）：
//   dist/index.html            產品介紹頁（landing）
//   dist/app/index.html        網頁版工具（需登入）
//   dist/app/ui/ui.{js,css}    共用畫面
//   dist/app/js/auth.js        登入（Firebase Auth，esbuild 打包）
//   dist/app/js/host.js        網頁版外殼（api 對應到雲端）
//   dist/app/js/mcpClient.js   雲端用戶端
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const ui = join(here, '..', '..', 'packages', 'ui');
execFileSync(process.execPath, [join(ui, 'build.mjs')], { stdio: 'inherit' });

const out = join(here, 'dist');
rmSync(out, { recursive: true, force: true });
const app = join(out, 'app');
mkdirSync(join(app, 'js'), { recursive: true });

await build({
  entryPoints: [join(here, 'src', 'auth.js')],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify: true,
  outfile: join(app, 'js', 'auth.js'),
  logLevel: 'warning',
});

cpSync(join(here, 'app', 'index.html'), join(app, 'index.html'));
cpSync(join(here, 'js', 'host.js'), join(app, 'js', 'host.js'));
cpSync(join(here, 'js', 'mcpClient.js'), join(app, 'js', 'mcpClient.js'));
cpSync(join(ui, 'dist'), join(app, 'ui'), { recursive: true });
cpSync(join(here, 'landing', 'index.html'), join(out, 'index.html'));
cpSync(join(here, 'landing', 'landing.css'), join(out, 'landing.css'));
cpSync(join(here, 'landing', 'landing.js'), join(out, 'landing.js'));
console.log('web: dist ready', existsSync(join(app, 'js', 'auth.js')) ? '(auth bundled)' : '(auth missing!)');
