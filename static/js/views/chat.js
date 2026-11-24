// Экран чата: открытый чат и его история, отправка сообщения, «печать» ответа по мере генерации,
// ошибки, заготовки, очистка, выход. Список сохранённых чатов — в sidebar.js.
import * as api from '../api.js';
import { $, el } from '../dom.js';
import { MODES, modeById } from '../modes.js';
import { timeElement } from '../render/datetime.js';
import { renderMarkdown } from '../render/markdown.js';
import { stablePart } from '../render/streaming.js';
import { MESSAGE, checkMessage } from '../validation.js';
import { createSidebar } from './sidebar.js';

const SLOW_ANSWER_MS = 10_000;

// «Печать» ответа: модель присылает текст неровными порциями, а на экран он выходит плавно.
// Каждый кадр допечатывается доля накопившегося — чем больше отставание, тем быстрее печать.
const TYPING_FRAME_MS = 32;
const TYPING_CATCH_UP = 12; // за кадр — 1/12 накопившегося текста
const TYPING_MIN_STEP = 2; // но не меньше двух символов
const FOLLOW_DISTANCE_PX = 80; // лента следует за текстом, пока пользователь у её конца

export function createChatView({ onSessionLost, onLogout }) {
  const view = $('#chat-view');
  const scroller = $('#chat-scroll');
  const status = $('#chat-status');
  const welcome = $('#chat-empty');
  const presets = $('#presets');
  const presetDetails = $('#preset-details');
  const presetTitle = $('#preset-title');
  const presetDescription = $('#preset-description');
  const presetExamples = $('#preset-examples');
  const presetBack = $('#preset-back');
  const modeButton = $('#mode-button');
  const modeLabel = $('#mode-label');
  const modeClear = $('#mode-clear');
  const modeMenu = $('#mode-menu');
  const list = $('#messages');
  const form = $('#composer');
  const input = $('#message-input');
  const counter = $('#message-counter');
  const sendButton = $('#send-button');
  const clearButton = $('#clear-button');
  const logoutButton = $('#logout-button');
  const clearDialog = $('#clear-dialog');

  const defaultPlaceholder = input.placeholder;

  let chatId = null; // открытый чат; null — новый, он сохранится вместе с первым ответом
  let opening = 0; // номер последнего открытия чата: ответ на устаревший запрос истории игнорируем
  let loaded = false; // история открытого чата получена с сервера
  let waiting = false; // ждём ответа модели

  const sidebar = createSidebar({
    onSelect: (id) => open(id),
    onNew() {
      open(null);
      input.focus();
    },
  });
  let mode = null; // выбранная заготовка (из MODES); действует на одно сообщение

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
    clearButton.disabled = waiting || chatId === null;
    sidebar.setDisabled(waiting);
    for (const button of welcome.querySelectorAll('button')) button.disabled = waiting;
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  }

  function setStatus(...content) {
    const shown = content.filter((part) => part !== undefined);
    status.replaceChildren(...shown);
    status.hidden = shown.length === 0;
  }

  const scrollToEnd = () => scroller.scrollTo({ top: scroller.scrollHeight });
  const isNearEnd = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < FOLLOW_DISTANCE_PX;

  /** true, если ошибка означает, что сессия закончилась и мы ушли на экран входа. */
  function sessionLost(error) {
    if (error.status !== 401) return false;
    onSessionLost();
    return true;
  }

  // --- Сообщения ---

  function userMessage(text, meta, modeId = null) {
    const usedMode = modeById(modeId);
    return el('article', { class: 'message message--user' },
      el('div', { class: 'message__main' },
        usedMode ? el('div', { class: 'message__mode' }, usedMode.title) : '',
        el('div', { class: 'message__text' }, text),
        el('div', { class: 'message__meta' }, meta),
      ),
    );
  }

  function assistantMessage(content, meta) {
    return el('article', { class: 'message message--assistant' },
      el('div', { class: 'message__main' }, content, meta ? el('div', { class: 'message__meta' }, meta) : ''),
    );
  }

  /** widgets — уже нарисованные графики и тренажёры этого ответа (см. streamingAnswer). */
  function storedMessage(message, widgets = null) {
    const node = message.role === 'user'
      ? userMessage(message.text, timeElement(message.created_at), message.mode)
      : assistantMessage(el('div', { class: 'prose' }, renderMarkdown(message.text, { widgets })), timeElement(message.created_at));
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

  /** Ответ, который ещё генерируется: принимает части текста и плавно их «допечатывает». */
  function streamingAnswer() {
    const prose = el('div', { class: 'prose' });
    const node = assistantMessage(prose);
    node.classList.add('is-streaming');

    // Готовые графики и тренажёры переживают перерисовки: иначе каждый кадр «печати» они
    // создавались бы заново и сбрасывали, например, положение ползунка.
    const widgets = new Map();
    let received = ''; // всё, что уже пришло от сервера
    let shown = 0; // сколько символов из этого уже на экране
    let timer = null;
    let onSettled = null;

    function tick() {
      timer = null;
      const backlog = received.length - shown;
      if (backlog > 0) {
        // Во вкладке на заднем плане таймеры редкие — показываем всё сразу, чтобы не отставать.
        const step = document.hidden ? backlog : Math.max(TYPING_MIN_STEP, Math.ceil(backlog / TYPING_CATCH_UP));
        shown = Math.min(received.length, shown + step);

        const follow = isNearEnd(); // если пользователь отмотал ленту вверх — не дёргаем её
        prose.replaceChildren(renderMarkdown(stablePart(received.slice(0, shown)), { widgets }));
        if (follow) scrollToEnd();
      }
      if (shown < received.length) timer = setTimeout(tick, TYPING_FRAME_MS);
      else onSettled?.();
    }

    return {
      node,
      widgets,
      push(delta) {
        received += delta;
        if (timer === null) timer = setTimeout(tick, TYPING_FRAME_MS);
      },
      /** Ответ запрошен заново: стереть напечатанное и начать с чистого листа. */
      reset() {
        received = '';
        shown = 0;
        widgets.clear();
        prose.replaceChildren();
      },
      /** Дождаться, пока всё полученное будет допечатано. */
      settled() {
        return shown >= received.length ? Promise.resolve() : new Promise((resolve) => { onSettled = resolve; });
      },
      stop() {
        clearTimeout(timer);
      },
    };
  }

  function markFailed(draft, text, usedMode, reason) {
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
      send(text, usedMode);
    });
    $('.message__main', draft).append(
      el('div', { class: 'message__error', role: 'alert' }, reason, el('div', { class: 'message__error-actions' }, dismiss, retry)),
    );
  }

  // --- Сценарии ---

  const statusWithRetry = (message, action) => {
    const retry = el('button', { type: 'button', class: 'button button--secondary button--small' }, 'Повторить');
    retry.addEventListener('click', action);
    setStatus(message, el('div', {}, retry));
  };

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
    list.replaceChildren();
    setStatus('Загружаем чаты…');
    refresh();
    try {
      sidebar.setChats(await api.listChats());
    } catch (error) {
      if (!sessionLost(error)) statusWithRetry(`Не удалось загрузить чаты. ${error.message}`, start);
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
    setMode(null);
    list.replaceChildren();
    setStatus(id === null ? undefined : 'Загружаем историю…');
    refresh();
    if (id === null) return;

    try {
      const messages = await api.listMessages(id);
      if (attempt !== opening) return; // пока грузилось, открыли другой чат
      list.append(...messages.map((message) => storedMessage(message)));
      loaded = true;
      setStatus();
    } catch (error) {
      if (attempt !== opening || sessionLost(error)) return;
      if (error.status === 404) { // чат удалили в другой вкладке
        sidebar.remove(id);
        open(null);
        return;
      }
      statusWithRetry(`Не удалось загрузить историю. ${error.message}`, () => open(id));
    }
    refresh();
    scrollToEnd();
  }

  /** usedMode — заготовка для этого сообщения; по умолчанию та, что выбрана сейчас. */
  async function send(rawText, usedMode = mode) {
    const text = rawText.trim();
    if (waiting || !loaded || !checkMessage(rawText).valid) return;

    setMode(null); // заготовка действует на одно сообщение
    for (const failed of list.querySelectorAll('.is-failed')) failed.remove();
    const draft = userMessage(text, 'Отправляется…', usedMode?.id);
    draft.classList.add('is-sending', 'is-new');
    const typing = typingIndicator();
    typing.classList.add('is-new');
    list.append(draft, typing);

    waiting = true;
    refresh();
    scrollToEnd();

    let answer = null;
    try {
      const exchange = await api.sendMessage(rawText, {
        chatId,
        mode: usedMode?.id ?? null,
        onDelta(delta) {
          if (answer === null) {
            // Первая часть ответа: «Решаю…» сменяется текстом, который дальше допечатывается.
            answer = streamingAnswer();
            typing.replaceWith(answer.node);
          }
          answer.push(delta);
        },
        onReset: () => answer?.reset(),
      });
      await answer?.settled();

      // Ответ готов и сохранён: заменяем черновики записями из истории (с датой и временем).
      const follow = isNearEnd();
      // Новый чат сохранился вместе с первым ответом — теперь у него есть номер и место в списке.
      chatId = exchange.chat.id;
      sidebar.upsert(exchange.chat);
      sidebar.setActive(chatId);
      rememberInAddress(chatId);
      draft.replaceWith(storedMessage(exchange.user));
      (answer?.node ?? typing).replaceWith(storedMessage(exchange.assistant, answer?.widgets));
      if (follow) scrollToEnd();
    } catch (error) {
      // Оборвавшийся ответ не сохранён на сервере, поэтому убираем и его начало с экрана.
      answer?.stop();
      answer?.node.remove();
      typing.remove();
      if (sessionLost(error)) return;
      markFailed(draft, text, usedMode, error.message);
      scrollToEnd();
    } finally {
      waiting = false;
      refresh();
    }
  }

  /** «Очистить»: удалить открытый чат со всеми сообщениями и начать новый. */
  async function clearChat() {
    const id = chatId;
    if (id === null) return;
    try {
      await api.deleteChat(id);
      sidebar.remove(id);
      await open(null);
      input.focus();
    } catch (error) {
      if (!sessionLost(error)) alert(`Не удалось очистить чат. ${error.message}`);
    }
  }

  // --- События ---

  // --- Заготовки ---

  function setMenuOpen(open) {
    modeMenu.hidden = !open;
    modeButton.setAttribute('aria-expanded', String(open));
  }

  /** Выбрать заготовку (или снять выбор): меняются подпись кнопки, подсказка в поле и пустой экран. */
  function setMode(next) {
    mode = next;
    modeLabel.textContent = mode ? mode.title : 'Заготовки';
    modeButton.classList.toggle('is-active', mode !== null);
    modeClear.hidden = mode === null;
    input.placeholder = mode ? mode.placeholder : defaultPlaceholder;
    for (const item of modeMenu.querySelectorAll('[role=menuitemradio]')) {
      item.setAttribute('aria-checked', String(item.dataset.mode === mode?.id));
    }

    presets.hidden = mode !== null;
    presetDetails.hidden = mode === null;
    if (mode) {
      const chosen = mode;
      presetTitle.textContent = chosen.action;
      presetDescription.textContent = chosen.description;
      presetExamples.replaceChildren(
        ...chosen.examples.map((example) => {
          const button = el('button', { type: 'button', class: 'chip' }, example);
          button.addEventListener('click', () => send(example, chosen));
          return el('li', {}, button);
        }),
      );
    }
    setMenuOpen(false);
    refresh();
  }

  function chooseMode(next) {
    setMode(next);
    input.focus();
  }

  for (const item of MODES) {
    // карточка на пустом экране
    const card = el('button', { type: 'button', class: 'preset' },
      el('span', { class: 'preset__title' }, item.action),
      el('span', { class: 'preset__text' }, item.description),
    );
    card.addEventListener('click', () => chooseMode(item));
    presets.append(el('li', {}, card));

    // пункт меню у поля ввода — заготовки доступны и посреди разговора
    const option = el('button', { type: 'button', class: 'mode__option', role: 'menuitemradio', 'aria-checked': 'false', 'data-mode': item.id },
      el('span', { class: 'mode__option-title' }, item.action),
      el('span', { class: 'mode__option-text' }, item.description),
    );
    option.addEventListener('click', () => chooseMode(item));
    modeMenu.append(el('li', { role: 'none' }, option));
  }

  modeButton.addEventListener('click', () => setMenuOpen(modeMenu.hidden));
  modeClear.addEventListener('click', () => chooseMode(null));
  presetBack.addEventListener('click', () => chooseMode(null));
  document.addEventListener('click', (event) => {
    if (!modeMenu.hidden && !event.target.closest('.mode')) setMenuOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modeMenu.hidden) {
      setMenuOpen(false);
      modeButton.focus();
    }
  });

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
    if (clearDialog.returnValue === 'confirm') clearChat();
    clearDialog.returnValue = '';
  });

  logoutButton.addEventListener('click', async () => {
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
      input.focus();
      start();
    },
    hide() {
      view.hidden = true;
      opening += 1;
      chatId = null;
      loaded = false;
      sidebar.close();
      sidebar.setChats([]);
      setMode(null);
      list.replaceChildren();
      setStatus();
      if (clearDialog.open) clearDialog.close();
    },
  };
}
