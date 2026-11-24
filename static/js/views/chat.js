// Экран чата: какой чат открыт, загрузка истории, отправка вопроса и приём ответа, очистка, выход.
// Сам экран только связывает части между собой:
//   sidebar.js — список чатов · messages.js — лента · composer.js — поле ввода ·
//   welcome.js — заготовки в пустом чате · progress.js — «Мой прогресс».
import * as api from '../api.js';
import { $, el } from '../dom.js';
import { modeById } from '../modes.js';
import { checkMessage } from '../validation.js';
import { createComposer } from './composer.js';
import { confirmAction, notify } from './confirm.js';
import { createMessageList } from './messages.js';
import { createProgressPanel } from './progress.js';
import { createSidebar } from './sidebar.js';
import { createWelcome } from './welcome.js';

export function createChatView({ onSessionLost, onLogout }) {
  const view = $('#chat-view');
  const status = $('#chat-status');
  const clearButton = $('#clear-button');

  let chatId = null; // открытый чат; null — новый, он сохранится вместе с первым ответом
  let opening = 0; // номер последнего открытия чата: ответ на устаревший запрос истории игнорируем
  let loaded = false; // история открытого чата получена с сервера
  let waiting = false; // ждём ответа модели
  let abort = null; // AbortController идущего запроса — для кнопки «Остановить»

  const sidebar = createSidebar({
    onSelect: (id) => open(id),
    onNew() {
      open(null);
      composer.focus();
    },
    onProgress: () => progress.open(),
  });

  // «Мой прогресс»: результаты тренажёров и тренировка по своим ошибкам в новом чате.
  const progress = createProgressPanel({
    onSessionLost,
    async onReview() {
      await open(null);
      send('Потренируй меня на моих ошибках', modeById('review'));
    },
  });

  const messages = createMessageList({
    // Прогресс — не главное: сбой записи результата чат не прерывает.
    recordAttempt: (messageId, result) => api.saveAttempt({ message_id: messageId, ...result }).catch(() => {}),
    onFollowup: (item) => send(item.text, modeById(item.mode)),
    onRegenerate: (question) => send(question.text, modeById(question.mode), { replaceLast: true }),
    onEdit: (question) => composer.startEditing(question.text, modeById(question.mode), true),
    onChange: refresh,
  });

  const welcome = createWelcome({
    onChoose: (mode) => composer.chooseMode(mode),
    onExample: (text, mode) => send(text, mode),
  });

  const composer = createComposer({
    onSubmit: ({ text, mode, replaceLast }) => send(text, mode, { replaceLast }),
    onStop: () => abort?.abort(),
    onModeChange: (mode) => welcome.showMode(mode),
    onEditingChange: refresh,
  });

  // --- Состояние элементов управления ---

  function refresh() {
    composer.setState({ busy: waiting, ready: loaded });
    welcome.setVisible(loaded && messages.isEmpty);
    welcome.setDisabled(waiting);
    clearButton.disabled = waiting || chatId === null;
    sidebar.setDisabled(waiting);
    messages.refreshActions(loaded && !waiting && !composer.editing);
  }

  function setStatus(message, onRetry) {
    status.hidden = message === undefined;
    if (message === undefined) return status.replaceChildren();
    if (!onRetry) return status.replaceChildren(message);
    const retry = el('button', { type: 'button', class: 'button button--secondary button--small' }, 'Повторить');
    retry.addEventListener('click', onRetry);
    status.replaceChildren(message, el('div', {}, retry));
  }

  /** true, если ошибка означает, что сессия закончилась и мы ушли на экран входа. */
  function sessionLost(error) {
    if (error.status !== 401) return false;
    onSessionLost();
    return true;
  }

  // --- Какой чат открыт ---

  // Адрес страницы помнит открытый чат (#12, #new): он переживает перезагрузку и работает кнопка «Назад».
  function chatFromAddress() {
    const value = location.hash.slice(1);
    if (value === 'new') return null;
    return /^\d+$/.test(value) ? Number(value) : undefined; // undefined — в адресе чат не указан
  }

  function rememberInAddress(id) {
    const hash = id === null ? '#new' : `#${id}`;
    if (location.hash !== hash) location.hash = hash;
  }

  /** Загрузить список чатов и открыть нужный: из адреса страницы или последний по времени. */
  async function start() {
    loaded = false;
    messages.clear();
    setStatus('Загружаем чаты…');
    refresh();
    try {
      sidebar.setChats(await api.listChats());
    } catch (error) {
      if (!sessionLost(error)) setStatus(`Не удалось загрузить чаты. ${error.message}`, start);
      return;
    }
    const wanted = chatFromAddress();
    await open(wanted !== undefined && (wanted === null || sidebar.has(wanted)) ? wanted : sidebar.latest());
  }

  /** Открыть сохранённый чат или (id = null) пустой новый. */
  async function open(id) {
    const attempt = ++opening;
    chatId = id;
    loaded = id === null;
    sidebar.setActive(id);
    rememberInAddress(id);
    composer.clearMode();
    messages.clear();
    setStatus(id === null ? undefined : 'Загружаем историю…');
    refresh();
    if (id === null) return;

    try {
      const history = await api.listMessages(id);
      if (attempt !== opening) return; // пока грузилось, открыли другой чат
      messages.showHistory(history);
      loaded = true;
      setStatus();
    } catch (error) {
      if (attempt !== opening || sessionLost(error)) return;
      if (error.status === 404) { // чат удалили в другой вкладке
        sidebar.remove(id);
        open(null);
        return;
      }
      setStatus(`Не удалось загрузить историю. ${error.message}`, () => open(id));
    }
    refresh();
  }

  // --- Вопрос и ответ ---

  /**
   * Отправить вопрос в открытый чат. usedMode — заготовка для этого сообщения;
   * replaceLast — вопрос заменяет последнюю пару чата: «ответить заново» и правка вопроса.
   */
  async function send(rawText, usedMode = null, { replaceLast = false } = {}) {
    const text = rawText.trim();
    if (waiting || !loaded || !checkMessage(rawText).valid) return;

    composer.clearMode(); // заготовка действует на одно сообщение
    const pending = messages.begin(text, usedMode?.id ?? null, { replaceLast });
    waiting = true;
    abort = new AbortController();
    refresh();
    messages.scrollToEnd();

    try {
      const exchange = await api.sendMessage(rawText, {
        chatId,
        mode: usedMode?.id ?? null,
        replaceLast: pending.replacesLast,
        signal: abort.signal,
        onDelta: pending.push,
        onReset: pending.reset,
      });
      await pending.complete(exchange);
      // Новый чат сохранился вместе с первым ответом — теперь у него есть номер и место в списке.
      chatId = exchange.chat.id;
      sidebar.upsert(exchange.chat);
      sidebar.setActive(chatId);
      rememberInAddress(chatId);
    } catch (error) {
      if (error.status === 401) {
        pending.discard();
        onSessionLost();
        return;
      }
      pending.fail(error, {
        onRetry: () => send(text, usedMode, { replaceLast: pending.replacesLast }),
        onEdit: () => composer.startEditing(text, usedMode, pending.replacesLast),
      });
    } finally {
      waiting = false;
      abort = null;
      refresh();
    }
  }

  /** «Очистить»: удалить открытый чат со всеми сообщениями и начать новый. */
  async function clearChat() {
    const id = chatId;
    const confirmed = await confirmAction({
      title: 'Очистить этот чат?',
      text: 'Чат и все его сообщения будут удалены без возможности восстановления. Остальные чаты останутся.',
      action: 'Очистить',
    });
    if (!confirmed || id === null) return;
    try {
      await api.deleteChat(id);
      sidebar.remove(id);
      await open(null);
      composer.focus();
    } catch (error) {
      if (!sessionLost(error)) notify(`Не удалось очистить чат. ${error.message}`);
    }
  }

  // --- События ---

  clearButton.addEventListener('click', clearChat);
  $('#logout-button').addEventListener('click', async () => {
    await api.logout().catch(() => {}); // даже если сеть пропала, с экрана чата уходим
    onLogout();
  });

  // Адрес изменили вручную или кнопкой «Назад» — открываем указанный в нём чат.
  window.addEventListener('hashchange', () => {
    const wanted = chatFromAddress();
    if (view.hidden || wanted === undefined || wanted === chatId) return;
    if (waiting) rememberInAddress(chatId); // пока идёт ответ, остаёмся в текущем чате
    else open(wanted);
  });

  return {
    show() {
      view.hidden = false;
      composer.focus();
      start();
    },
    hide() {
      view.hidden = true;
      opening += 1;
      abort?.abort();
      chatId = null;
      loaded = false;
      sidebar.close();
      sidebar.setChats([]);
      composer.reset();
      messages.clear();
      setStatus();
      for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    },
  };
}
