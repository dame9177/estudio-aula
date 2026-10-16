import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import store from '../../src/main/project-store.js';

let base;
let pdf;
beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-'));
  pdf = path.join(base, 'src', 'Introdução à Fisiologia: 2º período.pdf');
  fs.mkdirSync(path.dirname(pdf));
  fs.writeFileSync(pdf, '%PDF-1.4 fake one');
});

describe('project store', () => {
  it('creates a lesson folder named after the PDF, with a copy of it', () => {
    const { dir, project } = store.openProject(path.join(base, 'out'), pdf);
    expect(path.basename(dir)).toBe('Introdução à Fisiologia 2º período');
    expect(fs.readFileSync(path.join(dir, 'aula.pdf'), 'utf8')).toBe('%PDF-1.4 fake one');
    expect(project.takes).toEqual({});
  });

  it('resumes the same lesson when the PDF is opened again', () => {
    const out = path.join(base, 'out');
    const { dir } = store.openProject(out, pdf);
    store.setPageCount(dir, 27);
    store.saveTake(dir, 4, new Uint8Array([1, 2, 3]), 12_345);
    const again = store.openProject(out, pdf);
    expect(again.dir).toBe(dir);
    expect(again.pdfChanged).toBe(false);
    expect(again.project.takes[4].durationMs).toBe(12_345);
    expect(again.project.pageCount).toBe(27);
  });

  it('replaces a take and deletes the old file only after saving the new one', () => {
    const { dir } = store.openProject(path.join(base, 'out'), pdf);
    store.setPageCount(dir, 3);
    const p1 = store.saveTake(dir, 1, new Uint8Array([1]), 1000);
    const first = path.join(dir, p1.takes[1].file);
    expect(fs.existsSync(first)).toBe(true);
    // ensure a different timestamp
    const t = Date.now(); while (Date.now() - t < 5);
    const p2 = store.saveTake(dir, 1, new Uint8Array([2, 2]), 2000);
    expect(p2.takes[1].durationMs).toBe(2000);
    expect(fs.existsSync(path.join(dir, p2.takes[1].file))).toBe(true);
    expect(fs.existsSync(first)).toBe(false);
    expect(fs.readdirSync(path.join(dir, 'takes')).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('flags a changed PDF and trims takes beyond the new page count', () => {
    const out = path.join(base, 'out');
    const { dir } = store.openProject(out, pdf);
    store.setPageCount(dir, 5);
    store.saveTake(dir, 0, new Uint8Array([1]), 1000);
    store.saveTake(dir, 4, new Uint8Array([1]), 1000);
    fs.writeFileSync(pdf, '%PDF-1.4 fake two');
    const again = store.openProject(out, pdf);
    expect(again.pdfChanged).toBe(true);
    const p = store.setPageCount(dir, 3);
    expect(Object.keys(p.takes)).toEqual(['0']);
  });

  it('lists recent lessons with progress', () => {
    const out = path.join(base, 'out');
    const { dir } = store.openProject(out, pdf);
    store.setPageCount(dir, 27);
    store.saveTake(dir, 0, new Uint8Array([1]), 1000);
    const recent = store.listRecent(out);
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ title: 'Introdução à Fisiologia 2º período', pageCount: 27, recorded: 1 });
    expect(store.projectDirForPdf(recent[0].pdfPath)).toBe(dir);
    expect(store.projectDirForPdf(pdf)).toBe(null);
  });

  it('remembers slides where the camera is hidden', () => {
    const { dir } = store.openProject(path.join(base, 'out'), pdf);
    store.setCameraHidden(dir, 3, true);
    store.setCameraHidden(dir, 1, true);
    expect(store.setCameraHidden(dir, 3, false).cameraHidden).toEqual([1]);
  });
});

describe('titles', () => {
  it('repairs UTF-8 names that were decoded as Latin-1', () => {
    expect(store.titleFromPdf('/x/IntroduÃ§Ã£o e PrÃ¡tica.pdf')).toBe('Introdução e Prática');
    expect(store.fixMojibake('Introdução')).toBe('Introdução');
    expect(store.fixMojibake('Aula 1')).toBe('Aula 1');
  });
});
