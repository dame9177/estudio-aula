// Studio: slide strip, live stage (exactly the video), record/next controls, laser and pen.
import { h, icon, modal, toast } from '../ui.js';
import { Compositor, PEN_COLORS } from '../lib/compositor.js';
import { TakeRecorder } from '../lib/recorder.js';
import { createMeter } from '../lib/meter.js';
import { silentAudioTrack } from '../lib/devices.js';
import { formatDuration } from '../lib/geometry.js';

const SILENCE_PEAK = 0.0015; // digital silence: muted or unplugged mic
const SILENCE_WARN_MS = 8000;

export async function mount(root, ctx, params = {}) {
  const { api, lesson } = ctx;
  const { pdf, dir } = lesson;
  const n = pdf.pageCount;
  let project = lesson.project;
  let index = Math.min(params.index ?? firstUnrecorded(project, n), n - 1);
  let take = null; // current recording
  let busy = false; // countdown or save in progress
  let destroyed = false;
  let silentMs = 0;
  let lastTick = performance.now();
  const banners = new Map();

  // ---------- media ----------
  const camVideo = document.createElement('video');
  camVideo.muted = true;
  camVideo.playsInline = true;
  if (ctx.media.cam?.active) {
    camVideo.srcObject = ctx.media.cam;
    camVideo.play().catch(() => {});
    ctx.media.cam.getVideoTracks()[0].addEventListener('ended', onCameraLost);
  }
  const micTrack = ctx.media.mic?.getAudioTracks()[0];
  micTrack?.addEventListener('ended', onMicLost);
  const meter = ctx.media.mic ? createMeter(ctx.media.mic) : null;

  // ---------- stage ----------
  const canvas = h('canvas', { 'data-testid': 'stage' });
  const comp = new Compositor(canvas);
  comp.bubble = { ...ctx.prefs.bubble };
  comp.penColor = ctx.prefs.penColor || 'clay';
  comp.setCamera(ctx.media.cam ? camVideo : null);
  comp.onBubbleMoved = (bubble) => ctx.savePrefs({ bubble });
  const recorder = new TakeRecorder(canvas, micTrack || silentAudioTrack());

  const recLabel = h('span');
  const recPill = h('div', { class: 'rec-pill' }, h('span', { class: 'dot' }), recLabel);
  const countdownNum = h('span');
  const countdown = h('div', { class: 'countdown' }, countdownNum);
  const bannerBox = h('div', { class: 'banners' });
  const stageBox = h('div', { class: 'stage-box' }, canvas, recPill, countdown, bannerBox);

  // ---------- strip ----------
  const thumbs = Array.from({ length: n }, (_, i) => {
    const img = h('img', { alt: '' });
    const status = h('span');
    const btn = h(
      'button',
      { class: 'thumb', 'data-testid': `thumb-${i + 1}`, onclick: () => !take && !busy && showSlide(i) },
      h('span', { class: 'img' }, img),
      h('span', { class: 'meta' }, h('span', { class: 'n' }, String(i + 1)), status),
    );
    return { btn, img, status };
  });
  const strip = h('nav', { class: 'strip' }, thumbs.map((t) => t.btn));

  // ---------- controls ----------
  const prevBtn = h('button', { class: 'btn nav-btn', title: 'Slide anterior (←)', onclick: () => prev() }, icon('left'));
  const nextBtn = h('button', { class: 'btn nav-btn', 'data-testid': 'next', title: 'Próximo slide (Espaço ou →)', onclick: () => next() }, icon('right'));
  const recBtnLabel = h('span');
  const recBtn = h('button', { class: 'rec-btn', 'data-testid': 'record', onclick: () => toggleRecord() }, h('span', { class: 'dot' }), recBtnLabel);

  const laserBtn = h('button', { class: 'btn', title: 'Ponteiro laser (L)', onclick: () => setTool(comp.tool === 'laser' ? 'none' : 'laser') }, icon('laser'), 'Laser');
  const penBtn = h('button', { class: 'btn', title: 'Caneta (P)', onclick: () => setTool(comp.tool === 'pen' ? 'none' : 'pen') }, icon('pen'), 'Caneta');
  const swatches = Object.entries(PEN_COLORS).map(([key, color]) =>
    h('button', {
      class: 'swatch',
      title: { clay: 'Laranja', ink: 'Preto', blue: 'Azul' }[key],
      style: { background: color },
      'data-color': key,
      onclick: () => {
        comp.penColor = key;
        ctx.savePrefs({ penColor: key });
        render();
      },
    }),
  );
  const clearBtn = h('button', { class: 'btn', title: 'Apagar os riscos', onclick: () => comp.clearStrokes() }, icon('eraser'));
  const penExtras = h('span', { class: 'row', style: { gap: '6px', padding: '0 4px' } }, swatches, clearBtn);

  const camBtn = h('button', { class: 'btn', title: 'Câmera', onclick: () => togglePopover() }, icon('camera'), 'Câmera');
  const camShow = h('input', { type: 'checkbox', class: 'switch', onchange: () => setCameraHidden(!camShow.checked) });
  const camMirror = h('input', {
    type: 'checkbox',
    class: 'switch',
    onchange: () => {
      comp.bubble = { ...comp.bubble, mirror: camMirror.checked };
      ctx.savePrefs({ bubble: comp.bubble });
    },
  });
  const sizeSeg = h(
    'div',
    { class: 'seg' },
    ['p', 'm', 'g'].map((s) =>
      h(
        'button',
        {
          'data-size': s,
          onclick: () => {
            comp.bubble = { ...comp.bubble, size: s };
            ctx.savePrefs({ bubble: comp.bubble });
            render();
          },
        },
        s.toUpperCase(),
      ),
    ),
  );
  const devicesBtn = h('button', { class: 'btn', onclick: () => !take && ctx.go('check') }, icon('settings'), 'Trocar câmera ou microfone');
  const popover = h(
    'div',
    { class: 'popover', style: { display: 'none', left: '0' } },
    h('div', { class: 'r' }, h('span', {}, 'Mostrar neste slide'), camShow),
    h('div', { class: 'r' }, h('span', {}, 'Tamanho'), sizeSeg),
    h('div', { class: 'r' }, h('span', {}, 'Espelhar imagem'), camMirror),
    h('p', { class: 'muted', style: { fontSize: '12.5px' } }, 'Dica: arraste a bolinha para outro canto.'),
    devicesBtn,
  );
  const camGroup = h('span', { class: 'rel' }, camBtn, popover);

  const takeInfo = h('span', { class: 'muted', style: { fontSize: '13.5px' } });
  const watchBtn = h('button', { class: 'btn', 'data-testid': 'watch', onclick: () => watchTake() }, icon('play'), 'Assistir');
  const hint = h(
    'div',
    { class: 'hintline' },
    h('span', {}, h('kbd', {}, 'Espaço'), ' próximo'),
    h('span', {}, h('kbd', {}, 'R'), ' gravar/parar'),
    h('span', {}, h('kbd', {}, 'L'), ' laser'),
    h('span', {}, h('kbd', {}, 'P'), ' caneta'),
  );

  // ---------- top bar ----------
  const progressPill = h('span', { class: 'pill', 'data-testid': 'progress' });
  const exportBtn = h('button', { class: 'btn primary', 'data-testid': 'go-export', onclick: () => !take && !busy && ctx.go('export') }, icon('film'), 'Gerar vídeo');
  const homeBtn = h('button', { class: 'btn ghost', onclick: () => !take && !busy && ctx.goHome() }, icon('back'), 'Início');

  root.append(
    h(
      'div',
      { class: 'studio' },
      h('div', { class: 'topbar' }, homeBtn, h('div', { class: 'title' }, project.title), h('div', { class: 'spacer' }), progressPill, exportBtn),
      h('div', { class: 'main' }, strip, h('div', { class: 'stage-wrap' }, stageBox)),
      h(
        'div',
        { class: 'controls' },
        h('div', { class: 'left' }, h('div', { class: 'tool-group' }, laserBtn, penBtn, penExtras, camGroup)),
        h('div', { class: 'center' }, prevBtn, recBtn, nextBtn),
        h('div', { class: 'right' }, h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' } }, h('div', { class: 'row' }, takeInfo, watchBtn), hint)),
      ),
    ),
  );

  // ---------- behavior ----------
  function setTool(tool) {
    comp.tool = tool;
    render();
  }

  function togglePopover(force) {
    const show = force ?? popover.style.display === 'none';
    popover.style.display = show ? '' : 'none';
    camBtn.classList.toggle('on', show);
  }

  async function setCameraHidden(hidden) {
    comp.cameraVisible = !hidden;
    project = await api.setCameraHidden(dir, index, hidden);
    lesson.project = project;
  }

  async function showSlide(i) {
    if (i < 0 || i >= n) return;
    index = i;
    render();
    const bitmap = await pdf.slide(i);
    if (destroyed || index !== i) return;
    comp.setSlide(bitmap);
    comp.cameraVisible = !project.cameraHidden.includes(i);
    comp.draw();
    if (i + 1 < n) pdf.slide(i + 1); // pre-render so "next" is instant while recording
    thumbs[i].btn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  async function toggleRecord() {
    if (busy) return;
    if (take) return stopRecording();
    if (project.takes[index]) {
      const ok = await modal({
        title: `Regravar o slide ${index + 1}?`,
        body: 'A gravação anterior deste slide será substituída quando você terminar a nova.',
        actions: [
          { label: 'Cancelar', value: false },
          { label: 'Regravar', value: true, kind: 'clay' },
        ],
      });
      if (!ok) return;
    }
    await startRecording();
  }

  async function startRecording() {
    busy = true;
    togglePopover(false);
    render();
    countdown.classList.add('show');
    for (const s of [3, 2, 1]) {
      countdownNum.textContent = String(s);
      countdownNum.style.animation = 'none';
      void countdownNum.offsetWidth; // restart the pop animation
      countdownNum.style.animation = '';
      await sleep(window.__ESTUDIO_FAST ? 30 : 900);
      if (destroyed) return;
    }
    countdown.classList.remove('show');
    comp.clearStrokes();
    silentMs = 0;
    take = recorder.start(dir, index);
    busy = false;
    render();
  }

  async function stopRecording() {
    const finished = take;
    take = null;
    busy = true;
    render();
    await saveTake(finished);
    busy = false;
    render();
  }

  async function saveTake(t) {
    try {
      const updated = await recorder.stop(t);
      if (updated) {
        project = updated;
        lesson.project = project;
      } else {
        toast('Gravação muito curta, não salvei.');
      }
    } catch (err) {
      console.error(err);
      await modal({ title: 'Não consegui salvar a gravação', body: `Tente gravar este slide de novo. (${err.message || err})` });
    }
    render();
  }

  async function next() {
    if (busy) return;
    if (!take) return showSlide(Math.min(index + 1, n - 1));
    if (index === n - 1) {
      await stopRecording();
      const go = await modal({
        title: 'Último slide gravado! 🎉',
        body: 'Quer gerar o vídeo agora? Você ainda pode regravar qualquer slide depois.',
        actions: [
          { label: 'Ficar aqui', value: false },
          { label: 'Gerar vídeo', value: true, kind: 'primary' },
        ],
      });
      if (go) ctx.go('export');
      return;
    }
    const target = index + 1;
    if (project.takes[target]) {
      await stopRecording();
      await showSlide(target);
      toast(`O slide ${target + 1} já estava gravado, então parei a gravação para não apagar nada. Aperte Gravar se quiser regravá-lo.`, 6000);
      return;
    }
    // Seamless switch: stop this take and start the next one in the same tick.
    busy = true;
    const bitmap = await pdf.slide(target);
    const finished = take;
    index = target;
    comp.setSlide(bitmap);
    comp.cameraVisible = !project.cameraHidden.includes(target);
    comp.draw();
    take = recorder.start(dir, target);
    busy = false;
    render();
    thumbs[target].btn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (target + 1 < n) pdf.slide(target + 1);
    await saveTake(finished);
  }

  function prev() {
    if (take || busy) return;
    showSlide(Math.max(index - 1, 0));
  }

  async function watchTake() {
    const t = project.takes[index];
    if (!t || take) return;
    const url = await api.takeUrl(dir, t.file);
    const video = h('video', { src: url, controls: true, autoplay: true });
    const choice = await modal({
      title: `Slide ${index + 1} · ${formatDuration(t.durationMs)}`,
      body: video,
      wide: true,
      actions: [
        { label: 'Apagar esta gravação', value: 'delete', kind: 'ghost danger' },
        { label: 'Regravar', value: 'redo' },
        { label: 'Fechar', value: null, kind: 'primary' },
      ],
    });
    video.pause();
    video.removeAttribute('src');
    if (choice === 'redo') await startRecording();
    if (choice === 'delete') {
      const sure = await modal({
        title: `Apagar a gravação do slide ${index + 1}?`,
        body: 'Isso não pode ser desfeito.',
        actions: [
          { label: 'Cancelar', value: false },
          { label: 'Apagar', value: true, kind: 'clay' },
        ],
      });
      if (sure) {
        project = await api.deleteTake(dir, index);
        lesson.project = project;
        render();
      }
    }
  }

  // ---------- warnings ----------
  function banner(key, text, kind = '') {
    if (!text) {
      banners.get(key)?.remove();
      banners.delete(key);
      return;
    }
    if (banners.has(key)) return;
    const el = h('div', { class: `banner ${kind}` }, icon('alert'), h('span', {}, text));
    banners.set(key, el);
    bannerBox.append(el);
  }

  function onCameraLost() {
    if (destroyed) return;
    comp.setCamera(null);
    banner('cam', 'A câmera desconectou. A gravação continua só com os slides. Para religar, pare e use “Câmera → Trocar câmera ou microfone”.', 'err');
  }

  function onMicLost() {
    if (destroyed) return;
    banner('micgone', 'O microfone desconectou! Pare a gravação e use “Câmera → Trocar câmera ou microfone”.', 'err');
  }

  function tick() {
    const now = performance.now();
    const dt = now - lastTick;
    lastTick = now;
    if (take) {
      recLabel.textContent = `Gravando slide ${index + 1} · ${formatDuration(recorder.elapsed(take))}`;
      if (meter) {
        silentMs = meter.peak() < SILENCE_PEAK ? silentMs + dt : 0;
        banner('silence', silentMs > SILENCE_WARN_MS ? 'Não estou ouvindo você. O microfone está mudo?' : null);
      }
    } else {
      banner('silence', null);
    }
  }
  const tickTimer = setInterval(tick, 200);

  // ---------- rendering ----------
  function render() {
    const recording = Boolean(take);
    stageBox.classList.toggle('recording', recording);
    recBtn.classList.toggle('stop', recording);
    recBtn.disabled = busy && !recording;
    recBtnLabel.textContent = recording ? 'Parar' : project.takes[index] ? `Regravar slide ${index + 1}` : `Gravar slide ${index + 1}`;
    prevBtn.disabled = recording || busy || index === 0;
    nextBtn.disabled = busy || (!recording && index === n - 1);
    nextBtn.title = recording ? 'Encerrar este slide e gravar o próximo (Espaço)' : 'Próximo slide (Espaço ou →)';
    exportBtn.disabled = recording || busy;
    homeBtn.disabled = recording || busy;
    devicesBtn.disabled = recording;

    laserBtn.classList.toggle('on', comp.tool === 'laser');
    penBtn.classList.toggle('on', comp.tool === 'pen');
    penExtras.style.display = comp.tool === 'pen' ? '' : 'none';
    swatches.forEach((s) => s.classList.toggle('on', s.dataset.color === comp.penColor));
    camShow.checked = !project.cameraHidden.includes(index);
    camShow.disabled = !ctx.media.cam;
    camMirror.checked = comp.bubble.mirror;
    sizeSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.size === comp.bubble.size));

    const recorded = Object.keys(project.takes).length;
    progressPill.textContent = `${recorded} de ${n} gravados`;
    const t = project.takes[index];
    takeInfo.textContent = recording ? '' : t ? `Slide ${index + 1} gravado · ${formatDuration(t.durationMs)}` : `Slide ${index + 1} ainda não gravado`;
    watchBtn.style.display = t && !recording ? '' : 'none';

    thumbs.forEach((th, i) => {
      th.btn.classList.toggle('current', i === index);
      th.btn.disabled = recording || busy;
      const tk = project.takes[i];
      th.status.replaceChildren(tk ? h('span', { class: 'done' }, icon('check'), formatDuration(tk.durationMs)) : '');
    });
  }

  function onKey(e) {
    if (document.querySelector('.modal-back') || e.target.closest?.('select, input, textarea')) return;
    const k = e.key;
    if (k === ' ' || k === 'ArrowRight' || k === 'PageDown') {
      e.preventDefault();
      next();
    } else if (k === 'ArrowLeft' || k === 'PageUp') {
      e.preventDefault();
      prev();
    } else if (k === 'r' || k === 'R') {
      toggleRecord();
    } else if (k === 'Escape') {
      if (take) stopRecording();
      else if (comp.tool !== 'none') setTool('none');
      togglePopover(false);
    } else if (k === 'l' || k === 'L') {
      setTool(comp.tool === 'laser' ? 'none' : 'laser');
    } else if (k === 'p' || k === 'P') {
      setTool(comp.tool === 'pen' ? 'none' : 'pen');
    } else if ((k === 'c' || k === 'C') && ctx.media.cam) {
      setCameraHidden(comp.cameraVisible).then(render);
    }
  }
  document.addEventListener('keydown', onKey);
  const closePopover = (e) => {
    if (!camGroup.contains(e.target)) togglePopover(false);
  };
  document.addEventListener('mousedown', closePopover);

  render();
  await showSlide(index);
  // Fill thumbnails in the background, current one first.
  (async () => {
    const order = [...Array(n).keys()].sort((a, b) => Math.abs(a - index) - Math.abs(b - index));
    for (const i of order) {
      if (destroyed) return;
      thumbs[i].img.src = await pdf.thumb(i);
    }
  })();

  return async () => {
    destroyed = true;
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('mousedown', closePopover);
    clearInterval(tickTimer);
    if (take) await recorder.stop(take).catch(() => {});
    ctx.media.cam?.getVideoTracks()[0]?.removeEventListener('ended', onCameraLost);
    micTrack?.removeEventListener('ended', onMicLost);
    meter?.close();
    comp.destroy();
    camVideo.srcObject = null;
  };
}

function firstUnrecorded(project, n) {
  for (let i = 0; i < n; i++) if (!project.takes[i]) return i;
  return 0;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

