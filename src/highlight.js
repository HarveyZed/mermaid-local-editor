import { StreamLanguage } from '@codemirror/language';
import { DIAGRAM_TYPES } from './compat.js';

const DIAGRAM_KWS = DIAGRAM_TYPES.map((d) => d.kw);

const KEYWORDS = new Set([
  // 通用
  'graph', 'flowchart', 'subgraph', 'end', 'direction', 'classDef', 'class', 'style',
  'linkStyle', 'click', 'href', 'callback', 'tooltip', 'accTitle', 'accDescr', 'title',
  'note', 'Note', 'over', 'right', 'left', 'of', 'as', 'activate', 'deactivate',
  'autonumber', 'participant', 'actor', 'alt', 'else', 'opt', 'loop', 'par', 'and',
  'critical', 'option', 'break', 'rect', 'box', 'sequenceDiagram', 'classDiagram',
  'stateDiagram', 'erDiagram', 'gantt', 'pie', 'journey', 'gitGraph', 'mindmap',
  'timeline', 'quadrantChart', 'requirementDiagram', 'C4Context', 'C4Container',
  'C4Component', 'C4Dynamic', 'state', 'composite', 'direction', 'section',
  'dateFormat', 'axisFormat', 'excludes', 'includes', 'todayMarker', 'showTooltip',
  'axis', 'axis-x', 'axis-y', 'quadrant-1', 'quadrant-2', 'quadrant-3', 'quadrant-4',
  'requirement', 'functional', 'nonFunctional', 'risk', 'verify', 'element', 'satisfies',
  'requirementDiagram', 'branch', 'merge', 'checkout', 'commit', 'tag', 'cherry-pick',
  'checkpoint', 'detached', 'develop', 'release', 'version', 'insert', 'branchOrder',
  'assert', 'else', 'end', 'group', 'shared', 'swimlane', 'lanes', 'direction',
  'column', 'row', 'columns', 'rows', 'space', 'arch', 'service', 'junction', 'boundary',
  'in', 'out', 'of', 'point', 'beta', 'md', 'log', 'icon', 'call', 'inbox', 'outbox',
]);

const DIRS = new Set(['TD', 'TB', 'BT', 'RL', 'LR', 'td', 'tb', 'bt', 'rl', 'lr']);

export const mermaidHighlight = StreamLanguage.define({
  name: 'mermaid',
  token(stream) {
    if (stream.sol()) {
      // frontmatter
      if (stream.match(/^---/)) {
        stream.skipToEnd();
        return 'meta';
      }
      // init directive
      if (stream.match(/^%%\{\{?/)) {
        stream.skipToEnd();
        return 'meta';
      }
    }
    if (stream.eatSpace()) return null;

    // 注释
    if (stream.match(/^%%[^\n]*/)) return 'comment';

    // 字符串
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/) || stream.match(/^'(?:[^'\\]|\\.)*'?/)) {
      return 'string';
    }

    // 指令 %%{init: ...}%%
    if (stream.match(/^%%\{/)) {
      stream.skipToEnd();
      return 'meta';
    }

    const ch = stream.peek();
    if (ch === null) return null;

    // 图形关键字
    if (/[A-Za-z]/.test(ch)) {
      const word = stream.match(/^[A-Za-z][A-Za-z0-9\-_]*/);
      if (word) {
        const w = word[0];
        if (DIAGRAM_KWS.includes(w)) return 'keyword';
        if (KEYWORDS.has(w)) return 'keyword';
        if (DIRS.has(w)) return 'atom';
        if (w === 'end' || w === 'subgraph') return 'keyword';
        return 'variableName';
      }
    }

    if (/[0-9]/.test(ch)) {
      stream.match(/^[0-9]+(\.[0-9]+)?%?/);
      return 'number';
    }

    // 箭头 / 符号
    if (stream.match(/^(--|-.->|==>|\|>|-\.->|~~~|--o|<\|\.\.|x--x)/)) return 'operator';
    if (stream.match(/^[{}\[\]()()<>|]/)) return 'bracket';
    if (stream.match(/^[:;,]/)) return 'punctuation';
    if (stream.match(/^[-=]/)) return 'operator';

    stream.next();
    return null;
  },
  languageData: {
    commentTokens: { line: '%%' },
    closeBrackets: { brackets: ['(', '[', '{', '"'] },
  },
});
