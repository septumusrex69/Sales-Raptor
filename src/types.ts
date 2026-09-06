export type ID = string

export type LeadStatus =
  | 'No Contact Yet'
  | 'Interested'
  | 'Hot Lead'
  | 'Converted'
  | 'Rejected'

/**
 * Why a lead or a deal ended without being signed. One vocabulary for both, so "why did we
 * lose it" is answered the same way whichever record you're looking at. 'We declined them'
 * is deliberately its own reason: a book turned down on our side isn't a loss, and lumping
 * it in with the rest would make a deliberately selective month read as a bad one.
 */
export type RejectionReason =
  | 'Not interested anymore'
  | 'Too expensive'
  | 'Went with another provider'
  | 'No response'
  | 'We declined them'
  | 'Other'

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

/** One selected service's own estimated value, so a lead interested in several services doesn't blend them into one number. */
export interface LeadServiceValue {
  service: ProductService
  /** Standard services */
  value?: number
  /** Debt Collection only — combined outstanding balance of accounts being handed over */
  handoverAmount?: number
  /** Debt Collection only — number of accounts/matters in the handover */
  accountsCount?: number
}

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
  /** Per-service value breakdown when multiple services are selected. estimatedProjectValue/estimatedHandoverAmount/estimatedAccountsCount are derived sums of this, kept for backward-compat reads (LeadsList, Reports). Undefined on leads created before this existed. */
  serviceValues?: LeadServiceValue[]
  notes?: string
  lastContactAt?: string
  nextFollowUpAt?: string
  createdAt: string
  updatedAt: string
  convertedDealId?: ID
  /** Set when status is 'Rejected'. */
  rejectionReason?: RejectionReason
  /** Free-text detail captured alongside the rejection reason. */
  rejectionNote?: string
}

/**
 * A deal moves through the same three steps wherever it was raised — off a lead or off an
 * existing client — then ends Won or Rejected. Anything finer than this was stages nobody
 * moved a deal into.
 */
export type DealStage = 'New Deal' | 'Quotation Sent' | 'Invoice Sent' | 'Won' | 'Rejected'

export const DEAL_STAGES: DealStage[] = ['New Deal', 'Quotation Sent', 'Invoice Sent', 'Won', 'Rejected']

/** The steps a deal is still being worked in — everything before it ends one way or the other. */
export const OPEN_DEAL_STAGES: DealStage[] = ['New Deal', 'Quotation Sent', 'Invoice Sent']

/**
 * How likely a deal at each step is to close, used for the weighted forecast. Derived from the
 * stage rather than typed in per deal — nobody keeps a hand-entered percentage honest, and a
 * quote that's out is genuinely further along than one that isn't.
 */
export const DEAL_STAGE_PROBABILITY: Record<DealStage, number> = {
  'New Deal': 20,
  'Quotation Sent': 50,
  'Invoice Sent': 80,
  Won: 100,
  Rejected: 0,
}

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
  /** Set when stage is 'Rejected'. */
  rejectionReason?: RejectionReason
  /** Free-text detail captured alongside the rejection reason. */
  rejectionNote?: string
  createdAt: string
  wonAt?: string
  rejectedAt?: string
  nextActionAt?: string
  leadId?: ID
  /** Handover-type deals only (e.g. Debt Collection) — the outstanding balance being handed over, distinct from `value` (the contract/project value). */
  handoverAmount?: number
  /** Handover-type deals only — number of accounts/matters included in the handover. */
  accountsCount?: number
  /** Date the client is expected to begin handing over accounts / service commencement date, captured when marking the deal Won. */
  contractStartDate?: string
}

export interface Contact {
  id: ID
  firstName: string
  lastName: string
  jobTitle?: string
  companyId?: ID
  /** Set for a contact person captured against a lead, before there's a company to attach them to. */
  leadId?: ID
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
  /** Groups this Company as a sub-account under another Company (e.g. "Bonitas" under "Marara Pharmacy"). Undefined for a standalone client or a parent itself. */
  parentCompanyId?: ID
  /** Short reference code — either the real Swordfish client prefix (e.g. "MPY"), or an internal-only code we invent for a parent that has no Swordfish code of its own (e.g. "MARARA"). */
  code?: string
  /** Debt-collection servicing totals, synced from Swordfish per sub-account. A parent with children has no totals of its own — sum its children instead. */
  accountCount?: number
  handoverAmount?: number
  paymentsToDate?: number
  /** Name of the closer who originally signed this client (Swordfish's "Marketing Agent"), where known. */
  marketingAgent?: string
  /** Swordfish's client classification (A/B/C/D), where known. Set at the level a Swordfish code actually exists — a parent container invented by us has none of its own. */
  classification?: LeadClassification
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
  | 'Deal Rejected'
  | 'Courtesy Call'
  | 'Handover Received'

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
  /** Only meaningful for type 'Email': false until a freshly-synced incoming email has been opened. */
  isRead?: boolean
  /** File names of attachments on a synced incoming email. The files themselves stay in the mailbox. */
  attachmentNames?: string[]
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

export type UserRole = 'Administrator' | 'Sales Manager' | 'Sales Representative' | 'Liaison Manager' | 'Liaison' | 'Read Only'

export interface User {
  id: ID
  name: string
  email: string
  role: UserRole
  teamId?: ID
  status: 'Active' | 'Inactive'
  phone?: string
  avatarColor: string
  /** Appended under the body of any email sent from Romulus via this person's connected inbox. */
  emailSignature?: string
  /** Optional signature image (e.g. a scanned signature or logo), stored in the 'email-signatures' bucket. */
  emailSignatureImageUrl?: string
  emailSignatureImageWidth?: number
  emailSignatureImageAlign?: 'left' | 'center' | 'right'
}

export type TeamKind = 'Sales' | 'Communications'

export interface Team {
  id: ID
  name: string
  memberIds: ID[]
  kind: TeamKind
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
  | 'Email received'

export interface AppNotification {
  id: ID
  type: NotificationType
  message: string
  createdAt: string
  read: boolean
  /** App-relative path to open when clicked, e.g. "/companies/<id>". */
  link?: string
}
