// Экран входа: проверка ключа на лету, блокировка кнопки, ошибки от сервера.
import * as api from '../api.js';
import { $ } from '../dom.js';
import { checkAccessKey } from '../validation.js';

export function createLoginView({ onSuccess }) {
  const view = $('#login-view');
  const form = $('#login-form');
  const field = $('#access-key-field');
  const input = $('#access-key');
  const toggle = $('#access-key-toggle');
  const hint = $('#access-key-hint');
  const button = $('#login-button');
  const notice = $('#login-notice');

  const defaultHint = hint.textContent;
  let busy = false;
  let serverError = null;

  function refresh() {
    const check = checkAccessKey(input.value);
    const isError = serverError !== null || check.isError;

    button.disabled = busy || !check.valid;
    button.classList.toggle('is-busy', busy);
    hint.textContent = serverError ?? check.message ?? defaultHint;
    hint.classList.toggle('is-error', isError);
    field.classList.toggle('is-invalid', isError);
    input.setAttribute('aria-invalid', String(isError));
  }

  function shake() {
    field.classList.remove('is-shaking');
    void field.offsetWidth; // перезапуск анимации
    field.classList.add('is-shaking');
  }

  input.addEventListener('input', () => {
    serverError = null;
    refresh();
  });

  toggle.addEventListener('click', () => {
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(reveal));
    toggle.setAttribute('aria-label', reveal ? 'Скрыть ключ' : 'Показать ключ');
    input.focus();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !checkAccessKey(input.value).valid) return;

    busy = true;
    serverError = null;
    refresh();
    try {
      await api.login(input.value);
      input.value = ''; // ключ больше не нужен: дальше работает cookie сессии
      busy = false;
      onSuccess();
    } catch (error) {
      busy = false;
      serverError = error.message;
      refresh();
      shake();
      input.focus();
      input.select();
    }
  });

  return {
    show({ notice: text } = {}) {
      notice.textContent = text ?? '';
      notice.hidden = !text;
      view.hidden = false;
      refresh();
      input.focus();
    },
    hide() {
      view.hidden = true;
    },
  };
}
