// Помощник для ответа, который ещё «печатается».
//
// Недописанный текст нельзя просто отдать в разбор разметки: незакрытая формула показалась бы
// сырым LaTeX, а потом скачком превратилась в формулу. Поэтому до разбора от текста отрезается
// «хвост», который ещё не закончен, — формула появляется целиком, когда дописана.

import { CLOSING_FENCE, isWidget, jsonObjectEnd } from '../widgets/index.js';
import { PENDING_PREFIX } from './markdown.js';

const NOT_MATH = -1; // строка закончилась без закрывающего $ — это был просто знак доллара
const PENDING = -2; // текст оборвался посреди формулы

/** Часть текста, которую уже можно показывать: без незаконченной формулы в конце. */
export function stablePart(text) {
  let index = 0;
  let lateCloser = false; // после блока без закрывающей строки она может встретиться ниже
  while (index < text.length) {
    const char = text[index];

    if (text.startsWith('```', index)) {
      const widget = widgetFence(text, index);
      if (widget) {
        // График или тренажёр: блок готов, когда дописано его JSON-описание.
        if (widget.end === -1) return `${tidy(text.slice(0, index))}\n\n\`\`\`${PENDING_PREFIX}${widget.kind}\n\n\`\`\``;
        const rest = text.slice(widget.end);
        if (/^\s*`{0,2}$/.test(rest)) return text.slice(0, widget.end); // закрывающая строка ``` ещё печатается
        const closing = CLOSING_FENCE.exec(rest);
        lateCloser = !closing;
        index = widget.end + (closing?.[0].length ?? 0);
        continue;
      }
      const lineEnd = text.indexOf('\n', index);
      if (lateCloser && lineEnd !== -1 && text.slice(index + 3, lineEnd).trim() === '') {
        lateCloser = false; // запоздавшая закрывающая строка блока — это не начало блока кода
        index = lineEnd;
        continue;
      }
      lateCloser = false;
      const close = text.indexOf('```', index + 3);
      if (close === -1) return unfinishedFence(text, index);
      index = close + 3;
    } else if (char === '`') {
      const close = text.indexOf('`', index + 1);
      const lineEnd = text.indexOf('\n', index + 1);
      index = close !== -1 && (lineEnd === -1 || close < lineEnd) ? close + 1 : index + 1;
    } else if (char === '\\') {
      const next = text[index + 1];
      if (next === undefined) return tidy(text.slice(0, index)); // начало «\(» или «\$»?
      if (next === '[' || next === '(') {
        const close = text.indexOf(next === '[' ? '\\]' : '\\)', index + 2);
        if (close === -1) return tidy(text.slice(0, index));
        index = close + 2;
      } else {
        index += 2;
      }
    } else if (char === '$') {
      const next = text[index + 1];
      if (next === undefined) return tidy(text.slice(0, index)); // «$» или начало «$$» — пока неясно
      if (next === '$') {
        const close = text.indexOf('$$', index + 2);
        if (close === -1) return tidy(text.slice(0, index));
        index = close + 2;
      } else if (/\s/.test(next)) {
        index += 1;
      } else {
        const close = closingDollar(text, index + 1);
        if (close === PENDING) return tidy(text.slice(0, index));
        index = close === NOT_MATH ? index + 1 : close + 1;
      }
    } else {
      index += 1;
    }
  }
  return tidy(text);
}

/** Если с позиции start начинается блок графика или тренажёра — его вид и конец описания (-1: не дописано). */
function widgetFence(text, start) {
  const lineEnd = text.indexOf('\n', start);
  if (lineEnd === -1) return null;
  const kind = text.slice(start + 3, lineEnd).trim().toLowerCase();
  return isWidget(kind) ? { kind, end: jsonObjectEnd(text, lineEnd + 1) } : null;
}

/** Недописанный блок обычного кода показываем как есть; пока не дописано даже название — прячем. */
function unfinishedFence(text, start) {
  return text.includes('\n', start) ? text : tidy(text.slice(0, start));
}

function closingDollar(text, from) {
  for (let index = from; index < text.length; index++) {
    if (text[index] === '\\') index++;
    else if (text[index] === '\n') return NOT_MATH;
    else if (text[index] === '$') return index;
  }
  return PENDING;
}

/** Незакрытый **полужирный** в последней строке закрываем временно, чтобы не мигали звёздочки. */
function tidy(text) {
  let result = text.replace(/[ \t]+$/, '');
  if (/(^|[^*])\*$/.test(result)) result = result.slice(0, -1); // одинокая «*»: маркер ещё не дописан

  const lastLine = result.slice(result.lastIndexOf('\n') + 1);
  const marks = lastLine.match(/\*\*/g)?.length ?? 0;
  if (marks % 2 === 1) result = result.endsWith('**') ? result.slice(0, -2) : `${result}**`;
  return result;
}
