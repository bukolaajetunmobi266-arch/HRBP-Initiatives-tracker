// RecruitmentModule.jsx
// Top-level Recruitment tab — add as a new route/tab alongside the existing
// Deliverables Tracker. Renders differently depending on recruitment_role.

import React, { useEffect, useState, useCallback } from 'react';
import {
  getCurrentUserScope, fetchDivisions, fetchRoleLocationsWithCandidates,
  computeDashboardMetrics, computeStalledOnboarding, fetchRolesByDivision,
} from './recruitmentData';
import { parseUploadFile, executeUpload } from './recruitmentUpload';
import { bulkUpdateCandidateStatus, createRole, createRoleLocation } from './recruitmentActions';

const BRAND = {
  navy: '#1F4E78',
  paleBlue: '#D9E2F3',
  amber: '#EF9F27',
  amberBg: '#FAEEDA',
  amberText: '#854F0B',
  teal: '#085041',
  tealBg: '#E1F5EE',
  green: '#3B6D11',
  greenBg: '#EAF3DE',
  red: '#791F1F',
  redBg: '#FCEBEB',
};

const FUNNEL_STAGES = [
  ['Sourcing', BRAND.paleBlue, BRAND.navy],
  ['Interview', BRAND.paleBlue, BRAND.navy],
  ['Onboarding Approval', BRAND.paleBlue, BRAND.navy],
  ['Documentation', BRAND.paleBlue, BRAND.navy],
  ['Offer', BRAND.amberBg, BRAND.amberText],
  ['Awaiting Resumption', BRAND.tealBg, BRAND.teal],
  ['Closed', BRAND.greenBg, BRAND.green],
];

export default function RecruitmentModule() {
  const [scope, setScope] = useState(null);
  const [tab, setTab] = useState('overview');
  const [divisions, setDivisions] = useState([]);
  const [filters, setFilters] = useState({ divisionId: '', roleId: '', location: '', year: '' });
  const [rowsWithCandidates, setRowsWithCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);
  const [candidateStatusFilter, setCandidateStatusFilter] = useState(null); // set when a funnel/card is clicked

  const [loadError, setLoadError] = useState(null);

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

  useEffect(() => { if (scope) reload(); }, [scope, reload]);

  if (loadError) return <div style={{ padding: 24, color: '#791F1F' }}>Couldn't load Recruitment: {loadError}</div>;
  if (!scope) return <div style={{ padding: 24 }}>Loading…</div>;
  if (scope.recruitment_role === null) {
    return <div style={{ padding: 24 }}>You don't have recruitment access. Contact an Admin.</div>;
  }

  const metrics = computeDashboardMetrics(rowsWithCandidates);
  const stalled = computeStalledOnboarding(rowsWithCandidates);

  const uniqueRoles = [...new Map(
    rowsWithCandidates.map(rl => [rl.roles.role_id, rl.roles])
  ).values()];
  const uniqueLocations = [...new Set(rowsWithCandidates.map(rl => rl.location))];

  const canManageDivisions = ['admin', 'recruitment_admin'].includes(scope.recruitment_role);

  function jumpToCandidates(statusFilter) {
    setCandidateStatusFilter(statusFilter);
    setTab('candidates');
  }

  return (
    <div style={{ fontFamily: 'Corbel, sans-serif', padding: 20, maxWidth: 1200, margin: '0 auto' }}>
      <TabNav tab={tab} setTab={setTab} />

      {/* Filter bar — applies to Overview; Candidates tab has its own additional filters */}
      <FilterBar
        divisions={divisions}
        roles={uniqueRoles}
        locations={uniqueLocations}
        filters={filters}
        setFilters={setFilters}
        showDivisionFilter={canManageDivisions || ['hrbp', 'analyst'].includes(scope.recruitment_role)}
      />

      {loading ? <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading…</div> : (
        <>
          {tab === 'overview' && (
            <OverviewTab
              metrics={metrics}
              onFunnelClick={jumpToCandidates}
              onStalledClick={() => jumpToCandidates('__stalled__')}
              onYetToStartClick={() => setTab('yetToStart')}
              stalledCount={stalled.length}
            />
          )}
          {tab === 'roles' && <RolesTab rowsWithCandidates={rowsWithCandidates} />}
          {tab === 'candidates' && (
            <CandidatesTab
              rowsWithCandidates={rowsWithCandidates}
              initialStatusFilter={candidateStatusFilter}
              stalled={stalled}
              onChanged={reload}
            />
          )}
          {tab === 'aging' && <AgingTab rowsWithCandidates={rowsWithCandidates} />}
          {tab === 'yetToStart' && <YetToStartTab rowsWithCandidates={rowsWithCandidates} />}
          {tab === 'stalled' && <StalledTab stalled={stalled} />}
          {tab === 'dropped' && <DroppedTab rowsWithCandidates={rowsWithCandidates} />}
          {tab === 'addRole' && <AddRoleTab divisions={divisions} onDone={reload} />}
          {tab === 'upload' && <UploadTab onDone={reload} />}
        </>
      )}
    </div>
  );
}

function TabNav({ tab, setTab }) {
  const tabs = [
    ['overview', 'Overview'],
    ['roles', 'Roles'],
    ['candidates', 'Candidates'],
    ['aging', 'Aging'],
    ['yetToStart', 'Yet to Start'],
    ['stalled', 'Stalled Onboarding'],
    ['dropped', 'Dropped / Rejected'],
    ['addRole', 'Add Role'],
    ['upload', 'Upload'],
  ];
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: `2px solid ${BRAND.paleBlue}`, marginBottom: 20 }}>
      {tabs.map(([key, label]) => (
        <button
          key={key}
          onClick={() => setTab(key)}
          style={{
            padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer',
            fontWeight: tab === key ? 600 : 400,
            color: tab === key ? BRAND.navy : '#666',
            borderBottom: tab === key ? `3px solid ${BRAND.navy}` : '3px solid transparent',
          }}
        >{label}</button>
      ))}
    </div>
  );
}

function FilterBar({ divisions, roles, locations, filters, setFilters, showDivisionFilter }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
      {showDivisionFilter && (
        <select value={filters.divisionId} onChange={e => setFilters(f => ({ ...f, divisionId: e.target.value }))}>
          <option value="">Division: All</option>
          {divisions.map(d => <option key={d.division_id} value={d.division_id}>{d.name}</option>)}
        </select>
      )}
      <select value={filters.roleId} onChange={e => setFilters(f => ({ ...f, roleId: e.target.value }))}>
        <option value="">Role: All</option>
        {roles.map(r => <option key={r.role_id} value={r.role_id}>{r.role_title}</option>)}
      </select>
      <select value={filters.location} onChange={e => setFilters(f => ({ ...f, location: e.target.value }))}>
        <option value="">Location: All</option>
        {locations.map(l => <option key={l} value={l}>{l}</option>)}
      </select>
      <select value={filters.year} onChange={e => setFilters(f => ({ ...f, year: e.target.value }))}>
        <option value="">Year: All</option>
        {[2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
}

function KpiCard({ label, value, bg, color }) {
  return (
    <div style={{ background: bg || '#F5F5F5', borderRadius: 8, padding: '14px 16px', flex: 1, minWidth: 130 }}>
      <div style={{ fontSize: 13, color: color ? color : '#666', opacity: 0.85 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, color: color || '#222' }}>{value}</div>
    </div>
  );
}

function OverviewTab({ metrics, onFunnelClick, onStalledClick, stalledCount, onYetToStartClick }) {
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <KpiCard label="Total roles" value={metrics.totalRoles} color={BRAND.navy} />
        <KpiCard label="Open positions" value={metrics.totalSlots} color={BRAND.navy} />
        <div onClick={onYetToStartClick} style={{ cursor: 'pointer', flex: 1, minWidth: 130 }}>
          <KpiCard label="Yet to start" value={metrics.yetToStartSlots} />
        </div>
        <KpiCard label="Fill rate" value={`${metrics.fillRatePct}%`} color={BRAND.navy} />
        <KpiCard label="Closure rate" value={`${metrics.closureRatePct}%`} bg={BRAND.greenBg} color={BRAND.green} />
        <div onClick={onStalledClick} style={{ cursor: 'pointer', flex: 1, minWidth: 130 }}>
          <KpiCard label="Stalled onboarding" value={stalledCount} bg={BRAND.redBg} color={BRAND.red} />
        </div>
      </div>

      <div style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>Candidate funnel — share of total pipeline</div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 32 }}>
        {FUNNEL_STAGES.map(([stage, bg, color]) => (
          <div
            key={stage}
            onClick={() => onFunnelClick(stage)}
            style={{ flex: 1, textAlign: 'center', cursor: 'pointer' }}
          >
            <div style={{ background: bg, color, borderRadius: 6, padding: '8px 4px' }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{metrics.funnelCounts[stage]}</div>
              <div style={{ fontSize: 11 }}>{metrics.funnelPct[stage]}%</div>
            </div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>{stage}</div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>Closure rates by division</div>
      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#888', marginBottom: 10 }}>
        <Legend color={BRAND.amber} label="Fill rate" />
        <Legend color={BRAND.green} label="Closure rate" />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {metrics.byDivision.map(d => (
          <div key={d.name}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, fontSize: 13 }}>
              <span>{d.name}</span>
              <span style={{ color: '#666', fontSize: 12 }}>{d.fillRatePct}% filled · {d.closureRatePct}% closed</span>
            </div>
            <div style={{ background: '#F0F0F0', borderRadius: 4, height: 10, position: 'relative' }}>
              <div style={{ width: `${d.fillRatePct}%`, background: BRAND.amber, height: 10, borderRadius: 4, position: 'absolute' }} />
              <div style={{ width: `${d.closureRatePct}%`, background: BRAND.green, height: 10, borderRadius: 4, position: 'absolute' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Legend({ color, label }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: 'inline-block' }} />
      {label}
    </span>
  );
}

const SECURED_STATUSES_UI = ['Offer', 'Awaiting Resumption', 'Closed'];

function locationRates(rl) {
  const secured = rl.candidates.filter(c => SECURED_STATUSES_UI.includes(c.status)).length;
  const closed = rl.candidates.filter(c => c.status === 'Closed').length;
  const fillPct = rl.no_of_positions ? Math.min(100, Math.round((secured / rl.no_of_positions) * 100)) : 0;
  const closePct = rl.no_of_positions ? Math.min(100, Math.round((closed / rl.no_of_positions) * 100)) : 0;
  return { fillPct, closePct };
}

function ProgressBar({ fillPct, closePct }) {
  return (
    <div style={{ background: '#F0F0F0', borderRadius: 4, height: 8, position: 'relative', flex: 1, minWidth: 100 }}>
      <div style={{ width: `${fillPct}%`, background: BRAND.amber, height: 8, borderRadius: 4, position: 'absolute' }} />
      <div style={{ width: `${closePct}%`, background: BRAND.green, height: 8, borderRadius: 4, position: 'absolute' }} />
    </div>
  );
}

function RolesTab({ rowsWithCandidates }) {
  // Group: division name -> role_id -> { role_title, role_type, status, locations: [rl,...] }
  const divisions = {};
  for (const rl of rowsWithCandidates) {
    const divName = rl.roles.divisions.name;
    const roleId = rl.roles.role_id;
    if (!divisions[divName]) divisions[divName] = {};
    if (!divisions[divName][roleId]) {
      divisions[divName][roleId] = { title: rl.roles.role_title, roleType: rl.roles.role_type, locations: [] };
    }
    divisions[divName][roleId].locations.push(rl);
  }

  const divNames = Object.keys(divisions).sort();

  if (divNames.length === 0) {
    return <div style={{ padding: 20, color: '#888', textAlign: 'center' }}>No roles uploaded yet. Use "Add Role" or "Upload" to get started.</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 14, fontSize: 11, color: '#888', marginBottom: 16 }}>
        <Legend color={BRAND.amber} label="Fill rate" />
        <Legend color={BRAND.green} label="Closure rate" />
      </div>
      {divNames.map(divName => {
        const roles = divisions[divName];
        return (
          <div key={divName} style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: BRAND.navy, marginBottom: 10 }}>{divName}</div>
            {Object.entries(roles).map(([roleId, role]) => {
              const totalPositions = role.locations.reduce((sum, rl) => sum + rl.no_of_positions, 0);
              const totalSecured = role.locations.reduce((sum, rl) => sum + rl.candidates.filter(c => SECURED_STATUSES_UI.includes(c.status)).length, 0);
              const totalClosed = role.locations.reduce((sum, rl) => sum + rl.candidates.filter(c => c.status === 'Closed').length, 0);
              const roleFillPct = totalPositions ? Math.min(100, Math.round((totalSecured / totalPositions) * 100)) : 0;
              const roleClosePct = totalPositions ? Math.min(100, Math.round((totalClosed / totalPositions) * 100)) : 0;

              return (
                <div key={roleId} style={{ marginBottom: 14, paddingLeft: 8, borderLeft: `3px solid ${BRAND.paleBlue}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, minWidth: 200 }}>{role.title}</span>
                    <span style={{ fontSize: 11, color: '#888' }}>{role.roleType}</span>
                    <ProgressBar fillPct={roleFillPct} closePct={roleClosePct} />
                    <span style={{ fontSize: 11, color: '#666', whiteSpace: 'nowrap' }}>{totalPositions} positions total</span>
                  </div>
                  <div style={{ paddingLeft: 20 }}>
                    {role.locations.map(rl => {
                      const { fillPct, closePct } = locationRates(rl);
                      return (
                        <div key={rl.role_location_id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                          <span style={{ fontSize: 12, minWidth: 140 }}>{rl.location}</span>
                          <ProgressBar fillPct={fillPct} closePct={closePct} />
                          <span style={{ fontSize: 11, color: '#666', whiteSpace: 'nowrap' }}>
                            {rl.no_of_positions} positions · {rl.status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function CandidatesTab({ rowsWithCandidates, initialStatusFilter, stalled, onChanged }) {
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [bulkStatus, setBulkStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { setStatusFilter(initialStatusFilter); }, [initialStatusFilter]);

  const stalledIds = new Set(stalled.map(s => s.candidateId));

  let flat = rowsWithCandidates.flatMap(rl =>
    rl.candidates.map(c => ({ ...c, roleTitle: rl.roles.role_title, division: rl.roles.divisions.name, location: rl.location }))
  );

  if (statusFilter === '__stalled__') {
    flat = flat.filter(c => stalledIds.has(c.candidate_id));
  } else if (statusFilter) {
    flat = flat.filter(c => c.status === statusFilter);
  }
  if (search.trim()) {
    flat = flat.filter(c => c.candidate_name?.toLowerCase().includes(search.toLowerCase()));
  }

  async function applyBulk() {
    if (!bulkStatus || selected.size === 0) return;
    try {
      await bulkUpdateCandidateStatus([...selected], bulkStatus);
      setSelected(new Set());
      setBulkStatus('');
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <input placeholder="Search candidate name…" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, padding: 6 }} />
        {statusFilter && (
          <button onClick={() => setStatusFilter(null)} style={{ fontSize: 12 }}>
            Clear filter: {statusFilter === '__stalled__' ? 'Stalled' : statusFilter} ×
          </button>
        )}
      </div>

      {selected.size > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', background: BRAND.paleBlue, padding: 8, borderRadius: 6 }}>
          <span style={{ fontSize: 13 }}>{selected.size} selected</span>
          <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)}>
            <option value="">Move to…</option>
            {['Sourcing', 'Interview', 'Onboarding Approval', 'Documentation', 'Offer', 'Awaiting Resumption', 'Closed', 'Dropped', 'Rejected'].map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button onClick={applyBulk}>Apply</button>
        </div>
      )}
      {error && <div style={{ color: BRAND.red, fontSize: 13, marginBottom: 8 }}>{error}</div>}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${BRAND.paleBlue}`, textAlign: 'left' }}>
            <th></th>
            <th>Name</th><th>Division</th><th>Role</th><th>Location</th><th>Status</th><th>Source</th>
          </tr>
        </thead>
        <tbody>
          {flat.map(c => (
            <tr key={c.candidate_id} style={{ borderBottom: '1px solid #eee', background: stalledIds.has(c.candidate_id) ? BRAND.redBg : 'transparent' }}>
              <td><input type="checkbox" checked={selected.has(c.candidate_id)} onChange={e => {
                const next = new Set(selected);
                e.target.checked ? next.add(c.candidate_id) : next.delete(c.candidate_id);
                setSelected(next);
              }} /></td>
              <td>{c.candidate_name}</td>
              <td>{c.division}</td>
              <td>{c.roleTitle}</td>
              <td>{c.location}</td>
              <td>{c.status}</td>
              <td>{c.source || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {flat.length === 0 && <div style={{ padding: 20, color: '#888', textAlign: 'center' }}>No candidates match this filter.</div>}
    </div>
  );
}

function AgingTab({ rowsWithCandidates }) {
  const now = new Date();
  const aging = rowsWithCandidates
    .filter(rl => rl.status === 'Open' && rl.date_request_received)
    .map(rl => ({
      ...rl,
      daysOpen: Math.floor((now - new Date(rl.date_request_received)) / (1000 * 60 * 60 * 24)),
    }))
    .filter(rl => rl.daysOpen >= 30)
    .sort((a, b) => b.daysOpen - a.daysOpen);

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: `2px solid ${BRAND.paleBlue}`, textAlign: 'left' }}>
          <th>Role</th><th>Division</th><th>Location</th><th>Days open</th>
        </tr>
      </thead>
      <tbody>
        {aging.map(rl => (
          <tr key={rl.role_location_id} style={{ borderBottom: '1px solid #eee' }}>
            <td>{rl.roles.role_title}</td>
            <td>{rl.roles.divisions.name}</td>
            <td>{rl.location}</td>
            <td style={{ color: rl.daysOpen >= 90 ? BRAND.red : rl.daysOpen >= 60 ? BRAND.amberText : '#222' }}>{rl.daysOpen}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StalledTab({ stalled }) {
  const sorted = [...stalled].sort((a, b) => b.daysStalled - a.daysStalled);
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: `2px solid ${BRAND.paleBlue}`, textAlign: 'left' }}>
          <th>Candidate</th><th>Division</th><th>Role</th><th>Location</th><th>Days stalled</th><th></th>
        </tr>
      </thead>
      <tbody>
        {sorted.map(s => (
          <tr key={s.candidateId} style={{ borderBottom: '1px solid #eee', background: s.isEscalated ? BRAND.redBg : 'transparent' }}>
            <td>{s.candidateName}</td><td>{s.division}</td><td>{s.roleTitle}</td><td>{s.location}</td>
            <td>{s.daysStalled}</td>
            <td>{s.isEscalated && <span style={{ color: BRAND.red, fontSize: 11 }}>ESCALATED</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function YetToStartTab({ rowsWithCandidates }) {
  const queued = rowsWithCandidates
    .filter(rl => rl.status === 'Yet to Start')
    .sort((a, b) => (a.planned_start_date || '').localeCompare(b.planned_start_date || ''));

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: `2px solid ${BRAND.paleBlue}`, textAlign: 'left' }}>
          <th>Role</th><th>Division</th><th>Location</th><th>Positions</th><th>Planned start</th>
        </tr>
      </thead>
      <tbody>
        {queued.map(rl => (
          <tr key={rl.role_location_id} style={{ borderBottom: '1px solid #eee' }}>
            <td>{rl.roles.role_title}</td>
            <td>{rl.roles.divisions.name}</td>
            <td>{rl.location}</td>
            <td>{rl.no_of_positions}</td>
            <td>{rl.planned_start_date || '—'}</td>
          </tr>
        ))}
      </tbody>
      {queued.length === 0 && <tbody><tr><td colSpan={5} style={{ padding: 20, color: '#888', textAlign: 'center' }}>Nothing queued.</td></tr></tbody>}
    </table>
  );
}

function DroppedTab({ rowsWithCandidates }) {
  const dropped = rowsWithCandidates.flatMap(rl =>
    rl.candidates
      .filter(c => ['Dropped', 'Rejected'].includes(c.status))
      .map(c => ({ ...c, roleTitle: rl.roles.role_title, division: rl.roles.divisions.name, location: rl.location }))
  );
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: `2px solid ${BRAND.paleBlue}`, textAlign: 'left' }}>
          <th>Name</th><th>Division</th><th>Role</th><th>Location</th><th>Status</th><th>Reason</th>
        </tr>
      </thead>
      <tbody>
        {dropped.map(c => (
          <tr key={c.candidate_id} style={{ borderBottom: '1px solid #eee' }}>
            <td>{c.candidate_name}</td><td>{c.division}</td><td>{c.roleTitle}</td><td>{c.location}</td>
            <td>{c.status}</td><td>{c.status_reason || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AddRoleTab({ divisions, onDone }) {
  const [mode, setMode] = useState('role'); // 'role' | 'location'
  const [divisionId, setDivisionId] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [roleType, setRoleType] = useState('Sales');
  const [suggestedGrade, setSuggestedGrade] = useState('');

  const [rolesInDivision, setRolesInDivision] = useState([]);
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [location, setLocation] = useState('');
  const [noOfPositions, setNoOfPositions] = useState('');
  const [status, setStatus] = useState('Open');
  const [plannedStartDate, setPlannedStartDate] = useState('');
  const [dateRequestReceived, setDateRequestReceived] = useState('');

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (mode !== 'location' || !divisionId) { setRolesInDivision([]); return; }
    fetchRolesByDivision(divisionId).then(setRolesInDivision).catch(err => setError(err.message));
  }, [mode, divisionId]);

  async function submitRole() {
    setError(''); setMessage('');
    if (!divisionId || !roleTitle.trim()) { setError('Division and Role Title are required.'); return; }
    setSaving(true);
    try {
      await createRole({ divisionId, roleTitle: roleTitle.trim(), roleType, suggestedGrade });
      setMessage(`Role "${roleTitle}" created. Add a location for it next using "Add Location" above.`);
      setRoleTitle(''); setSuggestedGrade('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function submitLocation() {
    setError(''); setMessage('');
    if (!selectedRoleId || !location.trim() || !noOfPositions) { setError('Role, Location, and No. of Positions are required.'); return; }
    setSaving(true);
    try {
      await createRoleLocation({
        roleId: selectedRoleId, location: location.trim(), noOfPositions: Number(noOfPositions),
        status, plannedStartDate: plannedStartDate || null, dateRequestReceived: dateRequestReceived || null,
      });
      setMessage(`Location "${location}" added.`);
      setLocation(''); setNoOfPositions(''); setPlannedStartDate(''); setDateRequestReceived('');
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = { padding: 6, marginBottom: 8, display: 'block', width: '100%', maxWidth: 320 };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button onClick={() => { setMode('role'); setMessage(''); setError(''); }}
          style={{ fontWeight: mode === 'role' ? 600 : 400, background: mode === 'role' ? BRAND.paleBlue : 'transparent', border: 'none', padding: '6px 12px', borderRadius: 6, cursor: 'pointer' }}>
          New Role
        </button>
        <button onClick={() => { setMode('location'); setMessage(''); setError(''); }}
          style={{ fontWeight: mode === 'location' ? 600 : 400, background: mode === 'location' ? BRAND.paleBlue : 'transparent', border: 'none', padding: '6px 12px', borderRadius: 6, cursor: 'pointer' }}>
          Add Location to Existing Role
        </button>
      </div>

      {message && <div style={{ color: BRAND.green, fontSize: 13, marginBottom: 12 }}>{message}</div>}
      {error && <div style={{ color: BRAND.red, fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {mode === 'role' ? (
        <div>
          <label style={{ fontSize: 12, color: '#666' }}>Division</label>
          <select value={divisionId} onChange={e => setDivisionId(e.target.value)} style={inputStyle}>
            <option value="">Select division…</option>
            {divisions.map(d => <option key={d.division_id} value={d.division_id}>{d.name}</option>)}
          </select>

          <label style={{ fontSize: 12, color: '#666' }}>Role Title</label>
          <input value={roleTitle} onChange={e => setRoleTitle(e.target.value)} placeholder="e.g. Sales Associate" style={inputStyle} />

          <label style={{ fontSize: 12, color: '#666' }}>Role Type</label>
          <select value={roleType} onChange={e => setRoleType(e.target.value)} style={inputStyle}>
            <option>Sales</option><option>Support</option><option>Affiliate</option>
          </select>

          <label style={{ fontSize: 12, color: '#666' }}>Suggested Grade (optional)</label>
          <input value={suggestedGrade} onChange={e => setSuggestedGrade(e.target.value)} style={inputStyle} />

          <button onClick={submitRole} disabled={saving}>{saving ? 'Saving…' : 'Create Role'}</button>
        </div>
      ) : (
        <div>
          <label style={{ fontSize: 12, color: '#666' }}>Division</label>
          <select value={divisionId} onChange={e => { setDivisionId(e.target.value); setSelectedRoleId(''); }} style={inputStyle}>
            <option value="">Select division…</option>
            {divisions.map(d => <option key={d.division_id} value={d.division_id}>{d.name}</option>)}
          </select>

          <label style={{ fontSize: 12, color: '#666' }}>Role</label>
          <select value={selectedRoleId} onChange={e => setSelectedRoleId(e.target.value)} style={inputStyle} disabled={!divisionId}>
            <option value="">Select role…</option>
            {rolesInDivision.map(r => <option key={r.role_id} value={r.role_id}>{r.role_title}</option>)}
          </select>

          <label style={{ fontSize: 12, color: '#666' }}>Location</label>
          <input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Kano" style={inputStyle} />

          <label style={{ fontSize: 12, color: '#666' }}>No. of Positions</label>
          <input type="number" min="1" value={noOfPositions} onChange={e => setNoOfPositions(e.target.value)} style={inputStyle} />

          <label style={{ fontSize: 12, color: '#666' }}>Status</label>
          <select value={status} onChange={e => setStatus(e.target.value)} style={inputStyle}>
            <option>Open</option><option>Yet to Start</option><option>On Hold</option><option>Cancelled</option>
          </select>

          {status === 'Yet to Start' && (
            <>
              <label style={{ fontSize: 12, color: '#666' }}>Planned Start Date</label>
              <input type="date" value={plannedStartDate} onChange={e => setPlannedStartDate(e.target.value)} style={inputStyle} />
            </>
          )}

          <label style={{ fontSize: 12, color: '#666' }}>Date Request Received</label>
          <input type="date" value={dateRequestReceived} onChange={e => setDateRequestReceived(e.target.value)} style={inputStyle} />

          <button onClick={submitLocation} disabled={saving}>{saving ? 'Saving…' : 'Add Location'}</button>
        </div>
      )}
    </div>
  );
}

function UploadTab({ onDone }) {
  const [fileText, setFileText] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target.result;
      setFileText(text);
      setParsed(parseUploadFile(text));
      setResult(null);
    };
    reader.readAsText(file);
  }

  const [uploadError, setUploadError] = useState('');

  async function runUpload() {
    if (!parsed || parsed.errors.length) return;
    setRunning(true);
    setUploadError('');
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
      <p style={{ fontSize: 13, color: '#666' }}>
        Upload a CSV export of the recruitment template (Division, Role Title, Location, candidate details).
        Existing roles/locations are matched by name; anything new is created automatically.
      </p>
      <input type="file" accept=".csv" onChange={handleFile} />

      {uploadError && (
        <div style={{ marginTop: 12, color: BRAND.red, fontSize: 13 }}>
          <strong>Upload failed:</strong> {uploadError}
        </div>
      )}

      {parsed && parsed.errors.length > 0 && (
        <div style={{ marginTop: 12, color: BRAND.red, fontSize: 13 }}>
          <strong>Fix these before uploading:</strong>
          <ul>{parsed.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}

      {parsed && parsed.errors.length === 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, marginBottom: 8 }}>{parsed.rows.length} rows ready to upload.</div>
          <button onClick={runUpload} disabled={running}>{running ? 'Uploading…' : 'Upload'}</button>
        </div>
      )}

      {result && (
        <div style={{ marginTop: 16, fontSize: 13 }}>
          <div>{result.created} rows created successfully.</div>
          {result.failed.length > 0 && (
            <div style={{ color: BRAND.red, marginTop: 8 }}>
              <strong>{result.failed.length} rows failed:</strong>
              <ul>{result.failed.map((f, i) => <li key={i}>Row {f.rowNum}: {f.message}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
