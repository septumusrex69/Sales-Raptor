import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import {
  activities as initialActivities,
  companies as initialCompanies,
  contacts as initialContacts,
  currentUser,
  deals as initialDeals,
  formatDate,
  leads as initialLeads,
  proposals as initialProposals,
  tasks as initialTasks,
  TODAY,
} from '../data/mockData'
import type { Activity, ActivityType, Company, Contact, Deal, DealStage, ID, Lead, LeadStatus, LossReason, Proposal, Task } from '../types'

let idCounter = 1000
function nextId(prefix: string) {
  idCounter += 1
  return `${prefix}${idCounter}`
}

/** Dedicated, never-reused counter for Lead.leadNumber — kept separate from idCounter so it stays gap-free. */
let leadNumberCounter = initialLeads.length
function nextLeadNumber() {
  leadNumberCounter += 1
  return leadNumberCounter
}

function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

/**
 * There's no backend/cron in this app to run a real daily rollover, so this
 * simulates "missed tasks automatically move to the next day" by catching
 * up once when a session starts: any open task whose due date has already
 * passed gets moved to today (same time-of-day), which is the steady state
 * a day-by-day rollover would converge to by the time you're looking at it.
 * The original due date is kept on `autoRescheduledFrom` so the UI can
 * show it was missed rather than silently rewriting history.
 */
function rollOverMissedTasks(tasks: Task[]) {
  const todayStart = startOfDay(TODAY)
  const rolled: { task: Task; from: string }[] = []
  const nextTasks = tasks.map((t) => {
    if (t.status === 'Completed' || t.status === 'Cancelled') return t
    if (new Date(t.dueDate) >= todayStart) return t
    const newDue = new Date(t.dueDate)
    newDue.setFullYear(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate())
    const updated: Task = { ...t, dueDate: newDue.toISOString(), autoRescheduledFrom: t.dueDate }
    rolled.push({ task: updated, from: t.dueDate })
    return updated
  })
  return { tasks: nextTasks, rolled }
}

const TASK_ROLLOVER = rollOverMissedTasks(initialTasks)
const ROLLOVER_ACTIVITIES: Activity[] = TASK_ROLLOVER.rolled.map((r, i) => ({
  id: `rollover-${i}`,
  type: 'Status change',
  userId: r.task.ownerId,
  leadId: r.task.leadId,
  dealId: r.task.dealId,
  companyId: r.task.companyId,
  subject: `Task auto-rescheduled: ${r.task.title}`,
  notes: `Missed due date ${formatDate(r.from)} — automatically moved to today.`,
  activityDate: TODAY.toISOString(),
  createdAt: TODAY.toISOString(),
}))

interface AppState {
  leads: Lead[]
  deals: Deal[]
  contacts: Contact[]
  companies: Company[]
  tasks: Task[]
  activities: Activity[]
  proposals: Proposal[]
}

export interface WonDealDetails {
  finalValue: number
  startDate: string
  service: string
  contractDuration: string
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
  addTask: (input: Partial<Task> & { title: string; dueDate: string }) => Task
  updateTask: (id: ID, patch: Partial<Task>) => void
  addActivity: (input: Partial<Activity> & { type: ActivityType; subject: string }) => Activity

  addProposal: (input: Partial<Proposal> & { dealId: ID; companyId: ID; service: string; pricing: number }) => Proposal
  updateProposal: (id: ID, patch: Partial<Proposal>) => void
}

const AppContext = createContext<(AppState & AppActions) | null>(null)

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads)
  const [deals, setDeals] = useState<Deal[]>(initialDeals)
  const [contacts, setContacts] = useState<Contact[]>(initialContacts)
  const [companies, setCompanies] = useState<Company[]>(initialCompanies)
  const [tasks, setTasks] = useState<Task[]>(TASK_ROLLOVER.tasks)
  const [activities, setActivities] = useState<Activity[]>(() => [...ROLLOVER_ACTIVITIES, ...initialActivities])
  const [proposals, setProposals] = useState<Proposal[]>(initialProposals)

  const nowIso = () => new Date().toISOString()

  const addActivity = useCallback<AppActions['addActivity']>((input) => {
    const activity: Activity = {
      id: nextId('a'),
      userId: currentUser.id,
      activityDate: TODAY.toISOString(),
      createdAt: nowIso(),
      ...input,
    }
    setActivities((prev) => [activity, ...prev])
    return activity
  }, [])

  const addLead = useCallback<AppActions['addLead']>((input) => {
    const lead: Lead = {
      id: nextId('l'),
      leadNumber: nextLeadNumber(),
      status: 'New',
      source: 'Direct',
      score: 10,
      estimatedValue: 0,
      ownerId: currentUser.id,
      createdAt: TODAY.toISOString(),
      updatedAt: TODAY.toISOString(),
      ...input,
    }
    setLeads((prev) => [lead, ...prev])
    addActivity({ type: 'Note', subject: `New lead created: ${lead.firstName} ${lead.lastName}`, leadId: lead.id, companyId: lead.companyId })
    return lead
  }, [addActivity])

  const updateLead = useCallback<AppActions['updateLead']>((id, patch) => {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch, updatedAt: TODAY.toISOString() } : l)))
  }, [])

  const markLeadLost = useCallback<AppActions['markLeadLost']>((leadId) => {
    updateLead(leadId, { status: 'Lost' as LeadStatus })
    addActivity({ type: 'Status change', subject: 'Lead marked as Lost', leadId })
  }, [updateLead, addActivity])

  const deleteLead = useCallback<AppActions['deleteLead']>((leadId) => {
    setLeads((prev) => prev.filter((l) => l.id !== leadId))
  }, [])

  const addDeal = useCallback<AppActions['addDeal']>((input) => {
    const deal: Deal = {
      id: nextId('d'),
      ownerId: currentUser.id,
      stage: 'New Lead',
      value: 0,
      probability: 10,
      expectedCloseDate: TODAY.toISOString(),
      source: 'Direct',
      createdAt: TODAY.toISOString(),
      ...input,
    }
    setDeals((prev) => [deal, ...prev])
    addActivity({ type: 'Deal update', subject: `New deal created: ${deal.name}`, dealId: deal.id, companyId: deal.companyId })
    return deal
  }, [addActivity])

  const updateDeal = useCallback<AppActions['updateDeal']>((id, patch) => {
    setDeals((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }, [])

  const moveDealStage = useCallback<AppActions['moveDealStage']>((id, stage) => {
    setDeals((prev) =>
      prev.map((d) => {
        if (d.id !== id) return d
        const patch: Partial<Deal> = { stage }
        if (stage === 'Won') patch.wonAt = TODAY.toISOString()
        if (stage === 'Lost') patch.lostAt = TODAY.toISOString()
        return { ...d, ...patch }
      }),
    )
    const deal = deals.find((d) => d.id === id)
    addActivity({
      type: stage === 'Won' ? 'Deal Won' : stage === 'Lost' ? 'Deal Lost' : 'Deal Stage Change',
      subject: `${deal?.name ?? 'Deal'} moved to ${stage}`,
      dealId: id,
      companyId: deal?.companyId,
    })
  }, [deals, addActivity])

  const markDealWon = useCallback<AppActions['markDealWon']>((id, details) => {
    setDeals((prev) =>
      prev.map((d) =>
        d.id === id
          ? { ...d, stage: 'Won' as DealStage, value: details.finalValue, service: details.service, wonAt: TODAY.toISOString(), notes: `${d.notes ?? ''}\nContract start: ${details.startDate}. Duration: ${details.contractDuration}.`.trim() }
          : d,
      ),
    )
    const deal = deals.find((d) => d.id === id)
    addActivity({ type: 'Deal Won', subject: `${deal?.name ?? 'Deal'} marked Won — ${details.service}, starting ${details.startDate}`, dealId: id, companyId: deal?.companyId })
  }, [deals, addActivity])

  const markDealLost = useCallback<AppActions['markDealLost']>((id, reason) => {
    setDeals((prev) => prev.map((d) => (d.id === id ? { ...d, stage: 'Lost' as DealStage, lossReason: reason, lostAt: TODAY.toISOString() } : d)))
    const deal = deals.find((d) => d.id === id)
    addActivity({ type: 'Deal Lost', subject: `${deal?.name ?? 'Deal'} marked Lost — reason: ${reason}`, dealId: id, companyId: deal?.companyId })
  }, [deals, addActivity])

  const addProposal = useCallback<AppActions['addProposal']>((input) => {
    const proposal: Proposal = {
      id: nextId('p'),
      status: 'Draft',
      validityDate: new Date(TODAY.getTime() + 1000 * 60 * 60 * 24 * 30).toISOString(),
      createdAt: TODAY.toISOString(),
      ...input,
    }
    setProposals((prev) => [proposal, ...prev])
    addActivity({ type: 'Proposal', subject: `Proposal created: ${proposal.service}`, dealId: proposal.dealId, companyId: proposal.companyId })
    return proposal
  }, [addActivity])

  const updateProposal = useCallback<AppActions['updateProposal']>((id, patch) => {
    setProposals((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }, [])

  const convertLeadToDeal = useCallback<AppActions['convertLeadToDeal']>((leadId, dealValue) => {
    const lead = leads.find((l) => l.id === leadId)
    if (!lead) return undefined

    let companyId = lead.companyId
    if (!companyId) {
      const company = addCompanyInternal({ name: lead.companyName, industry: lead.industry, province: lead.province, city: lead.city })
      companyId = company.id
    }

    let contactId: ID | undefined
    const existingContact = contacts.find((c) => c.companyId === companyId && c.firstName === lead.firstName && c.lastName === lead.lastName)
    if (existingContact) {
      contactId = existingContact.id
    } else {
      const contact: Contact = {
        id: nextId('ct'),
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
      setContacts((prev) => [contact, ...prev])
      contactId = contact.id
    }

    const deal: Deal = {
      id: nextId('d'),
      name: `${lead.companyName} Deal`,
      companyId,
      contactId,
      ownerId: lead.ownerId,
      stage: 'Qualified',
      value: dealValue ?? lead.estimatedValue,
      probability: 40,
      expectedCloseDate: new Date(TODAY.getTime() + 1000 * 60 * 60 * 24 * 30).toISOString(),
      service: lead.serviceInterested,
      source: lead.source,
      createdAt: TODAY.toISOString(),
      leadId: lead.id,
    }
    setDeals((prev) => [deal, ...prev])

    setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, status: 'Converted' as LeadStatus, convertedDealId: deal.id, updatedAt: TODAY.toISOString() } : l)))
    addActivity({ type: 'Status change', subject: `Lead converted to deal: ${deal.name}`, leadId, dealId: deal.id, companyId })
    return deal
  }, [leads, contacts])

  function addCompanyInternal(input: Partial<Company> & { name: string }): Company {
    const company: Company = {
      id: nextId('co'),
      accountOwnerId: currentUser.id,
      createdAt: TODAY.toISOString(),
      ...input,
    }
    setCompanies((prev) => [company, ...prev])
    return company
  }

  const addCompany = useCallback<AppActions['addCompany']>((input) => addCompanyInternal(input), [])

  const addContact = useCallback<AppActions['addContact']>((input) => {
    const contact: Contact = {
      id: nextId('ct'),
      ownerId: currentUser.id,
      createdAt: TODAY.toISOString(),
      ...input,
    }
    setContacts((prev) => [contact, ...prev])
    return contact
  }, [])

  const addTask = useCallback<AppActions['addTask']>((input) => {
    const task: Task = {
      id: nextId('tk'),
      type: 'Follow-up',
      status: 'Not Started',
      priority: 'Medium',
      ownerId: currentUser.id,
      createdAt: TODAY.toISOString(),
      ...input,
    }
    setTasks((prev) => [task, ...prev])
    addActivity({ type: 'Task', subject: `Task created: ${task.title}`, leadId: task.leadId, dealId: task.dealId, companyId: task.companyId })
    return task
  }, [addActivity])

  const updateTask = useCallback<AppActions['updateTask']>((id, patch) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }, [])

  const value = useMemo<AppState & AppActions>(
    () => ({
      leads,
      deals,
      contacts,
      companies,
      tasks,
      activities,
      proposals,
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
      addTask,
      updateTask,
      addActivity,
      addProposal,
      updateProposal,
    }),
    [
      leads,
      deals,
      contacts,
      companies,
      tasks,
      activities,
      proposals,
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
      addTask,
      updateTask,
      addActivity,
      addProposal,
      updateProposal,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useAppStore() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useAppStore must be used within AppStoreProvider')
  return ctx
}
