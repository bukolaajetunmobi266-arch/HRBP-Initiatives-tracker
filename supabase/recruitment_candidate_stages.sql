-- Keep the database constraint aligned with the recruitment tracker and legacy upload template.
alter table public.candidates drop constraint if exists candidates_status_check;
alter table public.candidates add constraint candidates_status_check check (
  status = any (array['Sourcing','Screening','Interview','Assessment','Onboarding Approval','Documentation','Offer','Awaiting Resumption','Closed','Dropped','Rejected'])
);
