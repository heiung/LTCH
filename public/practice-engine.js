/* Pure grading logic. Answer keys must remain on a trusted server in production. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LTCHPractice = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function roundScore(value) {
    return Math.round(Number(value) * 10000) / 10000;
  }

  function normalize(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    return String(value)
      .normalize('NFKC')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\s*\/\s*/g, '/')
      .replace(/−/g, '-')
      .replace(/^-\s+/, '-')
      .replace(/,/g, '.')
      .toLowerCase();
  }

  function normalizeOptionKey(val, maxOptions = 6) {
    if (typeof val === 'number' && Number.isInteger(val) && val >= 0 && val < maxOptions) {
      return 'ABCDEF'[val];
    }
    if (typeof val === 'string') {
      const upper = val.trim().toUpperCase();
      if (upper.length === 1 && 'ABCDEF'.slice(0, maxOptions).includes(upper)) return upper;
    }
    return null;
  }

  function normalizeCardToken(val, cardsLength = 20) {
    if (typeof val === 'number' && Number.isInteger(val) && val >= 0 && val < cardsLength) {
      return `T${val + 1}`;
    }
    if (typeof val === 'string') {
      const m = /^T?(\d{1,2})$/i.exec(val.trim());
      if (m) {
        const idx = Number(m[1]);
        if (idx >= 1 && idx <= cardsLength) return `T${idx}`;
      }
    }
    return null;
  }

  function scoreQuestion(question, response) {
    if (!question || typeof question !== 'object') throw new TypeError('Invalid question');
    const points = question.points;
    if (typeof points !== 'number' || !Number.isFinite(points) || points <= 0) throw new TypeError('Invalid points');
    const max = roundScore(points);

    if (question.type === 'single') {
      if (!['A', 'B', 'C', 'D'].includes(question.answer)) throw new TypeError('Invalid answer key');
      const correct = typeof response === 'string' && response.trim().toUpperCase() === question.answer;
      return { score: correct ? max : 0, max, correct };
    }

    if (question.type === 'multiple') {
      const maxOpts = Array.isArray(question.options) && question.options.length >= 2 && question.options.length <= 6
        ? question.options.length
        : 6;
      const rawAnswers = Array.isArray(question.answers) ? question.answers : [];
      if (!rawAnswers.length || rawAnswers.length > maxOpts) throw new TypeError('Invalid multiple choice answer keys');
      const expectedSet = new Set();
      for (const item of rawAnswers) {
        const k = normalizeOptionKey(item, maxOpts);
        if (!k || expectedSet.has(k)) throw new TypeError('Invalid multiple choice answer keys');
        expectedSet.add(k);
      }
      const chosenRaw = Array.isArray(response) ? response : [];
      const chosenSet = new Set();
      let invalidSelection = false;
      for (const item of chosenRaw) {
        const k = normalizeOptionKey(item, maxOpts);
        if (!k) { invalidSelection = true; continue; }
        chosenSet.add(k);
      }
      let matched = 0;
      let wrongChosen = 0;
      for (const k of chosenSet) {
        if (expectedSet.has(k)) matched++;
        else wrongChosen++;
      }
      const totalParts = expectedSet.size;
      const correct = !invalidSelection && wrongChosen === 0 && matched === totalParts && chosenSet.size === totalParts;
      return {
        score: correct ? max : 0,
        max,
        correct,
        correctCount: matched,
        wrongCount: wrongChosen,
        totalParts
      };
    }

    if (question.type === 'true_false') {
      if (!Array.isArray(question.answers) || question.answers.length < 1 || question.answers.length > 5 || question.answers.some(x => typeof x !== 'boolean')) {
        throw new TypeError('Valid boolean answer keys required');
      }
      const m = question.answers.length;
      const weights = question.weights;
      if (
        !Array.isArray(weights) ||
        weights.length !== m + 1 ||
        weights.some(x => typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1) ||
        weights[0] !== 0 ||
        weights[m] !== 1 ||
        weights.some((x, i) => i > 0 && x < weights[i - 1])
      ) {
        throw new TypeError('Invalid scoring weights');
      }
      const choices = Array.isArray(response)
        ? response
        : (m === 1 && typeof response === 'boolean' ? [response] : []);
      const correctCount = question.answers.filter((a, i) => typeof choices[i] === 'boolean' && choices[i] === a).length;
      return {
        score: roundScore(points * weights[correctCount]),
        max,
        correct: correctCount === m,
        correctCount,
        totalParts: m
      };
    }

    if (question.type === 'short') {
      if (!Array.isArray(question.accepted) || !question.accepted.length || question.accepted.some(x => !normalize(x))) {
        throw new TypeError('Accepted answers required');
      }
      const answer = normalize(response);
      const correct = answer !== '' && question.accepted.some(x => normalize(x) === answer);
      return { score: correct ? max : 0, max, correct };
    }

    if (question.type === 'fill_blank') {
      const blanks = Array.isArray(question.blanks) ? question.blanks : [];
      if (!blanks.length || blanks.length > 10) throw new TypeError('Blanks definition required');
      const normalizedBlanks = blanks.map(b => {
        const list = Array.isArray(b) ? b : (b && Array.isArray(b.accepted) ? b.accepted : []);
        if (!list.length || list.some(x => !normalize(x))) throw new TypeError('Blank accepted answers required');
        return list.map(normalize);
      });
      const userArr = Array.isArray(response)
        ? response
        : (typeof response === 'string' && normalizedBlanks.length === 1
          ? [response]
          : (response && typeof response === 'object'
            ? normalizedBlanks.map((_, i) => response[i] ?? response[String(i + 1)] ?? '')
            : []));
      let correctCount = 0;
      for (let i = 0; i < normalizedBlanks.length; i++) {
        const val = normalize(userArr[i]);
        if (val !== '' && normalizedBlanks[i].includes(val)) correctCount++;
      }
      const totalParts = normalizedBlanks.length;
      const correct = correctCount === totalParts;
      return {
        score: correct ? max : 0,
        max,
        correct,
        correctCount,
        totalParts
      };
    }

    if (question.type === 'drag_drop') {
      const cards = Array.isArray(question.cards) ? question.cards : [];
      const rawExpected = Array.isArray(question.answer)
        ? question.answer
        : (Array.isArray(question.answers) ? question.answers : []);
      if (cards.length < 2 || cards.length > 15 || !rawExpected.length || rawExpected.length > cards.length) {
        throw new TypeError('Invalid drag_drop configuration');
      }
      const expectedTokens = rawExpected.map(item => normalizeCardToken(item, cards.length));
      if (expectedTokens.some(t => !t)) throw new TypeError('Invalid drag_drop answer key');
      const userRaw = Array.isArray(response)
        ? response
        : (response && typeof response === 'object'
          ? expectedTokens.map((_, i) => response[i] ?? response[String(i + 1)] ?? null)
          : []);
      const labelFor = token => String(cards[Number(token.slice(1)) - 1]).trim();
      const usedTokens = new Set();
      let correctCount = 0;
      for (let i = 0; i < expectedTokens.length; i++) {
        const userTok = normalizeCardToken(userRaw[i], cards.length);
        if (!userTok || usedTokens.has(userTok)) continue;
        usedTokens.add(userTok);
        if (labelFor(userTok) === labelFor(expectedTokens[i])) correctCount++;
      }
      const totalParts = expectedTokens.length;
      const correct = correctCount === totalParts;
      return {
        score: correct ? max : 0,
        max,
        correct,
        correctCount,
        totalParts
      };
    }

    throw new TypeError('Unsupported question type');
  }

  function grade(questions, responses) {
    if (!Array.isArray(questions) || !questions.length) throw new TypeError('Questions required');
    if (!responses || typeof responses !== 'object' || Array.isArray(responses)) throw new TypeError('Responses required');
    const ids = new Set();
    const results = questions.map(q => {
      if (typeof q.id !== 'string' || !q.id.trim() || ids.has(q.id)) throw new TypeError('Unique question IDs required');
      ids.add(q.id);
      return { id: q.id, ...scoreQuestion(q, Object.hasOwn(responses, q.id) ? responses[q.id] : undefined) };
    });
    return {
      score: roundScore(results.reduce((sum, item) => sum + item.score, 0)),
      max: roundScore(results.reduce((sum, item) => sum + item.max, 0)),
      results
    };
  }

  return { roundScore, normalize, scoreQuestion, grade };
});
