'use strict';

// подпись сайта в эйбрау
const SITE_NAME = {
  newdeaf: 'NewDeaf',
  yummyanime: 'YummyAnime',
  yummyani: 'YummyAni',
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
  // досмотренные целиком — вниз: первая карточка всегда та, что можно продолжить (порядок по свежести
  // внутри групп сохраняется — сортировка устойчивая)
  list = [...list].sort((a, b) => atStatus(a).finished - atStatus(b).finished);
  empty.classList.toggle('hidden', list.length > 0);
  document.getElementById('footer').classList.toggle('hidden', list.length === 0);

  for (const e of list) {
    const li = el('li', 'watch-item');
    li.dataset.key = e.key; // по нему возвращаем фокус после перерисовки
    const a = el('a', 'watch-link');
    a.dataset.role = 'open';
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

    // Ряд 1 — «где я»: «1 сезон, 3 серия · 12:34 из 23:04», одной строкой без переноса.
    // Чип озвучки раньше стоял здесь и выталкивал время на вторую строку.
    const season = e.season ? `${e.season} сезон, ` : '';
    const next = atStatus(e).next;
    const line = finished
      ? `Досмотрено: все ${e.total} серий`
      : done
        ? `Дальше ${season}${next} серия`
        : `${season}${e.episode} серия` + (e.time ? ` · ${fmt(e.time)}${e.duration ? ' из ' + fmt(e.duration) : ''}` : '');
    info.appendChild(el('div', 'watch-meta watch-line', line));

    // Ряд 2 — сколько осталось (считая серию на значке) и озвучка
    const sub = el('div', 'watch-sub');
    const left = e.total && !finished ? e.total - next + 1 : 0;
    if (left > 0) sub.appendChild(el('span', 'watch-left', `Осталось ${left} из ${e.total}`));
    // ярлык озвучки: SUB — субтитры, DUB — озвучка (студия — по наведению); в ней же откроется плеер
    const tr = e.translation;
    let trSpoken = '';
    if (tr?.title) {
      const isSub = tr.type === 'sub' || /субтитр/i.test(tr.title);
      const chip = el('span', 'tr-chip', isSub ? 'SUB' : 'DUB');
      chip.title = isSub ? (/^субтитры$/i.test(tr.title) ? 'Субтитры' : `Субтитры: ${tr.title}`) : `Озвучка: ${tr.title}`;
      sub.appendChild(chip);
      trSpoken = `. ${isSub ? 'Субтитры' : 'Озвучка ' + tr.title}`; // скринридеру, а не только мыши
    }
    if (sub.childNodes.length) info.appendChild(sub);
    a.setAttribute('aria-label', `${e.title}. ${line}${left > 0 ? `. Осталось ${left} из ${e.total}` : ''}${trSpoken}`);

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
      b.dataset.role = delta < 0 ? 'prev' : 'next';
      b.appendChild(atIcon(icon, 14));
      b.title = `Не та серия? Запомнить ${target}`;
      b.setAttribute('aria-label', `${label}: запомнить ${target} серию для «${e.title}»`);
      b.disabled = target < 1;
      b.addEventListener('click', async () => {
        await chrome.runtime.sendMessage({ type: 'manual', key: e.key, patch: { episode: target, time: 0, duration: 0 } });
        await load();
        // правка обнуляет время серии — случайный клик не должен стирать «6:58» насовсем
        showToast(`Запомнили ${target} серию`, 'Отменить', async () => {
          await chrome.runtime.sendMessage({ type: 'restore', entry: e, replace: true });
          load();
        });
      });
      step.appendChild(b);
    }

    const del = el('button', 'btn-remove');
    del.dataset.role = 'remove';
    del.appendChild(atIcon('x', 16));
    del.title = 'Убрать из списка';
    del.setAttribute('aria-label', `Убрать «${e.title}» из списка`);
    del.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const r = await chrome.runtime.sendMessage({ type: 'remove', key: e.key }).catch(() => null);
      if (!r?.ok) return showToast('Не получилось убрать — попробуйте ещё раз'); // не врём «убран» при сбое
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
  // перерисовка стирает список — запоминаем, где был фокус клавиатуры, чтобы вернуть его (WCAG 2.4.3)
  const focused = document.activeElement;
  const focusKey = focused?.closest?.('[data-key]')?.dataset.key;
  const focusRole = focused?.dataset?.role;
  const keys = [...document.querySelectorAll('#watchList [data-key]')].map((li) => li.dataset.key);
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
  if (focusKey) restoreFocus(focusKey, focusRole, keys.indexOf(focusKey));
}

// тот же элемент той же карточки; карточку удалили — соседняя на её месте (или предыдущая)
function restoreFocus(key, role, oldIndex) {
  const items = [...document.querySelectorAll('#watchList [data-key]')];
  const li = items.find((x) => x.dataset.key === key) || items[Math.min(oldIndex, items.length - 1)];
  if (!li) return document.getElementById('btnClear')?.focus();
  const target = (role && li.querySelector(`[data-role="${role}"]:not(:disabled)`)) || li.querySelector('[data-role="open"]');
  target?.focus();
}

// Тост r6tv: белая плашка, текст цвета фона, 14/700, радиус --r-btn; одно действие и автоскрытие.
// 8 с и пауза, пока на нём курсор или фокус: «Вернуть» должны успеть нажать (WCAG 2.2.1).
const TOAST_MS = 8000;
let toastTimer = 0;
function hideToast() {
  document.getElementById('toast').classList.add('hidden');
  document.body.classList.remove('has-toast');
}
function armToast() {
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, TOAST_MS);
}
{
  const t = document.getElementById('toast');
  for (const ev of ['mouseenter', 'focusin']) t.addEventListener(ev, () => clearTimeout(toastTimer));
  for (const ev of ['mouseleave', 'focusout']) t.addEventListener(ev, armToast);
}
function showToast(text, actionLabel, onAction) {
  const t = document.getElementById('toast');
  t.innerHTML = '';
  t.appendChild(el('span', 'toast-text', text));
  if (actionLabel) {
    const b = el('button', 'toast-action', actionLabel);
    b.addEventListener('click', () => {
      hideToast();
      onAction();
    });
    t.appendChild(b);
  }
  t.classList.remove('hidden');
  document.body.classList.add('has-toast'); // список получает отступ снизу — тост не закрывает ‹ › последней карточки
  armToast();
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

// Очистка — как удаление одной записи: сразу и с «Вернуть», без системного confirm() поверх попапа
btnClear.addEventListener('click', async () => {
  const r = await chrome.runtime.sendMessage({ type: 'list' });
  const before = r?.list || [];
  const done = await chrome.runtime.sendMessage({ type: 'clear' }).catch(() => null);
  if (!done?.ok) return showToast('Не получилось очистить — попробуйте ещё раз');
  await load();
  showToast('История очищена', 'Вернуть', async () => {
    await chrome.runtime.sendMessage({ type: 'restoreAll', entries: before });
    load();
  });
});
document.getElementById('btnRetry').addEventListener('click', () => load());

load();
