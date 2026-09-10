// recruitmentActions.js
// Write operations. Slot-cap enforcement happens in the database trigger
// (trg_enforce_slot_cap) — this layer just surfaces that error cleanly.

import { supabase } from './supabaseClient';

function friendlyError(error) {
  // Postgres raises our slot-cap message as a plain exception; surface it as-is.
  if (error?.message?.includes('slots are already committed')) {
    return new Error(error.message.replace(/^.*?ERROR:\s*/, ''));
  }
  return error;
}

export async function updateCandidateStatus(candidateId, newStatus, extraFields = {}) {
  const { data: { user } } = await supabase.auth.getUser();
  const payload = { status: newStatus, updated_by: user?.id, ...extraFields };
  const { data, error } = await supabase
    .from('candidates')
    .update(payload)
    .eq('candidate_id', candidateId)
    .select()
    .single();
  if (error) throw friendlyError(error);
  return data;
}

// Bulk update — same status applied to multiple candidates at once.
export async function bulkUpdateCandidateStatus(candidateIds, newStatus, extraFields = {}) {
  const { data: { user } } = await supabase.auth.getUser();
  const payload = { status: newStatus, updated_by: user?.id, ...extraFields };
  const { data, error } = await supabase
    .from('candidates')
    .update(payload)
    .in('candidate_id', candidateIds)
    .select();
  if (error) throw friendlyError(error);
  return data;
}

// Move a candidate to a different role_location (reuse / reassignment).
// Keeps history via previous_role_location_id; resets to Interview by default
// since they're being reconsidered for a different slot.
export async function moveCandidate(candidateId, newRoleLocationId, movedReason, resetToStatus = 'Interview') {
  const { data: current, error: fetchErr } = await supabase
    .from('candidates')
    .select('role_location_id')
    .eq('candidate_id', candidateId)
    .single();
  if (fetchErr) throw fetchErr;

  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('candidates')
    .update({
      role_location_id: newRoleLocationId,
      previous_role_location_id: current.role_location_id,
      moved_reason: movedReason,
      status: resetToStatus,
      updated_by: user?.id,
    })
    .eq('candidate_id', candidateId)
    .select()
    .single();
  if (error) throw friendlyError(error);
  return data;
}

// Soft delete a role_location (Admin / Recruitment Admin only — RLS enforces this)
export async function softDeleteRoleLocation(roleLocationId) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('role_locations')
    .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id })
    .eq('role_location_id', roleLocationId);
  if (error) throw error;
}

export async function restoreRoleLocation(roleLocationId) {
  const { error } = await supabase
    .from('role_locations')
    .update({ deleted_at: null, deleted_by: null })
    .eq('role_location_id', roleLocationId);
  if (error) throw error;
}

// Create a new role_location under an existing role (analysts/HRBPs allowed, per RLS)
export async function createRoleLocation({ roleId, location, noOfPositions, status = 'Yet to Start', plannedStartDate, dateRequestReceived }) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('role_locations')
    .insert({
      role_id: roleId,
      location,
      no_of_positions: noOfPositions,
      status,
      planned_start_date: plannedStartDate || null,
      date_request_received: dateRequestReceived || null,
      created_by: user?.id,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Create a new role under a division (analysts/HRBPs allowed, per RLS)
export async function createRole({ divisionId, roleTitle, roleType, suggestedGrade }) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('roles')
    .insert({
      division_id: divisionId,
      role_title: roleTitle,
      role_type: roleType,
      suggested_grade: suggestedGrade || null,
      created_by: user?.id,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Add a new candidate against a role_location
export async function addCandidate({ roleLocationId, candidateName, contactPhone, source, status = 'Sourcing' }) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('candidates')
    .insert({
      role_location_id: roleLocationId,
      candidate_name: candidateName,
      contact_phone: contactPhone || null,
      source: source || null,
      status,
      created_by: user?.id,
      updated_by: user?.id,
    })
    .select()
    .single();
  if (error) throw friendlyError(error);
  return data;
}
