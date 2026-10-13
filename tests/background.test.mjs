// Фоновая часть: очередь записей, досмотр, белый список ручной правки.
// Гоняем настоящий background.js в песочнице с поддельным chrome.storage (случайные задержки —
// чтобы гонки, если они есть, проявлялись).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);

// Облако chrome.storage.sync: одно на несколько «компьютеров» (boot с общим cloud). Изменение
// доходит до всех подписчиков onChanged, как в Chrome. quota — лимит байт на всё (QUOTA_BYTES).
function makeCloud({ quota = Infinity } = {}) {
  return { data: {}, listeners: new Set(), quota, writes: 0 };
}

// dir — откуда брать background.js и shared.js: исходники или готовая сборка (dist/store)
function boot({ build = 'personal', granted = () => true, dir = '..', cloud = makeCloud() } = {}) {
  const shared = require(`${dir}/shared.js`);
  const src = fs.readFileSync(new URL(`${dir}/background.js`, import.meta.url), 'utf8');
  const store = { local: {}, session: {}, sync: cloud.data };
  const delay = () => new Promise((r) => setTimeout(r, Math.random() * 15));
  const size = (o) => JSON.stringify(o).length;
  const area = (n) => ({
    async get(k) {
      await delay();
      const o = {};
      const keys = k === null ? Object.keys(store[n]) : [].concat(k);
      for (const key of keys) if (key in store[n]) o[key] = structuredClone(store[n][key]);
      return o;
    },
    async set(o) {
      await delay();
      if (n === 'sync') {
        if (size({ ...store.sync, ...o }) > cloud.quota) throw new Error('QUOTA_BYTES quota exceeded');
        cloud.writes++;
      }
      const changes = {};
      for (const [k, v] of Object.entries(o)) changes[k] = { oldValue: store[n][k], newValue: structuredClone(v) };
      Object.assign(store[n], structuredClone(o));
      if (n === 'sync') for (const f of cloud.listeners) setTimeout(() => f(structuredClone(changes), 'sync'));
    },
    async remove(k) {
      const changes = {};
      for (const key of [].concat(k)) {
        if (key in store[n]) changes[key] = { oldValue: store[n][key] };
        delete store[n][key];
      }
      if (n === 'sync') for (const f of cloud.listeners) setTimeout(() => f(changes, 'sync'));
    },
  });
  const onInstalled = [];
  let handler;
  const registered = { scripts: [], injected: [], removed: [] };
  const chrome = {
    storage: {
      local: area('local'),
      session: area('session'),
      sync: area('sync'),
      onChanged: { addListener: (f) => cloud.listeners.add(f) },
    },
    runtime: {
      onInstalled: { addListener: (f) => onInstalled.push(f) },
      onStartup: { addListener() {} },
      onMessage: { addListener: (f) => (handler = f) },
    },
    tabs: { sendMessage: async () => {}, onRemoved: { addListener() {} } },
    permissions: {
      contains: async ({ origins }) => origins.every(granted),
      remove: async ({ origins }) => registered.removed.push(...origins),
      onAdded: { addListener() {} },
      onRemoved: { addListener() {} },
    },
    scripting: {
      getRegisteredContentScripts: async () => registered.scripts,
      unregisterContentScripts: async () => (registered.scripts = []),
      registerContentScripts: async (list) => (registered.scripts = list),
      executeScript: async (o) => registered.injected.push(o),
    },
  };
  // importScripts('build.js', 'shared.js') фона — подставляем сборку и функции shared.js в его область
  const names = Object.keys(shared);
  new Function('chrome', 'importScripts', 'AT_BUILD', ...names, src)(chrome, () => {}, build, ...names.map((n) => shared[n]));
  // sender.tab.url — адрес верхней страницы вкладки (Chrome отдаёт его при host_permissions)
  const call = (msg, tabId = 0, url) => new Promise((r) => handler(msg, { tab: { id: tabId, url } }, r));
  // «установка расширения» на этом компьютере: обработчики onInstalled (сверка с sync и т. п.)
  const install = async () => {
    for (const f of onInstalled) await f();
    await idle();
  };
  return { call, store, registered, install };
}

// дождаться, пока события sync разойдутся и очередь фона их обработает
const idle = () => new Promise((r) => setTimeout(r, 150));

const meta = (t) => ({ site: 'newdeaf', url: `https://a.newdeaf.co/anime/${t}.html`, title: t, total: 12 });

test('одновременные записи не затирают друг друга, досмотр отмечается', async () => {
  for (let run = 0; run < 5; run++) {
    const { call } = boot();
    await call({ type: 'page', meta: meta('A') }, 1);
    await call({ type: 'page', meta: meta('B') }, 2);
    await Promise.all([
      call({ type: 'progress', season: 1, episode: 3, time: 1300, duration: 1400 }, 1),
      call({ type: 'progress', season: 1, episode: 7, time: 100, duration: 1400 }, 2),
    ]);
    const { list } = await call({ type: 'list' });
    const by = Object.fromEntries(list.map((e) => [e.title, e]));
    assert.equal(by.A.episode, 3);
    assert.equal(by.A.watched['1:3'], true);
    assert.equal(by.B.episode, 7);
  }
});

test('ручная правка принимает только серию и время — url и ключ не переписать', async () => {
  const { call } = boot();
  await call({ type: 'page', meta: meta('C') }, 1);
  await call({ type: 'progress', season: 1, episode: 5, time: 400, duration: 1400 }, 1);
  const key = 'newdeaf:/anime/C.html';
  const { entry } = await call({
    type: 'manual',
    key,
    patch: { episode: 6, time: 0, url: 'javascript:alert(1)', key: 'x', watched: { hack: true }, duration: -5 },
  });
  assert.equal(entry.episode, 6);
  assert.equal(entry.time, 0);
  assert.equal(entry.url, 'https://a.newdeaf.co/anime/C.html');
  assert.equal(entry.key, key);
  assert.equal(entry.watched.hack, undefined);
  assert.equal(entry.duration, 1400); // отрицательное отброшено
});

test('озвучка, выбранная до первого просмотра, попадает в запись', async () => {
  const { call } = boot();
  await call({ type: 'page', meta: meta('D') }, 1);
  await call({ type: 'translation', translation: { title: 'Субтитры', type: 'sub', path: '/serial/1/h/720p' } }, 1);
  await call({ type: 'progress', season: 1, episode: 1, time: 50, duration: 1400 }, 1);
  const { list } = await call({ type: 'list' });
  assert.equal(list[0].translation.title, 'Субтитры');
});

test('«Вернуть» восстанавливает удалённую запись, но не принимает небезопасный адрес', async () => {
  const { call } = boot();
  await call({ type: 'page', meta: meta('E') }, 1);
  await call({ type: 'progress', season: 1, episode: 4, time: 300, duration: 1400 }, 1);
  const key = 'newdeaf:/anime/E.html';
  const before = (await call({ type: 'list' })).list.find((e) => e.key === key);
  await call({ type: 'remove', key });
  assert.equal((await call({ type: 'list' })).list.length, 0);
  await call({ type: 'restore', entry: before });
  assert.equal((await call({ type: 'list' })).list[0].episode, 4);
  const bad = await call({ type: 'restore', entry: { key: 'x:/y', url: 'javascript:alert(1)' } });
  assert.equal(bad.ok, false);
});

test('окно плеера получает запись по адресу вкладки, даже если страница ещё не зарегистрировалась', async () => {
  // Регрессия 11.10: попап открывает тайтл в НОВОЙ вкладке; обёртка Kodik спрашивала запись раньше,
  // чем верхняя страница присылала page, — и получала null, Kodik открывался в озвучке по умолчанию.
  const { call } = boot();
  const url = 'https://yummyanime.tv/100-blich-m2.html';
  const m = { site: 'yummyanime', url, title: 'Блич', total: 366 };
  await call({ type: 'page', meta: m }, 1, url);
  await call({ type: 'translation', translation: { title: 'Субтитры', type: 'sub', path: '/serial/33316/h/720p' } }, 1, url);
  await call({ type: 'progress', season: 1, episode: 8, time: 160, duration: 1384 }, 1, url);
  // новая вкладка 2: page ещё не пришёл
  const { entry } = await call({ type: 'entry' }, 2, url);
  assert.equal(entry?.episode, 8);
  assert.equal(entry?.translation?.title, 'Субтитры');
});

test('окно плеера не получает запись ДРУГОГО тайтла после перехода в той же вкладке', async () => {
  const { call } = boot();
  const a = 'https://yummyanime.tv/100-blich-m2.html';
  const b = 'https://yummyanime.tv/200-naruto.html';
  await call({ type: 'page', meta: { site: 'yummyanime', url: a, title: 'Блич' } }, 1, a);
  await call({ type: 'progress', season: 1, episode: 8, time: 160, duration: 1384 }, 1, a);
  // вкладка 1 перешла на Наруто, page от новой страницы ещё не пришёл
  const { entry } = await call({ type: 'entry' }, 1, b);
  assert.equal(entry, null);
});

const SUBS = { id: 869, title: 'Субтитры', type: 'sub', path: '/serial/33316/h/720p' };
const DUB = { id: 609, title: 'AniDUB', type: 'dub', path: '/serial/5310/h/720p' };

test('озвучка, которую Kodik подставил сам, не затирает выбранную человеком', async () => {
  // Регрессия 11.10: Kodik открылся в AniDUB по своей памяти, расширение записало это как выбор
  // человека — попап сменил SUB на DUB, и следующее открытие шло уже в AniDUB.
  const { call } = boot();
  await call({ type: 'page', meta: meta('F') }, 1);
  await call({ type: 'translation', translation: SUBS }, 1);
  await call({ type: 'progress', season: 1, episode: 9, time: 72, duration: 1384, translation: DUB, chosen: false }, 1);
  assert.equal((await call({ type: 'list' })).list[0].translation.title, 'Субтитры');
  // сменил сам в меню Kodik — запоминаем
  await call({ type: 'progress', season: 1, episode: 9, time: 80, duration: 1384, translation: DUB, chosen: true }, 1);
  assert.equal((await call({ type: 'list' })).list[0].translation.title, 'AniDUB');
});

test('без сохранённой озвучки запоминается та, что реально играла', async () => {
  const { call } = boot();
  await call({ type: 'page', meta: meta('G') }, 1);
  await call({ type: 'progress', season: 1, episode: 1, time: 50, duration: 1384, translation: DUB, chosen: false }, 1);
  assert.equal((await call({ type: 'list' })).list[0].translation.title, 'AniDUB');
});

test('«Сменить озвучку» сбрасывает её у записи', async () => {
  const { call } = boot();
  await call({ type: 'page', meta: meta('H') }, 1);
  await call({ type: 'translation', translation: SUBS }, 1);
  await call({ type: 'progress', season: 1, episode: 2, time: 50, duration: 1384 }, 1);
  const { entry } = await call({ type: 'forgetTranslation', key: 'newdeaf:/anime/H.html' }, 1);
  assert.equal(entry.translation, null);
  assert.equal(entry.episode, 2);
});

// ── сборка для магазина: сайты добавляет человек ──

test('магазин: сайт добавляется только с выданным доступом, трекер регистрируется на его окна', async () => {
  const { call, registered } = boot({ build: 'store' });
  const r = await call({
    type: 'trackSite',
    host: 'www.example.com',
    origins: ['https://www.example.com', 'https://player.cdn.net', 'javascript:alert(1)'],
    tabId: 7,
  });
  assert.equal(r.ok, true);
  const [script] = registered.scripts;
  assert.deepEqual(script.matches, ['https://www.example.com/*', 'https://player.cdn.net/*']);
  assert.equal(script.allFrames, true);
  assert.deepEqual(script.js, ['build.js', 'shared.js', 'tracker.js']);
  assert.equal(registered.injected[0].target.tabId, 7); // открытая вкладка начинает отслеживаться сразу

  const denied = boot({ build: 'store', granted: () => false });
  assert.equal((await denied.call({ type: 'trackSite', host: 'a.com', origins: ['https://a.com'] })).ok, false);
  assert.equal(denied.registered.scripts.length, 0);
});

test('магазин: окно плеера получает запись только для добавленного сайта', async () => {
  const { call } = boot({ build: 'store' });
  const url = 'https://www.example.com/show/1';
  await call({ type: 'trackSite', host: 'example.com', origins: ['https://www.example.com'] });
  await call({ type: 'page', meta: { site: 'example.com', url, title: 'Шоу' } }, 1, url);
  await call({ type: 'progress', season: 1, episode: 3, time: 120, duration: 1400 }, 1, url);
  assert.equal((await call({ type: 'entry' }, 2, url)).entry?.episode, 3);
  // сайт из личной сборки в магазинной не узнаётся
  assert.equal((await call({ type: 'entry' }, 3, 'https://yummyanime.tv/100-blich-m2.html')).entry, null);
});

test('магазин: «Не отслеживать» убирает сайт, регистрацию и доступ, история остаётся', async () => {
  const { call, registered } = boot({ build: 'store' });
  const url = 'https://example.com/show/1';
  await call({ type: 'trackSite', host: 'example.com', origins: ['https://example.com'] });
  await call({ type: 'page', meta: { site: 'example.com', url, title: 'Шоу' } }, 1, url);
  await call({ type: 'progress', season: 1, episode: 2, time: 60, duration: 1400 }, 1, url);
  assert.equal((await call({ type: 'untrackSite', host: 'example.com' })).ok, true);
  assert.equal(registered.scripts.length, 0);
  assert.deepEqual(registered.removed, ['https://example.com/*']);
  assert.equal((await call({ type: 'list' })).list.length, 1);
});

test('личная сборка не принимает добавление сайтов', async () => {
  const { call } = boot();
  assert.equal((await call({ type: 'trackSite', host: 'a.com', origins: ['https://a.com'] })).ok, false);
});

test('готовая сборка для магазина работает без вырезанного кода личной', async () => {
  execFileSync(process.execPath, [new URL('../scripts/build.mjs', import.meta.url).pathname]);
  const { call, registered } = boot({ build: 'store', dir: '../dist/store' });
  const url = 'https://video.example.org/series/5';
  assert.equal((await call({ type: 'trackSite', host: 'video.example.org', origins: ['https://video.example.org'], tabId: 1 })).ok, true);
  await call({ type: 'page', meta: { site: 'video.example.org', url, title: 'Сериал' } }, 1, url);
  await call({ type: 'progress', season: 2, episode: 4, time: 300, duration: 1400 }, 1, url);
  assert.equal((await call({ type: 'entry' }, 2, url)).entry?.episode, 4);
  await call({ type: 'manual', key: 'video.example.org:/series/5', patch: { episode: 5 } });
  assert.equal((await call({ type: 'list' })).list[0].episode, 5);
  assert.equal(registered.scripts[0].js.includes('tracker.js'), true);
});

// ── синхронизация между компьютерами одного профиля Chrome ──

const blich = (n) => ({ site: 'newdeaf', url: `https://a.newdeaf.co/anime/${n}.html`, title: n, total: 366 });

test('sync: досмотренное на одном компьютере появляется на другом', async () => {
  const cloud = makeCloud();
  const a = boot({ cloud });
  const b = boot({ cloud });
  await a.call({ type: 'page', meta: blich('S1') }, 1);
  await a.call({ type: 'progress', season: 1, episode: 9, time: 1300, duration: 1384, force: true }, 1);
  await idle();
  const [e] = (await b.call({ type: 'list' })).list;
  assert.equal(e?.title, 'S1');
  assert.equal(e.episode, 9);
  assert.equal(e.watched['1:9'], true);
});

test('sync: время во время просмотра — не чаще раза в минуту, пауза и смена серии — сразу', async () => {
  const cloud = makeCloud();
  const a = boot({ cloud });
  await a.call({ type: 'page', meta: blich('S2') }, 1);
  await a.call({ type: 'progress', season: 1, episode: 1, time: 10, duration: 1384 }, 1);
  const first = cloud.writes;
  for (let t = 20; t <= 60; t += 10) await a.call({ type: 'progress', season: 1, episode: 1, time: t, duration: 1384 }, 1);
  assert.equal(cloud.writes, first); // опрос каждые 10 с в sync не идёт (лимит 120 записей в минуту)
  await a.call({ type: 'progress', season: 1, episode: 1, time: 65, duration: 1384, force: true }, 1);
  assert.equal(cloud.writes, first + 1); // пауза — сразу
  await a.call({ type: 'progress', season: 1, episode: 2, time: 5, duration: 1384 }, 1);
  assert.equal(cloud.writes, first + 2); // новая серия — сразу, даже без force
});

test('sync: побеждает более свежая запись, а не последняя пришедшая', async () => {
  const cloud = makeCloud();
  const a = boot({ cloud });
  const b = boot({ cloud });
  await a.call({ type: 'page', meta: blich('S3') }, 1);
  await a.call({ type: 'progress', season: 1, episode: 5, time: 100, duration: 1384, force: true }, 1);
  await idle();
  await b.call({ type: 'page', meta: blich('S3') }, 1);
  await b.call({ type: 'progress', season: 1, episode: 6, time: 200, duration: 1384, force: true }, 1);
  await idle();
  assert.equal((await a.call({ type: 'list' })).list[0].episode, 6);
  // запоздавшая старая запись с первого компьютера не откатывает второй
  const stale = { ...cloud.data['e:newdeaf:/anime/S3.html'], e: 4, up: 1 };
  for (const f of cloud.listeners) f({ 'e:newdeaf:/anime/S3.html': { newValue: stale } }, 'sync');
  await idle();
  assert.equal((await b.call({ type: 'list' })).list[0].episode, 6);
});

test('sync: удаление расходится, «Вернуть» отменяет его на обоих', async () => {
  const cloud = makeCloud();
  const a = boot({ cloud });
  const b = boot({ cloud });
  await a.call({ type: 'page', meta: blich('S4') }, 1);
  await a.call({ type: 'progress', season: 1, episode: 3, time: 100, duration: 1384, force: true }, 1);
  await idle();
  const entry = (await b.call({ type: 'list' })).list[0];
  await a.call({ type: 'remove', key: entry.key });
  await idle();
  assert.equal((await b.call({ type: 'list' })).list.length, 0);
  await a.call({ type: 'restore', entry });
  await idle();
  assert.equal((await b.call({ type: 'list' })).list[0]?.episode, 3);
});

test('sync: при нехватке места вытесняется самая старая запись, но у других компьютеров она остаётся', async () => {
  const cloud = makeCloud({ quota: 650 }) // три записи по ~200 байт;
  const a = boot({ cloud });
  const b = boot({ cloud });
  for (const n of ['Q1', 'Q2', 'Q3', 'Q4']) {
    await a.call({ type: 'page', meta: blich(n) }, 1);
    await a.call({ type: 'progress', season: 1, episode: 2, time: 50, duration: 1384, force: true }, 1);
    await idle();
  }
  const synced = Object.keys(cloud.data).filter((k) => k.startsWith('e:'));
  assert.ok(synced.includes('e:newdeaf:/anime/Q4.html')); // свежая влезла
  assert.ok(!synced.includes('e:newdeaf:/anime/Q1.html')); // старая вытеснена из sync
  const titles = (await b.call({ type: 'list' })).list.map((e) => e.title);
  assert.ok(titles.includes('Q1')); // но второй компьютер её не потерял
});

test('sync: новая установка забирает историю из sync и отдаёт свою', async () => {
  const cloud = makeCloud();
  const a = boot({ cloud });
  await a.call({ type: 'page', meta: blich('R1') }, 1);
  await a.call({ type: 'progress', season: 1, episode: 7, time: 100, duration: 1384, force: true }, 1);
  const b = boot({ cloud });
  b.store.local.history = {
    'newdeaf:/anime/R2.html': {
      key: 'newdeaf:/anime/R2.html', site: 'newdeaf', url: 'https://a.newdeaf.co/anime/R2.html', title: 'R2',
      season: 1, episode: 2, time: 30, duration: 1384, watched: {}, updatedAt: Date.now(),
    },
  };
  await b.install();
  assert.deepEqual((await b.call({ type: 'list' })).list.map((e) => e.title).sort(), ['R1', 'R2']);
  assert.ok(cloud.data['e:newdeaf:/anime/R2.html']); // своё отдала
});
