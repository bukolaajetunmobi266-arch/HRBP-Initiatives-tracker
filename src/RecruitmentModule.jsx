// RecruitmentModule.jsx
// Recruitment section of the People Management Tracker — rendered inside the
// sidebar's "Recruitment" mode. Uses the SAME CSS variables (--bg0, --acc-fill,
// --dgr-bg, etc.) already defined in App.jsx's LIGHT/DARK theme objects, so it
// inherits dark mode and looks like one product rather than a bolted-on module.

import React, { useEffect, useState, useCallback } from 'react';
import {
  getCurrentUserScope, fetchDivisions, fetchRoleLocationsWithCandidates,
  computeDashboardMetrics, computeStalledOnboarding, computeTimeToClose, computeTimeToOnboard,
  fetchMyNotifications, fetchRecruitmentYears,
} from './recruitmentData';
import { parseUploadFile, parseXlsxUploadFile, executeUpload, executeCandidateUpload } from './recruitmentUpload';
import {
  bulkUpdateCandidateStatus, updateCandidateStatus, updateCandidate, moveCandidate,
  createRole, createRoleLocation, updateRole, updateRoleLocation, addCandidate,
  syncStalledNotifications, markNotificationRead, checkCandidateDuplicate,
  deleteCandidates,
} from './recruitmentActions';

// ---------------------------------------------------------------
// Shared style helpers — same pattern and same CSS variables as App.jsx
// ---------------------------------------------------------------
function inputStyle(extra = {}) { return { background: 'var(--bg2)', color: 'var(--tx1)', border: '1px solid var(--bds)', borderRadius: 6, padding: '8px 10px', fontSize: 13, ...extra }; }
function btnStyle(extra = {}) { return { fontSize: 13, background: 'var(--bg2)', border: '1px solid var(--bds)', borderRadius: 6, padding: '7px 12px', cursor: 'pointer', color: 'var(--tx1)', ...extra }; }
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

const STATUS_OPTIONS = ['Sourcing', 'Interview', 'Onboarding Approval', 'Documentation', 'Offer', 'Awaiting Resumption', 'Closed', 'Dropped', 'Rejected', 'On Hold', 'Cancelled'];
const SECURED_STATUSES = ['Offer', 'Awaiting Resumption', 'Closed'];
const EMPLOYMENT_TYPE_OPTIONS = ['Full-Time', 'Contract', 'Affiliate', 'Intern'];
function employmentTypeState(value) {
  return { value: value || '', locked: false, required: false };
}

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
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 60 }}
    >
      <div
        onMouseDown={event => event.stopPropagation()}
        style={{ background: 'var(--bg2)', color: 'var(--tx1)', borderRadius: 12, width: '100%', maxWidth, maxHeight: '85vh', overflowY: 'auto', padding: 20 }}
      >
        {children}
      </div>
    </div>
  );
}

// =================================================================
// Root component
// =================================================================
export default function RecruitmentModule({ tab, setTab }) {
  const [scope, setScope] = useState(null);
  const [divisions, setDivisions] = useState([]);
  const [requestYears, setRequestYears] = useState([]);
  const [filters, setFilters] = useState(() => {
    try {
      const saved = localStorage.getItem('hrbp_recruitment_filters');
      return saved ? { divisionId: '', roleId: '', location: '', year: '', employmentType: '', stage: '', ...JSON.parse(saved) } : { divisionId: '', roleId: '', location: '', year: '', employmentType: '', stage: '' };
    } catch {
      return { divisionId: '', roleId: '', location: '', year: '', employmentType: '', stage: '' };
    }
  });

  useEffect(() => {
    try { localStorage.setItem('hrbp_recruitment_filters', JSON.stringify(filters)); } catch {}
  }, [filters]);
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
        const [divs, years] = await Promise.all([fetchDivisions(), fetchRecruitmentYears()]);
        setDivisions(divs);
        setRequestYears(years);
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
  const canDeleteCandidates = ['admin', 'recruitment_admin'].includes(scope.recruitment_role);

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
      <div data-recruitment-header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20, marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 24, lineHeight: 1.15, margin: 0, fontWeight: 700, letterSpacing: '-0.5px', color: 'var(--navy)' }}>Recruitment Tracker</h1>
          <p style={{ fontSize: 12, color: 'var(--txm)', margin: '5px 0 0' }}>Track requisitions, candidate movement and hiring progress.</p>
        </div>
        <div data-recruitment-actions><RecruitmentNotificationBell
          notifications={notifications}
          myUserId={scope.id}
          onRead={async (id) => { await markNotificationRead(id, scope.id); const list = await fetchMyNotifications(); setNotifications(list); }}
        /></div>
      </div>

      <TabNav tab={tab} setTab={setTab} />
      <FilterBar
        divisions={divisions} roles={uniqueRoles} locations={uniqueLocations}
        filters={filters} setFilters={setFilters}
        years={requestYears}
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
            />
          )}
          {tab === 'candidates' && (
            <CandidatesTab
              rowsWithCandidates={rowsWithCandidates}
              initialStatusFilter={candidateStatusFilter}
              initialLocationFilter={candidateLocationFilter}
              stalled={stalled}
              canDeleteCandidates={canDeleteCandidates}
              onChanged={reload}
            />
          )}
        </>
      )}
    </div>
  );
}

// =================================================================
// Nav + Filters
// =================================================================
function TabNav({ tab, setTab }) {
  const tabs = [['overview', 'Overview'], ['roles', 'Roles'], ['candidates', 'Candidates']];
  return (
    <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--bd)', marginBottom: 18 }}>
      {tabs.map(([id, label]) => (
        <button key={id} onClick={() => setTab(id)}
          style={{ border: 'none', borderBottom: tab === id ? '2px solid var(--acc-fill)' : '2px solid transparent', background: 'transparent', color: tab === id ? 'var(--acc-tx)' : 'var(--tx2)', fontSize: 13, fontWeight: tab === id ? 650 : 500, padding: '9px 16px 10px', cursor: 'pointer' }}>
          {label}
        </button>
      ))}
    </div>
  );
}

function FilterBar({ divisions, roles, locations, years, filters, setFilters, showDivisionFilter }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filters);

  useEffect(() => { if (open) setDraft(filters); }, [open, filters]);

  const activeCount = Object.values(filters).filter(Boolean).length;

  function update(key, value) {
    setDraft(f => ({ ...f, [key]: value }));
  }

  function apply() {
    setFilters(draft);
    setOpen(false);
  }

  function clearAll() {
    const empty = { divisionId: '', roleId: '', location: '', year: '', employmentType: '', stage: '' };
    setDraft(empty);
    setFilters(empty);
    setOpen(false);
  }

  function removeFilter(key) {
    setFilters(f => ({ ...f, [key]: '' }));
  }

  const divisionName = divisions.find(d => d.division_id === filters.divisionId)?.name;
  const roleName = roles.find(r => r.role_id === filters.roleId)?.role_title;

  const chips = [
    showDivisionFilter && filters.divisionId ? ['divisionId', divisionName || 'Division'] : null,
    filters.roleId ? ['roleId', roleName || 'Role'] : null,
    filters.location ? ['location', filters.location] : null,
    filters.year ? ['year', filters.year] : null,
    filters.employmentType ? ['employmentType', filters.employmentType] : null,
    filters.stage ? ['stage', filters.stage] : null,
  ].filter(Boolean);

  return (
    <div style={{ marginBottom: 18, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={() => setOpen(o => !o)}
          style={{
            ...btnStyle({
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              background: activeCount ? 'var(--acc-bg)' : 'var(--bg2)',
              color: activeCount ? 'var(--acc-tx)' : 'var(--tx1)',
              borderColor: activeCount ? 'var(--acc-fill)' : 'var(--bds)',
            }),
          }}
          aria-expanded={open}
        >
          <span style={{ fontSize: 14 }}>☷</span>
          <span>Filters</span>
          {activeCount > 0 && (
            <span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, background: 'var(--acc-fill)', color: '#fff', fontSize: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              {activeCount}
            </span>
          )}
          <span style={{ fontSize: 10 }}>{open ? '▲' : '▼'}</span>
        </button>

        {chips.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {chips.map(([key, label]) => (
              <button
                key={key}
                onClick={() => removeFilter(key)}
                title="Remove filter"
                style={{ ...btnStyle({ padding: '4px 8px', fontSize: 11, borderRadius: 999, background: 'var(--bg1)', color: 'var(--tx2)' }) }}
              >
                {label} ×
              </button>
            ))}
            <button onClick={clearAll} style={dangerBtnStyle({ fontSize: 11, padding: '3px 4px' })}>Clear all</button>
          </div>
        )}
      </div>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          left: 0,
          zIndex: 45,
          width: 'min(620px, calc(100vw - 40px))',
          background: 'var(--bg2)',
          border: '0.5px solid var(--bds)',
          borderRadius: 12,
          boxShadow: '0 10px 30px rgba(0,0,0,0.14)',
          padding: 16,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Filter recruitment</div>
              <div style={{ fontSize: 11, color: 'var(--txm)', marginTop: 2 }}>Apply filters across the recruitment views.</div>
            </div>
            {activeCount > 0 && <button onClick={clearAll} style={dangerBtnStyle({ fontSize: 11 })}>Clear all</button>}
          </div>

          <div data-recruitment-filter-grid style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            {showDivisionFilter && (
              <label>
                <span style={labelStyle()}>Division</span>
                <select value={draft.divisionId} onChange={e => update('divisionId', e.target.value)} style={inputStyle({ width: '100%' })}>
                  <option value="">All divisions</option>
                  {divisions.map(d => <option key={d.division_id} value={d.division_id}>{d.name}</option>)}
                </select>
              </label>
            )}
            <label>
              <span style={labelStyle()}>Role</span>
              <select value={draft.roleId} onChange={e => update('roleId', e.target.value)} style={inputStyle({ width: '100%' })}>
                <option value="">All roles</option>
                {roles.map(r => <option key={r.role_id} value={r.role_id}>{r.role_title}</option>)}
              </select>
            </label>
            <label>
              <span style={labelStyle()}>Location</span>
              <select value={draft.location} onChange={e => update('location', e.target.value)} style={inputStyle({ width: '100%' })}>
                <option value="">All locations</option>
                {locations.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
            <label>
              <span style={labelStyle()}>Year</span>
              <select value={draft.year} onChange={e => update('year', e.target.value)} style={inputStyle({ width: '100%' })}>
                <option value="">All years</option>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
            <label>
              <span style={labelStyle()}>Employment Type</span>
              <select value={draft.employmentType} onChange={e => update('employmentType', e.target.value)} style={inputStyle({ width: '100%' })}>
                <option value="">All employment types</option>
                {EMPLOYMENT_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label>
              <span style={labelStyle()}>Recruitment Stage</span>
              <select value={draft.stage} onChange={e => update('stage', e.target.value)} style={inputStyle({ width: '100%' })}>
                <option value="">All stages</option>
                {STATUS_OPTIONS.map(stage => <option key={stage} value={stage}>{stage}</option>)}
              </select>
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, paddingTop: 12, borderTop: '0.5px solid var(--bd)' }}>
            <button onClick={() => setOpen(false)} style={btnStyle()}>Cancel</button>
            <button onClick={apply} style={primaryBtnStyle()}>Apply filters</button>
          </div>
        </div>
      )}
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
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--bd)', borderTop: role === 'acc' ? '3px solid var(--acc-fill)' : role === 'suc' ? '3px solid var(--suc-fill)' : role === 'dgr' ? '3px solid var(--dgr-fill)' : '3px solid var(--bds)', borderRadius: 8, padding: '13px 14px', flex: 1, minWidth: 0, boxShadow: '0 1px 2px rgba(15,42,67,0.04)' }}>
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

function CollapsibleSection({ title, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 24 }}>
      <button onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: open ? 8 : 0 }}>
        <span style={{ fontSize: 11, color: 'var(--tx2)' }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontSize: 13, color: 'var(--tx2)', fontWeight: 500 }}>{title}</span>
      </button>
      {open && children}
    </div>
  );
}

function OverviewTab({ metrics, filters, onFunnelClick, onStalledClick, onYetToStartClick, stalledCount }) {
  return (
    <div>
      <div data-recruitment-kpis style={{ display: 'grid', gridTemplateColumns: 'repeat(8, minmax(0, 1fr))', gap: 10, marginBottom: 24 }}>
        <KpiCard label="Total roles" value={metrics.totalRoles} />
        <KpiCard label="Open positions" value={metrics.totalSlots} />
        <div onClick={onYetToStartClick} style={{ cursor: 'pointer' }}><KpiCard label="Yet to start" value={metrics.yetToStartSlots} role="neu" /></div>
        <KpiCard label="Fill rate" value={`${metrics.fillRatePct}%`} role="acc" />
        <KpiCard label="Closure rate" value={`${metrics.closureRatePct}%`} role="suc" />
        <KpiCard label="Avg time to close" value={metrics.avgTimeToClose !== null ? `${metrics.avgTimeToClose}d` : '—'} />
        <KpiCard label="Avg time to onboard" value={metrics.avgTimeToOnboard !== null ? `${metrics.avgTimeToOnboard}d` : '—'} />
        <div onClick={onStalledClick} style={{ cursor: 'pointer' }}><KpiCard label="Stalled onboarding" value={stalledCount} role="dgr" /></div>
      </div>

      <div style={{ background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 8, padding: '15px 16px', marginBottom: 16 }}>
        <CollapsibleSection title="Candidate funnel — click any stage">
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
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
        </CollapsibleSection>
      </div>

      <div style={{ background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 8, padding: '15px 16px', marginBottom: 16 }}>
        <CollapsibleSection title="Closure rates by division">
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
        </CollapsibleSection>
      </div>

      <YearComparisonSection filters={filters} />
    </div>
  );
}

// =================================================================
// Roles — structural only, no candidate list, links out to Candidates
// =================================================================
function locationProgress(rl) {
  const closed = rl.candidates.filter(c => c.status === 'Closed').length;
  const secured = rl.candidates.filter(c => SECURED_STATUSES.includes(c.status)).length;
  const left = Math.max(0, Number(rl.no_of_positions || 0) - closed);
  const pct = rl.no_of_positions ? Math.min(100, Math.round((closed / rl.no_of_positions) * 100)) : 0;
  return { closed, secured, left, pct };
}

function RolesTab({ rowsWithCandidates, onChanged, initialFilterMode, divisions, onViewCandidates }) {
  const [editingRole, setEditingRole] = useState(null);
  const [editingLocation, setEditingLocation] = useState(null);
  const [addingLocationFor, setAddingLocationFor] = useState(null);
  const [showNewRole, setShowNewRole] = useState(false);
  const [showRolesUpload, setShowRolesUpload] = useState(false);
  const [filterMode, setFilterMode] = useState(initialFilterMode || 'all');
  const [expandedDivisions, setExpandedDivisions] = useState({});
  const [expandedRoles, setExpandedRoles] = useState({});

  useEffect(() => { if (initialFilterMode) setFilterMode(initialFilterMode); }, [initialFilterMode]);

  const now = new Date();
  function passesFilter(rl) {
    if (filterMode === 'yetToStart') return rl.derived_status === 'Yet to Start';
    if (filterMode === 'aging') {
      if (['Yet to Start', 'On Hold', 'Cancelled', 'Closed'].includes(rl.derived_status) || !rl.date_request_received) return false;
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
    if (!divisionGroups[divName][roleId]) {
      divisionGroups[divName][roleId] = {
        title: rl.roles.role_title,
        roleType: rl.roles.role_type,
        locations: [],
      };
    }
    divisionGroups[divName][roleId].locations.push(rl);
  }

  const divNames = Object.keys(divisionGroups).sort();

  function exportRoles() {
    const rows = rowsWithCandidates.filter(passesFilter).map(rl => {
      const { closed, left } = locationProgress(rl);
      return {
        Division: rl.roles.divisions.name,
        'Role Title': rl.roles.role_title,
        'Role Type': rl.roles.role_type,
        Location: rl.location,
        'No of Positions': rl.no_of_positions,
        Closed: closed,
        Left: left,
        Status: rl.derived_status,
        'Time to Close (days)': computeTimeToClose(rl) ?? '',
      };
    });
    downloadCsv('roles_export.csv', ['Division', 'Role Title', 'Role Type', 'Location', 'No of Positions', 'Closed', 'Left', 'Status', 'Time to Close (days)'], rows);
  }

  return (
    <div>
      <style>{`
        .role-row:hover .row-actions, .location-card:hover .row-actions { opacity: 1 !important; }
        @media (max-width: 900px) {
          .role-row .row-actions, .location-card .row-actions { opacity: 1 !important; }
          .role-locations { margin-left: 0 !important; }
        }
      `}</style>

      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowRolesUpload(v => !v)}
            aria-label="Open recruitment actions"
            style={btnStyle({ fontSize: 18, lineHeight: 1, padding: '6px 9px', letterSpacing: 2 })}
          >•••</button>
          {showRolesUpload && (
            <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 40, minWidth: 190, background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.14)', padding: 6 }}>
              <button onClick={() => { setShowNewRole(true); setShowRolesUpload(false); }} style={btnStyle({ width: '100%', textAlign: 'left', border: 'none', background: 'transparent' })}>+ New role</button>
              <button onClick={() => { setShowRolesUpload('import'); }} style={btnStyle({ width: '100%', textAlign: 'left', border: 'none', background: 'transparent' })}>Import</button>
              <button onClick={() => exportRoles()} style={btnStyle({ width: '100%', textAlign: 'left', border: 'none', background: 'transparent' })}>Export CSV</button>
              <div style={{ height: 1, background: 'var(--bd)', margin: '5px 4px' }} />
              <button onClick={() => { setFilterMode(filterMode === 'aging' ? 'all' : 'aging'); setShowRolesUpload(false); }} style={btnStyle({ width: '100%', textAlign: 'left', border: 'none', background: 'transparent' })}>Aging (30+ days)</button>
              <button onClick={() => { setFilterMode(filterMode === 'yetToStart' ? 'all' : 'yetToStart'); setShowRolesUpload(false); }} style={btnStyle({ width: '100%', textAlign: 'left', border: 'none', background: 'transparent' })}>Yet to start</button>
            </div>
          )}
        </div>
      </div>

      {divNames.length === 0 && (
        <div style={{ padding: 24, color: 'var(--txm)', textAlign: 'center', background: 'var(--bg1)', borderRadius: 10 }}>
          {filterMode === 'all' ? 'No roles yet. Click "+ New role" or use Upload to get started.' : 'Nothing matches this filter.'}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {divNames.map(divName => {
          const isExpanded = expandedDivisions[divName];
          const roles = Object.values(divisionGroups[divName]);
          const divisionSlots = roles.reduce((sum, role) => sum + role.locations.reduce((a, rl) => a + Number(rl.no_of_positions || 0), 0), 0);
          const divisionClosed = roles.reduce((sum, role) => sum + role.locations.reduce((a, rl) => a + locationProgress(rl).closed, 0), 0);
          const divisionRemaining = Math.max(0, divisionSlots - divisionClosed);

          return (
            <div key={divName} style={{ background: 'var(--bg1)', border: '0.5px solid var(--bd)', borderRadius: 12, overflow: 'hidden' }}>
              <button onClick={() => setExpandedDivisions(c => ({ ...c, [divName]: !c[divName] }))}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', cursor: 'pointer', padding: '12px 14px', textAlign: 'left' }}>
                <span style={{ fontSize: 12, color: 'var(--tx2)' }}>{isExpanded ? '▾' : '▸'}</span>
                <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{divName}</span>
                <span style={{ fontSize: 11, color: 'var(--txm)' }}>{roles.length} role{roles.length !== 1 ? 's' : ''}</span>
                <span style={{ fontSize: 11, color: 'var(--tx2)' }}>{divisionSlots} slots</span>
                <span style={{ fontSize: 11, color: divisionRemaining ? 'var(--wrn-tx)' : 'var(--suc-tx)' }}>{divisionRemaining} to be filled</span>
              </button>

              {isExpanded && (
                <div style={{ borderTop: '0.5px solid var(--bd)', padding: '4px 14px 14px' }}>
                  {Object.entries(divisionGroups[divName]).map(([roleId, role]) => {
                    const totalPositions = role.locations.reduce((sum, rl) => sum + Number(rl.no_of_positions || 0), 0);
                    const totalClosed = role.locations.reduce((sum, rl) => sum + locationProgress(rl).closed, 0);
                    const totalRemaining = Math.max(0, totalPositions - totalClosed);
                    const roleIsExpanded = expandedRoles[roleId];

                    return (
                      <div key={roleId} className="role-row" style={{ padding: '12px 0', borderBottom: '0.5px solid var(--bd)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <button onClick={() => setExpandedRoles(c => ({ ...c, [roleId]: !c[roleId] }))}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tx2)', fontSize: 12, padding: 0 }}>
                            {roleIsExpanded ? '▾' : '▸'}
                          </button>
                          <div style={{ flex: 1, minWidth: 180 }}>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{role.title}</div>
                            <div style={{ fontSize: 11, color: 'var(--txm)', marginTop: 2 }}>{role.locations.length} location{role.locations.length !== 1 ? 's' : ''} · {totalPositions} slots</div>
                          </div>
                          <span style={{ fontSize: 11, color: 'var(--tx2)', whiteSpace: 'nowrap' }}>{totalClosed} closed · {totalRemaining} to be filled</span>
                          <span style={{ fontSize: 11, color: totalRemaining ? 'var(--wrn-tx)' : 'var(--suc-tx)', background: totalRemaining ? 'var(--wrn-bg)' : 'var(--suc-bg)', padding: '3px 8px', borderRadius: 999 }}>
                            {totalRemaining ? 'Open' : 'Closed'}
                          </span>
                          <span className="row-actions" style={{ display: 'flex', gap: 6, opacity: 0, transition: 'opacity 0.1s' }}>
                            <button onClick={() => setEditingRole({ roleId, title: role.title, roleType: role.roleType })} style={dangerBtnStyle({ color: 'var(--acc-tx)' })}>Edit</button>
                            <button onClick={() => setAddingLocationFor(roleId)} style={dangerBtnStyle({ color: 'var(--acc-tx)' })}>+ Location</button>
                          </span>
                        </div>

                        {roleIsExpanded && (
                          <div className="role-locations" style={{ marginTop: 10, marginLeft: 28, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {role.locations.map(rl => {
                              const { closed, left } = locationProgress(rl);
                              const status = left === 0 ? 'Closed' : rl.derived_status;
                              const ageDays = rl.date_request_received
                                ? Math.max(0, Math.floor((Date.now() - new Date(rl.date_request_received).getTime()) / 86400000))
                                : null;
                              const startDate = rl.planned_start_date
                                ? new Date(rl.planned_start_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                                : null;

                              return (
                                <div key={rl.role_location_id} className="location-card" style={{ background: 'var(--bg1)', border: '0.5px solid var(--bd)', borderRadius: 9, padding: '11px 12px' }}>
                                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                                    <div style={{ minWidth: 0 }}>
                                      <div style={{ fontSize: 13, fontWeight: 600 }}>{rl.location}</div>
                                      <div style={{ fontSize: 11, color: 'var(--txm)', marginTop: 3 }}>
                                        {rl.no_of_positions} slots · {closed} closed · {left} to be filled
                                      </div>
                                    </div>
                                    <span style={{
                                      flexShrink: 0, fontSize: 11, padding: '3px 8px', borderRadius: 999,
                                      background: status === 'Closed' ? 'var(--suc-bg)' : status === 'Yet to Start' ? 'var(--neu-bg)' : 'var(--acc-bg)',
                                      color: status === 'Closed' ? 'var(--suc-tx)' : status === 'Yet to Start' ? 'var(--neu-tx)' : 'var(--acc-tx)',
                                      whiteSpace: 'nowrap'
                                    }}>{status}</span>
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 8, fontSize: 11, color: 'var(--txm)' }}>
                                    {startDate && <span>Start Date · {startDate}</span>}
                                    {ageDays !== null && ageDays >= 30 && status !== 'Closed' && <span>· {ageDays} days open</span>}
                                  </div>

                                  <div className="row-actions" style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8, opacity: 0, transition: 'opacity 0.1s' }}>
                                    <button onClick={() => onViewCandidates(rl.role_location_id)} style={dangerBtnStyle({ color: 'var(--acc-tx)' })}>Candidates ({rl.candidates.length})</button>
                                    <button onClick={() => setEditingLocation(rl)} style={dangerBtnStyle({ color: 'var(--acc-tx)' })}>Edit</button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {addingLocationFor === roleId && (
                          <QuickAddLocationForm roleId={roleId} onDone={() => { setAddingLocationFor(null); onChanged(); }} onCancel={() => setAddingLocationFor(null)} />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editingRole && <EditRoleModal role={editingRole} onClose={() => setEditingRole(null)} onSaved={() => { setEditingRole(null); onChanged(); }} />}
      {editingLocation && <EditLocationModal rl={editingLocation} onClose={() => setEditingLocation(null)} onSaved={() => { setEditingLocation(null); onChanged(); }} />}
      {showNewRole && <NewRoleModal divisions={divisions} onClose={() => setShowNewRole(false)} onSaved={() => { setShowNewRole(false); onChanged(); }} />}
      {showRolesUpload === 'import' && (
        <BulkUploadModal
          title="Import recruitment data"
          helpText="Upload the completed Recruitment Tracker Excel template to add recruitment roles, locations and candidates."
          executor={executeUpload}
          mode="roles"
          onClose={() => setShowRolesUpload(false)}
          onDone={() => { setShowRolesUpload(false); onChanged(); }}
        />
      )}
    </div>
  );
}

function QuickAddLocationForm({ roleId, onDone, onCancel }) {
  const today = new Date().toISOString().slice(0, 10);
  const [location, setLocation] = useState('');
  const [noOfPositions, setNoOfPositions] = useState('');
  const [dateRequestReceived, setDateRequestReceived] = useState(today);
  const [plannedStartDate, setPlannedStartDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!location.trim() || !noOfPositions) { setError('Location and No. of Positions are required.'); return; }
    setSaving(true); setError('');
    try {
      await createRoleLocation({
        roleId,
        location: location.trim(),
        noOfPositions: Number(noOfPositions),
        status: 'Open',
        plannedStartDate: plannedStartDate || null,
        dateRequestReceived,
      });
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
      <label style={{ fontSize: 12, color: 'var(--tx2)', display: 'flex', alignItems: 'center', gap: 4 }}>
        Start Date
        <input type="date" value={plannedStartDate} onChange={e => setPlannedStartDate(e.target.value)} style={inputStyle({ width: 130 })} />
      </label>
      <label style={{ fontSize: 12, color: 'var(--tx2)', display: 'flex', alignItems: 'center', gap: 4 }}>
        Requested
        <input type="date" value={dateRequestReceived} onChange={e => setDateRequestReceived(e.target.value)} style={inputStyle({ width: 130 })} />
      </label>
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
        <option>Sales</option><option>Support</option>
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
  const [dateLocationClosed, setDateLocationClosed] = useState(rl.date_location_closed || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setSaving(true); setError('');
    try {
      await updateRoleLocation({
        roleLocationId: rl.role_location_id, location, noOfPositions: Number(noOfPositions), status,
        plannedStartDate: plannedStartDate || null, dateRequestReceived: dateRequestReceived || null,
        dateLocationClosed: dateLocationClosed || null,
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
      <label style={labelStyle()}>Status override</label>
      <select value={status} onChange={e => setStatus(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 4 })}>
        <option>Open</option><option>On Hold</option><option>Cancelled</option><option>Closed</option>
      </select>
      <div style={{ fontSize: 11, color: 'var(--txm)', marginBottom: 10 }}>Status is normally derived from the Start Date and candidate pipeline. Use On Hold or Cancelled for manual overrides.</div>
      <label style={labelStyle()}>Start Date</label>
      <input type="date" value={plannedStartDate} onChange={e => setPlannedStartDate(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 4 })} />
      <div style={{ fontSize: 11, color: 'var(--txm)', marginBottom: 10 }}>A future date will automatically show this recruitment as Yet to Start.</div>
      <label style={labelStyle()}>Date request received</label>
      <input type="date" value={dateRequestReceived} onChange={e => setDateRequestReceived(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />
      <label style={labelStyle()}>Date location closed</label>
      <input type="date" value={dateLocationClosed} onChange={e => setDateLocationClosed(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />
      <p style={{ fontSize: 11, color: 'var(--txm)', marginTop: -6, marginBottom: 10 }}>This is what Time to Close is calculated from — leave blank until every position here is filled.</p>
      {error && <div style={{ color: 'var(--dgr-tx)', fontSize: 12, marginBottom: 8 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={btnStyle()}>Cancel</button>
        <button onClick={submit} disabled={saving} style={primaryBtnStyle()}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
  );
}

function NewRoleModal({ divisions, onClose, onSaved }) {
  const today = new Date().toISOString().slice(0, 10);
  const [divisionId, setDivisionId] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [roleType, setRoleType] = useState('Sales');
  const [suggestedGrade, setSuggestedGrade] = useState('');
  const [location, setLocation] = useState('');
  const [noOfPositions, setNoOfPositions] = useState('');
  const [status, setStatus] = useState('Open');
  const [plannedStartDate, setPlannedStartDate] = useState('');
  const [dateRequestReceived, setDateRequestReceived] = useState(today);
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
        <option>Sales</option><option>Support</option>
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
      <label style={labelStyle()}>Start Date</label>
      <input type="date" value={plannedStartDate} onChange={e => setPlannedStartDate(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 4 })} />
      <div style={{ fontSize: 11, color: 'var(--txm)', marginBottom: 10 }}>A future date will automatically show this recruitment as Yet to Start.</div>
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
function CandidatesTab({ rowsWithCandidates, initialStatusFilter, initialLocationFilter, stalled, canDeleteCandidates, onChanged }) {
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter);
  const [locationFilter, setLocationFilter] = useState(initialLocationFilter);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [bulkStatus, setBulkStatus] = useState('');
  const [error, setError] = useState('');
  const [showAddCandidate, setShowAddCandidate] = useState(false);
  const [showCandidateUpload, setShowCandidateUpload] = useState(false);
  const [profileCandidate, setProfileCandidate] = useState(null); // { candidate, rl }
  const [deleting, setDeleting] = useState(false);

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
      'Employment Type': c.employment_type || '', Status: c.status, Source: c.source || '', Phone: c.contact_phone || '',
      'Time to Onboard (days)': computeTimeToOnboard(c) ?? '',
    }));
    downloadCsv('candidates_export.csv', ['Name', 'Division', 'Role', 'Location', 'Employment Type', 'Status', 'Source', 'Phone', 'Time to Onboard (days)'], rows);
  }

  const [pendingStatusChange, setPendingStatusChange] = useState(null); // { candidateId, newStatus, rl }

  const STATUSES_NEEDING_DATE = ['Interview', 'Onboarding Approval', 'Documentation', 'Offer', 'Awaiting Resumption', 'Closed', 'Dropped', 'Rejected'];

  async function quickChangeStatus(candidateId, newStatus, rl, previousStatus) {
    if (STATUSES_NEEDING_DATE.includes(newStatus)) {
      setPendingStatusChange({ candidateId, newStatus, rl, previousStatus });
      return;
    }
    setError('');
    try {
      await updateCandidateStatus(candidateId, newStatus);
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  const [pendingBulkStatus, setPendingBulkStatus] = useState(null); // { candidateIds, newStatus }

  async function applyBulk() {
    if (!bulkStatus || selected.size === 0) return;
    if (STATUSES_NEEDING_DATE.includes(bulkStatus)) {
      const selectedCandidates = flat.filter(c => selected.has(c.candidate_id));
      setPendingBulkStatus({ candidates: selectedCandidates, newStatus: bulkStatus });
      return;
    }
    try {
      await bulkUpdateCandidateStatus([...selected], bulkStatus);
      setSelected(new Set());
      setBulkStatus('');
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteSelectedCandidates() {
    if (!canDeleteCandidates || selected.size === 0) return;
    const count = selected.size;
    const confirmed = window.confirm(
      `Delete ${count} selected candidate${count === 1 ? '' : 's'} permanently? This cannot be undone.`
    );
    if (!confirmed) return;

    setDeleting(true);
    setError('');
    try {
      await deleteCandidates([...selected]);
      setSelected(new Set());
      onChanged();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setDeleting(false);
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
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowCandidateUpload(v => !v)}
            aria-label="Open candidate actions"
            style={btnStyle({ fontSize: 18, lineHeight: 1, padding: '6px 9px', letterSpacing: 2 })}
          >•••</button>
          {showCandidateUpload && (
            <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 40, minWidth: 170, background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.14)', padding: 6 }}>
              <button onClick={() => { setShowAddCandidate(true); setShowCandidateUpload(false); }} style={btnStyle({ width: '100%', textAlign: 'left', border: 'none', background: 'transparent' })}>+ Add candidate</button>
              <button onClick={() => setShowCandidateUpload('import')} style={btnStyle({ width: '100%', textAlign: 'left', border: 'none', background: 'transparent' })}>Import</button>
              <button onClick={() => exportCandidates()} style={btnStyle({ width: '100%', textAlign: 'left', border: 'none', background: 'transparent' })}>Export CSV</button>
            </div>
          )}
        </div>
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
          {canDeleteCandidates && (
            <button onClick={deleteSelectedCandidates} disabled={deleting} style={dangerBtnStyle({ color: 'var(--dgr-tx)', border: '1px solid var(--dgr-tx)', borderRadius: 8, padding: '6px 10px' })}>
              {deleting ? 'Deleting…' : 'Delete selected'}
            </button>
          )}
        </div>
      )}
      {error && <div style={{ color: 'var(--dgr-tx)', fontSize: 13, marginBottom: 8 }}>{error}</div>}

      <div className="recruitment-table-wrap" style={{ border: '0.5px solid var(--bd)', borderRadius: 8, overflowX: 'auto', overflowY: 'hidden' }}>
        <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--bg1)' }}>
              <th style={{ padding: '8px 10px', width: 36 }}>
                <input
                  type="checkbox"
                  aria-label="Select all visible candidates"
                  checked={flat.length > 0 && flat.every(c => selected.has(c.candidate_id))}
                  onChange={e => {
                    if (e.target.checked) {
                      setSelected(new Set(flat.map(c => c.candidate_id)));
                    } else {
                      setSelected(new Set());
                    }
                  }}
                />
              </th>
              <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 500, color: 'var(--tx2)' }}>Name</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 500, color: 'var(--tx2)' }}>Division</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 500, color: 'var(--tx2)' }}>Role</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 500, color: 'var(--tx2)' }}>Location</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 500, color: 'var(--tx2)' }}>Employment Type</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 500, color: 'var(--tx2)' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {flat.map(c => {
              const isStalled = stalledIds.has(c.candidate_id);
              return (
                <tr key={c.candidate_id} style={{ borderTop: '0.5px solid var(--bd)', background: isStalled ? 'var(--dgr-bg)' : 'transparent' }}>
                  <td style={{ padding: '8px 10px' }}>
                    <input type="checkbox" checked={selected.has(c.candidate_id)} onChange={e => {
                      const next = new Set(selected);
                      e.target.checked ? next.add(c.candidate_id) : next.delete(c.candidate_id);
                      setSelected(next);
                    }} />
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'left' }}>
                    <button onClick={() => setProfileCandidate({ candidate: c, rl: c.rl })} style={{ background: 'none', border: 'none', color: 'var(--acc-tx)', cursor: 'pointer', padding: 0, fontSize: 13, textDecoration: 'underline', textAlign: 'left' }}>
                      {c.candidate_name}
                    </button>
                    {isStalled && <span style={{ marginLeft: 6, color: 'var(--dgr-tx)' }}>⚠</span>}
                  </td>
                  <td style={{ padding: '8px 10px', color: 'var(--tx2)' }}>{c.division}</td>
                  <td style={{ padding: '8px 10px', color: 'var(--tx2)' }}>{c.roleTitle}</td>
                  <td style={{ padding: '8px 10px', color: 'var(--tx2)' }}>{c.location}</td>
                  <td style={{ padding: '8px 10px', color: 'var(--tx2)' }}>{c.employment_type || '—'}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <select value={c.status} onChange={e => quickChangeStatus(c.candidate_id, e.target.value, c.rl, c.status)} style={inputStyle({ padding: '3px 6px', fontSize: 12 })}>
                      {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {flat.length === 0 && <div style={{ padding: 20, color: 'var(--txm)', textAlign: 'center' }}>No candidates match this filter.</div>}
      </div>

      {showAddCandidate && (
        <AddCandidateModal rowsWithCandidates={rowsWithCandidates} presetRoleLocationId={locationFilter} onClose={() => setShowAddCandidate(false)} onSaved={() => { setShowAddCandidate(false); onChanged(); }} />
      )}
      {showCandidateUpload === 'import' && (
        <BulkUploadModal
          title="Import candidates"
          helpText="Upload candidates against existing roles/locations using the same streamlined template. Employment Type is required for mixed roles such as Relationship Officer."
          executor={executeCandidateUpload}
          mode="candidates"
          onClose={() => setShowCandidateUpload(false)}
          onDone={() => { setShowCandidateUpload(false); onChanged(); }}
        />
      )}
      {profileCandidate && (
        <CandidateProfilePanel
          candidate={profileCandidate.candidate}
          currentRl={profileCandidate.rl}
          allRows={rowsWithCandidates}
          canDelete={canDeleteCandidates}
          onClose={() => setProfileCandidate(null)}
          onSaved={() => { setProfileCandidate(null); onChanged(); }}
        />
      )}
      {pendingStatusChange && (
        <StatusDateModal
          pending={pendingStatusChange}
          onClose={() => setPendingStatusChange(null)}
          onSaved={() => { setPendingStatusChange(null); onChanged(); }}
        />
      )}
      {pendingBulkStatus && (
        <BulkStatusDateModal
          pending={pendingBulkStatus}
          onClose={() => setPendingBulkStatus(null)}
          onSaved={() => { setPendingBulkStatus(null); setSelected(new Set()); setBulkStatus(''); onChanged(); }}
        />
      )}
    </div>
  );
}

function AddCandidateModal({ rowsWithCandidates, presetRoleLocationId, onClose, onSaved }) {
  const presetRl = presetRoleLocationId ? rowsWithCandidates.find(rl => rl.role_location_id === presetRoleLocationId) : null;

  const [divisionName, setDivisionName] = useState('');
  const [roleId, setRoleId] = useState('');
  const [roleLocationId, setRoleLocationId] = useState(presetRoleLocationId || '');
  const [candidateName, setCandidateName] = useState('');
  const [employmentType, setEmploymentType] = useState('');
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

  const [duplicateWarning, setDuplicateWarning] = useState(null);
  const [confirmedDespiteDuplicate, setConfirmedDespiteDuplicate] = useState(false);

  function normPhone(p) { return (p || '').replace(/[\s\-+]/g, ''); }

  async function checkForDuplicate() {
    const name = candidateName.trim().toLowerCase();
    const phone = normPhone(contactPhone);
    // Cheap client-side check first — covers everything already visible to
    // this user, no network call needed.
    const localMatch = rowsWithCandidates.flatMap(rl => rl.candidates.map(c => ({ ...c, rl }))).find(c =>
      !['Dropped', 'Rejected'].includes(c.status) &&
      ((name && c.candidate_name?.trim().toLowerCase() === name) || (phone && normPhone(c.contact_phone) === phone))
    );
    if (localMatch) {
      return { found: true, within_scope: true, candidate_name: localMatch.candidate_name, division_name: localMatch.rl.roles.divisions.name, role_title: localMatch.rl.roles.role_title, location: localMatch.rl.location, status: localMatch.status };
    }
    // Nothing visible locally — ask the server whether a match exists
    // somewhere outside this user's own scope.
    try {
      return await checkCandidateDuplicate(candidateName.trim(), contactPhone.trim());
    } catch {
      return { found: false }; // don't block adding a candidate if the check itself fails
    }
  }

  async function submit() {
    if (!roleLocationId || !candidateName.trim()) { setError('Role/Location and Candidate Name are required.'); return; }
    const selectedRl = rowsWithCandidates.find(rl => rl.role_location_id === roleLocationId);
    const typeState = employmentTypeState(employmentType);
    if (!employmentType) { setError('Employment Type is required.'); return; }
    if (!confirmedDespiteDuplicate) {
      const dup = await checkForDuplicate();
      if (dup.found) {
        setDuplicateWarning(dup);
        return;
      }
    }
    setSaving(true); setError('');
    try {
      await addCandidate({ roleLocationId, candidateName: candidateName.trim(), employmentType: employmentType, contactPhone, source, status });
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <div style={{ fontWeight: 600, marginBottom: 12 }}>Add candidate</div>
      {presetRl ? (
        <div style={{ background: 'var(--acc-bg)', color: 'var(--acc-tx)', borderRadius: 6, padding: 10, marginBottom: 12, fontSize: 13 }}>
          {presetRl.roles.divisions.name} → {presetRl.roles.role_title} → {presetRl.location}
        </div>
      ) : (
        <>
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
        </>
      )}
      <label style={labelStyle()}>Candidate name</label>
      <input value={candidateName} onChange={e => setCandidateName(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />
      {(() => {
        const role = presetRl || rowsWithCandidates.find(rl => rl.role_location_id === roleLocationId);
        const typeState = employmentTypeState(employmentType);
        return (
          <>
            <label style={labelStyle()}>Employment Type</label>
            {typeState.locked ? (
              <>
                <input value={typeState.value} disabled style={inputStyle({ width: '100%', marginBottom: 4, opacity: 0.75 })} />
                <div style={{ fontSize: 11, color: 'var(--txm)', marginBottom: 10 }}></div>
              </>
            ) : (
              <>
                <select value={employmentType} onChange={e => setEmploymentType(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 4 })}>
                  <option value="">Select employment type…</option>
                  {EMPLOYMENT_TYPE_OPTIONS.map(t => <option key={t}>{t}</option>)}
                </select>
                <div style={{ fontSize: 11, color: 'var(--txm)', marginBottom: 10 }}>Select the engagement type for this candidate.</div>
              </>
            )}
          </>
        );
      })()}
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
      {duplicateWarning && (
        <div style={{ background: 'var(--wrn-bg)', color: 'var(--wrn-tx)', borderRadius: 6, padding: 10, marginBottom: 10, fontSize: 13 }}>
          {duplicateWarning.within_scope
            ? `${duplicateWarning.candidate_name} already appears in ${duplicateWarning.role_title} at ${duplicateWarning.location} (${duplicateWarning.division_name}) — status: ${duplicateWarning.status}.`
            : 'This name or phone number already appears in another division\'s pipeline. Details are hidden since you don\'t have access to that division.'}
          <div style={{ marginTop: 8 }}>
            <button onClick={() => { setConfirmedDespiteDuplicate(true); setDuplicateWarning(null); }} style={btnStyle()}>Add anyway</button>
            <button onClick={() => setDuplicateWarning(null)} style={{ ...btnStyle(), marginLeft: 6 }}>Cancel</button>
          </div>
        </div>
      )}
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
// Prompts for the specific date(s) a status transition actually needs, right
// when the analyst makes the change — instead of relying on a separate trip
// to the candidate's profile later. Also detects when this change fills the
// last open position at a location, and offers to close the location too
// (the date Time to Close is calculated from).
function StatusDateModal({ pending, onClose, onSaved }) {
  const { candidateId, newStatus, rl, previousStatus } = pending;
  const today = new Date().toISOString().slice(0, 10);

  const [dateInterview, setDateInterview] = useState(today);
  const [dateSentForApproval, setDateSentForApproval] = useState(today);
  const [dateDocumentationStarted, setDateDocumentationStarted] = useState(today);
  const [medicalReportReceived, setMedicalReportReceived] = useState(false);
  const [dateOfferExtended, setDateOfferExtended] = useState(today);
  const [dateOfferAccepted, setDateOfferAccepted] = useState(today);
  const [expectedResumptionDate, setExpectedResumptionDate] = useState('');
  const [actualResumptionDate, setActualResumptionDate] = useState(today);
  const [dateClosed, setDateClosed] = useState(today);
  const [statusReason, setStatusReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const closedSoFar = rl.candidates.filter(c => c.status === 'Closed' && c.candidate_id !== candidateId).length;
  const willFillLastPosition = newStatus === 'Closed' && (closedSoFar + 1) >= rl.no_of_positions && rl.status !== 'Closed';
  const isExit = newStatus === 'Dropped' || newStatus === 'Rejected';

  async function submit() {
    if (newStatus === 'Awaiting Resumption' && !expectedResumptionDate) {
      setError('Expected resumption date is required.');
      return;
    }
    if (isExit && !statusReason.trim()) {
      setError('A reason is required.');
      return;
    }
    setSaving(true); setError('');
    try {
      const extra = {};
      if (newStatus === 'Interview') extra.date_interview = dateInterview;
      if (newStatus === 'Onboarding Approval') extra.date_sent_for_onboarding_approval = dateSentForApproval;
      if (newStatus === 'Documentation') {
        extra.date_documentation_started = dateDocumentationStarted;
        extra.medical_report_received = medicalReportReceived;
      }
      if (newStatus === 'Offer') extra.date_offer_extended = dateOfferExtended;
      if (newStatus === 'Awaiting Resumption') {
        extra.date_offer_accepted = dateOfferAccepted;
        extra.expected_resumption_date = expectedResumptionDate;
      }
      if (newStatus === 'Closed') {
        extra.actual_resumption_date = actualResumptionDate;
        extra.date_closed = dateClosed;
      }
      if (isExit) {
        extra.status_reason = statusReason.trim();
        extra.status_stage_at_exit = previousStatus;
      }
      await updateCandidateStatus(candidateId, newStatus, extra);

      if (willFillLastPosition) {
        await updateRoleLocation({
          roleLocationId: rl.role_location_id, location: rl.location, noOfPositions: rl.no_of_positions,
          status: 'Closed', plannedStartDate: rl.planned_start_date, dateRequestReceived: rl.date_request_received,
          dateLocationClosed: dateClosed,
        });
      }
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <div style={{ fontWeight: 600, marginBottom: 12 }}>Moving to "{newStatus}"</div>

      {newStatus === 'Interview' && (
        <>
          <label style={labelStyle()}>Date of interview</label>
          <input type="date" value={dateInterview} onChange={e => setDateInterview(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />
        </>
      )}

      {newStatus === 'Onboarding Approval' && (
        <>
          <label style={labelStyle()}>Date sent for onboarding approval</label>
          <input type="date" value={dateSentForApproval} onChange={e => setDateSentForApproval(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />
        </>
      )}

      {newStatus === 'Documentation' && (
        <>
          <label style={labelStyle()}>Date documentation started</label>
          <input type="date" value={dateDocumentationStarted} onChange={e => setDateDocumentationStarted(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 10 }}>
            <input type="checkbox" checked={medicalReportReceived} onChange={e => setMedicalReportReceived(e.target.checked)} />
            Medical report received
          </label>
        </>
      )}

      {newStatus === 'Offer' && (
        <>
          <label style={labelStyle()}>Date offer extended</label>
          <input type="date" value={dateOfferExtended} onChange={e => setDateOfferExtended(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />
        </>
      )}

      {newStatus === 'Awaiting Resumption' && (
        <>
          <label style={labelStyle()}>Date offer accepted</label>
          <input type="date" value={dateOfferAccepted} onChange={e => setDateOfferAccepted(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />
          <label style={labelStyle()}>Expected resumption date</label>
          <input type="date" value={expectedResumptionDate} onChange={e => setExpectedResumptionDate(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />
        </>
      )}

      {newStatus === 'Closed' && (
        <>
          <label style={labelStyle()}>Actual resumption date</label>
          <input type="date" value={actualResumptionDate} onChange={e => setActualResumptionDate(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />
          <label style={labelStyle()}>Date closed</label>
          <input type="date" value={dateClosed} onChange={e => setDateClosed(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />

          {willFillLastPosition && (
            <div style={{ background: 'var(--suc-bg)', borderRadius: 6, padding: 10, marginBottom: 10, fontSize: 13, color: 'var(--suc-tx)' }}>
              This fills all {rl.no_of_positions} position{rl.no_of_positions > 1 ? 's' : ''} at {rl.location} — the location will be marked Closed automatically, using this same date. You can change it later from the Roles tab if needed.
            </div>
          )}
        </>
      )}

      {isExit && (
        <>
          <label style={labelStyle()}>Reason</label>
          <input value={statusReason} onChange={e => setStatusReason(e.target.value)} placeholder="e.g. Failed medical, Offer declined, Withdrew" style={inputStyle({ width: '100%', marginBottom: 10 })} />
          <p style={{ fontSize: 11, color: 'var(--txm)', marginTop: -6, marginBottom: 10 }}>Recorded as dropping out at the "{previousStatus}" stage.</p>
        </>
      )}

      {error && <div style={{ color: 'var(--dgr-tx)', fontSize: 12, marginBottom: 8 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={btnStyle()}>Cancel</button>
        <button onClick={submit} disabled={saving} style={primaryBtnStyle()}>{saving ? 'Saving…' : 'Confirm'}</button>
      </div>
    </Modal>
  );
}

// Same idea as StatusDateModal, for the bulk-select path. One shared date is
// applied to every selected candidate. Deliberately does NOT offer to
// auto-close a location the way the single-candidate version does — a bulk
// selection can span multiple locations, and guessing which ones just got
// fully filled isn't safe to automate; do that from the Roles tab instead.
function BulkStatusDateModal({ pending, onClose, onSaved }) {
  const { candidates, newStatus } = pending;
  const candidateIds = candidates.map(c => c.candidate_id);
  const today = new Date().toISOString().slice(0, 10);

  const [dateInterview, setDateInterview] = useState(today);
  const [dateSentForApproval, setDateSentForApproval] = useState(today);
  const [dateDocumentationStarted, setDateDocumentationStarted] = useState(today);
  const [medicalReportReceived, setMedicalReportReceived] = useState(false);
  const [dateOfferExtended, setDateOfferExtended] = useState(today);
  const [dateOfferAccepted, setDateOfferAccepted] = useState(today);
  const [expectedResumptionDate, setExpectedResumptionDate] = useState('');
  const [actualResumptionDate, setActualResumptionDate] = useState(today);
  const [dateClosed, setDateClosed] = useState(today);
  const [statusReason, setStatusReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isExit = newStatus === 'Dropped' || newStatus === 'Rejected';

  // For each distinct location among the selected candidates, work out
  // whether closing this whole batch completes every position there —
  // computed per location, not guessed, so a batch spanning several
  // locations only closes the ones it actually finishes.
  const locationsToAutoClose = newStatus === 'Closed' ? (() => {
    const byLocation = new Map(); // role_location_id -> { rl, idsInBatch: Set }
    for (const c of candidates) {
      if (!byLocation.has(c.rl.role_location_id)) byLocation.set(c.rl.role_location_id, { rl: c.rl, idsInBatch: new Set() });
      byLocation.get(c.rl.role_location_id).idsInBatch.add(c.candidate_id);
    }
    const result = [];
    for (const { rl, idsInBatch } of byLocation.values()) {
      if (rl.status === 'Closed') continue;
      const alreadyClosed = rl.candidates.filter(c => c.status === 'Closed' && !idsInBatch.has(c.candidate_id)).length;
      if (alreadyClosed + idsInBatch.size >= rl.no_of_positions) result.push(rl);
    }
    return result;
  })() : [];

  async function submit() {
    if (newStatus === 'Awaiting Resumption' && !expectedResumptionDate) {
      setError('Expected resumption date is required.');
      return;
    }
    if (isExit && !statusReason.trim()) {
      setError('A reason is required.');
      return;
    }
    setSaving(true); setError('');
    try {
      const extra = {};
      if (newStatus === 'Interview') extra.date_interview = dateInterview;
      if (newStatus === 'Onboarding Approval') extra.date_sent_for_onboarding_approval = dateSentForApproval;
      if (newStatus === 'Documentation') {
        extra.date_documentation_started = dateDocumentationStarted;
        extra.medical_report_received = medicalReportReceived;
      }
      if (newStatus === 'Offer') extra.date_offer_extended = dateOfferExtended;
      if (newStatus === 'Awaiting Resumption') {
        extra.date_offer_accepted = dateOfferAccepted;
        extra.expected_resumption_date = expectedResumptionDate;
      }
      if (newStatus === 'Closed') {
        extra.actual_resumption_date = actualResumptionDate;
        extra.date_closed = dateClosed;
      }

      if (isExit) {
        // Selected candidates may be at different stages right now — group by
        // their actual current status so status_stage_at_exit is correct per
        // candidate, not one guessed value applied to everyone.
        const groups = new Map(); // previousStatus -> [candidateId, ...]
        for (const c of candidates) {
          if (!groups.has(c.status)) groups.set(c.status, []);
          groups.get(c.status).push(c.candidate_id);
        }
        for (const [prevStatus, ids] of groups.entries()) {
          await bulkUpdateCandidateStatus(ids, newStatus, { ...extra, status_reason: statusReason.trim(), status_stage_at_exit: prevStatus });
        }
      } else {
        await bulkUpdateCandidateStatus(candidateIds, newStatus, extra);
      }

      for (const rl of locationsToAutoClose) {
        await updateRoleLocation({
          roleLocationId: rl.role_location_id, location: rl.location, noOfPositions: rl.no_of_positions,
          status: 'Closed', plannedStartDate: rl.planned_start_date, dateRequestReceived: rl.date_request_received,
          dateLocationClosed: dateClosed,
        });
      }
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <div style={{ fontWeight: 600, marginBottom: 12 }}>Moving {candidateIds.length} candidates to "{newStatus}"</div>
      <p style={{ fontSize: 12, color: 'var(--txm)', marginTop: -6, marginBottom: 12 }}>This applies to all {candidateIds.length} selected candidates.</p>

      {newStatus === 'Interview' && (
        <>
          <label style={labelStyle()}>Date of interview</label>
          <input type="date" value={dateInterview} onChange={e => setDateInterview(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />
        </>
      )}
      {newStatus === 'Onboarding Approval' && (
        <>
          <label style={labelStyle()}>Date sent for onboarding approval</label>
          <input type="date" value={dateSentForApproval} onChange={e => setDateSentForApproval(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />
        </>
      )}
      {newStatus === 'Documentation' && (
        <>
          <label style={labelStyle()}>Date documentation started</label>
          <input type="date" value={dateDocumentationStarted} onChange={e => setDateDocumentationStarted(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 10 }}>
            <input type="checkbox" checked={medicalReportReceived} onChange={e => setMedicalReportReceived(e.target.checked)} />
            Medical report received (for all selected)
          </label>
        </>
      )}
      {newStatus === 'Offer' && (
        <>
          <label style={labelStyle()}>Date offer extended</label>
          <input type="date" value={dateOfferExtended} onChange={e => setDateOfferExtended(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />
        </>
      )}
      {newStatus === 'Awaiting Resumption' && (
        <>
          <label style={labelStyle()}>Date offer accepted</label>
          <input type="date" value={dateOfferAccepted} onChange={e => setDateOfferAccepted(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />
          <label style={labelStyle()}>Expected resumption date</label>
          <input type="date" value={expectedResumptionDate} onChange={e => setExpectedResumptionDate(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />
        </>
      )}
      {newStatus === 'Closed' && (
        <>
          <label style={labelStyle()}>Actual resumption date</label>
          <input type="date" value={actualResumptionDate} onChange={e => setActualResumptionDate(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />
          <label style={labelStyle()}>Date closed</label>
          <input type="date" value={dateClosed} onChange={e => setDateClosed(e.target.value)} style={inputStyle({ width: '100%', marginBottom: 10 })} />
          {locationsToAutoClose.length > 0 && (
            <div style={{ background: 'var(--suc-bg)', borderRadius: 6, padding: 10, fontSize: 13, color: 'var(--suc-tx)' }}>
              This completes every position at: {locationsToAutoClose.map(rl => rl.location).join(', ')} — {locationsToAutoClose.length > 1 ? 'these locations' : 'this location'} will be marked Closed automatically, using this same date.
            </div>
          )}
        </>
      )}
      {isExit && (
        <>
          <label style={labelStyle()}>Reason</label>
          <input value={statusReason} onChange={e => setStatusReason(e.target.value)} placeholder="e.g. Failed medical, Offer declined, Withdrew" style={inputStyle({ width: '100%', marginBottom: 10 })} />
          <p style={{ fontSize: 11, color: 'var(--txm)', marginTop: -6, marginBottom: 10 }}>Each candidate's exit stage is recorded from their own current status, even if the selection spans different stages.</p>
        </>
      )}

      {error && <div style={{ color: 'var(--dgr-tx)', fontSize: 12, marginBottom: 8 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={btnStyle()}>Cancel</button>
        <button onClick={submit} disabled={saving} style={primaryBtnStyle()}>{saving ? 'Saving…' : 'Confirm'}</button>
      </div>
    </Modal>
  );
}

function CandidateProfilePanel({ candidate, currentRl, allRows, canDelete, onClose, onSaved }) {
  const [form, setForm] = useState({
    candidate_name: candidate.candidate_name || '',
    employment_type: candidate.employment_type || '',
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
  const [deleting, setDeleting] = useState(false);

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

  async function deleteThisCandidate() {
    if (!canDelete || deleting) return;
    const confirmed = window.confirm(
      `Delete ${candidate.candidate_name} permanently? This cannot be undone.`
    );
    if (!confirmed) return;

    setDeleting(true);
    setError('');
    try {
      await deleteCandidates([candidate.candidate_id]);
      onSaved();
    } catch (err) {
      setError(err.message || String(err));
      setDeleting(false);
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

      {(() => {
        const typeState = employmentTypeState(form.employment_type);
        return (
          <>
            <label style={labelStyle()}>Employment Type</label>
            {typeState.locked ? (
              <>
                <input value={typeState.value} disabled style={inputStyle({ width: '100%', marginBottom: 4, opacity: 0.75 })} />
                <div style={{ fontSize: 11, color: 'var(--txm)', marginBottom: 10 }}></div>
              </>
            ) : (
              <>
                <select value={form.employment_type} onChange={e => set('employment_type', e.target.value)} style={inputStyle({ width: '100%', marginBottom: 4 })}>
                  <option value="">Select employment type…</option>
                  {EMPLOYMENT_TYPE_OPTIONS.map(t => <option key={t}>{t}</option>)}
                </select>
                <div style={{ fontSize: 11, color: 'var(--txm)', marginBottom: 10 }}>Select the engagement type for this candidate.</div>
              </>
            )}
          </>
        );
      })()}
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
        <button onClick={save} disabled={saving || deleting} style={primaryBtnStyle()}>{saving ? 'Saving…' : 'Save'}</button>
        {canDelete && (
          <button onClick={deleteThisCandidate} disabled={saving || deleting} style={dangerBtnStyle({ color: 'var(--dgr-tx)', border: '1px solid var(--dgr-tx)', borderRadius: 8, padding: '6px 10px' })}>
            {deleting ? 'Deleting…' : 'Delete candidate'}
          </button>
        )}
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
// Bulk upload — reusable modal. Roles tab passes executeUpload (can
// create roles/locations); Candidates tab passes executeCandidateUpload
// (never creates structure, only matches existing roles/locations).
// =================================================================
function BulkUploadModal({ title, helpText, executor, mode, onClose, onDone }) {
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
      parseXlsxUploadFile(file, mode).then(setParsed).catch(err => setUploadError(err.message));
    } else {
      const reader = new FileReader();
      reader.onload = ev => setParsed(parseUploadFile(ev.target.result, mode));
      reader.readAsText(file);
    }
  }

  async function runUpload() {
    if (!parsed || parsed.errors.length) return;
    setRunning(true); setUploadError('');
    try {
      const res = await executor(parsed.rows);
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
    <Modal onClose={onClose}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>{title}</div>
      <p style={{ fontSize: 13, color: 'var(--tx2)' }}>{helpText}</p>
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
          <button onClick={runUpload} disabled={running} style={primaryBtnStyle()}>{running ? 'Importing…' : 'Import'}</button>
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
    </Modal>
  );
}
