// Общие мелочи интерфейса: вопрос «точно удалить?» и короткое уведомление внизу экрана.
import { $ } from '../dom.js';

/** Спросить подтверждение в диалоге. Возвращает Promise<boolean>: true — подтвердили. */
export function confirmAction({ title, text, action }) {
  const dialog = $('#confirm-dialog');
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  $('#confirm-action').textContent = action;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
  });
}

let toastTimer = null;

/** Показать уведомление на несколько секунд (например, о том, что действие не удалось). */
export function notify(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 5000);
}
