import test from 'node:test';
import assert from 'node:assert/strict';
import {parseForumMath, renderForumFormula} from '../client/forum-math.mjs';

test('forum text preserves prose and identifies inline and display formulas', () => {
  const text = String.raw`Giải $x^2=4$ và \(\sqrt{x}\).` + '\n' + String.raw`$$\frac{1}{2}$$`;
  const parts = parseForumMath(text);
  assert.deepEqual(parts.filter(p => p.type === 'math').map(p => [p.latex, p.display]), [
    ['x^2=4', false], [String.raw`\sqrt{x}`, false], [String.raw`\frac{1}{2}`, true]
  ]);
  assert.equal(parts.map(p => p.type === 'text' ? p.value : p.raw).join(''), text);
});

test('unmatched, escaped and oversized delimiters remain literal', () => {
  const text = String.raw`Giá \$5 và $chưa đóng` + '\n' + '$' + 'x'.repeat(2001) + '$';
  assert.deepEqual(parseForumMath(text), [{type: 'text', value: text}]);
});

test('rendering uses MathML and rejects malformed or unsafe LaTeX', () => {
  const fraction = renderForumFormula(String.raw`\frac{1}{2}`);
  assert.match(fraction, /<math\b/);
  assert.match(fraction, /<mfrac>/);
  assert.doesNotMatch(fraction, /style=/);
  assert.throws(() => renderForumFormula(String.raw`\frac{1}`));
  const hostile = renderForumFormula(String.raw`\htmlClass{danger}{x}`);
  assert.doesNotMatch(hostile, /class="danger"/);
  const annotation = renderForumFormula(String.raw`\text{<script>}`);
  assert.doesNotMatch(annotation, /<script>/);
});

test('normalizes geometry accents, overset tags and double-struck sets to valid MathML Core', () => {
  const arc = renderForumFormula(String.raw`\overset{\frown}{AB}`);
  const arcHead = arc.slice(0, arc.indexOf('<annotation'));
  assert.doesNotMatch(arc, /style=/);
  assert.match(arcHead, /<mover[^>]*accent="true"[^>]*><mrow><mi>A<\/mi><mi>B<\/mi><\/mrow><mo stretchy="true">⏜<\/mo><\/mover>/);
  assert.doesNotMatch(arcHead, /<mi><mover/);
  assert.doesNotMatch(arcHead, /<mo><mi/);

  const hat = renderForumFormula(String.raw`\widehat{ABC}`);
  assert.match(hat.slice(0, hat.indexOf('<annotation')), /<mo stretchy="true">\u0302<\/mo>/);

  const vec = renderForumFormula(String.raw`\overrightarrow{AB}`);
  assert.match(vec.slice(0, vec.indexOf('<annotation')), /<mo stretchy="true">\u20D7<\/mo>/);

  const seg = renderForumFormula(String.raw`\overline{AB}`);
  assert.match(seg.slice(0, seg.indexOf('<annotation')), /<mo stretchy="true">\u203E<\/mo>/);

  const combined = renderForumFormula(String.raw`\overset{\frown}{AB} + \widehat{ABC}`);
  const combinedHead = combined.slice(0, combined.indexOf('<annotation'));
  assert.match(combinedHead, /⏜/);
  assert.match(combinedHead, /\u0302/);

  const reals = renderForumFormula(String.raw`\mathbb{R}\cup\mathbb{Z}\cup\mathbb{N}\cup\mathbb{Q}`);
  const realsHead = reals.slice(0, reals.indexOf('<annotation'));
  assert.doesNotMatch(realsHead, /double-struck/);
  assert.match(realsHead, /ℝ/);
  assert.match(realsHead, /ℤ/);
  assert.match(realsHead, /ℕ/);
  assert.match(realsHead, /ℚ/);
});
