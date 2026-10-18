// Окно плеера: настоящий content.js в песочнице node:vm с поддельной
// страницей — подпись «N серия», один <video> и ручной опрос (setInterval не тикает сам).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

function frame(file, { topOrigin, origin, kodikChild = false }) {
  const sent = [];
  const listeners = {};
  let tick = () => {};
  const label = { tagName: 'SPAN', innerText: '', children: [], className: '', parentElement: { className: '' } };
  Object.defineProperty(label, 'textContent', { get: () => label.innerText });
  // окно Kodik внутри этого фрейма (обёртка сайта) — источник сообщений kodik_player_*
  const kodikWin = {};
  const kodikFrame = { tagName: 'IFRAME', src: 'https://kodikplayer.com/serial/1/h/720p', contentWindow: kodikWin };
  label.getBoundingClientRect = () => ({ width: 60, height: 20 });
  const video = { tagName: 'VIDEO', currentTime: 0, duration: NaN, paused: true, clientWidth: 640, clientHeight: 360 };
  video.getBoundingClientRect = () => ({ width: 640, height: 360 });
  const document = {
    querySelectorAll(sel) {
      if (sel === 'video' || sel === 'video, iframe') return [video];
      if (/\bspan\b/.test(sel)) return [label];
      if (sel === 'iframe' && kodikChild) return [kodikFrame];
      return [];
    },
    querySelector: (sel) => (sel === 'video' ? video : null),
    getElementById: () => null,
    addEventListener: (t, f) => (listeners[t] ||= []).push(f),
    documentElement: {},
    body: { innerText: '' },
    title: '',
    referrer: '',
  };
  const chrome = {
    runtime: {
      id: 'test',
      lastError: null,
      sendMessage(m, cb) {
        sent.push(m);
        cb?.(m.type === 'entry' ? { entry: null } : { ok: true });
      },
      onMessage: { addListener() {} },
    },
  };
  const winListeners = {};
  const win = { top: {}, addEventListener: (t, f) => (winListeners[t] ||= []).push(f) }; // окно плеера — не верхнее
  const ctx = vm.createContext({
    window: win,
    document,
    chrome,
    location: { origin, pathname: '/serial/1/h/720p', search: '', hash: '', ancestorOrigins: [topOrigin] },
    URL,
    URLSearchParams,
    setInterval: (f) => ((tick = f), 1),
    clearInterval: () => (tick = () => {}),
    setTimeout,
    getComputedStyle: () => ({ visibility: 'visible', position: 'static' }),
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    console,
  });
  vm.runInContext(read('shared.js'), ctx);
  vm.runInContext(read(file), ctx);
  const fire = (type) => (listeners[type] || []).forEach((f) => f({ target: video }));
  // сообщение от окна Kodik в эту обёртку
  const kodik = (key, value) =>
    (winListeners.message || []).forEach((f) => f({ data: { key, value }, origin: 'https://kodikplayer.com', source: kodikWin }));
  return { sent, video, label, fire, kodik, chrome, poll: () => tick(), progress: () => sent.filter((m) => m.type === 'progress') };
}

const settle = () => new Promise((r) => setTimeout(r, 10));

// Регрессия 13.10: Kodik сам включил 15 серию после 14-й. Подпись сменилась на «15 серия» сразу, а новое
// видео ещё грузилось (currentTime 0, длительность неизвестна) — и 15-я получила время конца 14-й
// (1394 из 1394), то есть «досмотрено», и попап предлагал 16-ю, пока шла 15-я.
for (const [file, topOrigin, origin] of [['content.js', 'https://yummyanime.tv', 'https://kodikplayer.com']]) {
  for (const withPlayEvent of [false, true]) {
    test(`${file}: автопереход на следующую серию не отмечает её досмотренной${withPlayEvent ? ' (через play)' : ''}`, async () => {
      const f = frame(file, { topOrigin, origin });
      await settle();
      // смотрим 14-ю
      f.label.innerText = '14 серия';
      Object.assign(f.video, { currentTime: 1380, duration: 1394, paused: false });
      f.poll();
      // доиграла: пауза в самом конце — 14-я досмотрена честно
      Object.assign(f.video, { currentTime: 1394, paused: true });
      f.fire('pause');
      // плеер сам включает 15-ю: подпись уже новая, видео ещё грузится
      f.label.innerText = '15 серия';
      Object.assign(f.video, { currentTime: 0, duration: NaN, paused: false });
      if (withPlayEvent) f.fire('play');
      f.poll();
      f.poll();
      const ep15 = f.progress().filter((m) => m.episode === 15);
      for (const m of ep15) assert.ok(!(m.duration > 0 && m.time / m.duration >= 0.9), `15 серия ушла как досмотренная: ${m.time}/${m.duration}`);
      // а 14-я досмотрена
      assert.ok(f.progress().some((m) => m.episode === 14 && m.time === 1394));
    });
  }
}

test('content.js: смена серии сообщением Kodik сбрасывает и длительность прошлой серии', async () => {
  // ревью 18.10: после короткой 20-минутной серии шла 24-минутная; до duration_update время новой
  // делилось на длительность прошлой, и на 18-й минуте серия считалась досмотренной
  const f = frame('content.js', { topOrigin: 'https://yummyanime.tv', origin: 'https://yummyanime.tv', kodikChild: true });
  await settle();
  f.kodik('kodik_player_current_episode', { episode: 14, season: 1 });
  f.kodik('kodik_player_duration_update', 1200);
  f.kodik('kodik_player_time_update', 600);
  f.kodik('kodik_player_current_episode', { episode: 15, season: 1 });
  f.kodik('kodik_player_time_update', 1100); // 18:20 новой серии, длительность ещё не пришла
  f.kodik('kodik_player_pause');
  f.fire('pause');
  const ep15 = f.progress().filter((m) => m.episode === 15);
  assert.ok(ep15.length > 0);
  for (const m of ep15) assert.ok(!(m.duration > 0 && m.time / m.duration >= 0.9), `${m.time}/${m.duration}`);
});

for (const file of ['content.js']) {
  test(`${file}: после перезагрузки расширения осиротевший скрипт перестаёт опрашивать страницу`, async () => {
    const f = frame(file, { topOrigin: 'https://yummyanime.tv', origin: 'https://kodikplayer.com' });
    await settle();
    f.label.innerText = '3 серия';
    Object.assign(f.video, { currentTime: 100, duration: 1400, paused: false });
    f.poll();
    const before = f.sent.length;
    delete f.chrome.runtime.id; // так выглядит chrome.runtime в осиротевшем скрипте
    f.label.innerText = '4 серия'; // смену серии старый код отправил бы сразу, без 10-секундной паузы
    f.video.currentTime = 200;
    f.poll();
    assert.equal(f.sent.length, before);
  });
}
