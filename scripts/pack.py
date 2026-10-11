# Архивы для установки и магазина. Не Compress-Archive: PowerShell 5.1 пишет пути с «\»,
# и Chrome Web Store не находит icons/icon128.png. Запуск: node scripts/build.mjs && python scripts/pack.py
import os, zipfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for build, name in [('store', 'anime-tracker-store.zip'), ('personal', 'anime-tracker.zip')]:
    src = os.path.join(ROOT, 'dist', build)
    dst = os.path.join(os.path.dirname(ROOT), name)
    with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as z:
        for base, _, files in os.walk(src):
            for f in sorted(files):
                full = os.path.join(base, f)
                z.write(full, os.path.relpath(full, src).replace(os.sep, '/'))
    print(name, [n for n in zipfile.ZipFile(dst).namelist()])
