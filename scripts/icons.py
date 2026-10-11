# Логотип «Стопка серий» → PNG 16/32/48/128 и промо-плитка магазина.
# Рисуем в 8× и уменьшаем (сглаживание без зависимостей, кроме Pillow). Геометрия — в сетке 128.
# Запуск: python scripts/icons.py
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TILE, BACK, MID, CARD, ACCENT = '#14171d', '#3a404c', '#8b919d', '#f1f3f6', '#55c989'


def draw_mark(d, ox, oy, s, simple=False):
    """Знак в квадрате 128×128 со смещением (ox, oy) и масштабом s.
    simple — для 16 px: одна задняя карточка вместо двух, крупнее «play» (мелочь сливается)."""
    R = lambda x0, y0, x1, y1, r, c: d.rounded_rectangle(
        [ox + x0 * s, oy + y0 * s, ox + x1 * s, oy + y1 * s], radius=r * s, fill=c)
    P = lambda pts, c: d.polygon([(ox + x * s, oy + y * s) for x, y in pts], fill=c)
    R(0, 0, 128, 128, 28, TILE)
    if simple:
        R(30, 22, 98, 64, 10, MID)
        R(16, 40, 112, 110, 14, CARD)
        P([(52, 56), (52, 92), (82, 74)], TILE)
        return
    R(40, 20, 96, 60, 8, BACK)
    R(32, 31, 100, 77, 9, MID)
    R(22, 44, 106, 106, 11, CARD)
    P([(55, 58), (55, 84), (77, 71)], TILE)
    R(32, 94, 72, 100, 3, ACCENT)


def render(size, pad=0, simple=False, k=8):
    big = size * k
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    inner = big - 2 * pad * k
    draw_mark(ImageDraw.Draw(img), pad * k, pad * k, inner / 128, simple)
    return img.resize((size, size), Image.LANCZOS)


os.makedirs(os.path.join(ROOT, 'icons'), exist_ok=True)
# панель браузера — знак во весь размер; 128 — для магазина: 96 px знака и 16 px прозрачного поля
# (так требует Chrome Web Store: иконка 128 с полем, чтобы в каталоге не выглядела крупнее чужих)
render(16, simple=True).save(os.path.join(ROOT, 'icons', 'icon16.png'))
render(32).save(os.path.join(ROOT, 'icons', 'icon32.png'))
render(48).save(os.path.join(ROOT, 'icons', 'icon48.png'))
render(128, pad=16).save(os.path.join(ROOT, 'icons', 'icon128.png'))
print('icons ok')
