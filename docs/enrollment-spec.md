# ĐẶC TẢ KỸ THUẬT BACKEND: QUY TRÌNH ĐĂNG KÝ VÀ PHÊ DUYỆT HỌC SINH
**Hệ thống:** Lớp Toán cô Hạnh (LTCH)  
**Tài khoản dịch vụ:** Cấu hình qua biến môi trường `ADMIN_EMAIL` (mặc định mẫu: `admin@example.com`)  
**Dự án Supabase:** Cấu hình qua `SUPABASE_URL` (`https://your-project.supabase.co`)  
**Dự án Firebase:** Cấu hình qua `FIREBASE_PROJECT_ID` (`your-firebase-project`)

---

## 1. MỤC TIÊU NGHIỆP VỤ & PHÂN ĐỊNH TÀI KHOẢN

### 1.1. Phân định rõ 2 tài khoản riêng biệt
Hệ thống có **2 tài khoản hoàn toàn tách biệt** (2 UID khác nhau trong `ltch_accounts`):
1. **Tài khoản Quản trị viên (Admin):** Quản trị kỹ thuật, cấu hình hạ tầng, kiểm soát tài khoản dịch vụ (`ADMIN_EMAIL`), bảo mật và phân quyền tổng thể.
2. **Tài khoản của Cô Hạnh:** Giáo viên trưởng / chủ nhiệm bộ môn Toán, phụ trách chuyên môn, học liệu, bài tập và trực tiếp theo dõi học sinh các lớp.
*Ghi chú quan trọng:* Hai tài khoản này gần như có quyền tương đương trong việc quản lý lớp và phê duyệt hồ sơ học sinh, nhưng **hoàn toàn là 2 tài khoản riêng biệt**, không được gộp chung hay đồng nhất danh xưng.

### 1.2. Quy trình đăng ký & phê duyệt
Khi một học sinh hoặc phụ huynh đăng nhập vào hệ thống (qua Google hoặc Email OTP):
1. **Tự động nhận diện tài khoản mới:** Nếu tài khoản chưa được gán vào lớp học, hệ thống tự động đưa đến trang điền hồ sơ đăng ký.
2. **Thông tin xác minh 3 phần:**
   - **Ảnh nhận diện:** Ảnh chụp rõ khuôn mặt (ảnh đời thường, selfie... không bắt buộc ảnh thẻ).
   - **Lớp học:** Chọn Năm học & Lớp học động từ `6A, 6B` đến `12A, 12B` (do Quản trị viên / Cô Hạnh quản lý).
   - **Thông tin xác minh:** Họ tên HS, Ngày sinh, Trường đang học (THCS/THPT), SĐT học sinh + Họ tên Phụ huynh, SĐT Phụ huynh, Mối quan hệ.
3. **Màn hình chờ duyệt & Nút Duyệt Gấp:** Học sinh chờ xem xét; có nút *"Yêu cầu Quản trị viên duyệt gấp"* tự động gửi email thông báo đến `ADMIN_EMAIL`.
4. **Quản trị viên / Cô Hạnh xử lý 3 hướng minh bạch:**
   - **Duyệt vào lớp:** Tự động gán vào lớp, kích hoạt tài khoản `active`, gửi email chúc mừng đến học sinh.
   - **Yêu cầu chỉnh sửa:** Ghi rõ lý do (ví dụ: chọn nhầm lớp, ảnh bị mờ) ➔ Gửi email thông báo ➔ Học sinh đăng nhập lại thấy lời nhắn và được mở lại form để sửa và gửi lại.
   - **Từ chối / Khóa:** Dành cho tài khoản spam, quấy rối.

---

## 2. CƠ SỞ DỮ LIỆU (SUPABASE MIGRATION)

Tạo file migration mới `supabase/migrations/202611010007_enrollment.sql`:

```sql
begin;

-- 1. Bảng lưu đơn đăng ký chọn lớp của học sinh
create table if not exists public.ltch_enrollment_requests (
  id text primary key default gen_random_uuid()::text,
  uid text not null references public.ltch_accounts(uid) on delete cascade,
  school_year_id text not null references public.ltch_school_years(id),
  class_id text not null references public.ltch_classes(id),
  full_name text not null check (length(full_name) between 1 and 160),
  date_of_birth date,
  school_name text not null check (length(school_name) between 1 and 200),
  student_phone text check (length(student_phone) <= 30),
  parent_name text not null check (length(parent_name) between 1 and 160),
  parent_phone text not null check (length(parent_phone) between 8 and 30),
  parent_relation text not null check (parent_relation in ('father', 'mother', 'guardian')),
  photo_path text, -- Đường dẫn lưu trữ trong Storage bucket hoặc URL
  status text not null default 'pending' check (status in ('pending', 'needs_revision', 'approved', 'rejected')),
  admin_notes text default '' check (length(admin_notes) <= 2000),
  urgent_notified_at bigint, -- Lưu timestamp lần cuối bấm "Duyệt gấp" (chống spam)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text references public.ltch_accounts(uid)
);

create index if not exists ltch_enrollment_uid on public.ltch_enrollment_requests(uid);
create index if not exists ltch_enrollment_status on public.ltch_enrollment_requests(status);
create index if not exists ltch_enrollment_class on public.ltch_enrollment_requests(class_id);

-- 2. Bảo mật RLS
alter table public.ltch_enrollment_requests enable row level security;
revoke all on public.ltch_enrollment_requests from public, anon, authenticated;
grant select, insert, update, delete on public.ltch_enrollment_requests to service_role;

commit;
```

---

## 3. DANH SÁCH API ENDPOINTS (CLOUDFLARE WORKER / SERVER)

Tất cả các endpoint đều yêu cầu xác thực phiên OTP (`headers.authorization = 'Session ...'`).

### 3.1. Dành cho Học sinh (Student Flow)

#### 1. `GET /api/enrollment/my-status`
- **Mục đích:** Frontend gọi ngay sau khi đăng nhập để tự động phân luồng giao diện.
- **Phản hồi:**
  ```json
  {
    "hasRequest": true,
    "status": "pending | needs_revision | approved | none",
    "request": {
      "id": "req-uuid",
      "classId": "12a1",
      "className": "12A",
      "schoolYearId": "2026-2027",
      "fullName": "Nguyễn Văn A",
      "dateOfBirth": "2009-05-15",
      "schoolName": "THPT Chu Văn An",
      "studentPhone": "0912345678",
      "parentName": "Nguyễn Văn B",
      "parentPhone": "0987654321",
      "parentRelation": "father",
      "photoUrl": "/api/enrollment/photo/...",
      "adminNotes": "Lớp 12A1 đã đủ sĩ số, em vui lòng chọn lại sang lớp 12A2",
      "createdAt": "2026-11-01T10:00:00Z"
    }
  }
  ```

#### 2. `POST /api/enrollment/submit`
- **Mục đích:** Học sinh nộp hồ sơ mới hoặc nộp lại sau khi chỉnh sửa.
- **Hỗ trợ:** `multipart/form-data` (nếu có gửi file ảnh trực tiếp) hoặc `application/json` (kèm photo URL/base64).
- **Body:**
  - `classId`, `schoolYearId`, `fullName`, `dateOfBirth`, `schoolName`, `studentPhone`, `parentName`, `parentPhone`, `parentRelation`, `photo` (file hoặc path).
- **Xử lý:**
  - Kiểm tra `classId` và `schoolYearId` tồn tại.
  - Lưu file ảnh vào bucket Storage an toàn (nếu có upload file mới).
  - Cập nhật hoặc thêm mới vào `ltch_enrollment_requests`, đặt `status = 'pending'`, reset `admin_notes`.
  - Trả về `{ ok: true, status: 'pending' }`.

#### 3. `POST /api/enrollment/urgent-notify`
- **Mục đích:** Học sinh bấm nút *"Yêu cầu Quản trị viên duyệt gấp"*.
- **Giới hạn (Rate-Limit):** Mỗi tài khoản chỉ được gửi 1 lần mỗi 30 phút để chống spam email.
- **Xử lý:**
  - Kiểm tra đơn đăng ký hiện tại của học sinh đang ở trạng thái `pending`.
  - Kiểm tra `urgent_notified_at`: nếu chưa đủ 30 phút, từ chối với lỗi `Vui lòng đợi 30 phút giữa các lần gửi yêu cầu duyệt gấp`.
  - Kích hoạt gửi email tự động tới Quản trị viên (`ADMIN_EMAIL`).
  - Ghi nhận `urgent_notified_at = Date.now()`.
  - Trả về `{ ok: true, message: 'Đã gửi email thông báo tới Quản trị viên' }`.

---

### 3.2. Dành cho Quản trị viên & Cô Hạnh (Review & Management Flow)

#### 4. `GET /api/admin/enrollments`
- **Quyền:** Tài khoản `admin` hoặc tài khoản Cô Hạnh (`teacher` có thẩm quyền).
- **Query params:** `?status=pending,needs_revision` (mặc định lấy danh sách đang chờ xử lý).
- **Phản hồi:** Danh sách các hồ sơ kèm thông tin học sinh, phụ huynh, lớp đăng ký, ảnh nhận diện và thời gian nộp.

#### 5. `POST /api/admin/enrollments/review`
- **Quyền:** Tài khoản `admin` hoặc tài khoản Cô Hạnh (`teacher` có thẩm quyền).
- **Body:**
  ```json
  {
    "requestId": "req-uuid",
    "action": "approve | request_revision | reject",
    "classId": "12a2", // Tùy chọn nếu Admin muốn đổi lớp khi duyệt
    "adminNotes": "Lý do yêu cầu sửa (bắt buộc nếu action là request_revision)"
  }
  ```
- **Xử lý theo từng action:**
  - **Khi `action === 'approve'`:**
    1. Cập nhật `ltch_enrollment_requests.status = 'approved'`.
    2. Cập nhật `ltch_accounts.status = 'active'`, bổ sung vai trò `'student'` vào mảng `roles` của tài khoản nếu chưa có.
    3. Thêm bản ghi vào `ltch_class_memberships`:
       ```sql
       insert into public.ltch_class_memberships (class_id, uid, member_role, status)
       values (target_class_id, student_uid, 'student', 'active')
       on conflict do nothing;
       ```
    4. Gửi email tự động chúc mừng học sinh đã được duyệt vào lớp (qua Google Apps Script).
  - **Khi `action === 'request_revision'`:**
    1. Bắt buộc có `adminNotes`.
    2. Cập nhật `ltch_enrollment_requests.status = 'needs_revision'` và lưu `admin_notes`.
    3. Gửi email thông báo cho học sinh biết lý do cần chỉnh sửa hồ sơ.
  - **Khi `action === 'reject'`:**
    1. Cập nhật `ltch_enrollment_requests.status = 'rejected'`.
    2. Khóa tài khoản: `update public.ltch_accounts set status = 'disabled' where uid = student_uid`.

---

## 4. DỊCH VỤ GỬI EMAIL (GOOGLE APPS SCRIPT)

Trong `integrations/apps-script-otp/Code.gs`, mở rộng hàm `doPost(e)` để hỗ trợ các mẫu email có chữ ký HMAC SHA256 an toàn.

> **Quy định bắt buộc:**
> - Tên thương hiệu: **Lớp Toán cô Hạnh** (tuyệt đối không dùng từ "trung tâm").
> - Email Quản trị viên: cấu hình qua `ADMIN_EMAIL` (vd. `admin@example.com`).
> - Nội dung email phải chuẩn xác từng câu chữ, trang trọng và đầy đủ theo 3 mẫu chuẩn mực dưới đây:

---

### Mẫu 1: `revision_request` (Gửi Học sinh khi Quản trị viên yêu cầu sửa hồ sơ)
- **Tiêu đề:** `[Lớp Toán cô Hạnh] Yêu cầu cập nhật thông tin hồ sơ đăng ký lớp học`
- **Nội dung:**
```
Kính gửi Quý phụ huynh và em {{full_name}},

Ban quản lý Lớp Toán cô Hạnh đã tiếp nhận hồ sơ đăng ký tham gia lớp học của em. Qua quá trình rà soát, Quản trị viên nhận thấy có một số thông tin cần được điều chỉnh hoặc bổ sung để việc xếp lớp và quản lý học tập được chính xác nhất.

📌 Nội dung Quản trị viên yêu cầu chỉnh sửa:
----------------------------------------------------------------------
{{admin_notes}}
----------------------------------------------------------------------

📝 Hướng dẫn thực hiện:
1. Truy cập vào Cổng học tập tại: https://ltch.example.com/app.html
2. Đăng nhập bằng tài khoản email này. Hệ thống sẽ tự động hiển thị lại hồ sơ với các thông tin đã điền trước đó.
3. Điều chỉnh lại những mục được yêu cầu và nhấn nút "Gửi lại hồ sơ để xét duyệt".

Quản trị viên sẽ ưu tiên xem xét và kích hoạt tài khoản ngay khi nhận được hồ sơ cập nhật lại từ em.

Trân trọng,
Ban Quản trị — Lớp Toán cô Hạnh
Hỗ trợ kỹ thuật: admin@example.com
```

---

### Mẫu 2: `approval_notice` (Gửi Học sinh khi hồ sơ được duyệt thành công)
- **Tiêu đề:** `[Lớp Toán cô Hạnh] Thông báo: Hồ sơ đăng ký đã được phê duyệt thành công`
- **Nội dung:**
```
Kính gửi Quý phụ huynh và em {{full_name}},

Ban quản lý Lớp Toán cô Hạnh xin trân trọng thông báo: Hồ sơ đăng ký tham gia lớp học của em đã được Quản trị viên phê duyệt chính thức!

🎓 Thông tin lớp học được phân công:
- Học sinh: {{full_name}}
- Lớp học: {{class_name}}
- Năm học: {{school_year_name}}
- Giáo viên phụ trách môn Toán: Cô Hạnh
- Lịch học định kỳ: {{schedule}}

🚀 Quyền lợi học tập đã được kích hoạt trên hệ thống:
- Xem kho bài giảng chuyên đề và tải tài liệu PDF bổ trợ.
- Làm bài tập về nhà trực tuyến và nhận nhận xét, chấm chữa chi tiết từ giáo viên.
- Tham gia phòng luyện đề trắc nghiệm tự động có lời giải từng bước.
- Theo dõi nhật ký điểm danh chuyên cần của từng buổi học.

👉 Đăng nhập vào lớp học ngay tại đây:
https://ltch.example.com/app.html
(Em chỉ cần đăng nhập bằng tài khoản email này là vào được thẳng không gian lớp học).

Kính chúc em một năm học môn Toán nhiều tiến bộ, nắm vững bản chất và tự tin chinh phục các kỳ thi!

Trân trọng,
Ban Quản trị — Lớp Toán cô Hạnh
```

---

### Mẫu 3: `urgent_admin_alert` (Gửi Quản trị viên khi học sinh bấm "Duyệt gấp")
- **Người nhận:** `admin@example.com`
- **Tiêu đề:** `[LTCH - YÊU CẦU DUYỆT GẤP] Học sinh {{full_name}} xin vào lớp {{class_name}}`
- **Nội dung:**
```
Kính gửi Quản trị viên Lớp Toán cô Hạnh,

Hệ thống vừa ghi nhận yêu cầu ưu tiên xét duyệt hồ sơ từ học sinh sau:

📋 Thông tin chi tiết hồ sơ:
- Học sinh: {{full_name}}
- Lớp đăng ký: {{class_name}} (Năm học: {{school_year_name}})
- Trường đang học: {{school_name}}
- Ngày sinh: {{date_of_birth}}
- Số điện thoại học sinh: {{student_phone}}
- Phụ huynh: {{parent_name}} — SĐT phụ huynh: {{parent_phone}} (Quan hệ: {{parent_relation}})
- Email tài khoản: {{user_email}}
- Thời điểm gửi yêu cầu: {{request_time}}

👉 Link mở trang Quản trị để duyệt ngay:
https://ltch.example.com/app.html

Hệ thống thông báo tự động Lớp Toán cô Hạnh.
```
