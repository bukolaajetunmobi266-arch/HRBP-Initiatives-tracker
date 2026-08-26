import * as XLSX from 'xlsx'

function ownerName(profiles, id) {
  return profiles.find((p) => p.id === id)?.full_name || ''
}

// deliverables: already the filtered/visible set the caller wants exported
export function exportToExcel({ deliverables, keyActions, profiles, includeActions, filename }) {
  const wb = XLSX.utils.book_new()

  const initiativeRows = deliverables.map((d) => ({
    Division: d.division || '',
    'HRBP/Team Lead': ownerName(profiles, d.owner_id),
    'Corporate Objectives': d.corporate_objective || '',
    'PM Objectives': d.pm_objective || '',
    'Key Result': d.key_result || '',
    'Key Initiative & Action': d.title,
    'Start Date': '',
    'Due Date': d.due_date || '',
    'Revised Due Date': d.revised_due_date || '',
    Status: d.status,
    'Date Completed': d.date_completed || '',
    'Status Changed Date': d.status_changed_date || '',
    Comment: d.latestComment || '',
    'Next Steps': d.next_steps || '',
  }))
  const wsInit = XLSX.utils.json_to_sheet(initiativeRows)
  XLSX.utils.book_append_sheet(wb, wsInit, 'Initiatives')

  if (includeActions && keyActions?.length) {
    const actionRows = keyActions.map((a) => ({
      'Deliverable / Action': a.title,
      'Raised In': a.raised_in || '',
      Owner: ownerName(profiles, a.owner_id),
      'Due Date': a.due_date || '',
      Status: a.status,
      Comment: a.comment || '',
    }))
    const wsAct = XLSX.utils.json_to_sheet(actionRows)
    XLSX.utils.book_append_sheet(wb, wsAct, 'Key Action Log')
  }

  XLSX.writeFile(wb, filename || 'HRBP_Deliverables_Export.xlsx')
}
