// Числа в подписях графиков и тренажёра: по-русски, с десятичной запятой и настоящим минусом.

/** Число для показа человеку: не больше `digits` знаков после запятой, без хвостовых нулей. */
export function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return '—';
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude >= 1e6 || magnitude < 10 ** -digits / 2)) {
    return value.toExponential(1).replace('.', ',').replace('-', '−').replace('e+', '·10^').replace('e−', '·10^−');
  }
  const rounded = Number(value.toFixed(digits));
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
