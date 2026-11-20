# Tài liệu Thiết kế Hệ thống Khảo thí & Phòng Luyện đề: THPTQG, HSA & TSA (Lớp Toán Cô Hạnh)

> [!IMPORTANT]
> **NGUYÊN TẮC KIẾN TRÚC TÁCH BIỆT BẮT BUỘC (PORTAL vs. EXAM ROOM):**
> 1. **Sảnh ngoài (Portal / Dashboard Luyện đề):** Nơi học sinh xem danh sách, lọc đề theo kỳ thi (`THPTQG`, `HSA`, `TSA`) và bấm *"Vào thi"*.
> 2. **Phòng thi độc lập (Dedicated Exam Room):** Khi bấm *"Vào thi"*, màn hình phòng thi mở ra **HOÀN TOÀN BIỆT LẬP**, **TUYỆT ĐỐI KHÔNG CÓ** thanh chuyển đổi kỳ thi hay menu bên ngoài. Màn hình bắt đầu trực tiếp bằng Header chính thức, **100% Full nền sáng (No Dark Mode)**, tập trung cao độ như thi thật.
> 3. **Thương hiệu:** Toàn bộ hệ thống sử dụng thương hiệu **`[LTCH]` (Lớp Toán Cô Hạnh)**.

---

## 1. Phân quyền & Điều hướng Phòng Luyện theo Khối Lớp (Lớp 10, 11, 12)

Chức năng Phòng Luyện đề được bảo vệ bằng phân quyền nghiêm ngặt dựa trên **khối lớp thực tế mà học sinh đang theo học trong năm học hiện tại** (tuyệt đối không lưu cứng trường `student_grade` trong bảng tài khoản):

### 1.1. Cơ chế Xác định Khối Lớp Động & Học sinh Học Nhiều Lớp Khác Khối
* **Bổ sung và đồng bộ trường `grade` vào bảng lớp học (`ltch_classes`):**
  * Bảng `ltch_classes` bổ sung cột `grade smallint CHECK (grade BETWEEN 6 AND 12)` bên cạnh `id, name, school_year_id` (migration tự suy diễn khối từ tên lớp cho dữ liệu hiện có).
  * **Đồng bộ bắt buộc cột `grade` trong mọi thao tác lớp học & chuyển niên khóa:** Khi tạo lớp mới (`create_class`), đổi tên lớp, hoặc chạy chuyển niên khóa (`advance_school_year` trong `worker/business.mjs` & `shared/classroom.mjs`), hệ thống bắt buộc ghi/cập nhật đồng bộ cột `grade` (`grade = prom.toGrade` khi lên lớp, `grade = 6` khi tạo lớp 6 mới, giữ nguyên `grade = 12` khi đưa lớp 12 vào `archived = true`).
* **Lưu Lịch sử Khối học theo Niên khóa (`ltch_student_grade_history`) phục vụ "Kho đã học":**
  * Do `advance_school_year` nâng khối trực tiếp trên bản ghi lớp hiện hành (`Lớp 10A` $\rightarrow$ `Lớp 11A`, đổi `school_year_id` sang năm mới), hệ thống bổ sung bảng `ltch_student_grade_history (uid, school_year_id, grade, class_id)` tự động ghi nhận mỗi khi học sinh được xếp vào lớp và ngay trước khi chạy `advance_school_year`.
  * Nhờ bảng lịch sử này, hệ thống biết chính xác từng học sinh đã học khối nào ở năm học nào tại trung tâm (phân biệt rõ học sinh cũ từ Lớp 10 lên Lớp 11 được mở *"Kho đã học"* Lớp 10 năm trước, với học sinh mới vào thẳng Lớp 11 năm nay).
* **Tự động chốt các bài đang làm dở trước khi chuyển niên khóa (`advance_school_year`):**
  * Ngay ở bước đầu tiên của giao dịch `advance_school_year`, máy chủ tự động quét và chốt toàn bộ các lượt làm đang ở trạng thái `'in_progress'` trong `ltch_practice_attempts` bằng bản nháp gần nhất (`autoFinalizeExpiredAttempt`), đảm bảo không có bài làm nào của học sinh Lớp 12 (sắp chuyển sang Đã tốt nghiệp) bị treo trạng thái `'in_progress'`.
* **Cơ chế Xác định "Năm học hiện tại" & "Học sinh Đã tốt nghiệp" (Đồng bộ với `advance_school_year`):**
  * **1. Cách xác định "Năm học hiện tại" (`currentSchoolYear`):**
    * Hệ thống sử dụng cơ chế chuyển niên khóa (`advance_school_year`): khi ban quản trị bấm chuyển sang năm học mới, toàn bộ các lớp đang hoạt động (`archived = false`) từ khối 6 đến khối 11 được nâng lên 1 khối (`grade + 1`) và gắn `school_year_id` của năm học mới; đồng thời các lớp 12 cũ tự động được đưa vào **Kho lưu trữ (`archived = true`)**.
    * Do đó, **Năm học hiện tại (`currentSchoolYear`)** của học sinh được lấy trực tiếp từ `school_year_id` của lớp đang hoạt động (`archived = false`) mà học sinh đang theo học (hoặc nếu xét toàn hệ thống thì ưu tiên năm học của các lớp `archived = false`, đối chiếu thêm `starts_on <= today <= ends_on`). Nhờ vậy, kể cả khi Admin tạo trước một bản ghi năm học tương lai trong bảng `ltch_school_years`, năm học hiện tại và năm thi THPTQG vẫn giữ nguyên cho đến khi thực sự chạy chuyển niên khóa (`advance_school_year`).
  * **2. Định nghĩa duy nhất về "Học sinh Đã tốt nghiệp" (`isGraduated`):**
    * Khi tạo/chuyển sang năm học mới (`advance_school_year`), **lớp 12 cũ tự động chuyển vào Kho lưu trữ (`archived = true, grade = 12`)**.
    * Một học sinh được xác định là **Đã tốt nghiệp** khi và chỉ khi thỏa mãn đồng thời 2 điều kiện:
      1. Không còn theo học bất kỳ lớp nào đang hoạt động (`archived = false`) với tư cách học sinh (`activeGrades = []`).
      2. Có lịch sử là học sinh của ít nhất một **lớp Khối 12 nằm trong Kho lưu trữ** (`archived = true` và `grade = 12`).
    * *Phân biệt với học sinh mới / chờ xếp lớp:* Học sinh mới tạo tài khoản hoặc đang nghỉ hè chờ xếp vào lớp mới (`activeGrades = []` nhưng **chưa từng thuộc lớp 12 đã lưu trữ**) chỉ ở trạng thái *"Chưa được xếp lớp"*, không bị coi là đã tốt nghiệp.
* **Xử lý trường hợp một học sinh học ở 2 lớp khác khối:**
  * Nếu một học sinh đồng thời theo học ở hai lớp thuộc hai khối khác nhau trong năm học hiện tại (ví dụ: vừa học lớp 10 vừa học vượt lớp 11, hoặc vừa học lớp 11 vừa học lớp 12), danh sách khối của học sinh là tập hợp `activeGrades` (ví dụ `[10, 11]`).
  * Quyền truy cập phòng luyện được tính theo **phép hợp (Union)** của các khối đang học: học sinh được vào tất cả các phòng luyện tương ứng với các khối mà mình đang theo học.

### 1.2. Bảng Ma trận Phân quyền Truy cập

> [!NOTE]
> **Phân định rõ khái niệm "Theo form THPTQG" vs. "THPTQG Thực chiến lớp 12":**
> * **"Theo form THPTQG" (áp dụng cho Khối 10 và Khối 11):** Là luyện tập theo **cấu trúc đề chuẩn của Bộ GD&ĐT** (22 câu, 90 phút: 12 trắc nghiệm 4 lựa chọn, 4 câu Đúng/Sai 4 ý, 6 câu điền số), nhưng nội dung câu hỏi bám sát chương trình kiến thức của khối đó (Toán 10 cho lớp 10, Toán 11 cho lớp 11). Hoàn toàn khác với việc bắt học sinh lớp 10, 11 làm đề tốt nghiệp của lớp 12.
> * **"THPTQG Thực chiến" (chỉ dành cho Khối 12):** Đề thi tốt nghiệp THPT Quốc gia tổng hợp toàn diện kiến thức thi đại học.

| Khối lớp | Quyền truy cập Phòng Luyện | Các Phòng Luyện được phép hiển thị & mở | Bản chất nội dung & Mục tiêu đào tạo |
| :--- | :---: | :--- | :--- |
| **Lớp 6, 7, 8, 9** (hoặc khối khác) | ❌ Không | Không hiển thị module (hoặc thông báo giới hạn) | Không áp dụng cho THCS. |
| **Khối Lớp 10** | ✅ Có | **1 Phòng duy nhất: Luyện Toán 10 – Theo Form THPTQG** | Rèn luyện sớm cấu trúc đề mới của Bộ theo kiến thức Toán 10. **Cấu trúc: 22 câu, 90 phút** (12 câu TN 4 lựa chọn, 4 câu Đúng/Sai 4 ý, 6 câu điền số ngắn). |
| **Khối Lớp 11** | ✅ Có | **2 Phòng chuyên biệt:**<br>1. **Luyện Toán 11 – Theo Form THPTQG** (22 câu · 90 phút)<br>2. **TSA (Bách Khoa)** (Đủ 3 phần: 100 câu · 150 phút; dùng chung kho với lớp 12) | 1. **Toán 11 theo form THPTQG:** Rèn luyện cấu trúc đề mới của Bộ theo kiến thức Toán 11 (**22 câu, 90 phút**).<br>2. **TSA Bách Khoa:** Có đủ đề cho cả 3 phần (Toán 40c/60p, Đọc hiểu 20c/30p, Khoa học 40c/60p). Học sinh tự chọn **làm cả đề (100 câu · 150p)** hoặc **luyện từng phần**. |
| **Khối Lớp 12** | ✅ Có | **Đủ cả 3 Phòng Luyện chuyên sâu:**<br>1. **THPTQG Thực chiến** (22 câu · 90 phút)<br>2. **HSA (ĐHQGHN)** (Đủ 3 phần: 150 câu · 195 phút)<br>3. **TSA (Bách Khoa)** (Đủ 3 phần: 100 câu · 150 phút) | Luyện thi tốt nghiệp và đại học thực chiến 100%. Với **HSA** và **TSA**, đội ngũ biên soạn up đủ cả 3 phần thi; học sinh tự do chọn **làm cả đề** hoặc **làm từng phần**. |
| **Đã tốt nghiệp** (lớp 12 khóa trước) | ❌ Không | Không hiển thị phòng luyện, không vào được phòng thi | Vẫn đăng nhập được để xem **tài liệu** và **các thông tin trước đó** của mình. Phòng luyện (cả làm đề mới và "Kho đã học") bị đóng. |

> [!NOTE]
> **Quy tắc tự động công nhận tốt nghiệp:** Khi ban quản trị tạo/chuyển sang năm học mới (`advance_school_year`), các lớp 12 cũ tự động được đưa vào **Kho lưu trữ (`archived = true, grade = 12`)**. Học sinh thuộc lớp 12 đã vào kho lưu trữ (và không còn học lớp `archived = false` nào khác) tự động được hệ thống xác định là **Đã tốt nghiệp** — không cần đánh dấu thủ công từng tài khoản và không bị nhầm với học sinh mới chờ xếp lớp. Backend chặn mọi API phòng luyện với tài khoản đã tốt nghiệp.

### 1.3. Logic Điều hướng tại Sảnh Ngoài (Portal / Dashboard)
* Khi học sinh đăng nhập vào hệ thống:
  * **Học sinh Lớp 10:** Dashboard hiển thị 1 thẻ duy nhất: **"Phòng Luyện Toán 10 – Theo Form THPTQG"** (22 câu · 90 phút).
  * **Học sinh Lớp 11:** Dashboard hiển thị 2 thẻ lựa chọn:
    1. **"Phòng Luyện Toán 11 – Theo Form THPTQG"** (22 câu · 90 phút).
    2. **"Luyện thi Đánh giá tư duy ĐH Bách Khoa (TSA)"** (Đủ 3 phần: Tư duy Toán học 40c · 60p, Đọc hiểu 20c · 30p, Khoa học 40c · 60p — Hỗ trợ chọn **Làm cả đề 100 câu · 150 phút** hoặc **Luyện từng phần**, cùng kho đề với lớp 12).
  * **Học sinh Lớp 12:** Dashboard hiển thị cả 3 thẻ lựa chọn:
    1. **"Luyện thi Tốt nghiệp THPTQG [Năm thi] – Thực chiến"** (22 câu · 90 phút; Năm thi tự động lấy theo năm kết thúc của niên khóa, ví dụ năm học 2026-2027 thì năm thi là 2027; không ghi cứng).
    2. **"Luyện thi Đánh giá năng lực ĐHQGHN (HSA)"** (Đủ 3 phần: Định lượng 50c · 75p, Định tính 50c · 60p, Khoa học/Tiếng Anh 50c · 60p — Hỗ trợ chọn **Làm cả đề 150 câu · 195 phút** hoặc **Luyện từng phần**).
    3. **"Luyện thi Đánh giá tư duy ĐH Bách Khoa (TSA)"** (Đủ 3 phần: Tư duy Toán học 40c · 60p, Đọc hiểu 20c · 30p, Khoa học 40c · 60p — Hỗ trợ chọn **Làm cả đề 100 câu · 150 phút** hoặc **Luyện từng phần**).
  * **Kho cũ sau khi lên lớp:** Học sinh lớp 11, 12 có thêm mục **"Kho đã học"** để xem lại kho THPTQG của khối/năm học trước (xem mục 2.4). Mục này không tính là phòng luyện mới của khối hiện tại.
* Cơ chế bảo vệ Backend: API `/api/practice/rooms` và bộ kiểm tra quyền đọc/nộp đề đối chiếu `activeGrades` của học sinh. Nếu học sinh cố tình truy cập URL của phòng thi hoặc mã đề không được phép, hệ thống sẽ từ chối truy cập.

---

## 2. Quy tắc Quản lý Ngân hàng Câu hỏi & Vòng đời Dữ liệu

Quy định chuẩn hóa về phân quyền quản trị kho đề chung, cơ chế thêm/sửa câu hỏi và vòng đời dữ liệu:

### 2.1. Phân quyền Quản lý Kho đề cho Admin, Giáo viên & Trợ giảng (Đồng bộ Cơ chế Gắn Lớp Mặc định)
Hệ thống tận dụng trực tiếp cơ chế phân công nhân sự hiện có (`assignActiveStaffToClass` và bảng `ltch_class_memberships`):
* **Mặc định Giáo viên và Trợ giảng được gắn vào tất cả các lớp:**
  * Khi tạo lớp học mới hoặc chuyển niên khóa, hệ thống tự động gán toàn bộ Giáo viên (`teacher`) và Trợ giảng (`assistant`) đang hoạt động (`status = 'active'`) vào các lớp học, trong đó Trợ giảng mặc định có bộ quyền `assistantDefaultPermissions` (bao gồm `practice.manage`).
* **Quyền quản lý Đề riêng trong Lớp (`practice.manage` - class-scoped) & Kho đề Phòng Luyện:**
  * **Admin (Quản trị viên / Cô Hạnh):** Toàn quyền trên mọi lớp, mọi khối (10, 11, 12) và mọi kỳ thi (`THPTQG`, `HSA`, `TSA`).
  * **Giáo viên (`teacher`):** Mặc định được gắn vào tất cả các lớp và có toàn quyền chuyên môn quản lý đề thi, ngân hàng câu hỏi trên tất cả các khối và kỳ thi (gần tương đương Admin).
  * **Trợ giảng (`assistant`):** Mặc định được gắn vào tất cả các lớp kèm quyền `practice.manage`, do đó mặc định có quyền quản lý kho đề (thêm câu, sửa câu, ẩn câu, bật/tắt đề cũ, xử lý báo lỗi). Khi Admin giới hạn quyền `practice.manage` của một trợ giảng ở một số lớp, quyền quản trị từng kho chung (`class_id IS NULL`) được xác định tường minh theo hàm `canManagePracticePool(actor, examType, targetGrade)`:
    * **Kho `thptqg` khối $G \in \{10, 11, 12\}$:** Có quyền `practice.manage` ở ít nhất 1 lớp đang hoạt động (`archived = false`) thuộc khối $G$.
    * **Kho `hsa`:** Có quyền `practice.manage` ở ít nhất 1 lớp đang hoạt động thuộc **Khối 12**.
    * **Kho `tsa`:** Có quyền `practice.manage` ở ít nhất 1 lớp đang hoạt động thuộc **Khối 11 hoặc Khối 12**.
* **Chế độ "Làm thử / Xem trước đề" (`is_preview = true`) dành cho Admin, Giáo viên & Trợ giảng:**
  * Admin, Giáo viên và Trợ giảng có quyền quản lý kho đó được phép bấm **`Làm thử / Xem trước giao diện học sinh`** trên cả đề đang ở trạng thái Nháp (`draft`) lẫn đề đã phát hành (`published`) để kiểm tra công thức LaTeX, hình vẽ, bảng Đúng/Sai và đáp án chấm thử trước khi mở cho học sinh.
  * Các lượt làm thử của nhân sự được gắn cờ `is_preview = true` trong `ltch_practice_attempts` để tách biệt hoàn toàn, không trộn vào danh sách điểm hay thống kê của học sinh.

> [!IMPORTANT]
> **QUY CHUẨN HIỂN THỊ VĂN BẢN, CÔNG THỨC TOÁN HỌC & CHỮ MỜ CHỐNG CHÉP ĐỀ (WATERMARK):**
> * Toàn bộ câu hỏi, phương án trả lời, mệnh đề Đúng/Sai và lời giải chi tiết trong cả 3 phòng luyện (`THPTQG`, `HSA`, `TSA`) **bắt buộc lưu trữ và hiển thị dưới dạng văn bản chuẩn kết hợp bộ dựng công thức Toán học LaTeX (KaTeX / MathJax)** sắc nét tuyệt đối.
> * **Tuyệt đối không dùng ảnh chụp cắt từ file đề** để làm nội dung câu hỏi, đảm bảo học sinh nhìn rõ nhất trên mọi màn hình và khi bấm thu/phóng cỡ chữ (`A-` / `A+`) công thức toán học tự động co giãn mượt mà không bị vỡ nét. (Hình ảnh chỉ dùng cho hình vẽ hình học, bảng biến thiên hoặc đồ thị hàm số minh họa đi kèm văn bản).
> * **Chữ mờ định danh chống chép đề (Watermark chuẩn 9Study):** Trên nền vùng hiển thị câu hỏi của cả 3 phòng thi, chèn lớp phủ chữ mờ xoay nghiêng (`pointer-events: none; user-select: none; opacity: 0.05`) mang nội dung **`LTCH - [student_code] / [Họ tên]`** lặp đều trên mặt trang (nếu tài khoản chưa có `student_code` — ví dụ Giáo viên/Trợ giảng đang ở chế độ Xem trước — tự động fallback sang **`LTCH - GV/TG / [Họ tên]`**, tuyệt đối không hiển thị `null`/`undefined`).

### 2.2. Quy định: Ai được THÊM hoặc SỬA câu trong Kho chung & Cơ chế Phiên bản Câu hỏi
Để đảm bảo Admin, Giáo viên và Trợ giảng phối hợp linh hoạt nhưng tuyệt đối bảo toàn dữ liệu và vết kiểm toán:

| Thao tác | Ai được phép thực hiện? | Quy tắc & Cơ chế thực hiện |
| :--- | :--- | :--- |
| **Thêm câu hỏi / đề mới (Upload)** | Admin, Giáo viên, Trợ giảng (theo quyền `canManagePracticePool`) | Đăng tải bằng **file Word `.docx` theo mẫu lệnh LTCH → nhận diện tự động → rà soát & sửa** (chi tiết tại [THIET_KE_DANG_TAI_CAU_HOI_WORD.md](./THIET_KE_DANG_TAI_CAU_HOI_WORD.md)). Hệ thống tự động cấp Mã định danh `#LTCH-xxxx` bằng Sequence PostgreSQL (`ltch_question_code_seq` — chống trùng tuyệt đối khi nhiều người tải đề cùng lúc), gán `version: 1`, `status: 'active'`, lưu trọn vẹn cấu trúc `question jsonb` (văn bản + công thức LaTeX), ngữ liệu dùng chung `ltch_passages` (nếu là câu hỏi chùm), `created_by: uid` và `created_at`. |
| **Sửa câu hỏi trong kho (Edit)** | Admin, Giáo viên, Trợ giảng (theo quyền `canManagePracticePool`) | **Tuyệt đối không ghi đè mất lịch sử:**<br>1. Lưu nguyên bản snapshot `question jsonb` (kèm phiên bản đoạn văn ngữ liệu `passage_version` nếu là câu chùm) của phiên bản cũ vào bảng lịch sử `ltch_question_versions`.<br>2. Nâng câu hỏi trong kho lên phiên bản mới (`version = version + 1`), cập nhật tự động vào các đề đang phát hành có chứa mã câu `#LTCH-xxxx` để **mọi lượt làm bài mới đều nhận ngay nội dung đã sửa (`v2`)**.<br>3. Các **lượt làm bài cũ** đã bắt đầu/đã nộp trước đó lưu mảng thứ tự & phiên bản của từng câu (`attempt_questions` ghi `version = 1`) để giữ nguyên kết quả và nội dung lúc học sinh đó làm bài.<br>4. **Tùy chọn chấm lại công bằng khi sửa lỗi "Đáp án sai":** Riêng khi sửa lỗi thuộc danh mục *Đáp án sai (`wrong_answer`)*, người sửa có thêm ô tích chọn **`Chấm lại điểm các bài đã nộp có chứa phiên bản lỗi này`** (`regrade_affected_attempts = true`) — khi bật, hệ thống giữ nguyên đề bài và lựa chọn học sinh đã làm nhưng tính lại điểm câu đó theo đáp án đúng mới và ghi nhật ký kiểm toán.<br>5. **Sửa lỗi chỉ sửa trên chính câu đó, giữ nguyên dạng câu:** được sửa nội dung đề bài, đoạn văn ngữ liệu (`ltch_passages`), phương án, đáp án đúng, lời giải, hình vẽ, công thức; **khóa không cho đổi** dạng câu (`single` / `true_false` / `short`), điểm câu (`points`) và cách tính điểm Đúng/Sai (`weights`). Nếu cần đổi sang câu khác thì câu thay thế bắt buộc phải **cùng phần, cùng dạng và cùng thang điểm** với câu cũ. |
| **Ẩn câu hỏi (Hide / Soft-delete)** | Admin, Giáo viên, Trợ giảng (theo quyền `canManagePracticePool`) | • **Nếu câu hỏi chưa gắn vào đề đang phát hành** (chỉ nằm trong ngân hàng câu hỏi): chuyển ngay sang `status: 'hidden'` kèm lý do (`hidden_reason`, hoặc mã câu gốc nếu trùng lặp).<br>• **Nếu câu hỏi đang nằm trong một đề đã phát hành (`ltch_exam_questions`):** khi bấm ẩn, hệ thống **bắt buộc yêu cầu chọn một câu hỏi khác cùng phần/cùng dạng để thay thế vào đúng vị trí đó trong đề** (hoặc sửa trực tiếp câu đó lên `v2`). **Với câu con thuộc chùm đọc hiểu (`cluster_id IS NOT NULL`):** chỉ cho phép sửa trực tiếp câu con lên `v2`, thay bằng câu con viết cho đúng ngữ liệu `passage_id` đó, hoặc thay nguyên cả chùm câu cùng số lượng câu (không cho thay lẻ 1 câu đơn khác ngữ liệu vào giữa chùm), đảm bảo mọi đề đang mở luôn giữ đủ 100% số câu, liền mạch ngữ liệu và chuẩn thang điểm. |
| **Bật / tắt đề cũ năm trước (THPTQG)** | Admin, Giáo viên, Trợ giảng (theo quyền `canManagePracticePool`) | Thao tác bật/tắt chia sẻ từng đề hoặc nhiều đề của năm trước sang năm học hiện tại thông qua bảng `ltch_exam_year_shares (exam_id, school_year_id, target_grade)`, độc lập hoàn toàn với việc hiển thị đề đó trong *"Kho đã học"* của khóa cũ. |
| **Xử lý Báo lỗi của học sinh** | Admin, Giáo viên, Trợ giảng (có quyền `practice.manage`) | Tiếp nhận phản hồi từ Modal Báo lỗi (`#LTCH-xxxx`), chuyển trạng thái `Mới` → `Đang xử lý` → `Đã sửa` / `Đã ẩn` / `Không phải lỗi`. |

### 2.3. Phòng Luyện TSA (Bách Khoa)
* **Phạm vi đối tượng:** **DÙNG CHUNG cho cả học sinh Khối 11 và Khối 12**.
* **Nội dung kiến thức:** TSA là kỳ thi chung, đề theo **kiến thức lớp 12**. Học sinh lớp 11 thấy và làm **toàn bộ kho** giống lớp 12; **không** gắn nhãn hay lọc câu theo mức kiến thức Toán 11/Toán 12.
* **Cơ chế lưu trữ:** **Up xuyên suốt, tích lũy liên tục (Cumulative Pool)**.
* **Quy tắc vòng đời:**
  * Cứ up thêm câu hỏi/đề thi mới vào ngân hàng, **tuyệt đối không xóa bớt**.
  * Học sinh các khóa sau khi được lên lớp (Lớp 10 lên 11, Lớp 11 lên 12) sẽ tự động được cấp quyền truy cập toàn bộ kho câu hỏi TSA đã tích lũy từ các năm trước đó.

### 2.4. Phòng Luyện THPTQG (Bộ GD&ĐT)
* **Phạm vi đối tượng:** **TÁCH BIỆT RIÊNG CHO 3 KHỐI LỚP (Lớp 10, Lớp 11, Lớp 12)**.
* **Thống nhất cấu trúc đề & thời gian làm bài cho cả 3 khối (10, 11, 12):**
  * Đề theo form THPTQG của **Lớp 10 và Lớp 11 có cấu trúc tương tự Lớp 12**: **22 câu hỏi, thời gian 90 phút** (gồm Phần I: 12 câu trắc nghiệm 4 lựa chọn; Phần II: 4 câu trắc nghiệm Đúng/Sai 4 ý; Phần III: 6 câu điền đáp án số ngắn 1 giá trị).
* **Cơ chế lưu trữ:** **Up và quản lý theo từng năm học (Niên khóa riêng biệt)**:
  * *Kho Lớp 10:* Chuyên đề Toán 10 theo form THPTQG mới (22 câu, 90 phút).
  * *Kho Lớp 11:* Chuyên đề Toán 11 theo form THPTQG mới (22 câu, 90 phút).
  * *Kho Lớp 12:* Đề thi tốt nghiệp THPTQG thực chiến 100% (22 câu, 90 phút, cập nhật theo từng năm thi).
* **Quy tắc phân định:** Mỗi đề/câu THPTQG bắt buộc gắn với `grade` (10, 11 hoặc 12) và `school_year` (ví dụ: `2026-2027`).
* **Mỗi năm học bắt đầu từ đầu:** Mặc định, học sinh của một khối chỉ thấy đề được up cho khối đó **trong năm học hiện tại**. Đề của các năm trước **không tự hiện** cho khóa mới.
* **Bật hiện đề cũ theo từng khóa (`ltch_exam_year_shares`):** Admin / Giáo viên / Trợ giảng (có quyền quản lý khối đó) có thể chọn **từng đề hoặc chọn nhiều đề** của năm trước để bật chia sẻ cho khối tương ứng của một năm học mới thông qua bảng `ltch_exam_year_shares (exam_id, school_year_id, target_grade)` (ví dụ: bật đề lớp 10 năm `year-2025-2026` cho lớp 10 năm `year-2026-2027`). Có thể bật/tắt lại cho khóa mới bất cứ lúc nào mà **không làm mất đề trong *"Kho đã học"* của học sinh khóa cũ**.
* **Lên lớp vẫn xem và làm lại được đề trong kho cũ ("Kho đã học"):** Dựa trên bảng lịch sử khối học `ltch_student_grade_history`, khi học sinh lên lớp (10 → 11, 11 → 12), các em **vẫn truy cập được** đúng kho THPTQG của khối và năm học mình thực sự đã theo học trước đó tại trung tâm trong mục **"Kho đã học"**: vừa xem lại được các bài đã nộp trước đây, vừa **được phép làm lại các đề cũ đó** (không giới hạn số lần) để ôn tập kiến thức nền tảng. Phòng luyện của khối mới được mở thêm, không thay thế kho cũ.

### 2.5. Phòng Luyện HSA (ĐHQGHN)
* **Phạm vi đối tượng:** **CHỈ DÀNH RIÊNG CHO HỌC SINH KHỐI LỚP 12** (Lớp 10 và 11 tuyệt đối không được truy cập).
* **Cơ chế lưu trữ:** **Tương tự phòng TSA - Up xuyên suốt, tích lũy liên tục (Cumulative Pool)**:
  * Kho câu hỏi HSA được bồi đắp liên tục qua các năm, không xóa bớt đề cũ.
  * Mỗi khóa học sinh lớp 12 mới sẽ được tiếp cận toàn bộ ngân hàng câu hỏi đồ sộ đã tích lũy của các khóa trước cộng với các câu mới được ban quản trị up thêm.

### 2.6. Xử lý câu hỏi bị báo lỗi (áp dụng cho cả 3 kho)
"Không xóa bớt" được hiểu là **không xóa vĩnh viễn**. Khi xử lý báo lỗi, người quản lý kho được:
* **Sửa câu:** sửa đề, đáp án, lời giải. Mỗi lần sửa tạo **phiên bản mới**, lưu lịch sử (ai sửa, lúc nào, nội dung trước/sau, lý do, báo lỗi liên quan). Mã câu hỏi (`#LTCH-xxxx`) giữ nguyên qua các phiên bản. **Chỉ sửa trên chính câu đó và giữ nguyên dạng câu, `points`, `weights`**; nếu đổi sang câu khác thì câu thay thế phải cùng phần, cùng dạng và cùng thang điểm, để đề đang phát hành luôn đúng cấu trúc và thang điểm.
* **Ẩn câu:** với câu lỗi không sửa được hoặc câu trùng lặp. Câu bị ẩn không còn xuất hiện trong đề mới, nhưng vẫn nằm trong kho và có thể khôi phục. Câu trùng ghi lại mã câu gốc mà nó trùng. **Đặc biệt, nếu câu hỏi cần ẩn đang nằm trong một đề đã phát hành (`ltch_exam_questions`), hệ thống bắt buộc yêu cầu người quản lý chọn một câu hỏi khác cùng phần/cùng dạng để thay thế vào đúng vị trí đó trong đề (hoặc sửa câu đó lên `v2`) trước khi ẩn**, tuyệt đối không để đề đang phát hành bị hụt số câu hay hụt thang điểm tối đa.
* **Lượt làm mới dùng phiên bản mới nhất – Bài làm cũ giữ nguyên phiên bản lúc làm (kèm tùy chọn chấm lại khi sửa đáp án sai):**
  * Khi một câu hỏi được sửa lên phiên bản mới (ví dụ từ `v1` lên `v2`), đề thi đang mở tự động tham chiếu đến phiên bản mới nhất (`v2`) để học sinh vào làm sau đó không còn gặp câu lỗi.
  * Mỗi lượt làm bài (`ltch_practice_attempts`) ghi nhận mảng thứ tự & phiên bản của từng câu tại thời điểm làm bài (`attempt_questions`), nên mặc định việc sửa hay ẩn câu hỏi về sau **không** làm thay đổi đề, đáp án đã chọn hay điểm số của những bài làm cũ.
  * **Tùy chọn chấm lại công bằng khi sửa lỗi "Đáp án sai":** Khi xử lý báo lỗi thuộc nhóm `wrong_answer`, người sửa được tích chọn **`Chấm lại điểm các bài đã nộp có chứa phiên bản lỗi này`** (`regrade_affected_attempts = true`). Hệ thống chỉ tính lại điểm của câu đó trên các bài đã nộp bị ảnh hưởng dựa trên đáp án đúng mới (giữ nguyên đề bài và lựa chọn gốc của học sinh, đồng thời lưu vết kiểm toán vào lịch sử chấm lại) để học sinh làm đúng không bị thiệt điểm oan.
* **Trạng thái báo lỗi:** `Mới` → `Đang xử lý` → `Đã sửa` / `Đã ẩn` / `Không phải lỗi`. Mỗi báo lỗi gắn với mã câu hỏi và phiên bản câu tại thời điểm báo.

---

## 3. Luồng Truy cập & Thiết kế 3 Giai đoạn Làm bài Chuẩn 9Study (Truy cập $\rightarrow$ Làm bài $\rightarrow$ Điểm số & Đáp án)

Toàn bộ trải nghiệm của học sinh trong mỗi kỳ thi (`THPTQG`, `HSA`, `TSA`) được thiết kế thống nhất theo **3 giai đoạn chuẩn 9Study** (100% nền sáng, thương hiệu `[LTCH]`):
1. **Giai đoạn 1: Sảnh Chọn Đề, Chọn Chế độ (Cả đề / Từng phần) & Màn hình Chờ Vào Thi.**
2. **Giai đoạn 2: Màn hình Làm bài Độc lập theo Đặc thù Từng Kỳ thi & Từng Phần.**
3. **Giai đoạn 3: Màn hình Kết quả Điểm số, Bảng Đối chiếu Đáp án & Lời giải Chi tiết.**

---

### 3.1. Giai đoạn 1: Thiết kế Truy cập vào Làm bài, Chọn Đề & Màn hình Chờ / Chọn Phần Thi (Pre-Exam Flow)

#### A. Giao diện Danh sách Bộ đề tại Sảnh Từng Phòng Luyện (Card Grid 4 Thẻ/Hàng – Chuẩn 9Study)
Khi học sinh bấm vào một Phòng Luyện từ Dashboard (`Toán 10/11 Form THPTQG`, `THPTQG Lớp 12`, `HSA`, hoặc `TSA`):
* **Không dùng thanh bộ lọc kỳ thi chung của 9Study:**
  * Vì mỗi phòng thi (`THPTQG`, `HSA`, `TSA`) có lối vào trang riêng biệt theo phân quyền khối lớp, giao diện **bỏ hoàn toàn** các hàng lọc `KỲ THI`, `HẠNG ĐỀ (VIP/PRO/FREE)`, `LOẠI ĐỀ`, `NGUỒN ĐỀ`.
  * Chỉ giữ thanh **Tìm kiếm tên đề** ở trên cùng, bộ lọc nhanh **`Trạng thái (Tất cả / Chưa làm / Đã làm)`** và menu **`Sắp xếp`**.
* **Thiết kế Lưới Thẻ Đề Thi (4 Thẻ / Hàng trên Desktop) riêng biệt cho 3 Phòng:**
  1. **Thẻ Đề Phòng THPTQG (Chỉ có môn Toán $\rightarrow$ Hiển thị thẳng theo từng đề, không qua bước chọn môn):**
     * **Banner trên của thẻ:** Nền **Xanh dương (`#1d4ed8` $\rightarrow$ `#2563eb`)** kèm họa tiết chìm công thức Toán học ($\sum_{i=1}^{n} a_i, \pi, \int$), chính giữa là khung trắng chữ xanh đậm **`TOÁN HỌC`** và dòng chữ **`Kỳ thi THPTQG`** (góc trái trên gắn nhãn `[LTCH]`).
     * **Thân thẻ bên dưới:** Nhãn `THPTQG`, tên đề in đậm 2 dòng (`[LTCH] Đề thi thử THPTQG năm [Năm thi] - Mã đề ... - Toán`), dòng thông số `X lượt làm bài · 📄 22 câu`, dòng tên giáo viên (`Cô Hạnh & Đội ngũ GV LTCH`), dưới cùng là nút `⋮` (xem lịch sử các lần làm) và nút xanh dương full-width **`Làm bài ngay`**.
  2. **Thẻ Đề Phòng HSA (ĐHQGHN):**
     * **Banner trên của thẻ:** Nền **Xanh lá đậm (`#047857` $\rightarrow$ `#059669`)** kèm họa tiết thước ê-ke & bóng đèn, góc trên trái là pill năm thi (`2027`) + nhãn `[LTCH]` (bỏ nhãn `VIP` và `Đề hot`), chính giữa là khung bo viền **`ĐỀ THI THỬ — ĐÁNH GIÁ NĂNG LỰC HSA`**.
     * **Thân thẻ bên dưới:** Nhãn `HSA`, tên đề in đậm (`[LTCH] Đề thi thử HSA ...`), thông số `X lượt làm bài · 📄 150 câu (hoặc 50 câu)`, tên giáo viên biên soạn, dưới cùng là nút `⋮` và nút màu tím (`#7e22ce`) **`Làm bài ngay`**.
  3. **Thẻ Đề Phòng TSA (ĐH Bách Khoa Hà Nội):**
     * **Banner trên của thẻ:** Nền **Đỏ đô sẫm (`#7f1d1d` $\rightarrow$ `#991b1b`)** kèm họa tiết $\sqrt{x}, \sum x_i$, góc trên trái là pill năm thi (`2027`) + nhãn `[LTCH]` (bỏ nhãn `FREE`/`VIP`), chính giữa là chữ trắng **`ĐỀ THI THỬ — ĐÁNH GIÁ TƯ DUY (TSA - Đại học Bách Khoa Hà Nội)`**, mép dưới trái có tab trắng **`TSA BÀI THI ĐÁNH GIÁ TƯ DUY`**.
     * **Thân thẻ bên dưới:** Nhãn `ĐỀ CHÍNH THỨC` / `ĐỀ THAM KHẢO`, tên đề (`[LTCH] Đề thi thử TSA năm ... - Mã đề ...`), thông số `X lượt làm bài · 📄 100 câu (hoặc 40 / 20 câu)`, dưới cùng là nút `⋮` và nút xanh dương (`#2563eb`) **`Làm bài ngay`**.
* **Một Bộ Đề HSA / TSA Dùng Chung Cho Cả 2 Chế độ (Thi Cả Đề & Luyện Riêng Từng Phần):**
  * Mỗi bộ đề HSA hoặc TSA khi được biên soạn và tải lên là **một bộ đề hoàn chỉnh dùng chung cho cả hai chế độ**:
    * **Một bộ đề TSA hoàn chỉnh** gồm đủ 3 phần: `Phần 1: Tư duy Toán học (40 câu · 60p)`, `Phần 2: Tư duy Đọc hiểu (20 câu · 30p)`, `Phần 3: Tư duy Khoa học / Giải quyết vấn đề (40 câu · 60p)`.
    * **Một bộ đề HSA hoàn chỉnh** gồm đủ các học phần:
      * `Phần 1: Tư duy Định lượng / Toán học (50 câu · 75p)`
      * `Phần 2: Tư duy Định tính / Ngôn ngữ - Văn học (50 câu · 60p)`
      * `Phần 3: Khoa học / Tiếng Anh (50 câu · 60p)` — trong đó người up đề tải lên đầy đủ **cả 5 môn Khoa học** (`Vật lí`, `Hóa học`, `Sinh học`, `Lịch sử`, `Địa lí` — **mỗi môn 17 câu**, tổng $5 \times 17 = 85$ câu Khoa học) cùng với **đề Tiếng Anh (50 câu)**.
  * Trên từng đề HSA hoặc TSA, học sinh được chọn linh hoạt:
    * **Chế độ 1 – Thi thử cả đề (`Full Mock Exam`):** Làm tuần tự cả 3 phần của bộ đề đó (`HSA: 150 câu · 195 phút` | `TSA: 100 câu · 150 phút`).
    * **Chế độ 2 – Luyện riêng từng phần (`Section Practice` ngay trên từng đề):**
      * **Với từng đề HSA:** Học sinh bấm chọn luyện riêng **`Phần 1: Định lượng / Toán (50c · 75p)`**, **`Phần 2: Định tính / Ngôn ngữ (50c · 60p)`**, hoặc **`Phần 3: Khoa học / Tiếng Anh (50c · 60p)`**.
      * **Với từng đề TSA:** Học sinh bấm chọn luyện riêng **`Phần 1: Tư duy Toán học (40c · 60p)`**, **`Phần 2: Tư duy Đọc hiểu (20c · 30p)`**, hoặc **`Phần 3: Tư duy Khoa học (40c · 60p)`**.
* **Chặn lách luật mở song song 2 chế độ trên cùng 1 đề & Hiển thị Lịch sử Điểm từng lần làm:**
  * Trên cùng một bộ đề (`examId`), mỗi học sinh **chỉ được có tối đa 1 lượt làm đang diễn ra (`status = 'in_progress'`) tại một thời điểm** (ràng buộc partial unique index `UNIQUE (exam_id, uid) WHERE status = 'in_progress' AND is_preview = false` trên bảng `ltch_practice_attempts`).
  * Dưới mỗi đề đã làm (hoặc khi bấm nút `⋮`), hiển thị danh sách toàn bộ các lượt đã nộp theo thứ tự (`Lần 1`, `Lần 2`, `Lần 3`... ghi rõ chế độ làm là *Cả đề* hay *Phần 1 / Phần 2 / Phần 3 - Tổ hợp ...*, kèm điểm số của từng lần, số câu đúng, thời gian hoàn thành, ngày giờ nộp và nút **`Xem chi tiết & Lời giải`** cho từng lần).

---

#### B. Luồng Màn hình Chờ 120s & Màn hình Chọn Tổ hợp Phần 3 của Kỳ thi HSA (Chuẩn 9Study)
Khi học sinh vào làm bài HSA, hệ thống hiển thị chuỗi màn hình chờ và chọn tổ hợp chuẩn xác theo bộ ảnh thực tế:
1. **Màn hình Chờ Vào Phần 1 (`Phần 1/3`), Phần 2 (`Phần 2/3`) và Phần 3 (`Phần 3/3`):**
   * **Thanh Header trên cùng (nền xám nhạt `#eef2f5`):**
     * Bên trái: Icon dấu tích xanh lá trong vòng tròn `✓`.
     * Chính giữa: Tên đề thi in hoa (`[LTCH] ĐỀ ÔN TẬP ĐGNL ĐHQG HN NĂM ... - MÃ ĐỀ ...`).
     * Bên phải: Ảnh đại diện (Avatar) của thí sinh.
   * **Khung Nội dung Chờ Chính giữa (trên nền trắng 100%):**
     * Dòng giới thiệu: `Bài thi bao gồm các phần:` kèm 3 dòng in hoa màu xanh dương đậm (`#1e40af`):
       * **`TOÁN HỌC VÀ XỬ LÝ SỐ LIỆU (TƯ DUY ĐỊNH LƯỢNG)`**
       * **`NGÔN NGỮ - VĂN HỌC (TƯ DUY ĐỊNH TÍNH)`**
       * **`KHOA HỌC hoặc TIẾNG ANH`**
     * Dòng lưu ý: *"Bạn phải làm tuần tự các phần thi ở trên và không thể quay lại phần thi đã làm trước đó."*
     * **Dải 9 biểu tượng mũi tên kép `>>` chỉ báo tiến độ chặng thi:**
       * Ở **Phần 1 (`Phần 1/3`)**: **3 mũi tên đầu** sáng màu xanh lá đậm (`#388e3c`), 6 mũi tên sau màu xám nhạt.
       * Ở **Phần 2 (`Phần 2/3`)**: **6 mũi tên đầu** sáng màu xanh lá đậm, 3 mũi tên sau màu xám nhạt.
       * Ở **Phần 3 (`Phần 3/3`)**: **Cả 9 mũi tên** đều sáng màu xanh lá đậm.
     * **Thông tin phần thi sắp mở:**
       * Tiêu đề phần chữ in hoa màu xanh lá đậm (`22px`):
         * Phần 1: **`TOÁN HỌC VÀ XỬ LÍ SỐ LIỆU`** (`Thời gian hoàn thành phần thi thứ 1: 75 phút` | `Tổng điểm phần thi này: 50 điểm`).
         * Phần 2: **`NGÔN NGỮ - VĂN HỌC`** (`Thời gian hoàn thành phần thi thứ 2: 60 phút` | `Tổng điểm phần thi này: 50 điểm`).
         * Phần 3: **`KHOA HỌC: [TÊN 3 MÔN ĐÃ CHỌN]`** hoặc **`TIẾNG ANH`** (`Thời gian hoàn thành phần thi thứ 3: 60 phút` | `Tổng điểm phần thi này: 50 điểm`).
       * Cụm logo 3 ô vuông màu đặc trưng: **`[ H ]`** (xám `#757575`) — **`[ S ]`** (xanh lá `#388e3c`) — **`[ A ]`** (đỏ nâu `#b71c1c`).
     * **Bộ đếm ngược Tự động Bắt đầu (120 giây):**
       * Dòng chữ: *"Phần [1/2/3] tự động bắt đầu sau 120 giây. Nếu đã sẵn sàng, bạn có thể bấm nút `<BẮT ĐẦU>` dưới đây để bắt đầu phần thi."*
       * Số giây đếm ngược cỡ lớn màu đỏ (`#d32f2f`, ví dụ: **`114`**).
       * Nút bấm màu xanh lá (`#4caf50`): **`[ BẮT ĐẦU ]`** và dòng chỉ số chặng **`Phần 1/3`** (hoặc `Phần 2/3`, `Phần 3/3`) ở dưới cùng.
2. **Màn hình Chọn Tổ hợp Phần 3 HSA (Xuất hiện ngay sau khi kết thúc Phần 2 hoặc khi vào luyện riêng Phần 3):**
   * **Phía trên cùng:** Hàng **9 hình thoi màu xanh lá** (`◇` tô đặc xanh lá `#68b94c` viền xanh đậm) xếp ngang.
   * **Tiêu đề hướng dẫn:**
     * Dòng đậm: **`Kích chọn một trong các phần thi sau đây`**
     * Dòng nghiêng: *(Phần thi được chọn có nền màu kem, phần thi không được chọn có nền màu xanh)*
   * **Bảng 11 Hàng Lựa chọn Xếp dọc (Chiều rộng `~760px` căn giữa):**
     * Các hàng chưa chọn có nền xanh lam nhạt (`#e8f1fa`), chữ in hoa đậm màu xanh navy (`#1e3a5f`). Khi học sinh bấm chọn 1 hàng, hàng đó chuyển sang **nền màu kem (`#fdf6e2`)**:
       1. **`Q01: LÍ - HÓA - SINH (TỰ CHỌN)`**
       2. **`Q02: LÍ - HÓA - SỬ (TỰ CHỌN)`**
       3. **`Q03: LÍ - HÓA - ĐỊA (TỰ CHỌN)`**
       4. **`Q04: LÍ - SINH - SỬ (TỰ CHỌN)`**
       5. **`Q05: LÍ - SINH - ĐỊA (TỰ CHỌN)`**
       6. **`Q06: LÍ - SỬ - ĐỊA (TỰ CHỌN)`**
       7. **`Q07: HÓA - SINH - SỬ (TỰ CHỌN)`**
       8. **`Q08: HÓA - SINH - ĐỊA (TỰ CHỌN)`**
       9. **`Q09: HÓA - SỬ - ĐỊA (TỰ CHỌN)`**
       10. **`Q10: SINH - SỬ - ĐỊA (TỰ CHỌN)`**
       11. **`TIẾNG ANH`** *(Mã `Q21`)*
   * **Nút bấm dưới cùng:** Nút **`[ XÁC NHẬN ]`** màu xanh lá (chỉ sáng rõ cho bấm sau khi học sinh đã kích chọn 1 trong 11 dòng). Khi bấm `XÁC NHẬN`, hệ thống chuyển sang Màn hình chờ 120 giây của Phần 3 (`Phần 3/3`).
   * **Thuật toán lấy 50 câu từ Tổ hợp 3 môn Khoa học (mỗi môn 17 câu) & Quy tắc tráo trong từng môn:**
     * Trong bộ đề gốc, mỗi môn Khoa học (`Lý`, `Hóa`, `Sinh`, `Sử`, `Địa`) có đầy đủ **17 câu** (và bắt buộc có ít nhất 1 câu đơn `cluster_id IS NULL` khi kiểm tra phát hành đề). Khi học sinh chọn 1 tổ hợp 3 môn ($17 \times 3 = 51$ câu), máy chủ **cắt bỏ ngẫu nhiên 1 câu đơn lẻ** (`cluster_id IS NULL`), tạo thành đúng **50 câu** (2 môn 17 câu + 1 môn 16 câu) và nối cố định vào mảng `attempt_questions`.
     * **Thứ tự môn & tráo câu:** Các câu của cùng một môn luôn nằm liền nhau theo đúng thứ tự môn trong tổ hợp đã chọn; chỉ tráo câu **bên trong từng môn** (câu đơn tráo ngẫu nhiên, chùm câu tráo nguyên cả chùm).
     * **Bảo toàn thang điểm `max_score = 150`:** Ở chế độ *Thi cả đề HSA*, `max_score` luôn cố định bằng **`150 điểm`** (nếu bỏ dở quá 24 giờ hoặc nộp sớm toàn bài trước khi chọn tổ hợp Phần 3, Phần 3 được chốt `0 / 50 điểm`).

---

#### C. Hộp thoại `Thông tin bài thi & Chọn phần thi` của Kỳ thi TSA (Chuẩn 9Study)
Khác với màn hình chờ 120 giây của HSA, kỳ thi **TSA (ĐH Bách Khoa Hà Nội)** sử dụng **Modal `Thông tin bài thi & Chọn phần thi`** hiển thị nổi chính giữa trên nền phòng thi phủ mờ khi bắt đầu bài thi và giữa các phần thi:
* **Tiêu đề Modal:** Logo chữ đỏ **`TSA`** lớn ở trên cùng + dòng chữ in hoa **`KỲ THI ĐÁNH GIÁ TƯ DUY`**.
* **Khối 1 – `Thông tin bài thi` (Bảng 2 cột Trái/Phải):**
  * `Họ tên`: Tên học sinh (ví dụ: `Nguyễn Hiếu`)
  * `Ngày sinh`: `DD/MM/YYYY`
  * `Đề thi`: `[LTCH] Đề ôn tập ĐGTD ĐHBK HN năm ... - Mã đề ...`
  * `Phần thi`: Tên phần sắp thi (ví dụ: `TSA - Phần thi Tư duy Toán học`)
  * `Thời gian`: `60 phút` (hoặc `30 phút`)
  * `Thời gian làm bài thực tế`: `HH:MM:SS` *(hiển thị bổ sung khi học sinh vừa hoàn thành ít nhất 1 phần thi)*.
* **Khối 2 – `Chọn phần thi` (3 Thẻ Phần thi xếp dọc):**
  1. **Thẻ 1: `1. TSA - Phần thi Tư duy Toán học`** (`Thời gian: 60 phút`)
     * Lúc mới vào: Trạng thái `Chưa thi` kèm nút đỏ nổi bật **`[ Làm phần này ]`** (`#dc2626`).
     * Sau khi nộp Phần 1: Đổi sang chữ xanh lá **`Đã làm`** kèm nút xám khóa **`[ Đã nộp ]`**.
  2. **Thẻ 2: `2. TSA - Phần thi Đọc hiểu`** (`Thời gian: 30 phút`)
     * Lúc đang ở Phần 1: Trạng thái `Chưa mở` kèm nút xám khóa **`[ Chưa mở ]`**.
     * Ngay sau khi nộp Phần 1: Tự động mở khóa thành `Chưa thi` kèm nút đỏ **`[ Làm phần này ]`**.
  3. **Thẻ 3: `3. TSA - Phần thi Giải quyết vấn đề`** (`Thời gian: 60 phút`)
     * Tự động mở khóa thành nút đỏ **`[ Làm phần này ]`** ngay sau khi học sinh nộp xong Phần 2.
* **Chân Modal:** Link chữ đỏ căn giữa **`Về trang chủ`** (quay lại Sảnh phòng luyện TSA).

---

### 3.2. Giai đoạn 2: Giao diện Màn hình Làm bài, Các Dạng Câu hỏi & Popup Xác nhận Nộp bài

#### A. Giao diện Phòng thi THPT Quốc Gia (Khối 10, 11 Form THPTQG & Khối 12 Thực chiến – Chuẩn 9Study)
* **Nhận diện Header:**
  * Nền **xanh Navy đậm (`#1a3b7c`)**, chữ trắng.
  * Góc trái: Tên thí sinh in đậm, tiêu đề `[LTCH] Đề thi thử THPTQG năm [Năm thi] - Mã đề ... - Toán`, dòng thông tin phụ `SBD: ...   Môn thi: TOÁN HỌC   Ngày thi: DD/MM/YYYY   Ca thi: ...`.
  * Góc phải: Đồng hồ đếm ngược `🕒 01:29:46`, trạng thái `🟢 Đang kết nối`, nút trắng chữ xanh đậm **`NỘP BÀI`** và nút phóng toàn màn hình `⛶`. **100% nền sáng (loại bỏ hoàn toàn nút mặt trăng chế độ tối).**
* **Thanh Sub-bar Điều khiển & Chuyển đổi Chế độ Hiển thị:**
  * Chính giữa: Cặp nút điều hướng **`[ Quay lại ]`** và **`[ Tiếp theo ]`** (nền xanh dương `#2563eb`).
  * Bên phải: Chỉ số `Số câu đã trả lời: 0 / 22`, cặp nút thu/phóng cỡ chữ `[-]` `[+]`, và nút icon **Chuyển đổi chế độ hiển thị** (Single Question Mode $\leftrightarrow$ Continuous List Mode).
* **Thiết kế 3 Phần Câu hỏi trong Đề 22 câu (Nền phủ Watermark chéo):**
  * **Phần I (Câu 1–12 – Trắc nghiệm 4 lựa chọn):** Hiển thị `Question 1.` (hoặc `Câu 1.`), góc phải có nút cờ `⚑` và `⚠ Báo lỗi`. Bên dưới là 4 lựa chọn radio tròn đơn.
  * **Phần II (Câu 13–16 – Trắc nghiệm Đúng/Sai 4 ý):** Hiển thị bảng 3 cột (`Nội dung mệnh đề a, b, c, d` | `Đúng` | `Sai`).
  * **Phần III (Câu 17–22 – Điền đáp án số ngắn):** Ô input nhập 1 giá trị số duy nhất kèm hướng dẫn gõ phân số/số thập phân.
* **Thanh Palette Đáy (Bottom Sticky Bar):**
  * Ghim cố định ở đáy màn hình, gồm dòng chú thích trạng thái (`🟢 Đã trả lời`, `⚪ Chưa trả lời`, `🟠 Đánh dấu xem lại`) và dải **22 nút tròn (`1` đến `22`)** (câu đang chọn có viền tròn xanh navy bao quanh).
* **Popup Xác nhận Nộp bài THPTQG (`Nộp bài thi`):**
  * Khi bấm nút **`NỘP BÀI`** trên Header, hiển thị hộp thoại trắng bo góc giữa màn hình phủ mờ:
    * Tiêu đề in đậm: **`Nộp bài thi`**
    * Nội dung cảnh báo: *"Em còn X câu chưa trả lời. Nộp bài bây giờ?"* (hoặc *"Em đã hoàn thành 22/22 câu. Nộp bài bây giờ?"*).
    * 2 nút bấm căn phải: **`[ Huỷ ]`** (nền trắng viền xám) và **`[ Nộp bài ]`** (nền xanh navy `#1a3b7c`, chữ trắng).

#### B. Giao diện Phòng Luyện đề HSA (ĐHQGHN – Chuẩn 9Study)
* **Cấu trúc Chuẩn & Số câu Từng phần Kỳ thi HSA:**

| Phần thi | Tên phần & Nội dung | Số lượng câu | Thời gian | Cơ cấu dạng thức câu hỏi & Quy tắc tráo câu |
| :--- | :--- | :---: | :---: | :--- |
| **Phần 1** | **Toán học & Xử lý số liệu** *(Tư duy định lượng)* | **50 câu**<br>*(Câu 1–50)* | **75 phút** | • Chuẩn 35 câu trắc nghiệm 4 lựa chọn đơn + 15 câu điền đáp số ngắn.<br>• Tráo ngẫu nhiên câu đơn và tráo theo khối đối với chùm câu có dữ liệu chung mỗi khi tạo lượt làm mới. |
| **Phần 2** | **Ngôn ngữ – Văn học** *(Tư duy định tính)* | **50 câu**<br>*(Câu 51–100)* | **60 phút** | • Chuẩn 25 câu đơn & chùm 5 câu ngữ âm/từ vựng/tìm lỗi + 25 câu thuộc các chùm đọc hiểu văn bản.<br>• Câu đơn tráo ngẫu nhiên, **chùm câu đọc hiểu tráo nguyên cả chùm**. |
| **Phần 3** | **Khoa học** *(hoặc Tiếng Anh)* | **50 câu**<br>*(Mã theo môn hoặc 101–150)* | **60 phút** | • Bộ đề gốc chứa đủ **5 môn Khoa học (Lý, Hóa, Sinh, Sử, Địa × 17 câu/môn)** và **Tiếng Anh (50 câu)**.<br>• Chọn tổ hợp 3 môn Khoa học ($3 \times 17 = 51$ câu) $\rightarrow$ cắt ngẫu nhiên 1 câu đơn lẻ lấy đúng **50 câu**, **chỉ tráo câu bên trong từng môn**, các câu cùng môn luôn liền nhau. |
| **Toàn bài** | **Cả đề đầy đủ (Full HSA)** | **150 câu** | **195 phút** | **Thang điểm: 150 điểm** (mỗi câu đúng 1 điểm). |

* **Thiết kế Màn hình Làm bài HSA (Chuẩn 9Study):**
  * **Dòng Header 1 (Thông tin & Đồng hồ):**
    * Góc trái: Icon tích xanh tròn `✓` kèm mũi tên và số thứ tự phần đang làm: `✓ >>> 1` (ở Phần 1), `✓ >>> 2` (ở Phần 2), `✓ >>> 3` (ở Phần 3).
    * Chính giữa: Tiêu đề đề thi và khung pill viền xanh dương có gạch chân đỏ nổi bật tên phần đang thi: **`TOÁN HỌC VÀ XỬ LÝ SỐ LIỆU (TƯ DUY ĐỊNH LƯỢNG)`**, **`NGÔN NGỮ - VĂN HỌC (TƯ DUY ĐỊNH TÍNH)`**, hoặc **`KHOA HỌC (TỰ CHỌN)`** / **`TIẾNG ANH`**.
    * Góc phải: Đồng hồ đếm ngược chữ đỏ cỡ lớn (ví dụ: **`01:14:54`** hoặc **`59:50`**) và avatar thí sinh (không có icon mặt trăng).
  * **Dòng Header 2 (Thanh Palette 50 Câu Ghim Đỉnh & Nút Kết thúc phần / Nộp bài):**
    * Hiển thị ngang toàn bộ các nút tròn số câu của phần đang làm:
      * Phần 1 & Phần 2 (hoặc đề Tiếng Anh): đánh số `1`–`50` (hoặc `51`–`100`).
      * Phần 3 Khoa học tự chọn: hỗ trợ hiển thị mã câu theo phân môn chuẩn ĐHQGHN (Vật lí `101–117`, Hóa học `201–217`, Sinh học `301–317`, Lịch sử `401–417`, Địa lí `501–517`) theo đúng thứ tự 3 môn trong tổ hợp đã chọn.
    * Bên phải dưới thanh số câu là nút hành động màu xanh lá đậm (`#386641`):
      * Ở Phần 1 và Phần 2 của chế độ *Thi cả đề*: nút hiển thị chữ **`KẾT THÚC PHẦN`** (kèm tùy chọn phụ nộp sớm toàn bài nếu học sinh muốn dừng hẳn).
      * Ở Phần 3 của *Thi cả đề* (hoặc khi *Luyện riêng 1 phần*): nút hiển thị chữ **`NỘP BÀI`**.
  * **Thân bài Cuộn dọc Liên tục (Continuous Scroll Layout):**
    * **Câu hỏi Chùm / Đọc hiểu:** Chia 2 cột — Cột trái (~45%) là hộp ngữ liệu nền tím nhạt (`#ede7f6`) ghim cố định (`position: sticky`); Cột phải (~55%) xếp dọc các câu hỏi con.
    * **Câu hỏi Đơn lẻ:** Hiển thị rộng rãi kèm nhãn xanh lá đậm **`Câu 1.`**, nút **`Báo lỗi ⚑`** ở góc phải, các phương án `(A)`, `(B)`, `(C)`, `(D)` hoặc ô điền đáp án ngắn (`Nhập đáp án...`).
  * **Popup Xác nhận khi bấm `KẾT THÚC PHẦN` / `NỘP BÀI` trong HSA:**
    * Hộp thoại trắng căn giữa trên nền phủ mờ:
      * Dòng chữ màu đỏ ở trên cùng liệt kê danh sách các câu chưa trả lời: **`Bạn chưa làm câu: 1, 2, 3, ..., 50`** (nếu đã làm hết thì hiện thông báo xanh lá *"Bạn đã trả lời đầy đủ tất cả các câu trong phần thi này"*).
      * Dòng cảnh báo: *"Khi đã kết thúc phần thi, bạn sẽ không quay lại phần thi được nữa."*
      * Câu hỏi in đậm: **`Bạn chắc chắn KẾT THÚC phần thi này?`** (hoặc **`Bạn chắc chắn NỘP BÀI thi này?`**).
      * 2 nút bấm căn giữa: **`[ Có ]`** (xanh dương `#3b5998`) và **`[ Không ]`** (xám `#6c757d`).

#### C. Giao diện Phòng Luyện đề TSA (ĐH Bách Khoa Hà Nội – Đầy đủ 6 Dạng Câu hỏi Chuẩn 9Study)
* **Cấu trúc Chuẩn & Bố cục Màn hình theo Từng phần Kỳ thi TSA:**

| Phần thi | Tên phần & Nội dung | Số lượng câu | Thời gian | Bố cục Màn hình & Cơ cấu dạng thức câu hỏi |
| :--- | :--- | :---: | :---: | :--- |
| **Phần 1** | **Tư duy Toán học** | **40 câu**<br>*(Câu 1–40)* | **60 phút** | • **Bố cục 1 khung câu hỏi lớn (`Single-Question Card`)** bên trái (~72%) + Sidebar bên phải (~28%).<br>• Gồm đủ các dạng: Trắc nghiệm 4 lựa chọn (Lưới 2×2), Đúng/Sai nhiều mệnh đề, Điền đáp án khung lớn, Điền đáp án inline giữa dòng văn bản, và Kéo thả (`Drag & Drop`). |
| **Phần 2** | **Tư duy Đọc hiểu** | **20 câu**<br>*(Câu 1–20)* | **30 phút** | • **Bố cục Chia đôi màn hình (`Split-Pane`)**: Cột trái cố định **`NGỮ LIỆU`** (văn bản dài đánh số đoạn `[1], [2], [3]...` cuộn độc lập) + Cột giữa hiển thị các câu hỏi theo ngữ liệu + Sidebar bên phải.<br>• Gồm: Trắc nghiệm 4 lựa chọn, Kéo thả từ vào chỗ trống, Điền từ không quá $k$ tiếng inline vào nhận định. |
| **Phần 3** | **Tư duy Khoa học / Giải quyết vấn đề** | **40 câu**<br>*(Câu 1–40)* | **60 phút** | • **Bố cục Chia đôi màn hình (`Split-Pane`)**: Cột trái cố định **`NGỮ LIỆU`** (mô tả thí nghiệm, công thức cấu tạo hóa học, bảng số liệu, sơ đồ sinh/lý) + Cột giữa hiển thị câu hỏi hiện tại + Sidebar bên phải.<br>• Gồm đủ cả **6 dạng câu hỏi tương tác** của TSA. |
| **Toàn bài** | **Cả đề đầy đủ (Full TSA)** | **100 câu** | **150 phút** | **Thang điểm: 100 điểm**. |

* **Thiết kế Chi tiết Màn hình Làm bài & 6 Dạng Tương tác Câu hỏi của TSA:**
  * **Thanh Header Trắng Viền Mảnh:**
    * Góc trái: Logo chữ đỏ **`TSA`** | Tên phần (`TSA – Phần 1/3: Tư duy Toán học` / `TSA – Phần 2/3: Đọc hiểu` / `TSA – Phần 3/3: Giải quyết vấn đề`) kèm mã câu màu đỏ (`00001`..`00040`).
    * Góc phải: Tên đề `[LTCH] Đề thi thử TSA năm ... - Mã đề ...`.
  * **Đặc tả 6 Dạng Tương tác Câu hỏi bên trong Card Câu hỏi TSA:**
    1. **Dạng 1 – Trắc nghiệm 1 đáp án (`type: 'single'`):**
       * 4 phương án xếp thành **Lưới 2 cột × 2 hàng (2×2 Grid)** gồm các ô bo góc có nút radio tròn. Khi chọn ô nào, cả ô chuyển viền xanh dương (`#2563eb`).
    2. **Dạng 2 – Trắc nghiệm nhiều đáp án (`type: 'multiple'` – Checkbox):**
       * Phía trên lưới phương án hiển thị dòng nhắc màu xanh dương: **`Chọn k đáp án đúng (đã chọn x/k)`** (ví dụ: *Chọn 2 đáp án đúng (đã chọn 0/2)*).
       * Các phương án xếp lưới 2 cột sử dụng **ô vuông Checkbox** (giới hạn không cho tích vượt quá $k$ đáp án nếu câu hỏi quy định số lượng cố định).
    3. **Dạng 3 – Đúng / Sai nhiều mệnh đề hoặc Đúng / Sai đơn (`type: 'true_false'`):**
       * **Bảng nhiều mệnh đề:** Hỗ trợ linh hoạt **từ 2 đến 5 mệnh đề (`A., B., C.` hoặc `A., B., C., D.` hoặc `A., B., C., D., E.`)**; bên phải có 2 cột radio **`Đúng` (cột trái) | `Sai` (cột phải)**.
       * **Đúng / Sai đơn (1 nhận định):** Hiển thị 2 thẻ lớn nằm ngang `[ ○ Đúng ]` và `[ ○ Sai ]`.
    4. **Dạng 4 – Điền câu trả lời ngắn khung lớn (`type: 'short'`):**
       * Ô input rộng bên dưới câu hỏi (`Nhập câu trả lời...`) kèm dòng hướng dẫn: *Phân số gõ 3/8. Số thập phân dùng 1,5 hoặc 1.5*.
    5. **Dạng 5 – Điền đáp án inline ngay giữa dòng văn bản (`type: 'fill_blank'`):**
       * Ngay tại các vị trí khuyết bên trong câu văn hiển thị **1 hoặc nhiều ô input viền nét đứt (`Nhập đáp án`)** (ví dụ: *"giới hạn $\lim_{x \to 4} \dots$ bằng bao nhiêu `[ Nhập đáp án ]`"* hoặc *"thể hiện lần lượt qua nhóm chức `[ Nhập đáp án ]` và `[ Nhập đáp án ]`"*).
    6. **Dạng 6 – Kéo thả đáp án vào chỗ trống (`type: 'drag_drop'`):**
       * Tại các vị trí khuyết trong văn bản, biểu thức so sánh (`[ Kéo thả ] < [ Kéo thả ] < [ Kéo thả ]`) hoặc danh sách mẫu vật hiển thị các ô nét đứt **`Kéo thả đáp án vào ô này`**.
       * Phía dưới câu hỏi là khu vực **`✋ CÁC ĐÁP ÁN`** chứa các thẻ đáp án bo góc có biểu tượng 6 chấm bi nắm kéo (`::`).
       * **Hỗ trợ kép (Kéo thả & Chạm/Click cho cả máy tính lẫn điện thoại/máy tính bảng):** Học sinh có thể kéo thẻ thả vào ô trống, hoặc bấm chọn thẻ đáp án rồi bấm vào ô trống để điền; bấm lại vào ô đã điền để gỡ thẻ về kho.
  * **Sidebar Phải (~28%) & Thanh Điều hướng Chân trang Trái:**
    * **Card 1 – Thông tin thí sinh & Đồng hồ:** `Họ tên`, `Ngày sinh`, `THỜI GIAN CÒN LẠI` (`59 : 58`), và nút đỏ to bản **`Nộp phần`** (ở Phần 1 & 2) hoặc **`Nộp bài`** (ở Phần 3 / đề lẻ).
    * **Card 2 – Chỉ thị màu sắc:** Tổng câu xám, số câu đã làm tím xanh (`#3b28cc`), câu đang mở xanh đen viền vàng (`#1e1b4b`), câu đánh dấu cam.
    * **Card 3 – Ma trận Bảng số 7 Cột:** Các nút tròn `1`–`40` (hoặc `1`–`20` ở Phần 2) xếp 7 cột/hàng, thanh tiến độ `Bạn đã hoàn thành X/40 câu (Y%)`, trạng thái `🟢 Đã kết nối`.
    * **Thanh Chân trang Trái:** Nút `<`, nút xanh đậm **`[ Câu tiếp > ]`**, và đồng hồ **`Thời gian làm câu hiện tại 0:02`** (hoặc `Thời gian làm bài đọc hiện tại`). **Bỏ hoàn toàn nút mặt trăng Dark Mode ở góc phải dưới.**
  * **Popup Xác nhận khi bấm `Nộp phần` / `Nộp bài` trong TSA:**
    * Hộp thoại trắng bo góc chính giữa màn hình:
      * Phía trên là **hình tròn màu vàng cam (`#f59e0b`)** hiển thị chữ trắng **`X/40 câu`** (hoặc `X/20 câu`).
      * Dòng thông báo căn giữa: *"Bạn vẫn còn thời gian làm phần này, bạn có chắc muốn kết thúc phần thi 1/3?"*
      * 2 nút bấm lớn cân đối: **`[ Làm bài tiếp ]`** (nền xanh tím than `#1e1b4b`, chữ trắng) và **`[ Nộp phần thi ]`** (nền đỏ `#dc2626`, chữ trắng).

---

### 3.3. Giai đoạn 3: Màn hình Điểm số Sau Khi Nộp & Trang Xem Chi tiết Kết quả / Lời giải (Chuẩn 9Study)

> [!IMPORTANT]
> **CÔNG BỐ ĐIỂM & LỜI GIẢI TỨC THÌ KHI NỘP BÀI + MỞ KHÓA 100% LỜI GIẢI (KHÔNG KHÓA VIP, BỎ ELO & LỰC CHIẾN):**
> * Tất cả các đề trong Phòng Luyện (`thptqg`, `hsa`, `tsa`) **mặc định trả điểm số, đáp án đúng và lời giải chi tiết ngay lập tức tại thời điểm học sinh nộp bài** (`status = 'submitted'`).
> * **Mở khóa 100% toàn bộ câu hỏi và lời giải chi tiết** (tuyệt đối không khóa từ câu 10 đòi mua gói VIP như 9Study).
> * **Loại bỏ hoàn toàn** các khối không thuộc hệ thống LTCH: hộp *Thay đổi Elo & Năng lực*, hộp *Lực chiến / Tân binh*, và *trợ lý Nini*.

Giai đoạn 3 gồm **2 bước màn hình nối tiếp nhau** đúng theo luồng thực tế trong bộ ảnh và file HTML bạn cung cấp:

#### A. Màn hình 3A – Màn hình Thông báo Điểm Ngay Khi Vừa Nộp Bài (Immediate Post-Submission Screen)
1. **Đối với Phòng THPTQG (`Kết quả thi`):**
   * Hiển thị khung thẻ trắng viền mảnh màu xanh dương (`border: 1px solid #3b82f6`) căn giữa trên nền xám xanh nhạt (`#eff3f8`):
     * Tiêu đề góc trên trái: **`Kết quả thi`**
     * Dòng thông báo lớn căn giữa: **`Bạn đã nộp bài thi thành công!`**
     * 2 dòng chỉ số:
       * `Số câu đã trả lời:` **`X/22`** (số màu xanh lá `#16a34a` in đậm).
       * `Số điểm đạt được:` **`Y/10`** (số màu xanh lá `#16a34a` in đậm).
     * Nút bấm chính giữa có viền xanh dương: **`[ Xem chi tiết ]`** $\rightarrow$ bấm vào chuyển sang **Màn hình 3B (Trang Kết quả & Lời giải chi tiết)**.
2. **Đối với Phòng HSA (`KẾT QUẢ HOÀN THÀNH BÀI THI` – Chuẩn khảo thí ĐHQGHN):**
   * Thanh Header trên cùng giữ icon tích xanh `✓`, tên đề thi ở giữa và avatar ở góc phải.
   * Chính giữa màn hình trắng là bảng tổng kết:
     * Tiêu đề lớn in hoa: **`KẾT QUẢ HOÀN THÀNH BÀI THI`**
     * Dòng thông tin thí sinh: **`Họ và tên: [Họ tên]`** &nbsp;&nbsp; **`Mã số: [Mã HS / Email]`** &nbsp;&nbsp; **`SBD: [Số]`**
     * Dòng tổng điểm: **`Điểm gốc: X/150`** (hoặc `X/50` nếu luyện 1 phần) và dòng phụ `DIỄN GIẢI CHI TIẾT`.
     * **Bảng kẻ ô chuẩn 4 cột (`Phần thi` | `Số câu` | `Điểm gốc` | `% đạt`):**
       * Hàng 1: `TOÁN HỌC VÀ XỬ LÝ SỐ LIỆU (TƯ DUY ĐỊNH LƯỢNG)` | `50` | `X1/50` | `P1%`
       * Hàng 2: `NGÔN NGỮ - VĂN HỌC (TƯ DUY ĐỊNH TÍNH)` | `50` | `X2/50` | `P2%`
       * Hàng 3: `Q02: LÍ - HÓA - SỬ (TỰ CHỌN)` *(hoặc tổ hợp / Tiếng Anh đã chọn)* | `50` | `X3/50` | `P3%`
       * Hàng Tổng: **`Tổng`** | **`150`** | **`X/150`** | **`P%`**
     * *(Đã loại bỏ hoàn toàn hộp `Thay đổi Elo & Năng lực` bên dưới bảng).*
     * Dòng nhắc hoàn thành: *"Vui lòng giữ nguyên giao diện này và đợi ký nhận nộp bài. Sau ký nhận nộp bài, bạn có thể đóng bài thi bằng việc bấm nút `<Đã ký nhận nộp bài. Đóng bài thi>`. **Bạn chỉ được rời khỏi phòng thi khi cán bộ coi thi cho phép.**"*
     * 2 nút bấm ở dưới cùng:
       * **`[ Xem lại bài thi (ở một tab khác) ]`** (nền xám xanh đậm `#34495e`) $\rightarrow$ mở sang **Màn hình 3B (Trang Kết quả & Lời giải chi tiết)**.
       * **`[ Đã ký nhận nộp bài. Đóng bài thi. ]`** (nền xanh dương `#3b5998`) $\rightarrow$ quay về Sảnh phòng luyện HSA.
3. **Đối với Phòng TSA:**
   * Ngay sau khi nộp phần cuối cùng (hoặc nộp đề lẻ), chuyển thẳng sang **Màn hình 3B (Trang Kết quả & Lời giải chi tiết)**.

---

#### B. Màn hình 3B – Trang Xem Chi tiết Kết quả, Phân tích & Lời giải (`Kết quả bài làm` – Chuẩn HTML 9Study)
Trang xem chi tiết kết quả và lời giải của cả 3 kỳ thi (**THPTQG**, **HSA**, **TSA**) được thiết kế đồng bộ, hiện đại trên nền sáng theo đúng cấu trúc file `Kết quả bài thi - 9Study.html`:

1. **Khối Hero Tổng kết Điểm số (Top Summary Section – 3 Cột ngang):**
   * **Cột Trái:**
     * Pill nhãn xanh tím nhạt: **`Kết quả bài làm`**
     * Tiêu đề lớn (`28px` extrabold): **`Chúc mừng bạn đã hoàn thành!`**
     * Tên đề thi: `[LTCH] Đề thi thử THPTQG / HSA / TSA năm ... - Mã đề ...`
     * Cặp nút hành động (`48px` height, bo góc `14px`):
       * **`[ ↻ Làm lại đề ]`** (nền trắng, viền xanh tím `#4f46e5`, chữ đậm) — khởi tạo lượt làm mới.
       * **`[ 📖 Xem lại bài ]`** (nền gradient xanh tím, chữ trắng) — cuộn mượt xuống khu vực Đáp án & lời giải chi tiết.
   * **Cột Giữa (Vòng tròn Điểm số `Donut Progress Ring` `210px`):**
     * Vòng tròn tiến độ SVG hiển thị tỷ lệ đạt được; chính giữa tâm vòng tròn là **Điểm số đạt được cỡ cực lớn (`62px` extrabold)** và dòng phụ bên dưới:
       * THPTQG: Điểm thang 10 (ví dụ: **`8,5`**) + dòng phụ **`19/22 câu`** *(trên thang 10)*.
       * TSA: Điểm thang 100 hoặc 40/20 (ví dụ: **`76`**) + dòng phụ **`76/100 câu`** *(hoặc `32/40 câu`)*.
       * HSA: Điểm thang 150 hoặc 50 (ví dụ: **`124`**) + dòng phụ **`124/150 câu`** *(hoặc `42/50 câu`)*.
   * **Cột Phải (4 Dòng Chỉ số Đối xứng):**
     * `Thời gian`: **`MM:SS`** (in đậm đen `#0f172a`)
     * `Câu đúng`: **`X`** (in đậm xanh lá `#16a34a`)
     * `Câu sai`: **`Y`** (in đậm đỏ cam `#ef4444`)
     * `Chưa làm`: **`Z`** (in đậm xám `#334155`)
2. **Bố cục 2 Cột Chính Bên Dưới (`grid-cols-[minmax(0,1fr)_340px]`):**
   * **CỘT TRÁI (Nội dung phân tích & Lời giải chi tiết):**
     * **Khối 1 – Bảng Phân tích Tiến độ & Phổ điểm:**
       * **Thanh 2 Tab:** `Tổng quan` (active gạch chân xanh tím) | `Theo dạng câu`.
       * **Mục `Tiến độ theo câu`:**
         * Header: Tiêu đề `Tiến độ theo câu` bên trái; chú thích 3 chấm màu bên phải (`🟢 Đúng`, `🔴 Sai`, `⚪ Chưa làm`, kèm `🟡 Đúng một phần` cho câu Đúng/Sai THPTQG).
         * **Lưới ô số câu (`12 cột` trên Desktop, bo góc `14px`, cao `36px`):**
           * Với đề 1 chặng (THPTQG `1..22`, hoặc đề lẻ 1 phần): Hiển thị 1 lưới liên tục.
           * Với đề tổng hợp 3 phần (Full TSA `100 câu` / Full HSA `150 câu`): Tự động tách thành **3 nhóm có tiêu đề riêng** (ví dụ TSA: **`Tư duy Toán học` (`1..40`)**, **`Tư duy Đọc hiểu` (`1..20`)**, **`Tư duy khoa học` (`1..40`)**; HSA: 3 phần tương ứng).
           * Bấm vào bất kỳ ô số nào sẽ cuộn mượt (`scrollIntoView`) tới đúng thẻ lời giải của câu hỏi đó ở bên dưới.
       * **Mục `Phân bố điểm thi` (Biểu đồ cột so sánh):**
         * Header: Tiêu đề `Phân bố điểm thi` + Badge xanh lá **`Cao hơn X% học sinh`**.
         * Biểu đồ cột đứng chia 5 khoảng điểm chuẩn theo từng kỳ thi (`0–2`, `2–4`, `4–6`, `6–8`, `8–10` với THPTQG; `0–20`..`80–100` với Full TSA; `0–30`..`120–150` với Full HSA), tô màu nổi bật cột chứa **`Điểm của bạn`** so với các **`Học sinh khác`** trong lớp/trung tâm.
     * **Khối 2 – `Đáp án & lời giải chi tiết` (Hiển thị đầy đủ 100% các câu):**
       * Dòng hướng dẫn: *"Lướt xuống để xem từng câu, hoặc bấm số câu ở 'Tiến độ theo câu' để nhảy tới."*
       * Danh sách toàn bộ các thẻ câu hỏi (chia theo từng phần đối với đề 3 phần). Mỗi thẻ câu hỏi bao gồm:
         1. **Dòng Header thẻ câu:** Huy hiệu số câu tròn/bo góc (`1`) + **`Câu 1`** + Badge trạng thái (`Đúng` xanh lá / `Đúng một phần` vàng / `Sai` đỏ / `Chưa làm` xám) + Badge loại câu (`Trắc nghiệm` / `Đúng / Sai` / `Trả lời ngắn` / `Kéo thả`) + Mã câu `#LTCH-xxxx`.
         2. **Nội dung Đề bài & Phương án:** Hiển thị đầy đủ văn bản + công thức LaTeX + hình vẽ (và khung ngữ liệu đối với câu chùm); hiển thị các phương án trả lời có đánh dấu tích xanh `✓` ở đáp án đúng và gạch đỏ `✕` ở phương án học sinh chọn sai.
         3. **Thanh Tóm tắt Kết quả Câu (3 cột ngang):**
            * **`Đáp án đúng:`** `[ B ]` (hoặc chuỗi mệnh đề `Đ-S-Đ-S` / giá trị số / thứ tự kéo thả)
            * **`Bạn chọn:`** `[ B / Chưa trả lời ]`
            * **`Điểm câu:`** `[ 0,25/0,25 ]` (hoặc `0,5/1,0`, `1/1`)
         4. **Khung `Lời giải chi tiết`:** Trình bày từng bước giải chi tiết bằng LaTeX sắc nét ngay bên dưới.
         5. **Chân thẻ câu:** Nút **`⚑ Báo lỗi`** (mở Modal báo lỗi câu hỏi/lời giải với mã `#LTCH-xxxx`).
   * **CỘT PHẢI (`340px` – Sidebar Thông tin & Đề xuất):**
     * **Thẻ 1 – `Thông tin bài thi`:** Bảng tóm tắt 6 dòng: `Kỳ thi`, `Môn thi`, `Hình thức`, `Thời gian`, `Số câu`, `Ngày làm (HH:MM - DD/MM/YYYY)`.
     * **Thẻ 2 – `Thống kê theo dạng câu`:** Tóm tắt tỷ lệ làm đúng theo từng phần / dạng câu hỏi trong bài vừa nộp.
     * **Thẻ 3 – `Đề xuất cho bạn`:** Gợi ý 3 đề luyện tập tiếp theo trong cùng Phòng Luyện của Lớp Toán Cô Hạnh kèm nút **`Luyện ngay`**.

---

### 3.4. Quy chuẩn Tablet & Mobile (cập nhật 12/11/2026)

Áp dụng cho cả ba giai đoạn, giữ phòng thi độc lập, nền sáng và nhận diện THPTQG xanh dương / HSA xanh lá / TSA đỏ.

| Kích thước | Sảnh chọn đề | Phòng làm bài |
| :--- | :--- | :--- |
| Điện thoại, dưới 768px | Một thẻ mỗi hàng, tìm kiếm và sắp xếp xuống dòng | Vùng câu hỏi toàn chiều rộng. THPTQG/TSA có thanh đồng hồ, tiến độ, nút **Bảng câu hỏi** đóng/mở và **Nộp bài / Nộp phần** luôn hiển thị. |
| Tablet, 768–1024px | Hai thẻ mỗi hàng | Dùng thanh thao tác gọn thay sidebar thường trực. TSA giữ hai cột ngữ liệu/câu hỏi; HSA giữ hai cột khi có ngữ liệu chung. |
| Desktop trên 1024px | Giữ nguyên bản thiết kế desktop hiện hành | Không thay đổi bố cục, kiểu chữ, màu sắc, sidebar, câu hỏi và kết quả của desktop. |

Tablet có màn hình lớn hơn 1024px nhưng dùng đầu vào cảm ứng chính (`hover: none`, `pointer: coarse`) vẫn dùng bố cục tablet. Điều này bao gồm iPad nằm ngang 1366px; không áp dụng thay đổi đó cho desktop có chuột.

- **Thông báo khi truy cập HSA/TSA từ điện thoại/tablet:** hiển thị gợi ý “Nên sử dụng trình duyệt trên máy tính để có trải nghiệm tốt hơn. Bạn vẫn có thể luyện tập trên điện thoại hoặc máy tính bảng.” Có nút **Đã hiểu**; không yêu cầu xác nhận để mở đề, không chặn quyền truy cập, không che vùng nộp bài. Không hiển thị cho THPTQG hoặc desktop. Khi vào trực tiếp màn chờ/phòng làm bài vẫn có gợi ý; sau khi đóng, không lặp lại theo mỗi lần chọn đáp án. Trở lại/chuyển vào phòng HSA/TSA sẽ có gợi ý cho lần truy cập mới.
- Các phần điều chỉnh về bảng Đúng/Sai, bảng dữ liệu rộng, ảnh lớn, vùng chạm và câu hỏi chỉ áp dụng cho bố cục mobile/tablet. Không sửa các quy tắc CSS desktop có sẵn.

- **Bảng câu hỏi THPTQG/TSA trên màn hình nhỏ:** mặc định thu gọn; mở trong bố cục với chiều cao tối đa 36% màn hình, cuộn riêng nếu cần. Chọn số câu sẽ đóng bảng và đưa tới câu tương ứng. Thanh thao tác không che đáp án.
- **TSA trên điện thoại:** nút **Ngữ liệu / Câu hỏi** chuyển giữa hai vùng, giữ vị trí đọc và đáp án. Trên tablet hai vùng có thể đọc song song. Không tải lại bài khi xoay thiết bị.
- **HSA trên điện thoại:** giữ đồng hồ và dải số câu cuộn ngang. Ngữ liệu lavender xếp trước câu hỏi, bỏ `sticky` và giới hạn chiều cao khi còn một cột để không che nội dung bên dưới.
- **Màn hình chờ, chọn tổ hợp và chọn phần thi:** nội dung co theo chiều rộng; hộp thoại cuộn theo chiều cao khả dụng, nút xác nhận luôn có thể tiếp cận.
- **Kết quả và lời giải:** tablet/mobile xếp tổng quan trước lời giải trên một vùng cuộn. Không để chiều cao cột desktop làm các khối chồng lên nhau.
- Nút chạm tối thiểu **44 × 44px**; ô nhập đáp án tối thiểu 16px để tránh tự phóng to trên iOS. Bảng Đúng/Sai phải giữ đủ hai cột lựa chọn.
- Tôn trọng vùng an toàn của thiết bị và chiều cao `dvh`; hỗ trợ bàn phím, trạng thái lựa chọn cho trình đọc màn hình, chữ phóng lớn và tùy chọn giảm chuyển động. Kéo thả TSA luôn có cách **chạm chọn thẻ rồi chạm ô**.
- Các chế độ hiển thị dùng chung đồng hồ máy chủ, bản nháp, tiến độ và quy trình nộp bài hiện hành; không tạo thêm lượt làm khi đổi bố cục.

---

## 4. Tóm tắt Cấu trúc & Chế độ Luyện thi HSA (ĐHQGHN)

### 4.1. Hai Chế độ Luyện thi HSA tại Lớp Toán Cô Hạnh
1. **Chế độ Luyện từng phần (Section Practice – Trọng tâm):**
   * Học sinh chọn luyện riêng **Phần 1: Tư duy định lượng (50 câu · 75 phút)**, **Phần 2: Tư duy định tính (50 câu · 60 phút)**, hoặc **Phần 3: Khoa học / Tiếng Anh (50 câu · 60 phút)**.
   * Nếu chọn Phần 3: Qua màn hình chọn 1 trong 11 tổ hợp (`Q01`–`Q10` hoặc `TIẾNG ANH`) $\rightarrow$ Màn hình chờ 120s $\rightarrow$ Làm 50 câu cuộn dọc với thanh Palette ghim đỉnh $\rightarrow$ Bấm `NỘP BÀI` (xác nhận popup liệt kê câu chưa làm) $\rightarrow$ Nhận bảng `KẾT QUẢ HOÀN THÀNH BÀI THI` (`X/50`) và bấm `Xem lại bài thi` để xem lời giải chi tiết.
2. **Chế độ Thi thử Cả đề (Full Mock Exam 150 câu · 195 phút):**
   * Thi tuần tự qua 3 phần: Màn hình chờ P1 (120s, 3 mũi tên xanh) $\rightarrow$ Phần 1 (75p) $\rightarrow$ Bấm `KẾT THÚC PHẦN` $\rightarrow$ Màn hình chờ P2 (120s, 6 mũi tên xanh) $\rightarrow$ Phần 2 (60p) $\rightarrow$ Bấm `KẾT THÚC PHẦN` $\rightarrow$ Màn hình chọn Tổ hợp Phần 3 (`Q01`–`Q10` / `TIẾNG ANH`) $\rightarrow$ Màn hình chờ P3 (120s, 9 mũi tên xanh) $\rightarrow$ Phần 3 (60p) $\rightarrow$ Bấm `NỘP BÀI`.
   * Hoàn thành cả 3 phần hiển thị màn hình `KẾT QUẢ HOÀN THÀNH BÀI THI` (`X/150 điểm`, bảng diễn giải 3 phần) và nút mở trang Xem chi tiết lời giải toàn bài.

---

## 5. Tóm tắt Cấu trúc & Chế độ Luyện thi TSA (ĐH Bách Khoa Hà Nội)

### 5.1. Hai Chế độ Luyện thi TSA tại Lớp Toán Cô Hạnh
1. **Chế độ Luyện từng phần (Section Practice – Trọng tâm):**
   * Học sinh chọn luyện riêng **Phần 1: Tư duy Toán học (40 câu · 60 phút)**, **Phần 2: Tư duy Đọc hiểu (20 câu · 30 phút)**, hoặc **Phần 3: Tư duy Khoa học / Giải quyết vấn đề (40 câu · 60 phút)**.
   * Làm bài trên giao diện TSA (Phần 1: 1 câu/màn hình; Phần 2 & 3: Chia đôi màn hình `NGỮ LIỆU` bên trái + Câu hỏi ở giữa + Sidebar ma trận 7 cột bên phải, đầy đủ 6 dạng câu hỏi tương tác) $\rightarrow$ Bấm `Nộp bài` $\rightarrow$ Chuyển thẳng sang Trang `Kết quả bài làm` (`X/40` hoặc `X/20`) kèm lời giải chi tiết.
2. **Chế độ Thi thử Cả đề (Full Mock Exam 100 câu · 150 phút):**
   * Mở Modal `Thông tin bài thi & Chọn phần thi` $\rightarrow$ Bấm `Làm phần này` ở Phần 1 Toán (60p) $\rightarrow$ Nộp Phần 1 (qua popup xác nhận vòng tròn cam `X/40 câu`) $\rightarrow$ Modal mở khóa Phần 2 Đọc hiểu (30p) $\rightarrow$ Nộp Phần 2 $\rightarrow$ Modal mở khóa Phần 3 Giải quyết vấn đề (60p) $\rightarrow$ Nộp bài.
   * Hoàn thành cả 3 phần chuyển sang Trang `Kết quả bài làm` tổng hợp (`X/100 điểm`), tách rõ tiến độ và lời giải chi tiết theo 3 phần (`Tư duy Toán học`, `Tư duy Đọc hiểu`, `Tư duy khoa học`).

---

## 6. Đặc tả Modal 'Báo lỗi câu hỏi' & Định danh Mã Câu hỏi

* **Tính Bất biến Tuyệt đối của Mã Định danh Câu hỏi (Question Code):**
  * Mã số câu hỏi (ví dụ: `#LTCH-1001`, `#LTCH-2045`) **phải do máy chủ tạo một lần duy nhất** khi câu hỏi được tải lên ngân hàng đề và **không bao giờ thay đổi**.
  * Dù câu hỏi bị xáo trộn vị trí trong các mã đề khác nhau (ví dụ: là Câu 1 ở đề A, Câu 15 ở đề B, Câu 38 ở đề C), mã câu hỏi vẫn giữ nguyên là `#LTCH-1001`.
  * **Cấm tự suy diễn mã trên Client:** Client chỉ nhận và hiển thị mã do máy chủ trả về, tuyệt đối không tự tính toán hoặc fallback mã dựa trên số thứ tự câu (`1000 + qNum`).

* **Gửi Báo lỗi Mọi lúc (Trong khi đang làm bài & Sau khi nộp) và Lưu vào Tab Quản trị:**
  * Nhờ bước **"Bắt đầu làm bài" (`POST /api/exams/:examId/start`)** đã tạo sẵn bản ghi `attemptId` (`status = 'in_progress'`) trên máy chủ ngay từ đầu ca thi, học sinh có thể bấm **Báo lỗi ⚐** và gửi báo cáo **ngay trong lúc đang làm bài giữa giờ** cũng như **sau khi đã nộp bài** (`status = 'submitted'`) mà không bao giờ bị máy chủ từ chối.
  * Học sinh chỉ cần chọn loại lỗi, nhập mô tả và bấm **`Gửi báo lỗi`**: hệ thống lập tức lưu bản ghi vào bảng `ltch_question_reports` và đẩy trực tiếp vào **Danh sách Báo lỗi Câu hỏi trong Tab Quản trị của Admin / Giáo viên / Trợ giảng** (theo phân quyền khối/kỳ thi).
  * Tại Tab Quản trị, Admin / Giáo viên / Trợ giảng nhìn thấy danh sách báo lỗi gồm:
    * Mã câu hỏi bất biến (`#LTCH-1001`) & Phiên bản câu lúc học sinh làm (`v1`).
    * Mã đề thi (`examId`), vị trí câu trong đề (`Câu 19`), mã bài làm (`attemptId`) và tên học sinh báo lỗi.
    * Loại lỗi (`category`), mô tả chi tiết của học sinh và thời gian gửi.
    * Các nút thao tác xử lý ngay trên dòng báo lỗi: **`Sửa câu hỏi`**, **`Ẩn câu hỏi`**, hoặc chuyển trạng thái (`Mới` $\rightarrow$ `Đang xử lý` $\rightarrow$ `Đã sửa` / `Đã ẩn` / `Không phải lỗi`).
  * **Giới hạn chống gửi lặp báo lỗi:** Mỗi câu hỏi (`question_code`) chỉ được báo lỗi **tối đa 1 lần trong mỗi lượt làm bài (`attempt_id`)** (ràng buộc `UNIQUE (attempt_id, question_code)` trong bảng `ltch_question_reports`). Câu đã báo lỗi trong lượt đó sẽ hiển thị trạng thái `✓ Đã gửi báo lỗi` để học sinh không bấm gửi trùng lặp.
  * **Cấu trúc Payload gửi về API `POST /api/practice/report-error` (đồng nhất định dạng `#LTCH-xxxx` và mã danh mục `category`):**
    ```json
    {
      "attemptId": "att_thptqg_52455117",
      "examId": "thptqg-2027-de-39",
      "questionCode": "#LTCH-1001",
      "questionVersion": 1,
      "questionOrder": 19,
      "category": "wrong_answer",
      "description": "Ở phương án B, dấu trong căn phải là dấu cộng..."
    }
    ```
  * **Ý nghĩa đối soát chuyên môn:** Giáo viên khi xử lý báo lỗi sẽ biết chính xác học sinh đang làm ở phiên bản nào (`v1`). Nếu câu hỏi sau đó đã được một giáo viên khác sửa lên `v2`, hệ thống vẫn hiển thị đúng ngữ cảnh `v1` mà học sinh đã gặp, tránh hiểu lầm rằng học sinh báo lỗi sai.

* **Cấu trúc trường thông tin Modal:**
  1. **Loại lỗi (`select` dropdown chuẩn 6 danh mục):**
     * `wrong_answer`: `Đáp án sai` (Mặc định).
     * `solution_error`: `Lời giải sai / khó hiểu`.
     * `content_error`: `Sai chính tả / nội dung câu hỏi`.
     * `media_error`: `Ảnh / công thức bị lỗi`.
     * `duplicate_question`: `Câu hỏi trùng lặp`.
     * `other`: `Khác`.
  2. **Mô tả chi tiết (`textarea` bắt buộc):**
     * Placeholder: `Mô tả chi tiết lỗi bạn phát hiện...`
     * Ràng buộc: Nhập tối thiểu 5 ký tự, tối đa 2000 ký tự.
     * Bộ đếm ký tự thời gian thực: `0/2000`.
     * Nút `Gửi báo lỗi` tự động khóa nếu chưa đủ 5 ký tự.
  3. **Nút điều khiển:** Nút `Hủy` và nút `Gửi báo lỗi` (gửi dữ liệu kèm `attemptId` và `questionVersion` về hệ thống).

---

## 7. Cơ chế Chống mất bài, Đồng hồ Máy chủ & Tự động Nộp khi Hết giờ (Resilience Engine)

Quy định chuẩn hóa hạ tầng phòng thi chống gian lận thời gian, bảo toàn bài làm khi gặp sự cố mạng hoặc tải lại trang:

### 7.1. Bước "Bắt đầu làm bài" trên Máy chủ & Đồng hồ Đếm ngược Ca thi (`startAttempt`)
* **Khắc phục triệt để hạn chế cũ (chỉ tạo bài làm lúc nộp):**
  * Hệ thống hiện tại chỉ tạo bản ghi `ltch_practice_attempts` khi bấm nộp bài, dẫn đến việc chỉ có `closesAt` (hạn đóng đợt mở đề, có thể kéo dài nhiều tuần/tháng) chứ chưa lưu giờ bắt đầu làm bài thực tế của từng học sinh.
  * Thiết kế mới bổ sung **Bước "Bắt đầu làm bài" trên máy chủ (`POST /api/exams/:examId/start`)** để máy chủ cấp `attemptId` và ghi lại chính xác thời điểm bắt đầu (`started_at`) cùng hạn làm bài (`deadline_at`) của phiên thi đó ngay trong cơ sở dữ liệu.
* **Đề Phòng Luyện không dùng hạn đóng `closesAt` (chỉ dùng công tắc Bật/Tắt hiển thị & Bảo vệ phiên đang làm dở):**
  * Khác với bài kiểm tra định kỳ trên lớp (`exam_type = 'class'` có giờ mở/đóng `closesAt`), các đề thuộc 3 Phòng Luyện (`thptqg`, `hsa`, `tsa` — bao gồm cả đề hiện hành, đề năm trước được bật chia sẻ qua `ltch_exam_year_shares` và đề trong *"Kho đã học"*) **không bị giới hạn bởi `closesAt`** mà chỉ quản lý bằng trạng thái bật/tắt hiển thị (`status = 'published'`).
  * **Không làm đứt quãng bài đang làm dở:** Công tắc tắt hiển thị đề chỉ chặn việc **mở lượt làm mới (`POST /start`)**; nếu một học sinh đã mở lượt làm hợp lệ từ trước và đang ở trạng thái `'in_progress'`, em đó vẫn được phép lưu nháp, chuyển phần, nộp bài và xem kết quả của lượt đó bình thường.
  * Nhờ vậy, học sinh có thể vào làm mới hoặc làm lại đề cũ bất cứ lúc nào trong suốt năm học mà không bao giờ bị lỗi "đề đã quá hạn đóng" hay mất bài giữa chừng.
  * Thời lượng làm bài chuẩn (`durationMinutes`) của mỗi lượt được tính trọn vẹn từ lúc bấm bắt đầu:
    * **THPTQG (Khối 10, 11, 12):** $90 \text{ phút}$.
    * **HSA:** Phần 1 ($75 \text{ phút}$), Phần 2 ($60 \text{ phút}$), Phần 3 ($60 \text{ phút}$), Cả đề ($195 \text{ phút}$).
    * **TSA:** Phần 1 ($60 \text{ phút}$), Phần 2 ($30 \text{ phút}$), Phần 3 ($60 \text{ phút}$), Cả đề ($150 \text{ phút}$).
* **Quy tắc Tráo Câu & Tráo theo Chùm Câu mỗi khi Làm Bài Mới (Cluster-aware Question Shuffling):**
  * Mỗi khi học sinh bấm bắt đầu một lượt làm bài mới (`POST /api/exams/:examId/start`), máy chủ tự động sinh một thứ tự câu hỏi mới cho lượt làm đó để học sinh rèn luyện thực chất, không bị học thuộc lòng vị trí câu:
    1. **Đối với đề THPTQG (22 câu):** Tráo ngẫu nhiên vị trí các câu trong nội bộ từng phần (12 câu Phần I tráo trong Câu 1–12; 4 câu Đúng/Sai Phần II tráo trong Câu 13–16; 6 câu Điền số Phần III tráo trong Câu 17–22).
    2. **Đối với đề HSA và TSA (có cả câu đơn và chùm câu hỏi chung ngữ liệu `cluster_id`):**
       * **Câu đơn lẻ (`cluster_id IS NULL`):** Tráo vị trí ngẫu nhiên trong phạm vi phần thi/nhóm câu tương ứng.
       * **Chùm câu hỏi (`cluster_id IS NOT NULL`, ví dụ chùm 3–5 câu đọc hiểu hoặc chùm dữ liệu khoa học dùng chung `passage_id`):** Được gom thành **một khối nguyên vẹn (Cluster Block)** và **tráo vị trí theo cả chùm câu** — đảm bảo các câu hỏi con thuộc cùng một đoạn văn/ngữ liệu luôn nằm liền kề nhau để hiển thị chung với hộp ngữ liệu bên cột trái.
       * **Riêng Phần 3 HSA (tổ hợp Khoa học):** Chỉ tráo câu **bên trong từng môn** (`subject_code`); các câu cùng môn luôn liền nhau thành một khối và không trộn sang môn khác. Ở chế độ *Thi cả đề*, việc tráo Phần 3 thực hiện khi bắt đầu Phần 3 (sau khi học sinh chọn tổ hợp).
    3. **Giữ nguyên thứ tự 4 phương án `A, B, C, D` và 4 mệnh đề `a, b, c, d` bên trong từng câu:** Hệ thống **chỉ tráo vị trí các câu hỏi và chùm câu**, tuyệt đối không đảo thứ tự 4 phương án trả lời hay 4 mệnh đề bên trong một câu để các phương án dạng *"Cả A và B đều đúng"* và nội dung lời giải chi tiết (*"Chọn C vì..."*, *"Từ a) suy ra b)..."*) luôn khớp chính xác 100%.
    4. **Lưu cố định thứ tự đã tráo bằng Mảng JSON có thứ tự (`attempt_questions`):** Thứ tự câu và phiên bản câu sau khi tráo được lưu vào cột mảng `attempt_questions jsonb NOT NULL DEFAULT '[]'::jsonb` (`jsonb_typeof = 'array'`, mỗi phần tử `{ slot, section, subject, clusterId, passageId, passageVersion, questionCode, version }`) trong bản ghi `ltch_practice_attempts` (tuyệt đối không lưu dạng JSON Object `{}` để không bị PostgreSQL sắp xếp lại thứ tự key). Mọi thao tác đọc đề khi F5, chấm điểm và xem lại kết quả đều đọc theo đúng mảng thứ tự này.
* **Quy trình khởi tạo, Chống bấm đúp (Idempotent) & Tính hạn làm bài (`deadlineAt`) trên Máy chủ:**
  1. **Thời điểm tạo lượt làm:** Khi học sinh bấm vào làm bài từ Sảnh, Client gọi `POST /api/exams/:examId/start` **ngay lúc vào màn hình chờ Phần 1 / màn hình chờ của phần luyện riêng**. Lượt làm được tạo ở trạng thái chờ; đồng hồ làm bài chỉ chạy khi bấm `BẮT ĐẦU` hoặc khi hết 120 giây chờ.
  2. **Khóa giao dịch chống bấm đúp & Tự chốt lượt cũ đã hết giờ:** Máy chủ dùng khóa giao dịch theo `(uid, exam_id)` (hoặc bắt `23505 unique_violation` trả về phiên vừa tạo để đảm bảo **Idempotent** khi học sinh bấm đúp chuột lúc mạng chậm) và kiểm tra lượt `'in_progress'` hiện có:
     * **Nếu lượt đó đã quá hạn** (quá `deadline_at`, quá hạn phần đang làm cộng ân hạn mạng, hoặc treo ở màn hình chọn tổ hợp Phần 3 HSA quá 24 giờ): máy chủ **gọi `autoFinalizeExpiredAttempt` để tự chốt và chấm lượt cũ bằng bản nháp gần nhất trước**, chuyển sang `'submitted'`, rồi mới tạo lượt mới. Nhờ vậy ràng buộc "mỗi đề chỉ 1 lượt đang làm" không bao giờ làm học sinh bị kẹt.
     * **Nếu lượt đó còn hạn và cùng chế độ:** Trả về lại đúng `attemptId`, `startedAt`, `deadlineAt`, `section_states` đã lưu (F5 / tải lại trang không bao giờ reset đồng hồ).
     * **Nếu lượt đó còn hạn nhưng khác chế độ:** Từ chối tạo lượt mới (`409 ATTEMPT_IN_PROGRESS_OTHER_MODE`), yêu cầu tiếp tục hoặc nộp xong lượt đang làm dở.
     * **Nếu không có lượt đang làm:** Tạo bản ghi mới trong `ltch_practice_attempts` với `status = 'in_progress'`.
  3. **Hạn nộp theo từng chế độ:**
     * **THPTQG và Luyện riêng từng phần (1 chặng):** Hạn nộp tính từ lúc phần thi bắt đầu chạy giờ:
       $$\text{deadlineAt} = \text{sectionStartedAt} + \text{durationMinutes} \times 60000$$
     * **Thi cả đề HSA / TSA (3 chặng):** Đồng hồ hiển thị, việc khóa phần và ân hạn mạng **đều tính theo hạn của từng phần (`sectionDeadlineAt_k`)**. Cột `deadline_at` chỉ là **mốc chặn trên an toàn** của cả lượt làm:
       $$\text{deadlineAt} = \text{startedAt} + \sum_{k=1}^{3} \text{durationMinutes}_k \times 60000 + 3 \times 120000$$
       *(HSA: 195 phút + 6 phút chờ; TSA: 150 phút + 6 phút chờ)*. Riêng trường hợp đang chờ chọn tổ hợp Phần 3 HSA, mốc chặn trên được dời theo giờ thực tế bắt đầu Phần 3.
* **Cơ chế Quản lý Thời gian Từng phần & Màn hình Chờ 120 giây khi Thi Cả Đề (Multi-section State Machine):**
  * Đối với chế độ **Thi cả đề (Full HSA 3 phần / Full TSA 3 phần)**, vì giữa các phần có màn hình chờ tối đa 120 giây và học sinh được phép bấm bắt đầu sớm hoặc nộp sớm từng phần, máy chủ **không dùng một hạn chung kiểu `startedAt + 195 phút`** mà ghi nhận giờ bắt đầu và hạn nộp **riêng cho từng phần (`section_states`)**:
    1. **Vào màn hình chờ phần $k \in \{1, 2, 3\}$:** Máy chủ ghi `waitStartedAt = serverNow` và `waitEndsAt = waitStartedAt + 120000` (120 giây). Trong lúc đang ở màn hình chờ (`status = 'waiting'`), máy chủ **chưa trả câu hỏi** của phần $k$ xuống Client.
    2. **Học sinh bấm `BẮT ĐẦU` phần $k$ trước khi hết 120 giây (`POST /api/exams/:examId/section` với `action: 'start_section'`):** Máy chủ ghi `sectionStartedAt = serverNow`, tính hạn làm phần $k$:
       $$\text{sectionDeadlineAt}_k = \text{sectionStartedAt}_k + \text{durationMinutes}_k \times 60000$$
       và **chỉ trả về danh sách câu hỏi của đúng phần đang mở (`current_section = k`)**, tuyệt đối không tải trước câu hỏi của Phần 2, Phần 3 khi đang làm Phần 1.
    3. **Hết 120 giây chờ mà học sinh chưa bấm `BẮT ĐẦU` (ví dụ đóng tab):** Máy chủ **tự động tính giờ bắt đầu phần $k$ đúng tại thời điểm hết 120 giây chờ**:
       $$\text{sectionStartedAt}_k = \text{waitEndsAt}_k, \quad \text{sectionDeadlineAt}_k = \text{waitEndsAt}_k + \text{durationMinutes}_k \times 60000$$
       **Ngoại lệ Phần 3 HSA:** nếu học sinh chưa chọn tổ hợp, máy chủ không tự bắt đầu Phần 3 mà giữ màn hình chọn tổ hợp; giờ Phần 3 chỉ bắt đầu tính sau khi học sinh chọn xong tổ hợp.
    4. **Khi nộp sớm phần $k$ (`POST /api/exams/:examId/section` với `action: 'submit_section'`) hoặc khi hết giờ phần $k$ ($\text{serverNow} > \text{sectionDeadlineAt}_k$):** Máy chủ tự động chốt và khóa vĩnh viễn các câu hỏi của phần $k$ (bằng bản nháp gần nhất nếu hết giờ), đồng thời kích hoạt màn hình chờ 120 giây của phần $k+1$. Khi phần 3 kết thúc, máy chủ tự động chốt toàn bộ bài thi (`status = 'submitted'`).
    5. **Khóa cứng đáp án của phần đã chốt:** Khi phần $k$ đã chuyển sang `locked`, máy chủ **chỉ nhận đáp án của các câu thuộc phần đang mở (`current_section`)** trong mọi API `/draft`, `/section` và `/submit`. Đáp án gửi lên cho câu thuộc phần đã khóa hoặc phần chưa mở **bị bỏ qua hoàn toàn**, giữ nguyên đáp án đã chốt — học sinh không thể quay lại sửa Phần 1 khi đang làm Phần 2.
  3. Máy chủ trả về `{ attemptId, startedAt, deadlineAt, sectionStates, currentSection, serverNow }`.
  4. Client tính độ lệch đồng hồ: $\text{clockOffset} = \text{serverNow} - \text{Date.now()}$.
  5. Mỗi giây (tick), thời gian còn lại hiển thị trên đồng hồ phòng thi (ở chế độ *Thi cả đề* dùng hạn của phần đang mở `sectionDeadlineAt_k` thay cho `deadlineAt`):
     $$\text{remainingMs} = \text{deadlineAt} - (\text{Date.now()} + \text{clockOffset})$$
  6. Khi nộp bài (`POST /api/exams/:examId/submit`), máy chủ đối chiếu thời điểm nộp `serverNow` với hạn của chặng đang làm đã lưu trong DB (cho phép ân hạn trễ mạng 5–10 giây) rồi cập nhật bản ghi từ `'in_progress'` sang `'submitted'`.

### 7.2. Tự động Nộp bài khi Hết giờ & Máy chủ Tự Chốt bằng Bản nháp Gần nhất
* **Trên Client khi $\text{remainingMs} \le 0$:**
  1. Toàn bộ ô chọn đáp án và nút bấm trong phòng thi lập tức chuyển sang trạng thái khóa (`disabled`).
  2. Hiển thị thông báo nổi bật: *"Đã hết thời gian làm bài! Hệ thống đang tự động nộp bài làm của bạn..."*.
  3. Tự động kích hoạt hàm nộp bài `submitExam()` gửi dữ liệu về máy chủ.
* **Trên Máy chủ khi tiếp nhận yêu cầu hoặc phát hiện phiên quá hạn (`autoFinalizeExpiredAttempt`):**
  1. **Trong khoảng ân hạn mạng ngắn ($\text{serverNow} \le \text{deadlineAt} + \text{GRACE\_PERIOD\_MS}$, 5–10 giây):** Máy chủ nhận gói `responses` cuối cùng từ Client, chấm điểm và chuyển `status = 'submitted'`.
  2. **Quá khoảng ân hạn ($\text{serverNow} > \text{deadlineAt} + \text{GRACE\_PERIOD\_MS}$) — ví dụ hết giờ đúng lúc mất mạng hoặc tắt máy:**
     * **Tuyệt đối không từ chối gây mất bài:** Máy chủ tự động chốt bài (`status = 'submitted'`, `submitted_at = deadline_at`) bằng **bản nháp (`responses`) đã đồng bộ lên máy chủ gần nhất trước lúc hết giờ**, chấm điểm và trả ngay kết quả bài làm cho học sinh.
     * Cơ chế tự chốt này cũng tự động kích hoạt khi học sinh mở lại trang kết quả (`GET /result`), mở lại phòng luyện (`GET /api/practice/rooms`) hoặc gọi lại `POST /submit` sau khi có mạng trở lại.

### 7.3. Lưu Nháp 2 Tầng (`localStorage` + Đồng bộ Định kỳ lên Máy chủ) & Khôi phục Đa thiết bị
* **Tầng 1 – Lưu cục bộ tức thì bằng `localStorage` (tuyệt đối không dùng `sessionStorage`):**
  * Mỗi khi học sinh chọn đáp án trắc nghiệm, nhập ký tự vào ô điền số, hoặc đánh dấu câu hỏi (`flagged`), trạng thái bài làm kèm mốc thời gian `clientUpdatedAt` lập tức được ghi vào `localStorage` theo khóa `ltch_draft_${attemptId}`.
  * Nhờ dùng `localStorage`, khi học sinh vô tình đóng tab hoặc tắt trình duyệt rồi mở lại trên cùng máy, dữ liệu vẫn còn nguyên vẹn 100%.
* **Tầng 2 – Đồng bộ bản nháp định kỳ lên Máy chủ (`POST /api/exams/:examId/draft`):**
  * Khi có thay đổi câu trả lời, Client tự động gom (debounce 3–5 giây hoặc định kỳ mỗi 15 giây khi có thay đổi) để gọi API `POST /api/exams/:examId/draft`, lưu `responses`, danh sách câu đánh dấu (`flagged`), vị trí câu đang làm và `draftUpdatedAt` trực tiếp vào bản ghi `ltch_practice_attempts` (`status = 'in_progress'`) trên máy chủ.
* **Khôi phục nguyên vẹn khi Tải lại trang, Đóng mở lại tab hoặc Đổi thiết bị & Khóa làm đồng thời trên 2 thiết bị (`active_device_token`):**
  * Chỉ cho phép **1 thiết bị / 1 tab hoạt động tại một thời điểm** trên cùng một lượt làm bài (`attemptId`):
    * Khi học sinh mở hoặc tiếp tục lượt làm bài (`POST /api/exams/:examId/start`), máy chủ cấp một `active_device_token` mới gắn vào bản ghi `ltch_practice_attempts` và trả về cùng bản nháp `serverDraft`.
    * **Kiểm tra bắt buộc `active_device_token` trên cả 3 API thay đổi trạng thái (`/draft`, `/section`, `/submit`):** Khi học sinh chuyển sang thiết bị mới, thiết bị mới nhận `active_device_token` mới và khôi phục 100% bài làm đã đồng bộ; còn thiết bị cũ nếu vẫn mở và gửi `POST /draft`, `POST /section` hoặc `POST /submit` (kể cả khi đồng hồ ở tab cũ tự đếm về `00:00`) đều bị từ chối (`409 Conflict - DEVICE_SUPERSEDED`), dừng đồng hồ tự nộp và khóa màn hình kèm thông báo *"Bài làm đang được tiếp tục trên một thiết bị/cửa sổ khác"*, tránh tuyệt đối việc thiết bị cũ nộp nhầm hoặc ghi đè làm mất câu trả lời mới.
  * Đồng hồ tiếp tục đếm ngược theo `deadlineAt` / `sectionDeadlineAt` của máy chủ (không bị reset hay cộng thêm giờ).

### 7.4. Ứng phó Sự cố Mất kết nối Mạng (Offline Resilience)
* Hệ thống lắng nghe sự kiện mạng `window.addEventListener('offline')` và `'online'`:
  * **Khi mất mạng:** Trạng thái kết nối trên Header chuyển sang `🔴 Mất kết nối mạng - Bài làm vẫn được lưu tạm an toàn trên máy, hãy kiểm tra đường truyền!`. Học sinh vẫn tiếp tục tích chọn câu trả lời bình thường (lưu vào `localStorage` với cờ `dirty = true`).
  * **Khi có mạng trở lại:** Tự động gọi ngay `POST /api/exams/:examId/draft` để đồng bộ bản nháp từ `localStorage` lên máy chủ, sau đó trạng thái phục hồi `🟢 Đang kết nối`.
  * **Nếu bấm nộp bài lúc mất mạng:** Hệ thống chặn nộp, giữ nguyên bài làm trong `localStorage`, hiển thị cảnh báo: *"Không có kết nối Internet. Vui lòng kiểm tra lại mạng trước khi nộp bài!"*.
  * **Nếu hết giờ khi đang mất mạng:** Trình duyệt khóa thao tác sửa bài, lưu trạng thái hết giờ cục bộ; ngay khi mạng khôi phục và gọi lên server (hoặc kể cả khi mất mạng kéo dài quá 10 giây), máy chủ tự động chốt bài bằng **bản nháp đã đồng bộ lên máy chủ gần nhất** trước khi hết hạn, đảm bảo học sinh không bao giờ bị mất bài.

### 7.5. Năm thi THPTQG Tự động theo Niên khóa của Lớp Đang Hoạt động (Dynamic Exam Year)
* **Không ghi cứng "2027":**
* Năm thi tốt nghiệp THPTQG hiển thị trên thẻ bài và tiêu đề phòng thi được suy ra từ niên khóa (`school_year_id`) đang gắn với các lớp hoạt động (`archived = false`) của học sinh (hoặc niên khóa có `starts_on <= today <= ends_on` khi chưa chuyển năm học):
  $$\text{examYear} = \text{activeSchoolYear.endsOn.getFullYear()}$$
  *(Ví dụ: Lớp đang hoạt động thuộc niên khóa `2026-2027` thì năm thi là `2027`; khi chạy chuyển niên khóa sang `2027-2028` thì năm thi mới tự động đổi thành `2028`, tránh việc nhảy năm sớm nếu Admin chỉ mới tạo bản ghi năm học dự kiến).*

---

## 8. Quy chuẩn Thang điểm & Cách tính Điểm Chuẩn Bộ GD&ĐT, HSA (ĐHQGHN) & TSA (ĐHBKHN)

Hệ thống chấm điểm tuân thủ chính xác quy chế chấm thi của **Bộ GD&ĐT (THPTQG)**, **ĐHQGHN (HSA)** và **ĐH Bách Khoa Hà Nội (TSA)**, đồng thời tương thích 100% với cấu trúc `points` và `weights` của bộ chấm `public/practice-engine.js`:

### 8.1. Cách tính điểm Đề THPTQG Môn Toán (Khối 10, 11 theo Form & Khối 12 Thực chiến – Chuẩn Bộ GD&ĐT)
Đề gồm **22 câu hỏi (90 phút)**, chấm theo **Thang điểm 10,0** (kèm hiển thị số câu đúng trên từng phần và toàn bài):
1. **Phần I – Trắc nghiệm 4 lựa chọn (12 câu, từ Câu 1 đến Câu 12 — Tối đa 3,0 điểm):**
   * Mỗi câu trả lời đúng được **`0,25 điểm`** (`type: 'single'`, `points: 0.25`).
   * Điểm tối đa Phần I: $12 \times 0,25 = \mathbf{3,0 \text{ điểm}}$.
2. **Phần II – Trắc nghiệm Đúng/Sai (4 câu, từ Câu 13 đến Câu 16 — Tối đa 4,0 điểm):**
   * Mỗi câu gồm 4 mệnh đề `a), b), c), d)`, điểm tối đa mỗi câu là **`1,0 điểm`** (`type: 'true_false'`, `points: 1.0`).
   * **Tính điểm lũy tiến bậc thang theo số ý trả lời đúng trong mỗi câu** (`weights: [0, 0.1, 0.25, 0.5, 1]` trong `practice-engine.js`):
     * Trả lời đúng **0 ý**: **`0 điểm`**
     * Chỉ chọn chính xác **1 ý** trong 1 câu: **`0,1 điểm`**
     * Chỉ chọn chính xác **2 ý** trong 1 câu: **`0,25 điểm`**
     * Chỉ chọn chính xác **3 ý** trong 1 câu: **`0,5 điểm`**
     * Chọn chính xác cả **4 ý** trong 1 câu: **`1,0 điểm`** (trọn vẹn điểm câu đó).
   * Điểm tối đa Phần II: $4 \times 1,0 = \mathbf{4,0 \text{ điểm}}$.
3. **Phần III – Trắc nghiệm trả lời ngắn / Điền đáp số (6 câu, từ Câu 17 đến Câu 22 — Tối đa 3,0 điểm):**
   * Đối với môn Toán, mỗi câu trả lời đúng được **`0,5 điểm`** (`type: 'short'`, `points: 0.5`).
   * Điểm tối đa Phần III: $6 \times 0,5 = \mathbf{3,0 \text{ điểm}}$.
4. **Tổng điểm toàn bài THPTQG:**
   $$\text{Tổng điểm} = \text{Phần I (3,0đ)} + \text{Phần II (4,0đ)} + \text{Phần III (3,0đ)} = \mathbf{10,0 \text{ điểm}}$$

---

### 8.2. Cách tính điểm Kỳ thi Đánh giá năng lực HSA (ĐHQGHN)
Bài thi HSA gồm các câu hỏi trắc nghiệm 4 lựa chọn (`single`) và điền đáp án ngắn (`short`), **không có câu hỏi bảng Đúng/Sai**:
* **Quy tắc chấm chuẩn ĐHQGHN:**
  * Mỗi câu trả lời đúng được **`1,0 điểm`** (`points: 1.0`).
  * Câu trả lời sai hoặc bỏ trống được **`0 điểm`** (tuyệt đối không trừ điểm câu sai).
* **Điểm từng phần & Toàn bài:**
  * **Phần 1 – Tư duy định lượng (Toán học & Xử lý số liệu, 50 câu · 75 phút):** Tối đa **`50 / 50 điểm`** (tương ứng số câu đúng / 50 câu: 35 câu TN + 15 câu điền đáp án).
  * **Phần 2 – Tư duy định tính (Ngôn ngữ – Văn học, 50 câu · 60 phút):** Tối đa **`50 / 50 điểm`** (tương ứng số câu đúng / 50 câu).
  * **Phần 3 – Khoa học hoặc Tiếng Anh (50 câu · 60 phút):** Tối đa **`50 / 50 điểm`** (tương ứng số câu đúng / 50 câu).
  * **Thi cả đề (Full HSA 150 câu · 195 phút):**
    $$\text{Tổng điểm HSA} = \text{Phần 1 (50đ)} + \text{Phần 2 (50đ)} + \text{Phần 3 (50đ)} = \mathbf{150 \text{ điểm}}$$

---

### 8.3. Cách tính điểm Kỳ thi Đánh giá tư duy TSA (ĐH Bách Khoa Hà Nội & Chuẩn 9Study)
1. **Quy tắc chấm các dạng câu hỏi nhiều ý của TSA ("Đúng trọn vẹn" – Khác với THPTQG):**
   * Theo quy định của ĐH Bách Khoa Hà Nội đối với tất cả các dạng câu hỏi có nhiều thành phần nhỏ trong cùng 1 câu (bảng Đúng/Sai từ 2 đến 5 mệnh đề `true_false`, trắc nghiệm chọn nhiều đáp án `multiple`, điền nhiều ô trống inline `fill_blank`, hoặc kéo thả nhiều vị trí `drag_drop`): **Thí sinh phải trả lời đúng hết tất cả các ý/vị trí trong câu hỏi đó (`correctCount === totalParts`) thì câu đó mới được tính là trả lời đúng và nhận trọn `1,0 điểm`**. Nếu sai hoặc bỏ trống dù chỉ 1 ý/1 ô thì câu hỏi đó bị tính là **Sai (`0 điểm`)**.
   * Trong `practice-engine.js`, các câu nhiều thành phần của TSA được cấu hình chuẩn với `points: 1.0` và mảng `weights` có phần tử cuối bằng `1` còn các phần tử trước bằng `0` (ví dụ bảng $m$ mệnh đề dùng `weights = [...Array(m).fill(0), 1]`), đồng thời vẫn trả về `correctCount / totalParts` để học sinh xem thống kê chi tiết từng ý trong màn hình lời giải.
2. **Thang điểm từng phần & Toàn bài TSA trong Phòng luyện (Chuẩn 9Study):**
   * *(Ghi chú chuyên môn: Trong kỳ thi thật, ĐHBKHN chuẩn hóa điểm cuối cùng theo mô hình IRT 2 tham số dựa trên phổ điểm toàn đợt thi; còn trong phòng luyện trực tuyến cá nhân chuẩn 9Study, điểm được tính trực tiếp theo số câu trả lời đúng trên thang 100 tương ứng 100 câu)*:
   * Mỗi câu trả lời đúng trọn vẹn (trong cả 6 dạng: `single`, `multiple`, `true_false`, `short`, `fill_blank`, `drag_drop`) được tính **`1,0 điểm`** (`points: 1.0`):
     * **Phần 1 – Tư duy Toán học (40 câu · 60 phút):** Tối đa **`40 / 40 điểm`** (số câu đúng / 40 câu).
     * **Phần 2 – Tư duy Đọc hiểu (20 câu · 30 phút):** Tối đa **`20 / 20 điểm`** (số câu đúng / 20 câu).
     * **Phần 3 – Tư duy Khoa học / Giải quyết vấn đề (40 câu · 60 phút):** Tối đa **`40 / 40 điểm`** (số câu đúng / 40 câu).
     * **Thi cả đề (Full TSA 100 câu · 150 phút):**
       $$\text{Tổng điểm TSA} = \text{Phần 1 (40đ)} + \text{Phần 2 (20đ)} + \text{Phần 3 (40đ)} = \mathbf{100 \text{ điểm}}$$

---

### 8.4. Quy chuẩn Chấm câu Điền Đáp số (`short` & `fill_blank`) và Kéo thả (`drag_drop`)
* **Với câu điền đáp số ngắn khung lớn (`short`) và điền inline (`fill_blank`):**
  * Mỗi ô nhập chỉ nhận **1 giá trị duy nhất** cho ô đó (với câu `fill_blank` có $k$ ô trống trong câu văn thì `response` là mảng $k$ chuỗi tương ứng với $k$ danh sách `accepted` của từng ô).
  * **Quy định theo cài đặt của người tải đề:** Tùy từng câu hỏi sẽ có yêu cầu cụ thể (điền số nguyên, số thập phân làm tròn, phân số tối giản, hoặc điền từ không quá 2 tiếng từ đoạn văn...), được chú thích rõ ngay trong đề bài và thiết lập trong trường `accepted`.
  * **Nguyên tắc chuẩn hóa & đối chiếu (`practice-engine.js`):**
    * Với đáp án số/phân số: Cắt khoảng trắng đầu/cuối (`trim()`), loại bỏ khoảng trắng thừa bên trong số/phân số (`replace(/\s+/g, '')`), đổi dấu phẩy `,` $\rightarrow$ `.`, dấu trừ Unicode `−` $\rightarrow$ `-`.
    * Với đáp án từ ngữ Tiếng Việt (ví dụ câu điền từ Đọc hiểu/Khoa học TSA): `trim()`, chuẩn hóa khoảng trắng đơn giữa các từ (`replace(/\s+/g, ' ')`), so khớp không phân biệt hoa thường (`toLowerCase()`) với `accepted`.
* **Với câu kéo thả (`drag_drop`):**
  * Đáp án học sinh thả vào $k$ ô trống được lưu dưới dạng mảng ID của các thẻ đáp án `[slot_1_item_id, slot_2_item_id, ...]`; chấm đúng khi toàn bộ $k$ vị trí khớp chính xác với mảng đáp án chuẩn của câu hỏi.
* **Chống sai số dấu phẩy động IEEE-754:** Mọi phép tính điểm từng câu (`points * weights[correctCount]`) và tổng điểm toàn bài đều được chuẩn hóa `Math.round(val * 10000) / 10000` (tránh tuyệt đối lỗi số lẻ kiểu `7.3500000000000005 / 10`), hiển thị gọn tối đa 2 chữ số thập phân chuẩn Việt Nam (`8,25`, `7,1`, `9,5`).

---

### 8.5. Bảng Tổng hợp Cấu hình Chấm điểm (`practice-engine.js`) theo Từng Kỳ thi

| Kỳ thi / Chế độ | Tổng câu & Thời gian | Cấu hình `points` & `weights` trong `practice-engine.js` | Điểm hiển thị chính thức |
| :--- | :---: | :--- | :--- |
| **THPTQG**<br>*(Khối 10, 11, 12)* | **22 câu · 90 phút** | • **Phần I (12 câu `single`):** `points = 0.25` (tối đa $3,0\text{đ}$)<br>• **Phần II (4 câu `true_false`):** `points = 1.0`, `weights = [0, 0.1, 0.25, 0.5, 1]` (tối đa $4,0\text{đ}$)<br>• **Phần III (6 câu `short`):** `points = 0.5` (tối đa $3,0\text{đ}$) | **Thang điểm 10,0**<br>*(kèm thống kê $X/22$ câu đúng)* |
| **HSA – Từng phần**<br>*(P1, P2 hoặc P3)* | **50 câu · 75p / 60p** | • **Mỗi câu (`single` / `short`):** `points = 1.0` | **$X / 50$ điểm**<br>*(tương ứng $X/50$ câu đúng)* |
| **HSA – Cả đề**<br>*(Full 3 phần)* | **150 câu · 195 phút** | • **Mỗi câu (`single` / `short`):** `points = 1.0` | **$(P_1 + P_2 + P_3) / 150$ điểm**<br>*(tương ứng tổng câu đúng / 150)* |
| **TSA – Từng phần**<br>*(P1: 40c, P2: 20c, P3: 40c)* | **40 câu (60p)** hoặc **20 câu (30p)** | • **Đủ 6 dạng (`single`, `multiple`, `true_false`, `short`, `fill_blank`, `drag_drop`):** `points = 1.0`<br>• **Câu nhiều ý:** đúng trọn vẹn 100% các ý trong câu mới nhận $1,0\text{đ}$ | **$T_1 / 40$ điểm**, **$T_2 / 20$ điểm**, hoặc **$T_3 / 40$ điểm** |
| **TSA – Cả đề**<br>*(Full 3 phần)* | **100 câu · 150 phút** | • **Đủ 6 dạng (`single`, `multiple`, `true_false`, `short`, `fill_blank`, `drag_drop`):** `points = 1.0` (đúng trọn vẹn nhận $1,0\text{đ}$) | **$(T_1 + T_2 + T_3) / 100$ điểm**<br>*(tương ứng tổng câu đúng / 100)* |

### 8.6. Quy định Không Giới hạn Số Lượt Làm bài, Hiển thị Danh sách Điểm Từng Lần & "Kho đã học"
* **Không giới hạn số lượt làm lại (Unlimited Retakes):**
  * Đối với tất cả các đề trong phòng luyện (cả kho hiện tại lẫn "Kho đã học"), học sinh được phép **làm lại không giới hạn số lượt** để rèn luyện kỹ năng.
* **Hiển thị điểm rõ ràng của từng lần làm theo danh sách:**
  * Mỗi lần nộp bài tạo một mã `attemptId` độc lập lưu vết đầy đủ trong hệ thống.
  * Giao diện thẻ đề và lịch sử bài làm hiển thị **danh sách rõ ràng từng lần làm (`Lần 1`, `Lần 2`, `Lần 3`, ...)** kèm:
    * Điểm số đạt được của lần đó (ví dụ: `Lần 1: 7,25/10đ` — `Lần 2: 8,75/10đ` — `Lần 3: 9,50/10đ`).
    * Số câu đúng / tổng số câu và thời gian làm bài của từng lần.
    * Nút bấm **`Xem bài làm & Lời giải`** riêng cho từng lần trong danh sách.
* **Quy chế "Kho đã học" (Được xem lại & Được làm lại đề cũ):**
  * Học sinh sau khi được chuyển lên lớp (Lớp 10 lên 11, Lớp 11 lên 12) có mục **"Kho đã học"** chứa toàn bộ đề THPTQG của khối lớp và năm học mình đã học trước đó.
  * Trong "Kho đã học", học sinh vừa xem lại được danh sách điểm các lần làm cũ và lời giải chi tiết, vừa **được phép vào làm lại các đề cũ đó** (không giới hạn số lần) để ôn tập lại kiến thức nền tảng. (Chỉ khi học sinh đã tốt nghiệp lớp 12 và lớp 12 vào kho lưu trữ thì toàn bộ phòng luyện mới đóng).

---

## 9. Thiết kế Cấu trúc Cơ sở Dữ liệu & API (Database & Backend Specification)

Để sẵn sàng khi triển khai lập trình, toàn bộ cấu trúc bảng dữ liệu và endpoint API được quy chuẩn như sau:

### 9.1. Cấu trúc Bảng Cơ sở Dữ liệu (Supabase / PostgreSQL – Đồng bộ 100% với Schema đang chạy)
1. **Bảng Lớp học (`ltch_classes` – mở rộng bảng hiện có):**
   * Bổ sung cột `grade smallint CHECK (grade BETWEEN 6 AND 12)` kèm index `ltch_classes_grade_idx`.
   * Cập nhật đồng bộ cột `grade` trong migration dữ liệu hiện có cũng như trong `advance_school_year`, `create_class` và thao tác đổi tên lớp.
2. **Bảng Lịch sử Khối học theo Niên khóa (`ltch_student_grade_history` – mới):**
   * Lưu vết chính xác học sinh đã học khối nào ở năm học nào trước khi `advance_school_year` nâng khối trực tiếp trên bản ghi lớp:
     * `uid text NOT NULL REFERENCES ltch_accounts(uid) ON DELETE CASCADE`
     * `school_year_id text NOT NULL REFERENCES ltch_school_years(id)`
     * `grade smallint NOT NULL CHECK (grade BETWEEN 6 AND 12)`
     * `class_id text NOT NULL REFERENCES ltch_classes(id)`
     * `recorded_at bigint NOT NULL`
     * `PRIMARY KEY (uid, school_year_id, grade)`
3. **Bảng Đề thi (`ltch_exams` – mở rộng bảng hiện có trong `202611010003_practice.sql`):**
   * `class_id`: Bỏ `NOT NULL` để cho phép `NULL` đối với các đề thuộc kho luyện chung cấp khối/kỳ thi (`exam_type = 'class'` vẫn bắt buộc `class_id IS NOT NULL`).
   * `exam_type text NOT NULL DEFAULT 'class' CHECK (exam_type IN ('class', 'thptqg', 'hsa', 'tsa'))`.
   * `opens_at`, `closes_at`: Bỏ `NOT NULL` đối với đề Phòng Luyện (`exam_type IN ('thptqg', 'hsa', 'tsa')` không dùng `closes_at`); giữ ràng buộc `CHECK (exam_type <> 'class' OR (opens_at IS NOT NULL AND closes_at IS NOT NULL AND closes_at > opens_at))` cho bài kiểm tra trên lớp.
   * `questions jsonb`: Sửa ràng buộc để cho phép `'[]'::jsonb` đối với đề Phòng Luyện (vì câu hỏi Phòng Luyện lưu qua bảng nối `ltch_exam_questions`), chỉ bắt buộc `jsonb_array_length(questions) BETWEEN 1 AND 300` khi `exam_type = 'class'`.
   * Một bộ đề HSA / TSA dùng chung cho cả 2 chế độ (học sinh chọn `practice_mode` là `'full'` hay `'section'` ngay lúc bắt đầu lượt làm bài trong `ltch_practice_attempts`).
   * `duration_minutes integer NOT NULL DEFAULT 90`: Thời lượng chuẩn của đề (hoặc tổng thời lượng cả đề).
   * `sections jsonb`: Cấu hình các phần của bộ đề (thời lượng, số câu từng phần: Phần 1, Phần 2, Phần 3 gồm 5 môn Khoa học 17 câu/môn + Tiếng Anh 50 câu).
   * `target_grade smallint CHECK (target_grade IS NULL OR (target_grade BETWEEN 6 AND 12))`.
   * `school_year_id text REFERENCES ltch_school_years(id)`: Niên khóa gốc của đề (bắt buộc với `thptqg`).
   * `is_cumulative boolean NOT NULL DEFAULT false`: Đánh dấu kho tích lũy liên tục (`tsa`, `hsa`).
4. **Bảng Chia sẻ Đề THPTQG Năm cũ sang Khóa mới (`ltch_exam_year_shares` – mới):**
   * Cho phép bật/tắt đề THPTQG của năm học cũ cho từng khóa/năm học mới một cách độc lập mà không ảnh hưởng đến *"Kho đã học"* của khóa cũ:
     * `exam_id text NOT NULL REFERENCES ltch_exams(id) ON DELETE CASCADE`
     * `school_year_id text NOT NULL REFERENCES ltch_school_years(id)`
     * `target_grade smallint NOT NULL CHECK (target_grade BETWEEN 10 AND 12)`
     * `enabled_by text NOT NULL REFERENCES ltch_accounts(uid)`
     * `enabled_at bigint NOT NULL`
     * `PRIMARY KEY (exam_id, school_year_id, target_grade)`
5. **Bảng Ngữ liệu Đọc hiểu / Dữ liệu Chùm câu (`ltch_passages` – mới):**
   * Dùng chung một bản ghi ngữ liệu cho toàn bộ các câu hỏi con thuộc cùng một chùm (`cluster_id`), tránh lặp dữ liệu và tránh lệch văn bản khi sửa đoạn đọc hiểu:
     * `id text PRIMARY KEY`
     * `version integer NOT NULL DEFAULT 1 CHECK (version >= 1)`
     * `content text NOT NULL CHECK (length(content) BETWEEN 1 AND 50000)` (văn bản + LaTeX + hình minh họa)
     * `created_by text NOT NULL REFERENCES ltch_accounts(uid)`, `updated_at bigint NOT NULL`
     * Kèm bảng lịch sử phiên bản ngữ liệu `ltch_passage_versions (passage_id, version, content, created_by, created_at, PRIMARY KEY (passage_id, version))`.
6. **Bảng Ngân hàng Câu hỏi (`ltch_question_bank` – mở rộng bảng hiện có trong `202611010006_question_bank.sql`):**
   * `class_id`: Bỏ `NOT NULL` để chứa câu hỏi thuộc kho chung HSA / TSA / THPTQG (`class_id IS NULL`).
   * `question_code text UNIQUE NOT NULL`: Mã định danh bất biến do máy chủ cấp tự động qua Sequence PostgreSQL `CREATE SEQUENCE ltch_question_code_seq START 1001` (`'#LTCH-' || nextval('ltch_question_code_seq')`) — chống trùng mã tuyệt đối khi nhiều người tải đề cùng lúc; migration tự cấp mã bổ sung cho các câu hỏi cũ đã có trong bảng.
   * `version integer NOT NULL DEFAULT 1 CHECK (version >= 1)`: Phiên bản hiện hành của câu hỏi.
   * `passage_id text REFERENCES ltch_passages(id)`: Liên kết tới đoạn văn/ngữ liệu chung nếu thuộc câu hỏi chùm.
   * `exam_type`, `target_grade`, `school_year_id`, `hidden_reason`, `duplicate_of_code`.
   * Ràng buộc `status IN ('active', 'archived', 'hidden')` (không bao giờ xóa cứng).
7. **Bảng Liên kết Đề thi – Câu hỏi (`ltch_exam_questions` – mới):**
   * Liên kết trực tiếp đề thi với ngân hàng câu hỏi:
     * `exam_id text NOT NULL REFERENCES ltch_exams(id) ON DELETE CASCADE`
     * `section_code text NOT NULL` (`'part_1'`, `'part_2'`, `'part_3'`)
     * `subject_code text NOT NULL DEFAULT ''` (rỗng `''` với phần chung; hoặc `'physics'`, `'chemistry'`, `'biology'`, `'history'`, `'geography'` — 17 câu/môn, `'english'` — 50 câu đối với Phần 3 HSA)
     * `question_order integer NOT NULL CHECK (question_order >= 1)`
     * `question_code text NOT NULL REFERENCES ltch_question_bank(question_code)`
     * `cluster_id text` (gom các câu thuộc cùng 1 chùm đọc hiểu/ngữ liệu; câu đơn có `cluster_id IS NULL`)
     * `PRIMARY KEY (exam_id, section_code, subject_code, question_order)` *(khóa chính phẳng chuẩn PostgreSQL, không dùng hàm biểu thức)*.
8. **Bảng Lịch sử Phiên bản Câu hỏi (`ltch_question_versions` – mới):**
   * Lưu bất biến mỗi phiên bản `(question_code, version)` với trọn vẹn snapshot `question jsonb NOT NULL` chuẩn hóa (bao gồm đầy đủ `type`, `prompt`, `options` hoặc `statements`, `answer` / `answers` / `accepted`, `points`, `weights`, `solution`), cùng `passage_id`, `passage_version`, `edit_reason`, `created_by`, `created_at`, `PRIMARY KEY (question_code, version)`.
   * Đảm bảo các bài làm cũ của học sinh luôn hiển thị và chấm theo đúng 100% cấu trúc phiên bản câu hỏi (kể cả bảng Đúng/Sai, `weights`, điền số và đoạn văn đọc hiểu) lúc làm bài.
9. **Bảng Lượt làm bài (`ltch_practice_attempts` – mở rộng bảng hiện có trong `202611010003_practice.sql`):**
   * Giữ đúng tên bảng thật `ltch_practice_attempts` và cột định danh người làm `uid`:
     * Cho phép `submitted_at`, `score`, `max_score`, `results` mang giá trị `NULL` khi `status = 'in_progress'`, kèm ràng buộc `CHECK (status = 'in_progress' OR (submitted_at IS NOT NULL AND score IS NOT NULL AND max_score > 0 AND results IS NOT NULL))`.
     * `status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted'))`.
     * `is_preview boolean NOT NULL DEFAULT false`: Đánh dấu lượt làm thử/xem trước của Admin, Giáo viên, Trợ giảng (tách khỏi dữ liệu điểm của học sinh).
     * `practice_mode text NOT NULL DEFAULT 'full' CHECK (practice_mode IN ('full', 'section'))`.
     * `selected_section text CHECK (selected_section IS NULL OR selected_section IN ('part_1', 'part_2', 'part_3'))`.
     * `selected_combination text`: Mã tổ hợp Phần 3 HSA (`'Q01'`..`'Q10'` hoặc `'Q21'`/`'english'`).
     * `started_at bigint NOT NULL`: Thời điểm máy chủ khởi tạo lượt làm.
     * `deadline_at bigint NOT NULL`: Hạn nộp bài (1 chặng: giờ bắt đầu chạy đồng hồ + thời lượng; *Thi cả đề*: mốc chặn trên an toàn, hạn thực tế của từng phần nằm trong `section_states`).
     * `attempt_questions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(attempt_questions) = 'array')`: **Mảng JSON có thứ tự** lưu danh sách câu hỏi đã tráo và phiên bản từng câu (`{ slot, section, subject, clusterId, passageId, passageVersion, questionCode, version }`), bảo toàn tuyệt đối thứ tự câu khi làm bài, chấm điểm và xem kết quả.
     * `responses jsonb NOT NULL DEFAULT '{}'::jsonb`: Lưu đáp án nháp định kỳ khi đang làm (`in_progress`) và chốt đáp án chính thức khi nộp (`submitted`).
     * `draft_meta jsonb NOT NULL DEFAULT '{}'::jsonb`: Lưu danh sách câu đánh dấu (`flagged`), vị trí câu đang mở (`currentQuestion`), mốc cập nhật nháp (`draftUpdatedAt`) và nhật ký chấm lại (`regradeHistory` nếu có).
     * `active_device_token text`: Mã phiên thiết bị đang làm bài hiện hành (kiểm tra bắt buộc trên cả `/draft`, `/section`, `/submit`).
     * `current_section integer DEFAULT 1` và `section_states jsonb`: Lưu trạng thái từng phần (`waiting` / `in_progress` / `locked`), `waitStartedAt`, `waitEndsAt` (120s), `sectionStartedAt`, `sectionDeadlineAt`.
     * **Ràng buộc chống mở 2 chế độ cùng lúc trên 1 đề:** Tạo partial unique index `CREATE UNIQUE INDEX ltch_practice_attempts_one_in_progress_idx ON ltch_practice_attempts (exam_id, uid) WHERE status = 'in_progress' AND is_preview = false`.
10. **Bảng Báo lỗi Câu hỏi (`ltch_question_reports` – mới):**
    * Lưu báo lỗi từ phòng thi gồm: `id`, `question_code`, `question_version`, `attempt_id REFERENCES ltch_practice_attempts(id)`, `exam_id`, `category`, `description` (5–2000 ký tự), `status` (`new`, `in_progress`, `fixed`, `hidden`, `rejected`), `reported_by`, `resolved_by`, `resolution_note`, `created_at`, `resolved_at`, kèm ràng buộc `UNIQUE (attempt_id, question_code)`.

### 9.2. Quy chuẩn API Backend, Phân trang, Xử lý Lỗi & Bộ chấm (`practice-engine.js`)
* **Bộ chấm `public/practice-engine.js`:**
  * Hỗ trợ đầy đủ cả 3 cơ chế chấm chuẩn thông qua `points` và `weights`, kèm chuẩn hóa làm tròn `Math.round(val * 10000) / 10000` chống sai số dấu phẩy động IEEE-754:
    1. **THPTQG (Thang 10,0đ chuẩn Bộ GD&ĐT):** Câu Phần I `points: 0.25`; câu Đúng/Sai Phần II `points: 1.0, weights: [0, 0.1, 0.25, 0.5, 1]`; câu Điền số Phần III `points: 0.5`.
    2. **HSA (Thang 50đ/phần, 150đ/toàn bài chuẩn ĐHQGHN):** Mỗi câu (`single` hoặc `short`) có `points: 1.0`. Ở chế độ *Thi cả đề HSA*, `max_score` luôn cố định bằng **`150`** (kể cả khi nộp sớm toàn bài trước khi chọn tổ hợp Phần 3).
    3. **TSA (Thang 40đ – 20đ – 40đ, tổng 100đ chuẩn Bách Khoa / 9Study):** Hỗ trợ đầy đủ 6 dạng câu hỏi (`single`, `multiple`, `true_false` 1–5 mệnh đề, `short`, `fill_blank` inline 1 hoặc nhiều ô, `drag_drop`), mỗi câu có `points: 1.0`; các câu có nhiều thành phần nhỏ yêu cầu trả lời đúng trọn vẹn 100% các ý trong câu (`correctCount === totalParts`) mới nhận $1,0$ điểm (trả về kèm `correctCount` để đối chiếu chi tiết).
  * Câu trả lời ngắn (`short` & `fill_blank`): chuẩn hóa chuỗi — cắt khoảng trắng thừa, đổi `,` $\rightarrow$ `.`, `−` $\rightarrow$ `-`, và **đối chiếu trực tiếp với mảng `accepted` do người up đề cài đặt**.
* **Chuẩn hóa Mã lỗi HTTP, Phân trang Kho lớn & Giới hạn Payload trên Worker:**
  * **Không nuốt mã lỗi thành `400` chung chung:** `practice-handler.mjs` trả đúng mã trạng thái HTTP kèm `errorCode` tường minh (`409 DEVICE_SUPERSEDED`, `409 ATTEMPT_IN_PROGRESS_OTHER_MODE`, `403 ALUMNI_LOCKED`, `403 FORBIDDEN_GRADE`, ...) để giao diện xử lý chính xác từng tình huống.
  * **Phân trang bằng con trỏ (`cursor pagination`):** Áp dụng cho API Ngân hàng câu hỏi và Danh sách báo lỗi thay cho `.limit(300)` cũ để đáp ứng kho tích lũy HSA/TSA hàng nghìn câu qua nhiều năm.
  * **Giới hạn kích thước Request Body hợp lý:** Giữ giới hạn chặt **`64KB`** cho request lưu nháp/nộp bài của học sinh; mở giới hạn tối đa **`2MB`** cho API tải lên/cập nhật trọn bộ đề 235 câu kèm lời giải LaTeX của Admin / Giáo viên / Trợ giảng.
* **API `GET /api/practice/rooms`:**
  * Tính toán động `activeGrades` từ các lớp `archived = false` của học sinh và đọc `ltch_student_grade_history` để mở chính xác **"Kho đã học"**.
  * Xác định `isAlumni` (`isGraduated`): `activeGrades.length === 0` **VÀ** học sinh thuộc ít nhất 1 lớp Khối 12 đã vào Kho lưu trữ (`archived = true` và `grade = 12`) $\rightarrow$ khóa toàn bộ phòng luyện (phân biệt rõ với học sinh mới chờ xếp lớp).
  * Suy diễn động `currentSchoolYear` và `examYear` từ niên khóa của lớp đang hoạt động (`archived = false`).
  * Trả về quyền truy cập từng phòng (`access: { thptqg, hsa, tsa }`), danh sách đề khả dụng (bao gồm đề năm cũ được bật trong `ltch_exam_year_shares`) và danh sách lịch sử điểm từng lần làm.
* **API `POST /api/exams/:examId/start` (Bước "Bắt đầu làm bài", Xem trước của Staff & Khôi phục phiên):**
  * Hỗ trợ cả lượt làm thật của học sinh (`is_preview = false`, yêu cầu đề đang bật hiển thị) và lượt **Làm thử / Xem trước** của Admin/Giáo viên/Trợ giảng có quyền `canManagePracticePool` (`is_preview = true`, mở được cả đề `draft`).
  * **Idempotent & Tự chốt lượt cũ đã quá hạn trước:** Khóa giao dịch theo `(uid, exam_id)` để chống lỗi bấm đúp chuột; nếu còn lượt `'in_progress'` đã quá hạn (hoặc treo chờ chọn tổ hợp Phần 3 HSA quá 24 giờ), máy chủ gọi `autoFinalizeExpiredAttempt` để chốt và chấm lượt cũ bằng bản nháp gần nhất trước rồi mới tạo lượt mới.
  * **Kiểm tra tối đa 1 lượt `'in_progress'` trên mỗi `examId`:** Từ chối mở chế độ khác khi đang có lượt làm dở còn hạn (`409 ATTEMPT_IN_PROGRESS_OTHER_MODE`).
  * Sinh mảng thứ tự câu đã tráo `attempt_questions`, cấp `active_device_token` mới và trả về `{ attemptId, activeDeviceToken, startedAt, deadlineAt, sectionStates, currentSection, responses, draftMeta, serverNow }`.
* **API `POST /api/exams/:examId/draft` (Đồng bộ bản nháp định kỳ lên máy chủ):**
  * Nhận `{ attemptId, activeDeviceToken, responses, flagged, currentQuestion, draftUpdatedAt }`.
  * Kiểm tra `status = 'in_progress'` (cho phép tiếp tục kể cả khi đề vừa bị tắt hiển thị với lượt mới), kiểm tra khớp `active_device_token` (`409 DEVICE_SUPERSEDED` nếu lệch) và chưa quá hạn của chặng đang làm; **chỉ ghi nhận đáp án của các câu thuộc phần đang mở (`current_section`)**, bỏ qua mọi câu thuộc phần đã khóa hoặc chưa mở.
* **API `POST /api/exams/:examId/section` (Bắt đầu phần thi & Chuyển chặng trong chế độ Thi Cả Đề):**
  * Nhận `{ attemptId, activeDeviceToken, action: 'start_section' | 'submit_section', responses, selectedCombination }`, kiểm tra bắt buộc `active_device_token`:
    * Khi `action = 'start_section'`: Kích hoạt phần thi đang ở màn hình chờ (`current_section`), nếu là Phần 3 HSA thì lưu `selectedCombination`, cắt 51 → 50 câu đơn và tráo câu trong từng môn nối vào `attempt_questions`, ghi `sectionStartedAt` & `sectionDeadlineAt`, rồi **trả về danh sách câu hỏi của riêng phần `current_section` vừa mở**.
    * Khi `action = 'submit_section'`: Lưu và khóa vĩnh viễn đáp án của phần `current_section` hiện tại, chuyển `current_section` sang phần kế tiếp ($k \rightarrow k+1$) ở trạng thái màn hình chờ 120 giây (`waiting`). Nếu đang ở phần cuối cùng ($k = 3$), chuyển thẳng toàn bài sang `'submitted'` và trả kết quả.
* **API `GET /api/exams/:examId`:**
  * Chỉ trả về thông tin cấu trúc đề (`sections`, `durationMinutes`), phiên đang làm dở (nếu có) và `serverTime`.
  * **Không tải trước câu hỏi của Phần 2, Phần 3 khi đang làm Phần 1:** Chỉ trả về câu hỏi (theo đúng thứ tự mảng `attempt_questions` và phiên bản lưu trong lượt làm) của phần đang mở sau khi phần đó đã bắt đầu tính giờ (`section_states[k].status === 'in_progress'`); giữ kín hoàn toàn đáp án và lời giải ở máy chủ.
* **API `POST /api/exams/:examId/submit` & `GET /api/exams/:examId/attempts/:attemptId` (Idempotent & Công bố kết quả tức thì):**
  * **Idempotent khi nộp bài:** Nếu `attemptId` đã ở trạng thái `'submitted'`, trả về luôn kết quả đã chấm (`200 OK`) thay vì báo lỗi. Nếu đang `'in_progress'`, kiểm tra bắt buộc `active_device_token` (cho phép nộp kể cả khi đề vừa bị tắt hiển thị cho lượt mới, và hỗ trợ nộp sớm toàn bài ở *Thi cả đề*).
  * Trong khoảng ân hạn mạng ($\text{serverNow} \le \text{hạn chặng} + \text{GRACE\_PERIOD\_MS}$, 5–10 giây): nhận gói `responses` của phần đang mở, chấm toàn bài theo đúng mảng `attempt_questions` và chuyển `status = 'submitted'`.
  * Quá khoảng ân hạn: máy chủ tự động chốt và chấm điểm bằng **bản nháp (`responses`) đã đồng bộ gần nhất trên máy chủ**.
  * Ngay khi `status = 'submitted'`, API lập tức trả về đầy đủ `score`, `max`, `results` (theo đúng thứ tự câu của lượt làm) và `solutions` (lời giải chi tiết của đúng phiên bản câu lúc làm bài) mà không chờ `results_at` hay `solutions_at`.
* **API `POST /api/practice/report-error` & API Quản trị Sửa câu / Báo lỗi (`GET / POST /api/admin/practice/reports`):**
  * Học sinh gửi báo lỗi ở cả trạng thái `'in_progress'` và `'submitted'` (tối đa 1 lần/câu/lượt làm).
  * Khi Admin / Giáo viên / Trợ giảng sửa câu bị lỗi `wrong_answer`, hỗ trợ cờ tùy chọn `regradeAffectedAttempts: true` để tính lại điểm câu đó một cách công bằng cho các bài đã nộp chứa phiên bản lỗi đáp án, đồng thời lưu vết kiểm toán đầy đủ.
