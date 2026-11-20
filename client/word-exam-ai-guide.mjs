// Trợ lý hướng dẫn soạn đề chuẩn LTCH bằng AI (gắn với bộ 3 file Word mẫu THPTQG · HSA · TSA)
// Tuân thủ CSP: không dùng inline style attribute, không dùng emoji làm icon giao diện.

export const EXAM_FORM_SPECS = {
  thptqg: {
    key: 'thptqg',
    shortLabel: 'THPTQG',
    fullLabel: 'THPTQG (Môn Toán)',
    templateFileName: 'Mau_dang_tai_THPTQG.docx',
    templateHref: '/mau-dang-tai/Mau_dang_tai_THPTQG.docx',
    structureSummary: '3 phần · 22 câu chuẩn (12 TN + 4 Đúng/Sai + 6 Trả lời ngắn) · 90 phút',
    keyTags: ['[PHẦN I / II / III]', '[A]–[D]', '[Ý a]–[Ý d]', '[ĐÁP ÁN] Đ S Đ Đ', 'LaTeX $...$'],
    warningNote:
      'Phần II bắt buộc đủ 4 mệnh đề [Ý a]–[Ý d] và [ĐÁP ÁN] gồm đúng 4 chữ Đ/S cách nhau bằng dấu cách (vd: Đ S Đ Đ).'
  },
  hsa: {
    key: 'hsa',
    shortLabel: 'HSA',
    fullLabel: 'HSA (ĐGNL ĐHQGHN)',
    templateFileName: 'Mau_dang_tai_HSA.docx',
    templateHref: '/mau-dang-tai/Mau_dang_tai_HSA.docx',
    structureSummary: '3 phần · Định lượng (50) · Định tính (50) · Khoa học (5 môn × 17) / Tiếng Anh (50) · 195 phút',
    keyTags: ['[PHẦN 1 / 2 / 3]', '[MÔN] VẬT LÍ…', '[NGỮ LIỆU]…[HẾT NGỮ LIỆU]', 'Chỉ TN 4 chọn & Điền ngắn'],
    warningNote:
      'HSA chỉ có 2 dạng câu (TN 4 lựa chọn và Điền ngắn); tuyệt đối không dùng [Ý a], [DẠNG], [THẺ]. Mỗi môn Khoa học Phần 3 cần ít nhất 1 câu đơn nằm ngoài [NGỮ LIỆU].'
  },
  tsa: {
    key: 'tsa',
    shortLabel: 'TSA',
    fullLabel: 'TSA (ĐGTD ĐHBK Hà Nội)',
    templateFileName: 'Mau_dang_tai_TSA.docx',
    templateHref: '/mau-dang-tai/Mau_dang_tai_TSA.docx',
    structureSummary: '3 phần · Toán (40) · Đọc hiểu (20) · Giải quyết vấn đề (40) · Đủ 6 dạng câu · 150 phút',
    keyTags: ['[DẠNG] NHIỀU ĐÁP ÁN', '[DẠNG] ĐÚNG SAI', 'Ô trống {{1}}', 'Kéo thả [THẺ] → T1, T2'],
    warningNote:
      'Thẻ [THẺ] tự đánh mã T1, T2, ... theo thứ tự xuất hiện (thẻ thừa là thẻ nhiễu); đáp án kéo thả ghi dạng (1) T4; (2) T1.'
  }
};

export const AI_SOURCE_MODES = [
  {
    id: 'separate',
    label: '2 file: Đề bài + Lời giải',
    shortDesc: 'Tải lên cùng lúc 3 tệp: File Word mẫu + File Đề bài + File Lời giải/Đáp án.'
  },
  {
    id: 'combined',
    label: '1 file gộp (Đề kèm lời giải)',
    shortDesc: 'Tải lên cùng lúc 2 tệp: File Word mẫu + File đề bài đã có sẵn lời giải.'
  },
  {
    id: 'questions_only',
    label: 'Chỉ có file đề bài',
    shortDesc: 'Tải lên 2 tệp: File Word mẫu + File Đề bài (nhờ AI tự lập đáp án & lời giải chi tiết — cần rà soát kỹ lại trước khi phát hành).'
  }
];

const AI_GUIDE_SVGS = {
  sparkle:
    '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/><path d="M19 3v4"/><path d="M21 5h-4"/><path d="M5 17v3"/><path d="M6.5 18.5h-3"/>',
  download:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  copy:
    '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check:
    '<polyline points="20 6 9 17 4 12"/>',
  alertTriangle:
    '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  eye:
    '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  chevronDown:
    '<polyline points="6 9 12 15 18 9"/>',
  fileText:
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'
};

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'class') {
      node.className = v;
    } else if (k === 'text') {
      node.textContent = v;
    } else if (k in node && k !== 'list' && k !== 'form') {
      node[k] = v;
    } else {
      node.setAttribute(k, String(v));
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c !== null && c !== undefined && c !== false) {
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
  }
  return node;
}

function aiIcon(name, size = 16) {
  const paths = AI_GUIDE_SVGS[name];
  if (!paths) return null;
  const span = el('span', { class: 'ltch-btn-svg-icon', 'aria-hidden': 'true' });
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  return span;
}

function normalizeExamType(examType) {
  const lower = String(examType || 'thptqg').trim().toLowerCase();
  return EXAM_FORM_SPECS[lower] ? lower : 'thptqg';
}

function normalizeSourceMode(sourceMode) {
  return AI_SOURCE_MODES.some((m) => m.id === sourceMode) ? sourceMode : 'separate';
}

export function normalizeSchoolYearLabel(raw) {
  const text = String(raw || '')
    .trim()
    .replace(/^year-/i, '')
    .replace(/\s*-\s*/g, '-');
  return text || '2026-2027';
}

function resolvePromptTitle(rawTitle, examType, schoolYear, examCode) {
  const spec = EXAM_FORM_SPECS[examType];
  const endYearMatch = /(\d{4})\s*$/.exec(schoolYear);
  const examYear = endYearMatch ? endYearMatch[1] : '2027';
  const defaultTitle = `[LTCH] Đề thi thử ${spec.shortLabel} năm ${examYear} - Mã đề ${examCode}`;
  const cleanTitle = String(rawTitle || '').trim();
  if (!cleanTitle) return defaultTitle;
  const mentionedMatch = /\b(THPTQG|HSA|TSA)\b/i.exec(cleanTitle);
  if (mentionedMatch && mentionedMatch[1].toLowerCase() !== examType) {
    return defaultTitle;
  }
  return cleanTitle;
}

function buildSection3ByExamType(examType) {
  if (examType === 'thptqg') {
    return [
      '### 3. CẤU TRÚC PHẦN THI & CÚ PHÁP RIÊNG CHO FORM THPTQG (MÔN TOÁN)',
      '- Chia đúng 3 phần theo thứ tự bằng các dòng lệnh đứng riêng một dòng:',
      '  + [PHẦN I] — Trắc nghiệm 4 lựa chọn (đề chuẩn gồm 12 câu). Mỗi câu có đủ [A], [B], [C], [D]; đáp án ghi 1 chữ cái: [ĐÁP ÁN] B',
      '  + [PHẦN II] — Trắc nghiệm Đúng/Sai (đề chuẩn gồm 4 câu). Mỗi câu bắt buộc có đủ 4 mệnh đề [Ý a], [Ý b], [Ý c], [Ý d]; đáp án ghi đúng 4 chữ Đ hoặc S cách nhau bởi khoảng trắng: [ĐÁP ÁN] Đ S Đ Đ',
      '  + [PHẦN III] — Trả lời ngắn (đề chuẩn gồm 6 câu). Không có phương án lựa chọn; đáp án ghi số/giá trị ngắn, nếu có nhiều cách viết tương đương thì ngăn bằng dấu | : [ĐÁP ÁN] 2,5 | 5/2',
      '- Lưu ý: Form THPTQG KHÔNG dùng [DẠNG], [THẺ], {{1}}, [NGỮ LIỆU].',
      '',
      'Ví dụ minh họa đúng chuẩn THPTQG:',
      '[PHẦN I]',
      '[CÂU] Cho hàm số $f(x)$ liên tục trên $[a;b]$ và $k$ là hằng số thực. Khẳng định nào sau đây đúng?',
      '[A] $\\int_a^b f(x)\\,dx = f(b)-f(a)$.',
      '[B] $\\int_a^b k f(x)\\,dx = k\\int_a^b f(x)\\,dx$.',
      '[C] $\\int_a^b f(x)\\,dx = \\int_b^a f(x)\\,dx$.',
      '[D] $\\int_a^b [f(x)]^2\\,dx = \\left(\\int_a^b f(x)\\,dx\\right)^2$.',
      '[ĐÁP ÁN] B',
      '[LỜI GIẢI] Theo tính chất của tích phân, hằng số $k$ được đưa ra ngoài dấu tích phân nên chọn B.',
      '',
      '[PHẦN II]',
      '[CÂU] Cho hàm số $y = x^3 - 3x + 1$. Xét tính đúng, sai của các mệnh đề sau:',
      '[Ý a] Hàm số đồng biến trên khoảng $(1;+\\infty)$.',
      '[Ý b] Hàm số có $3$ điểm cực trị.',
      '[Ý c] Đồ thị hàm số cắt trục tung tại điểm có tung độ bằng $1$.',
      '[Ý d] Giá trị cực tiểu của hàm số bằng $-1$.',
      '[ĐÁP ÁN] Đ S Đ Đ',
      '[LỜI GIẢI] Ta có $y\' = 3x^2 - 3 = 0 \\Leftrightarrow x = \\pm 1$. Từ bảng biến thiên suy ra ý a đúng, ý b sai, ý c đúng, ý d đúng.',
      '',
      '[PHẦN III]',
      '[CÂU] Tính tích phân $I = \\int_0^3 (2x+1)\\,dx$.',
      '[ĐÁP ÁN] 12',
      '[LỜI GIẢI] $I = \\left(x^2 + x\\right)\\Big|_0^3 = 9 + 3 = 12$.'
    ].join('\n');
  }

  if (examType === 'hsa') {
    return [
      '### 3. CẤU TRÚC PHẦN THI & CÚ PHÁP RIÊNG CHO FORM HSA (ĐHQGHN)',
      '- Chia phần thi bằng các dòng lệnh đứng riêng một dòng:',
      '  + [PHẦN 1] — Tư duy Định lượng (Toán học & Xử lý số liệu · đề chuẩn 50 câu)',
      '  + [PHẦN 2] — Tư duy Định tính (Ngôn ngữ - Văn học · đề chuẩn 50 câu)',
      '  + [PHẦN 3] — Khoa học / Tiếng Anh: mỗi môn bắt đầu bằng 1 dòng lệnh [MÔN] tương ứng:',
      '    [MÔN] VẬT LÍ | [MÔN] HÓA HỌC | [MÔN] SINH HỌC | [MÔN] LỊCH SỬ | [MÔN] ĐỊA LÍ (mỗi môn 17 câu, BẮT BUỘC có ít nhất 1 câu đơn nằm ngoài [NGỮ LIỆU]) | [MÔN] TIẾNG ANH (50 câu)',
      '- Chỉ được phép dùng 2 dạng câu hỏi sau trong toàn đề HSA:',
      '  1) Trắc nghiệm 4 lựa chọn: có đủ [A], [B], [C], [D] và [ĐÁP ÁN] C',
      '  2) Điền đáp án ngắn: không có phương án lựa chọn và [ĐÁP ÁN] 2,5 | 5/2 (ngăn cách các đáp án tương đương bằng dấu |)',
      '- Chùm câu hỏi đọc hiểu / dữ liệu dùng chung: đặt khối [NGỮ LIỆU] ... nội dung đoạn văn/bảng/hình ... rồi đặt các [CÂU] thuộc chùm bên dưới, kết thúc chùm bằng dòng riêng [HẾT NGỮ LIỆU].',
      '- NGHIÊM CẤM trong HSA: Không dùng [Ý a], [DẠNG], [THẺ] hoặc {{1}} (hệ thống sẽ báo lỗi chặn lưu).',
      '',
      'Ví dụ minh họa đúng chuẩn HSA:',
      '[PHẦN 1]',
      '[CÂU] Chu kì của hàm số $y = \\sin\\left(\\dfrac{2}{5}x\\right)\\cos\\left(\\dfrac{2}{5}x\\right)$ là $k\\pi$. Giá trị của $k$ là:',
      '[ĐÁP ÁN] 2,5 | 5/2',
      '[LỜI GIẢI] $y = \\dfrac{1}{2}\\sin\\left(\\dfrac{4}{5}x\\right)$ có chu kì $T = \\dfrac{2\\pi}{4/5} = \\dfrac{5\\pi}{2} \\Rightarrow k = 2{,}5$.',
      '',
      '[PHẦN 3]',
      '[MÔN] VẬT LÍ',
      '[NGỮ LIỆU] Đọc thông tin sau và trả lời 2 câu hỏi bên dưới: Một con lắc lò xo dao động điều hòa với phương trình $x = 4\\cos(10t)\\text{ (cm)}$.',
      '[CÂU] Biên độ dao động của con lắc là:',
      '[A] $2\\text{ cm}$',
      '[B] $4\\text{ cm}$',
      '[C] $8\\text{ cm}$',
      '[D] $10\\text{ cm}$',
      '[ĐÁP ÁN] B',
      '[LỜI GIẢI] Từ phương trình $x = A\\cos(\\omega t + \\varphi)$ suy ra $A = 4\\text{ cm}$.',
      '[HẾT NGỮ LIỆU]'
    ].join('\n');
  }

  return [
    '### 3. CẤU TRÚC PHẦN THI & CÚ PHÁP RIÊNG CHO FORM TSA (ĐHBK HÀ NỘI)',
    '- Chia phần thi bằng các dòng lệnh đứng riêng một dòng:',
    '  + [PHẦN 1] — Tư duy Toán học (đề chuẩn 40 câu)',
    '  + [PHẦN 2] — Tư duy Đọc hiểu (đề chuẩn 20 câu)',
    '  + [PHẦN 3] — Giải quyết vấn đề (đề chuẩn 40 câu)',
    '- Chùm ngữ liệu dùng chung (hiển thị cột trái khi thi): bọc bằng [NGỮ LIỆU] ... và đóng bằng [HẾT NGỮ LIỆU] sau câu cuối cùng của chùm.',
    '- Hỗ trợ đầy đủ 6 dạng câu hỏi của TSA (dùng đúng cú pháp nhận diện):',
    '  1) Trắc nghiệm 1 đáp án: có [A], [B], [C], [D], không ghi [DẠNG], đáp án [ĐÁP ÁN] B',
    '  2) Chọn nhiều đáp án: ghi [DẠNG] NHIỀU ĐÁP ÁN, có từ 2 đến 6 phương án [A]..[F], đáp án [ĐÁP ÁN] A, C, E',
    '  3) Đúng/Sai nhiều mệnh đề (2–5 ý): có [Ý a]..[Ý e], đáp án [ĐÁP ÁN] Đ S Đ Đ · Hoặc Đúng/Sai 1 nhận định: ghi [DẠNG] ĐÚNG SAI (không có [Ý ...]), đáp án [ĐÁP ÁN] S',
    '  4) Trả lời ngắn: không có phương án và không có {{1}}, đáp án [ĐÁP ÁN] 12 hoặc [ĐÁP ÁN] 2,5 | 5/2',
    '  5) Điền khuyết trong câu: đặt ô trống {{1}}, {{2}}... ngay trong thân câu [CÂU] (không có [THẺ]), đáp án [ĐÁP ÁN] (1) 88 hoặc [ĐÁP ÁN] (1) T | thymine; (2) U | uracil',
    '  6) Kéo thả thẻ đáp án: đặt {{1}}, {{2}}... trong thân câu [CÂU], liệt kê các thẻ bằng dòng [THẺ] ... (hệ thống tự đánh mã T1, T2, ... theo thứ tự; thẻ không dùng là thẻ nhiễu), đáp án [ĐÁP ÁN] (1) T4; (2) T1; (3) T2',
    '',
    'Ví dụ minh họa các dạng đặc thù TSA:',
    '[PHẦN 1]',
    '[CÂU] Trong các số sau, những số nào là số nguyên tố?',
    '[DẠNG] NHIỀU ĐÁP ÁN',
    '[A] $2$',
    '[B] $9$',
    '[C] $11$',
    '[D] $15$',
    '[E] $17$',
    '[ĐÁP ÁN] A, C, E',
    '[LỜI GIẢI] Các số nguyên tố trong danh sách là $2, 11, 17$.',
    '',
    '[CÂU] Giới hạn $\\lim\\limits_{x\\to 4}\\dfrac{f^2(x)+f(x)-30}{\\sqrt{x}-2}$ bằng {{1}}.',
    '[ĐÁP ÁN] (1) 88',
    '[LỜI GIẢI] Thay giá trị giới hạn tại $x \\to 4$ ta thu được kết quả $88$.',
    '',
    '[CÂU] Kéo thả các thẻ vào vị trí thích hợp: Giá bán mỗi chiếc là {{1}} (USD), lợi nhuận là {{2}} (USD) và đạt cực đại khi đơn hàng có {{3}}.',
    '[THẺ] $85x-0{,}25x^2$',
    '[THẺ] $170$ chiếc',
    '[THẺ] $90-0{,}25x$',
    '[THẺ] $115-0{,}25x$',
    '[ĐÁP ÁN] (1) T4; (2) T1; (3) T2',
    '[LỜI GIẢI] Thiết lập hàm lợi nhuận theo $x$ rồi tìm cực đại của tam thức bậc hai.'
  ].join('\n');
}

export function buildAiExamPrompt({
  examType = 'thptqg',
  targetGrade = 12,
  schoolYear = '2026-2027',
  examCode = '01',
  title = '',
  sourceMode = 'separate'
} = {}) {
  const safeType = normalizeExamType(examType);
  const spec = EXAM_FORM_SPECS[safeType];
  const safeGrade = [10, 11, 12].includes(Number(targetGrade)) ? Number(targetGrade) : 12;
  const safeYear = normalizeSchoolYearLabel(schoolYear);
  const cleanCode = String(examCode || '').trim() || '01';
  const cleanTitle = resolvePromptTitle(title, safeType, safeYear, cleanCode);
  const safeMode = normalizeSourceMode(sourceMode);

  let sourceInstruction = '';
  if (safeMode === 'separate') {
    sourceInstruction =
      'Tôi đính kèm 3 tệp: (1) File Word mẫu chuẩn "' +
      spec.templateFileName +
      '", (2) File Đề bài gốc, và (3) File Đáp án / Lời giải gốc. Hãy đối chiếu từng câu giữa File Đề bài và File Lời giải theo đúng số thứ tự câu, ghép đúng đáp án và lời giải chi tiết vào từng câu hỏi tương ứng.';
  } else if (safeMode === 'combined') {
    sourceInstruction =
      'Tôi đính kèm 2 tệp: (1) File Word mẫu chuẩn "' +
      spec.templateFileName +
      '", và (2) File Đề bài đã có sẵn đáp án và lời giải bên trong. Hãy tách chuẩn từng câu hỏi, phương án, đáp án đúng và lời giải chi tiết sang định dạng lệnh chuẩn.';
  } else {
    sourceInstruction =
      'Tôi đính kèm 2 tệp: (1) File Word mẫu chuẩn "' +
      spec.templateFileName +
      '", và (2) File Đề bài gốc (chưa có lời giải/đáp án kèm theo). Hãy chuyển đổi nội dung đề sang đúng mẫu lệnh chuẩn, đồng thời tự giải cẩn thận, kiểm tra lại phép tính để điền chính xác dòng [ĐÁP ÁN] và [LỜI GIẢI] chi tiết cho từng câu.';
  }

  const headerBlock = [
    '[BẮT ĐẦU ĐỀ]',
    `[KỲ THI] ${spec.shortLabel}`,
    ...(safeType === 'thptqg' ? [`[KHỐI] ${safeGrade}`, `[NĂM HỌC] ${safeYear}`] : []),
    `[MÃ ĐỀ] ${cleanCode}`,
    `[TÊN ĐỀ] ${cleanTitle}`
  ].join('\n');

  const fileSlug = `${spec.shortLabel}_Ma_${cleanCode.replace(/[^A-Za-z0-9_-]+/g, '_') || '01'}`;

  return [
    `Bạn là chuyên gia biên tập và chuẩn hóa đề thi cho hệ thống Lớp Toán Cô Hạnh (LTCH) theo chuẩn form ${spec.fullLabel}.`,
    '',
    '### 1. NHIỆM VỤ & TỆP ĐẦU VÀO',
    sourceInstruction,
    `Mục tiêu cuối cùng là chuyển hóa toàn bộ đề bài và lời giải thành 01 tệp Word (.docx) hoàn chỉnh, tuân thủ tuyệt đối quy ước dòng lệnh [...] của file mẫu "${spec.templateFileName}" để tải lên hệ thống đọc tự động không phát sinh lỗi.`,
    '',
    '### 2. PHẦN MỞ ĐẦU ĐỀ BẮT BUỘC',
    'Ngay sau dòng [BẮT ĐẦU ĐỀ], giữ nguyên chính xác các dòng khai báo thông tin đề sau:',
    '```text',
    headerBlock,
    '```',
    '',
    buildSection3ByExamType(safeType),
    '',
    '### 4. QUY TẮC KỸ THUẬT BẮT BUỘC ĐỂ HỆ THỐNG ĐỌC KHÔNG LỖI',
    '1. Vùng đọc đề: Toàn bộ phần đầu đề, phần thi, câu hỏi, đáp án và lời giải phải nằm giữa [BẮT ĐẦU ĐỀ] và kết thúc bằng một dòng [KẾT THÚC ĐỀ] ở cuối cùng.',
    '2. Cấu trúc dòng lệnh: Mỗi dòng lệnh [...] phải đứng ở ĐẦU ĐOẠN VĂN RIÊNG BIỆT (tuyệt đối không đặt hai lệnh trên cùng một dòng; nếu dùng Shift+Enter trong Word cũng phải tách đoạn rõ ràng cho lệnh mới).',
    '3. Không lặp nhãn thừa: Sau [CÂU] không viết "Câu 1:", "Bài 1:"; sau [A]..[F] không viết "A.", "B."; sau [Ý a]..[Ý e] không viết "a)", "b)". Hệ thống tự đánh số thứ tự.',
    '4. Cấm Auto-Numbering: Không dùng tính năng đánh số tự động (Numbering) hay gạch đầu dòng tự động (Bullet List) của Word ở các đoạn lệnh hoặc trong vùng đề.',
    '5. Công thức Toán học / Lí / Hóa: Chuyển 100% công thức sang LaTeX thuần đặt trong $...$ (trong dòng) hoặc $$...$$ (đứng riêng một dòng), tương thích chuẩn KaTeX (vd: $\\int_0^3 2x\\,dx = 9$, $\\dfrac{a}{b}$, $\\Leftrightarrow$). TUYỆT ĐỐI KHÔNG dùng Word Equation (OMML) hay đối tượng MathType OLE.',
    '6. Định dạng chữ được giữ: Chỉ giữ in đậm, in nghiêng, gạch chân (dùng cho từ cần hỏi trong đề đọc hiểu/tiếng Anh), chỉ số trên/dưới. TUYỆT ĐỐI KHÔNG dùng gạch chân, tô đậm hay tô màu chữ cái phương án để đánh dấu đáp án đúng — đáp án chỉ khai báo qua lệnh [ĐÁP ÁN].',
    '7. Bảng biểu & Bảng biến thiên: Bảng số liệu dùng bảng Word thật (không dùng bảng ký tự Markdown |---|). Với Bảng biến thiên / Bảng xét dấu, dựng bằng bảng Word 2–3 hàng ($x$, $y\'$, $y$; dùng $||$ tại điểm không xác định, //// cho miền bị loại, ↗ hoặc ↘ cho chiều biến thiên).',
    '8. Hình vẽ, đồ thị, sơ đồ: Nếu bạn trích xuất được ảnh PNG/JPG (≤ 2 MB) từ tệp gốc, hãy chèn trực tiếp vào .docx ở chế độ "In Line with Text" (không dùng Floating/Anchor, không dùng ảnh WMF/EMF) ngay tại vị trí cần hiển thị. Nếu không thể tự chèn ảnh, hãy ghi rõ "(Cần chèn hình minh họa từ đề gốc)" tại đúng vị trí trong câu hỏi/lời giải VÀ thêm dòng `[GHI CHÚ] Cần chèn hình minh họa (In Line with Text)` ở DÒNG CUỐI CÙNG CỦA CÂU ĐÓ (sau [LỜI GIẢI], tuyệt đối không đặt [GHI CHÚ] xen giữa thân câu hỏi hay giữa lời giải).',
    '9. Bảo toàn dữ liệu: Giữ nguyên vẹn 100% số lượng câu hỏi, giả thiết, số liệu và lời giải chi tiết từ tệp gốc; không tóm tắt, không lược bỏ câu bằng dấu "...". Nếu tệp gốc là đề rút gọn/đề chuyên đề ít câu hơn cấu trúc chuẩn, vẫn giữ đúng toàn bộ số câu hiện có.',
    '',
    '### 5. YÊU CẦU ĐẦU RA FILE .DOCX',
    `- Ưu tiên 1 (nếu bạn có công cụ tạo file / Python python-docx): Hãy trực tiếp tạo và xuất ra 01 tệp Word (.docx) hoàn chỉnh không chứa macro với tên gợi ý "De_${fileSlug}.docx" để tôi tải về và đẩy thẳng lên hệ thống.`,
    `- Phương án dự phòng (nếu phiên chat hiện tại không hỗ trợ tạo file tải về): Hãy xuất toàn bộ nội dung từ [BẮT ĐẦU ĐỀ] đến [KẾT THÚC ĐỀ] trong DUY NHẤT 01 khối văn bản thuần để tôi sao chép, dán vào file mẫu "${spec.templateFileName}" và lưu lại dạng .docx.`,
    '',
    '### 6. TỰ KIỂM TRA TRƯỚC KHI XUẤT KẾT QUẢ',
    '- Đã có đủ cặp [BẮT ĐẦU ĐỀ] và [KẾT THÚC ĐỀ].',
    '- Mọi [CÂU] đều có [ĐÁP ÁN] đúng định dạng của form ' + spec.shortLabel + ' và có [LỜI GIẢI] chi tiết.',
    '- Mọi [NGỮ LIỆU] (nếu có) đều được đóng bằng [HẾT NGỮ LIỆU] và có ít nhất 1 câu hỏi bên trong.',
    '- Mọi cặp dấu $...$ trong công thức LaTeX đều đóng mở đầy đủ, không dính Word Equation và không lặp tiền tố "Câu 1:", "A.".'
  ].join('\n');
}

export async function copyTextToClipboard(text) {
  const value = String(text || '');
  if (!value) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (_) {
    // Chuyển sang cơ chế sao chép dự phòng qua textarea tạm
  }
  try {
    const area = document.createElement('textarea');
    area.className = 'ltch-sr-only-copy';
    area.value = value;
    area.setAttribute('readonly', '');
    document.body.append(area);
    area.select();
    area.setSelectionRange(0, value.length);
    const copied = document.execCommand('copy');
    area.remove();
    return Boolean(copied);
  } catch (_) {
    return false;
  }
}

export function createAiExamGuideCard({
  getContext,
  onChangeExamType,
  onChangeSourceMode,
  onOpenFullModal,
  status
}) {
  const root = el('section', {
    class: 'ltch-ai-guide-card',
    'aria-label': 'Hướng dẫn soạn đề chuẩn bằng AI'
  });

  const liveRegion = el('span', { class: 'ltch-ai-live-status', 'aria-live': 'polite' });
  let copyTimer = null;
  let copiedFeedback = false;
  let previewExpanded = false;

  const promptCodeEl = el('pre', { class: 'ltch-ai-prompt-code' });

  function readCtx() {
    const raw = typeof getContext === 'function' ? getContext() : {};
    const examType = normalizeExamType(raw?.examType);
    const sourceMode = normalizeSourceMode(raw?.sourceMode);
    return {
      examType,
      targetGrade: [10, 11, 12].includes(Number(raw?.targetGrade)) ? Number(raw.targetGrade) : 12,
      schoolYear: normalizeSchoolYearLabel(raw?.schoolYear),
      examCode: String(raw?.examCode || '01').trim() || '01',
      title: String(raw?.title || ''),
      sourceMode
    };
  }

  function refreshPrompt() {
    const ctx = readCtx();
    promptCodeEl.textContent = buildAiExamPrompt(ctx);
  }

  async function handleCopyPrompt(copyBtn) {
    const ctx = readCtx();
    const spec = EXAM_FORM_SPECS[ctx.examType];
    const promptText = buildAiExamPrompt(ctx);
    const ok = await copyTextToClipboard(promptText);
    if (!ok) {
      status?.('Trình duyệt không cho phép sao chép tự động. Hãy bấm "Xem đầy đủ" để bôi đen và sao chép thủ công.', true);
      return;
    }
    copiedFeedback = true;
    liveRegion.textContent = `Đã sao chép Prompt hướng dẫn cho form ${spec.shortLabel}.`;
    status?.(`Đã sao chép Prompt hướng dẫn form ${spec.shortLabel}! Dán cùng file mẫu và đề gốc cho AI.`, false, 'success');
    updateCopyButtonVisual(copyBtn, spec);
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copiedFeedback = false;
      updateCopyButtonVisual(copyBtn, spec);
    }, 2500);
  }

  function updateCopyButtonVisual(copyBtn, spec) {
    if (!copyBtn) return;
    copyBtn.replaceChildren(
      aiIcon(copiedFeedback ? 'check' : 'copy', 16),
      el('span', { text: copiedFeedback ? 'Đã sao chép Prompt!' : `Sao chép Prompt form ${spec.shortLabel}` })
    );
    copyBtn.classList.toggle('is-copied', copiedFeedback);
  }

  function renderCard() {
    const ctx = readCtx();
    const spec = EXAM_FORM_SPECS[ctx.examType];
    const modeObj = AI_SOURCE_MODES.find((m) => m.id === ctx.sourceMode) || AI_SOURCE_MODES[0];

    root.className = `ltch-ai-guide-card is-${ctx.examType}`;
    promptCodeEl.textContent = buildAiExamPrompt(ctx);

    const copyBtn = el('button', {
      type: 'button',
      class: `ltch-btn ltch-btn-primary is-${ctx.examType} ltch-ai-copy-btn`,
      onclick: () => handleCopyPrompt(copyBtn)
    });
    updateCopyButtonVisual(copyBtn, spec);

    const detailsEl = el(
      'details',
      {
        class: 'ltch-ai-prompt-details',
        open: previewExpanded
      },
      el(
        'summary',
        {
          class: 'ltch-ai-prompt-summary',
          onclick: () => {
            setTimeout(() => {
              previewExpanded = detailsEl.open;
            }, 0);
          }
        },
        aiIcon('chevronDown', 15),
        el('span', { text: 'Xem trước nội dung Prompt sẽ sao chép' })
      ),
      promptCodeEl
    );

    const header = el(
      'div',
      { class: 'ltch-ai-guide-head' },
      el(
        'div',
        { class: 'ltch-ai-guide-title-wrap' },
        el(
          'div',
          { class: 'ltch-ai-guide-eyebrow-row' },
          el(
            'span',
            { class: 'ltch-ai-guide-eyebrow' },
            aiIcon('sparkle', 14),
            el('span', { text: 'TRỢ LÝ SOẠN ĐỀ BẰNG AI' })
          ),
          el(
            'span',
            { class: 'ltch-ai-recommended-badge' },
            aiIcon('check', 13),
            el('span', { text: 'Khuyên dùng' })
          )
        ),
        el('h3', { text: 'Biến file đề bài & lời giải thành file Word chuẩn' }),
        el('p', {
          class: 'meta',
          text: 'Gửi file mẫu LTCH kèm file đề gốc và lời giải cho ChatGPT, Claude hoặc Gemini để xuất ra file .docx đúng cú pháp tải lên ngay.'
        })
      ),
      el('span', {
        class: `ltch-dropzone-form-pill is-${ctx.examType}`,
        text: `FORM ${spec.shortLabel}`
      })
    );

    const steps = el(
      'ol',
      { class: 'ltch-ai-steps' },
      el(
        'li',
        { class: 'ltch-ai-step' },
        el('span', { class: 'ltch-ai-step-num', text: '1' }),
        el(
          'div',
          { class: 'ltch-ai-step-body' },
          el('strong', { text: `Tải file mẫu chuẩn form ${spec.shortLabel}` }),
          el('p', { class: 'meta', text: spec.structureSummary }),
          el(
            'a',
            {
              href: spec.templateHref,
              download: spec.templateFileName,
              class: `ltch-ai-template-btn is-${ctx.examType}`
            },
            aiIcon('download', 15),
            el('span', { text: `Tải ${spec.templateFileName}` })
          )
        )
      ),
      el(
        'li',
        { class: 'ltch-ai-step' },
        el('span', { class: 'ltch-ai-step-num', text: '2' }),
        el(
          'div',
          { class: 'ltch-ai-step-body' },
          el('strong', { text: 'Đính kèm file mẫu + đề gốc vào ChatGPT / Claude / Gemini' }),
          el(
            'div',
            { class: 'ltch-ai-mode-pills', role: 'group', 'aria-label': 'Chọn loại tệp nguồn của bạn' },
            ...AI_SOURCE_MODES.map((m) => {
              const active = m.id === ctx.sourceMode;
              return el(
                'button',
                {
                  type: 'button',
                  class: `ltch-ai-mode-btn${active ? ' is-active' : ''}`,
                  'aria-pressed': String(active),
                  onclick: () => {
                    if (m.id !== ctx.sourceMode) {
                      onChangeSourceMode?.(m.id);
                    }
                  }
                },
                m.label
              );
            })
          ),
          el('p', { class: 'meta', text: modeObj.shortDesc })
        )
      ),
      el(
        'li',
        { class: 'ltch-ai-step' },
        el('span', { class: 'ltch-ai-step-num', text: '3' }),
        el(
          'div',
          { class: 'ltch-ai-step-body' },
          el('strong', { text: 'Sao chép Prompt hướng dẫn & gửi AI xử lý' }),
          el('p', {
            class: 'meta',
            text: `Prompt đã điền sẵn form ${spec.shortLabel}, mã đề "${ctx.examCode}" và toàn bộ quy ước lệnh [...] + LaTeX.`
          }),
          el(
            'div',
            { class: 'ltch-ai-copy-row' },
            copyBtn,
            el(
              'button',
              {
                type: 'button',
                class: 'ltch-btn ltch-btn-outline ltch-ai-expand-btn',
                onclick: () => onOpenFullModal?.(readCtx())
              },
              aiIcon('eye', 15),
              el('span', { text: 'Xem đầy đủ' })
            )
          ),
          detailsEl
        )
      ),
      el(
        'li',
        { class: 'ltch-ai-step' },
        el('span', { class: 'ltch-ai-step-num', text: '4' }),
        el(
          'div',
          { class: 'ltch-ai-step-body' },
          el('strong', { text: 'Kiểm tra nhanh & tải file .docx lên ô bên cạnh' }),
          el('p', {
            class: 'meta',
            text: 'Nếu câu có hình vẽ/đồ thị và AI chưa chèn sẵn ảnh, mở Word chèn ảnh PNG/JPG chế độ In Line with Text vào đúng vị trí rồi thả file .docx vào khung bên trái.'
          })
        )
      )
    );

    const tagsRow = el(
      'div',
      { class: 'ltch-ai-tags-row', 'aria-label': `Từ khóa nhận diện form ${spec.shortLabel}` },
      ...spec.keyTags.map((tag) => el('span', { class: 'ltch-ai-tag-chip', text: tag }))
    );

    const warningBox = el(
      'div',
      { class: `ltch-ai-warning-box is-${ctx.examType}` },
      aiIcon('alertTriangle', 16),
      el('span', { text: spec.warningNote })
    );

    root.replaceChildren(header, steps, tagsRow, warningBox, liveRegion);
  }

  renderCard();

  return {
    element: root,
    refreshPrompt,
    render: renderCard
  };
}

export function openAiExamGuideModal({
  examType = 'thptqg',
  targetGrade = 12,
  schoolYear = '2026-2027',
  examCode = '01',
  title = '',
  sourceMode = 'separate',
  onSyncOptions,
  status
} = {}) {
  let state = {
    examType: normalizeExamType(examType),
    targetGrade: [10, 11, 12].includes(Number(targetGrade)) ? Number(targetGrade) : 12,
    schoolYear: normalizeSchoolYearLabel(schoolYear),
    examCode: String(examCode || '01').trim() || '01',
    title: String(title || ''),
    sourceMode: normalizeSourceMode(sourceMode)
  };
  let copiedFeedback = false;
  let copyTimer = null;

  const titleId = `ltch-ai-guide-title-${Date.now()}`;
  const bodyBox = el('div', { class: 'ltch-modal-body ltch-ai-modal-body' });
  const footerBox = el('div', { class: 'ltch-modal-footer ltch-ai-modal-footer' });
  const liveRegion = el('span', { class: 'ltch-ai-live-status', 'aria-live': 'polite' });

  const cleanupAndClose = () => {
    if (copyTimer) clearTimeout(copyTimer);
    document.removeEventListener('keydown', onKeyDown);
    backdrop.remove();
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cleanupAndClose();
    }
  };

  const closeBtn = el(
    'button',
    {
      type: 'button',
      class: 'ltch-modal-close',
      'aria-label': 'Đóng hộp thoại hướng dẫn AI',
      onclick: cleanupAndClose
    },
    '×'
  );

  const card = el(
    'div',
    {
      class: 'ltch-modal-card ltch-modal-lg ltch-ai-guide-modal',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      onclick: (e) => e.stopPropagation()
    },
    el(
      'div',
      { class: 'ltch-modal-header' },
      el(
        'div',
        { class: 'ltch-ai-modal-title-wrap' },
        el(
          'div',
          { class: 'ltch-ai-guide-eyebrow-row' },
          el(
            'span',
            { class: 'ltch-ai-guide-eyebrow' },
            aiIcon('sparkle', 14),
            el('span', { text: 'HƯỚNG DẪN SOẠN ĐỀ CHUẨN BẰNG AI' })
          ),
          el(
            'span',
            { class: 'ltch-ai-recommended-badge' },
            aiIcon('check', 13),
            el('span', { text: 'Khuyên dùng' })
          )
        ),
        el('h3', {
          id: titleId,
          text: 'Quy trình chuyển file đề bài & lời giải sang Word (.docx) chuẩn LTCH'
        })
      ),
      closeBtn
    ),
    bodyBox,
    footerBox,
    liveRegion
  );

  const backdrop = el(
    'div',
    {
      class: 'ltch-modal-backdrop is-ai-guide',
      onclick: cleanupAndClose
    },
    card
  );

  function syncParent() {
    onSyncOptions?.({
      examType: state.examType,
      targetGrade: state.targetGrade,
      sourceMode: state.sourceMode
    });
  }

  async function triggerCopy() {
    const spec = EXAM_FORM_SPECS[state.examType];
    const ok = await copyTextToClipboard(buildAiExamPrompt(state));
    if (!ok) {
      status?.('Không thể tự động sao chép. Hãy chọn nội dung trong khung Prompt và nhấn Ctrl+C.', true);
      return;
    }
    copiedFeedback = true;
    liveRegion.textContent = `Đã sao chép toàn bộ Prompt hướng dẫn cho form ${spec.shortLabel}.`;
    status?.(`Đã sao chép Prompt hướng dẫn form ${spec.shortLabel}!`, false, 'success');
    renderModal();
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copiedFeedback = false;
      if (backdrop.isConnected) renderModal();
    }, 2500);
  }

  function renderModal() {
    const spec = EXAM_FORM_SPECS[state.examType];
    const modeObj = AI_SOURCE_MODES.find((m) => m.id === state.sourceMode) || AI_SOURCE_MODES[0];
    const promptText = buildAiExamPrompt(state);

    const controlsRow = el(
      'div',
      { class: 'ltch-ai-modal-controls' },
      el(
        'div',
        { class: 'ltch-ai-modal-control-group' },
        el('span', { class: 'ltch-ai-control-label', text: '1. Form đề mẫu' }),
        el('span', {
          class: `ltch-dropzone-form-pill is-${state.examType}`,
          text: `FORM ${spec.shortLabel} · ${spec.fullLabel}`
        })
      ),
      state.examType === 'thptqg'
        ? el(
            'div',
            { class: 'ltch-ai-modal-control-group' },
            el('span', { class: 'ltch-ai-control-label', text: 'Khối lớp' }),
            el(
              'select',
              {
                class: 'ltch-select',
                'aria-label': 'Chọn khối lớp THPTQG',
                onchange: (e) => {
                  state.targetGrade = Number(e.target.value) || 12;
                  syncParent();
                  renderModal();
                }
              },
              el('option', { value: '12', selected: state.targetGrade === 12, text: 'Khối 12' }),
              el('option', { value: '11', selected: state.targetGrade === 11, text: 'Khối 11' }),
              el('option', { value: '10', selected: state.targetGrade === 10, text: 'Khối 10' })
            )
          )
        : null,
      el(
        'div',
        { class: 'ltch-ai-modal-control-group is-wide' },
        el('span', { class: 'ltch-ai-control-label', text: '2. Tệp đề nguồn bạn đang có' }),
        el(
          'div',
          { class: 'ltch-ai-mode-pills', role: 'group', 'aria-label': 'Chọn loại tệp nguồn' },
          ...AI_SOURCE_MODES.map((m) => {
            const active = m.id === state.sourceMode;
            return el(
              'button',
              {
                type: 'button',
                class: `ltch-ai-mode-btn${active ? ' is-active' : ''}`,
                'aria-pressed': String(active),
                onclick: () => {
                  state.sourceMode = m.id;
                  syncParent();
                  renderModal();
                }
              },
              m.label
            );
          })
        )
      )
    );

    const summaryBox = el(
      'div',
      { class: 'ltch-ai-modal-summary' },
      el('div', {
        class: 'ltch-ai-modal-summary-line',
        text: `Thao tác 4 bước: (1) Tải "${spec.templateFileName}" → (2) ${modeObj.shortDesc} → (3) Dán Prompt bên dưới để AI xuất ra file .docx → (4) Tải file .docx thành phẩm lên hệ thống và rà soát.`
      }),
      el(
        'div',
        { class: 'ltch-ai-tags-row' },
        ...spec.keyTags.map((tag) => el('span', { class: 'ltch-ai-tag-chip', text: tag }))
      ),
      el(
        'div',
        { class: `ltch-ai-warning-box is-${state.examType}` },
        aiIcon('alertTriangle', 16),
        el('span', { text: spec.warningNote })
      )
    );

    const promptPanel = el(
      'div',
      { class: 'ltch-ai-prompt-panel' },
      el(
        'div',
        { class: 'ltch-ai-prompt-panel-head' },
        el(
          'div',
          { class: 'ltch-ai-prompt-panel-title' },
          aiIcon('fileText', 15),
          el('strong', { text: `Prompt hướng dẫn AI cho form ${spec.fullLabel}` })
        ),
        el(
          'button',
          {
            type: 'button',
            class: `ltch-btn ltch-btn-outline ltch-btn-sm ltch-ai-quick-copy-btn${copiedFeedback ? ' is-copied' : ''}`,
            onclick: triggerCopy
          },
          aiIcon(copiedFeedback ? 'check' : 'copy', 14),
          el('span', { text: copiedFeedback ? 'Đã sao chép!' : 'Sao chép nhanh' })
        )
      ),
      el('pre', { class: 'ltch-ai-prompt-code is-modal', text: promptText })
    );

    bodyBox.replaceChildren(controlsRow, summaryBox, promptPanel);

    footerBox.replaceChildren(
      el(
        'a',
        {
          href: spec.templateHref,
          download: spec.templateFileName,
          class: `ltch-ai-template-btn is-${state.examType}`
        },
        aiIcon('download', 15),
        el('span', { text: `Tải ${spec.templateFileName}` })
      ),
      el(
        'div',
        { class: 'ltch-ai-modal-footer-right' },
        el(
          'button',
          {
            type: 'button',
            class: 'ltch-btn ltch-btn-outline',
            onclick: cleanupAndClose
          },
          'Đóng'
        ),
        el(
          'button',
          {
            type: 'button',
            class: `ltch-btn ltch-btn-primary is-${state.examType}${copiedFeedback ? ' is-copied' : ''}`,
            onclick: triggerCopy
          },
          aiIcon(copiedFeedback ? 'check' : 'copy', 16),
          el('span', { text: copiedFeedback ? 'Đã sao chép Prompt!' : `Sao chép Prompt form ${spec.shortLabel}` })
        )
      )
    );
  }

  renderModal();
  document.addEventListener('keydown', onKeyDown);
  document.body.append(backdrop);
  closeBtn.focus();
}
