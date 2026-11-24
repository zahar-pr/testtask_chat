import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decimalsFor, formatNumber, niceTicks } from '../../static/js/math/format.js';
import { ACCESS_KEY, MESSAGE, checkAccessKey, checkMessage } from '../../static/js/validation.js';

test('числа пишутся по-русски: запятая, настоящий минус, без хвостовых нулей', () => {
  assert.equal(formatNumber(1.5), '1,5');
  assert.equal(formatNumber(-2), '−2');
  assert.equal(formatNumber(2.999999), '3');
  assert.equal(formatNumber(-0.0000001), '0');
  assert.equal(formatNumber(1234567), '1,23·10^6');
  assert.equal(formatNumber(NaN), '—');
});

test('отметки осей — круглые числа', () => {
  assert.deepEqual(niceTicks(0, 10, 5).ticks, [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(niceTicks(-1, 1, 4).ticks, [-1, -0.5, 0, 0.5, 1]);
  assert.equal(decimalsFor(0.5), 1);
  assert.equal(decimalsFor(2), 0);
});

test('ключ доступа: 8–255 символов, латиница, цифры, дефис, подчёркивание', () => {
  assert.equal(checkAccessKey('valid-key_123').valid, true);
  assert.equal(checkAccessKey('a'.repeat(ACCESS_KEY.max)).valid, true);
  assert.equal(checkAccessKey('').isError, false); // пустое поле — ещё не ошибка
  assert.match(checkAccessKey('abc').message, /Ещё 5 символов/);
  assert.equal(checkAccessKey('abc').isError, false); // «не дописал» — не ошибка
  assert.match(checkAccessKey('ключ доступа').message, /Нельзя использовать/);
  assert.match(checkAccessKey('with space1').message, /пробел/);
  assert.equal(checkAccessKey('a'.repeat(ACCESS_KEY.max + 1)).valid, false);
});

test('сообщение: не пустое и не длиннее 500 символов', () => {
  assert.equal(checkMessage('2 + 2').valid, true);
  assert.equal(checkMessage('   \n ').valid, false);
  assert.equal(checkMessage('я'.repeat(MESSAGE.max)).valid, true);
  assert.deepEqual(checkMessage('я'.repeat(MESSAGE.max + 1)), { length: 501, over: true, valid: false });
});
