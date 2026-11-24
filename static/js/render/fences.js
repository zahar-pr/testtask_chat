// Блоки графиков и тренажёров в тексте ответа: где блок начинается и где заканчивается.
// Это единственное место, которое знает формат «```plot … ```»; им пользуются разбор готового
// ответа (markdown.js), показ недописанного ответа (streaming.js) и автопроверка качества (evals/).
// От страницы модуль не зависит.

export const WIDGET_KINDS = ['plot', 'trainer'];
export const isWidgetKind = (kind) => WIDGET_KINDS.includes(kind);

const OPENING = new RegExp(`\`\`\`(${WIDGET_KINDS.join('|')})[ \\t]*\\n`, 'gi');
// Закрывающая строка ``` сразу после описания.
const CLOSING = /^[ \t]*\n?[ \t]*```/;
// Первая строка ``` дальше по тексту; если она пустая (без названия) — это запоздавшая закрывающая.
const NEXT_FENCE = /\n[ \t]*```([^\n`]*)(?=\n|$)/;

/**
 * Где заканчивается JSON-объект, начинающийся с позиции `from` (индекс после закрывающей скобки),
 * или -1, если объект ещё не дописан. Скобки и кавычки внутри строк не считаются.
 */
export function jsonObjectEnd(text, from) {
  let index = from;
  while (index < text.length && /\s/.test(text[index])) index++;
  if (text[index] !== '{') return -1;

  let depth = 0;
  let inString = false;
  for (; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (char === '\\') index++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return index + 1;
  }
  return -1;
}

/**
 * Блок, открывающийся в позиции `start` (там стоит «```»). null — это не блок графика или
 * тренажёра. Иначе { kind, bodyStart, bodyEnd, end, closed }:
 *   bodyEnd — конец JSON-описания (-1 — описание ещё не дописано);
 *   end     — где блок заканчивается в тексте: после закрывающей строки, если она на месте;
 *   closed  — стоит ли закрывающая строка сразу после описания.
 * Конец блока определяется по самому описанию: модель иногда забывает закрывающую строку,
 * и текст после рисунка не должен из-за этого пропасть.
 */
export function readWidgetFence(text, start) {
  const lineEnd = text.indexOf('\n', start);
  if (lineEnd === -1) return null;
  const kind = text.slice(start + 3, lineEnd).trim().toLowerCase();
  if (!isWidgetKind(kind)) return null;

  const bodyStart = lineEnd + 1;
  const bodyEnd = jsonObjectEnd(text, bodyStart);
  if (bodyEnd === -1) return { kind, bodyStart, bodyEnd, end: -1, closed: false };
  const closing = CLOSING.exec(text.slice(bodyEnd));
  return { kind, bodyStart, bodyEnd, end: bodyEnd + (closing ? closing[0].length : 0), closed: closing !== null };
}

/** Запоздавшая закрывающая строка после позиции `from`: { start, end } или null. */
export function lateClosingFence(text, from) {
  const next = NEXT_FENCE.exec(text.slice(from));
  if (!next || next[1].trim() !== '') return null;
  return { start: from + next.index, end: from + next.index + next[0].length };
}

/**
 * Разрезать текст ответа на обычный текст и блоки:
 * [{ type: 'text', text } | { type: 'widget', kind, source }], где source — JSON-описание блока.
 * Блок с недописанным описанием остаётся в тексте как есть.
 */
export function splitWidgetBlocks(original) {
  let text = original;
  const parts = [];
  let cursor = 0;
  const opening = new RegExp(OPENING.source, OPENING.flags);
  for (let match = opening.exec(text); match; match = opening.exec(text)) {
    const block = readWidgetFence(text, match.index);
    if (!block || block.bodyEnd === -1) continue;
    if (!block.closed) {
      // Закрывающая строка стоит ниже, после куска обычного текста: убираем её, иначе она
      // открыла бы «блок кода» и спрятала всё до следующего блока.
      const late = lateClosingFence(text, block.bodyEnd);
      if (late) text = text.slice(0, late.start) + text.slice(late.end);
    }
    parts.push({ type: 'text', text: text.slice(cursor, match.index) });
    parts.push({ type: 'widget', kind: block.kind, source: text.slice(block.bodyStart, block.bodyEnd) });
    cursor = block.end;
    opening.lastIndex = block.end;
  }
  parts.push({ type: 'text', text: text.slice(cursor) });
  return parts;
}

/** Есть ли в тексте начало блока графика или тренажёра (например, с недописанным описанием). */
export const hasWidgetOpening = (text) => new RegExp(OPENING.source, 'i').test(text);
