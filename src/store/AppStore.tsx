import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import { TODAY } from '../data/mockData'
import { DEAL_STAGE_PROBABILITY } from '../types'
import { normalizeDeal, normalizeLead } from '../lib/legacyValues'
import { dealKind, kindForService } from '../lib/dealKind'
import type { Activity, ActivityType, AppNotification, Company, Contact, Deal, DealStage, ID, Lead, ProductService, Proposal, RejectionReason, Task, TaskType, Team, TeamKind, User } from '../types'

/**
 * Generic camelCase(app) <-> snake_case(Postgres) row mapping. The SQL
 * schema (supabase/schema.sql) deliberately names every column as the
 * exact snake_case transform of its types.ts field name, so one pair of
 * generic converters covers every entity — no per-table boilerplate.
 * `null` (DB) <-> `undefined` (TS optional fields) on the way in;
 * `undefined` (an explicit "clear this field") <-> `null` on the way out.
 */
function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)
}
function snakeToCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
}
function rowToApp<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) out[snakeToCamel(key)] = value === null ? undefined : value
  return out as T
}
function appToRow<T extends object>(patch: T): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) out[camelToSnake(key)] = value === undefined ? null : value
  return out
}

async function fetchTable<T>(table: string, orderBy: string): Promise<T[]> {
  const { data, error } = await supabase.from(table).select('*').order(orderBy, { ascending: false })
  if (error) {
    console.error(`[AppStore] failed to load ${table}:`, error.message)
    return []
  }
  return (data ?? []).map((row) => rowToApp<T>(row as Record<string, unknown>))
}

function reportError(action: string, message: string) {
  console.error(`[AppStore] ${action} failed:`, message)
}

/** Turns raw Postgrest/RLS errors into something worth showing a user. */
function friendlyError(message: string): string {
  if (message.includes('row-level security') || message.includes('JSON object requested')) {
    return "You don't have permission to do that."
  }
  return message
}

async function insertRow<T extends object>(table: string, row: T, action: string, onError?: (message: string) => void): Promise<string | null> {
  const { error } = await supabase.from(table).insert(appToRow(row))
  if (error) {
    reportError(action, error.message)
    onError?.(error.message)
    return error.message
  }
  return null
}
// RLS policies restrict UPDATE/DELETE via their `using` clause, and when a
// row is excluded that way Postgrest just reports "0 rows changed" — not an
// error. Chaining .select().single() forces an error when nothing matched
// (0 rows changed and 0 rows returned), which is how a permission-denied
// write actually gets surfaced back to the caller.
function updateRow<T extends object>(table: string, id: ID, patch: T, action: string, onError?: (message: string) => void) {
  supabase
    .from(table)
    .update(appToRow(patch))
    .eq('id', id)
    .select('id')
    .single()
    .then(({ error }) => {
      if (error) {
        reportError(action, error.message)
        onError?.(error.message)
      }
    })
}
function deleteRow(table: string, id: ID, action: string, onError?: (message: string) => void) {
  supabase
    .from(table)
    .delete()
    .eq('id', id)
    .select('id')
    .single()
    .then(({ error }) => {
      if (error) {
        reportError(action, error.message)
        onError?.(error.message)
      }
    })
}

/**
 * A completed task is logged as the kind of thing it actually was, so a meeting that happened
 * reads as a Meeting on the client's file — with the meeting colour — rather than as generic
 * admin. The types that don't describe a client interaction fall back to Task.
 */
function taskCompletionActivityType(taskType: TaskType): ActivityType {
  switch (taskType) {
    case 'Call':
    case 'Email':
    case 'Meeting':
    case 'WhatsApp':
    case 'Proposal':
      return taskType
    default:
      return 'Task'
  }
}

function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

/**
 * There's no server-side cron in this app to run a real daily rollover, so
 * this simulates "missed tasks automatically move to the next day" once
 * per load: any open task whose due date has already passed gets moved to
 * today (same time-of-day) and persisted. The original due date is kept
 * on `autoRescheduledFrom` so the UI can show it was missed. Tasks already
 * carrying `autoRescheduledFrom` are skipped, which also makes this
 * safely idempotent if two people's sessions both load around the same
 * time.
 */
function rollOverMissedTasks(tasks: Task[]): Task[] {
  const todayStart = startOfDay(TODAY)
  return tasks.map((t) => {
    if (t.status === 'Completed' || t.status === 'Cancelled') return t
    if (t.autoRescheduledFrom) return t
    if (new Date(t.dueDate) >= todayStart) return t
    const newDue = new Date(t.dueDate)
    newDue.setFullYear(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate())
    const updated: Task = { ...t, dueDate: newDue.toISOString(), autoRescheduledFrom: t.dueDate }
    updateRow('tasks', t.id, { dueDate: updated.dueDate, autoRescheduledFrom: updated.autoRescheduledFrom }, 'taskRollover')
    return updated
  })
}

interface AppState {
  leads: Lead[]
  deals: Deal[]
  contacts: Contact[]
  companies: Company[]
  tasks: Task[]
  activities: Activity[]
  proposals: Proposal[]
  users: User[]
  teams: Team[]
  notifications: AppNotification[]
  dataLoading: boolean
  /** Message from the most recent failed write (e.g. permission denied). Null when nothing to show. */
  toast: string | null
}

export interface WonDealDetails {
  /** Zero for a Handover: nothing is earned at signature, so there is no value to record. */
  finalValue: number
  startDate: string
  service: string
  contractDuration: string
  /** Handover-type services only (e.g. Debt Collection) — outstanding balance being handed over, distinct from finalValue. */
  handoverAmount?: number
  /** Handover-type services only — number of accounts/matters in the handover. */
  accountsCount?: number
}

/**
 * One deal being confirmed as part of converting a lead. `dealId` is set when the rep already
 * created the deal on the lead; without it the deal is created from the service the lead was
 * interested in.
 */
export interface ConvertDealConfirmation {
  dealId?: ID
  name: string
  service?: string
  value: number
  /** Debt Collection only — outstanding balance being handed over. */
  handoverAmount?: number
  /** Debt Collection only — number of accounts/matters in the handover. */
  accountsCount?: number
}

export interface ConvertConfirmation {
  /** Service commencement date, applied to every deal confirmed in this conversion. */
  startDate: string
  deals: ConvertDealConfirmation[]
}

interface AppActions {
  addLead: (input: Partial<Lead> & { firstName: string; lastName: string; companyName: string }) => Lead
  updateLead: (id: ID, patch: Partial<Lead>) => void
  /**
   * Turns a won lead into a real client: creates the Company (if there isn't one yet), carries
   * its contact people across, and opens a Deal per service so the handover can be tracked.
   * The lead itself stays on file as 'Converted' rather than disappearing.
   */
  convertLeadToClient: (leadId: ID, confirm: ConvertConfirmation) => { companyId: ID; deal?: Deal } | undefined
  /**
   * Opens a deal against a lead, before there's a client. A lead saying "I'm interested in
   * Executive Listing" is a real opportunity worth tracking from that moment, not only once
   * they sign — so the deal is created now and confirmed at conversion.
   */
  addLeadDeal: (leadId: ID, input: { name: string; value: number; service: ProductService; expectedCloseDate: string }) => Deal | undefined
  rejectLead: (leadId: ID, reason: RejectionReason, note?: string) => void
  deleteLead: (leadId: ID) => void

  addDeal: (input: Partial<Deal> & { name: string; companyId: ID }) => Deal
  updateDeal: (id: ID, patch: Partial<Deal>) => void
  moveDealStage: (id: ID, stage: DealStage) => void
  markDealWon: (id: ID, details: WonDealDetails) => void
  markDealRejected: (id: ID, reason: RejectionReason, note?: string) => void
  /**
   * Records that a document went out. Kept as dates on the deal rather than pipeline stages,
   * because a single deal can need both a quotation and a mandate — which one stage can't say.
   */
  logDealDocument: (id: ID, document: 'quotation' | 'mandate' | 'invoice') => void

  addContact: (input: Partial<Contact> & { firstName: string; lastName: string }) => Contact
  updateContact: (id: ID, patch: Partial<Contact>) => void
  addCompany: (input: Partial<Company> & { name: string }) => Company
  updateCompany: (id: ID, patch: Partial<Company>) => void
  deleteCompany: (id: ID) => void
  addTask: (input: Partial<Task> & { title: string; dueDate: string }) => Task
  updateTask: (id: ID, patch: Partial<Task>) => void
  addActivity: (input: Partial<Activity> & { type: ActivityType; subject: string }) => Activity
  updateActivity: (id: ID, patch: Partial<Activity>) => void
  markNotificationRead: (id: ID) => void
  markAllNotificationsRead: () => void
  /** Re-reads activities + notifications after server-side email sync has written to them. */
  refreshSyncedData: () => Promise<void>

  addProposal: (input: Partial<Proposal> & { dealId: ID; companyId: ID; service: string; pricing: number }) => Proposal
  updateProposal: (id: ID, patch: Partial<Proposal>) => void

  updateUser: (id: ID, patch: Partial<User>) => void
  /** Drops a user from local state after the server has actually deleted their account (via /api/delete-user) -- there's no client-side delete of auth.users, so this just syncs the UI. */
  removeUserLocal: (id: ID) => void
  addTeam: (input: Partial<Team> & { name: string }) => Team
  updateTeam: (id: ID, patch: Partial<Pick<Team, 'name' | 'kind'>>) => void
  deleteTeam: (id: ID) => void

  dismissToast: () => void

  companyById: (id?: ID) => Company | undefined
  contactById: (id?: ID) => Contact | undefined
  dealById: (id?: ID) => Deal | undefined
  leadById: (id?: ID) => Lead | undefined
  userById: (id?: ID) => User | undefined
}

const AppContext = createContext<(AppState & AppActions) | null>(null)



export function AppStoreProvider({ children }: { children: ReactNode }) {
  const { session, currentUser: authUser } = useAuth()

  const [leads, setLeads] = useState<Lead[]>([])
  const [deals, setDeals] = useState<Deal[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [teamRows, setTeamRows] = useState<{ id: ID; name: string; kind: TeamKind }[]>([])
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(timer)
  }, [toast])

  const showError = useCallback((message: string) => setToast(friendlyError(message)), [])
  const dismissToast = useCallback(() => setToast(null), [])

  useEffect(() => {
    if (!session) {
      setLeads([])
      setDeals([])
      setContacts([])
      setCompanies([])
      setTasks([])
      setActivities([])
      setProposals([])
      setUsers([])
      setTeamRows([])
      setNotifications([])
      setDataLoading(false)
      return
    }
    let active = true
    setDataLoading(true)
    Promise.all([
      fetchTable<Lead>('leads', 'created_at'),
      fetchTable<Deal>('deals', 'created_at'),
      fetchTable<Contact>('contacts', 'created_at'),
      fetchTable<Company>('companies', 'created_at'),
      fetchTable<Task>('tasks', 'created_at'),
      fetchTable<Activity>('activities', 'activity_date'),
      fetchTable<Proposal>('proposals', 'created_at'),
      fetchTable<User>('profiles', 'created_at'),
      fetchTable<{ id: ID; name: string; kind: TeamKind }>('teams', 'created_at'),
      fetchTable<AppNotification>('notifications', 'created_at'),
    ])
      .then(([l, d, ct, co, tk, ac, pr, us, tm, nt]) => {
        if (!active) return
        // A row still carrying a retired stage or status would render in no column at all —
        // not last, gone — so map anything stale onto the current vocabulary on the way in.
        setLeads(l.map(normalizeLead))
        setDeals(d.map(normalizeDeal))
        setContacts(ct)
        setCompanies(co)
        setTasks(rollOverMissedTasks(tk))
        setActivities(ac)
        setProposals(pr)
        setUsers(us)
        setTeamRows(tm)
        setNotifications(nt)
        setDataLoading(false)
      })
      .catch((err: unknown) => {
        if (!active) return
        // A single table throwing (vs. returning a Postgrest error field, which
        // fetchTable already swallows) would otherwise silently abort this
        // Promise.all and leave every entity stuck at its empty initial state
        // with no indication anything went wrong — surface it instead.
        const message = err instanceof Error ? err.message : String(err)
        console.error('[AppStore] initial data load failed:', message)
        showError(`Failed to load your data: ${message}`)
        setDataLoading(false)
      })
    return () => {
      active = false
    }
  }, [session])

  /**
   * Re-reads the tables that server-side code (not this browser) writes to.
   * Email sync runs entirely on the server, so a freshly-logged incoming email
   * and its notification exist in the database but not in this session's state
   * until something re-fetches — previously only a full page reload did, which
   * is why a synced email wouldn't appear on the client until you refreshed.
   */
  const refreshSyncedData = useCallback<AppActions['refreshSyncedData']>(async () => {
    const [ac, nt] = await Promise.all([fetchTable<Activity>('activities', 'activity_date'), fetchTable<AppNotification>('notifications', 'created_at')])
    setActivities(ac)
    setNotifications(nt)
  }, [])

  const teams = useMemo<Team[]>(
    () => teamRows.map((t) => ({ id: t.id, name: t.name, kind: t.kind, memberIds: users.filter((u) => u.teamId === t.id).map((u) => u.id) })),
    [teamRows, users],
  )

  const ownerId = authUser?.id ?? ''
  const nowIso = () => new Date().toISOString()

  const addActivity = useCallback<AppActions['addActivity']>(
    (input) => {
      const activity: Activity = {
        id: crypto.randomUUID(),
        userId: ownerId,
        activityDate: nowIso(),
        createdAt: nowIso(),
        ...input,
      }
      setActivities((prev) => [activity, ...prev])
      insertRow('activities', activity, 'addActivity')
      return activity
    },
    [ownerId],
  )

  const updateActivity = useCallback<AppActions['updateActivity']>(
    (id, patch) => {
      let previous: Activity | undefined
      setActivities((prev) => {
        previous = prev.find((a) => a.id === id)
        return prev.map((a) => (a.id === id ? { ...a, ...patch } : a))
      })
      updateRow('activities', id, patch, 'updateActivity', (message) => {
        if (previous) setActivities((prev) => prev.map((a) => (a.id === id ? previous! : a)))
        showError(message)
      })
    },
    [showError],
  )

  const markNotificationRead = useCallback<AppActions['markNotificationRead']>((id) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
    updateRow('notifications', id, { read: true }, 'markNotificationRead')
  }, [])

  const markAllNotificationsRead = useCallback<AppActions['markAllNotificationsRead']>(() => {
    setNotifications((prev) => {
      const unreadIds = prev.filter((n) => !n.read).map((n) => n.id)
      for (const id of unreadIds) updateRow('notifications', id, { read: true }, 'markAllNotificationsRead')
      return prev.map((n) => ({ ...n, read: true }))
    })
  }, [])

  const addLead = useCallback<AppActions['addLead']>(
    (input) => {
      const id = crypto.randomUUID()
      const optimisticLeadNumber = leads.reduce((max, l) => Math.max(max, l.leadNumber), 0) + 1
      const lead: Lead = {
        id,
        leadNumber: optimisticLeadNumber,
        status: 'No Contact Yet',
        source: 'Direct',
        score: 10,
        estimatedValue: 0,
        ownerId,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        ...input,
      }
      setLeads((prev) => [lead, ...prev])
      addActivity({ type: 'Note', subject: `New lead created: ${lead.firstName} ${lead.lastName}`, leadId: lead.id, companyId: lead.companyId })

      const row = appToRow(lead)
      delete row.lead_number // DB identity column assigns the real, gap-free number
      supabase
        .from('leads')
        .insert(row)
        .select('id, lead_number')
        .single()
        .then(({ data, error }) => {
          if (error) {
            reportError('addLead', error.message)
            return
          }
          if (data && data.lead_number !== optimisticLeadNumber) {
            setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, leadNumber: data.lead_number as number } : l)))
          }
        })
      return lead
    },
    [ownerId, leads, addActivity],
  )

  const updateLead = useCallback<AppActions['updateLead']>(
    (id, patch) => {
      // Edit forms hand back the whole lead object rather than just the changed fields, so
      // strip the columns Postgres won't accept in an UPDATE before it reaches the DB.
      // leadNumber is the one that actually breaks: it's GENERATED ALWAYS AS IDENTITY, so
      // including it -- even set to its own current value -- fails the entire update with
      // 'column "lead_number" can only be updated to DEFAULT', which silently killed every
      // Edit Lead save. id and createdAt are stripped for the same reason in principle:
      // neither is ever a legitimate thing to change on an existing record.
      const { leadNumber: _leadNumber, id: _id, createdAt: _createdAt, ...safePatch } = patch
      const fullPatch = { ...safePatch, updatedAt: nowIso() }
      let previous: Lead | undefined
      setLeads((prev) => {
        previous = prev.find((l) => l.id === id)
        return prev.map((l) => (l.id === id ? { ...l, ...fullPatch } : l))
      })
      updateRow('leads', id, fullPatch, 'updateLead', (message) => {
        if (previous) setLeads((prev) => prev.map((l) => (l.id === id ? previous! : l)))
        showError(message)
      })
    },
    [showError],
  )

  const deleteLead = useCallback<AppActions['deleteLead']>(
    (leadId) => {
      let previous: Lead | undefined
      setLeads((prev) => {
        previous = prev.find((l) => l.id === leadId)
        return prev.filter((l) => l.id !== leadId)
      })
      deleteRow('leads', leadId, 'deleteLead', (message) => {
        if (previous) setLeads((prev) => [previous!, ...prev])
        showError(message)
      })
    },
    [showError],
  )

  const addDeal = useCallback<AppActions['addDeal']>(
    (input) => {
      const deal: Deal = {
        id: crypto.randomUUID(),
        ownerId,
        stage: 'New Deal',
        value: 0,
        probability: DEAL_STAGE_PROBABILITY['New Deal'],
        kind: kindForService(input.service),
        expectedCloseDate: nowIso(),
        source: 'Direct',
        createdAt: nowIso(),
        ...input,
      }
      // Enforced after the spread, so a caller can't hand a handover a fee by accident. The
      // whole "a signed book is not revenue" rule rests on this staying zero: every revenue
      // total in the app sums deal.value, so a handover contributes nothing to any of them.
      if (kindForService(deal.service) === 'Handover') {
        deal.kind = 'Handover'
        deal.value = 0
      }
      setDeals((prev) => [deal, ...prev])
      insertRow('deals', deal, 'addDeal')
      addActivity({ type: 'Deal update', subject: `New deal created: ${deal.name}`, dealId: deal.id, companyId: deal.companyId })
      return deal
    },
    [ownerId, addActivity],
  )

  const updateDeal = useCallback<AppActions['updateDeal']>(
    (id, patch) => {
      let previous: Deal | undefined
      setDeals((prev) => {
        previous = prev.find((d) => d.id === id)
        return prev.map((d) => (d.id === id ? { ...d, ...patch } : d))
      })
      updateRow('deals', id, patch, 'updateDeal', (message) => {
        if (previous) setDeals((prev) => prev.map((d) => (d.id === id ? previous! : d)))
        showError(message)
      })
    },
    [showError],
  )

  const moveDealStage = useCallback<AppActions['moveDealStage']>(
    (id, stage) => {
      const patch: Partial<Deal> = { stage, probability: DEAL_STAGE_PROBABILITY[stage] }
      if (stage === 'Won') patch.wonAt = nowIso()
      if (stage === 'Rejected') patch.rejectedAt = nowIso()
      let previous: Deal | undefined
      setDeals((prev) => {
        previous = prev.find((d) => d.id === id)
        return prev.map((d) => (d.id === id ? { ...d, ...patch } : d))
      })
      updateRow('deals', id, patch, 'moveDealStage', (message) => {
        if (previous) setDeals((prev) => prev.map((d) => (d.id === id ? previous! : d)))
        showError(message)
      })
      const deal = deals.find((d) => d.id === id)
      addActivity({
        type: stage === 'Won' ? 'Deal Won' : stage === 'Rejected' ? 'Deal Rejected' : 'Deal Stage Change',
        subject: `${deal?.name ?? 'Deal'} moved to ${stage}`,
        dealId: id,
        companyId: deal?.companyId,
      })
    },
    [deals, addActivity, showError],
  )

  const markDealWon = useCallback<AppActions['markDealWon']>(
    (id, details) => {
      const deal = deals.find((d) => d.id === id)
      // A signed book is not revenue: a Handover's value stays at zero and its size lives in
      // handoverAmount, so nothing downstream can add the two kinds of money together.
      const isHandover = deal ? dealKind(deal) === 'Handover' : false
      const patch: Partial<Deal> = {
        stage: 'Won',
        probability: DEAL_STAGE_PROBABILITY.Won,
        value: isHandover ? 0 : details.finalValue,
        service: details.service,
        handoverAmount: details.handoverAmount,
        accountsCount: details.accountsCount,
        contractStartDate: details.startDate,
        wonAt: nowIso(),
        notes: `${deal?.notes ?? ''}\nContract start: ${details.startDate}. Duration: ${details.contractDuration}.`.trim(),
      }
      let previous: Deal | undefined
      setDeals((prev) => {
        previous = prev.find((d) => d.id === id)
        return prev.map((d) => (d.id === id ? { ...d, ...patch } : d))
      })
      updateRow('deals', id, patch, 'markDealWon', (message) => {
        if (previous) setDeals((prev) => prev.map((d) => (d.id === id ? previous! : d)))
        showError(message)
      })
      if (isHandover && deal?.companyId) {
        const signedAt = nowIso()
        setCompanies((prev) => prev.map((c) => (c.id === deal.companyId ? { ...c, mandateSignedAt: signedAt } : c)))
        updateRow('companies', deal.companyId, { mandateSignedAt: signedAt }, 'markDealWon:mandateSigned')
      }
      addActivity({
        type: 'Deal Won',
        subject: isHandover
          ? `${deal?.name ?? 'Deal'} — mandate signed, ${details.accountsCount ?? 0} accounts`
          : `${deal?.name ?? 'Deal'} marked Won — ${details.service}, starting ${details.startDate}`,
        dealId: id,
        companyId: deal?.companyId,
      })
    },
    [deals, addActivity, showError],
  )

  const logDealDocument = useCallback<AppActions['logDealDocument']>(
    (id, document) => {
      const deal = deals.find((d) => d.id === id)
      const sentAt = nowIso()
      const field = document === 'quotation' ? 'quotationSentAt' : document === 'mandate' ? 'mandateSentAt' : 'invoiceSentAt'
      const patch: Partial<Deal> = { [field]: sentAt }
      // Sending the quotation or the mandate is what moves a deal along; an invoice follows a
      // deal that's already won, so it records the fact without touching the stage.
      if (document !== 'invoice' && deal?.stage === 'New Deal') {
        patch.stage = 'Quotation Sent'
        patch.probability = DEAL_STAGE_PROBABILITY['Quotation Sent']
      }
      let previous: Deal | undefined
      setDeals((prev) => {
        previous = prev.find((d) => d.id === id)
        return prev.map((d) => (d.id === id ? { ...d, ...patch } : d))
      })
      updateRow('deals', id, patch, 'logDealDocument', (message) => {
        if (previous) setDeals((prev) => prev.map((d) => (d.id === id ? previous! : d)))
        showError(message)
      })
      const label = document === 'quotation' ? 'Quotation' : document === 'mandate' ? 'Mandate' : 'Invoice'
      addActivity({ type: 'Deal update', subject: `${label} sent: ${deal?.name ?? 'Deal'}`, dealId: id, companyId: deal?.companyId })
    },
    [deals, addActivity, showError],
  )

  const markDealRejected = useCallback<AppActions['markDealRejected']>(
    (id, reason, note) => {
      const patch: Partial<Deal> = {
        stage: 'Rejected',
        probability: DEAL_STAGE_PROBABILITY.Rejected,
        rejectionReason: reason,
        rejectionNote: note || undefined,
        rejectedAt: nowIso(),
      }
      let previous: Deal | undefined
      setDeals((prev) => {
        previous = prev.find((d) => d.id === id)
        return prev.map((d) => (d.id === id ? { ...d, ...patch } : d))
      })
      updateRow('deals', id, patch, 'markDealRejected', (message) => {
        if (previous) setDeals((prev) => prev.map((d) => (d.id === id ? previous! : d)))
        showError(message)
      })
      const deal = deals.find((d) => d.id === id)
      addActivity({ type: 'Deal Rejected', subject: `${deal?.name ?? 'Deal'} rejected — ${reason}`, notes: note || undefined, dealId: id, companyId: deal?.companyId })
    },
    [deals, addActivity, showError],
  )

  const addProposal = useCallback<AppActions['addProposal']>(
    (input) => {
      const proposal: Proposal = {
        id: crypto.randomUUID(),
        status: 'Draft',
        validityDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
        createdAt: nowIso(),
        ...input,
      }
      setProposals((prev) => [proposal, ...prev])
      insertRow('proposals', proposal, 'addProposal')
      addActivity({ type: 'Proposal', subject: `Proposal created: ${proposal.service}`, dealId: proposal.dealId, companyId: proposal.companyId })
      return proposal
    },
    [addActivity],
  )

  const updateProposal = useCallback<AppActions['updateProposal']>(
    (id, patch) => {
      let previous: Proposal | undefined
      setProposals((prev) => {
        previous = prev.find((p) => p.id === id)
        return prev.map((p) => (p.id === id ? { ...p, ...patch } : p))
      })
      updateRow('proposals', id, patch, 'updateProposal', (message) => {
        if (previous) setProposals((prev) => prev.map((p) => (p.id === id ? previous! : p)))
        showError(message)
      })
    },
    [showError],
  )

  function addCompanyInternal(input: Partial<Company> & { name: string }): Company {
    const company: Company = {
      id: crypto.randomUUID(),
      accountOwnerId: ownerId,
      createdAt: nowIso(),
      ...input,
    }
    setCompanies((prev) => [company, ...prev])
    insertRow('companies', company, 'addCompany')
    return company
  }

  const addCompany = useCallback<AppActions['addCompany']>((input) => addCompanyInternal(input), [ownerId])

  const updateCompany = useCallback<AppActions['updateCompany']>(
    (id, patch) => {
      let previous: Company | undefined
      setCompanies((prev) => {
        previous = prev.find((c) => c.id === id)
        return prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
      })
      updateRow('companies', id, patch, 'updateCompany', (message) => {
        if (previous) setCompanies((prev) => prev.map((c) => (c.id === id ? previous! : c)))
        showError(message)
      })
    },
    [showError],
  )

  const deleteCompany = useCallback<AppActions['deleteCompany']>(
    (id) => {
      let previous: Company | undefined
      setCompanies((prev) => {
        previous = prev.find((c) => c.id === id)
        return prev.filter((c) => c.id !== id)
      })
      setCompanies((prev) => prev.map((c) => (c.parentCompanyId === id ? { ...c, parentCompanyId: undefined } : c)))
      deleteRow('companies', id, 'deleteCompany', (message) => {
        if (previous) setCompanies((prev) => [previous!, ...prev])
        showError(message)
      })
    },
    [showError],
  )

  const addContact = useCallback<AppActions['addContact']>(
    (input) => {
      const contact: Contact = {
        id: crypto.randomUUID(),
        ownerId,
        createdAt: nowIso(),
        ...input,
      }
      setContacts((prev) => [contact, ...prev])
      insertRow('contacts', contact, 'addContact')
      return contact
    },
    [ownerId],
  )

  const updateContact = useCallback<AppActions['updateContact']>(
    (id, patch) => {
      let previous: Contact | undefined
      setContacts((prev) => {
        previous = prev.find((c) => c.id === id)
        return prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
      })
      updateRow('contacts', id, patch, 'updateContact', (message) => {
        if (previous) setContacts((prev) => prev.map((c) => (c.id === id ? previous! : c)))
        showError(message)
      })
    },
    [showError],
  )

  const addTask = useCallback<AppActions['addTask']>(
    (input) => {
      const task: Task = {
        id: crypto.randomUUID(),
        type: 'Follow-up',
        status: 'Not Started',
        priority: 'Medium',
        ownerId,
        createdAt: nowIso(),
        ...input,
      }
      setTasks((prev) => [task, ...prev])
      insertRow('tasks', task, 'addTask')
      addActivity({ type: 'Task', subject: `Task created: ${task.title}`, leadId: task.leadId, dealId: task.dealId, companyId: task.companyId })
      return task
    },
    [ownerId, addActivity],
  )

  const updateTask = useCallback<AppActions['updateTask']>(
    (id, patch) => {
      let previous: Task | undefined
      setTasks((prev) => {
        previous = prev.find((t) => t.id === id)
        return prev.map((t) => (t.id === id ? { ...t, ...patch } : t))
      })
      updateRow('tasks', id, patch, 'updateTask', (message) => {
        if (previous) setTasks((prev) => prev.map((t) => (t.id === id ? previous! : t)))
        showError(message)
      })

      // Creating a task was already logged on the client's file; finishing one wasn't, so a
      // meeting that actually happened left no trace anywhere except the task disappearing
      // off a list. Logged here rather than at each tick-box so it holds wherever a task gets
      // completed — dashboard, tasks page, or anywhere added later.
      if (previous && patch.status === 'Completed' && previous.status !== 'Completed') {
        addActivity({
          type: taskCompletionActivityType(previous.type),
          subject: `${previous.type} completed: ${previous.title}`,
          leadId: previous.leadId,
          dealId: previous.dealId,
          companyId: previous.companyId,
        })
      }
    },
    [showError, addActivity],
  )

  /**
   * The Company a lead's deals hang off. A lead often has no client record yet, and a Deal
   * can't exist without one, so the client is created here the first time it's needed. It
   * stays out of the Clients list until one of its deals is Won, so opening a deal on a lead
   * doesn't quietly promote them to a client.
   */
  const ensureLeadCompany = useCallback(
    (lead: Lead): { companyId: ID; newCompany?: Company } => {
      if (lead.companyId) return { companyId: lead.companyId }
      const newCompany: Company = {
        id: crypto.randomUUID(),
        accountOwnerId: ownerId,
        createdAt: nowIso(),
        name: lead.companyName,
        industry: lead.industry,
        province: lead.province,
        city: lead.city,
      }
      setCompanies((prev) => [newCompany, ...prev])
      return { companyId: newCompany.id, newCompany }
    },
    [ownerId],
  )

  const addLeadDeal = useCallback<AppActions['addLeadDeal']>(
    (leadId, input) => {
      const lead = leads.find((l) => l.id === leadId)
      if (!lead) return undefined
      const { companyId, newCompany } = ensureLeadCompany(lead)

      const deal: Deal = {
        id: crypto.randomUUID(),
        name: input.name,
        companyId,
        ownerId: lead.ownerId,
        stage: 'New Deal',
        // A handover earns nothing at signature, so it carries no deal value — only a book.
        kind: kindForService(input.service),
        value: kindForService(input.service) === 'Handover' ? 0 : input.value,
        probability: DEAL_STAGE_PROBABILITY['New Deal'],
        expectedCloseDate: input.expectedCloseDate,
        service: input.service,
        source: lead.source,
        createdAt: nowIso(),
        leadId,
      }
      setDeals((prev) => [deal, ...prev])
      addActivity({ type: 'Deal update', subject: `Deal opened on lead: ${deal.name}`, leadId, dealId: deal.id, companyId })

      // The company has to land before the deal that references it, or the deal insert fails
      // its foreign key and the row only ever exists in this browser tab.
      void (async () => {
        if (newCompany) {
          const companyError = await insertRow('companies', newCompany, 'addLeadDeal:company')
          if (companyError) {
            setCompanies((prev) => prev.filter((c) => c.id !== newCompany.id))
            setDeals((prev) => prev.filter((d) => d.id !== deal.id))
            showError(companyError)
            return
          }
          updateLead(leadId, { companyId })
        }
        const dealError = await insertRow('deals', deal, 'addLeadDeal:deal')
        if (dealError) {
          setDeals((prev) => prev.filter((d) => d.id !== deal.id))
          showError(dealError)
        }
      })()

      return deal
    },
    [leads, ensureLeadCompany, addActivity, updateLead, showError],
  )

  const convertLeadToClient = useCallback<AppActions['convertLeadToClient']>(
    (leadId, confirm) => {
      const lead = leads.find((l) => l.id === leadId)
      if (!lead) return undefined

      const { companyId, newCompany } = ensureLeadCompany(lead)

      let contactId: ID | undefined
      let newContact: Contact | undefined
      const existingContact = contacts.find((c) => c.companyId === companyId && c.firstName === lead.firstName && c.lastName === lead.lastName)
      if (existingContact) {
        contactId = existingContact.id
      } else {
        newContact = {
          id: crypto.randomUUID(),
          firstName: lead.firstName,
          lastName: lead.lastName,
          jobTitle: lead.jobTitle,
          companyId,
          email: lead.email,
          phone: lead.phone,
          mobile: lead.mobile,
          ownerId: lead.ownerId,
          createdAt: nowIso(),
        }
        contactId = newContact.id
        setContacts((prev) => [newContact!, ...prev])
      }

      // Converting means they signed, so every deal in the confirmation is marked Won with
      // the value confirmed at conversion — that's what starts the handover and puts them in
      // the Clients list. A deal the rep already opened while working the lead is confirmed
      // in place; a service they were interested in but never opened a deal for is created
      // and confirmed in one go.
      const wonAt = nowIso()
      const dealsToCreate: Deal[] = []
      const dealsToConfirm: { id: ID; name: string; patch: Partial<Deal> }[] = []

      for (const entry of confirm.deals) {
        const entryIsHandover = kindForService(entry.service) === 'Handover'
        const won: Partial<Deal> = {
          stage: 'Won',
          value: entryIsHandover ? 0 : entry.value,
          handoverAmount: entry.handoverAmount,
          accountsCount: entry.accountsCount,
          contractStartDate: confirm.startDate,
          wonAt,
        }
        if (entry.dealId) {
          dealsToConfirm.push({ id: entry.dealId, name: entry.name, patch: won })
        } else {
          dealsToCreate.push({
            id: crypto.randomUUID(),
            name: entry.name,
            companyId,
            contactId,
            ownerId: lead.ownerId,
            probability: DEAL_STAGE_PROBABILITY.Won,
            expectedCloseDate: confirm.startDate,
            service: entry.service,
            source: lead.source,
            createdAt: nowIso(),
            leadId: lead.id,
            kind: kindForService(entry.service),
            stage: 'Won',
            value: entryIsHandover ? 0 : entry.value,
            handoverAmount: entry.handoverAmount,
            accountsCount: entry.accountsCount,
            contractStartDate: confirm.startDate,
            wonAt,
          })
        }
      }

      setDeals((prev) => [
        ...dealsToCreate,
        ...prev.map((d) => {
          const confirmed = dealsToConfirm.find((c) => c.id === d.id)
          return confirmed ? { ...d, ...confirmed.patch } : d
        }),
      ])
      for (const confirmed of dealsToConfirm) {
        updateRow('deals', confirmed.id, confirmed.patch, 'convertLeadToClient:confirmDeal')
      }
      const firstDeal = dealsToCreate[0] ?? deals.find((d) => d.id === dealsToConfirm[0]?.id)

      // The estimate's working life ends here. It moves to the client as a labelled record of
      // what was promised — never a forecast, never summed with the real figures that arrive
      // once accounts are actually handed over.
      const estimatedBook = confirm.deals.find((d) => kindForService(d.service) === 'Handover')
      if (estimatedBook) {
        const estimate = {
          estimatedHandoverAmount: estimatedBook.handoverAmount,
          estimatedAccountsCount: estimatedBook.accountsCount,
          estimatedAtConversion: nowIso(),
          mandateSignedAt: nowIso(),
        }
        setCompanies((prev) => prev.map((c) => (c.id === companyId ? { ...c, ...estimate } : c)))
        if (!newCompany) updateRow('companies', companyId, estimate, 'convertLeadToClient:signupEstimate')
        else Object.assign(newCompany, estimate)
      }

      updateLead(leadId, { status: 'Converted', convertedDealId: firstDeal?.id })

      // Contact people captured while this was still a lead belong to the client now — without
      // this they'd stay pointed only at the lead and vanish from the record everyone actually
      // works from afterwards.
      const carriedOverContacts = contacts.filter((c) => c.leadId === leadId && !c.companyId)
      for (const contact of carriedOverContacts) {
        setContacts((prev) => prev.map((c) => (c.id === contact.id ? { ...c, companyId } : c)))
        updateRow('contacts', contact.id, { companyId }, 'convertLeadToClient:contactCompany')
      }
      addActivity({ type: 'Status change', subject: `Lead converted to client: ${lead.companyName}`, leadId, companyId })
      for (const deal of [...dealsToCreate, ...dealsToConfirm]) {
        addActivity({ type: 'Deal Won', subject: `Deal confirmed on conversion: ${deal.name}`, leadId, dealId: deal.id, companyId })
      }

      // Persist strictly in dependency order: contacts/deals reference
      // company_id, so if a new company is being created here, its insert
      // must actually land before the contact/deal inserts that point at
      // it fire — otherwise the faster contact/deal request can race ahead
      // of the still-in-flight company request and get rejected with a
      // foreign-key violation (the company it references doesn't exist
      // yet). That row then only ever existed in local state and silently
      // vanishes on the next reload, with no error shown anywhere. The
      // deals themselves don't depend on each other, so once company/
      // contact are confirmed their inserts can fire in parallel.
      void (async () => {
        const dealIds = dealsToCreate.map((d) => d.id)
        if (newCompany) {
          const companyError = await insertRow('companies', newCompany, 'addCompany')
          if (companyError) {
            setCompanies((prev) => prev.filter((c) => c.id !== newCompany!.id))
            setDeals((prev) => prev.filter((d) => !dealIds.includes(d.id)))
            if (newContact) setContacts((prev) => prev.filter((c) => c.id !== newContact!.id))
            showError(companyError)
            return
          }
        }
        if (newContact) {
          const contactError = await insertRow('contacts', newContact, 'convertLeadToClient:contact')
          if (contactError) {
            setContacts((prev) => prev.filter((c) => c.id !== newContact!.id))
            setDeals((prev) => prev.filter((d) => !dealIds.includes(d.id)))
            showError(contactError)
            return
          }
        }
        if (dealsToCreate.length === 0) return
        const results = await Promise.all(dealsToCreate.map((deal) => insertRow('deals', deal, 'convertLeadToClient:deal')))
        const failedIds = dealsToCreate.filter((_, i) => results[i]).map((d) => d.id)
        if (failedIds.length > 0) {
          setDeals((prev) => prev.filter((d) => !failedIds.includes(d.id)))
          showError(results.find((r) => r)!)
        }
      })()

      return { companyId, deal: firstDeal }
    },
    [leads, deals, contacts, ensureLeadCompany, updateLead, addActivity, showError],
  )

  const rejectLead = useCallback<AppActions['rejectLead']>(
    (leadId, reason, note) => {
      updateLead(leadId, { status: 'Rejected', rejectionReason: reason, rejectionNote: note || undefined })
      // The reason goes in the subject so it reads at a glance on the timeline; a rejection
      // nobody can explain six months later is the same as no record at all.
      addActivity({ type: 'Status change', subject: `Lead rejected — ${reason}`, notes: note || undefined, leadId })

      // A deal opened while working this lead has nowhere left to go once the lead itself is
      // rejected. Leaving it open would keep it sitting in the pipeline and the forecast for
      // business that is definitively not happening.
      for (const deal of deals.filter((d) => d.leadId === leadId && d.stage !== 'Won' && d.stage !== 'Rejected')) {
        markDealRejected(deal.id, reason)
      }
    },
    [updateLead, addActivity, deals, markDealRejected],
  )

  const updateUser = useCallback<AppActions['updateUser']>(
    (id, patch) => {
      let previous: User | undefined
      setUsers((prev) => {
        previous = prev.find((u) => u.id === id)
        return prev.map((u) => (u.id === id ? { ...u, ...patch } : u))
      })
      updateRow('profiles', id, patch, 'updateUser', (message) => {
        if (previous) setUsers((prev) => prev.map((u) => (u.id === id ? previous! : u)))
        showError(message)
      })
    },
    [showError],
  )

  const removeUserLocal = useCallback<AppActions['removeUserLocal']>((id) => {
    setUsers((prev) => prev.filter((u) => u.id !== id))
  }, [])

  const addTeam = useCallback<AppActions['addTeam']>(
    (input) => {
      const id = crypto.randomUUID()
      const team: Team = { memberIds: [], kind: 'Sales', ...input, id }
      setTeamRows((prev) => [...prev, { id, name: team.name, kind: team.kind }])
      insertRow('teams', { id, name: team.name, kind: team.kind }, 'addTeam', (message) => {
        setTeamRows((prev) => prev.filter((t) => t.id !== id))
        showError(message)
      })
      return team
    },
    [showError],
  )

  const updateTeam = useCallback<AppActions['updateTeam']>(
    (id, patch) => {
      let previous: { id: ID; name: string; kind: TeamKind } | undefined
      setTeamRows((prev) => {
        previous = prev.find((t) => t.id === id)
        return prev.map((t) => (t.id === id ? { ...t, ...patch } : t))
      })
      updateRow('teams', id, patch, 'updateTeam', (message) => {
        if (previous) setTeamRows((prev) => prev.map((t) => (t.id === id ? previous! : t)))
        showError(message)
      })
    },
    [showError],
  )

  const deleteTeam = useCallback<AppActions['deleteTeam']>(
    (id) => {
      let previous: { id: ID; name: string; kind: TeamKind } | undefined
      setTeamRows((prev) => {
        previous = prev.find((t) => t.id === id)
        return prev.filter((t) => t.id !== id)
      })
      setUsers((prev) => prev.map((u) => (u.teamId === id ? { ...u, teamId: undefined } : u)))
      deleteRow('teams', id, 'deleteTeam', (message) => {
        if (previous) setTeamRows((prev) => [...prev, previous!])
        showError(message)
      })
    },
    [showError],
  )

  const companyById = useCallback<AppActions['companyById']>((id) => companies.find((c) => c.id === id), [companies])
  const contactById = useCallback<AppActions['contactById']>((id) => contacts.find((c) => c.id === id), [contacts])
  const dealById = useCallback<AppActions['dealById']>((id) => deals.find((d) => d.id === id), [deals])
  const leadById = useCallback<AppActions['leadById']>((id) => leads.find((l) => l.id === id), [leads])
  const userById = useCallback<AppActions['userById']>((id) => users.find((u) => u.id === id), [users])

  const value = useMemo<AppState & AppActions>(
    () => ({
      leads,
      deals,
      contacts,
      companies,
      tasks,
      activities,
      proposals,
      users,
      teams,
      notifications,
      dataLoading,
      toast,
      addLead,
      updateLead,
      convertLeadToClient,
      addLeadDeal,
      rejectLead,
      deleteLead,
      addDeal,
      updateDeal,
      moveDealStage,
      markDealWon,
      markDealRejected,
      logDealDocument,
      addContact,
      updateContact,
      addCompany,
      updateCompany,
      deleteCompany,
      addTask,
      updateTask,
      addActivity,
      updateActivity,
      markNotificationRead,
      markAllNotificationsRead,
      refreshSyncedData,
      addProposal,
      updateProposal,
      updateUser,
      removeUserLocal,
      addTeam,
      updateTeam,
      deleteTeam,
      dismissToast,
      companyById,
      contactById,
      dealById,
      leadById,
      userById,
    }),
    [
      leads,
      deals,
      contacts,
      companies,
      tasks,
      activities,
      proposals,
      users,
      teams,
      notifications,
      dataLoading,
      toast,
      addLead,
      updateLead,
      convertLeadToClient,
      addLeadDeal,
      rejectLead,
      deleteLead,
      addDeal,
      updateDeal,
      moveDealStage,
      markDealWon,
      markDealRejected,
      logDealDocument,
      addContact,
      updateContact,
      addCompany,
      updateCompany,
      deleteCompany,
      addTask,
      updateTask,
      addActivity,
      updateActivity,
      markNotificationRead,
      markAllNotificationsRead,
      refreshSyncedData,
      addProposal,
      updateProposal,
      updateUser,
      removeUserLocal,
      addTeam,
      updateTeam,
      deleteTeam,
      dismissToast,
      companyById,
      contactById,
      dealById,
      leadById,
      userById,
    ],
  )

  return (
    <AppContext.Provider value={value}>
      {children}
      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[100] bg-navy-950 text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-3">
          <span>{toast}</span>
          <button onClick={dismissToast} className="text-slate-300 hover:text-white text-xs font-semibold">
            Dismiss
          </button>
        </div>
      )}
    </AppContext.Provider>
  )
}

export function useAppStore() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useAppStore must be used within AppStoreProvider')
  return ctx
}
