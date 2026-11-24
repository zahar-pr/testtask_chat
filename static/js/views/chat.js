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

export function createChatView({ onLogout }) {
  const view = $('#chat-view');
  const status = $('#chat-status');
  const clearButton = $('#clear-button');

  // Состояние экрана. Меняется только через setState — он же обновляет все элементы управления.
  const state = {
    chatId: null, // открытый чат; null — новый, он сохранится вместе с первым ответом
    loaded: false, // история открытого чата получена с сервера
    waiting: false, // ждём ответа модели
    stoppable: false, // ответ ещё идёт с сервера — его можно остановить
  };
  // Поколение экрана: растёт, когда открывают другой чат или уходят с экрана. Асинхронное
  // действие запоминает его в начале и после каждого ожидания проверяет — не устарело ли.
  let generation = 0;
  let abort = null; // AbortController идущего запроса — для кнопки «Остановить»

  function setState(patch) {
    Object.assign(state, patch);
    render();
  }

  const sidebar = createSidebar({
    onSelect: (id) => open(id),
    onNew() {
      open(null);
      composer.focus();
    },
    onProgress: () => progress.open(),
  });

  // Результаты тренажёров сохраняются в фоне. Помним незавершённые сохранения, чтобы
  // «Мой прогресс» не показал старые цифры, если его открыли сразу после задания.
  const saving = new Set();
  function recordAttempt(messageId, result) {
    // Прогресс — не главное: сбой записи результата чат не прерывает.
    const request = api.saveAttempt({ message_id: messageId, ...result }).catch(() => {});
    saving.add(request);
    request.finally(() => saving.delete(request));
  }

  // «Мой прогресс»: результаты тренажёров и тренировка по своим ошибкам в новом чате.
  const progress = createProgressPanel({
    untilSaved: () => Promise.all(saving),
    async onReview() {
      await open(null);
      send('Потренируй меня на моих ошибках', modeById('review'));
    },
  });

  const messages = createMessageList({
    recordAttempt,
    onFollowup: (item) => send(item.text, modeById(item.mode)),
    onRegenerate: (question) => send(question.text, modeById(question.mode), { replaceLast: true }),
    onEdit: (question) => composer.startEditing(question.text, modeById(question.mode), true),
    onChange: render,
  });

  const welcome = createWelcome({
    onChoose: (mode) => composer.chooseMode(mode),
    onExample: (text, mode) => send(text, mode),
  });

  const composer = createComposer({
    onSubmit: ({ text, mode, replaceLast }) => send(text, mode, { replaceLast }),
    onStop: () => abort?.abort(),
    onModeChange: (mode) => welcome.showMode(mode),
    onEditingChange: render,
  });

  // --- Отображение состояния ---

  function render() {
    const { chatId, loaded, waiting, stoppable } = state;
    composer.setState({ busy: waiting, stoppable, ready: loaded });
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
    const mine = ++generation;
    messages.clear();
    setStatus('Загружаем чаты…');
    setState({ chatId: null, loaded: false });
    let chats;
    try {
      chats = await api.listChats();
    } catch (error) {
      if (mine === generation && !error.unauthorized) setStatus(`Не удалось загрузить чаты. ${error.message}`, start);
      return;
    }
    if (mine !== generation) return;
    sidebar.setChats(chats);
    const wanted = chatFromAddress();
    await open(wanted !== undefined && (wanted === null || sidebar.has(wanted)) ? wanted : sidebar.latest());
  }

  /** Открыть сохранённый чат или (id = null) пустой новый. */
  async function open(id) {
    const mine = ++generation;
    sidebar.setActive(id);
    rememberInAddress(id);
    composer.reset({ keepText: true });
    messages.clear();
    setStatus(id === null ? undefined : 'Загружаем историю…');
    setState({ chatId: id, loaded: id === null });
    if (id === null) return;

    let history;
    try {
      history = await api.listMessages(id);
    } catch (error) {
      if (mine !== generation || error.unauthorized) return;
      if (error.status === 404) { // чат удалили в другой вкладке
        sidebar.remove(id);
        open(null);
        return;
      }
      setStatus(`Не удалось загрузить историю. ${error.message}`, () => open(id));
      return;
    }
    if (mine !== generation) return; // пока грузилось, открыли другой чат
    messages.showHistory(history);
    setStatus();
    setState({ loaded: true });
  }

  // --- Вопрос и ответ ---

  /**
   * Отправить вопрос в открытый чат. usedMode — заготовка для этого сообщения;
   * replaceLast — вопрос заменяет последнюю пару чата: «ответить заново» и правка вопроса.
   */
  async function send(rawText, usedMode = null, { replaceLast = false } = {}) {
    const text = rawText.trim();
    if (state.waiting || !state.loaded || !checkMessage(rawText).valid) return;

    const mine = generation;
    composer.reset({ keepText: true }); // вопрос мог уйти не из поля, а кнопкой или примером
    const pending = messages.begin(text, usedMode?.id ?? null, { replaceLast });
    abort = new AbortController();
    setState({ waiting: true, stoppable: true });
    messages.scrollToEnd();

    try {
      const exchange = await api.sendMessage(rawText, {
        chatId: state.chatId,
        mode: usedMode?.id ?? null,
        replaceLast: pending.replacesLast,
        signal: abort.signal,
        onDelta: pending.push,
        onReset: pending.reset,
      });
      if (mine !== generation) return; // с экрана ушли, пока шёл ответ
      setState({ stoppable: false }); // ответ получен целиком — останавливать уже нечего, идёт только «печать»
      await pending.complete(exchange);
      if (mine !== generation) return;
      // Новый чат сохранился вместе с первым ответом — теперь у него есть номер и место в списке.
      sidebar.upsert(exchange.chat);
      sidebar.setActive(exchange.chat.id);
      rememberInAddress(exchange.chat.id);
      setState({ chatId: exchange.chat.id });
    } catch (error) {
      if (mine !== generation || error.unauthorized) {
        pending.discard();
        return;
      }
      pending.fail(error, {
        onRetry: () => send(text, usedMode, { replaceLast: pending.replacesLast }),
        onEdit: () => composer.startEditing(text, usedMode, pending.replacesLast),
      });
    } finally {
      abort = null;
      if (mine === generation) setState({ waiting: false, stoppable: false });
    }
  }

  /** «Очистить»: удалить открытый чат со всеми сообщениями и начать новый. */
  async function clearChat() {
    const id = state.chatId;
    const confirmed = await confirmAction({
      title: 'Очистить этот чат?',
      text: 'Чат и все его сообщения будут удалены без возможности восстановления. Остальные чаты останутся.',
      action: 'Очистить',
    });
    if (!confirmed || id === null) return;
    try {
      await api.deleteChat(id);
    } catch (error) {
      if (!error.unauthorized) notify(`Не удалось очистить чат. ${error.message}`);
      return;
    }
    sidebar.remove(id);
    await open(null);
    composer.focus();
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
    if (view.hidden || wanted === undefined || wanted === state.chatId) return;
    if (state.waiting) rememberInAddress(state.chatId); // пока идёт ответ, остаёмся в текущем чате
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
      generation += 1; // всё, что ещё выполняется для этого экрана, устарело
      abort?.abort();
      sidebar.close();
      sidebar.setChats([]);
      composer.reset();
      messages.clear();
      setStatus();
      setState({ chatId: null, loaded: false, waiting: false, stoppable: false });
      for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    },
  };
}
