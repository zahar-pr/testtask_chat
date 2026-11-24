// Разбор и вычисление выражений — на нём держатся графики и проверка ответов в тренажёре.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ExprError, compile, compileValue, parse } from '../../static/js/widgets/expr.js';

const value = (source, scope = {}) => compile(source, Object.keys(scope))(scope);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test('арифметика и приоритеты', () => {
  assert.equal(value('2 + 3 * 4'), 14);
  assert.equal(value('(2 + 3) * 4'), 20);
  assert.equal(value('2^3^2'), 512); // степень — справа налево
  assert.equal(value('-x^2', { x: 3 }), -9); // минус слабее степени
  assert.equal(value('2^-1'), 0.5);
  assert.equal(value('1e2 / 4'), 25);
  assert.equal(value('2**3'), 8);
});

test('умножение без знака', () => {
  assert.equal(value('2x', { x: 5 }), 10);
  assert.equal(value('2x(x + 1)', { x: 2 }), 12);
  assert.equal(value('2x^2', { x: 3 }), 18);
});

test('функции, константы и школьные названия', () => {
  near(value('sin(pi / 2) + cos(0)'), 2);
  near(value('tg(0) + ln(e)'), 1);
  near(value('log(8, 2)'), 3);
  near(value('sqrt(16) / 2 + abs(-1)'), 3);
  assert.equal(value('min(3, 1, 2) + max(1, 5)'), 6);
});

test('знаки из математического текста: −, ·, π, √, ²', () => {
  assert.equal(value('3 − 2·2'), -1);
  near(value('2π'), 2 * Math.PI);
  assert.equal(value('√16 + 3²'), 13);
});

test('параметры графика подставляются по имени', () => {
  assert.equal(value('a*(x - 1)^2 + b', { a: 2, b: 1, x: 3 }), 9);
  assert.equal(compileValue(7)({}), 7);
  assert.equal(compileValue('a / 2', ['a'])({ a: 5 }), 2.5);
  assert.equal(compileValue(['a + 1'], ['a'])({ a: 5 }), 6); // координата, завёрнутая в список
  assert.throws(() => compileValue([1, 2]), ExprError);
  assert.throws(() => compileValue(null), ExprError);
});

test('ошибки находятся при разборе, а не при вычислении', () => {
  for (const source of ['2 +', 'foo(2)', 'y + 1', 'sin 2', '(1 + 2', '1 $ 2', '', '2 3 )']) {
    assert.throws(() => compile(source, ['x']), ExprError, source);
  }
});

test('выражение не может добраться до объектов JavaScript', () => {
  for (const source of ['alert(1)', 'x.constructor', 'constructor', '__proto__', 'toString()']) {
    assert.throws(() => compile(source, ['x']), ExprError, source);
  }
});

test('свободный разбор для предпросмотра: любые буквы, ab — произведение, f(x) — функция', () => {
  assert.equal(parse('2ab', null).type, 'binary');
  assert.equal(parse('f(x)', null).type, 'apply');
  assert.equal(parse('x1', null).name, 'x1');
  assert.throws(() => parse('solve', null), ExprError);
});
