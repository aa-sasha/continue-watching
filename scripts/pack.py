# Архивы расширения. Не Compress-Archive: PowerShell 5.1 пишет пути с «\», и Chrome Web Store
# не находит icons/icon128.png. Запуск: node scripts/build.mjs && python scripts/pack.py
#   anime-tracker.zip     — «Загрузить распакованное» (с key: постоянный ID, иначе sync не связал бы
#                           компьютеры с разными путями к папке);
#   anime-tracker-cws.zip — для Chrome Web Store: без key (ID товару назначает магазин) и с описанием
#                           под карточку.
import json, os, zipfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CWS_DESCRIPTION = ('Запоминает сезон, серию, озвучку и момент остановки на YummyAnime и NewDeaf '
                   'и открывает плеер Kodik на нужном месте.')


def pack(name, manifest_patch=None):
    src = os.path.join(ROOT, 'dist', 'personal')
    dst = os.path.join(os.path.dirname(ROOT), name)
    with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as z:
        for base, _, files in os.walk(src):
            for f in sorted(files):
                full = os.path.join(base, f)
                arc = os.path.relpath(full, src).replace(os.sep, '/')
                if arc == 'manifest.json' and manifest_patch:
                    m = json.load(open(full, encoding='utf-8'))
                    manifest_patch(m)
                    z.writestr(arc, json.dumps(m, ensure_ascii=False, indent=2) + '\n')
                else:
                    z.write(full, arc)
    print(name, zipfile.ZipFile(dst).namelist())


def for_cws(m):
    m.pop('key', None)  # магазин не принимает пакет с key: ID товара назначает сам
    assert len(CWS_DESCRIPTION) <= 132
    m['description'] = CWS_DESCRIPTION


pack('anime-tracker.zip')
pack('anime-tracker-cws.zip', for_cws)
