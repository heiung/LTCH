const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

// Known symbol commands mapped to display glyph and MathML token type ('mi' | 'mo' | 'mspace')
const SYMBOL_MAP = new Map([
  ['\\pm', {display: '±', tag: 'mo'}],
  ['\\mp', {display: '∓', tag: 'mo'}],
  ['\\cdot', {display: '⋅', tag: 'mo'}],
  ['\\times', {display: '×', tag: 'mo'}],
  ['\\div', {display: '÷', tag: 'mo'}],
  ['\\le', {display: '≤', tag: 'mo'}],
  ['\\leq', {display: '≤', tag: 'mo', canonical: '\\le'}],
  ['\\ge', {display: '≥', tag: 'mo'}],
  ['\\geq', {display: '≥', tag: 'mo', canonical: '\\ge'}],
  ['\\neq', {display: '≠', tag: 'mo'}],
  ['\\ne', {display: '≠', tag: 'mo', canonical: '\\neq'}],
  ['\\approx', {display: '≈', tag: 'mo'}],
  ['\\equiv', {display: '≡', tag: 'mo'}],
  ['\\sim', {display: '∼', tag: 'mo'}],
  ['\\cong', {display: '≅', tag: 'mo'}],
  ['\\perp', {display: '⊥', tag: 'mo'}],
  ['\\parallel', {display: '∥', tag: 'mo'}],
  ['\\angle', {display: '∠', tag: 'mo'}],
  ['\\triangle', {display: '△', tag: 'mo'}],
  ['\\infty', {display: '∞', tag: 'mi'}],
  ['\\Rightarrow', {display: '⇒', tag: 'mo'}],
  ['\\Leftarrow', {display: '⇐', tag: 'mo'}],
  ['\\Leftrightarrow', {display: '⇔', tag: 'mo'}],
  ['\\to', {display: '→', tag: 'mo'}],
  ['\\rightarrow', {display: '→', tag: 'mo', canonical: '\\to'}],
  ['\\leftarrow', {display: '←', tag: 'mo'}],
  ['\\mapsto', {display: '↦', tag: 'mo'}],
  ['\\in', {display: '∈', tag: 'mo'}],
  ['\\notin', {display: '∉', tag: 'mo'}],
  ['\\subset', {display: '⊂', tag: 'mo'}],
  ['\\subseteq', {display: '⊆', tag: 'mo'}],
  ['\\supset', {display: '⊃', tag: 'mo'}],
  ['\\supseteq', {display: '⊇', tag: 'mo'}],
  ['\\cup', {display: '∪', tag: 'mo'}],
  ['\\cap', {display: '∩', tag: 'mo'}],
  ['\\setminus', {display: '∖', tag: 'mo'}],
  ['\\varnothing', {display: '∅', tag: 'mi'}],
  ['\\emptyset', {display: '∅', tag: 'mi', canonical: '\\varnothing'}],
  ['\\forall', {display: '∀', tag: 'mo'}],
  ['\\exists', {display: '∃', tag: 'mo'}],
  ['\\circ', {display: '∘', tag: 'mo'}],
  ['\\prime', {display: '′', tag: 'mo'}],
  ['\\dots', {display: '…', tag: 'mo'}],
  ['\\cdots', {display: '⋯', tag: 'mo'}],
  ['\\sum', {display: '∑', tag: 'mo', largeop: true}],
  ['\\prod', {display: '∏', tag: 'mo', largeop: true}],
  ['\\int', {display: '∫', tag: 'mo', largeop: true}],
  ['\\lim', {display: 'lim', tag: 'mi', upright: true}],
  ['\\alpha', {display: 'α', tag: 'mi'}],
  ['\\beta', {display: 'β', tag: 'mi'}],
  ['\\gamma', {display: 'γ', tag: 'mi'}],
  ['\\delta', {display: 'δ', tag: 'mi'}],
  ['\\epsilon', {display: 'ϵ', tag: 'mi'}],
  ['\\varepsilon', {display: 'ε', tag: 'mi'}],
  ['\\zeta', {display: 'ζ', tag: 'mi'}],
  ['\\eta', {display: 'η', tag: 'mi'}],
  ['\\theta', {display: 'θ', tag: 'mi'}],
  ['\\lambda', {display: 'λ', tag: 'mi'}],
  ['\\mu', {display: 'μ', tag: 'mi'}],
  ['\\nu', {display: 'ν', tag: 'mi'}],
  ['\\xi', {display: 'ξ', tag: 'mi'}],
  ['\\pi', {display: 'π', tag: 'mi'}],
  ['\\rho', {display: 'ρ', tag: 'mi'}],
  ['\\sigma', {display: 'σ', tag: 'mi'}],
  ['\\tau', {display: 'τ', tag: 'mi'}],
  ['\\phi', {display: 'ϕ', tag: 'mi'}],
  ['\\varphi', {display: 'φ', tag: 'mi'}],
  ['\\chi', {display: 'χ', tag: 'mi'}],
  ['\\psi', {display: 'ψ', tag: 'mi'}],
  ['\\omega', {display: 'ω', tag: 'mi'}],
  ['\\Gamma', {display: 'Γ', tag: 'mi', upright: true}],
  ['\\Delta', {display: 'Δ', tag: 'mi', upright: true}],
  ['\\Theta', {display: 'Θ', tag: 'mi', upright: true}],
  ['\\Lambda', {display: 'Λ', tag: 'mi', upright: true}],
  ['\\Pi', {display: 'Π', tag: 'mi', upright: true}],
  ['\\Sigma', {display: 'Σ', tag: 'mi', upright: true}],
  ['\\Phi', {display: 'Φ', tag: 'mi', upright: true}],
  ['\\Psi', {display: 'Ψ', tag: 'mi', upright: true}],
  ['\\Omega', {display: 'Ω', tag: 'mi', upright: true}],
  ['\\,', {display: '\u2009', tag: 'mspace'}],
  ['\\;', {display: '\u2004', tag: 'mspace'}],
  ['\\quad', {display: '\u2003', tag: 'mspace'}],
  ['\\square', {display: '□', tag: 'mi', upright: true}],
  ['\\Box', {display: '□', tag: 'mi', upright: true, canonical: '\\square'}],
  ['\\leqslant', {display: '≤', tag: 'mo', canonical: '\\le'}],
  ['\\geqslant', {display: '≥', tag: 'mo', canonical: '\\ge'}],
  ['\\ldots', {display: '…', tag: 'mo', canonical: '\\dots'}]
]);

const BLACKBOARD_MAP = new Map([
  ['R', 'ℝ'],
  ['Z', 'ℤ'],
  ['N', 'ℕ'],
  ['Q', 'ℚ'],
  ['C', 'ℂ']
]);

const TRIG_FUNCTIONS = new Set(['sin', 'cos', 'tan', 'cot', 'ln', 'arcsin', 'arccos', 'arctan']);

const TERM_STOP_CHARS = new Set(['+', '-', '=', '<', '>', ',', ';', ':']);
const TERM_STOP_LATEX = new Set([
  '\\pm', '\\mp', '\\le', '\\ge', '\\neq', '\\approx', '\\equiv',
  '\\sim', '\\cong', '\\perp', '\\parallel',
  '\\Rightarrow', '\\Leftarrow', '\\Leftrightarrow', '\\to', '\\leftarrow', '\\mapsto',
  '\\in', '\\notin', '\\subset', '\\subseteq', '\\supset', '\\supseteq',
  '\\cup', '\\cap', '\\setminus'
]);

const AUTO_WORD_SHORTCUTS = [
  ['nthroot', () => ({kind: 'nthroot'})],
  ['sqrt', () => ({kind: 'sqrt'})],
  ['frac', () => ({kind: 'frac'})],
  ['alpha', () => ({kind: 'sym', latex: '\\alpha'})],
  ['beta', () => ({kind: 'sym', latex: '\\beta'})],
  ['gamma', () => ({kind: 'sym', latex: '\\gamma'})],
  ['delta', () => ({kind: 'sym', latex: '\\delta'})],
  ['Delta', () => ({kind: 'sym', latex: '\\Delta'})],
  ['theta', () => ({kind: 'sym', latex: '\\theta'})],
  ['lambda', () => ({kind: 'sym', latex: '\\lambda'})],
  ['omega', () => ({kind: 'sym', latex: '\\omega'})],
  ['Omega', () => ({kind: 'sym', latex: '\\Omega'})],
  ['infty', () => ({kind: 'sym', latex: '\\infty'})],
  ['pi', () => ({kind: 'sym', latex: '\\pi'})]
];

let nextId = 1;
export function createSlot(items = []) {
  return {id: `s${nextId++}`, items};
}

export function createNode(type, props = {}, slotCount = 0) {
  const slots = Array.from({length: slotCount}, () => createSlot());
  return {id: `n${nextId++}`, type, ...props, slots};
}

export function cloneSlot(slot) {
  return {
    id: slot.id,
    items: slot.items.map(cloneNode)
  };
}

export function cloneNode(node) {
  return {
    ...node,
    slots: node.slots ? node.slots.map(cloneSlot) : []
  };
}

function isSimpleLatexAtom(items) {
  if (items.every(it => it.type === 'char' && /^[0-9]$/.test(it.value))) return items.length >= 1;
  if (items.length !== 1) return false;
  const item = items[0];
  if (item.type === 'char') return /^[0-9a-zA-Z]$/.test(item.value);
  if (item.type === 'sym') return /^\\[a-zA-Z]+$/.test(item.latex);
  if (item.type === 'bb') return true;
  if (item.type === 'rm' && item.value.length === 1) return true;
  return false;
}

function needsCommandSpace(cmd, nextStr) {
  return /^\\[a-zA-Z]+$/.test(cmd) && /^[0-9a-zA-Z]/.test(nextStr);
}

export function serializeSlotToLatex(slot) {
  let out = '';
  for (let i = 0; i < slot.items.length; i++) {
    const piece = serializeNodeToLatex(slot.items[i]);
    if (out && needsCommandSpace(lastCommandIn(out), piece)) {
      out += ' ';
    }
    out += piece;
  }
  return out;
}

function lastCommandIn(str) {
  const m = str.match(/(\\[a-zA-Z]+)$/);
  return m ? m[1] : '';
}

function serializeBaseItems(slot) {
  if (slot.items.length === 0) return '\\placeholder{}';
  const raw = serializeSlotToLatex(slot);
  if (isSimpleLatexAtom(slot.items)) return raw;
  if (slot.items.length === 1 && slot.items[0].type === 'fence') return raw;
  return `{${raw}}`;
}

function serializeArgSlot(slot) {
  return slot.items.length === 0 ? '\\placeholder{}' : serializeSlotToLatex(slot);
}

export function serializeNodeToLatex(node) {
  switch (node.type) {
    case 'placeholder':
      return '\\placeholder{}';
    case 'char':
      return node.value;
    case 'sym':
      return node.latex;
    case 'bb':
      return `\\mathbb{${node.value}}`;
    case 'rm':
      return `\\mathrm{${node.value}}`;
    case 'frac':
      return `\\frac{${serializeArgSlot(node.slots[0])}}{${serializeArgSlot(node.slots[1])}}`;
    case 'binom':
      return `\\binom{${serializeArgSlot(node.slots[0])}}{${serializeArgSlot(node.slots[1])}}`;
    case 'sqrt':
      return `\\sqrt{${serializeArgSlot(node.slots[0])}}`;
    case 'nthroot':
      return `\\sqrt[${serializeArgSlot(node.slots[0])}]{${serializeArgSlot(node.slots[1])}}`;
    case 'sup': {
      const base = serializeBaseItems(node.slots[0]);
      const exp = serializeArgSlot(node.slots[1]);
      return `${base}^{${exp}}`;
    }
    case 'sub': {
      const base = serializeBaseItems(node.slots[0]);
      const sub = serializeArgSlot(node.slots[1]);
      return `${base}_{${sub}}`;
    }
    case 'subsup': {
      const base = serializeBaseItems(node.slots[0]);
      const sub = serializeArgSlot(node.slots[1]);
      const sup = serializeArgSlot(node.slots[2]);
      return `${base}_{${sub}}^{${sup}}`;
    }
    case 'fence':
      return `${node.latexOpen}${serializeSlotToLatex(node.slots[0])}${node.latexClose}`;
    case 'accent': {
      const inner = serializeArgSlot(node.slots[0]);
      if (node.kind === 'arc') return `\\overset{\\frown}{${inner}}`;
      return `\\${node.kind}{${inner}}`;
    }
    case 'fn':
      return `\\${node.name}\\left(${serializeArgSlot(node.slots[0])}\\right)`;
    case 'log':
      return `\\log_{${serializeArgSlot(node.slots[0])}}\\left(${serializeArgSlot(node.slots[1])}\\right)`;
    case 'cases': {
      const rows = node.slots.map(s => serializeArgSlot(s)).join('\\\\');
      if (node.variant === 'or') {
        return `\\left[\\begin{array}{l}${rows}\\end{array}\\right.`;
      }
      if (node.variant === 'lines') {
        return `\\begin{array}{l}${rows}\\end{array}`;
      }
      return `\\begin{cases}${rows}\\end{cases}`;
    }
    default:
      return '';
  }
}

export function hasEmptyRequiredSlot(slot, isRoot = true) {
  if (!isRoot && slot.items.length === 0) return true;
  for (const item of slot.items) {
    if (item.type === 'placeholder') return true;
    if (item.type === 'fence') {
      // Empty parentheses () are allowed, check nested children inside
      for (const child of item.slots[0].items) {
        if (child.type === 'placeholder') return true;
        for (const sub of child.slots || []) {
          if (hasEmptyRequiredSlot(sub, false)) return true;
        }
      }
      continue;
    }
    for (const childSlot of item.slots || []) {
      if (hasEmptyRequiredSlot(childSlot, false)) return true;
    }
  }
  return false;
}

// ============================================================================
// LaTeX -> Visual AST Parser
// Supports all 53 presets + common school/university math expressions cleanly.
// Returns { ok: true, root, markerSlotId, markerOffset } or { ok: false }.
// ============================================================================
export function parseLatexToAst(latexInput) {
  const src = String(latexInput || '').trim();
  const root = createSlot();
  if (!src) {
    return {ok: true, root, marker: null};
  }

  let pos = 0;
  let firstMarker = null; // { slot, offset, priority }

  const recordMarker = (slot, offset, priority) => {
    if (!firstMarker || priority < firstMarker.priority) {
      firstMarker = {slotId: slot.id, offset, priority};
    }
  };

  function skipSpaces() {
    while (pos < src.length && /\s/.test(src[pos])) pos++;
  }

  function matchLiteral(lit) {
    if (src.startsWith(lit, pos)) {
      pos += lit.length;
      return true;
    }
    return false;
  }

  function readCommand() {
    if (src[pos] !== '\\') return null;
    if (pos + 1 >= src.length) return null;
    const next = src[pos + 1];
    if (!/[a-zA-Z]/.test(next)) {
      pos += 2;
      return `\\${next}`;
    }
    let end = pos + 1;
    while (end < src.length && /[a-zA-Z]/.test(src[end])) end++;
    const cmd = src.slice(pos, end);
    pos = end;
    return cmd;
  }

  function parseBracedSlot() {
    skipSpaces();
    if (src[pos] !== '{') return null;
    pos++; // consume '{'
    const slot = createSlot();
    if (!parseSequenceInto(slot, ['}'])) return null;
    if (src[pos] !== '}') return null;
    pos++; // consume '}'
    return slot;
  }

  function parseBracketSlot() {
    skipSpaces();
    if (src[pos] !== '[') return null;
    pos++; // consume '['
    const slot = createSlot();
    if (!parseSequenceInto(slot, [']'])) return null;
    if (src[pos] !== ']') return null;
    pos++; // consume ']'
    return slot;
  }

  function parseSingleScriptArg() {
    skipSpaces();
    if (src[pos] === '{') return parseBracedSlot();
    const slot = createSlot();
    const single = parseSingleAtom(slot);
    if (!single) return null;
    return slot;
  }

  function parseSingleAtom(targetSlot) {
    skipSpaces();
    if (pos >= src.length) return false;

    // Template placeholders #@ and #?
    if (matchLiteral('#@') || matchLiteral('#?')) {
      targetSlot.items.push(createNode('placeholder'));
      return true;
    }

    const ch = src[pos];
    if (ch === '{') {
      const groupSlot = parseBracedSlot();
      if (!groupSlot) return false;
      targetSlot.items.push(...groupSlot.items);
      return true;
    }

    if (ch === '(') {
      pos++;
      const fence = createNode('fence', {open: '(', close: ')', latexOpen: '\\left(', latexClose: '\\right)'}, 1);
      if (!parseSequenceInto(fence.slots[0], [')'])) return false;
      if (src[pos] !== ')') return false;
      pos++;
      targetSlot.items.push(fence);
      return true;
    }

    if (ch === '[') {
      pos++;
      const fence = createNode('fence', {open: '[', close: ']', latexOpen: '\\left[', latexClose: '\\right]'}, 1);
      if (!parseSequenceInto(fence.slots[0], [']'])) return false;
      if (src[pos] !== ']') return false;
      pos++;
      targetSlot.items.push(fence);
      return true;
    }

    if (ch !== '\\') {
      if (ch === '$' || ch === '}' || ch === ')' || ch === ']') return false;
      pos++;
      if (ch === '\'') {
        targetSlot.items.push(createNode('sym', {latex: '\\prime'}));
      } else {
        targetSlot.items.push(createNode('char', {value: ch}));
      }
      return true;
    }

    // Command starting with '\'
    // Check special multi-command structures first
    if (matchLiteral('\\placeholder{}') || matchLiteral('\\placeholder')) {
      if (src[pos] === '{') {
        const skipped = parseBracedSlot();
        if (!skipped) return false;
      }
      targetSlot.items.push(createNode('placeholder'));
      return true;
    }

    if (matchLiteral('\\begin{cases}')) {
      const rows = [createSlot()];
      while (pos < src.length) {
        if (src.startsWith('\\end{cases}', pos)) {
          pos += '\\end{cases}'.length;
          const node = createNode('cases', {variant: 'cases'}, 0);
          node.slots = rows;
          targetSlot.items.push(node);
          return true;
        }
        if (src.startsWith('\\\\', pos)) {
          pos += 2;
          rows.push(createSlot());
          continue;
        }
        if (!parseAtomWithScripts(rows[rows.length - 1], ['\\end{cases}', '\\\\'])) return false;
      }
      return false;
    }

    if (matchLiteral('\\left[\\begin{array}{l}')) {
      const rows = [createSlot()];
      while (pos < src.length) {
        if (src.startsWith('\\end{array}\\right.', pos)) {
          pos += '\\end{array}\\right.'.length;
          const node = createNode('cases', {variant: 'or'}, 0);
          node.slots = rows;
          targetSlot.items.push(node);
          return true;
        }
        if (src.startsWith('\\\\', pos)) {
          pos += 2;
          rows.push(createSlot());
          continue;
        }
        if (!parseAtomWithScripts(rows[rows.length - 1], ['\\end{array}\\right.', '\\\\'])) return false;
      }
      return false;
    }

    if (matchLiteral('\\begin{array}{l}')) {
      const rows = [createSlot()];
      while (pos < src.length) {
        if (src.startsWith('\\end{array}', pos)) {
          pos += '\\end{array}'.length;
          const node = createNode('cases', {variant: 'lines'}, 0);
          node.slots = rows;
          targetSlot.items.push(node);
          return true;
        }
        if (src.startsWith('\\\\', pos)) {
          pos += 2;
          rows.push(createSlot());
          continue;
        }
        if (!parseAtomWithScripts(rows[rows.length - 1], ['\\end{array}', '\\\\'])) return false;
      }
      return false;
    }

    if (matchLiteral('\\overset{\\frown}')) {
      const body = parseBracedSlot();
      if (!body) return false;
      const node = createNode('accent', {kind: 'arc'}, 0);
      node.slots = [body];
      targetSlot.items.push(node);
      return true;
    }

    const savedPos = pos;
    const cmd = readCommand();
    if (!cmd) return false;

    if (cmd === '\\{' || cmd === '\\}') {
      if (cmd === '\\{') {
        const fence = createNode('fence', {open: '{', close: '}', latexOpen: '\\left\\{', latexClose: '\\right\\}'}, 1);
        if (!parseSequenceInto(fence.slots[0], ['\\}'])) return false;
        if (!matchLiteral('\\}')) return false;
        targetSlot.items.push(fence);
        return true;
      }
      pos = savedPos;
      return false;
    }

    if (cmd === '\\left') {
      skipSpaces();
      let open = '';
      let closeToken = '';
      let latexOpen = '';
      let latexClose = '';
      if (matchLiteral('(')) {
        open = '('; closeToken = '\\right)'; latexOpen = '\\left('; latexClose = '\\right)';
      } else if (matchLiteral('[')) {
        open = '['; closeToken = '\\right]'; latexOpen = '\\left['; latexClose = '\\right]';
      } else if (matchLiteral('|')) {
        open = '|'; closeToken = '\\right|'; latexOpen = '\\left|'; latexClose = '\\right|';
      } else if (matchLiteral('\\{')) {
        open = '{'; closeToken = '\\right\\}'; latexOpen = '\\left\\{'; latexClose = '\\right\\}';
      } else {
        return false;
      }
      const closeChar = open === '(' ? ')' : open === '[' ? ']' : open === '|' ? '|' : '}';
      const fence = createNode('fence', {open, close: closeChar, latexOpen, latexClose}, 1);
      if (!parseSequenceInto(fence.slots[0], [closeToken])) return false;
      if (!matchLiteral(closeToken)) return false;
      targetSlot.items.push(fence);
      return true;
    }

    if (cmd === '\\frac' || cmd === '\\dfrac' || cmd === '\\tfrac') {
      const num = parseBracedSlot();
      const den = num && parseBracedSlot();
      if (!num || !den) return false;
      const node = createNode('frac', {}, 0);
      node.slots = [num, den];
      targetSlot.items.push(node);
      return true;
    }

    if (cmd === '\\binom') {
      const top = parseBracedSlot();
      const bot = top && parseBracedSlot();
      if (!top || !bot) return false;
      const node = createNode('binom', {}, 0);
      node.slots = [top, bot];
      targetSlot.items.push(node);
      return true;
    }

    if (cmd === '\\sqrt') {
      skipSpaces();
      if (src[pos] === '[') {
        const deg = parseBracketSlot();
        const body = deg && parseBracedSlot();
        if (!deg || !body) return false;
        const node = createNode('nthroot', {}, 0);
        node.slots = [deg, body];
        targetSlot.items.push(node);
        return true;
      }
      const body = parseBracedSlot();
      if (!body) return false;
      const node = createNode('sqrt', {}, 0);
      node.slots = [body];
      targetSlot.items.push(node);
      return true;
    }

    if (
      cmd === '\\widehat' || cmd === '\\hat' ||
      cmd === '\\overrightarrow' || cmd === '\\vec' ||
      cmd === '\\overline' || cmd === '\\bar' ||
      cmd === '\\widetilde' || cmd === '\\tilde' ||
      cmd === '\\overparen'
    ) {
      const body = parseBracedSlot();
      if (!body) return false;
      const kind = (cmd === '\\widehat' || cmd === '\\hat')
        ? 'widehat'
        : (cmd === '\\overrightarrow' || cmd === '\\vec')
          ? 'overrightarrow'
          : (cmd === '\\widetilde' || cmd === '\\tilde')
            ? 'widetilde'
            : cmd === '\\overparen'
              ? 'arc'
              : 'overline';
      const node = createNode('accent', {kind}, 0);
      node.slots = [body];
      targetSlot.items.push(node);
      return true;
    }

    if (cmd === '\\mathbb') {
      const slot = parseBracedSlot();
      if (!slot || slot.items.length !== 1 || slot.items[0].type !== 'char') return false;
      const letter = slot.items[0].value;
      if (!BLACKBOARD_MAP.has(letter)) return false;
      targetSlot.items.push(createNode('bb', {value: letter}));
      return true;
    }

    if (cmd === '\\mathrm' || cmd === '\\text') {
      const slot = parseBracedSlot();
      if (!slot || !slot.items.every(it => it.type === 'char')) return false;
      const text = slot.items.map(it => it.value).join('');
      if (!text) return false;
      targetSlot.items.push(createNode('rm', {value: text}));
      return true;
    }

    if (cmd === '\\log') {
      skipSpaces();
      if (src[pos] === '_') {
        pos++;
        const base = parseSingleScriptArg();
        if (!base) return false;
        skipSpaces();
        let arg = null;
        if (matchLiteral('\\left(')) {
          arg = createSlot();
          if (!parseSequenceInto(arg, ['\\right)']) || !matchLiteral('\\right)')) return false;
        } else if (matchLiteral('(')) {
          arg = createSlot();
          if (!parseSequenceInto(arg, [')']) || !matchLiteral(')')) return false;
        }
        if (arg) {
          const node = createNode('log', {}, 0);
          node.slots = [base, arg];
          targetSlot.items.push(node);
          return true;
        }
        // \log_{a} without parentheses -> sub node on rm('log')
        const subNode = createNode('sub', {}, 0);
        subNode.slots = [createSlot([createNode('rm', {value: 'log'})]), base];
        targetSlot.items.push(subNode);
        return true;
      }
      targetSlot.items.push(createNode('rm', {value: 'log'}));
      return true;
    }

    const fnName = cmd.slice(1);
    if (TRIG_FUNCTIONS.has(fnName)) {
      const afterCmd = pos;
      skipSpaces();
      if (matchLiteral('\\left(')) {
        const arg = createSlot();
        if (!parseSequenceInto(arg, ['\\right)']) || !matchLiteral('\\right)')) return false;
        const node = createNode('fn', {name: fnName}, 0);
        node.slots = [arg];
        targetSlot.items.push(node);
        return true;
      }
      if (matchLiteral('(')) {
        const arg = createSlot();
        if (!parseSequenceInto(arg, [')']) || !matchLiteral(')')) return false;
        const node = createNode('fn', {name: fnName}, 0);
        node.slots = [arg];
        targetSlot.items.push(node);
        return true;
      }
      pos = afterCmd;
      targetSlot.items.push(createNode('sym', {latex: cmd, display: fnName, upright: true}));
      return true;
    }

    if (SYMBOL_MAP.has(cmd)) {
      const info = SYMBOL_MAP.get(cmd);
      targetSlot.items.push(createNode('sym', {latex: info.canonical || cmd}));
      return true;
    }

    return false;
  }

  function parseAtomWithScripts(targetSlot, stopTokens) {
    skipSpaces();
    if (pos >= src.length) return false;
    for (const stop of stopTokens) {
      if (src.startsWith(stop, pos)) return false;
    }

    const countBefore = targetSlot.items.length;

    if (!parseSingleAtom(targetSlot)) return false;

    skipSpaces();
    if (pos < src.length && (src[pos] === '^' || src[pos] === '_')) {
      let baseSlot;
      if (targetSlot.items.length > countBefore) {
        const baseItems = targetSlot.items.splice(countBefore);
        baseSlot = createSlot(baseItems);
      } else {
        baseSlot = createSlot();
      }

      let subSlot = null;
      let supSlot = null;
      while (pos < src.length) {
        skipSpaces();
        if (src[pos] === '_' && !subSlot) {
          pos++;
          subSlot = parseSingleScriptArg();
          if (!subSlot) return false;
        } else if (src[pos] === '^' && !supSlot) {
          pos++;
          supSlot = parseSingleScriptArg();
          if (!supSlot) return false;
        } else {
          break;
        }
      }

      if (subSlot && supSlot) {
        const node = createNode('subsup', {}, 0);
        node.slots = [baseSlot, subSlot, supSlot];
        targetSlot.items.push(node);
      } else if (supSlot) {
        const node = createNode('sup', {}, 0);
        node.slots = [baseSlot, supSlot];
        targetSlot.items.push(node);
      } else if (subSlot) {
        const node = createNode('sub', {}, 0);
        node.slots = [baseSlot, subSlot];
        targetSlot.items.push(node);
      }
    }

    return true;
  }

  function parseSequenceInto(targetSlot, stopTokens = []) {
    while (pos < src.length) {
      skipSpaces();
      if (pos >= src.length) break;
      let stopped = false;
      for (const stop of stopTokens) {
        if (src.startsWith(stop, pos)) {
          stopped = true;
          break;
        }
      }
      if (stopped) break;
      if (!parseAtomWithScripts(targetSlot, stopTokens)) return false;
    }
    return true;
  }

  const ok = parseSequenceInto(root, []);
  skipSpaces();
  if (!ok || pos < src.length) {
    return {ok: false};
  }

  function normalizeSlotPlaceholders(slot, isRootSlot) {
    if (!isRootSlot && slot.items.length === 1 && slot.items[0].type === 'placeholder') {
      slot.items = [];
      return;
    }
    for (const item of slot.items) {
      for (const child of item.slots || []) {
        normalizeSlotPlaceholders(child, false);
      }
    }
  }
  normalizeSlotPlaceholders(root, true);

  const targets = listFillableTargets(root, true);
  return {ok: true, root, marker: targets[0] || null};
}

// ============================================================================
// Pure AST Tree Helpers (Parent lookup, Cursor navigation, Editing operations)
// ============================================================================
export function buildSlotIndex(rootSlot) {
  const map = new Map();
  function walk(slot, parentNode, slotIdxInParent, parentSlot, nodeIdxInParentSlot) {
    map.set(slot.id, {slot, parentNode, slotIdxInParent, parentSlot, nodeIdxInParentSlot});
    slot.items.forEach((item, idx) => {
      (item.slots || []).forEach((childSlot, sIdx) => {
        walk(childSlot, item, sIdx, slot, idx);
      });
    });
  }
  walk(rootSlot, null, -1, null, -1);
  return map;
}

export function listAllSlots(rootSlot) {
  const out = [];
  function walk(slot, isRoot) {
    if (!isRoot) out.push(slot);
    for (const item of slot.items) {
      for (const child of item.slots || []) walk(child, false);
    }
  }
  walk(rootSlot, true);
  return out;
}

export function listFillableTargets(rootSlot, includeRootPlaceholders = false) {
  const targets = [];
  function walk(slot, isRoot) {
    if (!isRoot && slot.items.length === 0) {
      targets.push({slotId: slot.id, offset: 0});
      return;
    }
    slot.items.forEach((item, idx) => {
      if (item.type === 'placeholder' && (!isRoot || includeRootPlaceholders || slot.items.length > 0)) {
        targets.push({slotId: slot.id, offset: idx});
      }
      for (const child of item.slots || []) {
        walk(child, false);
      }
    });
  }
  walk(rootSlot, true);
  return targets;
}

function isTermStopper(node) {
  if (node.type === 'placeholder') return true;
  if (node.type === 'char') return TERM_STOP_CHARS.has(node.value);
  if (node.type === 'sym') return TERM_STOP_LATEX.has(node.latex);
  return false;
}

// Headless-capable Visual Math Model so every editing action can be unit-tested in Node
export function createVisualMathModel(initialLatex = '') {
  let root = createSlot();
  let cursor = {slotId: root.id, offset: 0};
  const undoStack = [];
  const redoStack = [];

  function saveUndo() {
    undoStack.push({root: cloneSlot(root), cursor: {...cursor}});
    if (undoStack.length > 80) undoStack.shift();
    redoStack.length = 0;
  }

  function ensureValidCursor() {
    const idx = buildSlotIndex(root);
    if (!idx.has(cursor.slotId)) {
      cursor = {slotId: root.id, offset: root.items.length};
      return idx;
    }
    const slot = idx.get(cursor.slotId).slot;
    cursor.offset = Math.max(0, Math.min(cursor.offset, slot.items.length));
    return idx;
  }

  function setLatex(latex) {
    const parsed = parseLatexToAst(latex);
    if (!parsed.ok) return false;
    root = parsed.root;
    cursor = {slotId: root.id, offset: root.items.length};
    undoStack.length = 0;
    redoStack.length = 0;
    return true;
  }

  if (initialLatex) {
    setLatex(initialLatex);
  }

  function getLatex() {
    return serializeSlotToLatex(root);
  }

  function moveRight() {
    const idx = ensureValidCursor();
    const info = idx.get(cursor.slotId);
    const {slot} = info;
    if (cursor.offset < slot.items.length) {
      const nextNode = slot.items[cursor.offset];
      if (nextNode.slots && nextNode.slots.length > 0) {
        cursor = {slotId: nextNode.slots[0].id, offset: 0};
      } else {
        cursor = {slotId: slot.id, offset: cursor.offset + 1};
      }
      return true;
    }
    if (info.parentNode) {
      const siblings = info.parentNode.slots;
      if (info.slotIdxInParent + 1 < siblings.length) {
        cursor = {slotId: siblings[info.slotIdxInParent + 1].id, offset: 0};
      } else {
        cursor = {slotId: info.parentSlot.id, offset: info.nodeIdxInParentSlot + 1};
      }
      return true;
    }
    return false;
  }

  function moveLeft() {
    const idx = ensureValidCursor();
    const info = idx.get(cursor.slotId);
    const {slot} = info;
    if (cursor.offset > 0) {
      const prevNode = slot.items[cursor.offset - 1];
      if (prevNode.slots && prevNode.slots.length > 0) {
        const lastSlot = prevNode.slots[prevNode.slots.length - 1];
        cursor = {slotId: lastSlot.id, offset: lastSlot.items.length};
      } else {
        cursor = {slotId: slot.id, offset: cursor.offset - 1};
      }
      return true;
    }
    if (info.parentNode) {
      const siblings = info.parentNode.slots;
      if (info.slotIdxInParent > 0) {
        const prevSib = siblings[info.slotIdxInParent - 1];
        cursor = {slotId: prevSib.id, offset: prevSib.items.length};
      } else {
        cursor = {slotId: info.parentSlot.id, offset: info.nodeIdxInParentSlot};
      }
      return true;
    }
    return false;
  }

  function moveVertical(direction) {
    const idx = ensureValidCursor();
    let cur = idx.get(cursor.slotId);
    while (cur && cur.parentNode) {
      const p = cur.parentNode;
      const sIdx = cur.slotIdxInParent;
      if ((p.type === 'frac' || p.type === 'binom') && direction === 'down' && sIdx === 0) {
        cursor = {slotId: p.slots[1].id, offset: Math.min(cursor.offset, p.slots[1].items.length)};
        return true;
      }
      if ((p.type === 'frac' || p.type === 'binom') && direction === 'up' && sIdx === 1) {
        cursor = {slotId: p.slots[0].id, offset: Math.min(cursor.offset, p.slots[0].items.length)};
        return true;
      }
      if (p.type === 'cases') {
        const target = direction === 'down' ? sIdx + 1 : sIdx - 1;
        if (target >= 0 && target < p.slots.length) {
          cursor = {slotId: p.slots[target].id, offset: Math.min(cursor.offset, p.slots[target].items.length)};
          return true;
        }
      }
      if (p.type === 'subsup') {
        if (direction === 'down' && sIdx === 2) {
          cursor = {slotId: p.slots[1].id, offset: p.slots[1].items.length};
          return true;
        }
        if (direction === 'up' && sIdx === 1) {
          cursor = {slotId: p.slots[2].id, offset: p.slots[2].items.length};
          return true;
        }
      }
      if (p.type === 'sup') {
        if (direction === 'up' && sIdx === 0) {
          cursor = {slotId: p.slots[1].id, offset: p.slots[1].items.length};
          return true;
        }
        if (direction === 'down' && sIdx === 1) {
          cursor = {slotId: p.slots[0].id, offset: p.slots[0].items.length};
          return true;
        }
      }
      if (p.type === 'sub') {
        if (direction === 'down' && sIdx === 0) {
          cursor = {slotId: p.slots[1].id, offset: p.slots[1].items.length};
          return true;
        }
        if (direction === 'up' && sIdx === 1) {
          cursor = {slotId: p.slots[0].id, offset: p.slots[0].items.length};
          return true;
        }
      }
      cur = idx.get(cur.parentSlot.id);
    }
    return false;
  }

  function jumpSlot(reverse = false) {
    ensureValidCursor();
    const fillable = listFillableTargets(root, true);
    if (fillable.length > 0) {
      const exactIdx = fillable.findIndex(t => t.slotId === cursor.slotId && t.offset === cursor.offset);
      if (!reverse) {
        if (exactIdx === -1) {
          cursor = {...fillable[0]};
          return true;
        }
        if (exactIdx + 1 < fillable.length) {
          cursor = {...fillable[exactIdx + 1]};
          return true;
        }
        if (fillable.length >= 1 && exactIdx !== 0) {
          cursor = {...fillable[0]};
          return true;
        }
        return false;
      }
      if (exactIdx > 0) {
        cursor = {...fillable[exactIdx - 1]};
        return true;
      }
      if (exactIdx === -1) {
        cursor = {...fillable[fillable.length - 1]};
        return true;
      }
      return false;
    }

    const slots = listAllSlots(root);
    if (!slots.length) return false;
    const currentIdx = slots.findIndex(s => s.id === cursor.slotId);
    if (!reverse) {
      if (currentIdx === -1) {
        cursor = {slotId: slots[0].id, offset: slots[0].items.length};
        return true;
      }
      if (currentIdx + 1 < slots.length) {
        const next = slots[currentIdx + 1];
        cursor = {slotId: next.id, offset: next.items.length};
        return true;
      }
      return false;
    }
    if (currentIdx > 0) {
      const prev = slots[currentIdx - 1];
      cursor = {slotId: prev.id, offset: prev.items.length};
      return true;
    }
    return false;
  }

  function consumePlaceholderAtCursor(slot) {
    if (slot.items[cursor.offset]?.type === 'placeholder') {
      slot.items.splice(cursor.offset, 1);
    }
  }

  function insertFraction() {
    saveUndo();
    const idx = ensureValidCursor();
    const {slot} = idx.get(cursor.slotId);
    consumePlaceholderAtCursor(slot);
    let start = cursor.offset;
    while (start > 0 && !isTermStopper(slot.items[start - 1])) {
      start--;
    }
    const taken = slot.items.splice(start, cursor.offset - start);
    const frac = createNode('frac', {}, 2);
    if (taken.length > 0) {
      frac.slots[0].items.push(...taken);
      slot.items.splice(start, 0, frac);
      cursor = {slotId: frac.slots[1].id, offset: 0};
    } else {
      slot.items.splice(start, 0, frac);
      cursor = {slotId: frac.slots[0].id, offset: 0};
    }
  }

  function insertScript(kind) {
    // kind: 'sup' | 'sub'
    saveUndo();
    const idx = ensureValidCursor();
    const {slot} = idx.get(cursor.slotId);
    if (cursor.offset > 0) {
      const prev = slot.items[cursor.offset - 1];
      if (kind === 'sup' && prev.type === 'sub') {
        const upgraded = createNode('subsup', {}, 0);
        upgraded.slots = [prev.slots[0], prev.slots[1], createSlot()];
        slot.items[cursor.offset - 1] = upgraded;
        cursor = {slotId: upgraded.slots[2].id, offset: 0};
        return;
      }
      if (kind === 'sub' && prev.type === 'sup') {
        const upgraded = createNode('subsup', {}, 0);
        upgraded.slots = [prev.slots[0], createSlot(), prev.slots[1]];
        slot.items[cursor.offset - 1] = upgraded;
        cursor = {slotId: upgraded.slots[1].id, offset: 0};
        return;
      }
      if (!isTermStopper(prev)) {
        let takeStart = cursor.offset - 1;
        if (prev.type === 'char' && /^[0-9.]$/.test(prev.value)) {
          while (takeStart > 0 && slot.items[takeStart - 1].type === 'char' && /^[0-9.]$/.test(slot.items[takeStart - 1].value)) {
            takeStart--;
          }
        }
        const baseAtoms = slot.items.splice(takeStart, cursor.offset - takeStart);
        const node = createNode(kind, {}, 2);
        node.slots[0].items.push(...baseAtoms);
        slot.items.splice(takeStart, 0, node);
        cursor = {slotId: node.slots[1].id, offset: 0};
        return;
      }
    }
    const node = createNode(kind, {}, 2);
    slot.items.splice(cursor.offset, 0, node);
    cursor = {slotId: node.slots[0].id, offset: 0};
  }

  function insertFence(openChar) {
    const idx = ensureValidCursor();
    const info = idx.get(cursor.slotId);
    const {slot} = info;
    // For '|', if already at end of '|...|' fence, step out
    if (
      openChar === '|' &&
      info.parentNode?.type === 'fence' &&
      info.parentNode.open === '|' &&
      cursor.offset === slot.items.length
    ) {
      cursor = {slotId: info.parentSlot.id, offset: info.nodeIdxInParentSlot + 1};
      return;
    }
    saveUndo();
    consumePlaceholderAtCursor(slot);
    const spec = openChar === '('
      ? {open: '(', close: ')', latexOpen: '\\left(', latexClose: '\\right)'}
      : openChar === '['
        ? {open: '[', close: ']', latexOpen: '\\left[', latexClose: '\\right]'}
        : openChar === '{'
          ? {open: '{', close: '}', latexOpen: '\\left\\{', latexClose: '\\right\\}'}
          : {open: '|', close: '|', latexOpen: '\\left|', latexClose: '\\right|'};
    const fence = createNode('fence', spec, 1);
    slot.items.splice(cursor.offset, 0, fence);
    cursor = {slotId: fence.slots[0].id, offset: 0};
  }

  function closeFenceOrInsert(closeChar) {
    const idx = ensureValidCursor();
    const info = idx.get(cursor.slotId);
    if (
      info.parentNode?.type === 'fence' &&
      info.parentNode.close === closeChar &&
      cursor.offset === info.slot.items.length
    ) {
      cursor = {slotId: info.parentSlot.id, offset: info.nodeIdxInParentSlot + 1};
      return true;
    }
    return false;
  }

  function checkTrailingAutoShortcuts(slot) {
    // Check 2-char / 3-char operator combinations before cursor
    const end = cursor.offset;
    const tailChars = (len) => {
      if (end < len) return null;
      let s = '';
      for (let i = end - len; i < end; i++) {
        const it = slot.items[i];
        if (it.type === 'char') s += it.value;
        else if (it.type === 'sym' && it.latex === '\\le' && len === 2) return null;
        else return null;
      }
      return s;
    };

    // '<=>' when user had '\le' + '>'
    if (end >= 2 && slot.items[end - 2].type === 'sym' && slot.items[end - 2].latex === '\\le' &&
        slot.items[end - 1].type === 'char' && slot.items[end - 1].value === '>') {
      slot.items.splice(end - 2, 2, createNode('sym', {latex: '\\Leftrightarrow'}));
      cursor.offset = end - 1;
      return;
    }

    const two = tailChars(2);
    const twoMap = {
      '<=': '\\le',
      '>=': '\\ge',
      '!=': '\\neq',
      '+-': '\\pm',
      '->': '\\to',
      '=>': '\\Rightarrow'
    };
    if (two && twoMap[two]) {
      slot.items.splice(end - 2, 2, createNode('sym', {latex: twoMap[two]}));
      cursor.offset = end - 1;
      return;
    }

    // Trig functions followed by '(' : handled in typeKey('(')
    // Word shortcuts (sqrt, nthroot, alpha, beta, Delta, pi, infty...)
    for (const [word, makeAction] of AUTO_WORD_SHORTCUTS) {
      const candidate = tailChars(word.length);
      if (candidate === word) {
        // Ensure char before word is not another ASCII letter (avoid matching inside longer word)
        const prevIdx = end - word.length - 1;
        if (prevIdx >= 0 && slot.items[prevIdx].type === 'char' && /[a-zA-Z]/.test(slot.items[prevIdx].value)) {
          continue;
        }
        const action = makeAction();
        slot.items.splice(end - word.length, word.length);
        cursor.offset = end - word.length;
        if (action.kind === 'sqrt') {
          const node = createNode('sqrt', {}, 1);
          slot.items.splice(cursor.offset, 0, node);
          cursor = {slotId: node.slots[0].id, offset: 0};
        } else if (action.kind === 'nthroot') {
          const node = createNode('nthroot', {}, 2);
          slot.items.splice(cursor.offset, 0, node);
          cursor = {slotId: node.slots[0].id, offset: 0};
        } else if (action.kind === 'frac') {
          const node = createNode('frac', {}, 2);
          slot.items.splice(cursor.offset, 0, node);
          cursor = {slotId: node.slots[0].id, offset: 0};
        } else if (action.kind === 'sym') {
          slot.items.splice(cursor.offset, 0, createNode('sym', {latex: action.latex}));
          cursor.offset += 1;
        }
        return;
      }
    }
  }

  function typeText(ch) {
    if (!ch) return;
    if (ch.length > 1) {
      for (const c of ch) typeText(c);
      return;
    }
    if (ch === '$') return;
    if (ch === '/') {
      insertFraction();
      return;
    }
    if (ch === '^') {
      insertScript('sup');
      return;
    }
    if (ch === '_') {
      insertScript('sub');
      return;
    }
    if (ch === '(') {
      const idx = ensureValidCursor();
      const {slot} = idx.get(cursor.slotId);
      // Check if preceding letters form sin, cos, tan, cot, ln
      for (const fnName of TRIG_FUNCTIONS) {
        if (cursor.offset >= fnName.length) {
          let match = true;
          for (let k = 0; k < fnName.length; k++) {
            const it = slot.items[cursor.offset - fnName.length + k];
            if (!it || it.type !== 'char' || it.value !== fnName[k]) {
              match = false;
              break;
            }
          }
          const beforeIdx = cursor.offset - fnName.length - 1;
          if (match && !(beforeIdx >= 0 && slot.items[beforeIdx].type === 'char' && /[a-zA-Z]/.test(slot.items[beforeIdx].value))) {
            saveUndo();
            slot.items.splice(cursor.offset - fnName.length, fnName.length);
            const fnNode = createNode('fn', {name: fnName}, 1);
            const insertAt = cursor.offset - fnName.length;
            slot.items.splice(insertAt, 0, fnNode);
            cursor = {slotId: fnNode.slots[0].id, offset: 0};
            return;
          }
        }
      }
      insertFence('(');
      return;
    }
    if (ch === '[' || ch === '{' || ch === '|') {
      insertFence(ch);
      return;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      closeFenceOrInsert(ch);
      return;
    }
    if (ch === ' ') {
      // Spacebar steps out of current child slot if inside a structure!
      const idx = ensureValidCursor();
      const info = idx.get(cursor.slotId);
      if (info.parentNode && cursor.offset === info.slot.items.length) {
        moveRight();
      }
      return;
    }

    saveUndo();
    const idx = ensureValidCursor();
    const {slot} = idx.get(cursor.slotId);
    consumePlaceholderAtCursor(slot);
    if (ch === '*') {
      slot.items.splice(cursor.offset, 0, createNode('sym', {latex: '\\cdot'}));
      cursor.offset += 1;
      return;
    }
    if (ch === '\'') {
      slot.items.splice(cursor.offset, 0, createNode('sym', {latex: '\\prime'}));
      cursor.offset += 1;
      return;
    }
    slot.items.splice(cursor.offset, 0, createNode('char', {value: ch}));
    cursor.offset += 1;
    checkTrailingAutoShortcuts(slot);
  }

  function backspace() {
    const idx = ensureValidCursor();
    const info = idx.get(cursor.slotId);
    const {slot} = info;

    if (cursor.offset > 0) {
      const prev = slot.items[cursor.offset - 1];
      if (!prev.slots || prev.slots.length === 0) {
        saveUndo();
        slot.items.splice(cursor.offset - 1, 1);
        cursor.offset -= 1;
        return true;
      }
      const allEmpty = prev.slots.every(s => s.items.length === 0);
      if (allEmpty) {
        saveUndo();
        slot.items.splice(cursor.offset - 1, 1);
        cursor.offset -= 1;
        return true;
      }
      // Step into last slot of composite node instead of deleting non-empty structure
      const last = prev.slots[prev.slots.length - 1];
      cursor = {slotId: last.id, offset: last.items.length};
      return true;
    }

    // cursor.offset === 0 inside a child slot
    if (!info.parentNode) return false;
    const p = info.parentNode;
    const pSlot = info.parentSlot;
    const pIdx = info.nodeIdxInParentSlot;
    const sIdx = info.slotIdxInParent;

    if ((p.type === 'sup' || p.type === 'sub') && sIdx === 1 && slot.items.length === 0) {
      saveUndo();
      const baseItems = p.slots[0].items;
      pSlot.items.splice(pIdx, 1, ...baseItems);
      cursor = {slotId: pSlot.id, offset: pIdx + baseItems.length};
      return true;
    }

    if (p.type === 'frac' && sIdx === 1 && slot.items.length === 0) {
      saveUndo();
      const numItems = p.slots[0].items;
      pSlot.items.splice(pIdx, 1, ...numItems);
      cursor = {slotId: pSlot.id, offset: pIdx + numItems.length};
      return true;
    }

    if ((p.type === 'sqrt' || p.type === 'fence' || p.type === 'accent' || p.type === 'fn') && slot.items.length === 0) {
      saveUndo();
      pSlot.items.splice(pIdx, 1);
      cursor = {slotId: pSlot.id, offset: pIdx};
      return true;
    }

    if (p.type === 'cases' && p.variant === 'lines') {
      if (sIdx > 0) {
        saveUndo();
        const prevSlot = p.slots[sIdx - 1];
        const joinOffset = prevSlot.items.length;
        prevSlot.items.push(...slot.items);
        p.slots.splice(sIdx, 1);
        if (p.slots.length === 1) {
          pSlot.items.splice(pIdx, 1, ...prevSlot.items);
          cursor = {slotId: pSlot.id, offset: pIdx + joinOffset};
        } else {
          cursor = {slotId: prevSlot.id, offset: joinOffset};
        }
        return true;
      }
      if (sIdx === 0 && slot.items.length === 0 && p.slots.length > 1) {
        saveUndo();
        p.slots.splice(0, 1);
        if (p.slots.length === 1) {
          const rem = p.slots[0].items;
          pSlot.items.splice(pIdx, 1, ...rem);
          cursor = {slotId: pSlot.id, offset: pIdx};
        } else {
          cursor = {slotId: p.slots[0].id, offset: 0};
        }
        return true;
      }
    }

    if (p.type === 'cases' && slot.items.length === 0 && p.slots.length > 1) {
      saveUndo();
      p.slots.splice(sIdx, 1);
      const targetIdx = Math.max(0, sIdx - 1);
      const targetSlot = p.slots[targetIdx];
      cursor = {slotId: targetSlot.id, offset: targetSlot.items.length};
      return true;
    }

    moveLeft();
    return true;
  }

  function deleteForward() {
    const idx = ensureValidCursor();
    const {slot} = idx.get(cursor.slotId);
    if (cursor.offset < slot.items.length) {
      const next = slot.items[cursor.offset];
      if (!next.slots || next.slots.length === 0 || next.slots.every(s => s.items.length === 0)) {
        saveUndo();
        slot.items.splice(cursor.offset, 1);
        return true;
      }
      cursor = {slotId: next.slots[0].id, offset: 0};
      return true;
    }
    return false;
  }

  function addSystemRow() {
    const idx = ensureValidCursor();
    let cur = idx.get(cursor.slotId);
    while (cur && cur.parentNode) {
      if (cur.parentNode.type === 'cases' && cur.parentNode.slots.length < 8) {
        saveUndo();
        const newRow = createSlot();
        cur.parentNode.slots.splice(cur.slotIdxInParent + 1, 0, newRow);
        cursor = {slotId: newRow.id, offset: 0};
        return true;
      }
      cur = idx.get(cur.parentSlot.id);
    }
    return false;
  }

  function insertNewline() {
    const idx = ensureValidCursor();
    let cur = idx.get(cursor.slotId);
    while (cur && cur.parentNode && cur.parentNode.type !== 'cases') {
      cur = idx.get(cur.parentSlot.id);
    }
    if (cur && cur.parentNode?.type === 'cases') {
      if (cur.parentNode.slots.length >= 12) return false;
      saveUndo();
      const splitSameSlot = cursor.slotId === cur.slot.id;
      const tail = splitSameSlot ? cur.slot.items.splice(cursor.offset) : [];
      const newRow = createSlot(tail);
      cur.parentNode.slots.splice(cur.slotIdxInParent + 1, 0, newRow);
      cursor = {slotId: newRow.id, offset: 0};
      return true;
    }

    saveUndo();
    const splitAtRoot = cursor.slotId === root.id;
    const firstItems = splitAtRoot ? root.items.slice(0, cursor.offset) : root.items.slice();
    const secondItems = splitAtRoot ? root.items.slice(cursor.offset) : [];
    const linesNode = createNode('cases', {variant: 'lines'}, 0);
    const line0 = createSlot(firstItems);
    const line1 = createSlot(secondItems);
    linesNode.slots = [line0, line1];
    root.items = [linesNode];
    cursor = {slotId: line1.id, offset: 0};
    return true;
  }

  function trimEmptyLines() {
    if (root.items.length === 1 && root.items[0].type === 'cases' && root.items[0].variant === 'lines') {
      const linesNode = root.items[0];
      const nonEmpty = linesNode.slots.filter(s => s.items.length > 0);
      if (nonEmpty.length === 0) {
        root.items = [];
        cursor = {slotId: root.id, offset: 0};
        return true;
      }
      if (nonEmpty.length === 1) {
        root.items = nonEmpty[0].items;
        ensureValidCursor();
        return true;
      }
      if (nonEmpty.length < linesNode.slots.length) {
        linesNode.slots = nonEmpty;
        ensureValidCursor();
        return true;
      }
    }
    return false;
  }

  function insertTemplate(template) {
    const parsed = parseLatexToAst(template);
    if (!parsed.ok) return false;
    saveUndo();
    const idx = ensureValidCursor();
    const {slot} = idx.get(cursor.slotId);

    // Smart base adoption when template starts with #@^{...} or #@_{...}
    if (
      parsed.root.items.length === 1 &&
      (parsed.root.items[0].type === 'sup' || parsed.root.items[0].type === 'sub') &&
      parsed.root.items[0].slots[0].items.length === 0 &&
      cursor.offset > 0 &&
      !isTermStopper(slot.items[cursor.offset - 1])
    ) {
      const node = parsed.root.items[0];
      let takeStart = cursor.offset - 1;
      const lastPrev = slot.items[takeStart];
      if (lastPrev.type === 'char' && /^[0-9.]$/.test(lastPrev.value)) {
        while (takeStart > 0 && slot.items[takeStart - 1].type === 'char' && /^[0-9.]$/.test(slot.items[takeStart - 1].value)) {
          takeStart--;
        }
      }
      const baseAtoms = slot.items.splice(takeStart, cursor.offset - takeStart);
      node.slots[0].items.push(...baseAtoms);
      slot.items.splice(takeStart, 0, node);
      if (node.slots[1].items.length === 0) {
        cursor = {slotId: node.slots[1].id, offset: 0};
      } else {
        cursor = {slotId: slot.id, offset: takeStart + 1};
      }
      return true;
    }

    const insertedItems = parsed.root.items;
    consumePlaceholderAtCursor(slot);
    const insertPos = cursor.offset;
    slot.items.splice(insertPos, 0, ...insertedItems);

    const fillableAfter = listFillableTargets(root, true);
    if (fillableAfter.length > 0) {
      // Pick first fillable target within or after inserted region
      const inInserted = parsed.marker
        ? (parsed.marker.slotId === parsed.root.id
          ? {slotId: slot.id, offset: insertPos + parsed.marker.offset}
          : parsed.marker)
        : fillableAfter[0];
      cursor = {...inInserted};
    } else {
      cursor = {slotId: slot.id, offset: insertPos + insertedItems.length};
    }
    ensureValidCursor();
    return true;
  }

  function undo() {
    if (!undoStack.length) return false;
    redoStack.push({root: cloneSlot(root), cursor: {...cursor}});
    const prev = undoStack.pop();
    root = prev.root;
    cursor = prev.cursor;
    ensureValidCursor();
    return true;
  }

  function redo() {
    if (!redoStack.length) return false;
    undoStack.push({root: cloneSlot(root), cursor: {...cursor}});
    const next = redoStack.pop();
    root = next.root;
    cursor = next.cursor;
    ensureValidCursor();
    return true;
  }

  return {
    get root() { return root; },
    get cursor() { return cursor; },
    setCursor(slotId, offset) {
      cursor = {slotId, offset};
      ensureValidCursor();
    },
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
    get hasIncompleteSlots() { return hasEmptyRequiredSlot(root, true); },
    get isEmpty() { return root.items.length === 0; },
    isInsideSystem() {
      const idx = ensureValidCursor();
      let cur = idx.get(cursor.slotId);
      while (cur && cur.parentNode) {
        if (cur.parentNode.type === 'cases') return true;
        cur = idx.get(cur.parentSlot.id);
      }
      return false;
    },
    setLatex,
    getLatex,
    typeText,
    insertFraction,
    insertScript,
    insertFence,
    insertTemplate,
    moveLeft,
    moveRight,
    moveVertical,
    jumpSlot,
    backspace,
    deleteForward,
    addSystemRow,
    insertNewline,
    trimEmptyLines,
    undo,
    redo
  };
}

// ============================================================================
// DOM Component: Native MathML Renderer + Interactive Cursor + Virtual Keypad
// ZERO inline style="" attributes -> 100% compliant with strict CSP style-src 'self'
// ============================================================================
export function createVisualMathField(options = {}) {
  const model = createVisualMathModel();
  let focused = false;

  const container = document.createElement('div');
  container.className = 'vmf-container';

  const fieldBox = document.createElement('div');
  fieldBox.className = 'vmf-field';
  fieldBox.setAttribute('role', 'group');
  fieldBox.setAttribute('aria-label', options.ariaLabel || 'Ô nhập công thức trực quan');

  const hiddenInput = document.createElement('input');
  hiddenInput.type = 'text';
  hiddenInput.className = 'vmf-hidden-input';
  hiddenInput.autocomplete = 'off';
  hiddenInput.autocapitalize = 'off';
  hiddenInput.spellcheck = false;
  hiddenInput.setAttribute('aria-label', options.ariaLabel || 'Nhập ký tự công thức toán');

  const canvas = document.createElement('div');
  canvas.className = 'vmf-canvas';

  const placeholderEl = document.createElement('span');
  placeholderEl.className = 'vmf-placeholder-hint';
  placeholderEl.textContent = options.placeholder || 'Nhập công thức…';

  const mathEl = document.createElementNS(MATHML_NS, 'math');
  mathEl.setAttribute('display', 'block');
  mathEl.setAttribute('class', 'vmf-math');

  canvas.append(placeholderEl, mathEl);
  fieldBox.append(hiddenInput, canvas);
  container.append(fieldBox);

  const mEl = (tag, cls = '', text = '') => {
    const el = document.createElementNS(MATHML_NS, tag);
    if (cls) el.setAttribute('class', cls);
    if (text) el.textContent = text;
    return el;
  };

  function makeCaretNode() {
    const caret = mEl('mspace', 'vmf-caret');
    caret.setAttribute('width', '2.5px');
    caret.setAttribute('height', '0.98em');
    caret.setAttribute('depth', '0.24em');
    return caret;
  }

  function renderSlot(slot, isRoot = false) {
    const isActive = focused && model.cursor.slotId === slot.id;
    const isEmpty = slot.items.length === 0;
    const cls = [
      'vmf-slot',
      isRoot ? 'vmf-root-slot' : 'vmf-child-slot',
      isEmpty && !isRoot ? 'is-empty' : '',
      isActive && !isRoot ? 'is-active' : ''
    ].filter(Boolean).join(' ');

    const row = mEl('mrow', cls);
    row.dataset.slotId = slot.id;

    if (isEmpty && !isRoot) {
      if (isActive) {
        row.append(makeCaretNode());
      }
      const box = mEl('mi', 'vmf-empty-glyph', '□');
      box.setAttribute('mathvariant', 'normal');
      row.append(box);
      return row;
    }

    for (let i = 0; i < slot.items.length; i++) {
      if (isActive && model.cursor.offset === i) {
        row.append(makeCaretNode());
      }
      const rendered = renderNode(slot.items[i]);
      rendered.dataset.parentSlotId = slot.id;
      rendered.dataset.itemIndex = String(i);
      row.append(rendered);
    }

    if (isActive && model.cursor.offset === slot.items.length) {
      row.append(makeCaretNode());
    }

    return row;
  }

  function renderNode(node) {
    switch (node.type) {
      case 'placeholder': {
        const box = mEl('mi', 'vmf-empty-glyph', '□');
        box.setAttribute('mathvariant', 'normal');
        return box;
      }
      case 'char': {
        const v = node.value;
        if (/^[0-9.]$/.test(v)) return mEl('mn', 'vmf-atom', v);
        if (/^[a-zA-Z]$/.test(v)) return mEl('mi', 'vmf-atom', v);
        return mEl('mo', 'vmf-atom', v === '-' ? '−' : v);
      }
      case 'sym': {
        const info = SYMBOL_MAP.get(node.latex);
        if (!info) return mEl('mi', 'vmf-atom', node.display || node.latex);
        if (info.tag === 'mspace') {
          const sp = mEl('mspace', 'vmf-atom');
          sp.setAttribute('width', node.latex === '\\quad' ? '1em' : '0.22em');
          return sp;
        }
        const el = mEl(info.tag, 'vmf-atom', info.display);
        if (info.upright) el.setAttribute('mathvariant', 'normal');
        if (info.largeop) el.setAttribute(' movablelimits'.trim(), 'false');
        return el;
      }
      case 'bb': {
        return mEl('mi', 'vmf-atom', BLACKBOARD_MAP.get(node.value) || node.value);
      }
      case 'rm': {
        const el = mEl('mi', 'vmf-atom', node.value);
        el.setAttribute('mathvariant', 'normal');
        return el;
      }
      case 'frac': {
        const frac = mEl('mfrac', 'vmf-frac');
        frac.append(renderSlot(node.slots[0]), renderSlot(node.slots[1]));
        return frac;
      }
      case 'binom': {
        const wrap = mEl('mrow', 'vmf-binom');
        const open = mEl('mo', '', '(');
        const frac = mEl('mfrac', '');
        frac.setAttribute('linethickness', '0');
        frac.append(renderSlot(node.slots[0]), renderSlot(node.slots[1]));
        const close = mEl('mo', '', ')');
        wrap.append(open, frac, close);
        return wrap;
      }
      case 'sqrt': {
        const sq = mEl('msqrt', 'vmf-sqrt');
        sq.append(renderSlot(node.slots[0]));
        return sq;
      }
      case 'nthroot': {
        // MathML <mroot> order is: base FIRST, index SECOND
        const rt = mEl('mroot', 'vmf-mroot');
        rt.append(renderSlot(node.slots[1]), renderSlot(node.slots[0]));
        return rt;
      }
      case 'sup': {
        const sup = mEl('msup', 'vmf-sup');
        sup.append(renderSlot(node.slots[0]), renderSlot(node.slots[1]));
        return sup;
      }
      case 'sub': {
        const sub = mEl('msub', 'vmf-sub');
        sub.append(renderSlot(node.slots[0]), renderSlot(node.slots[1]));
        return sub;
      }
      case 'subsup': {
        const isUnderOver = node.slots[0].items.length === 1 &&
          node.slots[0].items[0].type === 'sym' &&
          (node.slots[0].items[0].latex === '\\sum' || node.slots[0].items[0].latex === '\\prod');
        const tag = isUnderOver ? 'munderover' : 'msubsup';
        const el = mEl(tag, 'vmf-subsup');
        el.append(renderSlot(node.slots[0]), renderSlot(node.slots[1]), renderSlot(node.slots[2]));
        return el;
      }
      case 'fence': {
        const wrap = mEl('mrow', 'vmf-fence');
        const o = mEl('mo', 'vmf-delim', node.open);
        const c = mEl('mo', 'vmf-delim', node.close);
        wrap.append(o, renderSlot(node.slots[0]), c);
        return wrap;
      }
      case 'accent': {
        const over = mEl('mover', 'vmf-accent');
        over.setAttribute('accent', 'true');
        const markChar = node.kind === 'widehat'
          ? '\u0302'
          : node.kind === 'overrightarrow'
            ? '\u20D7'
            : node.kind === 'arc'
              ? '\u23DC'
              : node.kind === 'widetilde'
                ? '\u0303'
                : '\u203E';
        const mark = mEl('mo', 'vmf-accent-mark', markChar);
        mark.setAttribute('stretchy', 'true');
        over.append(renderSlot(node.slots[0]), mark);
        return over;
      }
      case 'fn': {
        const wrap = mEl('mrow', 'vmf-fn');
        const fn = mEl('mi', 'vmf-fn-name', node.name);
        fn.setAttribute('mathvariant', 'normal');
        const o = mEl('mo', 'vmf-delim', '(');
        const c = mEl('mo', 'vmf-delim', ')');
        wrap.append(fn, o, renderSlot(node.slots[0]), c);
        return wrap;
      }
      case 'log': {
        const wrap = mEl('mrow', 'vmf-log');
        const sub = mEl('msub', '');
        const lg = mEl('mi', 'vmf-fn-name', 'log');
        lg.setAttribute('mathvariant', 'normal');
        sub.append(lg, renderSlot(node.slots[0]));
        const o = mEl('mo', 'vmf-delim', '(');
        const c = mEl('mo', 'vmf-delim', ')');
        wrap.append(sub, o, renderSlot(node.slots[1]), c);
        return wrap;
      }
      case 'cases': {
        const isLines = node.variant === 'lines';
        const wrap = mEl('mrow', isLines ? 'vmf-cases is-lines' : 'vmf-cases');
        const table = mEl('mtable', 'vmf-mtable');
        table.setAttribute('columnalign', 'left');
        for (const rowSlot of node.slots) {
          const tr = mEl('mtr', '');
          const td = mEl('mtd', '');
          td.append(renderSlot(rowSlot));
          tr.append(td);
          table.append(tr);
        }
        if (isLines) {
          wrap.append(table);
        } else {
          const brace = mEl('mo', 'vmf-delim', node.variant === 'or' ? '[' : '{');
          brace.setAttribute('stretchy', 'true');
          wrap.append(brace, table);
        }
        return wrap;
      }
      default:
        return mEl('mrow', '');
    }
  }

  function render(notify = false) {
    placeholderEl.hidden = !model.isEmpty || focused;
    fieldBox.classList.toggle('is-focused', focused);
    mathEl.replaceChildren(renderSlot(model.root, true));
    container.dispatchEvent(new Event('cursorchange'));
    if (notify) {
      container.dispatchEvent(new Event('input', {bubbles: true}));
    }
  }

  // Click / Tap hit testing to place cursor accurately inside any slot or item
  fieldBox.addEventListener('pointerdown', event => {
    event.preventDefault();
    hiddenInput.focus({preventScroll: true});

    let target = event.target;
    // Check if user clicked directly on a direct item of a slot
    let itemEl = target?.closest?.('[data-parent-slot-id]');
    let slotEl = target?.closest?.('[data-slot-id]');

    if (slotEl && itemEl && slotEl !== itemEl.parentElement && itemEl.contains(slotEl)) {
      // Clicked inside a nested child slot of itemEl -> prioritize inner slotEl!
      itemEl = null;
    }

    if (itemEl) {
      const parentSlotId = itemEl.dataset.parentSlotId;
      const idx = Number(itemEl.dataset.itemIndex || 0);
      const rect = itemEl.getBoundingClientRect();
      const after = event.clientX > rect.left + rect.width / 2;
      model.setCursor(parentSlotId, after ? idx + 1 : idx);
      render(false);
      return;
    }

    if (slotEl) {
      const slotId = slotEl.dataset.slotId;
      const children = Array.from(slotEl.querySelectorAll(':scope > [data-item-index]'));
      if (children.length === 0) {
        model.setCursor(slotId, 0);
      } else {
        let bestOffset = children.length;
        for (let i = 0; i < children.length; i++) {
          const rect = children[i].getBoundingClientRect();
          if (event.clientX < rect.left + rect.width / 2) {
            bestOffset = i;
            break;
          }
        }
        model.setCursor(slotId, bestOffset);
      }
      render(false);
      return;
    }

    // Clicked empty space in fieldBox
    const mathRect = mathEl.getBoundingClientRect();
    if (event.clientX < mathRect.left) {
      model.setCursor(model.root.id, 0);
    } else {
      model.setCursor(model.root.id, model.root.items.length);
    }
    render(false);
  });

  hiddenInput.addEventListener('focus', () => {
    focused = true;
    render(false);
  });

  hiddenInput.addEventListener('blur', () => {
    focused = false;
    render(false);
  });

  hiddenInput.addEventListener('input', () => {
    const val = hiddenInput.value;
    hiddenInput.value = '';
    if (!val) return;
    model.typeText(val);
    render(true);
  });

  hiddenInput.addEventListener('paste', event => {
    event.preventDefault();
    const pasted = (event.clipboardData?.getData('text/plain') || '').trim();
    if (!pasted) return;
    const stripped = pasted.replace(/^\$\$?|\$\$?$/g, '').replace(/^\\\[|\\\]$|^\\\(|\\\)$/g, '').trim();
    if (model.isEmpty && model.setLatex(stripped)) {
      render(true);
      return;
    }
    if (model.insertTemplate(stripped)) {
      render(true);
      return;
    }
    model.typeText(stripped);
    render(true);
  });

  hiddenInput.addEventListener('copy', event => {
    const val = model.getLatex();
    if (!val) return;
    event.preventDefault();
    event.clipboardData?.setData('text/plain', val);
  });

  hiddenInput.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const k = event.key.toLowerCase();
      if (k === 'z') {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey ? model.redo() : model.undo()) render(true);
        return;
      }
      if (k === 'y') {
        event.preventDefault();
        event.stopPropagation();
        if (model.redo()) render(true);
        return;
      }
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      model.moveLeft();
      render(false);
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      model.moveRight();
      render(false);
      return;
    }
    if (event.key === 'ArrowUp') {
      if (model.moveVertical('up')) {
        event.preventDefault();
        render(false);
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      if (model.moveVertical('down')) {
        event.preventDefault();
        render(false);
      }
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      model.setCursor(model.root.id, 0);
      render(false);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      model.setCursor(model.root.id, model.root.items.length);
      render(false);
      return;
    }
    if (event.key === 'Tab') {
      if (model.jumpSlot(event.shiftKey)) {
        event.preventDefault();
        render(false);
      }
      return;
    }
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (model.backspace()) render(true);
      return;
    }
    if (event.key === 'Delete') {
      event.preventDefault();
      if (model.deleteForward()) render(true);
      return;
    }
    if (event.key === 'Enter' && event.shiftKey) {
      if (model.insertNewline()) {
        event.preventDefault();
        event.stopPropagation();
        render(true);
      }
    }
  });

  render(false);

  return {
    element: container,
    model,
    get value() {
      return model.getLatex();
    },
    set value(latex) {
      model.setLatex(latex);
      render(false);
    },
    setValue(latex) {
      const ok = model.setLatex(latex);
      render(false);
      return ok;
    },
    get hidden() {
      return container.hidden;
    },
    set hidden(val) {
      container.hidden = Boolean(val);
    },
    get hasIncompleteSlots() {
      return model.hasIncompleteSlots;
    },
    setVirtualKeyboardMode(enabled) {
      hiddenInput.inputMode = enabled ? 'none' : 'text';
    },
    focus() {
      hiddenInput.focus({preventScroll: true});
    },
    insertTemplate(template) {
      const ok = model.insertTemplate(template);
      render(true);
      hiddenInput.focus({preventScroll: true});
      return ok;
    },
    typeKey(ch) {
      model.typeText(ch);
      render(true);
      hiddenInput.focus({preventScroll: true});
    },
    backspace() {
      if (model.backspace()) render(true);
      hiddenInput.focus({preventScroll: true});
    },
    moveLeft() {
      model.moveLeft();
      render(false);
      hiddenInput.focus({preventScroll: true});
    },
    moveRight() {
      model.moveRight();
      render(false);
      hiddenInput.focus({preventScroll: true});
    },
    jumpNextSlot() {
      model.jumpSlot(false);
      render(false);
      hiddenInput.focus({preventScroll: true});
    },
    addSystemRow() {
      const ok = model.addSystemRow();
      if (ok) render(true);
      hiddenInput.focus({preventScroll: true});
      return ok;
    },
    insertNewline() {
      const ok = model.insertNewline();
      if (ok) render(true);
      hiddenInput.focus({preventScroll: true});
      return ok;
    },
    trimEmptyLines() {
      const changed = model.trimEmptyLines();
      if (changed) render(false);
      return changed;
    },
    undo() {
      if (model.undo()) render(true);
      hiddenInput.focus({preventScroll: true});
    },
    redo() {
      if (model.redo()) render(true);
      hiddenInput.focus({preventScroll: true});
    },
    addEventListener(type, fn) {
      container.addEventListener(type, fn);
    }
  };
}
