import test from 'node:test';
import assert from 'node:assert/strict';
import {serializeQuestionContent} from '../client/question-content.mjs';
const text = data => ({nodeType: 3, data});
const element = (nodeName, childNodes = [], dataset = {}) => ({nodeType: 1, nodeName, childNodes, dataset});
const formula = raw => element('SPAN', [text('visual math')], {formula: raw});
const fragment = (...childNodes) => ({nodeType: 11, childNodes});
test('serializes mixed text and editable math in the original wire format', () => {
  const result = serializeQuestionContent(fragment(text('Cho '), formula('$x^2$'), text(' và '), formula('\\[y=2\\]'), text('.')));
  assert.equal(result, 'Cho $x^2$ và \\[y=2\\].');
});
test('preserves line breaks, blank lines, spaces and ignores visual math descendants', () => {
  const result = serializeQuestionContent(fragment(text('Dòng 1'), element('DIV', [text('Dòng 2'), formula('$x$')]), element('DIV', [element('BR')]), element('DIV', [text('Dòng 4')])));
  assert.equal(result, 'Dòng 1\nDòng 2$x$\n\nDòng 4');
});
