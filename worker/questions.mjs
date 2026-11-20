import engine from '../public/practice-engine.js';
import {demand,string} from './policy.mjs';

export const HSA_SCIENCE_SUBJECTS = ['physics', 'chemistry', 'biology', 'history', 'geography'];
export const HSA_ALL_PART3_SUBJECTS = [...HSA_SCIENCE_SUBJECTS, 'english'];

export const HSA_COMBINATIONS = [
  { code: 'Q01', name: 'Vật lí · Hóa học · Sinh học', subjects: ['physics', 'chemistry', 'biology'] },
  { code: 'Q02', name: 'Vật lí · Hóa học · Lịch sử', subjects: ['physics', 'chemistry', 'history'] },
  { code: 'Q03', name: 'Vật lí · Hóa học · Địa lí', subjects: ['physics', 'chemistry', 'geography'] },
  { code: 'Q04', name: 'Vật lí · Sinh học · Lịch sử', subjects: ['physics', 'biology', 'history'] },
  { code: 'Q05', name: 'Vật lí · Sinh học · Địa lí', subjects: ['physics', 'biology', 'geography'] },
  { code: 'Q06', name: 'Vật lí · Lịch sử · Địa lí', subjects: ['physics', 'history', 'geography'] },
  { code: 'Q07', name: 'Hóa học · Sinh học · Lịch sử', subjects: ['chemistry', 'biology', 'history'] },
  { code: 'Q08', name: 'Hóa học · Sinh học · Địa lí', subjects: ['chemistry', 'biology', 'geography'] },
  { code: 'Q09', name: 'Hóa học · Lịch sử · Địa lí', subjects: ['chemistry', 'history', 'geography'] },
  { code: 'Q10', name: 'Sinh học · Lịch sử · Địa lí', subjects: ['biology', 'history', 'geography'] },
  { code: 'english', name: 'Tiếng Anh', subjects: ['english'] }
];

function sanitizeMediaList(media) {
  if (!Array.isArray(media) || !media.length) return undefined;
  demand(media.length <= 20, 400, 'Mỗi câu hỏi tối đa 20 hình ảnh.');
  return media.map(m => {
    demand(m && typeof m === 'object', 400, 'Thông tin hình ảnh không hợp lệ.');
    const item = {
      id: string(String(m.id || ''), 128)
    };
    if (typeof m.path === 'string' && m.path.trim()) item.path = string(m.path, 400);
    if (typeof m.dataUrl === 'string' && /^data:image\/(png|jpeg|jpg|gif|webp);base64,/i.test(m.dataUrl)) {
      demand(m.dataUrl.length <= 3_000_000, 400, 'Ảnh đính kèm vượt quá dung lượng cho phép.');
      item.dataUrl = m.dataUrl.replace(/^data:image\/jpg;base64,/i, 'data:image/jpeg;base64,');
    }
    if (typeof m.driveFileId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(m.driveFileId)) {
      item.driveFileId = m.driveFileId;
    }
    if (typeof m.mimeType === 'string') {
      const normMime = m.mimeType.trim().toLowerCase() === 'image/jpg' ? 'image/jpeg' : m.mimeType.trim().toLowerCase();
      if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(normMime)) {
        item.mimeType = normMime;
      }
    }
    if (Number.isSafeInteger(Number(m.size)) && Number(m.size) > 0 && Number(m.size) <= 10_000_000) {
      item.size = Number(m.size);
    }
    if (typeof m.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(m.sha256)) {
      item.sha256 = m.sha256.toLowerCase();
    }
    if (Number.isFinite(Number(m.width)) && Number(m.width) > 0) item.width = Math.round(Number(m.width));
    if (Number.isFinite(Number(m.height)) && Number(m.height) > 0) item.height = Math.round(Number(m.height));
    if (m.inSolution) item.inSolution = true;
    return item;
  });
}

export function validateQuestions(questions, options = {}) {
  const examType = options.examType || 'class';
  demand(Array.isArray(questions) && questions.length > 0 && questions.length <= 300, 400, 'Đề cần từ 1 đến 300 câu.');

  const normalized = questions.map((q, idx) => {
    demand(q && typeof q === 'object', 400, `Câu ${idx + 1} không hợp lệ.`);
    const qId = string(String(q.id || `q_${idx + 1}`), 128);
    const type = q.type;
    demand(['single', 'multiple', 'true_false', 'short', 'fill_blank', 'drag_drop'].includes(type), 400, `Dạng câu hỏi "${type}" không hợp lệ.`);

    if (examType === 'hsa') {
      demand(['single', 'short'].includes(type), 400, 'Đề HSA chỉ cho phép câu trắc nghiệm 4 lựa chọn hoặc điền đáp án ngắn.');
    } else if (examType === 'thptqg') {
      demand(['single', 'true_false', 'short'].includes(type), 400, 'Đề THPTQG chỉ gồm 3 dạng: Trắc nghiệm 4 lựa chọn, Đúng/Sai 4 ý và Trả lời ngắn.');
    }

    const defaultPoints = examType === 'thptqg'
      ? (type === 'single' ? 0.25 : type === 'true_false' ? 1.0 : 0.5)
      : (examType === 'hsa' || examType === 'tsa' ? 1.0 : Number(q.points));
    const points = Number.isFinite(Number(q.points)) && Number(q.points) > 0 ? Number(q.points) : defaultPoints;
    demand(Number.isFinite(points) && points > 0 && points <= 100, 400, 'Điểm câu hỏi không hợp lệ.');

    const base = {
      id: qId,
      type,
      prompt: string(q.prompt, 20000),
      points,
      solution: string(q.solution || '', 20000, true)
    };

    if (typeof q.section === 'string' && q.section.trim()) base.section = q.section.trim().slice(0, 32);
    if (typeof q.subject === 'string' && q.subject.trim()) base.subject = q.subject.trim().slice(0, 32);
    if (typeof q.clusterId === 'string' && q.clusterId.trim()) base.clusterId = q.clusterId.trim().slice(0, 64);
    if (typeof q.passageId === 'string' && q.passageId.trim()) base.passageId = q.passageId.trim().slice(0, 64);
    if (typeof q.passageContent === 'string' && q.passageContent.trim()) base.passageContent = string(q.passageContent, 30000, true);
    if (Array.isArray(q.passageMedia) && q.passageMedia.length) base.passageMedia = sanitizeMediaList(q.passageMedia);
    if (typeof q.questionCode === 'string' && q.questionCode.trim()) base.questionCode = q.questionCode.trim().slice(0, 32);
    if (Number.isInteger(q.version) && q.version >= 1) base.version = q.version;
    if (Number.isInteger(q.order) && q.order >= 1) base.order = q.order;

    const media = sanitizeMediaList(q.media);
    if (media) base.media = media;

    if (type === 'single') {
      const choices = q.options;
      demand(Array.isArray(choices) && choices.length === 4 && choices.every(x => typeof x === 'string' && x.trim() && x.length <= 10000), 400, 'Mỗi câu trắc nghiệm 1 đáp án cần đủ 4 lựa chọn A, B, C, D.');
      const ans = typeof q.answer === 'string' ? q.answer.trim().toUpperCase() : '';
      demand(['A', 'B', 'C', 'D'].includes(ans), 400, 'Đáp án trắc nghiệm phải là A, B, C hoặc D.');
      return { ...base, options: choices.map(x => x.trim()), answer: ans };
    }

    if (type === 'multiple') {
      const choices = q.options;
      demand(Array.isArray(choices) && choices.length >= 2 && choices.length <= 6 && choices.every(x => typeof x === 'string' && x.trim() && x.length <= 10000), 400, 'Câu chọn nhiều đáp án cần từ 2 đến 6 lựa chọn.');
      const rawAns = Array.isArray(q.answers) ? q.answers : [];
      demand(rawAns.length >= 1 && rawAns.length <= choices.length, 400, 'Cần chọn ít nhất 1 đáp án đúng cho câu nhiều lựa chọn.');
      const letters = 'ABCDEF'.slice(0, choices.length);
      const ansSet = new Set();
      for (const item of rawAns) {
        const letter = typeof item === 'number' && Number.isInteger(item) && item >= 0 && item < choices.length
          ? letters[item]
          : (typeof item === 'string' ? item.trim().toUpperCase() : '');
        demand(letter.length === 1 && letters.includes(letter) && !ansSet.has(letter), 400, 'Đáp án câu nhiều lựa chọn không hợp lệ.');
        ansSet.add(letter);
      }
      return { ...base, options: choices.map(x => x.trim()), answers: [...ansSet] };
    }

    if (type === 'true_false') {
      const statements = Array.isArray(q.statements) && q.statements.length
        ? q.statements
        : (examType === 'tsa' && Array.isArray(q.answers) && q.answers.length === 1 ? [base.prompt] : []);
      const minSt = examType === 'tsa' ? 1 : 4;
      const maxSt = examType === 'tsa' ? 5 : 4;
      demand(
        Array.isArray(statements) &&
        statements.length >= minSt &&
        statements.length <= maxSt &&
        statements.every(x => typeof x === 'string' && x.trim() && x.length <= 10000),
        400,
        examType === 'tsa' ? 'Câu Đúng/Sai TSA cần từ 1 đến 5 mệnh đề.' : 'Mỗi câu需要 đủ bốn lựa chọn hoặc mệnh đề.'
      );
      const m = statements.length;
      demand(Array.isArray(q.answers) && q.answers.length === m && q.answers.every(x => typeof x === 'boolean'), 400, 'Đáp án Đúng/Sai không khớp số mệnh đề.');
      const defaultWeights = examType === 'tsa'
        ? [...Array(m).fill(0), 1]
        : (m === 4 ? [0, 0.1, 0.25, 0.5, 1] : [...Array(m).fill(0), 1]);
      const weights = Array.isArray(q.weights) ? q.weights : defaultWeights;
      return {
        ...base,
        statements: statements.map(x => x.trim()),
        answers: q.answers,
        weights
      };
    }

    if (type === 'short') {
      demand(Array.isArray(q.accepted) && q.accepted.length >= 1 && q.accepted.length <= 50 && q.accepted.every(a => typeof a === 'string' && a.trim() && a.length <= 200), 400, 'Đáp án ngắn không hợp lệ.');
      return { ...base, accepted: q.accepted.map(a => a.trim()) };
    }

    if (type === 'fill_blank') {
      demand(Array.isArray(q.blanks) && q.blanks.length >= 1 && q.blanks.length <= 10, 400, 'Câu điền khuyết cần từ 1 đến 10 ô trống.');
      const blanks = q.blanks.map((b, bIdx) => {
        const list = Array.isArray(b) ? b : (b && Array.isArray(b.accepted) ? b.accepted : []);
        demand(list.length >= 1 && list.length <= 30 && list.every(a => typeof a === 'string' && a.trim() && a.length <= 200), 400, `Đáp án ô trống (${bIdx + 1}) không hợp lệ.`);
        const kind = b && b.kind === 'text' ? 'text' : 'number';
        return { accepted: list.map(a => a.trim()), kind };
      });
      return { ...base, blanks };
    }

    if (type === 'drag_drop') {
      const cards = q.cards;
      demand(Array.isArray(cards) && cards.length >= 2 && cards.length <= 15 && cards.every(c => typeof c === 'string' && c.trim() && c.length <= 2000), 400, 'Câu kéo thả cần từ 2 đến 15 thẻ đáp án.');
      const rawAns = Array.isArray(q.answer) ? q.answer : (Array.isArray(q.answers) ? q.answers : []);
      demand(rawAns.length >= 1 && rawAns.length <= cards.length, 400, 'Đáp án kéo thả không hợp lệ.');
      const normalizedAns = rawAns.map(tok => {
        if (typeof tok === 'number' && Number.isInteger(tok) && tok >= 0 && tok < cards.length) return `T${tok + 1}`;
        if (typeof tok === 'string') {
          const m = /^T?(\d{1,2})$/i.exec(tok.trim());
          if (m && Number(m[1]) >= 1 && Number(m[1]) <= cards.length) return `T${Number(m[1])}`;
        }
        demand(false, 400, 'Mã thẻ đáp án kéo thả không tồn tại.');
      });
      return { ...base, cards: cards.map(c => c.trim()), answer: normalizedAns };
    }
  });

  try {
    engine.grade(normalized, {});
  } catch (err) {
    throw demand(false, 400, err.message || 'Cấu trúc câu hỏi hoặc đáp án không hợp lệ.');
  }

  return normalized;
}

export function projectVisibleQuestion(q) {
  if (!q || typeof q.id !== 'string' || typeof q.prompt !== 'string' || q.prompt.length > 20000) {
    throw new TypeError('Invalid question');
  }
  const visible = {
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    points: q.points
  };
  if (q.questionCode) visible.questionCode = q.questionCode;
  if (q.version) visible.version = q.version;
  if (q.section) visible.section = q.section;
  if (q.subject) visible.subject = q.subject;
  if (q.clusterId) visible.clusterId = q.clusterId;
  if (q.passageId) visible.passageId = q.passageId;
  if (q.passageContent) visible.passageContent = q.passageContent;
  if (q.passageMedia) visible.passageMedia = q.passageMedia;
  if (Array.isArray(q.media) && q.media.length) {
    const publicMedia = q.media.filter(m => !m?.inSolution);
    if (publicMedia.length) visible.media = publicMedia;
  }

  if (q.type === 'single' || q.type === 'multiple') {
    const items = q.options;
    const minLen = q.type === 'single' ? 4 : 2;
    const maxLen = q.type === 'single' ? 4 : 6;
    if (!Array.isArray(items) || items.length < minLen || items.length > maxLen || items.some(x => typeof x !== 'string' || x.length > 10000)) {
      throw new TypeError('Invalid choices');
    }
    visible.options = [...items];
    return visible;
  }
  if (q.type === 'true_false') {
    const items = q.statements;
    if (!Array.isArray(items) || items.length < 1 || items.length > 5 || items.some(x => typeof x !== 'string' || x.length > 10000)) {
      throw new TypeError('Invalid choices');
    }
    visible.statements = [...items];
    return visible;
  }
  if (q.type === 'short') {
    return visible;
  }
  if (q.type === 'fill_blank') {
    const blanks = Array.isArray(q.blanks) ? q.blanks : [];
    if (!blanks.length || blanks.length > 10) throw new TypeError('Invalid blanks');
    visible.blankCount = blanks.length;
    return visible;
  }
  if (q.type === 'drag_drop') {
    const cards = Array.isArray(q.cards) ? q.cards : [];
    const ans = Array.isArray(q.answer) ? q.answer : (Array.isArray(q.answers) ? q.answers : []);
    if (cards.length < 2 || cards.length > 15 || !ans.length) throw new TypeError('Invalid drag_drop cards');
    visible.cards = [...cards];
    visible.slotCount = ans.length;
    return visible;
  }
  throw new TypeError('Invalid question');
}

export function checkExamStructure(examType, items, { requireFull = false } = {}) {
  const errors = [];
  const counts = {};

  if (examType === 'thptqg') {
    const p1 = items.filter(q => (q.section || 'part_1') === 'part_1');
    const p2 = items.filter(q => q.section === 'part_2');
    const p3 = items.filter(q => q.section === 'part_3');
    counts.part_1 = p1.length;
    counts.part_2 = p2.length;
    counts.part_3 = p3.length;

    if (p1.some(q => q.type !== 'single')) errors.push('Phần I (THPTQG) chỉ được chứa câu trắc nghiệm 4 lựa chọn.');
    if (p2.some(q => q.type !== 'true_false' || (q.statements || []).length !== 4)) errors.push('Phần II (THPTQG) chỉ được chứa câu Đúng/Sai đủ 4 mệnh đề.');
    if (p3.some(q => q.type !== 'short')) errors.push('Phần III (THPTQG) chỉ được chứa câu trả lời ngắn.');

    if (requireFull) {
      if (p1.length !== 12) errors.push(`Phần I cần đúng 12 câu (hiện có ${p1.length}/12).`);
      if (p2.length !== 4) errors.push(`Phần II cần đúng 4 câu (hiện có ${p2.length}/4).`);
      if (p3.length !== 6) errors.push(`Phần III cần đúng 6 câu (hiện có ${p3.length}/6).`);
    }
    return { valid: errors.length === 0, errors, counts };
  }

  if (examType === 'hsa') {
    const p1 = items.filter(q => (q.section || 'part_1') === 'part_1');
    const p2 = items.filter(q => q.section === 'part_2');
    const p3 = items.filter(q => q.section === 'part_3');
    counts.part_1 = p1.length;
    counts.part_2 = p2.length;
    counts.part_3 = {};
    for (const subj of HSA_ALL_PART3_SUBJECTS) {
      const subItems = p3.filter(q => (q.subject || '').toLowerCase() === subj);
      if (subItems.length > 0) {
        counts.part_3[subj] = subItems.length;
      }
    }
    if (requireFull) {
      const hasP1 = p1.length > 0;
      const hasP2 = p2.length > 0;
      const hasP3 = p3.length > 0;
      if (!hasP1 && !hasP2 && !hasP3) errors.push('Đề HSA chưa có câu hỏi nào.');
      if (hasP1 && p1.length !== 50) errors.push(`Phần 1 (Định lượng) cần đủ 50 câu (hiện có ${p1.length}/50).`);
      if (hasP2 && p2.length !== 50) errors.push(`Phần 2 (Định tính) cần đủ 50 câu (hiện có ${p2.length}/50).`);
      if (hasP3) {
        for (const [subj, cnt] of Object.entries(counts.part_3)) {
          if (subj === 'english') {
            if (cnt !== 50) errors.push(`Môn Tiếng Anh (Phần 3) cần đúng 50 câu (hiện có ${cnt}/50).`);
          } else {
            if (cnt !== 17) errors.push(`Môn ${subj} (Phần 3) cần đúng 17 câu (hiện có ${cnt}/17).`);
            const subItems = p3.filter(q => (q.subject || '').toLowerCase() === subj);
            const standaloneCount = subItems.filter(q => !q.clusterId && !q.passageId).length;
            if (standaloneCount < 1) errors.push(`Môn ${subj} (Phần 3) phải có ít nhất 1 câu đơn không thuộc ngữ liệu.`);
          }
        }
      }
    }
    return { valid: errors.length === 0, errors, counts };
  }

  if (examType === 'tsa') {
    const p1 = items.filter(q => (q.section || 'part_1') === 'part_1');
    const p2 = items.filter(q => q.section === 'part_2');
    const p3 = items.filter(q => q.section === 'part_3');
    counts.part_1 = p1.length;
    counts.part_2 = p2.length;
    counts.part_3 = p3.length;
    if (requireFull) {
      const hasP1 = p1.length > 0;
      const hasP2 = p2.length > 0;
      const hasP3 = p3.length > 0;
      if (!hasP1 && !hasP2 && !hasP3) errors.push('Đề TSA chưa có câu hỏi nào.');
      if (hasP1 && p1.length !== 40) errors.push(`Phần 1 (Tư duy Toán học) cần đủ 40 câu (hiện có ${p1.length}/40).`);
      if (hasP2 && p2.length !== 20) errors.push(`Phần 2 (Tư duy Đọc hiểu) cần đủ 20 câu (hiện có ${p2.length}/20).`);
      if (hasP3 && p3.length !== 40) errors.push(`Phần 3 (Giải quyết vấn đề) cần đủ 40 câu (hiện có ${p3.length}/40).`);
    }
    return { valid: errors.length === 0, errors, counts };
  }

  counts.total = items.length;
  return { valid: items.length > 0, errors, counts };
}
