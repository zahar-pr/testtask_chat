// Отрисовка формул LaTeX через KaTeX (подключён обычным скриптом, глобальная переменная katex).

const OPTIONS = { throwOnError: true, strict: 'ignore', trust: false };

// Пока ответ «печатается», сообщение перерисовывается много раз в секунду. Готовые формулы
// берём из памяти и копируем — заново KaTeX разбирает только то, чего ещё не видел.
const CACHE_LIMIT = 500;
const cache = new Map();

/** Вернуть узел с формулой. Если LaTeX не разобрался — показать исходную запись как есть. */
export function renderMath(tex, { display = false } = {}) {
  const source = tex.trim();
  const key = `${display ? 'D' : 'I'}${source}`;

  let node = cache.get(key);
  if (!node) {
    node = document.createElement('span');
    node.className = display ? 'math-display' : 'math-inline';
    try {
      window.katex.render(source, node, { ...OPTIONS, displayMode: display });
    } catch {
      node.classList.add('math-error');
      node.textContent = display ? `$$${source}$$` : `$${source}$`;
    }
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(key, node);
  }
  return node.cloneNode(true);
}
