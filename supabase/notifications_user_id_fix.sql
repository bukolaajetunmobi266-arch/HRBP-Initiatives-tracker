-- Fix for the shared action-item notification trigger.
-- The live notifications table is missing user_id, while the trigger
-- notify_on_shared_action_assignment() writes to notifications.user_id.
-- Safe to run once; does not remove or alter existing notification data.

alter table public.notifications
  add column if not exists user_id uuid references public.profiles(id);

create index if not exists notifications_user_id_idx
  on public.notifications(user_id);
