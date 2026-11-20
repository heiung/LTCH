import katex from 'katex';

const DOUBLE_STRUCK_MAP = new Map([
  ['A', '𝔸'], ['B', '𝔹'], ['C', 'ℂ'], ['D', '𝔻'], ['E', '𝔼'], ['F', '𝔽'], ['G', '𝔾'],
  ['H', 'ℍ'], ['I', '𝕀'], ['J', '𝕁'], ['K', '𝕂'], ['L', '𝕃'], ['M', '𝕄'], ['N', 'ℕ'],
  ['O', '𝕆'], ['P', 'ℙ'], ['Q', 'ℚ'], ['R', 'ℝ'], ['S', '𝕊'], ['T', '𝕋'], ['U', '𝕌'],
  ['V', '𝕍'], ['W', '𝕎'], ['X', '𝕏'], ['Y', '𝕐'], ['Z', 'ℤ']
]);

function normalizeForumMathML(html) {
  const annIdx = html.indexOf('<annotation');
  const head = (annIdx >= 0 ? html.slice(0, annIdx) : html).replace(
    /<mi mathvariant="double-struck">([A-Z])<\/mi>/g,
    (_, ch) => `<mi mathvariant="normal">${DOUBLE_STRUCK_MAP.get(ch) || ch}</mi>`
  );
  const tail = annIdx >= 0 ? html.slice(annIdx) : '';

  const tokens = [];
  const tagRe = /<\/?([a-zA-Z0-9-]+)([^>]*)>/g;
  let lastIndex = 0;
  for (const match of head.matchAll(tagRe)) {
    if (match.index > lastIndex) {
      tokens.push({type: 'text', value: head.slice(lastIndex, match.index)});
    }
    tokens.push({
      type: 'tag',
      raw: match[0],
      close: match[0].startsWith('</'),
      selfClosing: match[0].endsWith('/>'),
      name: match[1].toLowerCase(),
      attrs: match[2]
    });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < head.length) {
    tokens.push({type: 'text', value: head.slice(lastIndex)});
  }

  const stack = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type !== 'tag') continue;

    if (!tok.close) {
      if (stack.length) stack[stack.length - 1].hasChildElement = true;
      if (tok.selfClosing) {
        if (stack.length) stack[stack.length - 1].lastChild = {startIdx: i, endIdx: i, name: tok.name};
      } else {
        stack.push({name: tok.name, openIdx: i, hasChildElement: false, lastChild: null});
      }
      continue;
    }

    let matchPos = stack.length - 1;
    while (matchPos >= 0 && stack[matchPos].name !== tok.name) matchPos--;
    if (matchPos < 0) continue;

    while (stack.length - 1 > matchPos) stack.pop();
    const frame = stack.pop();

    if ((frame.name === 'mi' || frame.name === 'mo') && frame.hasChildElement) {
      tokens[frame.openIdx] = {type: 'text', value: '<mrow>'};
      tokens[i] = {type: 'text', value: '</mrow>'};
      frame.name = 'mrow';
    }

    if (frame.name === 'mover' && frame.lastChild && frame.lastChild.name === 'mo') {
      const {startIdx, endIdx} = frame.lastChild;
      const innerTokens = tokens.slice(startIdx + 1, endIdx);
      if (innerTokens.length === 1 && innerTokens[0].type === 'text') {
        const mark = innerTokens[0].value;
        const openTok = tokens[startIdx];
        if (mark === '\u2322') {
          innerTokens[0].value = '\u23DC';
          tokens[startIdx] = {type: 'text', value: '<mo stretchy="true">'};
          const moverTok = tokens[frame.openIdx];
          if (moverTok.type === 'tag' && !/\baccent=/.test(moverTok.attrs)) {
            tokens[frame.openIdx] = {type: 'text', value: `<mover${moverTok.attrs} accent="true">`};
          }
        } else if (openTok.type === 'tag' && openTok.attrs.includes('stretchy="true"')) {
          if (mark === '^') innerTokens[0].value = '\u0302';
          else if (mark === '~') innerTokens[0].value = '\u0303';
          else if (mark === '\u2192') innerTokens[0].value = '\u20D7';
        }
      }
    }

    if (stack.length) {
      stack[stack.length - 1].lastChild = {startIdx: frame.openIdx, endIdx: i, name: frame.name};
    }
  }

  return tokens.map(t => (t.type === 'text' ? t.value : t.raw)).join('') + tail;
}

// Text is kept verbatim; only explicitly delimited expressions are interpreted.
export function parseForumMath(input, maxFormulas = 60) {
  const text = String(input ?? ''), parts = [];
  let start = 0, i = 0, formulas = 0;
  const escaped = position => {
    let count = 0;
    for (let j = position - 1; j >= 0 && text[j] === '\\'; j--) count++;
    return count % 2 === 1;
  };
  while (i < text.length && formulas < maxFormulas) {
    let open, close, display = false;
    if (text[i] === '$' && !escaped(i)) {
      open = text[i + 1] === '$' ? '$$' : '$'; close = open; display = open === '$$';
    } else if (text[i] === '\\' && !escaped(i) && (text[i + 1] === '(' || text[i + 1] === '[')) {
      open = text.slice(i, i + 2); close = text[i + 1] === '(' ? '\\)' : '\\]'; display = text[i + 1] === '[';
    } else { i++; continue; }
    let end = i + open.length;
    while (end < text.length) {
      if (!display && text[end] === '\n') break;
      if (text.startsWith(close, end) && !escaped(end)) break;
      end++;
    }
    if (end >= text.length || !text.startsWith(close, end)) {
      i = end < text.length ? end + 1 : text.length;
      continue;
    }
    const latex = text.slice(i + open.length, end), raw = text.slice(i, end + close.length);
    if (!latex.trim() || latex.length > 2000) { i = end + close.length; continue; }
    if (i > start) parts.push({type: 'text', value: text.slice(start, i)});
    parts.push({type: 'math', latex, raw, display});
    formulas++; i = end + close.length; start = i;
  }
  if (start < text.length) parts.push({type: 'text', value: text.slice(start)});
  return parts;
}

export function renderForumFormula(latex, display = false) {
  return normalizeForumMathML(katex.renderToString(latex, {
    displayMode: display, output: 'mathml', throwOnError: true,
    trust: false, maxSize: 10, maxExpand: 100, strict: 'ignore'
  }));
}

export function renderForumText(target, text) {
  const nodes = [];
  let invalid = 0;
  for (const part of parseForumMath(text)) {
    if (part.type === 'text') { nodes.push(document.createTextNode(part.value)); continue; }
    const formula = document.createElement('span');
    formula.className = part.display ? 'forum-math-display' : 'forum-math-inline';
    try { formula.innerHTML = renderForumFormula(part.latex, part.display); }
    catch {
      invalid++;
      formula.classList.add('forum-math-invalid');
      formula.textContent = part.raw;
      formula.title = 'Công thức toán chưa hợp lệ.';
    }
    nodes.push(formula);
  }
  target.replaceChildren(...nodes);
  return invalid;
}
