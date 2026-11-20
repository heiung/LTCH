import test from 'node:test';
import assert from 'node:assert/strict';
import {renderForumFormula} from '../client/forum-math.mjs';
import {MATH_PRESET_GROUPS} from '../client/question-math-presets.mjs';
import {createVisualMathModel, parseLatexToAst, serializeSlotToLatex} from '../client/visual-math-field.mjs';

test('All math presets parse cleanly into Visual AST and fill into valid KaTeX formulas', () => {
  for (const group of MATH_PRESET_GROUPS) {
    for (const item of group.items) {
      const parsedPreview = parseLatexToAst(item.preview);
      assert.equal(parsedPreview.ok, true, `Preset preview failed AST parse: ${item.label} (${item.preview})`);
      const roundtrip = serializeSlotToLatex(parsedPreview.root);
      assert.ok(renderForumFormula(roundtrip, false).includes('<math'), `Roundtrip failed KaTeX: ${roundtrip}`);

      // Also test inserting the preset template into a fresh visual model and filling all empty slots
      const model = createVisualMathModel();
      assert.equal(model.insertTemplate(item.insert), true, `Preset insert failed: ${item.label} (${item.insert})`);
      let safety = 0;
      while (model.hasIncompleteSlots && safety < 10) {
        if (safety > 0) model.jumpSlot(false);
        model.typeText('x');
        safety++;
      }
      assert.equal(model.hasIncompleteSlots, false, `Preset still incomplete after filling: ${item.label} -> ${model.getLatex()}`);
      const filledLatex = model.getLatex();
      assert.ok(!filledLatex.includes('\\placeholder'), `Unexpected placeholder in ${filledLatex}`);
      assert.ok(renderForumFormula(filledLatex, false).includes('<math'), `Filled preset failed KaTeX: ${filledLatex}`);
    }
  }
});

test('Natural typing builds fractions, exponents, subscripts, fences, and trig functions', () => {
  const m = createVisualMathModel();
  m.typeText('x^2');
  assert.equal(m.getLatex(), 'x^{2}');
  m.typeText(' '); // step out of exponent
  m.typeText('+2x+1');
  assert.equal(m.getLatex(), 'x^{2}+2x+1');

  // Fraction wrapping preceding term vs fenced group
  const m2 = createVisualMathModel();
  m2.typeText('(x+1)');
  m2.typeText('/');
  m2.typeText('x-1');
  assert.equal(m2.getLatex(), '\\frac{\\left(x+1\\right)}{x-1}');

  // Sub + Sup upgrade to subsup
  const m3 = createVisualMathModel();
  m3.typeText('a_n');
  m3.moveRight(); // step out of subscript
  m3.typeText('^2');
  assert.equal(m3.getLatex(), 'a_{n}^{2}');

  // Trig auto-function with '('
  const m4 = createVisualMathModel();
  m4.typeText('sin(2x)');
  assert.equal(m4.getLatex(), '\\sin\\left(2x\\right)');
});

test('Auto-shortcuts convert operators and keywords accurately without breaking ordinary algebra', () => {
  const m = createVisualMathModel();
  m.typeText('x>=0');
  assert.equal(m.getLatex(), 'x\\ge 0');

  const m2 = createVisualMathModel();
  m2.typeText('sqrt');
  m2.typeText('x+3');
  m2.moveRight();
  m2.typeText('!=2');
  assert.equal(m2.getLatex(), '\\sqrt{x+3}\\neq 2');

  const m3 = createVisualMathModel();
  m3.typeText('Delta=b^2 -4ac');
  assert.equal(m3.getLatex(), '\\Delta=b^{2}-4ac');

  // Ordinary multi-letter product 'ab' stays 'ab'
  const m4 = createVisualMathModel();
  m4.typeText('2ab');
  assert.equal(m4.getLatex(), '2ab');
});

test('Smart base adoption works when clicking Power or Degree after typing a base', () => {
  const m = createVisualMathModel();
  m.typeText('90');
  m.insertTemplate('#@^{\\circ}');
  assert.equal(m.getLatex(), '90^{\\circ}');

  const m2 = createVisualMathModel();
  m2.typeText('x');
  m2.insertTemplate('#@^{#?}');
  m2.typeText('3');
  assert.equal(m2.getLatex(), 'x^{3}');
});

test('System of equations supports adding and removing rows and vertical navigation', () => {
  const m = createVisualMathModel();
  m.insertTemplate('\\begin{cases}#@=#?\\\\#?=#?\\end{cases}');
  assert.equal(m.isInsideSystem(), true);
  m.typeText('x+y');
  m.jumpSlot(false);
  m.typeText('5');
  m.jumpSlot(false);
  m.typeText('x-y');
  m.jumpSlot(false);
  m.typeText('1');
  assert.equal(m.getLatex(), '\\begin{cases}x+y=5\\\\x-y=1\\end{cases}');

  // Add 3rd row
  assert.equal(m.addSystemRow(), true);
  m.typeText('z=2');
  assert.equal(m.getLatex(), '\\begin{cases}x+y=5\\\\x-y=1\\\\z=2\\end{cases}');

  // Undo restores 2-row state cleanly
  m.undo();
  m.undo();
  m.undo();
  m.undo(); // undo '2', '=', 'z', and addSystemRow
  assert.equal(m.getLatex(), '\\begin{cases}x+y=5\\\\x-y=1\\end{cases}');
});

test('Backspace unwraps empty fractions and exponents without losing numerator/base', () => {
  const m = createVisualMathModel();
  m.typeText('2x/');
  assert.equal(m.getLatex(), '\\frac{2x}{\\placeholder{}}');
  m.backspace(); // unwraps 2x back to parent slot!
  assert.equal(m.getLatex(), '2x');

  m.typeText('^');
  assert.equal(m.getLatex(), '2x^{\\placeholder{}}');
  m.backspace();
  assert.equal(m.getLatex(), '2x');
});

test('Unsupported exotic LaTeX returns ok:false so editor can preserve it safely in LaTeX mode', () => {
  const res = parseLatexToAst('\\begin{pmatrix}1 & 2\\\\ 3 & 4\\end{pmatrix}');
  assert.equal(res.ok, false);
});

test('Square placeholder symbols parse cleanly into Visual AST and round-trip', () => {
  const res = parseLatexToAst('\\frac{\\square}{\\Box}');
  assert.equal(res.ok, true);
  assert.equal(serializeSlotToLatex(res.root), '\\frac{\\square}{\\square}');
});

test('Geometry variants and compatible symbols parse into Visual AST cleanly', () => {
  const arc = parseLatexToAst('\\overparen{AB}');
  assert.equal(arc.ok, true);
  assert.equal(serializeSlotToLatex(arc.root), '\\overset{\\frown}{AB}');

  const tilde = parseLatexToAst('\\widetilde{ABC}');
  assert.equal(tilde.ok, true);
  assert.equal(serializeSlotToLatex(tilde.root), '\\widetilde{ABC}');

  const sym = parseLatexToAst('x\\leqslant 1\\geqslant y');
  assert.equal(sym.ok, true);
  assert.equal(serializeSlotToLatex(sym.root), 'x\\le 1\\ge y');
});

test('insertNewline, backspace merge, trimEmptyLines and multi-line array round-trip cleanly', () => {
  const m = createVisualMathModel();
  m.typeText('2x+1=5');
  assert.equal(m.insertNewline(), true);
  m.typeText('2x=4');
  assert.equal(m.insertNewline(), true);
  // Leave 3rd line empty and verify trimEmptyLines drops only empty lines
  assert.equal(m.getLatex(), '\\begin{array}{l}2x+1=5\\\\2x=4\\\\\\placeholder{}\\end{array}');
  m.trimEmptyLines();
  assert.equal(m.getLatex(), '\\begin{array}{l}2x+1=5\\\\2x=4\\end{array}');

  // Round-trip back into AST
  const parsed = parseLatexToAst(m.getLatex());
  assert.equal(parsed.ok, true);
  assert.equal(serializeSlotToLatex(parsed.root), '\\begin{array}{l}2x+1=5\\\\2x=4\\end{array}');

  // Backspace at start of line 2 merges back into single line
  const m2 = createVisualMathModel();
  m2.typeText('a=1');
  m2.insertNewline();
  m2.typeText('b=2');
  m2.moveLeft(); m2.moveLeft(); m2.moveLeft();
  assert.equal(m2.backspace(), true);
  assert.equal(m2.getLatex(), 'a=1b=2');
});
