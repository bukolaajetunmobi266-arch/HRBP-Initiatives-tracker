-- Additive only — adds the missing INSERT/UPDATE policies on notifications.
-- Does NOT touch any existing table or data. Safe to run once.

create policy notifications_insert on public.notifications for insert
  with check (
    public.current_user_role() in ('admin','recruitment_admin')
    or division_id in (select division_id from public.divisions where hrbp_id = public.current_user_hrbp_id())
  );

create policy notifications_update on public.notifications for update
  using (
    public.current_user_role() in ('admin','recruitment_admin')
    or division_id in (select division_id from public.divisions where hrbp_id = public.current_user_hrbp_id())
  );
