// Подсказка под курсором: значения всех функций рисунка в выбранной точке x.
import { el } from '../../dom.js';
import { formatNumber } from '../../math/format.js';
import { functionDomain } from './scale.js';
import { colorStyle, pointMark, svg } from './shapes.js';

/**
 * picture — SVG рисунка; box — блок подсказки; current() → { view, scope, layer } на момент
 * последней отрисовки (layer — группа SVG для перекрестия и отметок).
 */
export function attachTooltip({ picture, box, model, renderInline, current }) {
  function hide() {
    current()?.layer.replaceChildren();
    box.hidden = true;
  }

  function show(event) {
    const state = current();
    if (!state || !model.functions.length) return;
    const { view, scope, layer } = state;
    const bounds = picture.getBoundingClientRect();
    const px = event.clientX - bounds.left;
    const py = event.clientY - bounds.top;
    if (px < view.left || px > view.right || py < view.top || py > view.bottom) return hide();

    const x = view.x0 + ((px - view.left) / view.plotWidth) * (view.x1 - view.x0);
    const marks = [svg('line', { class: 'plot__crosshair', x1: px, x2: px, y1: view.top, y2: view.bottom })];
    const rows = [];
    for (const item of model.functions) {
      const [from, to] = functionDomain(item, scope, view.x0, view.x1);
      const y = item.f({ ...scope, x });
      if (x < from || x > to || !Number.isFinite(y)) continue;
      const markY = view.Y(y);
      if (markY >= view.top && markY <= view.bottom) marks.push(pointMark(px, markY, item.color));
      rows.push(el('div', { class: 'plot__tooltip-row' },
        el('span', { class: 'plot__swatch', style: colorStyle(item.color) }),
        el('span', { class: 'plot__tooltip-name' }, renderInline(item.label ?? '$y$')),
        el('span', { class: 'plot__tooltip-value' }, formatNumber(y)),
      ));
    }
    if (!rows.length) return hide();

    layer.replaceChildren(...marks);
    box.replaceChildren(el('div', { class: 'plot__tooltip-x' }, renderInline('$x$'), ` = ${formatNumber(x)}`), ...rows);
    box.hidden = false;
    const flip = px > (view.left + view.right) / 2; // у правого края подсказка уходит влево от курсора
    box.style.left = `${px + (flip ? -12 : 12)}px`;
    box.style.top = `${view.top + 6}px`;
    box.classList.toggle('is-flipped', flip);
  }

  picture.addEventListener('pointermove', show);
  picture.addEventListener('pointerdown', show);
  picture.addEventListener('pointerleave', hide);
  return { hide };
}
