-- Allow candidate deletion to remove that candidate's status history as well.
-- Status history belongs to the candidate, so it should not block a permanent candidate delete.

alter table candidate_status_history
  drop constraint if exists candidate_status_history_candidate_id_fkey;

alter table candidate_status_history
  add constraint candidate_status_history_candidate_id_fkey
  foreign key (candidate_id)
  references candidates(candidate_id)
  on delete cascade;
