// Единственное место, где фронтенд общается с сервером.
// Сессию подтверждает HttpOnly-cookie: браузер прикладывает её сам, скрипту она недоступна.

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const NETWORK_ERROR = 'Нет связи с сервером. Проверьте подключение и попробуйте ещё раз.';
const STREAM_BROKEN = 'Соединение прервалось, ответ получен не полностью. Попробуйте ещё раз.';

/** Выполнить запрос и вернуть Response; любой неуспех превращается в ApiError. */
async function call(method, path, body) {
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network_error', NETWORK_ERROR);
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'unknown_error',
      payload?.error?.message ?? `Сервер ответил ошибкой (${response.status}). Попробуйте ещё раз.`,
    );
  }
  return response;
}

async function request(method, path, body) {
  const response = await call(method, path, body);
  return response.status === 204 ? null : response.json();
}

/** Читать поток Server-Sent Events как последовательность { event, data }. */
async function* readEvents(response) {
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += value;

      let end;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);

        let event = 'message';
        let data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event: ')) event = line.slice(7);
          else if (line.startsWith('data: ')) data += line.slice(6);
        }
        yield { event, data: JSON.parse(data) };
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

export const login = (accessKey) => request('POST', '/api/auth/login', { access_key: accessKey });
export const logout = () => request('POST', '/api/auth/logout');
export const isAuthenticated = async () => (await request('GET', '/api/auth/session')).authenticated;

export const listChats = async () => (await request('GET', '/api/chats')).chats;
export const listMessages = async (chatId) => (await request('GET', `/api/chats/${chatId}/messages`)).messages;
export const deleteChat = (chatId) => request('DELETE', `/api/chats/${chatId}`);

/**
 * Отправить вопрос в чат chatId (null — начать новый чат; mode — заготовка или null).
 * Ответ модели приходит потоком: каждая новая часть передаётся в onDelta, а результат
 * функции — сохранённые { chat, user, assistant }. onReset вызывается, если ответ оборвался
 * и сервер запросил его заново: показанное до этого нужно стереть.
 */
export async function sendMessage(text, { chatId = null, mode = null, onDelta, onReset } = {}) {
  const path = chatId === null ? '/api/chats' : `/api/chats/${chatId}/messages`;
  const response = await call('POST', path, { text, mode });
  try {
    for await (const { event, data } of readEvents(response)) {
      if (event === 'delta') onDelta?.(data.text);
      else if (event === 'reset') onReset?.();
      else if (event === 'done') return data;
      else if (event === 'error') throw new ApiError(502, data.code, data.message);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, 'network_error', STREAM_BROKEN);
  }
  throw new ApiError(0, 'network_error', STREAM_BROKEN); // поток закончился без события done
}
