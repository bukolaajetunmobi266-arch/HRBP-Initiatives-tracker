-- ============================================================================
-- HRBP Deliverables Tracker — Supabase schema (v2)
-- Run this in Supabase's SQL editor. Safe to run on a fresh project.
-- ============================================================================

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz default now()
);

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, full_name, email, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), new.email, 'member');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- After your first sign-up (you, the admin), run:
--   update profiles set role = 'admin' where email = 'your-email@creditdirect.ng';

-- ---------------------------------------------------------------------------
-- DELIVERABLES — now carries the full objective hierarchy
-- ---------------------------------------------------------------------------
create table if not exists deliverables (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  corporate_objective text,
  pm_objective text,
  key_result text,
  division text,
  owner_id uuid references profiles(id),
  status text not null default 'Not Started' check (status in ('Not Started', 'In Progress', 'Completed')),
  due_date date,
  revised_due_date date,
  revision_reason text,
  date_completed date,
  status_changed_date date default current_date,
  next_steps text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  deliverable_id uuid references deliverables(id) on delete cascade,
  author_id uuid references profiles(id),
  text text not null,
  created_at timestamptz default now()
);

-- Sub-deliverables — lightweight nested items under one deliverable
create table if not exists sub_deliverables (
  id uuid primary key default gen_random_uuid(),
  deliverable_id uuid references deliverables(id) on delete cascade,
  title text not null,
  owner_id uuid references profiles(id),
  status text not null default 'Not Started' check (status in ('Not Started', 'In Progress', 'Completed')),
  created_at timestamptz default now()
);

-- Key Action Log — meeting decisions/actions, separate from the main tracker
create table if not exists key_actions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  raised_in text,
  owner_id uuid references profiles(id),
  due_date date,
  status text not null default 'Not Started' check (status in ('Not Started', 'In Progress', 'Completed')),
  comment text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),
  deliverable_id uuid references deliverables(id) on delete cascade,
  type text not null check (type in ('assigned', 'due_soon', 'overdue', 'revised')),
  message text not null,
  read boolean default false,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
alter table profiles enable row level security;
alter table deliverables enable row level security;
alter table comments enable row level security;
alter table sub_deliverables enable row level security;
alter table key_actions enable row level security;
alter table notifications enable row level security;

create policy "profiles viewable by all logged-in users" on profiles for select using (auth.role() = 'authenticated');

create policy "deliverables viewable by all logged-in users" on deliverables for select using (auth.role() = 'authenticated');
create policy "deliverables insertable by all logged-in users" on deliverables for insert with check (auth.role() = 'authenticated');
create policy "deliverables updatable by all logged-in users" on deliverables for update using (auth.role() = 'authenticated');
create policy "only admins can delete deliverables" on deliverables for delete using (
  exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin')
);

create policy "comments viewable by all logged-in users" on comments for select using (auth.role() = 'authenticated');
create policy "comments insertable by all logged-in users" on comments for insert with check (auth.role() = 'authenticated');

create policy "sub_deliverables viewable by all logged-in users" on sub_deliverables for select using (auth.role() = 'authenticated');
create policy "sub_deliverables insertable by all logged-in users" on sub_deliverables for insert with check (auth.role() = 'authenticated');
create policy "sub_deliverables updatable by all logged-in users" on sub_deliverables for update using (auth.role() = 'authenticated');
create policy "only admins can delete sub_deliverables" on sub_deliverables for delete using (
  exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin')
);

create policy "key_actions viewable by all logged-in users" on key_actions for select using (auth.role() = 'authenticated');
create policy "key_actions insertable by all logged-in users" on key_actions for insert with check (auth.role() = 'authenticated');
create policy "key_actions updatable by all logged-in users" on key_actions for update using (auth.role() = 'authenticated');
create policy "only admins can delete key_actions" on key_actions for delete using (
  exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin')
);

create policy "users see only their own notifications" on notifications for select using (user_id = auth.uid());
create policy "users can mark their own notifications read" on notifications for update using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Due Date lock: only admins can change it. Also keeps status_changed_date
-- and date_completed accurate whenever status changes.
-- ---------------------------------------------------------------------------
create or replace function enforce_due_date_lock()
returns trigger as $$
declare
  requester_role text;
begin
  select role into requester_role from profiles where id = auth.uid();

  if new.due_date is distinct from old.due_date and coalesce(requester_role, 'member') <> 'admin' then
    raise exception 'Only an admin can change the Due Date. Use Revised Due Date instead.';
  end if;

  if new.status is distinct from old.status then
    new.status_changed_date := current_date;
    if new.status = 'Completed' then
      new.date_completed := current_date;
    else
      new.date_completed := null;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_enforce_due_date_lock on deliverables;
create trigger trg_enforce_due_date_lock
  before update on deliverables
  for each row execute function enforce_due_date_lock();

-- ---------------------------------------------------------------------------
-- Notify owner on assignment
-- ---------------------------------------------------------------------------
create or replace function notify_on_assignment()
returns trigger as $$
begin
  if (tg_op = 'INSERT' and new.owner_id is not null)
     or (tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id and new.owner_id is not null) then
    insert into notifications (user_id, deliverable_id, type, message)
    values (new.owner_id, new.id, 'assigned',
      'You''ve been assigned: "' || new.title || '" — due ' || coalesce(new.due_date::text, 'no date set'));
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_notify_on_assignment on deliverables;
create trigger trg_notify_on_assignment
  after insert or update on deliverables
  for each row execute function notify_on_assignment();

-- ---------------------------------------------------------------------------
-- Notify all admins the moment a Revised Due Date is set or changed by
-- anyone other than an admin, so they know to review and update Due Date.
-- ---------------------------------------------------------------------------
create or replace function notify_on_revised_due_date()
returns trigger as $$
declare
  requester_role text;
  requester_name text;
begin
  if new.revised_due_date is distinct from old.revised_due_date and new.revised_due_date is not null then
    select role, full_name into requester_role, requester_name from profiles where id = auth.uid();
    if coalesce(requester_role, 'member') <> 'admin' then
      insert into notifications (user_id, deliverable_id, type, message)
      select p.id, new.id, 'revised',
        '"' || new.title || '": ' || coalesce(requester_name, 'A team member') ||
        ' proposed a revised due date of ' || new.revised_due_date::text ||
        ' — update Due Date to clear the overdue flag.'
      from profiles p where p.role = 'admin';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_notify_on_revised_due_date on deliverables;
create trigger trg_notify_on_revised_due_date
  after update on deliverables
  for each row execute function notify_on_revised_due_date();

-- ---------------------------------------------------------------------------
-- Daily overdue + due-in-3-days check (replaces the two Power Automate flows)
-- ---------------------------------------------------------------------------
create or replace function generate_due_date_notifications()
returns void as $$
begin
  insert into notifications (user_id, deliverable_id, type, message)
  select d.owner_id, d.id, 'overdue',
         '"' || d.title || '" was due ' || d.due_date || ' and is still ' || d.status
  from deliverables d
  where d.due_date < current_date and d.status <> 'Completed' and d.owner_id is not null
    and not exists (select 1 from notifications n where n.deliverable_id = d.id and n.type = 'overdue' and n.created_at::date = current_date);

  insert into notifications (user_id, deliverable_id, type, message)
  select p.id, d.id, 'overdue',
         '"' || d.title || '" (' || coalesce(owner.full_name, 'unassigned') || ') is overdue'
  from deliverables d
  join profiles p on p.role = 'admin'
  left join profiles owner on owner.id = d.owner_id
  where d.due_date < current_date and d.status <> 'Completed'
    and not exists (select 1 from notifications n where n.deliverable_id = d.id and n.user_id = p.id and n.type = 'overdue' and n.created_at::date = current_date);

  insert into notifications (user_id, deliverable_id, type, message)
  select d.owner_id, d.id, 'due_soon',
         '"' || d.title || '" is due in 3 days (' || d.due_date || ')'
  from deliverables d
  where d.due_date = current_date + interval '3 days' and d.status <> 'Completed' and d.owner_id is not null
    and not exists (select 1 from notifications n where n.deliverable_id = d.id and n.type = 'due_soon' and n.created_at::date = current_date);

  insert into notifications (user_id, deliverable_id, type, message)
  select p.id, d.id, 'due_soon',
         '"' || d.title || '" (' || coalesce(owner.full_name, 'unassigned') || ') is due in 3 days'
  from deliverables d
  join profiles p on p.role = 'admin'
  left join profiles owner on owner.id = d.owner_id
  where d.due_date = current_date + interval '3 days' and d.status <> 'Completed'
    and not exists (select 1 from notifications n where n.deliverable_id = d.id and n.user_id = p.id and n.type = 'due_soon' and n.created_at::date = current_date);
end;
$$ language plpgsql security definer;

create extension if not exists pg_cron;

select cron.schedule(
  'daily-deliverable-checks',
  '0 8,16 * * *',  -- 08:00 and 16:00 UTC = 9am and 5pm WAT (Lagos, UTC+1)
  $$ select generate_due_date_notifications(); $$
);

-- ============================================================================
-- Done. Next: sign up in the app, then run:
--   update profiles set role = 'admin' where email = 'YOUR_EMAIL';
-- ============================================================================
