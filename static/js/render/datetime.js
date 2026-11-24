// Дата и время сообщений — в часовом поясе и формате пользователя.
import { el } from '../dom.js';

const dayFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const dayWithYearFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const fullFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'full', timeStyle: 'medium' });

/** «24 ноября, 14:32»; год добавляется, только если он не текущий. */
export function formatMessageTime(date, now = new Date()) {
  const day = date.getFullYear() === now.getFullYear() ? dayFormat.format(date) : dayWithYearFormat.format(date);
  return `${day}, ${timeFormat.format(date)}`;
}

/** Когда в чате писали в последний раз: сегодня — время, раньше — день. */
export function formatChatDate(isoString, now = new Date()) {
  const date = new Date(isoString);
  if (date.toDateString() === now.toDateString()) return timeFormat.format(date);
  return date.getFullYear() === now.getFullYear() ? dayFormat.format(date) : dayWithYearFormat.format(date);
}

/** <time> с машинным значением и полной датой во всплывающей подсказке. */
export function timeElement(isoString) {
  const date = new Date(isoString);
  return el('time', { datetime: date.toISOString(), title: fullFormat.format(date) }, formatMessageTime(date));
}
