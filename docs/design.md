# Estúdio de Aula — design

## Problem

Recording a classic video lesson (slides full screen, narration, the teacher's face in a corner)
on Linux desktop is harder than it should be: OBS needs setup, screen capture on Wayland goes
through the portal (black screens, picking the wrong window), webcams with an extra infrared
sensor get picked by mistake, and one mistake late in a 30-minute take means starting over.
The target user is non-technical.

## Decisions

- **Input is a PDF**, not PPTX: every slide tool exports PDF, and pdf.js renders it faithfully.
- **No screen capture.** The app composes each frame itself in a 1920×1080 `<canvas>` (slide +
  round camera bubble + pen strokes + laser) and records that canvas plus the microphone with
  `MediaRecorder`. The preview is the video: WYSIWYG, and nothing depends on Wayland portals.
- **Slide-by-slide takes.** Each slide is a separate WebM. While recording, "next" stops the
  current recorder and starts a new one in the same tick, so it feels like one continuous take.
  Re-recording replaces one slide only. If the next slide already has a take, recording stops
  instead of overwriting it.
- **Crash safety.** Chunks are streamed to `takes/*.webm.part` every second and promoted with a
  rename when the take ends. The previous take of a slide is deleted only after the new one is
  committed. Stale `.part` files are dropped when the lesson is reopened.
- **Export** with ffmpeg: every segment is trimmed/padded to its recorded duration on both
  streams (so audio never drifts across segments), concatenated, `loudnorm`-ed, and encoded to
  H.264/AAC 1080p30 with `+faststart`. Written to `.partial.mp4`, then renamed.
- **Devices.** IR cameras are filtered by label; the saved device is matched by id, then label.
  Mic constraints: noise suppression and AGC on, echo cancellation off. A device check screen
  (live preview, level meter, 5-second test recording) runs before every session, and in-recording
  banners warn about digital silence (muted mic) or a disconnected camera.
- **Stack.** Electron (bundled Chromium gives camera, mic, PDF and recording), vanilla ES modules
  without a bundler, `ffmpeg-static`. The compositor runs on `setInterval` with
  `backgroundThrottling: false` so recording does not stall when the window is covered.
- **Look.** Anthropic-like palette (cream, clay, sage), Source Serif 4 + Inter bundled offline,
  calm pt-BR microcopy.

## Screens

Home (open PDF / drag & drop / recent lessons) → Device check → Studio (slide strip, stage,
record/next, laser, pen, camera menu) → Export (summary, missing slides, progress, open result).

## Data

`~/Vídeos/Estúdio de Aula/<lesson>/` holds `aula.pdf` (copy), `project.json` (takes, slides with
the camera hidden), `takes/slide-NN-<stamp>.webm` and `<lesson>.mp4`. User preferences (devices,
bubble corner/size/mirror, pen color) live in Electron's `userData/prefs.json`.

## Out of scope (for now)

PPTX input, speaker notes/teleprompter, trimming inside a take, packaging (AppImage/Flatpak).
