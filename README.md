# Hệ thống Lớp Toán cô Hạnh (LTCH)

Không gian học tập số, quản lý lớp học và phòng luyện thi chuyên sâu môn Toán (THPTQG · ĐGNL HSA · ĐGTD TSA) dành cho học sinh THCS & THPT.

> [!NOTE]
> Đây là phiên bản mã nguồn sạch, độc lập hạ tầng (12-Factor). Mọi mã định danh dự án thật, domain và email vận hành được cấu hình qua tệp cấu hình/biến môi trường khi triển khai (xem mục **Danh sách cấu hình khi triển khai** hoặc [docs/deployment-guide.md](./docs/deployment-guide.md)).

## Tính năng cốt lõi

* **Cổng học tập & Phân quyền 5 vai trò:** Quản trị viên (`admin`), Giáo viên (`teacher`), Trợ giảng (`assistant` với 7 quyền chi tiết theo từng lớp), Học sinh (`student`) và Phụ huynh (`parent`).
* **Xác thực hai lớp an toàn:** Đăng nhập Google/Email qua Firebase Authentication kết hợp mã OTP 6 số gửi qua Google Apps Script có ký số HMAC-SHA256 và giới hạn tần suất (`rate limiting`).
* **Tuyển sinh & Phê duyệt hồ sơ:** Đăng ký trực tuyến theo năm học/lớp học động, hỗ trợ quy trình duyệt, yêu cầu chỉnh sửa hoặc khóa tài khoản kèm thông báo email tự động.
* **Vận hành lớp học:** Quản lý lịch học, điểm danh kèm hàng đợi email báo chuyên cần, nhắc lịch học tự động, bài giảng/tài liệu đa phương tiện (Google Drive + watermark theo người xem), bài tập về nhà, thông báo chung/theo lớp và diễn đàn hỗ trợ công thức Toán học.
* **Phòng luyện thi & Nhập đề từ Word:** Hỗ trợ đầy đủ 3 kỳ thi (**THPTQG**, **HSA**, **TSA**) với 6 dạng câu hỏi, trình phân tích trực tiếp tệp `.docx` kèm công thức KaTeX/MathLive, quản lý phiên bản câu hỏi và trang chữa đề chi tiết.

## Cấu trúc thư mục dự án

```text
├── .github/workflows/       # Tự động đóng gói & kiểm thử CI trên GitHub Actions
├── client/                  # Mã nguồn giao diện phía máy khách (ES Modules)
│   ├── app.js               # Ứng dụng SPA chính
│   ├── practice-rooms.mjs   # Giao diện Phòng luyện thi THPTQG / HSA / TSA
│   ├── word-exam-ai-guide.mjs # Hướng dẫn soạn đề Word chuẩn LTCH
│   └── config.js            # Cấu hình Firebase Web công khai, Endpoint API & Email hỗ trợ
├── public/                  # Tệp tĩnh gốc phục vụ Firebase Hosting
│   ├── index.html           # Trang giới thiệu lớp học (Landing Page)
│   ├── app.html             # Cổng học tập & đăng nhập (Portal)
│   ├── chinh-sach-bao-mat.html # Chính sách bảo vệ dữ liệu cá nhân
│   ├── fonts/               # Phông chữ Toán học STIX Two Math
│   ├── mau-dang-tai/        # 3 tệp Word mẫu chuẩn (THPTQG, HSA, TSA)
│   └── practice-covers/     # Ảnh bìa minh họa cho 3 phòng luyện thi
├── worker/                  # Mã nguồn Cloudflare Pages Worker (Backend API)
│   ├── index.mjs            # Điểm vào chính của REST API & định tuyến
│   ├── config.mjs           # Đọc & kiểm tra nghiêm ngặt cấu hình từ biến môi trường
│   ├── business.mjs         # Nghiệp vụ lớp học, lịch học, điểm danh, bài tập
│   ├── enrollment-handler.mjs # Nghiệp vụ đăng ký & phê duyệt hồ sơ
│   ├── practice-rooms.mjs   # Động cơ tổ chức thi & chấm điểm phòng luyện
│   ├── practice-drive.mjs   # Lưu trữ gói đề & hình ảnh trên Google Drive
│   ├── lesson-storage.mjs   # Lưu trữ bài giảng, video & bài nộp lên Drive
│   └── supabase-*.mjs       # Bộ truy cập dữ liệu Supabase PostgreSQL
├── server/                  # Miền logic lõi dùng chung & mẫu email
│   ├── app.cjs              # Máy chủ Express dự phòng
│   ├── domain/              # Logic OTP, phân quyền, chấm điểm & mẫu email HTML
│   └── integrations/        # Kết nối Apps Script Mailer, Firestore, Supabase
├── shared/                  # Logic dùng chung giữa trình duyệt và Worker
│   ├── classroom.mjs        # Điều hướng & phân quyền lớp học
│   └── word-exam-parser.mjs # Trình đọc & kiểm tra file đề Word (.docx)
├── supabase/migrations/     # 30 tệp SQL migration (0001 -> 0031)
├── integrations/apps-script-otp/ # Mã nguồn Google Apps Script (OTP, Nhắc học, Điểm danh)
├── scripts/                 # Công cụ đóng gói & kết nối Google Drive OAuth
├── tests/                   # Bộ kiểm thử tự động (Node test runner, PGlite, Playwright)
├── docs/                    # Tài liệu kiến trúc, đặc tả kỹ thuật & hướng dẫn triển khai
├── firebase.json            # Cấu hình Firebase Hosting, rewrites & CSP headers
├── firestore.rules          # Quy tắc bảo mật Firestore (chặn truy cập trực tiếp từ client)
└── package.json             # Khai báo phụ thuộc & các lệnh vận hành
```

> **Lưu ý về tệp sinh tự động:** Các tệp `public/app.js`, `public/mathlive/`, `public/pdfjs/` và `.deploy/api/` được tạo tự động khi chạy `npm run build` và không lưu trong Git.

## Bắt đầu nhanh tại máy

Yêu cầu **Node.js 22** (tham khảo `.nvmrc`).

```sh
# Cài đặt thư viện
npm ci

# Đóng gói giao diện và Backend Worker
npm run build

# Chạy toàn bộ bộ kiểm thử tự động (tự động build qua pretest)
npm test
```

Để chạy kiểm thử giao diện theo 5 vai trò với Playwright:

```sh
npx playwright install chromium
npm run qa:roles
```

## Danh sách cấu hình khi triển khai mới

Trước khi triển khai lên hạ tầng riêng của bạn, cập nhật các giá trị tương ứng (tối thiểu tại các mục sau):

1. **Frontend & Hosting:** [client/config.js](./client/config.js) (`firebaseConfig`, `apiBase`, `supportEmail`), [.firebaserc](./.firebaserc), CSP trong [firebase.json](./firebase.json), và thông tin liên hệ trên [public/index.html](./public/index.html) & [public/chinh-sach-bao-mat.html](./public/chinh-sach-bao-mat.html).
2. **Backend API Secrets (Cloudflare Pages):** `ALLOWED_ORIGIN`, `API_ORIGIN`, `SUPABASE_URL`, `SUPABASE_SECRET`, `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`, `MAIL_ENDPOINT`, `MAIL_SECRET`, `ADMIN_EMAIL`, `DRIVE_OWNER_EMAIL` (xem [.dev.vars.example](./.dev.vars.example)).
3. **Google Apps Script Properties:** `LTCH_MAIL_SECRET` và `LTCH_API_BASE_URL`.

Xem hướng dẫn chi tiết từng bước tại [docs/deployment-guide.md](./docs/deployment-guide.md).

## Tài liệu kỹ thuật liên quan

* [Tổng quan kiến trúc hệ thống](./docs/system-overview.md)
* [Hướng dẫn cài đặt & triển khai](./docs/deployment-guide.md)
* [Đặc tả quy trình đăng ký & phê duyệt](./docs/enrollment-spec.md)
* [Thiết kế hệ thống Phòng luyện thi THPTQG · HSA · TSA](./docs/practice-rooms-design.md)
* [Thiết kế nhập đề thi từ file Word (.docx)](./docs/word-exam-import-design.md)
* [Chính sách bảo mật & quản lý khóa](./SECURITY.md)
