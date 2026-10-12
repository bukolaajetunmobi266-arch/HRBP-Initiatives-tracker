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

export async function fetchRecruitmentYears() {
  const { data, error } = await supabase
    .from('role_locations')
    .select('date_request_received')
    .is('deleted_at', null)
    .order('date_request_received', { ascending: false });
  if (error) throw error;
  return [...new Set((data || [])
    .map(r => r.date_request_received ? new Date(r.date_request_received).getFullYear() : null)
    .filter(Boolean)
  )].sort((a, b) => b - a);
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
  // filters: { divisionId, roleId, location, year, employmentType, stage }
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
    if (filters.year) {
      const start = `${filters.year}-01-01`;
      const end = `${Number(filters.year) + 1}-01-01`;
      if (!rl.date_request_received || rl.date_request_received < start || rl.date_request_received >= end) return false;
    }
    return true;
  });

  const rlIds = roleLocations.map(rl => rl.role_location_id);
  if (rlIds.length === 0) return [];

  let candQuery = supabase
    .from('candidates')
    .select('*')
    .in('role_location_id', rlIds)
    .is('deleted_at', null);

  if (filters.employmentType) {
    candQuery = candQuery.eq('employment_type', filters.employmentType);
  }
  if (filters.stage && CANDIDATE_STATUS_FILTERS.includes(filters.stage)) {
    candQuery = candQuery.eq('status', filters.stage);
  }

  const { data: candidates, error: candErr } = await candQuery;
  if (candErr) throw candErr;

  const result = roleLocations.map(rl => {
    const row = {
      ...rl,
      candidates: candidates.filter(c => c.role_location_id === rl.role_location_id),
    };
    return { ...row, derived_status: deriveRoleLocationStatus(row) };
  });

  // Candidate-level filters affect the candidate population and therefore the
  // Overview, Roles and Candidates views. Role-location filters such as
  // Sourcing / Yet to Start are evaluated from the derived role status.
  let scoped = result;

  if (filters.employmentType) {
    scoped = scoped.filter(rl => rl.candidates.length > 0);
  }

  if (filters.stage) {
    if (ROLE_LOCATION_STATUS_FILTERS.includes(filters.stage)) {
      // Role/location stages are derived from the requisition and must remain
      // visible even when there are no candidate records (e.g. Sourcing).
      // "Sourcing" can also be a candidate status, so include either case.
      if (filters.stage === 'Sourcing') {
        scoped = scoped.filter(rl =>
          rl.derived_status === 'Sourcing' ||
          rl.candidates.some(c => c.status === 'Sourcing')
        );
      } else {
        scoped = scoped.filter(rl => rl.derived_status === filters.stage);
      }
    } else if (CANDIDATE_STATUS_FILTERS.includes(filters.stage)) {
      scoped = scoped.filter(rl => rl.candidates.some(c => c.status === filters.stage));
    }
  }

  return scoped;
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

const CANDIDATE_STATUS_FILTERS = [...CANDIDATE_FUNNEL_STAGES, 'Dropped', 'Rejected'];
const ROLE_LOCATION_STATUS_FILTERS = ['Yet to Start', 'Sourcing', 'On Hold', 'Deferred', 'Cancelled'];

function deriveRoleLocationStatus(rl) {
  // On Hold and Cancelled are deliberate manual overrides.
  if (['On Hold', 'Deferred', 'Cancelled'].includes(rl.status)) return rl.status;

  const positions = Number(rl.no_of_positions || 0);
  const closed = rl.candidates.filter(c => c.status === 'Closed').length;
  if (positions > 0 && closed >= positions) return 'Closed';

  // A future planned start date means recruitment has not started yet.
  if (rl.planned_start_date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const planned = new Date(rl.planned_start_date);
    planned.setHours(0, 0, 0, 0);
    if (planned > today) return 'Yet to Start';
  }

  const activeCandidates = rl.candidates.filter(c => !['Dropped', 'Rejected', 'Closed'].includes(c.status));
  if (activeCandidates.length === 0) return 'Sourcing';

  // The role/location status reflects the most advanced active candidate stage.
  const stageOrder = CANDIDATE_FUNNEL_STAGES;
  return activeCandidates.reduce((current, candidate) => {
    const currentIndex = stageOrder.indexOf(current);
    const candidateIndex = stageOrder.indexOf(candidate.status);
    return candidateIndex > currentIndex ? candidate.status : current;
  }, 'Sourcing');
}

export function computeDashboardMetrics(roleLocationsWithCandidates) {
  const uniqueRoleIds = new Set();
  const funnelCounts = Object.fromEntries(CANDIDATE_FUNNEL_STAGES.map(s => [s, 0]));
  const divisionAgg = {};
  const portfolio = {
    totalPositions: 0, openPositions: 0, filledPositions: 0,
    yetToStartPositions: 0, onHoldPositions: 0, deferredPositions: 0, cancelledPositions: 0,
    securedPositions: 0,
  };

  const stageOrder = CANDIDATE_FUNNEL_STAGES.filter(s => s !== 'Closed');

  for (const rl of roleLocationsWithCandidates) {
    const divName = rl.roles.divisions.name;
    if (!divisionAgg[divName]) divisionAgg[divName] = { positions: 0, secured: 0, closed: 0 };
    uniqueRoleIds.add(rl.roles.role_id);
    const positions = Math.max(0, Number(rl.no_of_positions || 0));
    portfolio.totalPositions += positions;
    divisionAgg[divName].positions += positions;

    const explicitStatus = rl.status;
    if (explicitStatus === 'On Hold' || explicitStatus === 'Deferred' || explicitStatus === 'Cancelled') {
      const key = explicitStatus === 'On Hold' ? 'onHoldPositions' : explicitStatus === 'Deferred' ? 'deferredPositions' : 'cancelledPositions';
      portfolio[key] += positions;
      continue;
    }
    if (rl.derived_status === 'Yet to Start') {
      portfolio.yetToStartPositions += positions;
      continue;
    }

    const closedCount = Math.min(positions, rl.candidates.filter(c => c.status === 'Closed').length);
    portfolio.filledPositions += closedCount;
    portfolio.securedPositions += closedCount;
    divisionAgg[divName].closed += closedCount;
    divisionAgg[divName].secured += closedCount;
    funnelCounts.Closed += closedCount;

    let remainingSlots = positions - closedCount;
    const activeCandidates = rl.candidates
      .filter(c => stageOrder.includes(c.status))
      .sort((a, b) => stageOrder.indexOf(b.status) - stageOrder.indexOf(a.status));

    for (const candidate of activeCandidates.slice(0, remainingSlots)) {
      funnelCounts[candidate.status] += 1;
      remainingSlots -= 1;
      if (['Offer', 'Awaiting Resumption'].includes(candidate.status)) {
        portfolio.securedPositions += 1;
        divisionAgg[divName].secured += 1;
      }
    }

    // Unassigned slots remain in Sourcing so the position funnel accounts for
    // every active slot, even when no candidate has been added yet.
    funnelCounts.Sourcing += remainingSlots;
    portfolio.openPositions += positions - closedCount;
  }

  const avgCloseTimes = roleLocationsWithCandidates
    .map(rl => computeTimeToClose(rl))
    .filter(d => d !== null);
  const avgTimeToClose = avgCloseTimes.length ? Math.round(avgCloseTimes.reduce((a, b) => a + b, 0) / avgCloseTimes.length) : null;

  const onboardTimes = roleLocationsWithCandidates
    .flatMap(rl => rl.candidates)
    .map(c => computeTimeToOnboard(c))
    .filter(d => d !== null);
  const avgTimeToOnboard = onboardTimes.length ? Math.round(onboardTimes.reduce((a, b) => a + b, 0) / onboardTimes.length) : null;

  const funnelTotal = Object.values(funnelCounts).reduce((sum, value) => sum + value, 0);
  return {
    totalSlots: portfolio.totalPositions,
    totalPositions: portfolio.totalPositions,
    totalRoles: uniqueRoleIds.size,
    totalRoleLocations: roleLocationsWithCandidates.length,
    positionsFilled: portfolio.filledPositions,
    positionsInProgress: portfolio.openPositions,
    yetToStartSlots: portfolio.yetToStartPositions,
    ...portfolio,
    avgTimeToClose,
    avgTimeToOnboard,
    fillRatePct: portfolio.totalPositions ? Math.round((portfolio.securedPositions / portfolio.totalPositions) * 100) : 0,
    closureRatePct: portfolio.totalPositions ? Math.round((portfolio.filledPositions / portfolio.totalPositions) * 100) : 0,
    funnelCounts,
    funnelPct: Object.fromEntries(
      CANDIDATE_FUNNEL_STAGES.map(s => [s, funnelTotal ? Math.round((funnelCounts[s] / funnelTotal) * 100) : 0])
    ),
    byDivision: Object.entries(divisionAgg).map(([name, v]) => ({
      name,
      fillRatePct: v.positions ? Math.round((v.secured / v.positions) * 100) : 0,
      closureRatePct: v.positions ? Math.round((v.closed / v.positions) * 100) : 0,
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
