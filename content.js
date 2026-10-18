(function () {
  'use strict';

  // Скрипт попадает в КАЖДЫЙ фрейм любой страницы: плееры живут на чужих и меняющихся доменах
  // (kodik, ceramet/gencit, allo.cdnlbox…), и серию с временем можно прочитать только изнутри
  // окна плеера. Поэтому первым делом — выйти, если верхняя страница не наш сайт.
  const isTop = window === window.top;
  const ancestors = Array.from(location.ancestorOrigins || []);
  const topOrigin = isTop ? location.origin : ancestors[ancestors.length - 1] || '';
  let topHost = '';
  try {
    topHost = new URL(topOrigin).hostname;
  } catch {
    return;
  }
  const siteId = atSiteOf(topHost); // список сайтов — shared.js (общий с фоном)
  if (!siteId) return;
  const site = { id: siteId };

  const DEBUG = false;
  const log = DEBUG ? (...a) => console.log('[AnimeTracker]', location.host, ...a) : () => {};
  const MAX_EPISODE = 2000;

  const send = (msg) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => {
          void chrome.runtime.lastError; // расширение перезагрузили — молча
          resolve(r);
        });
      } catch {
        resolve(null);
      }
    });

  const num = (s) => {
    const n = parseInt(s, 10);
    return n >= 1 && n <= MAX_EPISODE ? n : null;
  };

  // «6 серия», «Серия 6», «6 episode», «Episode 6», «1 сезон», «Season 1»
  function parseLabel(text, kind) {
    const t = (text || '').trim().toLowerCase();
    if (!t || t.length > 40) return null;
    const words = kind === 'episode' ? '(?:серия|эпизод|episode|ep\\.?|серии)' : '(?:сезон|season)';
    const m = t.match(new RegExp(`^(\\d+)\\s*${words}$`)) || t.match(new RegExp(`^${words}\\s*(\\d+)$`));
    return m ? num(m[1]) : null;
  }

  // ═════════════════════ верхняя страница ═════════════════════
  if (isTop) initPage();

  function cleanTitle(t) {
    return (t || '')
      .replace(/^(аниме\s+)?(сериал|фильм|мультсериал|мультфильм|дорама|аниме)\s+/i, '')
      .replace(/["«»“”]/g, '')
      .replace(/\s+смотреть.*$/i, '')
      .trim();
  }

  function pageMeta() {
    const og = (p) => document.querySelector(`meta[property="${p}"]`)?.content || '';
    const h1 = document.querySelector('h1')?.innerText || '';
    const body = document.body?.innerText || '';
    // сезон страницы: NewDeaf пишет его в заголовке («Блич 1 сезон все серии…»)
    const seasonM = document.title.match(/(\d+)\s*сезон/i) || location.pathname.match(/(\d+)-season/i);
    // всего серий: «1 сезон и 366 серия» (NewDeaf), «366 СЕРИЙ» в карточке (YummyAnime).
    // Берём ПЕРВОЕ вхождение: карточка тайтла идёт раньше комментариев («720 серий у Наруто»).
    const totalM =
      body.match(/сезон\s+и\s+(\d+)\s+сери/i) ||
      body.match(/(?:эпизод(?:ов|ы)?|серий|серии)\s*:\s*(\d+)/i) ||
      body.match(/(\d+)\s+(?:серий|эпизодов)/i);
    return {
      site: site.id,
      url: location.origin + location.pathname,
      title: cleanTitle(h1) || cleanTitle(og('og:title').split(/\s*[|—–]\s*/)[0]) || document.title,
      poster: og('og:image'),
      pageSeason: seasonM ? num(seasonM[1]) : null,
      total: totalM ? num(totalM[1]) : null,
    };
  }

  async function initPage() {
    const meta = pageMeta();
    // запись открыта только на страницах тайтлов: путь с .html (NewDeaf/YummyAnime) или /catalog/item/
    if (!/\.html$|\/catalog\/item\//.test(location.pathname)) return;
    const r = await send({ type: 'page', meta });
    renderBanner(r?.entry);
    openPlayersAt(r?.entry);
    selectPlayerTab(r?.entry);
    rememberPlayerTab();
    // пришли из попапа — сразу к плееру, метку из адреса убираем
    if (location.hash === '#at-continue') {
      history.replaceState(null, '', location.pathname + location.search);
      setTimeout(scrollToResume, 300);
    }
    chrome.runtime.onMessage.addListener((m) => {
      if (m.type === 'updated') renderBanner(m.entry);
    });
  }

  // Прокрутка к плашке «Продолжить» над плеером. scrollIntoView ставил ПЛЕЕР к самому верху окна, а
  // YummyAnime при прокрутке закрепляет шапку (`.header.sticky { position: fixed }`, ~140 px) —
  // она закрывала и нашу плашку, и вкладки плееров (регрессия 11.10). Поэтому: цель — плашка, отступ —
  // высота шапки, а после прокрутки проверяем, не перекрыто ли начало цели чем-то закреплённым.
  function scrollToResume() {
    const target = document.getElementById('at-banner') || document.querySelector(PLAYER_BOX);
    if (!target) return;
    const GAP = 8;
    const header = document.querySelector('header');
    const headerH = header ? header.getBoundingClientRect().height : 0;
    window.scrollTo({ top: window.scrollY + target.getBoundingClientRect().top - headerH - GAP, behavior: 'instant' });
    // человек начал крутить сам — не дёргаем страницу поправками
    let userMoved = false;
    const stop = () => (userMoved = true);
    for (const ev of ['wheel', 'touchstart', 'keydown', 'mousedown']) addEventListener(ev, stop, { once: true, passive: true });
    // поправка: закреплённая шапка появляется после прокрутки, картинки выше могут догрузиться
    const fix = () => {
      if (userMoved) return;
      const top = target.getBoundingClientRect().top;
      const x = target.getBoundingClientRect().left + 20;
      const cover = document.elementsFromPoint(x, Math.max(1, top + 2)).find((el) => !target.contains(el) && el !== target);
      const fixedEl = cover && fixedAncestor(cover);
      const coverBottom = fixedEl ? fixedEl.getBoundingClientRect().bottom : 0;
      const want = Math.max(coverBottom, 0) + GAP;
      if (Math.abs(top - want) > 4) window.scrollBy({ top: top - want, behavior: 'instant' });
    };
    setTimeout(fix, 400);
    setTimeout(fix, 1500);
  }
  function fixedAncestor(el) {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const pos = getComputedStyle(n).position;
      if (pos === 'fixed' || pos === 'sticky') return n;
    }
    return null;
  }

  // Вкладки плееров страницы: «Смотреть онлайн / Kodik / Трейлер» (YummyAnime), «Плеер 1 / Плеер 2» (NewDeaf)
  const PLAYER_TABS = '.tabs-block__select > span';
  const PLAYER_BOX = '.inner-page__player, .pmovie__player';
  // сайт по умолчанию открывает свой плеер; если пользователь ещё ничего не выбирал — берём этот
  const DEFAULT_PLAYER = { yummyanime: 'Kodik' };
  const isTrailer = (label) => /трейлер|trailer/i.test(label);
  const tabLabel = (el) => (el.textContent || '').trim();

  // Включаем тот плеер, которым смотрели в прошлый раз (или Kodik по умолчанию)
  function selectPlayerTab(entry) {
    const want = (entry?.player || DEFAULT_PLAYER[site.id] || '').toLowerCase();
    if (!want) return;
    const tab = [...document.querySelectorAll(PLAYER_TABS)].find((t) => tabLabel(t).toLowerCase() === want);
    if (tab && !tab.classList.contains('is-active')) tab.click();
  }

  // Запоминаем плеер, который выбрал сам пользователь (только настоящий клик, не наш tab.click())
  function rememberPlayerTab() {
    document.addEventListener(
      'click',
      (e) => {
        const tab = e.isTrusted && e.target.closest?.(PLAYER_TABS);
        if (!tab) return;
        const label = tabLabel(tab);
        if (label && !isTrailer(label)) send({ type: 'player', label });
        setTimeout(() => renderBanner(bannerEntry), 50);
      },
      true
    );
  }

  // Какую серию включать: досмотренную — следующую, иначе ту же (общая логика — shared.js)
  const resumeEpisode = (e) => (e ? atStatus(e).next : null);

  // NewDeaf грузит плееры лениво из data-src (…&season=1&episode=1). Пока src не выставлен, подменяем
  // серию — плеер сразу откроется там, где остановились. Уже загруженный не трогаем: это перезагрузка.
  function openPlayersAt(entry) {
    const ep = resumeEpisode(entry);
    if (!ep || site.id !== 'newdeaf') return;
    for (const f of document.querySelectorAll('iframe[data-src]')) {
      if (f.getAttribute('src')) continue;
      try {
        const u = new URL(f.dataset.src, location.href);
        if (!u.searchParams.has('episode')) continue;
        u.searchParams.set('episode', String(ep));
        if (entry.season && u.searchParams.has('season')) u.searchParams.set('season', String(entry.season));
        f.dataset.src = u.toString();
      } catch {
        /* чужой формат адреса — оставляем как есть */
      }
    }
  }

  // Текст плашки = действие: что включать сейчас, а не что было. Три состояния — три ветки,
  // без вложенного тернарника.
  function bannerText(entry, { done, finished }) {
    const season = entry.season ? `${entry.season} сезон, ` : '';
    if (finished) return `Досмотрено полностью: ${season}${entry.episode} из ${entry.total} серий`;
    if (done) return `Дальше: ${season}${entry.episode + 1} серия (${entry.episode} досмотрена)`;
    const from = entry.time > 30 ? ` с ${atFmtTime(entry.time)}` : '';
    return `Продолжить: ${season}${entry.episode} серия${from}`;
  }

  // Токены дизайн-системы r6tv (r6tv/analyzer/frontend/tokens.css, bento DS): плашка — ячейка
  // поверх чужой страницы, поэтому значения инлайном и `all:initial`, чтобы стили сайта не протекли.
  const R6 = {
    cell: '#14171d',
    control: 'rgba(255,255,255,.04)',
    controlHover: 'rgba(255,255,255,.08)',
    text: '#f1f3f6',
    muted: '#8b919d',
    pos: '#55c989',
    focus: 'rgba(255,255,255,.4)',
    font: 'Roboto,"Roboto Fallback",-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif',
  };

  // вторичная кнопка r6tv .btn-2 инлайном (страница чужая — классы сайта не протекают из-за all:initial)
  function styleSecondary(b, text) {
    b.style.cssText =
      'all:initial;cursor:pointer;flex:none;box-sizing:border-box;height:32px;border-radius:8px;display:inline-flex;' +
      'align-items:center;justify-content:center;' +
      (text ? `padding:0 12px;font:500 12px/32px ${R6.font};` : 'width:32px;min-width:32px;') +
      `background:${R6.control};color:${R6.text}`;
    b.onmouseenter = () => (b.style.background = R6.controlHover);
    b.onmouseleave = () => (b.style.background = R6.control);
    b.onfocus = () => {
      b.style.outline = `2px solid ${R6.focus}`;
      b.style.outlineOffset = '2px';
    };
    b.onblur = () => (b.style.outline = 'none');
  }

  // Плашка над плеером: где остановился + ручная правка серии, если плеер не дал её прочитать.
  let bannerEntry = null;
  function renderBanner(entry) {
    bannerEntry = entry || null;
    let el = document.getElementById('at-banner');
    if (!entry || !entry.episode) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.id = 'at-banner';
      el.style.cssText =
        // ячейка bento: плоско, без рамки и тени, радиус --r 14, поле 12/16, зазор --gap 8
        'all:initial;box-sizing:border-box;display:flex;align-items:center;gap:8px;flex-wrap:wrap;' +
        `margin:8px 0;padding:12px 16px;background:${R6.cell};border-radius:14px;color:${R6.text};` +
        `font:700 14px/1.5 ${R6.font};`;
      const anchor =
        document.querySelector('.pmovie__player, .inner-page__player, [class*="player"]') || document.querySelector('h1');
      anchor?.parentNode?.insertBefore(el, anchor);
    }
    const status = atStatus(entry);
    const { finished } = status;
    el.innerHTML = '';
    const lead = atIcon(finished ? 'circleCheck' : 'play', 16, !finished);
    lead.style.color = finished ? R6.pos : R6.text; // акцент r6tv — белый, «готово» — --pos
    el.appendChild(lead);
    const text = document.createElement('span');
    text.style.cssText = `all:initial;color:${R6.text};font:700 14px/1.5 ${R6.font};flex:1;min-width:200px`;
    text.textContent = bannerText(entry, status);
    el.appendChild(text);
    const tipLine = (txt) => {
      const tip = document.createElement('span');
      tip.textContent = txt;
      tip.style.cssText = `all:initial;flex-basis:100%;order:9;color:${R6.muted};font:500 12px/1.5 ${R6.font}`;
      el.appendChild(tip);
    };
    if (!status.done && entry.time > 30) tipLine('Нажмите «старт» в плеере — перемотаем сами');
    // Открыт другой плеер (у YummyAnime по умолчанию — Alloha): серию в нём расширение ставить не умеет.
    // Kodik умеет — точно, с озвучкой и перемоткой; предлагаем переключиться одним нажатием.
    const kodikTab = site.id === 'yummyanime' && [...document.querySelectorAll(PLAYER_TABS)].find((t) => /^kodik$/i.test(tabLabel(t)));
    if (kodikTab && !kodikTab.classList.contains('is-active') && !status.finished) {
      const go = document.createElement('button');
      go.textContent = `Открыть в Kodik на ${status.next} серии`;
      go.title = 'В этом плеере расширение не может поставить серию — в Kodik откроет нужную, в вашей озвучке';
      styleSecondary(go, true);
      go.onclick = () => {
        kodikTab.click();
        send({ type: 'player', label: tabLabel(kodikTab) }); // выбор человека: в следующий раз сразу Kodik
        setTimeout(() => renderBanner(bannerEntry), 50);
      };
      el.appendChild(go);
    }
    // Озвучка зафиксирована — в Kodik нет её списка; сменить можно здесь
    if (site.id === 'yummyanime' && entry.translation?.title) {
      const tr = document.createElement('button');
      const kind = entry.translation.type === 'sub' ? 'Субтитры' : `Озвучка: ${entry.translation.title}`;
      tr.textContent = `${kind} · сменить`;
      tr.title = 'Откроем список озвучек в Kodik — выбранную запомним';
      styleSecondary(tr, true);
      tr.onclick = async () => {
        const r = await send({ type: 'forgetTranslation', key: entry.key });
        renderBanner(r?.entry || entry); // фон не ответил — плашка остаётся, а не пропадает
      };
      el.appendChild(tr);
    }
    // Kodik откроется на нужной серии, только когда знаем озвучку — говорим, что её ещё нет
    if (site.id === 'yummyanime' && !entry.translation) {
      const tip = document.createElement('span');
      tip.textContent = 'Выберите озвучку в Kodik — откроем её на нужной серии в следующий раз';
      tip.style.cssText = `all:initial;flex-basis:100%;order:9;color:${R6.muted};font:500 12px/1.5 ${R6.font}`;
      el.appendChild(tip);
    }
    // правка — явно как исправление ошибки распознавания, а не управление плеером
    const hint = document.createElement('span');
    hint.textContent = 'Не та серия?';
    hint.style.cssText = `all:initial;color:${R6.muted};font:500 12px/1.5 ${R6.font}`;
    el.appendChild(hint);
    // Шаг — от серии на плашке (досмотренная → уже следующая): иначе «›» на «Дальше 16» ставил 16 и
    // ничего не менял. Номер — в подписи: «‹ ›» рядом с «Продолжить» читались как листание плеера.
    const btn = (icon, delta) => {
      const target = Math.max(1, status.next + delta);
      const b = document.createElement('button');
      b.appendChild(atIcon(icon, 18));
      b.title = `Не та серия? Запомнить ${target}`;
      b.setAttribute('aria-label', `Не та серия? Запомнить ${target} серию`);
      styleSecondary(b, false);
      b.onclick = async () => {
        const r = await send({ type: 'manual', key: entry.key, patch: { episode: target, time: 0, duration: 0 } });
        renderBanner(r?.entry || entry);
      };
      return b;
    };
    el.appendChild(btn('chevronLeft', -1));
    el.appendChild(btn('chevronRight', +1));
  }

  // ═════════════════════ окна плеера (любой фрейм) ═════════════════════
  // played — в этом фрейме реально шло видео. Без него НИЧЕГО не пишем: при загрузке страницы плеер
  // стартует с серией из своего адреса (?episode=1) и Kodik сразу шлёт current_episode — без этой
  // проверки каждое открытие страницы сбрасывало прогресс на 1 серию.
  const state = { season: null, episode: null, time: 0, duration: 0, lastSent: 0, lastKey: '', played: false };
  // Домены плеера Kodik — явным списком: шаблон «*kodik*» пропускал бы и kodik-evil.com.
  // aniqit.com — запасной домен самого Kodik.
  const KODIK_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*(kodik\.(info|biz|cc)|kodikplayer\.com|aniqit\.com)$/i;
  const isKodikSrc = (src) => {
    try {
      return KODIK_ORIGIN.test(new URL(src).origin);
    } catch {
      return false;
    }
  };
  const inKodik = KODIK_ORIGIN.test(location.origin);

  // Kodik сам сообщает родителю о смене серии и времени — ловим во фрейме-родителе
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d !== 'object' || typeof d.key !== 'string' || !d.key.startsWith('kodik_player_')) return;
    // только от собственного дочернего фрейма И с домена Kodik: рекламное окно рядом не подделает прогресс
    if (!KODIK_ORIGIN.test(e.origin)) return;
    if (![...document.querySelectorAll('iframe')].some((f) => f.contentWindow === e.source)) return;
    if (d.key === 'kodik_player_current_episode' && d.value) {
      const ep = num(d.value.episode);
      if (ep && ep !== state.episode) {
        // новая серия — время и длительность прошлой к ней не относятся (как setEpisode в опросе)
        state.time = 0;
        state.duration = 0;
      }
      state.season = num(d.value.season) || state.season;
      state.episode = ep || state.episode;
      report(true); // запишется, только если видео уже шло
    } else if (d.key === 'kodik_player_video_started') {
      kodikStarted(state.time, { win: e.source, origin: e.origin });
    } else if (d.key === 'kodik_player_video_ended') {
      // серия кончилась — досмотрена точно, а не по порогу 90%
      state.played = true;
      if (state.duration) state.time = state.duration;
      report(true);
    } else if (d.key === 'kodik_player_time_update') {
      const t = Number(d.value) || 0;
      if (kodikSeekTo && t > 0) kodikStarted(t, { win: e.source, origin: e.origin }); // если video_started не пришёл
      if (t > 0) state.played = true;
      state.time = t || state.time;
      report(false);
    } else if (d.key === 'kodik_player_duration_update') {
      state.duration = Number(d.value) || state.duration;
    }
  });

  // Открываем Kodik сразу на своей серии И своей озвучке. Команда change_episode из API Kodik для
  // этого не годится: она перезагружает плеер в озвучке по умолчанию (была AniDUB вместо «Субтитров»).
  // У каждой озвучки Kodik свой адрес /serial/{media-id}/{media-hash}/720p, и он принимает
  // ?season=&episode= — проверено на живом плеере. Адрес озвучки запоминается изнутри плеера
  // (readTranslation). Пока озвучка не запомнена — серию не трогаем, чтобы не сбить выбор человека.
  let kodikSeekTo = 0; // секунда, куда перемотать на первом «старте» (0 — не перематывать)
  // окна Kodik и их origin: команду шлём адресно, а не '*' — чужому окну она не уйдёт
  const kodikFrames = (target) =>
    target
      ? [target]
      : [...document.querySelectorAll('iframe')]
          .filter((f) => isKodikSrc(f.src))
          .map((f) => ({ win: f.contentWindow, origin: new URL(f.src).origin }));
  const kodikApi = (value, target) => {
    for (const { win, origin } of kodikFrames(target)) win?.postMessage({ key: 'kodik_player_api', value }, origin);
  };

  // Подмена адреса — для КАЖДОГО нового iframe Kodik. Обёртка YummyAnime (controller.php) после загрузки
  // удаляет свой iframe и создаёт новый с адресом по умолчанию (fetch → root.textContent='' → fillIframe),
  // а при повторном «start» от страницы — ещё раз. Подмена одного элемента один раз уходила в
  // выброшенный iframe — плеер открывался в AniDUB (регрессия 11.10). Свежая запись — на каждый элемент.
  const handledKodik = new WeakSet();
  async function applyKodik(f) {
    if (handledKodik.has(f)) return;
    handledKodik.add(f);
    const r = await send({ type: 'entry' });
    if (r?.entry) resume = r.entry;
    if (!resume) return;
    // перемотка — только для недосмотренной серии и если смотрели дольше 30 с
    const { done } = atStatus(resume);
    kodikSeekTo = !done && resume.time > 30 ? Math.max(0, resume.time - 3) : 0;
    const next = atKodikSrc(f.src, resume);
    if (next && f.isConnected) f.src = next;
  }
  const scanKodik = () => {
    for (const f of document.querySelectorAll('iframe')) if (isKodikSrc(f.src)) applyKodik(f);
  };
  // «Сменить озвучку»: с only_translations в Kodik нет списка озвучек — перезагружаем без него
  function unlockKodik() {
    for (const f of document.querySelectorAll('iframe')) {
      if (!isKodikSrc(f.src)) continue;
      const u = new URL(f.src);
      if (!u.searchParams.has('only_translations')) continue;
      u.searchParams.delete('only_translations');
      f.src = u.toString();
    }
  }

  // Изнутри окна Kodik: какая озвучка выбрана и её адрес (data-media-* у пункта списка озвучек)
  function readTranslation() {
    const opt = [...document.querySelectorAll('option[data-media-hash]')].find((o) => o.selected);
    if (!opt) return null;
    const d = opt.dataset;
    return {
      id: Number(d.id) || null, // translation.id Kodik: им озвучка фиксируется (only_translations)
      title: d.title || '',
      // voice — озвучка, subtitles — субтитры (так Kodik размечает пункты списка)
      type: d.translationType === 'subtitles' ? 'sub' : 'dub',
      path: `/${d.mediaType || 'serial'}/${d.mediaId}/${d.mediaHash}/720p`,
    };
  }

  // Выбор человека ≠ то, что открылось. Смена озвучки в меню Kodik — это location.replace изнутри
  // плеера (app.serial.js), поэтому у такой страницы referrer — сам Kodik. Страница, вставленная
  // обёрткой сайта или нами, приходит с referrer сайта, и её озвучку выбрал Kodik, а не человек.
  // auto_resume — переход кнопки Kodik «Продолжить просмотр» по ЕГО памяти: тоже не выбор.
  const chosenInPlayer = (() => {
    if (!inKodik || new URLSearchParams(location.search).has('auto_resume')) return false;
    try {
      return KODIK_ORIGIN.test(new URL(document.referrer).origin);
    } catch {
      return false;
    }
  })();

  // Выбранную озвучку шлём сразу, не дожидаясь просмотра: иначе она запоминалась только после
  // старта видео. Открывшуюся сама по себе — нет (регрессия 11.10: AniDUB записывалась вместо «Субтитров»).
  let sentTranslation = '';
  function syncTranslation() {
    if (!chosenInPlayer) return;
    const tr = readTranslation();
    if (!tr || tr.path === sentTranslation) return;
    sentTranslation = tr.path;
    send({ type: 'translation', translation: tr });
  }

  // Kodik перематывается командой seek, но только когда пошло само видео: на рекламе перед серией
  // команда уходит в никуда. Поэтому ждём kodik_player_video_started (после рекламы), а не play.
  function kodikStarted(time, target) {
    if (!kodikSeekTo || time > 10) return void (kodikSeekTo = 0);
    kodikApi({ method: 'seek', seconds: kodikSeekTo }, target);
    kodikSeekTo = 0;
  }

  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }

  // Серия/сезон из UI плеера: <select> → видимые подписи «6 серия» → параметры адреса фрейма
  function readFromDom(kind) {
    for (const sel of document.querySelectorAll('select')) {
      const n = parseLabel(sel.selectedOptions[0]?.text, kind);
      if (n) return n;
    }
    const candidates = [];
    for (const el of document.querySelectorAll('div, span, button, a, li, p')) {
      if (el.children.length > 2) continue;
      // сначала дешёвая длина текста: innerText у обёртки вроде #app > div считает раскладку всей
      // страницы, а подпись серии — пара слов (ревью 18.10)
      if ((el.textContent || '').length > 60) continue;
      const n = parseLabel(el.innerText, kind);
      if (n && visible(el)) candidates.push({ el, n });
    }
    // открыт выпадающий список — несколько видимых: берём отмеченную
    const active = candidates.find(({ el }) =>
      /active|selected|current/i.test(el.className + ' ' + (el.parentElement?.className || ''))
    );
    if (active) return active.n;
    if (candidates.length === 1) return candidates[0].n;
    if (candidates.length > 1) return candidates[0].n; // заголовок дропдауна идёт раньше списка
    const p = new URLSearchParams(location.search);
    return num(p.get(kind)) || null;
  }

  function mainVideo() {
    let best = null;
    for (const v of document.querySelectorAll('video')) {
      const area = v.clientWidth * v.clientHeight;
      if (!best || area > best.area) best = { v, area };
    }
    return best?.v || null;
  }

  function report(force) {
    if (!state.episode || !state.played) return;
    const key = `${state.season}:${state.episode}`;
    const now = Date.now();
    // смена серии — сразу; время — не чаще раза в 10 с
    if (!force && key === state.lastKey && now - state.lastSent < 10000) return;
    state.lastKey = key;
    state.lastSent = now;
    log('progress', { ...state });
    send({
      type: 'progress',
      force: !!force, // пауза, смена серии, досмотр — сразу в синхронизацию
      season: state.season,
      episode: state.episode,
      translation: readTranslation(),
      chosen: chosenInPlayer,
      time: Math.floor(state.time),
      duration: Math.floor(state.duration),
    });
  }

  // Новая серия — новое видео: время и длительность прошлой к ней не относятся. Плеер меняет подпись
  // «15 серия» сразу, а новое видео ещё грузится (currentTime 0, длительность неизвестна) — без сброса
  // 15-я получала время конца 14-й, 1394 из 1394, и считалась досмотренной (регрессия 13.10).
  function setEpisode(ep, se, v) {
    const changed = (ep && ep !== state.episode) || (se && se !== state.season);
    if (ep) state.episode = ep;
    if (se) state.season = se;
    if (changed) {
      state.time = v?.currentTime || 0;
      state.duration = isFinite(v?.duration) && v.duration > 0 ? v.duration : 0;
    }
    return changed;
  }

  let pollTimer = 0;
  let kodikObserver = null;
  function stopFrame() {
    clearInterval(pollTimer);
    kodikObserver?.disconnect();
  }

  function poll() {
    // расширение перезагрузили — этот экземпляр скрипта осиротел: перестаём опрашивать страницу
    if (!chrome.runtime?.id) return stopFrame();
    syncTranslation(); // в окне Kodik список озвучек есть и до появления <video>
    const v = mainVideo();
    if (!v) return; // в этом фрейме нет плеера
    // на паузе читать подписи незачем: время ловит событие pause, смену серии — play (ревью 18.10)
    if (v.paused) return;
    const changed = setEpisode(readFromDom('episode'), readFromDom('season'), v);
    if (isFinite(v.duration) && v.duration > 0) state.duration = v.duration;
    if (v.currentTime > 0) state.time = v.currentTime;
    if (!v.paused && v.currentTime > 0) state.played = true;
    // переключили серию — сразу (если в этом фрейме уже смотрели), иначе время раз в 10 с, пока идёт
    if (changed) report(true);
    else if (!v.paused) report(false);
  }

  // Перемотка к месту остановки: один раз, на первом «старте» той же серии, если видео ещё в самом
  // начале. Досмотренную и первые 30 с не перематываем — там проще начать заново.
  let resume = null;
  const resumed = new WeakSet();
  function tryResume(v) {
    // в окне Kodik перематывает его API по video_started (после рекламы): play ловил бы и рекламу
    if (inKodik || !resume || resumed.has(v)) return;
    const done = resume.watched?.[`${resume.season || 0}:${resume.episode}`];
    if (done || !(resume.time > 30) || state.episode !== resume.episode) return;
    resumed.add(v);
    if (v.currentTime > 10) return; // уже смотрит с другого места — не мешаем
    v.currentTime = Math.max(0, resume.time - 3);
  }

  if (!isTop || document.querySelector('video')) {
    if (!isTop)
      send({ type: 'entry' }).then((r) => {
        resume = r?.entry || null;
      });
    // окна Kodik появляются и пересоздаются когда угодно — следим за ними всё время жизни фрейма
    // (обёртка крошечная, наблюдатель дешёвый)
    scanKodik();
    kodikObserver = new MutationObserver(scanKodik);
    kodikObserver.observe(document.documentElement, { childList: true, subtree: true });
    chrome.runtime.onMessage.addListener((m) => {
      if (m.type !== 'updated') return;
      resume = m.entry || resume;
      if (!m.entry?.translation) unlockKodik();
    });
    document.addEventListener(
      'play',
      (e) => {
        if (e.target?.tagName !== 'VIDEO') return;
        setEpisode(readFromDom('episode'), null, e.target);
        tryResume(e.target);
      },
      true
    );
    pollTimer = setInterval(poll, 2000);
    // остановили — фиксируем точный момент, не дожидаясь опроса
    document.addEventListener(
      'pause',
      (e) => {
        if (e.target?.tagName !== 'VIDEO') return;
        if (e.target.currentTime > 0) state.played = true;
        state.time = e.target.currentTime || state.time;
        report(true);
      },
      true
    );
  }
})();
