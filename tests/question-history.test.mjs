import test from 'node:test';
import assert from 'node:assert/strict';
import {createQuestionHistory} from '../client/question-history.mjs';
const state = markup => ({markup});
test('undo and redo preserve a sequence of text and formula edits', () => {
  const h = createQuestionHistory(state(''));
  h.commit(state('Cho ')); h.commit(state('Cho $x=2$')); h.commit(state('Cho $x=2$!'));
  assert.equal(h.undo().markup, 'Cho $x=2$');
  assert.equal(h.undo().markup, 'Cho ');
  assert.equal(h.redo().markup, 'Cho $x=2$');
  assert.equal(h.redo().markup, 'Cho $x=2$!');
  assert.equal(h.canRedo, false);
});
test('a new edit after undo clears redo and history remains bounded', () => {
  const h = createQuestionHistory(state('0'), 3);
  h.commit(state('1')); h.commit(state('2')); h.commit(state('3'));
  assert.equal(h.undo().markup, '2'); assert.equal(h.undo().markup, '1');
  assert.equal(h.canUndo, false); h.commit(state('new')); assert.equal(h.canRedo, false);
  assert.equal(h.undo().markup, '1'); assert.equal(h.redo().markup, 'new');
  assert.equal(h.commit(state('new')), false);
});
