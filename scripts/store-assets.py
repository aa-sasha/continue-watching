# Графика карточки Chrome Web Store: скриншот 1280×800 и промо-плитка 440×280.
# Настоящий попап из dist/personal с вымышленными данными (поддельный chrome.* API), снимок —
# Chrome без окна. Названия и постеры выдуманные; сайты — те, для которых расширение сделано.
# Запуск: node scripts/build.mjs && python scripts/store-assets.py
import os, shutil, subprocess
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, 'dist', 'store-assets-src')
OUT = os.path.join(ROOT, 'store')
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
FONT = "Roboto,-apple-system,'Segoe UI',Arial,sans-serif"

shutil.rmtree(WORK, ignore_errors=True)
shutil.copytree(os.path.join(ROOT, 'dist', 'personal'), WORK)
os.makedirs(OUT, exist_ok=True)

# постеры: плоская геометрия в цветах, не похожих ни на какой реальный тайтл
POSTERS = [('#2d4a6b', '#e8b44c'), ('#5b2d3c', '#f08a5d'), ('#1f4d43', '#8fd3b6')]
for i, (bg, fg) in enumerate(POSTERS):
    k = 8
    im = Image.new('RGB', (88 * k, 124 * k), bg)
    d = ImageDraw.Draw(im)
    d.ellipse([20 * k, 18 * k, 68 * k, 66 * k], fill=fg)
    d.rectangle([0, 84 * k, 88 * k, 124 * k], fill='#14171d')
    d.polygon([(0, 84 * k), (44 * k, (60 + i * 6) * k), (88 * k, 84 * k)], fill='#14171d')
    im.resize((88, 124), Image.LANCZOS).save(os.path.join(WORK, f'poster{i}.png'))

SUB = "{ title:'Субтитры', type:'sub', path:'/serial/1/a/720p' }"
DUB = "{ title:'Студия', type:'dub', path:'/serial/2/b/720p' }"
FAKE = f"""<script>
const NOW = Date.now();
const LIST = [
  {{ key:'a', site:'yummyanime', url:'https://yummyanime.tv/a.html', title:'Северный экспресс', poster:'poster0.png', season:1, episode:15, time:418, duration:1384, total:24, watched:{{}}, translation:{SUB}, updatedAt:NOW-60000 }},
  {{ key:'b', site:'newdeaf', url:'https://a.newdeaf.co/anime/b.html', title:'Хроники маяка', poster:'poster1.png', season:2, episode:3, time:1300, duration:1400, total:10, watched:{{'2:3':true}}, updatedAt:NOW-3*3600e3 }},
  {{ key:'c', site:'yummyanime', url:'https://yummyanime.tv/c.html', title:'Город после дождя', poster:'poster2.png', season:1, episode:8, time:905, duration:1440, total:12, watched:{{}}, translation:{DUB}, updatedAt:NOW-26*3600e3 }},
];
window.chrome = {{ runtime: {{ sendMessage: async (m) => (m.type === 'list' ? {{ list: LIST }} : {{ ok: true }}) }} }};
</script>"""
html = open(os.path.join(WORK, 'popup.html'), encoding='utf-8').read()
html = html.replace('<script src="icons.js"></script>', FAKE + '\n  <script src="icons.js"></script>')
# демо: постеры лежат рядом файлами, а попап пропускает только http(s) — для снимка разрешаем их
html = html.replace('<script src="popup.js"></script>',
    '<script>const _safe = atSafeUrl; atSafeUrl = (u) => (/^poster[0-9][.]png$/.test(u) ? u : _safe(u));</script>\n'
    '  <script src="popup.js"></script>')
open(os.path.join(WORK, 'popup.html'), 'w', encoding='utf-8').write(html)


def shoot(src, dst, w, h):
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
                    f'--window-size={w},{h}', f'--screenshot={dst}', '--virtual-time-budget=3000',
                    'file:///' + src.replace(os.sep, '/')], check=True, capture_output=True)
    Image.open(dst).convert('RGB').save(dst)  # магазин требует 24-битный PNG без прозрачности
    print('ok', os.path.relpath(dst, ROOT))


page = f"""<!doctype html><html><head><meta charset="utf-8"><style>
body{{margin:0;width:1280px;height:800px;background:#0a0c10;font-family:{FONT};color:#f1f3f6;display:flex;align-items:center;gap:72px;padding:0 96px;box-sizing:border-box}}
.copy{{flex:1}} h1{{font-size:52px;line-height:1.1;font-weight:800;letter-spacing:-0.02em;margin:0 0 20px}}
p{{font-size:22px;line-height:1.5;color:#8b919d;margin:0;max-width:520px}}
.brand{{display:flex;align-items:center;gap:14px;margin-bottom:40px;font-size:20px;font-weight:700}}
.brand img{{width:48px;height:48px;margin:-8px}}
.shot{{flex:none;width:360px;height:470px;transform:scale(1.4);transform-origin:center;border-radius:14px;overflow:hidden;background:#0a0c10}}
iframe{{border:0;width:360px;height:470px}}
</style></head><body><div class="copy"><div class="brand"><img src="../../icons/icon128.png">Anime Tracker</div>
<h1>YummyAnime и NewDeaf: где вы остановились</h1><p>Серия, минута и озвучка. Нажмите на сериал — откроется плеер Kodik
на той же серии в той же озвучке и перемотает к месту остановки.</p></div>
<div class="shot"><iframe src="popup.html"></iframe></div></body></html>"""
p = os.path.join(WORK, 'screenshot.html')
open(p, 'w', encoding='utf-8').write(page)
shoot(p, os.path.join(OUT, 'anime-screenshot-1.png'), 1280, 800)

promo = f"""<!doctype html><html><head><meta charset="utf-8"><style>
body{{margin:0;width:440px;height:280px;background:#0a0c10;font-family:{FONT};color:#f1f3f6;display:flex;flex-direction:column;justify-content:center;padding:0 36px;box-sizing:border-box}}
img{{width:96px;height:96px;margin:-16px 0 4px -16px}} h1{{font-size:30px;font-weight:800;letter-spacing:-0.02em;margin:0 0 6px}}
p{{font-size:16px;color:#8b919d;margin:0}}</style></head><body><img src="../../icons/icon128.png">
<h1>Anime Tracker</h1><p>Где остановились на YummyAnime и NewDeaf — в один клик</p></body></html>"""
pp = os.path.join(WORK, 'promo.html')
open(pp, 'w', encoding='utf-8').write(promo)
shoot(pp, os.path.join(OUT, 'promo-440x280.png'), 440, 280)
shutil.rmtree(WORK, ignore_errors=True)
