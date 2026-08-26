import * as XLSX from 'xlsx'
import { OWNER_FUNCTIONS } from './constants'

const EXAMPLE_TITLE = 'Review Team Lead performance metrics alongside SA metrics'
const EXAMPLE_ACTION_TITLE = 'Escalate RPA IT access blocker'

function toISODate(val) {
  if (!val) return null
  if (val instanceof Date) return val.toISOString().slice(0, 10)
  const s = String(val).trim()
  if (!s) return null
  const d = new Date(s)
  if (isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

function matchOwner(name, profiles) {
  if (!name) return null
  const clean = String(name).trim().toLowerCase()
  return profiles.find((p) => p.full_name.trim().toLowerCase() === clean) || null
}

export function parseImportFile(arrayBuffer, profiles) {
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true })
  const result = { deliverables: [], deliverableErrors: [], actions: [], actionErrors: [] }

  if (wb.SheetNames.includes('Deliverables')) {
    const ws = wb.Sheets['Deliverables']
    const rows = XLSX.utils.sheet_to_json(ws, { range: 2, defval: '' }) // header row is row 3 (index 2)
    rows.forEach((row, i) => {
      const title = String(row['Deliverable Title'] || '').trim()
      if (!title || title === EXAMPLE_TITLE) return // skip blank / leftover example row
      const rowNum = i + 5 // data starts at sheet row 5
      const owner = matchOwner(row['Owner'], profiles)
      if (!owner) {
        result.deliverableErrors.push(`Row ${rowNum}: "${title}" — owner "${row['Owner']}" doesn't match any HRBP name. Row skipped.`)
        return
      }
      const dueDate = toISODate(row['Due Date'])
      const status = ['Not Started', 'In Progress', 'Completed'].includes(row['Status']) ? row['Status'] : 'Not Started'
      const division = String(row['Division'] || '').trim() || (OWNER_FUNCTIONS[owner.full_name] || [''])[0]
      result.deliverables.push({
        title,
        corporate_objective: String(row['Corporate Objective'] || '').trim(),
        pm_objective: String(row['PM Objective'] || '').trim(),
        key_result: String(row['Key Result'] || '').trim(),
        owner_id: owner.id,
        division,
        status,
        due_date: dueDate,
        _comment: String(row['Comment'] || '').trim(),
        next_steps: String(row['Next Steps'] || '').trim(),
      })
    })
  }

  if (wb.SheetNames.includes('Action Items')) {
    const ws = wb.Sheets['Action Items']
    const rows = XLSX.utils.sheet_to_json(ws, { range: 2, defval: '' })
    rows.forEach((row, i) => {
      const title = String(row['Deliverable / Action'] || '').trim()
      if (!title || title === EXAMPLE_ACTION_TITLE) return
      const rowNum = i + 5
      const owner = matchOwner(row['Owner'], profiles)
      if (!owner) {
        result.actionErrors.push(`Row ${rowNum}: "${title}" — owner "${row['Owner']}" doesn't match any HRBP name. Row skipped.`)
        return
      }
      const status = ['Not Started', 'In Progress', 'Completed'].includes(row['Status']) ? row['Status'] : 'Not Started'
      result.actions.push({
        title,
        raised_in: String(row['Raised In'] || '').trim(),
        owner_id: owner.id,
        due_date: toISODate(row['Due Date']),
        status,
        comment: String(row['Comment'] || '').trim(),
      })
    })
  }

  return result
}
