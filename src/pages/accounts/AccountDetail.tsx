import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, ArrowLeft, Building2, CalendarClock, Check, CheckCircle2, Gavel, Home, Loader2,
  Mail, MapPin, MessageCircle, MessageSquare, Phone, Plus, Printer, ScrollText, Search, ShieldAlert, StickyNote,
  User, Users, X, XCircle,
} from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { PhoneLink } from '../../components/PhoneLink'
import { DashboardHero } from '../../components/dashboard/DashboardHero'
import {
  ACTION_BASE, ACTION_ENABLED, RecordAction as Action, RecordActions, RecordFigure as Figure,
  RecordFigures, RecordLayout, RecordLayoutSwitcher, RecordTabs, useRecordLayout,
} from '../../components/record/RecordShell'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { StatusPill } from './AccountsList'
import { fetchAccount, fetchLedgers, hasCommissionDrift, type AccountLedgers, type DebtorAccount } from '../../lib/accountBook'
import { buildStatement, type BalanceInput, type BalanceBreakdown, type StatementLine } from '../../lib/accountBalance'
import { chargeMessage } from '../../lib/accountCharges'
import { promiseProblem, recordPromise, PROMISE_ITEM_ID } from '../../lib/accountPromises'
import {
  addNote, describeArrangement, fetchDocuments, fetchWorkspace, isOverdue,
  keepInstalment, nextPromise, resolvePromise, saveMainComment, dialableNumber, reachableNumbers,
  ARRANGEMENT_LABEL, WEEKDAYS,
  type AccountDocument, type Arrangement, type PromiseToPay, type Workspace,
} from '../../lib/accountWorkspace'
import { buildTimeline, filterTimeline, groupByDay, type TimelineEntry } from '../../lib/accountTimeline'
import { isWrittenOff } from '../../lib/accountStatus'
import { canFreezeAccounts, canViewClients } from '../../lib/permissions'
import { timeOnDesk } from '../../lib/dateLabels'
import { styleFor, PROMISE_CHIP } from './timelineStyle'
import { DebtorDetailsPanel, DocumentsPanel, MainComment, useWriter } from './AccountWorkspacePanels'
import { QueryPanel, OutcomeOutstanding } from './QueryPanel'
import { EscalateModal } from './EscalateModal'
import { FreezeModal } from './FreezeModal'
import { ClientActionModal } from './ClientActionModal'
import {
  CLIENT_FLAGS, CLIENT_POSITIONS, DESK_POSITIONS, deskPosition, frozenByLabel, positionReport,
  type ClientFlag, type DeskPosition,
} from '../../lib/clientPosition.ts'
import { clientLine, type ClientLine } from '../../lib/accountNarrative.ts'
import {
  directorshipSummary, judgmentSummary, practitionerLabel, practitionerMeaning, splitJudgments,
  type AccountDirector, type AccountJudgment, type AccountStanding, type DirectorCompany,
  type PractitionerKind,
} from '../../lib/accountStanding.ts'
import { fetchStanding } from '../../lib/accountStandingData.ts'
import { DirectorModal } from './DirectorModal'
import { heldProperty, propertyAcross, traceSummary, type FiledTrace } from '../../lib/traceStore.ts'
import { fetchTraces } from '../../lib/traceStoreData.ts'
import { TraceWorkspaceModal } from './TraceWorkspaceModal'
import { TraceUploadModal } from './TraceUploadModal'
import { PractitionerModal } from './PractitionerModal'
import { TraceButton } from './TraceButton'
import { SmsModal } from './SmsModal'
import { CallScriptModal } from './CallScriptModal'
import { DiaryWorkBar } from '../../components/diary/DiaryWorkBar'
import { DiariseModal } from '../../components/diary/DiariseModal'
import { fetchQueries, type AccountQuery } from '../../lib/accountQueries'
import {
  fetchAccountEmails, markRepliesRead, markRepliesUnread, recordSentEmail, replySubject,
  type AccountEmail,
} from '../../lib/accountEmails'
import { EmailsPanel } from './EmailsPanel'
/* The same four helpers the mailbox answers its own mail with. Written once, so a reply-all from
   an account and a reply-all from the mailbox cannot disagree about who is on a thread. */
import { forwardBody, forwardSubject, recipientLine, replyAllTo } from '../../lib/emailRules'
import { ComposeEmailModal } from '../../components/ComposeEmailModal'
import { CallButton } from './CallButton'
import { feeCeiling, scheduleFor } from '../../lib/annexureB'
import { formatMoney, formatDate } from '../../data/mockData'
import { mergeValuesFor } from '../../lib/messageTemplates'
import { FIRM_UNSET, fetchFirmSettings, type FirmSettings } from '../../lib/firmSettings'
import { dayKey } from '../../lib/collectionPace'
import { addWorkingDays } from '../../lib/workingDays'
import type { AccountContact } from '../../lib/accountWorkspace'
import { OtherAccountsPanel } from '../../components/collections/OtherAccountsPanel'
import { debtorKey, type OtherAccount } from '../../lib/sameDebtor'
import { fetchOtherAccounts } from '../../lib/accountBook'
import { useTitleSlot } from '../../components/layout/TitleSlot'
import { compareTraceReports, comparisonLine, previousTraceFor } from '../../lib/traceCompare.ts'
import {
  hasProgress, instalmentProgress, moneyProgress, progressPercent, type PaymentProgress,
} from '../../lib/paymentProgress.ts'
import { instalmentsDue } from '../../lib/arrangements'

type Tab = 'Overview' | 'Transactions' | 'Emails' | 'Documents'

/**
 * How the Overview arranges its six panels.
 *
 * The same panels every time — what changes is where they sit. Collectors work this page all day
 * on very different screens: a wide desktop where three columns read at a glance, a laptop where
 * the middle column gets squeezed, an iPad held in one hand. The firm asked to be able to choose
 * rather than have the page choose for them.
 */
/*
 * The layout switcher is now shared with every other record page — see RecordShell. The key stays
 * per page type, because the right arrangement genuinely differs: an account has a long timeline
 * to give width to, a lead has not.
 */
const LAYOUT_KEY = 'raptor.account.layout'

const TODAY = new Date().toISOString().slice(0, 10)

/**
 * One debtor account: who to call, what the story is, and what is owed.
 *
 * Three columns under the Overview tab, because that is the shape of the work. A collector picks
 * up an account and needs a number to dial, the history to know what has already been tried, and
 * the figures to know what to ask for — all at once, not behind tabs.
 *
 * The balance shown is **computed** from the three ledgers, never a stored figure. That is the
 * point of the whole model: a debtor, a client or the Council for Debt Collectors can ask how a
 * number was arrived at, and Transactions is the answer, line by line.
 */
export function AccountDetail() {
  const { id } = useParams<{ id: string }>()
  const { companies, users } = useAppStore()
  const { currentUser, session } = useAuth()
  const [account, setAccount] = useState<DebtorAccount | null>(null)
  const [ledgers, setLedgers] = useState<AccountLedgers | null>(null)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [documents, setDocuments] = useState<AccountDocument[]>([])
  const [queries, setQueries] = useState<AccountQuery[]>([])
  const [emails, setEmails] = useState<AccountEmail[]>([])
  const [standing, setStanding] = useState<AccountStanding>({ directors: [], judgments: [] })
  const [traces, setTraces] = useState<FiledTrace[]>([])
  /** The same debtor's accounts elsewhere on the book. Derived from the identity number. */
  const [otherAccounts, setOtherAccounts] = useState<OtherAccount[]>([])
  /** Which filed trace is open for working. See TraceWorkspaceModal. */
  const [openTrace, setOpenTrace] = useState<string | null>(null)
  /** Whether the signed-in agent has a mailbox connected at all. Null while we are asking. */
  const [mailbox, setMailbox] = useState<string | null>(null)
  /** Set when writing a reply, so the debtor's client threads our answer under their message. */
  const [replyTo, setReplyTo] = useState<AccountEmail | null>(null)
  /*
   * Arriving from the Messages menu.
   *
   * The `email` parameter picks the Emails tab and nothing more. It deliberately does NOT open
   * the message: the firm's instruction was "just take it to the account and show the email as
   * unread on the account", and the unread marker is what tells you which one to open. Landing
   * on the Overview with the reply three tabs away would be the other failure, so the tab still
   * switches.
   */
  const [params] = useSearchParams()
  const cameForEmail = params.get('email') !== null
  const [tab, setTab] = useState<Tab>(cameForEmail ? 'Emails' : 'Overview')
  const [layout, chooseLayout] = useRecordLayout(LAYOUT_KEY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [composeTo, setComposeTo] = useState<string | null>(null)
  /**
   * The Cc line the composer opens with, for a reply-all.
   *
   * Editable in the box, deliberately: a reply-all that quietly copied a debtor's attorney would
   * be the firm's mistake and not the sender's, and the only moment to catch it is before Send.
   */
  const [composeCc, setComposeCc] = useState('')
  /**
   * The message being passed on, where this is a forward.
   *
   * Separate from replyTo because the two produce opposite openings: a reply is threaded and
   * addressed and starts empty; a forward is neither threaded nor addressed and starts with the
   * original quoted under it.
   */
  const [forwardOf, setForwardOf] = useState<AccountEmail | null>(null)

  /**
   * Clear whatever the last message left behind, before opening the composer again.
   *
   * Four buttons now open the same modal with four different shapes. Without one place that
   * resets them, forwarding a message and then replying to a different one opens a reply that is
   * still carrying the forward's quoted body — the sort of bug that sends the wrong email.
   */
  function startCompose() {
    setReplyTo(null)
    setForwardOf(null)
    setComposeCc('')
  }

  // The action bar drives the panels below it rather than opening modals of its own: "Add Note"
  // puts the cursor in the note box that is already on the page, so there is one way to write a
  // note and not two that can drift apart.
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const [promiseOpen, setPromiseOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [disputing, setDisputing] = useState(false)
  const [freezing, setFreezing] = useState(false)
  const [askingClient, setAskingClient] = useState(false)
  const [smsOpen, setSmsOpen] = useState(false)
  const [scriptOpen, setScriptOpen] = useState(false)
  /*
   * THE FIRM'S OWN HALF OF A LETTER — its trust account, who signs, its name.
   *
   * Read once per account rather than per message: it is one row and it changes about never, and
   * fetching it again for every compose would put a round trip in front of a button somebody
   * presses fifty times a day. FIRM_UNSET while it is in flight, so a compose opened in the first
   * moment shows {{firm_bank}} standing rather than a blank line that reads as finished.
   */
  const [firm, setFirm] = useState<FirmSettings>(FIRM_UNSET)
  useEffect(() => { void fetchFirmSettings().then(setFirm) }, [])

  /*
   * THE DEBTOR'S OTHER ACCOUNTS, fetched only where the identity number can be trusted.
   *
   * `debtorKey` is asked first so the common case costs nothing: an account with no ID, or with
   * the telephone number the old sheet put in that column, makes no request at all. Cleared on
   * the way in, or clicking from one of a debtor's accounts to another would show the first
   * account's list against the second for as long as the fetch took -- which on this panel means
   * offering somebody a link back to the account they are already looking at.
   */
  useEffect(() => {
    setOtherAccounts([])
    if (!account?.id) return
    const key = debtorKey(account.debtorIdNumber, account.debtorKind)
    if (!key) return
    let live = true
    void fetchOtherAccounts(account.id, account.debtorIdNumber ?? '', account.debtorKind)
      .then((rows) => { if (live) setOtherAccounts(rows) })
      .catch(() => { /* A panel that cannot load is a panel that is not shown. */ })
    return () => { live = false }
  }, [account?.id, account?.debtorIdNumber, account?.debtorKind])
  const [diariseOpen, setDiariseOpen] = useState(false)
  const [tracing, setTracing] = useState(false)
  /** Null = closed. A kind inside it is the office the trace's status line implied. */
  const [practitioner, setPractitioner] = useState<{ suggest: PractitionerKind | null } | null>(null)
  /* Null when closed; `editing` null means adding, a director means correcting that one. */
  const [director, setDirector] = useState<{ editing: AccountDirector | null } | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true); setError(null)
    ;(async () => {
      try {
        /*
         * All at once, not the account first and everything else after.
         *
         * Every one of these keys on the account id, which the URL already gives us — waiting for
         * the account row before asking for its ledgers doubled the page's opening latency for no
         * information gained. From Paris that is a round trip of about 200ms, spent to learn
         * something we knew before the page rendered.
         */
        const [a, l, w, d, q, e, st, tr] = await Promise.all([
          fetchAccount(id), fetchLedgers(id), fetchWorkspace(id), fetchDocuments(id), fetchQueries(id),
          fetchAccountEmails(id), fetchStanding(id), fetchTraces(id),
        ])
        if (cancelled) return
        setAccount(a)
        if (a) { setLedgers(l); setWorkspace(w); setDocuments(d); setQueries(q); setEmails(e); setStanding(st); setTraces(tr) }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [id])

  /*
   * Writes are few and small, so everything is refetched rather than patched in place. The
   * alternative is several sets of local reducers that can drift from what the database holds.
   *
   * The LEDGERS are part of "everything", and were not. Nothing on this page raised a fee when
   * this was written; two things do now — a trace and a dispute — and both left the money they
   * had just charged invisible until somebody reloaded the browser. That is not a cosmetic lag:
   * the statement, the Transactions tab and the account summary are all built from these rows,
   * so a collector could trace a debtor and email them a statement that did not have the trace
   * on it.
   */
  /*
   * Can this agent send anything?
   *
   * Mail goes out through their OWN connected mailbox, so an agent who has not connected one in
   * Settings cannot email a debtor at all. Asked once, up front, so the buttons can say why they
   * are disabled instead of letting someone write a demand letter and fail on Send.
   */
  useEffect(() => {
    const token = session?.access_token
    if (!token) return
    let cancelled = false
    void fetch('/api/email/status', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((b: { connected?: boolean; email?: string | null }) => {
        if (!cancelled && b.connected) setMailbox(b.email ?? null)
      })
      .catch(() => { /* a status we could not read just leaves the buttons disabled. */ })
    return () => { cancelled = true }
  }, [session])

  const reload = useCallback(async () => {
    if (!account) return
    const [a, l, w, d, q, e, st, tr] = await Promise.all([
      fetchAccount(account.id), fetchLedgers(account.id), fetchWorkspace(account.id),
      fetchDocuments(account.id), fetchQueries(account.id), fetchAccountEmails(account.id),
      fetchStanding(account.id), fetchTraces(account.id),
    ])
    if (a) setAccount(a)
    setLedgers(l)
    setWorkspace(w)
    setDocuments(d)
    setQueries(q)
    setEmails(e)
    setStanding(st)
    setTraces(tr)
  }, [account])

  const { busy: savingComment, run: runComment } = useWriter(reload)
  const { busy: queryBusy, run: runQuery } = useWriter(reload)

  const client = companies.find((c) => c.id === account?.companyId)

  const statement = useMemo(() => {
    if (!account || !ledgers) return null
    const input: BalanceInput = {
      capitalHandedOver: account.capitalHandedOver,
      handoverDate: account.handoverDate,
      inDuplum: account.inDuplum,
      // An account written off stopped accruing then. Swordfish records the date inside the
      // comment ("Closed on 2026/09/07 ..."), which we do not have, so the last action stands in
      // for it — imprecise, and labelled as such rather than presented as the closing date.
      writtenOffAt: isWrittenOff(account.status) ? account.lastActionAt : null,
      // Interest runs to today, not to the last monthly posting. Without this the balance stands
      // still between postings and a collector quotes a settlement that is days out of date.
      interestRateAnnual: account.interestRateAnnual,
      accrueTo: new Date().toISOString().slice(0, 10),
      ledgers: {
        payments: ledgers.payments
          .filter((p) => !p.reversedAt)
          .map((p) => ({
            date: p.receivedAt.slice(0, 10),
            amount: p.amount,
            paidToClient: p.paidToClient,
            commissionExclVat: p.collectionCommission,
          })),
        fees: ledgers.fees.map((f) => ({
          date: f.incurredAt.slice(0, 10),
          at: f.incurredAt,
          description: f.description,
          exclVat: f.amountExclVat,
          vat: f.vatAmount,
          billed: f.billed,
          segments: f.segments,
        })),
        interest: ledgers.accruals.map((i) => ({ from: i.accruedOn, days: i.days, amount: i.amountAccrued })),
      },
    }
    return buildStatement(input)
  }, [account, ledgers])

  const timeline = useMemo(
    () => buildTimeline(ledgers, workspace?.notes ?? [], workspace?.promises ?? [], account && {
      handoverDate: account.handoverDate,
      importedAt: account.createdAt,
    }),
    [ledgers, workspace, account],
  )

  const ceiling = useMemo(() => {
    if (!account) return null
    const schedule = scheduleFor(account.lastActionAt ?? account.handoverDate ?? new Date().toISOString())
    return { limit: feeCeiling(account.capitalHandedOver, schedule) }
  }, [account])

  /*
   * WHAT THE FIRM'S WORDING IS MERGED AGAINST, resolved here because this is the only place that
   * holds all of it: the account, the balance struck from the three ledgers, the client whose
   * book it is, and who is sending.
   *
   * HOISTED OUT OF THE COMPOSER, because it is no longer only a letter that needs it. At the
   * firm's instruction -- "everything that we have in the library, to be in the account as well
   * as an option" -- the SMS box and the email box both pick from the library now, and all three
   * have to merge against THE SAME VALUES. Computed in two places they would drift, and the
   * drift would be a debtor sent a balance by SMS that does not match the one in the letter
   * posted the same day.
   *
   * mergeValuesFor had no caller at all until the composer. It was written, exported and checked,
   * and nothing in the app had ever asked it a question -- which is worth knowing, because a
   * resolver nobody calls is a resolver nobody notices is wrong.
   *
   * THE FIRM'S OWN DETAILS COME FROM THE DATABASE. They were fields nothing on earth could fill
   * -- `firmName` was a string literal typed in here, and the trust account and the signatory
   * were passed as literal null -- so a section 129 told the debtor to pay and did not say where.
   * Library -> The firm is where they are set.
   *
   * WHAT IS STILL NULL IS STILL NULL, and deliberately: the debtor's postal address and the date
   * to respond by are not the firm's details and do not belong on that screen. Passed as null
   * rather than as an empty string, and then DROPPED from the map below -- renderTemplate treats
   * a missing key and an empty string differently, and only the first leaves {{respond_by}}
   * standing where somebody can see it. One of those gets caught; the other gets posted.
   */
  const letterContext = useMemo(() => ({
    reference: account?.clientReference ?? account?.accountNumber ?? null,
    values: account
      ? Object.fromEntries(
        Object.entries(mergeValuesFor({
          account: {
            caseNumber: account.caseNumber,
            debtorKind: account.debtorKind,
            debtorTitle: account.debtorTitle,
            debtorFirstName: account.debtorFirstName,
            debtorSurname: account.debtorSurname,
            accountNumber: account.accountNumber,
            clientReference: account.clientReference,
            capitalOutstanding: account.capitalOutstanding,
            preferredLanguage: account.preferredLanguage,
          },
          balance: statement?.breakdown?.balance ?? null,
          clientName: client?.name ?? null,
          agentName: currentUser?.name ?? null,
          agentPhone: currentUser?.phone ?? null,
          agentEmail: currentUser?.email ?? null,
          agentWhatsapp: currentUser?.whatsapp ?? null,
          /*
           * THE THREE PEOPLE A LETTER CAN NAME, and they are not the same person.
           *
           * `agent` is whoever is composing. `collector` is whoever the ACCOUNT is assigned to --
           * which is the answer to "who is handling my account", and it follows the account when
           * it is handed on. `liaison` is whoever looks after the CLIENT whose book it is.
           *
           * Both come out of `users`, which AppStore already holds, so naming them costs no
           * request. Undefined where nobody is assigned, which merges as a placeholder left
           * standing rather than a blank line -- caught here rather than posted.
           */
          collector: users.find((u) => u.id === account.assignedTo),
          liaison: users.find((u) => u.id === client?.accountOwnerId),
          today: dayKey(new Date()),
          money: formatMoney,
          debtorIdMasked: account.debtorIdNumber,
          positionAsAt: dayKey(new Date()),
          /*
           * THE TWO FIELDS THAT WERE WRITTEN, CHECKED, EXPORTED AND FILLED BY NOTHING.
           *
           * {{debtor_address}} is the primary address on the account -- account_contacts already
           * holds one, kind 'address', and every section 129 needs it to be posted at all. The
           * PRIMARY one where a primary is marked, and otherwise the first that has not been
           * retired: a retired address is one somebody established the debtor no longer lives at,
           * and posting a statutory demand to it is worse than not posting one.
           *
           * {{respond_by}} is ten WORKING days from today, the day the notice goes out. Not ten
           * calendar days, and not counted by hand -- addWorkingDays knows the public holidays,
           * including the Easter dates and the Monday a holiday moves to when it falls on a
           * Sunday. A demand that gives a debtor less time than the Act does is a demand that can
           * be set aside.
           */
          debtorAddress: addressOf(workspace?.contacts ?? []),
          respondBy: addWorkingDays(dayKey(new Date()), 10),
          /* Passed whole. There is no list of the firm's fields here to fall behind the ones the
             library grew -- see mergeValuesFor, which takes FirmSettings' own shape. */
          firm,
        })).filter((entry): entry is [string, string] => entry[1] !== null),
      )
      : {},
  /* Before the early returns below, because a hook cannot run conditionally -- which is also why
     it reads `statement` rather than the `b` shorthand, which is only defined past them. */
  /* `users` and client.accountOwnerId are in here because the collector and the liaison are read
     out of them: left off, a letter keeps naming whoever held the account before it was handed
     on, which is the one failure these fields exist to prevent. */
  }), [account, statement?.breakdown?.balance, client?.name, client?.accountOwnerId, users,
    workspace?.contacts,
    currentUser?.name, currentUser?.phone, currentUser?.email, currentUser?.whatsapp, firm])


  /*
   * THE DEBTOR'S NAME, IN THE TOP BAR.
   *
   * THE FIRM: "the full name, Johannes van der Merwe -- you can put it in the hero section up
   * there. And then where the debtor's details is, you can just say title, surname, first name,
   * initials."
   *
   * The panel used to print the assembled name and the five parts it was assembled from directly
   * underneath, which is the same words twice. Up here it is on screen whatever the page is
   * scrolled to -- and a screen headed only "Account" is one somebody lands on from a link with
   * no idea whose it is.
   *
   * BEFORE THE EARLY RETURNS, because it is a hook. Called after the `loading` branch it would
   * run on some renders and not others, which React refuses outright.
   */
  const heroName = account
    ? ([account.debtorFirstName, account.debtorSurname].filter(Boolean).join(' ') || 'Unnamed debtor')
    : null
  useTitleSlot(
    heroName ? (
      <span className="min-w-0 flex items-baseline gap-2">
        <span className="text-slate-300">&middot;</span>
        <span className="text-lg font-semibold text-slate-800 truncate">{heroName}</span>
        {account?.accountNumber && (
          <span className="text-xs text-slate-400 tabular-nums shrink-0">{account.accountNumber}</span>
        )}
      </span>
    ) : null,
    [heroName, account?.accountNumber],
  )

  /*
   * HOW FAR THROUGH THE DEBT THEY ARE. THE FIRM: "a progress report or a progress bar for a
   * debtor that is paying."
   *
   * THE MONEY HALF COMES OFF THE BALANCE, so it cannot disagree with the figures printed beside
   * it -- `payments` and `balance` are the same two the statement shows, and the bar is their
   * ratio rather than a second opinion about the account.
   *
   * THE INSTALMENT HALF COMES OFF THE ARRANGEMENT the account is actually on. How many have
   * fallen DUE is counted from the schedule rather than from a flag: an arrangement taken in June
   * at R300 a month has had four instalments due by October whatever anybody has recorded, and a
   * count that waited to be told would report a debtor as current on the day they stopped paying.
   *
   * ABOVE THE EARLY RETURNS, because it is a hook. Placed beside the panel it feeds -- which is
   * after the `loading` branch -- it ran on some renders and not others, and React refuses that
   * outright: the whole account screen threw and the browser check found the page empty.
   */
  const progress = useMemo((): PaymentProgress | null => {
    const bal = statement?.breakdown
    if (!bal) return null
    const money = moneyProgress({ payments: bal.payments, balance: bal.balance })
    const live = (workspace?.promises ?? []).find((x) => x.status === 'open') ?? null
    return {
      money,
      instalments: live
        ? instalmentProgress({
          amount: live.amount,
          totalPromised: live.totalPromised,
          instalmentsKept: live.instalmentsKept,
          arrangement: live.arrangement,
          due: instalmentsDue(live, new Date().toISOString().slice(0, 10)),
        })
        : null,
    }
  }, [statement, workspace])

  if (loading) return <div className="p-10 grid place-items-center text-slate-400"><Loader2 size={20} className="animate-spin" /></div>
  if (error) return <Card className="border-negative-100 bg-negative-50"><p className="text-sm text-negative-700">{error}</p></Card>
  if (!account) return <Card><p className="text-sm text-slate-600">That account is not in the book.</p></Card>

  const b = statement?.breakdown
  const drift = hasCommissionDrift(account)
  const name = [account.debtorFirstName, account.debtorSurname].filter(Boolean).join(' ') || 'Unnamed debtor'
  const due = workspace ? nextPromise(workspace.promises) : undefined
  const emailContact = workspace?.contacts.find((c) => c.kind === 'email' && !c.retiredAt)
  const callContact = dialableNumber(workspace?.contacts ?? [])
  // One list for both: whatever you could SMS, you could ring.
  const smsNumbers = reachableNumbers(workspace?.contacts ?? [])
  // Who looks after this debtor's CLIENT — a different person from the pre-legal agent working
  // the debtor, and the one a query about the debt itself has to go to.
  /*
   * Derived here rather than read off a column, which is the rule for this vocabulary: it is a
   * reading of several facts and storing it only creates a way for the reading and the facts to
   * disagree. The bucket goes in because half the inherited book has no sub-status and Swordfish's
   * own filing is the only record that a promise was made or broken.
   */
  const position = deskPosition({
    status: account.status,
    subStatus: account.subStatus,
    bucket: account.bucket,
    everWorked: !!account.lastActionAt,
  })

  const clientLiaison = users.find((u) => u.id === client?.accountOwnerId)
  const canDelete = ['Administrator', 'Sales Manager', 'Liaison Manager'].includes(currentUser?.role ?? '')



  /*
   * The six panels, built once and placed by whichever layout is chosen.
   *
   * Defining them here rather than three times over is the whole reason the layouts can be
   * trusted to stay the same page: a prop added to the promise panel cannot be added to one
   * arrangement and forgotten in the other two.
   */
  /*
   * WHO THEY ARE, AND THEN WHAT STANDS BEHIND AND AGAINST THEM. One column, in that order.
   *
   * Standing was in the right-hand column among the money panels, and the firm's word for it was
   * "a weird place" — correctly. It is not a figure. It is the rest of the answer to "who am I
   * ringing": the directors are how you reach a company at all, and the judgments say what you are
   * joining a queue behind. Read next to the phone numbers it is part of one thought; read under
   * the settlement figure it is an interruption.
   *
   * Wrapped, because RecordLayout's details slot is a single node and two of its three
   * arrangements put no gap between siblings — the cards touched.
   */
  const detailsPanel = (
    <div className="space-y-4">
      <DebtorDetailsPanel account={account} name={name} workspace={workspace} onChange={reload}
        /* Only what they still own, across every trace on the account — see heldProperty. */
        properties={heldProperty(traces.flatMap((t) => t.items))}
        onOpenTrace={traces.length > 0 ? () => setOpenTrace(traces[0].id) : null}
        userId={currentUser?.id ?? null} onEmail={setComposeTo} />
      <StandingPanel account={account} standing={standing} position={position}
        traces={traces}
        traceAction={(
          <TraceButton accountId={account.id} actor={{ id: currentUser?.id ?? null, name: currentUser?.name ?? null }}
            debtorKind={account.debtorKind} idNumber={account.debtorIdNumber}
            label="Do the trace"
            className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg bg-brand-600 text-white shadow-sm hover:bg-brand-700"
            onDone={reload} onUpload={() => setTracing(true)} />
        )}
        onUpload={() => setTracing(true)}
        onOpenTrace={setOpenTrace}
        onPractitioner={() => setPractitioner({ suggest: null })}
        onAddDirector={() => setDirector({ editing: null })}
        onEditDirector={(d) => setDirector({ editing: d })} />
    </div>
  )
  const timelinePanel = (
    <TimelinePanel
      entries={timeline}
      accountId={account.id}
      userName={currentUser?.name ?? null}
      userId={currentUser?.id ?? null}
      onChange={reload}
      noteRef={noteRef}
      noteOpen={noteOpen}
      setNoteOpen={setNoteOpen}
    />
  )

  const summaryPanel = (
    <SummaryPanel account={account} breakdown={b} note={statement?.note} progress={progress} />
  )

  /*
   * WHAT THE CLIENT WILL READ, shown to the person whose work produces it.
   *
   * Asked for directly: "the clerk can see what will go to the client". It costs nothing to show
   * and it changes behaviour — an agent who can see that the client's line reads "No contact
   * attempted" is an agent who rings somebody.
   *
   * Composed from records, never from the main comment. See accountNarrative.
   */
  const clientReport = positionReport({
    status: account.status,
    subStatus: account.subStatus,
    paidInPeriod: false,
    openQueryWithClient: account.clientActionAsk !== null,
  })
  const otherAccountsPanel = <OtherAccountsPanel key="others" rows={otherAccounts} />

  const clientLinePanel = (
    <ClientLinePanel
      line={clientLine({
        /*
         * THE RUNG GOES IN, and without it the whole point of the rewrite was missing here.
         *
         * accountNarrative writes a different sentence per position — "the debtor advised that
         * they are not in a position to pay", "the matter is being dealt with through the
         * appointed practitioner" — and every one of them is guarded on this field. Left out, the
         * function fell through to its last resort on every account: "We worked the account on
         * 2 September". Which is the sentence the firm called stupid, and the reason those
         * position sentences were written in the first place.
         *
         * Same value the panel's own heading uses, so the line and the label cannot disagree.
         */
        position: clientReport.position,
        lastAttemptOn: account.lastActionAt,
        // Deliberately not passed: the book records that something was done and never what came
        // of it, so claiming a non-answer would be a statement about the debtor, not a record.
        reached: null,
        promise: due
          ? { amount: due.amount, dueOn: due.dueOn, takenOn: due.createdAt?.slice(0, 10) ?? null,
              status: due.status === 'broken' ? 'broken' : 'open', arrangement: due.arrangement }
          : null,
        /*
         * The account knows WHEN it comes back but not WHY — the kind lives on the diary entry,
         * which this page does not load. 'review' is the honest fallback: it produces "We will
         * follow the account up on ...", which is true of every diary date whatever its kind.
         */
        next: account.diaryDate ? { kind: 'review', dueOn: account.diaryDate } : null,
        frozenReason: account.frozenReason,
        frozenOn: account.frozenAt?.slice(0, 10) ?? null,
      })}
      /*
        CLIENT_POSITIONS here, deliberately, where every other position on this screen reads from
        DESK_POSITIONS. This panel is what the CLIENT is shown, and the fourteenth rung is ours: a
        never-worked account is "New" to a collector and "In progress" on the report. Two
        vocabularies staying two is the rule this whole mapping exists to hold, and the one place
        it would break is a panel reaching for whichever constant happened to be imported.
      */
      position={CLIENT_POSITIONS[clientReport.position]}
      flag={clientReport.flag}
      ask={account.clientActionAsk}
      askDue={account.clientActionDue}
      onAsk={() => setAskingClient(true)}
    />
  )
  const promisePanel = (
    <PromisePanel
      accountId={account.id}
      promises={workspace?.promises ?? []}
      userId={currentUser?.id ?? null}
      userName={currentUser?.name ?? null}
      onChange={reload}
      open={promiseOpen}
      setOpen={setPromiseOpen}
      successRatio={account.ptpSuccessRatio}
      balance={b?.balance}
      settlement={b?.settlement}
    />
  )
  const disputesPanel = (
    <QueryPanel
      accountId={account.id}
      accountLabel={account.accountNumber}
      queries={queries}
      users={users}
      actor={{ id: currentUser?.id ?? null, name: currentUser?.name ?? null, role: currentUser?.role }}
      onChange={reload}
      busy={queryBusy}
      run={runQuery}
      clientId={client?.id}
      clientLiaisonId={clientLiaison?.id}
    />
  )
  const positionPanel = (
    <PositionPanel account={account} ceiling={ceiling} chargedExclVat={ledgers?.totals.feesExclVat ?? 0}
      clientLiaisonName={clientLiaison?.name ?? null}
      onFreeze={canFreezeAccounts(currentUser?.role) ? () => setFreezing(true) : null} />
  )

  return (
    <div className="space-y-4">
      <Link to="/accounts" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={14} /> All accounts
      </Link>

      {/*
        The debtor is the subject of this page — not the client. The client is who handed the
        account over and who gets the money, which matters, but it is context for the person
        whose debt this is. Hence "Debtor" on the band and the client named beneath.
      */}
      <DashboardHero
        /*
         * "Debtor" or "Company debtor", because the two are not chased the same way. A person is
         * rung on their own numbers; a company is reached through its directors, and a collector
         * opening one needs to know which kind of afternoon this is before they read anything
         * else. The registration number reads as an ID number otherwise.
         */
        eyebrow={account.debtorKind === 'company' ? 'Company debtor' : 'Debtor'}
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            {name}
            {/*
              THE CASE NUMBER, IN GOLD, AND IT IS OURS.
              This badge showed `accountNumber` under a tooltip reading "our reference for this
              account" -- which was true only when Raptor had generated one and false whenever the
              client's sheet supplied it, because that column is the number on the agreement. The
              firm hit the ambiguity twice: once as "I see the client ref, but I don't see the
              Raptor reference", and again as "if they use the client reference it's more
              difficult to find". caseNumber is unmistakably ours, on every account, and unique.
            */}
            <span className="font-mono text-[11px] font-bold text-navy-950 bg-gold-400 px-2 py-0.5 rounded-md align-middle"
              title="Our case number. This is what every notice quotes.">
              {account.caseNumber}
            </span>
          </span>
        }
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            <span className="text-white/50">Client</span>
            {client
              ? canViewClients(currentUser?.role)
                ? <Link to={`/companies/${client.id}`} className="text-gold-400 hover:underline">{client.name}</Link>
                : <span className="text-gold-400">{client.name}</span>
              : <span>Unknown</span>}
            {/*
              "CLIENT REF", NOT "THEIR REF". The firm's own word, marked on the screen. It sat
              beside the gold account number, whose tooltip reads "our reference", and the pair
              was meant to be read as ours/theirs — but "their" only resolves if you have already
              read the word Client at the start of the line, and a collector quoting a reference
              back to a client is scanning, not reading.
            */}
            {/* Both of the OTHER numbers, marked for what they are. The badge above is ours;
                these two belong to the client and to the agreement, and a collector quoting one
                back down the phone has to know which they are reading. */}
            {account.accountNumber && (
              <>
                <span className="text-white/30">·</span>
                <span title="The account number on the agreement, as the client gave it">
                  account no. {account.accountNumber}
                </span>
              </>
            )}
            {account.clientReference && (
              <>
                <span className="text-white/30">·</span>
                <span title="The client's own reference for this account">
                  client ref {account.clientReference}
                </span>
              </>
            )}
            {account.handoverDate && <><span className="text-white/30">·</span><span>handed over {formatDate(account.handoverDate)}</span></>}
          </span>
        }
      >
        <div className="flex items-center gap-2">
          <StatusPill status={account.status} inDuplum={account.inDuplum} />
          {account.prescribed && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-negative-50 text-negative-700"
              title="Three years have run since the last payment or acknowledgement. It can no longer be enforced.">
              prescribed
            </span>
          )}
        </div>
        {/*
          Whoever is working this debtor. "Pre-legal agent" rather than "Client Liaison": a
          liaison looks after the client relationship, and this is the person chasing the debt.
        */}
        {/*
          The band carries the person working the DEBTOR. The client liaison is a different job on
          a different relationship, and it sits in the strip below with the other facts you check
          before picking up the phone — the band was starting to hold two of everything.
        */}
        <div className="mt-2.5 text-right leading-tight ml-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-gold-500">Pre-legal agent</p>
          {/*
            The name, and nothing under it. It used to say "from Swordfish" — which named the
            system the book came out of, not anything about the account. The firm is moving off
            Swordfish, and a debtor's file is not the place to keep mentioning it.
          */}
          <p className="text-sm font-semibold text-white">{account.swordfishAssignedTo ?? 'Unassigned'}</p>
        </div>
      </DashboardHero>

      {/*
        Only when the account was opened FROM the diary. An account looked up by name is just an
        account; one reached by working a queue gets the queue's controls.

        Directly under the band, at the firm's instruction, and it has now been in three places:
        fixed to the bottom of the window (which cost eighty pixels of every screen), then between
        the comment and the actions. Here is right, and the reason is that it is not really about
        this account at all — it says where you are in a queue of sixty-six and offers the way on.
        That belongs with the page's chrome, in the first screenful, never scrolled past.
      */}
      <DiaryWorkBar account={account} onWorked={reload} />

      {/*
        One number, not two. "Balance" and "To settle today" differ by the receipt fee, and a
        collector reading two figures a few hundred rand apart has to work out which one to quote
        — so only the one they quote is here. The other is on the Transactions tab, in the
        statement, where the working is shown.

        Status and flags earn their place beside the money: they decide what the call is about.
      */}
      <RecordFigures count={5}>
        {/*
          The figure moves every day, so the tile says so. A collector who quotes a settlement and
          is asked "why is it more than yesterday" needs the answer on the same screen.
        */}
        <Figure label="To settle today" value={b ? formatMoney(b.settlement) : '—'}
          note={b
            ? `incl. ${formatMoney(b.settlementFee)} receipt fee`
              + (b.interestAccruing > 0
                ? ` · ${formatMoney(b.interestAccruing)} interest over ${b.interestAccruingDays} ${b.interestAccruingDays === 1 ? 'day' : 'days'}`
                : '')
            : undefined} strong />
        <Figure label="Collected" value={b ? formatMoney(b.payments) : '—'} note={`${ledgers?.payments.length ?? 0} payments`} />
        <Figure
          label="Next promise"
          value={due ? formatMoney(due.amount) : '—'}
          note={due ? `due ${formatDate(due.dueOn)}` : 'none outstanding'}
          danger={!!due && isOverdue(due, TODAY)}
        />
        {/*
          THE POSITION, NOT THE COLUMN. This tile read "Active: Activated · no flags", which is
          the firm's own definition of a screen that shows a person a column instead of an answer:
          'Active: Activated' describes how the row got into the table and says nothing about the
          debtor. The rung the account is reported on is what a collector opening it needs, and it
          is the same word the client will see on their report.

          The inherited status has not vanished — it is on the band at the top of the record and
          on the Transactions tab. What it is not is the headline.
        */}
        <Figure
          label="Position"
          value={DESK_POSITIONS[position].label}
          note={account.clientActionAsk
            ? `${CLIENT_FLAGS.client_action.label}: ${account.clientActionAsk}`
            : DESK_POSITIONS[position].meaning}
          small
        />
        <Figure
          label="Client liaison"
          value={clientLiaison?.name ?? 'Not set'}
          note={clientLiaison ? `for ${client?.name ?? 'this client'}` : 'set one on the client record'}
          small
        />
      </RecordFigures>

      <MainComment account={account} busy={savingComment}
        onSave={(text) => runComment(
          // The name goes with it so the timeline note says who changed it.
          () => saveMainComment(account.id, text, currentUser?.id ?? null, currentUser?.name ?? null),
        )} />

      <ActionBar
        callNumber={callContact?.value}
        callNumbers={smsNumbers}
        onEmail={emailContact ? () => setComposeTo(emailContact.value) : undefined}
        onNote={() => { setTab('Overview'); setNoteOpen(true); setTimeout(() => noteRef.current?.focus(), 0) }}
        onPromise={() => { setTab('Overview'); setPromiseOpen(true) }}
        onDispute={() => setDisputing(true)}
        onSms={() => setSmsOpen(true)}
        onScript={() => setScriptOpen(true)}
        onDiarise={() => setDiariseOpen(true)}
        accountId={account.id}
        actor={{ id: currentUser?.id ?? null, name: currentUser?.name ?? null }}
        idNumber={account.debtorIdNumber}
        debtorKind={account.debtorKind}
        onTraced={reload}
        onUpload={() => setTracing(true)}
      />


      <OutcomeOutstanding queries={queries} accountId={account.id}
        actor={{ id: currentUser?.id ?? null, name: currentUser?.name ?? null }}
        busy={queryBusy} run={runQuery} />

      {drift && (
        <Banner title={`Billed at ${pct(account.commissionRate)}, but the mandate says ${pct(account.commissionRateExpected)}`}>
          On capital of {formatMoney(account.capitalHandedOver)}
          {account.commissionRateSource && <> under the {account.commissionRateSource.toLowerCase()}</>}.
          The billed rate is the record of what was actually charged &mdash; this is a flag, not a correction.
        </Banner>
      )}

      <RecordTabs<Tab>
        tabs={[
          { id: 'Overview', label: 'Overview' },
          { id: 'Transactions', label: 'Transactions', count: statement?.lines.length ?? 0 },
          { id: 'Emails', label: 'Emails', count: emails.length },
          { id: 'Documents', label: 'Documents', count: documents.length },
        ]}
        active={tab}
        onChange={setTab}
        /* Only on Overview, because it is the only tab with anything to arrange — offering it
           over a statement would be a control that does nothing. */
        trailing={tab === 'Overview'
          ? <RecordLayoutSwitcher layout={layout} onChange={chooseLayout} />
          : undefined}
      />

      {tab === 'Transactions' && (
        <Card><StatementTable statement={statement?.lines ?? []} account={account} breakdown={b} /></Card>
      )}

      {tab === 'Emails' && (
        <EmailsPanel
          emails={emails}
          userId={currentUser?.id ?? null}
          canSend={!!mailbox}
          onCompose={() => { startCompose(); setComposeTo(emailContact?.value ?? '') }}
          onReply={(e) => { startCompose(); setReplyTo(e); setComposeTo(e.debtorAddress) }}
          /*
           * EVERYBODY WHO WAS ON IT, worked out by the same helper the mailbox uses. It drops our
           * own addresses (or every reply-all copies us back into our own inbox and the thread
           * doubles each round) and promotes the sender to To.
           */
          onReplyAll={(e) => {
            const { to, cc } = replyAllTo({
              from: { name: e.sentByName, address: e.debtorAddress },
              to: e.toRecipients,
              cc: e.ccRecipients,
              mine: [e.ourAddress, mailbox, currentUser?.email].filter((a): a is string => !!a),
            })
            startCompose()
            setReplyTo(e)
            setComposeTo(to[0]?.address ?? e.debtorAddress)
            setComposeCc(recipientLine(cc))
          }}
          /* NOT threaded and NOT addressed: a forward goes to somebody who was not in the
             conversation, so In-Reply-To would put our message inside a thread they have never
             seen, and a prefilled To would be the wrong person. */
          onForward={(e) => { startCompose(); setForwardOf(e); setComposeTo('') }}
          /*
           * Marked read where it is actually read, with the row updated in place rather than by
           * reloading the account — a full reload here would collapse the message the moment
           * somebody opened it.
           */
          onRead={(e) => {
            setEmails((list) => list.map((x) => (
              x.id === e.id ? { ...x, readAt: new Date().toISOString() } : x
            )))
            void markRepliesRead([e.id])
          }}
          /*
           * Back onto the unread list, with the row updated in place for the same reason reading
           * one is: reloading the account here would close the message somebody just decided to
           * come back to.
           */
          onUnread={(e) => {
            setEmails((list) => list.map((x) => (x.id === e.id ? { ...x, readAt: null } : x)))
            void markRepliesUnread([e.id])
          }}
        />
      )}

      {tab === 'Documents' && (
        <DocumentsPanel accountId={account.id} documents={documents} onChange={reload}
          userId={currentUser?.id ?? null} userName={currentUser?.name ?? null} canDelete={canDelete}
          /*
           * A TRACE IS NOT A BLOB. Choosing it here opens the reader rather than filing the PDF
           * unread — the firm paid for the search, and a trace that goes into the bucket without
           * being read is the exact waste this was built to end. The reader files the PDF here
           * afterwards under the same kind, so nothing is lost either way.
           */
          onUploadTrace={() => setTracing(true)} />
      )}

      {tab === 'Overview' && (
        /*
          The same three arrangements every record page now offers, from the same component.

          Defining the panels once above and letting RecordLayout place them is the whole reason
          the layouts can be trusted to stay the same page: a prop added to the promise panel
          cannot be added to one arrangement and forgotten in the other two — a bug that is
          invisible until somebody switches layout.
        */
        <RecordLayout
          layout={layout}
          details={detailsPanel}
          main={timelinePanel}
          /*
            THE CLIENT'S LINE FIRST, above the figures.
            
            It went in second, under the Account summary, and the firm could not find it — which
            on an iPad is the honest outcome: the summary is a dozen rows of money and this is
            three lines under it. A panel nobody scrolls to is a panel that does not exist, and
            this one only works if the person doing the work reads it.
          */
          side={[clientLinePanel, summaryPanel, otherAccountsPanel, promisePanel,
            disputesPanel, positionPanel]}
        />
      )}

      {freezing && (
        <FreezeModal
          accountId={account.id}
          accountLabel={`${[account.debtorFirstName, account.debtorSurname].filter(Boolean).join(' ')} \u00b7 ${account.accountNumber}`}
          frozen={account.frozenBy || /^frozen/i.test(account.status)
            ? { by: account.frozenBy, reason: account.frozenReason }
            : null}
          actor={{ id: currentUser?.id ?? null, name: currentUser?.name ?? null }}
          onClose={() => setFreezing(false)}
          onDone={reload}
        />
      )}

      {askingClient && (
        <ClientActionModal
          accountId={account.id}
          accountLabel={`${[account.debtorFirstName, account.debtorSurname].filter(Boolean).join(' ')} \u00b7 ${account.accountNumber}`}
          outstanding={account.clientActionAsk
            ? { ask: account.clientActionAsk, dueOn: account.clientActionDue }
            : null}
          actor={{ id: currentUser?.id ?? null, name: currentUser?.name ?? null }}
          onClose={() => setAskingClient(false)}
          onDone={reload}
        />
      )}

      {disputing && (
        <EscalateModal
          accountId={account.id}
          users={users}
          clientLiaison={clientLiaison}
          actor={{ id: currentUser?.id ?? null, name: currentUser?.name ?? null }}
          onClose={() => setDisputing(false)}
          onDone={reload}
        />
      )}

      {smsOpen && (
        <SmsModal accountId={account.id} numbers={smsNumbers} values={letterContext.values}
          onClose={() => setSmsOpen(false)} onDone={reload} />
      )}

      {/*
        Reading the PDF the firm has already paid for. Charges nothing — see TraceUploadModal; the
        search is charged on the Trace button, where it is run.
      */}
      {tracing && (
        <TraceUploadModal
          accountId={account.id}
          debtorKind={account.debtorKind}
          registrationNumber={account.debtorKind === 'company' ? account.debtorIdNumber : null}
          directors={standing.directors}
          hasPractitioner={account.practitionerKind !== null || account.practitionerName !== null}
          actor={{ id: currentUser?.id ?? null, name: currentUser?.name ?? null }}
          onClose={() => setTracing(false)}
          onDone={reload}
          onAddPractitioner={(kind) => setPractitioner({ suggest: kind })}
          /*
            Straight from filing into working it, which is the firm's flow. reload() first, or the
            workspace opens against the traces this screen held BEFORE the import and cannot find
            the one it was just handed.
          */
          onWork={(traceId) => { void reload().then(() => setOpenTrace(traceId)) }}
        />
      )}

      {/*
        Working inside a trace: ring a number, say what happened, put the ones that are real onto
        the account. Opened from the panel's summary — see TraceWorkspaceModal.
      */}
      {openTrace !== null && traces.some((t) => t.id === openTrace) && (
        <TraceWorkspaceModal
          traces={traces}
          openId={openTrace}
          onOpen={setOpenTrace}
          actor={{ id: currentUser?.id ?? null, name: currentUser?.name ?? null }}
          onClose={() => setOpenTrace(null)}
          onChanged={reload}
        />
      )}

      {/* Who to deal with when it is no longer the debtor. Typed by a person — it is not on a PDF. */}
      {practitioner && (
        <PractitionerModal
          account={account}
          suggestKind={practitioner.suggest}
          onClose={() => setPractitioner(null)}
          onDone={reload}
        />
      )}

      {director && (
        <DirectorModal
          accountId={account.id}
          director={director.editing}
          onClose={() => setDirector(null)}
          onSaved={reload}
        />
      )}

      {/* Choosing when it comes back. Charges nothing — it is a note about a day, not an action
          against the debtor. */}
      {diariseOpen && (
        <DiariseModal
          accountId={account.id}
          accountLabel={[name, account.accountNumber].filter(Boolean).join(' · ')}
          prescriptionDate={account.prescriptionDate}
          onClose={() => setDiariseOpen(false)}
          onDone={reload}
        />
      )}

      {scriptOpen && (
        <CallScriptModal values={letterContext.values} onClose={() => setScriptOpen(false)} />
      )}

      {composeTo !== null && (
        <ComposeEmailModal
          to={composeTo}
          letterContext={letterContext}
          recipients={(workspace?.contacts ?? [])
            .filter((c) => c.kind === 'email' && !c.retiredAt)
            .map((c) => ({ email: c.value, label: c.label ?? undefined }))}
          initialSubject={forwardOf
            ? forwardSubject(forwardOf.subject)
            : replyTo
              ? replySubject(replyTo.subject)
              : `Account ${account.accountNumber ?? ''} - ${name}`.trim()}
          /*
           * A FORWARD IS THE ONE THAT CARRIES THE ORIGINAL. A reply does not, and that is a
           * decision explained below. A forward has to: the person receiving it was not in the
           * conversation, so without the original quoted under it they are reading an answer to
           * a question they never saw.
           */
          initialBody={forwardOf
            ? forwardBody(
              {
                fromName: forwardOf.direction === 'in' ? forwardOf.sentByName : (currentUser?.name ?? null),
                fromAddress: forwardOf.direction === 'in'
                  ? forwardOf.debtorAddress
                  : (forwardOf.ourAddress ?? mailbox ?? ''),
                subject: forwardOf.subject,
                occurredAt: forwardOf.occurredAt,
              },
              forwardOf.body ?? '',
            )
            : undefined}
          initialCc={composeCc}
          /*
           * No quoted history, on a reply or anything else. The box starts empty.
           *
           * Quoting looked helpful and was not. A debtor's reply already carries their own
           * client's quoted chain, so quoting it again produced a reply that opened with two
           * layers of "> Awe" and a stray "> <signature.png>" before the agent had typed a
           * word. The message being answered is on the page behind this modal anyway.
           */
          inReplyTo={replyTo?.messageId ?? null}
          contextNote={`Goes out from ${mailbox ?? 'your mailbox'} and is charged R25 under item 1(a). Their reply comes back to this account on its own and is charged R13 under item 6.`}
          onClose={() => { setComposeTo(null); startCompose() }}
          onSent={(rawSubject, bodyText, messageId, from) => {
            const to = composeTo
            const answering = replyTo
            setComposeTo(null)
            startCompose()
            /*
             * Charged, recorded and put on the timeline — see recordSentEmail.
             *
             * Item 1(a), R25, on every message we send, at the firm's instruction: "25 rand for
             * every email sent or responded to". A reply is a letter under 1(a) exactly as a
             * first email is, so it charges the same.
             *
             * The subject arrives with the modal's own "Email sent: " framing, which is the CRM
             * activity convention and means nothing on an account. Stripped here so the debtor's
             * own subject line is what gets stored.
             */
            void recordSentEmail({
              accountId: account.id,
              to,
              from: from ?? mailbox,
              subject: rawSubject.replace(/^Email sent: /, ''),
              body: bodyText,
              messageId: messageId ?? null,
              inReplyTo: answering?.messageId ?? null,
              actor: { id: currentUser?.id ?? null, name: currentUser?.name ?? null },
            }).then(reload)
          }}
        />
      )}
    </div>
  )
}

const pct = (r: number | null) => (r === null ? '—' : `${(r * 100).toFixed(r * 100 % 1 === 0 ? 0 : 1)}%`)

/** 1 = Monday .. 7 = Sunday, from a yyyy-mm-dd string, read as UTC so a timezone cannot shift it. */
function isoWeekday(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7
}

/* ---------- the action bar ---------- */

/**
 * What you can do to this account, in one row.
 *
 * Four of these work. Three are placeholders, and they say so rather than looking live and doing
 * nothing — a disabled button with a reason is honest; a button that swallows a click teaches
 * people not to trust the row.
 *
 * Record Payment is deliberately absent. A payment is not something a collector asserts: it
 * arrives in a bank account and is reconciled against the book, and a button that lets someone
 * type one in is a hole in the ledger.
 */
function ActionBar({ callNumber, callNumbers, onEmail, onNote, onPromise, onDispute, onSms, onScript, onDiarise, accountId, actor, idNumber, debtorKind, onTraced, onUpload }: {
  /** Copied to the clipboard when XDS opens, once it is checked — see TraceButton. */
  idNumber: string | null
  /** Which number that field is meant to hold: an ID, or a registration number. */
  debtorKind: 'individual' | 'company'
  /** The number SMS goes to, and what the row shows when there is no number at all. */
  callNumber?: string
  /** Every number that could reach this debtor, primary first. */
  callNumbers: { label: string; value: string }[]
  onEmail?: () => void
  onNote: () => void
  onPromise: () => void
  onDispute: () => void
  onSms: () => void
  /** The firm's wording for the call, merged against this debtor. Charges nothing: it is read,
      not sent, and Annexure B prices actions rather than reading. */
  onScript: () => void
  /** Put the account in somebody's diary. Charges nothing — it is a note about when, not an action. */
  onDiarise: () => void
  /** The account being worked, and who is working it — Call and Trace both charge fees. */
  accountId: string
  actor: { id: string | null; name: string | null }
  /** Reload after anything that writes a note or a fee — a trace, a call. */
  onTraced: () => Promise<void>
  /** Offered the moment the search comes back, which is when the PDFs are on the machine. */
  onUpload: () => void
}) {
  const soon = 'Not built yet — needs a provider connected and a decision on whether it charges the debtor.'
  return (
    <RecordActions>
      {/*
        The same PhoneLink the number in Debtor details uses, wearing the action row's clothes —
        so this button and that number cannot disagree about what dialling does. Without BuzzBox
        it falls back to a tel: link, which on the tablet the collectors actually use is the
        device dialler; with BuzzBox it rings the rep's extension and bridges the call.

        CallButton is that, plus the two things the firm found missing: the dial goes on the
        account's timeline, and a call the debtor answers raises the item 7 consultation.
      */}
      {callNumber
        ? (
          <CallButton accountId={accountId} numbers={callNumbers} actor={actor}
            className={`${ACTION_BASE} ${ACTION_ENABLED}`} onDone={onTraced} />
        )
        : <Action icon={Phone} label="Call" title="No phone number on this account yet" />}
      {/* Beside Call, because it is what somebody opens on their way into one. */}
      <Action icon={ScrollText} label="Call script" onClick={onScript}
        title="The firm's wording, with this debtor's figures in it" />
      <Action icon={MessageCircle} label="WhatsApp" title={soon} />
      {/* The number the SMS goes to is the same one Call rings: one number on file, one thing
          that happens when you reach for it. */}
      <Action icon={MessageSquare} label="SMS" onClick={callNumber ? onSms : undefined}
        title={callNumber ? 'Send this debtor an SMS — Annexure B item 1(c)' : 'No phone number on this account yet'} />
      <Action icon={Mail} label="Email" onClick={onEmail}
        title={onEmail ? 'Send from your connected mailbox' : 'No email address on this account yet'} />
      <Action icon={StickyNote} label="Add Note" onClick={onNote} title="Write on the timeline" />
      <Action icon={Check} label="Promise to Pay" onClick={onPromise} title="Record what they agreed to" primary />
      {/*
        The front door to the escalation system, and it has been called both things.

        It was "Escalate", then "Dispute" — because a collector who has just been told "I don't
        owe this" looks for the debtor's word, not a workflow verb. It is "Escalate" again now
        that the box behind it does three jobs rather than one: the debtor disputes the account,
        an agent wants a team leader's decision, or the debtor will not pay and the account should
        go to the attorneys. Only one of those is a dispute, so the door cannot be named after it.
        The dispute is the first and default option inside, which keeps the common case one glance
        away rather than a hunt.
      */}
      <Action icon={ShieldAlert} label="Escalate" onClick={onDispute}
        title="Raise a dispute, ask a team leader, or recommend it for litigation" />
      <TraceButton accountId={accountId} actor={actor} debtorKind={debtorKind} idNumber={idNumber}
        className={`${ACTION_BASE} ${ACTION_ENABLED}`}
        onDone={onTraced} onUpload={onUpload} />
      {/*
        When this account comes back, and why. Sits with the other actions rather than in a
        corner because it is the last thing done to an account before it is left alone, and an
        account left with no date on it is one nobody returns to.
      */}
      {/*
        One button for both horizons. It was two — Diarise and Remind me — and the firm's point
        was that the row had grown to ten buttons while those two asked the same question: when
        does this come back? The box behind it answers it at either scale, and the scale is the
        first thing it asks.
      */}
      <Action icon={CalendarClock} label="Diarise" onClick={onDiarise}
        title="When this comes back — a day in your diary, or a nudge later today" />

    </RecordActions>
  )
}



/* ---------- small shared pieces ---------- */
/*
 * Action and Figure used to live here. They are now in components/record/RecordShell, which the
 * Lead and Client pages use as well — the firm asked for one grammar across the app, and a shared
 * component the model page keeps a private copy of drifts inside a month.
 */

function Banner({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <Card className="border-gold-100 bg-gold-50">
      <div className="flex gap-3 text-sm">
        <AlertTriangle size={16} className="text-gold-600 shrink-0 mt-0.5" />
        <div>
          {title && <p className="font-medium text-navy-950">{title}</p>}
          <p className={`text-navy-800 ${title ? 'mt-1' : ''}`}>{children}</p>
        </div>
      </div>
    </Card>
  )
}

function PanelTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <h3 className="text-[11px] uppercase tracking-wide text-slate-400">{children}</h3>
      {action}
    </div>
  )
}

function Field({ label, value, note, action }: {
  label: string
  value?: string | null
  /** A second line under the value — why it is what it is, rather than more of what it is. */
  note?: string
  /** Lets a field be changed where it is shown, instead of from a button somewhere else. */
  action?: { label: string; onClick: () => void }
}) {
  return (
    // flex-wrap, so a value too wide to sit beside its label drops to its own full-width line
    // instead of being squeezed and broken mid-way. A reference number split across two lines
    // with one stray digit is a number someone will read out wrong over the phone.
    <div className="flex flex-wrap justify-between gap-x-3 text-sm">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className="text-slate-800 text-right min-w-0 break-words ml-auto">
        {value || '\u2014'}
        {note && <span className="block text-[11px] text-slate-400 font-normal">{note}</span>}
        {action && (
          <button type="button" onClick={action.onClick}
            className="block ml-auto text-[11px] font-medium text-[var(--c-steel)] hover:underline">
            {action.label}
          </button>
        )}
      </span>
    </div>
  )
}

function Money({ label, value, note, strong }: { label: string; value?: number; note?: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className={strong ? 'text-slate-700 font-medium' : 'text-slate-500'}>
        {label}
        {note && <span className="block text-[11px] text-slate-400">{note}</span>}
      </span>
      <span className={`tabular-nums shrink-0 ${strong ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
        {value === undefined ? '—' : formatMoney(value)}
      </span>
    </div>
  )
}

/* ---------- middle: the story ---------- */

const PAGE_SIZES = [5, 10, 20, 50] as const

/** Remembered per browser, not per account: it is a way of reading, not a fact about a debtor. */
const AUTOMATED_KEY = 'raptor.timeline.automated'

function TimelinePanel({ entries, accountId, userName, userId, onChange, noteRef, noteOpen, setNoteOpen }: {
  entries: TimelineEntry[]
  accountId: string
  userName: string | null
  userId: string | null
  onChange: () => Promise<void>
  noteRef: React.RefObject<HTMLTextAreaElement | null>
  /** Driven by "Add Note" in the action bar. There is one way to write a note, not two. */
  noteOpen: boolean
  setNoteOpen: (v: boolean) => void
}) {
  const [limit, setLimit] = useState<number>(10)
  /*
   * Everything by default.
   *
   * A timeline that quietly hides rows the first time you open it is a timeline you cannot trust
   * to be complete, and "why is the trace not showing" is a worse afternoon than a long list.
   * The choice is remembered per browser, because whoever turns it off means it.
   */
  const [showAutomated, setShowAutomated] = useState(() => {
    try { return window.localStorage.getItem(AUTOMATED_KEY) !== 'hide' } catch { return true }
  })
  const [body, setBody] = useState('')
  const { busy, err, run } = useWriter(onChange)

  function setAutomated(next: boolean) {
    setShowAutomated(next)
    // Wrapped: Safari in private mode throws on write, and a filter toggle is not worth a crash.
    try { window.localStorage.setItem(AUTOMATED_KEY, next ? 'show' : 'hide') } catch { /* fine */ }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!body.trim()) return
    const ok = await run(() => addNote({ accountId, body, authorName: userName, createdBy: userId }))
    if (ok) { setBody(''); setNoteOpen(false) }
  }

  /*
   * Filter, then count, then slice. In the other order "10 of 431" would count rows you cannot
   * see and hand you a page of four with no explanation of where the rest went.
   */
  const visible = filterTimeline(entries, showAutomated)
  const hidden = entries.length - visible.length
  const shown = limit >= visible.length ? visible : visible.slice(0, limit)
  const days = groupByDay(shown)

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-[11px] uppercase tracking-wide text-slate-400">Activity timeline</h3>
        {/*
          How much to show, chosen at the top rather than discovered at the bottom. An account can
          carry 800 actions; the question "how far back do I want to read" is asked before you
          start reading, not after you have scrolled past everything.
        */}
        <label className="text-xs text-slate-500 inline-flex items-center gap-1.5">
          Show
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}
            className="text-xs rounded-lg border border-slate-200 px-2 py-1 bg-white">
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            <option value={visible.length || 1}>All {visible.length.toLocaleString('en-ZA')}</option>
          </select>
          <span className="text-slate-400">of {visible.length.toLocaleString('en-ZA')}</span>
        </label>
      </div>

      {/*
        One switch, and it says what it costs. A filter that hides rows without saying how many is
        how somebody concludes a trace never happened.
      */}
      {/* Label and hint are one text flow, not two flex children: as two, the hint started on the
          first line beside the label and finished under it, which reads as a broken line. */}
      <label className="flex items-start gap-2 text-[11px] text-slate-500 mb-3 cursor-pointer select-none">
        <input type="checkbox" className="mt-0.5 shrink-0"
          checked={!showAutomated} onChange={(e) => setAutomated(!e.target.checked)} />
        <span>
          Just what people wrote{' '}
          <span className="text-slate-400">
            {showAutomated
              ? '— hides fee lines and the notes Raptor writes itself'
              : hidden > 0
                ? `— ${hidden.toLocaleString('en-ZA')} automatic ${hidden === 1 ? 'entry' : 'entries'} hidden`
                : '— nothing automatic on this account'}
          </span>
        </span>
      </label>

      {noteOpen && (
        <form onSubmit={submit} className="mb-4">
          <textarea
            ref={noteRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder="What was said, what was agreed..."
            className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
          <div className="flex items-center gap-2 mt-2">
            <button type="submit" disabled={busy || !body.trim()}
              className="text-sm font-medium px-3 py-1.5 rounded-lg bg-brand-600 text-white disabled:opacity-50">
              {busy ? 'Saving...' : 'Post note'}
            </button>
            <button type="button" onClick={() => { setBody(''); setNoteOpen(false) }}
              className="text-sm text-slate-500 hover:text-slate-700">Cancel</button>
          </div>
          {err && <p className="text-xs text-negative-700 mt-2">{err}</p>}
        </form>
      )}

      {entries.length === 0 && <p className="text-sm text-slate-400 py-6 text-center">Nothing has happened on this account yet.</p>}
      {entries.length > 0 && visible.length === 0 && (
        <p className="text-sm text-slate-400 py-6 text-center">
          Everything on this account so far was done by Raptor. Untick to see it.
        </p>
      )}

      <div className="space-y-4">
        {days.map((day) => (
          <div key={day.date}>
            <p className="text-[11px] uppercase tracking-wide text-slate-400 mb-2">{formatDate(day.date)}</p>
            <div className="space-y-2.5">
              {day.entries.map((e) => <TimelineRow key={e.id} entry={e} />)}
            </div>
          </div>
        ))}
      </div>

      {/* Counted against what is visible, not against everything: with the filter on, offering
          "20 more" out of rows the filter is hiding is a button that runs out early. */}
      {visible.length > shown.length && (
        <button onClick={() => setLimit((n) => n + 20)}
          className="mt-4 pt-3 border-t border-slate-100 w-full text-sm text-brand-600 hover:underline">
          Show 20 more &mdash; {(visible.length - shown.length).toLocaleString('en-ZA')} older
        </button>
      )}
    </Card>
  )
}

/**
 * How much of an entry fits before it needs asking for.
 *
 * A note someone typed during a call can run to a paragraph, and three of those turn the timeline
 * into a wall — which is the thing the timeline exists to avoid. Long entries clamp to three
 * lines and open on a click. The threshold is on character count rather than measured height:
 * a measurement would be exact and would also mean laying out every row twice on every render.
 */
const CLAMP_AT = 150

function TimelineRow({ entry }: { entry: TimelineEntry }) {
  const style = styleFor(entry)
  const Icon = style.icon
  const reversed = entry.status === 'reversed'
  const [open, setOpen] = useState(false)
  const long = entry.title.length > CLAMP_AT
  const wraps = entry.kind === 'note' || entry.kind === 'query' || entry.kind === 'main_comment'
  return (
    <div className="flex gap-3">
      <div className={`w-7 h-7 rounded-full grid place-items-center shrink-0 ${style.ring}`}>
        <Icon size={13} className={style.fg} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p
            onClick={long ? () => setOpen((v) => !v) : undefined}
            className={`text-sm min-w-0 wrap-anywhere ${wraps ? 'whitespace-pre-wrap' : ''} ${
              long ? 'cursor-pointer' : ''} ${long && !open ? 'line-clamp-3' : ''} ${
              reversed ? 'line-through text-slate-400' : 'text-slate-700'}`}
          >
            {entry.title}
            {entry.status && entry.kind === 'promise' && <PromiseChip status={entry.status} />}
          </p>
          <span className="text-sm tabular-nums shrink-0">
            {entry.amount != null
              ? <span className={entry.kind === 'payment' && !reversed ? 'text-positive-700 font-medium' : 'text-slate-600'}>
                  {formatMoney(entry.amount)}
                </span>
              : entry.free
                ? <span className="text-slate-300 text-xs" title="Work done past the Annexure B ceiling. Real history, no money.">not charged</span>
                : null}
          </span>
        </div>
        {long && (
          <button onClick={() => setOpen((v) => !v)} className="text-[11px] text-brand-600 hover:underline">
            {open ? 'Show less' : 'Show more'}
          </button>
        )}
        {(entry.detail || entry.by) && (
          <p className="text-[11px] text-slate-400 mt-0.5">
            {[entry.detail, entry.by].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
    </div>
  )
}

function PromiseChip({ status }: { status: string }) {
  return <span className={`text-[10px] px-1.5 py-0.5 rounded ml-1.5 align-middle ${PROMISE_CHIP[status] ?? ''}`}>{status}</span>
}

/**
 * The one line this account contributes to the client's monthly report.
 *
 * Read-only here. It is not an editable note and must not become one: the moment somebody can
 * type into it, it stops being a faithful reading of the records and becomes a second place
 * where the truth is kept. What changes it is doing the work — ringing the debtor, taking the
 * promise, setting the next date — which is the point of showing it.
 */
function ClientLinePanel({ line, position, flag, ask, askDue, onAsk }: {
  line: ClientLine
  position: { label: string; meaning: string }
  flag: ClientFlag
  /** What is outstanding from the client, or null when nothing is. */
  ask: string | null
  askDue: string | null
  onAsk: () => void
}) {
  const f = CLIENT_FLAGS[flag]
  return (
    <Card>
      <PanelTitle>What the client sees</PanelTitle>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-xs font-medium text-[var(--c-steel)]">{position.label}</p>
        {/*
          The dot and the words together. A colour alone is not a flag on a page somebody reads
          aloud down a telephone, and it is not a flag at all to anyone who cannot see colour.
        */}
        <p className={`text-[11px] font-medium ${flag === 'client_action' ? 'text-[var(--c-rust-deep)]' : 'text-slate-400'}`}>
          {f.dot} {f.label}
        </p>
      </div>
      <p className="text-[11px] text-slate-400 mb-2">{position.meaning}</p>

      {/*
        THE ASK, WORD FOR WORD. It is the one line on a client report that asks them to do
        something, so it is shown exactly as they will read it rather than summarised.
      */}
      {ask && (
        <p className="text-sm text-[var(--c-rust-deep)] bg-[var(--tint-rust-deep)] rounded-lg px-3 py-2 mb-2">
          {ask}
          {askDue && <span className="block text-[11px] mt-0.5 opacity-80">Needed by {formatDate(askDue)}</span>}
        </p>
      )}
      {/*
        Quoted and set apart, because it is not this page talking — it is a preview of another
        document. An agent should be able to tell at a glance that these are the words leaving
        the building.
      */}
      <div className="text-sm border-l-2 border-slate-200 pl-3 space-y-0.5">
        <p className="text-slate-700">{line.happened}</p>
        {/* The commitment on its own line — run into the sentence above, it stops being read. */}
        {line.next && <p className="font-medium text-slate-800">{line.next}</p>}
      </div>
      <button type="button" onClick={onAsk}
        className="mt-2.5 text-xs font-medium text-[var(--c-steel)] hover:underline">
        {ask ? 'The client came back' : 'Ask the client for something'}
      </button>
    </Card>
  )
}

/* ---------- right: the figures ---------- */

function SummaryPanel({ account, breakdown, note, progress }: {
  account: DebtorAccount
  breakdown: BalanceBreakdown | undefined
  /** How far through the debt they are. Null where nothing has been paid. */
  progress?: PaymentProgress | null
  /**
   * Why the figures above stop where they do — the in duplum ceiling, or a write-off date.
   *
   * It used to be a banner of its own, sitting between the action row and the tabs, which is
   * nowhere: a sentence about capital and interest, floating a long way from any of the numbers
   * it is about. Here it sits under the very figures it explains and beside the VAT footnote
   * that plays the same role, and it reads as part of the statement rather than as an alert
   * about the page.
   */
  note?: string
}) {
  const b = breakdown
  return (
    <Card>
      <PanelTitle>Account summary</PanelTitle>
      {/*
        One column, deliberately, however wide the card gets.

        This is a small financial statement, and the figures being in a single right-hand column
        is what makes it scannable — you read down the money, not across it. Splitting it two up
        was tried and it broke that alignment, so the width is used by putting the whole card
        beside the details panel instead. See the Overview layouts.
      */}
      <div className="space-y-1.5">
        <Money label="Original amount" value={b?.capital} />
        <Money label="Interest accrued" value={b?.interest} note={`${account.interestRateAnnual}% a year`} />
        <Money label="Fees, incl VAT" value={b?.fees} />
        <Money label="Receipt fees on payments" value={b?.receiptFees} note="10% of each, max R610" />
        <Money label="Collected" value={b ? -b.payments : undefined} />
        <p className="text-[11px] text-slate-400 pt-0.5">
          Fees and receipt fees are shown including VAT
          {b ? <> &mdash; {formatMoney(b.vat)} of the above is VAT</> : null}. Capital and interest carry none.
        </p>
        {/*
          Amber rather than grey, and above the divider: the VAT line explains how a figure is
          PRESENTED, this one explains that money the firm has charged cannot be collected. Same
          place, different weight.
        */}
        {note && (
          <p className="flex items-start gap-1.5 text-[11px] text-[var(--c-gold-dark)] bg-[var(--tint-gold)] rounded-lg px-2.5 py-2 mt-1">
            <AlertTriangle size={12} className="shrink-0 mt-px" />
            <span>{note}</span>
          </p>
        )}
        <div className="border-t border-slate-100 pt-2 mt-1 space-y-1.5">
          <Money label="Balance" value={b?.balance} strong />
          <Money label="Receipt fee if settled" value={b?.settlementFee} />
          <Money label="To settle today" value={b?.settlement} strong />
        </div>
        {/*
          HOW FAR THROUGH IT THEY ARE. THE FIRM: "a progress report or a progress bar for a debtor
          that is paying."
          
          UNDER THE FIGURES IT IS MADE OF, so it can be checked rather than believed. A bar with
          only a percentage on it is one nobody can add up, and this arithmetic goes on a section
          129 and on a client's report next -- both read by people entitled to check it.
          
          DRAWN ONLY WHERE SOMETHING HAS BEEN PAID -- see hasProgress. An empty bar on every
          account in the book is a thing people stop seeing.
        */}
        {progress && hasProgress(progress) && (
          <div className="border-t border-slate-100 pt-2.5 mt-2">
            <PaymentProgressBar progress={progress} />
          </div>
        )}
      </div>
    </Card>
  )
}

/**
 * The bar itself.
 *
 * TWO MEASURES, ONE ABOVE THE OTHER, at the firm's asking. They answer different questions and
 * the money one alone cannot answer the second: a debtor 60% paid who has missed the last three
 * instalments is not the same account as one 60% paid and current, and a single bar reports them
 * identically.
 *
 * NO PERCENTAGE WITHOUT ITS FIGURES. The words under it are what somebody checks the bar against.
 */
export function PaymentProgressBar({ progress }: { progress: PaymentProgress }) {
  const pct = progressPercent(progress.money)
  const run = progress.instalments
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide text-slate-400">Paid so far</span>
        <span className="text-[13px] font-semibold text-slate-700 tabular-nums">{pct}%</span>
      </div>
      {/* aria-hidden on the bar and the numbers in words beside it: a bar is a picture of a
          figure that is already on the screen, and read aloud twice it is noise. */}
      <div aria-hidden className="mt-1 h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full bg-[var(--c-green)]" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
        {formatMoney(progress.money.recovered)} of {formatMoney(progress.money.charged)}
        {progress.money.owed > 0 && <> &middot; {formatMoney(progress.money.owed)} still owed</>}
      </p>
      {run && (
        <p className="text-[11px] text-slate-500 mt-1">
          {/*
            SAID IN WORDS, NOT AS A SECOND BAR. The instalments are a handful of events, and four
            ticks is a picture of a number small enough to read as a number. What matters is
            whether any were MISSED, which a bar cannot say at a glance and a sentence can.
          */}
          <span className={run.missed > 0 ? 'font-medium text-[var(--c-gold-dark)]' : ''}>
            {run.kept} of {run.planned} instalments kept
            {run.missed > 0 && <>, {run.missed} missed</>}
          </span>
          {run.toCome > 0 && <span className="text-slate-400">, {run.toCome} still to come</span>}
        </p>
      )}
    </div>
  )
}

/**
 * Promises to pay.
 *
 * The one thing a collector actually produces on a call. It is a claim about the future, so it
 * never touches a balance — it is kept or it is broken, and a person says which. Matching one
 * against an incoming payment is the collections engine's job, and that does not exist yet.
 */
function PromisePanel({ accountId, promises, userName, userId, onChange, open, setOpen, successRatio, balance, settlement }: {
  accountId: string
  promises: PromiseToPay[]
  userName: string | null
  userId: string | null
  onChange: () => Promise<void>
  open: boolean
  setOpen: (v: boolean) => void
  /** Swordfish's score for how reliably this debtor keeps one, out of ten. */
  successRatio: number | null
  /** What is owed today. An instalment may not exceed it. */
  balance: number | undefined
  /** What it takes to close the account today, including the item 9 receipt fee on settling. */
  settlement: number | undefined
}) {
  /*
   * The arrangement is chosen first, and the amount follows from it.
   *
   * Asked in the other order, the form could not help: it did not know whether "5000" was the
   * whole debt or a monthly instalment, so it could neither fill it in nor object to it. Asked
   * this way round a once-off can quote itself, and an instalment can be held to the balance.
   */
  const [arrangement, setArrangement] = useState<Arrangement | ''>('')
  const [amount, setAmount] = useState('')
  const [dueOn, setDueOn] = useState('')
  const [onLastDay, setOnLastDay] = useState(false)
  const [charged, setCharged] = useState<string | null>(null)
  const { busy, err, run } = useWriter(onChange)

  const outstanding = promises.filter((p) => p.status === 'open')
  const past = promises.filter((p) => p.status !== 'open')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const value = Number(amount)
    if (!arrangement || !(value > 0) || !dueOn || problem) return
    let message: string | null = null
    const ok = await run(async () => {
      const { charge } = await recordPromise({
        accountId, amount: value, dueOn, arrangement,
        onLastDay: arrangement === 'monthly' && onLastDay,
        // Taken from the first instalment's date, which is what the debtor actually agreed to.
        dayOfMonth: arrangement === 'monthly' && !onLastDay ? Number(dueOn.slice(8, 10)) : null,
        dayOfWeek: arrangement === 'weekly' ? isoWeekday(dueOn) : null,
        actor: { id: userId, name: userName },
      })
      message = chargeMessage(charge, PROMISE_ITEM_ID)
    })
    // Said after the fact rather than promised beforehand: whether item 5 has room on this
    // account depends on the ledger, and the ledger is read when the charge is made.
    if (ok) {
      setCharged(message)
      setAmount(''); setDueOn(''); setArrangement(''); setOnLastDay(false); setOpen(false)
    }
  }

  /*
   * Two different answers to an amount that is too big, because they are different mistakes.
   *
   * An instalment above the balance is refused: no instalment can be larger than the whole debt,
   * so it is always a slip. A once-off above the settlement figure is only questioned -- interest
   * runs until the money actually arrives, and someone may be promising a round number that
   * covers it. The person on the phone knows which; the form does not.
   */
  const problem = arrangement && balance !== undefined && settlement !== undefined
    ? promiseProblem(arrangement, Number(amount), balance, settlement)
    : null
  const over = arrangement === 'once_off' && settlement !== undefined && Number(amount) > settlement

  return (
    <Card>
      <PanelTitle action={
        <button onClick={() => setOpen(!open)} className="text-xs text-brand-600 hover:underline inline-flex items-center gap-1">
          {open ? <><X size={12} /> Cancel</> : <><Plus size={12} /> Take one</>}
        </button>
      }>Promise to pay</PanelTitle>

      {successRatio !== null && (
        // Worth knowing before you take another one: a debtor who has kept none of the last ten
        // is a different conversation from one who has kept eight.
        <p className="text-[11px] text-slate-500 mb-3">
          Keeps <span className="font-medium text-slate-700 tabular-nums">{successRatio}</span> of 10 promises,
          per Swordfish.
        </p>
      )}

      {open && (
        <form onSubmit={submit} className="space-y-2 p-3 rounded-lg bg-slate-50 border border-slate-100 mb-3">
          {/*
            What kind of arrangement, before anything else. Choosing "once-off settlement" fills
            the amount in with what it actually takes to close the account today -- the balance
            plus the item 9 receipt fee that settling attracts -- because a settlement quoted at
            the bare balance leaves the debtor still owing that fee, and an account everyone
            believes is closed turns up open. It stays editable: it is a quote, not a lock.
          */}
          <select
            value={arrangement}
            autoFocus
            onChange={(e) => {
              const next = e.target.value as Arrangement | ''
              setArrangement(next)
              if (next === 'once_off' && settlement !== undefined) setAmount(String(settlement))
              else setAmount('')
            }}
            className="w-full text-sm rounded-lg border border-slate-200 px-2 py-1.5 bg-white"
          >
            <option value="">What did they agree to?</option>
            {(Object.keys(ARRANGEMENT_LABEL) as Arrangement[]).map((a) => (
              <option key={a} value={a}>{ARRANGEMENT_LABEL[a]}</option>
            ))}
          </select>

          {arrangement && (
            <>
              <label className="block text-[11px] text-slate-500">
                {arrangement === 'once_off' ? 'Settles the account in full' : 'Amount per instalment'}
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal"
                  placeholder={arrangement === 'once_off' ? 'Amount' : 'e.g. 500'}
                  className={`w-full text-sm rounded-lg border px-2 py-1.5 mt-0.5 ${
                    problem ? 'border-negative-100 bg-negative-50' : 'border-slate-200'}`} />
              </label>
              {arrangement !== 'once_off' && balance !== undefined && (
                <p className="text-[11px] text-slate-500">
                  {formatMoney(balance)} outstanding.
                </p>
              )}
              {problem && <p className="text-[11px] text-negative-700 leading-snug">{problem}</p>}
              {over && (
                <p className="text-[11px] text-gold-600 leading-snug">
                  That is more than the {formatMoney(settlement!)} it takes to settle the account
                  today. Fine if they meant it &mdash; worth a second look if they did not.
                </p>
              )}
              {arrangement === 'monthly' && (
                <label className="flex items-center gap-2 text-[11px] text-slate-600">
                  <input type="checkbox" checked={onLastDay} onChange={(e) => setOnLastDay(e.target.checked)} />
                  On the last day of the month
                </label>
              )}
              <label className="block text-[11px] text-slate-500">
                {arrangement === 'once_off' ? 'Due on' : 'First instalment due on'}
                <input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} min={TODAY}
                  className="w-full text-sm rounded-lg border border-slate-200 px-2 py-1.5 mt-0.5" />
              </label>
              {arrangement !== 'once_off' && dueOn && (
                // Said back before it is saved: "monthly on the 31st" behaves differently in
                // February, and a person should see which rule they have picked rather than
                // discover it later.
                <p className="text-[11px] text-slate-500">
                  Then {arrangement === 'weekly'
                    ? `every ${WEEKDAYS[isoWeekday(dueOn) - 1]}`
                    : onLastDay ? 'on the last day of each month' : `on the ${dueOn.slice(8, 10)}th of each month`}.
                </p>
              )}
              <p className="text-[10px] text-slate-500 leading-snug">
                Taking an arrangement charges item 5, the settlement account drawn up at the
                debtor&rsquo;s request &mdash; R50 excluding VAT, per occurrence.
              </p>
            </>
          )}
          <button type="submit" disabled={busy || !arrangement || !(Number(amount) > 0) || !dueOn || !!problem}
            className="w-full text-sm font-medium py-1.5 rounded-lg bg-brand-600 text-white disabled:opacity-50">
            {busy ? 'Saving...' : 'Record promise'}
          </button>
        </form>
      )}
      {charged && <p className="text-[11px] text-gold-600 mb-2">{charged}</p>}
      {err && <p className="text-xs text-negative-700 mb-2">{err}</p>}

      {outstanding.length === 0 && past.length === 0 && !open && (
        <p className="text-[11px] text-slate-400 leading-relaxed">
          No promise outstanding. Take one on the next call &mdash; it is the thing this account is measured by.
        </p>
      )}

      <div className="space-y-2">
        {outstanding.map((p) => {
          const late = isOverdue(p, TODAY)
          return (
            <div key={p.id} className={`p-3 rounded-lg border ${late ? 'border-negative-100 bg-negative-50' : 'border-gold-100 bg-gold-50'}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className={`font-semibold tabular-nums ${late ? 'text-negative-700' : 'text-navy-950'}`}>{formatMoney(p.amount)}</span>
                <span className={`text-[11px] ${late ? 'text-negative' : 'text-gold-600'}`}>
                  {late ? 'overdue ' : 'due '}{formatDate(p.dueOn)}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {[describeArrangement(p), p.method,
                  p.instalmentsKept > 0 ? `${p.instalmentsKept} paid so far` : null]
                  .filter(Boolean).join(' · ')}
              </p>
              <div className="flex gap-1.5 mt-2">
                <button disabled={busy} onClick={() => run(() => keepInstalment(p, userId))}
                  className="flex-1 text-[11px] font-medium py-1 rounded border border-positive-100 text-positive-700 hover:bg-positive-50 disabled:opacity-50 inline-flex items-center justify-center gap-1">
                  <Check size={11} /> {p.arrangement === 'once_off' ? 'Kept' : 'Instalment paid'}
                </button>
                <button disabled={busy} onClick={() => run(() => resolvePromise(p.id, 'broken', userId))}
                  className="flex-1 text-[11px] font-medium py-1 rounded border border-negative-100 text-negative-700 hover:bg-negative-50 disabled:opacity-50 inline-flex items-center justify-center gap-1">
                  <XCircle size={11} /> Broken
                </button>
                <button disabled={busy} onClick={() => run(() => resolvePromise(p.id, 'cancelled', userId))}
                  className="text-[11px] px-2 py-1 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50">
                  Cancel
                </button>
              </div>
            </div>
          )
        })}

        {past.length > 0 && (
          <div className="pt-1 space-y-1">
            {past.slice(0, 6).map((p) => (
              <div key={p.id} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="text-slate-500">
                  {p.status === 'kept' ? <CheckCircle2 size={11} className="inline text-positive mr-1" /> : null}
                  {formatDate(p.dueOn)}
                </span>
                <span className="tabular-nums text-slate-500">{formatMoney(p.amount)}</span>
                <PromiseChip status={p.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

/**
 * Who is behind this debtor, and what is already against them.
 *
 * Three facts that change what the call is, and none of which the book could hold until now:
 *
 *   - An appointed practitioner. The debt is still owed, but the DEBTOR IS NO LONGER THE PERSON
 *     TO ASK — the claim goes to a liquidator, trustee, curator, executor, business rescue
 *     practitioner or debt counsellor. A collector who rings the company instead has wasted the
 *     call at best.
 *   - The directors of a company, because a company is not rung; its people are. Active first:
 *     one real profile carries six directors of whom four have resigned, and a list that mixes
 *     them is four wasted calls.
 *   - Judgments other creditors already hold. The firm has said plainly that these will drive an
 *     internal likelihood of collection reported back to clients, so they are shown as rows — who
 *     sued, for what, how long ago — and NOT as a score. See BACKLOG: a number that goes on a
 *     client report has to be calibrated against the firm's own recovered outcomes first.
 *
 * Absent on nearly every account, and silent when absent.
 */
function StandingPanel({
  account, standing, position, traces, traceAction, onUpload, onOpenTrace, onPractitioner,
  onAddDirector, onEditDirector,
}: {
  account: DebtorAccount
  standing: AccountStanding
  /** The rung the account sits on, so a missing practitioner can be a warning only when it is one. */
  position: DeskPosition
  /** Every trace filed on this account, newest first, with everything each one found. */
  traces: FiledTrace[]
  /**
   * The Trace button itself, rendered by the account screen and handed in.
   *
   * Handed in rather than rebuilt here so there is one of it: it copies the ID number, opens XDS,
   * asks how many searches were run and raises item 4(c). A second copy of that in this file
   * would be a second place for the charge to drift.
   */
  traceAction: React.ReactNode
  /** Read a bureau PDF onto the account. See TraceUploadModal. */
  onUpload: () => void
  /** Open one for working: ring its numbers, record what happened, promote the real ones. */
  onOpenTrace: (traceId: string) => void
  /** Record who to deal with instead of the debtor. Not on any PDF — see PractitionerModal. */
  onPractitioner: () => void
  /** Put a director on the account by hand, where no trace has been bought. */
  onAddDirector: () => void
  /** Correct one that was typed in. Bureau-reported directors are not editable — see below. */
  onEditDirector: (director: AccountDirector) => void
}) {
  const kindLabel = practitionerLabel(account.practitionerKind)
  const hasPractitioner = !!(kindLabel || account.practitionerName || account.practitionerFirm)
  const { directors, judgments } = standing
  /*
   * SPLIT BEFORE ANYTHING IS COUNTED. A director's own judgments are on this account because the
   * director is, and they are real — but they are not judgments against the debtor. Counted in,
   * a company with a clean record reads as having two because somebody who signed for it does,
   * and that is the number the firm has said will drive what it reports to clients.
   */
  const { own: ownJudgments, byDirector: directorJudgments } = splitJudgments(judgments)
  const summary = judgmentSummary(ownJudgments)
  /*
   * A WARNING THAT ONLY FIRES WHEN SOMETHING IS ACTUALLY WRONG.
   *
   * The account reports as under administration — somebody else is running the debtor's affairs
   * — and there is no record of who. That is a claim nobody can submit, and it is the one state
   * worth interrupting a collector about. On every other rung a missing practitioner is simply
   * the normal case, and saying so would train people to stop reading.
   */
  const claimNobodyCanMake = position === 'under_administration' && !hasPractitioner

  /*
   * EVERY ACCOUNT GETS THIS PANEL, empty or not.
   *
   * It used to be hidden on an individual with nothing on it, on the reasoning that an empty card
   * across several hundred thousand accounts is a card people stop seeing. The firm asked for it
   * back -- "put it there as an empty box where you can upload a trace or do the trace" -- and the
   * old reasoning was answering the wrong question. It is not an empty card; it is where the work
   * starts. An individual with no bureau profile is precisely the account where somebody needs to
   * run a search, and hiding the way to do it does not make the account less empty.
   */
  const bare = !hasPractitioner && directors.length === 0 && judgments.length === 0
    && traces.length === 0 && !claimNobodyCanMake

  /*
   * WHAT THE SECOND SEARCH BOUGHT.
   *
   * THE FIRM: "if we have to update a trace, let's say three months later we do a trace and we
   * can update it -- like, okay, well, there's a new trace. And then it should compare it with
   * the data from the old trace and show you if there's any new data."
   *
   * A profile pulled three months after the first is mostly the same profile, and a collector who
   * has already worked those numbers is being asked to read forty lines to find the two that
   * changed. The account is charged Annexure B item 4(c) for the second search, so what it bought
   * is the fair question to answer here.
   *
   * READ AGAINST THE SAME SUBJECT, never simply the trace before it -- a company account carries
   * one report for the company and one per director, and paired by date alone every finding on
   * both would be reported as new. See previousTraceFor.
   */
  /* Everything still owned, across the company's own report and every director's. */
  const ownedProperty = useMemo(() => propertyAcross(traces), [traces])

  const sinceLastTrace = useMemo(() => {
    const latest = traces[0]
    if (!latest) return null
    const earlier = previousTraceFor(traces, latest)
    if (!earlier) return null
    return {
      when: earlier.enquiredOn ?? earlier.createdAt.slice(0, 10),
      ...compareTraceReports(latest.items, earlier.items),
    }
  }, [traces])

  return (
    /*
      A CONTAINER, so the blocks inside can lay themselves out on THIS PANEL'S width rather than
      the screen's. The two are not the same thing: in the three-column layout this card is about
      19rem wide on a 27" monitor, and a screen-width breakpoint would cheerfully put four columns
      inside it. Named, because @container/details on the debtor card is a different box and a
      variant naming that one from in here would never match anything.
    */
    <Card className="@container/trace">
      {/*
        THE WAY IN HAS TO BE A BUTTON. It was a line of small text inside a summary block, and the
        firm's report was "I don't know how to open that area where all the information is" —
        which is the only verdict that matters on a control nobody found. Uploading is the smaller
        job once a trace exists, so it gives up the emphasis.
      */}
      {/*
        THE HOUSE SCALE, not the mockup's.

        This shipped at the size the design was drawn at -- an 18px heading, a 20px number, 18px
        icons -- and the firm's verdict was "super bulky". They were right, and the mistake was
        mine twice over: a mockup is drawn full-bleed and this panel is a 19rem column, and every
        other card beside it already had a settled scale. A survey of the screen afterwards found
        exactly three pieces of oversized type on it and all three were this panel's.

        So: an 11px uppercase heading like every other panel, 11px labels, 13px values. What is
        KEPT from the design is the shape -- the bordered card, the icon in the gutter, the rules
        between findings, the two columns -- because that was never the problem.
      */}
      <PanelTitle action={
        <span className="inline-flex items-center gap-2">
          {/*
            ONE PLACE TO UPLOAD, NOT TWO. THE FIRM: "you should be able to upload a trace, of
            course, but there's not necessary to have two places to do that."
            
            With an empty panel there are two buttons in the middle of it -- "Do the trace" and
            "Upload a trace I already have" -- which are the ones somebody with no trace is
            looking at, and they say what they do at full size. This link sat above them saying
            the same thing in eleven-point grey. It is what is left once a trace exists and the
            empty state is gone, so it appears only then.
          */}
          {!bare && (
            <button type="button" onClick={onUpload}
              className="text-[11px] font-medium text-[var(--c-steel)] hover:underline">
              Upload a trace
            </button>
          )}
          {traces.length > 0 && (
            <button type="button" onClick={() => onOpenTrace(traces[0].id)}
              className="text-[11px] font-medium px-2 py-1 rounded-lg border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500 inline-flex items-center gap-1">
              <Search size={11} /> Open {traces.length > 1 ? `${traces.length} traces` : 'the trace'}
            </button>
          )}
        </span>
      }>Trace information</PanelTitle>

      {bare && (
        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-5 text-center">
          <p className="text-sm text-slate-600 font-medium">No trace on this account yet</p>
          <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
            {account.debtorKind === 'company'
              ? 'A company is reached through its directors. Run a search and they land here, with the judgments against it.'
              : 'Numbers, addresses, employment and next of kin all come off a bureau profile.'}
          </p>
          <div className="mt-3 flex flex-wrap items-start justify-center gap-2">
            {/*
              THE SEARCH FIRST. Uploading is what you do with a PDF you already have; running one
              is what somebody with an empty panel actually needs, and it is the one that costs
              money -- so it is the one that gets the weight and the confirmation behind it.
            */}
            {traceAction}
            <button type="button" onClick={onUpload}
              className="text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:border-[#c9a052] hover:bg-gold-50">
              Upload a trace I already have
            </button>
          </div>
        </div>
      )}

      {/*
        SAID ABOVE THE FINDINGS, because it is how to read them rather than one of them.
        
        NOTHING NEW IS STILL SAID OUT LOUD. A second search the account has been charged for that
        found nothing the first one did not is a fact worth putting in front of whoever decides
        to run a third -- and it is the answer to "why am I reading this again".
        
        AND NOTHING HERE CALLS A FINDING DEAD. A number missing from the newer report is not a
        disconnected number: bureaux age records out and two profiles carry different columns.
        Only a collector who dialled it may say otherwise, which is what an outcome is for.
      */}
      {sinceLastTrace && (
        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
          <p className="text-[11px] text-slate-600">
            <span className={`font-medium ${
              sinceLastTrace.added > 0 ? 'text-[var(--c-green)]' : 'text-slate-500'}`}>
              {comparisonLine(sinceLastTrace)}
            </span>
            {' '}
            <span className="text-slate-400">
              Compared with the report of {formatDate(sinceLastTrace.when)}.
            </span>
          </p>
        </div>
      )}

      {claimNobodyCanMake && (
        <div className="mb-3 rounded-lg border border-gold-300 bg-gold-50 px-2.5 py-2">
          <p className="text-xs font-medium text-navy-900 inline-flex items-center gap-1.5">
            <AlertTriangle size={13} className="text-gold-600 shrink-0" /> Nobody recorded to claim from
          </p>
          <p className="text-[11px] text-slate-600 mt-0.5">
            Somebody else is administering this debtor&rsquo;s affairs, and the account does not say
            who. The claim cannot be submitted until it does.
          </p>
          {/* The warning carries the thing that clears it. A notice with no way out is a nag. */}
          <button type="button" onClick={onPractitioner}
            className="mt-1.5 text-[11px] font-medium text-[var(--c-steel)] hover:underline">
            Add the practitioner
          </button>
        </div>
      )}

      {hasPractitioner && (
        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
          <p className="text-xs font-semibold text-navy-900">
            Deal with the {(kindLabel ?? 'practitioner').toLowerCase()}, not the debtor
          </p>
          {practitionerMeaning(account.practitionerKind) && (
            <p className="text-[11px] text-slate-500 mt-0.5">{practitionerMeaning(account.practitionerKind)}</p>
          )}
          <div className="space-y-1.5 mt-2">
            <Field label={kindLabel ?? 'Appointed'} value={account.practitionerName} note={account.practitionerFirm ?? undefined} />
            <Field label="Their reference" value={account.practitionerReference} />
            <Field label="Phone" value={account.practitionerPhone} />
            <Field label="Email" value={account.practitionerEmail} />
            <Field label="Appointed" value={account.practitionerAppointedOn ? formatDate(account.practitionerAppointedOn) : null}
              action={{ label: 'Change', onClick: onPractitioner }} />
          </div>
        </div>
      )}

      {/*
        WHAT THE TRACE FOUND, in a few lines, at the firm's instruction: "a principal telephone
        number, a principal address, property interests if they have properties, and next of kins"
        — and where they work, which they added.

        A SUMMARY, NOT THE TRACE. One real profile carries twenty-six numbers, eleven addresses
        and thirty directorships; the whole of it belongs behind the link, not on a panel a
        collector reads between calls.
      */}
      {/*
        WHAT ANYBODY CONNECTED TO THIS ACCOUNT STILL OWNS, ONCE, ABOVE THE REPORTS.
        
        THE FIRM: "if the directors of these companies, and we see that they have properties,
        that is displayed on the main page."
        
        Each trace already showed its own. What it could not show was the answer: a company with
        three directors traced draws four panels, each naming one property, and "is there
        anything here worth attaching" was spread across them and never added up.
        
        WHOSE IT IS IS ON EVERY ROW. A judgment against the company does not attach a director's
        house -- that takes a suretyship, or piercing -- so a collector who cannot see whose name
        is on the deed cannot tell which of those they are looking at.
        
        ONLY WHERE THERE IS MORE THAN ONE OWNER IN PLAY. On a plain consumer account the one
        trace panel below says it already, and a summary of one line above one line is noise.
      */}
      {ownedProperty.length > 0 && new Set(ownedProperty.map((p) => p.owner)).size > 1 && (
        <div className="mb-3 rounded-lg border border-slate-200 overflow-hidden">
          <Finding icon={<Home size={12} />} label="Property held, across every trace">
            <ul className="space-y-1">
              {ownedProperty.slice(0, 5).map((p) => (
                <li key={`${p.traceId}:${p.item.id}`} className="min-w-0">
                  <button type="button" onClick={() => onOpenTrace(p.traceId)}
                    className="block text-left w-full hover:underline">
                    <span className="block text-sm text-slate-800 break-words">{p.item.value}</span>
                    <span className="block text-[11px] text-slate-400">
                      {[
                        p.owner ?? (p.ownerKind === 'director' ? 'a director' : 'the debtor'),
                        p.ownerKind === 'director' ? 'director' : null,
                        p.item.amount !== null ? `bought for ${formatMoney(p.item.amount)}` : null,
                      ].filter(Boolean).join(' \u00b7 ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {ownedProperty.length > 5 && (
              <p className="text-[11px] text-slate-400 mt-1">
                and {ownedProperty.length - 5} more on the reports below
              </p>
            )}
          </Finding>
        </div>
      )}

      {traces.map((trace) => (
        <TraceFound key={trace.id} trace={trace} onOpen={() => onOpenTrace(trace.id)} />
      ))}

      {/*
        DIRECTORS CAN BE TYPED IN, not only read off a bureau PDF.

        They arrived one way until now: parsed from a commercial trace. That works once a trace
        has been bought, and the firm's ask is the case where one has not — "if there's a company,
        the ID numbers of the directors should also be stored". A collector reading a letterhead,
        a CIPC disclosure or a signed suretyship has the names, and often the numbers, long before
        anybody pays a bureau for them. The ID number is the point of the exercise: it is what
        makes a director traceable in their own right, and on a suretyship it is who actually owes
        the money.

        Offered on a company only. A director on an individual's account is not a thing.
      */}
      {(directors.length > 0 || account.debtorKind === 'company') && (
        <div className="mb-3">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <p className="text-[11px] uppercase tracking-wide text-slate-400 inline-flex items-center gap-1.5">
              <Users size={12} /> Directors
            </p>
            {account.debtorKind === 'company' && (
              <button type="button" onClick={onAddDirector}
                className="text-xs text-brand-600 hover:underline inline-flex items-center gap-1">
                <Plus size={12} /> Add
              </button>
            )}
          </div>
          {directors.length === 0 && (
            <p className="text-xs text-slate-400 mb-2">
              Nobody recorded yet. Add them off a letterhead or a CIPC disclosure, or run a
              commercial trace and they land here with the judgments against them.
            </p>
          )}
          <ul className="space-y-1.5">
            {directors.map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
                <span className={d.status === 'Resigned' ? 'text-slate-400' : 'text-slate-800'}>
                  {d.fullName}
                  {/* The ID number is why a director is stored at all: their own trace is keyed on it. */}
                  {d.idNumber && <span className="block text-[11px] text-slate-400 font-mono">{d.idNumber}</span>}
                </span>
                <span className={`text-[11px] px-1.5 py-0.5 rounded-full shrink-0 ${
                  d.status === 'Resigned' ? 'bg-slate-100 text-slate-500' : 'bg-positive-50 text-positive-700'
                }`}>
                  {d.status ?? 'Unknown'}
                </span>
                <Directorships companies={d.companies} />
                {/*
                  THEIR OWN JUDGMENTS, under their own name and nowhere near the company's.
                  A director who has been sued personally is a different conversation — and on a
                  suretyship it is the same debt — but it is not a judgment against the debtor.
                */}
                <PersonalJudgments judgments={directorJudgments.get(d.id) ?? []} />
                {/*
                  Correcting one is offered where it was TYPED, not where a bureau reported it.
                  A trace's own reading of a name is evidence and editing it in place would leave
                  the account disagreeing with the PDF filed against it, with nothing to say which
                  had been changed.
                */}
                {d.source === 'manual' && (
                  <button type="button" onClick={() => onEditDirector(d)}
                    className="text-[11px] text-slate-400 hover:text-brand-600 hover:underline">
                    Edit
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        JUDGMENTS, laid out as the firm drew them: a heading that carries the count and the newest
        date, then each one as four labelled columns.

        THE LABELS ARE THE POINT. "22 Apr 2025 · Levies · Judgement By Default · case 2334/2025"
        is four facts run together in a grey line, and a collector reading it has to work out which
        is which. Named columns are read at a glance, and this is the block that decides whether an
        account is worth attaching.
      */}
      {ownJudgments.length > 0 && (
        <div className="rounded-lg border border-slate-200 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-2 border-b border-slate-100">
            <p className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-400">
              <Gavel size={12} />
              Judgments
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 normal-case tracking-normal">
                {summary.count}
              </span>
            </p>
            <p className="text-[11px] text-slate-400 shrink-0">
              {summary.newest
                ? `most recent ${formatDate(summary.newest)}`
                : 'no filing date recorded'}
            </p>
          </div>

          {/*
            The total says "at least" where an amount is missing. A judgment recorded without one
            is not nothing, and a figure that quietly left it out would be read as the whole.
          */}
          {summary.total > 0 && (
            <p className="px-2.5 pt-2 text-[11px] text-slate-400">
              {summary.withoutAmount > 0 ? 'At least ' : ''}
              <span className="font-medium text-slate-600">{formatMoney(summary.total)}</span>
              {summary.withoutAmount > 0 && ` \u2014 ${summary.withoutAmount} without a recorded amount`}
            </p>
          )}

          <ul className="divide-y divide-slate-100">
            {ownJudgments.map((j) => (
              <li key={j.id} className="px-2.5 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 break-words">
                      {j.plaintiff ?? 'Plaintiff not recorded'}
                    </p>
                    <p className="text-[11px] text-slate-400">creditor</p>
                  </div>
                  {j.amount !== null && (
                    <span className="text-sm text-slate-700 tabular-nums shrink-0">{formatMoney(j.amount)}</span>
                  )}
                </div>

                {/*
                  TWO COLUMNS IN THIS PANEL, FOUR WHERE THERE IS ROOM. The design was drawn with
                  four across a full-width card; this panel is a 19rem column in the three-column
                  layout, where four columns give each about forty pixels and "Judgement By
                  Default" wraps to four lines. @container, so it answers to the PANEL's width and
                  not the screen's -- the same card is wide in the one-column layout.
                */}
                <dl className="mt-2 grid grid-cols-2 @lg/trace:grid-cols-4 gap-x-3 gap-y-1.5">
                  <JudgmentCell label="Date" value={j.filedOn ? formatDate(j.filedOn) : null} />
                  {/*
                    WHAT THE DEBT WAS, then WHAT THE COURT DID. The bureau's two columns are
                    caseReason ("Levies") and caseType ("Judgement By Default"), and they answer
                    those two different questions in that order.
                  */}
                  <JudgmentCell label="Type" value={j.caseReason} />
                  <JudgmentCell label="Outcome" value={j.caseType} />
                  <JudgmentCell label="Case number" value={j.caseNumber} />
                </dl>

                {/*
                  THE ROW AS THE BUREAU PRINTED IT, where its columns could not be split. Shown as
                  the bureau's own words rather than dressed up as a plaintiff — a judgment nobody
                  could parse is still a judgment, and who sued is the part worth having.
                */}
                {j.plaintiff === null && j.sourceText !== null && (
                  <p className="mt-1.5 text-[11px] text-slate-500 italic">
                    As printed: &ldquo;{j.sourceText}&rdquo;
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

/**
 * What one filed trace found, in the few lines that change what a collector does next.
 *
 * EVERY LINE HERE IS A FACT SOMEBODY CAN ACT ON. A number to ring, an address to serve at, an
 * employer to garnishee, a property that is an asset, a relative who might know where they are.
 * The bureau's twenty-odd other numbers are not on this panel and are not lost — they are one
 * click away, in the trace itself, where they can be worked.
 */
function TraceFound({ trace, onOpen }: { trace: FiledTrace; onOpen: () => void }) {
  const found = traceSummary(trace.items)
  const who = trace.subjectKind === 'director' ? trace.subjectName : null
  const kin = found.relatives[0] ?? null

  return (
    <div className="mb-3 rounded-lg border border-slate-200 overflow-hidden">
      <Finding icon={<Phone size={12} />} label="Phone number"
        action={(
          <button type="button" onClick={onOpen}
            className="text-[11px] font-medium text-[var(--c-steel)] hover:underline shrink-0">
            {who ? 'Review' : 'Review trace'} &rarr;
          </button>
        )}>
        {found.phone === null ? (
          <p className="text-sm text-slate-400">No number on this trace</p>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {/*
              The gutter already has a telephone on it, so PhoneLink is given its own content:
              its default is "<icon> number" and the row was showing two receivers.
            */}
            <span className="text-sm font-medium text-navy-950">
              <PhoneLink number={found.phone.value}>{found.phone.value}</PhoneLink>
            </span>
            {/* Confirmed means somebody rang it and reached them, not that a bureau printed it. */}
            {found.phone.outcome === 'verified' && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-positive-50 text-positive-700">
                <CheckCircle2 size={10} /> Confirmed
              </span>
            )}
            {found.phone.promotedContactId !== null && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">On account</span>
            )}
          </div>
        )}
      </Finding>

      {found.address && (
        <Finding icon={<MapPin size={12} />} label="Address" divider>
          <p className="text-sm text-slate-800 break-words">{found.address.value}</p>
          {found.address.label && <p className="text-[11px] text-slate-400">{found.address.label}</p>}
        </Finding>
      )}

      {found.employer && (
        <Finding icon={<Building2 size={12} />} label="Employer" divider>
          <p className="text-sm text-slate-800 break-words">{found.employer.value}</p>
          {found.employer.label && <p className="text-[11px] text-slate-400">{found.employer.label}</p>}
        </Finding>
      )}

      {/*
        PROPERTY AND NEXT OF KIN SIDE BY SIDE, which is the firm's own layout. They are the two
        findings that change what KIND of account this is rather than how to reach them: something
        to attach, and somebody else who might know where they are.
      */}
      {(found.properties.length > 0 || kin !== null) && (
        <div className="grid @sm/trace:grid-cols-2 border-t border-slate-100 divide-y @sm/trace:divide-y-0 @sm/trace:divide-x divide-slate-100">
          {found.properties.length > 0 && (
            <Finding icon={<Home size={12} />} label="Property">
              <p className="text-sm text-slate-800 break-words">{found.properties[0].value}</p>
              <p className="text-[11px] text-slate-400">
                {[
                  found.properties[0].amount !== null
                    ? `bought for ${formatMoney(found.properties[0].amount)}` : null,
                  found.properties.length > 1 ? `and ${found.properties.length - 1} more` : null,
                ].filter(Boolean).join(' \u00b7 ')}
              </p>
            </Finding>
          )}
          {kin !== null && (
            <Finding icon={<User size={12} />} label="Possible next of kin">
              <p className="text-sm text-slate-800 break-words">{kin.value}</p>
              {/*
                "Unverified" is the whole point of the word "possible". A shared surname is
                evidence of a family connection and not proof of one, and a collector who opens a
                call to somebody's sister as though it were established has made it worse.
              */}
              <p className="text-[11px] text-slate-400">
                {found.relatives.length > 1
                  ? `unverified \u00b7 and ${found.relatives.length - 1} more`
                  : 'unverified relationship'}
              </p>
            </Finding>
          )}
        </div>
      )}

      {found.directorships.length > 0 && (
        <Finding icon={<Building2 size={12} />} label="Directs" divider>
          <p className="text-sm text-slate-800 break-words">
            {found.directorships.slice(0, 3).map((d) => d.value).join(', ')}
            {found.directorships.length > 3 && (
              <span className="text-slate-400"> and {found.directorships.length - 3} more</span>
            )}
          </p>
        </Finding>
      )}

      {/*
        WHAT NOBODY HAS TRIED YET, which is the only measure of whether the search was worth
        buying. Silent at nought: a line reading "0 untried" has nothing to say and still takes
        a row.
      */}
      {found.untried > 0 && (
        <button type="button" onClick={onOpen}
          className="w-full text-left px-2.5 py-1.5 border-t border-slate-100 bg-slate-50/70 text-[11px] font-medium text-[var(--c-steel)] hover:bg-gold-50">
          {found.untried} finding{found.untried === 1 ? '' : 's'} nobody has tried yet &rarr;
        </button>
      )}
    </div>
  )
}

/** One labelled finding: an icon in the gutter, a quiet label, and the fact itself. */
function Finding({ icon, label, children, action, divider }: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
  action?: React.ReactNode
  divider?: boolean
}) {
  return (
    <div className={`flex items-start gap-2 px-2.5 py-2 ${divider ? 'border-t border-slate-100' : ''}`}>
      <span className="shrink-0 text-slate-400 mt-0.5">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-slate-400">{label}</p>
        {children}
      </div>
      {action}
    </div>
  )
}

/** One column of a judgment. Absent values say so rather than leaving a blank under a heading. */
function JudgmentCell({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={`text-xs break-words ${value ? 'text-slate-800' : 'text-slate-400'}`}>
        {value ?? 'Not recorded'}
      </dd>
    </div>
  )
}


/**
 * The other companies a director sits on.
 *
 * THE FIRM'S OWN SHAPE FOR THIS: "We could mention the active directorships. But if there are
 * other directorships where he's not active, there can be a little sign that says there are other
 * directors that he's not active anymore."
 *
 * So the live ones are named — those are companies that could actually be approached — and the
 * resigned ones are one short line. One real profile carries thirty directorships; listed in full
 * they bury the account under somebody's CV and the two that matter are lost in it.
 */
/*
 * FOUR NAMES IS A SENTENCE; TWENTY-FIVE IS A WALL.
 *
 * One real director on the firm's own book actively directs twenty-five companies. Named in full
 * they take more vertical space than the whole rest of the panel, and the point of naming them —
 * that here are companies somebody could actually approach — is lost in the reading. The newest
 * appointments are named because those are the live concerns, and the rest are a count.
 */
/**
 * What a director has against them personally.
 *
 * One line, named by plaintiff, and deliberately quiet. It is context a collector wants before
 * ringing somebody — and it is the thing that must never be counted as the company's, which is
 * why it renders here rather than in the block above.
 */
function PersonalJudgments({ judgments }: { judgments: AccountJudgment[] }) {
  if (judgments.length === 0) return null
  const newest = judgments.reduce((a, b) => ((b.filedOn ?? '') > (a.filedOn ?? '') ? b : a))
  return (
    <span className="block w-full mt-0.5 text-[11px] text-negative-700">
      {judgments.length === 1 ? 'A judgment against them personally' : `${judgments.length} judgments against them personally`}
      {newest.plaintiff && <> &mdash; {newest.plaintiff}</>}
      {newest.filedOn && <>, {formatDate(newest.filedOn)}</>}
    </span>
  )
}

const NAME_AT_MOST = 4

function Directorships({ companies }: { companies: DirectorCompany[] }) {
  if (companies.length === 0) return null
  const { active, resigned } = directorshipSummary(companies)
  const named = active.slice(0, NAME_AT_MOST)
  const unnamed = active.length - named.length
  return (
    <span className="block w-full mt-0.5">
      {named.length > 0 && (
        <span className="block text-[11px] text-slate-500">
          Also directs {named.map((c) => c.companyName).join(', ')}
          {unnamed > 0 && ` and ${unnamed} more`}
        </span>
      )}
      {resigned > 0 && (
        <span className="block text-[11px] text-slate-400">
          {active.length > 0 ? 'and has resigned from' : 'Has resigned from'} {resigned} other
          {resigned === 1 ? ' company' : ' companies'}
        </span>
      )}
    </span>
  )
}

function PositionPanel({ account, ceiling, chargedExclVat, clientLiaisonName, onFreeze }: {
  account: DebtorAccount
  ceiling: { limit: number } | null
  chargedExclVat: number
  clientLiaisonName: string | null
  /** Null where this person may not stop work — the field then simply has no control on it. */
  onFreeze: (() => void) | null
}) {
  const handedOver = account.handoverDate
    ? [formatDate(account.handoverDate), timeOnDesk(account.handoverDate)].filter(Boolean).join(' · ')
    : null

  return (
    <Card>
      <PanelTitle>Position</PanelTitle>
      {ceiling && (
        <div className="pb-3">
          <div className="flex items-baseline justify-between text-xs mb-1">
            <span className="text-slate-500">Annexure B fee ceiling</span>
            <span className={`tabular-nums ${chargedExclVat > ceiling.limit ? 'text-negative font-medium' : 'text-slate-400'}`}>
              {formatMoney(chargedExclVat)} of {formatMoney(ceiling.limit)}
            </span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${chargedExclVat > ceiling.limit ? 'bg-negative' : chargedExclVat / ceiling.limit > 0.9 ? 'bg-gold-500' : 'bg-brand-500'}`}
              style={{ width: `${Math.min(100, ceiling.limit ? (100 * chargedExclVat) / ceiling.limit : 0)}%` }}
            />
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {chargedExclVat >= ceiling.limit - 0.01
              ? 'At the ceiling. Further work on this account cannot be charged to the debtor.'
              : `${formatMoney(ceiling.limit - chargedExclVat)} of chargeable work left.`}
          </p>
        </div>
      )}
      <div className="space-y-1.5">
        <Field label="Commission" value={account.commissionRate === null ? 'not resolved' : pct(account.commissionRate)} />
        {/*
          THE STATUS IS WHERE WORK IS STOPPED, not the action row.

          The row is already nine buttons and the firm has said so. More to the point, a freeze
          IS the status — changing it anywhere else would be a control that acts on a field
          somewhere else on the page, which is how people end up unsure whether it worked.
        */}
        <Field
          label="Status"
          value={[account.status, account.subStatus].filter(Boolean).join(' · ')}
          note={account.frozenBy || account.frozenReason
            ? [frozenByLabel(account.frozenBy), account.frozenReason].filter(Boolean).join(' — ')
            : undefined}
          action={onFreeze
            ? { label: account.frozenBy || /^frozen/i.test(account.status) ? 'Restart' : 'Stop work',
                onClick: onFreeze }
            : undefined}
        />
        <Field label="Bucket" value={account.bucket} />
        {/*
          HANDED OVER, and it belongs above the other dates because it is the one they are all
          measured from — prescription runs from it, and how long an account has sat on the desk
          is judged against it.

          It was only in the hero band, which is the first thing off the top of the screen: the
          moment somebody scrolls to the figures they are working from, the date the clock
          started is gone. Shown with its age because that is the question actually being asked
          — "how long have we had this one" — and nobody counts months off a date in their head
          while a debtor is on the phone.
        */}
        <Field label="Handed over" value={handedOver} />
        <Field label="Prescribes" value={account.prescriptionDate ? formatDate(account.prescriptionDate) : null} />
        <Field label="Diary date" value={account.diaryDate ? formatDate(account.diaryDate) : null} />
        <Field label="Last action" value={account.lastActionAt ? formatDate(account.lastActionAt) : null} />
        <Field label="Last contact by" value={account.lastContactMethod} />
        <Field label="Client liaison" value={clientLiaisonName} />
        <Field label="Written off" value={account.writeOffReason} />
      </div>
    </Card>
  )
}

/**
 * Transactions: every movement, in date order, with a running balance.
 *
 * This is the document a debtor is entitled to and a client asks for when they query a figure.
 * Deliberately plain — printable as it stands, no colour carrying meaning that would be lost in
 * black and white.
 */
function StatementTable({ statement, account, breakdown }: {
  statement: StatementLine[]
  account: DebtorAccount
  breakdown: BalanceBreakdown | undefined
}) {
  if (statement.length === 0) return <p className="text-sm text-slate-400 py-6 text-center">Nothing has happened on this account.</p>
  return (
    <>
      <div className="flex items-center justify-between mb-3 print:hidden">
        <p className="text-xs text-slate-400">
          {statement.length} movements. Every line traces to a payment, a fee or an accrual.
        </p>
        <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
          <Printer size={13} /> Print
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Statement for account {account.accountNumber}</caption>
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-200">
              <th className="text-left px-3 py-2 font-medium">Date</th>
              <th className="text-left px-3 py-2 font-medium">Detail</th>
              <th className="text-right px-3 py-2 font-medium">Debit</th>
              <th className="text-right px-3 py-2 font-medium">Credit</th>
              <th className="text-right px-3 py-2 font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {statement.map((l, i) => (
              <tr key={i} className="border-b border-slate-50 last:border-0">
                <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{formatDate(l.date)}</td>
                <td className={`px-3 py-1.5 ${l.kind === 'payment' ? 'text-positive-700' : 'text-slate-700'}`}>
                  {l.description}
                  {l.kind === 'interest-accruing' && (
                    <span className="block text-[11px] text-slate-400">
                      Running since the last monthly posting. It will be charged as part of this month.
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{l.debit ? formatMoney(l.debit) : ''}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-positive-700">{l.credit ? formatMoney(l.credit) : ''}</td>
                <td className="px-3 py-1.5 text-right tabular-nums font-medium text-slate-900">{formatMoney(l.balance)}</td>
              </tr>
            ))}
          </tbody>

          {/*
            The settlement quotation, below the movements and ruled off from them.
            It belongs here because it is the number anybody reading this actually wants — what it
            takes to close the account today. It is NOT a movement: the receipt fee on a settlement
            is only incurred if the settlement is paid, so putting it in the running balance above
            would charge a fee for a payment nobody has made.
          */}
          {breakdown && breakdown.balance > 0 && (
            <tfoot>
              <tr className="border-t-2 border-slate-200">
                <td className="px-3 pt-3 text-slate-500 text-xs" colSpan={2}>Balance outstanding</td>
                <td colSpan={2} />
                <td className="px-3 pt-3 text-right tabular-nums font-medium text-slate-900">{formatMoney(breakdown.balance)}</td>
              </tr>
              <tr>
                <td className="px-3 py-1 text-slate-500 text-xs" colSpan={2}>
                  Receipt fee on settlement
                  <span className="block text-[11px] text-slate-400">
                    {breakdown.cappedBy === 'in duplum' && breakdown.settlementFee === 0
                      ? 'Nil \u2014 in duplum leaves no room for it. The ceiling is the whole of what is owed.'
                      : '10% of the balance, capped, plus VAT \u2014 charged only when the settlement is received'}
                  </span>
                </td>
                <td colSpan={2} />
                <td className="px-3 py-1 text-right tabular-nums text-slate-700">{formatMoney(breakdown.settlementFee)}</td>
              </tr>
              <tr className="border-t border-slate-200">
                <td className="px-3 pt-2 font-semibold text-slate-900" colSpan={2}>To settle in full today</td>
                <td colSpan={2} />
                <td className="px-3 pt-2 text-right tabular-nums font-semibold text-navy-950">{formatMoney(breakdown.settlement)}</td>
              </tr>
              {/*
                VAT is a component of the figures above, not an addition to them, so it sits under
                the total rather than in the running balance. Capital carries none — we did not
                sell the debtor anything — and neither does interest; the tax is on our fees and
                on the receipt fee, both of which are charged VAT-inclusive.
              */}
              <tr>
                <td className="px-3 pb-3 text-[11px] text-slate-400" colSpan={2}>
                  Included in the above: VAT at 15% on fees and receipt fees
                </td>
                <td colSpan={2} />
                <td className="px-3 pb-3 text-right tabular-nums text-[11px] text-slate-500">
                  {formatMoney(breakdown.vat + (breakdown.settlementFee - breakdown.settlementFee / 1.15))}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {breakdown && breakdown.balance > 0 && (
        <p className="text-[11px] text-slate-400 mt-3">
          Quoted as at {formatDate(TODAY)}. Interest continues to run, so a settlement paid later
          will differ.
        </p>
      )}
    </>
  )
}

/**
 * The address a notice is posted to.
 *
 * THE PRIMARY ONE, AND NEVER A RETIRED ONE. `retiredAt` is set when somebody established the
 * debtor no longer lives there — posting a statutory demand to an address known to be wrong is
 * worse than posting none, because it looks served. Where nothing is marked primary the first
 * live address is used, which is the order they were captured in.
 *
 * Returned as typed, on its own lines, because that is how {{debtor_address}} is merged and how
 * an address is written on a page.
 */
function addressOf(contacts: AccountContact[]): string | null {
  const live = contacts.filter((c) => c.kind === 'address' && !c.retiredAt)
  const pick = live.find((c) => c.isPrimary) ?? live[0]
  return (pick?.value ?? '').trim() || null
}
