// Блок «trainer»: тренажёр — несколько заданий с проверкой ответа, подсказкой и разбором.
//
// Как и график, тренажёр собирается из данных, а не из присланной разметки: модель описывает
// задания, а внешний вид и поведение одинаковы для всех тренажёров в чате.
import { el } from '../dom.js';
import { compile } from './expr.js';
import { formatNumber } from './format.js';
import { createPlot } from './plot.js';

const MAX_TASKS = 10;
const DEFAULT_TOLERANCE = 0.005; // допуск при сравнении чисел: 0,5 % (или 0,005 для ответов около нуля)

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

function toNumber(source) {
  if (typeof source === 'number') return source;
  if (typeof source === 'string') return compile(source)({});
  return NaN;
}

function normalize(spec) {
  if (!isObject(spec) || !Array.isArray(spec.tasks)) throw new Error('нужен список заданий «tasks»');

  const tasks = spec.tasks.filter(isObject).slice(0, MAX_TASKS).map((task, index) => {
    const question = text(task.question);
    if (!question) throw new Error(`в задании ${index + 1} нет вопроса`);
    const common = { question, hint: text(task.hint), solution: text(task.solution), plot: isObject(task.plot) ? task.plot : null };

    if (Array.isArray(task.options)) {
      const options = task.options.map((option) => String(option));
      const correct = Number(task.answer) - 1; // в описании варианты нумеруются с единицы
      if (options.length < 2 || !Number.isInteger(correct) || correct < 0 || correct >= options.length) {
        throw new Error(`в задании ${index + 1} неверно указан правильный вариант`);
      }
      return { ...common, kind: 'choice', options, correct };
    }

    const answers = (Array.isArray(task.answer) ? task.answer : [task.answer]).map(toNumber);
    if (!answers.length || !answers.every(Number.isFinite)) throw new Error(`в задании ${index + 1} ответ должен быть числом`);
    const tolerance = Number.isFinite(task.tolerance) && task.tolerance >= 0 ? task.tolerance : null;
    return { ...common, kind: 'number', answers, tolerance };
  });

  if (!tasks.length) throw new Error('в тренажёре нет заданий');
  return { title: text(spec.title), tasks };
}

/** Разобрать ответ пользователя: «4», «x = 4», «1/2», «0,5», «2; 3», «2 и 3». */
function parseAnswers(input) {
  const cleaned = input.trim().replace(/^[A-Za-zА-Яа-яё]\w*\s*[=≈]\s*/u, '');
  const parts = cleaned.split(/\s*;\s*|\s+и\s+|,\s+/u).filter((part) => part !== '');
  if (!parts.length) return null;
  try {
    const numbers = parts.map((part) => compile(part.replace(/(\d),(\d)/g, '$1.$2'))({}));
    return numbers.every(Number.isFinite) ? numbers : null;
  } catch {
    return null;
  }
}

function sameNumbers(given, expected, tolerance) {
  if (given.length !== expected.length) return false;
  const close = (a, b) => Math.abs(a - b) <= (tolerance ?? DEFAULT_TOLERANCE * Math.max(1, Math.abs(b)));
  const rest = [...expected];
  for (const value of given) {
    const index = rest.findIndex((candidate) => close(value, candidate));
    if (index === -1) return false;
    rest.splice(index, 1); // порядок ответов не важен, но каждый засчитывается один раз
  }
  return true;
}

export function createTrainer(spec, context) {
  const { renderBlock, renderInline } = context;
  const { title, tasks } = normalize(spec);

  // Итог по каждому заданию: 'first' — верно с первой попытки, 'solved' — верно не сразу,
  // 'revealed' — посмотрели решение.
  let results = [];
  let current = 0;

  const progress = el('ol', { class: 'trainer__progress', 'aria-hidden': 'true' });
  const counter = el('span', { class: 'trainer__counter' });
  const body = el('div', { class: 'trainer__body' });

  function refreshProgress() {
    counter.textContent = current < tasks.length ? `Задание ${current + 1} из ${tasks.length}` : 'Готово';
    progress.replaceChildren(
      ...tasks.map((_, index) => {
        const state = results[index] ?? (index === current ? 'current' : 'todo');
        return el('li', { class: `trainer__step is-${state}` });
      }),
    );
  }

  function showTask() {
    const task = tasks[current];
    let attempts = 0;
    let finished = false;

    const feedback = el('div', { class: 'trainer__feedback', role: 'status' });
    const extra = el('div', { class: 'trainer__extra' });
    const actions = el('div', { class: 'trainer__actions' });

    const button = (label, kind, onClick) => {
      const node = el('button', { type: 'button', class: `button button--small button--${kind}` }, label);
      node.addEventListener('click', onClick);
      return node;
    };

    function say(kind, message) {
      const icon = kind === 'good' ? '✓' : '✕';
      feedback.className = `trainer__feedback is-${kind}`;
      feedback.replaceChildren(el('span', { class: 'trainer__feedback-icon', 'aria-hidden': 'true' }, icon), message);
    }

    function showSolution() {
      if (task.solution) extra.replaceChildren(el('div', { class: 'trainer__note' }, el('strong', {}, 'Решение. '), renderInline(task.solution)));
      else extra.replaceChildren();
    }

    function finish(outcome) {
      finished = true;
      results[current] = outcome;
      lock();
      showSolution();
      const last = current === tasks.length - 1;
      const next = button(last ? 'К итогам' : 'Дальше', 'primary', () => {
        current += 1;
        if (current < tasks.length) showTask();
        else showSummary();
      });
      actions.replaceChildren(next);
      refreshProgress();
      next.focus({ preventScroll: true });
    }

    function wrong() {
      attempts += 1;
      say('bad', attempts === 1 ? 'Пока неверно. Попробуйте ещё раз.' : 'Снова неверно. Можно посмотреть подсказку или решение.');
      const buttons = [];
      if (task.hint) {
        buttons.push(button('Подсказка', 'secondary', () => {
          extra.replaceChildren(el('div', { class: 'trainer__note' }, el('strong', {}, 'Подсказка. '), renderInline(task.hint)));
        }));
      }
      buttons.push(button('Показать решение', 'ghost', () => {
        say('bad', el('span', {}, 'Правильный ответ: ', correctAnswer()));
        finish('revealed');
      }));
      actions.replaceChildren(...buttons);
    }

    const right = () => {
      say('good', attempts === 0 ? 'Верно!' : 'Теперь верно!');
      finish(attempts === 0 ? 'first' : 'solved');
    };

    // Поле ответа: варианты на выбор или ввод числа
    let answerArea;
    let lock;
    let correctAnswer;

    if (task.kind === 'choice') {
      const options = task.options.map((option, index) => {
        const node = el('button', { type: 'button', class: 'trainer__option' }, renderInline(option));
        node.addEventListener('click', () => {
          if (finished) return;
          if (index === task.correct) {
            node.classList.add('is-right');
            right();
          } else {
            node.classList.add('is-wrong');
            node.disabled = true;
            wrong();
          }
        });
        return node;
      });
      answerArea = el('div', { class: 'trainer__options' }, ...options);
      lock = () => options.forEach((node, index) => {
        node.disabled = true;
        if (index === task.correct) node.classList.add('is-right');
      });
      correctAnswer = () => renderInline(task.options[task.correct]);
    } else {
      const many = task.answers.length > 1;
      const input = el('input', {
        class: 'trainer__input', type: 'text', inputmode: 'text', autocomplete: 'off', spellcheck: 'false',
        placeholder: many ? 'Ответы через «;», например: 2; 3' : 'Ваш ответ',
        'aria-label': 'Ответ',
      });
      const check = el('button', { type: 'submit', class: 'button button--small button--primary' }, 'Проверить');
      answerArea = el('form', { class: 'trainer__answer', novalidate: true }, input, check);
      answerArea.addEventListener('submit', (event) => {
        event.preventDefault();
        if (finished || input.value.trim() === '') return;
        const given = parseAnswers(input.value);
        if (given === null) {
          say('bad', 'Не получилось прочитать ответ. Введите число, например 4, 0,5 или 1/2.');
          return;
        }
        if (sameNumbers(given, task.answers, task.tolerance)) right();
        else wrong();
      });
      lock = () => {
        input.disabled = true;
        check.disabled = true;
      };
      correctAnswer = () => task.answers.map((value) => formatNumber(value, 4)).join('; ');
    }

    let figure = '';
    if (task.plot) {
      try {
        figure = createPlot(task.plot, context);
      } catch {
        figure = ''; // рисунок к заданию необязателен: без него задание остаётся решаемым
      }
    }

    body.replaceChildren(
      el('div', { class: 'trainer__question prose' }, renderBlock(task.question)),
      figure, answerArea, feedback, extra, actions,
    );
    refreshProgress();
  }

  function showSummary() {
    const first = results.filter((result) => result === 'first').length;
    const solved = results.filter((result) => result === 'solved').length;
    const verdict = first === tasks.length ? 'Отлично: всё верно с первой попытки!'
      : first + solved === tasks.length ? 'Все задания решены.'
      : 'Тренировка завершена.';

    const again = el('button', { type: 'button', class: 'button button--small button--secondary' }, 'Пройти ещё раз');
    again.addEventListener('click', () => {
      results = [];
      current = 0;
      showTask();
    });
    body.replaceChildren(
      el('div', { class: 'trainer__summary' },
        el('p', { class: 'trainer__verdict' }, verdict),
        el('p', { class: 'trainer__score' },
          `С первой попытки: ${first} из ${tasks.length}`,
          solved ? ` · со второй и далее: ${solved}` : '',
          tasks.length - first - solved ? ` · с решением: ${tasks.length - first - solved}` : '',
        ),
      ),
      el('div', { class: 'trainer__actions' }, again),
    );
    refreshProgress();
  }

  showTask();

  return el('section', { class: 'widget trainer' },
    el('header', { class: 'trainer__header' },
      el('div', { class: 'widget__title' }, title ? renderInline(title) : 'Тренажёр'),
      el('div', { class: 'trainer__status' }, counter, progress),
    ),
    body,
  );
}
