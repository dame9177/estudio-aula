// Joins the per-slide WebM takes into one MP4 (H.264 + AAC) with ffmpeg.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const W = 1920;
const H = 1080;
const FPS = 30;

/**
 * ffmpeg arguments for joining takes in order.
 * Each segment is cut to its recorded duration on both streams (video padded by freezing the
 * last frame, audio padded with silence), so audio never drifts across segments.
 */
function buildFfmpegArgs(inputs, output) {
  if (!inputs.length) throw new Error('Nenhum slide gravado para exportar.');
  const args = ['-hide_banner', '-y', '-nostats', '-progress', 'pipe:1'];
  for (const input of inputs) args.push('-i', input.path);

  const parts = [];
  const labels = [];
  inputs.forEach((input, i) => {
    const d = (input.durationMs / 1000).toFixed(3);
    parts.push(
      `[${i}:v]fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0xFAF9F5,setsar=1,format=yuv420p,` +
        `tpad=stop_mode=clone:stop_duration=3,trim=duration=${d},setpts=PTS-STARTPTS[v${i}]`,
    );
    parts.push(
      `[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
        `apad,atrim=duration=${d},asetpts=PTS-STARTPTS[a${i}]`,
    );
    labels.push(`[v${i}][a${i}]`);
  });
  parts.push(`${labels.join('')}concat=n=${inputs.length}:v=1:a=1[vcat][acat]`);
  parts.push('[acat]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]');

  args.push(
    '-filter_complex', parts.join(';'),
    '-map', '[vcat]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
    '-movflags', '+faststart',
    '-f', 'mp4',
    output,
  );
  return args;
}

/** Ordered list of recorded takes plus the slides that have none. */
function collectTakes(dir, project) {
  const inputs = [];
  const missing = [];
  for (let i = 0; i < project.pageCount; i++) {
    const take = project.takes[i];
    if (take && fs.existsSync(path.join(dir, take.file))) {
      inputs.push({ index: i, path: path.join(dir, take.file), durationMs: take.durationMs });
    } else {
      missing.push(i);
    }
  }
  return { inputs, missing };
}

function outputPathFor(dir, project) {
  return path.join(dir, `${project.title}.mp4`);
}

/** Parse "out_time_us=…" lines from `-progress pipe:1`. */
function parseProgress(text) {
  let last = null;
  for (const line of text.split('\n')) {
    const m = /^out_time_(?:us|ms)=(\d+)/.exec(line.trim());
    if (m) last = Number(m[1]) / 1e6;
  }
  return last;
}

/**
 * Run the export. Writes to a .partial file and renames on success, so a half-written MP4
 * never sits next to a good one. Returns { promise, cancel }.
 */
function runExport({ ffmpegPath, inputs, output, onProgress }) {
  const partial = output.replace(/\.mp4$/i, '.partial.mp4');
  const totalSec = inputs.reduce((s, x) => s + x.durationMs, 0) / 1000;
  const child = spawn(ffmpegPath, buildFfmpegArgs(inputs, partial), { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderrTail = '';
  let cancelled = false;

  child.stdout.on('data', (buf) => {
    const t = parseProgress(buf.toString());
    if (t != null && totalSec > 0) onProgress?.(Math.min(0.999, t / totalSec));
  });
  child.stderr.on('data', (buf) => {
    stderrTail = (stderrTail + buf.toString()).slice(-4000);
  });

  const promise = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      if (cancelled) {
        fs.rmSync(partial, { force: true });
        reject(new Error('cancelled'));
      } else if (code === 0) {
        fs.renameSync(partial, output);
        onProgress?.(1);
        resolve(output);
      } else {
        fs.rmSync(partial, { force: true });
        reject(new Error(`ffmpeg saiu com código ${code}:\n${stderrTail}`));
      }
    });
  });

  return {
    promise,
    cancel() {
      cancelled = true;
      child.kill('SIGTERM');
    },
  };
}

module.exports = { buildFfmpegArgs, collectTakes, outputPathFor, parseProgress, runExport };
