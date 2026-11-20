# Chính sách Bảo mật — Lớp Toán cô Hạnh (LTCH)

## 1. Quản trị hạ tầng & Phân tách tài khoản
- Toàn bộ hạ tầng vận hành (**Firebase**, **Cloudflare Pages**, **Supabase**, **Google Drive**, **Google Apps Script**) nên được quản trị tập trung bằng một tài khoản dịch vụ chuyên trách (`ADMIN_EMAIL` / `DRIVE_OWNER_EMAIL`), tách biệt với tài khoản cá nhân.

## 2. Nguyên tắc quản lý bí mật & tệp cấu hình
- **Tuyệt đối không commit** lên Git các tệp chứa bí mật hoặc thông tin xác thực thật:
  - `.env`, `.env.*` (ngoại trừ `.env.example`)
  - `.dev.vars`, `.dev.vars.*` (ngoại trừ `.dev.vars.example`)
  - Khóa riêng (`*.pem`, `*.key`), tệp chứng chỉ OAuth (`*client_secret*.json`), hoặc Service Account JSON.
- Toàn bộ bí mật máy chủ chỉ lưu trong **Cloudflare Pages Secrets** và **Google Apps Script Properties** (`LTCH_MAIL_SECRET`, `LTCH_API_BASE_URL`).
- `client/config.js` chỉ chứa cấu hình công khai phía trình duyệt (`firebaseConfig` Web API Key, `apiBase` và `supportEmail`). Không bao giờ đưa `SUPABASE_SECRET`, `MAIL_SECRET`, hoặc OAuth Secret vào `client/` hay `public/`.

## 3. Kiến trúc bảo vệ nhiều lớp
- **Xác thực cấu hình Fail-Closed (`worker/config.mjs`):** API từ chối khởi chạy hoặc trả lỗi `503` nếu `ALLOWED_ORIGIN` không phải HTTPS hợp lệ hoặc `SUPABASE_URL` không đúng định dạng `https://<project-ref>.supabase.co`.
- **Firestore Security Rules (`firestore.rules`):** Từ chối toàn bộ truy cập đọc/ghi trực tiếp từ trình duyệt (`allow read, write: if false`).
- **Supabase PostgreSQL & RLS:** Các bảng nghiệp vụ được bảo vệ bằng Row-Level Security (`supabase/migrations/`); API máy chủ xác thực đồng thời **Firebase ID Token** + **OTP Session Token** trước khi truy vấn bằng quyền dịch vụ.
- **Google Apps Script Mailer:** Mọi yêu cầu gửi OTP, thông báo và điểm danh đều được ký số **HMAC-SHA256** kèm `timestamp` (cửa sổ 120 giây) và `nonce` chống gửi lại (`replay protection`).
- **Bảo vệ tiêu đề HTTP (`firebase.json`):** Thiết lập đầy đủ `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy` và `Permissions-Policy`.

## 4. Quy trình xoay vòng khóa khi nghi ngờ lộ lọt
1. **Xoay vòng `MAIL_SECRET`:** Tạo chuỗi ngẫu nhiên mới tối thiểu 32 ký tự, cập nhật đồng bộ `LTCH_MAIL_SECRET` trong Script Properties của Google Apps Script và `MAIL_SECRET` trên Cloudflare Pages (`npx wrangler pages secret put MAIL_SECRET --project-name <ten-du-an-pages>`).
2. **Xoay vòng `SUPABASE_SECRET`:** Tạo lại Secret Key trong bảng điều khiển Supabase, cập nhật lại Cloudflare Pages secret và thu hồi khóa cũ.
3. **Xoay vòng Google Drive OAuth:** Thu hồi quyền OAuth trong Google Cloud Console, sau đó chạy lại `node scripts/connect-google-drive.mjs --client-file <duong-dan-oauth.json>`.

## 5. Báo cáo lỗ hổng bảo mật
- Nếu phát hiện sự cố bảo mật hoặc cấu hình sai, vui lòng liên hệ trực tiếp với quản trị viên hệ thống qua địa chỉ hỗ trợ được cấu hình trong mục Hỗ trợ của cổng học tập (hoặc tạo Security Advisory riêng tư trên GitHub).
