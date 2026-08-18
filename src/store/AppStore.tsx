import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import { TODAY } from '../data/mockData'
import type { Activity, ActivityType, Company, Contact, Deal, DealStage, ID, Lead, LeadStatus, LossReason, Proposal, Task, Team, User } from '../types'

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
  dataLoading: boolean
  /** Message from the most recent failed write (e.g. permission denied). Null when nothing to show. */
  toast: string | null
}

export interface WonDealDetails {
  finalValue: number
  startDate: string
  service: string
  contractDuration: string
  /** Handover-type services only (e.g. Debt Collection) — outstanding balance being handed over, distinct from finalValue. */
  handoverAmount?: number
}

interface AppActions {
  addLead: (input: Partial<Lead> & { firstName: string; lastName: string; companyName: string }) => Lead
  updateLead: (id: ID, patch: Partial<Lead>) => void
  convertLeadToDeal: (leadId: ID, dealValue?: number) => Deal | undefined
  markLeadLost: (leadId: ID) => void
  deleteLead: (leadId: ID) => void

  addDeal: (input: Partial<Deal> & { name: string; companyId: ID }) => Deal
  updateDeal: (id: ID, patch: Partial<Deal>) => void
  moveDealStage: (id: ID, stage: DealStage) => void
  markDealWon: (id: ID, details: WonDealDetails) => void
  markDealLost: (id: ID, reason: LossReason) => void

  addContact: (input: Partial<Contact> & { firstName: string; lastName: string }) => Contact
  addCompany: (input: Partial<Company> & { name: string }) => Company
  updateCompany: (id: ID, patch: Partial<Company>) => void
  addTask: (input: Partial<Task> & { title: string; dueDate: string }) => Task
  updateTask: (id: ID, patch: Partial<Task>) => void
  addActivity: (input: Partial<Activity> & { type: ActivityType; subject: string }) => Activity

  addProposal: (input: Partial<Proposal> & { dealId: ID; companyId: ID; service: string; pricing: number }) => Proposal
  updateProposal: (id: ID, patch: Partial<Proposal>) => void

  updateUser: (id: ID, patch: Partial<User>) => void
  addTeam: (input: Partial<Team> & { name: string }) => Team

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
  const [teamRows, setTeamRows] = useState<{ id: ID; name: string }[]>([])
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
      fetchTable<{ id: ID; name: string }>('teams', 'created_at'),
    ])
      .then(([l, d, ct, co, tk, ac, pr, us, tm]) => {
        if (!active) return
        setLeads(l)
        setDeals(d)
        setContacts(ct)
        setCompanies(co)
        setTasks(rollOverMissedTasks(tk))
        setActivities(ac)
        setProposals(pr)
        setUsers(us)
        setTeamRows(tm)
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

  const teams = useMemo<Team[]>(
    () => teamRows.map((t) => ({ id: t.id, name: t.name, memberIds: users.filter((u) => u.teamId === t.id).map((u) => u.id) })),
    [teamRows, users],
  )

  const ownerId = authUser?.id ?? ''
  const nowIso = () => new Date().toISOString()

  const addActivity = useCallback<AppActions['addActivity']>(
    (input) => {
      const activity: Activity = {
        id: crypto.randomUUID(),
        userId: ownerId,
        activityDate: TODAY.toISOString(),
        createdAt: nowIso(),
        ...input,
      }
      setActivities((prev) => [activity, ...prev])
      insertRow('activities', activity, 'addActivity')
      return activity
    },
    [ownerId],
  )

  const addLead = useCallback<AppActions['addLead']>(
    (input) => {
      const id = crypto.randomUUID()
      const optimisticLeadNumber = leads.reduce((max, l) => Math.max(max, l.leadNumber), 0) + 1
      const lead: Lead = {
        id,
        leadNumber: optimisticLeadNumber,
        status: 'New',
        source: 'Direct',
        score: 10,
        estimatedValue: 0,
        ownerId,
        createdAt: TODAY.toISOString(),
        updatedAt: TODAY.toISOString(),
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
      const fullPatch = { ...patch, updatedAt: TODAY.toISOString() }
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

  const markLeadLost = useCallback<AppActions['markLeadLost']>(
    (leadId) => {
      updateLead(leadId, { status: 'Lost' as LeadStatus })
      addActivity({ type: 'Status change', subject: 'Lead marked as Lost', leadId })
    },
    [updateLead, addActivity],
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
        stage: 'New Lead',
        value: 0,
        probability: 10,
        expectedCloseDate: TODAY.toISOString(),
        source: 'Direct',
        createdAt: TODAY.toISOString(),
        ...input,
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
      const patch: Partial<Deal> = { stage }
      if (stage === 'Won') patch.wonAt = TODAY.toISOString()
      if (stage === 'Lost') patch.lostAt = TODAY.toISOString()
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
        type: stage === 'Won' ? 'Deal Won' : stage === 'Lost' ? 'Deal Lost' : 'Deal Stage Change',
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
      const patch: Partial<Deal> = {
        stage: 'Won' as DealStage,
        value: details.finalValue,
        service: details.service,
        handoverAmount: details.handoverAmount,
        contractStartDate: details.startDate,
        wonAt: TODAY.toISOString(),
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
      addActivity({ type: 'Deal Won', subject: `${deal?.name ?? 'Deal'} marked Won — ${details.service}, starting ${details.startDate}`, dealId: id, companyId: deal?.companyId })
    },
    [deals, addActivity, showError],
  )

  const markDealLost = useCallback<AppActions['markDealLost']>(
    (id, reason) => {
      const patch: Partial<Deal> = { stage: 'Lost' as DealStage, lossReason: reason, lostAt: TODAY.toISOString() }
      let previous: Deal | undefined
      setDeals((prev) => {
        previous = prev.find((d) => d.id === id)
        return prev.map((d) => (d.id === id ? { ...d, ...patch } : d))
      })
      updateRow('deals', id, patch, 'markDealLost', (message) => {
        if (previous) setDeals((prev) => prev.map((d) => (d.id === id ? previous! : d)))
        showError(message)
      })
      const deal = deals.find((d) => d.id === id)
      addActivity({ type: 'Deal Lost', subject: `${deal?.name ?? 'Deal'} marked Lost — reason: ${reason}`, dealId: id, companyId: deal?.companyId })
    },
    [deals, addActivity, showError],
  )

  const addProposal = useCallback<AppActions['addProposal']>(
    (input) => {
      const proposal: Proposal = {
        id: crypto.randomUUID(),
        status: 'Draft',
        validityDate: new Date(TODAY.getTime() + 1000 * 60 * 60 * 24 * 30).toISOString(),
        createdAt: TODAY.toISOString(),
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
      createdAt: TODAY.toISOString(),
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

  const addContact = useCallback<AppActions['addContact']>(
    (input) => {
      const contact: Contact = {
        id: crypto.randomUUID(),
        ownerId,
        createdAt: TODAY.toISOString(),
        ...input,
      }
      setContacts((prev) => [contact, ...prev])
      insertRow('contacts', contact, 'addContact')
      return contact
    },
    [ownerId],
  )

  const addTask = useCallback<AppActions['addTask']>(
    (input) => {
      const task: Task = {
        id: crypto.randomUUID(),
        type: 'Follow-up',
        status: 'Not Started',
        priority: 'Medium',
        ownerId,
        createdAt: TODAY.toISOString(),
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
    },
    [showError],
  )

  const convertLeadToDeal = useCallback<AppActions['convertLeadToDeal']>(
    (leadId, dealValue) => {
      const lead = leads.find((l) => l.id === leadId)
      if (!lead) return undefined

      let companyId = lead.companyId
      let newCompany: Company | undefined
      if (!companyId) {
        newCompany = { id: crypto.randomUUID(), accountOwnerId: ownerId, createdAt: TODAY.toISOString(), name: lead.companyName, industry: lead.industry, province: lead.province, city: lead.city }
        companyId = newCompany.id
        setCompanies((prev) => [newCompany!, ...prev])
      }

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
          createdAt: TODAY.toISOString(),
        }
        contactId = newContact.id
        setContacts((prev) => [newContact!, ...prev])
      }

      // One Deal per selected service, each carrying its own value — a lead
      // interested in both Executive Listing and Credit Check becomes two
      // independently trackable deals rather than one blended number. Falls
      // back to the legacy single-deal behavior for leads saved before
      // per-service values existed (serviceValues undefined/empty).
      const serviceEntries = lead.serviceValues && lead.serviceValues.length > 0 ? lead.serviceValues : undefined
      const dealDefs: { service?: string; value: number }[] = serviceEntries
        ? serviceEntries.map((sv) => ({ service: sv.service, value: (sv.service === 'Debt Collection' ? sv.handoverAmount : sv.value) ?? 0 }))
        : [{ service: lead.serviceInterested, value: dealValue ?? lead.estimatedValue }]

      const dealsToCreate: Deal[] = dealDefs.map((def) => ({
        id: crypto.randomUUID(),
        name: def.service ? `${lead.companyName} — ${def.service}` : `${lead.companyName} Deal`,
        companyId,
        contactId,
        ownerId: lead.ownerId,
        stage: 'Qualified',
        value: def.value,
        probability: 40,
        expectedCloseDate: new Date(TODAY.getTime() + 1000 * 60 * 60 * 24 * 30).toISOString(),
        service: def.service,
        source: lead.source,
        createdAt: TODAY.toISOString(),
        leadId: lead.id,
      }))
      const firstDeal = dealsToCreate[0]
      setDeals((prev) => [...dealsToCreate, ...prev])

      updateLead(leadId, { status: 'Converted' as LeadStatus, convertedDealId: firstDeal.id })
      for (const deal of dealsToCreate) {
        addActivity({ type: 'Status change', subject: `Lead converted to deal: ${deal.name}`, leadId, dealId: deal.id, companyId })
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
          const contactError = await insertRow('contacts', newContact, 'convertLeadToDeal:contact')
          if (contactError) {
            setContacts((prev) => prev.filter((c) => c.id !== newContact!.id))
            setDeals((prev) => prev.filter((d) => !dealIds.includes(d.id)))
            showError(contactError)
            return
          }
        }
        const results = await Promise.all(dealsToCreate.map((deal) => insertRow('deals', deal, 'convertLeadToDeal:deal')))
        const failedIds = dealsToCreate.filter((_, i) => results[i]).map((d) => d.id)
        if (failedIds.length > 0) {
          setDeals((prev) => prev.filter((d) => !failedIds.includes(d.id)))
          showError(results.find((r) => r)!)
        }
      })()

      return firstDeal
    },
    [leads, contacts, updateLead, addActivity, showError, ownerId],
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

  const addTeam = useCallback<AppActions['addTeam']>(
    (input) => {
      const id = crypto.randomUUID()
      const team: Team = { memberIds: [], ...input, id }
      setTeamRows((prev) => [...prev, { id, name: team.name }])
      insertRow('teams', { id, name: team.name }, 'addTeam', (message) => {
        setTeamRows((prev) => prev.filter((t) => t.id !== id))
        showError(message)
      })
      return team
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
      dataLoading,
      toast,
      addLead,
      updateLead,
      convertLeadToDeal,
      markLeadLost,
      deleteLead,
      addDeal,
      updateDeal,
      moveDealStage,
      markDealWon,
      markDealLost,
      addContact,
      addCompany,
      updateCompany,
      addTask,
      updateTask,
      addActivity,
      addProposal,
      updateProposal,
      updateUser,
      addTeam,
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
      dataLoading,
      toast,
      addLead,
      updateLead,
      convertLeadToDeal,
      markLeadLost,
      deleteLead,
      addDeal,
      updateDeal,
      moveDealStage,
      markDealWon,
      markDealLost,
      addContact,
      addCompany,
      updateCompany,
      addTask,
      updateTask,
      addActivity,
      addProposal,
      updateProposal,
      updateUser,
      addTeam,
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
