import { renderForumFormula } from './forum-math.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';

const NON_MATH_STATS_WORDS_RE = /(?:tần\s*s[ốuấ]t?|doanh\s*thu|doanh\s*số|khách\s*hàng|nhóm|thời\s*gian|t[ỉỷ]\s*lệ|số\s*(?:học\s*sinh|khách|lần|giờ|người|lượng|câu|mẫu)|điểm\s*(?:thi|kiểm|trung)|quý\b|mẫu\s*\d|chi\s*phí|lợi\s*nhuận|tháng\b|tuần\b|trung\s*bình|cỡ\s*mẫu|phút\b|giây\b)/iu;
const INTERVAL_BRACKET_RE = /[\[(]\s*[^;\],]+?\s*[;,]\s*[^)\]]+?\s*[\])]/;
const INDEP_VAR_RE = /^(?:[a-zA-Z]|alpha|beta|theta|varphi|phi|omega)(?:_[0-9a-zA-Z]+)?$/i;

function makeSvgNode(tag, attrs = {}, ...children) {
  const node = typeof document.createElementNS === 'function'
    ? document.createElementNS(SVG_NS, tag)
    : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null) continue;
    node.setAttribute(k, String(v));
  }
  for (const ch of children.flat(Infinity)) {
    if (ch !== null && ch !== undefined && ch !== false) node.append(ch);
  }
  return node;
}

function makeXhtmlDiv(className) {
  const el = typeof document.createElementNS === 'function'
    ? document.createElementNS(XHTML_NS, 'div')
    : document.createElement('div');
  el.setAttribute('class', className);
  return el;
}

export function extractCleanCellText(cell) {
  if (!cell) return '';
  let out = '';
  const walk = (node) => {
    if (!node) return;
    if (node.nodeType === 3) {
      out += node.textContent || '';
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = String(node.tagName || '').toLowerCase();
    if (tag === 'script' || tag === 'style') return;
    if (tag === 'br') {
      out += ' ';
      return;
    }
    if (tag === 'sup' || tag === 'sub') {
      let inner = '';
      for (const c of node.childNodes || []) {
        inner += c.textContent || '';
      }
      inner = inner.trim();
      if (inner) {
        out += tag === 'sup' ? `^{${inner}}` : `_{${inner}}`;
      }
      return;
    }
    const isBlock = tag === 'p' || tag === 'div';
    if (isBlock && out && !/\s$/.test(out)) out += ' ';
    for (const c of node.childNodes || []) walk(c);
    if (isBlock && out && !/\s$/.test(out)) out += ' ';
  };
  walk(cell);
  return out
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function unwrapAllMathDelimiters(raw) {
  return String(raw || '')
    .replace(/\\\[|\\\]|\\\(|\\\)/g, ' ')
    .replace(/\$\$/g, ' ')
    .replace(/\$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeLatexBody(raw) {
  let s = unwrapAllMathDelimiters(raw)
    .replace(/[\u2212\u2013\u2014]/g, '-')
    .replace(/\\infty/g, '__LTCH_INF__')
    .replace(/∞/g, '__LTCH_INF__')
    .replace(/__LTCH_INF__/g, '\\infty')
    .replace(/π/g, '\\pi')
    .replace(/±/g, '\\pm')
    .replace(/≥/g, '\\ge ')
    .replace(/≤/g, '\\le ')
    .replace(/≠/g, '\\neq ')
    .replace(/·/g, '\\cdot ')
    .replace(/\\quad|\\qquad|\\,|\\;|\\!/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Convert Unicode prime characters to standard apostrophe for KaTeX
  s = s.replace(/[’′]/g, "'");
  // Handle Vietnamese decimal comma in plain text like 2,5 when not inside {,}
  s = s.replace(/(\d),(\d)/g, '$1{,}$2');
  return s;
}

function classifySignCell(raw) {
  const s = normalizeLatexBody(raw)
    .replace(/\\(?:mathbf|mathrm|textbf|text)\{([^{}]*)\}/g, '$1')
    .replace(/\\left\s*\|/g, '|')
    .replace(/\\right\s*\|/g, '|')
    .replace(/\\(?:Vert|parallel)\b/g, '||')
    .replace(/‖/g, '||')
    .replace(/\|\s+\|/g, '||')
    .replace(/\s+/g, '');
  if (!s) return { ok: true, kind: '' };
  if (s === '+') return { ok: true, kind: '+' };
  if (s === '-') return { ok: true, kind: '-' };
  if (s === '0') return { ok: true, kind: '0' };
  if (s === '||') return { ok: true, kind: 'dbar' };
  if (/^\/{1,8}$/.test(s)) return { ok: true, kind: 'hatch' };
  return { ok: false, kind: '' };
}

function tokenizeRow2Cell(raw) {
  const cleaned = String(raw || '')
    .replace(/\\(?:left|right)?\s*(?:\\Vert|Vert|\|\s*\||‖|\\parallel)/g, ' __LTCH_DBAR__ ')
    .replace(/\|\|/g, ' __LTCH_DBAR__ ')
    .replace(/\|\s+\|/g, ' __LTCH_DBAR__ ')
    .replace(/‖/g, ' __LTCH_DBAR__ ')
    .replace(/\\nearrow\b|↗/g, ' __LTCH_UP__ ')
    .replace(/\\searrow\b|↘/g, ' __LTCH_DOWN__ ')
    .replace(/\\uparrow\b|↑/g, ' __LTCH_UP__ ')
    .replace(/\\downarrow\b|↓/g, ' __LTCH_DOWN__ ')
    .replace(/(?<![:/])\/{2,8}/g, ' __LTCH_HATCH__ ');

  const parts = cleaned.split(/\s*(__LTCH_(?:DBAR|UP|DOWN|HATCH)__)\s*/g);
  const tokens = [];
  for (const part of parts) {
    if (!part) continue;
    if (part === '__LTCH_DBAR__') {
      tokens.push({ type: 'dbar' });
    } else if (part === '__LTCH_UP__') {
      tokens.push({ type: 'arrow', dir: 'up' });
    } else if (part === '__LTCH_DOWN__') {
      tokens.push({ type: 'arrow', dir: 'down' });
    } else if (part === '__LTCH_HATCH__') {
      tokens.push({ type: 'hatch' });
    } else {
      const stripped = unwrapAllMathDelimiters(part);
      if (!stripped) continue;
      if (/^\|+$/.test(stripped.replace(/\s+/g, '')) && stripped.replace(/\s+/g, '').length >= 2) {
        tokens.push({ type: 'dbar' });
      } else {
        const latex = normalizeLatexBody(stripped);
        if (latex) tokens.push({ type: 'val', raw: stripped, latex });
      }
    }
  }
  return tokens;
}

function isValidHeaderVar(raw) {
  const norm = normalizeLatexBody(raw).replace(/[\\{}\s]/g, '');
  if (!norm || norm.length > 10) return false;
  if (NON_MATH_STATS_WORDS_RE.test(raw)) return false;
  return INDEP_VAR_RE.test(norm);
}

function isValidHeaderExpr(raw, { requireDerivative = false } = {}) {
  const s = String(raw || '').trim();
  if (!s || NON_MATH_STATS_WORDS_RE.test(s)) return false;
  const norm = normalizeLatexBody(s);
  if (!norm || norm.length > 44) return false;
  if (requireDerivative) {
    return /['’′]|\\prime/.test(norm);
  }
  return /^[a-zA-Z\\{}\s()0-9_,'’′+\-|[\]/*^.=]+$/.test(norm);
}

export function evaluateMathScalar(rawLatex) {
  const s = normalizeLatexBody(rawLatex).replace(/\s+/g, '');
  if (!s) return { kind: 'sym', key: '' };
  if (s === '-\\infty') return { kind: 'neg_inf' };
  if (s === '+\\infty' || s === '\\infty') return { kind: 'pos_inf' };

  // Pre-normalize comma decimals like 2{,}5 -> 2.5
  let src = s
    .replace(/\{,\}/g, '.')
    .replace(/\\(?:dfrac|tfrac|frac)\b/g, '__FRAC__')
    .replace(/\\sqrt\b/g, '__SQRT__')
    .replace(/\\left\s*\(/g, '(')
    .replace(/\\right\s*\)/g, ')')
    .replace(/\\(?:cdot|times)\b/g, '*')
    .replace(/\\pi\b/g, '__PI__')
    .replace(/\\mathrm\{e\}/g, '__E__')
    .replace(/\\ln\b/g, '__LN__')
    .replace(/\\log\b/g, '__LOG10__')
    .replace(/\\sin\b/g, '__SIN__')
    .replace(/\\cos\b/g, '__COS__')
    .replace(/\\tan\b/g, '__TAN__');

  let pos = 0;

  function peek() { return src[pos] || ''; }
  function skipBraces(fn) {
    if (peek() === '{') {
      pos++;
      const v = fn();
      if (peek() !== '}') return NaN;
      pos++;
      return v;
    }
    return fn();
  }

  function parseExpr() {
    let val = parseTerm();
    if (!Number.isFinite(val)) return NaN;
    while (pos < src.length) {
      const ch = peek();
      if (ch === '+' || ch === '-') {
        pos++;
        const rhs = parseTerm();
        if (!Number.isFinite(rhs)) return NaN;
        val = ch === '+' ? val + rhs : val - rhs;
      } else {
        break;
      }
    }
    return val;
  }

  function startsFactor() {
    const ch = peek();
    if (!ch) return false;
    if (/[0-9.(]/.test(ch)) return true;
    return src.startsWith('__FRAC__', pos) ||
      src.startsWith('__SQRT__', pos) ||
      src.startsWith('__PI__', pos) ||
      src.startsWith('__E__', pos) ||
      src.startsWith('__LN__', pos) ||
      src.startsWith('__LOG10__', pos) ||
      src.startsWith('__SIN__', pos) ||
      src.startsWith('__COS__', pos) ||
      src.startsWith('__TAN__', pos);
  }

  function parseTerm() {
    let val = parseUnary();
    if (!Number.isFinite(val)) return NaN;
    while (pos < src.length) {
      const ch = peek();
      if (ch === '*' || ch === '/') {
        pos++;
        const rhs = parseUnary();
        if (!Number.isFinite(rhs)) return NaN;
        if (ch === '*') val *= rhs;
        else {
          if (Math.abs(rhs) < 1e-12) return NaN;
          val /= rhs;
        }
      } else if (startsFactor()) {
        const rhs = parseUnary();
        if (!Number.isFinite(rhs)) return NaN;
        val *= rhs;
      } else {
        break;
      }
    }
    return val;
  }

  function parseUnary() {
    if (peek() === '+') {
      pos++;
      return parseUnary();
    }
    if (peek() === '-') {
      pos++;
      return -parseUnary();
    }
    return parsePower();
  }

  function parsePower() {
    const base = parseAtom();
    if (!Number.isFinite(base)) return NaN;
    if (peek() === '^') {
      pos++;
      const exp = peek() === '{' ? skipBraces(parseExpr) : parseUnary();
      if (!Number.isFinite(exp)) return NaN;
      return Math.pow(base, exp);
    }
    return base;
  }

  function parseArg() {
    if (peek() === '{') return skipBraces(parseExpr);
    if (peek() === '(') {
      pos++;
      const v = parseExpr();
      if (peek() !== ')') return NaN;
      pos++;
      return v;
    }
    return parseUnary();
  }

  function parseAtom() {
    if (src.startsWith('__FRAC__', pos)) {
      pos += 8;
      const num = parseArg();
      const den = parseArg();
      if (!Number.isFinite(num) || !Number.isFinite(den) || Math.abs(den) < 1e-12) return NaN;
      return num / den;
    }
    if (src.startsWith('__SQRT__', pos)) {
      pos += 8;
      let n = 2;
      if (peek() === '[') {
        pos++;
        n = parseExpr();
        if (peek() !== ']' || !Number.isFinite(n) || n === 0) return NaN;
        pos++;
      }
      const arg = parseArg();
      if (!Number.isFinite(arg) || (n % 2 === 0 && arg < 0)) return NaN;
      return Math.pow(arg, 1 / n);
    }
    if (src.startsWith('__PI__', pos)) { pos += 6; return Math.PI; }
    if (src.startsWith('__E__', pos)) { pos += 5; return Math.E; }
    if (src.startsWith('__LN__', pos)) {
      pos += 6;
      const v = parseArg();
      return v > 0 ? Math.log(v) : NaN;
    }
    if (src.startsWith('__LOG10__', pos)) {
      pos += 9;
      const v = parseArg();
      return v > 0 ? Math.log10(v) : NaN;
    }
    if (src.startsWith('__SIN__', pos)) { pos += 7; return Math.sin(parseArg()); }
    if (src.startsWith('__COS__', pos)) { pos += 7; return Math.cos(parseArg()); }
    if (src.startsWith('__TAN__', pos)) { pos += 7; return Math.tan(parseArg()); }
    if (peek() === 'e' && (pos + 1 === src.length || src[pos + 1] === '^' || !/[a-zA-Z]/.test(src[pos + 1]))) {
      pos++;
      return Math.E;
    }
    if (peek() === '(') {
      pos++;
      const v = parseExpr();
      if (peek() !== ')') return NaN;
      pos++;
      return v;
    }
    if (peek() === '{') {
      pos++;
      const v = parseExpr();
      if (peek() !== '}') return NaN;
      pos++;
      return v;
    }
    const numMatch = /^[0-9]+(?:\.[0-9]+)?/.exec(src.slice(pos));
    if (numMatch) {
      pos += numMatch[0].length;
      return Number.parseFloat(numMatch[0]);
    }
    return NaN;
  }

  const parsed = parseExpr();
  if (Number.isFinite(parsed) && pos === src.length) {
    return { kind: 'num', value: parsed };
  }
  return { kind: 'sym', key: s };
}

function assignNodeIntervalLimit(nodes, k, vals, hasUpOrDownTokens) {
  if (!vals.length) return;
  const leftNode = nodes[k];
  const rightNode = nodes[k + 1];
  const remaining = [...vals];

  if (remaining.length >= 2) {
    if (!leftNode.yDbar && !leftNode.val && k === 0 && !hasUpOrDownTokens.beforeFirst) {
      leftNode.val = remaining.shift();
    } else if (!leftNode.rightLimit) {
      leftNode.rightLimit = remaining.shift();
    }
    if (remaining.length) {
      if (!rightNode.yDbar && !rightNode.val && k + 1 === nodes.length - 1 && !hasUpOrDownTokens.afterLast) {
        rightNode.val = remaining.pop();
      } else if (!rightNode.leftLimit) {
        rightNode.leftLimit = remaining.pop();
      }
    }
    if (!leftNode.rightLimit && remaining.length) leftNode.rightLimit = remaining.shift();
    if (!rightNode.leftLimit && remaining.length) rightNode.leftLimit = remaining.pop();
    return;
  }

  const single = remaining[0];
  // 1 value placed inside interval column(s) between node k and node k+1
  if (hasUpOrDownTokens.arrowBefore && !rightNode.leftLimit) {
    if (rightNode.yDbar) rightNode.leftLimit = single;
    else if (!rightNode.val) rightNode.val = single;
    else if (!leftNode.rightLimit) leftNode.rightLimit = single;
    return;
  }
  if (hasUpOrDownTokens.arrowAfter && !leftNode.rightLimit) {
    if (leftNode.yDbar) leftNode.rightLimit = single;
    else if (!leftNode.val) leftNode.val = single;
    else if (!rightNode.leftLimit) rightNode.leftLimit = single;
    return;
  }
  if (rightNode.yDbar && !rightNode.leftLimit) {
    rightNode.leftLimit = single;
  } else if (leftNode.yDbar && !leftNode.rightLimit) {
    leftNode.rightLimit = single;
  } else if (!rightNode.val && k + 1 === nodes.length - 1) {
    rightNode.val = single;
  } else if (!leftNode.val && k === 0) {
    leftNode.val = single;
  } else if (!rightNode.leftLimit) {
    rightNode.leftLimit = single;
  }
}

function compareScalarDirection(fromVal, toVal) {
  if (!fromVal || !toVal) return null;
  const a = evaluateMathScalar(fromVal.latex);
  const b = evaluateMathScalar(toVal.latex);
  if (a.kind === 'neg_inf' && b.kind !== 'neg_inf') return 'up';
  if (b.kind === 'pos_inf' && a.kind !== 'pos_inf') return 'up';
  if (a.kind === 'pos_inf' && b.kind !== 'pos_inf') return 'down';
  if (b.kind === 'neg_inf' && a.kind !== 'neg_inf') return 'down';
  if (a.kind === 'num' && b.kind === 'num' && Math.abs(a.value - b.value) > 1e-9) {
    return b.value > a.value ? 'up' : 'down';
  }
  return null;
}

export function parseVariationOrSignTable(srcTable) {
  if (!srcTable || typeof srcTable.querySelectorAll !== 'function') return null;
  const trs = Array.from(srcTable.querySelectorAll('tr'));
  if (trs.length !== 2 && trs.length !== 3) return null;

  const grid = trs.map((tr) => Array.from(tr.querySelectorAll('th, td')));
  const colCount = grid[0]?.length || 0;
  if (colCount < 4 || colCount > 21) return null;
  if (grid.some((row) => row.length !== colCount)) return null;

  for (const row of grid) {
    for (const cell of row) {
      const cs = Number.parseInt(cell.getAttribute('colspan') || '1', 10);
      const rs = Number.parseInt(cell.getAttribute('rowspan') || '1', 10);
      if ((Number.isFinite(cs) && cs > 1) || (Number.isFinite(rs) && rs > 1)) return null;
      if (cell.querySelector && cell.querySelector('img')) return null;
      const rawTxt = cell.textContent || '';
      if (/\[\[(?:IMAGE|img):/i.test(rawTxt)) return null;
    }
  }

  const textGrid = grid.map((row) => row.map((cell) => extractCleanCellText(cell)));
  const isVariation = trs.length === 3;

  // Validate header column (Col 0)
  if (!isValidHeaderVar(textGrid[0][0])) return null;
  if (isVariation) {
    if (!isValidHeaderExpr(textGrid[1][0], { requireDerivative: true })) return null;
    if (!isValidHeaderExpr(textGrid[2][0], { requireDerivative: false })) return null;
  } else {
    if (!isValidHeaderExpr(textGrid[1][0], { requireDerivative: false })) return null;
  }

  // Validate Row 0 (x-nodes)
  const nodeCols = [];
  for (let c = 1; c < colCount; c++) {
    const raw = textGrid[0][c];
    if (!raw) continue;
    if (NON_MATH_STATS_WORDS_RE.test(raw) || INTERVAL_BRACKET_RE.test(raw)) return null;
    const latex = normalizeLatexBody(raw);
    if (!latex || latex.length > 36) return null;
    nodeCols.push({ col: c, raw, latex });
  }
  if (nodeCols.length < 2) return null;

  // Validate Row 1 (sign / derivative row)
  const signRowInfo = [];
  let hasSignPlusMinus = false;
  for (let c = 1; c < colCount; c++) {
    const res = classifySignCell(textGrid[1][c]);
    if (!res.ok) return null;
    if (res.kind === '+' || res.kind === '-') hasSignPlusMinus = true;
    signRowInfo[c] = res.kind;
  }
  if (!hasSignPlusMinus) return null;

  // Build nodes & intervals
  const nodes = nodeCols.map((nc) => ({
    col: nc.col,
    xRaw: nc.raw,
    xLatex: nc.latex,
    signAtNode: signRowInfo[nc.col] || '',
    yDbar: false,
    yHatch: false,
    val: null,
    leftLimit: null,
    rightLimit: null,
    arrowOut: null,
    arrowIn: null
  }));

  if (isVariation) {
    nodes.forEach((node, idx) => {
      const tokens = tokenizeRow2Cell(textGrid[2][node.col]);
      const dbarIdx = tokens.findIndex((t) => t.type === 'dbar');
      const hatchIdx = tokens.findIndex((t) => t.type === 'hatch');
      const valTokens = tokens.filter((t) => t.type === 'val');

      if (dbarIdx >= 0) {
        node.yDbar = true;
        const leftVals = tokens.slice(0, dbarIdx).filter((t) => t.type === 'val');
        const rightVals = tokens.slice(dbarIdx + 1).filter((t) => t.type === 'val');
        if (leftVals.length) node.leftLimit = leftVals[leftVals.length - 1];
        if (rightVals.length) node.rightLimit = rightVals[0];
      } else if (hatchIdx >= 0) {
        node.yHatch = true;
        const leftVals = tokens.slice(0, hatchIdx).filter((t) => t.type === 'val');
        const rightVals = tokens.slice(hatchIdx + 1).filter((t) => t.type === 'val');
        if (leftVals.length) node.leftLimit = leftVals[leftVals.length - 1];
        if (rightVals.length) node.rightLimit = rightVals[0];
      } else if (valTokens.length >= 2) {
        node.yDbar = node.signAtNode === 'dbar';
        node.leftLimit = valTokens[0];
        node.rightLimit = valTokens[valTokens.length - 1];
      } else if (valTokens.length === 1) {
        const vTok = valTokens[0];
        const vPos = tokens.indexOf(vTok);
        const arrowBefore = tokens.slice(0, vPos).find((t) => t.type === 'arrow');
        const arrowAfter = tokens.slice(vPos + 1).find((t) => t.type === 'arrow');
        if (arrowBefore) node.arrowIn = arrowBefore.dir;
        if (arrowAfter) node.arrowOut = arrowAfter.dir;

        const isBoundary = idx === 0 || idx === nodes.length - 1;
        if (isBoundary && node.signAtNode === 'dbar') {
          node.yDbar = true;
          if (idx === 0) node.rightLimit = vTok;
          else node.leftLimit = vTok;
        } else {
          node.val = vTok;
        }
      } else if (node.signAtNode === 'dbar') {
        // Empty y cell at a `||` point in y' indicates vertical asymptote / undefined y
        node.yDbar = true;
      }
    });
  }

  const intervals = [];
  for (let k = 0; k < nodes.length - 1; k++) {
    const startCol = nodes[k].col;
    const endCol = nodes[k + 1].col;
    let sign = '';
    for (let c = startCol + 1; c < endCol; c++) {
      const knd = signRowInfo[c];
      if (knd === '+' || knd === '-' || knd === 'hatch') {
        sign = knd;
        break;
      }
    }
    if (!sign && nodes[k].signAtNode === 'hatch') sign = 'hatch';

    let arrowDir = null;
    if (isVariation) {
      const intervalTokens = [];
      for (let c = startCol + 1; c < endCol; c++) {
        intervalTokens.push(...tokenizeRow2Cell(textGrid[2][c]));
      }
      const vals = intervalTokens.filter((t) => t.type === 'val');
      const arrows = intervalTokens.filter((t) => t.type === 'arrow');
      const hasHatch = sign === 'hatch' || intervalTokens.some((t) => t.type === 'hatch');
      if (hasHatch) sign = 'hatch';

      if (vals.length) {
        const firstValIdx = intervalTokens.indexOf(vals[0]);
        const lastValIdx = intervalTokens.lastIndexOf(vals[vals.length - 1]);
        const arrowBefore = intervalTokens.slice(0, firstValIdx).some((t) => t.type === 'arrow');
        const arrowAfter = intervalTokens.slice(lastValIdx + 1).some((t) => t.type === 'arrow');
        assignNodeIntervalLimit(nodes, k, vals, { arrowBefore, arrowAfter });
      }

      if (nodes[k].arrowOut) arrowDir = nodes[k].arrowOut;
      else if (arrows.length) arrowDir = arrows[0].dir;
      else if (nodes[k + 1].arrowIn) arrowDir = nodes[k + 1].arrowIn;
    }

    intervals.push({ sign, dir: arrowDir, fromVal: null, toVal: null });
  }

  // Finalize endpoint associations & infer any missing arrow directions for BBT
  if (isVariation) {
    for (let i = 0; i < nodes.length; i++) {
      const nd = nodes[i];
      if (nd.leftLimit || nd.rightLimit) {
        if (!nd.yHatch) nd.yDbar = true;
      }
      if (nd.val && nd.yDbar) {
        // If somehow both set, prefer val unless limits also exist
        if (nd.leftLimit || nd.rightLimit) nd.val = null;
      }
    }
    for (let k = 0; k < intervals.length; k++) {
      const it = intervals[k];
      if (it.sign === 'hatch') continue;
      const nL = nodes[k];
      const nR = nodes[k + 1];
      it.fromVal = nL.rightLimit || nL.val || null;
      it.toVal = nR.leftLimit || nR.val || null;
      if (!it.dir) {
        if (it.sign === '+') it.dir = 'up';
        else if (it.sign === '-') it.dir = 'down';
        else it.dir = compareScalarDirection(it.fromVal, it.toVal);
      }
    }
  }

  return {
    isVariation,
    headers: isVariation
      ? [normalizeLatexBody(textGrid[0][0]), normalizeLatexBody(textGrid[1][0]), normalizeLatexBody(textGrid[2][0])]
      : [normalizeLatexBody(textGrid[0][0]), normalizeLatexBody(textGrid[1][0])],
    nodes,
    intervals
  };
}

function assignValueHeights(nodes, intervals, yTop, yBot) {
  const entries = [];
  const register = (slotObj, slotId) => {
    if (!slotObj) return;
    const scalar = evaluateMathScalar(slotObj.latex);
    entries.push({ slotObj, slotId, scalar });
  };
  nodes.forEach((nd, i) => {
    if (nd.leftLimit) register(nd.leftLimit, `n${i}_L`);
    if (nd.val) register(nd.val, `n${i}_C`);
    if (nd.rightLimit) register(nd.rightLimit, `n${i}_R`);
  });
  if (!entries.length) return { entries, levelsCount: 1 };

  const negInfs = entries.filter((e) => e.scalar.kind === 'neg_inf');
  const posInfs = entries.filter((e) => e.scalar.kind === 'pos_inf');
  const nums = entries.filter((e) => e.scalar.kind === 'num');
  const syms = entries.filter((e) => e.scalar.kind === 'sym');

  const levels = []; // Ordered lowest -> highest; each element is array of entry objects

  if (negInfs.length) levels.push(negInfs);

  if (!syms.length) {
    const sortedNums = [...nums].sort((a, b) => a.scalar.value - b.scalar.value);
    for (const entry of sortedNums) {
      const prev = levels[levels.length - 1];
      const prevNum = prev && prev[0]?.scalar.kind === 'num' ? prev[0].scalar.value : null;
      if (prevNum !== null && Math.abs(entry.scalar.value - prevNum) <= 1e-9) {
        prev.push(entry);
      } else {
        levels.push([entry]);
      }
    }
  } else {
    // Mixed numeric + symbolic expressions: group identical keys/numbers and rank via DAG
    const entryMap = new Map(entries.map((e) => [e.slotObj, e]));
    const finiteEntries = [...nums, ...syms];
    const groups = [];
    const groupOfEntry = new Map();

    for (const entry of finiteEntries) {
      let found = null;
      for (const g of groups) {
        const rep = g[0];
        if (entry.scalar.kind === 'num' && rep.scalar.kind === 'num' && Math.abs(entry.scalar.value - rep.scalar.value) <= 1e-9) {
          found = g;
          break;
        }
        if (entry.scalar.kind === 'sym' && rep.scalar.kind === 'sym' && entry.scalar.key === rep.scalar.key) {
          found = g;
          break;
        }
      }
      if (!found) {
        found = [entry];
        groups.push(found);
      } else {
        found.push(entry);
      }
      groupOfEntry.set(entry, groups.indexOf(found));
    }

    const G = groups.length;
    const edges = Array.from({ length: G }, () => new Set());
    for (let i = 0; i < G; i++) {
      for (let j = 0; j < G; j++) {
        if (i === j) continue;
        const a = groups[i][0].scalar;
        const b = groups[j][0].scalar;
        if (a.kind === 'num' && b.kind === 'num' && a.value < b.value - 1e-9) {
          edges[i].add(j);
        }
      }
    }
    for (const it of intervals) {
      if (it.sign === 'hatch' || !it.fromVal || !it.toVal) continue;
      const eFrom = entryMap.get(it.fromVal);
      const eTo = entryMap.get(it.toVal);
      if (!eFrom || !eTo) continue;
      const gFrom = groupOfEntry.get(eFrom);
      const gTo = groupOfEntry.get(eTo);
      if (gFrom === undefined || gTo === undefined || gFrom === gTo) continue;
      if (it.dir === 'up') edges[gFrom].add(gTo);
      else if (it.dir === 'down') edges[gTo].add(gFrom);
    }

    // Longest path rank with cycle safety
    const rank = Array(G).fill(0);
    for (let pass = 0; pass < G; pass++) {
      let changed = false;
      for (let u = 0; u < G; u++) {
        for (const v of edges[u]) {
          if (rank[v] < rank[u] + 1) {
            rank[v] = rank[u] + 1;
            changed = true;
          }
        }
      }
      if (!changed) break;
    }

    const buckets = new Map();
    for (let i = 0; i < G; i++) {
      const r = rank[i];
      if (!buckets.has(r)) buckets.set(r, []);
      buckets.get(r).push(...groups[i]);
    }
    for (const r of [...buckets.keys()].sort((a, b) => a - b)) {
      levels.push(buckets.get(r));
    }
  }

  if (posInfs.length) levels.push(posInfs);

  const M = levels.length;
  for (let lvl = 0; lvl < M; lvl++) {
    const cy = M === 1 ? (yTop + yBot) / 2 : yBot - (lvl / (M - 1)) * (yBot - yTop);
    for (const entry of levels[lvl]) {
      entry.cy = cy;
      entry.slotObj.cy = cy;
    }
  }
  return { entries, levelsCount: M };
}

function estimateLabelBox(latex) {
  const s = String(latex || '');
  const hasFrac = /\\(?:dfrac|tfrac|frac)\b/.test(s);
  const hasSqrt = /\\sqrt\b/.test(s);
  let visibleLen = s
    .replace(/\\(?:infty|pi|alpha|beta|theta|varphi|phi|omega|pm|cdot|times)\b/g, 'W')
    .replace(/\\(?:left|right|mathrm|text|dfrac|tfrac|frac|sqrt)\b/g, '')
    .replace(/[{}^_\\]/g, '')
    .trim().length;
  if (s.includes('\\infty')) visibleLen = Math.max(visibleLen, 3);
  const hw = Math.min(46, Math.max(15, 7 + visibleLen * 4.4));
  const hh = hasFrac ? 21 : hasSqrt ? 16 : 13;
  return { hw, hh };
}

function appendMathLabelFO(svg, { cx, cy, boxW, boxH, latex, role, extraClass = '' }) {
  const fo = makeSvgNode('foreignObject', {
    x: (cx - boxW / 2).toFixed(1),
    y: (cy - boxH / 2).toFixed(1),
    width: boxW.toFixed(1),
    height: boxH.toFixed(1),
    'data-bbt-role': role,
    'data-bbt-cy': cy.toFixed(1)
  });
  const labelDiv = makeXhtmlDiv(`ltch-bbt-cell-label${extraClass ? ` ${extraClass}` : ''}`);
  const formulaSpan = typeof document.createElement === 'function' ? document.createElement('span') : makeXhtmlDiv('forum-math-inline');
  formulaSpan.setAttribute('class', 'forum-math-inline');
  try {
    formulaSpan.innerHTML = renderForumFormula(latex, false);
  } catch {
    formulaSpan.textContent = latex;
  }
  labelDiv.append(formulaSpan);
  fo.append(labelDiv);
  svg.append(fo);
}

function appendHatchLines(svg, x0, x1, y0, y1, step = 10) {
  if (x1 - x0 < 4 || y1 - y0 < 4) return;
  const H = y1 - y0;
  for (let s = -H; s <= x1 - x0; s += step) {
    // Line equation through (x0 + s, y1) with slope -1 in SVG coords -> up-right: (t, y1 - (t - (x0 + s)))
    // Intersect x in [x0, x1] and y in [y0, y1] => x0 + s <= t <= x0 + s + H
    const xs = Math.max(x0, x0 + s);
    const xe = Math.min(x1, x0 + s + H);
    if (xe - xs < 1) continue;
    const ys = y1 - (xs - (x0 + s));
    const ye = y1 - (xe - (x0 + s));
    svg.append(makeSvgNode('line', {
      class: 'ltch-bbt-hatch',
      x1: xs.toFixed(1),
      y1: ys.toFixed(1),
      x2: xe.toFixed(1),
      y2: ye.toFixed(1)
    }));
  }
}

function appendVectorArrow(svg, xStart, yStart, boxStart, xEnd, yEnd, boxEnd) {
  const dx = xEnd - xStart;
  const dy = yEnd - yStart;
  const L = Math.hypot(dx, dy);
  if (L < 8) return;
  const ux = dx / L;
  const uy = dy / L;
  const trimStart = Math.min(
    Math.abs(ux) > 1e-6 ? boxStart.hw / Math.abs(ux) : 1e6,
    Math.abs(uy) > 1e-6 ? boxStart.hh / Math.abs(uy) : 1e6
  );
  const trimEnd = Math.min(
    Math.abs(ux) > 1e-6 ? boxEnd.hw / Math.abs(ux) : 1e6,
    Math.abs(uy) > 1e-6 ? boxEnd.hh / Math.abs(uy) : 1e6
  );
  if (L <= trimStart + trimEnd + 10) return;

  const ax1 = xStart + ux * trimStart;
  const ay1 = yStart + uy * trimStart;
  const tipX = xEnd - ux * trimEnd;
  const tipY = yEnd - uy * trimEnd;
  const headLen = 9;
  const headHalfW = 4.2;
  const baseX = tipX - ux * headLen;
  const baseY = tipY - uy * headLen;
  const px = -uy * headHalfW;
  const py = ux * headHalfW;

  svg.append(makeSvgNode('line', {
    class: 'ltch-bbt-arrow',
    x1: ax1.toFixed(1),
    y1: ay1.toFixed(1),
    x2: (tipX - ux * (headLen * 0.65)).toFixed(1),
    y2: (tipY - uy * (headLen * 0.65)).toFixed(1)
  }));
  const pts = [
    `${tipX.toFixed(1)},${tipY.toFixed(1)}`,
    `${(baseX + px).toFixed(1)},${(baseY + py).toFixed(1)}`,
    `${(baseX - px).toFixed(1)},${(baseY - py).toFixed(1)}`
  ].join(' ');
  svg.append(makeSvgNode('polygon', { class: 'ltch-bbt-arrow-head', points: pts }));
}

export function tryRenderVariationOrSignTable(srcTable) {
  const model = parseVariationOrSignTable(srcTable);
  if (!model) return null;

  const { isVariation, headers, nodes, intervals } = model;
  const N = nodes.length;
  const longestHeader = Math.max(...headers.map((hStr) => hStr.replace(/\\|\{|\}/g, '').length));
  const col0W = longestHeader >= 5 ? 76 : 62;
  const row0H = 42;
  const row1H = 42;

  const padLeft = nodes[0].yDbar && nodes[0].rightLimit ? 60 : 44;
  const padRight = nodes[N - 1].yDbar && nodes[N - 1].leftLimit ? 60 : 44;

  // Compute node X coordinates dynamically based on whether asymptotic side-limits exist
  const nodeXs = [col0W + padLeft];
  for (let k = 0; k < intervals.length; k++) {
    const leftSideOffset = nodes[k].rightLimit ? 28 : 0;
    const rightSideOffset = nodes[k + 1].leftLimit ? 28 : 0;
    const stepW = (leftSideOffset || rightSideOffset) ? 148 : 118;
    nodeXs.push(nodeXs[k] + stepW);
  }

  const totalW = Math.round(nodeXs[N - 1] + padRight);
  const yRowPadTop = 28;
  const yRowPadBot = 28;

  // Count distinct heights first so multi-extremum tables get comfortable vertical spread
  const preHeights = isVariation ? assignValueHeights(nodes, intervals, 0, 100) : { levelsCount: 0 };
  const row2H = isVariation ? Math.max(122, Math.min(184, 72 + preHeights.levelsCount * 24)) : 0;
  const totalH = row0H + row1H + row2H;

  if (isVariation) {
    const yRowStart = row0H + row1H;
    assignValueHeights(nodes, intervals, yRowStart + yRowPadTop, totalH - yRowPadBot);
  }

  const svg = makeSvgNode('svg', {
    class: 'ltch-bbt-svg',
    width: String(totalW),
    height: String(totalH),
    viewBox: `0 0 ${totalW} ${totalH}`,
    role: 'img',
    'aria-label': isVariation ? 'Bảng biến thiên hàm số' : 'Bảng xét dấu'
  });

  // 1. White canvas
  svg.append(makeSvgNode('rect', {
    class: 'ltch-bbt-bg',
    x: '0',
    y: '0',
    width: String(totalW),
    height: String(totalH)
  }));

  // 2. Hatched forbidden regions in Row 1 (and Row 2 if BBT)
  for (let k = 0; k < intervals.length; k++) {
    if (intervals[k].sign !== 'hatch') continue;
    const xL = k === 0 && nodes[0].signAtNode !== 'dbar' ? col0W : nodeXs[k] + (nodes[k].signAtNode === 'dbar' ? 3 : 0);
    const xR = k === intervals.length - 1 && nodes[N - 1].signAtNode !== 'dbar' ? totalW : nodeXs[k + 1] - (nodes[k + 1].signAtNode === 'dbar' ? 3 : 0);
    appendHatchLines(svg, xL, xR, row0H, row0H + row1H);
    if (isVariation) {
      const yxL = k === 0 && !nodes[0].yDbar ? col0W : nodeXs[k] + (nodes[k].yDbar ? 3 : 0);
      const yxR = k === intervals.length - 1 && !nodes[N - 1].yDbar ? totalW : nodeXs[k + 1] - (nodes[k + 1].yDbar ? 3 : 0);
      appendHatchLines(svg, yxL, yxR, row0H + row1H, totalH);
    }
    if (k > 0) {
      const yTopLine = nodes[k].signAtNode === 'dbar' ? (isVariation && !nodes[k].yDbar ? row0H + row1H : totalH) : row0H;
      if (yTopLine < totalH) {
        svg.append(makeSvgNode('line', {
          class: 'ltch-bbt-divider',
          x1: String(nodeXs[k]), y1: String(yTopLine), x2: String(nodeXs[k]), y2: String(totalH)
        }));
      }
    }
    if (k < intervals.length - 1) {
      const yTopLine = nodes[k + 1].signAtNode === 'dbar' ? (isVariation && !nodes[k + 1].yDbar ? row0H + row1H : totalH) : row0H;
      if (yTopLine < totalH) {
        svg.append(makeSvgNode('line', {
          class: 'ltch-bbt-divider',
          x1: String(nodeXs[k + 1]), y1: String(yTopLine), x2: String(nodeXs[k + 1]), y2: String(totalH)
        }));
      }
    }
  }

  // 3. Double vertical bars || (drawn per node cleanly across Row 1 and/or Row 2)
  const dbarHalfGap = 2.6;
  for (let i = 0; i < N; i++) {
    const nd = nodes[i];
    const hasSignDbar = nd.signAtNode === 'dbar';
    const hasYDbar = isVariation && nd.yDbar;
    if (!hasSignDbar && !hasYDbar) continue;
    const cx = nodeXs[i];
    const yStart = hasSignDbar ? row0H : row0H + row1H;
    const yEnd = hasYDbar ? totalH : row0H + row1H;
    svg.append(makeSvgNode('line', {
      class: 'ltch-bbt-dbar',
      x1: (cx - dbarHalfGap).toFixed(1),
      y1: String(yStart),
      x2: (cx - dbarHalfGap).toFixed(1),
      y2: String(yEnd)
    }));
    svg.append(makeSvgNode('line', {
      class: 'ltch-bbt-dbar',
      x1: (cx + dbarHalfGap).toFixed(1),
      y1: String(yStart),
      x2: (cx + dbarHalfGap).toFixed(1),
      y2: String(yEnd)
    }));
  }

  // 4. Outer frame, single vertical header line, horizontal row dividers (zero vertical interval gridlines!)
  svg.append(makeSvgNode('line', {
    class: 'ltch-bbt-divider',
    x1: String(col0W), y1: '0', x2: String(col0W), y2: String(totalH)
  }));
  svg.append(makeSvgNode('line', {
    class: 'ltch-bbt-divider',
    x1: '0', y1: String(row0H), x2: String(totalW), y2: String(row0H)
  }));
  if (isVariation) {
    svg.append(makeSvgNode('line', {
      class: 'ltch-bbt-divider',
      x1: '0', y1: String(row0H + row1H), x2: String(totalW), y2: String(row0H + row1H)
    }));
  }
  svg.append(makeSvgNode('rect', {
    class: 'ltch-bbt-frame-rect',
    x: '0.75',
    y: '0.75',
    width: String(totalW - 1.5),
    height: String(totalH - 1.5)
  }));

  // 5. Col 0 header labels
  appendMathLabelFO(svg, { cx: col0W / 2, cy: row0H / 2, boxW: col0W - 6, boxH: row0H - 4, latex: headers[0], role: 'header-x', extraClass: 'is-header' });
  appendMathLabelFO(svg, { cx: col0W / 2, cy: row0H + row1H / 2, boxW: col0W - 6, boxH: row1H - 4, latex: headers[1], role: 'header-yprime', extraClass: 'is-header' });
  if (isVariation) {
    appendMathLabelFO(svg, { cx: col0W / 2, cy: row0H + row1H + row2H / 2, boxW: col0W - 6, boxH: 36, latex: headers[2], role: 'header-y', extraClass: 'is-header' });
  }

  // 6. Row 0 x-values & Row 1 signs
  for (let i = 0; i < N; i++) {
    const cx = nodeXs[i];
    appendMathLabelFO(svg, {
      cx,
      cy: row0H / 2,
      boxW: 90,
      boxH: row0H - 4,
      latex: nodes[i].xLatex,
      role: 'x-node'
    });
    if (nodes[i].signAtNode === '0') {
      appendMathLabelFO(svg, {
        cx,
        cy: row0H + row1H / 2,
        boxW: 40,
        boxH: row1H - 4,
        latex: '0',
        role: 'sign-zero'
      });
    }
  }
  for (let k = 0; k < intervals.length; k++) {
    const sg = intervals[k].sign;
    if (sg !== '+' && sg !== '-') continue;
    const mx = 0.5 * (nodeXs[k] + nodeXs[k + 1]);
    appendMathLabelFO(svg, {
      cx: mx,
      cy: row0H + row1H / 2,
      boxW: 48,
      boxH: row1H - 4,
      latex: sg,
      role: 'sign-interval',
      extraClass: 'is-sign'
    });
  }

  // 7. Row 2 y-values, asymptotic side limits, and vector arrows
  if (isVariation) {
    const limitOffset = 28;
    const nodeAnchors = nodes.map((nd, i) => {
      const cx = nodeXs[i];
      const out = { left: null, center: null, right: null };
      if (nd.leftLimit) {
        const lx = cx - limitOffset;
        const box = estimateLabelBox(nd.leftLimit.latex);
        out.left = { x: lx, y: nd.leftLimit.cy, box };
        appendMathLabelFO(svg, {
          cx: lx,
          cy: nd.leftLimit.cy,
          boxW: Math.max(54, box.hw * 2 + 12),
          boxH: Math.max(32, box.hh * 2 + 8),
          latex: nd.leftLimit.latex,
          role: 'y-limit-left'
        });
      }
      if (nd.val) {
        const hatchOnLeft = i > 0 && intervals[i - 1]?.sign === 'hatch';
        const hatchOnRight = i < N - 1 && intervals[i]?.sign === 'hatch';
        const vx = hatchOnRight && !hatchOnLeft ? cx - 18 : (hatchOnLeft && !hatchOnRight ? cx + 18 : cx);
        const box = estimateLabelBox(nd.val.latex);
        out.center = { x: vx, y: nd.val.cy, box };
        appendMathLabelFO(svg, {
          cx: vx,
          cy: nd.val.cy,
          boxW: Math.max(58, box.hw * 2 + 12),
          boxH: Math.max(32, box.hh * 2 + 8),
          latex: nd.val.latex,
          role: 'y-val'
        });
      }
      if (nd.rightLimit) {
        const rx = cx + limitOffset;
        const box = estimateLabelBox(nd.rightLimit.latex);
        out.right = { x: rx, y: nd.rightLimit.cy, box };
        appendMathLabelFO(svg, {
          cx: rx,
          cy: nd.rightLimit.cy,
          boxW: Math.max(54, box.hw * 2 + 12),
          boxH: Math.max(32, box.hh * 2 + 8),
          latex: nd.rightLimit.latex,
          role: 'y-limit-right'
        });
      }
      return out;
    });

    for (let k = 0; k < intervals.length; k++) {
      const it = intervals[k];
      if (it.sign === 'hatch' || !it.dir) continue;
      const startA = nodeAnchors[k].right || nodeAnchors[k].center;
      const endA = nodeAnchors[k + 1].left || nodeAnchors[k + 1].center;
      if (!startA || !endA) continue;
      appendVectorArrow(svg, startA.x, startA.y, startA.box, endA.x, endA.y, endA.box);
    }
  }

  const wrap = document.createElement('div');
  wrap.setAttribute('class', 'ltch-bbt-wrap');
  wrap.append(svg);
  return wrap;
}
