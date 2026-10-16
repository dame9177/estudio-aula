// Opt-in check with the machine's real webcam and microphone (ESTUDIO_REAL_DEVICES=1).
// Asserts numerically (no images kept) that the bubble is not black and no frames were dropped.
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const ffmpegPath = require('ffmpeg-static');
const ffprobe = require('ffprobe-static');

const ROOT = path.join(__dirname, '..', '..');
test.skip(!process.env.ESTUDIO_REAL_DEVICES, 'set ESTUDIO_REAL_DEVICES=1 to run with real hardware');

test('real webcam + mic: bubble has an image, takes keep 30 fps', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-real-'));
  const app = await electron.launch({
    args: [ROOT],
    env: { ...process.env, ESTUDIO_DATA_DIR: path.join(tmp, 'v'), ESTUDIO_USER_DATA: path.join(tmp, 'u'), ESTUDIO_HIDDEN: '1' },
  });
  const page = await app.firstWindow();
  const pdf = process.env.ESTUDIO_TEST_PDF || path.join(ROOT, 'tests', 'fixtures', 'Como gravar uma videoaula.pdf');
  await page.evaluate((p) => window.__estudio.openLesson(p), pdf);
  await expect(page.locator('.card .head').first()).toHaveClass(/ok/, { timeout: 20_000 });
  const devices = await page.evaluate(() => ({
    cam: window.__estudio.media.cam?.getVideoTracks()[0]?.label,
    camSettings: window.__estudio.media.cam?.getVideoTracks()[0]?.getSettings(),
    mic: window.__estudio.media.mic?.getAudioTracks()[0]?.label,
  }));
  console.log('devices', JSON.stringify(devices));
  expect(devices.cam).not.toMatch(/\bIR\b/);
  await page.getByTestId('go-studio').click();
  const cont = page.getByRole('button', { name: 'Continuar', exact: true });
  if (await cont.isVisible().catch(() => false)) await cont.click();
  await page.evaluate(() => (window.__ESTUDIO_FAST = true));
  await page.getByTestId('record').click();
  await page.waitForTimeout(4000);
  await page.getByTestId('next').click();
  await page.waitForTimeout(4000);
  await page.getByTestId('record').click();
  await expect(page.getByTestId('progress')).toHaveText(/2 de/, { timeout: 10_000 });
  const dir = await page.evaluate(() => window.__estudio.lesson.dir);
  const project = await page.evaluate(() => window.__estudio.lesson.project);
  await app.close();

  for (const k of ['0', '1']) {
    const file = path.join(dir, project.takes[k].file);
    const frames = execFileSync(ffprobe.path, ['-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file]).toString().trim();
    const fps = Number(frames) / (project.takes[k].durationMs / 1000);
    console.log(`take ${k}: ${frames} frames, ${fps.toFixed(1)} fps, ${(fs.statSync(file).size / 1e6).toFixed(2)} MB`);
    expect(fps).toBeGreaterThan(26);
  }
  // Mean luma inside the bubble (bottom-right corner) and mean loudness of the take.
  const file = path.join(dir, project.takes['0'].file);
  const luma = spawnSync(ffmpegPath, ['-hide_banner', '-ss', '2', '-i', file, '-frames:v', '1', '-vf', 'crop=140:140:1680:850,signalstats,metadata=print', '-f', 'null', '-']);
  const yavg = Number(/lavfi\.signalstats\.YAVG=([\d.]+)/.exec(luma.stderr.toString())?.[1]);
  const vol = spawnSync(ffmpegPath, ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
  console.log(`bubble luma avg ${yavg}, audio mean ${/mean_volume: (-?[\d.]+) dB/.exec(vol.stderr.toString())?.[1]} dB`);
  expect(yavg).toBeGreaterThan(20);
});
