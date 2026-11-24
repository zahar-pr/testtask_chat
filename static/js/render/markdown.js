// Превращает ответ модели (Markdown + LaTeX) в DOM-узлы.
//
// Узлы создаются через DOM API, а текст вставляется как текст — в разметку страницы не попадает
// ни один символ ответа модели, поэтому HTML-инъекция исключена без отдельной «санитизации».
//
// Поддерживается то, что разрешено модели системным промптом, с небольшим запасом:
// абзацы, **полужирный**, *курсив*, списки (в том числе вложенные), заголовки, цитаты, код,
// ссылки, формулы $...$, $$...$$, \(...\), \[...\], а также наглядные блоки ```plot и ```trainer
// (графики и тренажёры — см. widgets/).
import { el } from '../dom.js';
import { isWidget, renderPendingWidget, renderWidget } from '../widgets/index.js';
import { renderMath } from './math.js';

// Код и формулы вырезаются из текста первыми и заменяются заглушками, чтобы звёздочки и
// подчёркивания внутри LaTeX не были приняты за разметку. Заглушка — номер между служебными символами.
const INLINE_MARK = '\u0000';
const BLOCK_MARK = '\u0001';

const HEADING = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const BULLET = /^(\s*)([-*+•])(\s+)(.*)$/;
const NUMBERED = /^(\s*)(\d{1,9})[.)](\s+)(.*)$/;

const TRAILING_PUNCTUATION = /^[.,;:!?)»…]+/;

const INLINE = new RegExp(
  [
    '[\\u0000\\u0001](\\d+)[\\u0000\\u0001]', // 1: заглушка
    '\\*\\*(?!\\s)([^\\n]+?)(?<!\\s)\\*\\*', // 2: полужирный
    '(?<![\\p{L}\\p{N}*])\\*(?![\\s*])([^*\\n]+?)(?<![\\s*])\\*(?![\\p{L}\\p{N}*])', // 3: курсив
    '\\[([^\\]\\n]+)\\]\\((https?:\\/\\/[^\\s)]+)\\)', // 4, 5: ссылка
    '\\n', // перенос строки
  ].join('|'),
  'gu',
);

// Признак блока, который ещё «печатается»: его подставляет render/streaming.js.
export const PENDING_PREFIX = 'pending-';

/** Разметка внутри одной строки (подписи графиков, варианты ответа): формулы, **полужирный**, код. */
export function renderInlineMarkdown(source) {
  const fragment = document.createDocumentFragment();
  for (const block of renderMarkdown(source.replace(/\s*\n\s*/g, ' ')).childNodes) {
    fragment.append(...(block.nodeName === 'P' ? block.childNodes : [block]));
  }
  return fragment;
}

const WIDGET_CONTEXT = { renderBlock: (text) => renderMarkdown(text), renderInline: renderInlineMarkdown };

/**
 * widgets — необязательная память между перерисовками одного сообщения (Map): пока ответ
 * «печатается», уже готовые графики и тренажёры не создаются заново и не теряют состояние.
 */
export function renderMarkdown(source, { widgets = null } = {}) {
  const stash = [];
  const keep = (mark, node) => `${mark}${stash.push(node) - 1}${mark}`;

  const seen = new Map(); // одинаковые блоки в одном сообщении — разные элементы
  const fence = (language, code) => {
    const kind = language.trim().toLowerCase();
    if (kind.startsWith(PENDING_PREFIX) && isWidget(kind.slice(PENDING_PREFIX.length))) {
      return renderPendingWidget(kind.slice(PENDING_PREFIX.length));
    }
    if (!isWidget(kind)) return el('pre', {}, el('code', {}, code));

    const repeat = seen.get(code) ?? 0;
    seen.set(code, repeat + 1);
    const key = `${kind}#${repeat}:${code}`;
    const node = widgets?.get(key) ?? renderWidget(kind, code, WIDGET_CONTEXT);
    widgets?.set(key, node);
    return node;
  };

  const text = source
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000\u0001]/g, '')
    // блоки кода ```...```
    .replace(/```([^\n`]*)\n([\s\S]*?)(?:\n[ \t]*```|$)/g, (_, language, code) => keep(BLOCK_MARK, fence(language, code)))
    // `код в строке`
    .replace(/`([^`\n]+)`/g, (_, code) => keep(INLINE_MARK, el('code', {}, code)))
    // формулы отдельной строкой: $$...$$ и \[...\]
    .replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g, (_, a, b) => keep(BLOCK_MARK, renderMath(a ?? b, { display: true })))
    // формулы в строке: \(...\) и $...$; «\$» — просто знак доллара
    .replace(/\\\$|\\\(([\s\S]+?)\\\)|\$(?!\s)((?:\\.|[^$\\\n])+?)(?<!\s)\$(?!\d)/g, (match, a, b) =>
      match === '\\$' ? '$' : keep(INLINE_MARK, renderMath(a ?? b)),
    );

  const fragment = document.createDocumentFragment();
  fragment.append(...parseBlocks(text.split('\n'), stash));
  return fragment;
}

// --- Блоки: заголовки, списки, цитаты, абзацы ---

const isBlank = (line) => line.trim() === '';
const indentOf = (line) => line.length - line.trimStart().length;

function nextNonBlank(lines, from) {
  let index = from;
  while (index < lines.length && isBlank(lines[index])) index++;
  return index;
}

function matchListItem(line) {
  if (RULE.test(line)) return null;
  let match = BULLET.exec(line);
  if (match) {
    const indent = match[1].length;
    return { ordered: false, indent, offset: indent + 1 + match[3].length, text: match[4] };
  }
  match = NUMBERED.exec(line);
  if (match) {
    const indent = match[1].length;
    return {
      ordered: true,
      number: Number(match[2]),
      indent,
      offset: indent + match[2].length + 1 + match[3].length,
      text: match[4],
    };
  }
  return null;
}

const startsBlock = (line) => HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || matchListItem(line) !== null;

function parseBlocks(lines, stash) {
  const nodes = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (isBlank(line)) {
      index++;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      nodes.push(renderInline(el(heading[1].length <= 2 ? 'h3' : 'h4'), heading[2], stash));
      index++;
      continue;
    }

    if (RULE.test(line)) {
      nodes.push(el('hr'));
      index++;
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted = [];
      while (index < lines.length && QUOTE.test(lines[index])) quoted.push(QUOTE.exec(lines[index++])[1]);
      nodes.push(el('blockquote', {}, ...parseBlocks(quoted, stash)));
      continue;
    }

    const item = matchListItem(line);
    if (item) {
      const { list, next } = parseList(lines, index, item, stash);
      nodes.push(list);
      index = next;
      continue;
    }

    const paragraph = [];
    while (index < lines.length && !isBlank(lines[index]) && !(paragraph.length && startsBlock(lines[index]))) {
      paragraph.push(lines[index++].trim());
    }
    nodes.push(...renderParagraph(paragraph.join('\n'), stash));
  }
  return nodes;
}

function parseList(lines, start, first, stash) {
  const list = el(first.ordered ? 'ol' : 'ul');
  if (first.ordered && first.number !== 1) list.setAttribute('start', first.number);

  // Пункт того же списка: тот же тип маркера и тот же отступ. Строки с бо́льшим отступом —
  // содержимое пункта (продолжение абзаца, формула, вложенный список).
  const isSibling = (item) =>
    item !== null && item.ordered === first.ordered && item.indent >= first.indent && item.indent <= first.indent + 1;
  const isNested = (line) => indentOf(line) >= first.indent + 2;

  let index = start;
  while (index < lines.length) {
    const item = matchListItem(lines[index]);
    if (!isSibling(item)) break;

    const body = [item.text];
    index++;
    while (index < lines.length) {
      const line = lines[index];
      if (isBlank(line)) {
        const next = nextNonBlank(lines, index);
        if (next === lines.length || !isNested(lines[next])) break;
        body.push('');
        index = next;
      } else if (isNested(line)) {
        body.push(line.slice(Math.min(indentOf(line), item.offset)));
        index++;
      } else if (startsBlock(line)) {
        break;
      } else {
        body.push(line.trim()); // строка без отступа продолжает абзац пункта
        index++;
      }
    }
    list.append(el('li', {}, ...parseBlocks(body, stash)));

    // Пустые строки между пунктами не разрывают список.
    const next = nextNonBlank(lines, index);
    if (next > index && next < lines.length && isSibling(matchListItem(lines[next]))) index = next;
  }
  return { list, next: index };
}

/** Абзац; формулы отдельной строкой и блоки кода выносятся из него в самостоятельные блоки. */
function renderParagraph(text, stash) {
  const nodes = [];
  text.split(/\s*\u0001(\d+)\u0001\s*/).forEach((part, position) => {
    if (position % 2 === 1) nodes.push(stash[Number(part)]);
    else if (part.trim() !== '') nodes.push(renderInline(el('p'), part.trim(), stash));
  });
  return nodes;
}

// --- Разметка внутри строки ---

function renderInline(parent, text, stash) {
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) parent.append(text.slice(last, match.index));
    const [, placeholder, bold, italic, linkText, linkUrl] = match;
    last = match.index + match[0].length;

    if (placeholder !== undefined) {
      const node = stash[Number(placeholder)];
      // Знак препинания сразу после формулы не должен уезжать на следующую строку один.
      const punctuation = node.classList?.contains('math-inline') ? TRAILING_PUNCTUATION.exec(text.slice(last))?.[0] : null;
      if (punctuation) {
        parent.append(el('span', { class: 'nowrap' }, node, punctuation));
        last += punctuation.length;
      } else parent.append(node);
      continue;
    }
    if (bold !== undefined) parent.append(renderInline(el('strong'), bold, stash));
    else if (italic !== undefined) parent.append(renderInline(el('em'), italic, stash));
    else if (linkText !== undefined) {
      parent.append(renderInline(el('a', { href: linkUrl, target: '_blank', rel: 'noopener noreferrer' }), linkText, stash));
    } else parent.append(el('br'));
  }
  if (last < text.length) parent.append(text.slice(last));
  return parent;
}
