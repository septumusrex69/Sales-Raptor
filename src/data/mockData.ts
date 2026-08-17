import type {
  Activity,
  ActivityType,
  CalendarEvent,
  Company,
  Contact,
  CustomField,
  Deal,
  DealStage,
  ID,
  Lead,
  LeadClassification,
  LeadSource,
  LeadStatus,
  LossReason,
  ProductService,
  Proposal,
  Task,
  TaskPriority,
  TaskStatus,
  TaskType,
  Team,
  User,
} from '../types'

// ---------- Seeded RNG for stable "random" data across reloads ----------
function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(42)
const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)]
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min

const TODAY = new Date('2026-08-16T09:00:00')
function daysFromToday(offset: number, hour = 9, minute = 0) {
  const d = new Date(TODAY)
  d.setDate(d.getDate() + offset)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

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
/** Services offered for pick() weighting — excludes 'Other' so seeded leads mostly land on a real service. */
const pickableServices = services.filter((s) => s !== 'Other')

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

// ---------- Companies ----------
const companySeed: Array<[string, string, string]> = [
  ['ABC (Pty) Ltd', 'Construction', 'Gauteng'],
  ['Dlamini Attorneys', 'Legal', 'Gauteng'],
  ['Metro School', 'Education', 'Western Cape'],
  ['Greenleaf (Pty) Ltd', 'Property', 'Gauteng'],
  ['Bright Holdings', 'Construction', 'KwaZulu-Natal'],
  ['Tech Solutions SA', 'IT Services', 'Gauteng'],
  ['Alpha Retail (Pty) Ltd', 'Retail', 'Western Cape'],
  ['Coastal Manufacturing', 'Manufacturing', 'Eastern Cape'],
  ['Sunrise Hospitality Group', 'Hospitality', 'Western Cape'],
  ['Highveld Financial Services', 'Financial Services', 'Gauteng'],
  ['Karoo Health Partners', 'Healthcare', 'Free State'],
  ['Riverstone Logistics', 'Manufacturing', 'Mpumalanga'],
  ['Delta Property Group', 'Property', 'Gauteng'],
  ['Century IT Consulting', 'IT Services', 'Western Cape'],
]

export const companies: Company[] = companySeed.map(([name, industry, province], i) => ({
  id: `co${i + 1}`,
  name,
  industry,
  phone: `012 ${int(100, 999)} ${int(1000, 9999)}`,
  email: `info@${name.toLowerCase().replace(/[^a-z]+/g, '')}.co.za`,
  website: `www.${name.toLowerCase().replace(/[^a-z]+/g, '')}.co.za`,
  province,
  city: pick(['Johannesburg', 'Pretoria', 'Cape Town', 'Durban', 'Gqeberha', 'Bloemfontein']),
  address: `${int(1, 200)} Main Road`,
  accountOwnerId: pick(users.filter((u) => u.role !== 'Read Only')).id,
  createdAt: daysFromToday(-int(30, 400)),
}))

// ---------- Contacts ----------
const contactSeed: Array<[string, string, string]> = [
  ['John', 'Smith', 'co1'],
  ['Nomsa', 'Dlamini', 'co2'],
  ['Michael', 'Brown', 'co3'],
  ['Sarah', 'Johnson', 'co4'],
  ['David', 'Wilson', 'co5'],
  ['Thabo', 'Mokoena', 'co6'],
  ['Lisa', 'van der Merwe', 'co7'],
  ['James', 'Naidoo', 'co8'],
  ['Amanda', 'Peters', 'co9'],
  ['Sipho', 'Khumalo', 'co10'],
  ['Emma', 'Botha', 'co11'],
  ['Themba', 'Ngcobo', 'co12'],
  ['Chantelle', 'Adams', 'co13'],
  ['Werner', 'Kruger', 'co14'],
  ['Precious', 'Mahlangu', 'co1'],
]

export const contacts: Contact[] = contactSeed.map(([first, last, companyId], i) => ({
  id: `ct${i + 1}`,
  firstName: first,
  lastName: last,
  jobTitle: pick(['Owner', 'Procurement Manager', 'Operations Director', 'CEO', 'Office Manager', 'Financial Manager']),
  companyId,
  email: `${first.toLowerCase()}.${last.toLowerCase().replace(/[^a-z]/g, '')}@${companies.find((c) => c.id === companyId)?.name.toLowerCase().replace(/[^a-z]+/g, '')}.co.za`,
  phone: `012 ${int(100, 999)} ${int(1000, 9999)}`,
  mobile: `08${int(1, 9)} ${int(100, 999)} ${int(1000, 9999)}`,
  ownerId: pick(users.filter((u) => u.role.includes('Sales'))).id,
  lastContactAt: daysFromToday(-int(0, 20)),
  createdAt: daysFromToday(-int(30, 400)),
}))

// ---------- Leads ----------
const leadStatuses: LeadStatus[] = ['New', 'Attempting Contact', 'Contacted', 'Qualified', 'Unqualified', 'Proposal Required', 'Converted', 'Lost']
const leadFirstNames = ['John', 'Nomsa', 'Michael', 'Sarah', 'David', 'Thabo', 'Lisa', 'James', 'Amanda', 'Sipho', 'Emma', 'Themba', 'Chantelle', 'Werner', 'Precious', 'Karabo', 'Zanele', 'Riaan', 'Fatima', 'Andile', 'Cindy', 'Bongani', 'Melissa', 'Sizwe', 'Hannah', 'Kagiso', 'Tumi', 'Wayne', 'Noluthando', 'Christo']
const leadLastNames = ['Smith', 'Dlamini', 'Brown', 'Johnson', 'Wilson', 'Mokoena', 'van der Merwe', 'Naidoo', 'Peters', 'Khumalo', 'Botha', 'Ngcobo', 'Adams', 'Kruger', 'Mahlangu', 'Sithole', 'Coetzee', 'Pillay', 'Abrahams', 'Mnguni']
const otherServiceExamples = ['Custom compliance audit', 'Skip tracing for international debtor', 'Ad hoc legal consultation', 'Fleet recovery assistance']

/** Mostly 1 service, occasionally 2, rarely also/only 'Other' — mirrors how reps actually tag leads. */
function pickLeadServices(): ProductService[] {
  const result: ProductService[] = [pick(pickableServices)]
  if (rand() < 0.25) {
    const second = pick(pickableServices.filter((s) => s !== result[0]))
    result.push(second)
  }
  if (rand() < 0.08) result.push('Other')
  return result
}

export const leads: Lead[] = Array.from({ length: 110 }).map((_, i) => {
  const first = pick(leadFirstNames)
  const last = pick(leadLastNames)
  const company = pick(companies)
  const status = pick(leadStatuses)
  const created = -int(0, 240)
  const leadServices = pickLeadServices()
  const hasDebtCollection = leadServices.includes('Debt Collection')
  const hasOther = leadServices.includes('Other')
  return {
    id: `l${i + 1}`,
    firstName: first,
    lastName: last,
    jobTitle: pick(['Owner', 'Manager', 'Director', 'Buyer', 'Coordinator']),
    companyId: company.id,
    companyName: company.name,
    phone: `012 ${int(100, 999)} ${int(1000, 9999)}`,
    mobile: `08${int(1, 9)} ${int(100, 999)} ${int(1000, 9999)}`,
    email: `${first.toLowerCase()}.${last.toLowerCase().replace(/[^a-z]/g, '')}@${company.name.toLowerCase().replace(/[^a-z]+/g, '')}.co.za`,
    source: pick(leadSources),
    campaign: pick(['Winter Promo', 'Q3 Outreach', 'Referral Drive', undefined, undefined]),
    status,
    score: int(5, 98),
    estimatedValue: int(8, 180) * 1000,
    ownerId: pick(users.filter((u) => u.role.includes('Sales'))).id,
    industry: company.industry,
    country: 'South Africa',
    province: company.province,
    city: company.city,
    address: company.address,
    services: leadServices,
    otherServiceDetail: hasOther ? pick(otherServiceExamples) : undefined,
    classification: pick(leadClassifications),
    estimatedProjectValue: int(15, 450) * 1000,
    estimatedHandoverAmount: hasDebtCollection ? int(50, 1200) * 1000 : undefined,
    estimatedAccountsCount: hasDebtCollection ? int(5, 120) : undefined,
    notes: 'Initial enquiry captured, awaiting qualification.',
    lastContactAt: daysFromToday(-int(0, 45)),
    nextFollowUpAt: daysFromToday(int(-2, 10)),
    createdAt: daysFromToday(created),
    updatedAt: daysFromToday(created + int(0, 5)),
  }
})

// ---------- Deals ----------
const dealStages: DealStage[] = ['New Lead', 'Contacted', 'Qualified', 'Proposal Sent', 'Negotiation', 'Won', 'Lost']
const stageProbability: Record<DealStage, number> = {
  'New Lead': 10,
  Contacted: 20,
  Qualified: 40,
  'Proposal Sent': 55,
  Negotiation: 75,
  Won: 100,
  Lost: 0,
}

const dealNameSeed = [
  'Metro School Account', 'Greenleaf Property', 'Bright Holdings Rollout', 'Alpha Retail Refresh', 'Tech Solutions SA Contract',
  'ABC Construction Package', 'Dlamini Attorneys Retainer', 'Coastal Manufacturing Upgrade', 'Sunrise Hospitality Support',
  'Highveld Financial Onboarding', 'Karoo Health Systems', 'Riverstone Logistics Deal', 'Delta Property Expansion',
  'Century IT Partnership', 'ABC Phase 2', 'Greenleaf Maintenance', 'Bright Holdings Support Renewal', 'Tech Solutions Upsell',
  'Bright Holdings Debt Recovery Mandate', 'Tech Solutions SA Collections Contract', 'Alpha Retail Litigation Support',
  'Coastal Manufacturing Collections Package', 'Sunrise Hospitality New Mandate', 'Highveld Financial Tracing Engagement',
  'Karoo Health Credit Check Retainer', 'Riverstone Logistics Debt Recovery', 'Delta Property Executive Listing',
  'Century IT Contract Drafting', 'ABC Labour Law Engagement', 'Dlamini Attorneys Referral Partnership',
  'Metro School Collections Renewal', 'Greenleaf Litigation Mandate', 'Bright Holdings iCollect Rollout',
  'Tech Solutions SA Debt Recovery Phase 2', 'Alpha Retail Tracing Support', 'Coastal Manufacturing New Retainer',
  'Sunrise Hospitality Litigation Package', 'Highveld Financial Executive Search', 'Karoo Health Debt Collection Renewal',
  'Riverstone Logistics Contract Extension',
]

export const deals: Deal[] = dealNameSeed.map((name, i) => {
  const company = companies[i % companies.length]
  const stage = i < 8 ? dealStages[i % 5] : pick(dealStages)
  const created = -int(5, 240)
  const isWon = stage === 'Won'
  const isLost = stage === 'Lost'
  return {
    id: `d${i + 1}`,
    name,
    companyId: company.id,
    contactId: contacts.find((c) => c.companyId === company.id)?.id,
    ownerId: pick(users.filter((u) => u.role.includes('Sales'))).id,
    stage,
    value: int(15, 220) * 1000,
    probability: stageProbability[stage],
    expectedCloseDate: daysFromToday(int(-5, 45)),
    service: pick(services),
    source: pick(leadSources),
    competitor: pick([undefined, undefined, 'Competitor A', 'Competitor B']),
    notes: 'Deal progressing through pipeline.',
    lossReason: isLost ? pick(lossReasons) : undefined,
    createdAt: daysFromToday(created),
    wonAt: isWon ? daysFromToday(int(created + 5, 0)) : undefined,
    lostAt: isLost ? daysFromToday(int(created + 5, 0)) : undefined,
    nextActionAt: isWon || isLost ? undefined : daysFromToday(int(-1, 12)),
  }
})

// ---------- Tasks ----------
const taskTypes: TaskType[] = ['Call', 'Follow-up', 'Email', 'Proposal', 'Meeting', 'WhatsApp', 'Research', 'Internal task', 'Other']
const taskStatuses: TaskStatus[] = ['Not Started', 'In Progress', 'Completed', 'Cancelled']
const taskPriorities: TaskPriority[] = ['Low', 'Medium', 'High', 'Urgent']

export const tasks: Task[] = Array.from({ length: 90 }).map((_, i) => {
  const useDeal = rand() > 0.5
  const deal = useDeal ? pick(deals) : undefined
  const lead = !useDeal ? pick(leads) : undefined
  const dueOffset = int(-240, 12)
  const status: TaskStatus =
    dueOffset < -14
      ? pick(['Completed', 'Completed', 'Completed', 'Completed', 'Not Started', 'Cancelled'])
      : dueOffset < 0
        ? pick(['Completed', 'Not Started', 'Cancelled'])
        : pick(taskStatuses)
  return {
    id: `tk${i + 1}`,
    title: pick([
      'Follow up with client', 'Call back regarding proposal', 'Send proposal', 'Prepare quote', 'Check in on requirements',
      'Confirm meeting time', 'Send contract for signature', 'Discovery call', 'Renewal discussion', 'Introduce new service',
    ]) + (deal ? ` — ${companies.find((c) => c.id === deal.companyId)?.name}` : lead ? ` — ${lead.firstName} ${lead.lastName}` : ''),
    type: pick(taskTypes),
    status,
    priority: pick(taskPriorities),
    ownerId: pick(users.filter((u) => u.role.includes('Sales'))).id,
    dueDate: daysFromToday(dueOffset, int(8, 16), pick([0, 15, 30, 45])),
    dealId: deal?.id,
    leadId: lead?.id,
    companyId: deal ? deal.companyId : lead?.companyId,
    relatedToLabel: deal ? deal.name : lead ? `${lead.firstName} ${lead.lastName}` : undefined,
    createdAt: daysFromToday(dueOffset - int(1, 5)),
    completedAt: status === 'Completed' ? daysFromToday(dueOffset) : undefined,
  }
})

// ---------- Activities ----------
const activityTypes: ActivityType[] = ['Call', 'Email', 'WhatsApp', 'Meeting', 'Note', 'Proposal', 'Task', 'Status change', 'Deal update', 'Deal Stage Change', 'Deal Won', 'Deal Lost']
const activitySubjects: Record<ActivityType, string[]> = {
  Call: ['Call with {name}', 'Discovery call completed', 'Follow-up call'],
  Email: ['Email sent to {name}', 'Proposal emailed', 'Introduction email sent'],
  WhatsApp: ['WhatsApp message sent', 'WhatsApp follow-up'],
  Meeting: ['Meeting with {name}', 'Site visit scheduled', 'Meeting completed'],
  Note: ['Note added', 'Internal note logged'],
  Proposal: ['Proposal sent to {name}', 'Proposal drafted'],
  Task: ['Task created', 'Task completed'],
  'Status change': ['Lead status changed', 'Marked as Qualified'],
  'Deal update': ['Deal details updated'],
  'Deal Stage Change': ['Deal moved to Negotiation', 'Deal moved to Proposal Sent'],
  'Deal Won': ['Deal marked Won'],
  'Deal Lost': ['Deal marked Lost'],
}

export const activities: Activity[] = Array.from({ length: 260 }).map((_, i) => {
  const type = pick(activityTypes)
  const useLead = rand() > 0.5
  const lead = useLead ? pick(leads) : undefined
  const deal = !useLead ? pick(deals) : undefined
  const name = lead ? `${lead.firstName} ${lead.lastName}` : deal ? companies.find((c) => c.id === deal.companyId)?.name ?? '' : ''
  const subjectTemplate = pick(activitySubjects[type])
  const offset = -int(0, 240)
  return {
    id: `a${i + 1}`,
    type,
    userId: pick(users.filter((u) => u.role.includes('Sales') || u.role === 'Administrator')).id,
    leadId: lead?.id,
    companyId: lead?.companyId ?? deal?.companyId,
    dealId: deal?.id,
    subject: subjectTemplate.replace('{name}', name),
    notes: pick(['Client requested pricing.', 'Discussed requirements and timeline.', 'Left voicemail, will retry.', 'Positive response, moving forward.', undefined]),
    activityDate: daysFromToday(offset, int(8, 17), pick([0, 10, 20, 30, 40, 50])),
    createdAt: daysFromToday(offset),
  }
}).sort((a, b) => new Date(b.activityDate).getTime() - new Date(a.activityDate).getTime())

// ---------- Proposals ----------
export const proposals: Proposal[] = deals
  .filter((d) => ['Proposal Sent', 'Negotiation', 'Won', 'Lost'].includes(d.stage))
  .map((d, i) => ({
    id: `p${i + 1}`,
    dealId: d.id,
    companyId: d.companyId,
    contactId: d.contactId,
    service: d.service ?? pick(services),
    pricing: d.value,
    description: `Proposal for ${d.service ?? 'services'} covering agreed scope of work.`,
    terms: 'Net 30 days. Valid for 30 days from issue date.',
    validityDate: daysFromToday(int(5, 30)),
    status: d.stage === 'Won' ? 'Accepted' : d.stage === 'Lost' ? 'Declined' : pick(['Sent', 'Viewed', 'Draft']),
    createdAt: d.createdAt,
  }))

// ---------- Calendar Events ----------
export const calendarEvents: CalendarEvent[] = [
  ...tasks
    .filter((t) => t.status !== 'Cancelled')
    .map((t, i) => ({
      id: `ce-task-${i}`,
      title: t.title,
      type: (t.type === 'Meeting' ? 'Meeting' : t.type === 'Call' ? 'Call' : 'Follow-up') as CalendarEvent['type'],
      start: t.dueDate,
      end: t.dueDate,
      ownerId: t.ownerId,
      relatedToLabel: t.relatedToLabel,
    })),
  ...deals
    .filter((d) => d.stage !== 'Won' && d.stage !== 'Lost')
    .slice(0, 10)
    .map((d, i) => ({
      id: `ce-close-${i}`,
      title: `${d.name} — Expected Close`,
      type: 'Deal Close' as const,
      start: d.expectedCloseDate,
      end: d.expectedCloseDate,
      ownerId: d.ownerId,
      relatedToLabel: d.name,
    })),
]

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
