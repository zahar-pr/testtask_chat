// Точка входа: выбирает экран (вход или чат) и переключает их.
import * as api from './api.js';
import { createChatView } from './views/chat.js';
import { createLoginView } from './views/login.js';

const loginView = createLoginView({ onSuccess: showChat });
const chatView = createChatView({
  onSessionLost: () => showLogin('Сессия завершилась. Введите ключ доступа ещё раз.'),
  onLogout: () => showLogin(),
});

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
