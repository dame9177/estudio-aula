// Full flow on a lesson PDF (the demo deck by default): check devices, record slides 1-3 with seamless switching,
// re-record slide 2, export, and verify the MP4 with ffprobe. Screenshots land in test-results/shots.
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ffprobe = require('ffprobe-static');
const ffmpegPath = require('ffmpeg-static');

const ROOT = path.join(__dirname, '..', '..');
const PDF = process.env.ESTUDIO_TEST_PDF || path.join(ROOT, 'tests', 'fixtures', 'Como gravar uma videoaula.pdf');
const SHOTS = path.join(ROOT, 'test-results', 'shots');

test('record three slides, re-record one, export an MP4', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-e2e-'));
  fs.mkdirSync(SHOTS, { recursive: true });
  // Fake camera shows an illustrated avatar instead of Chromium's green test pattern.
  const camFile = path.join(tmp, 'avatar.y4m');
  execFileSync(ffmpegPath, ['-loglevel', 'error', '-loop', '1', '-i', path.join(ROOT, 'tests', 'fixtures', 'avatar.png'), '-t', '1', '-r', '30', '-pix_fmt', 'yuv420p', camFile]);
  // ...and a voice-level tone instead of full-scale beeps (a video file alone silences the fake mic).
  const micFile = path.join(tmp, 'voice.wav');
  // Speech-like: harmonics with moving pitch, gated into ~4 syllables per second
  // (steady tones are removed by the mic's noise suppression).
  const f0 = '(140+25*sin(2*PI*0.7*t))';
  const voice = `(sin(2*PI*${f0}*t)+0.6*sin(4*PI*${f0}*t)+0.35*sin(6*PI*${f0}*t))*0.22*pow(max(0,sin(2*PI*4*t)),2)*(0.6+0.4*sin(2*PI*0.5*t))`;
  execFileSync(ffmpegPath, ['-loglevel', 'error', '-f', 'lavfi', '-i', `aevalsrc=exprs='${voice}':s=48000:d=6`, micFile]);
  const app = await electron.launch({
    args: [
      ROOT,
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-video-capture=${camFile}`,
      `--use-file-for-fake-audio-capture=${micFile}`,
    ],
    env: {
      ...process.env,
      ESTUDIO_DATA_DIR: path.join(tmp, 'videos'),
      ESTUDIO_USER_DATA: path.join(tmp, 'userdata'),
    },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

  // Home
  await expect(page.getByTestId('open-pdf')).toBeVisible();
  await shot('1-home');

  // Open the lesson (the file dialog can't be automated; call the same entry point)
  await page.evaluate((p) => window.__estudio.openLesson(p), PDF);
  await expect(page.getByText('Antes de gravar, um teste rápido')).toBeVisible();
  await expect(page.locator('.card .head.ok')).toHaveCount(2, { timeout: 15_000 }); // camera ✓ + voice heard ✓
  // Docs cosmetics: the fake devices are labelled with a temp path.
  await page.evaluate(() => {
    document.querySelector('[data-testid=camera-select] option').textContent = 'Webcam HD';
    document.querySelector('[data-testid=mic-select] option').textContent = 'Microfone embutido';
  });
  await shot('2-check');
  await page.getByTestId('go-studio').click();

  // Studio
  await expect(page.getByTestId('record')).toHaveText(/Gravar slide 1/);
  await page.evaluate(() => (window.__ESTUDIO_FAST = true));
  await page.waitForTimeout(1500); // thumbnails
  await shot('3-studio');

  // Tools: drag the bubble to the top-left corner and back, then pen + laser on slide 3
  const stage = page.getByTestId('stage');
  const box = await stage.boundingBox();
  const k = box.width / 1920; // output px -> screen px
  const at = (x, y) => [box.x + x * k, box.y + y * k];
  expect(await page.evaluate(() => window.__estudio.prefs.bubble.corner)).toBe('br');
  await page.mouse.move(...at(1720, 880));
  await page.mouse.down();
  await page.mouse.move(...at(300, 250), { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__estudio.prefs.bubble.corner)).toBe('tl');
  await page.mouse.move(...at(190, 190));
  await page.mouse.down();
  await page.mouse.move(...at(1700, 900), { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__estudio.prefs.bubble.corner)).toBe('br');

  await page.getByTestId('thumb-3').click();
  await page.waitForTimeout(400);
  await page.keyboard.press('p');
  await page.mouse.move(...at(150, 492));
  await page.mouse.down();
  await page.mouse.move(...at(770, 498), { steps: 14 });
  await page.mouse.up();
  await page.keyboard.press('l');
  await page.mouse.move(...at(1395, 450), { steps: 4 });
  await page.waitForTimeout(150);
  await shot('3b-tools');
  await page.getByRole('button', { name: 'Câmera' }).click();
  await shot('3c-camera-menu');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.getByTestId('thumb-1').click();
  await expect(page.getByTestId('record')).toHaveText(/Gravar slide 1/);

  await page.getByTestId('record').click();
  await expect(page.getByTestId('record')).toHaveText('Parar');
  await page.waitForTimeout(2200);
  await shot('4-recording');
  await page.getByTestId('next').click(); // slide 2, seamless
  await page.waitForTimeout(1800);
  await page.keyboard.press('Space'); // slide 3, seamless
  await page.waitForTimeout(1500);
  await page.getByTestId('record').click(); // stop
  const pages = await page.evaluate(() => window.__estudio.lesson.pdf.pageCount);
  await expect(page.getByTestId('progress')).toHaveText(`3 de ${pages} gravados`, { timeout: 10_000 });

  // Re-record slide 2
  await page.getByTestId('thumb-2').click();
  await expect(page.getByTestId('record')).toHaveText(/Regravar slide 2/);
  await page.getByTestId('record').click();
  await page.getByRole('button', { name: 'Regravar', exact: true }).click();
  await expect(page.getByTestId('record')).toHaveText('Parar');
  await page.waitForTimeout(2500);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('record')).toHaveText(/Regravar slide 2/, { timeout: 10_000 });

  await page.getByTestId('watch').click();
  await expect(page.locator('.modal video')).toBeVisible();
  await page.waitForTimeout(800);
  await shot('4b-watch');
  await page.getByRole('button', { name: 'Fechar' }).click();

  const project = await page.evaluate(() => window.__estudio.lesson.project);
  expect(Object.keys(project.takes).sort()).toEqual(['0', '1', '2']);
  const takeFiles = fs.readdirSync(path.join(project && (await page.evaluate(() => window.__estudio.lesson.dir)), 'takes'));
  expect(takeFiles.filter((f) => f.startsWith('slide-02'))).toHaveLength(1); // old take removed
  expect(takeFiles.some((f) => f.endsWith('.part'))).toBe(false);
  expect(project.takes[1].durationMs).toBeGreaterThan(2000);

  // Export
  await page.getByTestId('go-export').click();
  await expect(page.getByTestId('export-start')).toBeVisible();
  await shot('5-export');
  await page.getByTestId('export-start').click();
  await page.getByRole('button', { name: 'Gerar sem eles' }).click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 120_000 });
  await shot('6-done');
  const output = await page.getByTestId('export-done').locator('code').textContent();

  const info = JSON.parse(execFileSync(ffprobe.path, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output]).toString());
  const v = info.streams.find((s) => s.codec_type === 'video');
  const a = info.streams.find((s) => s.codec_type === 'audio');
  expect(v).toMatchObject({ codec_name: 'h264', width: 1920, height: 1080 });
  expect(a).toMatchObject({ codec_name: 'aac' });
  const expected = (project.takes[0].durationMs + project.takes[1].durationMs + project.takes[2].durationMs) / 1000;
  expect(Math.abs(Number(info.format.duration) - expected)).toBeLessThan(0.3);
  fs.copyFileSync(output, path.join(SHOTS, 'export.mp4'));

  expect(errors).toEqual([]);
  await app.close();
});
