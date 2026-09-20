import React, { useEffect, useMemo, useState } from 'react'
import { STATUSES } from './constants'

const isoToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const dateLabel = (value) => value
  ? new Date(value + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—'

const isOverdue = (item) => Boolean(item.due_date && item.status !== 'Completed' && item.due_date < isoToday())

const latestComment = (item) => {
  const comments = Array.isArray(item.comments) ? item.comments : []
  if (!comments.length) return ''
  return [...comments].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]?.text || ''
}

function ActionMenu({ open, onToggle, children }) {
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={onToggle} aria-label="More options" style={iconButtonStyle}>•••</button>
      {open && (
        <div style={menuStyle}>
          {children}
        </div>
      )}
    </div>
  )
}

const menuItem = { width: '100%', border: 0, background: 'transparent', color: 'var(--tx1)', padding: '8px 10px', textAlign: 'left', cursor: 'pointer', fontSize: 12, borderRadius: 5 }
const iconButtonStyle = { border: 0, background: 'transparent', color: 'var(--txm)', cursor: 'pointer', padding: '5px 7px', borderRadius: 5, fontSize: 13 }
const menuStyle = { position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 30, minWidth: 150, padding: 4, background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 8, boxShadow: '0 10px 24px rgba(0,0,0,.10)' }

function InlineName({ node, prefix, editing, onStart, onSave, onCancel }) {
  const [draft, setDraft] = useState(node.name)
  useEffect(() => { if (editing) setDraft(node.name) }, [editing, node.name])
  if (editing) {
    return (
      <input
        autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft.trim()) onSave(draft); else onCancel() }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); if (draft.trim()) onSave(draft) }
          if (e.key === 'Escape') onCancel()
        }}
        style={{ width: '100%', maxWidth: 700, border: '1px solid var(--acc-fill)', borderRadius: 6, padding: '6px 8px', background: 'var(--bg2)', color: 'var(--tx1)', fontSize: 13, outline: 'none' }}
      />
    )
  }
  return (
    <span onDoubleClick={() => onStart(node.id)} title="Double-click to rename" style={{ cursor: 'text' }}>
      <span style={{ color: 'var(--txm)', fontWeight: 500 }}>{prefix}</span>{node.name}
    </span>
  )
}

function AddNodeRow({ placeholder, onCommit, onCancel }) {
  const [value, setValue] = useState('')
  return (
    <div style={{ display: 'flex', gap: 8, padding: '10px 14px', background: 'var(--acc-bg)', borderTop: '1px dashed var(--bd)' }}>
      <input
        autoFocus value={value} onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && value.trim()) onCommit(value.trim()); if (e.key === 'Escape') onCancel() }}
        placeholder={placeholder}
        style={{ flex: 1, minWidth: 0, border: '1px solid var(--bds)', borderRadius: 6, padding: '7px 9px', background: 'var(--bg2)', color: 'var(--tx1)', fontSize: 12 }}
      />
      <button disabled={!value.trim()} onClick={() => value.trim() && onCommit(value.trim())} style={primaryButton}>Add</button>
      <button onClick={onCancel} style={secondaryButton}>Cancel</button>
    </div>
  )
}

function InlineDeliverableField({ value, onSave, placeholder = '—', multiline = false, style = {}, editable = true }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value || '')
  useEffect(() => { if (!editing) setDraft(value || '') }, [value, editing])
  if (!editable) return <span style={{ display:'block', minHeight:18, ...style }}>{value || placeholder}</span>
  const commit = () => {
    const next = draft.trim()
    setEditing(false)
    if (next !== (value || '')) onSave(next)
  }
  if (!editing) {
    return <span onClick={() => setEditing(true)} title="Click to edit" style={{ cursor:'text', display:'block', minHeight:18, ...style }}>{value || placeholder}</span>
  }
  const props = {
    autoFocus: true, value: draft, onChange: (e) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e) => { if (e.key === 'Enter' && !multiline) { e.preventDefault(); commit() } if (e.key === 'Escape') { setDraft(value || ''); setEditing(false) } },
    style: { width:'100%', border:'1px solid var(--acc-fill)', borderRadius:5, padding:'5px 7px', background:'var(--bg2)', color:'var(--tx1)', fontSize:11, outline:'none', ...style }
  }
  return multiline ? <textarea {...props} rows={2} onKeyDown={(e) => { if (e.key === 'Escape') { setDraft(value || ''); setEditing(false) } }} /> : <input {...props} />
}

export default function DeliverablesWorkspace({
  items, isAdmin, collapsed, setCollapsed, selected, setSelected, ownerName, profiles,
  strategyNodes, onCreateNode, onRenameNode, onDuplicateKeyResult, onDuplicateDeliverable,
  onMoveKeyResult, onMoveDeliverable, onOpen, onQuickAdd, onQuickStatus, onDelete, onBulkStatus, onBulkDelete,
  onExport, onImport, onGeneratePpt, onInlineUpdate, userId,
}) {
  const [menu, setMenu] = useState(null)
  const [addingNode, setAddingNode] = useState(null)
  const [addingTo, setAddingTo] = useState(null)
  const [quickTitle, setQuickTitle] = useState('')
  const [quickOwner, setQuickOwner] = useState('')
  const [quickDue, setQuickDue] = useState(isoToday())
  const [editingNode, setEditingNode] = useState(null)
  const [dragging, setDragging] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  const [toast, setToast] = useState(null)

  const corporations = useMemo(() => strategyNodes.filter((n) => n.node_type === 'corporate'), [strategyNodes])
  const pmsFor = (id) => strategyNodes.filter((n) => n.node_type === 'pm' && n.parent_id === id)
  const krsFor = (id) => strategyNodes.filter((n) => n.node_type === 'key_result' && n.parent_id === id)
  const itemsFor = (id) => [...items.filter((d) => d.key_result_id === id)].sort((a, b) => {
    const ad = a.due_date || '9999-12-31'
    const bd = b.due_date || '9999-12-31'
    return ad.localeCompare(bd) || a.title.localeCompare(b.title)
  })
  const selectedIds = Object.keys(selected).filter((id) => selected[id])
  const selectedCount = selectedIds.length

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 7000)
    return () => clearTimeout(timer)
  }, [toast])

  const toggle = (key) => setCollapsed((current) => ({ ...current, [key]: !current[key] }))

  const beginNode = (type, parentId) => {
    setMenu(null)
    setAddingNode({ type, parentId })
  }

  const createNode = async (name) => {
    const result = await onCreateNode({ nodeType: addingNode.type, name, parentId: addingNode.parentId })
    if (result) setAddingNode(null)
  }

  const beginDeliverable = (co, pm, kr) => {
    setMenu(null)
    setAddingTo({ co, pm, kr })
    setQuickTitle('')
    setQuickOwner(isAdmin ? (profiles.find((p) => p.role !== 'admin')?.id || profiles[0]?.id || '') : (userId || ''))
    setQuickDue(isoToday())
  }

  const submitDeliverable = async () => {
    if (!quickTitle.trim() || !addingTo) return
    const ok = await onQuickAdd({
      title: quickTitle.trim(),
      corporateObjective: addingTo.co.name,
      pmObjective: addingTo.pm.name,
      keyResult: addingTo.kr.name,
      ownerId: quickOwner,
      dueDate: quickDue,
      corporateObjectiveId: addingTo.co.id,
      pmObjectiveId: addingTo.pm.id,
      keyResultId: addingTo.kr.id,
    })
    if (ok) {
      setAddingTo(null)
      setQuickTitle('')
    }
  }

  const startDrag = (event, payload) => {
    event.stopPropagation()
    setDragging(payload)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', `${payload.type}:${payload.id}`)
  }

  const dropOnPm = async (event, pm) => {
    if (dragging?.type !== 'key_result') return
    event.preventDefault()
    event.stopPropagation()
    const node = strategyNodes.find((n) => n.id === dragging.id)
    const previousPmId = node?.parent_id
    setDragging(null)
    setDropTarget(null)
    if (!node || previousPmId === pm.id) return
    const ok = await onMoveKeyResult({ node, targetPmId: pm.id })
    if (ok) setToast({ message: 'Key Result moved', undo: () => onMoveKeyResult({ node: { ...node, parent_id: pm.id }, targetPmId: previousPmId }) })
  }

  const dropOnKr = async (event, kr) => {
    if (dragging?.type !== 'deliverable') return
    event.preventDefault()
    event.stopPropagation()
    const item = items.find((d) => d.id === dragging.id)
    const previousKrId = item?.key_result_id
    setDragging(null)
    setDropTarget(null)
    if (!item || previousKrId === kr.id) return
    const ok = await onMoveDeliverable({ item, targetKeyResultId: kr.id })
    if (ok) setToast({ message: 'Deliverable moved', undo: () => onMoveDeliverable({ item: { ...item, key_result_id: kr.id }, targetKeyResultId: previousKrId }) })
  }

  const rename = async (node, value) => {
    await onRenameNode(node, value)
    setEditingNode(null)
  }

  return (
    <div className="deliverables-workspace">
      <style>{`
        .deliverables-workspace { color: var(--tx1); }
        .dw-toolbar { display:flex; align-items:center; justify-content:space-between; gap:14px; margin-bottom:20px; }
        .dw-toolbar-actions { display:flex; align-items:center; gap:7px; flex-wrap:wrap; }
        .dw-stat { font-size:12px; color:var(--txm); }
        .dw-stat strong { color:var(--tx1); font-size:14px; }
        .dw-objective { background:var(--bg2); border:1px solid var(--bd); border-radius:12px; margin-bottom:14px; overflow:visible; }
        .dw-objective-head { display:flex; align-items:center; gap:10px; min-height:62px; padding:0 16px; border-left:4px solid var(--acc-fill); border-radius:12px; }
        .dw-pm { margin:0 16px; border-top:1px solid var(--bd); }
        .dw-pm-head { display:flex; align-items:center; gap:9px; min-height:50px; }
        .dw-kr { margin:0 0 10px 28px; border-left:2px solid var(--bd); }
        .dw-kr-head { display:flex; align-items:center; gap:8px; min-height:46px; padding:0 10px 0 12px; border-radius:7px; transition:.15s; }
        .dw-kr-head.drop { background:var(--acc-bg); outline:2px dashed var(--acc-fill); outline-offset:-2px; }
        .dw-kr-body { padding:0 0 8px 26px; }
        .dw-table-wrap { overflow-x:auto; border-top:1px solid var(--bd); }
        .dw-table { width:100%; min-width:820px; border-collapse:collapse; font-size:12px; }
        .dw-table th { text-align:left; color:var(--txm); font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:.35px; padding:8px 9px; background:var(--bg0); }
        .dw-table td { padding:10px 9px; border-top:1px solid var(--bd); vertical-align:middle; }
        .dw-table tr.data-row:hover { background:var(--acc-bg); }
        .dw-empty { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:15px 12px; color:var(--txm); font-size:12px; border-top:1px solid var(--bd); }
        .dw-add { width:100%; border:0; border-top:1px dashed var(--bd); background:transparent; color:var(--acc-tx); text-align:left; padding:10px 12px; cursor:pointer; font-size:12px; font-weight:600; }
        .dw-add:hover { background:var(--acc-bg); }
        .dw-grip { color:var(--txm); cursor:grab; user-select:none; padding:4px; }
        .dw-grip:active { cursor:grabbing; }
        .dw-context { font-size:11px; color:var(--txm); white-space:nowrap; }
        .dw-mobile-stack { display:flex; flex-direction:column; }
        @media (max-width:700px) {
          .dw-toolbar { align-items:flex-start; flex-direction:column; }
          .dw-toolbar-actions { width:100%; }
          .dw-toolbar-actions > button { flex:1; }
          .dw-objective-head { padding:0 10px; }
          .dw-pm { margin:0 8px; }
          .dw-kr { margin-left:8px; }
          .dw-kr-body { padding-left:8px; }
          .dw-context { display:none; }
        }
      `}</style>

      <div className="dw-toolbar">
        <div className="dw-stat"><strong>{items.length}</strong> deliverables in view</div>
        <div className="dw-toolbar-actions">
          <button onClick={() => beginNode('corporate', null)} style={primaryButton}>+ Corporate Objective</button>
          <button onClick={onImport} style={secondaryButton}>Import</button>
          <button onClick={onExport} style={secondaryButton}>Export</button>
          <ActionMenu open={menu === 'global'} onToggle={() => setMenu(menu === 'global' ? null : 'global')}>
            <button style={menuItem} onClick={() => { onGeneratePpt(); setMenu(null) }}>Generate PPT</button>
          </ActionMenu>
        </div>
      </div>

      {addingNode?.type === 'corporate' && <AddNodeRow placeholder="Type Corporate Objective…" onCommit={createNode} onCancel={() => setAddingNode(null)} />}

      {selectedCount > 0 && (
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'9px 11px', marginBottom:12, background:'var(--acc-bg)', border:'1px solid var(--bd)', borderRadius:8 }}>
          <strong style={{ fontSize:12, color:'var(--acc-tx)' }}>{selectedCount} selected</strong>
          <select defaultValue="" onChange={(e) => e.target.value && onBulkStatus(e.target.value)} style={{ border:'1px solid var(--bds)', borderRadius:6, padding:'6px 8px', background:'var(--bg2)', color:'var(--tx1)', fontSize:11 }}>
            <option value="">Change status…</option>
            {STATUSES.map((status) => <option key={status}>{status}</option>)}
          </select>
          {isAdmin && <button onClick={onBulkDelete} style={{ ...secondaryButton, color:'var(--dgr-tx)' }}>Delete</button>}
          <button onClick={() => setSelected({})} style={{ ...secondaryButton, marginLeft:'auto' }}>Clear</button>
        </div>
      )}

      {corporations.length === 0 && !addingNode && (
        <div style={{ border:'1px solid var(--bd)', borderRadius:12, padding:'48px 24px', textAlign:'center', background:'var(--bg2)' }}>
          <div style={{ fontSize:15, fontWeight:650, marginBottom:6 }}>Start with your first Corporate Objective</div>
          <div style={{ fontSize:12, color:'var(--txm)', marginBottom:16 }}>Build the hierarchy first, then add Key Results and deliverables underneath it.</div>
          <button onClick={() => beginNode('corporate', null)} style={primaryButton}>+ Corporate Objective</button>
        </div>
      )}

      {corporations.map((co, ci) => {
        const coKey = 'co::' + co.id
        const coCollapsed = collapsed[coKey]
        return (
          <section key={co.id} className="dw-objective">
            <div className="dw-objective-head">
              <button onClick={() => toggle(coKey)} style={iconButtonStyle}>{coCollapsed ? '▸' : '▾'}</button>
              <div style={{ flex:1, minWidth:0, fontSize:14, fontWeight:650 }}>
                <InlineName node={co} prefix="Corporate Objective · " editing={editingNode === co.id} onStart={setEditingNode} onSave={(v) => rename(co,v)} onCancel={() => setEditingNode(null)} />
              </div>
              <div className="dw-context">{pmsFor(co.id).length} PM objective{pmsFor(co.id).length === 1 ? '' : 's'}</div>
              <ActionMenu open={menu === co.id} onToggle={() => setMenu(menu === co.id ? null : co.id)}>
                <button style={menuItem} onClick={() => beginNode('pm', co.id)}>+ PM Objective</button>
                {isAdmin && <button style={menuItem} onClick={() => { setEditingNode(co.id); setMenu(null) }}>Rename</button>}
              </ActionMenu>
            </div>

            {!coCollapsed && (
              <>
                {pmsFor(co.id).map((pm) => {
                  const pmKey = 'pm::' + pm.id
                  const pmCollapsed = collapsed[pmKey]
                  return (
                    <div key={pm.id} className="dw-pm">
                      <div
                        className="dw-pm-head"
                        onDragOver={(e) => { if (dragging?.type === 'key_result') { e.preventDefault(); setDropTarget('pm:' + pm.id) } }}
                        onDragLeave={() => dropTarget === 'pm:' + pm.id && setDropTarget(null)}
                        onDrop={(e) => dropOnPm(e, pm)}
                        style={{ background:dropTarget === 'pm:' + pm.id ? 'var(--acc-bg)' : 'transparent', outline:dropTarget === 'pm:' + pm.id ? '2px dashed var(--acc-fill)' : 'none', outlineOffset:-2, borderRadius:7 }}
                      >
                        <button onClick={() => toggle(pmKey)} style={iconButtonStyle}>{pmCollapsed ? '▸' : '▾'}</button>
                        <div style={{ flex:1, minWidth:0, fontSize:13, color:'var(--tx2)' }}>
                          <InlineName node={pm} prefix="PM Objective · " editing={editingNode === pm.id} onStart={setEditingNode} onSave={(v) => rename(pm,v)} onCancel={() => setEditingNode(null)} />
                        </div>
                        <div className="dw-context">{krsFor(pm.id).length} Key Result{krsFor(pm.id).length === 1 ? '' : 's'}</div>
                        <ActionMenu open={menu === pm.id} onToggle={() => setMenu(menu === pm.id ? null : pm.id)}>
                          <button style={menuItem} onClick={() => beginNode('key_result', pm.id)}>+ Key Result</button>
                          {isAdmin && <button style={menuItem} onClick={() => { setEditingNode(pm.id); setMenu(null) }}>Rename</button>}
                        </ActionMenu>
                      </div>

                      {!pmCollapsed && (
                        <>
                          {krsFor(pm.id).map((kr) => {
                            const krKey = 'kr::' + kr.id
                            const krCollapsed = collapsed[krKey]
                            const krItems = itemsFor(kr.id)
                            const adding = addingTo?.kr?.id === kr.id
                            const complete = krItems.filter((d) => d.status === 'Completed').length
                            return (
                              <div key={kr.id} className="dw-kr">
                                <div
                                  className={`dw-kr-head${dropTarget === 'kr:' + kr.id ? ' drop' : ''}`}
                                  onDragOver={(e) => { if (dragging?.type === 'deliverable') { e.preventDefault(); setDropTarget('kr:' + kr.id) } }}
                                  onDragLeave={() => dropTarget === 'kr:' + kr.id && setDropTarget(null)}
                                  onDrop={(e) => dropOnKr(e, kr)}
                                >
                                  <button onClick={() => toggle(krKey)} style={iconButtonStyle}>{krCollapsed ? '▸' : '▾'}</button>
                                  <span className="dw-grip" draggable onDragStart={(e) => startDrag(e, { type:'key_result', id:kr.id })} onDragEnd={() => { setDragging(null); setDropTarget(null) }} title="Move Key Result">⠿</span>
                                  <div style={{ flex:1, minWidth:0, fontSize:12.5, fontWeight:600 }}>
                                    <InlineName node={kr} prefix="Key Result · " editing={editingNode === kr.id} onStart={setEditingNode} onSave={(v) => rename(kr,v)} onCancel={() => setEditingNode(null)} />
                                  </div>
                                  <span className="dw-context">{complete}/{krItems.length} complete</span>
                                  <ActionMenu open={menu === kr.id} onToggle={() => setMenu(menu === kr.id ? null : kr.id)}>
                                    <button style={menuItem} onClick={() => { onDuplicateKeyResult({ node:kr }); setMenu(null) }}>Duplicate Key Result</button>
                                    {isAdmin && <button style={menuItem} onClick={() => { setEditingNode(kr.id); setMenu(null) }}>Rename</button>}
                                  </ActionMenu>
                                </div>

                                {!krCollapsed && (
                                  <div className="dw-kr-body">
                                    {krItems.length === 0 && !adding ? (
                                      <div className="dw-empty">
                                        <span>No deliverables under this Key Result yet.</span>
                                        <button onClick={() => beginDeliverable(co,pm,kr)} style={{ border:0, background:'transparent', color:'var(--acc-tx)', cursor:'pointer', fontWeight:600, fontSize:12 }}>+ Add deliverable</button>
                                      </div>
                                    ) : (
                                      <div className="dw-table-wrap">
                                        <table className="dw-table">
                                          <thead><tr><th style={{width:28}}></th><th style={{width:28}}></th><th>Deliverable</th><th>HRBP</th><th>Status</th><th>Due</th><th>Updates &amp; Next Steps</th><th style={{width:38}}></th></tr></thead>
                                          <tbody>
                                            {krItems.map((item) => {
                                              const overdue = isOverdue(item)
                                              return (
                                                <tr key={item.id} className="data-row">
                                                  <td><span className="dw-grip" draggable onDragStart={(e) => startDrag(e, { type:'deliverable', id:item.id })} onDragEnd={() => { setDragging(null); setDropTarget(null) }} title="Move deliverable">⠿</span></td>
                                                  <td><input type="checkbox" checked={!!selected[item.id]} onChange={(e) => setSelected((current) => ({ ...current, [item.id]: e.target.checked }))} /></td>
                                                  <td style={{ fontWeight:600, color:'var(--tx1)' }}>
                                                    <InlineDeliverableField value={item.title} editable={isAdmin} onSave={(value) => onInlineUpdate(item.id, 'title', value)} />
                                                    {item.revised_due_date && <span title="Revised due date" style={{ marginLeft:6, color:'var(--wrn-tx)', fontSize:10 }}>●</span>}
                                                  </td>
                                                  <td style={{ color:'var(--tx2)' }}>
                                                    <span onClick={() => onOpen(item.id)} title="Click to edit owner" style={{cursor:'pointer'}}>{ownerName(item.owner_id)}</span>
                                                  </td>
                                                  <td onClick={(e) => e.stopPropagation()}>
                                                    <select value={item.status} onChange={(e) => onQuickStatus(item.id, e.target.value)} style={{ border:'1px solid transparent', borderRadius:5, padding:'4px 6px', background:'transparent', color:'inherit', fontSize:11, cursor:'pointer' }}>
                                                      {STATUSES.map((status) => <option key={status}>{status}</option>)}
                                                    </select>
                                                  </td>
                                                  <td style={{ color:overdue ? 'var(--dgr-tx)' : 'var(--tx2)', whiteSpace:'nowrap' }}>
                                                    <span onClick={() => onOpen(item.id)} title="Click to edit" style={{cursor:'pointer'}}>{overdue ? 'Overdue · ' : ''}{dateLabel(item.due_date)}</span>
                                                  </td>
                                                  <td style={{ color:'var(--tx2)', maxWidth:240 }}>
                                                    {latestComment(item) ? (
                                                      <span onClick={() => onOpen(item.id)} title="Click to view comments" style={{ display:'block', minHeight:18, cursor:'pointer', overflow:'hidden', textOverflow:'ellipsis' }}>
                                                        {latestComment(item)}
                                                      </span>
                                                    ) : (
                                                      <InlineDeliverableField value={item.next_steps} placeholder="—" multiline style={{ overflow:'hidden', textOverflow:'ellipsis' }} onSave={(value) => onInlineUpdate(item.id, 'next_steps', value)} />
                                                    )}
                                                  </td>
                                                  <td>
                                                    <ActionMenu open={menu === item.id} onToggle={() => setMenu(menu === item.id ? null : item.id)}>
                                                      <button style={menuItem} onClick={() => { onDuplicateDeliverable({ item }); setMenu(null) }}>Duplicate</button>
                                                      <button style={{ ...menuItem, color:'var(--dgr-tx)' }} onClick={() => { if (isAdmin) { onDelete(item.id); setMenu(null) } }}>Delete</button>
                                                    </ActionMenu>
                                                  </td>
                                                </tr>
                                              )
                                            })}
                                            {adding && (
                                              <tr style={{ background:'var(--acc-bg)' }}>
                                                <td></td><td></td>
                                                <td style={{padding:6}}><input data-inline-deliverable-input autoFocus value={quickTitle} onChange={(e) => setQuickTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submitDeliverable(); if (e.key === 'Escape') setAddingTo(null) }} placeholder="Type a deliverable…" style={{width:'100%', border:'1px solid var(--bds)', borderRadius:6, padding:'7px 9px', background:'var(--bg2)', color:'var(--tx1)', fontSize:12}} /></td>
                                                <td style={{padding:6}}><select value={quickOwner} disabled={!isAdmin} onChange={(e) => setQuickOwner(e.target.value)} style={{width:'100%', border:'1px solid var(--bds)', borderRadius:6, padding:'6px 7px', background:'var(--bg2)', color:'var(--tx1)', fontSize:11}}>{profiles.filter((p) => p.role !== 'admin').map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></td>
                                                <td style={{padding:6, color:'var(--txm)'}}>Not Started</td>
                                                <td style={{padding:6}}><input type="date" value={quickDue} onChange={(e) => setQuickDue(e.target.value)} style={{width:'100%', border:'1px solid var(--bds)', borderRadius:6, padding:'6px 7px', background:'var(--bg2)', color:'var(--tx1)', fontSize:11}} /></td>
                                                <td style={{padding:6}}><div style={{display:'flex',gap:6}}><button onClick={submitDeliverable} disabled={!quickTitle.trim()} style={primaryButton}>Add</button><button onClick={() => setAddingTo(null)} style={secondaryButton}>Cancel</button></div></td><td></td>
                                              </tr>
                                            )}
                                          </tbody>
                                        </table>
                                        {!adding && <button className="dw-add" onClick={() => beginDeliverable(co,pm,kr)}>+ Add deliverable</button>}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                          {addingNode?.type === 'key_result' && addingNode.parentId === pm.id && <AddNodeRow placeholder="Type Key Result…" onCommit={createNode} onCancel={() => setAddingNode(null)} />}
                        </>
                      )}

                    </div>
                  )
                })}
                {addingNode?.type === 'pm' && addingNode.parentId === co.id && <AddNodeRow placeholder="Type PM Objective…" onCommit={createNode} onCancel={() => setAddingNode(null)} />}
              </>
            )}
          </section>
        )
      })}

      {toast && (
        <div style={{ position:'fixed', left:'50%', bottom:28, transform:'translateX(-50%)', zIndex:80, display:'flex', alignItems:'center', gap:10, background:'var(--navy)', color:'#fff', padding:'10px 12px 10px 14px', borderRadius:8, boxShadow:'0 10px 28px rgba(0,0,0,.2)', fontSize:12 }}>
          <span>{toast.message}</span>
          <button onClick={async () => { const undo = toast.undo; setToast(null); await undo() }} style={{border:'1px solid rgba(255,255,255,.35)',background:'transparent',color:'#fff',borderRadius:5,padding:'5px 8px',cursor:'pointer',fontSize:11}}>Undo</button>
          <button onClick={() => setToast(null)} style={{border:0,background:'transparent',color:'rgba(255,255,255,.75)',cursor:'pointer',fontSize:14}}>×</button>
        </div>
      )}
    </div>
  )
}

const primaryButton = { fontSize:12, background:'var(--acc-fill)', color:'#fff', border:0, borderRadius:6, padding:'8px 11px', cursor:'pointer', fontWeight:650 }
const secondaryButton = { fontSize:12, background:'var(--bg2)', color:'var(--tx1)', border:'1px solid var(--bds)', borderRadius:6, padding:'8px 11px', cursor:'pointer' }
