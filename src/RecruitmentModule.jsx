// RecruitmentModule.jsx
// Recruitment section of the People Management Tracker — rendered inside the
// sidebar's "Recruitment" mode. Uses the SAME CSS variables (--bg0, --acc-fill,
// --dgr-bg, etc.) already defined in App.jsx's LIGHT/DARK theme objects, so it
// inherits dark mode and looks like one product rather than a bolted-on module.

import React, { useEffect, useState, useCallback } from 'react';
import {
  getCurrentUserScope, fetchDivisions, fetchRoleLocationsWithCandidates,
  computeDashboardMetrics, computeStalledOnboarding, computeTimeToClose, computeTimeToOnboard,
  fetchMyNotifications,
} from './recruitmentData';
import { parseUploadFile, parseXlsxUploadFile, executeUpload } from './recruitmentUpload';
import {
  bulkUpdateCandidateStatus, updateCandidateStatus, updateCandidate, moveCandidate,
  createRole, createRoleLocation, updateRole, updateRoleLocation, addCandidate,
  syncStalledNotifications, markNotificationRead, deleteRole, restoreRole,
  deleteRoleLocationAction, restoreRoleLocation, fetchDeletedRolesAndLocations,
} from './recruitmentActions';

// ---------------------------------------------------------------
// Shared style helpers — same pattern and same CSS variables as App.jsx
// ---------------------------------------------------------------
function inputStyle(extra = {}) { return { background: 'var(--bg2)', color: 'var(--tx1)', border: '0.5px solid var(--bds)', borderRadius: 8, padding: '7px 10px', fontSize: 13, ...extra }; }
function btnStyle(extra = {}) { return { fontSize: 13, background: 'var(--bg2)', border: '0.5px solid var(--bds)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', color: 'var(--tx1)', ...extra }; }
function primaryBtnStyle(extra = {}) { return { fontSize: 13, background: 'var(--acc-fill)', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', ...extra }; }
function dangerBtnStyle(extra = {}) { return { fontSize: 12, background: 'none', border: 'none', color: 'var(--dgr-tx)', cursor: 'pointer', ...extra }; }
function labelStyle() { return { fontSize: 12, color: 'var(--tx2)', display: 'block', marginBottom: 4 }; }

function Badge({ status }) {
  const role = status === 'Closed' ? 'suc'
    : status === 'Offer' ? 'wrn'
    : ['Dropped', 'Rejected'].includes(status) ? 'dgr'
    : 'acc';
  return <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, background: `var(--${role}-bg)`, color: `var(--${role}-tx)`, whiteSpace: 'nowrap' }}>{status}</span>;
}

const STATUS_OPTIONS = ['Sourcing', 'Interview', 'Onboarding Approval', 'Documentation', 'Offer', 'Awaiting Resumption', 'Closed', 'Dropped', 'Rejected'];
const SECURED_STATUSES = ['Offer', 'Awaiting Resumption', 'Closed'];

function downloadCsv(filename, headers, rows) {
  const escape = v => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(',')].concat(rows.map(r => headers.map(h => escape(r[h])).join(',')));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function Modal({ children, onClose, maxWidth = 380 }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 60 }}>
      <div style={{ background: 'var(--bg2)', color: 'var(--tx1)', borderRadius: 12, width: '100%', maxWidth, maxHeight: '85vh', overflowY: 'auto', padding: 20 }}>
        {children}
      </div>
    </div>
  );
}

// =================================================================
// Root component
// =================================================================
export default function RecruitmentModule() {
  const [scope, setScope] = useState(null);
  const [tab, setTab] = useState('overview');
  const [divisions, setDivisions] = useState([]);
  const [filters, setFilters] = useState({ divisionId: '', roleId: '', location: '', year: '' });
  const [rowsWithCandidates, setRowsWithCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // Cross-tab navigation state — set by a click on Overview or Roles, consumed by Candidates.
  const [candidateStatusFilter, setCandidateStatusFilter] = useState(null);
  const [candidateLocationFilter, setCandidateLocationFilter] = useState(null);
  const [roleFilterMode, setRoleFilterMode] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await getCurrentUserScope();
        setScope(s);
        const divs = await fetchDivisions();
        setDivisions(divs);
      } catch (err) {
        console.error('Recruitment module failed to load:', err);
        setLoadError(err.message || String(err));
      }
    })();
  }, []);

  const reload = useCallback(async () => {
    if (initialLoad) setLoading(true);
    const data = await fetchRoleLocationsWithCandidates(filters);
    setRowsWithCandidates(data);
    setLoading(false);
    setInitialLoad(false);
  }, [filters, initialLoad]);

  const [notifications, setNotifications] = useState([]);

  useEffect(() => { if (scope) reload(); }, [scope, reload]);

  // Once data loads, write any newly-stalled candidates as notification rows
  // (deduplicated in syncStalledNotifications), then refresh the bell's list.
  useEffect(() => {
    if (!rowsWithCandidates.length) return;
    const stalledNow = computeStalledOnboarding(rowsWithCandidates);
    (async () => {
      try {
        await syncStalledNotifications(stalledNow);
        const list = await fetchMyNotifications();
        setNotifications(list);
      } catch (err) {
        console.error('Notification sync failed:', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsWithCandidates]);

  if (loadError) return <div style={{ padding: 24, color: 'var(--dgr-tx)' }}>Couldn't load Recruitment: {loadError}</div>;
  if (!scope) return <div style={{ padding: 24, color: 'var(--tx2)' }}>Loading…</div>;
  if (scope.recruitment_role === null) {
    return <div style={{ padding: 24, color: 'var(--tx2)' }}>You don't have recruitment access. Contact an Admin.</div>;
  }

  const metrics = computeDashboardMetrics(rowsWithCandidates);
  const stalled = computeStalledOnboarding(rowsWithCandidates);
  const uniqueRoles = [...new Map(rowsWithCandidates.map(rl => [rl.roles.role_id, rl.roles])).values()];
  const uniqueLocations = [...new Set(rowsWithCandidates.map(rl => rl.location))];
  const canManageDivisions = ['admin', 'recruitment_admin'].includes(scope.recruitment_role);

  function jumpToCandidatesByStatus(statusFilter) {
    setCandidateStatusFilter(statusFilter);
    setCandidateLocationFilter(null);
    setTab('candidates');
  }
  function jumpToCandidatesByLocation(roleLocationId) {
    setCandidateLocationFilter(roleLocationId);
    setCandidateStatusFilter(null);
    setTab('candidates');
  }
  function jumpToRolesFiltered(mode) {
    setRoleFilterMode(mode);
    setTab('roles');
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <TabNav tab={tab} setTab={setTab} canManageDivisions={canManageDivisions} />
        <RecruitmentNotificationBell
          notifications={notifications}
          myUserId={scope.id}
          onRead={async (id) => { await markNotificationRead(id, scope.id); const list = await fetchMyNotifications(); setNotifications(list); }}
        />
      </div>

      <FilterBar
        divisions={divisions} roles={uniqueRoles} locations={uniqueLocations}
        filters={filters} setFilters={setFilters}
        showDivisionFilter={canManageDivisions || ['hrbp', 'analyst'].includes(scope.recruitment_role)}
      />

      {loading ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--txm)' }}>Loading…</div> : (
        <>
          {tab === 'overview' && (
            <OverviewTab
              metrics={metrics}
              filters={filters}
              onFunnelClick={jumpToCandidatesByStatus}
              onStalledClick={() => jumpToCandidatesByStatus('__stalled__')}
              onYetToStartClick={() => jumpToRolesFiltered('yetToStart')}
              stalledCount={stalled.length}
            />
          )}
          {tab === 'roles' && (
            <RolesTab
              rowsWithCandidates={rowsWithCandidates}
              onChanged={reload}
              initialFilterMode={roleFilterMode}
              divisions={divisions}
              onViewCandidates={jumpToCandidatesByLocation}
              canDelete={canManageDivisions}
            />
          )}
          {tab === 'candidates' && (
            <CandidatesTab
              rowsWithCandidates={rowsWithCandidates}
              initialStatusFilter={candidateStatusFilter}
              initialLocationFilter={candidateLocationFilter}
              stalled={stalled}
              onChanged={reload}
            />
          )}
          {tab === 'upload' && <UploadTab onDone={reload} />}
          {tab === 'deleted' && canManageDivisions && <DeletedTab onChanged={reload} />}
        </>
      )}
    </div>
  );
}

// =================================================================
// Nav + Filters
// =================================================================
function TabNav({ tab, setTab, canManageDivisions }) {
  const tabs = [['overview', 'Overview'], ['roles', 'Roles'], ['candidates', 'Candidates'], ['upload', 'Upload']];
  if (canManageDivisions) tabs.push(['deleted', 'Deleted']);
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
      {tabs.map(([id, label]) => (
        <button key={id} onClick={() => setTab(id)}
          style={{ border: 'none', background: tab === id ? 'var(--acc-bg)' : 'transparent', color: tab === id ? 'var(--acc-tx)' : 'var(--tx2)', fontSize: 13, fontWeight: 500, padding: '6px 12px', borderRadius: 8, cursor: 'pointer' }}>
          {label}
        </button>
      ))}
    </div>
  );
}

function FilterBar({ divisions, roles, locations, filters, setFilters, showDivisionFilter }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
      {showDivisionFilter && (
        <select value={filters.divisionId} onChange={e => setFilters(f => ({ ...f, divisionId: e.target.value }))} style={inputStyle({ width: 'auto' })}>
          <option value="">Division: All</option>
          {divisions.map(d => <option key={d.division_id} value={d.division_id}>{d.name}</option>)}
        </select>
      )}
      <select value={filters.roleId} onChange={e => setFilters(f => ({ ...f, roleId: e.target.value }))} style={inputStyle({ width: 'auto' })}>
        <option value="">Role: All</option>
        {roles.map(r => <option key={r.role_id} value={r.role_id}>{r.role_title}</option>)}
      </select>
      <select value={filters.location} onChange={e => setFilters(f => ({ ...f, location: e.target.value }))} style={inputStyle({ width: 'auto' })}>
        <option value="">Location: All</option>
        {locations.map(l => <option key={l} value={l}>{l}</option>)}
      </select>
      <select value={filters.year} onChange={e => setFilters(f => ({ ...f, year: e.target.value }))} style={inputStyle({ width: 'auto' })}>
        <option value="">Year: All</option>
        {[2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
}

// =================================================================
// Overview
// =================================================================
const FUNNEL_STAGES = ['Sourcing', 'Interview', 'Onboarding Approval', 'Documentation', 'Offer', 'Awaiting Resumption', 'Closed'];
function funnelStyle(stage) {
  if (stage === 'Closed') return ['suc'];
  if (stage === 'Offer') return ['wrn'];
  if (stage === 'Awaiting Resumption') return ['acc'];
  return ['neu'];
}

function KpiCard({ label, value, role }) {
  return (
    <div style={{ background: role ? `var(--${role}-bg)` : 'var(--bg1)', borderRadius: 12, padding: '10px 8px', flex: 1, minWidth: 130 }}>
      <p style={{ fontSize: 11, color: role ? `var(--${role}-tx)` : 'var(--tx2)', margin: '0 0 4px' }}>{label}</p>
      <p style={{ fontSize: 18, fontWeight: 500, margin: 0, color: role ? `var(--${role}-tx)` : 'var(--tx1)' }}>{value}</p>
    </div>
  );
}

function YearComparisonSection({ filters }) {
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState(null); // { thisYear, lastYear, thisYearLabel, lastYearLabel }

  const baseYear = filters.year ? Number(filters.year) : new Date().getFullYear();

  async function loadComparison() {
    setLoading(true); setError('');
    try {
      const [thisYearData, lastYearData] = await Promise.all([
        fetchRoleLocationsWithCandidates({ ...filters, year: String(baseYear) }),
        fetchRoleLocationsWithCandidates({ ...filters, year: String(baseYear - 1) }),
      ]);
      setRows({
        thisYear: computeDashboardMetrics(thisYearData),
        lastYear: computeDashboardMetrics(lastYearData),
        thisYearLabel: String(baseYear),
        lastYearLabel: String(baseYear - 1),
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ marginTop: 32, borderTop: '0.5px solid var(--bd)', paddingTop: 16 }}>
      {!show ? (
        <button onClick={() => { setShow(true); loadComparison(); }} style={btnStyle()}>Compare to previous year</button>
      ) : (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <p style={{ fontSize: 13, color: 'var(--tx2)', margin: 0 }}>{baseYear} vs {baseYear - 1}</p>
            <button onClick={() => setShow(false)} style={btnStyle()}>Hide</button>
          </div>
          {loading && <div style={{ color: 'var(--txm)', fontSize: 13 }}>Loading…</div>}
          {error && <div style={{ color: 'var(--dgr-tx)', fontSize: 13 }}>{error}</div>}
          {rows && !loading && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--bg1)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 500, color: 'var(--tx2)' }}>Metric</th>
                  <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 500, color: 'var(--tx2)' }}>{rows.thisYearLabel}</th>
                  <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 500, color: 'var(--tx2)' }}>{rows.lastYearLabel}</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Fill rate', `${rows.thisYear.fillRatePct}%`, `${rows.lastYear.fillRatePct}%`],
                  ['Closure rate', `${rows.thisYear.closureRatePct}%`, `${rows.lastYear.closureRatePct}%`],
                  ['Avg time to close', rows.thisYear.avgTimeToClose !== null ? `${rows.thisYear.avgTimeToClose}d` : '—', rows.lastYear.avgTimeToClose !== null ? `${rows.lastYear.avgTimeToClose}d` : '—'],
                  ['Avg time to onboard', rows.thisYear.avgTimeToOnboard !== null ? `${rows.thisYear.avgTimeToOnboard}d` : '—', rows.lastYear.avgTimeToOnboard !== null ? `${rows.lastYear.avgTimeToOnboard}d` : '—'],
                  ['Total roles', rows.thisYear.totalRoles, rows.lastYear.totalRoles],
                ].map(([label, a, b]) => (
                  <tr key={label} style={{ borderTop: '0.5px solid var(--bd)' }}>
                    <td style={{ padding: '8px 10px' }}>{label}</td>
                    <td style={{ padding: '8px 10px' }}>{a}</td>
                    <td style={{ padding: '8px 10px', color: 'var(--tx2)' }}>{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function OverviewTab({ metrics, filters, onFunnelClick, onStalledClick, onYetToStartClick, stalledCount }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 24 }}>
        <KpiCard label="Total roles" value={metrics.totalRoles} />
        <KpiCard label="Open positions" value={metrics.totalSlots} />
        <div onClick={onYetToStartClick} style={{ cursor: 'pointer' }}><KpiCard label="Yet to start" value={metrics.yetToStartSlots} role="neu" /></div>
        <KpiCard label="Fill rate" value={`${metrics.fillRatePct}%`} role="acc" />
        <KpiCard label="Closure rate" value={`${metrics.closureRatePct}%`} role="suc" />
        <KpiCard label="Avg time to close" value={metrics.avgTimeToClose !== null ? `${metrics.avgTimeToClose}d` : '—'} />
        <KpiCard label="Avg time to onboard" value={metrics.avgTimeToOnboard !== null ? `${metrics.avgTimeToOnboard}d` : '—'} />
        <div onClick={onStalledClick} style={{ cursor: 'pointer' }}><KpiCard label="Stalled onboarding" value={stalledCount} role="dgr" /></div>
      </div>

      <p style={{ fontSize: 13, color: 'var(--tx2)', margin: '0 0 8px' }}>Candidate funnel — click any stage</p>
      <div style={{ display: 'flex', gap: 4, marginBottom: 32, flexWrap: 'wrap' }}>
        {FUNNEL_STAGES.map(stage => {
          const [role] = funnelStyle(stage);
          return (
            <div key={stage} onClick={() => onFunnelClick(stage)} style={{ flex: 1, minWidth: 90, textAlign: 'center', cursor: 'pointer' }}>
              <div style={{ background: `var(--${role}-bg)`, color: `var(--${role}-tx)`, borderRadius: 8, padding: '8px 4px' }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{metrics.funnelCounts[stage]}</div>
                <div style={{ fontSize: 11 }}>{metrics.funnelPct[stage]}%</div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--txm)', marginTop: 4 }}>{stage}</div>
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: 13, color: 'var(--tx2)', margin: '0 0 4px' }}>Closure rates by division</p>
      <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--txm)', marginBottom: 10 }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--wrn-fill)', marginRight: 4 }} />Fill rate</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--suc-fill)', marginRight: 4 }} />Closure rate</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {metrics.byDivision.map(d => (
          <div key={d.name}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, fontSize: 13 }}>
              <span>{d.name}</span>
              <span style={{ color: 'var(--tx2)', fontSize: 12 }}>{d.fillRatePct}% filled · {d.closureRatePct}% closed</span>
            </div>
            <div style={{ background: 'var(--bg1)', borderRadius: 4, height: 10, position: 'relative' }}>
              <div style={{ width: `${d.fillRatePct}%`, background: 'var(--wrn-fill)', height: 10, borderRadius: 4, position: 'absolute' }} />
              <div style={{ width: `${d.closureRatePct}%`, background: 'var(--suc-fill)', height: 10, borderRadius: 4, position: 'absolute' }} />
            </div>
          </div>
        ))}
        {metrics.byDivision.length === 0 && <div style={{ color: 'var(--txm)', fontSize: 13 }}>No open roles yet.</div>}
      </div>

      <YearComparisonSection filters={filters} />
    </div>
  );
}

// =================================================================
// Roles — structural only, no candidate list, links out to Candidates
// =================================================================
function ProgressBar({ fillPct, closePct }) {
  return (
    <div style={{ background: 'var(--bg1)', borderRadius: 4, height: 8, position: 'relative', flex: 1, minWidth: 100 }}>
      <div style={{ width: `${fillPct}%`, background: 'var(--wrn-fill)', height: 8, borderRadius: 4, position: 'absolute' }} />
      <div style={{ width: `${closePct}%`, background: 'var(--suc-fill)', height: 8, borderRadius: 4, position: 'absolute' }} />
    </div>
  );
}

function locationRates(rl) {
  const secured = rl.candidates.filter(c => SECURED_STATUSES.includes(c.status)).length;
  const closed = rl.candidates.filter(c => c.status === 'Closed').length;
  const fillPct = rl.no_of_positions ? Math.min(100, Math.round((secured / rl.no_of_positions) * 100)) : 0;
  const closePct = rl.no_of_positions ? Math.min(100, Math.round((closed / rl.no_of_positions) * 100)) : 0;
  return { fillPct, closePct };
}

function RolesTab({ rowsWithCandidates, onChanged, initialFilterMode, divisions, onViewCandidates, canDelete }) {
  const [editingRole, setEditingRole] = useState(null);
  const [editingLocation, setEditingLocation] = useState(null);
  const [addingLocationFor, setAddingLocationFor] = useState(null);
  const [showNewRole, setShowNewRole] = useState(false);
  const [filterMode, setFilterMode] = useState(initialFilterMode || 'all');

  useEffect(() => { if (initialFilterMode) setFilterMode(initialFilterMode); }, [initialFilterMode]);

  const now = new Date();
  function passesFilter(rl) {
    if (filterMode === 'yetToStart') return rl.status === 'Yet to Start';
    if (filterMode === 'aging') {
      if (rl.status !== 'Open' || !rl.date_request_received) return false;
      return Math.floor((now - new Date(rl.date_request_received)) / 86400000) >= 30;
    }
    return true;
  }

  const divisionGroups = {};
  for (const rl of rowsWithCandidates) {
    if (!passesFilter(rl)) continue;
    const divName = rl.roles.divisions.name;
    const roleId = rl.roles.role_id;
    if (!divisionGroups[divName]) divisionGroups[divName] = {};
    if (!divisionGroups[divName][roleId]) divisionGroups[divName][roleId] = { title: rl.roles.role_title, roleType: rl.roles.role_type, locations: [] };
    divisionGroups[divName][roleId].locations.push(rl);
  }
  const divNames = Object.keys(divisionGroups).sort();

  const [confirmDeleteRole, setConfirmDeleteRole] = useState(null);
  const [confirmDeleteLocation, setConfirmDeleteLocation] = useState(null);

  async function doDeleteRole(roleId) {
    await deleteRole(roleId);
    setConfirmDeleteRole(null);
    onChanged();
  }
  async function doDeleteLocation(roleLocationId) {
    await deleteRoleLocationAction(roleLocationId);
    setConfirmDeleteLocation(null);
    onChanged();
  }

  function exportRoles() {
    const rows = rowsWithCandidates.filter(passesFilter).map(rl => ({
      Division: rl.roles.divisions.name, 'Role Title': rl.roles.role_title, 'Role Type': rl.roles.role_type,
      Location: rl.location, 'No of Positions': rl.no_of_positions, Status: rl.status,
      'Time to Close (days)': computeTimeToClose(rl) ?? '',
    }));
    downloadCsv('roles_export.csv', ['Division', 'Role Title', 'Role Type', 'Location', 'No of Positions', 'Status', 'Time to Close (days)'], rows);
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {[['all', 'All'], ['aging', 'Aging (30+ days)'], ['yetToStart', 'Yet to start']].map(([key, label]) => (
            <button key={key} onClick={() => setFilterMode(key)}
              style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', background: filterMode === key ? 'var(--acc-fill)' : 'var(--bg1)', color: filterMode === key ? '#fff' : 'var(--tx2)' }}>
              {label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button onClick={exportRoles} style={btnStyle()}>Export CSV</button>
          <button onClick={() => setShowNewRole(true)} style={primaryBtnStyle()}>+ New role</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--txm)', marginBottom: 16 }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--wrn-fill)', marginRight: 4 }} />Fill rate</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--suc-fill)', marginRight: 4 }} />Closure rate</span>
      </div>

      {divNames.length === 0 && (
        <div style={{ padding: 20, color: 'var(--txm)', textAlign: 'center' }}>
          {filterMode === 'all' ? 'No roles yet. Click "+ New role" or use Upload to get started.' : 'Nothing matches this filter.'}
        </div>
      )}

      {divNames.map(divName => (
        <div key={divName} style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--tx1)', marginBottom: 10 }}>{divName}</div>
          {Object.entries(divisionGroups[divName]).map(([roleId, role]) => {
            const totalPositions = role.locations.reduce((sum, rl) => sum + rl.no_of_positions, 0);
            const totalSecured = role.locations.reduce((sum, rl) => sum + rl.candidates.filter(c => SECURED_STATUSES.includes(c.status)).length, 0);
            const totalClosed = role.locations.reduce((sum, rl) => sum + rl.candidates.filter(c => c.status === 'Closed').length, 0);
            const roleFillPct = totalPositions ? Math.min(100, Math.round((totalSecured / totalPositions) * 100)) : 0;
            const roleClosePct = totalPositions ? Math.min(100, Math.round((totalClosed / totalPositions) * 100)) : 0;

            return (
              <div key={roleId} style={{ marginBottom: 14, paddingLeft: 8, borderLeft: '3px solid var(--acc-bg)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, minWidth: 200 }}>{role.title}</span>
                  <span style={{ fontSize: 11, color: 'var(--txm)' }}>{role.roleType}</span>
                  <ProgressBar fillPct={roleFillPct} closePct={roleClosePct} />
                  <span style={{ fontSize: 11, color: 'var(--tx2)', whiteSpace: 'nowrap' }}>{totalPositions} positions</span>
                  <button onClick={() => setEditingRole({ roleId, title: role.title, roleType: role.roleType })} style={dangerBtnStyle({ color: 'var(--acc-tx)' })}>Edit</button>
                  <button onClick={() => setAddingLocationFor(roleId)} style={dangerBtnStyle({ color: 'var(--acc-tx)' })}>+ Location</button>
                  {canDelete && <button onClick={() => setConfirmDeleteRole(roleId)} style={dangerBtnStyle()}>Delete</button>}
                </div>
                <div style={{ paddingLeft: 20 }}>
                  {role.locations.map(rl => {
                    const { fillPct, closePct } = locationRates(rl);
                    const daysToClose = computeTimeToClose(rl);
                    return (
                      <div key={rl.role_location_id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, minWidth: 120 }}>{rl.location}</span>
                        <ProgressBar fillPct={fillPct} closePct={closePct} />
                        <span style={{ fontSize: 11, color: 'var(--tx2)', whiteSpace: 'nowrap' }}>
                          {rl.no_of_positions} positions · {rl.status}{daysToClose !== null ? ` · closed in ${daysToClose}d` : ''}
                        </span>
                        <button onClick={() => onViewCandidates(rl.role_location_id)} style={dangerBtnStyle({ color: 'var(--acc-tx)' })}>View candidates ({rl.candidates.length})</button>
                        <button onClick={() => setEditingLocation(rl)} style={dangerBtnStyle({ color: 'var(--acc-tx)' })}>Edit</button>
                        {canDelete && <button onClick={() => setConfirmDeleteLocation(rl.role_location_id)} style={dangerBtnStyle()}>Delete</button>}
                      </div>
                    );
                  })}
                </div>
                {addingLocationFor === roleId && (
                  <QuickAddLocationForm roleId={roleId} onDone={() => { setAddingLocationFor(null); onChanged(); }} onCancel={() => setAddingLocationFor(null)} />
                )}
              </div>
            );
          })}
        </div>
      ))}

      {editingRole && <EditRoleModal role={editingRole} onClose={() => setEditingRole(null)} onSaved={() => { setEditingRole(null); onChanged(); }} />}
      {confirmDeleteRole && (
        <Modal onClose={() => setConfirmDeleteRole(null)}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Delete this role?</div>
          <p style={{ fontSize: 13, color: 'var(--tx2)', marginBottom: 16 }}>This also hides all of its locations. Nothing is lost — restore it any time from the Deleted tab.</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setConfirmDeleteRole(null)} style={btnStyle()}>Cancel</button>
            <button onClick={() => doDeleteRole(confirmDeleteRole)} style={primaryBtnStyle({ background: 'var(--dgr-fill)' })}>Delete</button>
          </div>
        </Modal>
      )}
      {confirmDeleteLocation && (
        <Modal onClose={() => setConfirmDeleteLocation(null)}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Delete this location?</div>
          <p style={{ fontSize: 13, color: 'var(--tx2)', marginBottom: 16 }}>Nothing is lost — restore it any time from the Deleted tab.</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setConfirmDeleteLocation(null)} style={btnStyle()}>Cancel</button>
            <button onClick={() => doDeleteLocation(confirmDeleteLocation)} style={primaryBtnStyle({ background: 'var(--dgr-fill)' })}>Delete</button>
          </div>
        </Modal>
      )}
      {editingLocation && <EditLocationModal rl={editingLocation} onClose={() => setEditingLocation(null)} onSaved={() => { setEditingLocation(null); onChanged(); }} />}
      {showNewRole && <NewRoleModal divisions={divisions} onClose={() => setShowNewRole(false)} onSaved={() => { setShowNewRole(false); onChanged(); }} />}
    </div>
  );
}

function QuickAddLocationForm({ roleId, onDone, onCancel }) {
  const [location, setLocation] = useState('');
  const [noOfPositions, setNoOfPositions] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!location.trim() || !noOfPositions) { setError('Location and No. of Positions are required.'); return; }
    setSaving(true); setError('');
    try {
      await createRoleLocation({ roleId, location: location.trim(), noOfPositions: Number(noOfPositions), status: 'Open' });
      onDone();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div style={{ marginLeft: 20, marginTop: 8, padding: 10, background: 'var(--bg1)', borderRadius: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <input placeholder="Location" value={location} onChange={e => setLocation(e.target.value)} style={inputStyle({ width: 140 })} />
      <input type="number" min="1" placeholder="Positions" value={noOfPositions} onChange={e => setNoOfPositions(e.target.value)} style={inputStyle({ width: 90 })} />
      <button onClick={submit} disabled={saving} style={primaryBtnStyle()}>{saving ? 'Saving…' : 'Add'}</button>
      <button onClick={onCancel} style={btnStyle()}>Cancel</button>
      {error && <span style={{ color: 'var(--dgr-tx)', fontSize: 12 }}>{error}</span>}
    </div>
  );
}

function EditRoleModal({ role, onClose, onSaved }) {
  const [title, setTitle] = useState(role.title);
  const [roleType, setRoleType] = useState(role.roleType);
  const [suggestedGrade, setSuggestedGrade] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setSaving(true); setError('');
    try {
      await updateRole({ roleId: role.roleId, roleTitle: title, roleType, suggestedGrade });
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <div style={{ fontWeight: 600, marginBottom: 12 }}>Edit role</div>
      <label style={labelStyle()}>Role title</label>
      <input value={title} onChange={e => setTitle(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />
      <label style={labelStyle()}>Role type</label>
      <select value={roleType} onChange={e => setRoleType(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })}>
        <option>Sales</option><option>Support</option><option>Affiliate</option>
      </select>
      <label style={labelStyle()}>Suggested grade</label>
      <input value={suggestedGrade} onChange={e => setSuggestedGrade(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />
      {error && <div style={{ color: 'var(--dgr-tx)', fontSize: 12, marginBottom: 8 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={btnStyle()}>Cancel</button>
        <button onClick={submit} disabled={saving} style={primaryBtnStyle()}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
  );
}

function EditLocationModal({ rl, onClose, onSaved }) {
  const [location, setLocation] = useState(rl.location);
  const [noOfPositions, setNoOfPositions] = useState(rl.no_of_positions);
  const [status, setStatus] = useState(rl.status);
  const [plannedStartDate, setPlannedStartDate] = useState(rl.planned_start_date || '');
  const [dateRequestReceived, setDateRequestReceived] = useState(rl.date_request_received || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setSaving(true); setError('');
    try {
      await updateRoleLocation({
        roleLocationId: rl.role_location_id, location, noOfPositions: Number(noOfPositions), status,
        plannedStartDate: plannedStartDate || null, dateRequestReceived: dateRequestReceived || null,
      });
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <div style={{ fontWeight: 600, marginBottom: 12 }}>Edit location</div>
      <label style={labelStyle()}>Location</label>
      <input value={location} onChange={e => setLocation(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />
      <label style={labelStyle()}>No. of positions</label>
      <input type="number" min="1" value={noOfPositions} onChange={e => setNoOfPositions(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />
      <label style={labelStyle()}>Status</label>
      <select value={status} onChange={e => setStatus(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })}>
        <option>Open</option><option>Yet to Start</option><option>On Hold</option><option>Cancelled</option><option>Closed</option>
      </select>
      <label style={labelStyle()}>Planned start date</label>
      <input type="date" value={plannedStartDate} onChange={e => setPlannedStartDate(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />
      <label style={labelStyle()}>Date request received</label>
      <input type="date" value={dateRequestReceived} onChange={e => setDateRequestReceived(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />
      {error && <div style={{ color: 'var(--dgr-tx)', fontSize: 12, marginBottom: 8 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={btnStyle()}>Cancel</button>
        <button onClick={submit} disabled={saving} style={primaryBtnStyle()}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
  );
}

function NewRoleModal({ divisions, onClose, onSaved }) {
  const [divisionId, setDivisionId] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [roleType, setRoleType] = useState('Sales');
  const [suggestedGrade, setSuggestedGrade] = useState('');
  const [location, setLocation] = useState('');
  const [noOfPositions, setNoOfPositions] = useState('');
  const [status, setStatus] = useState('Open');
  const [plannedStartDate, setPlannedStartDate] = useState('');
  const [dateRequestReceived, setDateRequestReceived] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    if (!divisionId || !roleTitle.trim() || !location.trim() || !noOfPositions) {
      setError('Division, Role Title, Location, and No. of Positions are all required.');
      return;
    }
    setSaving(true);
    try {
      const newRole = await createRole({ divisionId, roleTitle: roleTitle.trim(), roleType, suggestedGrade });
      await createRoleLocation({
        roleId: newRole.role_id, location: location.trim(), noOfPositions: Number(noOfPositions),
        status, plannedStartDate: plannedStartDate || null, dateRequestReceived: dateRequestReceived || null,
      });
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <div style={{ fontWeight: 600, marginBottom: 12 }}>New role</div>
      <label style={labelStyle()}>Division</label>
      <select value={divisionId} onChange={e => setDivisionId(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })}>
        <option value="">Select division…</option>
        {divisions.map(d => <option key={d.division_id} value={d.division_id}>{d.name}</option>)}
      </select>
      <label style={labelStyle()}>Role title</label>
      <input value={roleTitle} onChange={e => setRoleTitle(e.target.value)} placeholder="e.g. Sales Associate" style={inputStyle({ width: '100%', marginBottom: 10 })} />
      <label style={labelStyle()}>Role type</label>
      <select value={roleType} onChange={e => setRoleType(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })}>
        <option>Sales</option><option>Support</option><option>Affiliate</option>
      </select>
      <label style={labelStyle()}>Suggested grade (optional)</label>
      <input value={suggestedGrade} onChange={e => setSuggestedGrade(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />

      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--acc-tx)', marginTop: 8, marginBottom: 6 }}>First location for this role</div>
      <label style={labelStyle()}>Location</label>
      <input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Kano" style={inputStyle({ width: '100%', marginBottom: 10 })} />
      <label style={labelStyle()}>No. of positions</label>
      <input type="number" min="1" value={noOfPositions} onChange={e => setNoOfPositions(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />
      <label style={labelStyle()}>Status</label>
      <select value={status} onChange={e => setStatus(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })}>
        <option>Open</option><option>Yet to Start</option><option>On Hold</option><option>Cancelled</option>
      </select>
      {status === 'Yet to Start' && (
        <>
          <label style={labelStyle()}>Planned start date</label>
          <input type="date" value={plannedStartDate} onChange={e => setPlannedStartDate(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />
        </>
      )}
      <label style={labelStyle()}>Date request received</label>
      <input type="date" value={dateRequestReceived} onChange={e => setDateRequestReceived(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />

      {error && <div style={{ color: 'var(--dgr-tx)', fontSize: 12, marginBottom: 8 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={btnStyle()}>Cancel</button>
        <button onClick={submit} disabled={saving} style={primaryBtnStyle()}>{saving ? 'Saving…' : 'Create role'}</button>
      </div>
    </Modal>
  );
}

// =================================================================
// Candidates — the only place candidates are added, edited, or have status changed
// =================================================================
function CandidatesTab({ rowsWithCandidates, initialStatusFilter, initialLocationFilter, stalled, onChanged }) {
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter);
  const [locationFilter, setLocationFilter] = useState(initialLocationFilter);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [bulkStatus, setBulkStatus] = useState('');
  const [error, setError] = useState('');
  const [showAddCandidate, setShowAddCandidate] = useState(false);
  const [profileCandidate, setProfileCandidate] = useState(null); // { candidate, rl }

  useEffect(() => { setStatusFilter(initialStatusFilter); }, [initialStatusFilter]);
  useEffect(() => { setLocationFilter(initialLocationFilter); }, [initialLocationFilter]);

  const stalledIds = new Set(stalled.map(s => s.candidateId));

  let flat = rowsWithCandidates.flatMap(rl =>
    rl.candidates.map(c => ({
      ...c, roleTitle: rl.roles.role_title, division: rl.roles.divisions.name, location: rl.location, rl,
    }))
  );

  if (statusFilter === '__stalled__') flat = flat.filter(c => stalledIds.has(c.candidate_id));
  else if (statusFilter === '__dropped__') flat = flat.filter(c => ['Dropped', 'Rejected'].includes(c.status));
  else if (statusFilter) flat = flat.filter(c => c.status === statusFilter);
  if (locationFilter) flat = flat.filter(c => c.rl.role_location_id === locationFilter);
  if (search.trim()) flat = flat.filter(c => c.candidate_name?.toLowerCase().includes(search.toLowerCase()));

  function exportCandidates() {
    const rows = flat.map(c => ({
      Name: c.candidate_name, Division: c.division, Role: c.roleTitle, Location: c.location,
      Status: c.status, Source: c.source || '', Phone: c.contact_phone || '',
      'Time to Onboard (days)': computeTimeToOnboard(c) ?? '',
    }));
    downloadCsv('candidates_export.csv', ['Name', 'Division', 'Role', 'Location', 'Status', 'Source', 'Phone', 'Time to Onboard (days)'], rows);
  }

  async function quickChangeStatus(candidateId, newStatus) {
    setError('');
    try {
      await updateCandidateStatus(candidateId, newStatus);
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  async function applyBulk() {
    if (!bulkStatus || selected.size === 0) return;
    try {
      await bulkUpdateCandidateStatus([...selected], bulkStatus);
      setSelected(new Set());
      setBulkStatus('');
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  const activeFilterLabel = statusFilter === '__stalled__' ? 'Stalled'
    : statusFilter === '__dropped__' ? 'Dropped/Rejected'
    : locationFilter ? `Location: ${flat[0]?.location || ''}`
    : statusFilter;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <input placeholder="Search candidate name…" value={search} onChange={e => setSearch(e.target.value)} style={inputStyle({ flex: 1, minWidth: 160 })} />
        <button onClick={() => setShowAddCandidate(true)} style={primaryBtnStyle()}>+ Add candidate</button>
        <button onClick={exportCandidates} style={btnStyle()}>Export CSV</button>
        <button onClick={() => setStatusFilter('__dropped__')} style={btnStyle()}>Dropped / rejected</button>
        {(statusFilter || locationFilter) && (
          <button onClick={() => { setStatusFilter(null); setLocationFilter(null); }} style={btnStyle()}>
            Clear filter: {activeFilterLabel} ×
          </button>
        )}
      </div>

      {selected.size > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', background: 'var(--acc-bg)', padding: 8, borderRadius: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--acc-tx)' }}>{selected.size} selected</span>
          <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)} style={inputStyle({ width: 'auto' })}>
            <option value="">Move to…</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={applyBulk} style={primaryBtnStyle()}>Apply</button>
        </div>
      )}
      {error && <div style={{ color: 'var(--dgr-tx)', fontSize: 13, marginBottom: 8 }}>{error}</div>}

      <div style={{ border: '0.5px solid var(--bd)', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--bg1)' }}>
              <th style={{ padding: '8px 10px' }}></th>
              <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 500, color: 'var(--tx2)' }}>Name</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 500, color: 'var(--tx2)' }}>Division</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 500, color: 'var(--tx2)' }}>Role</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 500, color: 'var(--tx2)' }}>Location</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 500, color: 'var(--tx2)' }}>Status</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 500, color: 'var(--tx2)' }}>Time to onboard</th>
            </tr>
          </thead>
          <tbody>
            {flat.map(c => {
              const isStalled = stalledIds.has(c.candidate_id);
              const ttOnboard = computeTimeToOnboard(c);
              return (
                <tr key={c.candidate_id} style={{ borderTop: '0.5px solid var(--bd)', background: isStalled ? 'var(--dgr-bg)' : 'transparent' }}>
                  <td style={{ padding: '8px 10px' }}>
                    <input type="checkbox" checked={selected.has(c.candidate_id)} onChange={e => {
                      const next = new Set(selected);
                      e.target.checked ? next.add(c.candidate_id) : next.delete(c.candidate_id);
                      setSelected(next);
                    }} />
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <button onClick={() => setProfileCandidate({ candidate: c, rl: c.rl })} style={{ background: 'none', border: 'none', color: 'var(--acc-tx)', cursor: 'pointer', padding: 0, fontSize: 13, textDecoration: 'underline' }}>
                      {c.candidate_name}
                    </button>
                    {isStalled && <span style={{ marginLeft: 6, color: 'var(--dgr-tx)' }}>⚠</span>}
                  </td>
                  <td style={{ padding: '8px 10px', color: 'var(--tx2)' }}>{c.division}</td>
                  <td style={{ padding: '8px 10px', color: 'var(--tx2)' }}>{c.roleTitle}</td>
                  <td style={{ padding: '8px 10px', color: 'var(--tx2)' }}>{c.location}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <select value={c.status} onChange={e => quickChangeStatus(c.candidate_id, e.target.value)} style={inputStyle({ padding: '3px 6px', fontSize: 12 })}>
                      {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: '8px 10px', color: isStalled ? 'var(--dgr-tx)' : 'var(--tx2)' }}>{ttOnboard !== null ? `${ttOnboard}d` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {flat.length === 0 && <div style={{ padding: 20, color: 'var(--txm)', textAlign: 'center' }}>No candidates match this filter.</div>}
      </div>

      {showAddCandidate && (
        <AddCandidateModal rowsWithCandidates={rowsWithCandidates} onClose={() => setShowAddCandidate(false)} onSaved={() => { setShowAddCandidate(false); onChanged(); }} />
      )}
      {profileCandidate && (
        <CandidateProfilePanel
          candidate={profileCandidate.candidate}
          currentRl={profileCandidate.rl}
          allRows={rowsWithCandidates}
          onClose={() => setProfileCandidate(null)}
          onSaved={() => { setProfileCandidate(null); onChanged(); }}
        />
      )}
    </div>
  );
}

function AddCandidateModal({ rowsWithCandidates, onClose, onSaved }) {
  const [divisionName, setDivisionName] = useState('');
  const [roleId, setRoleId] = useState('');
  const [roleLocationId, setRoleLocationId] = useState('');
  const [candidateName, setCandidateName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [source, setSource] = useState('');
  const [status, setStatus] = useState('Sourcing');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const divisionNames = [...new Set(rowsWithCandidates.map(rl => rl.roles.divisions.name))].sort();
  const rolesInDivision = [...new Map(
    rowsWithCandidates.filter(rl => rl.roles.divisions.name === divisionName).map(rl => [rl.roles.role_id, rl.roles])
  ).values()];
  const locationsForRole = rowsWithCandidates.filter(rl => rl.roles.role_id === roleId);

  async function submit() {
    if (!roleLocationId || !candidateName.trim()) { setError('Role/Location and Candidate Name are required.'); return; }
    setSaving(true); setError('');
    try {
      await addCandidate({ roleLocationId, candidateName: candidateName.trim(), contactPhone, source, status });
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <div style={{ fontWeight: 600, marginBottom: 12 }}>Add candidate</div>
      <label style={labelStyle()}>Division</label>
      <select value={divisionName} onChange={e => { setDivisionName(e.target.value); setRoleId(''); setRoleLocationId(''); }} style={inputStyle({ width: '100%', marginBottom: 10 })}>
        <option value="">Select division…</option>
        {divisionNames.map(d => <option key={d} value={d}>{d}</option>)}
      </select>
      <label style={labelStyle()}>Role</label>
      <select value={roleId} onChange={e => { setRoleId(e.target.value); setRoleLocationId(''); }} style={inputStyle({ width: '100%', marginBottom: 10 })} disabled={!divisionName}>
        <option value="">Select role…</option>
        {rolesInDivision.map(r => <option key={r.role_id} value={r.role_id}>{r.role_title}</option>)}
      </select>
      <label style={labelStyle()}>Location</label>
      <select value={roleLocationId} onChange={e => setRoleLocationId(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} disabled={!roleId}>
        <option value="">Select location…</option>
        {locationsForRole.map(rl => <option key={rl.role_location_id} value={rl.role_location_id}>{rl.location}</option>)}
      </select>
      <label style={labelStyle()}>Candidate name</label>
      <input value={candidateName} onChange={e => setCandidateName(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />
      <label style={labelStyle()}>Contact phone</label>
      <input value={contactPhone} onChange={e => setContactPhone(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />
      <label style={labelStyle()}>Source</label>
      <select value={source} onChange={e => setSource(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })}>
        <option value="">Select…</option>
        <option>Referral</option><option>Job Board</option><option>Agency</option><option>Internal</option><option>Other</option>
      </select>
      <label style={labelStyle()}>Starting status</label>
      <select value={status} onChange={e => setStatus(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })}>
        {STATUS_OPTIONS.slice(0, 7).map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      {error && <div style={{ color: 'var(--dgr-tx)', fontSize: 12, marginBottom: 8 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={btnStyle()}>Cancel</button>
        <button onClick={submit} disabled={saving} style={primaryBtnStyle()}>{saving ? 'Saving…' : 'Add candidate'}</button>
      </div>
    </Modal>
  );
}

// The candidate profile panel — every editable field on a candidate lives here,
// so the Candidates table itself stays a clean, scannable list.
function CandidateProfilePanel({ candidate, currentRl, allRows, onClose, onSaved }) {
  const [form, setForm] = useState({
    candidate_name: candidate.candidate_name || '',
    contact_phone: candidate.contact_phone || '',
    source: candidate.source || '',
    status: candidate.status || 'Sourcing',
    medical_report_received: !!candidate.medical_report_received,
    date_sourced: candidate.date_sourced || '',
    date_interview: candidate.date_interview || '',
    date_sent_for_onboarding_approval: candidate.date_sent_for_onboarding_approval || '',
    date_documentation_started: candidate.date_documentation_started || '',
    date_offer_extended: candidate.date_offer_extended || '',
    date_offer_accepted: candidate.date_offer_accepted || '',
    expected_resumption_date: candidate.expected_resumption_date || '',
    actual_resumption_date: candidate.actual_resumption_date || '',
    date_closed: candidate.date_closed || '',
    status_reason: candidate.status_reason || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [showMove, setShowMove] = useState(false);
  const [moveTargetId, setMoveTargetId] = useState('');
  const [moveReason, setMoveReason] = useState('');
  const [moving, setMoving] = useState(false);

  function set(field, value) { setForm(f => ({ ...f, [field]: value })); }

  async function save() {
    setSaving(true); setError('');
    try {
      const payload = {};
      for (const [k, v] of Object.entries(form)) {
        payload[k] = v === '' ? null : v;
      }
      await updateCandidate(candidate.candidate_id, payload);
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  async function submitMove() {
    if (!moveTargetId) { setError('Select a location to move to.'); return; }
    setMoving(true); setError('');
    try {
      await moveCandidate(candidate.candidate_id, moveTargetId, moveReason);
      onSaved();
    } catch (err) {
      setError(err.message);
      setMoving(false);
    }
  }

  const otherLocations = allRows.filter(rl => rl.role_location_id !== currentRl.role_location_id);
  const dateFields = [
    ['date_sourced', 'Date sourced'],
    ['date_interview', 'Date interview'],
    ['date_sent_for_onboarding_approval', 'Date sent for onboarding approval'],
    ['date_documentation_started', 'Date documentation started'],
    ['date_offer_extended', 'Date offer extended'],
    ['date_offer_accepted', 'Date offer accepted'],
    ['expected_resumption_date', 'Expected resumption date'],
    ['actual_resumption_date', 'Actual resumption date'],
    ['date_closed', 'Date closed'],
  ];

  return (
    <Modal onClose={onClose} maxWidth={460}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{candidate.candidate_name}</div>
      <div style={{ fontSize: 12, color: 'var(--tx2)', marginBottom: 16 }}>
        {currentRl.roles.divisions.name} · {currentRl.roles.role_title} · {currentRl.location}
      </div>

      <label style={labelStyle()}>Name</label>
      <input value={form.candidate_name} onChange={e => set('candidate_name', e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />

      <label style={labelStyle()}>Contact phone</label>
      <input value={form.contact_phone} onChange={e => set('contact_phone', e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />

      <label style={labelStyle()}>Source</label>
      <select value={form.source} onChange={e => set('source', e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })}>
        <option value="">—</option>
        <option>Referral</option><option>Job Board</option><option>Agency</option><option>Internal</option><option>Other</option>
      </select>

      <label style={labelStyle()}>Status</label>
      <select value={form.status} onChange={e => set('status', e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })}>
        {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
      </select>

      {['Dropped', 'Rejected'].includes(form.status) && (
        <>
          <label style={labelStyle()}>Reason</label>
          <input value={form.status_reason} onChange={e => set('status_reason', e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />
        </>
      )}

      <label style={{ ...labelStyle(), display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <input type="checkbox" checked={form.medical_report_received} onChange={e => set('medical_report_received', e.target.checked)} />
        Medical report received
      </label>

      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--acc-tx)', marginTop: 12, marginBottom: 6 }}>Stage dates</div>
      {dateFields.map(([field, label]) => (
        <div key={field}>
          <label style={labelStyle()}>{label}</label>
          <input type="date" value={form[field]} onChange={e => set(field, e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />
        </div>
      ))}

      {error && <div style={{ color: 'var(--dgr-tx)', fontSize: 12, marginBottom: 8 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginBottom: 16 }}>
        <button onClick={onClose} style={btnStyle()}>Cancel</button>
        <button onClick={save} disabled={saving} style={primaryBtnStyle()}>{saving ? 'Saving…' : 'Save'}</button>
      </div>

      <div style={{ borderTop: '0.5px solid var(--bd)', paddingTop: 12 }}>
        {!showMove ? (
          <button onClick={() => setShowMove(true)} style={btnStyle()}>Move to a different role/location</button>
        ) : (
          <div>
            <label style={labelStyle()}>Move to</label>
            <select value={moveTargetId} onChange={e => setMoveTargetId(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })}>
              <option value="">Select role/location…</option>
              {otherLocations.map(rl => (
                <option key={rl.role_location_id} value={rl.role_location_id}>
                  {rl.roles.divisions.name} — {rl.roles.role_title} — {rl.location}
                </option>
              ))}
            </select>
            <label style={labelStyle()}>Reason for move</label>
            <input value={moveReason} onChange={e => setMoveReason(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowMove(false)} style={btnStyle()}>Cancel</button>
              <button onClick={submitMove} disabled={moving} style={primaryBtnStyle()}>{moving ? 'Moving…' : 'Confirm move'}</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// =================================================================
// Notification bell — Stalled Onboarding alerts
// =================================================================
function RecruitmentNotificationBell({ notifications, myUserId, onRead }) {
  const [open, setOpen] = useState(false);
  const unread = notifications.filter(n => !(n.read_by || []).includes(myUserId));

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={btnStyle({ position: 'relative' })}>
        Notifications
        {unread.length > 0 && (
          <span style={{ marginLeft: 6, background: 'var(--dgr-fill)', color: '#fff', borderRadius: 999, fontSize: 11, padding: '1px 6px' }}>
            {unread.length}
          </span>
        )}
      </button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 6, width: 320, maxHeight: 360, overflowY: 'auto', background: 'var(--bg2)', border: '0.5px solid var(--bd)', borderRadius: 8, zIndex: 50, boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>
          {notifications.length === 0 && <div style={{ padding: 14, fontSize: 13, color: 'var(--txm)' }}>No notifications yet.</div>}
          {notifications.map(n => {
            const isRead = (n.read_by || []).includes(myUserId);
            return (
              <div key={n.notification_id} style={{ padding: '10px 12px', borderTop: '0.5px solid var(--bd)', background: isRead ? 'transparent' : 'var(--dgr-bg)' }}>
                <p style={{ fontSize: 12, margin: '0 0 6px', color: 'var(--tx1)' }}>{n.message}</p>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--txm)' }}>{new Date(n.created_at).toLocaleDateString()}</span>
                  {!isRead && <button onClick={() => onRead(n.notification_id)} style={{ fontSize: 11, background: 'none', border: 'none', color: 'var(--acc-tx)', cursor: 'pointer' }}>Mark read</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// =================================================================
// Deleted — Admin / Recruitment Admin only. Nothing is ever hard-deleted;
// this is where a mistaken delete gets undone.
// =================================================================
function DeletedTab({ onChanged }) {
  const [data, setData] = useState({ roles: [], locations: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    try {
      const d = await fetchDeletedRolesAndLocations();
      setData(d);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function restore(kind, id) {
    setError('');
    try {
      if (kind === 'role') await restoreRole(id);
      else await restoreRoleLocation(id);
      await load();
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <div style={{ padding: 20, color: 'var(--txm)' }}>Loading…</div>;

  return (
    <div>
      {error && <div style={{ color: 'var(--dgr-tx)', fontSize: 13, marginBottom: 8 }}>{error}</div>}

      <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx2)', marginBottom: 6 }}>Deleted roles</p>
      {data.roles.length === 0 && <div style={{ fontSize: 13, color: 'var(--txm)', marginBottom: 16 }}>None.</div>}
      {data.roles.map(r => (
        <div key={r.role_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '0.5px solid var(--bd)' }}>
          <span style={{ fontSize: 13 }}>{r.divisions?.name} — {r.role_title}</span>
          <button onClick={() => restore('role', r.role_id)} style={btnStyle()}>Restore</button>
        </div>
      ))}

      <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx2)', margin: '20px 0 6px' }}>Deleted locations</p>
      {data.locations.length === 0 && <div style={{ fontSize: 13, color: 'var(--txm)' }}>None.</div>}
      {data.locations.map(l => (
        <div key={l.role_location_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '0.5px solid var(--bd)' }}>
          <span style={{ fontSize: 13 }}>{l.roles?.divisions?.name} — {l.roles?.role_title} — {l.location}</span>
          <button onClick={() => restore('location', l.role_location_id)} style={btnStyle()}>Restore</button>
        </div>
      ))}
    </div>
  );
}

// =================================================================
// Upload
// =================================================================
function UploadTab({ onDone }) {
  const [parsed, setParsed] = useState(null);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [uploadError, setUploadError] = useState('');

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setResult(null);
    setUploadError('');
    if (file.name.toLowerCase().endsWith('.xlsx')) {
      parseXlsxUploadFile(file)
        .then(setParsed)
        .catch(err => setUploadError(err.message));
    } else {
      const reader = new FileReader();
      reader.onload = ev => setParsed(parseUploadFile(ev.target.result));
      reader.readAsText(file);
    }
  }

  async function runUpload() {
    if (!parsed || parsed.errors.length) return;
    setRunning(true); setUploadError('');
    try {
      const res = await executeUpload(parsed.rows);
      setResult(res);
      onDone();
    } catch (err) {
      console.error('Upload failed:', err);
      setUploadError(err.message || String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--tx2)' }}>
        Upload a CSV export of the recruitment template (Division, Role Title, Location, candidate details).
        Existing roles/locations are matched by name; anything new is created automatically.
      </p>
      <input type="file" accept=".csv,.xlsx" onChange={handleFile} />

      {uploadError && <div style={{ marginTop: 12, color: 'var(--dgr-tx)', fontSize: 13 }}><strong>Upload failed:</strong> {uploadError}</div>}

      {parsed && parsed.errors.length > 0 && (
        <div style={{ marginTop: 12, color: 'var(--dgr-tx)', fontSize: 13 }}>
          <strong>Fix these before uploading:</strong>
          <ul>{parsed.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}

      {parsed && parsed.errors.length === 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, marginBottom: 8 }}>{parsed.rows.length} rows ready to upload.</div>
          <button onClick={runUpload} disabled={running} style={primaryBtnStyle()}>{running ? 'Uploading…' : 'Upload'}</button>
        </div>
      )}

      {result && (
        <div style={{ marginTop: 16, fontSize: 13 }}>
          <div>{result.created} rows created successfully.</div>
          {result.failed.length > 0 && (
            <div style={{ color: 'var(--dgr-tx)', marginTop: 8 }}>
              <strong>{result.failed.length} rows failed:</strong>
              <ul>{result.failed.map((f, i) => <li key={i}>Row {f.rowNum}: {f.message}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
