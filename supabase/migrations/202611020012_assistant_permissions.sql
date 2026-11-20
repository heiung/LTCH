begin;
-- A grant is still explicit and scoped to one class. This only synchronizes
-- the allowed action names with the application; no membership is granted.
alter table public.ltch_class_memberships drop constraint ltch_class_memberships_permissions_check;
alter table public.ltch_class_memberships add constraint ltch_class_memberships_permissions_check
 check (permissions <@ array['attendance.write','materials.write','assignments.write','practice.manage','notices.write','messages.write','schedule.manage']::text[]);
commit;
