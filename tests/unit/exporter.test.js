import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import exporter from '../../src/main/exporter.js';

describe('ffmpeg arguments', () => {
  it('trims every segment on both streams and concatenates in order', () => {
    const args = exporter.buildFfmpegArgs(
      [{ path: '/t/a.webm', durationMs: 2500 }, { path: '/t/b.webm', durationMs: 1000 }],
      '/t/out.mp4',
    );
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(args.filter((a) => a === '-i')).toHaveLength(2);
    expect(graph).toContain('trim=duration=2.500');
    expect(graph).toContain('atrim=duration=1.000');
    expect(graph).toContain('[v0][a0][v1][a1]concat=n=2:v=1:a=1');
    expect(args.at(-1)).toBe('/t/out.mp4');
    expect(args).toContain('libx264');
  });

  it('refuses an empty export', () => {
    expect(() => exporter.buildFfmpegArgs([], '/t/out.mp4')).toThrow(/Nenhum slide/);
  });

  it('parses progress output', () => {
    expect(exporter.parseProgress('frame=10\nout_time_us=2500000\nprogress=continue\n')).toBe(2.5);
    expect(exporter.parseProgress('frame=10\n')).toBe(null);
  });

  it('collects takes in slide order and reports missing slides', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-'));
    fs.mkdirSync(path.join(dir, 'takes'));
    fs.writeFileSync(path.join(dir, 'takes', 'b.webm'), 'x');
    fs.writeFileSync(path.join(dir, 'takes', 'a.webm'), 'x');
    const project = {
      pageCount: 4,
      takes: { 2: { file: 'takes/b.webm', durationMs: 2 }, 0: { file: 'takes/a.webm', durationMs: 1 }, 3: { file: 'takes/gone.webm', durationMs: 3 } },
    };
    const { inputs, missing } = exporter.collectTakes(dir, project);
    expect(inputs.map((x) => x.index)).toEqual([0, 2]);
    expect(missing).toEqual([1, 3]);
  });
});

describe('real export with ffmpeg', () => {
  it('joins WebM takes (one with short audio) into a 1080p H.264/AAC MP4 of the right length', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-'));
    const make = (name, vSec, aSec, size) => {
      const out = path.join(dir, name);
      execFileSync(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=30:duration=${vSec}`,
        '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${aSec}`,
        '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-b:v', '1M', '-c:a', 'libopus', out,
      ]);
      return out;
    };
    const inputs = [
      { path: make('s1.webm', 2, 2, '1920x1080'), durationMs: 2000 },
      { path: make('s2.webm', 1.5, 0.8, '1280x720'), durationMs: 1500 },
      { path: make('s3.webm', 1, 1, '1920x1080'), durationMs: 1000 },
    ];
    const output = path.join(dir, 'Aula.mp4');
    const seen = [];
    const job = exporter.runExport({ ffmpegPath, inputs, output, onProgress: (p) => seen.push(p) });
    await job.promise;

    expect(fs.existsSync(output)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'Aula.partial.mp4'))).toBe(false);
    const info = JSON.parse(execFileSync(ffprobe.path, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output]).toString());
    const v = info.streams.find((s) => s.codec_type === 'video');
    const a = info.streams.find((s) => s.codec_type === 'audio');
    expect(v).toMatchObject({ codec_name: 'h264', width: 1920, height: 1080, pix_fmt: 'yuv420p' });
    expect(a).toMatchObject({ codec_name: 'aac', sample_rate: '48000' });
    expect(Number(info.format.duration)).toBeGreaterThan(4.3);
    expect(Number(info.format.duration)).toBeLessThan(4.7);
    expect(Math.abs(Number(v.duration) - Number(a.duration))).toBeLessThan(0.1);
    expect(seen.at(-1)).toBe(1);
  }, 60_000);
});
