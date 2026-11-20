import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  AI_SOURCE_MODES,
  EXAM_FORM_SPECS,
  buildAiExamPrompt,
  normalizeSchoolYearLabel
} from '../client/word-exam-ai-guide.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

async function readRepoFile(relPath) {
  return fs.readFile(path.join(ROOT_DIR, relPath), 'utf8');
}

test('normalizeSchoolYearLabel formats year IDs cleanly', () => {
  assert.equal(normalizeSchoolYearLabel('year-2026-2027'), '2026-2027');
  assert.equal(normalizeSchoolYearLabel('2026 - 2027'), '2026-2027');
  assert.equal(normalizeSchoolYearLabel(''), '2026-2027');
});

test('buildAiExamPrompt covers all 3 exam forms and 3 source modes accurately', () => {
  const expectedFiles = {
    thptqg: 'Mau_dang_tai_THPTQG.docx',
    hsa: 'Mau_dang_tai_HSA.docx',
    tsa: 'Mau_dang_tai_TSA.docx'
  };

  for (const examType of ['thptqg', 'hsa', 'tsa']) {
    for (const mode of AI_SOURCE_MODES) {
      const prompt = buildAiExamPrompt({
        examType,
        targetGrade: 11,
        schoolYear: 'year-2026-2027',
        examCode: '08',
        sourceMode: mode.id
      });

      assert.ok(prompt.includes(expectedFiles[examType]), `${examType}/${mode.id} must mention ${expectedFiles[examType]}`);
      assert.ok(prompt.includes('[BẮT ĐẦU ĐỀ]'), `${examType} prompt must require [BẮT ĐẦU ĐỀ]`);
      assert.ok(prompt.includes('[KẾT THÚC ĐỀ]'), `${examType} prompt must require [KẾT THÚC ĐỀ]`);
      assert.ok(prompt.includes(`[KỲ THI] ${EXAM_FORM_SPECS[examType].shortLabel}`), `${examType} prompt must set [KỲ THI]`);
      assert.ok(prompt.includes('[MÃ ĐỀ] 08'), `${examType} prompt must set [MÃ ĐỀ]`);
      assert.ok(prompt.includes('[TÊN ĐỀ]'), `${examType} prompt must set [TÊN ĐỀ]`);
      assert.ok(prompt.includes('[ĐÁP ÁN]'), `${examType} prompt must explain [ĐÁP ÁN]`);
      assert.ok(prompt.includes('[LỜI GIẢI]'), `${examType} prompt must explain [LỜI GIẢI]`);
      assert.ok(prompt.includes('$...$'), `${examType} prompt must mandate LaTeX $...$`);
      assert.ok(prompt.includes('Word Equation'), `${examType} prompt must forbid Word Equation`);
      assert.ok(prompt.includes('In Line with Text'), `${examType} prompt must specify In Line with Text images`);
      assert.ok(prompt.includes('[GHI CHÚ]'), `${examType} prompt must explain [GHI CHÚ] rule`);
      assert.ok(prompt.includes('sau [LỜI GIẢI]'), `${examType} prompt must place [GHI CHÚ] after [LỜI GIẢI]`);
      assert.ok(prompt.includes('.docx'), `${examType} prompt must request .docx output`);
      assert.ok(prompt.includes('Phương án dự phòng'), `${examType} prompt must include copy-paste fallback`);
    }
  }

  const thptqgPrompt = buildAiExamPrompt({ examType: 'thptqg', targetGrade: 11, schoolYear: 'year-2026-2027', examCode: '02' });
  assert.ok(thptqgPrompt.includes('[KHỐI] 11'));
  assert.ok(thptqgPrompt.includes('[NĂM HỌC] 2026-2027'));
  assert.ok(thptqgPrompt.includes('[PHẦN I]'));
  assert.ok(thptqgPrompt.includes('[PHẦN II]'));
  assert.ok(thptqgPrompt.includes('[PHẦN III]'));
  assert.ok(thptqgPrompt.includes('[Ý a]') && thptqgPrompt.includes('[Ý d]'));
  assert.ok(thptqgPrompt.includes('Đ S Đ Đ'));

  const hsaPrompt = buildAiExamPrompt({ examType: 'hsa', examCode: '05' });
  assert.ok(hsaPrompt.includes('[PHẦN 1]'));
  assert.ok(hsaPrompt.includes('[PHẦN 2]'));
  assert.ok(hsaPrompt.includes('[PHẦN 3]'));
  assert.ok(hsaPrompt.includes('[MÔN]'));
  assert.ok(hsaPrompt.includes('[NGỮ LIỆU]') && hsaPrompt.includes('[HẾT NGỮ LIỆU]'));
  assert.ok(hsaPrompt.includes('NGHIÊM CẤM') && hsaPrompt.includes('[Ý a]') && hsaPrompt.includes('[DẠNG]') && hsaPrompt.includes('[THẺ]'));

  const tsaPrompt = buildAiExamPrompt({ examType: 'tsa', examCode: '09' });
  assert.ok(tsaPrompt.includes('[DẠNG] NHIỀU ĐÁP ÁN'));
  assert.ok(tsaPrompt.includes('[DẠNG] ĐÚNG SAI'));
  assert.ok(tsaPrompt.includes('{{1}}'));
  assert.ok(tsaPrompt.includes('[THẺ]'));
  assert.ok(tsaPrompt.includes('(1) T4'));
});

test('buildAiExamPrompt avoids leaking stale title from another exam form when switching tabs', () => {
  const switchedToTsa = buildAiExamPrompt({
    examType: 'tsa',
    examCode: '03',
    schoolYear: 'year-2026-2027',
    title: '[LTCH] Đề thi thử THPTQG năm 2027 - Mã đề 03'
  });
  assert.ok(switchedToTsa.includes('[TÊN ĐỀ] [LTCH] Đề thi thử TSA năm 2027 - Mã đề 03'));
  assert.ok(!switchedToTsa.includes('[TÊN ĐỀ] [LTCH] Đề thi thử THPTQG'));

  const customTitle = buildAiExamPrompt({
    examType: 'tsa',
    examCode: '03',
    title: 'Đề luyện tổng hợp tuần 4'
  });
  assert.ok(customTitle.includes('[TÊN ĐỀ] Đề luyện tổng hợp tuần 4'));
});

test('word-exam-ai-guide.mjs obeys CSP (zero inline style) and matches CSS classes in public/app.css', async () => {
  const [guideSrc, appCss] = await Promise.all([
    readRepoFile('client/word-exam-ai-guide.mjs'),
    readRepoFile('public/app.css')
  ]);

  assert.doesNotMatch(guideSrc, /setAttribute\s*\(\s*['"]style['"]/i);
  assert.doesNotMatch(guideSrc, /\bstyle\s*=\s*["'][^"']*["']/i);

  const guideClasses = [...new Set([...guideSrc.matchAll(/ltch-[a-zA-Z0-9_-]+/g)].map((m) => m[0]))]
    .filter((c) => !c.endsWith('-'))
    .sort();
  const missingInCss = guideClasses.filter((c) => !appCss.includes(`.${c}`));
  assert.deepEqual(
    missingInCss,
    [],
    `All ${guideClasses.length} ltch-* classes in client/word-exam-ai-guide.mjs must be styled in public/app.css`
  );
});

test('practice-rooms.mjs integrates AI guide card and modal in single and bulk upload flows', async () => {
  const roomsSrc = await readRepoFile('client/practice-rooms.mjs');

  assert.match(roomsSrc, /from\s+['"]\.\/word-exam-ai-guide\.mjs['"]/);
  assert.match(roomsSrc, /createAiExamGuideCard\s*\(/);
  assert.match(roomsSrc, /openAiExamGuideModal\s*\(/);

  const bulkStart = roomsSrc.indexOf('function openBulkWordExamUploadModal(');
  assert.ok(bulkStart !== -1, 'Expected openBulkWordExamUploadModal');
  const bulkSlice = roomsSrc.slice(bulkStart, bulkStart + 18000);
  assert.ok(bulkSlice.includes('ltch-bulk-ai-guide-bar'), 'Bulk upload modal must include AI guide bar');
  assert.ok(bulkSlice.includes('openAiExamGuideModal('), 'Bulk upload modal must open AI guide modal');
  assert.ok(roomsSrc.includes('ltch-ai-btn-rec-pill'), 'Upload workspace must display Khuyên dùng pill on AI guide buttons');
  assert.ok(roomsSrc.includes('ltch-dropzone-methods-box'), 'Empty dropzone must describe the 2 upload methods');

  const guideSrc = await readRepoFile('client/word-exam-ai-guide.mjs');
  assert.ok(guideSrc.includes('ltch-ai-recommended-badge'), 'AI guide card and modal must display Khuyên dùng badge');
  assert.ok(guideSrc.includes('Khuyên dùng'), 'AI guide must contain Khuyên dùng label');
});
