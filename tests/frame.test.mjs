// Окно плеера: настоящие content.js (личная) и tracker.js (магазин) в песочнице node:vm с поддельной
// страницей — подпись «N серия», один <video> и ручной опрос (setInterval не тикает сам).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

function frame(file, { topOrigin, origin }) {
  const sent = [];
  const listeners = {};
  let tick = () => {};
  const label = { tagName: 'SPAN', innerText: '', children: [], className: '', parentElement: { className: '' } };
  label.getBoundingClientRect = () => ({ width: 60, height: 20 });
  const video = { tagName: 'VIDEO', currentTime: 0, duration: NaN, paused: true, clientWidth: 640, clientHeight: 360 };
  video.getBoundingClientRect = () => ({ width: 640, height: 360 });
  const document = {
    querySelectorAll(sel) {
      if (sel === 'video' || sel === 'video, iframe') return [video];
      if (/\bspan\b/.test(sel)) return [label];
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
      lastError: null,
      sendMessage(m, cb) {
        sent.push(m);
        cb?.(m.type === 'entry' ? { entry: null } : { ok: true });
      },
      onMessage: { addListener() {} },
    },
    storage: { local: { get: async () => ({ sites: [{ host: new URL(topOrigin).hostname, origins: [topOrigin] }] }) } },
  };
  const win = { top: {}, addEventListener() {} }; // окно плеера — не верхнее
  const ctx = vm.createContext({
    window: win,
    document,
    chrome,
    location: { origin, pathname: '/serial/1/h/720p', search: '', hash: '', ancestorOrigins: [topOrigin] },
    URL,
    URLSearchParams,
    setInterval: (f) => (tick = f),
    setTimeout,
    getComputedStyle: () => ({ visibility: 'visible', position: 'static' }),
    MutationObserver: class {
      observe() {}
    },
    console,
  });
  vm.runInContext(read('build.js') + read('shared.js'), ctx);
  vm.runInContext(read(file), ctx);
  const fire = (type) => (listeners[type] || []).forEach((f) => f({ target: video }));
  return { sent, video, label, fire, poll: () => tick(), progress: () => sent.filter((m) => m.type === 'progress') };
}

const settle = () => new Promise((r) => setTimeout(r, 10));

// Регрессия 13.10: Kodik сам включил 15 серию после 14-й. Подпись сменилась на «15 серия» сразу, а новое
// видео ещё грузилось (currentTime 0, длительность неизвестна) — и 15-я получила время конца 14-й
// (1394 из 1394), то есть «досмотрено», и попап предлагал 16-ю, пока шла 15-я.
for (const [file, topOrigin, origin] of [
  ['content.js', 'https://yummyanime.tv', 'https://kodikplayer.com'],
  ['tracker.js', 'https://tv.example.com', 'https://player.example.net'],
]) {
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
