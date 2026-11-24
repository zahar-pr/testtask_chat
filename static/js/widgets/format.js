// Числа в подписях графиков и тренажёра: по-русски, с десятичной запятой и настоящим минусом.

/** Число для показа человеку: не больше `digits` знаков после запятой, без хвостовых нулей. */
export function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1e6) {
    // очень большие числа — в виде 1,2·10^6
    const [mantissa, exponent] = value.toExponential(2).split('e');
    return `${formatNumber(Number(mantissa), 2)}·10^${Number(exponent)}`;
  }
  const rounded = Number(value.toFixed(digits)); // погрешность вроде 1e-16 превращается в 0
  return String(Object.is(rounded, -0) ? 0 : rounded).replace('.', ',').replace('-', '−');
}

/** «Круглые» отметки оси между min и max: шаг 1, 2 или 5 на степень десяти. */
export function niceTicks(min, max, targetCount) {
  const span = max - min;
  if (!(span > 0)) return { ticks: [], step: 1 };
  const rough = span / Math.max(2, targetCount);
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough);

  const ticks = [];
  for (let index = Math.ceil(min / step - 1e-9); index * step <= max + step * 1e-9; index++) {
    ticks.push(Number((index * step).toPrecision(12)));
  }
  return { ticks, step };
}

/** Сколько знаков после запятой нужно, чтобы подписи отметок с данным шагом не слились. */
export const decimalsFor = (step) => Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9)));
