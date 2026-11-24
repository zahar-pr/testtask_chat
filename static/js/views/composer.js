// Поле ввода и всё вокруг него: счётчик, предпросмотр формул, кнопки символов, выбор заготовки,
// правка последнего вопроса, кнопки «Отправить» и «Остановить».
import { $, el } from '../dom.js';
import { PRESETS } from '../modes.js';
import { findMath, renderMathText } from '../render/mathtext.js';
import { MESSAGE, checkMessage } from '../validation.js';

// caret — на сколько символов от конца вставки отступить курсору: sqrt(|)
const SYMBOLS = [
  { label: 'x²', insert: '^2', title: 'Квадрат' },
  { label: 'xⁿ', insert: '^', title: 'Степень' },
  { label: '√', insert: 'sqrt()', caret: 1, title: 'Корень' },
  { label: 'a/b', insert: '/', title: 'Дробь' },
  { label: '( )', insert: '()', caret: 1, title: 'Скобки' },
  { label: 'π', insert: 'π', title: 'Число пи' },
  { label: '≤', insert: ' ≤ ' }, { label: '≥', insert: ' ≥ ' }, { label: '≠', insert: ' ≠ ' },
  { label: '∞', insert: '∞', title: 'Бесконечность' },
];
const SYMBOLS_SETTING = 'epsilon.symbols'; // помним только, открыта ли панель символов

/**
 * onSubmit({ text, mode, replaceLast }) — пользователь отправил вопрос;
 * onStop() — нажал «Остановить»; onModeChange(mode) — выбрал или снял заготовку;
 * onEditingChange() — начал или отменил правку последнего вопроса.
 */
export function createComposer({ onSubmit, onStop, onModeChange, onEditingChange }) {
  const form = $('#composer');
  const input = $('#message-input');
  const counter = $('#message-counter');
  const sendButton = $('#send-button');
  const stopButton = $('#stop-button');
  const preview = $('#input-preview');
  const symbols = $('#symbols');
  const symbolsToggle = $('#symbols-toggle');
  const modeButton = $('#mode-button');
  const modeLabel = $('#mode-label');
  const modeClear = $('#mode-clear');
  const modeMenu = $('#mode-menu');
  const editBanner = $('#edit-banner');

  const defaultPlaceholder = input.placeholder;

  let mode = null; // выбранная заготовка; действует на одно сообщение
  let editing = false; // в поле — последний вопрос чата: отправка заменит его и ответ
  let busy = false; // модель отвечает
  let ready = false; // чат открыт, можно писать

  function refresh() {
    const check = checkMessage(input.value);
    counter.textContent = `${check.length} / ${MESSAGE.max}`;
    counter.classList.toggle('is-over', check.over);

    // Предпросмотр: если в набранном тексте есть формулы, показываем, как они будут выглядеть.
    const formulas = findMath(input.value);
    preview.hidden = formulas.length === 0;
    preview.replaceChildren(formulas.length ? renderMathText(input.value, formulas) : '');

    sendButton.disabled = busy || !ready || !check.valid;
    sendButton.classList.toggle('is-busy', busy);
    sendButton.setAttribute('aria-label', busy ? 'Ждём ответа' : 'Отправить');
    stopButton.hidden = !busy;
    editBanner.hidden = !editing;
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  }

  function setText(text) {
    input.value = text;
    autosize();
    refresh();
  }

  // --- Заготовка: кнопка и меню ---

  function setMenuOpen(open) {
    modeMenu.hidden = !open;
    modeButton.setAttribute('aria-expanded', String(open));
  }

  function setMode(next) {
    mode = next;
    modeLabel.textContent = mode ? mode.title : 'Заготовки';
    modeButton.classList.toggle('is-active', mode !== null);
    modeClear.hidden = mode === null;
    input.placeholder = mode?.placeholder ?? defaultPlaceholder;
    for (const option of modeMenu.querySelectorAll('[role=menuitemradio]')) {
      option.setAttribute('aria-checked', String(option.dataset.mode === mode?.id));
    }
    setMenuOpen(false);
    onModeChange(mode);
  }

  function chooseMode(next) {
    setMode(next);
    input.focus();
  }

  for (const preset of PRESETS) {
    const option = el('button', { type: 'button', class: 'mode__option', role: 'menuitemradio', 'aria-checked': 'false', 'data-mode': preset.id },
      el('span', { class: 'mode__option-title' }, preset.action),
      el('span', { class: 'mode__option-text' }, preset.description),
    );
    option.addEventListener('click', () => chooseMode(preset));
    modeMenu.append(el('li', { role: 'none' }, option));
  }
  modeButton.addEventListener('click', () => setMenuOpen(modeMenu.hidden));
  modeClear.addEventListener('click', () => chooseMode(null));
  document.addEventListener('click', (event) => {
    if (!modeMenu.hidden && !event.target.closest('.mode')) setMenuOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modeMenu.hidden) {
      setMenuOpen(false);
      modeButton.focus();
    }
  });

  // --- Кнопки математических символов ---

  function insertAtCursor({ insert, caret = 0 }) {
    const { selectionStart: start, selectionEnd: end, value } = input;
    input.value = value.slice(0, start) + insert + value.slice(end);
    const position = start + insert.length - caret;
    input.setSelectionRange(position, position);
    input.focus();
    autosize();
    refresh();
  }

  function setSymbolsShown(shown) {
    symbols.hidden = !shown;
    symbolsToggle.setAttribute('aria-pressed', String(shown));
    symbolsToggle.classList.toggle('is-active', shown);
    try {
      localStorage.setItem(SYMBOLS_SETTING, shown ? '1' : '0');
    } catch { /* хранилище недоступно — просто не запомним */ }
  }

  for (const symbol of SYMBOLS) {
    const button = el('button', { type: 'button', class: 'composer__symbol', title: symbol.title ?? null }, symbol.label);
    button.addEventListener('click', () => insertAtCursor(symbol));
    symbols.append(button);
  }
  symbolsToggle.addEventListener('click', () => setSymbolsShown(symbols.hidden));
  try {
    setSymbolsShown(localStorage.getItem(SYMBOLS_SETTING) === '1');
  } catch { /* без хранилища панель просто скрыта */ }

  // --- Ввод и отправка ---

  function stopEditing() {
    editing = false;
    setText('');
    setMode(null);
    onEditingChange();
  }

  input.addEventListener('input', () => {
    autosize();
    refresh();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value;
    if (busy || !ready || !checkMessage(text).valid) return;
    const submitted = { text, mode, replaceLast: editing };
    editing = false;
    setText('');
    setMode(null); // заготовка действует на одно сообщение
    onSubmit(submitted);
  });
  stopButton.addEventListener('click', onStop);
  $('#edit-cancel').addEventListener('click', () => {
    stopEditing();
    input.focus();
  });

  return {
    get mode() {
      return mode;
    },
    get editing() {
      return editing;
    },
    setMode,
    chooseMode,
    /** busy — модель отвечает; ready — чат открыт и в него можно писать. */
    setState(state) {
      ({ busy, ready } = state);
      refresh();
    },
    /** Вернуть вопрос в поле, чтобы исправить его; replacesLast — отправка заменит последнюю пару чата. */
    startEditing(text, usedMode, replacesLast) {
      setMode(usedMode);
      editing = replacesLast;
      setText(text);
      onEditingChange();
      input.focus();
    },
    /** Снять заготовку и правку, не трогая набранный текст: вопрос ушёл другим путём (кнопкой, примером). */
    clearMode() {
      editing = false;
      setMode(null);
      refresh();
    },
    reset() {
      editing = false;
      setText('');
      setMode(null);
    },
    focus: () => input.focus(),
  };
}
