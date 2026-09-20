-- Compatibility fix for the shared action-item notification trigger.
-- The live notifications table must support both deliverable and action-item
-- notifications. Safe to run once; existing notification data is preserved.

alter table public.notifications
  add column if not exists user_id uuid references public.profiles(id);

alter table public.notifications
  add column if not exists action_id uuid references public.key_actions(id) on delete cascade;

create index if not exists notifications_user_id_idx
  on public.notifications(user_id);

create index if not exists notifications_action_id_idx
  on public.notifications(action_id);
