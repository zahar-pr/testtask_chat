// Единственное место, где фронтенд общается с сервером.
// Сессию подтверждает HttpOnly-cookie: браузер прикладывает её сам, скрипту она недоступна.

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(method, path, body) {
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Нет связи с сервером. Проверьте подключение и попробуйте ещё раз.');
  }

  if (response.status === 204) return null;

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'unknown_error',
      payload?.error?.message ?? `Сервер ответил ошибкой (${response.status}). Попробуйте ещё раз.`,
    );
  }
  return payload;
}

export const login = (accessKey) => request('POST', '/api/auth/login', { access_key: accessKey });
export const logout = () => request('POST', '/api/auth/logout');
export const isAuthenticated = async () => (await request('GET', '/api/auth/session')).authenticated;

export const listMessages = async () => (await request('GET', '/api/messages')).messages;
export const sendMessage = (text) => request('POST', '/api/messages', { text });
export const clearMessages = () => request('DELETE', '/api/messages');
