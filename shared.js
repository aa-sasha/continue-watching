// Общая логика попапа и контент-скрипта. Раньше «досмотрено → следующая серия» и формат времени
// жили копиями в двух файлах — правка одной молча расходилась бы с другой (ревью 11.10).
// Подключается и попапом (popup.html), и в каждый фрейм (manifest → content_scripts.js).

/**
 * Статус записи истории.
 * @param {{season?: number|null, episode: number, total?: number|null, watched?: Record<string, boolean>}} e
 * @returns {{done: boolean, finished: boolean, next: number}}
 *   done — текущая серия досмотрена; finished — досмотрен весь тайтл; next — какую серию включать сейчас
 */
// eslint-disable-next-line no-unused-vars
function atStatus(e) {
  const done = !!e?.watched?.[`${e.season || 0}:${e.episode}`];
  const finished = done && !!e.total && e.episode >= e.total;
  return { done, finished, next: done ? e.episode + 1 : e?.episode };
}

/** Секунды → «6:58» или «1:02:03». Пустая строка для 0 и мусора. */
// eslint-disable-next-line no-unused-vars
function atFmtTime(s) {
  if (!s || !Number.isFinite(s)) return '';
  s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

// @personal-start Kodik: озвучка и серия адресом плеера
/**
 * Адрес плеера Kodik «наша озвучка + нужная серия» или null, если менять нечего.
 * У каждой озвучки Kodik свой адрес /serial/{media-id}/{media-hash}/720p, и он принимает
 * ?season=&episode=. Но открытый с yummyanime Kodik озвучку из пути не слушает — подставляет свою
 * (AniDUB по его памяти, kodik_player_current_episode → translation.id 609). Слушается только
 * only_translations={id}: тогда в плеере ровно наша озвучка (проверено вживую 11.10).
 * @param {string} src текущий адрес iframe Kodik
 * @param {object|null} entry запись истории
 * @returns {string|null}
 */
// eslint-disable-next-line no-unused-vars
function atKodikSrc(src, entry) {
  const path = entry?.translation?.path;
  if (!path) return null; // озвучка не запомнена — не трогаем, чтобы не сбить выбор человека
  const episode = String(atStatus(entry).next);
  const season = String(entry.season || 1);
  let u;
  try {
    u = new URL(src);
  } catch {
    return null;
  }
  const only = entry.translation.id ? String(entry.translation.id) : null;
  if (
    u.pathname === path &&
    u.searchParams.get('episode') === episode &&
    u.searchParams.get('season') === season &&
    u.searchParams.get('only_translations') === only
  )
    return null;
  u.pathname = path;
  u.searchParams.set('season', season);
  u.searchParams.set('episode', episode);
  // старые записи без id озвучки — как раньше, по пути
  if (only) u.searchParams.set('only_translations', only);
  else u.searchParams.delete('only_translations');
  return u.toString();
}
// @personal-end


// @personal-start список сайтов личной сборки
// Сайты, которые отслеживаем. Один список на фон и контент-скрипт: раньше он жил копией.
const AT_SITES = [
  { id: 'newdeaf', re: /(^|\.)newdeaf\./i },
  { id: 'yummyanime', re: /(^|\.)yummyanime\.tv$/i },
  { id: 'yummyani', re: /(^|\.)yummyani\.me$/i },
];

/** id сайта по хосту или null. */
// eslint-disable-next-line no-unused-vars
function atSiteOf(hostname) {
  return AT_SITES.find((s) => s.re.test(hostname || ''))?.id || null;
}
// @personal-end


// ── универсальный трекер (сборка для магазина): сайты добавляет сам человек ──

/** Хост без www: www.example.com и example.com — один сайт. */
// eslint-disable-next-line no-unused-vars
function atHostKey(hostname) {
  return String(hostname || '')
    .toLowerCase()
    .replace(/^www\./, '');
}

/**
 * Отслеживаемый сайт для хоста верхней страницы или null.
 * @param {string} hostname
 * @param {{host: string, origins: string[]}[]} sites — chrome.storage.local.sites
 */
// eslint-disable-next-line no-unused-vars
function atTrackedSite(hostname, sites) {
  const host = atHostKey(hostname);
  return (sites || []).find((s) => s.host === host) || null;
}

/** «6 серия», «Серия 6», «Episode 6», «1 сезон», «Season 1» → число или null. */
// eslint-disable-next-line no-unused-vars
function atParseLabel(text, kind) {
  const t = (text || '').trim().toLowerCase();
  if (!t || t.length > 40) return null;
  const words = kind === 'episode' ? '(?:серия|серии|эпизод|episode|ep\\.?)' : '(?:сезон|season)';
  const m = t.match(new RegExp(`^(\\d+)\\s*${words}$`)) || t.match(new RegExp(`^${words}\\s*(\\d+)$`));
  const n = m ? parseInt(m[1], 10) : NaN;
  return n >= 1 && n <= 2000 ? n : null;
}

/** Только http(s): ссылка из хранилища не должна стать javascript:/data: в href попапа. */
// eslint-disable-next-line no-unused-vars
function atSafeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

// для node --test (в браузере module не определён)
if (typeof module !== 'undefined') module.exports = {
    atStatus,
    atFmtTime,
    atSafeUrl,
    // @personal-start
    atSiteOf,
    atKodikSrc,
    AT_SITES,
    // @personal-end
    atHostKey,
    atTrackedSite,
    atParseLabel,
  };
