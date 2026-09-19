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

export async function deleteCandidates(candidateIds) {
  const ids = [...new Set(candidateIds || [])].filter(Boolean);
  if (!ids.length) return [];

  const { data, error } = await supabase
    .from('candidates')
    .delete()
    .in('candidate_id', ids)
    .select('candidate_id');

  if (error) throw friendlyError(error);
  return data || [];
}

export async function deleteCandidate(candidateId) {
  return deleteCandidates([candidateId]);
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

// Full profile update — every editable field on a candidate, used by the
// Candidate Profile panel. Only the fields actually passed in `fields` are
// written; callers send the whole form state each save.
export async function updateCandidate(candidateId, fields) {
  const { data: { user } } = await supabase.auth.getUser();
  const payload = { ...fields, updated_by: user?.id };
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

export async function updateRole({ roleId, roleTitle, roleType, suggestedGrade }) {
  const { data, error } = await supabase
    .from('roles')
    .update({ role_title: roleTitle, role_type: roleType, suggested_grade: suggestedGrade || null })
    .eq('role_id', roleId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateRoleLocation({ roleLocationId, location, noOfPositions, status, plannedStartDate, dateRequestReceived, dateLocationClosed }) {
  const { data, error } = await supabase
    .from('role_locations')
    .update({
      location, no_of_positions: noOfPositions, status,
      planned_start_date: plannedStartDate || null,
      date_request_received: dateRequestReceived || null,
      date_location_closed: dateLocationClosed || null,
    })
    .eq('role_location_id', roleLocationId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Add a new candidate against a role_location
export async function addCandidate({ roleLocationId, candidateName, employmentType, contactPhone, source, status = 'Sourcing' }) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('candidates')
    .insert({
      role_location_id: roleLocationId,
      candidate_name: candidateName,
      employment_type: employmentType || null,
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

// ---------------------------------------------------------------
// Stalled Onboarding notifications — computed client-side (see
// computeStalledOnboarding), written here so they persist and can be
// marked read. One row per candidate per threshold crossed — a second,
// distinct 'stalled_onboarding_escalation' row is written once a
// candidate passes 28 days, without touching the first 14-day row.
// ---------------------------------------------------------------
export async function syncStalledNotifications(stalledList) {
  for (const s of stalledList) {
    const type = s.isEscalated ? 'stalled_onboarding_escalation' : 'stalled_onboarding';
    const { data: existing, error: checkErr } = await supabase
      .from('notifications')
      .select('notification_id')
      .eq('candidate_id', s.candidateId)
      .eq('type', type)
      .maybeSingle();
    if (checkErr) continue; // don't let a notification glitch break the page
    if (existing) continue; // already recorded, don't spam duplicates

    const message = s.isEscalated
      ? `${s.candidateName} has been stalled in onboarding for ${s.daysStalled} days (${s.roleTitle}, ${s.location}) — still no offer acceptance recorded.`
      : `${s.candidateName} has been stalled in onboarding for ${s.daysStalled} days (${s.roleTitle}, ${s.location}).`;

    await supabase.from('notifications').insert({
      type, candidate_id: s.candidateId, role_location_id: s.roleLocationId,
      division_id: s.divisionId, message,
    });
  }
}

export async function markNotificationRead(notificationId, userId) {
  const { data: row, error: fetchErr } = await supabase
    .from('notifications').select('read_by').eq('notification_id', notificationId).single();
  if (fetchErr) throw fetchErr;
  const readBy = row.read_by || [];
  if (readBy.includes(userId)) return;
  const { error } = await supabase
    .from('notifications').update({ read_by: [...readBy, userId] }).eq('notification_id', notificationId);
  if (error) throw error;
}

export async function checkCandidateDuplicate(name, phone, excludeCandidateId) {
  const { data, error } = await supabase.rpc('check_candidate_duplicate', {
    p_name: name || null, p_phone: phone || null, p_exclude_candidate_id: excludeCandidateId || null,
  });
  if (error) throw error;
  return data?.[0] || { found: false };
}

