export type ID = string

export type LeadStatus =
  | 'New'
  | 'Attempting Contact'
  | 'Contacted'
  | 'Qualified'
  | 'Unqualified'
  | 'Proposal Required'
  | 'Converted'
  | 'Lost'

export type LeadSource =
  | 'Website'
  | 'Google Ads'
  | 'Referral'
  | 'LinkedIn'
  | 'Facebook'
  | 'Direct'
  | 'Email'
  | 'Existing Client'
  | 'Sales Rep'
  | 'Event'
  | 'ChatGPT'
  | 'Claude'
  | 'Gemini'
  | 'Other'

export type LeadCategory = 'Cold' | 'Warm' | 'Hot' | 'Priority'

export type LeadClassification = 'A' | 'B' | 'C' | 'D'

export type ProductService =
  | 'Debt Collection'
  | 'Litigation'
  | 'Executive Listing'
  | 'iCollect'
  | 'Contract Drafting'
  | 'In-Person Debt Collection'
  | 'Credit Check'
  | 'Tracing'
  | 'NovaCall'
  | 'Labour Law'
  | 'Other'

export interface Lead {
  id: ID
  /** Permanent, sequential, never-reused display number (formatted via formatLeadNumber → "SR-00001"). */
  leadNumber: number
  firstName: string
  lastName: string
  jobTitle?: string
  companyId?: ID
  companyName: string
  phone?: string
  mobile?: string
  email?: string
  website?: string
  source: LeadSource
  campaign?: string
  status: LeadStatus
  score: number
  estimatedValue: number
  ownerId: ID
  industry?: string
  country?: string
  province?: string
  city?: string
  address?: string
  /** @deprecated superseded by `services` (multi-select); kept so existing records still read fine */
  serviceInterested?: string
  services?: ProductService[]
  /** Free-text detail when 'Other' is among `services` */
  otherServiceDetail?: string
  classification?: LeadClassification
  /** General opportunity value; label adapts per selected service (see LeadOpportunityFields) */
  estimatedProjectValue?: number
  /** Debt Collection specific — combined outstanding balance of accounts being handed over */
  estimatedHandoverAmount?: number
  /** Debt Collection specific — number of accounts/matters in the handover */
  estimatedAccountsCount?: number
  notes?: string
  lastContactAt?: string
  nextFollowUpAt?: string
  createdAt: string
  updatedAt: string
  convertedDealId?: ID
}

export type DealStage =
  | 'New Lead'
  | 'Contacted'
  | 'Qualified'
  | 'Proposal Sent'
  | 'Negotiation'
  | 'Won'
  | 'Lost'

export const DEAL_STAGES: DealStage[] = [
  'New Lead',
  'Contacted',
  'Qualified',
  'Proposal Sent',
  'Negotiation',
  'Won',
  'Lost',
]

export type LossReason =
  | 'Price'
  | 'No budget'
  | 'Competitor'
  | 'No response'
  | 'Project cancelled'
  | 'Not decision-maker'
  | 'Service not suitable'
  | 'Timing'
  | 'Duplicate'
  | 'Other'

export interface Deal {
  id: ID
  name: string
  companyId: ID
  contactId?: ID
  ownerId: ID
  stage: DealStage
  value: number
  probability: number
  expectedCloseDate: string
  service?: string
  source: LeadSource
  competitor?: string
  notes?: string
  lossReason?: LossReason
  createdAt: string
  wonAt?: string
  lostAt?: string
  nextActionAt?: string
  leadId?: ID
}

export interface Contact {
  id: ID
  firstName: string
  lastName: string
  jobTitle?: string
  companyId?: ID
  email?: string
  phone?: string
  mobile?: string
  ownerId: ID
  lastContactAt?: string
  createdAt: string
  notes?: string
}

export interface Company {
  id: ID
  name: string
  industry?: string
  phone?: string
  email?: string
  website?: string
  province?: string
  city?: string
  address?: string
  accountOwnerId: ID
  createdAt: string
}

export type TaskType =
  | 'Call'
  | 'Follow-up'
  | 'Email'
  | 'Proposal'
  | 'Meeting'
  | 'WhatsApp'
  | 'Research'
  | 'Internal task'
  | 'Other'

export type TaskStatus = 'Not Started' | 'In Progress' | 'Completed' | 'Cancelled'
export type TaskPriority = 'Low' | 'Medium' | 'High' | 'Urgent'

export interface Task {
  id: ID
  title: string
  type: TaskType
  status: TaskStatus
  priority: TaskPriority
  ownerId: ID
  dueDate: string
  leadId?: ID
  dealId?: ID
  contactId?: ID
  companyId?: ID
  relatedToLabel?: string
  createdAt: string
  completedAt?: string
  /** Set when this task's due date was auto-rolled forward because it was missed; cleared once completed. */
  autoRescheduledFrom?: string
}

export type ActivityType =
  | 'Call'
  | 'Email'
  | 'WhatsApp'
  | 'Meeting'
  | 'Note'
  | 'Proposal'
  | 'Task'
  | 'Status change'
  | 'Deal update'
  | 'Deal Stage Change'
  | 'Deal Won'
  | 'Deal Lost'

export interface Activity {
  id: ID
  type: ActivityType
  userId: ID
  leadId?: ID
  contactId?: ID
  companyId?: ID
  dealId?: ID
  subject: string
  notes?: string
  activityDate: string
  createdAt: string
}

export type ProposalStatus = 'Draft' | 'Sent' | 'Viewed' | 'Accepted' | 'Declined' | 'Expired'

export interface Proposal {
  id: ID
  dealId: ID
  companyId: ID
  contactId?: ID
  service: string
  pricing: number
  description?: string
  terms?: string
  validityDate: string
  status: ProposalStatus
  createdAt: string
}

export type UserRole = 'Administrator' | 'Sales Manager' | 'Sales Representative' | 'Read Only'

export interface User {
  id: ID
  name: string
  email: string
  role: UserRole
  teamId?: ID
  status: 'Active' | 'Inactive'
  phone?: string
  avatarColor: string
}

export interface Team {
  id: ID
  name: string
  memberIds: ID[]
}

export type CustomFieldType =
  | 'Text'
  | 'Number'
  | 'Currency'
  | 'Date'
  | 'Dropdown'
  | 'Multi-select'
  | 'Checkbox'
  | 'URL'
  | 'Email'
  | 'Phone'

export interface CustomField {
  id: ID
  name: string
  relatedTo: 'Leads' | 'Deals' | 'Contacts' | 'Companies'
  type: CustomFieldType
  status: 'Active' | 'Inactive'
}

export interface CalendarEvent {
  id: ID
  title: string
  type: 'Call' | 'Meeting' | 'Follow-up' | 'Proposal Deadline' | 'Deal Close' | 'Task'
  start: string
  end: string
  ownerId: ID
  relatedToLabel?: string
  color?: string
}

export type NotificationType =
  | 'New lead assigned'
  | 'Task due'
  | 'Task overdue'
  | 'Meeting starting'
  | 'Proposal viewed'
  | 'Proposal accepted'
  | 'Deal inactive'
  | 'Deal moved'
  | 'Deal won'
  | 'Lead reassigned'

export interface AppNotification {
  id: ID
  type: NotificationType
  message: string
  createdAt: string
  read: boolean
}
