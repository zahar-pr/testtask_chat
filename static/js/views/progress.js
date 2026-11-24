// «Мой прогресс»: сколько заданий тренажёров решено, как идут темы и над чем стоит поработать.
import * as api from '../api.js';
import { $, el } from '../dom.js';
import { renderInlineMarkdown } from '../render/markdown.js';
import { confirmAction } from './confirm.js';

const OUTCOME_LABELS = { solved: 'не с первой попытки', revealed: 'с подсмотренным решением' };

export function createProgressPanel({ onReview, onSessionLost }) {
  const dialog = $('#progress-dialog');
  const content = $('#progress-content');
  const reviewButton = $('#progress-review');
  const resetButton = $('#progress-reset');

  const stat = (value, label) =>
    el('div', { class: 'stat' }, el('div', { class: 'stat__value' }, String(value)), el('div', { class: 'stat__label' }, label));

  function render({ totals, topics, mistakes }) {
    const done = totals.first + totals.solved + totals.revealed;
    reviewButton.disabled = mistakes.length === 0;
    resetButton.disabled = done === 0;
    if (done === 0) {
      content.replaceChildren(
        el('p', { class: 'progress__empty' }, 'Пока пусто. Пройдите тренажёр — заготовка «Потренироваться» или урок «с нуля» — и результаты появятся здесь.'),
      );
      return;
    }

    content.replaceChildren(
      el('div', { class: 'stats' },
        stat(done, 'заданий решено'),
        stat(`${Math.round((totals.first / done) * 100)}%`, 'с первой попытки'),
        stat(totals.solved + totals.revealed, 'стоит повторить'),
      ),
      el('h3', { class: 'progress__heading' }, 'По темам'),
      el('ul', { class: 'progress__topics' },
        ...topics.map((topic) =>
          el('li', { class: 'progress__topic' },
            el('span', { class: 'progress__topic-name' }, renderInlineMarkdown(topic.topic)),
            el('span', { class: 'progress__bar', role: 'img', 'aria-label': `С первой попытки ${topic.first} из ${topic.tasks}` },
              el('span', { class: 'progress__bar-fill', style: `width: ${(topic.first / topic.tasks) * 100}%` })),
            el('span', { class: 'progress__topic-score' }, `${topic.first} из ${topic.tasks}`),
          ),
        ),
      ),
      ...(mistakes.length === 0 ? [] : [
        el('h3', { class: 'progress__heading' }, 'Над чем поработать'),
        el('ul', { class: 'progress__mistakes' },
          ...mistakes.map((mistake) =>
            el('li', { class: 'progress__mistake' },
              el('div', {}, renderInlineMarkdown(mistake.question)),
              el('div', { class: 'progress__mistake-meta' }, renderInlineMarkdown(mistake.topic), ` · ${OUTCOME_LABELS[mistake.outcome]}`),
            ),
          ),
        ),
      ]),
    );
  }

  async function load() {
    content.replaceChildren(el('p', { class: 'progress__empty' }, 'Загружаем…'));
    reviewButton.disabled = true;
    resetButton.disabled = true;
    try {
      render(await api.getProgress());
    } catch (error) {
      if (error.status === 401) {
        dialog.close();
        onSessionLost();
        return;
      }
      content.replaceChildren(el('p', { class: 'progress__empty' }, `Не удалось загрузить прогресс. ${error.message}`));
    }
  }

  reviewButton.addEventListener('click', () => {
    dialog.close();
    onReview();
  });
  resetButton.addEventListener('click', async () => {
    const confirmed = await confirmAction({
      title: 'Сбросить прогресс?',
      text: 'Результаты всех тренажёров будут удалены без возможности восстановления.',
      action: 'Сбросить',
    });
    if (!confirmed) return;
    await api.resetProgress().catch(() => {});
    load();
  });
  $('#progress-close').addEventListener('click', () => dialog.close());

  return {
    open() {
      dialog.showModal();
      load();
    },
  };
}
