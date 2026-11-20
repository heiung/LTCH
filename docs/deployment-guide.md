# Hướng dẫn Cài đặt & Triển khai Hệ thống LTCH

Tài liệu này mô tả đầy đủ quy trình cấu hình, dựng, kiểm thử và triển khai hệ thống **Lớp Toán cô Hạnh (LTCH)** từ mã nguồn công khai lên hạ tầng riêng của bạn.

---

## 1. Yêu cầu môi trường

* **Node.js:** Phiên bản `22` (xem `.nvmrc`) và `npm`
* **Tài khoản dịch vụ chuyên trách:** Một tài khoản Google/Cloudflare/Supabase dùng cho quản trị và sở hữu Google Drive (`ADMIN_EMAIL` / `DRIVE_OWNER_EMAIL`)
* **Công cụ CLI:**
  * Firebase CLI (`npx firebase-tools`)
  * Cloudflare Wrangler (`npx wrangler`)
  * Supabase CLI (`npx supabase`)

---

## 2. Cài đặt cục bộ, Đóng gói & Kiểm thử

```sh
# 1. Cài đặt phụ thuộc chính xác theo lockfile
npm ci

# 2. Tạo tệp biến môi trường cục bộ (nếu chạy API cục bộ)
cp .dev.vars.example .dev.vars

# 3. Đóng gói giao diện (public/app.js, mathlive, pdfjs) & Worker (.deploy/api)
npm run build

# 4. Chạy toàn bộ bộ kiểm thử tự động (API, Postgres PGlite, Parser Word, Bảo mật)
npm test
```

### Kiểm thử giao diện theo vai trò (Playwright)
Cần cài trình duyệt Chromium cho Playwright trong lần đầu tiên:

```sh
npx playwright install chromium
npm run qa:roles
```

Báo cáo sau khi chạy được lưu tại `.local/role-audit/` (đã nằm trong `.gitignore`).

---

## 3. Danh sách cấu hình bắt buộc trước khi triển khai (Deployment Configuration Checklist)

Vì mã nguồn công khai không gắn cứng thông tin hạ tầng thật, hãy cập nhật lần lượt các mục sau theo dự án của bạn:

1. **`client/config.js`:** Điền `firebaseConfig` (Web API Key, `authDomain`, `projectId`, `appId`), `apiBase` (URL Cloudflare Pages API, vd. `https://api.ltch.example.com`) và `supportEmail`.
2. **`.firebaserc`:** Thay `your-firebase-project` bằng Firebase Project ID của bạn.
3. **`firebase.json`:** Trong header `Content-Security-Policy`, thay `https://api.ltch.example.com` và `https://your-firebase-project.firebaseapp.com` bằng domain API và `authDomain` của bạn.
4. **`public/index.html` & `public/chinh-sach-bao-mat.html`:** Cập nhật địa chỉ email hỗ trợ và domain trang web của bạn.
5. **Cloudflare Pages Secrets / Environment Variables:** Xem bảng biến ở mục 5.
6. **Google Apps Script Properties:** `LTCH_MAIL_SECRET` và `LTCH_API_BASE_URL` (xem mục 7).

---

## 4. Áp dụng Migration Cơ sở dữ liệu (Supabase)

Thư mục `supabase/migrations/` chứa đầy đủ 30 tệp SQL migration (từ `202611010001_auth.sql` đến `202611190031_notice_reads.sql`).

```sh
# Đăng nhập và liên kết đúng project Supabase của bạn
npx supabase login
npx supabase link --project-ref <YOUR_SUPABASE_PROJECT_REF>

# Kiểm tra và đẩy toàn bộ migration chưa áp dụng
npx supabase db push
```

> [!IMPORTANT]
> Không sửa tên hoặc thay đổi nội dung các tệp migration đã phát hành trong `supabase/migrations/`. Mọi thay đổi schema mới phải tạo tệp migration tiếp theo theo quy ước thời gian `YYYYMMDDNNNN_mo_ta.sql`.

---

## 5. Triển khai Backend API lên Cloudflare Pages

1. Xác thực Wrangler:
   ```sh
   npx wrangler login
   npx wrangler whoami
   ```
2. Thiết lập đầy đủ các biến môi trường / secrets trên dự án Cloudflare Pages (thay `<PAGES_PROJECT>` bằng tên dự án Pages của bạn):
   ```sh
   npx wrangler pages secret put ALLOWED_ORIGIN --project-name <PAGES_PROJECT>
   npx wrangler pages secret put API_ORIGIN --project-name <PAGES_PROJECT>
   npx wrangler pages secret put SUPABASE_URL --project-name <PAGES_PROJECT>
   npx wrangler pages secret put SUPABASE_SECRET --project-name <PAGES_PROJECT>
   npx wrangler pages secret put FIREBASE_PROJECT_ID --project-name <PAGES_PROJECT>
   npx wrangler pages secret put FIREBASE_API_KEY --project-name <PAGES_PROJECT>
   npx wrangler pages secret put MAIL_ENDPOINT --project-name <PAGES_PROJECT>
   npx wrangler pages secret put MAIL_SECRET --project-name <PAGES_PROJECT>
   npx wrangler pages secret put ADMIN_EMAIL --project-name <PAGES_PROJECT>
   npx wrangler pages secret put DRIVE_OWNER_EMAIL --project-name <PAGES_PROJECT>
   ```
   Các cờ tính năng tùy chọn (xem `.dev.vars.example`): `LTCH_LESSONS_ENABLED`, `LTCH_LESSONS_AUDIENCE`, `LTCH_LESSONS_PILOT_UIDS`, `LTCH_DRIVE_LINK_PREVIEW`.
3. Đóng gói và triển khai Worker:
   ```sh
   npm run build
   npx wrangler pages deploy .deploy/api --project-name <PAGES_PROJECT>
   ```
4. Kiểm tra trạng thái API:
   ```sh
   curl https://<API_DOMAIN>/api/health
   ```
   Kết quả kỳ vọng trả về JSON có `"ok": true`, `"ready": true` và `"database": "ok"`.

---

## 6. Triển khai Frontend & Firestore Rules lên Firebase Hosting

Cấu hình trong `firebase.json` đã tích hợp sẵn hook `"predeploy": ["npm run build"]` nên gói giao diện `public/app.js` và thư viện `mathlive` / `pdfjs` luôn được tạo mới trước khi đẩy lên hosting.

```sh
npx firebase-tools login --reauth
npx firebase-tools deploy --only hosting,firestore:rules --project <YOUR_FIREBASE_PROJECT_ID>
```

---

## 7. Triển khai Google Apps Script (OTP, Điểm danh & Nhắc lịch học)

Mã nguồn nằm trong `integrations/apps-script-otp/`:
* `Code.gs`: Điểm nhận `doPost`, xác thực chữ ký HMAC-SHA256 và gửi OTP / thông báo.
* `OtpTemplate.gs`: Mẫu HTML email OTP (đồng bộ từ `server/domain/notification-templates.cjs`).
* `Attendance.gs`: Xử lý hàng đợi gửi email điểm danh.
* `Reminders.gs`: Bộ lập lịch nhắc lịch học và đồng bộ Drive mỗi phút.

Quy trình cập nhật:
1. Nếu muốn đổi domain/email hỗ trợ hoặc sửa mẫu email trong `server/domain/`, thiết lập biến môi trường và đồng bộ sang `OtpTemplate.gs`:
   ```sh
   LTCH_SITE_URL=https://<YOUR_SITE_DOMAIN> LTCH_SUPPORT_EMAIL=<YOUR_ADMIN_EMAIL> npm run sync:otp-template
   ```
2. Mở dự án Google Apps Script thuộc tài khoản vận hành, dán 4 tệp `.gs` tương ứng.
3. Trong **Project Settings -> Script Properties**, thiết lập:
   * `LTCH_MAIL_SECRET`: trùng khớp chính xác với `MAIL_SECRET` trên Cloudflare Pages (tối thiểu 32 ký tự).
   * `LTCH_API_BASE_URL`: URL gốc của API Backend (ví dụ `https://api.ltch.example.com`).
4. Triển khai dưới dạng **Web App** (Execute as: `Me`, Who has access: `Anyone`), lấy URL `/exec` cập nhật vào secret `MAIL_ENDPOINT`.
5. Trong trình soạn thảo Apps Script, chạy thử:
   * `verifyAttendanceMailConnection()` — xác nhận kết nối nội bộ API điểm danh thành công.
   * `installLessonReminderTrigger()` — tạo trigger chạy mỗi 1 phút cho `sendLessonReminders`.

---

## 8. Kết nối Google Drive OAuth (Lưu trữ Bài giảng, Bài nộp & Gói đề)

Sử dụng công cụ nội bộ `scripts/connect-google-drive.mjs` (đọc thông tin đích từ biến môi trường để tránh thao tác nhầm tài khoản):

```sh
CLOUDFLARE_ACCOUNT_ID=<YOUR_CF_ACCOUNT_ID> \
CLOUDFLARE_PAGES_PROJECT=<PAGES_PROJECT> \
DRIVE_OWNER_EMAIL=<YOUR_DRIVE_OWNER_EMAIL> \
ALLOWED_ORIGIN=https://<YOUR_SITE_DOMAIN> \
node scripts/connect-google-drive.mjs --client-file <duong-dan-tep-oauth-web.json>
```

Mở địa chỉ `http://127.0.0.1:48421/start` hiển thị trên màn hình, đăng nhập đúng tài khoản `DRIVE_OWNER_EMAIL` và cấp quyền `drive.file`. Công cụ sẽ tự kiểm tra tạo/tải/xóa tệp thử nghiệm trên Drive và nạp 3 khóa `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN` vào Cloudflare Pages.
