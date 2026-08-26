export const OWNER_FUNCTIONS = {
  'Iveren Igba': ['Finance', 'Federal Business', 'Exec. Office - Financial Inclusion', 'Exec. Office - Brand, Marketing & Corp. Comm.', 'Exec. Office - Strategy', 'Exec. Office - Digital Transformation'],
  'Busayo Onasanya': ['State Business', 'ERM', 'Internal Audit and Compliance'],
  'Motolani Afolayan': ['DPL', 'CX and Operations', 'PM & Admin'],
  'Oladunni Cole': ['Paramilitary & Education Business', 'Enterprise Project Management', 'Enterprise Product Management', 'Technology', 'Infrastructure & Information'],
}

export const DIVISIONS = Object.values(OWNER_FUNCTIONS).flat()
export const STATUSES = ['Not Started', 'In Progress', 'Completed']
export const CO_COLORS = ['#0F7FC4', '#2E6B8A', '#D85A30', '#7C5CBF', '#1D9E75', '#993C1D']

export const STATUS_COLOR = {
  Completed: { bg: 'bg-emerald-100', text: 'text-emerald-800' },
  'In Progress': { bg: 'bg-amber-100', text: 'text-amber-800' },
  'Not Started': { bg: 'bg-gray-100', text: 'text-gray-700' },
  Overdue: { bg: 'bg-red-100', text: 'text-red-800' },
}
