import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'
import AuthGate from './AuthGate'
import NotificationBell from './NotificationBell'
import { exportToExcel } from './exportExcel'
import ImportDialog from './ImportDialog'
import { OWNER_FUNCTIONS, DIVISIONS, STATUSES, CO_COLORS } from './constants'

const LIGHT = { '--bg0': '#F3F6FA', '--bg1': '#EEF2F7', '--bg2': '#FFFFFF', '--tx1': '#1A2733', '--tx2': '#52606D', '--txm': '#8A94A0', '--bd': '#E2E8F0', '--bds': '#CBD5E0', '--acc-bg': '#E6F1FB', '--acc-tx': '#0C447C', '--acc-fill': '#0F7FC4', '--dgr-bg': '#FAECE7', '--dgr-tx': '#993C1D', '--wrn-bg': '#FAEEDA', '--wrn-tx': '#854F0B', '--suc-bg': '#E1F5EE', '--suc-tx': '#085041', '--suc-fill': '#2E9E75', '--wrn-fill': '#EF9F27', '--dgr-fill': '#D85A30', '--neu-bg': '#EAEDF0', '--neu-tx': '#52606D', '--navy': '#1B2A3C' }
const DARK = { '--bg0': '#0F1720', '--bg1': '#16202B', '--bg2': '#1C2733', '--tx1': '#F0F4F8', '--tx2': '#B7C2CC', '--txm': '#7C8794', '--bd': '#2A3541', '--bds': '#3A4652', '--acc-bg': '#123152', '--acc-tx': '#7FB8EE', '--acc-fill': '#3B93DA', '--dgr-bg': '#3A1B10', '--dgr-tx': '#F0997B', '--wrn-bg': '#3A2A0E', '--wrn-tx': '#F5C775', '--suc-bg': '#0C2A22', '--suc-tx': '#5DCAA5', '--suc-fill': '#3C8F72', '--wrn-fill': '#EF9F27', '--dgr-fill': '#E8724A', '--neu-bg': '#232D38', '--neu-tx': '#B7C2CC', '--navy': '#101A26' }

const todayISO = () => new Date().toISOString().slice(0, 10)
const fmtDate = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const isOverdue = (d) => d.due_date && d.status !== 'Completed' && d.due_date < todayISO()
const isDueSoon = (d) => {
  if (!d.due_date || d.status === 'Completed') return false
  const diff = (new Date(d.due_date) - new Date(todayISO())) / 86400000
  return diff >= 0 && diff <= 3
}

export default function App() {
  const [session, setSession] = useState(undefined)
  const [theme, setTheme] = useState('light')
  const [recoveryMode, setRecoveryMode] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    const vars = theme === 'dark' ? DARK : LIGHT
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v))
  }, [theme])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <div style={{ minHeight: '100vh', background: 'var(--bg0)' }} />

  return (
    <AuthGate session={session} recoveryMode={recoveryMode} onRecoveryDone={() => setRecoveryMode(false)}>
      <Dashboard session={session} theme={theme} setTheme={setTheme} />
    </AuthGate>
  )
}

function Dashboard({ session, theme, setTheme }) {
  const [profile, setProfile] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [deliverables, setDeliverables] = useState([])
  const [keyActions, setKeyActions] = useState([])
  const [view, setView] = useState('summary')
  const [filters, setFilters] = useState({ search: '', division: 'all', owner: 'all', status: 'all', overdueOnly: false })
  const [collapsed, setCollapsed] = useState({})
  const [selected, setSelected] = useState({})
  const [sort, setSort] = useState({ key: 'due_date', dir: 'asc' })
  const [editing, setEditing] = useState(null) // {id|null, isNewObjective}
  const [editingAction, setEditingAction] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [showExport, setShowExport] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [loading, setLoading] = useState(true)

  const userId = session.user.id

  useEffect(() => {
    loadProfile(); loadProfiles(); loadDeliverables(); loadKeyActions()
    const ch = supabase.channel('deliverables-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'deliverables' }, loadDeliverables).subscribe()
    return () => supabase.removeChannel(ch)
    // eslint-disable-next-line
  }, [])

  const loadProfile = async () => { const { data } = await supabase.from('profiles').select('*').eq('id', userId).single(); setProfile(data) }
  const loadProfiles = async () => { const { data } = await supabase.from('profiles').select('*').order('full_name'); setProfiles(data || []) }
  const loadDeliverables = async () => {
    const { data } = await supabase.from('deliverables').select('*, comments(*)').order('created_at', { ascending: false })
    setDeliverables(data || []); setLoading(false)
  }
  const loadKeyActions = async () => { const { data } = await supabase.from('key_actions').select('*').order('created_at', { ascending: false }); setKeyActions(data || []) }

  const isAdmin = profile?.role === 'admin'
  const ownerName = (id) => profiles.find((p) => p.id === id)?.full_name || 'Unassigned'
  const lastComment = (d) => (d.comments?.length ? d.comments[d.comments.length - 1] : null)

  const getFiltered = () =>
    deliverables.filter((d) => {
      if (filters.search && !d.title.toLowerCase().includes(filters.search.toLowerCase())) return false
      if (filters.division !== 'all' && d.division !== filters.division) return false
      if (filters.owner !== 'all' && d.owner_id !== filters.owner) return false
      if (filters.status !== 'all' && d.status !== filters.status) return false
      if (filters.overdueOnly && !isOverdue(d)) return false
      return true
    })

  const sortItems = (items) => {
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...items].sort((a, b) => {
      let av, bv
      if (sort.key === 'status') { av = STATUSES.indexOf(a.status); bv = STATUSES.indexOf(b.status) }
      else if (sort.key === 'due_date') { av = a.due_date || '9999'; bv = b.due_date || '9999' }
      else { av = (a[sort.key] || '').toLowerCase(); bv = (b[sort.key] || '').toLowerCase() }
      return av < bv ? -dir : av > bv ? dir : 0
    })
  }

  const saveDeliverable = async (form, isNew, isNewObjective, originalRevised) => {
    const payload = {
      title: form.title, corporate_objective: form.corporateObjective, pm_objective: form.pmObjective, key_result: form.keyResult,
      division: form.division, owner_id: form.ownerId, status: form.status, due_date: form.dueDate || null,
      revised_due_date: form.revisedDueDate || null, revision_reason: form.revisionReason, next_steps: form.nextSteps,
    }
    if (isNew) {
      const { error } = await supabase.from('deliverables').insert(payload)
      if (error) { alert(error.message); return }
    } else {
      const { error } = await supabase.from('deliverables').update(payload).eq('id', form.id)
      if (error) { alert(error.message); return }
    }
    setEditing(null); loadDeliverables()
  }

  const changeStatus = async (id, status) => {
    const { error } = await supabase.from('deliverables').update({ status }).eq('id', id)
    if (error) alert(error.message)
    loadDeliverables()
  }

  const deleteDeliverable = async (id) => {
    const { error } = await supabase.from('deliverables').delete().eq('id', id)
    if (error) alert(error.message)
    loadDeliverables()
  }

  const bulkStatus = async (status) => {
    const ids = Object.keys(selected).filter((k) => selected[k])
    await Promise.all(ids.map((id) => supabase.from('deliverables').update({ status }).eq('id', id)))
    setSelected({}); loadDeliverables()
  }
  const bulkDelete = async () => {
    const ids = Object.keys(selected).filter((k) => selected[k])
    await Promise.all(ids.map((id) => supabase.from('deliverables').delete().eq('id', id)))
    setSelected({}); loadDeliverables()
  }

  const counts = useMemo(() => {
    const c = { 'Not Started': 0, 'In Progress': 0, Completed: 0, Overdue: 0 }
    deliverables.forEach((d) => { c[d.status] = (c[d.status] || 0) + 1; if (isOverdue(d)) c.Overdue++ })
    return c
  }, [deliverables])

  if (loading || !profile) return <div style={{ minHeight: '100vh', background: 'var(--bg0)' }} />

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg0)', color: 'var(--tx1)' }}>
      <Header profile={profile} userId={userId} theme={theme} setTheme={setTheme} />
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '1.5rem 1rem' }}>
        <KpiStrip counts={counts} total={deliverables.length} />
        <Nav view={view} setView={setView} setSelected={setSelected} />

        {(view === 'board' || view === 'deliverables' || view === 'calendar') && (
          <FilterBar filters={filters} setFilters={setFilters} profiles={profiles} isAdmin={isAdmin} />
        )}

        {view === 'summary' && <SummaryView deliverables={deliverables} profiles={profiles} />}

        {view === 'board' && (
          <BoardView items={getFiltered()} isAdmin={isAdmin} onOpen={(id) => setEditing({ id })} onStatus={changeStatus} onDelete={(id) => setConfirmDelete(id)} onAdd={() => setEditing({ id: null })} ownerName={ownerName} />
        )}

        {view === 'deliverables' && (
          <DeliverablesView
            items={getFiltered()} allItems={deliverables} isAdmin={isAdmin}
            collapsed={collapsed} setCollapsed={setCollapsed}
            selected={selected} setSelected={setSelected}
            sort={sort} setSort={setSort} sortItems={sortItems}
            ownerName={ownerName} profiles={profiles}
            onOpen={(id) => setEditing({ id })}
            onAdd={() => setEditing({ id: null })}
            onNewObjective={() => setEditing({ id: null, isNewObjective: true })}
            onBulkStatus={bulkStatus} onBulkDelete={bulkDelete}
            onExport={() => setShowExport(true)}
            onImport={() => setShowImport(true)}
          />
        )}

        {view === 'calendar' && <CalendarView items={getFiltered()} onOpen={(id) => setEditing({ id })} />}
        {view === 'movement' && <ActivityView deliverables={deliverables} ownerName={ownerName} onOpen={(id) => setEditing({ id })} />}
        {view === 'actions' && (
          <ActionsView keyActions={keyActions} profiles={profiles} isAdmin={isAdmin} ownerName={ownerName}
            onOpen={(id) => setEditingAction({ id })} onAdd={() => setEditingAction({ id: null })}
            onDelete={async (id) => { await supabase.from('key_actions').delete().eq('id', id); loadKeyActions() }} />
        )}
      </div>

      {editing && (
        <DeliverableModal
          item={editing.id ? deliverables.find((d) => d.id === editing.id) : null}
          isNewObjective={!!editing.isNewObjective}
          isAdmin={isAdmin} profiles={profiles} userId={userId}
          onClose={() => setEditing(null)} onSave={saveDeliverable}
          reloadDeliverables={loadDeliverables}
        />
      )}
      {editingAction && (
        <ActionModal
          action={editingAction.id ? keyActions.find((a) => a.id === editingAction.id) : null}
          profiles={profiles}
          onClose={() => setEditingAction(null)}
          onSave={async (form, isNew) => {
            const payload = { title: form.title, raised_in: form.raisedIn, owner_id: form.ownerId, due_date: form.dueDate || null, status: form.status, comment: form.comment }
            if (isNew) await supabase.from('key_actions').insert(payload)
            else await supabase.from('key_actions').update(payload).eq('id', form.id)
            setEditingAction(null); loadKeyActions()
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog message="Delete this deliverable? This can't be undone." onCancel={() => setConfirmDelete(null)} onConfirm={() => { deleteDeliverable(confirmDelete); setConfirmDelete(null) }} />
      )}
      {showImport && (
        <ImportDialog profiles={profiles} onCancel={() => setShowImport(false)} onDone={() => { setShowImport(false); loadDeliverables(); loadKeyActions() }} />
      )}
      {showExport && (
        <ExportDialog
          filters={filters} profiles={profiles}
          onCancel={() => setShowExport(false)}
          onExport={(useFiltered, includeActions) => {
            const rows = (useFiltered ? getFiltered() : deliverables).map((d) => ({ ...d, latestComment: lastComment(d)?.text }))
            exportToExcel({ deliverables: rows, keyActions, profiles, includeActions })
            setShowExport(false)
          }}
        />
      )}
    </div>
  )
}

function Header({ profile, userId, theme, setTheme }) {
  return (
    <header style={{ background: 'var(--navy)', color: '#fff' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '0.75rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>HRBP Deliverables Tracker</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 12, background: 'rgba(255,255,255,0.1)', padding: '4px 10px', borderRadius: 8 }}>{profile.full_name} · {profile.role === 'admin' ? 'Admin' : 'Team member'}</span>
          <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} style={{ border: '0.5px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.08)', color: '#fff', borderRadius: 8, padding: '5px 10px', fontSize: 12, cursor: 'pointer' }}>
            {theme === 'light' ? 'Dark mode' : 'Light mode'}
          </button>
          <NotificationBell userId={userId} />
          <button onClick={() => supabase.auth.signOut()} style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', background: 'none', border: 'none', cursor: 'pointer' }}>Sign out</button>
        </div>
      </div>
    </header>
  )
}

function KpiStrip({ counts, total }) {
  const pct = total ? Math.round((counts.Completed / total) * 100) : 0
  const items = [['Overall completion', pct + '%'], ['Completed', counts.Completed], ['Overdue', counts.Overdue], ['Active total', total - counts.Completed]]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 20 }}>
      {items.map(([label, val]) => (
        <div key={label} style={{ background: 'var(--bg1)', borderRadius: 10, padding: '12px 16px' }}>
          <p style={{ fontSize: 12, color: 'var(--tx2)', margin: '0 0 4px' }}>{label}</p>
          <p style={{ fontSize: 22, fontWeight: 500, margin: 0 }}>{val}</p>
        </div>
      ))}
    </div>
  )
}

function Nav({ view, setView, setSelected }) {
  const tabs = [['summary', 'Summary dashboard'], ['board', 'Board'], ['deliverables', 'Deliverables'], ['calendar', 'Calendar'], ['movement', 'Activity'], ['actions', 'Action items']]
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
      {tabs.map(([id, label]) => (
        <button key={id} onClick={() => { setView(id); setSelected({}) }}
          style={{ border: 'none', background: view === id ? 'var(--acc-bg)' : 'transparent', color: view === id ? 'var(--acc-tx)' : 'var(--tx2)', fontSize: 13, fontWeight: 500, padding: '6px 12px', borderRadius: 8, cursor: 'pointer' }}>
          {label}
        </button>
      ))}
    </div>
  )
}

function FilterBar({ filters, setFilters, profiles }) {
  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }))
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
      <input placeholder="Search deliverables…" value={filters.search} onChange={(e) => set('search', e.target.value)} style={inputStyle({ flex: 1, minWidth: 160 })} />
      <select value={filters.division} onChange={(e) => set('division', e.target.value)} style={inputStyle({ minWidth: 150 })}>
        <option value="all">All divisions</option>
        {DIVISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
      <select value={filters.owner} onChange={(e) => set('owner', e.target.value)} style={inputStyle({ minWidth: 130 })}>
        <option value="all">All owners</option>
        {profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
      </select>
      <select value={filters.status} onChange={(e) => set('status', e.target.value)} style={inputStyle({ minWidth: 120 })}>
        <option value="all">All statuses</option>
        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <label style={{ fontSize: 12, color: 'var(--tx2)', display: 'flex', alignItems: 'center', gap: 4 }}>
        <input type="checkbox" checked={filters.overdueOnly} onChange={(e) => set('overdueOnly', e.target.checked)} /> Overdue only
      </label>
    </div>
  )
}

function inputStyle(extra = {}) { return { background: 'var(--bg2)', color: 'var(--tx1)', border: '0.5px solid var(--bds)', borderRadius: 8, padding: '7px 10px', fontSize: 13, ...extra } }

function StatusBadge({ status, overdue }) {
  const role = overdue ? 'dgr' : status === 'Completed' ? 'suc' : status === 'In Progress' ? 'wrn' : 'neu'
  return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: `var(--${role}-bg)`, color: `var(--${role}-tx)`, whiteSpace: 'nowrap' }}>{overdue && '⚠ '}{status}</span>
}
function RevisionFlag({ item }) { return item.revised_due_date ? <span title="Revised due date pending review" style={{ marginLeft: 4, color: 'var(--acc-tx)' }}>📅</span> : null }

function OwnerDisplay({ items, ownerName, onJump, size = 13 }) {
  const owners = [...new Set(items.map((d) => d.owner_id))]
  if (owners.length <= 1) return <span style={{ fontSize: size, fontWeight: 500 }}>{owners[0] ? ownerName(owners[0]) : ''}</span>
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {owners.map((o) => (
        <button key={o} onClick={(e) => { e.stopPropagation(); onJump(o) }} title={`Filter to ${ownerName(o)}`}
          style={{ fontSize: size - 2, fontWeight: 500, background: 'var(--acc-bg)', color: 'var(--acc-tx)', padding: '2px 8px', borderRadius: 999, border: 'none', cursor: 'pointer' }}>
          {ownerName(o).split(' ')[0]}
        </button>
      ))}
    </span>
  )
}

function BoardView({ items, isAdmin, onOpen, onStatus, onDelete, onAdd, ownerName }) {
  const [dragId, setDragId] = useState(null)
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button onClick={onAdd} style={btnStyle()}>+ Add deliverable</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
        {STATUSES.map((status) => {
          const col = items.filter((d) => d.status === status)
          return (
            <div key={status} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (dragId) onStatus(dragId, status); setDragId(null) }}
              style={{ background: 'var(--bg1)', borderRadius: 10, padding: 10, minHeight: 200 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13, fontWeight: 500 }}>
                <span>{status}</span><span style={{ color: 'var(--txm)' }}>{col.length}</span>
              </div>
              {col.map((item) => {
                const overdue = isOverdue(item)
                return (
                  <div key={item.id} draggable onDragStart={() => setDragId(item.id)} onClick={() => onOpen(item.id)}
                    style={{ position: 'relative', background: 'var(--bg2)', border: `0.5px solid ${overdue ? 'var(--dgr-fill)' : 'var(--bd)'}`, borderRadius: 8, padding: 10, marginBottom: 8, cursor: 'pointer' }}>
                    {isAdmin && <button onClick={(e) => { e.stopPropagation(); onDelete(item.id) }} style={{ position: 'absolute', top: 6, right: 6, border: 'none', background: 'none', color: 'var(--txm)', cursor: 'pointer' }}>🗑</button>}
                    <p style={{ fontSize: 13, margin: '0 20px 8px 0' }}>{item.title}</p>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, fontWeight: 500 }}>{ownerName(item.owner_id)}</span>
                      <span style={{ fontSize: 11, color: overdue ? 'var(--dgr-tx)' : isDueSoon(item) ? 'var(--wrn-tx)' : 'var(--txm)' }}>{overdue ? 'Overdue' : fmtDate(item.due_date) || 'No date'}<RevisionFlag item={item} /></span>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function btnStyle(extra = {}) { return { fontSize: 13, background: 'var(--bg2)', border: '0.5px solid var(--bds)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', color: 'var(--tx1)', ...extra } }
function primaryBtnStyle(extra = {}) { return { fontSize: 13, background: 'var(--acc-fill)', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', ...extra } }

function buildTree(items) {
  const tree = {}
  items.forEach((d) => {
    const co = d.corporate_objective || 'Unassigned objective'
    const pm = d.pm_objective || 'Unassigned PM objective'
    const kr = d.key_result || 'Unassigned key result'
    tree[co] = tree[co] || {}; tree[co][pm] = tree[co][pm] || {}; tree[co][pm][kr] = tree[co][pm][kr] || []
    tree[co][pm][kr].push(d)
  })
  return tree
}

function DeliverablesView({ items, allItems, isAdmin, collapsed, setCollapsed, selected, setSelected, sort, setSort, sortItems, ownerName, profiles, onOpen, onAdd, onNewObjective, onBulkStatus, onBulkDelete, onExport, onImport }) {
  const toggle = (k) => setCollapsed((c) => ({ ...c, [k]: !c[k] }))
  const jump = () => {} // owner-jump handled at filter level in parent; simplified here
  const selCount = Object.values(selected).filter(Boolean).length
  if (!items.length) return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <button onClick={onImport} style={btnStyle()}>Import from Excel</button>
        <button onClick={onExport} style={btnStyle()}>Export to Excel</button>
        <button onClick={onNewObjective} style={btnStyle()}>+ New corporate objective</button>
        <button onClick={onAdd} style={btnStyle()}>+ Add deliverable</button>
      </div>
      <EmptyState msg="No deliverables match your filters." />
    </div>
  )

  const totalTree = buildTree(allItems)
  const visTree = buildTree(items)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <button onClick={onImport} style={btnStyle()}>Import from Excel</button>
        <button onClick={onExport} style={btnStyle()}>Export to Excel</button>
        <button onClick={onNewObjective} style={btnStyle()}>+ New corporate objective</button>
        <button onClick={onAdd} style={btnStyle()}>+ Add deliverable</button>
      </div>
      {selCount > 0 && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', background: 'var(--acc-bg)', padding: '8px 12px', borderRadius: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--acc-tx)', fontSize: 13 }}>{selCount} selected</span>
          <select onChange={(e) => { if (e.target.value) onBulkStatus(e.target.value) }} style={inputStyle({ width: 'auto' })} defaultValue="">
            <option value="">Change status to…</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {isAdmin && <button onClick={onBulkDelete} style={{ ...btnStyle(), color: 'var(--dgr-tx)', marginLeft: 'auto' }}>Delete selected</button>}
          <button onClick={() => setSelected({})} style={btnStyle()}>Clear</button>
        </div>
      )}
      {Object.keys(visTree).map((co, i) => {
        const color = CO_COLORS[i % CO_COLORS.length]
        const coKey = 'co::' + co
        const coCollapsed = collapsed[coKey]
        let coCount = 0
        Object.values(visTree[co]).forEach((pmObj) => Object.values(pmObj).forEach((arr) => { coCount += arr.length }))
        return (
          <div key={co} style={{ borderLeft: `4px solid ${color}`, background: 'var(--bg1)', marginBottom: 10 }}>
            <button onClick={() => toggle(coKey)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '10px 12px', cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center' }}>
              <span>{coCollapsed ? '▸' : '▾'}</span>
              <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{co}</span>
              <span style={{ fontSize: 11, color: 'var(--txm)' }}>{coCount} items</span>
            </button>
            {!coCollapsed && (
              <div style={{ padding: '0 12px 10px 24px' }}>
                {Object.keys(visTree[co]).map((pm) => {
                  const pmKey = 'pm::' + co + '|' + pm
                  const pmCollapsed = collapsed[pmKey]
                  return (
                    <div key={pm} style={{ marginBottom: 8 }}>
                      <button onClick={() => toggle(pmKey)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '6px 0', cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span>{pmCollapsed ? '▸' : '▾'}</span>
                        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--tx2)' }}>{pm}</span>
                      </button>
                      {!pmCollapsed && (
                        <div style={{ paddingLeft: 20 }}>
                          {Object.keys(visTree[co][pm]).map((kr) => {
                            const krItemsRaw = visTree[co][pm][kr]
                            const krItems = sortItems(krItemsRaw)
                            const totalKr = totalTree[co]?.[pm]?.[kr] || krItems
                            const krKey = 'kr::' + co + '|' + pm + '|' + kr
                            const krCollapsed = collapsed[krKey]
                            const completed = krItems.filter((d) => d.status === 'Completed').length
                            const pct = krItems.length ? Math.round((completed / krItems.length) * 100) : 0
                            const showingNote = totalKr.length !== krItems.length ? ` (showing ${krItems.length} of ${totalKr.length})` : ''
                            return (
                              <div key={kr} style={{ border: '0.5px solid var(--bd)', borderRadius: 8, overflow: 'hidden', background: 'var(--bg2)', marginBottom: 8 }}>
                                <div style={{ padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                  <button onClick={() => toggle(krKey)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center', flex: 1, textAlign: 'left' }}>
                                    <span>{krCollapsed ? '▸' : '▾'}</span>
                                    <span style={{ fontSize: 12 }}>{kr}{showingNote}</span>
                                  </button>
                                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <OwnerDisplay items={krItems} ownerName={ownerName} onJump={jump} size={12} />
                                    <span style={{ width: 50, height: 5, background: 'var(--bg1)', borderRadius: 999, overflow: 'hidden' }}>
                                      <span style={{ display: 'block', height: '100%', width: pct + '%', background: pct >= 65 ? 'var(--suc-fill)' : pct >= 35 ? 'var(--wrn-fill)' : 'var(--dgr-fill)' }} />
                                    </span>
                                    <span style={{ fontSize: 11, color: 'var(--txm)' }}>{completed}/{krItems.length}</span>
                                  </span>
                                </div>
                                {!krCollapsed && (
                                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                                    <thead>
                                      <tr style={{ background: 'var(--bg1)' }}>
                                        <th style={{ width: 26 }}></th>
                                        {[['title', 'Deliverable'], ['status', 'Status'], ['due_date', 'Due']].map(([key, label]) => (
                                          <th key={key} onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))} style={{ textAlign: 'left', padding: '6px 12px', fontWeight: 500, color: 'var(--tx2)', cursor: 'pointer' }}>
                                            {label}{sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                                          </th>
                                        ))}
                                        <th style={{ textAlign: 'left', padding: '6px 12px', fontWeight: 500, color: 'var(--tx2)' }}>Comment</th>
                                        <th style={{ textAlign: 'left', padding: '6px 12px', fontWeight: 500, color: 'var(--tx2)' }}>Next steps</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {krItems.map((d) => {
                                        const lc = d.comments?.length ? d.comments[d.comments.length - 1] : null
                                        return (
                                          <tr key={d.id} style={{ borderTop: '0.5px solid var(--bd)' }}>
                                            <td style={{ padding: '6px 12px' }}>
                                              <input type="checkbox" checked={!!selected[d.id]} onChange={(e) => setSelected((s) => ({ ...s, [d.id]: e.target.checked }))} />
                                            </td>
                                            <td onClick={() => onOpen(d.id)} style={{ padding: '6px 12px', cursor: 'pointer' }}>
                                              {d.title}<RevisionFlag item={d} />
                                              <div style={{ color: 'var(--tx2)', fontSize: 11 }}>{ownerName(d.owner_id)}</div>
                                            </td>
                                            <td onClick={() => onOpen(d.id)} style={{ padding: '6px 12px', cursor: 'pointer' }}><StatusBadge status={d.status} overdue={isOverdue(d)} /></td>
                                            <td onClick={() => onOpen(d.id)} style={{ padding: '6px 12px', color: 'var(--tx2)', whiteSpace: 'nowrap', cursor: 'pointer' }}>{fmtDate(d.due_date) || '—'}</td>
                                            <td onClick={() => onOpen(d.id)} style={{ padding: '6px 12px', color: 'var(--tx2)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}>{lc?.text || '—'}</td>
                                            <td onClick={() => onOpen(d.id)} style={{ padding: '6px 12px', color: 'var(--tx2)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}>{d.next_steps || '—'}</td>
                                          </tr>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function CalendarView({ items, onOpen }) {
  const [monthOffset, setMonthOffset] = useState(0)
  const [selectedDate, setSelectedDate] = useState(null)
  const base = new Date(); base.setDate(1); base.setMonth(base.getMonth() + monthOffset)
  const year = base.getFullYear(), month = base.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const startWeekday = new Date(year, month, 1).getDay()
  const byDate = {}
  items.forEach((d) => { if (d.due_date) { byDate[d.due_date] = byDate[d.due_date] || []; byDate[d.due_date].push(d) } })
  const cells = []
  for (let i = 0; i < startWeekday; i++) cells.push(null)
  for (let day = 1; day <= daysInMonth; day++) cells.push(day)
  const dateStr = (day) => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <button onClick={() => setMonthOffset((m) => m - 1)} style={btnStyle()}>‹</button>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{base.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</span>
        <button onClick={() => setMonthOffset((m) => m + 1)} style={btnStyle()}>›</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, marginBottom: 6 }}>
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((w) => <div key={w} style={{ fontSize: 11, color: 'var(--txm)', textAlign: 'center' }}>{w}</div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={i} />
          const ds = dateStr(day)
          const dayItems = byDate[ds] || []
          const hasOverdue = dayItems.some(isOverdue)
          return (
            <button key={i} onClick={() => setSelectedDate(ds)} style={{ aspectRatio: '1', borderRadius: 8, border: `0.5px solid ${selectedDate === ds ? 'var(--acc-fill)' : 'var(--bd)'}`, background: ds === todayISO() ? 'var(--acc-bg)' : 'var(--bg2)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
              <span style={{ fontSize: 12 }}>{day}</span>
              {dayItems.length > 0 && <span style={{ width: 5, height: 5, borderRadius: '50%', background: hasOverdue ? 'var(--dgr-fill)' : 'var(--acc-fill)' }} />}
            </button>
          )
        })}
      </div>
      <div style={{ marginTop: 16 }}>
        {selectedDate && (byDate[selectedDate] || []).length > 0 ? (
          <>
            <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Due {fmtDate(selectedDate)}</p>
            {byDate[selectedDate].map((d) => (
              <div key={d.id} onClick={() => onOpen(d.id)} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', border: '0.5px solid var(--bd)', borderRadius: 8, marginBottom: 6, cursor: 'pointer', fontSize: 13 }}>
                <span>{d.title}</span><StatusBadge status={d.status} overdue={isOverdue(d)} />
              </div>
            ))}
          </>
        ) : selectedDate ? <EmptyState msg={`Nothing due ${fmtDate(selectedDate)}.`} /> : <p style={{ fontSize: 12, color: 'var(--txm)' }}>Click a date to see what's due.</p>}
      </div>
    </div>
  )
}

function ActivityView({ deliverables, ownerName, onOpen }) {
  const [preset, setPreset] = useState(7)
  const [range, setRange] = useState({ from: '', to: '' })
  const from = range.from || new Date(Date.now() - preset * 86400000).toISOString().slice(0, 10)
  const to = range.to || todayISO()
  const moved = deliverables.filter((d) => d.status_changed_date && d.status_changed_date >= from && d.status_changed_date <= to)
  const owners = [...new Set(moved.map((d) => d.owner_id))]
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        {[7, 14, 30].map((n) => <button key={n} onClick={() => { setPreset(n); setRange({ from: '', to: '' }) }} style={btnStyle()}>Last {n} days</button>)}
        <span style={{ fontSize: 12, color: 'var(--txm)' }}>or custom:</span>
        <input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} style={inputStyle({ width: 'auto' })} />
        <span style={{ fontSize: 12, color: 'var(--txm)' }}>to</span>
        <input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} style={inputStyle({ width: 'auto' })} />
      </div>
      {!owners.length ? <EmptyState msg={`No movement between ${fmtDate(from)} and ${fmtDate(to)}.`} /> : owners.map((o) => {
        const items = moved.filter((d) => d.owner_id === o)
        return (
          <div key={o} style={{ border: '0.5px solid var(--bd)', borderRadius: 10, overflow: 'hidden', marginBottom: 10 }}>
            <div style={{ background: 'var(--bg1)', padding: '8px 12px', fontSize: 13, fontWeight: 500 }}>{ownerName(o)} · {items.length} moved</div>
            {items.map((d) => (
              <div key={d.id} onClick={() => onOpen(d.id)} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderTop: '0.5px solid var(--bd)', fontSize: 13, cursor: 'pointer' }}>
                <span>{d.title}</span><StatusBadge status={d.status} overdue={isOverdue(d)} />
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

function SummaryView({ deliverables, profiles }) {
  const rows = profiles.filter((p) => p.role !== 'admin').map((p) => {
    const items = deliverables.filter((d) => d.owner_id === p.id)
    const completed = items.filter((d) => d.status === 'Completed').length
    const pct = items.length ? Math.round((completed / items.length) * 100) : 0
    return { name: p.full_name, pct, total: items.length }
  }).filter((r) => r.total > 0)
  const total = deliverables.length
  const completed = deliverables.filter((d) => d.status === 'Completed').length
  const overdue = deliverables.filter(isOverdue).length
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
        {[['Overall completion', (total ? Math.round((completed / total) * 100) : 0) + '%'], ['Completed', completed], ['Overdue', overdue], ['Active total', total - completed]].map(([l, v]) => (
          <div key={l} style={{ background: 'var(--bg1)', borderRadius: 8, padding: '12px 16px' }}>
            <p style={{ fontSize: 12, color: 'var(--tx2)', margin: '0 0 4px' }}>{l}</p><p style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>{v}</p>
          </div>
        ))}
      </div>
      <div style={{ background: 'var(--bg2)', border: '0.5px solid var(--bd)', borderRadius: 12, padding: 16 }}>
        {rows.map((r) => (
          <div key={r.name} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}><span>{r.name}</span><span style={{ fontWeight: 500 }}>{r.pct}%</span></div>
            <div style={{ height: 6, background: 'var(--bg1)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: r.pct + '%', background: r.pct >= 65 ? 'var(--acc-fill)' : r.pct >= 50 ? 'var(--wrn-fill)' : 'var(--dgr-fill)' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ActionsView({ keyActions, profiles, isAdmin, ownerName, onOpen, onAdd, onDelete }) {
  if (!keyActions.length) return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}><button onClick={onAdd} style={btnStyle()}>+ Add action</button></div>
      <EmptyState msg="No action items logged yet." />
    </div>
  )
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}><button onClick={onAdd} style={btnStyle()}>+ Add action</button></div>
      <div style={{ border: '0.5px solid var(--bd)', borderRadius: 10, overflow: 'auto' }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', minWidth: 760 }}>
          <thead><tr style={{ background: 'var(--bg1)' }}>
            {['Deliverable / action', 'Raised in', 'Owner', 'Due', 'Status', 'Comment', ''].map((h) => <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 12, color: 'var(--tx2)', fontWeight: 500 }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {keyActions.map((a) => (
              <tr key={a.id} onClick={() => onOpen(a.id)} style={{ borderTop: '0.5px solid var(--bd)', cursor: 'pointer' }}>
                <td style={{ padding: '8px 12px' }}>{a.title}</td>
                <td style={{ padding: '8px 12px', color: 'var(--tx2)' }}>{a.raised_in}</td>
                <td style={{ padding: '8px 12px', color: 'var(--tx2)' }}>{ownerName(a.owner_id)}</td>
                <td style={{ padding: '8px 12px', color: 'var(--tx2)', whiteSpace: 'nowrap' }}>{fmtDate(a.due_date) || '—'}</td>
                <td style={{ padding: '8px 12px' }}><StatusBadge status={a.status} overdue={a.due_date && a.status !== 'Completed' && a.due_date < todayISO()} /></td>
                <td style={{ padding: '8px 12px', color: 'var(--tx2)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.comment || '—'}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right' }}>{isAdmin && <button onClick={(e) => { e.stopPropagation(); onDelete(a.id) }} style={{ fontSize: 11, color: 'var(--dgr-tx)', background: 'none', border: 'none', cursor: 'pointer' }}>Delete</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function EmptyState({ msg }) { return <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--txm)' }}><p style={{ fontSize: 13, margin: 0 }}>{msg}</p></div> }

function DeliverableModal({ item, isNewObjective, isAdmin, profiles, userId, onClose, onSave, reloadDeliverables }) {
  const isNew = !item
  const lockCore = !isAdmin && !isNew
  const [form, setForm] = useState(item ? {
    id: item.id, title: item.title, corporateObjective: item.corporate_objective || '', pmObjective: item.pm_objective || '', keyResult: item.key_result || '',
    division: item.division, ownerId: item.owner_id, status: item.status, dueDate: item.due_date || '', revisedDueDate: item.revised_due_date || '',
    revisionReason: item.revision_reason || '', nextSteps: item.next_steps || '',
  } : {
    title: '', corporateObjective: '', pmObjective: '', keyResult: '', division: Object.values(OWNER_FUNCTIONS)[0][0], ownerId: profiles[0]?.id,
    status: 'Not Started', dueDate: todayISO(), revisedDueDate: '', revisionReason: '', nextSteps: '',
  })
  const [comments, setComments] = useState([])
  const [commentText, setCommentText] = useState('')
  const [subs, setSubs] = useState([])
  const [subTitle, setSubTitle] = useState('')
  const [subOwner, setSubOwner] = useState(profiles[0]?.id)
  const [showHistory, setShowHistory] = useState(false)
  const [err, setErr] = useState('')
  const modalRef = React.useRef(null)
  const originalRevised = item?.revised_due_date || ''

  useEffect(() => { modalRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, [])
  useEffect(() => {
    if (!isNew) {
      supabase.from('comments').select('*, author:profiles(full_name)').eq('deliverable_id', item.id).order('created_at').then(({ data }) => setComments(data || []))
      supabase.from('sub_deliverables').select('*').eq('deliverable_id', item.id).then(({ data }) => setSubs(data || []))
    }
    // eslint-disable-next-line
  }, [])

  const ownerFunctions = OWNER_FUNCTIONS[profiles.find((p) => p.id === form.ownerId)?.full_name] || DIVISIONS

  const postComment = async () => {
    if (!commentText.trim()) return
    await supabase.from('comments').insert({ deliverable_id: item.id, author_id: userId, text: commentText.trim() })
    setCommentText('')
    const { data } = await supabase.from('comments').select('*, author:profiles(full_name)').eq('deliverable_id', item.id).order('created_at')
    setComments(data || [])
  }

  const addSub = async () => {
    if (!subTitle.trim()) return
    if (isNew) { setSubs((s) => [...s, { id: 'local' + s.length, title: subTitle.trim(), owner_id: subOwner, status: 'Not Started' }]); setSubTitle(''); return }
    await supabase.from('sub_deliverables').insert({ deliverable_id: item.id, title: subTitle.trim(), owner_id: subOwner, status: 'Not Started' })
    setSubTitle('')
    const { data } = await supabase.from('sub_deliverables').select('*').eq('deliverable_id', item.id)
    setSubs(data || [])
  }
  const removeSub = async (id) => {
    if (!id.toString().startsWith('local')) await supabase.from('sub_deliverables').delete().eq('id', id)
    setSubs((s) => s.filter((x) => x.id !== id))
  }
  const updateSubStatus = async (id, status) => {
    if (!id.toString().startsWith('local')) await supabase.from('sub_deliverables').update({ status }).eq('id', id)
    setSubs((s) => s.map((x) => (x.id === id ? { ...x, status } : x)))
  }

  const handleSave = () => {
    if (!form.title.trim()) { setErr('Enter a deliverable title first.'); return }
    onSave(form, isNew, isNewObjective, originalRevised)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 50 }}>
      <div ref={modalRef} style={{ background: 'var(--bg2)', color: 'var(--tx1)', borderRadius: 12, width: '100%', maxWidth: 460, maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '0.5px solid var(--bd)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 15, fontWeight: 500 }}>{isNewObjective ? 'New corporate objective' : isNew ? 'Add deliverable' : 'Edit deliverable'}</span>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--txm)' }}>✕</button>
        </div>
        {isNewObjective && <div style={{ margin: '12px 1.25rem 0', padding: '8px 12px', background: 'var(--acc-bg)', color: 'var(--acc-tx)', borderRadius: 8, fontSize: 12 }}>Fill in the new objective, its PM Objective, Key Result, and first deliverable.</div>}
        <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Title"><input disabled={lockCore} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} style={inputStyle({ width: '100%' })} /></Field>
          <Field label="Corporate objective"><input disabled={lockCore} value={form.corporateObjective} onChange={(e) => setForm((f) => ({ ...f, corporateObjective: e.target.value }))} style={inputStyle({ width: '100%' })} /></Field>
          <Field label="PM objective"><input disabled={lockCore} value={form.pmObjective} onChange={(e) => setForm((f) => ({ ...f, pmObjective: e.target.value }))} style={inputStyle({ width: '100%' })} /></Field>
          <Field label="Key result"><input disabled={lockCore} value={form.keyResult} onChange={(e) => setForm((f) => ({ ...f, keyResult: e.target.value }))} style={inputStyle({ width: '100%' })} /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Owner">
              <select disabled={lockCore} value={form.ownerId} onChange={(e) => setForm((f) => ({ ...f, ownerId: e.target.value, division: (OWNER_FUNCTIONS[profiles.find((p) => p.id === e.target.value)?.full_name] || DIVISIONS)[0] }))} style={inputStyle({ width: '100%' })}>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </Field>
            <Field label="Division">
              <select disabled={lockCore} value={form.division} onChange={(e) => setForm((f) => ({ ...f, division: e.target.value }))} style={inputStyle({ width: '100%' })}>
                {ownerFunctions.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Status">
            <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} style={inputStyle({ width: '100%' })}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label={`Due date${!isAdmin ? ' (admin only)' : ''}`}><input type="date" disabled={!isAdmin} value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} style={inputStyle({ width: '100%' })} /></Field>
            <Field label="Revised due date"><input type="date" value={form.revisedDueDate} onChange={(e) => setForm((f) => ({ ...f, revisedDueDate: e.target.value }))} style={inputStyle({ width: '100%' })} /></Field>
          </div>
          <Field label="Revision reason"><input value={form.revisionReason} onChange={(e) => setForm((f) => ({ ...f, revisionReason: e.target.value }))} style={inputStyle({ width: '100%' })} placeholder="Why is the date shifting?" /></Field>
          <Field label="Next steps"><textarea rows={2} value={form.nextSteps} onChange={(e) => setForm((f) => ({ ...f, nextSteps: e.target.value }))} style={inputStyle({ width: '100%', resize: 'vertical', fontFamily: 'inherit' })} /></Field>

          <div>
            <p style={{ fontSize: 12, color: 'var(--tx2)', margin: '0 0 6px' }}>Sub-deliverables</p>
            {subs.length === 0 && <p style={{ fontSize: 12, color: 'var(--txm)', margin: 0 }}>No sub-deliverables yet.</p>}
            {subs.map((s) => (
              <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 6, alignItems: 'center', padding: '4px 0' }}>
                <span style={{ fontSize: 12 }}>{s.title}</span>
                <span style={{ fontSize: 11, color: 'var(--tx2)' }}>{profiles.find((p) => p.id === s.owner_id)?.full_name}</span>
                <select value={s.status} onChange={(e) => updateSubStatus(s.id, e.target.value)} style={inputStyle({ fontSize: 11 })}>
                  {STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
                </select>
                {!lockCore && <button onClick={() => removeSub(s.id)} style={{ border: 'none', background: 'none', color: 'var(--txm)', cursor: 'pointer' }}>✕</button>}
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 6, marginTop: 6 }}>
              <input value={subTitle} onChange={(e) => setSubTitle(e.target.value)} placeholder="Sub-deliverable title…" style={inputStyle()} />
              <select value={subOwner} onChange={(e) => setSubOwner(e.target.value)} style={inputStyle()}>{profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>
              <button onClick={addSub} style={btnStyle()}>Add</button>
            </div>
          </div>

          {!isNew && (
            <>
              <div>
                <p style={{ fontSize: 12, color: 'var(--tx2)', margin: '0 0 6px' }}>Comment</p>
                <div style={{ maxHeight: 120, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {comments.length === 0 && <p style={{ fontSize: 12, color: 'var(--txm)', margin: 0 }}>No comments yet.</p>}
                  {comments.map((c) => (
                    <div key={c.id} style={{ fontSize: 12 }}>
                      <span style={{ fontWeight: 500 }}>{c.author?.full_name}</span> <span style={{ color: 'var(--txm)' }}>· {new Date(c.created_at).toLocaleDateString()}</span>
                      <div>{c.text}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <input value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Add a comment…" style={inputStyle({ flex: 1 })} />
                  <button onClick={postComment} style={btnStyle()}>Post</button>
                </div>
              </div>
              <div>
                <button onClick={() => setShowHistory((s) => !s)} style={{ fontSize: 12, color: 'var(--acc-tx)', border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}>{showHistory ? 'Hide history' : 'View history'}</button>
                {showHistory && <p style={{ fontSize: 12, color: 'var(--tx2)', marginTop: 8 }}>Created {new Date(item.created_at).toLocaleString()}, last updated {new Date(item.updated_at).toLocaleString()}.</p>}
              </div>
            </>
          )}
          {err && <div style={{ fontSize: 12, color: 'var(--dgr-tx)' }}>{err}</div>}
        </div>
        <div style={{ padding: '1rem 1.25rem', borderTop: '0.5px solid var(--bd)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={btnStyle()}>Cancel</button>
          <button onClick={handleSave} style={primaryBtnStyle()}>Save</button>
        </div>
      </div>
    </div>
  )
}

function ActionModal({ action, profiles, onClose, onSave }) {
  const isNew = !action
  const [form, setForm] = useState(action ? {
    id: action.id, title: action.title, raisedIn: action.raised_in || '', ownerId: action.owner_id, dueDate: action.due_date || '', status: action.status, comment: action.comment || '',
  } : { title: '', raisedIn: '', ownerId: profiles[0]?.id, dueDate: todayISO(), status: 'Not Started', comment: '' })
  const [err, setErr] = useState('')
  const modalRef = React.useRef(null)
  useEffect(() => { modalRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 50 }}>
      <div ref={modalRef} style={{ background: 'var(--bg2)', color: 'var(--tx1)', borderRadius: 12, width: '100%', maxWidth: 420, maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '0.5px solid var(--bd)', display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 15, fontWeight: 500 }}>{isNew ? 'Add action item' : 'Edit action item'}</span>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Deliverable / action"><input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} style={inputStyle({ width: '100%' })} /></Field>
          <Field label="Raised in"><input value={form.raisedIn} onChange={(e) => setForm((f) => ({ ...f, raisedIn: e.target.value }))} style={inputStyle({ width: '100%' })} placeholder="e.g. Bi-weekly CPO Review" /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Owner"><select value={form.ownerId} onChange={(e) => setForm((f) => ({ ...f, ownerId: e.target.value }))} style={inputStyle({ width: '100%' })}>{profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></Field>
            <Field label="Due date"><input type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} style={inputStyle({ width: '100%' })} /></Field>
          </div>
          <Field label="Status"><select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} style={inputStyle({ width: '100%' })}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
          <Field label="Comment"><textarea rows={2} value={form.comment} onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))} style={inputStyle({ width: '100%', resize: 'vertical', fontFamily: 'inherit' })} /></Field>
          {err && <div style={{ fontSize: 12, color: 'var(--dgr-tx)' }}>{err}</div>}
        </div>
        <div style={{ padding: '1rem 1.25rem', borderTop: '0.5px solid var(--bd)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={btnStyle()}>Cancel</button>
          <button onClick={() => { if (!form.title.trim()) { setErr('Enter a title first.'); return } onSave(form, isNew) }} style={primaryBtnStyle()}>Save</button>
        </div>
      </div>
    </div>
  )
}

function ExportDialog({ filters, onCancel, onExport }) {
  const [useFiltered, setUseFiltered] = useState(false)
  const [includeActions, setIncludeActions] = useState(true)
  const filtersActive = filters.search || filters.division !== 'all' || filters.owner !== 'all' || filters.status !== 'all' || filters.overdueOnly
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 50 }}>
      <div style={{ background: 'var(--bg2)', color: 'var(--tx1)', borderRadius: 12, width: '100%', maxWidth: 380, padding: 20 }}>
        <p style={{ fontSize: 15, fontWeight: 500, margin: '0 0 12px' }}>Export to Excel</p>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 10 }}>
          <input type="radio" name="scope" checked={!useFiltered} onChange={() => setUseFiltered(false)} /> All deliverables
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 10, opacity: filtersActive ? 1 : 0.5 }}>
          <input type="radio" name="scope" disabled={!filtersActive} checked={useFiltered} onChange={() => setUseFiltered(true)} /> Just what's currently filtered {!filtersActive && '(no filters active)'}
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 16 }}>
          <input type="checkbox" checked={includeActions} onChange={(e) => setIncludeActions(e.target.checked)} /> Include Key Action Log as a second sheet
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onCancel} style={btnStyle()}>Cancel</button>
          <button onClick={() => onExport(useFiltered, includeActions)} style={primaryBtnStyle()}>Export</button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) { return <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--tx2)' }}>{label}{children}</label> }

function ConfirmDialog({ message, onCancel, onConfirm }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 50 }}>
      <div style={{ background: 'var(--bg2)', color: 'var(--tx1)', borderRadius: 12, width: '100%', maxWidth: 320, padding: 20 }}>
        <p style={{ fontSize: 13, margin: '0 0 16px' }}>{message}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onCancel} style={btnStyle()}>Cancel</button>
          <button onClick={onConfirm} style={{ ...primaryBtnStyle(), background: 'var(--dgr-fill)' }}>Delete</button>
        </div>
      </div>
    </div>
  )
}
