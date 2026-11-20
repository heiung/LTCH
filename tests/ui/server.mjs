import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import {scheduleText, encodeAssignmentSessionInstructions} from '../../shared/classroom.mjs';
import {computeForumStats, normalizeForumSessionNumber} from '../../shared/forum-metadata.mjs';

const root = process.cwd();
const authStub = path.join(root, 'tests/ui/firebase.mjs');

const result = await build({
  entryPoints: ['client/app.js'],
  bundle: true,
  format: 'esm',
  write: false,
  plugins: [{
    name: 'qa',
    setup(b) {
      b.onResolve({filter: /^firebase\//}, () => ({path: authStub}));
      b.onLoad({filter: /client[\\/]config\.js$/}, () => ({
        contents: "export const firebaseConfig={};export const apiBase='http://127.0.0.1:5181';export const supportEmail='admin@example.com';",
        loader: 'js'
      }));
      // Keep production HTTPS-only. This isolated fixture serves only loopback
      // HTTP and patches the bundled test copy, not the application source.
      b.onLoad({filter: /client[\\/]api-transport\.mjs$/}, async args => {
        const source = await fs.readFile(args.path, 'utf8');
        const guard = "endpoint.protocol !== 'https:'";
        if (!source.includes(guard)) throw Error('QA transport guard changed');
        return {contents: source.replace(guard, "!(endpoint.protocol === 'http:' && endpoint.host === '127.0.0.1:5181')"), loader:'js'};
      });
    }
  }]
});

const now = Date.now();
let submissions = [];
const submissionBlobs = new Map();
let notices = [];
const noticeDrafts = new Map();
const noticeFiles = new Map();
let assignments = [
  {
    id: 'qa-assignment',
    title: 'Bài tập kiểm tra giao diện',
    status: 'published',
    instructions: encodeAssignmentSessionInstructions({
      instructions: 'Dữ liệu chỉ dùng kiểm tra cục bộ. Làm câu 1 đến câu 10 trong phiếu đính kèm.',
      sessionNumber: 1,
      lessonId: 'qa-lesson',
      fileIds: ['qa-hw-1']
    }),
    opens_at: now - 1000,
    closes_at: now + 86400000
  }
];
let exams = [];
let bank = [];
let retryRequestId = null;

// Danh sách lớp hiện tại (Lớp Toán cô Hạnh)
const defaultClasses = [
  {id: 'class-6a', name: '6', schedule: 'Thứ 3, 5: 18h00 - 19h30', schoolYearId: 'qa-year', school_year_id: 'qa-year'},
  {id: 'class-7a', name: '7', schedule: 'Thứ 3, 5: 19h45 - 21h15', schoolYearId: 'qa-year', school_year_id: 'qa-year'},
  {id: 'class-8a', name: '8A', schedule: 'Thứ 2, 6: 18h00 - 19h30', schoolYearId: 'qa-year', school_year_id: 'qa-year'},
  {id: 'class-8b', name: '8B', schedule: 'Thứ 3, 7: 18h00 - 19h30', schoolYearId: 'qa-year', school_year_id: 'qa-year'},
  {id: 'class-9a', name: '9A', schedule: 'Thứ 2, 6: 19h45 - 21h15 (Ôn thi vào 10)', schoolYearId: 'qa-year', school_year_id: 'qa-year'},
  {id: 'class-9b', name: '9B', schedule: 'Thứ 4, CN: 18h00 - 19h30 (Ôn thi vào 10)', schoolYearId: 'qa-year', school_year_id: 'qa-year'},
  {id: 'class-10a1', name: '10A', schedule: 'Thứ 2, 5: 18h00 - 19h45', schoolYearId: 'qa-year', school_year_id: 'qa-year'},
  {id: 'class-10a2', name: '10B', schedule: 'Thứ 3, 6: 18h00 - 19h45', schoolYearId: 'qa-year', school_year_id: 'qa-year'},
  {id: 'class-11a1', name: '11', schedule: 'Thứ 2, 5: 19h45 - 21h30', schoolYearId: 'qa-year', school_year_id: 'qa-year'},
  {id: 'class-12a1', name: '12', schedule: 'Thứ 4, 7: 18h00 - 20h00', schoolYearId: 'qa-year', school_year_id: 'qa-year'},
  {id: 'qa-class', name: 'Lớp kiểm tra giao diện', schedule: 'Dữ liệu thử trên máy', schoolYearId: 'qa-year', school_year_id: 'qa-year'}
];
let classesState = [
  ...defaultClasses.map(c => ({...c})),
  {id: 'class-next-7', name: '7 (Khóa 2027-2028)', schedule: 'Thứ 3, 5: 19h45 - 21h15', schoolYearId: 'qa-year-next', school_year_id: 'qa-year-next'}
];
let archivedClasses = [
  {id: 'arch-12', name: '12 (Khóa 2025)', schoolYearId: 'qa-year-prev', school_year_id: 'qa-year-prev', schoolYearName: 'Năm học 2025-2026', schedule: 'Đã hoàn thành chương trình', archived: true}
];
let yearsList = [
  {id: 'qa-year', name: 'Năm học 2026-2027', starts_on: '2026-09-01', ends_on: '2027-06-30'},
  {id: 'qa-year-next', name: 'Năm học 2027-2028', starts_on: '2027-09-01', ends_on: '2028-06-30'}
];

const account = {
  uid: 'qa-admin',
  display_name: 'Quản trị viên (Admin)',
  email: 'admin@example.com',
  roles: ['admin', 'teacher', 'student', 'parent'],
  status: 'active',
  contact_phone: '0912345678'
};
let usersList = [
  account,
  {uid: 'student-new-001', display_name: 'Nguyễn Minh Quân', email: 'qa-student@example.test', status: 'pending', roles: []},
  {uid: 'qa-student', display_name: 'Học sinh thử', email: 'hs@example.test', status: 'active', roles: ['student'], student_code: 'LTCH001'},
  {uid: 'qa-student-2', display_name: 'Trần Thảo Linh', email: 'linh@example.test', status: 'active', roles: ['student'], student_code: 'LTCH002'},
  {uid: 'qa-teacher', display_name: 'Cô Hạnh', email: 'gv@example.test', status: 'active', roles: ['teacher']},
  {uid: 'qa-dual-staff', display_name: 'Trần Minh Đức', email: 'dual-staff@ltch.test', status: 'active', roles: ['teacher', 'assistant']},
  {uid: 'qa-assistant', display_name: 'Trợ giảng thử', email: 'tg@example.test', status: 'active', roles: ['assistant']},
  {uid: 'qa-parent', display_name: 'Phụ huynh thử', email: 'ph@example.test', status: 'active', roles: ['parent']}
];
const allQaAssistantPerms = ['attendance.write', 'materials.write', 'assignments.write', 'practice.manage', 'notices.write', 'messages.write', 'schedule.manage'];
let membershipsList = [
  {class_id: 'qa-class', uid: 'qa-admin', member_role: 'student', status: 'active', permissions: []},
  {class_id: 'qa-class', uid: 'qa-student', member_role: 'student', status: 'active', permissions: []},
  {class_id: 'class-12a1', uid: 'qa-student', member_role: 'student', status: 'active', permissions: []},
  ...classesState.map(c => ({class_id: c.id, uid: 'qa-teacher', member_role: 'teacher', status: 'active', permissions: []})),
  ...classesState.map(c => ({class_id: c.id, uid: 'qa-dual-staff', member_role: 'teacher', status: 'active', permissions: []})),
  ...classesState.map(c => ({class_id: c.id, uid: 'qa-dual-staff', member_role: 'assistant', status: 'active', permissions: allQaAssistantPerms})),
  ...classesState.map(c => ({
    class_id: c.id,
    uid: 'qa-assistant',
    member_role: 'assistant',
    status: 'active',
    permissions: c.id === 'class-12a1' ? ['attendance.write', 'materials.write'] : allQaAssistantPerms
  })),
  ...classesState.map(c => ({class_id: c.id, uid: 'qa-admin', member_role: 'assistant', status: 'active', permissions: allQaAssistantPerms})),
  {class_id: 'arch-12', uid: 'qa-teacher', member_role: 'teacher', status: 'active', permissions: []},
  {class_id: 'arch-12', uid: 'qa-dual-staff', member_role: 'teacher', status: 'active', permissions: []},
  {class_id: 'arch-12', uid: 'qa-dual-staff', member_role: 'assistant', status: 'active', permissions: allQaAssistantPerms},
  {class_id: 'arch-12', uid: 'qa-assistant', member_role: 'assistant', status: 'active', permissions: allQaAssistantPerms},
  {class_id: 'arch-12', uid: 'qa-student', member_role: 'student', status: 'inactive', permissions: []}
];
let parentLinksList = [
  {parent_uid: 'qa-parent', student_uid: 'qa-student', status: 'active'}
];
let forumPosts = [
  {
    id: 'qa-forum-pinned',
    class_id: null,
    title: 'Nội quy trao đổi bài và hướng dẫn gõ công thức Toán trên Diễn đàn',
    body: 'Các em ghi rõ buổi học liên quan và gõ công thức trong cặp dấu $...$, ví dụ $\\int_0^1 x^2\\,dx = \\frac{1}{3}$ để thầy cô và bạn học xem dễ dàng nhé.',
    author_uid: 'qa-teacher',
    author_name: 'Giáo viên thử',
    author_role: 'teacher',
    category: 'tip',
    session_number: null,
    pinned: true,
    resolved: true,
    accepted_comment_id: null,
    locked: false,
    edited_at: null,
    has_file: false,
    created_at: now - 86_400_000
  },
  {
    id: 'qa-forum-waiting',
    class_id: null,
    title: 'Nhờ cô gợi ý câu 5 BTVN Buổi 1 về cực trị hàm bậc ba',
    body: 'Em tìm được đạo hàm $y\' = 3x^2 - 6x + m$ nhưng chưa biết biện luận điều kiện để hàm số có hai điểm cực trị thỏa mãn $x_1^2 + x_2^2 = 10$.',
    author_uid: 'qa-student',
    author_name: 'Học sinh thử',
    author_role: 'student',
    category: 'homework',
    session_number: 1,
    pinned: false,
    resolved: false,
    accepted_comment_id: null,
    locked: false,
    edited_at: null,
    has_file: false,
    created_at: now - 3_600_000
  },
  {
    id: 'qa-forum-solved',
    class_id: null,
    title: 'Cách nhận diện nhanh tiệm cận xiên của đồ thị hàm phân thức',
    body: 'Khi bậc tử lớn hơn bậc mẫu đúng 1 bậc, ta chia đa thức hay dùng giới hạn $\\lim_{x \\to \\infty} [f(x) - (ax+b)] = 0$ sẽ nhanh hơn ạ?',
    author_uid: 'qa-student',
    author_name: 'Học sinh thử',
    author_role: 'student',
    category: 'lesson',
    session_number: 1,
    pinned: false,
    resolved: true,
    accepted_comment_id: 'qa-comment-accepted',
    locked: false,
    edited_at: null,
    has_file: false,
    created_at: now - 14_400_000
  }
];
let forumComments = {
  'qa-forum-solved': [
    {
      id: 'qa-comment-accepted',
      post_id: 'qa-forum-solved',
      body: 'Em thực hiện phép chia đa thức $f(x) = ax + b + \\frac{r(x)}{q(x)}$ với $\\deg r < \\deg q$ là suy ra ngay tiệm cận xiên $y = ax + b$ trong 1 bước nhé!',
      author_uid: 'qa-teacher',
      author_name: 'Giáo viên thử',
      author_role: 'teacher',
      has_file: false,
      edited_at: null,
      created_at: now - 10_800_000
    }
  ]
};
let attendanceRows = [
  {id: 'qa-class_qa-student_2026-11-18', class_id: 'qa-class', student_uid: 'qa-student', lesson_date: '2026-11-18', status: 'present', note: 'Hoàn thành tốt bài trên lớp', updated_at: Date.now() - 86400000},
  {id: 'qa-class_qa-admin_2026-11-18', class_id: 'qa-class', student_uid: 'qa-admin', lesson_date: '2026-11-18', status: 'late', note: 'Đi muộn 5 phút', updated_at: Date.now() - 86400000},
  {id: 'qa-class_qa-student_2026-11-15', class_id: 'qa-class', student_uid: 'qa-student', lesson_date: '2026-11-15', status: 'excused', note: 'Phụ huynh xin phép nghỉ', updated_at: Date.now() - 4 * 86400000},
  {id: 'class-8a_qa-admin_2026-11-18', class_id: 'class-8a', student_uid: 'qa-admin', lesson_date: '2026-11-18', status: 'present', note: '', updated_at: Date.now() - 86400000},
  {id: 'class-8a_qa-admin_2026-11-15', class_id: 'class-8a', student_uid: 'qa-admin', lesson_date: '2026-11-15', status: 'late', note: 'Đến muộn 5 phút', updated_at: Date.now() - 4 * 86400000},
  {id: 'class-8a_qa-child_2026-11-18', class_id: 'class-8a', student_uid: 'qa-child', lesson_date: '2026-11-18', status: 'present', note: 'Chủ động phát biểu', updated_at: Date.now() - 86400000},
  {id: 'class-8a_qa-child_2026-11-11', class_id: 'class-8a', student_uid: 'qa-child', lesson_date: '2026-11-11', status: 'absent', note: 'Chưa thấy báo phép', updated_at: Date.now() - 8 * 86400000}
];
let sessionsByClass = {};
let practiceSolutionsByClass = {};
let classroomAttempts = new Map();
let workspaceAttempts = [];

const samplePracticeAccess = {
  displayName: account.display_name,
  birthDate: '15/06/2009',
  studentCode: 'LTCH001',
  activeGrades: [12],
  allowedRooms: ['thptqg', 'hsa', 'tsa'],
  examYear: 2027,
  isStaff: true,
  canManageAny: true
};
let samplePracticeExams = [
  {
    id: 'qa-thptqg-01',
    title: '[LTCH] Đề thi thử THPTQG môn Toán – Đề số 01',
    examType: 'thptqg',
    examCode: 'THPT-01',
    questionCount: 6,
    year: 2027,
    status: 'published',
    canManage: true,
    durationMinutes: 90,
    sections: [{key: 'all', label: 'Đề thi môn Toán THPTQG', durationMinutes: 90}],
    sectionCounts: {all: 6}
  },
  {
    id: 'qa-hsa-01',
    title: '[LTCH] Đề thi thử Đánh giá năng lực HSA – Đề số 01',
    examType: 'hsa',
    examCode: 'HSA-01',
    questionCount: 6,
    year: 2027,
    status: 'published',
    canManage: true,
    durationMinutes: 195,
    sections: [
      {key: 'part_1', label: 'Phần 1: Tư duy Định lượng', durationMinutes: 75},
      {key: 'part_2', label: 'Phần 2: Tư duy Định tính', durationMinutes: 60},
      {key: 'part_3', label: 'Phần 3: Khoa học / Tiếng Anh', durationMinutes: 60}
    ],
    sectionCounts: {part_1: 2, part_2: 2, part_3: 2}
  },
  {
    id: 'qa-tsa-01',
    title: '[LTCH] Đề thi thử Đánh giá tư duy TSA – Đề số 01',
    examType: 'tsa',
    examCode: 'TSA-01',
    questionCount: 6,
    year: 2027,
    status: 'published',
    canManage: true,
    durationMinutes: 150,
    sections: [
      {key: 'part_1', label: 'Tư duy Toán học', durationMinutes: 60},
      {key: 'part_2', label: 'Tư duy Đọc hiểu', durationMinutes: 30},
      {key: 'part_3', label: 'Tư duy Khoa học', durationMinutes: 60}
    ],
    sectionCounts: {part_1: 2, part_2: 2, part_3: 2}
  }
];

const formatViSessionDate = (isoDate = '2026-09-01', start = '18:00', end = '19:30') => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
  const d = m ? `${m[3]}/${m[2]}/${m[1]}` : String(isoDate || '01/09/2026');
  return start && end ? `${d} (${start}–${end})` : d;
};

const getSessionsForClass = (classId, schedule) => {
  if (!sessionsByClass[classId]) {
    sessionsByClass[classId] = [
      {
        sessionNumber: 1,
        title: 'Buổi 1: Bài giảng thử',
        lessonName: 'Bài giảng thử',
        cleanTopic: 'Dữ liệu cục bộ',
        date: '2026-09-01',
        sessionDate: '2026-09-01',
        start: '18:00',
        end: '19:30',
        formattedDate: formatViSessionDate('2026-09-01', '18:00', '19:30'),
        lessonId: 'qa-lesson',
        explicit: true,
        persisted: true,
        driveSynced: true,
        videos: [
          {
            id: 'qa-video-1',
            name: 'Video bài giảng thử',
            fileId: '1ZGwXOnASvyG4OzSk63DrsxIgJX9IQDT7',
            lessonId: 'qa-lesson',
            url: `/api/classes/${classId}/lessons/qa-lesson/files/qa-file-1`
          }
        ],
        files: [
          {
            id: 'qa-file-1',
            lessonId: 'qa-lesson',
            name: 'Bài mẫu PDF',
            file_size: 1024,
            content_type: 'application/pdf',
            created_at: 1790000000000
          }
        ],
        homeworkFiles: [
          {
            id: 'qa-hw-1',
            lessonId: 'qa-lesson',
            name: '[BTVN] Phiếu bài tập Buổi 1.pdf',
            size: 1024,
            created_at: 1790000000000
          }
        ]
      },
      {
        sessionNumber: 2,
        title: 'Buổi 2: Cực trị của hàm số',
        lessonName: 'Cực trị của hàm số',
        cleanTopic: 'Giải tích 12',
        date: '2026-09-04',
        sessionDate: '2026-09-04',
        start: '18:00',
        end: '19:30',
        formattedDate: formatViSessionDate('2026-09-04', '18:00', '19:30'),
        lessonId: 'qa-lesson-2',
        explicit: true,
        persisted: true,
        driveSynced: true,
        videos: [],
        files: [],
        homeworkFiles: []
      }
    ];
  }
  return sessionsByClass[classId];
};

const getExamSolutionsState = (exam) => {
  const examId = exam?.id || 'qa-thptqg-01';
  if (!practiceSolutionsByClass[examId]) {
    const isThpt = examId === 'qa-thptqg-01';
    practiceSolutionsByClass[examId] = {
      examId,
      topic: isThpt ? 'Hàm số & Hình không gian' : '',
      solutionNote: '',
      date: isThpt ? '2026-10-15' : '',
      formattedDate: isThpt ? '15/10/2026' : '',
      coverFileId: null,
      examFiles: [
        {
          id: `source-${examId}`,
          sourceType: 'exam_source',
          driveFileId: `qa-drive-src-${examId}`,
          name: `${exam?.examCode || 'DE'}-de-thi.docx`,
          content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          file_size: 16384,
          downloadPath: `/api/practice/exams/${examId}/solutions/source/qa-drive-src-${examId}`
        }
      ],
      videos: isThpt
        ? [{id: 'qa-sol-vid-1', fileKind: 'video', name: 'Video chữa chi tiết Đề 1.mp4', content_type: 'video/mp4', file_size: 1048576, created_at: now}]
        : [],
      files: isThpt
        ? [{id: 'qa-sol-doc-1', fileKind: 'document', name: 'Lời giải chi tiết Đề 1.pdf', content_type: 'application/pdf', file_size: 1024, created_at: now - 1}]
        : []
    };
  }
  return practiceSolutionsByClass[examId];
};

const formatScheduleSummary = (slots) => {
  if (!Array.isArray(slots) || !slots.length) return '';
  try { return scheduleText(slots); } catch { return ''; }
};

const buildSamplePdf = (label = 'LTCH PDF preview test') => {
  const stream = `BT /F1 24 Tf 50 750 Td (${label}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, obj] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
};

const SAMPLE_MP4_BYTES = Buffer.from(
  'AAAAHGZ0eXBpc29tAAACAGlzb21pc28ybXA0MQAAA5Jtb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAAPoAAAMgAABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAACvXRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAMgAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAACgAAAAWgAAAAAACRlZHRzAAAAHGVsc3QAAAAAAAAAAQAADIAAAAAAAAEAAAAAAjVtZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAACgAAACAAFXEAAAAAAAtaGRscgAAAAAAAAAAdmlkZQAAAAAAAAAAAAAAAFZpZGVvSGFuZGxlcgAAAAHgbWluZgAAABR2bWhkAAAAAQAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAABoHN0YmwAAACoc3RzZAAAAAAAAAABAAAAmHZwMDkAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAACgAFoAEgAAABIAAAAAAAAAAEXTGF2YzYzLjEuMTAyIGxpYnZweC12cDkAAAAAAAAAAAAY//8AAAAUdnBjQwEAAAAAFYICAgIAAAAAAApmaWVsAQAAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAAMWgAAAAAAAAAYc3R0cwAAAAAAAAABAAAAIAAABAAAAAAUc3RzcwAAAAAAAAABAAAAAQAAABxzdHNjAAAAAAAAAAEAAAABAAAAIAAAAAEAAACUc3RzegAAAAAAAAAAAAAAIAAAAYkAAAAgAAAAHAAAABwAAAAcAAAAHAAAABwAAAAcAAAAHAAAABwAAAAcAAAAHAAAABwAAAAcAAAAHAAAABwAAAAcAAAAHAAAABwAAAAcAAAAHAAAABwAAAAcAAAAHAAAABwAAAAcAAAAHAAAABwAAAAcAAAAHAAAABwAAAAcAAAAFHN0Y28AAAAAAAAAAQAAA74AAABhdWR0YQAAAFltZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAACxpbHN0AAAAJKl0b28AAAAcZGF0YQAAAAEAAAAATGF2ZjYzLjEuMTAyAAAACGZyZWUAAAT5bWRhdIJJg0IAJ/AWdgg4JBwYShABeH+R47s3t4Nf/P9it9h72opoXpHaOvcCkNcXTFol3p9XfWXWXEWA6v+pxOV+sFAAAAAAo3jYf2AwjeR7xLgyBtuMOPpVq7qb+9BrZMD4lPGRnbJ9ma9rrJowmyKxms6wB3JAqapt4tNOA1TqvuEgjBc5Pf3tOcseg9OKYrYceg9OKYrYceg9ObgG56xglH4AAEHHWEyTB2NZNxZzMEzr4F2Cc3QkJ4q6xhpfxqqWyxDmXdWDXOD6PYzlHatXwRpAWW8nH8/ZAAOwqLMJkl8rbanczEr2oAB42H9gMI8O7AJnZNFhJUsad0gfYWvrfvJDGYSjP50OF9PAfu/87rp/iNF6A4ovoR6rUhukvoQb+FftqpgS3zeVPTkzlm9jRKADUAbbsdJAEE8lFsKYPPJhxSv0qPdUVYgAVfRqcANi7wn70C3zY/cx8lap/6FlHqUv9m2ojUqEd/gUpaBxH4C0YLKHqFnVf6FJRa+aqSfD39n1McHycryMAIYAQJKcEFABAAOAJ6jyPxgAAAAAAAVaZwyAAFpnDIAAhgBAkpwQTuEAAYAgAAAAAAAFWmcMgABaZwyAAIYAQJKcEFABAAGAIAAAAAAABVpnDIAAWmcMgACGAECSnBBNQQABgCAAAAAAAAVaZwyAAFpnDIAAhgBAkpwQUAEAAYAgAAAAAAAFWmcMgABaZwyAAIYAQJKcEE7hAAGAIAAAAAAABVpnDIAAWmcMgACGAECSnBBQAQABgCAAAAAAAAVaZwyAAFpnDIAAhgBAkpwQSiEAAYAgAAAAAAAFWmcMgABaZwyAAIYAQJKcEFABAAGAIAAAAAAABVpnDIAAWmcMgACGAMCSnBBKIQABgCAAAAAAAAVaZwyAAFpnDIAAhgBAkpwQUAEAAYAgAAAAAAAFWmcMgABaZwyAAIYAQJKcEE1BAAGAIAAAAAAABVpnDIAAWmcMgACGAECSnBBQAQABgCAAAAAAAAVaZwyAAFpnDIAAhgBAkpwQTuEAAYAgAAAAAAAFWmcMgABaZwyAAIYAQJKcEFABAAGAIAAAAAAABVpnDIAAWmcMgACGAECSnBBKIQABgCAAAAAAAAVaZwyAAFpnDIAAhgBAkpwQUAEAAYAgAAAAAAAFWmcMgABaZwyAAIYAQJKcEE7hAAGAIAAAAAAABVpnDIAAWmcMgACGAECSnBBQAQABgCAAAAAAAAVaZwyAAFpnDIAAhgDAkpwQSiEAAYAgAAAAAAAFWmcMgABaZwyAAIYAQJKcEFABAAGAIAAAAAAABVpnDIAAWmcMgACGAECSnBBO4QABgCAAAAAAAAVaZwyAAFpnDIAAhgBAkpwQUAEAAYAgAAAAAAAFWmcMgABaZwyAAIYAQJKcEEohAAGAIAAAAAAABVpnDIAAWmcMgACGAECSnBBQAQABgCAAAAAAAAVaZwyAAFpnDIAAhgBAkpwQTuEAAYAgAAAAAAAFWmcMgABaZwyAAIYAQJKcEFABAAGAIAAAAAAABVpnDIAAWmcMgACGAECSnBBNQQABgCAAAAAAAAVaZwyAAFpnDIAAhgBAkpwQUAEAAYAgAAAAAAAFWmcMgABaZwyAAIYAwJKcEEohAAGAIAAAAAAABVpnDIAAWmcMgACGAECSnBBQAQABgCAAAAAAAAVaZwyAAFpnDIAA',
  'base64'
);

const viewer = {uid: account.uid, name: account.display_name, roles: account.roles, memberships: [{class_id: 'qa-class', member_role: 'student'}], childMemberships: [{class_id: 'qa-class', uid: 'qa-child'}]};
const materialRows = Array.from({length:101},(_,i)=>({id:`qa-material-${String(i).padStart(3,'0')}`,title:`Tài liệu thử ${i+1}`,topic:'Chỉ kiểm thử cục bộ',content_type:'application/pdf',created_at:now-i}));
const lessonRows = [{id:'qa-lesson',title:'Bài giảng thử',topic:'Dữ liệu cục bộ',created_at:now}];
const lessonFiles = [{id:'qa-file-1',name:'Đề mẫu.pdf',content_type:'application/pdf',file_size:100,created_at:now},{id:'qa-file-2',name:'Bài tập mẫu.docx',content_type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',file_size:120,created_at:now-1}];

// Mock enrollments cho Admin phê duyệt
let mockEnrollments = [
  {
    id: 'enr-001',
    version: 1,
    uid: 'student-new-001',
    applicantRole: 'student',
    fullName: 'Nguyễn Minh Quân',
    dateOfBirth: '2010-04-21',
    schoolYearId: 'qa-year',
    studentPhone: '0912345678',
    schoolName: 'THPT Chuyên Hà Nội - Amsterdam',
    classId: 'class-12a1',
    className: '12',
    parentName: 'Nguyễn Văn Hoàng',
    parentPhone: '0987654321',
    parentRelation: 'father',
    studyStatus: 'Học sinh đang theo học tại lớp offline của cô Hạnh',
    referral: 'Bạn cùng lớp giới thiệu',
    status: 'pending',
    createdAt: now - 3600000,
    photoUrl: ''
  },
  {
    id: 'enr-002',
    version: 1,
    uid: 'student-new-002',
    applicantRole: 'student',
    fullName: 'Trần Thảo Linh',
    dateOfBirth: '2010-08-15',
    schoolYearId: 'qa-year',
    studentPhone: '0901234567',
    schoolName: 'THPT Chu Văn An',
    classId: 'class-10a2',
    className: '10A2',
    parentName: 'Trần Thu Hà',
    parentPhone: '0918765432',
    parentRelation: 'mother',
    studyStatus: 'Học sinh mới đăng ký bồi dưỡng',
    referral: 'Tìm kiếm trên mạng',
    status: 'needs_revision',
    adminNotes: 'Em đăng ký nhầm lớp 10B của năm ngoái, vui lòng chọn lại lớp 11 và cập nhật lại SĐT của phụ huynh.',
    createdAt: now - 7200000,
    photoUrl: ''
  },
  {
    id: 'enr-003',
    version: 1,
    uid: 'qa-parent-req',
    applicantRole: 'parent',
    fullName: 'Phạm Thu Hằng',
    dateOfBirth: '2010-01-10',
    schoolYearId: 'qa-year',
    studentPhone: '',
    schoolName: 'THPT Cầu Giấy',
    classId: 'qa-class',
    className: 'Lớp kiểm tra giao diện',
    parentName: 'Phạm Thu Hằng',
    parentPhone: '0911222333',
    parentRelation: 'mother',
    status: 'pending',
    createdAt: now - 5400000,
    photoUrl: ''
  }
];

let currentUserEnrollment = {
  hasRequest: false,
  status: 'none'
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:5181');
  const respond = (v, status = 200) => {
    res.writeHead(status, {'content-type': 'application/json'});
    res.end(JSON.stringify(v));
  };

  if (url.pathname.startsWith('/api/')) {
    const rawChunks = [];
    for await (const chunk of req) rawChunks.push(chunk);
    const rawBytes = Buffer.concat(rawChunks);
    const raw = rawBytes.toString('utf8');
    let body = {};
    const ctype = req.headers['content-type'] || '';
    if (raw && ctype.includes('json')) {
      try { body = JSON.parse(raw); } catch (_) { body = {}; }
    } else if (raw && ctype.includes('multipart/form-data')) {
      const m = /boundary=([^\s;]+)/.exec(ctype);
      if (m) {
        const boundary = m[1].replace(/^["']|["']$/g, '');
        for (const part of raw.split('--' + boundary)) {
          const nameMatch = /name="([^"]+)"/.exec(part);
          if (!nameMatch || /filename="/.test(part)) continue;
          const idx = part.indexOf('\r\n\r\n');
          if (idx !== -1) body[nameMatch[1]] = part.slice(idx + 4).replace(/\r\n$/, '');
        }
      }
    }

    // Enrollment API routes
    if (url.pathname === '/api/enrollment/catalog') {
      return respond({classes: classesState.filter(c => !c.archived).map(klass => ({...klass, school_year_id: klass.school_year_id || 'qa-year'})), years: yearsList});
    }
    if (url.pathname === '/api/enrollment/my-status') {
      return respond(currentUserEnrollment);
    }
    if (url.pathname === '/api/enrollment/submit' && req.method === 'POST') {
      const newEnr = {
        id: 'enr-' + Date.now(),
        version: 1,
        uid: account.uid,
        applicantRole: body.applicantRole || 'student',
        ...body,
        status: 'pending',
        createdAt: Date.now()
      };
      mockEnrollments.unshift(newEnr);
      currentUserEnrollment = {hasRequest: true, status: 'pending', request: newEnr};
      return respond({ok: true, status: 'pending'});
    }
    if (url.pathname === '/api/enrollment/staff-request' && req.method === 'POST') {
      return respond({ok: true, notificationStatus: 'sent'});
    }
    if (url.pathname === '/api/enrollment/urgent-notify' && req.method === 'POST') {
      return respond({ok: true, message: 'Đã gửi thông báo ưu tiên tới Quản trị viên'});
    }
    if (url.pathname === '/api/admin/enrollments/students' && req.method === 'GET') {
      const activeStudents = usersList.filter(u => u.roles.includes('student') && u.status === 'active');
      return respond({items: activeStudents.map(u => ({uid: u.uid, name: u.display_name, studentCode: u.student_code || 'LTCH001'}))});
    }
    if (url.pathname === '/api/admin/enrollments' && req.method === 'GET') {
      return respond({items: mockEnrollments});
    }
    if (url.pathname === '/api/admin/enrollments/review' && req.method === 'POST') {
      const target = mockEnrollments.find(e => e.id === body.requestId || e.uid === body.studentUid);
      if (target) {
        if (body.action === 'approve') {
          target.status = 'approved';
          target.classId = body.classId || target.classId;
        } else if (body.action === 'request_revision') {
          target.status = 'needs_revision';
          target.adminNotes = body.adminNotes || body.notes || 'Vui lòng kiểm tra lại thông tin';
        } else if (body.action === 'reject') {
          target.status = 'rejected';
        }
      }
      return respond({ok: true, studentCode: target?.applicantRole === 'parent' ? undefined : 'LTCH999'});
    }
    if (url.pathname === '/api/admin/mail/retry' && req.method === 'POST') {
      return respond({ok: true, sent: 1, pending: 0});
    }

    if (url.pathname === '/api/notices/drafts' && req.method === 'POST') {
      if (!noticeDrafts.has(body.id)) noticeDrafts.set(body.id, {...body, class_id: body.classId, created_by: viewer.uid, created_at: Date.now(), status: 'draft', attachments: []});
      return respond({id: body.id, status: noticeDrafts.get(body.id).status}, 201);
    }
    const noticeAction = /^\/api\/notices\/([^/]+)\/(publish|edit|files)(?:\/([^/]+)(?:\/(chunks|ticket))?)?$/.exec(url.pathname);
    if (noticeAction) {
      const [, noticeId, action, fileId, fileAction] = noticeAction;
      const notice = noticeDrafts.get(noticeId) || notices.find(item => item.id === noticeId);
      if (!notice) return respond({error: 'Không tìm thấy thông báo.'}, 404);
      if (action === 'publish') {
        if (notice.status !== 'published') {
          notice.status = 'published';
          notices.unshift(notice);
        }
        return respond({ok: true, id: noticeId, notificationStatus: 'queued', notifiedCount: 2});
      }
      if (action === 'edit') {
        notice.title = body.title;
        notice.body = body.body;
        return respond({ok: true});
      }
      if (!fileId && req.method === 'POST') {
        const file = {id: `file-${body.requestId}`, notice_id: noticeId, name: body.name, content_type: body.contentType, file_size: body.size, chunks: [], offset: 0};
        noticeFiles.set(file.id, file);
        return respond({id: file.id, uploadToken: 'mock-token', chunkSize: 8 * 1024 * 1024, totalSize: body.size}, 201);
      }
      const file = noticeFiles.get(fileId);
      if (!file) return respond({error: 'Không tìm thấy tệp.'}, 404);
      if (fileAction === 'chunks' && req.method === 'POST') {
        if (url.searchParams.get('status') !== '1' && Number(url.searchParams.get('offset')) === file.offset && file.offset < file.file_size) {
          file.chunks.push(rawBytes);
          file.offset += rawBytes.length;
        }
        if (file.offset < file.file_size) return respond({id: file.id, state: 'uploading', offset: file.offset});
        if (!notice.attachments.some(item => item.id === file.id)) notice.attachments.push({id: file.id, name: file.name, content_type: file.content_type, file_size: file.file_size});
        return respond({id: file.id, state: 'uploaded', offset: file.offset});
      }
      if (fileAction === 'ticket' && req.method === 'GET') return respond({url: `http://127.0.0.1:5181/api/notice-media?ticket=${encodeURIComponent(fileId)}`});
    }
    if (url.pathname === '/api/notice-media') {
      const file = noticeFiles.get(url.searchParams.get('ticket'));
      if (!file) return respond({error: 'Không tìm thấy tệp.'}, 404);
      const bytes = Buffer.concat(file.chunks);
      const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      if (match) {
        const start = Number(match[1]), end = match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
        res.writeHead(206, {'content-type': file.content_type, 'content-range': `bytes ${start}-${end}/${bytes.length}`, 'content-length': end - start + 1, 'accept-ranges': 'bytes'});
        return res.end(bytes.subarray(start, end + 1));
      }
      res.writeHead(200, {'content-type': file.content_type, 'content-length': bytes.length, 'accept-ranges': 'bytes'});
      return res.end(bytes);
    }
    if (url.pathname === '/api/video-media') {
      const ticket = url.searchParams.get('ticket');
      if (!ticket || ticket === 'invalid') return respond({error: 'Liên kết phát video không hợp lệ.'}, 403);
      const bytes = SAMPLE_MP4_BYTES;
      if (req.method === 'HEAD') {
        res.writeHead(200, {'content-type': 'video/mp4', 'content-length': bytes.length, 'accept-ranges': 'bytes'});
        return res.end();
      }
      const match = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '').trim());
      if (req.headers.range && (!match || (!match[1] && !match[2]))) {
        res.writeHead(416, {'content-range': `bytes */${bytes.length}`, 'accept-ranges': 'bytes'});
        return res.end();
      }
      if (match) {
        const start = !match[1] ? Math.max(0, bytes.length - Number(match[2])) : Number(match[1]);
        const end = !match[1] ? bytes.length - 1 : match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
        if (start >= bytes.length || end < start) {
          res.writeHead(416, {'content-range': `bytes */${bytes.length}`, 'accept-ranges': 'bytes'});
          return res.end();
        }
        res.writeHead(206, {
          'content-type': 'video/mp4',
          'content-range': `bytes ${start}-${end}/${bytes.length}`,
          'content-length': end - start + 1,
          'accept-ranges': 'bytes'
        });
        return res.end(bytes.subarray(start, end + 1));
      }
      res.writeHead(200, {'content-type': 'video/mp4', 'content-length': bytes.length, 'accept-ranges': 'bytes'});
      return res.end(bytes);
    }

    const overviewAssignments = assignments.map(a => ({...a, title: a.title || 'Bài tập về nhà Buổi 14', class_id: a.class_id || 'class-9a'}));
    if (url.pathname === '/api/overview') {
      const requestedRole = url.searchParams.get('role') || account.roles[0] || 'admin';
      const effectiveRole = ['admin', 'teacher', 'assistant', 'student', 'parent'].includes(requestedRole) ? requestedRole : 'admin';
      const openClasses = classesState.filter(c => !c.archived);
      const isStaff = ['admin', 'teacher', 'assistant'].includes(effectiveRole);
      const nowTs = Date.now();
      if (isStaff) {
        const assignmentStats = {};
        for (const a of overviewAssignments) {
          assignmentStats[a.id] = {submittedCount: 14, ungradedCount: 3, expectedStudents: 18};
        }
        const classHealth = openClasses.map((c, idx) => ({
          classId: c.id,
          className: c.name,
          studentCount: 14 + (idx % 7) * 2,
          attendanceRatePct: idx === 2 ? 82 : 92 + (idx % 7),
          attendanceTotal: 45,
          attendanceAbsent: idx === 2 ? 8 : 2,
          lessonWithFilesCount: 6 + (idx % 5),
          openAssignmentsCount: overviewAssignments.filter(a => a.class_id === c.id).length || (idx % 2),
          ungradedCount: idx === 0 ? 2 : idx === 4 ? 3 : 0,
          unansweredForumCount: idx === 0 ? 1 : 0
        }));
        return respond({
          assignments: overviewAssignments,
          notices,
          dashboard: {
            role: effectiveRole,
            mode: 'staff',
            generatedAt: nowTs,
            canReviewEnrollments: effectiveRole === 'admin' || effectiveRole === 'teacher',
            canCheckPractice: true,
            kpis: {
              activeStudents: 148,
              classCount: openClasses.length,
              attendance30d: {ratePct: 94, present: 312, late: 18, absent: 14, excused: 7, total: 351},
              ungradedCount: 5,
              openAssignmentsCount: overviewAssignments.length,
              pendingEnrollmentsCount: mockEnrollments.filter(e => ['pending', 'needs_revision'].includes(e.status)).length,
              openQuestionReportsCount: 1,
              unansweredForumCount: 1,
              practice7d: {count: 24, avgScore10: 8.4}
            },
            actionQueue: [
              {
                type: 'enrollment',
                id: 'enr-001',
                title: 'Nguyễn Minh Quân',
                subtitle: 'Lớp 12 · Học sinh',
                badge: 'Chờ duyệt',
                timestamp: nowTs - 3600000,
                target: {page: 'enrollments'}
              },
              {
                type: 'grading',
                id: overviewAssignments[0]?.id || 'qa-assignment',
                title: overviewAssignments[0]?.title || 'Bài tập kiểm tra giao diện',
                subtitle: 'Lớp 9A · 3 bài chờ nhận xét',
                badge: '3 chờ chấm',
                timestamp: nowTs - 1800000,
                target: {classId: overviewAssignments[0]?.class_id || 'class-9a', tab: 'assignments', subPage: 'buoi-1'}
              },
              {
                type: 'forum',
                id: 'qa-forum-waiting',
                title: 'Nhờ cô gợi ý câu 5 BTVN Buổi 1 về cực trị hàm bậc ba',
                subtitle: 'Lớp 12 · Học sinh thử chưa có phản hồi',
                badge: 'Chưa trả lời',
                timestamp: nowTs - 3600000,
                target: {classId: openClasses[0]?.id || 'class-12a1', tab: 'forum', subPage: 'qa-forum-waiting'}
              },
              {
                type: 'question_report',
                id: 'q-reports',
                title: '1 báo lỗi câu hỏi phòng luyện',
                subtitle: 'Cần rà soát nội dung / đáp án trong Phòng luyện',
                badge: '1 báo lỗi',
                timestamp: nowTs - 7200000,
                target: {page: 'practice'}
              }
            ],
            assignmentStats,
            classHealth,
            recentActivity: [
              {
                type: 'submission',
                id: 'sub-qa-1',
                title: 'Học sinh thử đã nộp bài',
                subtitle: 'Lớp 9A · Bài tập kiểm tra giao diện',
                statusLabel: 'Chờ nhận xét',
                timestamp: nowTs - 900000,
                target: {classId: 'class-9a', tab: 'assignments', subPage: 'buoi-1'}
              },
              {
                type: 'lesson_file',
                id: 'lesson-qa-1',
                title: 'Buổi 1: Bài giảng thử',
                subtitle: 'Lớp 9A · Bài mẫu PDF',
                statusLabel: 'Học liệu mới',
                timestamp: nowTs - 5400000,
                target: {classId: 'class-9a', tab: 'materials', subPage: 'buoi-1'}
              }
            ]
          }
        });
      }

      const assignmentStatus = {};
      for (const a of overviewAssignments) {
        assignmentStatus[a.id] = {
          status: effectiveRole === 'parent' ? 'graded' : 'missing',
          storedAt: effectiveRole === 'parent' ? nowTs - 7200000 : null,
          feedbackPreview: effectiveRole === 'parent' ? 'Trình bày sạch đẹp, lưu ý kiểm tra điều kiện xác định.' : '',
          ...(effectiveRole === 'parent' ? {studentName: 'Học sinh thử'} : {})
        };
      }
      return respond({
        assignments: overviewAssignments,
        notices,
        dashboard: {
          role: effectiveRole,
          mode: effectiveRole,
          generatedAt: nowTs,
          ...(effectiveRole === 'parent'
            ? {children: [{uid: 'qa-student', name: 'Học sinh thử', studentCode: 'LTCH001', classIds: ['class-12a1'], classNames: ['12']}]}
            : {}),
          kpis: {
            attendance: {ratePct: 95, present: 18, late: 1, absent: 0, excused: 1, total: 20},
            homework: {
              totalOpen: overviewAssignments.length,
              submittedOpen: effectiveRole === 'parent' ? overviewAssignments.length : 0,
              pendingOpen: effectiveRole === 'parent' ? 0 : overviewAssignments.length,
              gradedTotal: 2
            },
            practice: {attemptCount: 4, avgScore10: 8.6, latestScore: 8.8, latestMaxScore: 10, latestExamTitle: '[LTCH] Đề thi thử THPT Quốc gia – Đề số 01'},
            materials: {lessonsWithFilesCount: 5, latestLessonTitle: 'Buổi 1: Bài giảng thử', latestSessionNumber: 1, latestClassId: 'class-12a1'},
            ...(effectiveRole !== 'parent' ? {forum: {recentCount: forumPosts.length, openCount: 1, myPostsCount: 2, myAnsweredCount: 1}} : {}),
            gradedCount: 2
          },
          assignmentStatus,
          recentLessons: [
            {
              lessonId: 'qa-lesson',
              classId: 'class-12a1',
              className: '12',
              title: 'Buổi 1: Bài giảng thử',
              sessionNumber: 1,
              videoCount: 1,
              docCount: 1,
              latestFileAt: nowTs - 7200000
            }
          ],
          recentFeedback: [
            {
              assignmentId: overviewAssignments[0]?.id || 'qa-assignment',
              classId: overviewAssignments[0]?.class_id || 'class-9a',
              className: '9A',
              assignmentTitle: overviewAssignments[0]?.title || 'Bài tập kiểm tra giao diện',
              sessionNumber: 1,
              feedbackPreview: 'Làm tốt các câu tự luận, chú ý kết luận nghiệm đầy đủ.',
              storedAt: nowTs - 18000000,
              ...(effectiveRole === 'parent' ? {studentName: 'Học sinh thử'} : {})
            }
          ],
          recentPractice: [
            {
              attemptId: 'qa-att-1',
              examId: 'qa-thptqg-01',
              examTitle: '[LTCH] Đề thi thử THPT Quốc gia – Đề số 01',
              examType: 'thptqg',
              classId: 'class-12a1',
              score: 8.8,
              maxScore: 10,
              submittedAt: nowTs - 86400000,
              ...(effectiveRole === 'parent' ? {studentName: 'Học sinh thử'} : {})
            }
          ],
          recentAttendance: [
            {lessonDate: '2026-11-18', classId: 'class-12a1', className: '12', status: 'present', note: '', ...(effectiveRole === 'parent' ? {studentName: 'Học sinh thử'} : {})},
            {lessonDate: '2026-11-15', classId: 'class-12a1', className: '12', status: 'late', note: 'Đến muộn 5 phút', ...(effectiveRole === 'parent' ? {studentName: 'Học sinh thử'} : {})},
            {lessonDate: '2026-11-11', classId: 'class-12a1', className: '12', status: 'present', note: '', ...(effectiveRole === 'parent' ? {studentName: 'Học sinh thử'} : {})}
          ],
          ...(effectiveRole !== 'parent'
            ? {
                recentForumPosts: forumPosts.slice(0, 4).map(p => ({
                  postId: p.id,
                  classId: p.class_id || 'class-12a1',
                  className: '12',
                  title: p.title,
                  authorName: p.author_name,
                  isMine: p.author_uid === 'qa-student',
                  category: p.category || 'general',
                  sessionNumber: p.session_number || null,
                  resolved: Boolean(p.resolved || p.accepted_comment_id),
                  pinned: Boolean(p.pinned),
                  commentCount: (forumComments[p.id] || []).length,
                  createdAt: p.created_at,
                  latestActivityAt: p.created_at,
                  target: {classId: p.class_id || 'class-12a1', tab: 'forum', subPage: p.id}
                }))
              }
            : {})
        }
      });
    }
    if (url.pathname === '/api/health') return respond({ok: true, ready: true});
    if (url.pathname === '/api/profile') {
      if (req.method === 'POST') {
        const nextName = typeof body.name === 'string' ? body.name.trim() : '';
        if (!nextName || nextName.length > 160) {
          return respond({error: 'Vui lòng nhập họ và tên hiển thị hợp lệ (tối đa 160 ký tự).'}, 400);
        }
        const nextPhone = typeof body.phone === 'string' ? body.phone.trim() : '';
        if (nextPhone && !/^[0-9+() -]{8,30}$/.test(nextPhone)) {
          return respond({error: 'Số điện thoại liên hệ không hợp lệ (cần 8–30 ký tự gồm chữ số, khoảng trắng, dấu + hoặc -).'}, 400);
        }
        account.display_name = nextName;
        viewer.name = nextName;
        account.contact_phone = nextPhone;
        return respond({ok: true, display_name: account.display_name, contact_phone: account.contact_phone});
      }
      const accountRoles = Array.isArray(account.roles) ? account.roles : [];
      const isStaffRole = accountRoles.some(r => r === 'admin' || r === 'teacher' || r === 'assistant');
      const isParentRole = !isStaffRole && accountRoles.includes('parent');
      const isStudentRole = !isStaffRole && accountRoles.includes('student');
      return respond({
        display_name: account.display_name,
        contact_phone: account.contact_phone || '',
        student_code: !isStaffRole && (isStudentRole || isParentRole) ? 'LTCH001' : null,
        own_student_code: isStudentRole ? 'LTCH001' : null,
        email: account.email,
        status: account.status || 'active',
        roles: account.roles,
        created_at: '2026-09-01T08:00:00.000Z',
        enrollment: !isStaffRole ? {
          id: 'qa-req-self',
          applicantRole: 'student',
          status: 'approved',
          fullName: account.display_name,
          dateOfBirth: '2009-05-14',
          schoolName: 'THPT Chuyên Hà Nội - Amsterdam',
          studentPhone: account.contact_phone || '0912345678',
          parentName: 'Nguyễn Thị Lan',
          parentPhone: '0987654321',
          parentRelation: 'mother',
          hasPhoto: false,
          photoUrl: null,
          createdAt: '2026-09-01T08:00:00.000Z',
          updatedAt: '2026-09-02T09:00:00.000Z'
        } : null,
        linked_students: isParentRole
          ? [{uid: 'qa-student', display_name: 'Học sinh thử', student_code: 'LTCH001', class_ids: ['qa-class', 'class-12a1']}]
          : [],
        linked_parents: isStudentRole
          ? [{uid: 'qa-parent', display_name: 'Phụ huynh thử', contact_phone: '0987654321', email: 'ph@example.test'}]
          : []
      });
    }
    if (url.pathname === '/api/auth/begin') return respond({challengeId: 'qa', expiresAt: Date.now() + 300000});
    if (url.pathname === '/api/auth/complete') return respond({token: 'q'.repeat(43), expiresAt: Date.now() + 60000});
    if (url.pathname === '/api/auth/logout') return respond({ok: true});
    if (url.pathname === '/api/bootstrap') return respond({accountStatus: 'active', me: {...viewer, name: account.display_name}, classes: classesState.filter(c => !c.archived), overview: {assignments: overviewAssignments, notices}});
    if (url.pathname === '/api/me') return respond({uid: account.uid, name: account.display_name, roles: account.roles, memberships: viewer.memberships, childMemberships: viewer.childMemberships});
    if (url.pathname === '/api/classes') return respond({items: classesState.filter(c => !c.archived)});
    if (url.pathname === '/api/classes/cohorts') {
      if (req.method === 'POST') {
        if (body.action === 'create_class') {
          const id = 'class-' + Date.now();
          const name = body.name || 'Lớp mới';
          const schoolYearId = body.schoolYearId || yearsList[0]?.id || 'qa-year';
          const item = {
            id,
            name,
            schoolYearId,
            school_year_id: schoolYearId,
            schedule: formatScheduleSummary(body.scheduleSlots) || 'Chưa cập nhật',
            schedule_slots: body.scheduleSlots || [],
            reminders_enabled: body.remindersEnabled ?? true,
            routePath: '/class/' + encodeURIComponent(name.toLowerCase().replace(/\s+/g, '-'))
          };
          classesState.push(item);
          return respond({ok: true, item}, 201);
        }
        if (body.action === 'advance_school_year') {
          const nextName = 'Năm học 2027-2028';
          const nextId = 'year-2027-2028-' + Date.now();
          if (!yearsList.some(y => y.id === nextId)) yearsList.unshift({id: nextId, name: nextName, starts_on: '2027-09-01', ends_on: '2028-06-30'});
          return respond({ok: true, plan: {nextSchoolYearName: nextName}, createdClasses: []}, 201);
        }
        if (body.action === 'restore_class') {
          const idx = archivedClasses.findIndex(c => c.id === body.classId);
          if (idx !== -1) {
            const [restored] = archivedClasses.splice(idx, 1);
            restored.archived = false;
            classesState.push(restored);
          }
          return respond({ok: true});
        }
        if (body.action === 'delete_archived_class') {
          archivedClasses = archivedClasses.filter(c => c.id !== body.classId);
          return respond({ok: true});
        }
        return respond({ok: true});
      }
      return respond({
        years: yearsList,
        activeClasses: classesState.filter(c => !c.archived),
        archivedClasses
      });
    }

    // Practice Rooms QA routes on :5181 (uses module-level samplePracticeAccess & samplePracticeExams)
    const buildPracticeQuestions = (examType) => {
      const passage = 'Đọc ngữ liệu mẫu và trả lời các câu hỏi bên phải.';
      if (examType === 'thptqg') {
        return [
          {id: 'pq-1', questionCode: 'LTCH-1', displayNumber: 1, section: 'part_1', type: 'single', prompt: 'Cho hàm số $f(x)=x^2-2x+1$. Giá trị nhỏ nhất là?', options: ['0', '1', '2', '4'], answer: 'A', points: 0.25},
          {id: 'pq-2', questionCode: 'LTCH-2', displayNumber: 2, section: 'part_2', type: 'true_false', prompt: 'Xét tính đúng sai của các mệnh đề sau:', statements: ['f(1) = 0', 'f(0) = 1', 'f(x) >= 0 với mọi x', 'Đồ thị cắt Ox tại 2 điểm phân biệt'], points: 1},
          {id: 'pq-3', questionCode: 'LTCH-3', displayNumber: 3, section: 'part_3', type: 'short', prompt: 'Tính giá trị $f(3)$.', answer: '4', points: 0.5}
        ];
      }
      return Array.from({length: 6}, (_, i) => {
        const section = i < 2 ? 'part_1' : i < 4 ? 'part_2' : 'part_3';
        return {
          id: `pq-${examType}-${i + 1}`,
          questionCode: `LTCH-${i + 1}`,
          displayNumber: i + 1,
          section,
          type: 'single',
          prompt: `Câu hỏi mẫu ${i + 1} cho phòng luyện ${examType.toUpperCase()}.`,
          options: ['Phương án A', 'Phương án B', 'Phương án C', 'Phương án D'],
          answer: 'A',
          points: 1,
          ...(section !== 'part_1' ? {passageContent: passage, passageId: `${examType}-${section}`} : {})
        };
      });
    };
    if (url.pathname === '/api/practice/rooms') {
      const examsWithSolutions = samplePracticeExams.map(ex => {
        const st = getExamSolutionsState(ex);
        return {
          ...ex,
          solutionVideoCount: st.videos.length,
          solutionDocCount: st.files.length,
          sourceFileCount: st.examFiles.length,
          hasSolution: st.videos.length + st.files.length > 0
        };
      });
      return respond({access: samplePracticeAccess, exams: examsWithSolutions, attemptsByExam: {}});
    }
    const examSolutionRouteMatch = /^\/api\/practice\/exams\/([^/]+)\/solutions(?:\/(?:files(?:\/([^/]+)(?:\/(preview|chunks|stream))?)?|source\/([^/]+)))?$/.exec(url.pathname);
    if (examSolutionRouteMatch) {
      const [, solExamId, fileId, fileAction, sourceDriveId] = examSolutionRouteMatch;
      const ex = samplePracticeExams.find(e => e.id === solExamId) || samplePracticeExams[0];
      const st = getExamSolutionsState(ex);
      if (sourceDriveId && req.method === 'GET') {
        res.writeHead(200, {'content-type': 'application/octet-stream'});
        return res.end(buildSamplePdf('LTCH Exam Source Preview'));
      }
      if (url.pathname.includes('/solutions/files')) {
        if (fileAction === 'stream' && req.method === 'GET') {
          return respond({
            url: `http://127.0.0.1:5181/api/video-media?ticket=${encodeURIComponent(fileId || 'qa-sol-vid-1')}`,
            mimeType: 'video/mp4',
            size: SAMPLE_MP4_BYTES.length,
            name: 'Video bài chữa.mp4'
          });
        }
        if (fileAction === 'preview' && req.method === 'GET') {
          return respond({url: 'https://drive.google.com/file/d/1ZGwXOnASvyG4OzSk63DrsxIgJX9IQDT7/preview'});
        }
        if (fileAction === 'chunks' && req.method === 'POST') {
          return respond({id: fileId, state: 'uploaded', offset: 1});
        }
        if (req.method === 'POST' && !fileId) {
          if (body && body.mode === 'resumable') {
            const kind = body.fileKind || (body.isVideoLecture ? 'video' : 'document');
            const item = {
              id: `qa-sol-${Date.now()}`,
              fileKind: kind,
              name: body.name || 'video-chua-de.mp4',
              content_type: body.contentType || 'video/mp4',
              file_size: Number(body.size) || 1024,
              created_at: Date.now()
            };
            if (kind === 'video') st.videos = [item, ...st.videos];
            else if (kind === 'exam_file') st.examFiles = [...st.examFiles, {...item, sourceType: 'uploaded_exam_file', downloadPath: `/api/practice/exams/${ex.id}/solutions/files/${item.id}`}];
            else st.files = [item, ...st.files];
            return respond({id: item.id, fileKind: kind, uploadToken: 'qa-upload-token', chunkSize: 8 * 1024 * 1024, state: 'uploaded', offset: item.file_size}, 201);
          }
          const name = /filename="([^"]+)"/.exec(raw)?.[1] || 'Tệp bài chữa.pdf';
          const kind = body.fileKind || (/^__ltch_cover__/i.test(name) ? 'cover' : 'document');
          const item = {id: `qa-sol-${Date.now()}`, fileKind: kind, name, content_type: kind === 'cover' ? 'image/jpeg' : 'application/pdf', file_size: rawBytes.length || 100, created_at: Date.now()};
          if (kind === 'cover') st.coverFileId = item.id;
          else if (kind === 'exam_file') st.examFiles = [...st.examFiles, {...item, sourceType: 'uploaded_exam_file', downloadPath: `/api/practice/exams/${ex.id}/solutions/files/${item.id}`}];
          else st.files = [item, ...st.files];
          return respond({id: item.id, fileKind: kind}, 201);
        }
        if (req.method === 'GET' && fileId) {
          res.writeHead(200, {'content-type': 'application/octet-stream'});
          return res.end(buildSamplePdf('LTCH Exam Solution Preview'));
        }
        if (req.method === 'GET') {
          return respond({items: [...st.videos, ...st.files], hasMore: false});
        }
      }
      if (req.method === 'POST') {
        const action = String(body.action || '');
        if (action === 'update_meta') {
          if (typeof body.topic === 'string') st.topic = body.topic.trim();
          if (typeof body.date === 'string') {
            st.date = body.date.trim();
            st.formattedDate = st.date ? formatViSessionDate(st.date, '', '') : '';
          }
        } else if (action === 'delete_file') {
          const fid = String(body.fileId || '');
          st.videos = st.videos.filter(v => v.id !== fid);
          st.files = st.files.filter(f => f.id !== fid);
          st.examFiles = st.examFiles.filter(f => f.id !== fid);
        }
        return respond({ok: true, exam: ex, solution: st, solutionsEnabled: true, solutionsLinkPreview: true});
      }
      return respond({exam: ex, solution: st, solutionsEnabled: true, solutionsLinkPreview: true});
    }
    if (url.pathname === '/api/practice/report-error' && req.method === 'POST') return respond({ok: true});
    if (url.pathname === '/api/admin/practice/reports') return respond({items: []});
    const adminExamMatch = /^\/api\/admin\/practice\/exams(?:\/([^/]+))?$/.exec(url.pathname);
    if (adminExamMatch) {
      if (req.method === 'POST') {
        if (body.action === 'stage_drive_assets') {
          const assets = Array.isArray(body.assets) ? body.assets.map((asset, idx) => ({
            key: asset.key,
            kind: asset.kind || 'image',
            id: asset.id || `asset_${idx}`,
            name: asset.name || `asset_${idx}`,
            driveFileId: `mock_drive_${Date.now()}_${idx}`,
            mimeType: asset.mimeType || 'image/png',
            size: 128,
            sha256: '0'.repeat(64)
          })) : [];
          return respond({ ok: true, examId: body.examId || 'exam_mock_1', assets });
        }
        if (body.action === 'storage_diagnostics') {
          return respond({
            ok: true,
            examsCount: samplePracticeExams.length,
            totalDbJsonBytes: 4096,
            inlineDataUrlCount: 0,
            tables: { ltch_exams: { count: samplePracticeExams.length, jsonBytes: 2048, inlineDataUrlCount: 0 } },
            exams: samplePracticeExams.map(e => ({
              id: e.id, title: e.title, examType: e.examType, status: e.status,
              storage: 'drive', questionCount: e.questionCount || 0, dbRowBytes: 512, sourceFilesCount: 0
            }))
          });
        }
        if (body.action === 'purge_all_room_exams') {
          const purgedExams = samplePracticeExams.length;
          samplePracticeExams = [];
          return respond({ ok: true, purgedExams, purgedQuestionCodes: 0, purgedDriveFolders: 0 });
        }
        if (body.action === 'delete_exam' || body.action === 'delete_draft') {
          samplePracticeExams = samplePracticeExams.filter(e => e.id !== body.examId);
          return respond({ok: true, deletedExamId: body.examId});
        }
        if (body.action === 'change_status') {
          const target = samplePracticeExams.find(e => e.id === body.examId);
          if (target && body.status) target.status = body.status;
          return respond({ok: true, examId: body.examId, status: body.status});
        }
        return respond({ok: true, exam: samplePracticeExams[0] || null});
      }
      const targetId = adminExamMatch[1];
      const targetExam = (targetId && samplePracticeExams.find(e => e.id === targetId)) || samplePracticeExams[0];
      return respond({exam: {...targetExam, questions: buildPracticeQuestions(targetExam?.examType || 'thptqg')}});
    }
    const practiceAttemptMatch = /^\/api\/practice\/exams\/([^/]+)\/attempts\/([^/]+)$/.exec(url.pathname);
    if (practiceAttemptMatch && req.method === 'GET') {
      const ex = samplePracticeExams.find(e => e.id === practiceAttemptMatch[1]) || samplePracticeExams[0];
      const qs = buildPracticeQuestions(ex.examType);
      return respond({
        examId: ex.id, attemptId: practiceAttemptMatch[2], examType: ex.examType, examTitle: ex.title,
        score: qs.length, max: qs.length, timeSpentSeconds: 120, questions: qs, responses: {},
        results: qs.map(q => ({id: q.id, answered: true, correct: true, earned: q.points || 1, points: q.points || 1, max: q.points || 1, response: 'A', correctAnswer: 'A', solution: 'Đáp án mẫu A.'}))
      });
    }
    const examActionMatch = /^\/api\/exams\/([^/]+)\/(start|draft|section|submit)$/.exec(url.pathname);
    if (examActionMatch && req.method === 'POST') {
      const ex = samplePracticeExams.find(e => e.id === examActionMatch[1]) || samplePracticeExams[0];
      const qs = buildPracticeQuestions(ex.examType);
      const action = examActionMatch[2];
      const cur = body.sectionKey && body.sectionKey !== 'all' ? body.sectionKey : (ex.examType === 'thptqg' ? 'all' : 'part_1');
      if (action === 'submit' || (action === 'section' && body.action === 'submit_section')) {
        return respond({
          completedAllSections: true, status: 'submitted',
          examId: ex.id, attemptId: 'qa-att-1', examType: ex.examType, examTitle: ex.title,
          score: 1, max: qs.length, timeSpentSeconds: 60, questions: qs, responses: body.responses || {},
          results: qs.map((q, idx) => ({id: q.id, answered: idx === 0, correct: idx === 0, earned: idx === 0 ? 1 : 0, points: q.points || 1, max: q.points || 1, response: idx === 0 ? 'A' : '', correctAnswer: 'A', solution: 'Giải thích mẫu.'})),
          sectionSummary: [{section: cur, total: qs.length, earned: 1, max: qs.length}]
        });
      }
      if (action === 'draft') return respond({ok: true, serverNow: Date.now()});
      return respond({
        examId: ex.id, attemptId: 'qa-att-1', examType: ex.examType, examTitle: ex.title,
        activeDeviceToken: 'qa-device', currentSection: cur, serverNow: Date.now(), deadlineAt: Date.now() + 3600000,
        sectionStates: {[cur]: {status: 'in_progress', durationMinutes: 60, deadlineAt: Date.now() + 3600000}},
        visibleQuestions: qs, responses: {}, draftMeta: {}
      });
    }

    // Classroom exam taking & grading routes
    const clsExamAttemptMatch = /^\/api\/exams\/([^/]+)\/attempts\/([^/]+)$/.exec(url.pathname);
    if (clsExamAttemptMatch) {
      const [, examId, attemptId] = clsExamAttemptMatch;
      const ex = exams.find(e => e.id === examId) || {id: examId, title: 'Đề kiểm tra lớp', questions: []};
      if (req.method === 'POST') {
        const responses = body.responses || {};
        const qs = ex.questions || [];
        const results = qs.map(q => {
          const pts = Number(q.points) || 1;
          const ans = responses[q.id];
          let correct = false;
          if (q.type === 'true_false') {
            correct = Array.isArray(ans) && Array.isArray(q.answer) ? ans.every((v, i) => v === q.answer[i]) : false;
          } else {
            correct = ans !== undefined && String(ans).trim().toLowerCase() === String(q.answer ?? '').trim().toLowerCase();
          }
          const scoreVal = correct ? pts : 0;
          return {id: q.id, answered: ans !== undefined && ans !== '', correct, score: scoreVal, max: pts, earned: scoreVal, points: pts, response: ans ?? '', correctAnswer: q.answer ?? '', solution: q.solution || ''};
        });
        const score = results.reduce((s, r) => s + r.earned, 0);
        const max = results.reduce((s, r) => s + r.points, 0);
        const submittedAt = Date.now();
        classroomAttempts.set(attemptId, {attemptId, examId, uid: account.uid, submittedAt, score, max, results});
        workspaceAttempts.unshift({id: attemptId, exam_id: examId, uid: account.uid, submitted_at: submittedAt, score, max});
        return respond({attemptId, submittedAt}, 201);
      }
      if (req.method === 'GET') {
        const att = classroomAttempts.get(attemptId) || {attemptId, examId, submittedAt: Date.now(), score: 0, max: 0, results: []};
        return respond({
          status: 'graded',
          submittedAt: att.submittedAt,
          score: att.score,
          max: att.max,
          results: att.results,
          solutions: (ex.questions || []).map(q => ({id: q.id, solution: q.solution || ''}))
        });
      }
    }
    const clsExamReadMatch = /^\/api\/exams\/([^/]+)$/.exec(url.pathname);
    if (clsExamReadMatch && req.method === 'GET') {
      const ex = exams.find(e => e.id === clsExamReadMatch[1]);
      if (!ex) return respond({error: 'Không tìm thấy đề thi.'}, 404);
      return respond({
        id: ex.id,
        title: ex.title,
        opensAt: ex.opens_at,
        closesAt: ex.closes_at,
        questions: (ex.questions || []).map(q => ({
          id: q.id,
          type: q.type,
          prompt: q.prompt,
          points: q.points,
          ...(q.options ? {options: q.options} : {}),
          ...(q.statements ? {statements: q.statements} : {})
        }))
      });
    }

    // Student assignment submissions & staff feedback routes
    const assignSubMatch = /^\/api\/assignments\/([^/]+)\/submissions$/.exec(url.pathname);
    if (assignSubMatch && req.method === 'POST') {
      const assignmentId = assignSubMatch[1];
      const subId = 'qa-sub-' + Date.now();
      let note = '';
      const storedFiles = [];
      if (ctype.includes('multipart/form-data')) {
        const parsedForm = await new Request(`http://127.0.0.1${url.pathname}`, {
          method: 'POST',
          headers: {'content-type': ctype},
          body: rawBytes
        }).formData();
        note = String(parsedForm.get('note') || '').trim();
        const uploaded = [...parsedForm.getAll('files'), ...parsedForm.getAll('file')].filter(
          f => f && typeof f.arrayBuffer === 'function' && f.size > 0
        );
        for (let idx = 0; idx < uploaded.length; idx++) {
          const entry = uploaded[idx];
          const bytes = Buffer.from(await entry.arrayBuffer());
          const contentType = entry.type || (/\.png$/i.test(entry.name) ? 'image/png' : /\.webp$/i.test(entry.name) ? 'image/webp' : /\.(jpe?g)$/i.test(entry.name) ? 'image/jpeg' : 'application/pdf');
          submissionBlobs.set(`${subId}:${idx}`, {bytes, contentType, name: entry.name});
          storedFiles.push({index: idx, name: entry.name, content_type: contentType, size: bytes.length});
        }
      }
      if (!storedFiles.length) {
        const fileName = /filename="([^"]+)"/.exec(raw)?.[1] || body.fileName || 'bai-nop-hoc-sinh.pdf';
        const pdfBytes = buildSamplePdf('LTCH Submission Preview');
        submissionBlobs.set(`${subId}:0`, {bytes: pdfBytes, contentType: 'application/pdf', name: fileName});
        storedFiles.push({index: 0, name: fileName, content_type: 'application/pdf', size: pdfBytes.length});
      }
      const totalSize = storedFiles.reduce((sum, f) => sum + (f.size || 0), 0);
      const record = {
        id: subId,
        assignment_id: assignmentId,
        uid: account.uid,
        content_type: storedFiles[0].content_type,
        file_size: totalSize,
        status: 'stored',
        created_at: Date.now(),
        stored_at: Date.now(),
        feedback: '',
        note,
        file_count: storedFiles.length,
        files: storedFiles
      };
      submissions.unshift(record);
      return respond({ok: true, id: subId, note, fileCount: storedFiles.length, files: storedFiles}, 201);
    }
    const subFileMatch = /^\/api\/submissions\/([^/]+)\/(file|feedback)$/.exec(url.pathname);
    if (subFileMatch) {
      const [, subId, action] = subFileMatch;
      const sub = submissions.find(s => s.id === subId);
      if (action === 'feedback' && req.method === 'POST') {
        if (sub) sub.feedback = String(body.feedback || '');
        return respond({ok: true});
      }
      if (action === 'file' && req.method === 'GET') {
        const idx = Number(url.searchParams.get('index') || 0);
        const blobRec = submissionBlobs.get(`${subId}:${idx}`) || submissionBlobs.get(`${subId}:0`);
        if (blobRec) {
          res.writeHead(200, {'content-type': blobRec.contentType || 'application/octet-stream'});
          return res.end(blobRec.bytes);
        }
        res.writeHead(200, {'content-type': 'application/pdf'});
        return res.end(buildSamplePdf('LTCH Submission Preview'));
      }
    }

    // Generalized class routes matching ANY classId (including qa-class, class-10a1, class-12a1, etc.)
    const classSubMatch = /^\/api\/classes\/([^/]+)(\/.*)$/.exec(url.pathname);
    if (classSubMatch) {
      const classId = decodeURIComponent(classSubMatch[1]);
      const subPath = classSubMatch[2];
      const targetClass = classesState.find(c => c.id === classId)
        || archivedClasses.find(c => c.id === classId)
        || {id: classId, name: classId, schedule: 'Thứ 3, 5: 18h00 - 19h30', schoolYearId: 'qa-year', school_year_id: 'qa-year'};

      if (subPath === '/workspace' && req.method === 'GET') {
        const classMembers = membershipsList
          .filter(m => m.class_id === classId && m.status === 'active')
          .map(m => {
            const u = usersList.find(usr => usr.uid === m.uid);
            return {...m, name: u?.display_name || m.uid, ...(m.member_role === 'student' ? {student_code: u?.student_code || 'LTCH001'} : {})};
          });
        if (!classMembers.some(m => m.member_role === 'student')) {
          classMembers.push({uid: 'qa-student', class_id: classId, member_role: 'student', status: 'active', name: 'Học sinh thử', student_code: 'LTCH001'});
        }
        return respond({
          class: targetClass,
          assignments,
          exams,
          submissions,
          notices: notices.filter(notice => notice.scope === 'all' || notice.class_id === classId),
          viewerContext: {...viewer, name: account.display_name},
          materials: materialRows.slice(0, 100),
          materialsHasMore: true,
          lessonsEnabled: true,
          lessonsLinkPreview: true,
          attendance: attendanceRows.filter(a => !a.class_id || a.class_id === classId),
          messages: [],
          members: classMembers,
          contacts: classMembers.map(m => ({uid: m.uid, display_name: m.name})),
          attempts: workspaceAttempts,
          permissions: {schedule: true, assignments: true, practice: true, attendance: true, materials: true, notices: true, messages: true, student: true}
        });
      }
      if (subPath === '/sessions') {
        const list = getSessionsForClass(classId, targetClass.schedule);
        if (req.method === 'POST') {
          const action = String(body.action || '').trim().toLowerCase();
          if (action === 'delete_file') {
            const fid = String(body.fileId || '').trim();
            lessonFiles = lessonFiles.filter(f => f.id !== fid);
            for (const s of list) {
              if (Array.isArray(s.files)) s.files = s.files.filter(f => f.id !== fid);
              if (Array.isArray(s.videos)) s.videos = s.videos.filter(v => v.id !== fid);
              if (Array.isArray(s.homeworkFiles)) s.homeworkFiles = s.homeworkFiles.filter(f => f.id !== fid);
            }
            return respond({ok: true, deletedFileId: fid, trashed: true});
          }
          const num = Number(body.sessionNumber) || 1;
          if (action === 'delete_session') {
            const idx = list.findIndex(s => s.sessionNumber === num);
            if (idx === -1) return respond({error: `Không tìm thấy Buổi ${num}`}, 404);
            list.splice(idx, 1);
            return respond({ok: true, deletedSessionNumber: num, trashedCount: 1, sessions: list});
          }
          const isAddAction = action === 'add_session' || action === 'create_session';
          let target = list.find(s => s.sessionNumber === num);
          if (!target) {
            target = {
              sessionNumber: num,
              title: `Buổi ${num}`,
              lessonName: '',
              cleanTopic: '',
              date: '2026-09-01',
              sessionDate: '2026-09-01',
              start: '18:00',
              end: '19:30',
              lessonId: `qa-lesson-${num}`,
              explicit: true,
              persisted: true,
              driveSynced: true,
              videos: [],
              files: [],
              homeworkFiles: []
            };
            list.push(target);
            list.sort((a, b) => a.sessionNumber - b.sessionNumber);
          }
          if (!target.lessonId) target.lessonId = num === 1 ? 'qa-lesson' : `qa-lesson-${num}`;
          target.explicit = true;
          target.persisted = true;
          target.driveSynced = true;
          if (typeof body.lessonName === 'string' && body.lessonName.trim()) {
            target.lessonName = body.lessonName.trim();
            target.title = `Buổi ${num}: ${target.lessonName}`;
          }
          if (typeof body.cleanTopic === 'string' && body.cleanTopic.trim()) target.cleanTopic = body.cleanTopic.trim();
          if (body.date) { target.date = body.date; target.sessionDate = body.date; }
          if (body.start) target.start = body.start;
          if (body.end) target.end = body.end;
          target.formattedDate = formatViSessionDate(target.date, target.start, target.end);
          return respond({
            ok: true,
            created: isAddAction,
            driveSynced: true,
            cascaded: Boolean(body.cascade),
            shiftedCount: body.cascade ? Math.max(0, list.length - num) : 0,
            oldDate: target.sessionDate,
            newDate: target.date,
            session: {...target},
            sessions: list
          }, isAddAction ? 201 : 200);
        }
        return respond({
          sessions: list,
          schoolYearStartsOn: '2026-09-01',
          unmatchedLessons: [],
          driveAvailable: true,
          scheduleSlots: targetClass.schedule_slots || [],
          scheduleText: targetClass.schedule || ''
        });
      }
      if (subPath === '/schedule' && req.method === 'POST') {
        const summary = formatScheduleSummary(body.scheduleSlots);
        if (summary) targetClass.schedule = summary;
        if (Array.isArray(body.scheduleSlots)) targetClass.schedule_slots = body.scheduleSlots;
        if (typeof body.remindersEnabled === 'boolean') targetClass.reminders_enabled = body.remindersEnabled;
        return respond({ok: true});
      }
      if (subPath === '/questions' && req.method === 'GET') return respond({items: bank});
      if (subPath === '/lessons' && req.method === 'GET') return respond({items: lessonRows, hasMore: false});
      if (subPath === '/lessons' && req.method === 'POST') {
        lessonRows.unshift({id: `qa-lesson-${Date.now()}`, title: body.title, topic: body.topic, created_at: Date.now()});
        return respond({id: lessonRows[0].id}, 201);
      }
      if (/^\/lessons\/[^/]+\/files$/.test(subPath) && req.method === 'GET') return respond({items: lessonFiles, hasMore: false});
      if (/^\/lessons\/[^/]+\/files\/qa-file-1\/preview$/.test(subPath) && req.method === 'GET') {
        return respond({url: 'https://drive.google.com/file/d/1ZGwXOnASvyG4OzSk63DrsxIgJX9IQDT7/preview'});
      }
      const streamMatch = /^\/lessons\/[^/]+\/files\/([^/]+)\/stream$/.exec(subPath);
      if (streamMatch && req.method === 'GET') {
        return respond({
          url: `http://127.0.0.1:5181/api/video-media?ticket=${encodeURIComponent(streamMatch[1])}`,
          mimeType: 'video/mp4',
          size: SAMPLE_MP4_BYTES.length,
          name: 'Video bài giảng thử.mp4'
        });
      }
      if (/^\/lessons\/[^/]+\/files\/(?:qa-file-1|qa-hw-1|qa-video-1)$/.test(subPath) && req.method === 'GET') {
        res.writeHead(200, {'content-type': 'application/octet-stream'}); return res.end(buildSamplePdf());
      }
      if (/^\/lessons\/[^/]+\/files$/.test(subPath) && req.method === 'POST') {
        if (body && body.mode === 'resumable') {
          const item = {
            id: `qa-upload-${Date.now()}-${lessonFiles.length}`,
            name: body.name || 'video-bai-giang.mp4',
            content_type: body.contentType || 'video/mp4',
            file_size: Number(body.size) || 1024,
            created_at: Date.now()
          };
          lessonFiles.unshift(item);
          return respond({id: item.id, uploadToken: 'qa-upload-token', chunkSize: 8 * 1024 * 1024, state: 'uploaded', offset: item.file_size}, 201);
        }
        const name = /filename="([^"]+)"/.exec(raw)?.[1] || 'Tệp thử';
        if (name === 'busy.pdf') return respond({error: 'Hệ thống đang tải một tệp khác. Vui lòng thử lại sau.'}, 429);
        if (name === 'retry.pdf') {
          const requestId = /name="requestId"\r\n\r\n([^\r\n]+)/.exec(raw)?.[1];
          if (!requestId) return respond({error: 'Thiếu mã thử lại.'}, 400);
          if (!retryRequestId) { retryRequestId = requestId; return respond({error: 'Mô phỏng mất kết nối sau khi lưu.'}, 503); }
          if (requestId !== retryRequestId) return respond({error: 'Mã thử lại không khớp.'}, 409);
        }
        const item = {id: `qa-upload-${Date.now()}-${lessonFiles.length}`, name, content_type: 'application/octet-stream', file_size: 1, created_at: Date.now()};
        lessonFiles.unshift(item); return respond({id: item.id}, 201);
      }
      if (subPath === '/materials' && req.method === 'GET') return respond({items: materialRows.slice(100), hasMore: false});
      if (subPath === '/forum') {
        const decorateMockPost = p => {
          const replies = forumComments[p.id] || [];
          const hasStaffReply = replies.some(c => ['admin', 'teacher', 'assistant'].includes(c.author_role));
          const latestAct = Math.max(Number(p.created_at) || 0, ...replies.map(c => Number(c.created_at) || 0));
          return {
            ...p,
            comment_count: replies.length,
            has_staff_reply: hasStaffReply,
            latest_activity_at: latestAct,
            can_edit: true,
            can_delete: true,
            can_resolve: true,
            can_moderate: true
          };
        };
        if (req.method === 'GET') {
          if (process.env.LTCH_QA_FORUM_PAGINATION !== '1') {
            const items = forumPosts.filter(p => !p.class_id || p.class_id === classId).map(decorateMockPost);
            return respond({items, canWrite: true, canModerate: true, isStaff: true, stats: computeForumStats(items, account.uid)});
          }
          const older = url.searchParams.has('beforeId');
          return respond({items: [{id: older ? 'qa-old-post' : 'qa-new-post', title: older ? 'Câu hỏi cũ' : 'Câu hỏi mới', body: 'Dữ liệu giả', author_name: 'Học sinh thử', author_role: 'student', created_at: older ? 1 : 2, comment_count: 0}], canWrite: true, canModerate: true, nextCursor: older ? null : {beforeCreatedAt: 2, beforeId: 'qa-new-post'}, hasMore: !older});
        }
        if (req.method === 'POST') {
          const post = {
            id: 'qa-post-' + Date.now(),
            class_id: classId,
            title: body.title || 'Câu hỏi mới',
            body: body.body || '',
            author_uid: account.uid,
            author_name: account.display_name,
            author_role: account.roles?.[0] || 'student',
            category: body.category || 'general',
            session_number: normalizeForumSessionNumber(body.sessionNumber),
            pinned: body.pinned === '1' || body.pinned === true,
            resolved: false,
            accepted_comment_id: null,
            locked: false,
            edited_at: null,
            has_file: /filename="([^"]+)"/.test(raw),
            created_at: Date.now()
          };
          forumPosts.unshift(post);
          return respond({ok: true, id: post.id}, 201);
        }
      }
      if (subPath === '/attendance' && req.method === 'GET') return respond({items: attendanceRows.filter(a => !a.class_id || a.class_id === classId)});
      const editSubMatch = /^\/(notices|assignments|exams)\/([^/]+)$/.exec(subPath);
      if (editSubMatch && req.method === 'POST') {
        const [, kind, recordId] = editSubMatch;
        const collection = kind === 'notices' ? notices : kind === 'assignments' ? assignments : exams;
        const idx = collection.findIndex(item => item.id === recordId);
        if (idx === -1) return respond({error: 'Không tìm thấy mục cần sửa.'}, 404);
        if (kind === 'exams' && body.action === 'delete') {
          collection.splice(idx, 1);
          return respond({ok: true, deletedExamId: recordId});
        }
        const rec = collection[idx];
        if (body.title !== undefined) rec.title = body.title;
        if (kind === 'notices' && body.body !== undefined) rec.body = body.body;
        if (kind === 'assignments' || kind === 'exams') {
          if (body.status) rec.status = body.status;
          if (body.opensAt !== undefined) rec.opens_at = body.opensAt;
          if (body.closesAt !== undefined) rec.closes_at = body.closesAt;
          if (kind === 'assignments' && body.instructions !== undefined) rec.instructions = body.instructions;
          if (kind === 'exams') {
            if (body.resultsAt !== undefined) rec.results_at = body.resultsAt;
            if (body.solutionsAt !== undefined) rec.solutions_at = body.solutionsAt;
          }
        }
        return respond({ok: true});
      }
      if (req.method === 'POST') {
        if (subPath === '/questions') {
          if (body.archiveId) bank = bank.filter(q => q.id !== body.archiveId);
          else bank.push({id: body.question?.id || ('bank-' + Date.now() + '-' + bank.length), topic: body.topic || 'Chủ đề chung', question: body.question});
        }
        if (subPath === '/notices') {
          const createdNotice = {...body, id: 'qa-notice-' + Date.now(), class_id: classId, created_at: Date.now()};
          notices.unshift(createdNotice);
          return respond({ok: true, id: createdNotice.id, notificationStatus: 'sent', notifiedCount: 2}, 201);
        }
        if (subPath === '/assignments') assignments.unshift({...body, id: 'qa-assignment-' + Date.now(), class_id: classId, status: 'published', opens_at: body.opensAt, closes_at: body.closesAt});
        if (subPath === '/exams') exams.unshift({...body, id: 'qa-exam-' + Date.now(), class_id: classId, status: 'published', opens_at: body.opensAt, closes_at: body.closesAt, results_at: body.resultsAt, solutions_at: body.solutionsAt});
        if (subPath === '/attendance') {
          const rowId = `${classId}_${body.studentUid}_${body.date}`;
          const row = {id: rowId, class_id: classId, student_uid: body.studentUid, lesson_date: body.date, status: body.status, note: body.note || '', updated_at: Date.now()};
          const idx = attendanceRows.findIndex(r => r.id === rowId);
          if (idx === -1) attendanceRows.push(row);
          else attendanceRows[idx] = row;
        }
        return respond({ok: true});
      }
    }

    const forumCommentsMatch = /^\/api\/forum\/posts\/([^/]+)\/comments$/.exec(url.pathname);
    if (forumCommentsMatch) {
      const postId = forumCommentsMatch[1];
      const post = forumPosts.find(p => p.id === postId);
      if (req.method === 'GET') {
        if (postId === 'qa-new-post' && process.env.LTCH_QA_FORUM_PAGINATION === '1') {
          const older = url.searchParams.has('beforeId');
          return respond({items: [{id: older ? 'qa-old-reply' : 'qa-new-reply', body: older ? 'Trả lời cũ' : 'Trả lời mới', author_name: 'Giáo viên thử', author_role: 'teacher', created_at: older ? 1 : 2}], canWrite: true, canModerate: true, nextCursor: older ? null : {beforeCreatedAt: 2, beforeId: 'qa-new-reply'}, hasMore: !older});
        }
        const replies = (forumComments[postId] || []).map(c => ({
          ...c,
          is_author_op: Boolean(post && c.author_uid === post.author_uid),
          is_accepted: Boolean(post && post.accepted_comment_id === c.id),
          can_edit: true,
          can_delete: true
        }));
        return respond({items: replies, canWrite: true, canModerate: true, nextCursor: null, hasMore: false});
      }
      if (req.method === 'POST') {
        forumComments[postId] ??= [];
        const reply = {
          id: 'qa-comment-' + Date.now(),
          post_id: postId,
          body: body.body || '',
          author_uid: account.uid,
          author_name: account.display_name,
          author_role: account.roles?.[0] || 'student',
          has_file: /filename="([^"]+)"/.test(raw),
          edited_at: null,
          created_at: Date.now()
        };
        forumComments[postId].push(reply);
        return respond({ok: true, id: reply.id}, 201);
      }
    }
    const forumPostDetailMatch = /^\/api\/forum\/posts\/([^/]+)$/.exec(url.pathname);
    if (forumPostDetailMatch && req.method === 'GET') {
      const p = forumPosts.find(item => item.id === forumPostDetailMatch[1]);
      if (!p) return respond({error: 'Không tìm thấy bài viết.'}, 404);
      const replies = forumComments[p.id] || [];
      return respond({
        post: {
          ...p,
          comment_count: replies.length,
          has_staff_reply: replies.some(c => ['admin', 'teacher', 'assistant'].includes(c.author_role)),
          latest_activity_at: Math.max(Number(p.created_at) || 0, ...replies.map(c => Number(c.created_at) || 0)),
          can_edit: true,
          can_delete: true,
          can_resolve: true,
          can_moderate: true
        },
        canWrite: true,
        canModerate: true,
        isStaff: true
      });
    }
    const forumPostActMatch = /^\/api\/forum\/posts\/([^/]+)\/(edit|moderate|delete)$/.exec(url.pathname);
    if (forumPostActMatch && req.method === 'POST') {
      const [, postId, action] = forumPostActMatch;
      const idx = forumPosts.findIndex(item => item.id === postId);
      if (idx === -1) return respond({error: 'Không tìm thấy bài viết.'}, 404);
      const p = forumPosts[idx];
      if (action === 'edit') {
        if (body.title !== undefined) p.title = body.title;
        if (body.body !== undefined) p.body = body.body;
        if (body.category !== undefined) p.category = body.category;
        if (body.sessionNumber !== undefined) p.session_number = normalizeForumSessionNumber(body.sessionNumber);
        if (/filename="([^"]+)"/.test(raw)) p.has_file = true;
        else if (body.removeFile === '1') p.has_file = false;
        p.edited_at = Date.now();
        return respond({ok: true, post: p});
      }
      if (action === 'moderate') {
        if (typeof body.pinned === 'boolean') p.pinned = body.pinned;
        if (typeof body.locked === 'boolean') p.locked = body.locked;
        if (Object.prototype.hasOwnProperty.call(body, 'acceptedCommentId')) {
          p.accepted_comment_id = body.acceptedCommentId || null;
          if (p.accepted_comment_id) p.resolved = true;
        }
        if (typeof body.resolved === 'boolean') {
          p.resolved = body.resolved;
          if (!p.resolved) p.accepted_comment_id = null;
        }
        return respond({ok: true, post: p});
      }
      forumPosts.splice(idx, 1);
      delete forumComments[postId];
      return respond({ok: true, deletedPostId: postId});
    }
    const forumCommentActMatch = /^\/api\/forum\/comments\/([^/]+)\/(edit|delete)$/.exec(url.pathname);
    if (forumCommentActMatch && req.method === 'POST') {
      const [, commentId, action] = forumCommentActMatch;
      for (const [postId, list] of Object.entries(forumComments)) {
        const idx = list.findIndex(c => c.id === commentId);
        if (idx !== -1) {
          if (action === 'edit') {
            if (body.body !== undefined) list[idx].body = body.body;
            list[idx].edited_at = Date.now();
            return respond({ok: true, comment: list[idx]});
          }
          list.splice(idx, 1);
          const parent = forumPosts.find(p => p.id === postId);
          if (parent && parent.accepted_comment_id === commentId) {
            parent.accepted_comment_id = null;
            parent.resolved = false;
          }
          return respond({ok: true, deletedCommentId: commentId});
        }
      }
      return respond({error: 'Không tìm thấy câu trả lời.'}, 404);
    }
    const forumFileMatch = /^\/api\/forum\/(posts|comments)\/([^/]+)\/file$/.exec(url.pathname);
    if (forumFileMatch && req.method === 'GET') {
      const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
      res.writeHead(200, {'content-type': 'image/png'});
      return res.end(pngBytes);
    }
    if (url.pathname === '/api/materials/qa-material-000/file' && req.method === 'GET') {
      res.writeHead(200, {'content-type': 'application/octet-stream'}); return res.end(buildSamplePdf());
    }
    if (url.pathname === '/api/admin/accounts') {
      if (req.method === 'POST') {
        const u = usersList.find(x => x.uid === body.uid);
        if (u) {
          if (Array.isArray(body.roles)) {
            const nextRoles = [...new Set(body.roles)];
            if (nextRoles.includes('admin') && !nextRoles.includes('assistant')) nextRoles.push('assistant');
            u.roles = nextRoles;
          }
          if (body.status) u.status = body.status;
          const openIds = classesState.filter(c => !c.archived).map(c => c.id);
          const syncRole = (role, defaultPerms) => {
            const isActiveRole = u.status === 'active' && u.roles.includes(role) && !u.roles.includes('admin');
            if (isActiveRole) {
              for (const cid of openIds) {
                const existing = membershipsList.find(m => m.class_id === cid && m.uid === u.uid && m.member_role === role);
                if (existing) existing.status = 'active';
                else membershipsList.push({class_id: cid, uid: u.uid, member_role: role, status: 'active', permissions: [...defaultPerms]});
              }
            } else {
              for (const m of membershipsList) {
                if (m.uid === u.uid && m.member_role === role) {
                  m.status = 'inactive';
                  if (role === 'assistant' && !u.roles.includes('assistant')) m.permissions = [];
                }
              }
            }
          };
          syncRole('teacher', []);
          syncRole('assistant', allQaAssistantPerms);
        }
        return respond({ok: true});
      }
      return respond({items: usersList});
    }
    if (url.pathname === '/api/admin/years') {
      if (req.method === 'POST') {
        const yId = 'year-' + Date.now();
        yearsList.unshift({id: yId, name: body.name, starts_on: body.startsOn, ends_on: body.endsOn});
        return respond({ok: true, id: yId}, 201);
      }
      return respond({items: yearsList});
    }
    if (url.pathname === '/api/admin/classes') {
      if (req.method === 'POST') {
        if (body.id) {
          const c = classesState.find(x => x.id === body.id);
          if (c && body.name) c.name = body.name;
          return respond({ok: true});
        }
        const cId = 'class-' + Date.now();
        classesState.push({
          id: cId,
          name: body.name || 'Lớp mới',
          schoolYearId: body.schoolYearId || yearsList[0]?.id || 'qa-year',
          school_year_id: body.schoolYearId || yearsList[0]?.id || 'qa-year',
          schedule: formatScheduleSummary(body.scheduleSlots) || 'Chưa cập nhật',
          schedule_slots: body.scheduleSlots || []
        });
        return respond({ok: true, id: cId}, 201);
      }
      return respond({items: classesState.filter(c => !c.archived)});
    }
    if (url.pathname === '/api/admin/memberships') {
      if (req.method === 'POST') {
        const targetUser = usersList.find(u => u.uid === body.uid);
        if (!targetUser || targetUser.status !== 'active' || !Array.isArray(targetUser.roles) || !targetUser.roles.includes(body.role)) {
          return respond({error: 'Tài khoản chưa có vai trò tương ứng.'}, 400);
        }
        const classIds = Array.isArray(body.classIds) ? [...new Set(body.classIds)] : [body.classId];
        if (!classIds.length || classIds.some(cid => !classesState.some(c => c.id === cid && !c.archived))) {
          return respond({error: 'Lớp đã lưu trữ hoặc không tồn tại.'}, 400);
        }
        const nextStatus = body.status || 'active';
        if (nextStatus !== 'active' && !targetUser.roles.includes('admin') && (body.role === 'teacher' || body.role === 'assistant')) {
          return respond({error: `${body.role === 'teacher' ? 'Giáo viên' : 'Trợ giảng'} đang hoạt động được phân công tự động vào tất cả lớp đang mở.`}, 409);
        }
        for (const cid of classIds) {
          const entry = {
            class_id: cid,
            uid: body.uid,
            member_role: body.role,
            status: nextStatus,
            permissions: Array.isArray(body.permissions)
              ? body.permissions
              : (body.role === 'assistant' ? ['attendance.write', 'materials.write', 'assignments.write', 'practice.manage', 'notices.write', 'messages.write', 'schedule.manage'] : [])
          };
          const idx = membershipsList.findIndex(m => m.class_id === entry.class_id && m.uid === entry.uid && m.member_role === entry.member_role);
          if (idx === -1) membershipsList.push(entry);
          else membershipsList[idx] = {...membershipsList[idx], ...entry};
        }
        if (body.uid === account.uid) {
          viewer.memberships = membershipsList.filter(m => m.uid === account.uid && m.status === 'active').map(m => ({class_id: m.class_id, member_role: m.member_role}));
          if (!viewer.memberships.length) viewer.memberships = [{class_id: 'qa-class', member_role: 'student'}];
        }
        return respond({ok: true});
      }
      return respond({items: membershipsList});
    }
    if (url.pathname === '/api/admin/parent-links') {
      if (req.method === 'POST') {
        const nextStatus = body.status || 'active';
        if (!['active', 'inactive'].includes(nextStatus) || !body.parentUid || !body.studentUid || body.parentUid === body.studentUid) {
          return respond({error: 'Liên kết chỉ áp dụng giữa tài khoản Phụ huynh và Học sinh đang hoạt động.'}, 400);
        }
        const isStaff = roles => Array.isArray(roles) && roles.some(r => r === 'admin' || r === 'teacher' || r === 'assistant');
        const pUser = usersList.find(u => u.uid === body.parentUid);
        const sUser = usersList.find(u => u.uid === body.studentUid);
        if (nextStatus === 'active' && (
          !pUser || pUser.status !== 'active' || isStaff(pUser.roles) || !pUser.roles?.includes('parent') ||
          !sUser || sUser.status !== 'active' || isStaff(sUser.roles) || !sUser.roles?.includes('student')
        )) {
          return respond({error: 'Liên kết chỉ áp dụng giữa tài khoản Phụ huynh và Học sinh đang hoạt động.'}, 400);
        }
        const link = {parent_uid: body.parentUid, student_uid: body.studentUid, status: nextStatus};
        const idx = parentLinksList.findIndex(l => l.parent_uid === link.parent_uid && l.student_uid === link.student_uid);
        if (idx === -1) parentLinksList.push(link);
        else parentLinksList[idx] = link;
        return respond({ok: true});
      }
      return respond({items: parentLinksList});
    }
    if (url.pathname === '/api/admin/promotions/preview' && req.method === 'POST') {
      const routes = body.routes || {};
      const creates = Object.entries(routes)
        .filter(([, dest]) => Boolean(dest))
        .map(([sourceClassId, destClassId]) => ({studentId: 'qa-student', classId: destClassId, sourceClassId}));
      if (!creates.length) {
        return respond({canApply: false, creates: [], issues: ['Hãy chọn ít nhất một lớp đích để xem trước chuyển lớp.']});
      }
      return respond({canApply: true, planId: 'qa-plan-' + Date.now(), creates, issues: []});
    }
    if (url.pathname === '/api/admin/promotions/apply' && req.method === 'POST') {
      return respond({ok: true, count: 1});
    }
    if (req.method === 'POST') return respond({ok: true});
    return respond({error: 'QA route not configured'}, 404);
  }

  try {
    let bytes, type;
    if (url.pathname === '/app.js') {
      bytes = result.outputFiles[0].contents;
      type = 'text/javascript';
    } else if (/^\/pdfjs\/(?:pdf\.worker\.min\.mjs|(?:cmaps|standard_fonts|wasm|iccs)\/[A-Za-z0-9_.-]+)$/.test(url.pathname)) {
      bytes = await fs.readFile(path.join(root,'public',url.pathname.slice(1)));
      type = url.pathname.endsWith('.mjs')?'text/javascript':url.pathname.endsWith('.wasm')?'application/wasm':'application/octet-stream';
    } else {
      const appPaths = /^\/(?:login|app|overview|class|classes|settings|account|profile|tai-khoan|admin|enrollments|onboarding|archive|practice)(?:\.html)?$|^\/(?:class|practice|admin|enrollments)\/[A-Za-z0-9/_-]+(?:\.html)?$|^\/settings\/(?:profile|learning|security|privacy)(?:\.html)?$/;
      const file = url.pathname === '/' ? 'index.html' : appPaths.test(url.pathname) ? 'app.html' : url.pathname.slice(1);
      const allowedStatic = new Set([
        'index.html', 'style.css', 'app.html', 'app.css', 'scrollbars.css', 'logo.png', 'chinh-sach-bao-mat.html',
        'favicon.ico', 'favicon-16.png', 'favicon-32.png', 'apple-touch-icon.png',
        'practice-covers/thptqg.png', 'practice-covers/hsa.png', 'practice-covers/tsa.png',
        'practice-covers/thptqg.webp', 'practice-covers/hsa.webp', 'practice-covers/tsa.webp',
        'fonts/stix-two-math/STIXTwoMath-Regular.woff2'
      ]);
      if (!allowedStatic.has(file)) throw Error();
      bytes = await fs.readFile(path.join(root, 'public', file));
      type = file.endsWith('.css') ? 'text/css'
        : file.endsWith('.woff2') ? 'font/woff2'
        : file.endsWith('.webp') ? 'image/webp'
        : file.endsWith('.png') ? 'image/png'
        : file.endsWith('.ico') ? 'image/x-icon'
        : 'text/html; charset=utf-8';
      if (file === 'app.html' && process.env.LTCH_ROLE_AUDIT !== '1') {
        const previewBanner = `
<body>
<div style="padding:10px 16px;background:#e6f3f2;color:#035957;font-weight:600;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #74c2b1;flex-wrap:wrap;gap:8px;font-family:'Plus Jakarta Sans',sans-serif;font-size:13px;">
  <div style="display:flex;align-items:center;gap:8px;">
    <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#10b981;"></span>
    <span><strong>Lớp Toán cô Hạnh</strong> — Trình duyệt giao diện & Phê duyệt (Local UI Preview)</span>
  </div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;">
    <button onclick="window.qaSetMode && window.qaSetMode('admin')" style="padding:5px 12px;border-radius:6px;border:1px solid #035957;background:#fff;color:#035957;cursor:pointer;font-weight:600;font-size:12px;">👑 Xem Quản trị (Duyệt hồ sơ)</button>
    <button onclick="window.qaSetMode && window.qaSetMode('new_student')" style="padding:5px 12px;border-radius:6px;border:1px solid #035957;background:#fff;color:#035957;cursor:pointer;font-weight:600;font-size:12px;">📝 Xem Form Đăng ký HS mới</button>
    <button onclick="window.qaSetMode && window.qaSetMode('pending')" style="padding:5px 12px;border-radius:6px;border:1px solid #035957;background:#fff;color:#035957;cursor:pointer;font-weight:600;font-size:12px;">⏳ Xem Màn hình Chờ duyệt</button>
    <button onclick="window.qaSetMode && window.qaSetMode('revision')" style="padding:5px 12px;border-radius:6px;border:1px solid #d97706;background:#fff;color:#d97706;cursor:pointer;font-weight:600;font-size:12px;">⚠️ Xem Hộp yêu cầu sửa</button>
  </div>
</div>`;
        bytes = Buffer.from(bytes.toString().replace('<body>', previewBanner));
      }
    }
    res.writeHead(200, {'content-type': type, 'cache-control': 'no-store'});
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end();
  }
});

server.listen(5181, '127.0.0.1', () => process.stdout.write('Local UI QA ready on port 5181\n'));
