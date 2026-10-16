// pdf.js wrapper: full-size slide bitmaps (1920x1080, letterboxed) and small thumbnails, cached.
import * as pdfjs from '../../../node_modules/pdfjs-dist/build/pdf.mjs';
import { OUT_W, OUT_H, fitContain } from './geometry.js';

const PDFJS = new URL('../../../node_modules/pdfjs-dist/', import.meta.url).href;
pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS}build/pdf.worker.mjs`;

const PAPER = '#FFFFFF';

export async function loadPdf(bytes) {
  const doc = await pdfjs.getDocument({
    data: bytes,
    wasmUrl: `${PDFJS}wasm/`,
    cMapUrl: `${PDFJS}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS}standard_fonts/`,
    iccUrl: `${PDFJS}iccs/`,
  }).promise;

  const slides = new Map(); // index -> Promise<ImageBitmap>
  const thumbs = new Map(); // index -> Promise<string> (object URL)

  async function draw(index, W, H) {
    const page = await doc.getPage(index + 1);
    const base = page.getViewport({ scale: 1 });
    const box = fitContain(base.width, base.height, W, H);
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, W, H);
    const viewport = page.getViewport({ scale: box.scale, offsetX: box.x, offsetY: box.y });
    await page.render({ canvasContext: ctx, canvas, viewport }).promise;
    return canvas;
  }

  return {
    pageCount: doc.numPages,

    /** Full-resolution slide for the composition. */
    slide(index) {
      if (!slides.has(index)) {
        const p = draw(index, OUT_W, OUT_H).then((c) => c.transferToImageBitmap());
        p.catch(() => slides.delete(index));
        slides.set(index, p);
      }
      return slides.get(index);
    },

    /** Small PNG thumbnail URL for the slide strip. */
    thumb(index) {
      if (!thumbs.has(index)) {
        const p = draw(index, 320, 180)
          .then((c) => c.convertToBlob({ type: 'image/png' }))
          .then((b) => URL.createObjectURL(b));
        thumbs.set(index, p);
      }
      return thumbs.get(index);
    },

    destroy() {
      for (const p of thumbs.values()) p.then((u) => URL.revokeObjectURL(u)).catch(() => {});
      doc.destroy();
    },
  };
}
