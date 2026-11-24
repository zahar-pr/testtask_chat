// Блок «plot»: график или чертёж по описанию от модели.
//
// Модель присылает не картинку и не код, а данные: какие функции, точки и отрезки показать.
// Рисует их приложение — всегда одними и теми же линиями, цветами и шрифтами, поэтому все
// рисунки в чате выглядят одинаково и подстраиваются под тёмную тему и ширину экрана.
// С ползунками («params») рисунок становится наглядным объяснением: двигаешь — и видишь, что меняется.
//
//   spec.js    — проверка описания        scale.js   — границы и перевод координат в пиксели
//   shapes.js  — сетка и фигуры           tooltip.js — значения под курсором
import { el } from '../../dom.js';
import { decimalsFor, formatNumber } from '../../math/format.js';
import { autoRange, createView } from './scale.js';
import { colorStyle, paintGrid, paintShapes, svg } from './shapes.js';
import { normalize } from './spec.js';
import { attachTooltip } from './tooltip.js';

let clipCounter = 0; // у каждого рисунка своя область обрезки

export function createPlot(spec, { renderInline }) {
  const model = normalize(spec);
  const scope = Object.fromEntries(model.params.map((param) => [param.name, param.value]));
  // Границы считаются один раз — при движении ползунка меняется график, а не «уезжают» оси.
  const yRange = model.yRange ?? autoRange(model, scope);

  const picture = svg('svg', { class: 'plot__svg', role: 'img', 'aria-label': model.title ?? 'График' });
  const labels = el('div', { class: 'plot__labels', 'aria-hidden': 'true' });
  const tooltipBox = el('div', { class: 'plot__tooltip', hidden: true });
  const canvas = el('div', { class: 'plot__canvas' }, picture, labels, tooltipBox);

  let width = 0;
  let frame = null;
  let drawn = null; // { view, scope, layer } последней отрисовки — нужно подсказке под курсором
  const tooltip = attachTooltip({ picture, box: tooltipBox, model, renderInline, current: () => drawn });

  function draw() {
    if (width <= 0) return;
    const view = createView(model, yRange, width);
    const clipId = `plot-clip-${++clipCounter}`;
    const shapes = svg('g', { 'clip-path': `url(#${clipId})` });
    const layer = svg('g', { class: 'plot__hover' });
    const labelNodes = [];

    paintShapes(model, {
      view,
      scope,
      add: (node) => shapes.append(node),
      // Подписи — обычный HTML поверх рисунка: так в них работают формулы.
      label(px, py, content, placement) {
        if (!content || !view.contains(px, py)) return;
        const side = placement === 'point' && px > view.right - 90 ? 'point-left' : placement;
        labelNodes.push(
          el('span', { class: `plot__label plot__label--${side}`, style: `left: ${px.toFixed(1)}px; top: ${py.toFixed(1)}px` },
            renderInline(content)),
        );
      },
    });

    picture.setAttribute('viewBox', `0 0 ${view.width} ${view.height}`);
    picture.setAttribute('width', view.width);
    picture.setAttribute('height', view.height);
    picture.replaceChildren(
      svg('defs', {}, svg('clipPath', { id: clipId },
        svg('rect', { x: view.left, y: view.top, width: view.plotWidth, height: view.plotHeight }))),
      model.axes ? paintGrid(view) : '',
      shapes,
      layer,
    );
    labels.replaceChildren(...labelNodes);
    drawn = { view, scope, layer };
    tooltip.hide();
  }

  function scheduleDraw() {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      draw();
    });
  }

  // Рисуем, когда блок появился на странице, и перерисовываем при изменении ширины.
  new ResizeObserver(([entry]) => {
    const measured = Math.round(entry.contentRect.width);
    if (measured > 0 && measured !== width) {
      width = measured;
      draw();
    }
  }).observe(canvas);

  const readouts = createReadouts(model, scope, renderInline);
  const sliders = createSliders(model, scope, renderInline, () => {
    readouts.refresh();
    scheduleDraw();
  });

  return el('figure', { class: 'widget plot' },
    model.title ? el('figcaption', { class: 'widget__title' }, renderInline(model.title)) : '',
    canvas,
    createLegend(model, renderInline),
    sliders,
    readouts.node,
    model.caption ? el('p', { class: 'widget__caption' }, renderInline(model.caption)) : '',
  );
}

/** Легенда: образец линии и подпись у каждого графика с названием. */
function createLegend(model, renderInline) {
  const series = [...model.functions, ...model.curves].filter((item) => item.label);
  if (!series.length) return '';
  return el('ul', { class: 'plot__legend' },
    ...series.map((item) =>
      el('li', { class: 'plot__legend-item' },
        el('span', { class: `plot__swatch${item.dashed ? ' is-dashed' : ''}`, style: colorStyle(item.color) }),
        el('span', {}, renderInline(item.label)),
      ),
    ),
  );
}

/** Значения, которые пересчитываются при движении ползунков («readouts»). */
function createReadouts(model, scope, renderInline) {
  if (!model.readouts.length) return { node: '', refresh() {} };
  const values = model.readouts.map(() => el('span', { class: 'plot__readout-value' }));
  const refresh = () => {
    model.readouts.forEach((item, index) => {
      values[index].textContent = formatNumber(item.f(scope));
    });
  };
  refresh();
  const node = el('div', { class: 'plot__readouts' },
    ...model.readouts.map((item, index) =>
      el('span', { class: 'plot__readout' }, item.label ? renderInline(item.label) : '', item.label ? ' = ' : '', values[index]),
    ),
  );
  return { node, refresh };
}

/** Ползунки параметров: меняют значение в scope и сообщают об этом через onChange. */
function createSliders(model, scope, renderInline, onChange) {
  if (!model.params.length) return '';
  return el('div', { class: 'plot__params' },
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
        onChange();
      });
      return el('label', { class: 'plot__param' },
        el('span', { class: 'plot__param-name' }, renderInline(param.label ?? `$${param.name}$`), ' = ', output),
        input,
      );
    }),
  );
}
