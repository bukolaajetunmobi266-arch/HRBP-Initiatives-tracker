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

-- Keep the same rule at the database layer so spreadsheet and UI entry cannot diverge.
create or replace function enforce_candidate_type()
returns trigger as $$
declare
  role_type_value text;
begin
  select r.role_type
    into role_type_value
  from role_locations rl
  join roles r on r.role_id = rl.role_id
  where rl.role_location_id = new.role_location_id;

  if role_type_value in ('Sales Associate', 'Sales Affiliate') then
    new.candidate_type := role_type_value;
  elsif tg_op = 'INSERT'
     or new.candidate_type is distinct from old.candidate_type
     or new.role_location_id is distinct from old.role_location_id then
    if nullif(trim(new.candidate_type), '') is null then
      raise exception 'Candidate Type is required for this role.';
    end if;
  end if;

  return new;
end $$ language plpgsql;

drop trigger if exists trg_enforce_candidate_type on candidates;
create trigger trg_enforce_candidate_type
before insert or update on candidates
for each row execute function enforce_candidate_type();
