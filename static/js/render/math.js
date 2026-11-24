// Отрисовка формул LaTeX через KaTeX (подключён обычным скриптом, глобальная переменная katex).

const OPTIONS = { throwOnError: true, strict: 'ignore', trust: false };

/** Вернуть узел с формулой. Если LaTeX не разобрался — показать исходную запись как есть. */
export function renderMath(tex, { display = false } = {}) {
  const node = document.createElement('span');
  node.className = display ? 'math-display' : 'math-inline';
  const source = tex.trim();
  try {
    window.katex.render(source, node, { ...OPTIONS, displayMode: display });
  } catch {
    node.classList.add('math-error');
    node.textContent = display ? `$$${source}$$` : `$${source}$`;
  }
  return node;
}
