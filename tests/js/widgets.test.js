// Описания графиков и тренажёров от модели: что принимается, что отклоняется и как режутся блоки.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { splitWidgetBlocks } from '../../static/js/render/fences.js';
import { autoRange, createView } from '../../static/js/widgets/plot/scale.js';
import { normalize } from '../../static/js/widgets/plot/spec.js';
import { normalizeTrainer } from '../../static/js/widgets/trainer.js';

const PLOT = '{"x": [0, 1], "functions": [{"expr": "x"}]}';

test('рисунок: выражения становятся функциями, графики получают цвета по порядку', () => {
  const model = normalize({
    x: [-1, '2*pi'],
    params: [{ name: 'a', min: 0, max: '2*pi', value: 1 }],
    functions: [{ expr: 'a*x^2' }, { expr: 'sin(x)', color: 5 }, { expr: 'x' }],
    points: [{ x: ['cos(a)'], y: 0, label: '  A  ' }],
  });
  assert.deepEqual(model.xRange, [-1, 2 * Math.PI]);
  assert.equal(model.functions[0].f({ a: 2, x: 3 }), 18);
  assert.deepEqual(model.functions.map((item) => item.color), ['series-1', 'series-5', 'series-2']);
  assert.equal(model.points[0].label, 'A'); // подписи обрезаются по краям
  assert.equal(model.points[0].color, 'ink'); // точки без явного цвета — цвета текста
  assert.equal(model.params[0].max, 2 * Math.PI); // граница ползунка выражением
  assert.equal(model.axes, true);
});

test('рисунок: ошибка в описании — понятная причина, а не падение при отрисовке', () => {
  assert.throws(() => normalize({ functions: [{ expr: 'x' }] }), /границы по горизонтали/);
  assert.throws(() => normalize({ x: [3, 1] }), /границ/);
  assert.throws(() => normalize({ x: [0, 1], functions: [{ expr: 'foo(x)' }] }), /неизвестное имя «foo»/);
  assert.throws(() => normalize({ x: [0, 1], functions: [{ expr: '\\frac{1}{x}' }] }), /непонятный символ/);
  assert.throws(() => normalize({ x: [0, 1], params: [{ name: 'x', min: 0, max: 1 }] }), /имя параметра/);
  assert.throws(() => normalize({ x: [0, 1], params: [{ name: 'a', min: 2, max: 1 }] }), /min < max/);
  assert.throws(() => normalize({ x: [0, 1], functions: 'x' }), /должно быть списком/);
  assert.throws(() => normalize(null), /должно быть объектом/);
});

test('рисунок: лишнее сверх лимитов отбрасывается', () => {
  const many = Array.from({ length: 20 }, () => ({ expr: 'x' }));
  assert.equal(normalize({ x: [0, 1], functions: many }).functions.length, 6);
});

test('границы по вертикали: асимптота не растягивает ось до бесконечности', () => {
  const hyperbola = normalize({ x: [-2, 2], functions: [{ expr: '1/x' }] });
  const [low, high] = autoRange(hyperbola, {});
  assert.ok(high < 100 && low > -100, `[${low}, ${high}]`);

  const parabola = normalize({ x: [-3, 3], functions: [{ expr: 'x^2' }] });
  const [bottom, top] = autoRange(parabola, {});
  assert.ok(bottom <= 0 && top >= 9 && top < 12, `[${bottom}, ${top}]`); // вся кривая с небольшим запасом
  assert.deepEqual(autoRange(normalize({ x: [0, 1], lines: [{ x: 0.5 }] }), {}), [-1, 1]);
});

test('вид рисунка: координаты переводятся в пиксели, equal даёт одинаковый масштаб осей', () => {
  const model = normalize({ x: [0, 10], functions: [{ expr: 'x' }] });
  const view = createView(model, [0, 10], 600);
  assert.equal(view.X(0), view.left);
  assert.equal(view.X(10), view.right);
  assert.equal(view.Y(0), view.bottom);
  assert.equal(view.Y(10), view.top);
  assert.ok(view.contains(view.X(5), view.Y(5)) && !view.contains(view.right + 50, view.top));

  const equal = createView(normalize({ x: [-1, 1], equal: true, circles: [{ center: [0, 0], r: 1 }] }), [-1, 1], 600);
  const unitX = equal.X(1) - equal.X(0);
  const unitY = equal.Y(0) - equal.Y(1);
  assert.ok(Math.abs(unitX - unitY) < 1e-9); // окружность остаётся окружностью
});

test('тренажёр: число, несколько чисел и выбор варианта', () => {
  const { title, tasks } = normalizeTrainer({
    title: ' Проценты ',
    tasks: [
      { question: 'Найдите $20\\%$ от 150', answer: 30, hint: 'умножьте', solution: '$30$' },
      { question: 'Корни?', answer: [2, '1/2'] },
      { question: 'Сколько?', options: ['один', 2, 'три'], answer: 2 },
    ],
  });
  assert.equal(title, 'Проценты');
  assert.deepEqual(tasks.map((task) => task.kind), ['number', 'number', 'choice']);
  assert.deepEqual(tasks[1].answers, [2, 0.5]); // ответ-выражение вычисляется
  assert.deepEqual([tasks[2].options, tasks[2].correct], [['один', '2', 'три'], 1]); // номер варианта — с единицы
});

test('тренажёр: без заданий, без вопроса или с ответом вне вариантов — ошибка', () => {
  assert.throws(() => normalizeTrainer({ tasks: [] }), /нет заданий/);
  assert.throws(() => normalizeTrainer({}), /список заданий/);
  assert.throws(() => normalizeTrainer({ tasks: [{ answer: 1 }] }), /нет вопроса/);
  assert.throws(() => normalizeTrainer({ tasks: [{ question: '?', answer: 'много' }] }));
  assert.throws(() => normalizeTrainer({ tasks: [{ question: '?', options: ['а', 'б'], answer: 3 }] }), /правильный вариант/);
});

test('блоки в тексте: обычный случай, забытая и запоздавшая закрывающая строка', () => {
  const kinds = (text) => splitWidgetBlocks(text).map((part) => (part.type === 'widget' ? `[${part.kind}]` : part.text.trim()));

  assert.deepEqual(kinds(`До\n\`\`\`plot\n${PLOT}\n\`\`\`\nПосле`), ['До', '[plot]', 'После']);
  assert.deepEqual(kinds(`До\n\`\`\`plot\n${PLOT}\nПосле`), ['До', '[plot]', 'После']); // закрывающую строку забыли
  // закрывающая строка стоит после куска текста — убирается, следующий блок не «съедается»
  const late = `\`\`\`plot\n${PLOT}\nПояснение\n\`\`\`\nЕщё текст\n\`\`\`trainer\n{"tasks": []}\n\`\`\`\nКонец`;
  assert.deepEqual(kinds(late), ['', '[plot]', 'Пояснение\nЕщё текст', '[trainer]', 'Конец']);
});

test('блоки в тексте: недописанное описание и обычный код не трогаются', () => {
  const unfinished = '```plot\n{"x": [0, 1], "functions": [';
  assert.deepEqual(splitWidgetBlocks(unfinished), [{ type: 'text', text: unfinished }]);
  const code = 'Код:\n```python\nprint("```plot")\n```';
  assert.equal(splitWidgetBlocks(code).length, 1);
  assert.equal(splitWidgetBlocks(`\`\`\`PLOT\n${PLOT}\n\`\`\``)[1].kind, 'plot'); // регистр названия не важен
});
