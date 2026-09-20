import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  UserPlus, ArrowLeft, ArrowRight, Mail, Phone, Globe, StickyNote, Pencil, Handshake,
  CalendarClock, Users2, Link2, Unlink, Trash2, Inbox, MessageSquare, Plus,
} from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { DashboardHero } from '../../components/dashboard/DashboardHero'
import { Card, CardHeader } from '../../components/ui/Card'
import { StatusBadge, StageBadge, ClassificationBadge, ServiceBadge } from '../../components/ui/Badge'
import { InlineSelect } from '../../components/ui/InlineSelect'
import {
  ACTION_BASE, ACTION_ENABLED, RecordAction, RecordActions, RecordFigure, RecordFigures,
  RecordActionsMore, RecordFigureShell, RecordLayout, RecordLayoutSwitcher, RecordMoreAction,
  RecordTabs, useRecordLayout,
} from '../../components/record/RecordShell'
import { CrmCallButton } from '../../components/record/CrmCallButton'
import { CrmSmsModal } from '../../components/record/CrmSmsModal'
import {
  RecordComment, RecordCommentFact, RecordCommentSummary,
} from '../../components/record/RecordComment'
import { PhoneLink } from '../../components/PhoneLink'
import { UserAvatar } from '../../components/ui/Avatar'
import { Modal, FormField, inputClass } from '../../components/ui/Modal'
import { AddDealModal, QuickLogModal, ScheduleFollowUpModal, ScheduleMeetingModal } from '../../components/QuickModals'
import { ComposeEmailModal } from '../../components/ComposeEmailModal'
import { WriteButton } from '../../components/email/MessageActions'
import { EditContactModal } from '../../components/contacts/EditContactModal'
import { AddContactModal } from '../../components/contacts/AddContactModal'
import { formatCurrency, formatDate, leadClassifications } from '../../data/mockData'
import { openingFor, type ComposeOpening } from '../../lib/emailActivity'
import { buildDrilldownUrl } from '../../lib/drilldown'
import { RowLimitSelect, applyRowLimitKeeping, type RowLimit } from '../../components/ui/RowLimitSelect'
import { useFocusedEmailId } from '../../lib/focusedEmail'
import { fetchBookSummary, type BookSummary } from '../../lib/accountBook'
import { HeroOwner } from '../../components/RecordOwner'
import { ClientQueries } from './ClientQueries'
import { EmailActivityList } from '../../components/EmailActivityRow'
import { NoteActivityList } from '../../components/NoteActivityRow'
import { LogHandoverModal } from '../../components/companies/LogHandoverModal'
import { AddDebtorModal } from '../../components/companies/AddDebtorModal'
import { createDebtorAccount, fetchAccountReferences, fetchClientCommissionRate } from '../../lib/accountBook'
import { toAccountRow, toContactRows, type NewDebtorInput } from '../../lib/newDebtor'
import { HandoverBook } from '../../components/companies/HandoverBook'
import type { Company, Contact, ProductService } from '../../types'
import { isAssignableOwner } from '../../lib/permissions'
import { summaryLine } from '../../lib/summaryLine'

type ClientTab = 'Overview' | 'Emails' | 'Notes' | 'Tasks'

export function CompanyDetail() {
  const focusedEmailId = useFocusedEmailId()
  const { id } = useParams()
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  /*
   * Every address that is US, so a reply-all never copies the sender back into their own thread.
   * A list rather than one address: mail reaches an agent at their own address and at whatever
   * the firm forwards to them.
   */
  const mine = useMemo(
    () => [currentUser?.email].filter((a): a is string => !!a),
    [currentUser?.email],
  )
  const {
    companies,
    contacts,
    leads,
    deals,
    activities,
    tasks,
    users,
    addActivity,
    addHandover,
    updateCompany,
    updateContact,
    addContact,
    deleteCompany,
    addCompany,
    addDeal,
    addTask,
  } = useAppStore()
  const company = companies.find((c) => c.id === id)
  const isAdmin = currentUser?.role === 'Administrator'
  const reps = useMemo(() => users.filter((u) => isAssignableOwner(u.role)), [users])
  const [noteOpen, setNoteOpen] = useState(false)
  const [courtesyCallOpen, setCourtesyCallOpen] = useState(false)
  const [handoverOpen, setHandoverOpen] = useState(false)
  // Adding a debtor by hand. The references are fetched when the modal opens rather than on every
  // page load: they are only ever used to propose the next number in the client's series.
  const [debtorOpen, setDebtorOpen] = useState(false)
  const [debtorRefs, setDebtorRefs] = useState<string[]>([])
  const [debtorBusy, setDebtorBusy] = useState(false)
  const [debtorError, setDebtorError] = useState<string | null>(null)
  const [ownerOpen, setOwnerOpen] = useState(false)
  const [dealOpen, setDealOpen] = useState(false)
  const [followUpOpen, setFollowUpOpen] = useState(false)
  const [meetingOpen, setMeetingOpen] = useState(false)
  const [parentOpen, setParentOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [contactEmailTarget, setContactEmailTarget] = useState<Contact | null>(null)
  const [editContact, setEditContact] = useState<Contact | null>(null)
  const [editCompanyOpen, setEditCompanyOpen] = useState(false)
  const [addContactOpen, setAddContactOpen] = useState(false)
  /**
   * The composer's opening, for whichever of the three answers was pressed.
   *
   * One state for reply, reply-all and forward rather than three: they open the same modal with
   * different fields, and three states is how a forward ends up carrying a reply's Cc line.
   */
  const [replyTarget, setReplyTarget] = useState<
    (ComposeOpening & { contactId?: string }) | null
  >(null)
  const [emailLimit, setEmailLimit] = useState<RowLimit>(5)
  const [noteLimit, setNoteLimit] = useState<RowLimit>(5)
  const [composeOpen, setComposeOpen] = useState(false)
  const [composeTarget, setComposeTarget] = useState<{ to: string; contactId?: string } | null>(null)

  const companyContacts = useMemo(() => contacts.filter((c) => c.companyId === id), [contacts, id])
  const companyLeads = useMemo(() => leads.filter((l) => l.companyId === id), [leads, id])
  const companyDeals = useMemo(() => deals.filter((d) => d.companyId === id), [deals, id])
  // The signed mandate a batch arrives under, so a handover is tied to the agreement it came
  // in on rather than floating against the client in general.
  const mandateDeal = useMemo(
    () => companyDeals.find((d) => d.stage === 'Won' && d.handoverAmount != null),
    [companyDeals],
  )
  const openDeals = companyDeals.filter((d) => d.stage !== 'Won' && d.stage !== 'Rejected')
  const wonDeals = companyDeals.filter((d) => d.stage === 'Won')
  const subAccounts = useMemo(() => companies.filter((c) => c.parentCompanyId === id), [companies, id])
  const isClient = wonDeals.length > 0 || !!company?.code
  /*
   * Every number that could reach this client.
   *
   * A company has one switchboard number of its own; the people are on the contacts below. The
   * Call button rings the one there is, which is what somebody phoning a client expects.
   */
  /*
   * Which tab, and how the Overview is arranged. The layout key is per page type rather than per
   * client: it is a preference about eyes, not about a company.
   */
  const [tab, setTab] = useState<ClientTab>('Overview')
  const [layout, chooseLayout] = useRecordLayout('raptor.client.layout')
  const [smsOpen, setSmsOpen] = useState(false)

  /*
   * What this client actually buys, taken from their deals.
   *
   * A company carries no services column of its own: what they wanted was captured on the lead
   * and what they signed is on the deals, so the deals are the honest answer to "what do we do
   * for them?".
   */
  const companyServices = useMemo(
    () => [...new Set(companyDeals.map((d) => d.service).filter(Boolean))] as ProductService[],
    [companyDeals],
  )

  const clientNumbers = useMemo(
    () => (company?.phone ? [{ label: 'Switchboard', value: company.phone }] : []),
    [company?.phone],
  )
  const companyActivities = useMemo(
    () => activities.filter((a) => a.companyId === id).sort((a, b) => new Date(b.activityDate).getTime() - new Date(a.activityDate).getTime()),
    [activities, id],
  )
  const emailActivities = useMemo(() => companyActivities.filter((a) => a.type === 'Email'), [companyActivities])
  const nonEmailActivities = useMemo(() => companyActivities.filter((a) => a.type !== 'Email'), [companyActivities])
  const companyTasks = useMemo(() => tasks.filter((t) => t.companyId === id), [tasks, id])
  const lifetimeValue = wonDeals.reduce((s, d) => s + d.value, 0)
  // Paid-to-date vs. handover amount. Can exceed 100% — payments here include
  // fees on top of the handover amount, which this system deliberately never
  // discloses, so the ratio isn't meant to cap at 100.
  const collectionsCoefficient =
    company?.handoverAmount !== undefined && company.handoverAmount > 0 && company?.paymentsToDate !== undefined
      ? (company.paymentsToDate / company.handoverAmount) * 100
      : undefined

  if (!company) {
    return (
      <div className="text-center py-16 text-slate-400">
        Client not found. <Link to="/companies" className="text-brand-600 hover:underline">Back to clients</Link>
      </div>
    )
  }

  /*
   * The panels, built once and placed by whichever layout is chosen.
   *
   * Defining them here rather than three times over is the whole reason the layouts can be
   * trusted to stay the same page: a prop added to one arrangement cannot be forgotten in the
   * other two, and that bug is invisible until somebody switches layout.
   */
  /** Who to ring, and the people you deal with there. */
  const contactPanel = (
    <Card className="@container">
      <CardHeader
        title="Contact Details"
        action={
          <button onClick={() => setEditCompanyOpen(true)} className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
            <Pencil size={12} /> Edit
          </button>
        }
      />
      {/*
        Three across when the CARD is wide enough, stacked when it is not. `sm:` asks about the
        WINDOW, so in the three-column layout this laid out three columns inside a 300px card and
        ran an email address off its right-hand edge. See the same note on the lead page.
      */}
      <div className="grid grid-cols-1 @md:grid-cols-3 gap-3 text-sm mb-4 pb-4 border-b border-slate-100">
        <div>
          <p className="text-xs text-slate-400 mb-0.5">Phone</p>
          {company.phone ? (
            <PhoneLink number={company.phone} className="inline-flex items-center gap-1.5 text-slate-700 font-medium hover:text-brand-600" log={{ label: company.name, companyId: company.id }} />
          ) : (
            <span className="text-slate-300">—</span>
          )}
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-0.5">Email</p>
          {company.email ? (
            <span className="inline-flex items-center gap-1.5 text-slate-700 font-medium">
              <button onClick={() => setEmailOpen(true)} className="text-slate-400 hover:text-brand-600" title="Send email">
                <Mail size={13} />
              </button>
              {company.email}
            </span>
          ) : (
            <span className="text-slate-300">—</span>
          )}
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-0.5">Website</p>
          {company.website ? (
            <span className="inline-flex items-center gap-1.5 text-slate-700 font-medium">
              <Globe size={13} /> {company.website}
            </span>
          ) : (
            <span className="text-slate-300">—</span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-slate-400">Contact Persons</p>
        <button onClick={() => setAddContactOpen(true)} className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
          <Plus size={12} /> Add Contact
        </button>
      </div>
      {companyContacts.length === 0 ? (
        <p className="text-sm text-slate-400">No contact persons yet.</p>
      ) : (
        <div className="space-y-1">
          {companyContacts.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 hover:bg-slate-50 -mx-1 px-2 py-2 rounded-lg">
              <Link to={`/contacts/${c.id}`} className="flex items-center gap-2.5 min-w-0">
                <UserAvatar userId={c.ownerId} size={30} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-700 hover:text-brand-600 truncate">{c.firstName} {c.lastName}</p>
                  <p className="text-xs text-slate-400 truncate">{c.jobTitle}</p>
                </div>
              </Link>
              <div className="flex items-center gap-3 text-xs text-slate-500 shrink-0">
                {c.phone && (
                  <PhoneLink number={c.phone} iconSize={11} className="inline-flex items-center gap-1 hover:text-brand-600" log={{ label: `${c.firstName} ${c.lastName}`, contactId: c.id, companyId: company.id }} />
                )}
                {c.mobile && (
                  <PhoneLink number={c.mobile} iconSize={11} className="inline-flex items-center gap-1 hover:text-brand-600" log={{ label: `${c.firstName} ${c.lastName}`, contactId: c.id, companyId: company.id }}>
                    <Phone size={11} /> {c.mobile} <span className="text-slate-300">mobile</span>
                  </PhoneLink>
                )}
                {c.email && (
                  <span className="inline-flex items-center gap-1">
                    <button onClick={() => setContactEmailTarget(c)} className="text-slate-400 hover:text-brand-600" title="Send email">
                      <Mail size={11} />
                    </button>
                    {c.email}
                  </span>
                )}
                <button onClick={() => setEditContact(c)} className="text-slate-400 hover:text-brand-600" title="Edit contact">
                  <Pencil size={11} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )

  /** The clients grouped under this one. */
  const subAccountsPanel = subAccounts.length > 0 && (
    <Card padded={false}>
      <div className="p-5 pb-3">
        <CardHeader title="Sub-accounts" subtitle={`${subAccounts.length} under this client`} />
      </div>
      <div className="overflow-x-auto px-5 pb-5">
        <table className="w-full text-sm border border-slate-100 rounded-xl overflow-hidden">
          <thead>
            <tr className="text-left text-xs text-slate-400 bg-slate-50/70">
              <th className="font-medium px-4 py-2.5">Sub-account</th>
              <th className="font-medium px-3 py-2.5">Code</th>
              <th className="font-medium px-3 py-2.5 text-right">Accounts</th>
              <th className="font-medium px-3 py-2.5 text-right">Handover Amount</th>
              <th className="font-medium px-3 py-2.5 text-right">Payments to Date</th>
            </tr>
          </thead>
          <tbody>
            {subAccounts.map((s) => (
              <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50/60 cursor-pointer" onClick={() => navigate(`/companies/${s.id}`)}>
                <td className="px-4 py-2.5">
                  <Link to={`/companies/${s.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-slate-700 hover:text-brand-600">
                    {s.name}
                  </Link>
                </td>
                <td className="px-3 py-2.5">
                  {s.code ? <span className="font-mono text-[11px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md">{s.code}</span> : '—'}
                </td>
                <td className="px-3 py-2.5 text-right text-slate-600 tabular-nums">{s.accountCount ?? '—'}</td>
                <td className="px-3 py-2.5 text-right text-slate-600 tabular-nums">{s.handoverAmount !== undefined ? formatCurrency(s.handoverAmount) : '—'}</td>
                <td className="px-3 py-2.5 text-right text-slate-600 tabular-nums">{s.paymentsToDate !== undefined ? formatCurrency(s.paymentsToDate) : '—'}</td>
              </tr>
            ))}
            <tr className="border-t border-slate-200" style={{ background: 'rgba(236,220,184,0.25)' }}>
              <td className="px-4 py-2.5 font-bold text-slate-800">Total</td>
              <td className="px-3 py-2.5"></td>
              <td className="px-3 py-2.5 text-right font-bold text-slate-800 tabular-nums">{subAccounts.reduce((s, a) => s + (a.accountCount ?? 0), 0)}</td>
              <td className="px-3 py-2.5 text-right font-bold text-slate-800 tabular-nums">{formatCurrency(subAccounts.reduce((s, a) => s + (a.handoverAmount ?? 0), 0))}</td>
              <td className="px-3 py-2.5 text-right font-bold text-slate-800 tabular-nums">{formatCurrency(subAccounts.reduce((s, a) => s + (a.paymentsToDate ?? 0), 0))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  )

  /** Its own tab: a list that grows without limit does not belong on an overview. */
  const emailsPanel = (
    <Card>
      <CardHeader
        title="Emails"
        subtitle={`${emailActivities.length} message${emailActivities.length === 1 ? '' : 's'}`}
        action={
          <div className="flex items-center gap-2">
            <WriteButton onClick={() => setComposeOpen(true)} />
            <RowLimitSelect value={emailLimit} onChange={setEmailLimit} />
          </div>
        }
      />
      {emailActivities.length === 0 ? (
        <p className="text-sm text-slate-400">No emails yet.</p>
      ) : (
        <EmailActivityList
          activities={applyRowLimitKeeping(emailActivities, emailLimit, focusedEmailId)}
            focusId={focusedEmailId}
          showDeal
          mine={mine}
          onAnswer={(a, mode) => {
            const theirAddress = a.contactId
              ? contacts.find((c) => c.id === a.contactId)?.email
              : company.email
            /* A forward needs no address — it is going to somebody who was not on the thread. */
            if (!theirAddress && mode !== 'forward') return
            setReplyTarget({
              ...openingFor(
                {
                  rawSubject: a.subject,
                  fromName: null,
                  fromAddress: theirAddress ?? null,
                  to: a.emailToRecipients ?? [],
                  cc: a.emailCcRecipients ?? [],
                  body: a.notes ?? '',
                  occurredAt: a.activityDate,
                  messageId: a.emailMessageId ?? null,
                },
                mode,
                mine,
              ),
              contactId: a.contactId,
            })
          }}
        />
      )}
    </Card>
  )

  /** Everything that is not an email — courtesy calls, meetings, notes. */
  const notesPanel = (
    <Card>
      <CardHeader
        title="Notes"
        subtitle={`${nonEmailActivities.length} update${nonEmailActivities.length === 1 ? '' : 's'}`}
        action={<RowLimitSelect value={noteLimit} onChange={setNoteLimit} />}
      />
      {nonEmailActivities.length === 0 ? (
        <p className="text-sm text-slate-400">No activity recorded yet.</p>
      ) : (
        <div className="space-y-2.5">
          <NoteActivityList activities={nonEmailActivities} limit={noteLimit} />
        </div>
      )}
    </Card>
  )

  /** What is still being sold to them. */
  const openDealsPanel = (
    <Card>
      <CardHeader title="Open Deals" subtitle={`${openDeals.length} active`} />
      {openDeals.length === 0 ? (
        <p className="text-sm text-slate-400">No open deals.</p>
      ) : (
        <div className="divide-y divide-slate-50">
          {openDeals.map((d) => (
            <Link key={d.id} to={`/deals/${d.id}`} className="flex items-center justify-between py-2.5 hover:bg-slate-50/60 -mx-1 px-1 rounded-lg">
              <span className="text-sm font-medium text-slate-700">{d.name}</span>
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-500">{formatCurrency(d.value)}</span>
                <StageBadge stage={d.stage} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </Card>
  )

  /** What they have already signed. */
  const wonDealsPanel = (
    <Card>
      <CardHeader title="Won Deals" subtitle={`${wonDeals.length} closed`} />
      {wonDeals.length === 0 ? (
        <p className="text-sm text-slate-400">No won deals yet.</p>
      ) : (
        <div className="divide-y divide-slate-50">
          {wonDeals.map((d) => (
            <Link key={d.id} to={`/deals/${d.id}`} className="flex items-center justify-between py-2.5 hover:bg-slate-50/60 -mx-1 px-1 rounded-lg">
              <span className="text-sm font-medium text-slate-700">{d.name}</span>
              <span className="text-sm font-semibold text-[var(--c-gold-deep)]">{formatCurrency(d.value)}</span>
            </Link>
          ))}
        </div>
      )}
    </Card>
  )

  /** The leads this client came from. */
  const leadsPanel = (
    <Card>
      <CardHeader title="Leads" />
      {companyLeads.length === 0 ? (
        <p className="text-sm text-slate-400">No leads for this company.</p>
      ) : (
        <div className="divide-y divide-slate-50">
          {companyLeads.map((l) => (
            <Link key={l.id} to={`/leads/${l.id}`} className="flex items-center justify-between py-2.5 hover:bg-slate-50/60 -mx-1 px-1 rounded-lg">
              <span className="text-sm font-medium text-slate-700">{l.firstName} {l.lastName}</span>
              <StatusBadge status={l.status} />
            </Link>
          ))}
        </div>
      )}
    </Card>
  )

  /** The firmographics. */
  const companyInfoPanel = (
    <Card>
      <CardHeader title="Company Information" />
      <dl className="space-y-3 text-sm">
        <Field label="Industry" value={company.industry} />
        <Field label="Province" value={company.province} />
        <Field label="City" value={company.city} />
        <Field label="Address" value={company.address} />
        <Field label="Signed by (Marketing Agent)" value={company.marketingAgent} />
        <div className="flex justify-between gap-3 items-center">
          <dt className="text-slate-400">Account Owner</dt>
          <dd className="flex items-center gap-1.5">
            <span className="text-slate-700 font-medium">{users.find((u) => u.id === company.accountOwnerId)?.name ?? '—'}</span>
            <button onClick={() => setOwnerOpen(true)} className="p-1 rounded-lg text-slate-300 hover:text-slate-600 hover:bg-slate-100">
              <Pencil size={12} />
            </button>
          </dd>
        </div>
        {company.mandateSignedAt && <Field label="Mandate Signed" value={formatDate(company.mandateSignedAt)} />}
        <Field label="Created" value={formatDate(company.createdAt)} />
      </dl>
    </Card>
  )

  /** Its own tab as well: a task list is work, not context. */
  const tasksPanel = (
    <Card>
      <CardHeader title="Tasks" />
      {companyTasks.length === 0 ? (
        <p className="text-sm text-slate-400">No tasks yet.</p>
      ) : (
        <div className="space-y-2">
          {companyTasks.map((t) => (
            <div key={t.id} className="text-sm">
              <p className="text-slate-700">{t.title}</p>
              <p className="text-xs text-slate-400">Due {formatDate(t.dueDate)}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  )

  return (
    <div className="space-y-5">
      <Link to="/companies" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={15} /> Back to Clients
      </Link>

      <DashboardHero
        eyebrow={company.parentCompanyId ? 'Sub-account' : 'Client'}
        title={
          <span className="inline-flex items-center gap-2">
            {company.name}
            {company.code && (
              <span className="font-mono text-[11px] font-bold text-navy-950 bg-gold-400 px-2 py-0.5 rounded-md align-middle">{company.code}</span>
            )}
          </span>
        }
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            {company.parentCompanyId && (
              <>
                <span>Sub-account of</span>
                <Link to={`/companies/${company.parentCompanyId}`} className="text-gold-400 hover:underline">
                  {companies.find((c) => c.id === company.parentCompanyId)?.name}
                </Link>
                <button
                  onClick={() => updateCompany(company.id, { parentCompanyId: undefined })}
                  className="inline-flex items-center text-white/60 hover:text-white"
                  title="Make this an independent client"
                  aria-label="Make this an independent client"
                >
                  <Unlink size={12} />
                </button>
                <span className="text-white/30">·</span>
              </>
            )}
            {(() => {
              const line = summaryLine([company.industry, summaryLine([company.city, company.province], ', ')])
              return line ? <span>{line}</span> : null
            })()}
          </span>
        }
      >
        <HeroOwner ownerId={company.accountOwnerId} label="Client Liaison" />
      </DashboardHero>

      {/*
        The same row of figures the Account and Lead pages wear, from the same component.

        It used to be a line of stats inside a card, at a different size, in a different order to
        the debtor page next door. The firm's point: a client liaison moving between a client and
        the debtors they handed over should not have to learn the page twice.
      */}
      <RecordFigures count={collectionsCoefficient !== undefined ? 6 : 5}>
        {/* Class sits first because it applies to every client, and it was previously invisible
            on any client without handover totals — including the ungraded ones, which are
            exactly the ones you would want to grade. */}
        <RecordFigureShell label="Class">
          <InlineSelect
            value={company.classification}
            options={leadClassifications}
            onChange={(classification) => updateCompany(company.id, { classification })}
          >
            {company.classification ? (
              <ClassificationBadge classification={company.classification} />
            ) : (
              <span className="text-xs text-slate-400 border border-dashed border-slate-200 rounded-md px-2 py-1">Not yet graded</span>
            )}
          </InlineSelect>
        </RecordFigureShell>

        <RecordFigure label="Accounts" value={String(company.accountCount ?? 0)}
          note="handed over to us" />
        <RecordFigure label="Handover amount" value={formatCurrency(company.handoverAmount ?? 0)}
          note={company.estimatedHandoverAmount != null
            ? `estimated ${formatCurrency(company.estimatedHandoverAmount)} at signup`
            : 'capital in the book'} />
        <RecordFigure label="Paid to date" value={formatCurrency(company.paymentsToDate ?? 0)} strong />
        {collectionsCoefficient !== undefined && (
          /* Can exceed 100%: payments here include fees on top of the handover amount, which
             this system deliberately never discloses, so the ratio is not meant to cap. */
          <RecordFigure label="Coefficient" value={`${collectionsCoefficient.toFixed(0)}%`}
            note="of what was handed over" />
        )}
        <RecordFigure label="Deals won" value={formatCurrency(lifetimeValue)}
          note={`${openDeals.length} open`}
          onClick={() => navigate(buildDrilldownUrl('/deals', { company: company.id, open: '1', view: 'table' }))}
          title="Open this client's deals" />
      </RecordFigures>

      {/*
        The two lines the next person needs, and the facts they would otherwise go hunting for.

        Above the actions, exactly where it sits on a debtor's account, because it answers the
        question somebody opens the page with — what is going on here? — before they decide which
        button to press. The deals and the book ride along with it: they lived several panels
        down, and this puts them where the eye already is.
      */}
      <RecordComment
        text={company.mainComment}
        at={company.mainCommentAt}
        placeholder="Where does this client stand? Two lines is plenty."
        onSave={(text) => updateCompany(company.id, {
          mainComment: text || undefined,
          mainCommentAt: new Date().toISOString(),
          mainCommentBy: currentUser?.id,
        })}
        summary={(
          <RecordCommentSummary>
            <RecordCommentFact label="Services">
              {companyServices.length > 0
                ? companyServices.map((sv) => <ServiceBadge key={sv} service={sv} />)
                : <span className="text-slate-400">Nothing signed yet</span>}
            </RecordCommentFact>
            <RecordCommentFact label="Deals">
              {companyDeals.length === 0
                ? <span className="text-slate-400">None yet</span>
                : (
                  <>
                    <span className="font-medium tabular-nums">{formatCurrency(lifetimeValue)}</span>
                    <span className="text-slate-400">won · {openDeals.length} still open</span>
                  </>
                )}
            </RecordCommentFact>
            <RecordCommentFact label="Book">
              {company.accountCount
                ? (
                  <>
                    <span className="font-medium tabular-nums">{formatCurrency(company.handoverAmount ?? 0)}</span>
                    <span className="text-slate-400">over {company.accountCount} accounts</span>
                  </>
                )
                : <span className="text-slate-400">Nothing handed over</span>}
            </RecordCommentFact>
          </RecordCommentSummary>
        )}
      />

      <Card>

        {company.estimatedHandoverAmount != null && (
          <p className="text-xs text-slate-400 mt-3">
            Estimated at signup: {formatCurrency(company.estimatedHandoverAmount)}
            {company.estimatedAccountsCount != null ? ` across ${company.estimatedAccountsCount} accounts` : ''}
            {company.estimatedAtConversion ? ` · ${formatDate(company.estimatedAtConversion)}` : ''}
            <span className="text-slate-300"> — what they said they'd hand over, kept for the record. The figures above are actual.</span>
          </p>
        )}

        <div className="mt-4 pt-4 border-t border-slate-100">
          {/*
            The same action row as the Account and Lead pages, in the same order of thought:
            reach them first, then record what happened, then move the record on. A client page
            whose first button was "Add Deal" put the paperwork before the phone.

            Nothing here charges anybody. Every comparable action on a debtor raises an Annexure B
            fee, because a debtor pays for the work of collecting from them — a client is the
            person paying US. See CrmCallButton, which never reaches the charge engine.
          */}
          <RecordActions>
            <CrmCallButton
              numbers={clientNumbers}
              to={{ companyId: company.id }}
              subject={company.name}
              className={`${ACTION_BASE} ${ACTION_ENABLED}`}
            />
            <RecordAction icon={MessageSquare} label="SMS"
              onClick={clientNumbers.length > 0 ? () => setSmsOpen(true) : undefined}
              title={clientNumbers.length > 0
                ? 'Text this client — nothing is charged'
                : 'No phone number on this client yet'} />
            <RecordAction icon={Mail} label="Email"
              onClick={company.email ? () => setEmailOpen(true) : undefined}
              title={company.email ? 'Send from your connected mailbox' : 'No email address on this client yet'} />
            <RecordAction icon={StickyNote} label="Add Note" onClick={() => setNoteOpen(true)}
              title="Write on the timeline" />
            {isClient && (
              <RecordAction icon={Inbox} label="Import Handover" onClick={() => setHandoverOpen(true)} primary
                title="Bring a batch of accounts into the book" />
            )}

            {/*
              Everything else, folded away. Twelve buttons wrapped to three lines on an iPad and
              pushed the panels below off the screen; nothing is removed, because the fix for a
              crowded row is not to take away the button somebody needs twice a month.
            */}
            <RecordActionsMore>
              {/*
                First in the menu, beside the import, because they are the two ways an account
                gets into the book and a person looking for one will look for the other. The
                import takes a batch; this takes the single account a client phones in.
              */}
              {isClient && (
                <RecordMoreAction icon={UserPlus} label="Add debtor"
                  onClick={async () => {
                    setDebtorError(null)
                    // Fetched BEFORE the modal opens, not alongside it. The reference it proposes
                    // is worked out once when the form mounts, so references arriving a moment
                    // later would leave the field blank — which is exactly what it did.
                    setDebtorRefs(await fetchAccountReferences(company.id).catch(() => []))
                    setDebtorOpen(true)
                  }} />
              )}
              {isClient && (
                <RecordMoreAction icon={Phone} label="Log courtesy call" onClick={() => setCourtesyCallOpen(true)}
                  title="Record a call you made some other way" />
              )}
              {isClient && <RecordMoreAction icon={CalendarClock} label="Schedule follow-up" onClick={() => setFollowUpOpen(true)} />}
              {isClient && <RecordMoreAction icon={Users2} label="Schedule meeting" onClick={() => setMeetingOpen(true)} />}
              {isClient && <RecordMoreAction icon={Handshake} label="Add deal" onClick={() => setDealOpen(true)} />}
              {subAccounts.length === 0 && (
                <RecordMoreAction icon={Link2}
                  label={company.parentCompanyId ? 'Change parent' : 'Assign to parent'}
                  onClick={() => setParentOpen(true)} />
              )}
              {isAdmin && <RecordMoreAction icon={Trash2} label="Delete" danger onClick={() => setDeleteOpen(true)} />}
            </RecordActionsMore>
          </RecordActions>
        </div>
      </Card>

      {/*
        Tabs over the detail, like the Account and Lead pages — and for the same reason.
        Everything below used to be one scroll: contact details, sub-accounts, every email ever
        sent, every note, the queries, the handover book, then the deals somebody actually came
        for. The long lists get their own tabs so the Overview stays readable at a glance.
      */}
      <RecordTabs<ClientTab>
        tabs={[
          { id: 'Overview', label: 'Overview' },
          { id: 'Emails', label: 'Emails', count: emailActivities.length },
          { id: 'Notes', label: 'Notes', count: nonEmailActivities.length },
          { id: 'Tasks', label: 'Tasks', count: companyTasks.length },
        ]}
        active={tab}
        onChange={setTab}
        /* Only on Overview, because it is the only tab with more than one panel to arrange. */
        trailing={tab === 'Overview'
          ? <RecordLayoutSwitcher layout={layout} onChange={chooseLayout} />
          : undefined}
      />

      {tab === 'Overview' && (
        <RecordLayout
          layout={layout}
          details={contactPanel}
          main={(
            <div className="space-y-5">
              {/* Above the deals: for a debt collection client this IS the relationship. What
                  they signed is one line on a deal; what they actually send is the work. */}
              <HandoverBook company={company} onLog={() => setHandoverOpen(true)} />
              {/* Notes in the middle, and still on their own tab — both places, at the firm's
                  asking. Here they are capped at five with a "show more"; the tab is where you
                  go for the lot. */}
              {notesPanel}
              {openDealsPanel}
              {wonDealsPanel}
            </div>
          )}
          side={[
            <ClientBookCard key="book" companyId={company.id} />,
            /* Beside the handover book, because these are the two things a liaison opens this
               page for: what came in, and what is stuck. */
            <ClientQueries key="queries" companyId={company.id} />,
            companyInfoPanel,
            subAccountsPanel,
            leadsPanel,
          ]}
        />
      )}

      {tab === 'Emails' && emailsPanel}
      {tab === 'Notes' && notesPanel}
      {tab === 'Tasks' && tasksPanel}

      {emailOpen && company.email && (
        <ComposeEmailModal
          to={company.email}
          onClose={() => setEmailOpen(false)}
          onSent={(subject, bodyText) => addActivity({ type: 'Email', subject, notes: bodyText, companyId: company.id })}
        />
      )}
      {contactEmailTarget && contactEmailTarget.email && (
        <ComposeEmailModal
          to={contactEmailTarget.email}
          onClose={() => setContactEmailTarget(null)}
          onSent={(subject, bodyText) =>
            addActivity({ type: 'Email', subject, notes: bodyText, contactId: contactEmailTarget.id, companyId: company.id })
          }
        />
      )}
      {replyTarget && (
        <ComposeEmailModal
          to={replyTarget.to}
          initialCc={replyTarget.cc}
          initialSubject={replyTarget.subject}
          initialBody={replyTarget.body}
          inReplyTo={replyTarget.inReplyTo}
          onClose={() => setReplyTarget(null)}
          onSent={(subject, bodyText) => addActivity({ type: 'Email', subject, notes: bodyText, contactId: replyTarget.contactId, companyId: company.id })}
        />
      )}
      {/* Nothing is charged for this — see CrmSmsModal, which says so on screen too. */}
      {smsOpen && (
        <CrmSmsModal
          numbers={clientNumbers}
          target={{ companyId: company.id }}
          who={company.name}
          onClose={() => setSmsOpen(false)}
          onSent={(a) => addActivity({ type: 'SMS', ...a, companyId: company.id })}
        />
      )}

      {composeOpen && (
        <ChooseRecipientModal
          company={company}
          contacts={companyContacts}
          onClose={() => setComposeOpen(false)}
          onChoose={(target) => {
            setComposeOpen(false)
            setComposeTarget(target)
          }}
        />
      )}
      {composeTarget && (
        <ComposeEmailModal
          to={composeTarget.to}
          onClose={() => setComposeTarget(null)}
          onSent={(subject, bodyText) => addActivity({ type: 'Email', subject, notes: bodyText, contactId: composeTarget.contactId, companyId: company.id })}
        />
      )}
      {editContact && (
        <EditContactModal contact={editContact} onClose={() => setEditContact(null)} onSave={(patch) => updateContact(editContact.id, patch)} />
      )}
      {editCompanyOpen && (
        <EditCompanyDetailsModal company={company} onClose={() => setEditCompanyOpen(false)} onSave={(patch) => updateCompany(company.id, patch)} />
      )}
      {addContactOpen && (
        <AddContactModal onClose={() => setAddContactOpen(false)} onSave={(input) => addContact({ ...input, companyId: company.id })} />
      )}
      {noteOpen && (
        <QuickLogModal
          title="Add Note"
          fieldLabel="Note"
          submitLabel="Add Note"
          onClose={() => setNoteOpen(false)}
          onSave={(text) => addActivity({ type: 'Note', subject: 'Note added', notes: text, companyId: company.id })}
        />
      )}
      {courtesyCallOpen && (
        <QuickLogModal
          title="Log Courtesy Call"
          fieldLabel="What was discussed? (optional)"
          submitLabel="Log Call"
          required={false}
          onClose={() => setCourtesyCallOpen(false)}
          onSave={(text) => addActivity({ type: 'Courtesy Call', subject: `Courtesy call — ${company.name}`, notes: text || undefined, companyId: company.id })}
        />
      )}
      {debtorOpen && (
        <AddDebtorModal
          companyName={company.name}
          existingReferences={debtorRefs}
          busy={debtorBusy}
          error={debtorError}
          onClose={() => setDebtorOpen(false)}
          onSave={async (input: NewDebtorInput) => {
            setDebtorBusy(true); setDebtorError(null)
            try {
              // Commission is the client's, not the account's, so it is inherited rather than
              // typed. It is stored as a fraction everywhere in the system — 0.3 is thirty
              // percent — and passing a percentage through here is what made one account read
              // as 2300% on the accounts list.
              const account = await createDebtorAccount(
                toAccountRow(input, company.id, null, await fetchClientCommissionRate(company.id).catch(() => null)),
                (id) => toContactRows(input, id),
              )
              setDebtorOpen(false)
              navigate(`/accounts/${account.id}`)
            } catch (e) {
              setDebtorError(e instanceof Error ? e.message : String(e))
            } finally {
              setDebtorBusy(false)
            }
          }}
        />
      )}

      {handoverOpen && (
        <LogHandoverModal
          companyName={company.name}
          onClose={() => setHandoverOpen(false)}
          onSave={(input) => addHandover({ ...input, companyId: company.id, dealId: mandateDeal?.id })}
        />
      )}
      {ownerOpen && (
        <EditOwnerModal
          currentOwnerId={company.accountOwnerId}
          reps={reps}
          onClose={() => setOwnerOpen(false)}
          onSave={(accountOwnerId) => updateCompany(company.id, { accountOwnerId })}
        />
      )}
      {dealOpen && <AddDealModal subjectName={company.name} onClose={() => setDealOpen(false)} onSave={(input) => addDeal({ ...input, companyId: company.id })} />}
      {followUpOpen && (
        <ScheduleFollowUpModal
          onClose={() => setFollowUpOpen(false)}
          onSave={(input) => addTask({ ...input, companyId: company.id, relatedToLabel: company.name })}
        />
      )}
      {meetingOpen && (
        <ScheduleMeetingModal
          onClose={() => setMeetingOpen(false)}
          onSave={(input) => addTask({ ...input, type: 'Meeting', companyId: company.id, relatedToLabel: company.name })}
        />
      )}
      {parentOpen && (
        <AssignParentModal
          currentParentId={company.parentCompanyId}
          currentParentName={companies.find((c) => c.id === company.parentCompanyId)?.name}
          candidates={companies.filter((c) => c.id !== company.id && !c.parentCompanyId)}
          onClose={() => setParentOpen(false)}
          onAssignExisting={(parentId) => updateCompany(company.id, { parentCompanyId: parentId })}
          onCreateNew={(name, code) => {
            const parent = addCompany({ name, code: code || undefined, accountOwnerId: company.accountOwnerId })
            updateCompany(company.id, { parentCompanyId: parent.id })
          }}
          onMakeIndependent={() => updateCompany(company.id, { parentCompanyId: undefined })}
        />
      )}
      {deleteOpen && (
        <DeleteClientModal
          company={company}
          subAccountsCount={subAccounts.length}
          dealsCount={companyDeals.length}
          contactsCount={companyContacts.length}
          leadsCount={companyLeads.length}
          onClose={() => setDeleteOpen(false)}
          onConfirm={() => {
            deleteCompany(company.id)
            navigate('/companies')
          }}
        />
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-slate-700 font-medium text-right">{value || '—'}</dd>
    </div>
  )
}

function ChooseRecipientModal({
  company,
  contacts,
  onClose,
  onChoose,
}: {
  company: Company
  contacts: Contact[]
  onClose: () => void
  onChoose: (target: { to: string; contactId?: string }) => void
}) {
  const recipients = [
    ...(company.email ? [{ label: `${company.name} (Client)`, email: company.email, contactId: undefined as string | undefined }] : []),
    ...contacts.filter((c) => c.email).map((c) => ({ label: `${c.firstName} ${c.lastName}${c.jobTitle ? ` — ${c.jobTitle}` : ''}`, email: c.email!, contactId: c.id })),
  ]

  return (
    <Modal title="Write to them" onClose={onClose} width={400}>
      {recipients.length === 0 ? (
        <p className="text-sm text-slate-400">No one here has an email address on file yet.</p>
      ) : (
        <div className="space-y-1">
          {recipients.map((r) => (
            <button
              key={r.contactId ?? 'company'}
              onClick={() => onChoose({ to: r.email, contactId: r.contactId })}
              className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-slate-50 flex items-center justify-between gap-3"
            >
              <span className="text-sm font-medium text-slate-700">{r.label}</span>
              <span className="text-xs text-slate-400">{r.email}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}

function EditCompanyDetailsModal({ company, onClose, onSave }: { company: Company; onClose: () => void; onSave: (patch: Partial<Company>) => void }) {
  const [form, setForm] = useState({
    name: company.name,
    phone: company.phone ?? '',
    email: company.email ?? '',
    website: company.website ?? '',
    province: company.province ?? '',
    city: company.city ?? '',
    address: company.address ?? '',
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    onSave({
      name: form.name.trim(),
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      website: form.website.trim() || undefined,
      province: form.province.trim() || undefined,
      city: form.city.trim() || undefined,
      address: form.address.trim() || undefined,
    })
    onClose()
  }

  return (
    <Modal title="Edit Contact Details" onClose={onClose} width={460}>
      <form onSubmit={handleSubmit}>
        <FormField label="Client Name" required>
          <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
        </FormField>
        <div className="grid grid-cols-2 gap-x-3">
          <FormField label="Phone">
            <input className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </FormField>
          <FormField label="Email">
            <input className={inputClass} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </FormField>
        </div>
        <FormField label="Website">
          <input className={inputClass} value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
        </FormField>
        <div className="grid grid-cols-2 gap-x-3">
          <FormField label="Province">
            <input className={inputClass} value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} />
          </FormField>
          <FormField label="City / Town">
            <input className={inputClass} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </FormField>
        </div>
        <FormField label="Address">
          <input className={inputClass} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </FormField>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            Save Changes
          </button>
        </div>
      </form>
    </Modal>
  )
}

function EditOwnerModal({
  currentOwnerId,
  reps,
  onClose,
  onSave,
}: {
  currentOwnerId: string
  reps: ReturnType<typeof useAppStore>['users']
  onClose: () => void
  onSave: (ownerId: string) => void
}) {
  const [ownerId, setOwnerId] = useState(currentOwnerId)
  return (
    <Modal title="Reassign Account Owner" onClose={onClose} width={380}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSave(ownerId)
          onClose()
        }}
      >
        <FormField label="Account Owner" required>
          <select className={inputClass} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </FormField>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            Save
          </button>
        </div>
      </form>
    </Modal>
  )
}


function DeleteClientModal({
  company,
  subAccountsCount,
  dealsCount,
  contactsCount,
  leadsCount,
  onClose,
  onConfirm,
}: {
  company: Company
  subAccountsCount: number
  dealsCount: number
  contactsCount: number
  leadsCount: number
  onClose: () => void
  onConfirm: () => void
}) {
  const [confirmText, setConfirmText] = useState('')
  const canDelete = confirmText.trim() === company.name

  return (
    <Modal title="Delete Client" onClose={onClose} width={420}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          This permanently deletes <strong>{company.name}</strong> and cannot be undone.
        </p>
        {(dealsCount > 0 || subAccountsCount > 0 || contactsCount > 0 || leadsCount > 0) && (
          <ul className="list-disc pl-5 space-y-1 text-xs text-slate-500">
            {dealsCount > 0 && <li>{dealsCount} deal{dealsCount === 1 ? '' : 's'} linked to this client will also be permanently deleted.</li>}
            {subAccountsCount > 0 && <li>{subAccountsCount} sub-account{subAccountsCount === 1 ? '' : 's'} will become standalone clients.</li>}
            {contactsCount > 0 && <li>{contactsCount} contact{contactsCount === 1 ? '' : 's'} will be kept but unlinked from this client.</li>}
            {leadsCount > 0 && <li>{leadsCount} lead{leadsCount === 1 ? '' : 's'} will be kept but unlinked from this client.</li>}
          </ul>
        )}
        <FormField label={`Type "${company.name}" to confirm`}>
          <input className={inputClass} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoFocus />
        </FormField>
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button
            type="button"
            disabled={!canDelete}
            onClick={onConfirm}
            className="text-sm font-medium px-3.5 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Delete Client
          </button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * Assigning a client to a parent, and taking it back out again.
 *
 * Both directions live here because they are one decision, and because the way out was
 * previously an eleven-pixel icon at forty percent opacity in the hero band — present, working,
 * and findable by nobody. A relationship you can enter and not leave isn't a setting, it's a
 * trap.
 */
function AssignParentModal({
  currentParentId,
  currentParentName,
  candidates,
  onClose,
  onAssignExisting,
  onCreateNew,
  onMakeIndependent,
}: {
  currentParentId?: string
  currentParentName?: string
  candidates: Company[]
  onClose: () => void
  onAssignExisting: (parentId: string) => void
  onCreateNew: (name: string, code: string) => void
  onMakeIndependent: () => void
}) {
  const [mode, setMode] = useState<'existing' | 'new'>(candidates.length > 0 ? 'existing' : 'new')
  const [selectedId, setSelectedId] = useState(currentParentId ?? candidates[0]?.id ?? '')
  const [newName, setNewName] = useState('')
  const [newCode, setNewCode] = useState('')

  return (
    <Modal title={currentParentId ? 'Parent Client' : 'Assign to Parent Client'} onClose={onClose} width={420}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (mode === 'existing') {
            if (!selectedId) return
            onAssignExisting(selectedId)
          } else {
            if (!newName.trim()) return
            onCreateNew(newName.trim(), newCode.trim())
          }
          onClose()
        }}
      >
        <div className="flex gap-2 mb-3 text-xs font-medium">
          <button
            type="button"
            onClick={() => setMode('existing')}
            disabled={candidates.length === 0}
            className={`px-3 py-1.5 rounded-lg border ${mode === 'existing' ? 'bg-brand-600 text-white border-brand-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50'} disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            Existing client
          </button>
          <button
            type="button"
            onClick={() => setMode('new')}
            className={`px-3 py-1.5 rounded-lg border ${mode === 'new' ? 'bg-brand-600 text-white border-brand-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            New parent client
          </button>
        </div>

        {mode === 'existing' ? (
          <FormField label="Parent Client" required>
            <select className={inputClass} value={selectedId} onChange={(e) => setSelectedId(e.target.value)} required>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.code ? ` (${c.code})` : ''}
                </option>
              ))}
            </select>
          </FormField>
        ) : (
          <>
            <p className="text-xs text-slate-400 mb-3">Creates a new parent client record with no Swordfish prefix of its own, and moves this client underneath it.</p>
            <FormField label="Parent Client Name" required>
              <input className={inputClass} value={newName} onChange={(e) => setNewName(e.target.value)} required autoFocus placeholder="e.g. Marara Pharmacy" />
            </FormField>
            <FormField label="Code (optional)">
              <input className={inputClass} value={newCode} onChange={(e) => setNewCode(e.target.value.toUpperCase())} placeholder="e.g. MARARA" />
            </FormField>
          </>
        )}

        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            {currentParentId ? 'Move' : 'Assign'}
          </button>
        </div>
      </form>

      {currentParentId && (
        <div className="mt-4 pt-3 border-t border-slate-100">
          <p className="text-xs text-slate-400 mb-2">
            Currently a sub-account of {currentParentName ?? 'another client'}. Making it independent leaves it a client in
            its own right — nothing else about it changes, and its own sub-accounts stay with it.
          </p>
          <button
            type="button"
            onClick={() => {
              onMakeIndependent()
              onClose()
            }}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            <Unlink size={13} /> Make independent
          </button>
        </div>
      )}
    </Modal>
  )
}


/**
 * The client's collections book, read live rather than from the sales-side totals above.
 *
 * companies.account_count and handover_amount are figures a person typed when the mandate was
 * signed. These are the accounts that actually arrived. Both are worth showing, and they should
 * not be conflated — a client who promised 300 accounts and sent 71 is a fact worth seeing.
 */
function ClientBookCard({ companyId }: { companyId: string }) {
  const [summary, setSummary] = useState<BookSummary | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchBookSummary(companyId)
      .then((s) => { if (!cancelled) setSummary(s) })
      // A client with no book is the normal case before the migration runs, and a failed read
      // here should not take the client page down with it.
      .catch(() => {})
    return () => { cancelled = true }
  }, [companyId])

  if (!summary || summary.accounts === 0) return null

  return (
    /*
      The link moved OUT of the header and down to the bottom.
      
      A long title, a long subtitle and a button all on one row is fine in a full-width card and
      cramped in a narrow one — and this card lives in the side column, where it was squeezing the
      button against the edge. Below the figures it has the whole width to itself at any size, and
      it reads as the conclusion of the card rather than as a control competing with the heading.
    */
    <Card className="@container">
      <CardHeader
        title="Collections book"
        subtitle="The accounts actually handed over, as opposed to what the mandate estimated"
      />
      {/* Every label reserves two lines, so a heading that wraps ("Capital handed over") does not
          push its figure below the one beside it. The numbers share a baseline at every width. */}
      <div className="grid grid-cols-2 @lg:grid-cols-3 gap-4">
        <div>
          <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide leading-tight min-h-[2.2em]">Accounts</p>
          <p className="text-2xl font-bold text-slate-800 mt-0.5 tabular-nums">{summary.accounts.toLocaleString('en-ZA')}</p>
        </div>
        <div>
          <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide leading-tight min-h-[2.2em]">Capital handed over</p>
          <p className="text-2xl font-bold text-slate-800 mt-0.5 tabular-nums">{formatCurrency(summary.capital)}</p>
        </div>
        {summary.commissionDrift > 0 && (
          <div>
            <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide leading-tight min-h-[2.2em]">Off their mandate rate</p>
            <Link to={`/accounts?client=${companyId}&drift=1`} className="text-2xl font-bold text-amber-700 mt-0.5 tabular-nums block hover:underline">
              {summary.commissionDrift.toLocaleString('en-ZA')}
            </Link>
          </div>
        )}
      </div>

      {/* Full width, so it never has to fight the heading for room. */}
      <Link
        to={`/accounts?client=${companyId}`}
        className="mt-4 flex items-center justify-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
      >
        Open the book <ArrowRight size={14} />
      </Link>
    </Card>
  )
}
