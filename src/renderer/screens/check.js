// Device check: live camera preview + microphone level, before every recording session.
import { h, icon, modal } from '../ui.js';
import { listDevices, openCamera, openMic, choose, describe, stopStream } from '../lib/devices.js';
import { humanMediaError } from '../lib/device-pick.js';
import { createMeter } from '../lib/meter.js';

const BARS = 28;
const VOICE_PEAK = 0.04; // ~ -28 dBFS: someone talking near the laptop
const HEARD_MS = 500;

export async function mount(root, ctx) {
  const { api, lesson } = ctx;
  let meter = null;
  let raf = 0;
  let heardMs = 0;
  let lastTick = performance.now();
  let sinceMic = 0;
  let clipCount = 0;
  let destroyed = false;
  let testing = false;

  // ---------- camera card ----------
  const camVideo = h('video', { autoplay: true, muted: true, playsinline: true, class: ctx.prefs.bubble.mirror ? 'mirror' : '' });
  const camPlaceholder = h('div', { class: 'placeholder' }, 'Ligando a câmera…');
  const camSelect = h('select', { 'data-testid': 'camera-select' });
  const camStatus = h('div', { class: 'status' });
  const camHead = h('div', { class: 'head' }, h('span', { class: 'num' }, '1'), h('h3', {}, 'Sua câmera'));
  const camRetry = h('button', { class: 'btn', onclick: () => startCamera(camSelect.value || null) }, icon('redo'), 'Tentar de novo');

  // ---------- mic card ----------
  const bars = Array.from({ length: BARS }, () => h('i'));
  const meterEl = h('div', { class: 'meter', 'data-testid': 'mic-meter' }, bars);
  const micSelect = h('select', { 'data-testid': 'mic-select' });
  const micStatus = h('div', { class: 'status' });
  const micHead = h('div', { class: 'head' }, h('span', { class: 'num' }, '2'), h('h3', {}, 'Seu microfone'));
  const micRetry = h('button', { class: 'btn', onclick: () => startMic(micSelect.value || null) }, icon('redo'), 'Tentar de novo');
  const playback = h('audio', { controls: true, style: { width: '100%', display: 'none' } });
  const testBtn = h('button', { class: 'btn', 'data-testid': 'mic-test', onclick: () => testRecording() }, icon('mic'), 'Gravar 5 segundos e ouvir');

  const goBtn = h('button', { class: 'btn primary big', 'data-testid': 'go-studio', onclick: () => proceed() }, 'Tudo certo, ir para o estúdio', icon('right'));
  const noCamBtn = h('button', { class: 'linklike', style: { display: 'none' }, onclick: () => proceed(true) }, 'Gravar sem câmera');

  function setStatus(el, kind, text) {
    el.className = `status ${kind}`;
    el.replaceChildren(icon(kind === 'ok' ? 'check' : kind === 'info' ? 'info' : 'alert'), h('span', {}, text));
  }

  async function fillSelects() {
    const { cameras, mics } = await listDevices();
    const fill = (sel, list, current, none) => {
      sel.replaceChildren(
        ...(list.length ? list.map((d, i) => h('option', { value: d.deviceId }, d.label || `${none} ${i + 1}`)) : [h('option', { value: '' }, none === 'Câmera' ? 'Nenhuma câmera encontrada' : 'Nenhum microfone encontrado')]),
      );
      if (current) sel.value = current;
      sel.disabled = list.length < 2;
    };
    fill(camSelect, cameras, describe(ctx.media.cam?.getVideoTracks()[0])?.id, 'Câmera');
    fill(micSelect, mics, describe(ctx.media.mic?.getAudioTracks()[0])?.id, 'Microfone');
    return { cameras, mics };
  }

  async function startCamera(deviceId) {
    stopStream(ctx.media.cam);
    ctx.media.cam = null;
    camPlaceholder.style.display = '';
    camPlaceholder.textContent = 'Ligando a câmera…';
    camHead.classList.remove('ok');
    setStatus(camStatus, 'info', 'Ligando a câmera…');
    camRetry.style.display = 'none';
    try {
      const { cameras } = await listDevices();
      const pick = deviceId ? cameras.find((c) => c.deviceId === deviceId) : choose(cameras, ctx.prefs.video);
      if (!pick && !cameras.length) throw Object.assign(new Error('no camera'), { name: 'NotFoundError' });
      const stream = await openCamera(pick?.deviceId);
      if (destroyed) return stopStream(stream);
      ctx.media.cam = stream;
      camVideo.srcObject = stream;
      await camVideo.play().catch(() => {});
      camPlaceholder.style.display = 'none';
      const track = stream.getVideoTracks()[0];
      track.addEventListener('ended', () => {
        if (!destroyed) {
          setStatus(camStatus, 'err', 'A câmera desligou. Ela foi desconectada?');
          camRetry.style.display = '';
        }
      });
      await ctx.savePrefs({ video: describe(track) });
      camHead.classList.add('ok');
      setStatus(camStatus, 'ok', 'Câmera funcionando. Arrume a luz e o enquadramento: o rosto deve ficar no centro do círculo.');
      noCamBtn.style.display = 'none';
      await fillSelects();
    } catch (err) {
      console.warn('camera', err);
      camPlaceholder.textContent = 'Sem imagem';
      setStatus(camStatus, 'err', humanMediaError(err, 'video'));
      camRetry.style.display = '';
      noCamBtn.style.display = '';
    }
  }

  async function startMic(deviceId) {
    meter?.close();
    meter = null;
    stopStream(ctx.media.mic);
    ctx.media.mic = null;
    heardMs = 0;
    sinceMic = 0;
    clipCount = 0;
    micHead.classList.remove('ok');
    micRetry.style.display = 'none';
    try {
      const { mics } = await listDevices();
      const pick = deviceId ? mics.find((m) => m.deviceId === deviceId) : choose(mics, ctx.prefs.audio);
      if (!pick && !mics.length) throw Object.assign(new Error('no mic'), { name: 'NotFoundError' });
      const stream = await openMic(pick?.deviceId);
      if (destroyed) return stopStream(stream);
      ctx.media.mic = stream;
      meter = createMeter(stream);
      await ctx.savePrefs({ audio: describe(stream.getAudioTracks()[0]) });
      setStatus(micStatus, 'info', 'Fale alguma coisa, tipo “testando, um, dois, três”. As barrinhas devem se mexer.');
      testBtn.disabled = false;
      await fillSelects();
    } catch (err) {
      console.warn('mic', err);
      setStatus(micStatus, 'err', humanMediaError(err, 'audio'));
      micRetry.style.display = '';
      testBtn.disabled = true;
    }
  }

  function tick() {
    const now = performance.now();
    const dt = now - lastTick;
    lastTick = now;
    if (meter) {
      sinceMic += dt;
      const peak = meter.peak();
      const level = meter.level();
      const lit = Math.round(level * BARS);
      bars.forEach((b, i) => {
        b.className = i < lit ? `on${i >= BARS - 2 ? ' clip' : i >= BARS - 6 ? ' hot' : ''}` : '';
      });
      if (peak > 0.98) clipCount++;
      if (peak > VOICE_PEAK) heardMs += dt;
      if (!testing) {
        if (heardMs >= HEARD_MS && !micHead.classList.contains('ok')) {
          micHead.classList.add('ok');
          setStatus(micStatus, 'ok', 'Estou te ouvindo! Se quiser, grave 5 segundos para conferir como sua voz fica.');
        } else if (clipCount > 90 && micHead.classList.contains('ok')) {
          setStatus(micStatus, 'warn', 'Está chegando um pouco alto demais. Fale um pouquinho mais longe do computador.');
          clipCount = -1e9;
        } else if (heardMs < HEARD_MS && sinceMic > 9000 && sinceMic - dt <= 9000) {
          setStatus(
            micStatus,
            'warn',
            'Ainda não ouvi nada. Confira se o microfone não está mudo (ícone de som no canto da tela) ou escolha outro microfone na lista.',
          );
        }
      }
    }
    raf = requestAnimationFrame(tick);
  }

  async function testRecording() {
    if (!ctx.media.mic) return;
    testing = true;
    testBtn.disabled = true;
    playback.style.display = 'none';
    const rec = new MediaRecorder(ctx.media.mic, { mimeType: 'audio/webm;codecs=opus' });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((r) => (rec.onstop = r));
    rec.start();
    for (let s = 5; s > 0; s--) {
      testBtn.replaceChildren(icon('mic'), `Gravando… ${s}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
    rec.stop();
    await stopped;
    if (destroyed) return;
    playback.src = URL.createObjectURL(new Blob(chunks, { type: 'audio/webm' }));
    playback.style.display = '';
    playback.play().catch(() => {});
    testBtn.replaceChildren(icon('mic'), 'Gravar de novo');
    testBtn.disabled = false;
    testing = false;
    setStatus(micStatus, 'ok', 'Ouça a gravação abaixo. Se ficou baixinho, chegue mais perto do notebook.');
  }

  async function proceed(withoutCamera = false) {
    if (!ctx.media.mic) {
      const go = await modal({
        title: 'O microfone não está funcionando',
        body: 'Sem microfone o vídeo vai ficar mudo. Quer mesmo continuar?',
        actions: [
          { label: 'Voltar e arrumar', value: false },
          { label: 'Continuar mudo', value: true, kind: 'primary' },
        ],
      });
      if (!go) return;
    } else if (heardMs < HEARD_MS) {
      const go = await modal({
        title: 'Ainda não ouvi sua voz',
        body: 'As barrinhas do microfone não se mexeram. Pode ser que ele esteja mudo. Quer continuar mesmo assim?',
        actions: [
          { label: 'Testar de novo', value: false },
          { label: 'Continuar', value: true, kind: 'primary' },
        ],
      });
      if (!go) return;
    }
    if (withoutCamera) {
      stopStream(ctx.media.cam);
      ctx.media.cam = null;
    }
    await ctx.go('studio');
  }

  camSelect.addEventListener('change', () => startCamera(camSelect.value));
  micSelect.addEventListener('change', () => startMic(micSelect.value));

  root.append(
    h(
      'div',
      { class: 'check' },
      h(
        'div',
        { class: 'topbar' },
        h('button', { class: 'btn ghost', onclick: () => ctx.goHome() }, icon('back'), 'Início'),
        h('div', { class: 'title' }, lesson.project.title),
        h('div', { class: 'spacer' }),
        h('span', { class: 'pill' }, `${lesson.pdf.pageCount} slides`),
      ),
      h(
        'div',
        { class: 'body' },
        h(
          'div',
          { class: 'intro' },
          h('h2', {}, 'Antes de gravar, um teste rápido'),
          h('p', { class: 'muted' }, 'Leva meio minuto e evita surpresa no vídeo final.'),
        ),
        h(
          'div',
          { class: 'grid' },
          h(
            'section',
            { class: 'card' },
            camHead,
            h('div', { class: 'cam-preview' }, camVideo, camPlaceholder),
            camStatus,
            h('div', { class: 'row' }, camRetry),
            h('div', { class: 'field' }, h('label', {}, 'Câmera'), camSelect),
          ),
          h(
            'section',
            { class: 'card' },
            micHead,
            meterEl,
            micStatus,
            h('div', { class: 'row' }, testBtn, micRetry),
            playback,
            h('div', { class: 'field' }, h('label', {}, 'Microfone'), micSelect),
          ),
        ),
      ),
      h('footer', {}, noCamBtn, goBtn),
    ),
  );

  camRetry.style.display = 'none';
  micRetry.style.display = 'none';
  raf = requestAnimationFrame(tick);
  // Reuse streams if we came back from the studio, else open the saved/best devices.
  if (ctx.media.cam?.active) {
    camVideo.srcObject = ctx.media.cam;
    camPlaceholder.style.display = 'none';
    camHead.classList.add('ok');
    setStatus(camStatus, 'ok', 'Câmera funcionando.');
  } else {
    startCamera(null);
  }
  if (ctx.media.mic?.active) {
    meter = createMeter(ctx.media.mic);
    setStatus(micStatus, 'info', 'Fale alguma coisa para conferir as barrinhas.');
  } else {
    startMic(null);
  }
  fillSelects();

  return () => {
    destroyed = true;
    cancelAnimationFrame(raf);
    meter?.close();
    camVideo.srcObject = null;
    if (playback.src) URL.revokeObjectURL(playback.src);
  };
}
