import test from 'node:test';
import assert from 'node:assert/strict';
import {MATH_PRESET_GROUPS, applySourceTemplate, buildFormulaDelimiters} from '../client/question-math-presets.mjs';
import {parseForumMath, renderForumFormula} from '../client/forum-math.mjs';

test('all math editor preset previews and filled templates render cleanly in KaTeX MathML', () => {
  assert.ok(MATH_PRESET_GROUPS.length >= 5);
  for (const group of MATH_PRESET_GROUPS) {
    assert.ok(group.items.length > 0, `Group ${group.id} must not be empty`);
    for (const item of group.items) {
      assert.ok(item.label && item.insert && item.preview, 'Preset must define label, insert, and preview');
      const previewHtml = renderForumFormula(item.preview, false);
      assert.match(previewHtml, /<math\b/, `Preview failed for ${item.label}`);
      const filled = item.insert.replaceAll('#@', 'x').replaceAll('#?', '1');
      const filledHtml = renderForumFormula(filled, true);
      assert.match(filledHtml, /<math\b/, `Filled template failed for ${item.label}`);
      if (/\\(begin\{cases\}|begin\{array\}|lim|int|sum|prod|log|ln|sin|cos|tan|cot|widehat)/.test(item.preview)) {
        assert.equal(item.wide, true, `Wide formula preset should mark wide:true (${item.label})`);
      }
    }
  }
});

test('applySourceTemplate wraps selected LaTeX or positions cursor inside first placeholder', () => {
  const wrapped = applySourceTemplate('2 + x', 4, 5, '\\frac{#@}{#?}');
  assert.equal(wrapped.value, '2 + \\frac{x}{}');
  assert.equal(wrapped.cursor, '2 + \\frac{x}{'.length);

  const empty = applySourceTemplate('', 0, 0, '\\sqrt{#@}');
  assert.equal(empty.value, '\\sqrt{}');
  assert.equal(empty.cursor, '\\sqrt{'.length);

  const symbol = applySourceTemplate('a ', 2, 2, '\\le ');
  assert.equal(symbol.value, 'a \\le ');
  assert.equal(symbol.cursor, 'a \\le '.length);
});

test('buildFormulaDelimiters preserves compatible inline/display delimiters and round-trips parseForumMath', () => {
  assert.deepEqual(buildFormulaDelimiters('', false), ['$', '$']);
  assert.deepEqual(buildFormulaDelimiters('\\(x\\)', false), ['\\(', '\\)']);
  assert.deepEqual(buildFormulaDelimiters('\\(x\\)', true), ['$$', '$$']);
  assert.deepEqual(buildFormulaDelimiters('', true), ['$$', '$$']);
  assert.deepEqual(buildFormulaDelimiters('\\[x\\]', true), ['\\[', '\\]']);
  assert.deepEqual(buildFormulaDelimiters('$$x$$', false), ['$', '$']);

  const blockLatex = '\\begin{cases}x+y=3\\\\x-y=1\\end{cases}';
  const [open, close] = buildFormulaDelimiters('', true);
  const parsed = parseForumMath(`${open}${blockLatex}${close}`);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].type, 'math');
  assert.equal(parsed[0].display, true);
  assert.equal(parsed[0].latex, blockLatex);
});
