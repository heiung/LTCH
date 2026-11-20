-- Migration 009: Khởi tạo danh mục Năm học & Lớp học thực tế cho Lớp Toán cô Hạnh (LTCH)
-- Lịch học để trống ('') để Quản trị viên/Cô Hạnh cập nhật sau qua giao diện quản trị.
-- Áp dụng trên cơ sở dữ liệu Supabase PostgreSQL của hệ thống LTCH

begin;

-- 1. Khởi tạo Năm học 2026 - 2027
insert into public.ltch_school_years (id, name, starts_on, ends_on)
values ('year-2026-2027', 'Năm học 2026 - 2027', '2026-09-01', '2027-06-30')
on conflict (id) do update set
  name = excluded.name,
  starts_on = excluded.starts_on,
  ends_on = excluded.ends_on;

-- 2. Khởi tạo danh mục 14 lớp học từ Khối 6 đến Khối 12 (schedule để trống '', mở tuyển sinh)
insert into public.ltch_classes (id, school_year_id, name, schedule, enrollment_open)
values
  ('class-6a', 'year-2026-2027', 'Lớp 6A', '', true),
  ('class-6b', 'year-2026-2027', 'Lớp 6B', '', true),
  ('class-7a', 'year-2026-2027', 'Lớp 7A', '', true),
  ('class-7b', 'year-2026-2027', 'Lớp 7B', '', true),
  ('class-8a', 'year-2026-2027', 'Lớp 8A', '', true),
  ('class-8b', 'year-2026-2027', 'Lớp 8B', '', true),
  ('class-9a', 'year-2026-2027', 'Lớp 9A (Ôn thi vào 10)', '', true),
  ('class-9b', 'year-2026-2027', 'Lớp 9B (Ôn thi vào 10)', '', true),
  ('class-10a1', 'year-2026-2027', 'Lớp 10A1', '', true),
  ('class-10a2', 'year-2026-2027', 'Lớp 10A2', '', true),
  ('class-11a1', 'year-2026-2027', 'Lớp 11A1', '', true),
  ('class-11a2', 'year-2026-2027', 'Lớp 11A2', '', true),
  ('class-12a1', 'year-2026-2027', 'Lớp 12A1 (Luyện thi THPTQG & Chuyên sâu)', '', true),
  ('class-12a2', 'year-2026-2027', 'Lớp 12A2 (Luyện thi THPTQG)', '', true)
on conflict (id) do update set
  school_year_id = excluded.school_year_id,
  name = excluded.name,
  schedule = case when public.ltch_classes.schedule <> '' then public.ltch_classes.schedule else excluded.schedule end,
  enrollment_open = excluded.enrollment_open;

commit;
