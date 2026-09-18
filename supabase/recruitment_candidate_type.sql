-- Recruitment employment type migration
-- Role Type, Role Title, and Employment Type are independent fields.
-- Employment Type is not derived from or restricted by Role or Role Type.

alter table candidates
  add column if not exists employment_type text;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'candidates' and column_name = 'candidate_type'
  ) then
    update candidates
      set employment_type = candidate_type
      where employment_type is null and candidate_type is not null;
    alter table candidates drop column candidate_type;
  end if;
end $$;

alter table candidates drop constraint if exists candidates_candidate_type_check;
alter table candidates drop constraint if exists candidates_employment_type_check;

alter table candidates
  add constraint candidates_employment_type_check
  check (employment_type is null or employment_type in ('Full-Time', 'Contract', 'Affiliate', 'Intern'));

drop trigger if exists trg_enforce_candidate_type on candidates;
drop function if exists enforce_candidate_type();

-- No trigger intentionally: any Role + Role Type + Employment Type combination is valid.
