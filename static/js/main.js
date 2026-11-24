// Точка входа: выбирает экран (вход или чат) и переключает их.
import * as api from './api.js';
import { createChatView } from './views/chat.js';
import { createLoginView } from './views/login.js';

const loginView = createLoginView({ onSuccess: showChat });
const chatView = createChatView({ onLogout: () => showLogin() });

// Любой запрос может обнаружить, что сессия закончилась, — реагируем на это в одном месте.
api.setUnauthorizedHandler(() => showLogin('Сессия завершилась. Введите ключ доступа ещё раз.'));

function showLogin(notice) {
  chatView.hide();
  loginView.show({ notice });
}

function showChat() {
  loginView.hide();
  chatView.show();
}

// Действует ли сессия, знает только сервер: cookie недоступна скрипту.
try {
  if (await api.isAuthenticated()) showChat();
  else showLogin();
} catch (error) {
  showLogin(error.message);
}
