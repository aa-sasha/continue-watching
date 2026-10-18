// Сборка расширения в dist/personal: только файлы, которые нужны Chrome (без тестов и скриптов).
// Запуск: node scripts/build.mjs. Архивы собирает scripts/pack.py.
// (До 18.10 была и вторая, магазинная сборка «трекер серий»; от неё отказались — см. README.)
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const FILES = ['manifest.json', 'background.js', 'shared.js', 'icons.js', 'content.js', 'popup.html', 'popup.js', 'popup.css', 'THIRD_PARTY_NOTICES.txt'];

const out = path.join(root, 'dist', 'personal');
fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'icons'), { recursive: true });
for (const f of FILES) fs.copyFileSync(path.join(root, f), path.join(out, f));
for (const f of fs.readdirSync(path.join(root, 'icons')))
  if (f.endsWith('.png')) fs.copyFileSync(path.join(root, 'icons', f), path.join(out, 'icons', f));

// всё, на что ссылаются манифест и попап, должно быть в сборке
const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
const referenced = [
  manifest.background.service_worker,
  ...manifest.content_scripts.flatMap((c) => c.js),
  manifest.action.default_popup,
  ...[...fs.readFileSync(path.join(out, 'popup.html'), 'utf8').matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]),
];
for (const f of referenced) if (!fs.existsSync(path.join(out, f))) throw new Error(`нет файла в сборке: ${f}`);
console.log('dist/personal: ok');
