// Пустой чат: карточки заготовок, а после выбора — описание заготовки и примеры тем.
import { $, el } from '../dom.js';
import { PRESETS } from '../modes.js';

export function createWelcome({ onChoose, onExample }) {
  const view = $('#chat-empty');
  const cards = $('#presets');
  const details = $('#preset-details');
  const title = $('#preset-title');
  const description = $('#preset-description');
  const examples = $('#preset-examples');

  for (const preset of PRESETS) {
    const card = el('button', { type: 'button', class: 'preset' },
      el('span', { class: 'preset__title' }, preset.action),
      el('span', { class: 'preset__text' }, preset.description),
    );
    card.addEventListener('click', () => onChoose(preset));
    cards.append(el('li', {}, card));
  }
  $('#preset-back').addEventListener('click', () => onChoose(null));

  return {
    /** Показать карточки (mode = null) или выбранную заготовку с примерами. */
    showMode(mode) {
      cards.hidden = mode !== null;
      details.hidden = mode === null;
      if (mode === null) return;
      title.textContent = mode.action ?? mode.title;
      description.textContent = mode.description ?? '';
      examples.replaceChildren(
        ...(mode.examples ?? []).map((example) => {
          const chip = el('button', { type: 'button', class: 'chip' }, example);
          chip.addEventListener('click', () => onExample(example, mode));
          return el('li', {}, chip);
        }),
      );
    },
    setVisible(visible) {
      view.hidden = !visible;
    },
    setDisabled(disabled) {
      for (const button of view.querySelectorAll('button')) button.disabled = disabled;
    },
  };
}
