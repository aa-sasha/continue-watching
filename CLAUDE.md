# CLAUDE.md — continue-watching

Chrome-расширение **Anime Tracker — продолжить просмотр**: на YummyAnime и NewDeaf запоминает сезон, серию,
озвучку и момент остановки и открывает плеер Kodik на нужном месте. Опубликовано в Chrome Web Store
(архив `anime-tracker-cws.zip`); для себя ставится и распакованным (`anime-tracker.zip`, с постоянным ID).
Универсальная магазинная сборка «трекер серий» снята 18.10.2026: она дублировала эту.

Репозиторий публичный: https://github.com/aa-sasha/continue-watching

## Язык

Код, имена, идентификаторы — английский. Комментарии, UI, коммиты, PR, отчёты — русский.

## Команды

```bash
npm test                    # node --test: фон в песочнице с поддельным chrome.*, окно плеера (node:vm), shared.js
node scripts/build.mjs      # dist/personal; падает, если манифест или попап ссылаются на файл, которого нет
python scripts/icons.py     # значки из геометрии логотипа
python scripts/store-assets.py  # скриншот и промо магазина в store/
python scripts/pack.py      # ../anime-tracker.zip и ../anime-tracker-cws.zip (пути с «/», не Compress-Archive)
```
Node на этой машине — только в WSL: `wsl -e bash -lc 'cd /mnt/d/_AI/anime-tracker && npm test'`.

## Главное

- Контент-скрипт идёт во все фреймы любых сайтов и сразу выходит, если верхняя страница — не YummyAnime
  и не NewDeaf (`AT_SITES` в shared.js). Ничего не читать и не хранить на чужих сайтах.
- Команды попапа (очистка, удаление, «Вернуть») фон принимает только от страниц расширения.
- Синхронизация — `chrome.storage.sync` с лимитами: сжатые записи `e:`, отметки удаления `d:`, запись
  пачками; подробности — комментарий в background.js.

## Git

- **Ветки.** `main` — то, что в магазине и в архивах. Работа — в ветке `feat/…`, `fix/…`, `chore/…`,
  `docs/…` от свежего `main`, затем PR в `main`. Прямые коммиты в `main` — нет.
- **Коммиты** — conventional commits по-русски: `тип(область): что изменилось для человека`.
  Типы: `feat`, `fix`, `docs`, `chore`, `test`, `refactor`, `build`. Область — `popup`, `player`,
  `kodik`, `sync`, `store`, `build`… Пример: `fix(kodik): озвучка, которую плеер подставил сам, не записывается как выбор`.
- **Тело коммита и PR** — причина и как проверено, а не пересказ диффа. Регрессия — с датой и симптомом.
- **Коммит перечислением путей:** `git add <пути> && git commit` одной командой, не `git add -A`;
  перед коммитом — `git status --short`. Индекс не держать между командами.
- **Перед коммитом** — `npm test` зелёный и `node scripts/build.mjs` собирается.
- **Не коммитить:** `dist/`, архивы `*.zip`, секреты (их здесь нет и не должно быть).
- **Автор** — `Sasha <sasanikitin@users.noreply.github.com>` (адрес noreply, личная почта в истории не светится).
- **Слияние PR** — merge-коммит `Merge #N: <суть>`; ветку после слияния удалять.
- **Историю `main` не переписывать** (`push --force` — нет).

## Выпуск

1. Поднять `version` в `manifest.json`.
2. `npm test` → `node scripts/build.mjs` → `python scripts/pack.py`.
3. PR `build: версия X.Y.Z — <что нового>` → слияние → тег `vX.Y.Z`.
4. Магазин: `anime-tracker-cws.zip` загружает владелец в кабинете разработчика (Chrome не даёт
   расширениям управлять магазином). Тексты карточки — `store/LISTING-anime.md`, политика —
   `docs/privacy-anime.html` (GitHub Pages).
