// Вычисление математических выражений из описаний графиков и ответов тренажёра:
// «a*x^2 - 5*x + 6», «2*pi», «sqrt(2)/2».
//
// Свой небольшой разбор вместо eval/new Function: выражения приходят от языковой модели и от
// пользователя, исполнять их как код нельзя (и Content-Security-Policy этого не позволит).
// Выражение один раз превращается в функцию и потом вызывается сотни раз при построении графика.

export class ExprError extends Error {}

const CONSTANTS = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };

const log = (x, base) => (base === undefined ? Math.log(x) : Math.log(x) / Math.log(base));
const FUNCTIONS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, cot: (x) => 1 / Math.tan(x),
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  exp: Math.exp, ln: Math.log, lg: Math.log10, log2: Math.log2, log,
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, sign: Math.sign,
  floor: Math.floor, ceil: Math.ceil, round: Math.round,
  min: Math.min, max: Math.max, pow: Math.pow,
};
// Привычные по школьным учебникам названия.
const ALIASES = { tg: 'tan', ctg: 'cot', arcsin: 'asin', arccos: 'acos', arctan: 'atan', arctg: 'atan', log10: 'lg' };

const TOKEN = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)|([A-Za-z_][A-Za-z_0-9]*)|(\*\*|[-+*/^(),]))/y;

function tokenize(source) {
  const text = source
    .replace(/[−–]/g, '-')
    .replace(/[·×]/g, '*')
    .replace(/÷/g, '/')
    .replace(/π/g, ' pi ')
    .replace(/(\d),(\d)/g, '$1.$2'); // десятичная запятая: 0,5
  const tokens = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < text.length) {
    const start = TOKEN.lastIndex;
    const match = TOKEN.exec(text);
    if (!match) {
      if (text.slice(start).trim() === '') break;
      throw new ExprError(`непонятный символ «${text.slice(start).trim()[0]}»`);
    }
    if (match[1] !== undefined) tokens.push({ type: 'number', value: Number(match[1]) });
    else if (match[2] !== undefined) tokens.push({ type: 'name', value: match[2] });
    else tokens.push({ type: match[3] === '**' ? '^' : match[3] });
  }
  return tokens;
}

/**
 * Превратить выражение в функцию от набора переменных: compile('a*x^2', ['x', 'a'])({ x: 2, a: 3 }) → 12.
 * Неизвестные имена — ошибка сразу, при разборе, а не при вычислении.
 */
export function compile(source, variables = []) {
  if (typeof source !== 'string' || source.trim() === '') throw new ExprError('пустое выражение');
  const tokens = tokenize(source);
  let position = 0;

  const peek = () => tokens[position];
  const take = (type) => (peek()?.type === type ? tokens[position++] : null);
  const startsOperand = (token) => token && (token.type === 'number' || token.type === 'name' || token.type === '(');

  // сумма → произведение → унарный минус → степень → число, имя, функция, скобки
  function parseSum() {
    let left = parseProduct();
    for (;;) {
      if (take('+')) {
        const a = left, b = parseProduct();
        left = (scope) => a(scope) + b(scope);
      } else if (take('-')) {
        const a = left, b = parseProduct();
        left = (scope) => a(scope) - b(scope);
      } else return left;
    }
  }

  function parseProduct() {
    let left = parseUnary();
    for (;;) {
      if (take('*')) {
        const a = left, b = parseUnary();
        left = (scope) => a(scope) * b(scope);
      } else if (take('/')) {
        const a = left, b = parseUnary();
        left = (scope) => a(scope) / b(scope);
      } else if (startsOperand(peek())) {
        const a = left, b = parsePower(); // умножение без знака: 2x, 3(x + 1)
        left = (scope) => a(scope) * b(scope);
      } else return left;
    }
  }

  function parseUnary() {
    if (take('-')) {
      const operand = parseUnary();
      return (scope) => -operand(scope);
    }
    if (take('+')) return parseUnary();
    return parsePower();
  }

  function parsePower() {
    const base = parseAtom();
    if (!take('^')) return base;
    const exponent = parseUnary(); // справа налево: 2^3^2 = 2^9, а -x^2 = -(x^2)
    return (scope) => Math.pow(base(scope), exponent(scope));
  }

  function parseAtom() {
    const token = tokens[position++];
    if (!token) throw new ExprError('выражение обрывается');

    if (token.type === 'number') return () => token.value;

    if (token.type === '(') {
      const inner = parseSum();
      if (!take(')')) throw new ExprError('не закрыта скобка');
      return inner;
    }

    if (token.type === 'name') {
      const name = token.value;
      if (variables.includes(name)) return (scope) => scope[name];

      const lower = name.toLowerCase();
      const fn = FUNCTIONS[ALIASES[lower] ?? lower];
      if (fn && peek()?.type === '(') {
        position++;
        const args = [parseSum()];
        while (take(',')) args.push(parseSum());
        if (!take(')')) throw new ExprError(`не закрыта скобка после ${name}`);
        return (scope) => fn(...args.map((arg) => arg(scope)));
      }
      if (lower in CONSTANTS) return () => CONSTANTS[lower];
      throw new ExprError(fn ? `после ${name} нужны скобки` : `неизвестное имя «${name}»`);
    }
    throw new ExprError(`лишний знак «${token.type}»`);
  }

  const result = parseSum();
  if (position < tokens.length) throw new ExprError(`лишний знак «${tokens[position].type === 'name' ? tokens[position].value : tokens[position].type}»`);
  return result;
}

/** Значение поля, которое может быть числом или выражением в кавычках: 2, "2*pi", "a/2". */
export function compileValue(value, variables = []) {
  if (typeof value === 'number' && Number.isFinite(value)) return () => value;
  if (typeof value === 'string') return compile(value, variables);
  throw new ExprError('ожидалось число или выражение');
}
