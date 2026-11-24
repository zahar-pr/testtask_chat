// Разбор ответа модели для автопроверки: текст и блоки графиков и тренажёров.
// Используется тот же код, что и в интерфейсе, — поэтому «блок исправен» здесь значит ровно то,
// что пользователь увидит рисунок или тренажёр, а не заглушку «не получилось».
//
// Вход: ответ модели в stdin. Выход: JSON { prose, blocks: [{ kind, error, tasks, sliders }] }.
import { hasWidgetOpening, splitWidgetBlocks } from '../static/js/render/fences.js';
import { normalize as normalizePlot } from '../static/js/widgets/plot/spec.js';
import { normalizeTrainer } from '../static/js/widgets/trainer.js';
import { parseSpec } from '../static/js/widgets/util.js';

function describe(kind, source) {
  try {
    const spec = parseSpec(source);
    if (kind === 'plot') {
      const model = normalizePlot(spec);
      return { kind, error: null, tasks: 0, sliders: model.params.length };
    }
    return { kind, error: null, tasks: normalizeTrainer(spec).tasks.length, sliders: 0 };
  } catch (error) {
    return { kind, error: error instanceof SyntaxError ? 'описание блока повреждено' : error.message, tasks: 0, sliders: 0 };
  }
}

let answer = '';
for await (const chunk of process.stdin) answer += chunk;

const blocks = [];
const prose = [];
for (const part of splitWidgetBlocks(answer.replace(/\r\n?/g, '\n'))) {
  if (part.type === 'widget') blocks.push(describe(part.kind, part.source));
  else {
    // Блок с недописанным описанием остаётся в тексте — интерфейс покажет его как сломанный.
    if (hasWidgetOpening(part.text)) blocks.push({ kind: 'plot', error: 'описание блока не дописано', tasks: 0, sliders: 0 });
    prose.push(part.text);
  }
}
process.stdout.write(JSON.stringify({ prose: prose.join('\n'), blocks }));
