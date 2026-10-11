# CLAUDE.md — continue-watching

Chrome-расширение «Продолжить просмотр»: запоминает серию и момент остановки в видео и возвращает к ним.
Две сборки из одного кода (подробно — README):
- **store** — универсальный трекер для Chrome Web Store (`tracker.js`, сайты добавляет человек);
- **personal** — с модулями под YummyAnime/NewDeaf/Kodik (`content.js`), ставится распакованным.

Репозиторий публичный: https://github.com/aa-sasha/continue-watching

## Язык

Код, имена, идентификаторы — английский. Комментарии, UI, коммиты, PR, отчёты — русский.

## Команды

```bash
npm test                    # node --test: фон в песочнице, shared.js, готовая сборка store
node scripts/build.mjs      # dist/personal и dist/store; падает, если в store осталось имя сайта личной
python scripts/icons.py     # значки из геометрии логотипа
python scripts/store-assets.py  # скриншоты и промо магазина в store/
python scripts/pack.py      # ../anime-tracker*.zip (пути с «/», не Compress-Archive)
```
Node на этой машине — только в WSL: `wsl -e bash -lc 'cd /mnt/d/_AI/anime-tracker && npm test'`.

## Две сборки — главное правило

Код под конкретные сайты в общих файлах (background.js, shared.js, popup.*) — только внутри
`// @personal-start … // @personal-end`. Сборка store вырезает эти блоки и падает, если в ней осталось
`yummyani|newdeaf|kodik`. Новый общий код пишется так, чтобы работать в обеих сборках (`AT_BUILD`).
Магазинная версия ничего не меняет на сайтах — только читает `<video>`.

## Git

- **Ветки.** `main` — то, что в магазине и в архивах. Работа — в ветке `feat/…`, `fix/…`, `chore/…`,
  `docs/…` от свежего `main`, затем PR в `main`. Прямые коммиты в `main` — нет.
- **Коммиты** — conventional commits по-русски: `тип(область): что изменилось для человека`.
  Типы: `feat`, `fix`, `docs`, `chore`, `test`, `refactor`, `build`. Область — `store`, `personal`,
  `popup`, `tracker`, `kodik`, `build`… Пример: `fix(kodik): озвучка, которую плеер подставил сам, не записывается как выбор`.
- **Тело коммита и PR** — причина и как проверено, а не пересказ диффа. Регрессия — с датой и симптомом.
- **Коммит перечислением путей:** `git add <пути> && git commit` одной командой, не `git add -A`;
  перед коммитом — `git status --short`. Индекс не держать между командами.
- **Перед коммитом** — `npm test` зелёный. Правка общего кода — ещё и `node scripts/build.mjs`.
- **Не коммитить:** `dist/`, архивы `*.zip`, секреты (их здесь нет и не должно быть).
- **Автор** — `Sasha <sasanikitin@users.noreply.github.com>` (адрес noreply, личная почта в истории не светится).
- **Слияние PR** — merge-коммит `Merge #N: <суть>`; ветку после слияния удалять.
- **Историю `main` не переписывать** (`push --force` — нет).

## Выпуск

1. Поднять `version` в `manifest.store.json` (магазин) и/или `manifest.json` (личная).
2. `npm test` → `node scripts/build.mjs` → `python scripts/pack.py`.
3. PR `build: версия X.Y.Z — <что нового>` → слияние → тег `store-vX.Y.Z` / `personal-vX.Y.Z`.
4. Магазин: архив загружает владелец в кабинете разработчика (Chrome не даёт расширениям
   управлять магазином). Тексты карточки — `store/LISTING.md`, политика — `store/PRIVACY.md`.
