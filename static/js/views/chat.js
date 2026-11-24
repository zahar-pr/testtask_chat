// Экран чата: история, отправка сообщения, ожидание и ошибки ответа, очистка, выход.
import * as api from '../api.js';
import { $, el } from '../dom.js';
import { timeElement } from '../render/datetime.js';
import { renderMarkdown } from '../render/markdown.js';
import { MESSAGE, checkMessage } from '../validation.js';

const SUGGESTIONS = [
  { label: 'Уравнение', display: 'Решить $x^2 - 5x + 6 = 0$', text: 'Реши уравнение x^2 - 5x + 6 = 0' },
  { label: 'Интеграл', display: 'Найти $\\int x e^{x}\\,dx$', text: 'Найди интеграл от x·e^x по dx' },
  { label: 'Объяснение', display: 'Что такое производная?', text: 'Объясни простыми словами, что такое производная' },
  { label: 'Доказательство', display: 'Почему $\\sqrt{2}$ иррационально?', text: 'Докажи, что корень из 2 — иррациональное число' },
];

const SLOW_ANSWER_MS = 10_000;

export function createChatView({ onSessionLost, onLogout }) {
  const view = $('#chat-view');
  const scroller = $('#chat-scroll');
  const status = $('#chat-status');
  const welcome = $('#chat-empty');
  const suggestions = $('#suggestions');
  const list = $('#messages');
  const form = $('#composer');
  const input = $('#message-input');
  const counter = $('#message-counter');
  const sendButton = $('#send-button');
  const clearButton = $('#clear-button');
  const logoutButton = $('#logout-button');
  const clearDialog = $('#clear-dialog');

  let loaded = false; // история получена с сервера
  let waiting = false; // ждём ответа модели

  // --- Состояние элементов управления ---

  function refresh() {
    const check = checkMessage(input.value);
    counter.textContent = `${check.length} / ${MESSAGE.max}`;
    counter.classList.toggle('is-over', check.over);

    sendButton.disabled = waiting || !loaded || !check.valid;
    sendButton.classList.toggle('is-busy', waiting);
    sendButton.setAttribute('aria-label', waiting ? 'Ждём ответа' : 'Отправить');

    const hasMessages = list.childElementCount > 0;
    welcome.hidden = !loaded || hasMessages;
    clearButton.disabled = waiting || list.querySelector('.message[data-id]') === null;
    for (const button of suggestions.querySelectorAll('button')) button.disabled = waiting;
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  }

  function setStatus(...content) {
    status.replaceChildren(...content);
    status.hidden = content.length === 0;
  }

  const scrollToEnd = () => scroller.scrollTo({ top: scroller.scrollHeight });

  /** true, если ошибка означает, что сессия закончилась и мы ушли на экран входа. */
  function sessionLost(error) {
    if (error.status !== 401) return false;
    onSessionLost();
    return true;
  }

  // --- Сообщения ---

  function userMessage(text, meta) {
    return el('article', { class: 'message message--user' },
      el('div', { class: 'message__main' },
        el('div', { class: 'message__text' }, text),
        el('div', { class: 'message__meta' }, meta),
      ),
    );
  }

  function assistantMessage(content, meta) {
    return el('article', { class: 'message message--assistant' },
      el('div', { class: 'logo', 'aria-hidden': 'true' }, 'ε'),
      el('div', { class: 'message__main' }, content, meta ? el('div', { class: 'message__meta' }, meta) : ''),
    );
  }

  function storedMessage(message) {
    const node = message.role === 'user'
      ? userMessage(message.text, timeElement(message.created_at))
      : assistantMessage(el('div', { class: 'prose' }, renderMarkdown(message.text)), timeElement(message.created_at));
    node.dataset.id = message.id;
    return node;
  }

  function typingIndicator() {
    const label = el('span', { class: 'typing__label' }, 'Решаю…');
    // Честно предупреждаем, если модель отвечает дольше обычного (типичный ответ — 2–5 секунд).
    setTimeout(() => { label.textContent = 'Модель думает дольше обычного, ещё немного…'; }, SLOW_ANSWER_MS);
    return assistantMessage(
      el('div', { class: 'typing', role: 'status' },
        el('span', { class: 'typing__dot' }), el('span', { class: 'typing__dot' }), el('span', { class: 'typing__dot' }),
        label,
      ),
    );
  }

  function markFailed(draft, text, reason) {
    draft.classList.replace('is-sending', 'is-failed');
    $('.message__meta', draft).textContent = 'Не отправлено';

    const dismiss = el('button', { type: 'button', class: 'button button--ghost button--small' }, 'Убрать');
    const retry = el('button', { type: 'button', class: 'button button--secondary button--small' }, 'Повторить');
    dismiss.addEventListener('click', () => {
      draft.remove();
      refresh();
    });
    retry.addEventListener('click', () => {
      draft.remove();
      send(text);
    });
    $('.message__main', draft).append(
      el('div', { class: 'message__error', role: 'alert' }, reason, el('div', { class: 'message__error-actions' }, dismiss, retry)),
    );
  }

  // --- Сценарии ---

  async function load() {
    loaded = false;
    list.replaceChildren();
    setStatus('Загружаем историю…');
    refresh();
    try {
      const messages = await api.listMessages();
      list.append(...messages.map(storedMessage));
      loaded = true;
      setStatus();
    } catch (error) {
      if (sessionLost(error)) return;
      const retry = el('button', { type: 'button', class: 'button button--secondary button--small' }, 'Повторить');
      retry.addEventListener('click', load);
      setStatus(`Не удалось загрузить историю. ${error.message}`, el('div', {}, retry));
    }
    refresh();
    scrollToEnd();
  }

  async function send(rawText) {
    const text = rawText.trim();
    if (waiting || !loaded || !checkMessage(rawText).valid) return;

    for (const failed of list.querySelectorAll('.is-failed')) failed.remove();
    const draft = userMessage(text, 'Отправляется…');
    draft.classList.add('is-sending', 'is-new');
    const typing = typingIndicator();
    typing.classList.add('is-new');
    list.append(draft, typing);

    waiting = true;
    refresh();
    scrollToEnd();

    try {
      const exchange = await api.sendMessage(rawText);
      const question = storedMessage(exchange.user);
      draft.replaceWith(question);
      const answer = storedMessage(exchange.assistant);
      answer.classList.add('is-new');
      typing.replaceWith(answer);
      // Показываем вопрос у верхнего края: длинный ответ читается с начала, а не с конца.
      question.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      typing.remove();
      if (sessionLost(error)) return;
      markFailed(draft, text, error.message);
      scrollToEnd();
    } finally {
      waiting = false;
      refresh();
    }
  }

  async function clearHistory() {
    try {
      await api.clearMessages();
      list.replaceChildren();
      refresh();
      input.focus();
    } catch (error) {
      if (!sessionLost(error)) alert(`Не удалось очистить историю. ${error.message}`);
    }
  }

  // --- События ---

  for (const suggestion of SUGGESTIONS) {
    const button = el('button', { type: 'button', class: 'suggestion' },
      el('span', { class: 'suggestion__label' }, suggestion.label),
      el('span', { class: 'suggestion__text' }, unwrap(renderMarkdown(suggestion.display))),
    );
    button.addEventListener('click', () => send(suggestion.text));
    suggestions.append(el('li', {}, button));
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
    if (waiting || !checkMessage(text).valid) return;
    input.value = '';
    autosize();
    send(text);
  });

  clearButton.addEventListener('click', () => clearDialog.showModal());
  clearDialog.addEventListener('close', () => {
    if (clearDialog.returnValue === 'confirm') clearHistory();
    clearDialog.returnValue = '';
  });

  logoutButton.addEventListener('click', async () => {
    await api.logout().catch(() => {}); // даже если сеть пропала, с экрана чата уходим
    onLogout();
  });

  return {
    show() {
      view.hidden = false;
      input.focus();
      load();
    },
    hide() {
      view.hidden = true;
      list.replaceChildren();
      setStatus();
      if (clearDialog.open) clearDialog.close();
    },
  };
}

/** Содержимое единственного абзаца без обёртки <p> — для коротких подписей с формулами. */
function unwrap(fragment) {
  const result = document.createDocumentFragment();
  result.append(...fragment.firstChild.childNodes);
  return result;
}
