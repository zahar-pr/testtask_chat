// Отрисовка: сетка с осями и фигуры рисунка. Каждый вид фигуры — отдельная небольшая функция;
// порядок слоёв задан одним списком (LAYERS).
import { decimalsFor, formatNumber, niceTicks } from '../../math/format.js';
import { clamp } from '../util.js';
import { functionDomain } from './scale.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const POINT_RADIUS = 4.5;
const CURVE_SAMPLES = 240; // точек на параметрическую кривую

export function svg(tag, attributes = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== false && value != null) node.setAttribute(name, value);
  }
  node.append(...children);
  return node;
}

export const colorStyle = (color) => `--c: var(--${color})`;
const dashed = (item, base) => `${base}${item.dashed ? ' is-dashed' : ''}`;
const allFinite = (...values) => values.every(Number.isFinite);
/** Значения пары выражений [x, y] при текущих параметрах. */
const at = (pair, scope) => pair.map((coordinate) => coordinate(scope));

/** Сетка, оси и подписи отметок. */
export function paintGrid(view) {
  const { left, right, top, bottom, X, Y } = view;
  const grid = svg('g', { class: 'plot__grid' });
  const xTicks = niceTicks(view.x0, view.x1, view.plotWidth / 52);
  const yTicks = niceTicks(view.y0, view.y1, view.plotHeight / 40);

  for (const tick of xTicks.ticks) {
    grid.append(
      svg('line', { x1: X(tick), x2: X(tick), y1: top, y2: bottom }),
      svg('text', { x: X(tick), y: bottom + 18, 'text-anchor': 'middle' }, formatNumber(tick, decimalsFor(xTicks.step))),
    );
  }
  for (const tick of yTicks.ticks) {
    grid.append(
      svg('line', { x1: left, x2: right, y1: Y(tick), y2: Y(tick) }),
      svg('text', { x: left - 8, y: Y(tick), 'text-anchor': 'end', 'dominant-baseline': 'central' },
        formatNumber(tick, decimalsFor(yTicks.step))),
    );
  }
  if (view.y0 <= 0 && view.y1 >= 0) grid.append(svg('line', { class: 'plot__axis', x1: left, x2: right, y1: Y(0), y2: Y(0) }));
  if (view.x0 <= 0 && view.x1 >= 0) grid.append(svg('line', { class: 'plot__axis', x1: X(0), x2: X(0), y1: top, y2: bottom }));
  return grid;
}

/**
 * Ломаная по точкам pointAt(доля от 0 до 1) → [x, y]. Разрывы (асимптоты, область определения)
 * разбивают её на части: иначе через весь рисунок прошла бы вертикальная черта.
 */
function trace(view, count, pointAt) {
  const { top, bottom, plotHeight } = view;
  let path = '';
  let drawing = false;
  let previous = 0;
  for (let index = 0; index <= count; index++) {
    const [x, y] = pointAt(index / count);
    if (!allFinite(x, y)) {
      drawing = false;
      continue;
    }
    const py = clamp(view.Y(y), top - 2 * plotHeight, bottom + 2 * plotHeight);
    if (drawing && Math.abs(py - previous) > plotHeight * 1.5) drawing = false; // скачок через весь рисунок
    path += `${drawing ? 'L' : 'M'}${view.X(x).toFixed(1)} ${py.toFixed(1)}`;
    drawing = true;
    previous = py;
  }
  return path;
}

const samplesFor = (view) => clamp(Math.round(view.plotWidth), 80, 800);

// --- Фигуры. Каждая функция получает элемент модели и «холст»:
//     { view, scope, add(узел), label(px, py, текст, положение) } ---

function paintArea(item, { view, scope, add, label }) {
  const from = clamp(item.from(scope), view.x0, view.x1);
  const to = clamp(item.to(scope), view.x0, view.x1);
  const local = { ...scope };
  const valueAt = (x) => {
    local.x = x;
    return item.f(local);
  };
  const count = Math.max(8, Math.round((samplesFor(view) * Math.abs(to - from)) / (view.x1 - view.x0)));
  const curve = trace(view, count, (share) => {
    const x = from + (to - from) * share;
    return [x, valueAt(x)];
  });
  if (!curve) return;
  const baseline = view.Y(0).toFixed(1);
  const outline = `M${view.X(from).toFixed(1)} ${baseline}${curve.replace(/M/g, 'L')}L${view.X(to).toFixed(1)} ${baseline}Z`;
  add(svg('path', { class: 'plot__area', d: outline, style: colorStyle(item.color) }));
  const middle = (from + to) / 2;
  label(view.X(middle), view.Y(valueAt(middle) / 2), item.label, 'center');
}

function paintPolygon(item, { view, scope, add, label }) {
  const points = item.points.map((point) => at(point, scope)).map(([x, y]) => [view.X(x), view.Y(y)]);
  if (points.length < 3 || !allFinite(...points.flat())) return;
  add(svg('polygon', {
    class: 'plot__polygon', style: colorStyle(item.color),
    points: points.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' '),
  }));
  const center = points.reduce(([sx, sy], [px, py]) => [sx + px / points.length, sy + py / points.length], [0, 0]);
  label(center[0], center[1], item.label, 'center');
}

function paintCircle(item, { view, scope, add, label }) {
  const [cx, cy] = at(item.center, scope);
  const radius = Math.abs(item.r(scope));
  if (!allFinite(cx, cy, radius)) return;
  add(svg('ellipse', {
    class: dashed(item, 'plot__stroke'), style: colorStyle(item.color),
    cx: view.X(cx), cy: view.Y(cy),
    rx: (radius / (view.x1 - view.x0)) * view.plotWidth, ry: (radius / (view.y1 - view.y0)) * view.plotHeight,
  }));
  label(view.X(cx), view.Y(cy + radius), item.label, 'above');
}

/** Вертикальная (x) или горизонтальная (y) прямая через весь рисунок: асимптота, уровень. */
function paintLine(item, { view, scope, add, label }) {
  const attributes = { class: dashed(item, 'plot__stroke plot__stroke--thin'), style: colorStyle(item.color) };
  if (item.x) {
    const px = view.X(item.x(scope));
    if (!Number.isFinite(px)) return;
    add(svg('line', { ...attributes, x1: px, x2: px, y1: view.top, y2: view.bottom }));
    label(px, view.top + 2, item.label, 'beside');
  } else if (item.y) {
    const py = view.Y(item.y(scope));
    if (!Number.isFinite(py)) return;
    add(svg('line', { ...attributes, x1: view.left, x2: view.right, y1: py, y2: py }));
    label(view.right - 4, py, item.label, 'point-left');
  }
}

function paintSegment(item, { view, scope, add, label }) {
  const [ax, ay] = at(item.from, scope);
  const [bx, by] = at(item.to, scope);
  if (!allFinite(ax, ay, bx, by)) return;
  add(svg('line', {
    class: dashed(item, 'plot__stroke'), style: colorStyle(item.color),
    x1: view.X(ax), y1: view.Y(ay), x2: view.X(bx), y2: view.Y(by),
  }));
  label((view.X(ax) + view.X(bx)) / 2, (view.Y(ay) + view.Y(by)) / 2, item.label, 'above');
}

function paintFunction(item, { view, scope, add }) {
  const [from, to] = functionDomain(item, scope, view.x0, view.x1);
  if (!(to > from)) return;
  const local = { ...scope };
  const path = trace(view, samplesFor(view), (share) => {
    local.x = from + (to - from) * share;
    return [local.x, item.f(local)];
  });
  add(svg('path', { class: dashed(item, 'plot__curve'), d: path, style: colorStyle(item.color) }));
}

function paintCurve(item, { view, scope, add }) {
  const [from, to] = at(item.t, scope);
  const local = { ...scope };
  const path = trace(view, CURVE_SAMPLES, (share) => {
    local.t = from + (to - from) * share;
    return [item.x(local), item.y(local)];
  });
  add(svg('path', { class: dashed(item, 'plot__curve'), d: path, style: colorStyle(item.color) }));
}

function paintPoint(item, { view, scope, add, label }) {
  const px = view.X(item.x(scope));
  const py = view.Y(item.y(scope));
  if (!allFinite(px, py)) return;
  add(pointMark(px, py, item.color));
  label(px, py, item.label, 'point');
}

/** Кружок-отметка: точка на рисунке или значение функции под курсором. */
export function pointMark(px, py, color) {
  return svg('circle', { class: 'plot__point', style: colorStyle(color), cx: px, cy: py, r: POINT_RADIUS });
}

// Слои рисунка снизу вверх: заливки, контуры, линии, графики, точки.
const LAYERS = [
  ['areas', paintArea], ['polygons', paintPolygon], ['circles', paintCircle], ['lines', paintLine],
  ['segments', paintSegment], ['functions', paintFunction], ['curves', paintCurve], ['points', paintPoint],
];

/** Нарисовать все фигуры модели на «холсте». */
export function paintShapes(model, canvas) {
  for (const [kind, paint] of LAYERS) {
    for (const item of model[kind]) paint(item, canvas);
  }
}
