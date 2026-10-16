// Export: review what is recorded, then join everything into one MP4.
import { h, icon, modal, plural, cleanError } from '../ui.js';
import { formatDuration } from '../lib/geometry.js';

export async function mount(root, ctx) {
  const { api, lesson } = ctx;
  const { dir, pdf } = lesson;
  const n = pdf.pageCount;
  const plan = await api.exportPlan(dir);
  const totalMs = plan.inputs.reduce((s, x) => s + x.durationMs, 0);
  let running = false;
  let stopProgress = null;

  const bar = h('i');
  const barText = h('span', { class: 'muted' });
  const progressBox = h('div', { style: { display: 'none', flexDirection: 'column', gap: '8px' } }, h('div', { class: 'bar' }, bar), barText);
  const resultBox = h('div');
  const cancelBtn = h('button', { class: 'btn', style: { display: 'none' }, onclick: () => api.cancelExport() }, 'Cancelar');
  const goBtn = h('button', { class: 'btn clay big', 'data-testid': 'export-start', disabled: !plan.inputs.length, onclick: () => run() }, icon('film'), 'Gerar vídeo (MP4)');
  const backBtn = h('button', { class: 'btn ghost', onclick: () => !running && ctx.go('studio') }, icon('back'), 'Voltar ao estúdio');

  const takeCards = Array.from({ length: n }, (_, i) => {
    const t = lesson.project.takes[i];
    const img = h('img', { alt: '' });
    pdf.thumb(i).then((u) => (img.src = u));
    return h(
      'div',
      {
        class: `t${t ? '' : ' missing'}`,
        style: { cursor: running ? 'default' : 'pointer' },
        title: 'Abrir no estúdio',
        onclick: () => !running && ctx.go('studio', { index: i }),
      },
      img,
      h('div', { class: 'm' }, h('span', {}, `Slide ${i + 1}`), h('span', {}, t ? formatDuration(t.durationMs) : 'não gravado')),
    );
  });

  async function run() {
    if (plan.missing.length) {
      const list = plan.missing.map((i) => i + 1);
      const go = await modal({
        title: `${plural(list.length, 'slide não foi gravado', 'slides não foram gravados')}`,
        body: `Slides ${joinList(list)}. Eles vão ficar de fora do vídeo. Quer gerar assim mesmo?`,
        actions: [
          { label: 'Voltar e gravar', value: false },
          { label: 'Gerar sem eles', value: true, kind: 'primary' },
        ],
      });
      if (!go) {
        ctx.go('studio', { index: plan.missing[0] });
        return;
      }
    }
    running = true;
    goBtn.disabled = true;
    backBtn.disabled = true;
    cancelBtn.style.display = '';
    progressBox.style.display = 'flex';
    resultBox.replaceChildren();
    const started = performance.now();
    stopProgress = api.onExportProgress((p) => {
      bar.style.width = `${Math.round(p * 100)}%`;
      const elapsed = performance.now() - started;
      const eta = p > 0.03 ? (elapsed / p) * (1 - p) : null;
      barText.textContent = `${Math.round(p * 100)}%${eta ? ` · falta ~${formatDuration(eta)}` : ''}. Pode deixar rodando.`;
    });
    barText.textContent = 'Preparando…';
    try {
      const output = await api.startExport(dir);
      showDone(output);
    } catch (err) {
      const msg = cleanError(err);
      if (!/cancelled/.test(msg)) {
        console.error(msg);
        await modal({ title: 'O vídeo não foi gerado', body: 'Algo deu errado ao juntar as gravações. Tente de novo; se repetir, regrave o último slide gravado.' });
      }
      progressBox.style.display = 'none';
    } finally {
      stopProgress?.();
      running = false;
      goBtn.disabled = false;
      backBtn.disabled = false;
      cancelBtn.style.display = 'none';
    }
  }

  function showDone(output) {
    progressBox.style.display = 'none';
    resultBox.replaceChildren(
      h(
        'div',
        { class: 'done-card', 'data-testid': 'export-done' },
        h('h3', {}, 'Seu vídeo está pronto ✓'),
        h('code', {}, output),
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn primary', onclick: () => api.openPath(output) }, icon('play'), 'Assistir'),
          h('button', { class: 'btn', onclick: () => api.showInFolder(output) }, icon('folder'), 'Abrir a pasta'),
        ),
      ),
    );
    goBtn.replaceChildren(icon('film'), 'Gerar de novo');
  }

  root.append(
    h(
      'div',
      { class: 'export' },
      h('div', { class: 'topbar' }, backBtn, h('div', { class: 'title' }, lesson.project.title)),
      h(
        'div',
        { class: 'body' },
        h(
          'div',
          { class: 'inner' },
          h('div', {}, h('h2', {}, 'Gerar o vídeo final'), h('p', { class: 'muted' }, 'Junto todos os slides gravados, na ordem, num único MP4 em Full HD.')),
          h(
            'div',
            { class: 'summary' },
            stat(`${plan.inputs.length}/${n}`, 'slides gravados'),
            stat(formatDuration(totalMs), 'duração do vídeo'),
            stat(plan.missing.length ? String(plan.missing.length) : '0', plan.missing.length ? 'slides faltando' : 'nada faltando'),
          ),
          h('div', { class: 'row' }, goBtn, cancelBtn),
          progressBox,
          resultBox,
          h('h3', { style: { marginTop: '8px' } }, 'Slides'),
          h('div', { class: 'takes' }, takeCards),
        ),
      ),
    ),
  );

  if (plan.exists) {
    resultBox.replaceChildren(
      h(
        'div',
        { class: 'status info' },
        icon('info'),
        h('span', {}, 'Já existe um vídeo gerado antes. Gerar de novo vai substituí-lo com as gravações atuais. '),
        h('button', { class: 'linklike', onclick: () => api.openPath(plan.output) }, 'Assistir o anterior'),
      ),
    );
  }

  return () => stopProgress?.();
}

function stat(value, label) {
  return h('div', { class: 'stat' }, h('b', {}, value), h('span', {}, label));
}

function joinList(nums) {
  if (nums.length === 1) return String(nums[0]);
  return `${nums.slice(0, -1).join(', ')} e ${nums.at(-1)}`;
}
