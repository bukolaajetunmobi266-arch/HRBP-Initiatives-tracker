// recruitmentData.js
// Data-fetching + metric-calculation layer for the Recruitment module.
// Depends on a `supabase` client already configured elsewhere in the app
// (same client the Deliverables Tracker uses).

import { supabase } from './supabaseClient'; // adjust path to match existing app

// ---------------------------------------------------------------
// Working-day math (weekends excluded only, per confirmed design)
// ---------------------------------------------------------------
export function workingDaysBetween(startDateStr, endDateStr) {
  if (!startDateStr || !endDateStr) return null;
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  if (end < start) return null;
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const day = cur.getDay(); // 0 = Sun, 6 = Sat
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// Stalled Onboarding: calendar days (not working days), threshold 14 / escalation 28
export function calendarDaysSince(dateStr) {
  if (!dateStr) return null;
  const then = new Date(dateStr);
  const now = new Date();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------
// Current user's recruitment role + scope
// ---------------------------------------------------------------
export async function getCurrentUserScope() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, recruitment_role, recruitment_hrbp_id, full_name')
    .eq('id', user.id)
    .single();

  if (error) throw error;
  return profile; // { id, recruitment_role, recruitment_hrbp_id, name }
}

// ---------------------------------------------------------------
// Fetch divisions visible to the current user (RLS already scopes this,
// this just wraps the query)
// ---------------------------------------------------------------
export async function fetchDivisions() {
  const { data, error } = await supabase.from('divisions').select('division_id, name, hrbp_id');
  if (error) throw error;
  return data;
}

export async function fetchRolesByDivision(divisionId) {
  let query = supabase.from('roles').select('role_id, role_title, role_type, division_id').is('deleted_at', null);
  if (divisionId) query = query.eq('division_id', divisionId);
  const { data, error } = await query.order('role_title');
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------
// Fetch roles + role_locations + candidate counts, with optional filters
// ---------------------------------------------------------------
export async function fetchRoleLocationsWithCandidates(filters = {}) {
  // filters: { divisionId, roleId, location, year, employmentType }
  // Division/Role/Location are applied client-side below, not as server
  // query filters — filtering through a nested embedded resource
  // (roles.division_id) proved unreliable, and divisionId in particular
  // was never being applied to the query at all. Fetching everything RLS
  // already scopes the user to, then filtering in plain JS, is simpler
  // and something we can actually verify is correct.
  const query = supabase
    .from('role_locations')
    .select(`
      role_location_id, location, no_of_positions, status, planned_start_date,
      date_request_received, date_location_closed,
      roles!inner ( role_id, role_title, role_type, suggested_grade, division_id,
        divisions!inner ( division_id, name, hrbp_id ) )
    `)
    .is('deleted_at', null)
    .is('roles.deleted_at', null);

  const { data: allRoleLocations, error } = await query;
  if (error) throw error;

  const roleLocations = allRoleLocations.filter(rl => {
    if (filters.divisionId && rl.roles.division_id !== filters.divisionId) return false;
    if (filters.roleId && rl.roles.role_id !== filters.roleId) return false;
    if (filters.location && rl.location !== filters.location) return false;
    return true;
  });

  const rlIds = roleLocations.map(rl => rl.role_location_id);
  if (rlIds.length === 0) return [];

  let candQuery = supabase
    .from('candidates')
    .select('*')
    .in('role_location_id', rlIds)
    .is('deleted_at', null);

  if (filters.year) {
    candQuery = candQuery
      .gte('created_at', `${filters.year}-01-01`)
      .lt('created_at', `${Number(filters.year) + 1}-01-01`);
  }
  if (filters.employmentType) {
    candQuery = candQuery.eq('employment_type', filters.employmentType);
  }

  const { data: candidates, error: candErr } = await candQuery;
  if (candErr) throw candErr;

  return roleLocations.map(rl => ({
    ...rl,
    candidates: candidates.filter(c => c.role_location_id === rl.role_location_id),
  }));
}

// ---------------------------------------------------------------
// Compute dashboard metrics from a set of role_locations (already filtered)
// ---------------------------------------------------------------
const SECURED_STATUSES = ['Offer', 'Awaiting Resumption', 'Closed'];
const FUNNEL_STAGES = [
  'Yet to Start', 'Sourcing', 'Interview', 'Onboarding Approval',
  'Documentation', 'Offer', 'Awaiting Resumption', 'Closed',
];

// Candidate-status funnel stages only (unit = candidates). "Yet to Start" is
// tracked separately in slot units and deliberately excluded from Fill Rate,
// Closure Rate, and the funnel percentage base — see design notes.
const CANDIDATE_FUNNEL_STAGES = FUNNEL_STAGES.filter(s => s !== 'Yet to Start');

export function computeDashboardMetrics(roleLocationsWithCandidates) {
  let totalSlots = 0;
  let securedCount = 0;
  let closedCount = 0;
  let yetToStartSlots = 0;
  const uniqueRoleIds = new Set();
  const funnelCounts = Object.fromEntries(CANDIDATE_FUNNEL_STAGES.map(s => [s, 0]));
  const divisionAgg = {}; // name -> { slots, secured, closed }

  for (const rl of roleLocationsWithCandidates) {
    const divName = rl.roles.divisions.name;
    if (!divisionAgg[divName]) divisionAgg[divName] = { slots: 0, secured: 0, closed: 0 };
    uniqueRoleIds.add(rl.roles.role_id);

    if (rl.status === 'Yet to Start') {
      // Not yet active — excluded from slot totals, Fill Rate, Closure Rate, and the funnel.
      yetToStartSlots += rl.no_of_positions;
      continue;
    }

    totalSlots += rl.no_of_positions;
    divisionAgg[divName].slots += rl.no_of_positions;

    for (const c of rl.candidates) {
      if (funnelCounts[c.status] !== undefined) funnelCounts[c.status]++;
      if (SECURED_STATUSES.includes(c.status)) {
        securedCount++;
        divisionAgg[divName].secured++;
      }
      if (c.status === 'Closed') {
        closedCount++;
        divisionAgg[divName].closed++;
      }
    }
  }


  const closeTimes = roleLocationsWithCandidates
    .map(rl => computeTimeToClose(rl))
    .filter(d => d !== null);
  const avgTimeToClose = closeTimes.length ? Math.round(closeTimes.reduce((a, b) => a + b, 0) / closeTimes.length) : null;

  const onboardTimes = roleLocationsWithCandidates
    .flatMap(rl => rl.candidates)
    .map(c => computeTimeToOnboard(c))
    .filter(d => d !== null);
  const avgTimeToOnboard = onboardTimes.length ? Math.round(onboardTimes.reduce((a, b) => a + b, 0) / onboardTimes.length) : null;

  return {
    totalSlots,
    totalRoles: uniqueRoleIds.size,
    totalRoleLocations: roleLocationsWithCandidates.length,
    yetToStartSlots,
    avgTimeToClose,
    avgTimeToOnboard,
    fillRatePct: totalSlots ? Math.round((securedCount / totalSlots) * 100) : 0,
    closureRatePct: totalSlots ? Math.round((closedCount / totalSlots) * 100) : 0,
    funnelCounts,
    funnelPct: Object.fromEntries(
      CANDIDATE_FUNNEL_STAGES.map(s => [s, totalSlots ? Math.round((funnelCounts[s] / totalSlots) * 100) : 0])
    ),
    byDivision: Object.entries(divisionAgg).map(([name, v]) => ({
      name,
      fillRatePct: v.slots ? Math.round((v.secured / v.slots) * 100) : 0,
      closureRatePct: v.slots ? Math.round((v.closed / v.slots) * 100) : 0,
    })),
  };
}

// ---------------------------------------------------------------
// Stalled Onboarding — 14 calendar days first alert, 28 calendar days escalation
// ---------------------------------------------------------------
export function computeStalledOnboarding(roleLocationsWithCandidates) {
  const results = [];
  for (const rl of roleLocationsWithCandidates) {
    for (const c of rl.candidates) {
      const inWindow = ['Onboarding Approval', 'Documentation', 'Offer'].includes(c.status);
      if (!inWindow || !c.date_sent_for_onboarding_approval || c.date_offer_accepted) continue;
      const days = calendarDaysSince(c.date_sent_for_onboarding_approval);
      if (days >= 14) {
        results.push({
          candidateId: c.candidate_id,
          candidateName: c.candidate_name,
          roleLocationId: rl.role_location_id,
          divisionId: rl.roles.division_id,
          roleTitle: rl.roles.role_title,
          division: rl.roles.divisions.name,
          location: rl.location,
          daysStalled: days,
          isEscalated: days >= 28,
        });
      }
    }
  }
  return results;
}

export async function fetchMyNotifications() {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------
// Time to Close (working days), per role_location
// ---------------------------------------------------------------
export function computeTimeToClose(rl) {
  if (!rl.date_request_received || !rl.date_location_closed) return null;
  return workingDaysBetween(rl.date_request_received, rl.date_location_closed);
}

// ---------------------------------------------------------------
// Time to Onboard (working days): date_offer_accepted - date_sent_for_onboarding_approval
// ---------------------------------------------------------------
export function computeTimeToOnboard(candidate) {
  if (!candidate.date_sent_for_onboarding_approval || !candidate.date_offer_accepted) return null;
  return workingDaysBetween(candidate.date_sent_for_onboarding_approval, candidate.date_offer_accepted);
}
