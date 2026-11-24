// Мелкие помощники для разбора описаний блоков, которые присылает модель.

export const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Непустая строка без пробелов по краям; всё остальное — null. */
export const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * Разобрать JSON-описание блока. Модели часто забывают удвоить обратную косую черту в JSON:
 * пишут "$\frac{1}{2}$" вместо "$\\frac{1}{2}$". Хуже того, «\f» и «\t» — допустимые в JSON
 * символы, и «\frac» молча превратился бы в мусор. Поэтому одиночную черту перед командой
 * LaTeX удваиваем сами.
 */
export function parseSpec(source) {
  const repaired = source.replace(/(\\+)(?=[A-Za-z]{2}|[{}()[\],;!|%&_ ])/g, (slashes) =>
    (slashes.length % 2 === 1 ? `${slashes}\\` : slashes),
  );
  return JSON.parse(repaired);
}
