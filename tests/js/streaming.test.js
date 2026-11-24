// Что показывать, пока ответ ещё «печатается», и где заканчиваются блоки графиков и тренажёров.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stablePart } from '../../static/js/render/streaming.js';
import { jsonObjectEnd, parseSpec } from '../../static/js/widgets/index.js';

const PLOT = '{"x": [0, 1], "functions": [{"expr": "x", "label": "a } b ``` c"}]}';

test('недописанная формула не показывается, дописанная — показывается', () => {
  assert.equal(stablePart('Найдём $x'), 'Найдём');
  assert.equal(stablePart('Формула $$\\frac{a}{b'), 'Формула');
  assert.equal(stablePart('Итог: $$x=1$$ и далее $y'), 'Итог: $$x=1$$ и далее');
  assert.equal(stablePart('Корни: $x_1$, $x_2$.'), 'Корни: $x_1$, $x_2$.');
  assert.equal(stablePart('\\(a+b'), '');
});

test('знак доллара в обычном тексте — не формула', () => {
  assert.equal(stablePart('Цена $5 и всё\nдальше'), 'Цена $5 и всё\nдальше');
});

test('незакрытый полужирный временно закрывается, одинокая звёздочка прячется', () => {
  assert.equal(stablePart('**Шаг 1. Выч'), '**Шаг 1. Выч**');
  assert.equal(stablePart('текст **'), 'текст ');
  assert.equal(stablePart('готово $a$ и *'), 'готово $a$ и ');
});

test('пока описание графика не дописано, вместо него заглушка', () => {
  assert.equal(stablePart('До\n```plot\n{"x": [0, 1], "functions": [{"expr": "x'), 'До\n\n\n```pending-plot\n\n```');
  assert.equal(stablePart('До\n```pl'), 'До\n'); // название блока ещё печатается
});

test('блок готов, как только дописан его JSON — закрывающая строка необязательна', () => {
  const done = `До\n\`\`\`plot\n${PLOT}`;
  assert.equal(stablePart(`${done}\n\`\``), done); // закрывающая строка ещё печатается
  assert.equal(stablePart(`${done}\nТекст $x`), `${done}\nТекст`);
  assert.equal(stablePart(`${done}\nТекст\n\`\`\`\nДальше $x$ и`), `${done}\nТекст\n\`\`\`\nДальше $x$ и`);
});

test('обычный блок кода показывается и недописанным', () => {
  assert.equal(stablePart("код ```py\nx = '$"), "код ```py\nx = '$");
});

test('конец JSON-объекта: скобки и кавычки внутри строк не считаются', () => {
  assert.equal(jsonObjectEnd(`${PLOT} хвост`, 0), PLOT.length);
  assert.equal(jsonObjectEnd('  {"a": "\\"}"} x', 0), 14);
  assert.equal(jsonObjectEnd('{"a": {"b": 1}', 0), -1); // не дописан
  assert.equal(jsonObjectEnd('текст', 0), -1);
});

test('неудвоенная обратная черта LaTeX в JSON чинится', () => {
  assert.equal(parseSpec('{"q": "$\\frac{1}{2}$"}').q, '$\\frac{1}{2}$'); // \f не стал «переводом страницы»
  assert.equal(parseSpec('{"q": "$\\\\frac{1}{2}$"}').q, '$\\frac{1}{2}$'); // правильно удвоенная — не тронута
  assert.equal(parseSpec('{"q": "$20\\%$ и $a \\cdot b$"}').q, '$20\\%$ и $a \\cdot b$');
  assert.equal(parseSpec('{"q": "строка\\nвторая"}').q, 'строка\nвторая'); // настоящий перенос строки цел
});
