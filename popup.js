'use strict';

// подпись сайта в эйбрау; в магазинной сборке сайт — это его хост
const SITE_NAME = {
  // @personal-start
  newdeaf: 'NewDeaf',
  yummyanime: 'YummyAnime',
  yummyani: 'YummyAni',
  // @personal-end
};

const fmt = atFmtTime; // shared.js

function plural(n, forms) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return forms[0];
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return forms[1];
  return forms[2];
}

function formatDate(ts) {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'только что';
  // коротко: строка «сайт · когда» делит ширину с кнопками справа и с «назад» обрезалась многоточием
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч`;
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('ru-RU', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

function render(list) {
  const ul = document.getElementById('watchList');
  const empty = document.getElementById('emptyState');
  ul.innerHTML = '';
  empty.classList.toggle('hidden', list.length > 0);
  document.getElementById('footer').classList.toggle('hidden', list.length === 0);

  for (const e of list) {
    const li = el('li', 'watch-item');
    const a = el('a', 'watch-link');
    const safe = atSafeUrl(e.url);
    if (safe) a.href = safe + '#at-continue'; // метка: страница сама прокрутит к плееру
    a.target = '_blank';
    a.rel = 'noopener noreferrer';

    const { done, finished } = atStatus(e); // shared.js — та же логика, что у плашки
    // значок = серия, которую включать СЕЙЧАС (досмотренная → следующая); строка ниже это называет
    const badge = el('div', 'ep-badge' + (finished ? ' ep-badge--done' : ''));
    if (finished) badge.appendChild(atIcon('check', 16));
    else badge.textContent = String(done ? e.episode + 1 : e.episode);
    badge.setAttribute('aria-hidden', 'true');
    // Постер: аниме узнают по картинке, а не по названию (эвристика «узнавание вместо вспоминания»).
    // Номер серии ложится на постер пилюлей; не загрузился постер — остаётся голый номер.
    const poster = atSafeUrl(e.poster);
    if (poster) {
      const thumb = el('div', 'ep-thumb');
      const img = document.createElement('img');
      img.src = poster;
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => {
        badge.classList.remove('ep-badge--on-poster');
        thumb.replaceWith(badge);
      });
      badge.classList.add('ep-badge--on-poster');
      thumb.append(img, badge);
      a.appendChild(thumb);
    } else {
      a.appendChild(badge);
    }

    const info = el('div', 'watch-info');
    // эйбрау над названием: где и когда — микролейблом, а не отдельной колонкой (она съедала ширину)
    info.appendChild(el('div', 'watch-eyebrow', `${SITE_NAME[e.site] || e.site} · ${formatDate(e.updatedAt)}`));
    const titleEl = el('div', 'watch-title', e.title);
    titleEl.title = e.title; // длинное название режется многоточием — полное по наведению
    info.appendChild(titleEl);

    // «1 сезон 3 серия · 12:34 из 23:04» — как «последняя информация» на HDrezka
    const season = e.season ? `${e.season} сезон, ` : '';
    const line = finished
      ? `Досмотрено: все ${e.total} серий`
      : done
        ? `Дальше ${season}${e.episode + 1} серия`
        : `${season}${e.episode} серия` + (e.time ? ` · ${fmt(e.time)}${e.duration ? ' из ' + fmt(e.duration) : ''}` : '');
    const metaRow = el('div', 'watch-meta');
    metaRow.appendChild(document.createTextNode(line));
    // ярлык озвучки: SUB — субтитры, DUB · студия — озвучка; в ней же откроется плеер
    const tr = e.translation;
    if (tr?.title) {
      const isSub = tr.type === 'sub' || /субтитр/i.test(tr.title);
      // коротко: длинное «DUB · AniDUB» выталкивало строку серии на два ряда; студия — по наведению
      const chip = el('span', 'tr-chip' + (isSub ? ' tr-chip--sub' : ''), isSub ? 'SUB' : 'DUB');
      chip.title = isSub ? (/^субтитры$/i.test(tr.title) ? 'Субтитры' : `Субтитры: ${tr.title}`) : `Озвучка: ${tr.title}`;
      metaRow.appendChild(chip);
    }
    info.appendChild(metaRow);
    // озвучку слышит и скринридер, а не только мышь в подсказке
    const trSpoken = e.translation?.title
      ? `. ${e.translation.type === 'sub' ? 'Субтитры' : 'Озвучка ' + e.translation.title}`
      : '';
    a.setAttribute('aria-label', `${e.title}. ${line}${trSpoken}`);

    // «смотреть ещё N серий»
    const remaining = e.total && !finished ? e.total - e.episode : 0;
    if (remaining > 0) {
      info.appendChild(el('div', 'watch-left', `смотреть ещё ${remaining} ${plural(remaining, ['серию', 'серии', 'серий'])}`));
    }

    if (e.duration && !done) {
      const bar = el('div', 'watch-progress');
      const fill = el('div', 'watch-progress-fill');
      fill.style.width = Math.min(100, Math.round((e.time / e.duration) * 100)) + '%';
      bar.appendChild(fill);
      info.appendChild(bar);
    }
    a.appendChild(info);


    // Правка серии рядом с записью: на незнакомом сайте номер угадывается по подписям и может ошибиться.
    // Шаг — от серии, которую показывает значок (досмотренная → уже следующая), иначе «›» ничего не менял бы.
    const shown = atStatus(e).next;
    const step = el('div', 'ep-step');
    for (const [icon, delta, label] of [
      ['chevronLeft', -1, 'Предыдущая серия'],
      ['chevronRight', 1, 'Следующая серия'],
    ]) {
      const target = shown + delta;
      const b = el('button', 'btn-step');
      b.appendChild(atIcon(icon, 14));
      b.title = `Не та серия? Запомнить ${target}`;
      b.setAttribute('aria-label', `${label}: запомнить ${target} серию для «${e.title}»`);
      b.disabled = target < 1;
      b.addEventListener('click', async () => {
        await chrome.runtime.sendMessage({ type: 'manual', key: e.key, patch: { episode: target, time: 0, duration: 0 } });
        load();
      });
      step.appendChild(b);
    }

    const del = el('button', 'btn-remove');
    del.appendChild(atIcon('x', 16));
    del.title = 'Убрать из списка';
    del.setAttribute('aria-label', `Убрать «${e.title}» из списка`);
    del.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      await chrome.runtime.sendMessage({ type: 'remove', key: e.key });
      await load();
      // удаление обратимо: промах по крестику не стирает историю тайтла насовсем
      showToast(`«${e.title}» убран`, 'Вернуть', async () => {
        await chrome.runtime.sendMessage({ type: 'restore', entry: e });
        load();
      });
    });

    const actions = el('div', 'card-actions');
    actions.append(del, step);
    li.appendChild(a);
    li.appendChild(actions);
    ul.appendChild(li);
  }
}

async function load() {
  let r = null;
  try {
    r = await chrome.runtime.sendMessage({ type: 'list' });
  } catch {
    /* фоновая часть недоступна — ниже покажем ошибку, а не «пусто» */
  }
  // пустой список и сбой загрузки — разные состояния: «ничего не смотрели» при ошибке было бы враньём
  document.getElementById('errorState').classList.toggle('hidden', !!r);
  if (!r) {
    render([]);
    document.getElementById('emptyState').classList.add('hidden');
    return;
  }
  render(r.list || []);
}

// Тост r6tv: белая плашка, текст цвета фона, 14/700, радиус --r-btn; одно действие и автоскрытие
let toastTimer = 0;
function showToast(text, actionLabel, onAction) {
  const t = document.getElementById('toast');
  t.innerHTML = '';
  t.appendChild(el('span', 'toast-text', text));
  if (actionLabel) {
    const b = el('button', 'toast-action', actionLabel);
    b.addEventListener('click', () => {
      t.classList.add('hidden');
      onAction();
    });
    t.appendChild(b);
  }
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 6000);
}

// знак расширения «Стопка серий» (тот же, что icons/*.png — scripts/icons.py); разметка — константа
document.getElementById('logoIcon').innerHTML =
  '<svg viewBox="0 0 128 128" width="20" height="20" aria-hidden="true">' +
  '<rect width="128" height="128" rx="28" fill="#262b35"/><rect x="40" y="20" width="56" height="40" rx="8" fill="#3a404c"/>' +
  '<rect x="32" y="31" width="68" height="46" rx="9" fill="#8b919d"/><rect x="22" y="44" width="84" height="62" rx="11" fill="#f1f3f6"/>' +
  '<polygon points="55,58 55,84 77,71" fill="#14171d"/><rect x="32" y="94" width="40" height="6" rx="3" fill="#55c989"/></svg>';
document.getElementById('emptyIcon').appendChild(atIcon('tv', 40));
const btnClear = document.getElementById('btnClear');
btnClear.append(atIcon('trash', 14), document.createTextNode('Очистить историю'));

btnClear.addEventListener('click', async () => {
  if (confirm('Очистить всю историю просмотров?')) {
    await chrome.runtime.sendMessage({ type: 'clear' });
    load();
  }
});

load();
initSiteBar();

// ── «Отслеживать этот сайт» (сборка для магазина) ──
// Доступа к сайтам по умолчанию нет: человек выдаёт его сам, для конкретного сайта. Окна плеера
// часто живут на другом домене — их адреса собираем заранее, при открытии попапа: запрос доступа
// Chrome принимает только прямо в обработчике нажатия, после await он уже не сработает.
async function initSiteBar() {
  if (AT_BUILD !== 'store') {
    // @personal-start
    document.getElementById('emptySub').innerHTML = 'Откройте тайтл на YummyAnime или NewDeaf<br>и включите серию';
    // @personal-end
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let url;
  try {
    url = new URL(tab?.url || '');
  } catch {
    return;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
  const host = atHostKey(url.hostname);
  const { sites = [] } = await chrome.storage.local.get('sites');
  const tracked = atTrackedSite(url.hostname, sites);

  let frames = [];
  if (!tracked) {
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: playerFrameOrigins });
      frames = res?.result || [];
    } catch {
      /* страница не даёт заглянуть внутрь (магазин Chrome, PDF) — отслеживаем только сам сайт */
    }
  }

  const bar = document.getElementById('siteBar');
  const btn = document.getElementById('btnSite');
  document.getElementById('siteHost').textContent = host;
  document.getElementById('siteState').textContent = tracked ? 'Отслеживается' : 'Этот сайт';
  btn.textContent = tracked ? 'Не отслеживать' : 'Отслеживать этот сайт';
  btn.classList.toggle('btn-site--primary', !tracked);
  btn.title = tracked
    ? 'Расширение перестанет читать видео на этом сайте и вернёт доступ к нему. История останется'
    : 'Chrome спросит доступ к этому сайту' + (frames.length ? ' и к окну его плеера' : '');
  bar.classList.remove('hidden');

  btn.onclick = async () => {
    if (tracked) {
      await chrome.runtime.sendMessage({ type: 'untrackSite', host });
      return initSiteBar();
    }
    const origins = [url.origin, ...frames.filter((o) => o !== url.origin)];
    // заявка — на случай, если окно доступа закроет попап раньше ответа: тогда сайт добавит фон
    chrome.storage.local.set({ pendingTrack: { host, origins, tabId: tab.id } });
    const granted = await chrome.permissions.request({ origins: origins.map((o) => `${o}/*`) });
    if (!granted) return chrome.storage.local.remove('pendingTrack');
    await chrome.runtime.sendMessage({ type: 'trackSite', host, origins, tabId: tab.id });
    initSiteBar();
  };
}

// Выполняется В СТРАНИЦЕ (chrome.scripting): адреса крупных окон-плееров с других доменов.
// Мелкие окна (реклама, кнопки соцсетей) не берём — доступ к ним не нужен.
function playerFrameOrigins() {
  const out = new Set();
  for (const f of document.querySelectorAll('iframe')) {
    const r = f.getBoundingClientRect();
    if (r.width < 320 || r.height < 180) continue;
    try {
      const u = new URL(f.src);
      if ((u.protocol === 'https:' || u.protocol === 'http:') && u.origin !== location.origin) out.add(u.origin);
    } catch {
      /* about:blank и srcdoc */
    }
  }
  return [...out];
}
