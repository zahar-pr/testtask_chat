// Блок «plot»: график или чертёж по описанию от модели.
//
// Модель присылает не картинку и не код, а данные: какие функции, точки и отрезки показать.
// Рисует их этот файл — всегда одними и теми же линиями, цветами и шрифтами, поэтому все
// рисунки в чате выглядят одинаково и подстраиваются под тёмную тему и ширину экрана.
// С ползунками («params») рисунок становится наглядным объяснением: двигаешь — и видишь, что меняется.
import { el } from '../dom.js';
import { compile, compileValue } from './expr.js';
import { decimalsFor, formatNumber, niceTicks } from './format.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SERIES_COLORS = 6; // столько различимых цветов в палитре (см. tokens.css)
const LIMITS = { params: 4, functions: 6, curves: 6, shapes: 24, readouts: 6 };
const MARGIN = { top: 12, right: 16, bottom: 30, left: 46 };
const BARE_MARGIN = { top: 14, right: 14, bottom: 14, left: 14 }; // рисунок без осей
const PARAM_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

let clipCounter = 0;

function svg(tag, attributes = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== false && value != null) node.setAttribute(name, value);
  }
  node.append(...children);
  return node;
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

// --- Разбор описания: проверяем поля и заранее превращаем выражения в функции ---

function fail(message) {
  throw new Error(message);
}

function list(value, max, name) {
  if (value == null) return [];
  if (!Array.isArray(value)) fail(`поле «${name}» должно быть списком`);
  return value.filter(isObject).slice(0, max);
}

function normalize(spec) {
  if (!isObject(spec)) fail('описание рисунка должно быть объектом');

  const params = list(spec.params, LIMITS.params, 'params').map((param) => {
    const { name, min, max } = param;
    if (typeof name !== 'string' || !PARAM_NAME.test(name) || name === 'x' || name === 't') {
      fail(`недопустимое имя параметра «${name}»`);
    }
    if (![min, max].every(Number.isFinite) || min >= max) fail(`у параметра ${name} нужны числа min < max`);
    const step = Number.isFinite(param.step) && param.step > 0 ? param.step : (max - min) / 100;
    const value = clamp(Number.isFinite(param.value) ? param.value : (min + max) / 2, min, max);
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

const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

// --- Границы по вертикали, если модель их не задала ---

function autoRange(model, scope) {
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

function functionDomain(item, scope, x0, x1) {
  if (!item.domain) return [x0, x1];
  const [from, to] = item.domain.map((bound) => bound(scope));
  return [Math.max(x0, Math.min(from, to)), Math.min(x1, Math.max(from, to))];
}

// --- Сам рисунок ---

export function createPlot(spec, { renderInline }) {
  const model = normalize(spec);
  const scope = Object.fromEntries(model.params.map((param) => [param.name, param.value]));
  // Границы считаются один раз — при движении ползунка меняется график, а не «уезжают» оси.
  const yRange = model.yRange ?? autoRange(model, scope);

  const picture = svg('svg', { class: 'plot__svg', role: 'img', 'aria-label': model.title ?? 'График' });
  const labels = el('div', { class: 'plot__labels', 'aria-hidden': 'true' });
  const tooltip = el('div', { class: 'plot__tooltip', hidden: true });
  const canvas = el('div', { class: 'plot__canvas' }, picture, labels, tooltip);

  const series = [...model.functions, ...model.curves].filter((item) => item.label);
  const legend = el('ul', { class: 'plot__legend' },
    ...series.map((item) =>
      el('li', { class: 'plot__legend-item' },
        el('span', { class: `plot__swatch${item.dashed ? ' is-dashed' : ''}`, style: `--c: var(--${item.color})` }),
        el('span', {}, renderInline(item.label)),
      ),
    ),
  );

  const readoutValues = model.readouts.map(() => el('span', { class: 'plot__readout-value' }));
  const readouts = el('div', { class: 'plot__readouts' },
    ...model.readouts.map((item, index) =>
      el('span', { class: 'plot__readout' }, item.label ? renderInline(item.label) : '', item.label ? ' = ' : '', readoutValues[index]),
    ),
  );
  const refreshReadouts = () => {
    model.readouts.forEach((item, index) => {
      readoutValues[index].textContent = formatNumber(item.f(scope));
    });
  };

  const controls = el('div', { class: 'plot__params' },
    ...model.params.map((param) => {
      const digits = decimalsFor(param.step);
      const output = el('output', { class: 'plot__param-value' }, formatNumber(param.value, digits));
      const input = el('input', {
        class: 'plot__slider', type: 'range', min: param.min, max: param.max, step: param.step, value: param.value,
        'aria-label': `Параметр ${param.name}`,
      });
      input.addEventListener('input', () => {
        scope[param.name] = Number(input.value);
        output.textContent = formatNumber(scope[param.name], digits);
        refreshReadouts();
        scheduleDraw();
      });
      return el('label', { class: 'plot__param' },
        el('span', { class: 'plot__param-name' }, renderInline(param.label ?? `$${param.name}$`), ' = ', output),
        input,
      );
    }),
  );

  let width = 0;
  let frame = null;
  let view = null; // геометрия последней отрисовки — нужна подсказке под курсором

  function scheduleDraw() {
    if (frame === null) {
      frame = requestAnimationFrame(() => {
        frame = null;
        draw();
      });
    }
  }

  function draw() {
    if (width <= 0) return;
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

    const X = (x) => margin.left + ((x - x0) / (x1 - x0)) * plotWidth;
    const Y = (y) => margin.top + ((y1 - y) / (y1 - y0)) * plotHeight;
    const left = margin.left;
    const right = margin.left + plotWidth;
    const top = margin.top;
    const bottom = margin.top + plotHeight;
    const visible = (px, py) => px >= left - 1 && px <= right + 1 && py >= top - 1 && py <= bottom + 1;
    const paint = (color) => `--c: var(--${color})`;

    picture.setAttribute('viewBox', `0 0 ${width} ${height}`);
    picture.setAttribute('width', width);
    picture.setAttribute('height', height);

    const clipId = `plot-clip-${++clipCounter}`;
    const grid = svg('g', { class: 'plot__grid' });
    const shapes = svg('g', { 'clip-path': `url(#${clipId})` });
    const hover = svg('g', { class: 'plot__hover' });
    const labelNodes = [];

    const addLabel = (px, py, content, placement) => {
      if (!content || !visible(px, py)) return;
      // Подписи — обычный HTML поверх рисунка: так в них работают формулы.
      const side = placement === 'point' && px > right - 90 ? 'point-left' : placement;
      labelNodes.push(
        el('span', { class: `plot__label plot__label--${side}`, style: `left: ${px.toFixed(1)}px; top: ${py.toFixed(1)}px` },
          renderInline(content)),
      );
    };

    // Сетка, оси, подписи отметок
    if (model.axes) {
      const xTicks = niceTicks(x0, x1, plotWidth / 52);
      const yTicks = niceTicks(y0, y1, plotHeight / 40);
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
      if (y0 <= 0 && y1 >= 0) grid.append(svg('line', { class: 'plot__axis', x1: left, x2: right, y1: Y(0), y2: Y(0) }));
      if (x0 <= 0 && x1 >= 0) grid.append(svg('line', { class: 'plot__axis', x1: X(0), x2: X(0), y1: top, y2: bottom }));
    }

    // Ломаная по точкам; разрывы (асимптоты, область определения) разбивают её на части.
    const trace = (count, pointAt) => {
      let path = '';
      let drawing = false;
      let previous = 0;
      for (let index = 0; index <= count; index++) {
        const [x, y] = pointAt(index / count);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          drawing = false;
          continue;
        }
        const py = clamp(Y(y), top - 2 * plotHeight, bottom + 2 * plotHeight);
        if (drawing && Math.abs(py - previous) > plotHeight * 1.5) drawing = false; // скачок через весь рисунок
        path += `${drawing ? 'L' : 'M'}${X(x).toFixed(1)} ${py.toFixed(1)}`;
        drawing = true;
        previous = py;
      }
      return path;
    };
    const samples = clamp(Math.round(plotWidth), 80, 800);
    const local = { ...scope };

    for (const item of model.areas) {
      const from = clamp(item.from(scope), x0, x1);
      const to = clamp(item.to(scope), x0, x1);
      const curve = trace(Math.max(8, Math.round((samples * Math.abs(to - from)) / (x1 - x0))), (share) => {
        local.x = from + (to - from) * share;
        return [local.x, item.f(local)];
      });
      if (curve) {
        const outline = `M${X(from).toFixed(1)} ${Y(0).toFixed(1)}${curve.replace(/M/g, 'L')}L${X(to).toFixed(1)} ${Y(0).toFixed(1)}Z`;
        shapes.append(svg('path', { class: 'plot__area', d: outline, style: paint(item.color) }));
        local.x = (from + to) / 2;
        addLabel(X(local.x), Y(item.f(local) / 2), item.label, 'center');
      }
    }

    for (const item of model.polygons) {
      const points = item.points.map(([x, y]) => [X(x(scope)), Y(y(scope))]);
      if (points.length < 3 || points.flat().some((value) => !Number.isFinite(value))) continue;
      shapes.append(svg('polygon', {
        class: 'plot__polygon', style: paint(item.color),
        points: points.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' '),
      }));
      const center = points.reduce(([sx, sy], [px, py]) => [sx + px / points.length, sy + py / points.length], [0, 0]);
      addLabel(center[0], center[1], item.label, 'center');
    }

    for (const item of model.circles) {
      const [cx, cy] = item.center.map((coordinate) => coordinate(scope));
      const radius = Math.abs(item.r(scope));
      if (![cx, cy, radius].every(Number.isFinite)) continue;
      shapes.append(svg('ellipse', {
        class: `plot__stroke${item.dashed ? ' is-dashed' : ''}`, style: paint(item.color),
        cx: X(cx), cy: Y(cy), rx: (radius / (x1 - x0)) * plotWidth, ry: (radius / (y1 - y0)) * plotHeight,
      }));
      addLabel(X(cx), Y(cy + radius), item.label, 'above');
    }

    for (const item of model.lines) {
      const cls = `plot__stroke plot__stroke--thin${item.dashed ? ' is-dashed' : ''}`;
      if (item.x) {
        const px = X(item.x(scope));
        if (!Number.isFinite(px)) continue;
        shapes.append(svg('line', { class: cls, style: paint(item.color), x1: px, x2: px, y1: top, y2: bottom }));
        addLabel(px, top + 2, item.label, 'beside');
      } else if (item.y) {
        const py = Y(item.y(scope));
        if (!Number.isFinite(py)) continue;
        shapes.append(svg('line', { class: cls, style: paint(item.color), x1: left, x2: right, y1: py, y2: py }));
        addLabel(right - 4, py, item.label, 'point-left');
      }
    }

    for (const item of model.segments) {
      const [ax, ay] = item.from.map((coordinate) => coordinate(scope));
      const [bx, by] = item.to.map((coordinate) => coordinate(scope));
      if (![ax, ay, bx, by].every(Number.isFinite)) continue;
      shapes.append(svg('line', {
        class: `plot__stroke${item.dashed ? ' is-dashed' : ''}`, style: paint(item.color),
        x1: X(ax), y1: Y(ay), x2: X(bx), y2: Y(by),
      }));
      addLabel((X(ax) + X(bx)) / 2, (Y(ay) + Y(by)) / 2, item.label, 'above');
    }

    for (const item of model.functions) {
      const [from, to] = functionDomain(item, scope, x0, x1);
      if (!(to > from)) continue;
      const path = trace(samples, (share) => {
        local.x = from + (to - from) * share;
        return [local.x, item.f(local)];
      });
      shapes.append(svg('path', { class: `plot__curve${item.dashed ? ' is-dashed' : ''}`, d: path, style: paint(item.color) }));
    }

    for (const item of model.curves) {
      const [from, to] = item.t.map((bound) => bound(scope));
      const path = trace(240, (share) => {
        local.t = from + (to - from) * share;
        return [item.x(local), item.y(local)];
      });
      shapes.append(svg('path', { class: `plot__curve${item.dashed ? ' is-dashed' : ''}`, d: path, style: paint(item.color) }));
    }

    for (const item of model.points) {
      const px = X(item.x(scope));
      const py = Y(item.y(scope));
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
      shapes.append(svg('circle', { class: 'plot__point', style: paint(item.color), cx: px, cy: py, r: 4.5 }));
      addLabel(px, py, item.label, 'point');
    }

    picture.replaceChildren(
      svg('defs', {}, svg('clipPath', { id: clipId }, svg('rect', { x: left, y: top, width: plotWidth, height: plotHeight }))),
      grid, shapes, hover,
    );
    labels.replaceChildren(...labelNodes);
    tooltip.hidden = true;
    view = { x0, x1, left, right, top, bottom, plotWidth, X, Y, hover };
  }

  // Подсказка под курсором: значения всех функций в выбранной точке x.
  function showTooltip(event) {
    if (!view || !model.functions.length) return;
    const bounds = picture.getBoundingClientRect();
    const px = event.clientX - bounds.left;
    const py = event.clientY - bounds.top;
    if (px < view.left || px > view.right || py < view.top || py > view.bottom) return hideTooltip();

    const x = view.x0 + ((px - view.left) / view.plotWidth) * (view.x1 - view.x0);
    const rows = [];
    const marks = [svg('line', { class: 'plot__crosshair', x1: px, x2: px, y1: view.top, y2: view.bottom })];
    for (const item of model.functions) {
      const [from, to] = functionDomain(item, scope, view.x0, view.x1);
      const y = item.f({ ...scope, x });
      if (x < from || x > to || !Number.isFinite(y)) continue;
      const markY = view.Y(y);
      if (markY >= view.top && markY <= view.bottom) {
        marks.push(svg('circle', { class: 'plot__point', style: `--c: var(--${item.color})`, cx: px, cy: markY, r: 4.5 }));
      }
      rows.push(el('div', { class: 'plot__tooltip-row' },
        el('span', { class: 'plot__swatch', style: `--c: var(--${item.color})` }),
        el('span', { class: 'plot__tooltip-name' }, item.label ? renderInline(item.label) : renderInline('$y$')),
        el('span', { class: 'plot__tooltip-value' }, formatNumber(y)),
      ));
    }
    if (!rows.length) return hideTooltip();

    view.hover.replaceChildren(...marks);
    tooltip.replaceChildren(el('div', { class: 'plot__tooltip-x' }, renderInline('$x$'), ` = ${formatNumber(x)}`), ...rows);
    tooltip.hidden = false;
    const flip = px > (view.left + view.right) / 2;
    tooltip.style.left = `${px + (flip ? -12 : 12)}px`;
    tooltip.style.top = `${view.top + 6}px`;
    tooltip.classList.toggle('is-flipped', flip);
  }

  function hideTooltip() {
    view?.hover.replaceChildren();
    tooltip.hidden = true;
  }

  picture.addEventListener('pointermove', showTooltip);
  picture.addEventListener('pointerdown', showTooltip);
  picture.addEventListener('pointerleave', hideTooltip);

  // Рисуем, когда блок появился на странице, и перерисовываем при изменении ширины.
  new ResizeObserver(([entry]) => {
    const measured = Math.round(entry.contentRect.width);
    if (measured > 0 && measured !== width) {
      width = measured;
      draw();
    }
  }).observe(canvas);

  refreshReadouts();

  return el('figure', { class: 'widget plot' },
    model.title ? el('figcaption', { class: 'widget__title' }, renderInline(model.title)) : '',
    canvas,
    series.length ? legend : '',
    model.params.length ? controls : '',
    model.readouts.length ? readouts : '',
    model.caption ? el('p', { class: 'widget__caption' }, renderInline(model.caption)) : '',
  );
}
