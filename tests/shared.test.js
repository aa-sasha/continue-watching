// Общая логика попапа и плашки (shared.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { atStatus, atFmtTime, atSafeUrl, atSiteOf, atKodikSrc, atTrackedSite, atParseLabel, atPackWatched, atUnpackWatched, atPackEntry, atUnpackEntry, atMergeRemote } = require('../shared.js');

test('atStatus: недосмотренная — та же серия, досмотренная — следующая, последняя — весь тайтл', () => {
  assert.deepEqual(atStatus({ season: 1, episode: 6, watched: {} }), { done: false, finished: false, next: 6 });
  assert.deepEqual(atStatus({ season: 1, episode: 8, watched: { '1:8': true } }), { done: true, finished: false, next: 9 });
  assert.equal(atStatus({ season: 6, episode: 6, total: 6, watched: { '6:6': true } }).finished, true);
  // без сезона ключ досмотра — 0:N
  assert.equal(atStatus({ season: null, episode: 9, watched: { '0:9': true } }).next, 10);
});

test('atFmtTime', () => {
  assert.equal(atFmtTime(418), '6:58');
  assert.equal(atFmtTime(3723), '1:02:03');
  assert.equal(atFmtTime(0), '');
  assert.equal(atFmtTime(NaN), '');
});

test('atSafeUrl пропускает только http(s)', () => {
  assert.equal(atSafeUrl('https://yummyanime.tv/100-blich-m2.html'), 'https://yummyanime.tv/100-blich-m2.html');
  assert.equal(atSafeUrl('javascript:alert(1)'), null);
  assert.equal(atSafeUrl('data:text/html,x'), null);
  assert.equal(atSafeUrl('не адрес'), null);
});

test('atKodikSrc: адрес «наша озвучка + нужная серия»', () => {
  const subs = { title: 'Субтитры', type: 'sub', path: '/serial/33316/4438cb17b24193ab2e1c2a2adf3f8d2a/720p' };
  const aniDub = 'https://kodikplayer.com/serial/22916/95c6c145567b328ee15c780fba5d18b2/720p';
  // регрессия 11.10: обёртка вставила iframe AniDUB — подменяем на субтитры, 8 серию
  assert.equal(
    atKodikSrc(aniDub, { season: 1, episode: 8, translation: subs, watched: {} }),
    'https://kodikplayer.com/serial/33316/4438cb17b24193ab2e1c2a2adf3f8d2a/720p?season=1&episode=8',
  );
  // досмотренная — следующая серия
  assert.match(atKodikSrc(aniDub, { season: 1, episode: 8, translation: subs, watched: { '1:8': true } }), /episode=9$/);
  // уже на месте — менять нечего (иначе бесконечная перезагрузка)
  const ok = 'https://kodikplayer.com/serial/33316/4438cb17b24193ab2e1c2a2adf3f8d2a/720p?season=1&episode=8';
  assert.equal(atKodikSrc(ok, { season: 1, episode: 8, translation: subs, watched: {} }), null);
  // озвучка не запомнена — не трогаем выбор человека
  assert.equal(atKodikSrc(aniDub, { season: 1, episode: 8, watched: {} }), null);
});

test('atSiteOf', () => {
  assert.equal(atSiteOf('yummyanime.tv'), 'yummyanime');
  assert.equal(atSiteOf('10oct.newdeaf.co'), 'newdeaf');
  assert.equal(atSiteOf('evil-yummyanime.tv.example'), null);
});

test('atKodikSrc: с id озвучки фиксирует её через only_translations', () => {
  // Регрессия 11.10 (вторая): на yummyanime Kodik игнорирует озвучку в пути адреса и открывает свою
  // (AniDUB, translation.id 609 в kodik_player_current_episode). Слушается только only_translations.
  const subs = { id: 869, title: 'Субтитры', type: 'sub', path: '/serial/33316/4438cb17b24193ab2e1c2a2adf3f8d2a/720p' };
  const aniDub = 'https://kodikplayer.com/serial/22916/95c6c145567b328ee15c780fba5d18b2/720p';
  const e = { season: 1, episode: 9, translation: subs, watched: {} };
  const u = new URL(atKodikSrc(aniDub, e));
  assert.equal(u.pathname, subs.path);
  assert.equal(u.searchParams.get('only_translations'), '869');
  assert.equal(u.searchParams.get('episode'), '9');
  // уже на месте — без перезагрузки
  assert.equal(atKodikSrc(u.toString(), e), null);
  // путь и серия верные, но озвучка не зафиксирована — подменяем
  assert.notEqual(atKodikSrc(`https://kodikplayer.com${subs.path}?season=1&episode=9`, e), null);
});

test('atTrackedSite: www и регистр не важны, чужой хост — null', () => {
  const sites = [{ host: 'example.com', origins: ['https://www.example.com'] }];
  assert.equal(atTrackedSite('WWW.Example.com', sites)?.host, 'example.com');
  assert.equal(atTrackedSite('example.com.evil.net', sites), null);
  assert.equal(atTrackedSite('example.com', undefined), null);
});

test('atParseLabel: русские и английские подписи серии и сезона', () => {
  assert.equal(atParseLabel('6 серия', 'episode'), 6);
  assert.equal(atParseLabel('Episode 12', 'episode'), 12);
  assert.equal(atParseLabel('Season 2', 'season'), 2);
  assert.equal(atParseLabel('2 сезон', 'episode'), null);
  assert.equal(atParseLabel('Серия 99999', 'episode'), null);
});

test('atPackWatched: досмотренное диапазонами и обратно без потерь', () => {
  const watched = {};
  for (let e = 1; e <= 120; e++) watched[`1:${e}`] = true;
  watched['1:125'] = true;
  watched['2:1'] = true;
  const packed = atPackWatched(watched);
  assert.deepEqual(packed, { 1: '1-120,125', 2: '1' });
  assert.deepEqual(atUnpackWatched(packed), watched);
  // весь «Блич» досмотрен — десяток байт вместо ~4 КБ
  const all = {};
  for (let e = 1; e <= 366; e++) all[`1:${e}`] = true;
  assert.ok(JSON.stringify(atPackWatched(all)).length < 20);
  // мусор из sync не превращается в миллион серий
  assert.deepEqual(atUnpackWatched({ 1: '5-1,x,1-999999' }), {});
});

test('atPackEntry/atUnpackEntry: запись переживает sync; опасный адрес не принимается', () => {
  const e = {
    key: 'k', site: 's', url: 'https://x.example/a', title: 'T', season: 1, episode: 4, time: 72, duration: 1384,
    total: 12, watched: { '1:3': true }, updatedAt: 5, poster: 'https://x.example/p.jpg', translation: null,
  };
  const back = atUnpackEntry(JSON.parse(JSON.stringify(atPackEntry(e))));
  assert.deepEqual(back, e);
  assert.equal(atUnpackEntry({ ...atPackEntry(e), u: 'javascript:alert(1)' }), null);
});

test('atMergeRemote: свежее побеждает, постер и число серий не теряются', () => {
  const local = { key: 'k', episode: 3, updatedAt: 10, poster: 'p', total: 12 };
  assert.equal(atMergeRemote(local, { key: 'k', episode: 2, updatedAt: 9 }), null);
  const m = atMergeRemote(local, { key: 'k', episode: 5, updatedAt: 11, total: null });
  assert.equal(m.episode, 5);
  assert.equal(m.poster, 'p');
  assert.equal(m.total, 12);
});
