import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  sealVideoStreamTicket,
  openVideoStreamTicket,
  parseVideoByteRange,
  videoMedia,
  VIDEO_TICKET_LIFETIME_MS,
  MAX_VIDEO_CHUNK_BYTES
} from '../worker/video-stream.mjs';
import { lessons } from '../worker/lessons.mjs';
import { practiceSolutions } from '../worker/practice-solutions.mjs';
import { createWorker } from '../worker/index.mjs';

const TEST_ENV = {
  ALLOWED_ORIGIN: 'https://ltch.example.com',
  API_ORIGIN: 'https://api.ltch.example.com',
  SUPABASE_URL: 'https://your-project.supabase.co',
  SUPABASE_SECRET: 'test-supabase-secret-only',
  FIREBASE_API_KEY: 'test-firebase-api-key',
  MAIL_ENDPOINT: 'https://script.google.com/macros/s/test/exec',
  MAIL_SECRET: 'video-stream-test-secret-material-at-least-32-chars',
  LTCH_LESSONS_ENABLED: '1',
  LTCH_LESSONS_AUDIENCE: 'all',
  LTCH_DRIVE_LINK_PREVIEW: '1',
  GOOGLE_DRIVE_CLIENT_ID: 'cid',
  GOOGLE_DRIVE_CLIENT_SECRET: 'csecret',
  GOOGLE_DRIVE_REFRESH_TOKEN: 'rtoken'
};

function createMockDb(seed = {}) {
  const tables = {
    ltch_school_years: seed.years || [
      { id: 'y1', name: 'Năm học 2026 - 2027', starts_on: '2026-08-01', ends_on: '2027-06-30' }
    ],
    ltch_classes: seed.classes || [
      { id: 'c1', name: 'Lớp 12', grade: 12, school_year_id: 'y1', archived: false, schedule_slots: [] }
    ],
    ltch_lessons: seed.lessons || [
      { id: 'l1', class_id: 'c1', title: 'Buổi 1', topic: '' }
    ],
    ltch_lesson_files: seed.lessonFiles || [],
    ltch_practice_solutions: seed.practiceSolutions || [],
    ltch_practice_solution_files: seed.practiceSolutionFiles || [],
    ltch_exams: seed.exams || [],
    ltch_exam_year_shares: [],
    ltch_student_grade_history: [],
    ltch_drive_folders: []
  };

  return {
    tables,
    from(table) {
      const filters = [];
      return {
        select() {
          return this;
        },
        eq(k, v) {
          filters.push((row) => row[k] === v);
          return this;
        },
        in(k, vals) {
          const set = new Set(vals || []);
          filters.push((row) => set.has(row[k]));
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        async maybeSingle() {
          const rows = (tables[table] || []).filter((r) => filters.every((fn) => fn(r)));
          return { data: rows[0] || null, error: null };
        },
        then(resolve, reject) {
          const rows = (tables[table] || []).filter((r) => filters.every((fn) => fn(r)));
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        }
      };
    }
  };
}

function createMockDrive(filesMap) {
  return {
    async metadata({ id }) {
      const item = filesMap.get(id);
      if (!item) {
        const err = new Error('not_found');
        err.code = 'not_found';
        throw err;
      }
      return item;
    },
    async permissions({ id }) {
      const item = filesMap.get(id);
      return [
        { type: 'user', role: 'owner' },
        ...(item?.shared ? [{ type: 'anyone', role: 'reader', allowFileDiscovery: false }] : [])
      ];
    },
    async download({ id, range }) {
      const item = filesMap.get(id);
      if (!item) {
        const err = new Error('not_found');
        err.code = 'not_found';
        throw err;
      }
      const bytes = item.bytes;
      if (range) {
        const m = /^bytes=(\d+)-(\d+)$/.exec(range);
        const start = Number(m[1]);
        const end = Math.min(Number(m[2]), bytes.byteLength - 1);
        const slice = bytes.subarray(start, end + 1);
        return new Response(slice, {
          status: 206,
          headers: {
            'content-length': String(slice.byteLength),
            'content-range': `bytes ${start}-${end}/${bytes.byteLength}`
          }
        });
      }
      return new Response(bytes, {
        status: 200,
        headers: { 'content-length': String(bytes.byteLength) }
      });
    }
  };
}

test('sealVideoStreamTicket encrypts Drive file ID and rejects tampered, wrong-secret, or expired tickets', async () => {
  const now = 1_795_000_000_000;
  const ticket = await sealVideoStreamTicket(
    TEST_ENV,
    { uid: 'student-1', driveFileId: 'drive_secret_98765', mimeType: 'video/mp4', size: 724_774_184 },
    now
  );
  assert.match(ticket, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(ticket.includes('drive_secret_98765'), false);

  const opened = await openVideoStreamTicket(TEST_ENV, ticket, now + 5000);
  assert.equal(opened.uid, 'student-1');
  assert.equal(opened.driveFileId, 'drive_secret_98765');
  assert.equal(opened.mimeType, 'video/mp4');
  assert.equal(opened.size, 724_774_184);

  // Tamper ticket payload/tag
  const flipped = ticket.slice(0, -2) + (ticket.endsWith('AA') ? 'BB' : 'AA');
  await assert.rejects(openVideoStreamTicket(TEST_ENV, flipped, now), (err) => err.status === 403);

  // Wrong key
  await assert.rejects(
    openVideoStreamTicket({ ...TEST_ENV, MAIL_SECRET: 'other-secret-material-at-least-32-chars-long' }, ticket, now),
    (err) => err.status === 403
  );

  // Expired ticket
  await assert.rejects(
    openVideoStreamTicket(TEST_ENV, ticket, now + VIDEO_TICKET_LIFETIME_MS + 1000),
    (err) => err.status === 403
  );

  // Rejects non-video MIME or bad size
  await assert.rejects(
    sealVideoStreamTicket(TEST_ENV, { uid: 'student-1', driveFileId: 'drv1', mimeType: 'application/pdf', size: 100 }, now),
    (err) => err.status === 400
  );
  await assert.rejects(
    sealVideoStreamTicket(TEST_ENV, { uid: 'student-1', driveFileId: 'drv1', mimeType: 'video/mp4', size: 0 }, now),
    (err) => err.status === 400
  );
});

test('parseVideoByteRange enforces 8MB chunk cap, suffix/open ranges, and 416 rejections', () => {
  assert.deepEqual(parseVideoByteRange('bytes=0-', 20_000_000), {
    start: 0,
    end: MAX_VIDEO_CHUNK_BYTES - 1,
    header: `bytes=0-${MAX_VIDEO_CHUNK_BYTES - 1}`
  });
  assert.deepEqual(parseVideoByteRange('bytes=0-1', 20_000_000), {
    start: 0,
    end: 1,
    header: 'bytes=0-1'
  });
  assert.deepEqual(parseVideoByteRange('bytes=100-500', 1000), {
    start: 100,
    end: 500,
    header: 'bytes=100-500'
  });
  assert.deepEqual(parseVideoByteRange('bytes=-100', 1000), {
    start: 900,
    end: 999,
    header: 'bytes=900-999'
  });

  for (const invalid of ['bytes=1000-', 'bytes=500-100', 'bytes=0-1, 2-3', 'bytes=-', 'items=0-5']) {
    assert.throws(() => parseVideoByteRange(invalid, 1000), (err) => err.status === 416);
  }
});

test('lessons /stream and practiceSolutions /stream issue tickets with real Drive file size for >10MB videos and reject non-videos', async () => {
  const videoBytes = Uint8Array.from({ length: 64 }, (_, i) => i);
  const shaVideo = createHash('sha256').update(videoBytes).digest('hex');
  const pdfSha = 'b'.repeat(64);
  const bigSize = 724_774_184;

  const filesMap = new Map([
    [
      'drv_vid_big',
      {
        id: 'drv_vid_big',
        name: 'Bai-giang-lon.mp4',
        mimeType: 'video/mp4',
        size: String(bigSize),
        appProperties: { ltchSha256: shaVideo, ltchSize: String(bigSize) },
        trashed: false,
        ownedByMe: true,
        shared: true,
        parents: ['drv_folder_1'],
        bytes: videoBytes
      }
    ],
    [
      'drv_pdf_1',
      {
        id: 'drv_pdf_1',
        name: 'Tai-lieu.pdf',
        mimeType: 'application/pdf',
        size: '1024',
        appProperties: { ltchSha256: pdfSha },
        trashed: false,
        ownedByMe: true,
        shared: true,
        parents: ['drv_folder_1'],
        bytes: new Uint8Array(1024)
      }
    ],
    [
      'drv_psol_vid',
      {
        id: 'drv_psol_vid',
        name: 'Chua-de-1.mp4',
        mimeType: 'video/mp4',
        size: '987654321',
        appProperties: { ltchSha256: shaVideo, ltchSize: '987654321' },
        trashed: false,
        ownedByMe: true,
        shared: true,
        parents: ['drv_psol_folder'],
        bytes: videoBytes
      }
    ]
  ]);

  const db = createMockDb({
    lessonFiles: [
      {
        id: 'f_vid_big',
        lesson_id: 'l1',
        class_id: 'c1',
        name: 'Bai-giang-lon.mp4',
        drive_file_id: 'drv_vid_big',
        content_type: 'video/mp4',
        file_size: 10_000_000, // clamped in DB just like production resumable uploads
        sha256: shaVideo,
        status: 'stored'
      },
      {
        id: 'f_pdf_1',
        lesson_id: 'l1',
        class_id: 'c1',
        name: 'Tai-lieu.pdf',
        drive_file_id: 'drv_pdf_1',
        content_type: 'application/pdf',
        file_size: 1024,
        sha256: pdfSha,
        status: 'stored'
      }
    ],
    exams: [
      {
        id: 'ex_1',
        title: 'Đề thử 1',
        exam_type: 'thptqg',
        target_grade: 12,
        duration_minutes: 90,
        status: 'published',
        questions: [{ id: 'q1' }]
      }
    ],
    practiceSolutionFiles: [
      {
        id: 'psol_vid_1',
        exam_id: 'ex_1',
        file_kind: 'video',
        name: 'Chua-de-1.mp4',
        drive_file_id: 'drv_psol_vid',
        parent_folder_id: 'drv_psol_folder',
        content_type: 'video/mp4',
        file_size: 987_654_321,
        sha256: shaVideo,
        status: 'stored'
      }
    ]
  });

  const drive = createMockDrive(filesMap);
  const openDrive = async () => drive;
  const student = { uid: 'stu_1', status: 'active', roles: ['student'], memberships: [{ class_id: 'c1', member_role: 'student' }], childMemberships: [] };
  const outsider = { uid: 'out_1', status: 'active', roles: ['student'], memberships: [], childMemberships: [] };

  const streamPath = '/api/classes/c1/lessons/l1/files/f_vid_big/stream';
  const res = await lessons(new Request(`https://api.ltch.example.com${streamPath}`), streamPath, { db, actor: student, env: TEST_ENV, openDrive });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.size, bigSize);
  assert.equal(body.mimeType, 'video/mp4');
  const parsedUrl = new URL(body.url);
  assert.equal(parsedUrl.origin, 'https://api.ltch.example.com');
  assert.equal(parsedUrl.pathname, '/api/video-media');
  const decoded = await openVideoStreamTicket(TEST_ENV, parsedUrl.searchParams.get('ticket'));
  assert.equal(decoded.driveFileId, 'drv_vid_big');
  assert.equal(decoded.size, bigSize);

  // Rejects non-video file
  const pdfStreamPath = '/api/classes/c1/lessons/l1/files/f_pdf_1/stream';
  await assert.rejects(
    lessons(new Request(`https://api.ltch.example.com${pdfStreamPath}`), pdfStreamPath, { db, actor: student, env: TEST_ENV, openDrive }),
    (err) => err.status === 400
  );

  // Rejects unauthorized actor
  await assert.rejects(
    lessons(new Request(`https://api.ltch.example.com${streamPath}`), streamPath, { db, actor: outsider, env: TEST_ENV, openDrive }),
    (err) => err.status === 403
  );

  // Practice solutions /stream
  const psolStreamPath = '/api/practice/exams/ex_1/solutions/files/psol_vid_1/stream';
  const psolRes = await practiceSolutions(new Request(`https://api.ltch.example.com${psolStreamPath}`), psolStreamPath, {
    db,
    actor: student,
    env: TEST_ENV,
    openDrive
  });
  assert.equal(psolRes.status, 200);
  const psolJson = await psolRes.json();
  assert.equal(psolJson.size, 987_654_321);
  assert.match(psolJson.url, /^https:\/\/api\.ltch\.example\.com\/api\/video-media\?ticket=v1\./);
});

test('worker /api/video-media serves HEAD, 206 byte-range slices, 416 out-of-bounds, and enforces Origin', async () => {
  const sampleBytes = Uint8Array.from({ length: 256 }, (_, i) => i & 0xff);
  const mockDrive = createMockDrive(
    new Map([['drv_stream_test', { id: 'drv_stream_test', bytes: sampleBytes }]])
  );
  const worker = createWorker({ openDrive: async () => mockDrive });
  const ticket = await sealVideoStreamTicket(TEST_ENV, {
    uid: 'student-1',
    driveFileId: 'drv_stream_test',
    mimeType: 'video/mp4',
    size: sampleBytes.byteLength
  });
  const endpoint = `https://api.ltch.example.com/api/video-media?ticket=${encodeURIComponent(ticket)}`;

  // Disallowed origin rejected
  const badOrigin = await worker.fetch(new Request(endpoint, { headers: { origin: 'https://evil.example' } }), TEST_ENV);
  assert.equal(badOrigin.status, 403);

  // HEAD returns 200 with metadata
  const headRes = await worker.fetch(new Request(endpoint, { method: 'HEAD' }), TEST_ENV);
  assert.equal(headRes.status, 200);
  assert.equal(headRes.headers.get('accept-ranges'), 'bytes');
  assert.equal(headRes.headers.get('content-length'), '256');
  assert.equal(headRes.headers.get('content-type'), 'video/mp4');
  assert.equal(headRes.headers.get('cross-origin-resource-policy'), 'cross-origin');

  // GET with byte range returns 206 with exact slice
  const rangeRes = await worker.fetch(
    new Request(endpoint, { headers: { range: 'bytes=10-25', origin: 'https://ltch.example.com' } }),
    TEST_ENV
  );
  assert.equal(rangeRes.status, 206);
  assert.equal(rangeRes.headers.get('content-range'), 'bytes 10-25/256');
  assert.equal(rangeRes.headers.get('content-length'), '16');
  assert.equal(rangeRes.headers.get('access-control-allow-origin'), 'https://ltch.example.com');
  const sliced = new Uint8Array(await rangeRes.arrayBuffer());
  assert.deepEqual([...sliced], [...sampleBytes.subarray(10, 26)]);

  // Out-of-bounds range returns 416 with content-range */N
  const oobRes = await worker.fetch(new Request(endpoint, { headers: { range: 'bytes=999-' } }), TEST_ENV);
  assert.equal(oobRes.status, 416);
  assert.equal(oobRes.headers.get('content-range'), 'bytes */256');

  // Tampered ticket returns 403
  const badTicket = await worker.fetch(new Request('https://api.ltch.example.com/api/video-media?ticket=invalid'), TEST_ENV);
  assert.equal(badTicket.status, 403);
});

test('videoMedia rejects upstream 200 when a Range request was sent', async () => {
  const bytes = new Uint8Array(128);
  const brokenDrive = {
    async download() {
      return new Response(bytes, { status: 200, headers: { 'content-length': '128' } });
    }
  };
  const ticket = await sealVideoStreamTicket(TEST_ENV, {
    uid: 'student-1',
    driveFileId: 'drv_broken',
    mimeType: 'video/mp4',
    size: 128
  });
  await assert.rejects(
    videoMedia(new Request(`https://api.ltch.example.com/api/video-media?ticket=${ticket}`, { headers: { range: 'bytes=0-31' } }), {
      env: TEST_ENV,
      openDrive: async () => brokenDrive
    }),
    (err) => err.status === 503
  );
});
