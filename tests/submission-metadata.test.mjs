import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  normalizeSubmissionMimeType,
  sanitizeSubmissionFileName,
  encodeLegacySubmissionFeedback,
  decodeSubmissionRecord,
  toPublicSubmission
} from '../shared/submission-metadata.mjs';
import { createSupabaseRepository } from '../worker/supabase-repository.mjs';

test('normalizeSubmissionMimeType normalizes jpg, webp, pdf, and extension fallbacks', () => {
  assert.equal(normalizeSubmissionMimeType('image/jpg; charset=utf-8'), 'image/jpeg');
  assert.equal(normalizeSubmissionMimeType('image/webp'), 'image/webp');
  assert.equal(normalizeSubmissionMimeType('application/octet-stream', 'bai_1.png'), 'image/png');
  assert.equal(normalizeSubmissionMimeType('', 'de_thi.PDF'), 'application/pdf');
  assert.equal(normalizeSubmissionMimeType('text/html', 'bad.html'), null);
});

test('legacy feedback sentinel preserves multi-file metadata and student note without leaking object_path', () => {
  const files = [
    { name: 'trang-1.jpg', contentType: 'image/jpeg', size: 1200, objectPath: 'drive:id-1' },
    { name: 'trang-2.png', contentType: 'image/png', size: 2400, objectPath: 'drive:id-2' }
  ];
  const encoded = encodeLegacySubmissionFeedback({
    feedback: 'Bài làm tốt, chữ rõ.',
    note: 'Em làm câu 1-5 ở trang 1, câu 6 ở trang 2.',
    files
  });
  const decoded = decodeSubmissionRecord({
    id: 'sub-1',
    assignment_id: 'asn-1',
    uid: 'stu-1',
    status: 'stored',
    created_at: 1000,
    stored_at: 1001,
    file_size: 3600,
    content_type: 'image/jpeg',
    object_path: 'drive:id-1',
    feedback: encoded
  });

  assert.equal(decoded.hasLegacyMeta, true);
  assert.equal(decoded.feedback, 'Bài làm tốt, chữ rõ.');
  assert.equal(decoded.note, 'Em làm câu 1-5 ở trang 1, câu 6 ở trang 2.');
  assert.equal(decoded.files.length, 2);
  assert.equal(decoded.files[1].objectPath, 'drive:id-2');

  const pub = toPublicSubmission({
    id: 'sub-1',
    assignment_id: 'asn-1',
    uid: 'stu-1',
    status: 'stored',
    created_at: 1000,
    stored_at: 1001,
    file_size: 3600,
    content_type: 'image/jpeg',
    object_path: 'drive:id-1',
    feedback: encoded
  });
  assert.equal(pub.note, 'Em làm câu 1-5 ở trang 1, câu 6 ở trang 2.');
  assert.equal(pub.feedback, 'Bài làm tốt, chữ rõ.');
  assert.equal(pub.file_count, 2);
  assert.equal('object_path' in pub, false);
  assert.equal('objectPath' in pub.files[0], false);
  assert.equal(sanitizeSubmissionFileName('a/b\\c\n?.jpg', 'jpg', 0), 'a b c ?.jpg');
});

test('supabase repository markStored falls back seamlessly when legacy DB lacks student_note/files columns', async () => {
  const calls = [];
  const fakeDb = {
    from() {
      return {
        update(patch) {
          calls.push(patch);
          return {
            eq() { return this; },
            select() {
              if ('student_note' in patch || 'files' in patch) {
                return Promise.resolve({
                  data: null,
                  error: { code: '42703', message: 'column "student_note" of relation "ltch_submissions" does not exist' }
                });
              }
              return Promise.resolve({ data: [{ id: 'sub-1' }], error: null });
            }
          };
        }
      };
    }
  };
  const repo = createSupabaseRepository(fakeDb);
  await repo.markStored('sub-1', {
    size: 2048,
    contentType: 'image/png',
    storedAt: 5000,
    objectPath: 'drive:f1',
    note: 'Ghi chú học sinh test',
    files: [
      { name: 'p1.png', contentType: 'image/png', size: 1024, objectPath: 'drive:f1' },
      { name: 'p2.jpg', contentType: 'image/jpeg', size: 1024, objectPath: 'drive:f2' }
    ]
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].student_note, 'Ghi chú học sinh test');
  assert.equal(calls[1].object_path, 'drive:f1');
  const decoded = decodeSubmissionRecord({ feedback: calls[1].feedback });
  assert.equal(decoded.note, 'Ghi chú học sinh test');
  assert.equal(decoded.files.length, 2);
});

test('assignment split workspace UI & CSS keep left-submit right-viewer layout and zero inline styles', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const [clientJs, sharedJs, css] = await Promise.all([
    fs.readFile(path.join(root, 'client/app.js'), 'utf8'),
    fs.readFile(path.join(root, 'shared/submission-metadata.mjs'), 'utf8'),
    fs.readFile(path.join(root, 'public/app.css'), 'utf8')
  ]);

  assert.doesNotMatch(clientJs, /\bstyle\s*=\s*["'][^"']*["']/i);
  assert.doesNotMatch(sharedJs, /\bstyle\s*=\s*["'][^"']*["']/i);
  assert.match(clientJs, /class:\s*'assignment-split-workspace'/);
  assert.match(clientJs, /class:\s*'assignment-split-left'/);
  assert.match(clientJs, /class:\s*'assignment-split-right'/);
  assert.match(clientJs, /session-doc-selector-bar is-below-viewer/);
  assert.match(clientJs, /el\('div',\s*\{class:\s*'assignment-split-doc-pane'\},\s*docMountBox,\s*docSelectorRow\)/);
  assert.match(css, /@media\s*\(min-width:\s*1025px\)\s*\{[\s\S]*?\.assignment-split-workspace\s*\{[^}]*grid-template-columns:/);
  assert.match(css, /\.submission-selected-grid\s*\{/);
  assert.match(css, /\.submission-student-note\s*\{/);
  assert.match(css, /dialog#editor:has\(\.submission-gallery-modal\)/);
  assert.match(css, /\.pdf-pill-center\s*\{/);
  assert.match(css, /\.ltch-pdf-type-badge\s*\{/);
  assert.match(css, /\.ltch-pdf-doc-title\s*\{/);
  assert.match(css, /\.session-doc-selector-bar\.is-below-viewer\s*\{/);
});
