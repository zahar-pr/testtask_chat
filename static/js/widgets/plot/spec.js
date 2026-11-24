// Описание рисунка от модели → проверенная модель рисунка. Без обращений к странице:
// этот шаг можно проверять тестами и вызывать из автопроверки качества (evals/).
import { compile, compileValue } from '../../math/expr.js';
import { clamp, isObject, text } from '../util.js';

export const SERIES_COLORS = 6; // столько различимых цветов в палитре (см. tokens.css)
const LIMITS = { params: 4, functions: 6, curves: 6, shapes: 24, readouts: 6 };
const PARAM_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

function fail(message) {
  throw new Error(message);
}

function list(value, max, name) {
  if (value == null) return [];
  if (!Array.isArray(value)) fail(`поле «${name}» должно быть списком`);
  return value.filter(isObject).slice(0, max);
}

/**
 * Проверить описание рисунка и подготовить его к отрисовке: границы — числа, выражения — функции,
 * у каждого элемента — цвет. Ошибка в описании — исключение с понятной причиной.
 */
export function normalize(spec) {
  if (!isObject(spec)) fail('описание рисунка должно быть объектом');

  // Границы ползунка могут быть заданы выражением: "max": "2*pi".
  const constant = (value) => (typeof value === 'string' ? compile(value)({}) : value);
  const params = list(spec.params, LIMITS.params, 'params').map((param) => {
    const name = param.name;
    const [min, max, start, stride] = [param.min, param.max, param.value, param.step].map(constant);
    if (typeof name !== 'string' || !PARAM_NAME.test(name) || name === 'x' || name === 't') {
      fail(`недопустимое имя параметра «${name}»`);
    }
    if (![min, max].every(Number.isFinite) || min >= max) fail(`у параметра ${name} нужны числа min < max`);
    const step = Number.isFinite(stride) && stride > 0 ? stride : (max - min) / 100;
    const value = clamp(Number.isFinite(start) ? start : (min + max) / 2, min, max);
    return { name, min, max, step, value, label: text(param.label) };
  });
  const names = params.map((param) => param.name);
  const initial = Object.fromEntries(params.map((param) => [param.name, param.value]));

  const value = (source, extra = []) => compileValue(source, [...names, ...extra]);
  const pair = (source, what) => {
    if (!Array.isArray(source) || source.length !== 2) fail(`«${what}» — это пара [a, b]`);
    return [value(source[0]), value(source[1])];
  };
  const fixedRange = (source, what) => {
    const [from, to] = pair(source, what).map((bound) => bound(initial));
    if (![from, to].every(Number.isFinite) || from >= to) fail(`в «${what}» нужны границы [мин, макс]`);
    return [from, to];
  };

  // Графики получают цвета палитры по порядку; остальным фигурам цвет задаётся явно («color»).
  let nextSeries = 0;
  const seriesColor = (item) => colorOf(item) ?? `series-${(nextSeries++ % SERIES_COLORS) + 1}`;
  const colorOf = (item) =>
    Number.isInteger(item.color) && item.color >= 1 && item.color <= SERIES_COLORS ? `series-${item.color}` : null;

  if (spec.x == null) fail('не заданы границы по горизонтали: "x": [мин, макс]');

  return {
    title: text(spec.title),
    caption: text(spec.caption),
    equal: spec.equal === true,
    axes: spec.axes !== false,
    params,
    xRange: fixedRange(spec.x, 'x'),
    yRange: spec.y == null ? null : fixedRange(spec.y, 'y'),
    functions: list(spec.functions, LIMITS.functions, 'functions').map((item) => ({
      f: compile(item.expr, [...names, 'x']),
      domain: item.domain == null ? null : pair(item.domain, 'domain'),
      label: text(item.label),
      dashed: item.dashed === true,
      color: seriesColor(item),
    })),
    curves: list(spec.curves, LIMITS.curves, 'curves').map((item) => ({
      x: compile(item.x, [...names, 't']),
      y: compile(item.y, [...names, 't']),
      t: pair(item.t, 't'),
      label: text(item.label),
      dashed: item.dashed === true,
      color: seriesColor(item),
    })),
    areas: list(spec.areas, LIMITS.shapes, 'areas').map((item) => ({
      f: compile(item.expr, [...names, 'x']),
      from: value(item.from),
      to: value(item.to),
      label: text(item.label),
      color: colorOf(item) ?? 'series-1',
    })),
    polygons: list(spec.polygons, LIMITS.shapes, 'polygons').map((item) => ({
      points: (Array.isArray(item.points) ? item.points : []).map((point) => pair(point, 'points')),
      label: text(item.label),
      color: colorOf(item) ?? 'series-1',
    })),
    circles: list(spec.circles, LIMITS.shapes, 'circles').map((item) => ({
      center: pair(item.center, 'center'),
      r: value(item.r),
      label: text(item.label),
      dashed: item.dashed === true,
      color: colorOf(item) ?? 'ink',
    })),
    lines: list(spec.lines, LIMITS.shapes, 'lines').map((item) => ({
      x: item.x == null ? null : value(item.x),
      y: item.y == null ? null : value(item.y),
      label: text(item.label),
      dashed: item.dashed !== false,
      color: colorOf(item) ?? 'muted',
    })),
    segments: list(spec.segments, LIMITS.shapes, 'segments').map((item) => ({
      from: pair(item.from, 'from'),
      to: pair(item.to, 'to'),
      label: text(item.label),
      dashed: item.dashed === true,
      color: colorOf(item) ?? 'ink',
    })),
    points: list(spec.points, LIMITS.shapes, 'points').map((item) => ({
      x: value(item.x),
      y: value(item.y),
      label: text(item.label),
      color: colorOf(item) ?? 'ink',
    })),
    readouts: list(spec.readouts, LIMITS.readouts, 'readouts').map((item) => ({
      label: text(item.label),
      f: compile(item.expr, names),
    })),
  };
}
