// Формулы в тексте с клавиатуры (предпросмотр) и разбор ответов в тренажёре.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findMath } from '../../static/js/render/mathtext.js';
import { parseAnswers, sameNumbers } from '../../static/js/widgets/trainer.js';

const found = (text) => findMath(text).map(({ start, end, latex }) => [text.slice(start, end), latex]);

test('выражения находятся внутри обычной фразы', () => {
  assert.deepEqual(found('Реши уравнение x^2 - 5x + 6 = 0'), [['x^2 - 5x + 6 = 0', 'x^{2} - 5 x + 6 = 0']]);
  assert.deepEqual(found('2x + 6 = 10, у меня получилось x = 8'), [['2x + 6 = 10', '2 x + 6 = 10'], ['x = 8', 'x = 8']]);
  assert.deepEqual(found('Сколько будет 12 * 12?'), [['12 * 12', '12 \\cdot 12']]);
});

test('дроби, корни, функции и греческие буквы', () => {
  assert.deepEqual(found('1/2 + 1/3 = 2/5, правильно?')[0][1], '\\frac{1}{2} + \\frac{1}{3} = \\frac{2}{5}');
  assert.equal(found('sqrt(16)/2 + 0,5')[0][1], '\\frac{\\sqrt{16}}{2} + 0{,}5');
  assert.equal(found('f(x) = x^3 * sin(x)')[0][1], 'f\\left(x\\right) = x^{3} \\cdot \\sin\\left(x\\right)');
  assert.equal(found('S = πr^2')[0][1], 'S = \\pi r^{2}');
  assert.equal(found('√2 ≤ x^2')[0][1], '\\sqrt{2} \\le x^{2}');
  assert.equal(found('x1 + x2 = 5')[0][1], 'x_{1} + x_{2} = 5');
});

test('обычный текст формулой не считается', () => {
  for (const text of ['Найди площадь круга радиуса 3', 'как k и b меняют прямую', 'Проценты, 6 класс',
    'в 2024 году', 'solve x^2 = 4', '5 - это число', 'скидка 20% от 150', 'a, b и c']) {
    assert.deepEqual(found(text), [], text);
  }
});

test('ответ тренажёра читается в разных записях', () => {
  assert.deepEqual(parseAnswers('4'), [4]);
  assert.deepEqual(parseAnswers('x = 4'), [4]);
  assert.deepEqual(parseAnswers('0,5'), [0.5]);
  assert.deepEqual(parseAnswers('1/2'), [0.5]);
  assert.deepEqual(parseAnswers('2; 3'), [2, 3]);
  assert.deepEqual(parseAnswers('2 и 3'), [2, 3]);
  assert.equal(parseAnswers('не знаю'), null);
  assert.equal(parseAnswers('   '), null);
});

test('ответы сравниваются с допуском, порядок не важен, лишних быть не должно', () => {
  assert.equal(sameNumbers([3, 2], [2, 3], null), true);
  assert.equal(sameNumbers([2], [2, 3], null), false);
  assert.equal(sameNumbers([2, 2], [2, 3], null), false);
  assert.equal(sameNumbers([3.14], [Math.PI], null), true); // допуск по умолчанию — 0,5 %
  assert.equal(sameNumbers([3.2], [Math.PI], null), false);
  assert.equal(sameNumbers([3.2], [Math.PI], 0.1), true);
});
