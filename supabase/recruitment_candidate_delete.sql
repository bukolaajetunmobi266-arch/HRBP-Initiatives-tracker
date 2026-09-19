-- Allow recruitment admins to permanently delete candidates.
-- The UI exposes deletion only to these roles; this policy also enforces it in Supabase.

alter table candidates enable row level security;

drop policy if exists "Recruitment admins can delete candidates" on candidates;

create policy "Recruitment admins can delete candidates"
on candidates
for delete
to authenticated
using (
  exists (
    select 1
    from profiles
    where profiles.id = auth.uid()
      and profiles.recruitment_role in ('admin', 'recruitment_admin')
  )
);
