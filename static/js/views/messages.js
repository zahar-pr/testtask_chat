// Лента сообщений: записи из истории, вопрос в ожидании ответа, «печать» ответа по мере
// генерации, вопрос без ответа (сбой или остановка) и действия у последней пары.
// Здесь только отрисовка — запросы к серверу делает chat.js.
import { $, el } from '../dom.js';
import { DEFAULT_FOLLOWUPS, modeById } from '../modes.js';
import { timeElement } from '../render/datetime.js';
import { renderMarkdown } from '../render/markdown.js';
import { renderMathText } from '../render/mathtext.js';
import { stablePart } from '../render/streaming.js';

const SLOW_ANSWER_MS = 10_000;

// «Печать» ответа: модель присылает текст неровными порциями, а на экран он выходит плавно.
// Каждый кадр допечатывается доля накопившегося — чем больше отставание, тем быстрее печать.
const TYPING_FRAME_MS = 32;
const TYPING_CATCH_UP = 12; // за кадр — 1/12 накопившегося текста
const TYPING_MIN_STEP = 2; // но не меньше двух символов
const FOLLOW_DISTANCE_PX = 80; // лента следует за текстом, пока пользователь у её конца

const button = (label, kind, onClick) => {
  const node = el('button', { type: 'button', class: `button button--small button--${kind}` }, label);
  node.addEventListener('click', onClick);
  return node;
};

/**
 * recordAttempt(messageId, result) — тренажёр в ответе сообщил результат задания;
 * onFollowup(item), onRegenerate(question), onEdit(question) — действия у последней пары;
 * onChange() — лента изменилась по действию пользователя (например, убрали вопрос без ответа).
 */
export function createMessageList({ recordAttempt, onFollowup, onRegenerate, onEdit, onChange }) {
  const scroller = $('#chat-scroll');
  const list = $('#messages');

  const scrollToEnd = () => scroller.scrollTo({ top: scroller.scrollHeight });
  const isNearEnd = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < FOLLOW_DISTANCE_PX;

  // --- Узлы сообщений ---

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

  /** Запись из истории. widgets — уже нарисованные графики и тренажёры этого ответа (см. streamingAnswer). */
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
      /** Ответ сохранён на сервере под номером id. */
      saved(id) {
        messageId = id;
        for (const result of early.splice(0)) recordAttempt(id, result);
      },
      stop() {
        clearTimeout(timer);
      },
    };
  }

  // --- Последняя пара и действия у неё ---

  /** Последняя сохранённая пара чата: [вопрос, ответ] — или [], если её нет. */
  function lastPair() {
    const [question, answer] = [...list.querySelectorAll('.message[data-id]')].slice(-2);
    return question?.message.role === 'user' && answer?.message.role === 'assistant' ? [question, answer] : [];
  }

  /**
   * Действия у последней пары: продолжения разговора одной кнопкой, «ответить заново»,
   * «изменить вопрос». У более ранних сообщений их нет — менять можно только конец разговора.
   */
  function refreshActions(enabled) {
    for (const stale of list.querySelectorAll('.message__actions')) stale.remove();
    if (!enabled || list.querySelector('.is-failed, .is-stopped')) return;
    const [question, answer] = lastPair();
    if (!question) return;

    const asked = question.message;
    const followups = modeById(asked.mode)?.followups ?? DEFAULT_FOLLOWUPS;
    $('.message__main', answer).append(
      el('div', { class: 'message__actions' },
        ...followups.map((item) => {
          const chip = el('button', { type: 'button', class: 'chip chip--small' }, item.label);
          chip.addEventListener('click', () => onFollowup(item));
          return chip;
        }),
        button('Ответить заново', 'ghost', () => onRegenerate(asked)),
      ),
    );
    $('.message__main', question).append(
      el('div', { class: 'message__actions' }, button('Изменить', 'ghost', () => onEdit(asked))),
    );
  }

  // --- Вопрос в ожидании ответа ---

  /**
   * Показать отправленный вопрос и индикатор ожидания. Возвращает «незавершённый обмен»:
   * в него передаются части ответа, а затем — итог: успех (complete), сбой (fail) или отказ (discard).
   * replaceLast — вопрос заменяет последнюю пару чата: «ответить заново» и правка вопроса.
   */
  function begin(text, modeId, { replaceLast = false } = {}) {
    for (const unanswered of list.querySelectorAll('.is-failed, .is-stopped')) unanswered.remove();
    // Заменяемую пару убираем с экрана, но не забываем: при сбое сервер её сохранит — вернём и мы.
    const replaced = replaceLast ? lastPair() : [];
    for (const node of replaced) node.remove();

    const draft = userMessage(text, 'Отправляется…', modeId);
    draft.classList.add('is-sending', 'is-new');
    const typing = typingIndicator();
    typing.classList.add('is-new');
    list.append(draft, typing);

    let answer = null;
    const removeAnswer = () => {
      answer?.stop();
      answer?.node.remove();
      typing.remove();
    };

    return {
      replacesLast: replaced.length > 0,
      push(delta) {
        if (answer === null) {
          // Первая часть ответа: «Решаю…» сменяется текстом, который дальше допечатывается.
          answer = streamingAnswer();
          typing.replaceWith(answer.node);
        }
        answer.push(delta);
      },
      reset: () => answer?.reset(),
      /** Ответ получен и сохранён: заменяем черновики записями из истории (с датой и временем). */
      async complete(exchange) {
        await answer?.settled();
        const follow = isNearEnd();
        answer?.saved(exchange.assistant.id);
        draft.replaceWith(storedMessage(exchange.user));
        (answer?.node ?? typing).replaceWith(storedMessage(exchange.assistant, answer?.widgets));
        if (follow) scrollToEnd();
      },
      /**
       * Ответа нет (сбой или остановка). Начало оборвавшегося ответа убираем — на сервере оно не
       * сохранено; вопрос оставляем в ленте с действиями «убрать», «изменить», «повторить».
       */
      fail(error, { onRetry, onEdit: onEditDraft }) {
        removeAnswer();
        draft.before(...replaced);
        const wasStopped = error.code === 'stopped';
        draft.classList.replace('is-sending', wasStopped ? 'is-stopped' : 'is-failed');
        $('.message__meta', draft).textContent = wasStopped ? 'Остановлено' : 'Не отправлено';

        const then = (action) => () => {
          draft.remove();
          action();
        };
        $('.message__main', draft).append(
          el('div', { class: 'message__error', role: 'alert' },
            wasStopped ? 'Генерация остановлена, ответ не сохранён.' : error.message,
            el('div', { class: 'message__error-actions' },
              button('Убрать', 'ghost', then(onChange)),
              button('Изменить', 'ghost', then(onEditDraft)),
              button('Повторить', 'secondary', then(onRetry)),
            ),
          ),
        );
        scrollToEnd();
      },
      /** Убрать вопрос и ответ без следа (сессия закончилась — уходим на экран входа). */
      discard() {
        removeAnswer();
        draft.remove();
      },
    };
  }

  return {
    get isEmpty() {
      return list.childElementCount === 0;
    },
    clear: () => list.replaceChildren(),
    showHistory(messages) {
      list.replaceChildren(...messages.map((message) => storedMessage(message)));
      scrollToEnd();
    },
    begin,
    refreshActions,
    scrollToEnd,
  };
}
