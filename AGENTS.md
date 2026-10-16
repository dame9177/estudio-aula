# estudio-aula

Estúdio de Aula: grava videoaula a partir de PDF com câmera no canto (Electron, estilo Anthropic)

Created 2026-10-16. Public repo: https://github.com/dame9177/estudio-aula (MIT).
User-facing docs: `README.md` (pt-BR). Design: `docs/design.md`.

## Setup / run / test

```bash
./scripts/install.sh                 # npm install if needed + GNOME menu entry (no sudo); --remover undoes
npm start                            # run from the terminal
npm test                             # vitest: geometry, device picking, project store, ffmpeg export (real ffmpeg)
npm run e2e                          # Playwright + Electron, fake cam (avatar) / fake mic (speech-like tone)
ESTUDIO_REAL_DEVICES=1 npx playwright test real-devices   # real webcam+mic, window hidden
npx electron scripts/make-fixtures.js   # rebuild tests/fixtures PDF (from aula-exemplo.html) + avatar.png
npx electron scripts/make-icon.js       # rebuild packaging/estudio-aula.png from the SVG
```

The e2e window pops up on screen (~20 s). Screenshots and the exported MP4 land in
`test-results/shots/`; README images in `docs/img/` are copied from there (`resultado.gif` is
made from `export.mp4` with ffmpeg palettegen). `ESTUDIO_TEST_PDF` overrides the lesson PDF.
Env overrides: `ESTUDIO_DATA_DIR` (lessons, default `~/Vídeos/Estúdio de Aula`),
`ESTUDIO_USER_DATA` (prefs), `ESTUDIO_HIDDEN=1`.

## Architecture

- `src/main/` (CommonJS): `main.js` window + IPC + media permission handlers (granted only to our
  `file://` renderer) + PDF from argv ("Abrir com…"); `project-store.js` lesson folder, atomic
  writes; `exporter.js` ffmpeg concat → MP4.
- `src/preload.js`: thin `window.api` bridge (contextIsolation, sandbox on).
- `src/renderer/` (ES modules over `file://`, vanilla JS, no bundler): `app.js` router/context;
  `screens/{home,check,studio,export}.js`; `lib/compositor.js` draws into the stage canvas, which
  is what gets recorded; `lib/recorder.js` one `MediaRecorder` per take, chunks streamed to disk;
  `lib/pdf.js` pdf.js at 1920×1080 + thumbnails.
- Pure, unit-tested modules: `geometry.js`, `device-pick.js`, `project-store.js`, `exporter.js`.

## Project rules / gotchas

- Code/comments in English; UI strings and docs in pt-BR. Palette tokens in `styles.css`.
- Never screen-capture; compose in canvas. Compositor uses `setInterval` (not rAF).
- `navigator.mediaDevices` is undefined on `data:` URLs; the renderer must load from `file://`.
- Fake media in tests: a `--use-file-for-fake-video-capture` file silences the default fake mic, so
  pass `--use-file-for-fake-audio-capture` too; pure tones get eaten by noise suppression, hence
  the syllable-gated harmonic signal. Full-scale default beeps trigger the "too loud" hint.
- Sandbox: on Ubuntu 24.04 (`apparmor_restrict_unprivileged_userns=1`) Electron 44's namespace
  sandbox still worked on the dev machine (renderer: own userns, seccomp 2). `scripts/estudio-aula`
  retries with `--no-sandbox` only if startup fails with a sandbox error; log at
  `~/.local/state/estudio-aula/launch.log`.
- `app.setDesktopName('estudio-aula.desktop')` matches the menu entry (icon on Wayland).
- Lesson titles repair UTF-8-as-Latin-1 file names ("IntroduÃ§Ã£o" → "Introdução").
- Do not commit personal lesson PDFs or screenshots of them; docs use the demo deck + avatar.

## Status / next steps

- 2026-10-16: v0.1 released. Unit (25), e2e and real-hardware tests pass (ASUS FHD webcam
  1280×720@30, takes at 29–30 fps). Used to record a real 27-slide lecture.
- Ideas: speaker notes/teleprompter, target-time timer, trim start/end of a take, AppImage/Flatpak,
  English UI.
