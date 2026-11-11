// 建置網頁版：先建置共用畫面（packages/ui），再把入口檔與產物複製到 dist/。
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ui = join(here, '..', '..', 'packages', 'ui');
execFileSync(process.execPath, [join(ui, 'build.mjs')], { stdio: 'inherit' });

rmSync(join(here, 'dist'), { recursive: true, force: true });
mkdirSync(join(here, 'dist', 'js'), { recursive: true });
cpSync(join(here, 'index.html'), join(here, 'dist', 'index.html'));
cpSync(join(here, 'js', 'host.js'), join(here, 'dist', 'js', 'host.js'));
cpSync(join(ui, 'dist'), join(here, 'dist', 'ui'), { recursive: true });
console.log('web: dist ready');
