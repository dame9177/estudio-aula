// App shell: shared context + screen switching (home -> check -> studio -> export).
import { loadPdf } from './lib/pdf.js';
import { stopStream } from './lib/devices.js';
import { modal, toast, cleanError } from './ui.js';
import * as home from './screens/home.js';
import * as check from './screens/check.js';
import * as studio from './screens/studio.js';
import * as exportScreen from './screens/export.js';

const screens = { home, check, studio, export: exportScreen };
const root = document.getElementById('app');
const api = window.api;

const ctx = {
  api,
  prefs: null,
  lesson: null, // { dir, project, pdf }
  media: { cam: null, mic: null, camVideo: null },
  current: null,
  unmount: null,

  async savePrefs(patch) {
    ctx.prefs = await api.setPrefs(patch);
  },

  async go(name, params = {}) {
    try {
      await ctx.unmount?.();
    } catch (err) {
      console.error(err);
    }
    ctx.unmount = null;
    root.replaceChildren();
    ctx.current = name;
    document.body.dataset.screen = name;
    ctx.unmount = (await screens[name].mount(root, ctx, params)) || null;
  },

  /** Open a PDF (new lesson or resume), then go to the device check. */
  async openLesson(pdfPath) {
    let opened;
    try {
      opened = await api.openProject(pdfPath);
    } catch (err) {
      await modal({ title: 'Não consegui abrir esse arquivo', body: cleanError(err) });
      return;
    }
    let pdf;
    try {
      pdf = await loadPdf(opened.pdfBytes);
    } catch (err) {
      await modal({ title: 'Esse PDF não abriu', body: 'O arquivo parece estar corrompido ou protegido por senha. Tente exportar o PDF de novo pelo PowerPoint/Google Slides.' });
      return;
    }
    ctx.lesson?.pdf?.destroy();
    const project = await api.setPageCount(opened.dir, pdf.pageCount);
    ctx.lesson = { dir: opened.dir, project, pdf };
    if (opened.pdfChanged) {
      await modal({
        title: 'O PDF mudou desde a última vez',
        body: 'Mantive as gravações que você já tinha. Dê uma olhada nos slides gravados para conferir se ainda combinam com o conteúdo novo.',
        actions: [{ label: 'Entendi', value: true, kind: 'primary' }],
      });
    }
    await ctx.go('check');
  },

  closeMedia() {
    stopStream(ctx.media.cam);
    stopStream(ctx.media.mic);
    if (ctx.media.camVideo) ctx.media.camVideo.srcObject = null;
    ctx.media = { cam: null, mic: null, camVideo: null };
  },

  async goHome() {
    ctx.closeMedia();
    ctx.lesson?.pdf?.destroy();
    ctx.lesson = null;
    await ctx.go('home');
  },
};

window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  toast(`Algo deu errado: ${cleanError(e.reason)}`, 6000);
});

// Never let a PDF dropped outside the drop zone replace the app.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

(async () => {
  ctx.prefs = await api.getPrefs();
  window.__estudio = ctx; // handy for debugging and the e2e test
  api.onOpenPdf((pdfPath) => {
    if (ctx.current === 'studio') toast('Volte ao Início para abrir outro PDF.');
    else ctx.openLesson(pdfPath);
  });
  await ctx.go('home');
  const pending = await api.pendingPdf();
  if (pending) await ctx.openLesson(pending);
})();
