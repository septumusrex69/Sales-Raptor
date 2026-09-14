import { useMemo, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, Pencil, UserPlus, StickyNote, CalendarClock, Users2, XCircle, Phone, Mail,
  MessageSquare, Trash2, Plus, Handshake,
} from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { canEditOwned, canReassign, isAssignableOwner} from '../../lib/permissions'
import { DashboardHero } from '../../components/dashboard/DashboardHero'
import { HeroOwner } from '../../components/RecordOwner'
import { Card, CardHeader } from '../../components/ui/Card'
import { UserAvatar } from '../../components/ui/Avatar'
import { AddContactModal } from '../../components/contacts/AddContactModal'
import { EditContactModal } from '../../components/contacts/EditContactModal'
import { StatusBadge, ServiceBadge, StageBadge, ClassificationBadge } from '../../components/ui/Badge'
import { Modal, FormField, inputClass } from '../../components/ui/Modal'
import { ConfirmDeleteModal } from '../../components/ui/ConfirmDeleteModal'
import { ComposeEmailModal } from '../../components/ComposeEmailModal'
import { AddDealModal, QuickLogModal, ScheduleFollowUpModal, ScheduleMeetingModal } from '../../components/QuickModals'
import { RejectLeadModal } from '../../components/leads/RejectLeadModal'
import { ConvertLeadModal } from '../../components/leads/ConvertLeadModal'
import { InlineSelect } from '../../components/ui/InlineSelect'
import {
  ACTION_BASE, ACTION_ENABLED, RecordAction, RecordActions, RecordFigure, RecordFigures,
  RecordActionsMore, RecordFigureShell, RecordLayout, RecordLayoutSwitcher, RecordMoreAction,
  RecordTabs, useRecordLayout,
} from '../../components/record/RecordShell'
import { CrmCallButton } from '../../components/record/CrmCallButton'
import {
  RecordComment, RecordCommentFact, RecordCommentSummary,
} from '../../components/record/RecordComment'
import { PhoneLink } from '../../components/PhoneLink'
import { LEAD_STATUSES, isActiveLead } from '../../lib/leadStatus'
import { RowLimitSelect, applyRowLimitKeeping, type RowLimit } from '../../components/ui/RowLimitSelect'
import { useFocusedEmailId } from '../../lib/focusedEmail'
import { EmailActivityList } from '../../components/EmailActivityRow'
import { NoteActivityList } from '../../components/NoteActivityRow'
import { parseEmailActivity } from '../../lib/emailActivity'
import { buildDrilldownUrl } from '../../lib/drilldown'
import { formatCurrency, formatDate, formatLeadNumber, industries, leadSources } from '../../data/mockData'
import { leadClassifications } from '../../data/mockData'
import type { Contact, LeadStatus } from '../../types'
import { LeadOpportunityFields, leadOpportunityValueFromLead, leadOpportunityPatch, serviceValueLabel, leadServiceValueList } from '../../components/leads/LeadOpportunityFields'
import { summaryLine } from '../../lib/summaryLine'
import { hasDealValue } from '../../lib/dealKind'

type LeadTab = 'Overview' | 'Emails' | 'Notes' | 'Tasks'

export function LeadDetail() {
  const focusedEmailId = useFocusedEmailId()
  const { id } = useParams()
  const navigate = useNavigate()
  const { leads, deals, contacts, activities, tasks, users, userById, updateLead, convertLeadToClient, addLeadDeal, rejectLead, deleteLead, addActivity, addContact, updateContact, addTask } = useAppStore()
  const { currentUser } = useAuth()
  const reps = useMemo(() => users.filter((u) => isAssignableOwner(u.role)), [users])
  const lead = leads.find((l) => l.id === id)
  const resultingDeals = useMemo(() => deals.filter((d) => d.leadId === id), [deals, id])
  const openLeadDeals = useMemo(() => resultingDeals.filter((d) => d.stage !== 'Won' && d.stage !== 'Rejected'), [resultingDeals])
  // Service deals only. A handover carries no deal value by design — its size is the book,
  // which is shown as the Handover Amount — so including it here would either add zero or,
  // worse, re-create the very sum this replaces.
  const openDealValue = useMemo(
    () => openLeadDeals.filter((d) => hasDealValue(d)).reduce((sum, d) => sum + d.value, 0),
    [openLeadDeals],
  )
  /*
   * Every number that could reach this lead, mobile first.
   *
   * Mobile before office deliberately: a mobile is answered by the person, a switchboard is
   * answered by somebody else. The Call button rings the first one when there is only one.
   */
  /*
   * Which tab, and how the Overview is arranged.
   *
   * The layout key is per page type rather than per lead: it is a preference about eyes. Separate
   * from the account page's key because the right arrangement genuinely differs — an account has
   * a long timeline to give width to, a lead has not.
   */
  const [tab, setTab] = useState<LeadTab>('Overview')
  const [layout, chooseLayout] = useRecordLayout('raptor.lead.layout')

  const leadNumbers = useMemo(() => [
    ...(lead?.mobile ? [{ label: 'Mobile', value: lead.mobile }] : []),
    ...(lead?.phone ? [{ label: 'Office', value: lead.phone }] : []),
  ], [lead?.mobile, lead?.phone])

  const canEdit = canEditOwned(currentUser, lead?.ownerId)

  const [editOpen, setEditOpen] = useState(false)
  const [callOpen, setCallOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [followUpOpen, setFollowUpOpen] = useState(false)
  const [meetingOpen, setMeetingOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [convertOpen, setConvertOpen] = useState(false)
  const [dealOpen, setDealOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailLimit, setEmailLimit] = useState<RowLimit>(5)
  const [noteLimit, setNoteLimit] = useState<RowLimit>(5)
  const [replyTarget, setReplyTarget] = useState<{ subject: string } | null>(null)
  const [addContactOpen, setAddContactOpen] = useState(false)
  const [editContact, setEditContact] = useState<Contact | null>(null)
  const [contactEmailTarget, setContactEmailTarget] = useState<Contact | null>(null)

  const leadContacts = useMemo(() => contacts.filter((c) => c.leadId === id), [contacts, id])
  const leadTasks = useMemo(() => tasks.filter((t) => t.leadId === id), [tasks, id])

  const timeline = useMemo(
    () => activities.filter((a) => a.leadId === id).sort((a, b) => new Date(b.activityDate).getTime() - new Date(a.activityDate).getTime()),
    [activities, id],
  )
  const emailActivities = useMemo(() => timeline.filter((a) => a.type === 'Email'), [timeline])
  const nonEmailActivities = useMemo(() => timeline.filter((a) => a.type !== 'Email'), [timeline])

  // A lead's debt-collection numbers can be captured either per-service (the current shape) or
  // on the lead itself (leads saved before per-service values existed) — prefer the newer one.
  const debtService = lead ? leadServiceValueList(lead).find((sv) => sv.service === 'Debt Collection') : undefined
  const estimatedHandover = debtService?.handoverAmount ?? lead?.estimatedHandoverAmount
  const estimatedAccounts = debtService?.accountsCount ?? lead?.estimatedAccountsCount

  if (!lead) {
    return (
      <div className="text-center py-16 text-slate-400">
        Lead not found. <Link to="/leads" className="text-brand-600 hover:underline">Back to leads</Link>
      </div>
    )
  }

  const active = isActiveLead(lead)

  /*
   * The panels, built once and placed by whichever layout is chosen.
   *
   * Defining them here rather than three times over is the whole reason the layouts can be
   * trusted to stay the same page: a prop added to one arrangement cannot be forgotten in the
   * other two, and that bug is invisible until somebody switches layout. The Account page has
   * worked this way for a while; this is the same shape, from the same components.
   */
  /** Who to ring, and the people around them. */
  const contactPanel = (
    <Card className="@container">
      <CardHeader
        title="Contact Details"
        action={
          canEdit ? (
            <button
              onClick={() => setEditOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              <Pencil size={12} /> Edit
            </button>
          ) : undefined
        }
      />
      {/*
        Three across when the CARD is wide enough, stacked when it is not.

        This was `sm:grid-cols-3`, which asks about the WINDOW. In the three-column layout the
        card is about 300px wide inside a 1200px window, so it still laid out three columns —
        and an email address ran off the right-hand edge of the card with no way to read it.
        A container query asks the question that actually matters.
      */}
      <div className="grid grid-cols-1 @md:grid-cols-3 gap-3 text-sm mb-4 pb-4 border-b border-slate-100">
        <div>
          <p className="text-xs text-slate-400 mb-0.5">Office Number</p>
          {lead.phone ? (
            <PhoneLink
              number={lead.phone}
              className="inline-flex items-center gap-1.5 text-slate-700 font-medium hover:text-brand-600"
              log={{ label: `${lead.firstName} ${lead.lastName}`, leadId: lead.id, companyId: lead.companyId }}
              onDialled={() => updateLead(lead.id, { lastContactAt: new Date().toISOString() })}
            />
          ) : (
            <span className="text-slate-300">—</span>
          )}
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-0.5">Mobile</p>
          {lead.mobile ? (
            <PhoneLink
              number={lead.mobile}
              className="inline-flex items-center gap-1.5 text-slate-700 font-medium hover:text-brand-600"
              log={{ label: `${lead.firstName} ${lead.lastName}`, leadId: lead.id, companyId: lead.companyId }}
              onDialled={() => updateLead(lead.id, { lastContactAt: new Date().toISOString() })}
            />
          ) : (
            <span className="text-slate-300">—</span>
          )}
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-0.5">Email</p>
          {lead.email ? (
            <span className="inline-flex items-center gap-1.5 text-slate-700 font-medium">
              <button onClick={() => setEmailOpen(true)} className="text-slate-400 hover:text-brand-600" title="Send email">
                <Mail size={13} />
              </button>
              {lead.email}
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
      {leadContacts.length === 0 ? (
        <p className="text-sm text-slate-400">
          Just {lead.firstName} so far. Add anyone else you deal with at {lead.companyName}.
        </p>
      ) : (
        <div className="space-y-1">
          {leadContacts.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 hover:bg-slate-50 -mx-1 px-2 py-2 rounded-lg">
              <Link to={`/contacts/${c.id}`} className="flex items-center gap-2.5 min-w-0">
                <UserAvatar userId={c.ownerId} size={30} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-700 hover:text-brand-600 truncate">
                    {c.firstName} {c.lastName}
                  </p>
                  <p className="text-xs text-slate-400 truncate">{c.jobTitle}</p>
                </div>
              </Link>
              <div className="flex items-center gap-3 text-xs text-slate-500 shrink-0">
                {c.phone && (
                  <PhoneLink number={c.phone} iconSize={11} className="inline-flex items-center gap-1 hover:text-brand-600" log={{ label: `${c.firstName} ${c.lastName}`, leadId: lead.id, contactId: c.id, companyId: lead.companyId }} />
                )}
                {c.mobile && (
                  <PhoneLink number={c.mobile} iconSize={11} className="inline-flex items-center gap-1 hover:text-brand-600" log={{ label: `${c.firstName} ${c.lastName}`, leadId: lead.id, contactId: c.id, companyId: lead.companyId }}>
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
                <button onClick={() => setEditContact(c)} className="text-slate-300 hover:text-brand-600" title="Edit contact">
                  <Pencil size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )

  /** Its own tab, like the Account page: a list that grows without limit does not belong on an overview. */
  const emailsPanel = (
    <Card>
      <CardHeader
        title="Emails"
        subtitle={`${emailActivities.length} message${emailActivities.length === 1 ? '' : 's'}`}
        action={
          <div className="flex items-center gap-2">
            {lead.email && (
              <button
                onClick={() => setEmailOpen(true)}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                <Mail size={12} /> Compose
              </button>
            )}
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
          onReply={
            lead.email
              ? (a) => {
                  const rawSubject = parseEmailActivity(a.subject)?.subject ?? a.subject
                  setReplyTarget({ subject: rawSubject.toLowerCase().startsWith('re:') ? rawSubject : `Re: ${rawSubject}` })
                }
              : undefined
          }
        />
      )}
    </Card>
  )

  /** Everything that is not an email — calls, meetings, notes. */
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

  /** What this lead has actually produced. */
  const dealsPanel = resultingDeals.length > 0 && (
      <Card>
        <CardHeader title="Deals" subtitle={`${resultingDeals.length} on this lead`} />
        <div className="space-y-2">
          {resultingDeals.map((d) => (
            <Link
              key={d.id}
              to={`/deals/${d.id}`}
              className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg border border-slate-100 hover:bg-slate-50 transition-colors"
            >
              <div>
                <p className="text-sm font-medium text-slate-700">{d.name}</p>
                {d.service && <p className="text-xs text-slate-400">{d.service}</p>}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-slate-700">{formatCurrency(d.value)}</span>
                <StageBadge stage={d.stage} />
              </div>
            </Link>
          ))}
        </div>
      </Card>
  )

  /** What they say they will hand over, per service. */
  const opportunityPanel = (
    <Card className="@container">
      <CardHeader title="Opportunity Information" />
      <dl className="grid grid-cols-1 @sm:grid-cols-2 gap-x-6 gap-y-3.5 text-sm">
        {leadServiceValueList(lead).map((sv) =>
          sv.service === 'Debt Collection' ? (
            <div key={sv.service} className="@sm:col-span-2 grid grid-cols-1 @sm:grid-cols-2 gap-x-6 gap-y-3.5">
              <Field label="Estimated Handover Amount" value={sv.handoverAmount != null ? formatCurrency(sv.handoverAmount) : undefined} />
              <Field label="Estimated Number of Accounts / Matters" value={sv.accountsCount != null ? String(sv.accountsCount) : undefined} />
            </div>
          ) : (
            <Field
              key={sv.service}
              label={lead.services && lead.services.length > 1 ? `${sv.service} — ${serviceValueLabel(sv.service)}` : serviceValueLabel(sv.service)}
              value={sv.value != null ? formatCurrency(sv.value) : undefined}
            />
          ),
        )}
        {lead.services?.includes('Other') && <Field label="Other Service — Please Specify" value={lead.otherServiceDetail} />}
      </dl>
      {(!lead.services || lead.services.length === 0) && !lead.estimatedProjectValue && (
        <p className="text-xs text-slate-400">No products or services captured yet. Use Edit to add opportunity details.</p>
      )}
    </Card>
  )

  /** Where the lead came from and who owns it. */
  const leadInfoPanel = (
    <Card className="@container">
      <CardHeader title="Lead Information" />
      <dl className="grid grid-cols-1 @sm:grid-cols-2 gap-x-6 gap-y-3.5 text-sm">
        <Field label="Lead Source" value={lead.source} />
        <Field label="Campaign" value={lead.campaign} />
        <Field label="Assigned Owner" value={userById(lead.ownerId)?.name} />
        <Field label="Lead Status" value={lead.status} />
        <Field label="Lead Score" value={`${lead.score} / 100`} />
        <Field label="Estimated Value" value={formatCurrency(lead.estimatedValue)} />
        <Field label="Classification" value={lead.classification ? `Class ${lead.classification}` : undefined} />
        <Field label="Date Created" value={formatDate(lead.createdAt)} />
        <Field label="Last Contact" value={formatDate(lead.lastContactAt)} />
        <Field label="Next Follow-up" value={formatDate(lead.nextFollowUpAt)} />
        {lead.status === 'Rejected' && <Field label="Rejection Reason" value={lead.rejectionReason} />}
      </dl>
      {lead.notes && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <p className="text-xs font-medium text-slate-400 mb-1">Notes</p>
          <p className="text-sm text-slate-600">{lead.notes}</p>
        </div>
      )}
    </Card>
  )

  /** The firmographics. */
  const profilePanel = (
    <Card className="@container">
      <CardHeader title="Lead Profile" />
      <dl className="grid grid-cols-1 @sm:grid-cols-2 gap-x-6 gap-y-3.5 text-sm">
        <Field label="First Name" value={lead.firstName} />
        <Field label="Last Name" value={lead.lastName} />
        <Field label="Company" value={lead.companyName} />
        <Field label="Job Title" value={lead.jobTitle} />
        <Field label="Industry" value={lead.industry} />
        <Field label="Country" value={lead.country} />
        <Field label="Province" value={lead.province} />
        <Field label="City / Town" value={lead.city} />
        <Field label="Address" value={lead.address} />
      </dl>
    </Card>
  )

  /** Its own tab as well: a task list is work, not context. */
  const tasksPanel = (
    <Card>
      <CardHeader title="Tasks" />
      {leadTasks.length === 0 ? (
        <p className="text-sm text-slate-400">No tasks yet.</p>
      ) : (
        <div className="space-y-2">
          {leadTasks.map((t) => (
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
      <Link to="/leads" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={15} /> Back to Leads
      </Link>

      <DashboardHero
        eyebrow={`Lead · ${formatLeadNumber(lead.leadNumber)}`}
        title={`${lead.firstName} ${lead.lastName}`}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            {(() => {
              const who = summaryLine([lead.jobTitle && lead.companyName ? `${lead.jobTitle} at ${lead.companyName}` : lead.jobTitle || lead.companyName])
              const source = lead.source ? `Source: ${lead.source}` : ''
              return (
                <>
                  {who && <span>{who}</span>}
                  {who && source && <span className="text-white/30">·</span>}
                  {source && <span>{source}</span>}
                </>
              )
            })()}
          </span>
        }
      >
        <HeroOwner ownerId={lead.ownerId} label="Owner" />
      </DashboardHero>

      {/*
        The same row of figures the Account page wears, from the same component.

        It used to be six stats strung along one line inside a card, at a different size, in a
        different order of importance to the debtor page next door. The firm's point was simple
        and right: moving between a debtor and the client who handed them over should not mean
        learning the page again.

        Class and Status stay HERE rather than moving into a panel, even though they are controls
        rather than readings. They are the first two things anybody looks at on a lead, and
        tidying them away would be neater and worse.
      */}
      <RecordFigures count={6}>
        <RecordFigureShell label="Class">
          <InlineSelect
            value={lead.classification}
            options={leadClassifications}
            disabled={!canEdit}
            onChange={(classification) => updateLead(lead.id, { classification })}
          >
            {lead.classification ? (
              <ClassificationBadge classification={lead.classification} />
            ) : (
              // A lead often hasn't been graded yet; saying so is more useful than an empty gap
              // that reads as though the field doesn't exist.
              <span className="text-xs text-slate-400 border border-dashed border-slate-200 rounded-md px-2 py-1">Not yet graded</span>
            )}
          </InlineSelect>
        </RecordFigureShell>

        <RecordFigureShell label="Status">
          <InlineSelect
            value={lead.status}
            options={LEAD_STATUSES}
            disabled={!canEdit}
            onChange={(status) => {
              // Rejection needs a reason, so route that one through the proper flow rather
              // than letting a dropdown close a lead off with nothing recorded.
              if (status === 'Rejected') setRejectOpen(true)
              else if (status === 'Converted') setConvertOpen(true)
              else updateLead(lead.id, { status })
            }}
          >
            <StatusBadge status={lead.status} />
          </InlineSelect>
        </RecordFigureShell>

        <RecordFigure label="Accounts"
          value={estimatedAccounts !== undefined ? String(estimatedAccounts) : '\u2014'}
          note={estimatedAccounts === undefined ? 'not estimated yet' : 'on the mandate'} />

        <RecordFigure label="Handover amount"
          value={estimatedHandover !== undefined ? formatCurrency(estimatedHandover) : '\u2014'}
          note={estimatedHandover === undefined ? 'not estimated yet' : 'what they say they will hand over'} />

        {/* Open deal value, not "estimated value". The old figure added the book to the service
            deals and showed one number, which is the sum this whole model exists to prevent: a
            book is work to be collected on commission, a service deal is a fee. Adding them
            describes nothing. The book is the Handover amount beside this; what belongs here is
            the money the open service deals are actually worth. */}
        <RecordFigure label="Open deal value" value={formatCurrency(openDealValue)}
          note={`${openLeadDeals.length} open deal${openLeadDeals.length === 1 ? '' : 's'}`}
          onClick={() => navigate(buildDrilldownUrl('/deals', { view: 'table' }))}
          title="Open the deals this lead has produced" />

        <RecordFigure label="Lead score" value={String(lead.score)}
          note={`added ${formatDate(lead.createdAt)}`} />
      </RecordFigures>

      {/*
        The two lines the next person needs, and the facts they would otherwise go hunting for.

        Above the actions, exactly where it sits on a debtor's account, because it answers the
        question somebody opens the page with — what is going on here? — before they decide which
        button to press. The services and the open deals ride along with it: they lived three
        panels down, and this puts them where the eye already is.
      */}
      <RecordComment
        text={lead.mainComment}
        at={lead.mainCommentAt}
        placeholder="Where does this lead stand? Two lines is plenty."
        onSave={(text) => updateLead(lead.id, {
          mainComment: text || undefined,
          mainCommentAt: new Date().toISOString(),
          mainCommentBy: currentUser?.id,
        })}
        summary={(
          <RecordCommentSummary>
            <RecordCommentFact label="Interested in">
              {lead.services && lead.services.length > 0
                ? lead.services.map((sv) => <ServiceBadge key={sv} service={sv} />)
                : <span className="text-slate-400">Nothing captured yet</span>}
            </RecordCommentFact>
            <RecordCommentFact label="Deals">
              {resultingDeals.length === 0
                ? <span className="text-slate-400">None yet</span>
                : (
                  <>
                    <span className="font-medium tabular-nums">{formatCurrency(openDealValue)}</span>
                    <span className="text-slate-400">
                      across {openLeadDeals.length} open of {resultingDeals.length}
                    </span>
                  </>
                )}
            </RecordCommentFact>
            <RecordCommentFact label="Handover">
              {estimatedHandover !== undefined
                ? (
                  <>
                    <span className="font-medium tabular-nums">{formatCurrency(estimatedHandover)}</span>
                    {estimatedAccounts !== undefined && (
                      <span className="text-slate-400">over {estimatedAccounts} accounts</span>
                    )}
                  </>
                )
                : <span className="text-slate-400">Not estimated</span>}
            </RecordCommentFact>
          </RecordCommentSummary>
        )}
      />

      <Card>
        {/*
          The service chips used to sit here as well as in the main comment above — the same
          fact twice, a hand's width apart. The comment keeps them, because that is where
          somebody is already reading.
        */}
        {lead.status === 'Rejected' && lead.rejectionReason && (
          <div className="mb-4 rounded-lg border border-red-100 bg-red-50/60 px-3.5 py-2.5">
            <p className="text-xs font-medium text-red-700">Rejected — {lead.rejectionReason}</p>
            {lead.rejectionNote && <p className="text-sm text-red-900/70 mt-0.5">{lead.rejectionNote}</p>}
          </div>
        )}

        <div>
          {/*
            The same row of actions the Account page wears, from the same component, in the same
            order of thought: REACH THEM first, then record what happened, then move the record on.
            A lead page whose first button was "Edit" put the filing cabinet before the phone.

            Reaching a lead costs nothing and charges nothing. Every comparable action on a debtor
            raises an Annexure B fee, and none of these do — a lead is not a debtor and the money
            rules must not follow the furniture. See crmComms, which cannot reach the fee engine.
          */}
          <RecordActions>
            <CrmCallButton
              numbers={leadNumbers}
              to={{ leadId: lead.id, companyId: lead.companyId }}
              subject={`${lead.firstName} ${lead.lastName}`}
              className={`${ACTION_BASE} ${ACTION_ENABLED}`}
            />
            {/*
              Honest rather than absent. The send endpoint is built around an account, because
              sending a debtor an SMS raises item 1(c) — so pointing a lead at it would either
              fail or charge somebody who owes us nothing. Saying so beats a button that
              swallows the click, and beats pretending the firm never asked.
            */}
            <RecordAction icon={MessageSquare} label="SMS"
              title="Not built for leads yet — the SMS route is tied to a debtor's account, where it raises a fee." />
            <RecordAction icon={Mail} label="Email"
              onClick={lead.email ? () => setEmailOpen(true) : undefined}
              title={lead.email ? 'Send from your connected mailbox' : 'No email address on this lead yet'} />
            <RecordAction icon={StickyNote} label="Add Note" onClick={() => setNoteOpen(true)}
              title="Write on the timeline" />
            {canEdit && active && (
              <RecordAction icon={UserPlus} label="Convert to Client" onClick={() => setConvertOpen(true)} primary />
            )}

            {/*
              Everything else, folded away. Twelve buttons wrapped to three lines on an iPad and
              pushed the panels below off the screen; nothing is removed, because the fix for a
              crowded row is not to take away the button somebody needs twice a month.
            */}
            <RecordActionsMore>
              <RecordMoreAction icon={Phone} label="Log Call" onClick={() => setCallOpen(true)}
                title="Record a call you made some other way" />
              <RecordMoreAction icon={CalendarClock} label="Schedule Follow-up" onClick={() => setFollowUpOpen(true)} />
              <RecordMoreAction icon={Users2} label="Schedule Meeting" onClick={() => setMeetingOpen(true)} />
              {canEdit && active && <RecordMoreAction icon={Handshake} label="Add Deal" onClick={() => setDealOpen(true)} />}
              {canEdit && <RecordMoreAction icon={Pencil} label="Edit lead" onClick={() => setEditOpen(true)} />}
              {canEdit && active && <RecordMoreAction icon={XCircle} label="Reject" danger onClick={() => setRejectOpen(true)} />}
              {/* Deleting a converted lead takes its deals with it (the DB cascades on lead_id),
                  which would wipe the client's won business and drop them out of Clients. */}
              {canEdit && (
                <RecordMoreAction
                  icon={Trash2}
                  label="Delete"
                  danger
                  onClick={lead.status === 'Converted' ? undefined : () => setDeleteOpen(true)}
                  title={lead.status === 'Converted' ? 'Converted leads can\u2019t be deleted \u2014 it would remove the client\u2019s deals too.' : undefined}
                />
              )}
            </RecordActionsMore>
          </RecordActions>
        </div>
      </Card>

      {/*
        Tabs over the detail, like the Account page — and for the same reason. Everything below
        used to be one scroll: contact details, then every email ever sent, then every note, then
        the information panels somebody actually came for. The long lists get their own tabs so
        the Overview stays the thing you can read at a glance.
      */}
      <RecordTabs<LeadTab>
        tabs={[
          { id: 'Overview', label: 'Overview' },
          { id: 'Emails', label: 'Emails', count: emailActivities.length },
          { id: 'Notes', label: 'Notes', count: nonEmailActivities.length },
          { id: 'Tasks', label: 'Tasks', count: leadTasks.length },
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
          /*
            Notes in the MIDDLE, and still on their own tab.
            
            Both places on purpose, at the firm's asking. On the overview they sit in the column
            you are working in, capped at five with a "show more"; the tab is where you go when
            you want the lot. A note behind a tab only is a note nobody reads.
          */
          main={<div className="space-y-5">{dealsPanel}{notesPanel}{opportunityPanel}</div>}
          side={[leadInfoPanel, profilePanel]}
        />
      )}

      {tab === 'Emails' && emailsPanel}
      {tab === 'Notes' && notesPanel}
      {tab === 'Tasks' && tasksPanel}

      {editOpen && (
        <EditLeadModal lead={lead} reps={reps} canReassign={canReassign(currentUser)} onClose={() => setEditOpen(false)} onSave={(patch) => updateLead(lead.id, patch)} />
      )}
      {callOpen && (
        <QuickLogModal
          title="Log Call"
          fieldLabel="What was discussed? (optional)"
          submitLabel="Log Call"
          required={false}
          onClose={() => setCallOpen(false)}
          onSave={(text) =>
            addActivity({ type: 'Call', subject: `Call — ${lead.firstName} ${lead.lastName}`, notes: text || undefined, leadId: lead.id, companyId: lead.companyId })
          }
        />
      )}
      {noteOpen && (
        <QuickLogModal
          title="Add Note"
          fieldLabel="Note"
          submitLabel="Add Note"
          onClose={() => setNoteOpen(false)}
          onSave={(text) => addActivity({ type: 'Note', subject: 'Note added', notes: text, leadId: lead.id, companyId: lead.companyId })}
        />
      )}
      {followUpOpen && (
        <ScheduleFollowUpModal
          placeholder="e.g. Call back about the handover"
          onClose={() => setFollowUpOpen(false)}
          onSave={(input) => addTask({ ...input, type: 'Follow-up', leadId: lead.id, companyId: lead.companyId, relatedToLabel: `${lead.firstName} ${lead.lastName}` })}
        />
      )}
      {meetingOpen && (
        <ScheduleMeetingModal
          placeholder="e.g. Intro meeting"
          onClose={() => setMeetingOpen(false)}
          onSave={(input) => addTask({ ...input, type: 'Meeting', leadId: lead.id, companyId: lead.companyId, relatedToLabel: `${lead.firstName} ${lead.lastName}` })}
        />
      )}
      {convertOpen && (
        <ConvertLeadModal
          lead={lead}
          openDeals={openLeadDeals}
          onClose={() => setConvertOpen(false)}
          onConfirm={(confirmation) => {
            const result = convertLeadToClient(lead.id, confirmation)
            // The client record is where the handover actually gets worked, so that's where the
            // person doing the converting should land — not on one of the deals it confirmed.
            if (result) navigate(`/companies/${result.companyId}`)
          }}
        />
      )}
      {dealOpen && (
        <AddDealModal
          subjectName={lead.companyName}
          defaultService={lead.services?.[0]}
          onClose={() => setDealOpen(false)}
          onSave={(input) => addLeadDeal(lead.id, input)}
        />
      )}
      {rejectOpen && (
        <RejectLeadModal
          leadName={`${lead.firstName} ${lead.lastName}`}
          onClose={() => setRejectOpen(false)}
          onConfirm={(reason, note) => rejectLead(lead.id, reason, note)}
        />
      )}
      {deleteOpen && (
        <ConfirmDeleteModal
          title="Delete Lead"
          itemLabel={`${lead.firstName} ${lead.lastName}`}
          onClose={() => setDeleteOpen(false)}
          onConfirm={() => {
            deleteLead(lead.id)
            navigate('/leads')
          }}
        />
      )}
      {emailOpen && lead.email && (
        <ComposeEmailModal
          to={lead.email}
          onClose={() => setEmailOpen(false)}
          onSent={(subject, bodyText) => addActivity({ type: 'Email', subject, notes: bodyText, leadId: lead.id, companyId: lead.companyId })}
        />
      )}
      {addContactOpen && (
        <AddContactModal
          onClose={() => setAddContactOpen(false)}
          onSave={(input) => addContact({ ...input, leadId: lead.id, companyId: lead.companyId })}
        />
      )}
      {editContact && (
        <EditContactModal
          contact={editContact}
          onClose={() => setEditContact(null)}
          onSave={(patch) => updateContact(editContact.id, patch)}
        />
      )}
      {contactEmailTarget?.email && (
        <ComposeEmailModal
          to={contactEmailTarget.email}
          onClose={() => setContactEmailTarget(null)}
          onSent={(subject, bodyText) =>
            addActivity({ type: 'Email', subject, notes: bodyText, contactId: contactEmailTarget.id, leadId: lead.id, companyId: lead.companyId })
          }
        />
      )}
      {replyTarget && lead.email && (
        <ComposeEmailModal
          to={lead.email}
          initialSubject={replyTarget.subject}
          onClose={() => setReplyTarget(null)}
          onSent={(subject, bodyText) => addActivity({ type: 'Email', subject, notes: bodyText, leadId: lead.id, companyId: lead.companyId })}
        />
      )}
    </div>
  )
}

/** Deliberately identical in weight to the Client page's action row — same size, same padding. */
/*
 * ActionButton used to live here — its own size, its own colours, its own idea of what a
 * disabled button looks like. It is now RecordAction in components/record/RecordShell, shared
 * with the Account and Client pages, because the firm asked for one grammar across the app and
 * three private copies of a button is how you end up with three.
 */

function Field({ label, value, icon: Icon, href, onIconClick }: { label: string; value?: string; icon?: typeof Mail; href?: string; onIconClick?: () => void }) {
  return (
    <div>
      <dt className="text-xs text-slate-400 mb-0.5">{label}</dt>
      <dd className="text-slate-700 font-medium flex items-center gap-1.5">
        {Icon && (onIconClick ? (
          <button type="button" onClick={onIconClick} className="text-slate-400 hover:text-brand-600" title="Send email">
            <Icon size={13} />
          </button>
        ) : (
          <Icon size={13} className="text-slate-400" />
        ))}
        {href ? (
          <a href={href} className="hover:text-brand-600 hover:underline">
            {value ?? '—'}
          </a>
        ) : (
          value || '—'
        )}
      </dd>
    </div>
  )
}

function EditLeadModal({
  lead,
  reps,
  canReassign,
  onClose,
  onSave,
}: {
  lead: ReturnType<typeof useAppStore>['leads'][number]
  reps: ReturnType<typeof useAppStore>['users']
  canReassign: boolean
  onClose: () => void
  onSave: (patch: Partial<typeof lead>) => void
}) {
  const [form, setForm] = useState({ ...lead })
  const [opportunity, setOpportunity] = useState(() => leadOpportunityValueFromLead(lead))
  return (
    <Modal title="Edit Lead" onClose={onClose} width={560}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSave({ ...form, ...leadOpportunityPatch(opportunity) })
          onClose()
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <FormField label="First Name" required>
            <input className={inputClass} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required />
          </FormField>
          <FormField label="Last Name">
            <input className={inputClass} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          </FormField>
          <FormField label="Job Title">
            <input className={inputClass} value={form.jobTitle ?? ''} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
          </FormField>
          <FormField label="Company">
            <input className={inputClass} value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
          </FormField>
          <FormField label="Email">
            <input type="email" className={inputClass} value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </FormField>
          <FormField label="Mobile">
            <input className={inputClass} value={form.mobile ?? ''} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
          </FormField>
          <FormField label="Lead Status">
            <select className={inputClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as LeadStatus })}>
              {LEAD_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Lead Source">
            <select className={inputClass} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value as typeof form.source })}>
              {leadSources.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Lead Score">
            <input type="number" min={0} max={100} className={inputClass} value={form.score} onChange={(e) => setForm({ ...form, score: Number(e.target.value) })} />
          </FormField>
          <FormField label="Owner">
            {canReassign ? (
              <select className={inputClass} value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })}>
                {reps.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-slate-500 py-2">{reps.find((r) => r.id === form.ownerId)?.name ?? '—'} <span className="text-xs text-slate-400">(ask a manager to reassign)</span></p>
            )}
          </FormField>
          <FormField label="Industry">
            <select className={inputClass} value={form.industry ?? ''} onChange={(e) => setForm({ ...form, industry: e.target.value })}>
              <option value="">—</option>
              {industries.map((i) => (
                <option key={i}>{i}</option>
              ))}
            </select>
          </FormField>
        </div>
        <LeadOpportunityFields value={opportunity} onChange={setOpportunity} />
        <FormField label="Notes">
          <textarea className={inputClass} rows={3} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
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


