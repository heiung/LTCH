const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreQuestion, grade } = require('../public/practice-engine.js');

test('single choice requires the actual answer, not a blank', () => {
  const q = { type: 'single', answer: 'B', points: 0.25 };
  assert.equal(scoreQuestion(q, 'B').score, 0.25);
  assert.equal(scoreQuestion(q, '').score, 0);
  assert.equal(scoreQuestion(q, 'A').score, 0);
});
test('true/false grades each of four responses with configurable partial credit', () => {
  const q = { type: 'true_false', answers: [true, false, true, false], weights: [0, 0.1, 0.25, 0.5, 1], points: 1 };
  assert.equal(scoreQuestion(q, [true, false, false, null]).score, 0.25);
  assert.equal(scoreQuestion(q, [true, false, true, false]).score, 1);
  assert.equal(scoreQuestion(q, []).score, 0);
  assert.throws(() => scoreQuestion({ ...q, weights: [0, 0.5, 0.2, 0.5, 1] }, []));
});
test('short answers normalize decimal separators and preserve explicit acceptable answers', () => {
  const q = { type: 'short', accepted: ['-1,5', '3/2'], points: 1 };
  assert.equal(scoreQuestion(q, ' −1.5 ').score, 1);
  assert.equal(scoreQuestion(q, '').score, 0);
  assert.equal(scoreQuestion(q, '1.5').score, 0);
});
test('grades mixed questions and rejects duplicate IDs', () => {
  const questions = [{ id: 'a', type: 'single', answer: 'A', points: 2 }, { id: 'b', type: 'short', accepted: ['0'], points: 1 }];
  assert.deepEqual([grade(questions, { a: 'A', b: '0' }).score, grade(questions, {}).max], [3, 3]);
  assert.throws(() => grade([questions[0], questions[0]], {}));
});

test('TSA multiple choice, variable true/false, fill_blank and drag_drop require full accuracy', () => {
  const qMulti = { id: 'm1', type: 'multiple', options: ['2', '9', '11', '15', '17', '21'], answers: ['A', 'C', 'E'], points: 1 };
  assert.equal(scoreQuestion(qMulti, ['A', 'C', 'E']).score, 1);
  assert.equal(scoreQuestion(qMulti, ['A', 'C']).score, 0);
  assert.equal(scoreQuestion(qMulti, ['A', 'C', 'E', 'B']).score, 0);

  const qTf3 = { id: 'tf3', type: 'true_false', answers: [true, true, false], weights: [0, 0, 0, 1], points: 1 };
  assert.equal(scoreQuestion(qTf3, [true, true, false]).score, 1);
  assert.equal(scoreQuestion(qTf3, [true, true, true]).score, 0);

  const qTf1 = { id: 'tf1', type: 'true_false', answers: [false], weights: [0, 1], points: 1 };
  assert.equal(scoreQuestion(qTf1, [false]).score, 1);
  assert.equal(scoreQuestion(qTf1, false).score, 1);

  const qFill = { id: 'fb1', type: 'fill_blank', blanks: [{ accepted: ['T', 'thymine', 'timin'] }, { accepted: ['U', 'uracil'] }], points: 1 };
  assert.equal(scoreQuestion(qFill, ['Thymine', 'u']).score, 1);
  assert.equal(scoreQuestion(qFill, ['T', 'A']).score, 0);

  const qDrag = { id: 'dd1', type: 'drag_drop', cards: ['85x-0,25x^2', '170 chiếc', '90-0,25x', '115-0,25x'], answer: ['T4', 'T1', 'T2'], points: 1 };
  assert.equal(scoreQuestion(qDrag, ['T4', 'T1', 'T2']).score, 1);
  assert.equal(scoreQuestion(qDrag, [3, 0, 1]).score, 1);
  assert.equal(scoreQuestion(qDrag, ['T4', 'T1', 'T3']).score, 0);
});

test('TSA drag and drop accepts interchangeable cards once per token', () => {
  const q = { type: 'drag_drop', points: 1, cards: ['tăng', 'giảm', 'tăng'], answer: ['T1', 'T3'] };
  assert.equal(scoreQuestion(q, ['T3', 'T1']).score, 1);
  assert.equal(scoreQuestion(q, ['T1', 'T1']).score, 0);
  assert.equal(scoreQuestion(q, ['T3', 'T2']).score, 0);
});
