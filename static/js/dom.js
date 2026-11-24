// Маленькие помощники для работы с DOM — вместо фреймворка.

export const $ = (selector, root = document) => root.querySelector(selector);

/** Создать элемент: el('p', { class: 'note' }, 'текст', дочернийУзел). Строки вставляются как текст. */
export function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === false || value == null) continue;
    node.setAttribute(name, value === true ? '' : value);
  }
  node.append(...children);
  return node;
}

/** Небольшая кнопка действия: kind — оформление (primary, secondary, ghost, danger). */
export function button(label, kind, onClick) {
  const node = el('button', { type: 'button', class: `button button--small button--${kind}` }, label);
  node.addEventListener('click', onClick);
  return node;
}
