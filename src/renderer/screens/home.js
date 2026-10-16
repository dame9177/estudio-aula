// Home: open a PDF (button or drag & drop) or continue a recent lesson.
import { h, icon, plural } from '../ui.js';

export async function mount(root, ctx) {
  const { api } = ctx;
  const recent = await api.recentProjects();

  const drop = h(
    'div',
    { class: 'drop', 'data-testid': 'drop' },
    icon('doc', 'doc'),
    h('h3', {}, 'Abra o PDF da sua aula'),
    h('p', { class: 'muted' }, 'Pode ser o PowerPoint ou o Google Slides salvo como PDF.'),
    h(
      'button',
      {
        class: 'btn clay big',
        'data-testid': 'open-pdf',
        onclick: async () => {
          const file = await api.choosePdf();
          if (file) ctx.openLesson(file);
        },
      },
      'Escolher o PDF…',
    ),
    h('span', { class: 'hint' }, 'ou arraste o arquivo para cá'),
  );

  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const file = [...e.dataTransfer.files].find((f) => /\.pdf$/i.test(f.name));
    if (file) ctx.openLesson(api.pathForFile(file));
  });

  const recentEl = recent.length
    ? h(
        'section',
        { class: 'recent' },
        h('h3', {}, 'Continuar de onde parou'),
        h(
          'div',
          { class: 'recent-list' },
          recent.map((r) => {
            const pct = r.pageCount ? Math.round((100 * r.recorded) / r.pageCount) : 0;
            return h(
              'button',
              { class: 'recent-item', onclick: () => ctx.openLesson(r.pdfPath) },
              icon('film'),
              h(
                'div',
                { class: 'grow' },
                h('div', { class: 't' }, r.title),
                h('div', { class: 's' }, `${r.recorded} de ${plural(r.pageCount, 'slide gravado', 'slides gravados')} · ${when(r.updatedAt)}`),
              ),
              h('div', { class: 'progress-mini' }, h('i', { style: { width: `${pct}%` } })),
              icon('right'),
            );
          }),
        ),
      )
    : null;

  root.append(
    h(
      'div',
      { class: 'home' },
      h('header', {}, brand()),
      h(
        'div',
        { class: 'content' },
        h(
          'div',
          { class: 'hello' },
          h('h1', {}, 'Vamos gravar sua aula.'),
          h('p', {}, 'Você fala, os slides passam, seu rosto aparece num cantinho. Cada slide é gravado separado: errou, regrava só aquele.'),
        ),
        drop,
        h(
          'div',
          { class: 'steps' },
          step('1. Câmera e microfone', 'Um teste rápido para ver se está tudo funcionando.'),
          step('2. Grave slide a slide', 'Aperte gravar, fale, passe para o próximo.'),
          step('3. Gere o vídeo', 'Um MP4 pronto para enviar ou subir no Drive.'),
        ),
        recentEl,
      ),
    ),
  );
}

export function brand() {
  return h('div', { class: 'brand' }, icon('mark', 'mark'), 'Estúdio de Aula');
}

function step(title, text) {
  return h('div', { class: 'step' }, h('b', {}, title), h('span', {}, text));
}

function when(iso) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `hoje às ${time}` : d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }) + ` às ${time}`;
}
