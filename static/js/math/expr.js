// Разбор и вычисление математических выражений: «a*x^2 - 5*x + 6», «2*pi», «sqrt(2)/2».
// Нужен графикам (значения функций), тренажёру (ответы) и предпросмотру формул при вводе.
//
// Свой небольшой разбор вместо eval/new Function: выражения приходят от языковой модели и от
// пользователя, исполнять их как код нельзя (и Content-Security-Policy этого не позволит).
// Выражение сначала превращается в дерево (parse), а из дерева — в функцию (compile)
// или в запись LaTeX (render/mathtext.js).
// От страницы и остального приложения модуль не зависит.

export class ExprError extends Error {}

export const CONSTANTS = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI, inf: Infinity };

const log = (x, base) => (base === undefined ? Math.log(x) : Math.log(x) / Math.log(base));
export const FUNCTIONS = {
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
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/√\s*(\d+(?:\.\d+)?|[A-Za-z])/g, ' sqrt($1)') // √2, √x
    .replace(/√/g, ' sqrt')
    .replace(/∞/g, ' inf ')
    .replace(/π/g, ' pi ');
  const tokens = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < text.length) {
    const start = TOKEN.lastIndex;
    const match = TOKEN.exec(text);
    if (!match) {
      if (text.slice(start).trim() === '') break;
      throw new ExprError(`непонятный символ «${text.slice(start).trim()[0]}»`);
    }
    if (match[1] !== undefined) tokens.push({ type: 'number', value: Number(match[1]), text: match[1] });
    else if (match[2] !== undefined) tokens.push({ type: 'name', value: match[2] });
    else tokens.push({ type: match[3] === '**' ? '^' : match[3] });
  }
  return tokens;
}

/**
 * Разобрать выражение в дерево. Узлы: { type: 'number' | 'variable' | 'constant' | 'call' |
 * 'apply' | 'negate' | 'binary' }.
 *
 * variables — список разрешённых имён переменных; неизвестное имя — ошибка сразу при разборе.
 * variables = null — «свободный» разбор для предпросмотра формул: любая буква — переменная,
 * «ab» читается как a·b, «f(x)» — как функция f от x.
 */
export function parse(source, variables = []) {
  if (typeof source !== 'string' || source.trim() === '') throw new ExprError('пустое выражение');
  const symbolic = variables === null;
  const tokens = tokenize(source);
  let position = 0;

  const peek = () => tokens[position];
  const take = (type) => (peek()?.type === type ? tokens[position++] : null);
  const startsOperand = (token) => token && (token.type === 'number' || token.type === 'name' || token.type === '(');
  const binary = (op, left, right, implicit = false) => ({ type: 'binary', op, left, right, implicit });

  // сумма → произведение → унарный минус → степень → число, имя, функция, скобки
  function parseSum() {
    let left = parseProduct();
    for (;;) {
      if (take('+')) left = binary('+', left, parseProduct());
      else if (take('-')) left = binary('-', left, parseProduct());
      else return left;
    }
  }

  function parseProduct() {
    let left = parseUnary();
    for (;;) {
      if (take('*')) left = binary('*', left, parseUnary());
      else if (take('/')) left = binary('/', left, parseUnary());
      else if (startsOperand(peek())) left = binary('*', left, parsePower(), true); // 2x, 3(x + 1)
      else return left;
    }
  }

  function parseUnary() {
    if (take('-')) return { type: 'negate', arg: parseUnary() };
    if (take('+')) return parseUnary();
    return parsePower();
  }

  function parsePower() {
    const base = parseAtom();
    if (!take('^')) return base;
    return binary('^', base, parseUnary()); // справа налево: 2^3^2 = 2^9, а -x^2 = -(x^2)
  }

  function parseArguments(name) {
    position++; // открывающая скобка
    const args = [parseSum()];
    while (take(',')) args.push(parseSum());
    if (!take(')')) throw new ExprError(`не закрыта скобка после ${name}`);
    return args;
  }

  function parseAtom() {
    const token = tokens[position++];
    if (!token) throw new ExprError('выражение обрывается');

    if (token.type === 'number') return { type: 'number', value: token.value, text: token.text };

    if (token.type === '(') {
      const inner = parseSum();
      if (!take(')')) throw new ExprError('не закрыта скобка');
      return { ...inner, grouped: true };
    }

    if (token.type === 'name') {
      const name = token.value;
      if (!symbolic && variables.includes(name)) return { type: 'variable', name };

      const lower = name.toLowerCase();
      const known = ALIASES[lower] ?? lower;
      if (Object.hasOwn(FUNCTIONS, known) && peek()?.type === '(') {
        return { type: 'call', name: known, args: parseArguments(name) };
      }
      if (Object.hasOwn(CONSTANTS, lower)) return { type: 'constant', name: lower };
      if (Object.hasOwn(FUNCTIONS, known)) throw new ExprError(`после ${name} нужны скобки`);
      if (!symbolic) throw new ExprError(`неизвестное имя «${name}»`);

      // Свободный разбор: f(x) — функция, x и alpha — переменные, ab — произведение a·b.
      if (name.length === 1 && peek()?.type === '(' && /[fghFGHPp]/.test(name)) {
        return { type: 'apply', name, args: parseArguments(name) };
      }
      if (name.length === 1 || GREEK.has(lower) || /^[A-Za-z]\d+$/.test(name)) return { type: 'variable', name };
      if (name.length <= 3 && /^[A-Za-z]+$/.test(name)) {
        return [...name].map((letter) => ({ type: 'variable', name: letter }))
          .reduce((left, right) => binary('*', left, right, true));
      }
      throw new ExprError(`непонятное слово «${name}»`);
    }
    throw new ExprError(`лишний знак «${token.type}»`);
  }

  const tree = parseSum();
  if (position < tokens.length) {
    const extra = tokens[position];
    throw new ExprError(`лишний знак «${extra.type === 'name' ? extra.value : extra.type}»`);
  }
  return tree;
}

export const GREEK = new Set([
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'theta', 'lambda', 'mu', 'sigma', 'phi', 'omega', 'rho', 'tau',
]);

const OPERATIONS = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => a / b,
  '^': Math.pow,
};

/** Дерево → функция от набора переменных. Собирается один раз, вызывается сотни раз. */
function evaluator(node) {
  switch (node.type) {
    case 'number': return () => node.value;
    case 'constant': return () => CONSTANTS[node.name];
    case 'variable': return (scope) => scope[node.name];
    case 'negate': {
      const arg = evaluator(node.arg);
      return (scope) => -arg(scope);
    }
    case 'binary': {
      const operation = OPERATIONS[node.op];
      const left = evaluator(node.left);
      const right = evaluator(node.right);
      return (scope) => operation(left(scope), right(scope));
    }
    case 'call': {
      const fn = FUNCTIONS[node.name];
      const args = node.args.map(evaluator);
      return (scope) => fn(...args.map((arg) => arg(scope)));
    }
    default: throw new ExprError('выражение нельзя вычислить');
  }
}

/** Превратить выражение в функцию: compile('a*x^2', ['x', 'a'])({ x: 2, a: 3 }) → 12. */
export function compile(source, variables = []) {
  return evaluator(parse(source, variables));
}

/** Значение поля, которое может быть числом или выражением в кавычках: 2, "2*pi", "a/2". */
export function compileValue(value, variables = []) {
  // Модель иногда заворачивает координату в список: "x": ["cos(a)"] — понимаем и так.
  if (Array.isArray(value) && value.length === 1) return compileValue(value[0], variables);
  if (typeof value === 'number' && Number.isFinite(value)) return () => value;
  if (typeof value === 'string') return compile(value, variables);
  throw new ExprError('ожидалось число или выражение');
}
