(function () {
  'use strict';

  // Универсальный трекер — сборка для Chrome Web Store. Работает только на сайтах, которые человек
  // добавил сам кнопкой «Отслеживать этот сайт» (и только там у расширения есть доступ). Читает
  // стандартный <video> и подписи вида «6 серия» / «Episode 6»; страницу и плеер не меняет —
  // ничего не переключает, не выбирает и не открывает. Только записывает, где человек остановился.

  // скрипт приходит дважды: зарегистрированный и вставленный сразу после «Отслеживать» — второй выходит
  if (window.__atTracker) return;
  window.__atTracker = true;

  const isTop = window === window.top;
  const ancestors = Array.from(location.ancestorOrigins || []);
  const topOrigin = isTop ? location.origin : ancestors[ancestors.length - 1] || '';
  let topHost = '';
  try {
    topHost = new URL(topOrigin).hostname;
  } catch {
    return;
  }

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

  // окно плеера с чужого домена — тоже наше, только если ВЕРХНЯЯ страница — отслеживаемый сайт
  chrome.storage.local.get('sites').then(({ sites }) => {
    const site = atTrackedSite(topHost, sites);
    if (site) start(site);
  });

  function start(site) {
    if (isTop) initPage(site);
    initFrame();
  }

  // ═════════════════════ верхняя страница ═════════════════════

  function cleanTitle(t) {
    return (t || '')
      .split(/\s+[|—–]\s+/)[0]
      .replace(/["«»“”]/g, '')
      .replace(/\s+(смотреть|watch)\b.*$/i, '')
      .trim();
  }

  function pageMeta(site) {
    const og = (p) => document.querySelector(`meta[property="${p}"]`)?.content || '';
    const h1 = document.querySelector('h1')?.innerText || '';
    const body = (document.body?.innerText || '').slice(0, 20000); // карточка тайтла — в начале страницы
    const seasonM = document.title.match(/(\d+)\s*сезон|season\s*(\d+)/i);
    const totalM =
      body.match(/(?:эпизод(?:ов|ы)?|серий|серии|episodes)\s*:\s*(\d+)/i) || body.match(/(\d+)\s+(?:серий|эпизодов|episodes)/i);
    const n = (s) => {
      const v = parseInt(s, 10);
      return v >= 1 && v <= 2000 ? v : null;
    };
    return {
      site: site.host,
      url: location.origin + location.pathname,
      title: cleanTitle(og('og:title')) || cleanTitle(h1) || cleanTitle(document.title) || site.host,
      poster: og('og:image'),
      pageSeason: seasonM ? n(seasonM[1] || seasonM[2]) : null,
      total: totalM ? n(totalM[1]) : null,
    };
  }

  async function initPage(site) {
    // запись появляется только когда видео реально шло (progress), а page лишь сообщает, что это за страница
    await send({ type: 'page', meta: pageMeta(site) });
    // пришли из попапа — к плееру, метку из адреса убираем
    if (location.hash === '#at-continue') {
      history.replaceState(null, '', location.pathname + location.search);
      setTimeout(() => biggestPlayer()?.scrollIntoView({ block: 'center', behavior: 'instant' }), 600);
    }
  }

  // самый крупный видимый <video> или окно плеера (iframe) на странице
  function biggestPlayer() {
    let best = null;
    for (const el of document.querySelectorAll('video, iframe')) {
      const r = el.getBoundingClientRect();
      const area = r.width * r.height;
      if (area >= 320 * 180 && (!best || area > best.area)) best = { el, area };
    }
    return best?.el || null;
  }

  // ═════════════════════ окно с видео (любой фрейм) ═════════════════════

  // played — в этом фрейме реально шло видео. Без него ничего не пишем: открыть страницу ≠ посмотреть.
  const state = { season: null, episode: null, time: 0, duration: 0, lastSent: 0, lastKey: '', played: false };
  let resume = null;
  const resumed = new WeakSet();

  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }

  // серия/сезон: <select> → видимые подписи «6 серия» → параметры адреса → 1 для фильма/ролика
  function readFromDom(kind) {
    for (const sel of document.querySelectorAll('select')) {
      const n = atParseLabel(sel.selectedOptions[0]?.text, kind);
      if (n) return n;
    }
    const candidates = [];
    for (const el of document.querySelectorAll('div, span, button, a, li, p, h1, h2, h3')) {
      if (el.children.length > 2) continue;
      const n = atParseLabel(el.innerText, kind);
      if (n && visible(el)) candidates.push({ el, n });
    }
    // открыт выпадающий список — берём отмеченную
    const active = candidates.find(({ el }) =>
      /active|selected|current/i.test(el.className + ' ' + (el.parentElement?.className || ''))
    );
    if (active) return active.n;
    if (candidates.length) return candidates[0].n;
    const p = new URLSearchParams(location.search);
    const n = parseInt(p.get(kind), 10);
    return n >= 1 && n <= 2000 ? n : null;
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
    if (!state.played) return;
    const episode = state.episode || 1; // серию не нашли — фильм или ролик: одна «серия»
    const key = `${state.season}:${episode}`;
    const now = Date.now();
    // смена серии — сразу; время — не чаще раза в 10 с
    if (!force && key === state.lastKey && now - state.lastSent < 10000) return;
    state.lastKey = key;
    state.lastSent = now;
    send({
      type: 'progress',
      season: state.season,
      episode,
      time: Math.floor(state.time),
      duration: Math.floor(state.duration),
    });
  }

  function poll() {
    const v = mainVideo();
    if (!v) return;
    const ep = readFromDom('episode');
    const se = readFromDom('season');
    const changed = (ep && ep !== state.episode) || (se && se !== state.season);
    if (ep) state.episode = ep;
    if (se) state.season = se;
    if (isFinite(v.duration) && v.duration > 0) state.duration = v.duration;
    if (v.currentTime > 0) state.time = v.currentTime;
    if (!v.paused && v.currentTime > 0) state.played = true;
    if (changed) report(true);
    else if (!v.paused) report(false);
  }

  // Перемотка к месту остановки — один раз, на первом «старте» той же серии, если видео в самом начале.
  // Досмотренную и первые 30 с не перематываем: там проще начать заново.
  function tryResume(v) {
    if (!resume || resumed.has(v)) return;
    const { done } = atStatus(resume);
    if (done || !(resume.time > 30) || (state.episode || 1) !== resume.episode) return;
    resumed.add(v);
    if (v.currentTime > 10) return; // уже смотрит с другого места — не мешаем
    v.currentTime = Math.max(0, resume.time - 3);
  }

  function initFrame() {
    send({ type: 'entry' }).then((r) => {
      resume = r?.entry || null;
    });
    document.addEventListener(
      'play',
      (e) => {
        if (e.target?.tagName !== 'VIDEO') return;
        state.episode = readFromDom('episode') || state.episode;
        tryResume(e.target);
      },
      true
    );
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
    document.addEventListener(
      'ended',
      (e) => {
        if (e.target?.tagName !== 'VIDEO') return;
        state.played = true;
        if (state.duration) state.time = state.duration;
        report(true);
      },
      true
    );
    setInterval(poll, 2000);
  }
})();
