// Наглядные блоки в ответе модели: ```plot (график, чертёж, интерактивное объяснение)
// и ```trainer (тренажёр). Здесь JSON-описание блока превращается в готовый элемент страницы.
// Где блок начинается и заканчивается в тексте, знает render/fences.js.
import { el } from '../dom.js';
import { createPlot } from './plot/index.js';
import { createTrainer } from './trainer.js';
import { parseSpec } from './util.js';

const WIDGETS = {
  plot: { create: createPlot, pending: 'Рисую график…', failed: 'Не получилось построить рисунок' },
  trainer: { create: createTrainer, pending: 'Готовлю тренажёр…', failed: 'Не получилось собрать тренажёр' },
};

/** Готовый блок по его описанию; если описание испорчено — аккуратная заглушка с причиной. */
export function renderWidget(kind, source, context) {
  const widget = WIDGETS[kind];
  try {
    return widget.create(parseSpec(source), context);
  } catch (error) {
    const reason = error instanceof SyntaxError ? 'описание блока повреждено' : error.message;
    return el('div', { class: 'widget widget--failed' },
      el('p', { class: 'widget__failed-title' }, widget.failed),
      el('p', { class: 'widget__failed-reason' }, `Причина: ${reason}. Попросите модель нарисовать ещё раз.`),
    );
  }
}

/** Заглушка на время, пока описание блока ещё «печатается». */
export function renderPendingWidget(kind) {
  return el('div', { class: 'widget widget--pending', role: 'status' },
    el('span', { class: 'spinner', 'aria-hidden': 'true' }), WIDGETS[kind].pending);
}
