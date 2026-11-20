const test = require('node:test');
const assert = require('node:assert/strict');
const { planPromotion } = require('../server/domain/promotion.cjs');

test('previews promotion without changing prior-year records', () => {
  const enrollments = [{ studentId: 's1', classId: '9a', schoolYear: '2025', status: 'active' }];
  const plan = planPromotion({ sourceYear: '2025', targetYear: '2026', classes: [{ id: '10a', schoolYear: '2026' }], enrollments, destinations: { s1: '10a' } });
  assert.equal(plan.canApply, true);
  assert.deepEqual(plan.creates[0], { studentId: 's1', classId: '10a', schoolYear: '2026', status: 'active' });
  assert.equal(enrollments[0].classId, '9a');
});
test('blocks entire batch when there are missing or duplicate enrollments', () => {
  const enrollments = [{ studentId: 's1', classId: '9a', schoolYear: '2025', status: 'active' }, { studentId: 's2', classId: '9a', schoolYear: '2025', status: 'active' }, { studentId: 's1', classId: '10a', schoolYear: '2026', status: 'active' }];
  const plan = planPromotion({ sourceYear: '2025', targetYear: '2026', classes: [{ id: '10a', schoolYear: '2026' }], enrollments, destinations: { s1: '10a' } });
  assert.equal(plan.canApply, false);
  assert.deepEqual(plan.issues.map(x => x.reason), ['already_enrolled', 'destination_missing']);
});
