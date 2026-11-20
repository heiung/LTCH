'use strict';

// Preview only: persistence must use an atomic, authorized server transaction.
function planPromotion({ sourceYear, targetYear, classes, enrollments, destinations }) {
  if (typeof sourceYear !== 'string' || !sourceYear.trim() || typeof targetYear !== 'string' || !targetYear.trim() || sourceYear === targetYear) throw new TypeError('Distinct school years are required');
  if (!Array.isArray(classes) || !Array.isArray(enrollments) || !destinations || typeof destinations !== 'object' || Array.isArray(destinations)) throw new TypeError('Invalid promotion data');
  const classMap = new Map();
  for (const c of classes) {
    if (!c || typeof c.id !== 'string' || !c.id || classMap.has(c.id)) throw new TypeError('Unique class IDs are required');
    classMap.set(c.id, c);
  }
  const existing = new Set();
  for (const e of enrollments) {
    if (!e || typeof e.studentId !== 'string' || !e.studentId || typeof e.schoolYear !== 'string' || typeof e.classId !== 'string') throw new TypeError('Invalid enrollment');
    if (e.schoolYear === targetYear && e.status === 'active') existing.add(e.studentId);
  }
  const planned = new Set();
  const creates = [];
  const issues = [];
  for (const e of enrollments) {
    if (e.schoolYear !== sourceYear || e.status !== 'active') continue;
    const destinationId = Object.hasOwn(destinations, e.studentId) ? destinations[e.studentId] : undefined;
    const destination = classMap.get(destinationId);
    let reason = null;
    if (planned.has(e.studentId)) reason = 'duplicate_source';
    else if (existing.has(e.studentId)) reason = 'already_enrolled';
    else if (!destinationId) reason = 'destination_missing';
    else if (!destination || destination.schoolYear !== targetYear) reason = 'invalid_destination';
    planned.add(e.studentId);
    if (reason) issues.push({ studentId: e.studentId, reason });
    else creates.push({ studentId: e.studentId, schoolYear: targetYear, classId: destinationId, status: 'active' });
  }
  // Block the whole batch if any conflict exists; never mutate source records.
  return { canApply: issues.length === 0 && creates.length > 0, creates, issues };
}
module.exports = { planPromotion };
