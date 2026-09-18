-- Recruitment candidate type migration
-- Run this in the Supabase SQL editor before using the Candidate Type field.
-- Role Type belongs to the role; Candidate Type belongs to the candidate.

alter table candidates
  add column if not exists candidate_type text;

-- Preserve the agreed inheritance rule for existing candidates on fixed-type roles.
update candidates c
set candidate_type = r.role_type
from role_locations rl
join roles r on r.role_id = rl.role_id
where c.role_location_id = rl.role_location_id
  and c.candidate_type is null
  and r.role_type in ('Sales Associate', 'Sales Affiliate');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'candidates_candidate_type_check'
      and conrelid = 'candidates'::regclass
  ) then
    alter table candidates
      add constraint candidates_candidate_type_check
      check (candidate_type is null or candidate_type in ('Sales Associate', 'Sales Affiliate'));
  end if;
end $$;
