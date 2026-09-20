import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'
import AuthGate from './AuthGate'
import NotificationBell from './NotificationBell'
import { exportToExcel } from './exportExcel'
import { generateCpoReviewPack, generatePersonalReviewPack } from './exportPpt'
import ImportDialog from './ImportDialog'
import { OWNER_FUNCTIONS, DIVISIONS, STATUSES, CO_COLORS } from './constants'
import RecruitmentModule from './RecruitmentModule'

const LIGHT = { '--bg0': '#F4F6F8', '--bg1': '#FFFFFF', '--bg2': '#FFFFFF', '--tx1': '#172033', '--tx2': '#4B5B6B', '--txm': '#8492A0', '--bd': '#E1E7EC', '--bds': '#CBD7E0', '--acc-bg': '#E5F3FB', '--acc-tx': '#006FB9', '--acc-fill': '#0077BD', '--dgr-bg': '#FAECE7', '--dgr-tx': '#993C1D', '--wrn-bg': '#FAEEDA', '--wrn-tx': '#854F0B', '--suc-bg': '#E1F5EE', '--suc-tx': '#085041', '--suc-fill': '#2E9E75', '--wrn-fill': '#EF9F27', '--dgr-fill': '#D85A30', '--neu-bg': '#EEF2F5', '--neu-tx': '#52606D', '--neu-fill': '#AAB8C4', '--navy': '#0E2A43' }
const DARK = { '--bg0': '#091722', '--bg1': '#0F2233', '--bg2': '#142C40', '--tx1': '#F4F8FC', '--tx2': '#C2D2DF', '--txm': '#8296A8', '--bd': '#274357', '--bds': '#39576B', '--acc-bg': '#0A3655', '--acc-tx': '#72C4F2', '--acc-fill': '#1594D0', '--dgr-bg': '#3A1B10', '--dgr-tx': '#F0997B', '--wrn-bg': '#3A2A0E', '--wrn-tx': '#F5C775', '--suc-bg': '#0C2A22', '--suc-tx': '#5DCAA5', '--suc-fill': '#3C8F72', '--wrn-fill': '#EF9F27', '--dgr-fill': '#E8724A', '--neu-bg': '#1A3347', '--neu-tx': '#C2D2DF', '--neu-fill': '#637A8C', '--navy': '#061B2B' }

function localISODate(date) {
  const d = date || new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
const todayISO = () => localISODate()
function currentWeekStart() {
  const d = new Date()
  const day = d.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diffToMonday)
  return localISODate(d)
}
function currentWeekEnd() {
  const d = new Date()
  const day = d.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diffToMonday + 6)
  return localISODate(d)
}
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
    if (window.location.hash.includes('type=recovery')) {
      setRecoveryMode(true)
    }
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
  const [strategyNodes, setStrategyNodes] = useState([])
  const [keyActions, setKeyActions] = useState([])
  const [actionStatuses, setActionStatuses] = useState([])
  const [view, setView] = useState('summary')
  const [filters, setFilters] = useState({ search: '', divisions: [], owner: 'all', status: 'all', overdueOnly: false })
  const [actionFilter, setActionFilter] = useState({ status: 'all', overdueOnly: false })
  const [collapsed, setCollapsed] = useState({})
  const [selected, setSelected] = useState({})
  const [sort, setSort] = useState({ key: 'due_date', dir: 'asc' })
  const [editing, setEditing] = useState(null)
  const [editingAction, setEditingAction] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [showExport, setShowExport] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showPpt, setShowPpt] = useState(null)
  const [pptBusy, setPptBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [appMode, setAppMode] = useState('deliverables') // 'deliverables' | 'recruitment'
  const [recruitmentTab, setRecruitmentTab] = useState('overview')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const userId = session.user.id

  useEffect(() => {
    loadProfile(); loadProfiles(); loadDeliverables(); loadStrategyNodes(); loadKeyActions(); loadActionStatuses()
    const ch = supabase.channel('deliverables-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'deliverables' }, loadDeliverables).subscribe()
    const ch2 = supabase.channel('action-status-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'action_item_statuses' }, loadActionStatuses).subscribe()
    return () => { supabase.removeChannel(ch); supabase.removeChannel(ch2) }
    // eslint-disable-next-line
  }, [])

  const loadProfile = async () => { const { data } = await supabase.from('profiles').select('*').eq('id', userId).single(); setProfile(data) }
  const loadProfiles = async () => { const { data } = await supabase.from('profiles').select('*').order('full_name'); setProfiles(data || []) }
  const loadDeliverables = async () => {
    const { data } = await supabase.from('deliverables').select('*, comments(*)').order('created_at', { ascending: false })
    setDeliverables(data || []); setLoading(false)
  }
  const loadStrategyNodes = async () => { const { data } = await supabase.from('strategy_nodes').select('*').order('node_type').order('sort_order').order('name'); setStrategyNodes(data || []) }
  const loadKeyActions = async () => { const { data } = await supabase.from('key_actions').select('*').order('created_at', { ascending: false }); setKeyActions(data || []) }
  const loadActionStatuses = async () => { const { data } = await supabase.from('action_item_statuses').select('*'); setActionStatuses(data || []) }

  const isAdmin = profile?.role === 'admin'
  const ownerName = (id) => profiles.find((p) => p.id === id)?.full_name || 'Unassigned'
  const lastComment = (d) => (d.comments?.length ? d.comments[d.comments.length - 1] : null)

  const myActionStatus = (a) => {
    if (!a.shared) return a.status
    const row = actionStatuses.find((s) => s.action_id === a.id && s.user_id === userId)
    return row ? row.status : 'Not Started'
  }
  const isPersonInAction = (a, personId) => a.shared
    ? actionStatuses.some((s) => s.action_id === a.id && s.user_id === personId)
    : a.owner_id === personId
  const isActionOverdue = (a, status) => a.due_date && status !== 'Completed' && a.due_date < todayISO()
  const aggregateSharedStatus = (rows) => {
    if (!rows.length) return 'Not Started'
    if (rows.every((r) => r.status === 'Completed')) return 'Completed'
    if (rows.some((r) => r.status === 'In Progress' || r.status === 'Completed')) return 'In Progress'
    return 'Not Started'
  }
  const expandedActions = (isAdmin
    ? keyActions.map((a) => {
        if (!a.shared) return { ...a, _effStatus: a.status }
        const rows = actionStatuses.filter((s) => s.action_id === a.id)
        return { ...a, _effStatus: aggregateSharedStatus(rows) }
      })
    : keyActions
        .filter((a) => isPersonInAction(a, userId))
        .map((a) => ({ ...a, _effStatus: myActionStatus(a), _owner: userId })))
  const actionItemsForMetrics = expandedActions.map((a) => ({ status: a._effStatus, due_date: a.due_date }))

  const visibleDeliverables = isAdmin ? deliverables : deliverables.filter((d) => d.owner_id === userId)

  const getFiltered = () =>
    visibleDeliverables.filter((d) => {
      if (filters.search && !d.title.toLowerCase().includes(filters.search.toLowerCase())) return false
      if (filters.divisions.length && !filters.divisions.includes(d.division)) return false
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
      const { data: inserted, error } = await supabase.from('deliverables').insert(payload).select('id, owner_id').single()
      if (error) { alert(error.message); return }
      if (!inserted || inserted.owner_id !== form.ownerId) {
        alert('The deliverable was saved, but the HRBP assignment could not be confirmed. Please try again.')
        return
      }
    } else {
      const { data: updated, error } = await supabase.from('deliverables').update(payload).eq('id', form.id).select('id, owner_id').single()
      if (error) { alert(error.message); return }
      if (!updated || updated.owner_id !== form.ownerId) {
        alert('The deliverable was saved, but the HRBP assignment could not be confirmed. Please try again.')
        return
      }
    }
    setEditing(null); loadDeliverables()
  }

  const quickAddDeliverable = async ({ title, corporateObjective, pmObjective, keyResult, ownerId, dueDate, corporateObjectiveId, pmObjectiveId, keyResultId }) => {
    const fallbackOwner = profiles.find((p) => p.role !== 'admin')?.id || profiles[0]?.id || userId
    const selectedOwner = isAdmin ? (ownerId || fallbackOwner) : userId
    const ownerProfile = profiles.find((p) => p.id === selectedOwner)
    const division = OWNER_FUNCTIONS[ownerProfile?.full_name]?.[0] || DIVISIONS[0] || ''
    const payload = { title, corporate_objective: corporateObjective, pm_objective: pmObjective, key_result: keyResult, corporate_objective_id: corporateObjectiveId, pm_objective_id: pmObjectiveId, key_result_id: keyResultId, division, owner_id: selectedOwner, status: 'Not Started', due_date: dueDate || null, revised_due_date: null, revision_reason: '', next_steps: '' }
    const { data: inserted, error } = await supabase.from('deliverables').insert(payload).select('id, owner_id').single()
    if (error) { alert(error.message); return false }
    if (!inserted || inserted.owner_id !== selectedOwner) { alert('The deliverable was saved, but the HRBP assignment could not be confirmed. Please try again.'); return false }
    await loadDeliverables(); return true
  }
  const duplicateDeliverable = async ({ item }) => {
    const kr = strategyNodes.find((n) => n.id === item.key_result_id && n.node_type === 'key_result')
    if (!kr) { alert('This deliverable is not linked to a Key Result.'); return false }
    const pm = strategyNodes.find((n) => n.id === kr.parent_id && n.node_type === 'pm')
    const co = pm ? strategyNodes.find((n) => n.id === pm.parent_id && n.node_type === 'corporate') : null
    const payload = {
      title: item.title + ' (Copy)', corporate_objective: co?.name || item.corporate_objective || '',
      pm_objective: pm?.name || item.pm_objective || '', key_result: kr.name,
      corporate_objective_id: co?.id || item.corporate_objective_id || null,
      pm_objective_id: pm?.id || item.pm_objective_id || null, key_result_id: kr.id,
      division: item.division, owner_id: item.owner_id, status: 'Not Started',
      due_date: item.due_date || null, revised_due_date: null, revision_reason: '', next_steps: item.next_steps || '',
    }
    const { data, error } = await supabase.from('deliverables').insert(payload).select('id, owner_id').single()
    if (error) { alert(error.message); return false }
    if (!data || data.owner_id !== item.owner_id) { alert('The deliverable was duplicated, but the HRBP assignment could not be confirmed.'); return false }
    await loadDeliverables(); return true
  }

  const duplicateKeyResult = async ({ node }) => {
    const sourcePm = strategyNodes.find((n) => n.id === node.parent_id && n.node_type === 'pm')
    if (!sourcePm) return false
    const sourceCo = strategyNodes.find((n) => n.id === sourcePm.parent_id && n.node_type === 'corporate')
    const siblings = strategyNodes.filter((n) => n.node_type === 'key_result' && n.parent_id === sourcePm.id)
    const { data: newKr, error } = await supabase.from('strategy_nodes').insert({
      node_type: 'key_result', name: node.name + ' (Copy)', parent_id: sourcePm.id, sort_order: (node.sort_order ?? siblings.length) + 1,
    }).select('*').single()
    if (error) { alert(error.message); return false }
    const sourceItems = deliverables.filter((d) => d.key_result_id === node.id)
    if (sourceItems.length) {
      const copies = sourceItems.map((item) => ({
        title: item.title, corporate_objective: sourceCo?.name || item.corporate_objective || '',
        pm_objective: sourcePm.name, key_result: newKr.name,
        corporate_objective_id: sourceCo?.id || null, pm_objective_id: sourcePm.id, key_result_id: newKr.id,
        division: item.division, owner_id: item.owner_id, status: 'Not Started',
        due_date: item.due_date || null, revised_due_date: null, revision_reason: '', next_steps: item.next_steps || '',
      }))
      const { error: copyError } = await supabase.from('deliverables').insert(copies)
      if (copyError) {
        await supabase.from('strategy_nodes').delete().eq('id', newKr.id)
        alert(copyError.message); return false
      }
    }
    await loadStrategyNodes(); await loadDeliverables(); return true
  }

  const moveKeyResult = async ({ node, targetPmId }) => {
    if (!node || node.parent_id === targetPmId) return true
    const targetPm = strategyNodes.find((n) => n.id === targetPmId && n.node_type === 'pm')
    if (!targetPm) return false
    const targetCo = strategyNodes.find((n) => n.id === targetPm.parent_id && n.node_type === 'corporate')
    const siblings = strategyNodes.filter((n) => n.node_type === 'key_result' && n.parent_id === targetPm.id)
    const { error } = await supabase.from('strategy_nodes').update({ parent_id: targetPm.id, sort_order: siblings.length, updated_at: new Date().toISOString() }).eq('id', node.id)
    if (error) { alert(error.message); return false }
    const { error: linkError } = await supabase.from('deliverables').update({
      corporate_objective: targetCo?.name || '', pm_objective: targetPm.name,
      corporate_objective_id: targetCo?.id || null, pm_objective_id: targetPm.id,
    }).eq('key_result_id', node.id)
    if (linkError) { alert(linkError.message); return false }
    await loadStrategyNodes(); await loadDeliverables(); return true
  }

  const moveDeliverable = async ({ item, targetKeyResultId }) => {
    if (!item || item.key_result_id === targetKeyResultId) return true
    const kr = strategyNodes.find((n) => n.id === targetKeyResultId && n.node_type === 'key_result')
    if (!kr) return false
    const pm = strategyNodes.find((n) => n.id === kr.parent_id && n.node_type === 'pm')
    const co = pm ? strategyNodes.find((n) => n.id === pm.parent_id && n.node_type === 'corporate') : null
    const { error } = await supabase.from('deliverables').update({
      corporate_objective: co?.name || '', pm_objective: pm?.name || '', key_result: kr.name,
      corporate_objective_id: co?.id || null, pm_objective_id: pm?.id || null, key_result_id: kr.id,
    }).eq('id', item.id)
    if (error) { alert(error.message); return false }
    await loadDeliverables(); return true
  }

  const createStrategyNode = async ({ nodeType, name, parentId }) => {
    const siblings = strategyNodes.filter((n) => n.node_type === nodeType && (n.parent_id || null) === (parentId || null))
    const { data, error } = await supabase.from('strategy_nodes').insert({ node_type: nodeType, name: name.trim(), parent_id: parentId || null, sort_order: siblings.length }).select('*').single()
    if (error) { alert(error.message); return null }
    setStrategyNodes((n) => [...n, data])
    return data
  }

  const renameStrategyNode = async (node, name) => {
    const value = name.trim()
    if (!value || value === node.name) return
    const { error } = await supabase.from('strategy_nodes').update({ name: value, updated_at: new Date().toISOString() }).eq('id', node.id)
    if (error) { alert(error.message); return }
    const field = node.node_type === 'corporate' ? 'corporate_objective' : node.node_type === 'pm' ? 'pm_objective' : 'key_result'
    const idField = node.node_type === 'corporate' ? 'corporate_objective_id' : node.node_type === 'pm' ? 'pm_objective_id' : 'key_result_id'
    const { error: linkError } = await supabase.from('deliverables').update({ [field]: value }).eq(idField, node.id)
    if (linkError) { alert(linkError.message); return }
    setStrategyNodes((n) => n.map((x) => x.id === node.id ? { ...x, name: value } : x))
    await loadDeliverables()
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

  const kpiSource = (view === 'board' || view === 'deliverables' || view === 'calendar') ? getFiltered() : visibleDeliverables

  if (loading || !profile) return <div style={{ minHeight: '100vh', background: 'var(--bg0)' }} />

  return (
    <div data-app-shell style={{ minHeight: '100vh', background: 'var(--bg0)', color: 'var(--tx1)', display: 'flex' }}>
      <style>{`
        @media (max-width: 1100px) {
          [data-app-main] { padding-left: 20px !important; padding-right: 20px !important; }
        }
        @media (max-width: 1100px) {
          [data-app-shell] { flex-direction: column !important; }
          [data-app-sidebar] {
            position: fixed !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            width: 100% !important;
            min-width: 0 !important;
            height: 64px !important;
            box-sizing: border-box !important;
            flex-direction: row !important;
            align-items: stretch !important;
            justify-content: stretch !important;
            padding: 6px 8px !important;
            gap: 6px !important;
            border-right: none !important;
            border-top: 1px solid var(--bd) !important;
            z-index: 100 !important;
          }
          [data-sidebar-brand], [data-sidebar-section] { display: none !important; }
          [data-mobile-tracker-nav] { display: block !important; }
          [data-app-sidebar] [data-nav] {
            flex: 1 !important;
            justify-content: center !important;
            border-left: none !important;
            border-top: 3px solid transparent !important;
            border-radius: 7px !important;
            padding: 8px 10px !important;
          }
          [data-app-sidebar] [data-nav][data-active="true"] {
            border-top-color: var(--acc-fill) !important;
          }
          [data-app-sidebar] [data-nav] span:last-child { white-space: nowrap; }
          [data-app-main] {
            max-width: none !important;
            padding: 16px 12px 88px !important;
          }
          [data-recruitment-kpis] { grid-template-columns: repeat(4, minmax(0, 1fr)) !important; }
          [data-recruitment-filter-grid] { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
          .deliverables-board-grid { grid-template-columns: 1fr !important; }
          .deliverables-nav { overflow-x: auto !important; flex-wrap: nowrap !important; scrollbar-width: none; }
          .deliverables-nav::-webkit-scrollbar { display: none; }
          .deliverables-nav button { flex: 0 0 auto !important; white-space: nowrap !important; }
          .deliverables-table-wrap { width: 100%; }
          .hierarchy-corporate { margin-bottom: 18px; border: 1px solid var(--bd); border-radius: 12px; overflow: hidden; background: var(--bg2); }
          .hierarchy-corporate-header { min-height: 58px; }
          .hierarchy-pm { margin: 0 20px; border-top: 1px solid var(--bd); }
          .hierarchy-pm-header { min-height: 48px; }
          .hierarchy-kr { margin: 8px 0 18px 22px; border-left: 2px solid var(--bd); overflow: hidden; background: var(--bg2); }
          .hierarchy-kr:last-child { margin-bottom: 20px; }
          .hierarchy-row-actions { opacity: 0; transition: opacity .15s ease; }
          .hierarchy-kr-header:hover .hierarchy-row-actions, .hierarchy-pm-header:hover .hierarchy-row-actions, .hierarchy-corporate-header:hover .hierarchy-row-actions { opacity: 1; }
          .hierarchy-table thead th { background: var(--bg0); }
          .hierarchy-table tbody tr:hover { background: var(--acc-bg); }
          .hierarchy-table tbody tr { transition: background .12s ease; }
          .hierarchy-empty { padding: 14px 16px; background: var(--bg1); color: var(--txm); font-size: 11px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
          .hierarchy-kr-header { min-height: 44px; }
          .hierarchy-table td, .hierarchy-table th { vertical-align: middle; }
          .hierarchy-table tbody tr td:nth-child(3) { color: var(--tx1); }
          @media (max-width: 700px) { .hierarchy-kr { margin-left: 8px; margin-right: 0; } .hierarchy-pm { margin: 0 8px; } }
          @media (max-width: 700px) { .hierarchy-row-actions { opacity: 1; } .hierarchy-kr { margin-left: 8px; margin-right: 0; } .hierarchy-pm { margin: 0 8px; } }
          .summary-dashboard-grid { grid-template-columns: 1fr !important; }
          .summary-metrics > div { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
          .summary-action-metrics > div { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
          .summary-section-heading { align-items: flex-start !important; }
          .summary-metrics > div, .summary-action-metrics > div { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
        }
        @media (max-width: 600px) {
          .summary-metrics > div { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
          .summary-action-metrics > div { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
          .summary-action-grid { grid-template-columns: 1fr !important; }
          [data-recruitment-kpis] { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
          [data-recruitment-filter-grid] { grid-template-columns: 1fr !important; }
          [data-recruitment-header] { align-items: flex-start !important; }
          [data-recruitment-actions] { width: 100% !important; }
          [data-recruitment-actions] > * { flex: 1 !important; }
        }
      `}</style>
      <Sidebar appMode={appMode} setAppMode={setAppMode} collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Header profile={profile} userId={userId} theme={theme} setTheme={setTheme} />
        <div data-mobile-tracker-nav style={{ display: 'none', padding: '8px 12px', background: 'var(--bg2)', borderBottom: '1px solid var(--bd)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <button
              onClick={() => setAppMode('deliverables')}
              style={{ border: '1px solid var(--bd)', borderRadius: 7, padding: '8px 6px', background: appMode === 'deliverables' ? 'var(--acc-bg)' : 'transparent', color: appMode === 'deliverables' ? 'var(--acc-tx)' : 'var(--tx2)', fontSize: 11, fontWeight: appMode === 'deliverables' ? 650 : 500, cursor: 'pointer' }}
            >📋 Deliverables Tracker</button>
            <button
              onClick={() => setAppMode('recruitment')}
              style={{ border: '1px solid var(--bd)', borderRadius: 7, padding: '8px 6px', background: appMode === 'recruitment' ? 'var(--acc-bg)' : 'transparent', color: appMode === 'recruitment' ? 'var(--acc-tx)' : 'var(--tx2)', fontSize: 11, fontWeight: appMode === 'recruitment' ? 650 : 500, cursor: 'pointer' }}
            >🧑‍💼 Recruitment Tracker</button>
          </div>
        </div>
        <main data-app-main style={{ maxWidth: 1440, margin: '0 auto', padding: '24px 32px 40px', width: '100%', boxSizing: 'border-box' }}>
        {appMode === 'deliverables' && (
        <>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, marginBottom: 18 }}>
          <div>
            <h1 style={{ fontSize: 24, lineHeight: 1.15, margin: 0, fontWeight: 700, letterSpacing: '-0.5px', color: 'var(--navy)' }}>Deliverables Tracker</h1>
            <p style={{ fontSize: 12, color: 'var(--txm)', margin: '5px 0 0' }}>Manage objectives, commitments and action items across the People function.</p>
          </div>
        </div>

        <Nav view={view} setView={setView} setSelected={setSelected} />

        {(view === 'summary' || view === 'board' || view === 'deliverables' || view === 'calendar') && (
          <FilterBar filters={filters} setFilters={setFilters} profiles={profiles} isAdmin={isAdmin} />
        )}

        {view !== 'summary' && view !== 'actions' && (
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 11, color: 'var(--txm)', margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: 0.3 }}>Deliverables</p>
            <MetricGrid
              items={kpiSource}
              totalLabel="Total deliverables"
              onCardClick={(key) => {
                setFilters({
                  search: '',
                  divisions: [],
                  owner: 'all',
                  status: key === 'total' || key === 'overdue' ? 'all' : key === 'completed' ? 'Completed' : key === 'inProgress' ? 'In Progress' : 'Not Started',
                  overdueOnly: key === 'overdue',
                })
                setView('deliverables')
                setSelected({})
              }}
            />
          </div>
        )}

        {view === 'actions' && (
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 11, color: 'var(--txm)', margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: 0.3 }}>Action Items</p>
            <ActionFilterBar filter={actionFilter} setFilter={setActionFilter} />
            <MetricGrid
              items={actionItemsForMetrics}
              totalLabel="Total action items"
              onCardClick={(key) => {
                setActionFilter({
                  status: key === 'total' || key === 'overdue' ? 'all' : key === 'completed' ? 'Completed' : key === 'inProgress' ? 'In Progress' : 'Not Started',
                  overdueOnly: key === 'overdue',
                })
              }}
            />
          </div>
        )}

        {view === 'summary' && (
          <SummaryView
            deliverables={getFiltered()} profiles={profiles} expandedActions={expandedActions} isAdmin={isAdmin}
            actionHrbpRows={isAdmin ? profiles.filter((p) => p.role !== 'admin').map((p) => ({
              name: p.full_name,
              items: keyActions.filter((a) => isPersonInAction(a, p.id)).map((a) => {
                if (!a.shared) return { status: a.status, due_date: a.due_date }
                const row = actionStatuses.find((s) => s.action_id === a.id && s.user_id === p.id)
                return { status: row ? row.status : 'Not Started', due_date: a.due_date }
              }),
            })).filter((r) => r.items.length > 0) : []}
            onDeliverableMetricClick={(key) => {
              setFilters({
                search: '',
                divisions: [],
                owner: 'all',
                status: key === 'total' || key === 'overdue' ? 'all' : key === 'completed' ? 'Completed' : key === 'inProgress' ? 'In Progress' : 'Not Started',
                overdueOnly: key === 'overdue',
              })
              setView('deliverables')
              setSelected({})
            }}
            onActionMetricClick={(key) => {
              setActionFilter({
                status: key === 'total' || key === 'overdue' ? 'all' : key === 'completed' ? 'Completed' : key === 'inProgress' ? 'In Progress' : 'Not Started',
                overdueOnly: key === 'overdue',
              })
              setView('actions')
            }}
          />
        )}

        {view === 'board' && (
          <BoardView items={getFiltered()} isAdmin={isAdmin} onOpen={(id) => setEditing({ id })} onStatus={changeStatus} onDelete={(id) => setConfirmDelete(id)} onAdd={() => setEditing({ id: null })} ownerName={ownerName} />
        )}

        {view === 'deliverables' && (
          <DeliverablesView
            items={getFiltered()} allItems={visibleDeliverables} isAdmin={isAdmin}
            collapsed={collapsed} setCollapsed={setCollapsed}
            selected={selected} setSelected={setSelected}
            sort={sort} setSort={setSort} sortItems={sortItems}
            ownerName={ownerName} profiles={profiles} strategyNodes={strategyNodes}
            onCreateNode={createStrategyNode} onRenameNode={renameStrategyNode}
            onDuplicateKeyResult={duplicateKeyResult} onDuplicateDeliverable={duplicateDeliverable} onMoveKeyResult={moveKeyResult} onMoveDeliverable={moveDeliverable}
            onOpen={(id) => setEditing({ id })}
            onAdd={() => setEditing({ id: null })}
            onQuickAdd={quickAddDeliverable}
            onNewObjective={() => setEditing({ id: null, isNewObjective: true })}
            onBulkStatus={bulkStatus} onBulkDelete={bulkDelete}
            onExport={() => setShowExport(true)}
            onImport={() => setShowImport(true)}
            onGeneratePpt={() => setShowPpt(isAdmin ? 'cpo' : 'personal')}
          />
        )}

        {view === 'calendar' && <CalendarView items={getFiltered()} onOpen={(id) => setEditing({ id })} />}
        {view === 'movement' && <ActivityView deliverables={visibleDeliverables} ownerName={ownerName} onOpen={(id) => setEditing({ id })} />}
        {view === 'actions' && (
          <ActionsView keyActions={keyActions} actionStatuses={actionStatuses} profiles={profiles} isAdmin={isAdmin} ownerName={ownerName} myId={userId}
            actionFilter={actionFilter}
            onOpen={(id) => setEditingAction({ id })} onAdd={() => setEditingAction({ id: null })}
            onDelete={async (id) => { await supabase.from('key_actions').delete().eq('id', id); loadKeyActions() }}
            onMyStatusChange={async (actionId, status) => {
              await supabase.from('action_item_statuses').upsert({ action_id: actionId, user_id: userId, status }, { onConflict: 'action_id,user_id' })
              loadActionStatuses()
            }}
            onAdminStatusChange={async (actionId, targetUserId, status) => {
              await supabase.from('action_item_statuses').upsert({ action_id: actionId, user_id: targetUserId, status }, { onConflict: 'action_id,user_id' })
              loadActionStatuses()
            }}
            onExport={() => setShowExport(true)} onImport={() => setShowImport(true)}
          />
        )}
        </>
        )}

        {appMode === 'recruitment' && <RecruitmentModule tab={recruitmentTab} setTab={setRecruitmentTab} />}
        </main>
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
          profiles={profiles} isAdmin={isAdmin} myId={userId}
          existingStatuses={editingAction.id ? actionStatuses.filter((s) => s.action_id === editingAction.id) : []}
          onClose={() => setEditingAction(null)}
          onSave={async (form, isNew) => {
            const payload = {
              title: form.title, raised_in: form.raisedIn, shared: form.shared,
              owner_id: form.shared ? null : form.ownerId,
              due_date: form.dueDate || null, status: form.shared ? 'Not Started' : form.status, comment: form.comment,
            }
            let actionId = form.id
            if (isNew) {
              const { data, error } = await supabase.from('key_actions').insert(payload).select().single()
              if (error) { alert(error.message); return }
              actionId = data.id
            } else {
              const { error } = await supabase.from('key_actions').update(payload).eq('id', form.id)
              if (error) { alert(error.message); return }
            }
            if (form.shared) {
              if (!form.sharedOwnerIds.length) {
                alert('Please select at least one HRBP to assign this action item to.')
                return
              }

              for (const pid of form.sharedOwnerIds) {
                const { error } = await supabase
                  .from('action_item_statuses')
                  .upsert(
                    { action_id: actionId, user_id: pid, status: 'Not Started' },
                    { onConflict: 'action_id,user_id' }
                  )
                if (error) {
                  alert(`The action item was saved, but the HRBP assignment could not be saved: ${error.message}`)
                  return
                }
              }

              const previouslyAssigned = actionStatuses.filter((s) => s.action_id === actionId).map((s) => s.user_id)
              const removed = previouslyAssigned.filter((pid) => !form.sharedOwnerIds.includes(pid))
              if (removed.length) {
                const { error } = await supabase
                  .from('action_item_statuses')
                  .delete()
                  .eq('action_id', actionId)
                  .in('user_id', removed)
                if (error) {
                  alert(`The action item was saved, but removing a previous HRBP assignment failed: ${error.message}`)
                  return
                }
              }
            }
            setEditingAction(null)
            await loadKeyActions()
            await loadActionStatuses()
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
            const rows = (useFiltered ? getFiltered() : visibleDeliverables).map((d) => ({ ...d, latestComment: lastComment(d)?.text }))
            exportToExcel({ deliverables: rows, keyActions: isAdmin ? keyActions : keyActions.filter((a) => isPersonInAction(a, userId)), profiles, includeActions })
            setShowExport(false)
          }}
        />
      )}
      {showPpt && (
        <PptDialog
          scope={showPpt}
          onCancel={() => setShowPpt(null)}
          busy={pptBusy}
          onGenerate={async (from, to) => {
            setPptBusy(true)
            try {
              if (showPpt === 'cpo') {
                await generateCpoReviewPack({ deliverables, actions: keyActions, actionStatuses, profiles, ownerName, winsFrom: from, winsTo: to })
              } else {
                const mineDeliverables = visibleDeliverables
                const mineActions = keyActions.filter((a) => isPersonInAction(a, userId))
                await generatePersonalReviewPack({ name: profile.full_name, deliverables: mineDeliverables, actions: mineActions, actionStatuses, myUserId: userId, winsFrom: from, winsTo: to })
              }
            } finally {
              setPptBusy(false); setShowPpt(null)
            }
          }}
        />
      )}
    </div>
  )
}

function Header({ profile, userId, theme, setTheme }) {
  return (
    <header style={{ background: 'var(--bg2)', color: 'var(--tx1)', borderBottom: '1px solid var(--bd)', position: 'sticky', top: 0, zIndex: 30 }}>
      <div style={{ minHeight: 58, padding: '0 28px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--tx2)', padding: '7px 10px', border: '1px solid var(--bd)', borderRadius: 7, background: 'var(--bg2)' }}>
          {profile.full_name} · {profile.role === 'admin' ? 'Admin' : 'Team member'}
        </span>
        <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} style={{ border: '1px solid var(--bd)', background: 'var(--bg2)', color: 'var(--tx2)', borderRadius: 7, padding: '7px 10px', fontSize: 12, cursor: 'pointer' }}>
          {theme === 'light' ? 'Dark mode' : 'Light mode'}
        </button>
        <NotificationBell userId={userId} />
        <button onClick={() => supabase.auth.signOut()} style={{ fontSize: 12, color: 'var(--tx2)', background: 'none', border: 'none', cursor: 'pointer' }}>Sign out</button>
      </div>
    </header>
  )
}

function Sidebar({ appMode, setAppMode, collapsed, setCollapsed }) {
  const width = collapsed ? 64 : 236
  const sectionButtonStyle = (active) => ({
    display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left',
    border: 'none', borderLeft: active ? '3px solid var(--acc-fill)' : '3px solid transparent',
    background: active ? 'var(--acc-bg)' : 'transparent', color: active ? 'var(--acc-tx)' : 'var(--tx2)',
    padding: '11px 14px', fontSize: 13, fontWeight: active ? 600 : 500, cursor: 'pointer', borderRadius: '0 7px 7px 0',
  })

  return (
    <aside data-app-sidebar style={{ width, minWidth: width, transition: 'width 0.15s', background: 'var(--bg2)', borderRight: '1px solid var(--bd)', display: 'flex', flexDirection: 'column', padding: '16px 10px', gap: 4 }}>
      <div data-sidebar-brand style={{ display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between', padding: '2px 8px 22px' }}>
        {!collapsed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
            <img src="/credit-direct-logo.png" alt="Credit Direct" style={{ width: 122, height: 'auto', display: 'block' }} />
          </div>
        )}
        <button onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{ border: '1px solid var(--bd)', background: 'var(--bg2)', cursor: 'pointer', color: 'var(--tx2)', fontSize: 15, padding: '5px 7px', borderRadius: 7 }}>
          {collapsed ? '»' : '«'}
        </button>
      </div>

      <button data-nav data-active={appMode === 'deliverables'} onClick={() => setAppMode('deliverables')} style={sectionButtonStyle(appMode === 'deliverables')}>
        <span style={{ width: 18, textAlign: 'center', fontSize: 15 }}>📋</span>{!collapsed && <span>Deliverables Tracker</span>}
      </button>

      <button data-nav data-active={appMode === 'recruitment'} onClick={() => setAppMode('recruitment')} style={sectionButtonStyle(appMode === 'recruitment')}>
        <span style={{ width: 18, textAlign: 'center', fontSize: 15 }}>🧑‍💼</span>{!collapsed && <span>Recruitment Tracker</span>}
      </button>
    </aside>
  )
}

function Nav({ view, setView, setSelected }) {
  const tabs = [['summary', 'Summary Dashboard'], ['board', 'Board'], ['deliverables', 'Deliverables'], ['calendar', 'Calendar'], ['movement', 'Activity'], ['actions', 'Action Items']]
  return (
    <div className="deliverables-nav" style={{ display: 'flex', gap: 2, marginBottom: 22, flexWrap: 'wrap', borderBottom: '1px solid var(--bd)' }}>
      {tabs.map(([id, label]) => (
        <button key={id} onClick={() => { setView(id); setSelected({}) }}
          style={{ border: 'none', borderBottom: view === id ? '2px solid var(--acc-fill)' : '2px solid transparent', background: 'transparent', color: view === id ? 'var(--acc-tx)' : 'var(--tx2)', fontSize: 13, fontWeight: view === id ? 600 : 500, padding: '9px 12px 10px', borderRadius: 0, cursor: 'pointer' }}>
          {label}
        </button>
      ))}
    </div>
  )
}

function DivisionMultiSelect({ selected, onChange }) {
  const [open, setOpen] = useState(false)
  const toggle = (d) => onChange(selected.includes(d) ? selected.filter((x) => x !== d) : [...selected, d])
  const label = selected.length === 0 ? 'All divisions' : selected.length === 1 ? selected[0] : `${selected.length} divisions`
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen((o) => !o)} style={{ ...inputStyle({ minWidth: 160, textAlign: 'left' }), display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span> <span style={{ fontSize: 10 }}>▾</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: 'var(--bg2)', border: '0.5px solid var(--bds)', borderRadius: 8, padding: 8, zIndex: 20, minWidth: 220, maxHeight: 280, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
          {selected.length > 0 && <button onClick={() => onChange([])} style={{ fontSize: 11, color: 'var(--acc-fill)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', marginBottom: 4 }}>Clear all</button>}
          {Object.keys(OWNER_FUNCTIONS).map((owner) => (
            <div key={owner} style={{ marginBottom: 6 }}>
              <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--tx2)', margin: '4px 0 2px', textTransform: 'uppercase' }}>{owner}</p>
              {OWNER_FUNCTIONS[owner].map((d) => (
                <label key={d} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '3px 4px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={selected.includes(d)} onChange={() => toggle(d)} /> {d}
                </label>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function FilterBar({ filters, setFilters, profiles, isAdmin }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(filters)

  useEffect(() => { if (open) setDraft(filters) }, [open, filters])

  const activeCount =
    (filters.search ? 1 : 0) +
    (filters.divisions.length ? 1 : 0) +
    (filters.owner !== 'all' ? 1 : 0) +
    (filters.status !== 'all' ? 1 : 0) +
    (filters.overdueOnly ? 1 : 0)

  const update = (key, value) => setDraft((f) => ({ ...f, [key]: value }))
  const clearAll = () => {
    const empty = { search: '', divisions: [], owner: 'all', status: 'all', overdueOnly: false }
    setDraft(empty)
    setFilters(empty)
    setOpen(false)
  }
  const apply = () => { setFilters(draft); setOpen(false) }
  const removeFilter = (key) => {
    if (key === 'divisions') setFilters((f) => ({ ...f, divisions: [] }))
    else if (key === 'overdueOnly') setFilters((f) => ({ ...f, overdueOnly: false }))
    else setFilters((f) => ({ ...f, [key]: key === 'owner' || key === 'status' ? 'all' : '' }))
  }

  const ownerLabel = profiles.find((p) => p.id === filters.owner)?.full_name
  const chips = [
    filters.search ? ['search', `Search: ${filters.search}`] : null,
    filters.divisions.length ? ['divisions', filters.divisions.length === 1 ? filters.divisions[0] : `${filters.divisions.length} divisions`] : null,
    filters.owner !== 'all' ? ['owner', ownerLabel || 'Owner'] : null,
    filters.status !== 'all' ? ['status', filters.status] : null,
    filters.overdueOnly ? ['overdueOnly', 'Overdue'] : null,
  ].filter(Boolean)

  return (
    <div style={{ marginBottom: 16, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={() => setOpen((o) => !o)}
          style={btnStyle({
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            background: activeCount ? 'var(--acc-bg)' : 'var(--bg2)',
            color: activeCount ? 'var(--acc-tx)' : 'var(--tx1)',
            borderColor: activeCount ? 'var(--acc-fill)' : 'var(--bds)',
          })}
          aria-expanded={open}
        >
          <i className="ti ti-filter" style={{ fontSize: 14 }} aria-hidden="true" />
          <span>Filters</span>
          {activeCount > 0 && <span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, background: 'var(--acc-fill)', color: '#fff', fontSize: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{activeCount}</span>}
          <span style={{ fontSize: 10 }}>{open ? '▲' : '▼'}</span>
        </button>

        {chips.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {chips.map(([key, label]) => (
              <button key={key} onClick={() => removeFilter(key)} title="Remove filter"
                style={btnStyle({ padding: '4px 8px', fontSize: 11, borderRadius: 999, background: 'var(--bg1)', color: 'var(--tx2)' })}>
                {label} ×
              </button>
            ))}
            <button onClick={clearAll} style={{ ...btnStyle({ padding: '3px 6px', fontSize: 11, border: 'none', background: 'transparent', color: 'var(--dgr-tx)' }) }}>Clear all</button>
          </div>
        )}
      </div>

      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 45, width: 'min(640px, calc(100vw - 40px))', background: 'var(--bg2)', border: '0.5px solid var(--bds)', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.14)', padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Filter deliverables</div>
              <div style={{ fontSize: 11, color: 'var(--txm)', marginTop: 2 }}>Apply filters across the deliverables views.</div>
            </div>
            {activeCount > 0 && <button onClick={clearAll} style={{ ...btnStyle({ padding: '3px 6px', fontSize: 11, border: 'none', background: 'transparent', color: 'var(--dgr-tx)' }) }}>Clear all</button>}
          </div>

          <div data-recruitment-filter-grid style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <label>
              <span style={{ fontSize: 12, color: 'var(--tx2)', display: 'block', marginBottom: 4 }}>Search</span>
              <input placeholder="Search deliverables…" value={draft.search} onChange={(e) => update('search', e.target.value)} style={inputStyle({ width: '100%' })} />
            </label>

            <label>
              <span style={{ fontSize: 12, color: 'var(--tx2)', display: 'block', marginBottom: 4 }}>Status</span>
              <select value={draft.status} onChange={(e) => update('status', e.target.value)} style={inputStyle({ width: '100%' })}>
                <option value="all">All statuses</option>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>

            {isAdmin && (
              <label>
                <span style={{ fontSize: 12, color: 'var(--tx2)', display: 'block', marginBottom: 4 }}>Owner</span>
                <select value={draft.owner} onChange={(e) => update('owner', e.target.value)} style={inputStyle({ width: '100%' })}>
                  <option value="all">All owners</option>
                  {profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
              </label>
            )}

            <div>
              <span style={{ fontSize: 12, color: 'var(--tx2)', display: 'block', marginBottom: 4 }}>Division</span>
              <DivisionMultiSelect selected={draft.divisions} onChange={(v) => update('divisions', v)} />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--tx2)', paddingTop: 22 }}>
              <input type="checkbox" checked={draft.overdueOnly} onChange={(e) => update('overdueOnly', e.target.checked)} />
              Overdue only
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button onClick={() => setOpen(false)} style={btnStyle()}>Cancel</button>
            <button onClick={apply} style={primaryBtnStyle()}>Apply filters</button>
          </div>
        </div>
      )}
    </div>
  )
}

function ActionFilterBar({ filter, setFilter }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(filter)
  useEffect(() => { if (open) setDraft(filter) }, [open, filter])

  const activeCount = (filter.status !== 'all' ? 1 : 0) + (filter.overdueOnly ? 1 : 0)
  const clearAll = () => {
    const empty = { status: 'all', overdueOnly: false }
    setDraft(empty)
    setFilter(empty)
    setOpen(false)
  }
  const chips = [
    filter.status !== 'all' ? ['status', filter.status] : null,
    filter.overdueOnly ? ['overdueOnly', 'Overdue'] : null,
  ].filter(Boolean)

  return (
    <div style={{ marginBottom: 16, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={() => setOpen((o) => !o)}
          style={btnStyle({
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            background: activeCount ? 'var(--acc-bg)' : 'var(--bg2)',
            color: activeCount ? 'var(--acc-tx)' : 'var(--tx1)',
            borderColor: activeCount ? 'var(--acc-fill)' : 'var(--bds)',
          })}
          aria-expanded={open}
        >
          <i className="ti ti-filter" style={{ fontSize: 14 }} aria-hidden="true" />
          <span>Filters</span>
          {activeCount > 0 && <span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, background: 'var(--acc-fill)', color: '#fff', fontSize: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{activeCount}</span>}
          <span style={{ fontSize: 10 }}>{open ? '▲' : '▼'}</span>
        </button>

        {chips.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {chips.map(([key, label]) => (
              <button key={key} onClick={() => key === 'status'
                ? setFilter((f) => ({ ...f, status: 'all' }))
                : setFilter((f) => ({ ...f, overdueOnly: false }))}
                title="Remove filter"
                style={btnStyle({ padding: '4px 8px', fontSize: 11, borderRadius: 999, background: 'var(--bg1)', color: 'var(--tx2)' })}
              >
                {label} ×
              </button>
            ))}
            <button onClick={clearAll} style={{ ...btnStyle({ padding: '3px 6px', fontSize: 11, border: 'none', background: 'transparent', color: 'var(--dgr-tx)' }) }}>Clear all</button>
          </div>
        )}
      </div>

      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 45, width: 'min(420px, calc(100vw - 40px))', background: 'var(--bg2)', border: '0.5px solid var(--bds)', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.14)', padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Filter action items</div>
              <div style={{ fontSize: 11, color: 'var(--txm)', marginTop: 2 }}>Apply filters across the action items view.</div>
            </div>
            {activeCount > 0 && <button onClick={clearAll} style={{ ...btnStyle({ padding: '3px 6px', fontSize: 11, border: 'none', background: 'transparent', color: 'var(--dgr-tx)' }) }}>Clear all</button>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
            <label>
              <span style={{ fontSize: 12, color: 'var(--tx2)', display: 'block', marginBottom: 4 }}>Status</span>
              <select value={draft.status} onChange={(e) => setDraft((f) => ({ ...f, status: e.target.value }))} style={inputStyle({ width: '100%' })}>
                <option value="all">All statuses</option>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--tx2)' }}>
              <input type="checkbox" checked={draft.overdueOnly} onChange={(e) => setDraft((f) => ({ ...f, overdueOnly: e.target.checked }))} />
              Overdue only
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button onClick={() => setOpen(false)} style={btnStyle()}>Cancel</button>
            <button onClick={() => { setFilter(draft); setOpen(false) }} style={primaryBtnStyle()}>Apply filters</button>
          </div>
        </div>
      )}
    </div>
  )
}
function inputStyle(extra = {}) { return { background: 'var(--bg2)', color: 'var(--tx1)', border: '1px solid var(--bds)', borderRadius: 6, padding: '8px 10px', fontSize: 13, ...extra } }

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
      <div className="deliverables-board-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
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

function btnStyle(extra = {}) { return { fontSize: 13, background: 'var(--bg2)', border: '1px solid var(--bds)', borderRadius: 6, padding: '8px 12px', cursor: 'pointer', color: 'var(--tx1)', ...extra } }
function primaryBtnStyle(extra = {}) { return { fontSize: 13, background: 'var(--acc-fill)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', cursor: 'pointer', fontWeight: 600, ...extra } }

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

function DeliverablesView({ items, allItems, isAdmin, collapsed, setCollapsed, selected, setSelected, sort, setSort, sortItems, ownerName, profiles, onOpen, onAdd, onQuickAdd, onNewObjective, onBulkStatus, onBulkDelete, onExport, onImport, onGeneratePpt, strategyNodes, onCreateNode, onRenameNode, onDuplicateKeyResult, onDuplicateDeliverable, onMoveKeyResult, onMoveDeliverable }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const [editingNode, setEditingNode] = useState(null)
  const [newNode, setNewNode] = useState(null)
  const [addingTo, setAddingTo] = useState(null)
  const [quickTitle, setQuickTitle] = useState('')
  const [quickOwner, setQuickOwner] = useState('')
  const [quickDue, setQuickDue] = useState(todayISO())
  const [dragging, setDragging] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const [toast, setToast] = useState(null)
  const toggle = (key) => setCollapsed((c) => ({ ...c, [key]: !c[key] }))
  const selCount = Object.values(selected).filter(Boolean).length
  const visible = items
  const byNode = (id) => sortItems(visible.filter((d) => d.key_result_id === id))
  const corporations = strategyNodes.filter((n) => n.node_type === 'corporate')
  const pmsFor = (id) => strategyNodes.filter((n) => n.node_type === 'pm' && n.parent_id === id)
  const krsFor = (id) => strategyNodes.filter((n) => n.node_type === 'key_result' && n.parent_id === id)
  const startDrag = (e, payload) => {
    setDragging(payload); setDropTarget(null)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', payload.type + ':' + payload.id)
  }
  const endDrag = () => { setDragging(null); setDropTarget(null) }
  const allowDrop = (e, type, id) => {
    if (dragging?.type !== type) return
    e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; setDropTarget(type + ':' + id)
  }
  const dropOnPm = async (e, pm) => {
    if (dragging?.type !== 'key_result') return
    e.preventDefault(); e.stopPropagation()
    const node = strategyNodes.find((n) => n.id === dragging.id)
    setDropTarget(null); setDragging(null)
    if (node) {
      const previousPmId = node.parent_id
      const ok = await onMoveKeyResult({ node, targetPmId: pm.id })
      if (ok) setToast({ message: 'Key Result moved', undo: async () => { await onMoveKeyResult({ node: { ...node, parent_id: pm.id }, targetPmId: previousPmId }) } })
    }
  }
  const dropOnKr = async (e, kr) => {
    if (dragging?.type !== 'deliverable') return
    e.preventDefault(); e.stopPropagation()
    const item = visible.find((d) => d.id === dragging.id) || allItems.find((d) => d.id === dragging.id)
    setDropTarget(null); setDragging(null)
    if (item) {
      const previousKrId = item.key_result_id
      const ok = await onMoveDeliverable({ item, targetKeyResultId: kr.id })
      if (ok) setToast({ message: 'Deliverable moved', undo: async () => { await onMoveDeliverable({ item: { ...item, key_result_id: kr.id }, targetKeyResultId: previousKrId }) } })
    }
  }
  const beginAdd = (co, pm, kr) => {
    setAddingTo({ co, pm, kr }); setQuickTitle(''); setQuickOwner(isAdmin ? (profiles.find((p) => p.role !== 'admin')?.id || profiles[0]?.id || '') : ''); setQuickDue(todayISO())
    setTimeout(() => document.querySelector('[data-inline-deliverable-input]')?.focus(), 0)
  }
  const submitAdd = async () => {
    if (!quickTitle.trim() || !addingTo) return
    const ok = await onQuickAdd({ title: quickTitle.trim(), corporateObjective: addingTo.co.name, pmObjective: addingTo.pm.name, keyResult: addingTo.kr.name, ownerId: quickOwner, dueDate: quickDue, corporateObjectiveId: addingTo.co.id, pmObjectiveId: addingTo.pm.id, keyResultId: addingTo.kr.id })
    if (ok) { setAddingTo(null); setQuickTitle('') }
  }
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 7000)
    return () => clearTimeout(timer)
  }, [toast])

  const startNew = (type, parentId) => { setNewNode({ type, parentId }); setEditingNode(null) }
  const commitNew = async () => {
    if (!newNode?.name?.trim()) return
    const created = await onCreateNode({ nodeType: newNode.type, name: newNode.name, parentId: newNode.parentId })
    if (created) setNewNode(null)
  }
  const NodeName = ({ node, label }) => {
    const editing = editingNode === node.id
    const [draft, setDraft] = useState(node.name)
    useEffect(() => { if (editing) setDraft(node.name) }, [editing, node.name])
    return editing ? (
      <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={async (e) => { await onRenameNode(node, e.target.value); setEditingNode(null) }} onKeyDown={async (e) => { if (e.key === 'Enter') { await onRenameNode(node, e.currentTarget.value); setEditingNode(null) } if (e.key === 'Escape') setEditingNode(null) }} style={inputStyle({ border: '1px solid var(--acc-fill)', padding: '3px 6px', fontSize: 12, flex: 1 })} />
    ) : (
      <span onClick={() => setEditingNode(node.id)} title="Click to edit" style={{ cursor: 'text' }}><strong>{label}</strong> {node.name}</span>
    )
  }

  const toolbar = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap', padding: '2px 0' }}>
      <div style={{ fontSize: 12, color: 'var(--tx2)' }}><strong style={{ color: 'var(--tx1)', fontSize: 13 }}>{visible.length}</strong> deliverables</div>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        <button onClick={() => startNew('corporate', null)} style={primaryBtnStyle({ padding: '7px 11px', fontSize: 12 })}>+ Corporate Objective</button>
        <button onClick={onImport} style={btnStyle({ padding: '7px 10px', fontSize: 12 })}>Import</button>
        <button onClick={onExport} style={btnStyle({ padding: '7px 10px', fontSize: 12 })}>Export</button>
        <div style={{ position: 'relative' }}><button onClick={() => setMoreOpen((o) => !o)} style={btnStyle({ padding: '7px 10px', fontSize: 12 })}>•••</button>{moreOpen && <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 40, background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 8, padding: 4, minWidth: 150 }}><button onClick={() => { onGeneratePpt(); setMoreOpen(false) }} style={{ width: '100%', border: 0, background: 'transparent', padding: '8px 10px', textAlign: 'left', cursor: 'pointer', color: 'var(--tx1)', fontSize: 12 }}>Generate PPT</button></div>}</div>
      </div>
    </div>
  )

  return (
    <div>
    {toolbar}
    {newNode?.type === 'corporate' && !newNode.parentId && <InlineNodeInput placeholder="Type Corporate Objective…" value={newNode.name || ''} onChange={(name) => setNewNode((n) => ({ ...n, name }))} onCommit={commitNew} onCancel={() => setNewNode(null)} />}
    {selCount > 0 && <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', marginBottom: 10, background: 'var(--acc-bg)', border: '1px solid var(--bd)', borderRadius: 7 }}><span style={{ fontSize: 12, color: 'var(--acc-tx)' }}>{selCount} selected</span><select defaultValue="" onChange={(e) => e.target.value && onBulkStatus(e.target.value)} style={inputStyle({ width: 'auto', padding: '6px 8px' })}><option value="">Change status…</option>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>{isAdmin && <button onClick={onBulkDelete} style={btnStyle({ padding: '6px 9px', fontSize: 11, color: 'var(--dgr-tx)' })}>Delete</button>}<button onClick={() => setSelected({})} style={btnStyle({ padding: '6px 9px', fontSize: 11, marginLeft: 'auto' })}>Clear</button></div>}
    <div style={{ border: '1px solid var(--bd)', borderRadius: 10, overflow: 'hidden', background: 'var(--bg2)' }}>
      {corporations.map((co, ci) => {
        const coKey = 'co::' + co.id, coCollapsed = collapsed[coKey]
        return <div key={co.id} className="hierarchy-corporate">
          <div className="hierarchy-corporate-header" style={{ padding: '15px 17px', background: 'var(--bg1)', borderLeft: '3px solid ' + CO_COLORS[ci % CO_COLORS.length], display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => toggle(coKey)} style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--txm)' }}>{coCollapsed ? '▸' : '▾'}</button>
            <div style={{ flex: 1, fontSize: 13 }}><NodeName node={co} label="Corporate Objective:" /></div>
            <button onClick={() => startNew('pm', co.id)} style={btnStyle({ padding: '4px 8px', fontSize: 10 })}>+ PM Objective</button>
          </div>
          {!coCollapsed && pmsFor(co.id).map((pm) => {
            const pmKey = 'pm::' + pm.id, pmCollapsed = collapsed[pmKey]
            return <div key={pm.id} className="hierarchy-pm">
              <div className="hierarchy-pm-header" onDragOver={(e) => allowDrop(e, 'key_result', pm.id)} onDragLeave={() => dropTarget === 'key_result:' + pm.id && setDropTarget(null)} onDrop={(e) => dropOnPm(e, pm)} style={{ padding: '13px 8px', display: 'flex', alignItems: 'center', gap: 8, background: dropTarget === 'key_result:' + pm.id ? 'var(--acc-bg)' : 'transparent', outline: dropTarget === 'key_result:' + pm.id ? '2px dashed var(--acc-fill)' : 'none', outlineOffset: -2 }}>
                <button onClick={() => toggle(pmKey)} style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--txm)' }}>{pmCollapsed ? '▸' : '▾'}</button>
                <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--tx2)' }}><NodeName node={pm} label="PM Objective:" /></div>
                <div className="hierarchy-row-actions"><button onClick={() => startNew('key_result', pm.id)} style={btnStyle({ padding: '4px 8px', fontSize: 10 })}>+ Key Result</button></div>
              </div>
              {!pmCollapsed && krsFor(pm.id).map((kr) => {
                const krKey = 'kr::' + kr.id, krCollapsed = collapsed[krKey], krItems = byNode(kr.id), complete = krItems.filter((d) => d.status === 'Completed').length, pct = krItems.length ? Math.round(complete / krItems.length * 100) : 0
                const adding = addingTo?.kr?.id === kr.id
                return <div key={kr.id} className="hierarchy-kr">
                  <div className="hierarchy-kr-header" onDragOver={(e) => allowDrop(e, 'deliverable', kr.id)} onDragLeave={() => dropTarget === 'deliverable:' + kr.id && setDropTarget(null)} onDrop={(e) => dropOnKr(e, kr)} style={{ padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 9, background: dropTarget === 'deliverable:' + kr.id ? 'var(--acc-bg)' : 'var(--bg2)', outline: dropTarget === 'deliverable:' + kr.id ? '2px dashed var(--acc-fill)' : 'none', outlineOffset: -2 }}>
                    <button onClick={() => toggle(krKey)} style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--txm)', padding: 2 }}>{krCollapsed ? '▸' : '▾'}</button>
                    <span draggable onDragStart={(e) => { e.stopPropagation(); startDrag(e, { type: 'key_result', id: kr.id }) }} onDragEnd={endDrag} title="Drag Key Result to another PM Objective" style={{ color: 'var(--txm)', cursor: dragging?.type === 'key_result' ? 'grabbing' : 'grab', fontSize: 12, userSelect: 'none' }}>⠿</span>
                    <div style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                      <NodeName node={kr} label="Key Result:" />
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--txm)', whiteSpace: 'nowrap', paddingRight: 4 }}>{complete}/{krItems.length} complete</span>
                    <button onClick={() => beginAdd(co, pm, kr)} style={btnStyle({ padding: '5px 9px', fontSize: 10, background: 'var(--acc-bg)', color: 'var(--acc-tx)', borderColor: 'transparent' })}>+ Deliverable</button>
                    <button onClick={() => onDuplicateKeyResult({ node: kr })} title="Duplicate Key Result" aria-label="Duplicate Key Result" style={btnStyle({ padding: '5px 7px', fontSize: 12, color: 'var(--txm)', borderColor: 'transparent', background: 'transparent' })}>⧉</button>
                  </div>

                  {!krCollapsed && (
                    krItems.length === 0 && !adding
                      ? <div className="hierarchy-empty"><span>No deliverables under this Key Result yet.</span><button onClick={() => beginAdd(co, pm, kr)} style={{ border: 0, background: 'transparent', color: 'var(--acc-tx)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>+ Add deliverable</button></div>
                      : <div className="deliverables-table-wrap" style={{ overflowX: 'auto' }}>
                          <table className="hierarchy-table" style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead><tr><th style={{ width: 28 }}></th><th style={{ width: 30 }}></th><th style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--txm)', fontWeight: 500 }}>Deliverable</th><th style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--txm)', fontWeight: 500 }}>HRBP</th><th style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--txm)', fontWeight: 500 }}>Status</th><th style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--txm)', fontWeight: 500 }}>Due</th><th style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--txm)', fontWeight: 500 }}>Next step</th><th style={{ width: 34 }}></th></tr></thead>
                            <tbody>
                              {krItems.map((d) => <tr key={d.id} style={{ borderTop: '1px solid var(--bd)' }}>
                                <td style={{ padding: '8px 6px', width: 28 }}><span draggable onDragStart={(e) => { e.stopPropagation(); startDrag(e, { type: 'deliverable', id: d.id }) }} onDragEnd={endDrag} title="Drag deliverable to another Key Result" style={{ color: 'var(--txm)', cursor: dragging?.type === 'deliverable' ? 'grabbing' : 'grab', fontSize: 12, userSelect: 'none' }}>⠿</span></td>
                                <td style={{ padding: '8px 10px' }}><input type="checkbox" checked={!!selected[d.id]} onChange={(e) => setSelected((v) => ({ ...v, [d.id]: e.target.checked }))} /></td>
                                <td onClick={() => onOpen(d.id)} style={{ padding: '8px 10px', fontWeight: 550, cursor: 'pointer' }}>{d.title}<RevisionFlag item={d} /></td>
                                <td onClick={() => onOpen(d.id)} style={{ padding: '8px 10px', color: 'var(--tx2)', cursor: 'pointer' }}>{ownerName(d.owner_id)}</td>
                                <td style={{ padding: '8px 10px' }} onClick={(e) => e.stopPropagation()}><select value={d.status} onChange={(e) => onStatus?.(d.id, e.target.value)} style={{ border: 'none', background: 'transparent', color: 'inherit', fontSize: 11, padding: '2px 4px', cursor: 'pointer' }} aria-label={'Change status for ' + d.title}><option>Not Started</option><option>In Progress</option><option>Completed</option></select></td>
                                <td onClick={() => onOpen(d.id)} style={{ padding: '8px 10px', color: 'var(--tx2)', cursor: 'pointer' }}>{fmtDate(d.due_date) || '—'}</td>
                                <td onClick={() => onOpen(d.id)} style={{ padding: '8px 10px', color: 'var(--tx2)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}>{d.next_steps || '—'}</td>
                                <td style={{ width: 34, padding: '8px 6px' }}><button onClick={() => onDuplicateDeliverable({ item: d })} title="Duplicate deliverable" aria-label="Duplicate deliverable" style={btnStyle({ padding: '3px 6px', fontSize: 11, color: 'var(--txm)', borderColor: 'transparent', background: 'transparent' })}>⧉</button></td>
                              </tr>)}
                              {adding && <tr style={{ background: 'var(--acc-bg)' }}><td></td><td></td><td style={{ padding: 6 }}><input data-inline-deliverable-input autoFocus value={quickTitle} onChange={(e) => setQuickTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submitAdd(); if (e.key === 'Escape') setAddingTo(null) }} placeholder="Type a deliverable…" style={inputStyle({ width: '100%', padding: '7px 9px' })} /></td><td style={{ padding: 6 }}><select value={quickOwner} disabled={!isAdmin} onChange={(e) => setQuickOwner(e.target.value)} style={inputStyle({ width: '100%' })}>{profiles.filter((p) => p.role !== 'admin').map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></td><td style={{ padding: 6 }}>Not Started</td><td style={{ padding: 6 }}><input type="date" value={quickDue} onChange={(e) => setQuickDue(e.target.value)} style={inputStyle({ width: '100%' })} /></td><td style={{ padding: 6 }}><button onClick={submitAdd} style={primaryBtnStyle({ padding: '6px 9px', fontSize: 11 })}>Add</button></td></tr>}
                            </tbody>
                          </table>
                          {!adding && <button onClick={() => beginAdd(co, pm, kr)} style={{ width: '100%', padding: '8px 12px', border: 0, borderTop: '1px dashed var(--bd)', background: 'transparent', color: 'var(--acc-tx)', textAlign: 'left', fontSize: 11, cursor: 'pointer' }}>+ Add deliverable</button>}
                        </div>
                  )}
                </div>
              {newNode?.type === 'key_result' && newNode.parentId === pm.id && <InlineNodeInput placeholder="Type Key Result…" value={newNode.name || ''} onChange={(name) => setNewNode((n) => ({ ...n, name }))} onCommit={commitNew} onCancel={() => setNewNode(null)} />}
            </div>
          })}
          {newNode?.type === 'pm' && newNode.parentId === co.id && <InlineNodeInput placeholder="Type PM Objective…" value={newNode.name || ''} onChange={(name) => setNewNode((n) => ({ ...n, name }))} onCommit={commitNew} onCancel={() => setNewNode(null)} />}
        </div>
      })}
    </div>
    {toast && <div style={{ position: 'fixed', left: '50%', bottom: 28, transform: 'translateX(-50%)', zIndex: 80, display: 'flex', alignItems: 'center', gap: 12, background: 'var(--navy)', color: '#fff', padding: '10px 12px 10px 14px', borderRadius: 9, boxShadow: '0 10px 28px rgba(0,0,0,0.2)', fontSize: 12 }}><span>{toast.message}</span><button onClick={async () => { const undo = toast.undo; setToast(null); await undo() }} style={{ border: '1px solid rgba(255,255,255,0.35)', background: 'transparent', color: '#fff', borderRadius: 6, padding: '5px 8px', cursor: 'pointer', fontSize: 11 }}>Undo</button><button onClick={() => setToast(null)} aria-label="Dismiss" style={{ border: 0, background: 'transparent', color: 'rgba(255,255,255,0.75)', cursor: 'pointer', fontSize: 14 }}>×</button></div>}
    </div>
  )
}

function InlineNodeInput({ placeholder, value, onChange, onCommit, onCancel }) {
  return <div style={{ padding: '8px 14px 10px 34px', background: 'var(--acc-bg)', borderTop: '1px dashed var(--bd)', display: 'flex', gap: 7 }}>
    <input autoFocus value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onCommit(); if (e.key === 'Escape') onCancel() }} placeholder={placeholder} style={inputStyle({ flex: 1, padding: '7px 9px' })} />
    <button onClick={onCommit} style={primaryBtnStyle({ padding: '6px 10px', fontSize: 11 })}>Add</button>
    <button onClick={onCancel} style={btnStyle({ padding: '6px 10px', fontSize: 11 })}>Cancel</button>
  </div>
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
  const from = range.from || localISODate(new Date(Date.now() - preset * 86400000))
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

function metricSet(items, totalLabel) {
  const completed = items.filter((i) => i.status === 'Completed').length
  const inProgress = items.filter((i) => i.status === 'In Progress').length
  const notStarted = items.filter((i) => i.status === 'Not Started').length
  const overdue = items.filter((i) => i.due_date && i.status !== 'Completed' && i.due_date < todayISO()).length
  const total = items.length
  const pct = (n) => (total ? Math.round((n / total) * 100) : 0)
  return [
    ['ti-circle-check', 'Completed', `${completed} (${pct(completed)}%)`, 'suc', 'completed'],
    ['ti-loader-2', 'In progress', `${inProgress} (${pct(inProgress)}%)`, 'wrn', 'inProgress'],
    ['ti-hourglass-empty', 'Yet to start', `${notStarted} (${pct(notStarted)}%)`, 'neu', 'notStarted'],
    ['ti-alert-triangle', 'Overdue', `${overdue} (${pct(overdue)}%)`, 'dgr', 'overdue'],
    ['ti-list-details', totalLabel, String(total), 'flat', 'total'],
  ]
}
function MetricGrid({ items, totalLabel, onCardClick }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,minmax(0,1fr))', gap: 10 }}>
      {metricSet(items, totalLabel).map(([icon, label, val, role, key]) => (
        <div key={label} onClick={() => onCardClick?.(key)} style={{
          background: 'var(--bg2)',
          border: '1px solid var(--bd)',
          borderTop: role === 'suc' ? '3px solid var(--suc-fill)' : role === 'wrn' ? '3px solid var(--wrn-fill)' : role === 'dgr' ? '3px solid var(--dgr-fill)' : role === 'acc' ? '3px solid var(--acc-fill)' : '3px solid var(--bds)',
          borderRadius: 8, padding: '13px 14px', minHeight: 72,
          boxSizing: 'border-box', boxShadow: '0 1px 2px rgba(15,42,67,0.04)',
          cursor: onCardClick ? 'pointer' : 'default',
          transition: 'transform 0.12s, box-shadow 0.12s',
        }}>
          <i className={`ti ${icon}`} style={{ fontSize: 15, color: role === 'flat' ? 'var(--txm)' : `var(--${role}-tx)` }} aria-hidden="true" />
          <p style={{ fontSize: 11, color: 'var(--tx2)', margin: '7px 0 3px' }}>{label}</p>
          <p style={{ fontSize: 19, fontWeight: 650, margin: 0, color: 'var(--tx1)', letterSpacing: '-0.2px' }}>{val}</p>
        </div>
      ))}
    </div>
  )
}

function segmentBreakdown(items) {
  let completed = 0, overdue = 0, inProgress = 0, notStarted = 0
  const today = todayISO()
  items.forEach((i) => {
    const isOd = i.due_date && i.status !== 'Completed' && i.due_date < today
    if (i.status === 'Completed') completed++
    else if (isOd) overdue++
    else if (i.status === 'In Progress') inProgress++
    else notStarted++
  })
  const total = items.length || 1
  return {
    completedPct: (completed / total) * 100,
    inProgressPct: (inProgress / total) * 100,
    notStartedPct: (notStarted / total) * 100,
    overduePct: (overdue / total) * 100,
  }
}

function HrbpBar({ name, items }) {
  const { completedPct, inProgressPct, notStartedPct, overduePct } = segmentBreakdown(items)
  const chip = (pct, role) => pct > 0 ? (
    <span style={{ fontSize: 11, fontWeight: 500, background: `var(--${role}-bg)`, color: `var(--${role}-tx)`, padding: '2px 8px', borderRadius: 999 }}>{Math.round(pct)}%</span>
  ) : null
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, marginBottom: 4 }}>
        <span>{name}</span>
        <span style={{ display: 'flex', gap: 6 }}>
          {chip(completedPct, 'suc')}
          {chip(inProgressPct, 'wrn')}
          {chip(notStartedPct, 'neu')}
          {chip(overduePct, 'dgr')}
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 999, overflow: 'hidden', display: 'flex', background: 'var(--bg1)' }}>
        <div style={{ width: completedPct + '%', background: 'var(--suc-fill)' }} />
        <div style={{ width: inProgressPct + '%', background: 'var(--wrn-fill)' }} />
        <div style={{ width: notStartedPct + '%', background: 'var(--neu-fill)' }} />
        <div style={{ width: overduePct + '%', background: 'var(--dgr-fill)' }} />
      </div>
    </div>
  )
}
function HrbpBarLegend() {
  const item = (role, label) => (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--txm)' }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: `var(--${role}-fill)`, display: 'inline-block' }} />{label}
    </span>
  )
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
      {item('suc', 'Completed')}{item('wrn', 'In progress')}{item('neu', 'Yet to start')}{item('dgr', 'Overdue')}
    </div>
  )
}

function SummaryView({ deliverables, profiles, expandedActions, isAdmin, actionHrbpRows, onDeliverableMetricClick, onActionMetricClick }) {
  const deliverableHrbpRows = profiles.filter((p) => p.role !== 'admin').map((p) => ({
    name: p.full_name,
    items: deliverables.filter((d) => d.owner_id === p.id),
  })).filter((r) => r.items.length > 0)

  const actionItems = expandedActions.map((a) => ({ status: a._effStatus, due_date: a.due_date }))

  return (
    <div>
      <div className="summary-section-heading" style={{ marginBottom: 8 }}>
        <p style={{ fontSize: 15, fontWeight: 650, margin: 0, color: 'var(--navy)' }}>Deliverables Overview</p>
      </div>
      <div className="summary-metrics">
        <MetricGrid items={deliverables} totalLabel="Total deliverables" onCardClick={onDeliverableMetricClick} />
      </div>

      <div className="summary-section-heading" style={{ marginTop: 20, marginBottom: 8 }}>
        <p style={{ fontSize: 15, fontWeight: 650, margin: 0, color: 'var(--navy)' }}>Action Items Overview</p>
      </div>
      <div className="summary-action-metrics">
        <MetricGrid items={actionItems} totalLabel="Total action items" onCardClick={onActionMetricClick} />
      </div>

      <div className="summary-dashboard-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14, marginTop: 18 }}>
        <div style={{ background: 'var(--bg2)', border: '0.5px solid var(--bd)', borderRadius: 12, padding: 16 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy)', margin: '0 0 3px' }}>Deliverables Completion by HRBP</p>
          <p style={{ fontSize: 11, color: 'var(--txm)', margin: '0 0 12px' }}>Progress across assigned deliverables</p>
          <HrbpBarLegend />
          {deliverableHrbpRows.length ? deliverableHrbpRows.map((r) => <HrbpBar key={r.name} name={r.name} items={r.items} />) : (
            <p style={{ fontSize: 12, color: 'var(--txm)', margin: 0 }}>No assigned deliverables yet.</p>
          )}
        </div>

        <div style={{ background: 'var(--bg2)', border: '0.5px solid var(--bd)', borderRadius: 12, padding: 16 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy)', margin: '0 0 3px' }}>Action Items Completion by HRBP</p>
          <p style={{ fontSize: 11, color: 'var(--txm)', margin: '0 0 12px' }}>Progress across assigned action items</p>
          <HrbpBarLegend />
          {isAdmin && actionHrbpRows.length ? actionHrbpRows.map((r) => <HrbpBar key={r.name} name={r.name} items={r.items} />) : (
            <p style={{ fontSize: 12, color: 'var(--txm)', margin: 0 }}>{isAdmin ? 'No assigned action items yet.' : 'Action item progress is available to HRBPs through the Action Items tab.'}</p>
          )}
        </div>
      </div>
    </div>
  )
}
function ActionsView({ keyActions, actionStatuses, profiles, isAdmin, ownerName, myId, actionFilter, onOpen, onAdd, onDelete, onMyStatusChange, onAdminStatusChange, onExport, onImport }) {
  const [collapsed, setCollapsed] = useState({})
  const visible = (isAdmin ? keyActions : keyActions.filter((a) =>
    a.shared ? actionStatuses.some((s) => s.action_id === a.id && s.user_id === myId) : a.owner_id === myId
  )).filter((a) => {
    const rows = a.shared ? actionStatuses.filter((s) => s.action_id === a.id) : []
    const status = a.shared
      ? (isAdmin
        ? (rows.length && rows.every((r) => r.status === 'Completed')
          ? 'Completed'
          : rows.some((r) => r.status === 'In Progress' || r.status === 'Completed')
            ? 'In Progress'
            : 'Not Started')
        : (rows.find((s) => s.user_id === myId)?.status || 'Not Started'))
      : a.status
    if (actionFilter.status !== 'all' && status !== actionFilter.status) return false
    if (actionFilter.overdueOnly && !(a.due_date && status !== 'Completed' && a.due_date < todayISO())) return false
    return true
  })
  if (!visible.length) return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 10 }}>
        <button onClick={onImport} style={btnStyle()}>Import from Excel</button>
        <button onClick={onExport} style={btnStyle()}>Export to Excel</button>
        <button onClick={onAdd} style={btnStyle()}>+ Add action</button>
      </div>
      <EmptyState msg="No action items logged yet." />
    </div>
  )

  const groups = {}
  visible.forEach((a) => {
    const key = a.raised_in?.trim() || 'Not tied to a specific session'
    groups[key] = groups[key] || []
    groups[key].push(a)
  })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 10 }}>
        <button onClick={onImport} style={btnStyle()}>Import from Excel</button>
        <button onClick={onExport} style={btnStyle()}>Export to Excel</button>
        <button onClick={onAdd} style={btnStyle()}>+ Add action</button>
      </div>

      {Object.keys(groups).map((session, i) => {
        const items = groups[session]
        const groupKey = 'session::' + session
        const isCollapsed = collapsed[groupKey]
        const color = CO_COLORS[i % CO_COLORS.length]
        return (
          <div key={session} style={{ borderLeft: `4px solid ${color}`, background: 'var(--bg1)', marginBottom: 10 }}>
            <button onClick={() => setCollapsed((c) => ({ ...c, [groupKey]: !c[groupKey] }))} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{isCollapsed ? '▸' : '▾'}</span>
              <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{session}</span>
              <span style={{ fontSize: 11, color: 'var(--txm)' }}>{items.length} item{items.length === 1 ? '' : 's'}</span>
            </button>
            {!isCollapsed && (
              <div style={{ padding: '0 12px 10px' }}>
                <div style={{ background: 'var(--bg2)', borderRadius: 8, overflow: 'hidden' }}>
                  {items.map((a, idx) => {
                    const rows = a.shared ? actionStatuses.filter((s) => s.action_id === a.id) : []
                    const myRow = a.shared ? rows.find((s) => s.user_id === myId) : null
                    const myStatus = myRow ? myRow.status : 'Not Started'
                    return (
                      <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 12px', borderTop: idx ? '0.5px solid var(--bd)' : 'none' }}>
                        <span onClick={() => onOpen(a.id)} style={{ fontSize: 13, cursor: 'pointer', flex: 1, minWidth: 0 }}>{a.title}</span>
                        {a.shared ? (
                          isAdmin ? (
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
                              {profiles.filter((p) => p.role !== 'admin' && rows.some((s) => s.user_id === p.id)).map((p) => {
                                const row = rows.find((s) => s.user_id === p.id)
                                const st = row.status
                                const overdue = a.due_date && st !== 'Completed' && a.due_date < todayISO()
                                const role = overdue ? 'dgr' : st === 'Completed' ? 'suc' : st === 'In Progress' ? 'wrn' : 'neu'
                                return (
                                  <label key={p.id} onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, padding: '2px 3px 2px 7px', borderRadius: 999, background: `var(--${role}-bg)`, color: `var(--${role}-tx)`, whiteSpace: 'nowrap' }}>
                                    {overdue && '⚠ '}{p.full_name.split(' ')[0]}
                                    <select value={st} onChange={(e) => onAdminStatusChange(a.id, p.id, e.target.value)} style={{ fontSize: 10, border: 'none', background: 'transparent', color: `var(--${role}-tx)`, padding: '2px', cursor: 'pointer' }}>
                                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                  </label>
                                )
                              })}
                            </div>
                          ) : (
                            <select onClick={(e) => e.stopPropagation()} value={myStatus} onChange={(e) => onMyStatusChange(a.id, e.target.value)} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 999, border: '0.5px solid var(--bds)', background: 'var(--bg2)', color: 'var(--tx1)', flexShrink: 0 }}>
                              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          )
                        ) : (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                            <StatusBadge status={a.status} overdue={a.due_date && a.status !== 'Completed' && a.due_date < todayISO()} />
                            <span onClick={() => onOpen(a.id)} style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', cursor: 'pointer' }}>{ownerName(a.owner_id)}</span>
                          </span>
                        )}
                        {isAdmin && (
                          <button onClick={(e) => { e.stopPropagation(); onDelete(a.id) }} style={{ fontSize: 11, color: 'var(--dgr-tx)', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>✕</button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )
      })}
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
    title: '', corporateObjective: '', pmObjective: '', keyResult: '', division: Object.values(OWNER_FUNCTIONS)[0][0], ownerId: isAdmin ? profiles[0]?.id : userId,
    status: 'Not Started', dueDate: todayISO(), revisedDueDate: '', revisionReason: '', nextSteps: '',
  })
  const [comments, setComments] = useState([])
  const [commentText, setCommentText] = useState('')
  const [subs, setSubs] = useState([])
  const [subTitle, setSubTitle] = useState('')
  const [subOwner, setSubOwner] = useState(isAdmin ? profiles[0]?.id : userId)
  const [historyEntries, setHistoryEntries] = useState([])
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
            <Field label={`Owner${!isAdmin ? ' (you)' : ''}`}>
              <select disabled={!isAdmin} value={form.ownerId} onChange={(e) => setForm((f) => ({ ...f, ownerId: e.target.value, division: (OWNER_FUNCTIONS[profiles.find((p) => p.id === e.target.value)?.full_name] || DIVISIONS)[0] }))} style={inputStyle({ width: '100%' })}>
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
              <select value={subOwner} disabled={!isAdmin} onChange={(e) => setSubOwner(e.target.value)} style={inputStyle()}>{profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>
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
                <button onClick={async () => {
                  const next = !showHistory
                  setShowHistory(next)
                  if (next && historyEntries.length === 0) {
                    const { data } = await supabase.from('deliverable_status_history').select('*').eq('deliverable_id', item.id).order('changed_at', { ascending: false })
                    setHistoryEntries(data || [])
                  }
                }} style={{ fontSize: 12, color: 'var(--acc-tx)', border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}>{showHistory ? 'Hide history' : 'View history'}</button>
                {showHistory && (
                  historyEntries.length ? (
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {historyEntries.map((h) => (
                        <p key={h.id} style={{ fontSize: 12, color: 'var(--tx2)', margin: 0 }}>
                          {new Date(h.changed_at).toLocaleString()} — {h.old_status ? `${h.old_status} → ${h.new_status}` : `Created as ${h.new_status}`}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontSize: 12, color: 'var(--txm)', marginTop: 8 }}>No history recorded yet — this starts tracking from now on, so items created before this feature won't have earlier entries.</p>
                  )
                )}
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

function ActionModal({ action, profiles, isAdmin, myId, existingStatuses, onClose, onSave }) {
  const isNew = !action
  const [form, setForm] = useState(action ? {
    id: action.id, title: action.title, raisedIn: action.raised_in || '', ownerId: action.owner_id,
    shared: action.shared, sharedOwnerIds: existingStatuses.map((s) => s.user_id),
    dueDate: action.due_date || '', status: action.status, comment: action.comment || '',
  } : {
    title: '', raisedIn: '', ownerId: isAdmin ? profiles[0]?.id : myId, shared: false, sharedOwnerIds: [],
    dueDate: todayISO(), status: 'Not Started', comment: '',
  })
  const [err, setErr] = useState('')
  const modalRef = React.useRef(null)
  useEffect(() => { modalRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, [])
  const hrbps = profiles.filter((p) => p.role !== 'admin')

  const toggleOwner = (id) => setForm((f) => ({ ...f, sharedOwnerIds: f.sharedOwnerIds.includes(id) ? f.sharedOwnerIds.filter((x) => x !== id) : [...f.sharedOwnerIds, id] }))

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

          {isAdmin && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={form.shared} onChange={(e) => setForm((f) => ({ ...f, shared: e.target.checked }))} />
              This applies to all HRBPs (each tracks their own progress)
            </label>
          )}

          {form.shared ? (
            <Field label="Assigned to">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, border: '0.5px solid var(--bds)', borderRadius: 8, padding: 10 }}>
                {hrbps.map((p) => (
                  <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <input type="checkbox" disabled={!isAdmin} checked={form.sharedOwnerIds.includes(p.id)} onChange={() => toggleOwner(p.id)} /> {p.full_name}
                  </label>
                ))}
                {isAdmin && <span style={{ fontSize: 10, color: 'var(--txm)', marginTop: 2 }}>
                  {form.sharedOwnerIds.length ? `${form.sharedOwnerIds.length} HRBP${form.sharedOwnerIds.length === 1 ? '' : 's'} selected` : 'Select the HRBPs responsible for this action item.'}
                </span>}
              </div>
            </Field>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label={`Owner${!isAdmin ? ' (you)' : ''}`}>
                <select disabled={!isAdmin} value={form.ownerId} onChange={(e) => setForm((f) => ({ ...f, ownerId: e.target.value }))} style={inputStyle({ width: '100%' })}>
                  {profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
              </Field>
              <Field label="Due date"><input type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} style={inputStyle({ width: '100%' })} /></Field>
            </div>
          )}
          {form.shared && (
            <Field label="Due date"><input type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} style={inputStyle({ width: '100%' })} /></Field>
          )}
          {!form.shared && (
            <Field label="Status"><select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} style={inputStyle({ width: '100%' })}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
          )}
          <Field label="Comment"><textarea rows={2} value={form.comment} onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))} style={inputStyle({ width: '100%', resize: 'vertical', fontFamily: 'inherit' })} /></Field>
          {err && <div style={{ fontSize: 12, color: 'var(--dgr-tx)' }}>{err}</div>}
        </div>
        <div style={{ padding: '1rem 1.25rem', borderTop: '0.5px solid var(--bd)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={btnStyle()}>Cancel</button>
          <button onClick={() => {
            if (!form.title.trim()) { setErr('Enter a title first.'); return }
            if (form.shared && form.sharedOwnerIds.length === 0) { setErr('Select at least one HRBP.'); return }
            onSave(form, isNew)
          }} style={primaryBtnStyle()}>Save</button>
        </div>
      </div>
    </div>
  )
}

function ExportDialog({ filters, onCancel, onExport }) {
  const [useFiltered, setUseFiltered] = useState(false)
  const [includeActions, setIncludeActions] = useState(true)
  const filtersActive = filters.search || filters.divisions.length > 0 || filters.owner !== 'all' || filters.status !== 'all' || filters.overdueOnly
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

function PptDialog({ scope, onCancel, onGenerate, busy }) {
  const [from, setFrom] = useState(todayISO().slice(0, 8) + '01')
  const [to, setTo] = useState(todayISO())
  const preset = (days) => { setFrom(localISODate(new Date(Date.now() - days * 86400000))); setTo(todayISO()) }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 50 }}>
      <div style={{ background: 'var(--bg2)', color: 'var(--tx1)', borderRadius: 12, width: '100%', maxWidth: 380, padding: 20 }}>
        <p style={{ fontSize: 15, fontWeight: 500, margin: '0 0 4px' }}>{scope === 'cpo' ? 'PPT Deck' : 'My Update Pack'}</p>
        <p style={{ fontSize: 12, color: 'var(--tx2)', margin: '0 0 14px' }}>Everything else in the deck reflects right now. This range only controls the "Key Wins" slide — pick any period, including past ones.</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <button onClick={() => preset(7)} style={btnStyle()}>Last 7 days</button>
          <button onClick={() => preset(14)} style={btnStyle()}>Last 14 days</button>
          <button onClick={() => preset(30)} style={btnStyle()}>Last 30 days</button>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={inputStyle({ width: '100%' })} />
          <span style={{ fontSize: 12, color: 'var(--tx2)' }}>to</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={inputStyle({ width: '100%' })} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onCancel} disabled={busy} style={btnStyle()}>Cancel</button>
          <button onClick={() => onGenerate(from, to)} disabled={busy} style={primaryBtnStyle()}>{busy ? 'Generating…' : 'Generate PPT'}</button>
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