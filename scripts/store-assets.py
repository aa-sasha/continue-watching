# Материалы карточки Chrome Web Store: скриншоты 1280×800 и промо-плитка 440×280.
# Настоящий попап сборки dist/store с вымышленными данными (поддельный chrome.* API), снимок —
# Chrome без окна. Названия и постеры выдуманные: в карточке нет чужих брендов и контента.
# Запуск: node scripts/build.mjs && python scripts/store-assets.py
import os, re, shutil, subprocess
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, 'dist', 'store-assets-src')
OUT = os.path.join(ROOT, 'store')
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'

shutil.rmtree(WORK, ignore_errors=True)
shutil.copytree(os.path.join(ROOT, 'dist', 'store'), WORK)
os.makedirs(OUT, exist_ok=True)

# постеры: плоская геометрия в цветах, не похожих ни на какой реальный тайтл
POSTERS = [('#2d4a6b', '#e8b44c'), ('#5b2d3c', '#f08a5d'), ('#1f4d43', '#8fd3b6'), ('#3d3561', '#c9a7f2')]
for i, (bg, fg) in enumerate(POSTERS):
    k = 8
    im = Image.new('RGB', (88 * k, 124 * k), bg)
    d = ImageDraw.Draw(im)
    d.ellipse([20 * k, 18 * k, 68 * k, 66 * k], fill=fg)
    d.rectangle([0, 84 * k, 88 * k, 124 * k], fill='#14171d')
    d.polygon([(0, 84 * k), (44 * k, (60 + i * 6) * k), (88 * k, 84 * k)], fill='#14171d')
    im.resize((88, 124), Image.LANCZOS).save(os.path.join(WORK, f'poster{i}.png'))

FAKE = """<script>
const MODE = new URLSearchParams(location.search).get('mode') || 'tracked';
const NOW = Date.now();
const LIST = MODE === 'new' ? [] : [
  { key:'a', site:'tv.example.com', url:'https://tv.example.com/a', title:'Северный экспресс', poster:'poster0.png', season:1, episode:6, time:418, duration:1384, total:12, watched:{}, updatedAt:NOW-60000 },
  { key:'b', site:'tv.example.com', url:'https://tv.example.com/b', title:'Хроники маяка', poster:'poster1.png', season:2, episode:3, time:1300, duration:1400, total:10, watched:{'2:3':true}, updatedAt:NOW-3*3600e3 },
  { key:'c', site:'kino.example.org', url:'https://kino.example.org/c', title:'Город после дождя', poster:'poster2.png', season:null, episode:14, time:905, duration:1440, total:24, watched:{}, updatedAt:NOW-26*3600e3 },
  // { key:'d', site:'kino.example.org', url:'https://kino.example.org/d', title:'Лаборатория снов', poster:'poster3.png', season:1, episode:8, time:1420, duration:1440, total:8, watched:{'1:8':true}, updatedAt:NOW-4*86400e3 },
];
window.chrome = {
  runtime: { sendMessage: async (m) => (m.type === 'list' ? { list: LIST } : { ok: true }) },
  tabs: { query: async () => [{ id: 1, url: MODE === 'new' ? 'https://anime.example.net/series/42' : 'https://tv.example.com/a' }] },
  storage: { local: { get: async () => ({ sites: MODE === 'new' ? [] : [{ host: 'tv.example.com', origins: ['https://tv.example.com'] }] }), set: async () => {}, remove: async () => {} } },
  scripting: { executeScript: async () => [{ result: ['https://player.example.net'] }] },
  permissions: { request: async () => true },
};
</script>"""
html = open(os.path.join(WORK, 'popup.html'), encoding='utf-8').read()
html = html.replace('<script src="build.js"></script>', FAKE + '\n  <script src="build.js"></script>')
# демо: постеры лежат рядом файлами, а попап пропускает только http(s) — для снимка разрешаем их
html = html.replace('<script src="popup.js"></script>',
    '<script>const _safe = atSafeUrl; atSafeUrl = (u) => (/^poster[0-9][.]png$/.test(u) ? u : _safe(u));</script>\n'
    '  <script src="popup.js"></script>')
open(os.path.join(WORK, 'popup.html'), 'w', encoding='utf-8').write(html)

ICON = open(os.path.join(ROOT, 'icons', 'icon128.png'), 'rb').read()
FONT = "Roboto,-apple-system,'Segoe UI',Arial,sans-serif"

def slide(name, mode, title, sub, h=430):
    page = f"""<!doctype html><html><head><meta charset="utf-8"><style>
body{{margin:0;width:1280px;height:800px;background:#0a0c10;font-family:{FONT};color:#f1f3f6;display:flex;align-items:center;gap:72px;padding:0 96px;box-sizing:border-box}}
.copy{{flex:1}} h1{{font-size:52px;line-height:1.1;font-weight:800;letter-spacing:-0.02em;margin:0 0 20px}}
p{{font-size:22px;line-height:1.5;color:#8b919d;margin:0;max-width:520px}}
.brand{{display:flex;align-items:center;gap:14px;margin-bottom:40px;font-size:20px;font-weight:700}}
.brand img{{width:48px;height:48px;margin:-8px}}
.shot{{flex:none;width:360px;height:{h}px;transform:scale(1.4);transform-origin:center;border-radius:14px;overflow:hidden;background:#0a0c10}}
iframe{{border:0;width:360px;height:{h}px}}
</style></head><body><div class="copy"><div class="brand"><img src="../../icons/icon128.png">Продолжить просмотр</div>
<h1>{title}</h1><p>{sub}</p></div><div class="shot"><iframe src="popup.html?mode={mode}"></iframe></div></body></html>"""
    path = os.path.join(WORK, f'{name}.html')
    open(path, 'w', encoding='utf-8').write(page)
    shoot(path, os.path.join(OUT, f'{name}.png'), 1280, 800)

def shoot(src, dst, w, h):
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
                    f'--window-size={w},{h}', f'--screenshot={dst}', '--virtual-time-budget=3000',
                    'file:///' + src.replace(os.sep, '/')], check=True, capture_output=True)
    print('ok', os.path.relpath(dst, ROOT))

slide('screenshot-1', 'tracked', 'Где вы остановились — в один клик',
      'Серия, момент и сколько осталось. Нажмите на сериал — страница откроется, а видео продолжится с того же места.', h=540)
slide('screenshot-2', 'new', 'Отслеживает только то, что вы выбрали',
      'Нажмите «Отслеживать этот сайт» — Chrome спросит доступ только к нему. История хранится на вашем устройстве и никуда не отправляется.', h=300)

promo = f"""<!doctype html><html><head><meta charset="utf-8"><style>
body{{margin:0;width:440px;height:280px;background:#0a0c10;font-family:{FONT};color:#f1f3f6;display:flex;flex-direction:column;justify-content:center;padding:0 36px;box-sizing:border-box}}
img{{width:96px;height:96px;margin:-16px 0 4px -16px}} h1{{font-size:30px;font-weight:800;letter-spacing:-0.02em;margin:0 0 6px}}
p{{font-size:16px;color:#8b919d;margin:0}}</style></head><body><img src="../../icons/icon128.png">
<h1>Продолжить просмотр</h1><p>Трекер серий: где остановились — в один клик</p></body></html>"""
pp = os.path.join(WORK, 'promo.html')
open(pp, 'w', encoding='utf-8').write(promo)
shoot(pp, os.path.join(OUT, 'promo-440x280.png'), 440, 280)

# очень большое промо 1400×560: знак и название слева, настоящий попап справа
marquee = f"""<!doctype html><html><head><meta charset="utf-8"><style>
body{{margin:0;width:1400px;height:560px;background:#0a0c10;font-family:{FONT};color:#f1f3f6;display:flex;align-items:center;gap:80px;padding:0 110px;box-sizing:border-box;overflow:hidden}}
.copy{{flex:1}} img{{width:120px;height:120px;margin:-20px 0 8px -20px}}
h1{{font-size:56px;line-height:1.1;font-weight:800;letter-spacing:-0.02em;margin:0 0 14px}}
p{{font-size:24px;color:#8b919d;margin:0;max-width:560px;line-height:1.45}}
.shot{{flex:none;width:360px;height:540px;margin-top:140px;transform:scale(1.15);transform-origin:top center;border-radius:14px;overflow:hidden}}
iframe{{border:0;width:360px;height:540px}}</style></head><body><div class="copy"><img src="../../icons/icon128.png">
<h1>Продолжить просмотр</h1><p>Запоминает серию и момент, где вы остановились, и возвращает к ним в один клик.</p></div>
<div class="shot"><iframe src="popup.html?mode=tracked"></iframe></div></body></html>"""
mp = os.path.join(WORK, 'marquee.html')
open(mp, 'w', encoding='utf-8').write(marquee)
shoot(mp, os.path.join(OUT, 'marquee-1400x560.png'), 1400, 560)

# магазин требует 24-битный PNG без прозрачности
for f in os.listdir(OUT):
    if f.endswith('.png') and not f.startswith('store-icon'):
        p = os.path.join(OUT, f)
        Image.open(p).convert('RGB').save(p)

# ── товар «Anime Tracker» (личная версия в магазине): попап dist/personal, записи YummyAnime/NewDeaf ──
# Названия и постеры вымышленные, как и выше; сайты — те, для которых версия сделана.
WORK2 = os.path.join(ROOT, 'dist', 'store-assets-personal')
shutil.rmtree(WORK2, ignore_errors=True)
shutil.copytree(os.path.join(ROOT, 'dist', 'personal'), WORK2)
for i in range(3):
    shutil.copy(os.path.join(WORK, f'poster{i}.png'), WORK2)
SUB = "{ title:'Субтитры', type:'sub', path:'/serial/1/a/720p' }"
DUB = "{ title:'Студия', type:'dub', path:'/serial/2/b/720p' }"
FAKE2 = f"""<script>
const NOW = Date.now();
const LIST = [
  {{ key:'a', site:'yummyanime', url:'https://yummyanime.tv/a.html', title:'Северный экспресс', poster:'poster0.png', season:1, episode:15, time:418, duration:1384, total:24, watched:{{}}, translation:{SUB}, updatedAt:NOW-60000 }},
  {{ key:'b', site:'newdeaf', url:'https://a.newdeaf.co/anime/b.html', title:'Хроники маяка', poster:'poster1.png', season:2, episode:3, time:1300, duration:1400, total:10, watched:{{'2:3':true}}, updatedAt:NOW-3*3600e3 }},
  {{ key:'c', site:'yummyanime', url:'https://yummyanime.tv/c.html', title:'Город после дождя', poster:'poster2.png', season:1, episode:8, time:905, duration:1440, total:12, watched:{{}}, translation:{DUB}, updatedAt:NOW-26*3600e3 }},
];
window.chrome = {{ runtime: {{ sendMessage: async (m) => (m.type === 'list' ? {{ list: LIST }} : {{ ok: true }}) }} }};
</script>"""
h2 = open(os.path.join(WORK2, 'popup.html'), encoding='utf-8').read()
h2 = h2.replace('<script src="build.js"></script>', FAKE2 + '\n  <script src="build.js"></script>')
h2 = h2.replace('<script src="popup.js"></script>',
    '<script>const _safe = atSafeUrl; atSafeUrl = (u) => (/^poster[0-9][.]png$/.test(u) ? u : _safe(u));</script>\n'
    '  <script src="popup.js"></script>')
open(os.path.join(WORK2, 'popup.html'), 'w', encoding='utf-8').write(h2)
page = open(os.path.join(WORK, 'screenshot-1.html'), encoding='utf-8').read()
page = page.replace('Продолжить просмотр</div>', 'Anime Tracker</div>', 1)
page = re.sub(r'<h1>.*?</h1><p>.*?</p>',
    '<h1>YummyAnime и NewDeaf: где вы остановились</h1><p>Серия, минута и озвучка. Нажмите на сериал — '
    'откроется плеер Kodik на той же серии в той же озвучке и перемотает к месту остановки.</p>', page, flags=re.S)
page = page.replace('popup.html?mode=tracked', 'popup.html').replace('height:540px', 'height:470px')
p2 = os.path.join(WORK2, 'anime-screenshot-1.html')
open(p2, 'w', encoding='utf-8').write(page)
shoot(p2, os.path.join(OUT, 'anime-screenshot-1.png'), 1280, 800)
Image.open(os.path.join(OUT, 'anime-screenshot-1.png')).convert('RGB').save(os.path.join(OUT, 'anime-screenshot-1.png'))
