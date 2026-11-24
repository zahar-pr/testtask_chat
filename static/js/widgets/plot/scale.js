// Геометрия рисунка: границы по осям и перевод математических координат в пиксели.
import { clamp } from '../util.js';

const MARGIN = { top: 12, right: 16, bottom: 30, left: 46 };
const BARE_MARGIN = { top: 14, right: 14, bottom: 14, left: 14 }; // рисунок без осей

/** Границы по вертикали, если модель их не задала: по значениям всего, что есть на рисунке. */
export function autoRange(model, scope) {
  const [x0, x1] = model.xRange;
  const values = [];
  const add = (y) => Number.isFinite(y) && values.push(y);

  const curveValues = [];
  for (const item of model.functions) {
    const [from, to] = functionDomain(item, scope, x0, x1);
    for (let index = 0; index <= 200; index++) {
      const y = item.f({ ...scope, x: from + ((to - from) * index) / 200 });
      if (Number.isFinite(y)) curveValues.push(y);
    }
  }
  if (curveValues.length) {
    // У функций с асимптотами (tg x, 1/x) значения уходят в бесконечность: берём «основную массу»
    // значений с запасом, а не абсолютные минимум и максимум.
    curveValues.sort((a, b) => a - b);
    const at = (share) => curveValues[Math.round((curveValues.length - 1) * share)];
    const spread = at(0.95) - at(0.05) || 1;
    add(Math.max(curveValues[0], at(0.05) - spread));
    add(Math.min(curveValues[curveValues.length - 1], at(0.95) + spread));
  }
  for (const item of model.curves) {
    const [from, to] = item.t.map((bound) => bound(scope));
    for (let index = 0; index <= 120; index++) add(item.y({ ...scope, t: from + ((to - from) * index) / 120 }));
  }
  if (model.areas.length) add(0);
  for (const item of model.polygons) item.points.forEach(([, y]) => add(y(scope)));
  for (const item of model.circles) {
    add(item.center[1](scope) + Math.abs(item.r(scope)));
    add(item.center[1](scope) - Math.abs(item.r(scope)));
  }
  for (const item of model.lines) if (item.y) add(item.y(scope));
  for (const item of model.segments) [item.from, item.to].forEach(([, y]) => add(y(scope)));
  for (const item of model.points) add(item.y(scope));

  if (!values.length) return [-1, 1];
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 1e-9) [min, max] = [min - 1, max + 1];
  const padding = (max - min) * 0.1;
  return [min - padding, max + padding];
}

/** Где рисовать функцию: её собственная область (domain), обрезанная границами рисунка. */
export function functionDomain(item, scope, x0, x1) {
  if (!item.domain) return [x0, x1];
  const [from, to] = item.domain.map((bound) => bound(scope));
  return [Math.max(x0, Math.min(from, to)), Math.min(x1, Math.max(from, to))];
}

/**
 * «Вид» рисунка заданной ширины: размеры области построения, границы по осям и функции X, Y,
 * переводящие координаты в пиксели. Пересчитывается при каждой отрисовке.
 */
export function createView(model, yRange, width) {
  const margin = model.axes ? MARGIN : BARE_MARGIN;
  const height = Math.round(clamp(width * 0.62, 200, 380));
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  let [x0, x1] = model.xRange;
  let [y0, y1] = yRange;
  if (model.equal) {
    // Одинаковый масштаб осей: окружность остаётся окружностью, прямой угол — прямым.
    const unit = Math.min(plotWidth / (x1 - x0), plotHeight / (y1 - y0));
    const centerX = (x0 + x1) / 2;
    const centerY = (y0 + y1) / 2;
    [x0, x1] = [centerX - plotWidth / unit / 2, centerX + plotWidth / unit / 2];
    [y0, y1] = [centerY - plotHeight / unit / 2, centerY + plotHeight / unit / 2];
  }

  const left = margin.left;
  const top = margin.top;
  const right = left + plotWidth;
  const bottom = top + plotHeight;
  return {
    width, height, plotWidth, plotHeight, left, right, top, bottom, x0, x1, y0, y1,
    X: (x) => left + ((x - x0) / (x1 - x0)) * plotWidth,
    Y: (y) => top + ((y1 - y) / (y1 - y0)) * plotHeight,
    /** Попадает ли точка (в пикселях) в область построения. */
    contains: (px, py) => px >= left - 1 && px <= right + 1 && py >= top - 1 && py <= bottom + 1,
  };
}
