import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubmissionHandler } from '../worker/submission-handler.mjs';

const pdfBytes = new Uint8Array([37, 80, 68, 70, 45]);
const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const jpgBytes = new Uint8Array([255, 216, 255, 224, 0, 16]);
const webpBytes = new Uint8Array([82, 73, 70, 70, 12, 0, 0, 0, 87, 69, 66, 80]);

function setup({ session = true, member = true, uploadFails = false, failOnCall = 0 } = {}) {
  const uploads = [];
  const trashed = [];
  let storedPayload = null;
  let failedId = null;

  const actor = {
    uid: 'student',
    name: 'Học sinh Test',
    roles: ['student'],
    memberships: member ? [{ class_id: 'class1', member_role: 'student' }] : []
  };
  const repository = {
    actor: async () => actor,
    getAssignment: async () => ({ classId: 'class1', status: 'published', opensAt: 1, closesAt: 200 }),
    reserve: async () => true,
    markStored: async (_id, data) => {
      storedPayload = data;
    },
    markFailed: async id => {
      failedId = id;
    }
  };
  const handle = createSubmissionHandler({
    auth: { authenticate: async () => (session ? { uid: 'student' } : null) },
    repository,
    storage: {
      upload: async params => {
        if (uploadFails || (failOnCall && uploads.length + 1 >= failOnCall)) {
          throw new Error('storage error');
        }
        const objectPath = `drive:drv-${uploads.length + 1}`;
        uploads.push({
          contentType: params.contentType,
          fileName: params.fileName,
          fileIndex: params.fileIndex,
          fileCount: params.fileCount,
          size: params.bytes.byteLength,
          objectPath
        });
        return { size: params.bytes.byteLength, objectPath };
      },
      trash: async ({ objectPaths }) => {
        trashed.push(...objectPaths);
      }
    },
    clock: () => 100
  });
  const request = () =>
    new Request('https://example.test', {
      method: 'POST',
      headers: { 'content-type': 'application/pdf' },
      body: pdfBytes
    });
  return {
    handle,
    request,
    getUploads: () => uploads.length,
    getUploadRecords: () => uploads,
    getTrashed: () => trashed,
    getStoredPayload: () => storedPayload,
    getFailedId: () => failedId
  };
}

test('upload requires an OTP session and student membership in the assigned class', async () => {
  const a = setup({ session: false });
  assert.equal((await a.handle(a.request(), 'a1')).status, 401);
  assert.equal(a.getUploads(), 0);
  const b = setup({ member: false });
  assert.equal((await b.handle(b.request(), 'a1')).status, 403);
  assert.equal(b.getUploads(), 0);
  const c = setup();
  assert.equal((await c.handle(c.request(), 'a1')).status, 201);
  assert.equal(c.getUploads(), 1);
  const d = setup({ uploadFails: true });
  assert.equal((await d.handle(d.request(), 'a1')).status, 400);
});

test('multipart submission supports multiple small images, note, validation, and rollback', async () => {
  const ctx = setup();
  const fd = new FormData();
  fd.append('files', new Blob([jpgBytes], { type: 'image/jpeg' }), 'trang-1.jpg');
  fd.append('files', new Blob([pngBytes], { type: 'image/png' }), 'trang-2.png');
  fd.append('files', new Blob([webpBytes], { type: 'image/webp' }), 'trang-3.webp');
  fd.append('note', 'Em nộp 3 ảnh bài giải câu 20-35.');

  const res = await ctx.handle(
    new Request('https://example.test/api/assignments/a1/submissions', { method: 'POST', body: fd }),
    'a1'
  );
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.status, 'submitted');
  assert.equal(body.fileCount, 3);
  assert.equal(body.note, 'Em nộp 3 ảnh bài giải câu 20-35.');
  assert.deepEqual(
    body.files.map(f => f.name),
    ['trang-1.jpg', 'trang-2.png', 'trang-3.webp']
  );

  const records = ctx.getUploadRecords();
  assert.equal(records.length, 3);
  assert.equal(records[0].fileIndex, 0);
  assert.equal(records[1].fileIndex, 1);
  assert.equal(records[2].fileIndex, 2);
  assert.equal(records[2].fileCount, 3);

  const stored = ctx.getStoredPayload();
  assert.equal(stored.note, 'Em nộp 3 ảnh bài giải câu 20-35.');
  assert.equal(stored.files.length, 3);

  // Empty multipart submission -> 400
  const emptyFd = new FormData();
  emptyFd.append('note', 'Không có file');
  const emptyRes = await ctx.handle(
    new Request('https://example.test/api/assignments/a1/submissions', { method: 'POST', body: emptyFd }),
    'a1'
  );
  assert.equal(emptyRes.status, 400);

  // Unsupported extension/mime -> 400
  const badFd = new FormData();
  badFd.append('files', new Blob([new Uint8Array([1, 2, 3])], { type: 'application/x-msdownload' }), 'bad.exe');
  const badRes = await ctx.handle(
    new Request('https://example.test/api/assignments/a1/submissions', { method: 'POST', body: badFd }),
    'a1'
  );
  assert.equal(badRes.status, 400);

  // Too many files (>12) -> 400
  const manyFd = new FormData();
  for (let i = 0; i < 13; i++) {
    manyFd.append('files', new Blob([pngBytes], { type: 'image/png' }), `img-${i}.png`);
  }
  const manyRes = await ctx.handle(
    new Request('https://example.test/api/assignments/a1/submissions', { method: 'POST', body: manyFd }),
    'a1'
  );
  assert.equal(manyRes.status, 400);

  // Partial upload failure trashes earlier files and marks submission failed
  const partialCtx = setup({ failOnCall: 2 });
  const partialFd = new FormData();
  partialFd.append('files', new Blob([pngBytes], { type: 'image/png' }), 'ok-1.png');
  partialFd.append('files', new Blob([pngBytes], { type: 'image/png' }), 'fail-2.png');
  const partialRes = await partialCtx.handle(
    new Request('https://example.test/api/assignments/a1/submissions', { method: 'POST', body: partialFd }),
    'a1'
  );
  assert.equal(partialRes.status, 400);
  assert.ok(partialCtx.getFailedId(), 'expected markFailed to be called');
  assert.deepEqual(partialCtx.getTrashed(), ['drive:drv-1']);
});
