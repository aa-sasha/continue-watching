'use strict';

// сборка (build.js) и общая логика (shared.js); в тестах под node importScripts подменяется
if (typeof importScripts === 'function') importScripts('build.js', 'shared.js');
// Сборка для магазина — универсальный трекер: сайты добавляет человек, доступ к ним выдаёт Chrome.
// Личная — со списком сайтов в коде (AT_SITES) и модулями под них.
const STORE = AT_BUILD === 'store';

// История просмотра в chrome.storage.local (а не sync: прогресс пишется раз в ~10 с, у sync лимит
// 120 записей в минуту и 8 КБ на ключ). Одна запись на тайтл:
//   history[key] = { key, site, url, title, poster, total, season, episode, time, duration,
//                    watched: { 'сезон:серия': true }, updatedAt }
// key = site + путь без домена: у некоторых сайтов меняется домен (зеркала), а путь — нет.

const MAX_ENTRIES = 200;
// tabId → мета страницы из верхнего фрейма. В storage.session, а не в переменной: service worker
// MV3 засыпает через ~30 с простоя, и прогресс из плеера приходил бы «ничьим».
const setPage = (tabId, meta) => chrome.storage.session.set({ [`tab_${tabId}`]: meta });
const getPage = async (tabId) => (await chrome.storage.session.get(`tab_${tabId}`))[`tab_${tabId}`];

const keyOf = (site, url) => `${site}:${new URL(url).pathname}`;

// ── отслеживаемые сайты (сборка для магазина) ──
// sites = [{ host: 'example.com', origins: ['https://www.example.com', 'https://player.cdn.net'] }]
// origins — сам сайт и окна его плеера с других доменов: туда тоже нужен доступ, чтобы читать <video>.
const getSites = async () => (await chrome.storage.local.get('sites')).sites || [];
const ORIGIN = /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i;
const pattern = (origin) => `${origin}/*`;
const TRACKER_JS = ['build.js', 'shared.js', 'tracker.js'];

/** id сайта для хоста: в магазинной сборке — только добавленный человеком. */
async function siteOfHost(hostname) {
  // @personal-start
  if (!STORE) return atSiteOf(hostname);
  // @personal-end
  return atTrackedSite(hostname, await getSites())?.host || null;
}

// Скрипт трекера — только на сайтах, к которым человек дал доступ. Регистрация живёт между
// перезапусками браузера, но после правки списка её пересобираем целиком.
async function syncRegistration() {
  if (!STORE) return;
  const matches = [];
  for (const s of await getSites())
    for (const o of s.origins) if (await chrome.permissions.contains({ origins: [pattern(o)] })) matches.push(pattern(o));
  const had = await chrome.scripting.getRegisteredContentScripts({ ids: ['tracker'] });
  if (had.length) await chrome.scripting.unregisterContentScripts({ ids: ['tracker'] });
  if (!matches.length) return;
  await chrome.scripting.registerContentScripts([
    { id: 'tracker', matches: [...new Set(matches)], js: TRACKER_JS, allFrames: true, runAt: 'document_idle' },
  ]);
}

async function addSite(host, origins) {
  host = atHostKey(host);
  origins = [...new Set((origins || []).filter((o) => typeof o === 'string' && ORIGIN.test(o)))];
  if (!host || !origins.length) return false;
  // без выданного доступа сайт не добавляем: иначе в списке «отслеживается» то, что не работает
  if (!(await chrome.permissions.contains({ origins: origins.map(pattern) }))) return false;
  const sites = (await getSites()).filter((s) => s.host !== host);
  sites.push({ host, origins });
  await chrome.storage.local.set({ sites });
  await syncRegistration();
  return true;
}

if (STORE) {
  chrome.runtime.onStartup?.addListener(() => serial(syncRegistration));
  // Окно разрешения Chrome может закрыть попап раньше, чем он узнает ответ. Поэтому попап заранее
  // кладёт заявку (pendingTrack), а сайт добавляет фон, когда доступ действительно выдан.
  chrome.permissions.onAdded?.addListener(() =>
    serial(async () => {
      const { pendingTrack } = await chrome.storage.local.get('pendingTrack');
      if (!pendingTrack) return;
      if (await addSite(pendingTrack.host, pendingTrack.origins)) {
        await chrome.storage.local.remove('pendingTrack');
        injectNow(pendingTrack.tabId);
      }
    })
  );
  // доступ отозвали в настройках Chrome — сайт больше не отслеживается
  chrome.permissions.onRemoved?.addListener(() =>
    serial(async () => {
      const kept = [];
      for (const s of await getSites())
        if (await chrome.permissions.contains({ origins: [pattern(s.origins[0])] })) kept.push(s);
      await chrome.storage.local.set({ sites: kept });
      await syncRegistration();
    })
  );
}

// только что добавленный сайт начинает отслеживаться сразу, без перезагрузки вкладки
function injectNow(tabId) {
  if (!Number.isInteger(tabId)) return;
  chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: TRACKER_JS }).catch(() => {});
}

async function getHistory() {
  return (await chrome.storage.local.get('history')).history || {};
}

async function saveHistory(h) {
  const keys = Object.keys(h);
  if (keys.length > MAX_ENTRIES) {
    keys
      .sort((a, b) => (h[a].updatedAt || 0) - (h[b].updatedAt || 0))
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((k) => delete h[k]);
  }
  await chrome.storage.local.set({ history: h });
}

chrome.runtime.onInstalled.addListener(() => serial(syncRegistration));

// @personal-start перенос истории YummyAni Tracker 1.x
// Перенос истории из YummyAni Tracker 1.x (chrome.storage.sync: watchIndex + watch_{slug})
chrome.runtime.onInstalled.addListener(async () => {
  const { migrated } = await chrome.storage.local.get('migrated');
  if (migrated) return;
  const { watchIndex = [] } = await chrome.storage.sync.get('watchIndex');
  if (watchIndex.length) {
    const old = await chrome.storage.sync.get(watchIndex.map((s) => `watch_${s}`));
    const h = await getHistory();
    for (const slug of watchIndex) {
      const e = old[`watch_${slug}`];
      if (!e) continue;
      const key = keyOf('yummyani', e.url);
      const season = parseInt(String(e.season || '').replace(/\D+/g, ''), 10) || null;
      h[key] ??= {
        key,
        site: 'yummyani',
        url: e.url,
        title: e.title,
        season,
        episode: e.episode,
        time: 0,
        duration: 0,
        watched: {},
        updatedAt: e.lastWatched || Date.now(),
      };
    }
    await saveHistory(h);
  }
  await chrome.storage.local.set({ migrated: true });
});
// @personal-end

// Все обращения к истории — строго по очереди. Иначе два почти одновременных сообщения (пауза +
// опрос, два плеера, две вкладки) читают одну версию, и вторая запись затирает первую.
let queue = Promise.resolve();
const serial = (fn) => (queue = queue.then(fn, fn));

// ── синхронизация между компьютерами одного профиля Chrome (chrome.storage.sync) ──
// Главная история — локальная (пишется раз в ~10 с). В sync уходит сжатая суть каждой записи
// (`e:<ключ>`, shared.js atPackEntry). Лимиты sync — ~100 КБ всего, 8 КБ на запись, 120 записей
// в минуту, — поэтому пишем только смену серии/паузу/досмотр (force) и не чаще раза в минуту
// во время просмотра. Конфликт двух компьютеров решает свежесть (updatedAt).
// Удаление — отдельным списком `deleted` {ключ: когда}: просто пропавшая из sync запись могла быть
// вытеснена по лимиту, и стирать её у другого компьютера нельзя.
const SYNC_PREFIX = 'e:';
const SYNC_EVERY = 60000;
const TOMBSTONES_MAX = 200;
const lastPush = new Map(); // ключ → { at, mark }

const syncMark = (e) => `${e.season}:${e.episode}:${Object.keys(e.watched || {}).length}:${e.translation?.path || ''}`;

async function pushSync(e, force) {
  if (!e?.key) return;
  const mark = syncMark(e);
  const prev = lastPush.get(e.key);
  if (!force && prev && prev.mark === mark && Date.now() - prev.at < SYNC_EVERY) return;
  lastPush.set(e.key, { at: Date.now(), mark });
  const item = { [SYNC_PREFIX + e.key]: atPackEntry(e) };
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await chrome.storage.sync.set(item);
      return;
    } catch (err) {
      // места нет — вытесняем самую старую запись из sync (у других компьютеров она остаётся)
      if (!/quota/i.test(String(err?.message || err)) || !(await evictOldestSync(e.key))) return;
    }
  }
}

async function evictOldestSync(keep) {
  const all = await chrome.storage.sync.get(null);
  let oldest = null;
  for (const [k, v] of Object.entries(all))
    if (k.startsWith(SYNC_PREFIX) && k !== SYNC_PREFIX + keep && (!oldest || (v?.up || 0) < oldest.up))
      oldest = { k, up: v?.up || 0 };
  if (!oldest) return false;
  await chrome.storage.sync.remove(oldest.k);
  return true;
}

async function deleteSync(keys) {
  const { deleted = {} } = await chrome.storage.sync.get('deleted');
  const now = Date.now();
  for (const k of keys) {
    deleted[k] = now;
    lastPush.delete(k);
  }
  // хранить вечно незачем: оставляем самые свежие
  const kept = Object.entries(deleted).sort((a, b) => b[1] - a[1]).slice(0, TOMBSTONES_MAX);
  await chrome.storage.sync.set({ deleted: Object.fromEntries(kept) }).catch(() => {});
  await chrome.storage.sync.remove(keys.map((k) => SYNC_PREFIX + k)).catch(() => {});
}

// пришло с другого компьютера (или полная сверка при запуске): более свежее — в локальную историю
async function applyRemote(entries, deleted) {
  const h = await getHistory();
  let changed = false;
  for (const p of entries) {
    const remote = atUnpackEntry(p);
    if (!remote) continue;
    if (deleted?.[remote.key] >= remote.updatedAt) continue; // удалили позже этой записи
    const merged = atMergeRemote(h[remote.key], remote);
    if (merged) {
      h[remote.key] = merged;
      changed = true;
    }
  }
  for (const [k, at] of Object.entries(deleted || {}))
    if (h[k] && (h[k].updatedAt || 0) <= at) {
      delete h[k];
      changed = true;
    }
  if (changed) await saveHistory(h);
}

// Полная сверка при установке и запуске: забрать чужое, отдать своё, чего в sync нет или там старее.
async function reconcileSync() {
  const all = await chrome.storage.sync.get(null);
  const remote = Object.entries(all)
    .filter(([k]) => k.startsWith(SYNC_PREFIX))
    .map(([, v]) => v);
  await applyRemote(remote, all.deleted);
  const h = await getHistory();
  const ups = Object.fromEntries(remote.map((p) => [p?.k, p?.up || 0]));
  const mine = Object.values(h)
    .filter((e) => (ups[e.key] ?? -1) < (e.updatedAt || 0))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)); // свежие первыми: им место в sync важнее
  for (const e of mine) await pushSync(e, true);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  const entries = [];
  for (const [k, c] of Object.entries(changes)) if (k.startsWith(SYNC_PREFIX) && c.newValue) entries.push(c.newValue);
  const deleted = changes.deleted?.newValue;
  if (entries.length || deleted) serial(() => applyRemote(entries, deleted));
});
chrome.runtime.onInstalled.addListener(() => serial(reconcileSync));
chrome.runtime.onStartup?.addListener(() => serial(reconcileSync));

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  serial(() => handle(msg, sender))
    .then(reply)
    .catch((err) => {
      console.error('[AnimeTracker]', err);
      reply(null);
    });
  return true;
});

async function handle(msg, sender) {
  const tabId = sender.tab?.id;

  if (msg.type === 'page') {
    await setPage(tabId, msg.meta);
    const h = await getHistory();
    const key = keyOf(msg.meta.site, msg.meta.url);
    const e = h[key];
    if (e) {
      // обновляем живой домен, постер и число серий, но не трогаем прогресс
      Object.assign(e, {
        url: msg.meta.url,
        title: msg.meta.title || e.title,
        poster: msg.meta.poster || e.poster,
        total: msg.meta.total || e.total,
      });
      await saveHistory(h);
    }
    return { entry: e || null };
  }

  if (msg.type === 'progress') {
    const meta = await getPage(tabId);
    if (!meta) return null; // плеер на странице, которую верхний скрипт не признал тайтлом
    const h = await getHistory();
    const key = keyOf(meta.site, meta.url);
    const prev = h[key] || { watched: {} };
    const season = msg.season || prev.season || meta.pageSeason || null;
    const watched = { ...prev.watched };
    if (msg.duration > 0 && msg.time / msg.duration >= 0.9) watched[`${season || 0}:${msg.episode}`] = true;
    h[key] = {
      ...prev,
      key,
      site: meta.site,
      url: meta.url,
      title: meta.title || prev.title,
      poster: meta.poster || prev.poster,
      total: meta.total || prev.total,
      player: prev.player || meta.player,
      // Озвучка плеера (личная сборка) — чтобы открыть ту же, а не по умолчанию. Перезаписывает
      // сохранённую только выбранная человеком в меню плеера (chosen): ту, что плеер подставил сам,
      // записать как выбор нельзя (11.10). Пустое место заполняет любая реально игравшая.
      translation: (msg.chosen && msg.translation) || prev.translation || meta.translation || msg.translation || null,
      season,
      episode: msg.episode,
      time: msg.time,
      duration: msg.duration || prev.duration || 0,
      watched,
      updatedAt: Date.now(),
    };
    await saveHistory(h);
    // в sync — сразу на паузе, смене серии и досмотре (force), иначе не чаще раза в минуту
    await pushSync(h[key], msg.force);
    chrome.tabs.sendMessage(tabId, { type: 'updated', entry: h[key] }).catch(() => {});
    return { ok: true };
  }

  // @personal-start выбор плеера и озвучки на странице
  // какой плеер страницы выбрал пользователь («Kodik», «Плеер 2») — откроем его в следующий раз
  if (msg.type === 'player') {
    const meta = await getPage(tabId);
    if (!meta) return null;
    const h = await getHistory();
    const key = keyOf(meta.site, meta.url);
    if (h[key]) {
      h[key].player = msg.label;
      await saveHistory(h);
    } else {
      await setPage(tabId, { ...meta, player: msg.label }); // записи ещё нет — заберём при первом прогрессе
    }
    return { ok: true };
  }

  // озвучка Kodik выбрана — запоминаем сразу, без ожидания прогресса
  if (msg.type === 'translation') {
    const meta = await getPage(tabId);
    if (!meta || !msg.translation?.path) return null;
    const h = await getHistory();
    const key = keyOf(meta.site, meta.url);
    if (h[key]) {
      h[key].translation = msg.translation;
      h[key].updatedAt = Date.now(); // свежее — чтобы выбор дошёл до другого компьютера
      await saveHistory(h);
      await pushSync(h[key], true);
      chrome.tabs.sendMessage(tabId, { type: 'updated', entry: h[key] }).catch(() => {});
    } else {
      await setPage(tabId, { ...meta, translation: msg.translation });
    }
    return { ok: true };
  }

  // «Сменить озвучку» на плашке: забываем её — Kodik откроется со списком озвучек, выбор запомнится
  if (msg.type === 'forgetTranslation') {
    const h = await getHistory();
    const e = h[msg.key];
    if (!e) return { entry: null };
    e.translation = null;
    e.updatedAt = Date.now();
    await saveHistory(h);
    await pushSync(e, true);
    if (tabId !== undefined) chrome.tabs.sendMessage(tabId, { type: 'updated', entry: e }).catch(() => {});
    return { entry: e };
  }
  // @personal-end

  // Окно плеера спрашивает, с какого места продолжать. Ключ — по НАСТОЯЩЕМУ адресу вкладки
  // (sender.tab.url), а не по мете, которую присылает верхняя страница: окно плеера спрашивает
  // раньше, чем страница успевает её прислать (в новой вкладке из попапа меты нет вовсе), а после
  // перехода в той же вкладке старая мета указала бы на ДРУГОЙ тайтл (регрессия 11.10).
  if (msg.type === 'entry') {
    const url = sender.tab?.url;
    let site = null;
    try {
      site = url ? await siteOfHost(new URL(url).hostname) : null;
    } catch {
      site = null;
    }
    if (!site) return { entry: null };
    const h = await getHistory();
    return { entry: h[keyOf(site, url)] || null };
  }

  // «Отслеживать этот сайт» из попапа (доступ уже выдан окном Chrome)
  if (msg.type === 'trackSite') {
    if (!STORE) return { ok: false };
    const ok = await addSite(msg.host, msg.origins);
    if (ok) {
      await chrome.storage.local.remove('pendingTrack');
      injectNow(msg.tabId);
    }
    return { ok };
  }

  if (msg.type === 'untrackSite') {
    if (!STORE) return { ok: false };
    const host = atHostKey(msg.host);
    const sites = await getSites();
    const site = sites.find((s) => s.host === host);
    if (!site) return { ok: false };
    await chrome.storage.local.set({ sites: sites.filter((s) => s !== site) });
    await syncRegistration();
    // доступ возвращаем Chrome; история просмотров остаётся
    await chrome.permissions.remove({ origins: site.origins.map(pattern) }).catch(() => {});
    return { ok: true };
  }

  if (msg.type === 'manual') {
    const h = await getHistory();
    const e = h[msg.key];
    if (!e) return { entry: null };
    // белый список полей и типов: правка серии не должна переписать url, ключ или историю
    const p = msg.patch || {};
    const int = (v) => (Number.isInteger(v) && v >= 0 && v <= 100000 ? v : undefined);
    const patch = { episode: int(p.episode), time: int(p.time), duration: int(p.duration) };
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];
    if (patch.episode === 0) delete patch.episode;
    // человек сказал «я на этой серии» — значит, она не досмотрена, иначе «‹ ›» ничего не меняли бы
    // (отметка осталась бы, и попап снова показал бы следующую; регрессия 13.10)
    if (patch.episode && e.watched) {
      e.watched = { ...e.watched };
      delete e.watched[`${e.season || 0}:${patch.episode}`];
    }
    Object.assign(e, patch, { updatedAt: Date.now() });
    await saveHistory(h);
    await pushSync(e, true);
    return { entry: e };
  }

  if (msg.type === 'list') {
    const h = await getHistory();
    return { list: Object.values(h).sort((a, b) => b.updatedAt - a.updatedAt) };
  }

  // «Вернуть» после удаления: запись приходит из попапа, кладём её обратно под её же ключом
  if (msg.type === 'restore') {
    const e = msg.entry;
    if (!e?.key || typeof e.key !== 'string' || !/^https?:[/][/]/.test(e.url || '')) return { ok: false };
    const h = await getHistory();
    h[e.key] ??= e;
    await saveHistory(h);
    // «Вернуть» отменяет и удаление на других компьютерах: снимаем отметку, отдаём запись заново
    const { deleted = {} } = await chrome.storage.sync.get('deleted');
    if (e.key in deleted) {
      delete deleted[e.key];
      await chrome.storage.sync.set({ deleted }).catch(() => {});
    }
    await pushSync(h[e.key], true);
    return { ok: true };
  }

  if (msg.type === 'remove') {
    const h = await getHistory();
    delete h[msg.key];
    await saveHistory(h);
    await deleteSync([msg.key]);
    return { ok: true };
  }

  if (msg.type === 'clear') {
    const keys = Object.keys(await getHistory());
    await chrome.storage.local.set({ history: {} });
    await deleteSync(keys);
    return { ok: true };
  }
  return null;
}

chrome.tabs.onRemoved.addListener((id) => chrome.storage.session.remove(`tab_${id}`));
