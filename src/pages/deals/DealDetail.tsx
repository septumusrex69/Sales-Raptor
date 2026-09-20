import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Pencil, CheckCircle2, XCircle, StickyNote, CheckSquare, FileText, Send, Plus, Upload,
  Trash2, Mail, MessageSquare, Building2,
} from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { canEditOwned, canReassign, isAssignableOwner} from '../../lib/permissions'
import { Card, CardHeader } from '../../components/ui/Card'
import { StageBadge } from '../../components/ui/Badge'
import { UserAvatar } from '../../components/ui/Avatar'
import { Modal, FormField, inputClass } from '../../components/ui/Modal'
import { MarkRejectedModal, MarkWonModal } from './DealStageModals'
import { dealKind, dealStageLabel } from '../../lib/dealKind'
import { formatCurrency, formatDate, formatDateTime, services } from '../../data/mockData'
import type { ActivityType, ProposalStatus, TaskType } from '../../types'
import { NoteActivityList } from '../../components/NoteActivityRow'
import { EmailActivityList } from '../../components/EmailActivityRow'
import { ComposeEmailModal } from '../../components/ComposeEmailModal'
import { WriteButton } from '../../components/email/MessageActions'
import { openingFor, type ComposeOpening } from '../../lib/emailActivity'
import { RowLimitSelect, applyRowLimitKeeping, type RowLimit } from '../../components/ui/RowLimitSelect'
import { useFocusedEmailId } from '../../lib/focusedEmail'
import { DashboardHero } from '../../components/dashboard/DashboardHero'
import { HeroOwner } from '../../components/RecordOwner'
import {
  ACTION_BASE, ACTION_ENABLED, RecordAction, RecordActions, RecordActionsMore, RecordFigure,
  RecordFigures, RecordFigureShell, RecordLayout, RecordLayoutSwitcher, RecordMoreAction,
  RecordTabs, useRecordLayout,
} from '../../components/record/RecordShell'
import { CrmCallButton } from '../../components/record/CrmCallButton'
import { CrmSmsModal } from '../../components/record/CrmSmsModal'
import {
  RecordComment, RecordCommentFact, RecordCommentSummary,
} from '../../components/record/RecordComment'
import type { WonDealDetails } from '../../store/AppStore'


interface MockDocument {
  id: string
  name: string
  uploadedAt: string
  size: string
}

type DealTab = 'Overview' | 'Emails' | 'Notes' | 'Tasks' | 'Documents'

export function DealDetail() {
  const focusedEmailId = useFocusedEmailId()
  const { id } = useParams()
  const navigate = useNavigate()
  const store = useAppStore()
  const {
    deals,
    activities,
    tasks,
    proposals,
    users,
    contacts,
    leads,
    companyById,
    contactById,
    userById,
    updateDeal,
    markDealWon,
    markDealRejected,
    logDealDocument,
    addActivity,
    addTask,
    updateTask,
    addProposal,
    updateProposal,
  } = store
  const { currentUser } = useAuth()
  const reps = useMemo(() => users.filter((u) => isAssignableOwner(u.role)), [users])
  const deal = deals.find((d) => d.id === id)
  const canEdit = canEditOwned(currentUser, deal?.ownerId)

  /*
   * Which tab, and how the Overview is arranged. The layout key is per page type rather than per
   * deal: it is a preference about eyes, not about a piece of business.
   */
  const [tab, setTab] = useState<DealTab>('Overview')
  const [layout, chooseLayout] = useRecordLayout('raptor.deal.layout')
  const [smsOpen, setSmsOpen] = useState(false)

  const [editOpen, setEditOpen] = useState(false)
  const [wonOpen, setWonOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [noteLimit, setNoteLimit] = useState<RowLimit>(5)
  const [emailLimit, setEmailLimit] = useState<RowLimit>(5)
  const [composeOpen, setComposeOpen] = useState(false)
  /**
   * Answering a message that is already on the deal.
   *
   * THE DEAL HAD NO REPLY AT ALL. The card listed the conversation and offered no way to take
   * part in it, so answering a client meant leaving for the client page or for Outlook. The firm
   * asked for the same actions everywhere: "the same functions for the emailing inside the leads,
   * the deals, the clients as well."
   */
  const [replyTarget, setReplyTarget] = useState<ComposeOpening | null>(null)
  /* Every address that is us — see the same note on the client page. */
  const mine = useMemo(
    () => [currentUser?.email].filter((a): a is string => !!a),
    [currentUser?.email],
  )
  const [showClientEmails, setShowClientEmails] = useState(false)
  const [taskOpen, setTaskOpen] = useState(false)
  const [proposalOpen, setProposalOpen] = useState(false)
  const [docs, setDocs] = useState<MockDocument[]>([
    { id: 'doc1', name: 'Signed_MSA.pdf', uploadedAt: new Date().toISOString(), size: '212 KB' },
  ])

  const dealActivities = useMemo(() => activities.filter((a) => a.dealId === id).sort((a, b) => new Date(b.activityDate).getTime() - new Date(a.activityDate).getTime()), [activities, id])
  /**
   * Everyone already known on this deal's client and originating lead.
   *
   * The Compose button used to appear only when the deal itself carried a contactId — and no
   * code path has ever set one, on any deal, so email from a deal has never been available to
   * anybody. Recipients are resolved from the client instead, and the address stays typeable
   * for the common case where the right person isn't in the CRM yet.
   */
  const recipients = useMemo(() => {
    const out: { email: string; label: string }[] = []
    const seen = new Set<string>()
    const add = (email?: string, label?: string) => {
      const clean = email?.trim().toLowerCase()
      if (!clean || seen.has(clean)) return
      seen.add(clean)
      out.push({ email: clean, label: label ? `${label} — ${clean}` : clean })
    }
    const dealContact = contactById(deal?.contactId)
    add(dealContact?.email, dealContact ? `${dealContact.firstName} ${dealContact.lastName}` : undefined)
    for (const c of contacts.filter((c) => deal?.companyId && c.companyId === deal.companyId)) {
      add(c.email, `${c.firstName} ${c.lastName}`)
    }
    const lead = deal?.leadId ? leads.find((l) => l.id === deal.leadId) : undefined
    add(lead?.email, lead ? `${lead.firstName} ${lead.lastName}`.trim() || lead.companyName : undefined)
    for (const c of contacts.filter((c) => deal?.leadId && c.leadId === deal.leadId)) {
      add(c.email, `${c.firstName} ${c.lastName}`)
    }
    return out
  }, [deal, contacts, leads, contactById])

  const dealEmails = useMemo(() => dealActivities.filter((a) => a.type === 'Email'), [dealActivities])

  /**
   * The whole client's correspondence, on request.
   *
   * Deliberately a view rather than a copy. Writing an email row onto every deal a client has
   * would double-count it in every activity figure on the dashboard — including the activity
   * target — and make a client with six open deals show the same message six times. One record
   * carrying its client and (where it has one) its deal answers both questions: the deal shows
   * its own thread, and this toggle widens the same data to everything on the account.
   */
  const clientEmails = useMemo(() => {
    if (!deal?.companyId) return []
    return activities
      .filter((a) => a.type === 'Email' && a.companyId === deal.companyId)
      .sort((a, b) => new Date(b.activityDate).getTime() - new Date(a.activityDate).getTime())
  }, [activities, deal])

  const visibleEmails = showClientEmails ? clientEmails : dealEmails
  const dealTasks = useMemo(() => tasks.filter((t) => t.dealId === id), [tasks, id])
  /** Work still outstanding, which is what "open tasks" means to somebody reading a deal. */
  const openDealTasks = useMemo(
    () => dealTasks.filter((t) => t.status !== 'Completed' && t.status !== 'Cancelled').length,
    [dealTasks],
  )
  const dealProposals = useMemo(() => proposals.filter((p) => p.dealId === id), [proposals, id])

  if (!deal) {
    return (
      <div className="text-center py-16 text-slate-400">
        Deal not found. <Link to="/deals" className="text-brand-600 hover:underline">Back to deals</Link>
      </div>
    )
  }

  const company = companyById(deal.companyId)
  const contact = contactById(deal.contactId)
  const kind = dealKind(deal)
  const isHandover = kind === 'Handover'
  const isClosed = deal.stage === 'Won' || deal.stage === 'Rejected'

  /*
   * What has been SENT, in the order it goes out.
   *
   * These three dates lived in the Deal Information panel, which is the last place somebody looks
   * and the first thing they want to know: has the quote gone? has the mandate? has the invoice?
   */
  const paperTrail = [
    deal.quotationSentAt && `Quotation ${formatDate(deal.quotationSentAt)}`,
    deal.mandateSentAt && `Mandate ${formatDate(deal.mandateSentAt)}`,
    deal.invoiceSentAt && `Invoice ${formatDate(deal.invoiceSentAt)}`,
  ].filter(Boolean) as string[]

  /*
   * The contact's numbers, so a deal can be worked from the deal.
   *
   * A deal has no telephone of its own — the person does. Mobile before office: a mobile is
   * answered by them, a switchboard is answered by somebody else.
   */
  const contactNumbers = [
    ...(contact?.mobile ? [{ label: 'Mobile', value: contact.mobile }] : []),
    ...(contact?.phone ? [{ label: 'Office', value: contact.phone }] : []),
  ]

  /*
   * The panels, built once and placed by whichever layout is chosen — the same shape the
   * Account, Lead and Client pages use. A prop added to one arrangement cannot be forgotten in
   * the other two, and that bug is invisible until somebody switches layout.
   */
  /** What this deal is, in fields. */
  const infoPanel = (
    <Card className="@container">
      <CardHeader title="Deal Information" />
      {/* Laid out to the CARD's width, not the window's. `md:` asks about the window, so this
          put three columns inside a 246px side column and squeezed every value to 80px. */}
      <dl className="grid grid-cols-1 @sm:grid-cols-2 @lg:grid-cols-3 gap-x-6 gap-y-3.5 text-sm">
        <Field label="Deal Name" value={deal.name} />
        <Field label="Date Created" value={deal.createdAt ? formatDate(deal.createdAt) : undefined} />
        <Field label="Company" value={company?.name} />
        <Field label="Contact" value={contact ? `${contact.firstName} ${contact.lastName}` : undefined} />
        <Field label="Owner" value={userById(deal.ownerId)?.name} />
        <Field label="Stage" value={deal.stage} />
        <Field label="Probability" value={`${deal.probability}%`} />
        <Field label="Expected Close Date" value={formatDate(deal.expectedCloseDate)} />
        <Field label="Service" value={deal.service} />
        <Field label="Lead Source" value={deal.source} />
        <Field label="Competitor" value={deal.competitor} />
        {deal.rejectionReason && <Field label="Rejection Reason" value={deal.rejectionReason} />}
        <Field label="Weighted Value" value={formatCurrency(Math.round((deal.value * deal.probability) / 100))} />
        {deal.quotationSentAt && <Field label="Quotation Sent" value={formatDate(deal.quotationSentAt)} />}
        {deal.mandateSentAt && <Field label="Mandate Sent" value={formatDate(deal.mandateSentAt)} />}
        {deal.invoiceSentAt && <Field label="Invoice Sent" value={formatDate(deal.invoiceSentAt)} />}
        {deal.handoverAmount != null && <Field label="Agreed Book" value={formatCurrency(deal.handoverAmount)} />}
        {deal.accountsCount != null && <Field label="Number of Accounts / Matters" value={deal.accountsCount.toString()} />}
        {deal.contractStartDate && <Field label="Starting Date" value={formatDate(deal.contractStartDate)} />}
      </dl>
      {deal.notes && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <p className="text-xs font-medium text-slate-400 mb-1">Notes</p>
          <p className="text-sm text-slate-600 whitespace-pre-line">{deal.notes}</p>
        </div>
      )}
    </Card>
  )

  /** Its own tab: a thread grows without limit and does not belong on an overview. */
  const emailsPanel = (
    <Card>
      <CardHeader
        title="Emails"
        subtitle={
          showClientEmails
            ? `${visibleEmails.length} message${visibleEmails.length === 1 ? '' : 's'} across the whole client`
            : `${dealEmails.length} message${dealEmails.length === 1 ? '' : 's'} on this deal`
        }
        action={
          <div className="flex items-center gap-2">
            {company && (
              <button
                onClick={() => setShowClientEmails((v) => !v)}
                aria-pressed={showClientEmails}
                title="Show every email on this client, including messages raised from its other deals"
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border ${
                  showClientEmails ? 'border-gold-500 bg-gold-500/5 text-gold-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Building2 size={12} /> Whole client
              </button>
            )}
            <WriteButton onClick={() => setComposeOpen(true)} />
            <RowLimitSelect value={emailLimit} onChange={setEmailLimit} />
          </div>
        }
      />
      {visibleEmails.length === 0 ? (
        <p className="text-sm text-slate-400">
          {showClientEmails ? 'No emails on this client yet.' : 'No emails on this deal yet.'}
        </p>
      ) : (
        <EmailActivityList
          activities={applyRowLimitKeeping(visibleEmails, emailLimit, focusedEmailId)}
          focusId={focusedEmailId}
          mine={mine}
          onAnswer={(a, mode) => {
            /*
             * The deal's own contact leads. `recipients` carries addresses and labels, not ids,
             * so there is nothing to match an activity's contact_id against here -- and the deal
             * has one contact by definition, which is who the conversation is with.
             */
            const theirAddress = contact?.email ?? recipients[0]?.email ?? null
            if (!theirAddress && mode !== 'forward') return
            setReplyTarget(openingFor(
              {
                rawSubject: a.subject,
                fromName: null,
                fromAddress: theirAddress,
                to: a.emailToRecipients ?? [],
                cc: a.emailCcRecipients ?? [],
                body: a.notes ?? '',
                occurredAt: a.activityDate,
                messageId: a.emailMessageId ?? null,
              },
              mode,
              mine,
            ))
          }}
        />
      )}
    </Card>
  )

  /** Everything that is not an email. */
  const notesPanel = (
    <Card padded={false}>
      <div className="p-5 flex items-center justify-between">
        <h3 className="font-semibold text-slate-800 text-[15px]">Notes &amp; Updates</h3>
        <div className="flex items-center gap-3">
          <RowLimitSelect value={noteLimit} onChange={setNoteLimit} />
          <button onClick={() => setActivityOpen(true)} className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:underline">
            <Plus size={13} /> Add Note
          </button>
        </div>
      </div>
      {/* Everything that happened to this deal, not only what someone typed. "When did the
          quotation go out?" is answered here, next to the notes about it, rather than
          being a date on its own in another tab — and the same list, in the same shape, is
          what a client's page shows. */}
      <div className="px-5 pb-5">
        {dealActivities.length === 0 ? (
          <p className="text-sm text-slate-400">Nothing recorded yet.</p>
        ) : (
          <NoteActivityList activities={dealActivities} limit={noteLimit} />
        )}
      </div>
    </Card>
  )

  /** Its own tab as well: a task list is work, not context. */
  const tasksPanel = (
    <Card padded={false}>
      <div className="p-5 flex items-center justify-between">
        <h3 className="font-semibold text-slate-800 text-[15px]">Tasks</h3>
        <button onClick={() => setTaskOpen(true)} className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:underline">
          <Plus size={13} /> Add Task
        </button>
      </div>
      <div className="px-5 pb-5 divide-y divide-slate-50">
        {dealTasks.length === 0 && <p className="text-sm text-slate-400">No tasks yet.</p>}
        {dealTasks.map((t) => (
          <div key={t.id} className="flex items-center gap-3 py-2.5">
            <input
              type="checkbox"
              checked={t.status === 'Completed'}
              onChange={(e) => updateTask(t.id, { status: e.target.checked ? 'Completed' : 'Not Started', completedAt: e.target.checked ? new Date().toISOString() : undefined })}
              className="w-4 h-4 accent-brand-600"
            />
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${t.status === 'Completed' ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{t.title}</p>
              <p className="text-xs text-slate-400">{t.type} · Due {formatDate(t.dueDate)}</p>
            </div>
            <UserAvatar userId={t.ownerId} size={22} />
          </div>
        ))}
      </div>
    </Card>
  )

  /** The quotes that have gone out. */
  const proposalsPanel = (
    <Card padded={false}>
      <div className="p-5 flex items-center justify-between">
        <h3 className="font-semibold text-slate-800 text-[15px]">Quotes / Proposals</h3>
        <button onClick={() => setProposalOpen(true)} className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:underline">
          <Plus size={13} /> Create Proposal
        </button>
      </div>
      <div className="px-5 pb-5 space-y-3">
        {dealProposals.length === 0 && <p className="text-sm text-slate-400">No proposals yet.</p>}
        {dealProposals.map((p) => (
          <div key={p.id} className="border border-slate-100 rounded-xl p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-700">{p.service}</p>
                <p className="text-xs text-slate-400 mt-0.5">Valid until {formatDate(p.validityDate)}</p>
              </div>
              <ProposalStatusBadge status={p.status} />
            </div>
            <p className="text-lg font-bold text-slate-800 mt-2">{formatCurrency(p.pricing)}</p>
            {p.description && <p className="text-xs text-slate-500 mt-1">{p.description}</p>}
            <div className="flex flex-wrap gap-1.5 mt-3">
              {(['Draft', 'Sent', 'Viewed', 'Accepted', 'Declined', 'Expired'] as ProposalStatus[]).map((s) => (
                <button
                  key={s}
                  onClick={() => updateProposal(p.id, { status: s })}
                  className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
                    p.status === s ? 'bg-brand-600 text-white border-brand-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  Mark {s}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )

  /** What is attached to the deal. */
  const documentsPanel = (
    <Card padded={false}>
      <div className="p-5 flex items-center justify-between">
        <h3 className="font-semibold text-slate-800 text-[15px]">Documents</h3>
        <button
          onClick={() =>
            setDocs((prev) => [{ id: `doc${prev.length + 1}`, name: `Document_${prev.length + 1}.pdf`, uploadedAt: new Date().toISOString(), size: `${(Math.random() * 500 + 50).toFixed(0)} KB` }, ...prev])
          }
          className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:underline"
        >
          <Upload size={13} /> Upload Document
        </button>
      </div>
      <div className="px-5 pb-5 divide-y divide-slate-50">
        {docs.map((d) => (
          <div key={d.id} className="flex items-center gap-3 py-2.5">
            <FileText size={18} className="text-slate-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-700 truncate">{d.name}</p>
              <p className="text-xs text-slate-400">{d.size} · Uploaded {formatDate(d.uploadedAt)}</p>
            </div>
            <button onClick={() => setDocs((prev) => prev.filter((x) => x.id !== d.id))} className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </Card>
  )

  /** The dates, in the order they happened. */
  const historyPanel = (
    <Card padded={false}>
      <div className="p-5">
        <h3 className="font-semibold text-slate-800 text-[15px]">History</h3>
      </div>
      <div className="px-5 pb-5 space-y-3">
        <HistoryRow label="Deal created" date={deal.createdAt} />
        {dealActivities
          .filter((a) => ['Deal Stage Change', 'Deal update', 'Deal Won', 'Deal Rejected'].includes(a.type))
          .map((a) => (
            <HistoryRow key={a.id} label={a.subject} date={a.activityDate} />
          ))}
        {deal.wonAt && <HistoryRow label="Deal marked Won" date={deal.wonAt} />}
        {deal.rejectedAt && <HistoryRow label="Deal rejected" date={deal.rejectedAt} />}
      </div>
    </Card>
  )

  return (
    <div className="space-y-5">
      <Link to="/deals" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={15} /> Back to Deals
      </Link>

      {/*
        The same band, figures, comment and action row every other record page wears.

        This page had none of it: a plain white card with the name and the value in it, then a
        row of small buttons in a size nothing else used. The firm asked for one grammar across
        the app, and a deal is where a lead becomes a client — the page you should least have to
        relearn.
      */}
      <DashboardHero
        eyebrow={`Deal \u00b7 ${kind}`}
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            {deal.name}
            <StageBadge stage={deal.stage} label={dealStageLabel(deal)} />
          </span>
        }
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            {company && (
              <Link to={`/companies/${company.id}`} className="text-gold-400 hover:underline">
                {company.name}
              </Link>
            )}
            {contact && (
              <>
                <span className="text-white/30">\u00b7</span>
                <span>{contact.firstName} {contact.lastName}</span>
              </>
            )}
          </span>
        }
      >
        <HeroOwner ownerId={deal.ownerId} label="Owner" />
      </DashboardHero>

      <RecordFigures count={isHandover ? 5 : 4}>
        {/* A handover earns nothing at signature, so showing a deal value would be inventing one.
            Its size is the book — and even that is what the client says rather than what
            arrives. */}
        <RecordFigure
          label={isHandover ? 'Agreed book' : 'Deal value'}
          value={isHandover
            ? deal.handoverAmount != null ? formatCurrency(deal.handoverAmount) : '\u2014'
            : formatCurrency(deal.value)}
          note={isHandover ? 'what the client says they will hand over' : undefined}
          strong
        />
        {isHandover && (
          <RecordFigure label="Accounts"
            value={deal.accountsCount != null ? String(deal.accountsCount) : '\u2014'}
            note={deal.accountsCount == null ? 'not estimated yet' : 'on the mandate'} />
        )}
        <RecordFigureShell label="Stage">
          <StageBadge stage={deal.stage} label={dealStageLabel(deal)} />
        </RecordFigureShell>
        <RecordFigure label="Expected close" value={formatDate(deal.expectedCloseDate)} small />
        <RecordFigure label="Service" value={deal.service ?? '\u2014'} small />
      </RecordFigures>

      {/*
        The two lines the next person needs, above the actions, exactly as on an account, a lead
        and a client. The paperwork rides along with it: what has been sent and when is the thing
        somebody actually opens a deal to find out, and it was buried in the panel below.
      */}
      <RecordComment
        text={deal.mainComment}
        at={deal.mainCommentAt}
        placeholder="Where does this deal stand? Two lines is plenty."
        onSave={(text) => updateDeal(deal.id, {
          mainComment: text || undefined,
          mainCommentAt: new Date().toISOString(),
          mainCommentBy: currentUser?.id,
        })}
        summary={(
          <RecordCommentSummary>
            <RecordCommentFact label="Paperwork">
              {paperTrail.length > 0
                ? paperTrail.map((p) => (
                  <span key={p} className="text-xs px-2 py-0.5 rounded-md bg-white border border-slate-200">
                    {p}
                  </span>
                ))
                : <span className="text-slate-400">Nothing sent yet</span>}
            </RecordCommentFact>
            <RecordCommentFact label="Quotes / proposals">
              {dealProposals.length === 0
                ? <span className="text-slate-400">None yet</span>
                : <span className="font-medium tabular-nums">{dealProposals.length}</span>}
            </RecordCommentFact>
            <RecordCommentFact label="Open tasks">
              {openDealTasks === 0
                ? <span className="text-slate-400">None</span>
                : <span className="font-medium tabular-nums">{openDealTasks}</span>}
            </RecordCommentFact>
          </RecordCommentSummary>
        )}
      />

      <Card>
        <RecordActions>
          {/*
            The contact's own numbers, so a deal can be worked from the deal. Nothing is charged:
            a client is the person paying us, not a debtor. See CrmCallButton.
          */}
          <CrmCallButton
            numbers={contactNumbers}
            to={{ dealId: deal.id, contactId: deal.contactId, companyId: deal.companyId }}
            subject={contact ? `${contact.firstName} ${contact.lastName}` : deal.name}
            className={`${ACTION_BASE} ${ACTION_ENABLED}`}
          />
          <RecordAction icon={MessageSquare} label="SMS"
            onClick={contactNumbers.length > 0 ? () => setSmsOpen(true) : undefined}
            title={contactNumbers.length > 0
              ? 'Text the contact on this deal \u2014 nothing is charged'
              : 'No phone number on this deal\u2019s contact'} />
          <RecordAction icon={Mail} label="Email" onClick={() => setComposeOpen(true)}
            title="Send from your connected mailbox" />
          <RecordAction icon={StickyNote} label="Add Activity" onClick={() => setActivityOpen(true)}
            title="Write on the timeline" />
          {canEdit && (
            <RecordAction icon={CheckCircle2} label={isHandover ? 'Mandate Signed' : 'Mark Won'} primary
              onClick={isClosed ? undefined : () => setWonOpen(true)}
              title={isClosed ? 'This deal is already closed.' : undefined} />
          )}

          <RecordActionsMore>
            <RecordMoreAction icon={CheckSquare} label="Create task" onClick={() => setTaskOpen(true)} />
            {canEdit && !isClosed && !isHandover && !deal.quotationSentAt && (
              <RecordMoreAction icon={FileText} label="Quotation sent" onClick={() => logDealDocument(deal.id, 'quotation')} />
            )}
            {canEdit && !isClosed && isHandover && !deal.mandateSentAt && (
              <RecordMoreAction icon={FileText} label="Mandate sent" onClick={() => logDealDocument(deal.id, 'mandate')} />
            )}
            {canEdit && !deal.invoiceSentAt && !isHandover && deal.stage === 'Won' && (
              <RecordMoreAction icon={Send} label="Invoice sent" onClick={() => logDealDocument(deal.id, 'invoice')} />
            )}
            {canEdit && <RecordMoreAction icon={Pencil} label="Edit deal" onClick={() => setEditOpen(true)} />}
            {canEdit && (
              <RecordMoreAction icon={XCircle} label="Mark rejected" danger
                onClick={isClosed ? undefined : () => setRejectOpen(true)}
                title={isClosed ? 'This deal is already closed.' : undefined} />
            )}
          </RecordActionsMore>
        </RecordActions>
      </Card>

      {/*
        Tabs over the detail, like every other record page. This was one scroll of seven cards:
        information, then every email, then every note, then tasks, quotes, documents and the
        history somebody scrolled past to reach. The long lists get their own tabs.
      */}
      <RecordTabs<DealTab>
        tabs={[
          { id: 'Overview', label: 'Overview' },
          { id: 'Emails', label: 'Emails', count: dealEmails.length },
          { id: 'Notes', label: 'Notes', count: dealActivities.length - dealEmails.length },
          { id: 'Tasks', label: 'Tasks', count: dealTasks.length },
          { id: 'Documents', label: 'Documents', count: docs.length },
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
          details={infoPanel}
          /* Notes in the middle, and still on their own tab — both places, at the firm's asking. */
          main={<div className="space-y-5">{proposalsPanel}{notesPanel}</div>}
          side={[historyPanel]}
        />
      )}

      {tab === 'Emails' && emailsPanel}
      {tab === 'Notes' && notesPanel}
      {tab === 'Tasks' && tasksPanel}
      {tab === 'Documents' && documentsPanel}









      {/* Nothing is charged for this — see CrmSmsModal, which says so on screen too. */}
      {smsOpen && (
        <CrmSmsModal
          numbers={contactNumbers}
          target={{ dealId: deal.id }}
          who={contact ? `${contact.firstName} ${contact.lastName}` : deal.name}
          onClose={() => setSmsOpen(false)}
          onSent={(a) => addActivity({ type: 'SMS', ...a, dealId: deal.id, companyId: deal.companyId, contactId: deal.contactId })}
        />
      )}

      {composeOpen && (
        <ComposeEmailModal
          to={contact?.email ?? recipients[0]?.email}
          recipients={recipients}
          contextNote={`Filed against this deal${company ? ` and ${company.name}` : ''}${deal.leadId ? ", and the lead's history" : ''} — one record, visible on each.`}
          onClose={() => setComposeOpen(false)}
          onSent={(subject, bodyText, emailMessageId) =>
            // Carries the deal; addActivity fills the client in from it, so one record lands on
            // both the deal's thread and the client's — no second copy. The Message-ID is what
            // lets the recipient's reply find its way back to this deal specifically.
            addActivity({ type: 'Email', subject, notes: bodyText, dealId: deal.id, contactId: contact?.id, emailMessageId })
          }
        />
      )}
      {replyTarget && (
        <ComposeEmailModal
          to={replyTarget.to}
          recipients={recipients}
          initialCc={replyTarget.cc}
          initialSubject={replyTarget.subject}
          initialBody={replyTarget.body}
          inReplyTo={replyTarget.inReplyTo}
          contextNote={`Filed against this deal${company ? ` and ${company.name}` : ''}${deal.leadId ? ", and the lead's history" : ''} — one record, visible on each.`}
          onClose={() => setReplyTarget(null)}
          onSent={(subject, bodyText, emailMessageId) =>
            addActivity({ type: 'Email', subject, notes: bodyText, dealId: deal.id, contactId: contact?.id, emailMessageId })
          }
        />
      )}
      {editOpen && (
        <EditDealModal deal={deal} reps={reps} canReassign={canReassign(currentUser)} onClose={() => setEditOpen(false)} onSave={(patch) => updateDeal(deal.id, patch)} />
      )}
      {wonOpen && <MarkWonModal deal={deal} onClose={() => setWonOpen(false)} onSave={(details: WonDealDetails) => markDealWon(deal.id, details)} />}
      {rejectOpen && (
        <MarkRejectedModal
          onClose={() => setRejectOpen(false)}
          onSave={(reason, note) => {
            markDealRejected(deal.id, reason, note)
            // A rejected deal is finished — there's nothing left to do on its page. Back to
            // the board, where it's now sitting in Rejected alongside the others.
            navigate('/deals')
          }}
        />
      )}
      {activityOpen && (
        <AddActivityModal onClose={() => setActivityOpen(false)} onSave={(type, notes) => addActivity({ type, subject: `${type} logged on ${deal.name}`, notes, dealId: deal.id, companyId: deal.companyId })} />
      )}
      {taskOpen && (
        <AddTaskModal onClose={() => setTaskOpen(false)} onSave={(title, dueDate, type) => addTask({ title, dueDate, type, dealId: deal.id, companyId: deal.companyId, relatedToLabel: deal.name })} />
      )}
      {proposalOpen && (
        <CreateProposalModal
          defaultService={deal.service ?? services[0]}
          defaultValue={deal.value}
          onClose={() => setProposalOpen(false)}
          onSave={(input) => addProposal({ dealId: deal.id, companyId: deal.companyId, contactId: deal.contactId, ...input })}
        />
      )}
    </div>
  )
}

function HistoryRow({ label, date }: { label: string; date: string }) {
  return (
    <div className="flex items-center justify-between text-sm border-b border-slate-50 pb-2.5 last:border-0">
      <span className="text-slate-600">{label}</span>
      <span className="text-xs text-slate-400">{formatDateTime(date)}</span>
    </div>
  )
}

function ProposalStatusBadge({ status }: { status: ProposalStatus }) {
  const tone: Record<ProposalStatus, string> = {
    Draft: 'bg-slate-100 text-slate-600',
    Sent: 'bg-[var(--tint-steel)] text-[var(--c-steel)]',
    Viewed: 'bg-[var(--tint-steel)] text-[var(--c-navy-deep)]',
    Accepted: 'bg-[var(--tint-gold-deep)] text-[var(--c-gold-deep)]',
    Declined: 'bg-[var(--tint-rust-deep)] text-[var(--c-rust-deep)]',
    Expired: 'bg-[var(--tint-rust)] text-[var(--c-rust)]',
  }
  return <span className={`badge ${tone[status]}`}>{status}</span>
}

/*
 * ActionButton used to live here — its own size, its own colours, its own idea of what disabled
 * looks like. It is now RecordAction in components/record/RecordShell, shared with the Account,
 * Lead and Client pages, because the firm asked for one grammar across the app.
 */

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-400 mb-0.5">{label}</dt>
      <dd className="text-slate-700 font-medium">{value || '—'}</dd>
    </div>
  )
}

function EditDealModal({
  deal,
  reps,
  canReassign,
  onClose,
  onSave,
}: {
  deal: ReturnType<typeof useAppStore>['deals'][number]
  reps: ReturnType<typeof useAppStore>['users']
  canReassign: boolean
  onClose: () => void
  onSave: (patch: Partial<typeof deal>) => void
}) {
  const [form, setForm] = useState({ ...deal, expectedCloseDate: deal.expectedCloseDate.slice(0, 10) })
  return (
    <Modal title="Edit Deal" onClose={onClose} width={520}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSave({ ...form, expectedCloseDate: new Date(form.expectedCloseDate).toISOString() })
          onClose()
        }}
      >
        <FormField label="Deal Name" required>
          <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Value (R)">
            <input type="number" className={inputClass} value={form.value} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} />
          </FormField>
          <FormField label="Probability (%)">
            <input type="number" min={0} max={100} className={inputClass} value={form.probability} onChange={(e) => setForm({ ...form, probability: Number(e.target.value) })} />
          </FormField>
          <FormField label="Expected Close Date">
            <input type="date" className={inputClass} value={form.expectedCloseDate} onChange={(e) => setForm({ ...form, expectedCloseDate: e.target.value })} />
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
          <FormField label="Service">
            <select className={inputClass} value={form.service ?? ''} onChange={(e) => setForm({ ...form, service: e.target.value })}>
              {services.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Competitor">
            <input className={inputClass} value={form.competitor ?? ''} onChange={(e) => setForm({ ...form, competitor: e.target.value })} />
          </FormField>
        </div>
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

const ACTIVITY_TYPES: ActivityType[] = ['Call', 'Email', 'WhatsApp', 'Meeting', 'Note', 'Proposal', 'Deal update']

function AddActivityModal({ onClose, onSave }: { onClose: () => void; onSave: (type: ActivityType, notes: string) => void }) {
  const [type, setType] = useState<ActivityType>('Call')
  const [notes, setNotes] = useState('')
  return (
    <Modal title="Add Activity" onClose={onClose} width={420}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSave(type, notes)
          onClose()
        }}
      >
        <FormField label="Activity Type">
          <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as ActivityType)}>
            {ACTIVITY_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Notes">
          <textarea className={inputClass} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            Log Activity
          </button>
        </div>
      </form>
    </Modal>
  )
}

function AddTaskModal({ onClose, onSave }: { onClose: () => void; onSave: (title: string, dueDate: string, type: TaskType) => void }) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('09:00')
  const [type, setType] = useState<TaskType>('Follow-up')
  return (
    <Modal title="Add Task" onClose={onClose} width={420}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!title || !date) return
          onSave(title, new Date(`${date}T${time}`).toISOString(), type)
          onClose()
        }}
      >
        <FormField label="Task Title" required>
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Date" required>
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} required />
          </FormField>
          <FormField label="Time">
            <input type="time" className={inputClass} value={time} onChange={(e) => setTime(e.target.value)} />
          </FormField>
        </div>
        <FormField label="Type">
          <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as TaskType)}>
            {(['Call', 'Follow-up', 'Email', 'Proposal', 'Meeting', 'WhatsApp', 'Internal task', 'Other'] as TaskType[]).map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </FormField>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            Add Task
          </button>
        </div>
      </form>
    </Modal>
  )
}

function CreateProposalModal({
  defaultService,
  defaultValue,
  onClose,
  onSave,
}: {
  defaultService: string
  defaultValue: number
  onClose: () => void
  onSave: (input: { service: string; pricing: number; description: string; terms: string; validityDate: string }) => void
}) {
  const [form, setForm] = useState({
    service: defaultService,
    pricing: String(defaultValue),
    description: '',
    terms: 'Net 30 days. Valid for 30 days from issue date.',
    validityDate: '',
  })
  return (
    <Modal title="Create Proposal" onClose={onClose} width={480}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!form.validityDate) return
          onSave({ service: form.service, pricing: Number(form.pricing) || 0, description: form.description, terms: form.terms, validityDate: new Date(form.validityDate).toISOString() })
          onClose()
        }}
      >
        <FormField label="Service" required>
          <select className={inputClass} value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })}>
            {services.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Pricing (R)" required>
            <input type="number" className={inputClass} value={form.pricing} onChange={(e) => setForm({ ...form, pricing: e.target.value })} required />
          </FormField>
          <FormField label="Validity Date" required>
            <input type="date" className={inputClass} value={form.validityDate} onChange={(e) => setForm({ ...form, validityDate: e.target.value })} required />
          </FormField>
        </div>
        <FormField label="Description">
          <textarea className={inputClass} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </FormField>
        <FormField label="Terms">
          <textarea className={inputClass} rows={2} value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} />
        </FormField>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            <Send size={13} /> Save Proposal
          </button>
        </div>
      </form>
    </Modal>
  )
}
