// Две сборки из одного кода:
//   dist/personal — с модулями под YummyAnime/NewDeaf (content.js), ставится «Загрузить распакованное»;
//   dist/store    — универсальный трекер для Chrome Web Store (tracker.js), без списка сайтов в коде.
// Запуск: node scripts/build.mjs. Архивы собирает scripts/pack.ps1.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const COMMON = ['background.js', 'shared.js', 'icons.js', 'popup.html', 'popup.js', 'popup.css', 'THIRD_PARTY_NOTICES.txt'];
const BUILDS = {
  personal: { manifest: 'manifest.json', files: ['content.js'] },
  store: { manifest: 'manifest.store.json', files: ['tracker.js'] },
};
// в магазинной сборке не должно быть ни одного адреса сайтов из личной
const PERSONAL_ONLY = /yummyani|newdeaf|kodik/i;

for (const [name, b] of Object.entries(BUILDS)) {
  const out = path.join(root, 'dist', name);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'icons'), { recursive: true });
  for (const f of [...COMMON, ...b.files]) fs.copyFileSync(path.join(root, f), path.join(out, f));
  for (const f of fs.readdirSync(path.join(root, 'icons')))
    if (f.endsWith('.png')) fs.copyFileSync(path.join(root, 'icons', f), path.join(out, 'icons', f));
  fs.copyFileSync(path.join(root, b.manifest), path.join(out, 'manifest.json'));
  fs.writeFileSync(
    path.join(out, 'build.js'),
    `// сборка: ${name} (scripts/build.mjs)\n// eslint-disable-next-line no-unused-vars\nconst AT_BUILD = '${name}';\n`
  );
  if (name === 'store') stripPersonal(out);
  console.log(`dist/${name}: ok`);
}

// Магазинная сборка: из общих файлов вырезаются блоки `// @personal-start … // @personal-end`
// (список сайтов, Kodik), а затем проверяется, что упоминаний не осталось ни в одном файле.
function stripPersonal(dir) {
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(js|html|css|json)$/.test(f)) continue;
    const p = path.join(dir, f);
    const src = fs.readFileSync(p, 'utf8');
    const cut = src.replace(/[ \t]*\/\/ @personal-start[\s\S]*?\/\/ @personal-end[^\n]*\n/g, '');
    fs.writeFileSync(p, cut);
    const hit = cut.split('\n').findIndex((l) => PERSONAL_ONLY.test(l));
    if (hit >= 0) throw new Error(`store: ${f}:${hit + 1} упоминает сайт личной сборки — «${cut.split('\n')[hit].trim()}»`);
  }
}
