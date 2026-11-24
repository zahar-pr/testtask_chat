// Наглядные блоки в ответе модели: ```plot (график, чертёж, интерактивное объяснение)
// и ```trainer (тренажёр). Внутри блока — JSON-описание; здесь оно превращается в готовый элемент.
import { el } from '../dom.js';
import { createPlot } from './plot.js';
import { createTrainer } from './trainer.js';

const WIDGETS = {
  plot: { create: createPlot, pending: 'Рисую график…', failed: 'Не получилось построить рисунок' },
  trainer: { create: createTrainer, pending: 'Готовлю тренажёр…', failed: 'Не получилось собрать тренажёр' },
};

export const isWidget = (kind) => Object.hasOwn(WIDGETS, kind);

/**
 * Модели часто забывают удвоить обратную косую черту в JSON: пишут "$\frac{1}{2}$" вместо
 * "$\\frac{1}{2}$". Хуже того, «\f» и «\t» — допустимые в JSON символы, и «\frac» молча
 * превратился бы в мусор. Поэтому одиночную черту перед командой LaTeX удваиваем сами.
 */
function parseSpec(source) {
  const repaired = source.replace(/(\\+)(?=[A-Za-z]{2}|[{}()[\],;!|%&_ ])/g, (slashes) =>
    slashes.length % 2 === 1 ? `${slashes}\\` : slashes,
  );
  return JSON.parse(repaired);
}

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
