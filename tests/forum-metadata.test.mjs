import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  FORUM_CATEGORIES,
  getForumCategoryMeta,
  normalizeForumSessionNumber,
  inferForumCategory,
  inferForumSessionNumber,
  encodeForumPostMeta,
  decodeForumPostMeta,
  encodeForumCommentMeta,
  decodeForumCommentMeta,
  deriveForumPostStatus,
  summarizeForumExcerpt,
  formatRelativeForumTimeVi,
  computeForumStats,
  sortAndFilterForumPosts
} from '../shared/forum-metadata.mjs';

test('FORUM_CATEGORIES exposes expected keys and fallback metadata', () => {
  assert.deepEqual(
    FORUM_CATEGORIES.map(c => c.key),
    ['homework', 'lesson', 'exam', 'tip', 'general']
  );
  assert.equal(getForumCategoryMeta('homework').pillLabel, 'Bài tập');
  assert.equal(getForumCategoryMeta('unknown-cat').key, 'general');
  assert.equal(normalizeForumSessionNumber('7'), 7);
  assert.equal(normalizeForumSessionNumber(0), null);
  assert.equal(normalizeForumSessionNumber(205), null);
});

test('encodeForumPostMeta & decodeForumPostMeta round-trip cleanly without nesting headers', () => {
  const encoded = encodeForumPostMeta({
    category: 'homework',
    sessionNumber: 12,
    pinned: true,
    resolved: true,
    acceptedCommentId: 'cm_99',
    locked: true,
    editedAt: 1731000500000,
    body: 'Cho phương trình $x^2 - 5x + 6 = 0$.\nGiải giúp em bước 2.'
  });
  assert.match(encoded, /^\[\[ltch-forum:/);

  // Re-encoding already encoded content should not nest headers
  const reEncoded = encodeForumPostMeta({
    category: 'exam',
    sessionNumber: 5,
    pinned: false,
    resolved: false,
    acceptedCommentId: null,
    locked: false,
    editedAt: 1731000900000,
    body: encoded
  });
  assert.equal((reEncoded.match(/\[\[ltch-forum:/g) || []).length, 1);

  const decoded = decodeForumPostMeta(reEncoded);
  assert.equal(decoded.hasExplicitMeta, true);
  assert.equal(decoded.category, 'exam');
  assert.equal(decoded.sessionNumber, 5);
  assert.equal(decoded.pinned, false);
  assert.equal(decoded.resolved, false);
  assert.equal(decoded.acceptedCommentId, null);
  assert.equal(decoded.locked, false);
  assert.equal(decoded.editedAt, 1731000900000);
  assert.equal(decoded.cleanBody, 'Cho phương trình $x^2 - 5x + 6 = 0$.\nGiải giúp em bước 2.');

  // Default plain metadata encodes as raw clean text without wrapper
  const plain = encodeForumPostMeta({ category: 'general', body: 'Thảo luận bình thường' });
  assert.equal(plain, 'Thảo luận bình thường');

  // Legacy inference when no header prefix exists
  const legacyHomework = decodeForumPostMeta('Em vướng câu 4 phiếu BTVN buổi 8 ạ', 'Hỏi BTVN buổi 8');
  assert.equal(legacyHomework.hasExplicitMeta, false);
  assert.equal(legacyHomework.category, 'homework');
  assert.equal(legacyHomework.sessionNumber, 8);
  assert.equal(inferForumCategory('Đề thi thử THPTQG số 3', 'Nhờ cô chấm giúp'), 'exam');
  assert.equal(inferForumSessionNumber('Tài liệu buổi 15', ''), 15);
});

test('encodeForumCommentMeta & decodeForumCommentMeta preserve clean text and editedAt', () => {
  assert.equal(encodeForumCommentMeta({ editedAt: null, body: 'Đáp án là 3' }), 'Đáp án là 3');
  const encoded = encodeForumCommentMeta({ editedAt: 1731000123456, body: 'Đáp án đã sửa: $x=2$' });
  assert.match(encoded, /^\[\[ltch-fcm:edited=1731000123456\]\]\n/);
  const reEncoded = encodeForumCommentMeta({ editedAt: 1731000999999, body: encoded });
  assert.equal((reEncoded.match(/\[\[ltch-fcm:/g) || []).length, 1);
  const decoded = decodeForumCommentMeta(reEncoded);
  assert.equal(decoded.hasExplicitMeta, true);
  assert.equal(decoded.editedAt, 1731000999999);
  assert.equal(decoded.cleanBody, 'Đáp án đã sửa: $x=2$');
});

test('deriveForumPostStatus maps states deterministically', () => {
  assert.equal(deriveForumPostStatus({ resolved: true }).key, 'solved');
  assert.equal(deriveForumPostStatus({ acceptedCommentId: 'cm-1' }).key, 'solved');
  assert.equal(deriveForumPostStatus({ hasStaffReply: true, commentCount: 1 }).key, 'staff_replied');
  assert.equal(deriveForumPostStatus({ commentCount: 2 }).key, 'discussing');
  assert.equal(deriveForumPostStatus({ locked: true }).key, 'locked');
  assert.equal(deriveForumPostStatus({}).key, 'waiting');
});

test('summarizeForumExcerpt never slices inside inline or display math delimiters', () => {
  const inlineText = 'Giải bất phương trình $x^2 - 4x + 3 \\le 0$ trên tập số thực để tìm nghiệm nguyên.';
  const shortInline = summarizeForumExcerpt(inlineText, 40);
  // Inline dollar formula spans indices ~22..44 so length 40 truncates cleanly BEFORE opening '$'
  assert.equal(shortInline.includes('$x^2'), false);
  assert.ok(shortInline.endsWith('…'));

  const parenMath = 'Tính giá trị biểu thức \\(\\int_{0}^{1} (3x^2 + 2x + 1)\\,dx\\) và suy ra kết quả cuối cùng.';
  const parenSummary = summarizeForumExcerpt(parenMath, 42);
  assert.equal((parenSummary.match(/\\\(/g) || []).length, (parenSummary.match(/\\\)/g) || []).length);

  const displayMath = 'Chứng minh bất đẳng thức sau đây cho mọi số thực dương \\[a^3 + b^3 + c^3 \\ge 3abc\\] rồi áp dụng.';
  const displaySummary = summarizeForumExcerpt(displayMath, 55);
  assert.equal((displaySummary.match(/\\\[/g) || []).length, (displaySummary.match(/\\\]/g) || []).length);

  const blockMathOnly = '$$\\sum_{k=1}^{n} k^2 = \\frac{n(n+1)(2n+1)}{6}$$ phần thuyết minh sau';
  const blockSummary = summarizeForumExcerpt(blockMathOnly, 40);
  assert.match(blockSummary, /^\$\$[\s\S]+\$\$/);
});

test('computeForumStats & sortAndFilterForumPosts compute metrics and filter accurately', () => {
  const now = 1_731_000_000_000;
  const posts = [
    {
      id: 'p-wait',
      author_uid: 'stu-1',
      author_name: 'Nguyễn Minh Anh',
      title: 'Hỏi bài hình học buổi 4',
      body: 'Em chưa hiểu định lý Ta-lét',
      category: 'homework',
      session_number: 4,
      pinned: false,
      resolved: false,
      has_staff_reply: false,
      locked: false,
      created_at: now - 10_000,
      latest_activity_at: now - 10_000
    },
    {
      id: 'p-solved',
      author_uid: 'stu-2',
      author_name: 'Trần Quốc Bảo',
      title: 'Cách giải nhanh bất phương trình',
      body: 'Đã có đáp án chi tiết',
      category: 'tip',
      session_number: 2,
      pinned: false,
      resolved: true,
      accepted_comment_id: 'cm-1',
      has_staff_reply: true,
      locked: false,
      created_at: now - 5_000,
      latest_activity_at: now - 1_000
    },
    {
      id: 'p-pin',
      author_uid: 'tea-1',
      author_name: 'Cô Hạnh',
      title: 'Quy ước nộp bài buổi 4',
      body: 'Các em chụp rõ bài làm',
      category: 'lesson',
      session_number: 4,
      pinned: true,
      resolved: false,
      has_staff_reply: true,
      locked: true,
      created_at: now - 50_000,
      latest_activity_at: now - 50_000
    }
  ];

  const stats = computeForumStats(posts, 'stu-1');
  assert.deepEqual(stats, {
    total: 3,
    waitingCount: 1,
    openCount: 2,
    solvedCount: 1,
    staffRepliedCount: 2,
    pinnedCount: 1,
    mineCount: 1,
    myOpenCount: 1,
    mySolvedCount: 0
  });

  // Pinned first regardless of activity time
  const defaultOrder = sortAndFilterForumPosts(posts, { sortBy: 'activity' });
  assert.deepEqual(defaultOrder.map(p => p.id), ['p-pin', 'p-solved', 'p-wait']);

  // Diacritic-insensitive search + category + sessionNumber filter
  const searched = sortAndFilterForumPosts(posts, {
    searchQuery: 'dinh ly ta-let',
    category: 'homework',
    sessionNumber: 4
  });
  assert.deepEqual(searched.map(p => p.id), ['p-wait']);

  // Status filter waiting vs solved vs mine
  assert.deepEqual(sortAndFilterForumPosts(posts, { statusFilter: 'waiting' }).map(p => p.id), ['p-wait']);
  assert.deepEqual(sortAndFilterForumPosts(posts, { statusFilter: 'solved' }).map(p => p.id), ['p-solved']);
  assert.deepEqual(sortAndFilterForumPosts(posts, { statusFilter: 'mine', currentUid: 'stu-1' }).map(p => p.id), ['p-wait']);

  assert.equal(formatRelativeForumTimeVi(now - 120_000, now), '2 phút trước');
  assert.equal(formatRelativeForumTimeVi(now - 86_400_000, now), 'Hôm qua');
});

test('Static CSP & stylesheet alignment: zero inline styles and key Forum 2.0 classes exist', async () => {
  const root = process.cwd();
  const [forumClient, appClient, css] = await Promise.all([
    fs.readFile(path.join(root, 'client', 'forum-workspace.mjs'), 'utf8'),
    fs.readFile(path.join(root, 'client', 'app.js'), 'utf8'),
    fs.readFile(path.join(root, 'public', 'app.css'), 'utf8')
  ]);

  for (const [label, src] of [['client/forum-workspace.mjs', forumClient], ['client/app.js', appClient]]) {
    assert.equal(/\bstyle\s*=/.test(src), false, `${label} must not emit inline style="..." attributes`);
    assert.equal(/\.style\./.test(src), false, `${label} must not mutate element .style properties`);
  }

  for (const cls of ['.forum-workspace-shell', '.forum-toolbar', '.forum-card', '.forum-thread-shell', '.forum-reply-card', '.ops-card.is-forum', '.badge-neutral']) {
    assert.ok(css.includes(cls), `public/app.css must define ${cls}`);
  }
});
