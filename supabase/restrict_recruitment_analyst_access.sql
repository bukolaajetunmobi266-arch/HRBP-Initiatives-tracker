-- Recruitment analysts must not have access to the HRBP Deliverables workspace.
-- The UI is also restricted, but this database-level restrictive policy prevents
-- direct Data API access to deliverables even if another permissive policy exists.

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'deliverables',
    'comments',
    'sub_deliverables',
    'key_actions',
    'action_item_statuses',
    'deliverable_status_history',
    'strategy_nodes'
  ]
  loop
    execute format('drop policy if exists "block recruitment analysts" on public.%I', tbl);
    execute format(
      'create policy "block recruitment analysts" on public.%I as restrictive for all to authenticated using (coalesce((select p.recruitment_role from public.profiles p where p.id = (select auth.uid())), '''') <> ''analyst'') with check (coalesce((select p.recruitment_role from public.profiles p where p.id = (select auth.uid())), '''') <> ''analyst'')',
      tbl
    );
  end loop;
end $$;
