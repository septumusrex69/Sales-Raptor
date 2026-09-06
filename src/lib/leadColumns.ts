/** Single source of truth for the Leads table's toggleable columns (Columns menu + table renderer both read from this). */

export type ColumnKey =
  | 'leadNumber'
  | 'companyLead'
  | 'contactPerson'
  | 'status'
  | 'classification'
  | 'score'
  | 'services'
  | 'estValue'
  | 'handoverAmount'
  | 'owner'
  | 'nextFollowUp'
  | 'dateAdded'
  | 'lastContact'
  | 'source'
  | 'city'
  | 'province'
  | 'leadAge'
  | 'jobTitle'
  | 'phone'
  | 'email'

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  leadNumber: 'Lead #',
  companyLead: 'Company / Lead',
  contactPerson: 'Contact Person',
  status: 'Status',
  classification: 'Class',
  score: 'Score',
  services: 'Service(s)',
  estValue: 'Est. Value',
  handoverAmount: 'Handover Amount',
  owner: 'Owner',
  nextFollowUp: 'Next Follow-up',
  dateAdded: 'Date Added',
  lastContact: 'Last Contact',
  source: 'Source',
  city: 'City',
  province: 'Province',
  leadAge: 'Lead Age',
  jobTitle: 'Job Title',
  phone: 'Phone',
  email: 'Email',
}

/** Default column order per spec — everything here starts visible. */
export const DEFAULT_COLUMNS: ColumnKey[] = [
  // When a lead came in is the first thing anyone wants to know, so it opens the table and
  // stays pinned while you scroll — rather than sitting twelfth, off the right-hand edge.
  'dateAdded',
  'leadNumber',
  'companyLead',
  'contactPerson',
  'status',
  'classification',
  'score',
  'services',
  'estValue',
  'handoverAmount',
  'owner',
  'nextFollowUp',
  'lastContact',
  'source',
]

/** Extra columns available via the Columns menu — hidden by default. */
export const OPTIONAL_COLUMNS: ColumnKey[] = ['city', 'province', 'leadAge', 'jobTitle', 'phone', 'email']

export const ALL_COLUMNS: ColumnKey[] = [...DEFAULT_COLUMNS, ...OPTIONAL_COLUMNS]

export function defaultVisibleColumns(): Record<ColumnKey, boolean> {
  const visible = {} as Record<ColumnKey, boolean>
  for (const key of ALL_COLUMNS) visible[key] = DEFAULT_COLUMNS.includes(key)
  return visible
}

export type SortKey =
  | 'leadNumber'
  | 'companyLead'
  | 'status'
  | 'classification'
  | 'score'
  | 'estValue'
  | 'handoverAmount'
  | 'nextFollowUp'
  | 'dateAdded'
  | 'lastContact'
  | 'owner'
  | 'source'

export const SORTABLE_COLUMN_KEYS: Partial<Record<ColumnKey, SortKey>> = {
  leadNumber: 'leadNumber',
  companyLead: 'companyLead',
  status: 'status',
  classification: 'classification',
  score: 'score',
  estValue: 'estValue',
  handoverAmount: 'handoverAmount',
  nextFollowUp: 'nextFollowUp',
  dateAdded: 'dateAdded',
  lastContact: 'lastContact',
  owner: 'owner',
  source: 'source',
}
