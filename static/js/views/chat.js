// Экран чата: открытый чат и его история, отправка сообщения, «печать» ответа по мере генерации,
// ошибки, заготовки, очистка, выход. Список сохранённых чатов — в sidebar.js.
import * as api from '../api.js';
import { $, el } from '../dom.js';
import { DEFAULT_FOLLOWUPS, PRESETS, modeById } from '../modes.js';
import { timeElement } from '../render/datetime.js';
import { renderMarkdown } from '../render/markdown.js';
import { findMath, renderMathText } from '../render/mathtext.js';
import { stablePart } from '../render/streaming.js';
import { MESSAGE, checkMessage } from '../validation.js';
import { createProgressPanel } from './progress.js';
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
  const stopButton = $('#stop-button');
  const preview = $('#input-preview');
  const symbols = $('#symbols');
  const symbolsToggle = $('#symbols-toggle');
  const editBanner = $('#edit-banner');
  const editCancel = $('#edit-cancel');
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

  /** Сохранить результат задания тренажёра. Прогресс — не главное: сбой записи чат не прерывает. */
  const recordAttempt = (messageId, result) => api.saveAttempt({ message_id: messageId, ...result }).catch(() => {});
  let mode = null; // выбранная заготовка (из MODES); действует на одно сообщение
  let editing = false; // в поле ввода — последний вопрос чата: отправка заменит его и ответ
  let abort = null; // AbortController идущего запроса — для кнопки «Остановить»

  // --- Состояние элементов управления ---

  function refresh() {
    const check = checkMessage(input.value);
    refreshPreview();
    counter.textContent = `${check.length} / ${MESSAGE.max}`;
    counter.classList.toggle('is-over', check.over);

    sendButton.disabled = waiting || !loaded || !check.valid;
    sendButton.classList.toggle('is-busy', waiting);
    sendButton.setAttribute('aria-label', waiting ? 'Ждём ответа' : 'Отправить');
    stopButton.hidden = !waiting;
    editBanner.hidden = !editing;

    const hasMessages = list.childElementCount > 0;
    welcome.hidden = !loaded || hasMessages;
    clearButton.disabled = waiting || chatId === null;
    sidebar.setDisabled(waiting);
    for (const button of welcome.querySelectorAll('button')) button.disabled = waiting;
    refreshActions();
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  }

  /** Предпросмотр: если в набранном тексте есть формулы, показываем, как они будут выглядеть. */
  function refreshPreview() {
    const formulas = findMath(input.value);
    preview.hidden = formulas.length === 0;
    preview.replaceChildren(formulas.length ? renderMathText(input.value, formulas) : '');
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
        el('div', { class: 'message__text' }, renderMathText(text)), // формулы из вопроса — в настоящей записи
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
    const onTrainerResult = (result) => recordAttempt(message.id, result);
    const node = message.role === 'user'
      ? userMessage(message.text, timeElement(message.created_at), message.mode)
      : assistantMessage(
        el('div', { class: 'prose' }, renderMarkdown(message.text, { widgets, onTrainerResult })),
        timeElement(message.created_at),
      );
    node.dataset.id = message.id;
    node.message = message; // нужен действиям «изменить» и «ответить заново»
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
    // Тренажёр можно начать решать, пока ответ ещё печатается и не сохранён: результаты копим
    // и записываем, когда у ответа появится номер (saved).
    let messageId = null;
    const early = [];
    const onTrainerResult = (result) => (messageId === null ? early.push(result) : recordAttempt(messageId, result));
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
        prose.replaceChildren(renderMarkdown(stablePart(received.slice(0, shown)), { widgets, onTrainerResult }));
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
      /** Ответ сохранён на сервере под номером id. */
      saved(id) {
        messageId = id;
        for (const result of early.splice(0)) recordAttempt(id, result);
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

  /** Последняя сохранённая пара чата: [вопрос, ответ] — или [], если её нет. */
  function lastPair() {
    const stored = [...list.querySelectorAll('.message[data-id]')];
    const [question, answer] = stored.slice(-2);
    return question?.message.role === 'user' && answer?.message.role === 'assistant' ? [question, answer] : [];
  }

  const actionButton = (label, kind, onClick) => {
    const button = el('button', { type: 'button', class: `button button--small button--${kind}` }, label);
    button.addEventListener('click', onClick);
    return button;
  };

  /**
   * Действия у последней пары: продолжения разговора одной кнопкой, «ответить заново»,
   * «изменить вопрос». У более ранних сообщений их нет — менять можно только конец разговора.
   */
  function refreshActions() {
    for (const stale of list.querySelectorAll('.message__actions')) stale.remove();
    if (!loaded || waiting || editing || list.querySelector('.is-failed, .is-stopped')) return;
    const [question, answer] = lastPair();
    if (!question) return;

    const asked = question.message;
    const followups = modeById(asked.mode)?.followups ?? DEFAULT_FOLLOWUPS;
    $('.message__main', answer).append(
      el('div', { class: 'message__actions' },
        ...followups.map((item) => {
          const chip = el('button', { type: 'button', class: 'chip chip--small' }, item.label);
          chip.addEventListener('click', () => send(item.text, modeById(item.mode)));
          return chip;
        }),
        actionButton('Ответить заново', 'ghost', () => send(asked.text, modeById(asked.mode), { replaceLast: true })),
      ),
    );
    $('.message__main', question).append(
      el('div', { class: 'message__actions' }, actionButton('Изменить', 'ghost', () => startEditing(asked.text, modeById(asked.mode)))),
    );
  }

  /** Вернуть вопрос в поле ввода, чтобы исправить его; отправка заменит последнюю пару чата. */
  function startEditing(text, usedMode, replacesLast = true) {
    setMode(usedMode);
    editing = replacesLast;
    input.value = text;
    autosize();
    refresh();
    input.focus();
  }

  function stopEditing() {
    editing = false;
    input.value = '';
    autosize();
    setMode(null);
  }

  /** Вопрос не получил ответа (сбой или остановка): оставляем его в ленте с действиями. */
  function markUnanswered(draft, text, usedMode, error, replaceLast) {
    const wasStopped = error.code === 'stopped';
    draft.classList.replace('is-sending', wasStopped ? 'is-stopped' : 'is-failed');
    $('.message__meta', draft).textContent = wasStopped ? 'Остановлено' : 'Не отправлено';

    const again = (action) => () => {
      draft.remove();
      action();
    };
    $('.message__main', draft).append(
      el('div', { class: 'message__error', role: 'alert' },
        wasStopped ? 'Генерация остановлена, ответ не сохранён.' : error.message,
        el('div', { class: 'message__error-actions' },
          actionButton('Убрать', 'ghost', again(refresh)),
          actionButton('Изменить', 'ghost', again(() => startEditing(text, usedMode, replaceLast))),
          actionButton('Повторить', 'secondary', again(() => send(text, usedMode, { replaceLast }))),
        ),
      ),
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
    editing = false;
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

  /**
   * Отправить вопрос. usedMode — заготовка для этого сообщения (по умолчанию выбранная сейчас);
   * replaceLast — вопрос заменяет последнюю пару чата: «ответить заново» и правка вопроса.
   */
  async function send(rawText, usedMode = mode, { replaceLast = editing } = {}) {
    const text = rawText.trim();
    if (waiting || !loaded || !checkMessage(rawText).valid) return;

    editing = false;
    setMode(null); // заготовка действует на одно сообщение
    for (const unanswered of list.querySelectorAll('.is-failed, .is-stopped')) unanswered.remove();
    // Заменяемую пару убираем с экрана, но не забываем: при сбое сервер её сохранит — вернём и мы.
    const replaced = replaceLast ? lastPair() : [];
    for (const node of replaced) node.remove();
    const draft = userMessage(text, 'Отправляется…', usedMode?.id);
    draft.classList.add('is-sending', 'is-new');
    const typing = typingIndicator();
    typing.classList.add('is-new');
    list.append(draft, typing);

    waiting = true;
    abort = new AbortController();
    refresh();
    scrollToEnd();

    let answer = null;
    try {
      const exchange = await api.sendMessage(rawText, {
        chatId,
        mode: usedMode?.id ?? null,
        replaceLast: replaced.length > 0,
        signal: abort.signal,
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
      answer?.saved(exchange.assistant.id);
      (answer?.node ?? typing).replaceWith(storedMessage(exchange.assistant, answer?.widgets));
      if (follow) scrollToEnd();
    } catch (error) {
      // Оборвавшийся ответ не сохранён на сервере, поэтому убираем и его начало с экрана.
      answer?.stop();
      answer?.node.remove();
      typing.remove();
      if (sessionLost(error)) return;
      draft.before(...replaced);
      markUnanswered(draft, text, usedMode, error, replaced.length > 0);
      scrollToEnd();
    } finally {
      waiting = false;
      abort = null;
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

  for (const item of PRESETS) {
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

  // --- Кнопки математических символов ---

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
      localStorage.setItem('epsilon.symbols', shown ? '1' : '0'); // запоминаем выбор, не более
    } catch { /* хранилище недоступно — просто не запомним */ }
  }

  for (const symbol of SYMBOLS) {
    const button = el('button', { type: 'button', class: 'composer__symbol', title: symbol.title ?? null }, symbol.label);
    button.addEventListener('click', () => insertAtCursor(symbol));
    symbols.append(button);
  }
  symbolsToggle.addEventListener('click', () => setSymbolsShown(symbols.hidden));
  try {
    setSymbolsShown(localStorage.getItem('epsilon.symbols') === '1');
  } catch { /* без хранилища панель просто скрыта */ }

  stopButton.addEventListener('click', () => abort?.abort());
  editCancel.addEventListener('click', () => {
    stopEditing();
    input.focus();
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
      abort?.abort();
      editing = false;
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
