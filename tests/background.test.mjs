// Фоновая часть: очередь записей, досмотр, белый список ручной правки.
// Гоняем настоящий background.js в песочнице с поддельным chrome.storage (случайные задержки —
// чтобы гонки, если они есть, проявлялись).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Облако chrome.storage.sync: одно на несколько «компьютеров» (boot с общим cloud). Изменение
// доходит до всех подписчиков onChanged, как в Chrome. quota — лимит байт на всё (QUOTA_BYTES).
function makeCloud({ quota = Infinity, quotaPerItem = Infinity } = {}) {
  return { data: {}, listeners: new Set(), quota, quotaPerItem, writes: 0 };
}

// dir — откуда брать background.js и shared.js
function boot({ dir = '..', cloud = makeCloud() } = {}) {
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
        for (const [k, v] of Object.entries(o))
          if (k.length + size(v) > cloud.quotaPerItem) throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
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
  const chrome = {
    storage: {
      local: area('local'),
      session: area('session'),
      sync: area('sync'),
      onChanged: { addListener: (f) => cloud.listeners.add(f) },
    },
    runtime: {
      getURL: (path) => `chrome-extension://test/${path}`,
      onInstalled: { addListener: (f) => onInstalled.push(f) },
      onStartup: { addListener() {} },
      onMessage: { addListener: (f) => (handler = f) },
    },
    tabs: { sendMessage: async () => {}, onRemoved: { addListener() {} } },
  };
  // importScripts('shared.js') фона — подставляем функции shared.js в его область
  const names = Object.keys(shared);
  new Function('chrome', 'importScripts', ...names, src)(chrome, () => {}, ...names.map((n) => shared[n]));
  // sender.tab.url — адрес верхней страницы вкладки (Chrome отдаёт его при host_permissions)
  // без вкладки — сообщение из попапа (страница расширения), с вкладкой — из контент-скрипта
  const call = (msg, tabId, url) =>
    new Promise((r) =>
      handler(msg, tabId === undefined && !url ? { url: 'chrome-extension://test/popup.html' } : { tab: { id: tabId ?? 0, url } }, r)
    );
  // то же сообщение, но от контент-скрипта чужой страницы
  const callFromPage = (msg) => new Promise((r) => handler(msg, { tab: { id: 9, url: 'https://evil.example/' } }, r));
  // «установка расширения» на этом компьютере: обработчики onInstalled (сверка с sync и т. п.)
  const install = async () => {
    for (const f of onInstalled) await f();
    await idle();
  };
  return { call, callFromPage, store, install };
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

test('ручной выбор серии снимает с неё отметку «досмотрено» — иначе «‹» ничего не меняет', async () => {
  // Регрессия 13.10: ложно досмотренную 15-ю (см. tests/frame.test.mjs) нельзя было вернуть кнопкой
  // «‹» — серия ставилась 15-я, но отметка оставалась, и попап снова показывал «Дальше 16».
  const { call } = boot();
  await call({ type: 'page', meta: meta('M') }, 1);
  await call({ type: 'progress', season: 1, episode: 15, time: 1394, duration: 1394 }, 1);
  const key = 'newdeaf:/anime/M.html';
  const { entry } = await call({ type: 'manual', key, patch: { episode: 15, time: 0, duration: 0 } });
  assert.equal(require("../shared.js").atStatus(entry).next, 15);
  assert.equal(entry.watched['1:15'], undefined);
});

test('«Отменить» после правки серии возвращает время; «Вернуть» после очистки — всю историю', async () => {
  const { call } = boot();
  await call({ type: 'page', meta: meta('U') }, 1);
  await call({ type: 'progress', season: 1, episode: 6, time: 418, duration: 1384 }, 1);
  const before = (await call({ type: 'list' })).list[0];
  await call({ type: 'manual', key: before.key, patch: { episode: 7, time: 0, duration: 0 } });
  await call({ type: 'restore', entry: before, replace: true });
  const back = (await call({ type: 'list' })).list[0];
  assert.equal(back.episode, 6);
  assert.equal(back.time, 418);

  await call({ type: 'page', meta: meta('V') }, 2);
  await call({ type: 'progress', season: 1, episode: 2, time: 60, duration: 1384 }, 2);
  const all = (await call({ type: 'list' })).list;
  await call({ type: 'clear' });
  assert.equal((await call({ type: 'list' })).list.length, 0);
  await call({ type: 'restoreAll', entries: [...all, { key: 'x', url: 'javascript:alert(1)' }] });
  assert.deepEqual((await call({ type: 'list' })).list.map((e) => e.title).sort(), ['U', 'V']);
});

// ── ревью кода 18.10 ──

test('прогресс не пишется в тайтл, который уже не открыт во вкладке', async () => {
  // мета вкладки от тайтла A, а вкладка уже на B (переход без перезагрузки) — запись A не трогаем
  const { call } = boot();
  const a = 'https://a.newdeaf.co/anime/A1.html';
  await call({ type: 'page', meta: meta('A1') }, 1, a);
  await call({ type: 'progress', season: 1, episode: 3, time: 300, duration: 1400 }, 1, a);
  await call({ type: 'progress', season: 1, episode: 9, time: 50, duration: 1400 }, 1, 'https://a.newdeaf.co/anime/B1.html');
  assert.equal((await call({ type: 'list' })).list[0].episode, 3);
});

test('первые секунды плеера не затирают место остановки той же серии; реклама — не досмотр', async () => {
  const { call } = boot();
  await call({ type: 'page', meta: meta('T1') }, 1);
  await call({ type: 'progress', season: 1, episode: 4, time: 640, duration: 1400 }, 1);
  await call({ type: 'progress', season: 1, episode: 4, time: 1, duration: 1400, force: true }, 1);
  assert.equal((await call({ type: 'list' })).list[0].time, 640);
  await call({ type: 'progress', season: 1, episode: 4, time: 700, duration: 1400 }, 1);
  assert.equal((await call({ type: 'list' })).list[0].time, 700);
  // 30-секундный ролик доигран — серия не досмотрена
  await call({ type: 'progress', season: 1, episode: 5, time: 30, duration: 30 }, 1);
  assert.equal((await call({ type: 'list' })).list[0].watched['1:5'], undefined);
});

test('команды попапа не принимаются от контент-скрипта страницы', async () => {
  const { call, callFromPage } = boot();
  await call({ type: 'page', meta: meta('P1') }, 1);
  await call({ type: 'progress', season: 1, episode: 2, time: 60, duration: 1400 }, 1);
  assert.equal(await callFromPage({ type: 'clear' }), null);
  assert.equal(await callFromPage({ type: 'restore', entry: { key: 'x', url: 'https://phish.example/' } }), null);
  assert.equal((await call({ type: 'list' })).list.length, 1);
});

test('sync: очистка большой истории доходит до другого компьютера (отметки по ключам, не одним объектом)', async () => {
  // 8 КБ на запись: старый общий объект `deleted` на ~120 тайтлах не влезал, и очистка молча терялась
  const cloud = makeCloud({ quotaPerItem: 8192 });
  const a = boot({ cloud });
  const b = boot({ cloud });
  a.store.local.history = {};
  for (let i = 0; i < 150; i++) {
    const key = `newdeaf:/anime/very-long-title-number-${i}-season-one-subtitles.html`;
    a.store.local.history[key] = {
      key, site: 'newdeaf', url: `https://a.newdeaf.co/anime/very-long-title-number-${i}-season-one-subtitles.html`,
      title: `T${i}`, season: 1, episode: 2, time: 30, duration: 1400, watched: {}, updatedAt: Date.now() - 1000,
    };
  }
  await a.install();
  await idle();
  assert.equal((await b.call({ type: 'list' })).list.length, 150);
  await a.call({ type: 'clear' });
  await idle();
  assert.equal((await b.call({ type: 'list' })).list.length, 0);
  // и после перезапуска второго компьютера история не возвращается
  await b.install();
  await idle();
  assert.equal((await a.call({ type: 'list' })).list.length, 0);
});

