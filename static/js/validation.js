// Правила полей ввода. Те же ограничения проверяет сервер (app/config.py) —
// здесь они нужны, чтобы подсказать пользователю ещё до отправки.

export const ACCESS_KEY = { min: 8, max: 255 };
export const MESSAGE = { max: 500 };

const FORBIDDEN_IN_KEY = /[^A-Za-z0-9_-]/g;

function plural(count, one, few, many) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/**
 * Проверка ключа доступа.
 * message — подсказка под полем (null — показать подсказку по умолчанию),
 * isError — подсвечивать ли поле: «ещё не дописал» ошибкой не считаем.
 */
export function checkAccessKey(value) {
  if (value === '') return { valid: false, isError: false, message: null };

  const forbidden = [...new Set(value.match(FORBIDDEN_IN_KEY) ?? [])];
  if (forbidden.length) {
    const shown = forbidden.slice(0, 3).map((char) => (char.trim() === '' ? 'пробел' : `«${char}»`));
    const rest = forbidden.length > shown.length ? ' и другие' : '';
    return {
      valid: false,
      isError: true,
      message: `Нельзя использовать: ${shown.join(', ')}${rest}. Подойдут латинские буквы, цифры, дефис и подчёркивание.`,
    };
  }
  if (value.length < ACCESS_KEY.min) {
    const left = ACCESS_KEY.min - value.length;
    return {
      valid: false,
      isError: false,
      message: `Ещё ${left} ${plural(left, 'символ', 'символа', 'символов')} — ключ не короче ${ACCESS_KEY.min}.`,
    };
  }
  if (value.length > ACCESS_KEY.max) {
    return {
      valid: false,
      isError: true,
      message: `Слишком длинный ключ: ${value.length} из ${ACCESS_KEY.max} допустимых символов.`,
    };
  }
  return { valid: true, isError: false, message: null };
}

/** Проверка сообщения: не пустое (пробелы не в счёт) и не длиннее лимита. */
export function checkMessage(value) {
  const length = value.length;
  const over = length > MESSAGE.max;
  return { length, over, valid: value.trim() !== '' && !over };
}
