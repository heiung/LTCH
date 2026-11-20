'use strict';
const { grade } = require('../../public/practice-engine.js');

// repository.saveAttemptOnce must atomically reject an existing attempt ID.
// authorize must obtain membership from trusted server data.
function createPracticeService({ repository, authorize, canReadAttempt = async () => false, clock = Date.now }) {
  if (!repository || typeof repository.getExam !== 'function' || typeof repository.saveAttemptOnce !== 'function' || typeof repository.getAttempt !== 'function' || typeof authorize !== 'function') throw new TypeError('Practice configuration missing');
  function time() { const now = clock(); if (!Number.isSafeInteger(now)) throw new Error('Invalid clock'); return now; }
  async function examFor(actor, examId, action = 'read') {
    if (!actor || typeof actor.uid !== 'string' || typeof examId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(examId)) throw new Error('Unavailable');
    const exam = await repository.getExam(examId);
    if (!exam || !(exam.status === 'published' || action === 'result' && exam.status === 'archived') || !await authorize(actor, exam, action)) throw new Error('Unavailable');
    return exam;
  }
  function visibleQuestion(q) {
    if (!q || typeof q.id !== 'string' || typeof q.prompt !== 'string' || q.prompt.length > 20000 || !['single','multiple','true_false','short','fill_blank','drag_drop'].includes(q.type)) throw new TypeError('Invalid question');
    const question = { id: q.id, type: q.type, prompt: q.prompt, points: q.points };
    if (q.type === 'single' || q.type === 'multiple' || q.type === 'true_false') {
      const items = q.type === 'true_false' ? q.statements : q.options;
      const minLen = q.type === 'single' ? 4 : (q.type === 'multiple' ? 2 : 1);
      const maxLen = q.type === 'single' ? 4 : (q.type === 'multiple' ? 6 : 5);
      if (!Array.isArray(items) || items.length < minLen || items.length > maxLen || items.some(x => typeof x !== 'string' || x.length > 10000)) throw new TypeError('Invalid choices');
      if (q.type === 'true_false') question.statements = [...items]; else question.options = [...items];
    }
    if (q.type === 'fill_blank' && Array.isArray(q.blanks)) question.blankCount = q.blanks.length;
    if (q.type === 'drag_drop' && Array.isArray(q.cards)) {
      question.cards = [...q.cards];
      question.slotCount = Array.isArray(q.answer) ? q.answer.length : (Array.isArray(q.answers) ? q.answers.length : 0);
    }
    return question;
  }
  async function read(actor, examId) {
    const exam = await examFor(actor, examId); const now = time();
    if (!Number.isSafeInteger(exam.opensAt) || !Number.isSafeInteger(exam.closesAt) || now < exam.opensAt || now >= exam.closesAt) throw new Error('Unavailable');
    return { id: examId, title: exam.title, opensAt: exam.opensAt, closesAt: exam.closesAt, questions: exam.questions.map(visibleQuestion) };
  }
  async function submit(actor, examId, attemptId, responses) {
    if (typeof attemptId !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(attemptId)) throw new TypeError('Invalid attempt');
    const exam = await examFor(actor, examId); const now = time();
    if (!Number.isSafeInteger(exam.opensAt) || !Number.isSafeInteger(exam.closesAt) || now < exam.opensAt || now >= exam.closesAt) throw new Error('Unavailable');
    if (!responses || typeof responses !== 'object' || Array.isArray(responses) || Object.keys(responses).length > exam.questions.length) throw new TypeError('Invalid responses');
    const validIds = new Set(exam.questions.map(q => q.id));
    for (const [id, answer] of Object.entries(responses)) {
      if (!validIds.has(id) || !(typeof answer === 'string' && answer.length <= 200 || Array.isArray(answer) && answer.length === 4 && answer.every(x => x === null || typeof x === 'boolean'))) throw new TypeError('Invalid responses');
    }
    const result = grade(exam.questions, responses);
    const saved = await repository.saveAttemptOnce({ attemptId, examId, uid: actor.uid, submittedAt: now, responses, score: result.score, max: result.max, results: result.results });
    if (!saved) throw new Error('Attempt already exists');
    return { attemptId, submittedAt: now };
  }
  async function result(actor, examId, attemptId) {
    const exam = await examFor(actor, examId, 'result'); const now = time();
    const attempt = await repository.getAttempt(attemptId);
    if (!attempt || attempt.examId !== examId || (attempt.uid !== actor.uid && !await canReadAttempt(actor, exam, attempt))) throw new Error('Unavailable');
    if (!Number.isSafeInteger(exam.resultsAt) || now < exam.resultsAt) return { status: 'submitted', submittedAt: attempt.submittedAt };
    const data = { status: 'graded', submittedAt: attempt.submittedAt, score: attempt.score, max: attempt.max, results: attempt.results };
    if (Number.isSafeInteger(exam.solutionsAt) && now >= exam.solutionsAt) data.solutions = exam.questions.map(q => ({ id: q.id, solution: q.solution || '' }));
    return data;
  }
  return { read, submit, result };
}
module.exports = { createPracticeService };


