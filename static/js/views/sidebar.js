// Список сохранённых чатов. На широком экране это колонка слева, на телефоне — выезжающая панель.
import { $, el } from '../dom.js';
import { formatChatDate } from '../render/datetime.js';

export function createSidebar({ onSelect, onNew }) {
  const view = $('#chat-view');
  const list = $('#chat-list');
  const empty = $('#chat-list-empty');
  const newButton = $('#new-chat');
  const toggle = $('#sidebar-toggle');
  const backdrop = $('#sidebar-backdrop');

  let chats = [];
  let activeId = null; // null — открыт новый, ещё не сохранённый чат
  let disabled = false;

  function render() {
    empty.hidden = chats.length > 0;
    newButton.disabled = disabled;
    list.replaceChildren(
      ...chats.map((chat) => {
        const active = chat.id === activeId;
        const button = el('button', { type: 'button', class: `sidebar__chat${active ? ' is-active' : ''}`, title: chat.title, 'aria-current': active ? 'true' : null },
          el('span', { class: 'sidebar__chat-title' }, chat.title),
          el('span', { class: 'sidebar__chat-date' }, formatChatDate(chat.updated_at)),
        );
        button.disabled = disabled && !active;
        button.addEventListener('click', () => {
          setOpen(false);
          onSelect(chat.id);
        });
        return el('li', {}, button);
      }),
    );
  }

  // Панель на узком экране
  function setOpen(open) {
    view.classList.toggle('is-sidebar-open', open);
    backdrop.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  }

  toggle.addEventListener('click', () => setOpen(!view.classList.contains('is-sidebar-open')));
  backdrop.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setOpen(false);
  });
  newButton.addEventListener('click', () => {
    setOpen(false);
    onNew();
  });

  return {
    setChats(next) {
      chats = next;
      render();
    },
    /** Добавить чат или обновить его: чат, в котором только что писали, поднимается наверх. */
    upsert(chat) {
      chats = [chat, ...chats.filter((other) => other.id !== chat.id)];
      render();
    },
    remove(chatId) {
      chats = chats.filter((chat) => chat.id !== chatId);
      render();
    },
    has: (chatId) => chats.some((chat) => chat.id === chatId),
    latest: () => chats[0]?.id ?? null,
    setActive(chatId) {
      activeId = chatId;
      render();
    },
    /** Пока модель отвечает, переключать чаты нельзя: ответ пишется в текущий. */
    setDisabled(value) {
      if (disabled === value) return;
      disabled = value;
      render();
    },
    close: () => setOpen(false),
  };
}
