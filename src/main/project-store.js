// One folder per lesson: aula.pdf, project.json, takes/slide-NN-<stamp>.webm, final MP4.
// Everything is written atomically (tmp + rename) so a crash never loses a finished take.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PROJECT_FILE = 'project.json';
const PDF_FILE = 'aula.pdf';

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Undo UTF-8 read as Latin-1 ("IntroduÃ§Ã£o" -> "Introdução"), common in names of files
 * downloaded from some sites.
 */
function fixMojibake(name) {
  if (!/[ÃÂ][\u0080-\u00BF]/.test(name)) return name;
  if ([...name].some((c) => c.charCodeAt(0) > 0xff)) return name;
  const fixed = Buffer.from(name, 'latin1').toString('utf8');
  return fixed.includes('\uFFFD') ? name : fixed;
}

/** Folder-safe lesson title from the PDF file name. */
function titleFromPdf(pdfPath) {
  const base = fixMojibake(path.basename(pdfPath).replace(/\.pdf$/i, ''));
  const clean = base.replace(/[\/\\:*?"<>|\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean || 'Aula';
}

function readProject(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, PROJECT_FILE), 'utf8'));
}

function writeProject(dir, project) {
  project.updatedAt = new Date().toISOString();
  writeAtomic(path.join(dir, PROJECT_FILE), JSON.stringify(project, null, 2));
  return project;
}

function slideTag(index) {
  return `slide-${String(index + 1).padStart(2, '0')}`;
}

/**
 * Open (or create) the lesson folder for a PDF. Re-opening the same file name resumes it.
 * If the PDF content changed, the new PDF replaces the copy and takes are kept
 * (the caller trims takes beyond the new page count via setPageCount).
 */
function openProject(baseDir, pdfPath) {
  const bytes = fs.readFileSync(pdfPath);
  const hash = sha256(bytes);
  const title = titleFromPdf(pdfPath);
  const dir = path.join(baseDir, title);
  fs.mkdirSync(path.join(dir, 'takes'), { recursive: true });

  let project;
  let pdfChanged = false;
  if (fs.existsSync(path.join(dir, PROJECT_FILE))) {
    project = readProject(dir);
    if (project.pdfSha256 !== hash) {
      pdfChanged = Object.keys(project.takes).length > 0;
      writeAtomic(path.join(dir, PDF_FILE), bytes);
      project.pdfSha256 = hash;
    }
    project.sourcePdf = pdfPath;
    removeStaleParts(dir);
  } else {
    writeAtomic(path.join(dir, PDF_FILE), bytes);
    const now = new Date().toISOString();
    project = {
      version: 1,
      title,
      sourcePdf: pdfPath,
      pdfSha256: hash,
      pageCount: 0,
      createdAt: now,
      updatedAt: now,
      takes: {},
      cameraHidden: [],
    };
  }
  writeProject(dir, project);
  return { dir, project, pdfChanged };
}

function setPageCount(dir, pageCount) {
  const project = readProject(dir);
  project.pageCount = pageCount;
  for (const key of Object.keys(project.takes)) {
    if (Number(key) >= pageCount) {
      removeQuiet(path.join(dir, project.takes[key].file));
      delete project.takes[key];
    }
  }
  project.cameraHidden = project.cameraHidden.filter((i) => i < pageCount);
  return writeProject(dir, project);
}

/** Takes interrupted by a crash or a forced quit are left as .part files: drop them. */
function removeStaleParts(dir) {
  const takes = path.join(dir, 'takes');
  for (const f of fs.readdirSync(takes)) {
    if (f.endsWith('.part') || f.endsWith('.tmp')) removeQuiet(path.join(takes, f));
  }
}

function removeQuiet(file) {
  try {
    fs.unlinkSync(file);
  } catch {
    /* already gone */
  }
}

/** Path a take is streamed into while it is being recorded (renamed by commitTake). */
function partialTakePath(dir, index) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17);
  return path.join(dir, 'takes', `${slideTag(index)}-${stamp}.webm.part`);
}

/** Save a finished take from bytes in memory. */
function saveTake(dir, index, data, durationMs) {
  const part = partialTakePath(dir, index);
  fs.writeFileSync(part, Buffer.from(data));
  return commitTake(dir, index, part, durationMs);
}

/** Promote a streamed .part file to the slide's take. The previous take is deleted only after the new one is safe. */
function commitTake(dir, index, partPath, durationMs) {
  const finalPath = partPath.replace(/\.part$/, '');
  fs.renameSync(partPath, finalPath);
  const rel = path.relative(dir, finalPath);

  const project = readProject(dir);
  const old = project.takes[index];
  project.takes[index] = { file: rel, durationMs: Math.round(durationMs), recordedAt: new Date().toISOString() };
  writeProject(dir, project);
  if (old && old.file !== rel) removeQuiet(path.join(dir, old.file));
  return project;
}

function deleteTake(dir, index) {
  const project = readProject(dir);
  const old = project.takes[index];
  if (!old) return project;
  delete project.takes[index];
  writeProject(dir, project);
  removeQuiet(path.join(dir, old.file));
  return project;
}

function setCameraHidden(dir, index, hidden) {
  const project = readProject(dir);
  const set = new Set(project.cameraHidden);
  if (hidden) set.add(index);
  else set.delete(index);
  project.cameraHidden = [...set].sort((a, b) => a - b);
  return writeProject(dir, project);
}

/** Lessons in baseDir, most recently touched first. */
function listRecent(baseDir, limit = 6) {
  if (!fs.existsSync(baseDir)) return [];
  const out = [];
  for (const name of fs.readdirSync(baseDir)) {
    const dir = path.join(baseDir, name);
    try {
      const p = readProject(dir);
      out.push({
        dir,
        title: p.title,
        pageCount: p.pageCount,
        recorded: Object.keys(p.takes).length,
        updatedAt: p.updatedAt,
        pdfPath: path.join(dir, PDF_FILE),
      });
    } catch {
      /* not a lesson folder */
    }
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return out.slice(0, limit);
}

/** Lesson folder that holds this exact PDF copy (used when "Continuar aula" re-opens aula.pdf). */
function projectDirForPdf(pdfPath) {
  const dir = path.dirname(pdfPath);
  if (path.basename(pdfPath) === PDF_FILE && fs.existsSync(path.join(dir, PROJECT_FILE))) return dir;
  return null;
}

/** Re-open an existing lesson folder directly (for its own aula.pdf copy). */
function resumeProject(dir) {
  removeStaleParts(dir);
  return { dir, project: readProject(dir), pdfChanged: false };
}

module.exports = {
  PDF_FILE,
  openProject,
  resumeProject,
  projectDirForPdf,
  readProject,
  setPageCount,
  partialTakePath,
  saveTake,
  commitTake,
  deleteTake,
  setCameraHidden,
  listRecent,
  titleFromPdf,
  fixMojibake,
  slideTag,
};
