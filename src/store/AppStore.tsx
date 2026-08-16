import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import {
  activities as initialActivities,
  companies as initialCompanies,
  contacts as initialContacts,
  currentUser,
  deals as initialDeals,
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
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [activities, setActivities] = useState<Activity[]>(initialActivities)
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
