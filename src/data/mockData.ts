import type {
  Activity,
  CalendarEvent,
  Company,
  Contact,
  CustomField,
  Deal,
  ID,
  Lead,
  LeadClassification,
  LeadSource,
  LossReason,
  ProductService,
  Proposal,
  Task,
  Team,
  User,
} from '../types'

/** The app's notion of "now" — was a fixed demo-data anchor date; real usage needs the real current time. */
const TODAY = new Date()

// ---------- Users & Teams ----------
export const users: User[] = [
  { id: 'u1', name: 'Stephan Ferreira', email: 'stephan@bredellferreira.co.za', role: 'Administrator', teamId: 't5', status: 'Active', phone: '082 123 4567', avatarColor: '#c9a227' },
  { id: 'u2', name: 'Rinda Marais', email: 'rinda@bredellferreira.co.za', role: 'Sales Manager', teamId: 't2', status: 'Active', phone: '082 234 5678', avatarColor: '#416281' },
  { id: 'u3', name: 'Nicole Loder', email: 'nicole@bredellferreira.co.za', role: 'Sales Representative', teamId: 't2', status: 'Active', phone: '082 345 6789', avatarColor: '#406d58' },
  { id: 'u4', name: 'Kea Mokoena', email: 'kea@bredellferreira.co.za', role: 'Sales Representative', teamId: 't3', status: 'Active', phone: '082 456 7890', avatarColor: '#ad6452' },
  { id: 'u5', name: 'Vusi Nkosi', email: 'vusi@bredellferreira.co.za', role: 'Sales Representative', teamId: 't4', status: 'Active', phone: '082 567 8901', avatarColor: '#2b4055' },
  { id: 'u6', name: 'Thandiwe Zulu', email: 'thandiwe@bredellferreira.co.za', role: 'Sales Representative', teamId: 't3', status: 'Active', phone: '082 678 9012', avatarColor: '#6086a9' },
  { id: 'u7', name: 'Pieter van Wyk', email: 'pieter@bredellferreira.co.za', role: 'Read Only', teamId: 't5', status: 'Inactive', phone: '082 789 0123', avatarColor: '#6b7280' },
]

export const teams: Team[] = [
  { id: 't1', name: 'New Business', memberIds: ['u3', 'u4'] },
  { id: 't2', name: 'Corporate Sales', memberIds: ['u2', 'u3'] },
  { id: 't3', name: 'SME Sales', memberIds: ['u4', 'u6'] },
  { id: 't4', name: 'Key Accounts', memberIds: ['u5'] },
  { id: 't5', name: 'Management', memberIds: ['u1', 'u7'] },
]

export const currentUser = users[0]

// ---------- Reference data ----------
export const leadSources: LeadSource[] = [
  'Website', 'Google Ads', 'Referral', 'LinkedIn', 'Facebook', 'Direct', 'Email', 'Existing Client', 'Sales Rep', 'Event', 'ChatGPT', 'Claude', 'Gemini', 'Other',
]

export const lossReasons: LossReason[] = [
  'Price', 'No budget', 'Competitor', 'No response', 'Project cancelled', 'Not decision-maker', 'Service not suitable', 'Timing', 'Duplicate', 'Other',
]

export const industries = ['Construction', 'Legal', 'Education', 'Property', 'IT Services', 'Retail', 'Manufacturing', 'Healthcare', 'Hospitality', 'Financial Services']
export const provinces = ['Gauteng', 'Western Cape', 'KwaZulu-Natal', 'Eastern Cape', 'Free State', 'Mpumalanga']
export const countries = ['South Africa']
export const leadClassifications: LeadClassification[] = ['A', 'B', 'C', 'D']

/** Canonical product/service list — shared by Lead.services (multi-select) and Deal.service. */
export const services: ProductService[] = [
  'Debt Collection',
  'Litigation',
  'Executive Listing',
  'iCollect',
  'Contract Drafting',
  'In-Person Debt Collection',
  'Credit Check',
  'Tracing',
  'NovaCall',
  'Labour Law',
  'Other',
]

export const customFields: CustomField[] = [
  { id: 'cf1', name: 'Lead Source', relatedTo: 'Leads', type: 'Dropdown', status: 'Active' },
  { id: 'cf2', name: 'Company Size', relatedTo: 'Companies', type: 'Dropdown', status: 'Active' },
  { id: 'cf3', name: 'Industry', relatedTo: 'Companies', type: 'Dropdown', status: 'Active' },
  { id: 'cf4', name: 'Deal Value', relatedTo: 'Deals', type: 'Currency', status: 'Active' },
  { id: 'cf5', name: 'Probability', relatedTo: 'Deals', type: 'Number', status: 'Active' },
  { id: 'cf6', name: 'Existing Client', relatedTo: 'Companies', type: 'Checkbox', status: 'Active' },
  { id: 'cf7', name: 'Contract Length', relatedTo: 'Deals', type: 'Text', status: 'Active' },
  { id: 'cf8', name: 'Competitor', relatedTo: 'Deals', type: 'Text', status: 'Active' },
]

// ---------- Business records — starts empty; populated by real usage from here on ----------
export const companies: Company[] = []
export const contacts: Contact[] = []
export const leads: Lead[] = []
export const deals: Deal[] = []
export const tasks: Task[] = []
export const activities: Activity[] = []
export const proposals: Proposal[] = []
export const calendarEvents: CalendarEvent[] = []

// ---------- Helpers ----------
export const userById = (id?: ID) => users.find((u) => u.id === id)
export const companyById = (id?: ID) => companies.find((c) => c.id === id)
export const contactById = (id?: ID) => contacts.find((c) => c.id === id)
export const dealById = (id?: ID) => deals.find((d) => d.id === id)
export const leadById = (id?: ID) => leads.find((l) => l.id === id)

export function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(value)
}

export function formatDate(iso?: string) {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso))
}

export function formatLeadNumber(n: number) {
  return `SR-${String(n).padStart(5, '0')}`
}

/** Day-grained relative label for Last Contact ("Today"/"Yesterday"/"N days ago") — distinct from timeAgo's minute/hour granularity used in activity feeds. */
export function daysAgoLabel(iso?: string) {
  if (!iso) return undefined
  const diffDays = Math.floor((TODAY.getTime() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays <= 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return `${diffDays} days ago`
}

export function formatDateTime(iso?: string) {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

export function timeAgo(iso: string) {
  const diffMs = TODAY.getTime() - new Date(iso).getTime()
  const diffMins = Math.round(diffMs / 60000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHrs = Math.round(diffMins / 60)
  if (diffHrs < 24) return `${diffHrs}h ago`
  const diffDays = Math.round(diffHrs / 24)
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return formatDate(iso)
}

export { TODAY }
