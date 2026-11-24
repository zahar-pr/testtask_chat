// Формулы в тексте, который человек набирает с клавиатуры: «x^2 - 5x + 6 = 0», «1/2 + 1/3».
// Находит в обычном тексте математические выражения и показывает их в настоящей записи —
// в предпросмотре над полем ввода и в отправленных вопросах. Сам текст вопроса при этом
// не меняется: модель получает ровно то, что набрано.
import { GREEK, ExprError, parse } from '../math/expr.js';
import { renderMath } from './math.js';

const RELATIONS = { '=': '=', '<': '<', '>': '>', '<=': '\\le', '>=': '\\ge', '!=': '\\ne', '≤': '\\le', '≥': '\\ge', '≠': '\\ne' };
const RELATION = /(<=|>=|!=|[=<>≤≥≠])/;
// Кусок текста — кандидат в формулу, если в нём нет кириллицы и знаков конца фразы…
const CANDIDATE = /[^Ѐ-ӿ\n;:?!"«»—…→]+/g;
// …и есть хотя бы один математический знак: одно число или одна буква — ещё не формула.
const HAS_OPERATOR = /[\^/*=<>+√²³≤≥≠·×÷]|\d\s*-|-\s*\d|[A-Za-z)]\s*-\s*[A-Za-z(]|\d[A-Za-z(]|[a-z]+\(/;

const CONSTANT_LATEX = { pi: '\\pi', e: 'e', tau: '\\tau', inf: '\\infty' };
// Названия функций — как в школьных учебниках: tg, ctg, arctg.
const FUNCTION_LATEX = {
  sin: '\\sin', cos: '\\cos', tan: '\\tg', cot: '\\ctg', asin: '\\arcsin', acos: '\\arccos', atan: '\\arctg',
  sinh: '\\sinh', cosh: '\\cosh', tanh: '\\tanh', ln: '\\ln', lg: '\\lg', log2: '\\log_2', log: '\\log',
  min: '\\min', max: '\\max',
};

const isSum = (node) => node.type === 'binary' && (node.op === '+' || node.op === '-');
const isAtom = (node) => node.type === 'number' || node.type === 'variable' || node.type === 'constant';
const inParens = (text) => `\\left(${text}\\right)`;

/** Дерево выражения (см. math/expr.js) → запись LaTeX. Скобки ставятся только там, где нужны. */
export function toLatex(node) {
  switch (node.type) {
    case 'number':
      return node.text.replace('.', '{,}');
    case 'constant':
      return CONSTANT_LATEX[node.name];
    case 'variable': {
      const indexed = /^([A-Za-z])(\d+)$/.exec(node.name);
      if (indexed) return `${indexed[1]}_{${indexed[2]}}`;
      return GREEK.has(node.name.toLowerCase()) ? `\\${node.name.toLowerCase()}` : node.name;
    }
    case 'negate':
      return `-${isSum(node.arg) ? inParens(toLatex(node.arg)) : toLatex(node.arg)}`;
    case 'apply':
      return `${node.name}${inParens(node.args.map(toLatex).join(',\\, '))}`;
    case 'call':
      return callToLatex(node);
    default:
      return binaryToLatex(node);
  }
}

function callToLatex({ name, args }) {
  const [first, second] = args.map(toLatex);
  if (name === 'sqrt') return `\\sqrt{${first}}`;
  if (name === 'cbrt') return `\\sqrt[3]{${first}}`;
  if (name === 'abs') return `\\left|${first}\\right|`;
  if (name === 'exp') return `e^{${first}}`;
  if (name === 'pow') return `{${first}}^{${second}}`;
  if (name === 'log' && second !== undefined) return `\\log_{${second}}${inParens(first)}`;
  const label = FUNCTION_LATEX[name] ?? `\\operatorname{${name}}`;
  return `${label}${inParens(args.map(toLatex).join(',\\, '))}`;
}

function binaryToLatex({ op, left, right, implicit }) {
  const a = toLatex(left);
  const b = toLatex(right);
  if (op === '+') return `${a} + ${right.type === 'negate' ? inParens(b) : b}`;
  if (op === '-') return `${a} - ${isSum(right) || right.type === 'negate' ? inParens(b) : b}`;
  if (op === '/') return `\\frac{${a}}{${b}}`;
  if (op === '^') return `${isAtom(left) && !(left.type === 'number' && left.value < 0) ? a : inParens(a)}^{${b}}`;

  // умножение: 2x пишем слитно, 12 · 12 — с точкой, суммы берём в скобки
  const factor = (node, text) => (isSum(node) || node.type === 'negate' ? inParens(text) : text);
  const needsDot = !implicit || right.type === 'number' || (right.type === 'binary' && right.op === '^' && right.left.type === 'number');
  return `${factor(left, a)}${needsDot ? ' \\cdot ' : ' '}${factor(right, b)}`;
}

/** Выражение с клавиатуры → LaTeX; null, если это не выражение. */
function expressionToLatex(source) {
  const parts = source.replace(/(\d),(\d)/g, '$1.$2').split(RELATION); // 0,5 — десятичная запятая
  try {
    return parts
      .map((part, index) => (index % 2 === 1 ? ` ${RELATIONS[part]} ` : toLatex(parse(part, null))))
      .join('');
  } catch (error) {
    if (error instanceof ExprError) return null;
    throw error;
  }
}

/** Разбить кусок по запятым между выражениями: «x = 8, y = 2» — два выражения, «log(8, 2)» — одно. */
function splitByCommas(text, offset) {
  const pieces = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index <= text.length; index++) {
    const char = text[index];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    if (index === text.length || (char === ',' && depth <= 0 && /\s/.test(text[index + 1] ?? ' '))) {
      pieces.push({ text: text.slice(start, index), start: offset + start });
      start = index + 1;
    }
  }
  return pieces;
}

/** Найти в тексте формулы: [{ start, end, latex }] в порядке следования. */
export function findMath(text) {
  const found = [];
  for (const candidate of text.matchAll(CANDIDATE)) {
    for (const piece of splitByCommas(candidate[0], candidate.index)) {
      const trimmed = piece.text.replace(/^[\s.,]+/, '').replace(/[\s.,]+$/, '');
      if (trimmed.length < 3 || !HAS_OPERATOR.test(trimmed)) continue;
      const latex = expressionToLatex(trimmed);
      if (latex === null) continue;
      const start = piece.start + piece.text.indexOf(trimmed);
      found.push({ start, end: start + trimmed.length, latex });
    }
  }
  return found;
}

/** Текст с клавиатуры → узлы страницы: обычный текст как есть, найденные формулы — в настоящей записи. */
export function renderMathText(text, formulas = findMath(text)) {
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const { start, end, latex } of formulas) {
    fragment.append(text.slice(cursor, start), renderMath(latex));
    cursor = end;
  }
  fragment.append(text.slice(cursor));
  return fragment;
}
