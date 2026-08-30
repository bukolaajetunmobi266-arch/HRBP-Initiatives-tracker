import pptxgen from 'pptxgenjs'

const NAVY = '1B2A3C'
const BLUE = '0F7FC4'
const GREEN = '2E9E75'
const AMBER = 'EF9F27'
const CORAL = 'D85A30'
const GREY = '5F5E5A'
const LIGHT = 'F1EFE8'

function metricBox(slide, x, y, w, label, value, color) {
  slide.addShape('roundRect', { x, y, w, h: 0.9, fill: { color: LIGHT }, line: { type: 'none' }, rectRadius: 0.06 })
  slide.addText(String(value), { x, y: y + 0.08, w, h: 0.5, fontSize: 20, bold: true, color, align: 'center' })
  slide.addText(label, { x, y: y + 0.58, w, h: 0.3, fontSize: 10, color: GREY, align: 'center' })
}

function localISODate(date) {
  const d = date || new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function statusCounts(items) {
  const c = { Completed: 0, 'In Progress': 0, 'Not Started': 0, Overdue: 0, total: items.length }
  const today = localISODate()
  items.forEach((it) => {
    const overdue = it.due_date && it.status !== 'Completed' && it.due_date < today
    if (overdue) c.Overdue++
    c[it.status] = (c[it.status] || 0) + 1
  })
  return c
}

function addTitleSlide(pres, title, subtitle, dateLabel) {
  const slide = pres.addSlide()
  slide.background = { color: NAVY }
  slide.addText(title, { x: 0.6, y: 2.2, w: 8.8, fontSize: 32, bold: true, color: 'FFFFFF' })
  slide.addText(subtitle, { x: 0.6, y: 3.0, w: 8.8, fontSize: 16, color: 'B7C2CC' })
  slide.addText(dateLabel, { x: 0.6, y: 3.5, w: 8.8, fontSize: 12, color: '8A94A0' })
}

function addSnapshotSlide(pres, heading, deliverables, actions) {
  const slide = pres.addSlide()
  slide.addText(heading, { x: 0.5, y: 0.35, w: 9, fontSize: 20, bold: true, color: NAVY })
  const dc = statusCounts(deliverables)
  const ac = statusCounts(actions)
  slide.addText('Deliverables', { x: 0.5, y: 1.0, fontSize: 13, bold: true, color: GREY })
  const dW = 1.75
  metricBox(slide, 0.5, 1.3, dW, 'Completed', `${dc.Completed} (${dc.total ? Math.round(dc.Completed / dc.total * 100) : 0}%)`, GREEN)
  metricBox(slide, 0.5 + dW + 0.15, 1.3, dW, 'In Progress', `${dc['In Progress']} (${dc.total ? Math.round(dc['In Progress'] / dc.total * 100) : 0}%)`, AMBER)
  metricBox(slide, 0.5 + (dW + 0.15) * 2, 1.3, dW, 'Yet to Start', `${dc['Not Started']} (${dc.total ? Math.round(dc['Not Started'] / dc.total * 100) : 0}%)`, GREY)
  metricBox(slide, 0.5 + (dW + 0.15) * 3, 1.3, dW, 'Overdue', `${dc.Overdue} (${dc.total ? Math.round(dc.Overdue / dc.total * 100) : 0}%)`, CORAL)
  metricBox(slide, 0.5 + (dW + 0.15) * 4, 1.3, dW, 'Total Deliverables', String(dc.total), BLUE)

  slide.addText('Action items', { x: 0.5, y: 2.5, fontSize: 13, bold: true, color: GREY })
  metricBox(slide, 0.5, 2.8, dW, 'Completed', `${ac.Completed} (${ac.total ? Math.round(ac.Completed / ac.total * 100) : 0}%)`, GREEN)
  metricBox(slide, 0.5 + dW + 0.15, 2.8, dW, 'In Progress', `${ac['In Progress']} (${ac.total ? Math.round(ac['In Progress'] / ac.total * 100) : 0}%)`, AMBER)
  metricBox(slide, 0.5 + (dW + 0.15) * 2, 2.8, dW, 'Yet to Start', `${ac['Not Started']} (${ac.total ? Math.round(ac['Not Started'] / ac.total * 100) : 0}%)`, GREY)
  metricBox(slide, 0.5 + (dW + 0.15) * 3, 2.8, dW, 'Overdue', `${ac.Overdue} (${ac.total ? Math.round(ac.Overdue / ac.total * 100) : 0}%)`, CORAL)
  metricBox(slide, 0.5 + (dW + 0.15) * 4, 2.8, dW, 'Total Action Items', String(ac.total), BLUE)
}

function addCompletionByHrbpSlide(pres, deliverables, profiles) {
  const slide = pres.addSlide()
  slide.addText('Completion by HRBP', { x: 0.5, y: 0.35, w: 9, fontSize: 20, bold: true, color: NAVY })
  const rows = [[{ text: 'HRBP', options: { bold: true, color: 'FFFFFF', fill: NAVY } }, { text: 'Completion', options: { bold: true, color: 'FFFFFF', fill: NAVY } }, { text: 'Total', options: { bold: true, color: 'FFFFFF', fill: NAVY } }]]
  profiles.filter((p) => p.role !== 'admin').forEach((p) => {
    const items = deliverables.filter((d) => d.owner_id === p.id)
    if (!items.length) return
    const done = items.filter((d) => d.status === 'Completed').length
    rows.push([p.full_name, `${Math.round(done / items.length * 100)}%`, String(items.length)])
  })
  slide.addTable(rows, { x: 0.5, y: 1.1, w: 9, fontSize: 12, border: { type: 'solid', color: 'E2E8F0' } })
}

function addOverdueSlide(pres, heading, deliverables, ownerName) {
  const slide = pres.addSlide()
  slide.addText(heading, { x: 0.5, y: 0.35, w: 9, fontSize: 20, bold: true, color: NAVY })
  const today = new Date()
  const overdue = deliverables.filter((d) => d.due_date && d.status !== 'Completed' && d.due_date < localISODate(today))
  if (!overdue.length) {
    slide.addText('Nothing overdue.', { x: 0.5, y: 1.2, fontSize: 14, color: GREY })
    return
  }
  const rows = [[{ text: 'Deliverable', options: { bold: true, color: 'FFFFFF', fill: CORAL } }, { text: 'Owner', options: { bold: true, color: 'FFFFFF', fill: CORAL } }, { text: 'Days overdue', options: { bold: true, color: 'FFFFFF', fill: CORAL } }]]
  overdue.forEach((d) => {
    const days = Math.floor((today - new Date(d.due_date)) / 86400000)
    rows.push([d.title, ownerName ? ownerName(d.owner_id) : '', String(days)])
  })
  slide.addTable(rows, { x: 0.5, y: 1.1, w: 9, fontSize: 11, border: { type: 'solid', color: 'E2E8F0' } })
}

function addKeyWinsSlide(pres, heading, deliverables, from, to, ownerName) {
  const slide = pres.addSlide()
  slide.addText(heading + ` (${from} to ${to})`, { x: 0.5, y: 0.35, w: 9, fontSize: 20, bold: true, color: NAVY })
  const wins = deliverables.filter((d) => d.status === 'Completed' && d.status_changed_date >= from && d.status_changed_date <= to)
  if (!wins.length) {
    slide.addText('No completions in this period.', { x: 0.5, y: 1.2, fontSize: 14, color: GREY })
    return
  }
  const rows = [[{ text: 'Deliverable', options: { bold: true, color: 'FFFFFF', fill: GREEN } }, { text: 'Owner', options: { bold: true, color: 'FFFFFF', fill: GREEN } }, { text: 'Completed', options: { bold: true, color: 'FFFFFF', fill: GREEN } }]]
  wins.forEach((d) => rows.push([d.title, ownerName ? ownerName(d.owner_id) : '', d.status_changed_date]))
  slide.addTable(rows, { x: 0.5, y: 1.1, w: 9, fontSize: 11, border: { type: 'solid', color: 'E2E8F0' } })
}

function addSharedActionsSlide(pres, actions, actionStatuses, profiles) {
  const shared = actions.filter((a) => a.shared)
  if (!shared.length) return
  const slide = pres.addSlide()
  slide.addText('Shared action items', { x: 0.5, y: 0.35, w: 9, fontSize: 20, bold: true, color: NAVY })
  let y = 1.1
  shared.forEach((a) => {
    slide.addText(a.title, { x: 0.5, y, w: 9, fontSize: 13, bold: true, color: NAVY })
    y += 0.35
    const statuses = actionStatuses.filter((s) => s.action_id === a.id)
    const line = statuses.map((s) => `${(profiles.find((p) => p.id === s.user_id) || {}).full_name || '?'}: ${s.status}`).join('   ·   ')
    slide.addText(line || 'No individual statuses recorded yet.', { x: 0.6, y, w: 8.5, fontSize: 11, color: GREY })
    y += 0.55
  })
}

export async function generateCpoReviewPack({ deliverables, actions, actionStatuses, profiles, ownerName, winsFrom, winsTo }) {
  const pres = new pptxgen()
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  addTitleSlide(pres, 'HR Business Partnering Update', 'Credit Direct — Bi-weekly CPO Review', today)
  addSnapshotSlide(pres, 'Overall snapshot', deliverables, actions)
  addCompletionByHrbpSlide(pres, deliverables, profiles)
  addOverdueSlide(pres, 'Overdue items', deliverables, ownerName)
  addKeyWinsSlide(pres, 'Key wins', deliverables, winsFrom, winsTo, ownerName)
  addSharedActionsSlide(pres, actions, actionStatuses, profiles)
  await pres.writeFile({ fileName: 'CPO_Review_Pack.pptx' })
}

export async function generatePersonalReviewPack({ name, deliverables, actions, actionStatuses, myUserId, winsFrom, winsTo }) {
  const pres = new pptxgen()
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  addTitleSlide(pres, `${name}'s Business & People Update`, 'Credit Direct HRBP Check-in', today)
  addSnapshotSlide(pres, 'My snapshot', deliverables, actions)
  addKeyWinsSlide(pres, 'My key wins', deliverables, winsFrom, winsTo, null)
  addOverdueSlide(pres, 'My overdue items', deliverables, null)
  const mine = actions.filter((a) => !a.shared || actionStatuses.some((s) => s.action_id === a.id && s.user_id === myUserId))
  const slide = pres.addSlide()
  slide.addText('My action items', { x: 0.5, y: 0.35, w: 9, fontSize: 20, bold: true, color: NAVY })
  const rows = [[{ text: 'Action', options: { bold: true, color: 'FFFFFF', fill: NAVY } }, { text: 'Status', options: { bold: true, color: 'FFFFFF', fill: NAVY } }]]
  mine.forEach((a) => {
    const myStatus = a.shared ? (actionStatuses.find((s) => s.action_id === a.id && s.user_id === myUserId) || {}).status : a.status
    rows.push([a.title, myStatus || 'Not Started'])
  })
  if (rows.length > 1) slide.addTable(rows, { x: 0.5, y: 1.1, w: 9, fontSize: 12, border: { type: 'solid', color: 'E2E8F0' } })
  else slide.addText('No action items.', { x: 0.5, y: 1.2, fontSize: 14, color: GREY })
  await pres.writeFile({ fileName: `${name.replace(/\s+/g, '_')}_Update.pptx` })
}
