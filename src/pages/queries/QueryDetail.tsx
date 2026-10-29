import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Building2, Download, Loader2, Upload } from 'lucide-react'
import { Card, CardHeader } from '../../components/ui/Card'
import { useAuth } from '../../store/AuthContext'
import { useAppStore } from '../../store/AppStore'
import { formatDate } from '../../data/mockData'
import {
  ageInDays, closeQuery, fetchQuery, fetchTicketStages, isStale, stageLine, updateQuery,
  QUERY_OUTCOME_LABEL, QUERY_STAGE_LABEL,
  type QueryStage, type QueryOutcome, type QueryEffect,
  ticketLabel,
} from '../../lib/accountQueries'
/* The kind's own words, from the file that OWNS the dispute vocabulary rather than through the
   module that re-exports the queries half of it. */
import { ESCALATION_KINDS, escalationCard } from '../../lib/disputeCategories'
import {
  canGiveFeedback, canSendBack, feedbackNote, nextAction, referNote, referTargets, sendBackNote, ticketThread,
} from '../../lib/ticketThread.ts'
import { fetchPortalContacts, type PortalContact } from '../../lib/portalStaffApi'
import { TicketThread } from '../../components/queries/TicketThread'
import {
  acceptDraftRow, approveDraft, clearDraftRowDecision, discardDraft, fetchDraft,
  fetchDraftForHandover, followUpDraft, rejectDraftRow, setDraftRowValue,
  startFollowUpDraft, updateDraftRow,
  type JudgedDraft,
} from '../../lib/handoverDraft'
import { DraftTable } from '../../components/settings/HandoverImportCard'
import { fetchClientCommission } from '../../lib/accountBook'
import { HANDOVER_COLUMNS } from '../../lib/handoverSheet.ts'
import { givenFor } from '../../lib/importCorrections.ts'
import { ReplyAnswers } from '../../components/queries/ReplyAnswers'
import { TicketWork } from '../../components/queries/TicketWork'
import { SendBack } from '../../components/queries/SendBack'
import { CloseForm } from '../accounts/QueryPanel'
import { formatWorkingTime, ticketTimes, type StageMark } from '../../lib/ticketClock'
import { clockNow } from '../../lib/clock'
import { addNote, fetchQueryNotes, type AccountNote } from '../../lib/accountWorkspace'
import { ComposeEmailModal } from '../../components/ComposeEmailModal'
import {
  fetchQueryEmails, markRepliesRead, markRepliesUnread, recordSentEmail, recordSheetTicketEmail, type AccountEmail,
} from '../../lib/accountEmails'
import {
  EMAIL_IN_KIND, EMAIL_OUT_KIND, forwardBody, forwardSubject, recipientLine, replyAllTo, replySubject,
} from '../../lib/emailRules.ts'
import { RecordTabs } from '../../components/record/RecordShell'
import { EmailsPanel } from '../accounts/EmailsPanel'
import { sheetTicketBody, sheetTicketSubject, ticketBody, ticketSubject } from '../../lib/ticketEmail.ts'
import { canSendToClient } from '../../lib/disputeCategories.ts'
import { canViewClients } from '../../lib/permissions.ts'
import { fetchAccounts } from '../../lib/accountBook'
import { rejectedSheetName, rejectedSheetRows } from '../../lib/rejectedSheet.ts'
import { firmToday } from '../../lib/dateLabels'
import { buildXlsx, downloadBytes, XLSX_MIME } from '../../lib/xlsxWrite.ts'

/* SAST, not UTC: a follow-up import approved here dates its accounts' handover today (prompt 11). */
const TODAY = () => firmToday()

/*
 * TABS ON A TICKET, LIKE THE CLIENT'S OWN PAGE (S14). The firm, holding the two side by side: "make the
 * dispute ticket look a little bit more like this" -- Overview, then Emails and Notes with their counts.
 * Overview keeps the work and the whole conversation, which the firm likes; Emails is every message on
 * the ticket with Reply, Reply all and Forward on each ("respond to a specific email from a client");
 * Notes is what people wrote and rang about it. Account tickets only: a handover-sheet ticket has no
 * account, and so no mail of its own to list.
 */
type TicketTab = 'Overview' | 'Emails' | 'Notes'
/* Notes that are an email's own record are the Emails tab's; Raptor's stage lines are the conversation's. */
const isPersonNote = (n: AccountNote) => n.source !== 'system' && n.kind !== EMAIL_OUT_KIND && n.kind !== EMAIL_IN_KIND

const STAGE_CHIP: Record<QueryStage, string> = {
  agent: 'bg-slate-100 text-slate-600',
  team_leader: 'bg-navy-700/[0.07] text-[var(--c-steel-deep)]',
  liaison: 'bg-navy-700/10 text-navy-700',
  client: 'bg-gold-100 text-[var(--c-gold-deep)]',
}

const label = (key: string) => HANDOVER_COLUMNS.find((c) => c.key === key)?.label ?? key

/**
 * One query, on its own page.
 *
 * THE FIRM: "a query should have a card, like the same as a deal, with the details of the query on
 * the inside ... if you click on that little query for this date's handover sheet, then it goes
 * in there."
 *
 * Until now a query had no page at all: the board and the client list both opened the ACCOUNT,
 * which answers a different question -- and for a query about a whole handover sheet it cannot
 * answer it, because there is no one account to open.
 *
 * THE DETAIL IS READ BACK, NOT STORED. For an import query the rows come off the frozen draft the
 * batch was imported from, re-judged by the same planner. That is deliberate: a description
 * copied onto the query at approval would be true on the day and slowly stop being true, while
 * the draft IS the record of what the client sent and what was corrected on the way in. One
 * record, read two ways.
 */
export function QueryDetail() {
  const { id } = useParams<{ id: string }>()
  const { currentUser, session } = useAuth()
  /* Only to put a NAME on the owner. The ticket stores an id, and "With f1a187f8-…" is not a thing
     to show somebody who wants to know whether it is still sitting with the liaison. */
  const { users, addActivity } = useAppStore()
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchQuery>>>(null)
  const [draft, setDraft] = useState<JudgedDraft | null>(null)
  /**
   * The client's own reference to the account it opened.
   *
   * READ OFF THE BOOK, not off the draft: the draft says what was sent, and an answer has to be
   * written to the account that actually exists. A row that opened none is absent here, which is
   * exactly what tells the screen it has nowhere to put that answer.
   */
  const [openedFor, setOpenedFor] = useState<Map<string, string>>(new Map())
  /**
   * The second go at the rows that could not be opened.
   *
   * THE FIRM: "this ticket for a handover that is in an awaiting state should show all of the
   * details like it's ready for an import, and when the details is changed it can be approved
   * and imported." A NEW draft, never the frozen original -- see startFollowUpDraft.
   */
  const [followUp, setFollowUp] = useState<JudgedDraft | null>(null)
  const [imported, setImported] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [resolving, setResolving] = useState(false)
  /**
   * THE MAIL FILED AGAINST THIS TICKET, and the one being passed on.
   *
   * THE FIRM: "can me, as a client liaison, for example, Stefan, or Nicole, forward that email
   * just like that to the client?" The email has been filed here since the button existed and
   * nothing ever read it back — see TicketEmails.
   */
  const [emails, setEmails] = useState<AccountEmail[]>([])
  const [forwarding, setForwarding] = useState<AccountEmail | null>(null)
  /**
   * THE TICKET'S OWN THREAD, and a fresh message to the client.
   *
   * `notes` is every account note carrying this query's id — which is what every stage change,
   * every outcome and now every note written here already writes. `writing` is the compose box
   * opened from scratch rather than onto an existing message; `forwarding` above is the other
   * half, and they share one modal because they produce the same record.
   */
  const [notes, setNotes] = useState<AccountNote[]>([])
  /* S14: the ticket's stage history, which its clock is read off (ticketClock.ts). */
  const [stages, setStages] = useState<StageMark[]>([])
  const [writing, setWriting] = useState(false)
  /* The message being ANSWERED (S14), and who else is copied on a reply-all. Threaded, unlike a forward. */
  const [replyTo, setReplyTo] = useState<AccountEmail | null>(null)
  const [replyCc, setReplyCc] = useState('')
  const [tab, setTab] = useState<TicketTab>('Overview')
  const [noteDraft, setNoteDraft] = useState('')
  /* Whether the signed-in person has a mailbox at all. Mail goes out through their OWN, so the
     button says why it is disabled rather than failing on Send. Null while we are asking. */
  const [mailbox, setMailbox] = useState<string | null>(null)
  /*
   * WHO AT THE CLIENT MAY SIGN IN TO THE PORTAL (S15). Their addresses are the client's -- a reply goes to
   * them like to any person at the client -- and whether there are any decides whether the reply carries
   * the portal link. Read through the portal's staff route: the table has no policies.
   */
  const [portalPeople, setPortalPeople] = useState<PortalContact[]>([])
  /* Who a referral goes to, when there is more than one to choose from (S15). */
  const [referTo, setReferTo] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true); setError(null)
    try {
      const found = await fetchQuery(id)
      setData(found)
      /* Never fatal, and only for somebody who may write to the client -- the route refuses everybody else. */
      if (found?.mainClientId && canSendToClient(currentUser?.role)) {
        fetchPortalContacts(found.mainClientId).then(setPortalPeople).catch(() => setPortalPeople([]))
      }
      /*
       * NEVER FATAL. A ticket whose correspondence cannot be read is still a ticket somebody has
       * to work — the description, the owner and the chase date are all on the row itself. An
       * empty list simply hides the card.
       */
      setEmails(await fetchQueryEmails(id).catch(() => []))
      /* NEVER FATAL, for the same reason as the mail above: a thread that will not load leaves a
         ticket somebody can still work from the row itself. */
      setNotes(await fetchQueryNotes(id).catch(() => []))
      /* Never fatal: no history reads as one stretch with us, which is what is known. */
      setStages(await fetchTicketStages(id).catch(() => []))
      /*
       * Only for a batch, and never fatal. A draft that has been tidied away leaves the query
       * readable rather than the page broken -- the query's own words still say what it is about.
       */
      if (found?.batch) {
        setDraft(await fetchDraftForHandover(found.batch.id, TODAY()).catch(() => null))
        /* The whole batch in one page: a handover is hundreds at the most, and a second page
           here would mean an answer silently having nowhere to go. */
        /* The rows themselves are the answer here; nothing draws a total. */
        const opened = await fetchAccounts({ handoverId: found.batch.id, pageSize: 2000, countRows: false })
          .catch(() => ({ accounts: [], total: 0 }))
        setOpenedFor(new Map(opened.accounts
          .filter((a) => a.clientReference)
          .map((a) => [a.clientReference as string, a.id])))
        /* Read, never raised: opening a ticket must not create anything. The button does that. */
        setFollowUp(await followUpDraft(found.query.id, TODAY()).catch(() => null))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { void load() }, [load])

  /*
   * CAN THIS PERSON SEND ANYTHING? Asked once, up front, so the Forward button can say why it is
   * disabled instead of letting somebody write a covering note and fail on Send. The same question
   * the account page asks, for the same reason.
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
      .catch(() => { /* a status we could not read just leaves the button disabled. */ })
    return () => { cancelled = true }
  }, [session])

  /*
   * THE SAME HANDLERS THE IMPORT SCREEN USES, against the same library functions. The table is
   * shared; wiring it to a second set of writes here is how the two screens would come to mean
   * different things by the same button.
   *
   * Every one re-reads the draft afterwards rather than patching state: the verdict on a row is
   * never stored, it is recomputed from the values, so a screen that edited its own copy would
   * show a row still refused for something already fixed.
   */
  const reload = useCallback(async (draftId: string) => {
    setFollowUp(await fetchDraft(draftId, TODAY()))
  }, [])

  async function raiseFollowUp() {
    if (!data?.batch) return
    setBusy(true); setError(null)
    try {
      setFollowUp(await startFollowUpDraft({
        queryId: data.query.id, handoverId: data.batch.id, today: TODAY(),
      }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  async function importFollowUp() {
    if (!followUp) return
    setBusy(true); setError(null)
    try {
      const commission = await fetchClientCommission(followUp.draft.companyId).catch(() => null)
      const result = await approveDraft({
        draftId: followUp.draft.id,
        today: TODAY(),
        /* THE CLIENT'S RATE, read fresh rather than off a row in memory: commission is the
           client's, and a stale copy of it is an account invoiced at the wrong rate for life. */
        commission,
        accessToken: session?.access_token ?? null,
      })
      setImported(`${result.created} accounts opened.`
        + (result.leftBehind ? ` ${result.leftBehind} left behind.` : '')
        + (result.correctionProblems.length ? ` ${result.correctionProblems.join(' ')}` : ''))
      setFollowUp(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  /*
   * RESOLVED, WITH ITS REAL OUTCOME (S14). The two buttons here were "The client has answered" and
   * "Close without an answer", and both CLOSED the ticket -- the first as 'valid', which on a dispute
   * means UPHELD and lets the account's sequences resume. The firm: "there could be multiple
   * communications regarding a specific dispute". A client's reply now brings the ticket back to the
   * liaison and leaves it open (ticket_client_replied, in the database); it ends only here, through
   * the account panel's own outcome form, which asks what the outcome was and what happens to the
   * account.
   */
  async function resolve(outcome: QueryOutcome, action: string, amount: number | null, effect: QueryEffect | null) {
    if (!data) return
    setBusy(true); setError(null)
    try {
      await closeQuery(data.query.id, { outcome, action, amount, effect }, {
        accountId: data.query.accountId,
        actorId: currentUser?.id ?? null,
        actorName: currentUser?.name ?? null,
      })
      setResolving(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  if (loading) {
    return <div className="py-16 grid place-items-center text-slate-400"><Loader2 size={20} className="animate-spin" /></div>
  }
  if (!data) {
    return <Card><p className="text-sm text-slate-500">That query is no longer there.</p></Card>
  }

  const q = data.query
  const stale = isStale(q, TODAY())
  /*
   * THE TWO GROUPS THE EMAIL USES, AND THE SAME WORDS. A client holding the email and a liaison
   * holding this page have to be able to talk to each other about the same rows, so "not brought
   * in" means the same thing in both places.
   */
  const rows = draft?.rows ?? []
  const notBroughtIn = rows.filter((r) => (r.excluded || r.planned?.refused)
    && (r.planned?.problems.length ?? 0) > 0)
  const toConfirm = rows.filter((r) => !r.excluded && !r.planned?.refused
    && (r.planned?.problems.length ?? 0) > 0)

  /*
   * WHO MAY PUT THIS IN FRONT OF A CLIENT, and it is not a new rule invented here.
   *
   * `canSendToClient` already decides it everywhere else on a query, and its own note says why a
   * collections agent is not on the list: "a collections agent should not be writing to a client
   * about a disputed account on their own initiative — that is the liaison's relationship to
   * manage." The firm named the same people asking for this: "can me, as a client liaison, for
   * example, Stefan, or Nicole, forward that email just like that to the client?"
   *
   * AND A MAILBOX, because the message goes out through the sender's OWN. Two different reasons
   * to be unable to press it, each with its own sentence — a button disabled without saying which
   * is a button people ask about rather than fix.
   */
  const ownerName = data?.query.ownerId
    ? (users.find((u) => u.id === data.query.ownerId)?.name ?? 'Somebody who has left')
    : null
  const mayWriteToClient = canSendToClient(currentUser?.role)
  /*
   * TWO DIFFERENT REASONS TO BE UNABLE TO PRESS SOMETHING, AND THEY ARE NOT THE SAME REASON.
   *
   * THE FIRM: "the debt collector has viewing options and it can view, but it cannot, for example,
   * send an email to the client, it doesn't have that permissions. However, the liaison can do
   * anything within the ticket."
   *
   * MAY NOT is about the role and covers everything that reaches the client — a call as much as an
   * email. CANNOT YET is about a mailbox and covers only the email. Collapsed into one sentence,
   * a collector was told to go and connect a mailbox for a thing they would still not be allowed
   * to do, which is a sentence that sends somebody to Settings for nothing.
   */
  const clientWhy = mayWriteToClient
    ? null
    /* THE PANEL'S SECOND LINE already says what they CAN do, in better words. Saying it here
       too put "You can still add a note" on the screen twice, an inch apart. */
    : 'Only a liaison or a manager deals with the client on a ticket.'
  const forwardWhy = clientWhy
    ?? (!mailbox ? 'Connect your mailbox in Settings before you can send anything.' : null)
  const activePortal = portalPeople.filter((p) => p.active)
  /* The portal's people join the client's list for the picker, after the company's own people. */
  const recipients = [
    ...data.clientPeople,
    ...activePortal.filter((p) => !data.clientPeople.some((c) => c.email === p.email.toLowerCase()))
      .map((p) => ({ email: p.email.toLowerCase(), label: `${p.name || p.email} \u00b7 client portal` })),
  ]
  const clientAddresses = [data.clientEmail, ...recipients.map((person) => person.email)]
    .filter((a): a is string => !!a)
  /*
   * THE PORTAL LINE ON A REPLY (S15). Stephan: "respond on a ticket and it can notify the client via email
   * and say there's been a response, click here to view ... If they want to work inside the app, it lives
   * inside the app. If they want to work on emails, it goes to the emails." So the reply is the email --
   * whole, for the client who works in email -- and it ends with the way into the portal for the one who
   * works there. Only where somebody at the client can sign in: a link to a door they have no key to is noise.
   */
  const portalLine = activePortal.length > 0 && q.accountId
    ? `\n\nYou can also read this and answer it in your client portal: ${window.location.origin}/portal (ticket ${ticketLabel(q)}).`
    : ''
  /* THE ONE REPLY: to whoever at the client last wrote on this ticket, threaded under their message;
     to the client's own address where nobody has. */
  function replyOnTicket() {
    const lastFromClient = emails
      .filter((e) => e.direction === 'in' && (e.correspondent === 'client'
        || clientAddresses.some((a) => a.trim().toLowerCase() === e.debtorAddress.trim().toLowerCase())))
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0]
    if (lastFromClient) startReply(lastFromClient, false)
    else { setReplyTo(null); setForwarding(null); setWriting(true) }
  }
  function replyHintTo(): string {
    const last = emails.filter((e) => e.direction === 'in' && e.correspondent === 'client')
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0]
    return last?.sentByName ?? last?.debtorAddress ?? data?.clientContact ?? data?.clientName ?? 'the client'
  }
  const agentId = data.account?.assignedTo ?? null
  const targets = q.status !== 'closed' && q.accountId && (q.stage === 'liaison' || q.stage === 'team_leader')
    ? referTargets({ agentId, actorId: currentUser?.id, users }) : []
  const target = targets.find((t) => t.id === referTo) ?? targets[0] ?? null
  const liaisonName = data.liaisonId ? (users.find((u) => u.id === data.liaisonId)?.name ?? null) : null
  const personNotes = notes.filter(isPersonNote)
  function startReply(email: AccountEmail, all: boolean) {
    setForwarding(null); setWriting(false)
    setReplyTo(email)
    if (all) {
      const { cc } = replyAllTo({
        from: { name: email.sentByName, address: email.debtorAddress },
        to: email.toRecipients, cc: email.ccRecipients,
        /* Never copied back to ourselves -- see replyAllTo. */
        mine: [email.ourAddress, mailbox, currentUser?.email].filter((a): a is string => !!a),
      })
      setReplyCc(recipientLine(cc))
    } else setReplyCc('')
  }

  return (
    <div className="space-y-4">
      {/*
        BACK WHERE YOU CAME FROM, AND THE CLIENT BESIDE IT.

        THE FIRM: "there should also be an option on the ticket file to go to the client folder,
        the client's particulars and stuff."

        TWO LINKS, NOT ONE RELABELLED. On an account ticket the back link goes to the ACCOUNT --
        that is the debtor whose dispute this is, and it is where the ledger, the correspondence
        and the workflow are. The client is a second place worth reaching, not the same place: a
        liaison about to write to them needs the contact, the mandate and the commission rate, and
        finding it meant going out to Clients and searching by name.

        AND IT IS ONLY OFFERED TO SOMEBODY WHO MAY LOOK. `client.view` is a capability, and a
        pre-legal agent does not have it -- they work debtors, not the firm's relationships. A link
        that 404s on a permission is worse than no link.
      */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <Link to={data.batch ? `/companies/${data.batch.companyId}` : `/accounts/${q.accountId}`}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft size={14} />
          {data.batch ? (data.clientName ?? 'Back') : (data.account?.debtorName ?? 'Back to the account')}
        </Link>
        {!data.batch && data.account && canViewClients(currentUser) && (
          <Link to={`/companies/${data.account.companyId}`}
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
            <Building2 size={14} />
            {data.clientName ?? 'The client'}
          </Link>
        )}
      </div>

      {/*
        THE TICKET SAYS WHAT IT IS AND WHERE IT STANDS, BEFORE ANYTHING ELSE.
        ---------------------------------------------------------------------
        THE FIRM, showing a design of what a dispute ticket should look like: a band across the top
        carrying the reference, the debtor, the account, the state, who owns it and when it comes
        back.

        EVERY ONE OF THOSE WAS ALREADY ON THE PAGE AND NONE OF THEM WAS AT THE TOP. The state was a
        chip beside a title, the owner and the follow-up were in a rail two thirds of the way down,
        and the account number was a subtitle. Somebody opening a ticket at nine in the morning
        asks four questions -- whose, what, where has it got to, when does it come back -- and had
        to look in four places for them.

        DARK, LIKE THE ACCOUNT'S OWN HERO, because it is doing the same job: this is the one band on
        the screen that is about the thing itself rather than about the work on it.

        ON AN ACCOUNT TICKET ONLY. A batch ticket is about a client's spreadsheet -- it has no
        debtor, no account number and no account to work -- and a band of blanks reads as a screen
        that failed to load.
      */}
      {q.accountId && (
        <div className="rounded-2xl bg-navy-950 text-white px-4 py-3.5 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
            <div className="min-w-0">
              {/*
                WHAT KIND OF TICKET, rather than a number.
                
                THE FIRM'S DESIGN SHOWED A REFERENCE -- "DSP-00428" -- AND RAPTOR HAD NONE; a UUID is
                not something anybody reads out on a telephone. S14 made the real thing: a sequence
                and a migration (ticket_numbers), T-1001 onwards, one series for every kind. It is
                printed beside what the ticket IS, and the client is asked to quote it.
              */}
              <p className="text-[11px] uppercase tracking-wide text-white/50">
                <span className="font-mono font-semibold text-white/80" data-testid="ticket-number">{ticketLabel(q)}</span>
                {' · '}{escalationCard(q.kind).label}
              </p>
              <h1 className="text-lg sm:text-xl font-semibold mt-0.5 wrap-anywhere">
                {q.category || q.requestFor || ESCALATION_KINDS[q.kind ?? 'dispute'].label}
              </h1>
              {/* THE ACCOUNT, ONE PRESS AWAY (S15). Stephan: "click on the reference number and it goes to the
                  account." Our case number first -- the one every notice quotes -- then theirs. */}
              <p className="text-sm text-white/70 mt-0.5 wrap-anywhere">
                {data.account ? (
                  <Link to={`/accounts/${data.account.id}`} data-testid="ticket-account-link"
                    className="text-white hover:underline underline-offset-4 decoration-white/40">
                    {data.account.caseNumber && <span className="font-mono text-gold-400 mr-1.5">{data.account.caseNumber}</span>}
                    {data.account.debtorName}
                  </Link>
                ) : 'An account'}
                {data.account?.accountNumber ? ` · ${data.account.accountNumber}` : ''}
              </p>
            </div>
            <dl className="flex flex-wrap items-start gap-x-6 gap-y-2">
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-white/50">Where it stands</dt>
                <dd className="text-sm font-medium mt-0.5">
                  {q.status === 'closed'
                    ? (q.outcome ? QUERY_OUTCOME_LABEL[q.outcome] : 'Closed')
                    : stageLine({ stage: q.stage, chaseOn: q.chaseOn }).label}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-white/50">With</dt>
                <dd className="text-sm font-medium mt-0.5">{ownerName ?? 'Nobody yet'}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-white/50">Follow up</dt>
                {/* THE ONE FIGURE HERE THAT CAN BE WRONG RATHER THAN MERELY OLD, so it is the one
                    that gets a colour -- the same rule the rail below has always followed. */}
                <dd className={`text-sm font-medium mt-0.5 ${stale ? 'text-gold-300' : ''}`}>
                  {q.chaseOn ? formatDate(q.chaseOn) : 'Not booked'}
                </dd>
              </div>
            </dl>
          </div>
          {/*
            AND WHAT TO DO NEXT, WHICH IS THE QUESTION THE BAND ABOVE ONLY ANSWERS HALFWAY.
            
            THE FIRM'S DESIGN PUTS IT ABOVE THE CONVERSATION -- "Next action: ask client to verify
            payment". Composed from the stage, which is the one field that already means this, so
            the imperative here and the board's reading of the same ticket cannot disagree.
          */}
          {nextAction({ stage: q.stage, status: q.status }) && (
            <p className="text-sm text-gold-300 mt-3 pt-3 border-t border-white/10">
              <span className="font-medium">Next:</span>{' '}
              {nextAction({ stage: q.stage, status: q.status })}
            </p>
          )}
        </div>
      )}

      <Card>
        <CardHeader
          title={data.batch
            ? (data.batch.reference ?? 'One handover sheet')
            : `Query on ${data.account?.debtorName ?? 'an account'}`}
          subtitle={data.batch
            ? `Handover brought in ${formatDate(data.batch.receivedAt)}${data.clientName ? ` for ${data.clientName}` : ''}.`
            : data.account?.accountNumber ?? undefined}
          action={
            <span className={`text-[11px] px-2 py-1 rounded ${
              q.status === 'closed' ? 'bg-slate-100 text-slate-500' : STAGE_CHIP[q.stage]}`}>
              {q.status === 'closed'
                ? (q.outcome ? QUERY_OUTCOME_LABEL[q.outcome] : 'Closed')
                : QUERY_STAGE_LABEL[q.stage]}
            </span>
          }
        />

        <p className="text-sm text-slate-700 whitespace-pre-wrap wrap-anywhere mt-3">{q.description}</p>

        {/* ON A BATCH ONLY. An account ticket carries these in the rail beside it — see below;
            drawn in both places they would be the same four figures twice on one screen. */}
        {!q.accountId && (
          <dl className="grid gap-3 mt-4 sm:grid-cols-3">
            <Fact label="Raised" value={`${formatDate(q.raisedAt)}${q.raisedByName ? ` by ${q.raisedByName}` : ''}`} />
            <Fact label={q.status === 'closed' ? 'Closed' : 'Age'}
              value={q.status === 'closed' ? formatDate(q.closedAt ?? q.raisedAt) : `${ageInDays(q)} days`} />
            <Fact label="Chase" tone={stale ? 'bad' : undefined}
              value={q.chaseOn ? formatDate(q.chaseOn) : 'Not set'} />
          </dl>
        )}

        {error && <p className="text-sm text-negative-700 mt-3">{error}</p>}

        {q.status !== 'closed' && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            {resolving ? (
              <CloseForm busy={busy} onCancel={() => setResolving(false)}
                onClose={(outcome, action, amount, effect) => { void resolve(outcome, action, amount, effect) }} />
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" disabled={busy} onClick={() => setResolving(true)} data-testid="ticket-resolve"
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-gold-400 text-navy-950 border border-gold-500 disabled:opacity-50">
                  Resolve…
                </button>
                <span className="text-xs text-slate-500">
                  Open until it is resolved. Every email in and out stays on this ticket, and a reply from the client brings it back to you.
                </span>
              </div>
            )}
          </div>
        )}
      </Card>

      {/*
        THE PAGE HAS A SHAPE NOW, AND ONLY ON A TICKET ABOUT AN ACCOUNT.
        ----------------------------------------------------------------
        THE FIRM: "we need to design a ticket pane. It looks shit currently."

        It was one narrow column of cards down the left of a wide screen, because every card was
        full width whether it had a paragraph in it or three words. The work gets two thirds and
        the facts about the ticket get one, which is the same proportion the account's own Wide
        arrangement uses and for the same reason: the column you came to work in should look like
        it.

        NOT ON A BATCH TICKET. Those carry tables of every row a client's sheet could not open,
        running to hundreds, and two thirds of the width is where a reference and seven columns
        stop fitting. A batch keeps the full measure it has always had.
      */}
      {/*
        A SHEET TICKET HAS EMAILS TOO (S15). Stephan: a handover-sheet ticket sends and receives email,
        not charged. So the strip is on every ticket; a sheet ticket has no Notes tab because a note is
        filed on an account's timeline and a sheet has none.
      */}
      <RecordTabs<TicketTab>
        tabs={[
          { id: 'Overview', label: 'Overview' },
          /* The dot: a message in from the client or the debtor that nobody has opened yet. */
          { id: 'Emails', label: 'Emails', count: emails.length, alert: emails.some((e) => e.direction === 'in' && !e.readAt) },
          ...(q.accountId ? [{ id: 'Notes' as TicketTab, label: 'Notes', count: personNotes.length }] : []),
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'Overview' && (
      <div className={q.accountId ? 'grid gap-4 items-start lg:grid-cols-3' : 'contents'}>
      <div className={q.accountId ? 'space-y-4 lg:col-span-2' : 'contents'}>

      {/*
        THE WORK, DIRECTLY UNDER THE TICKET IT IS ABOUT.
        ------------------------------------------------
        THE FIRM: "there needs to be options... it should already be able to draft an email for the
        client. There should also be an option to call the client just from the ticket. Make notes
        on the ticket, and the notes should also live in the client section and on the ticket."

        ONLY ON A TICKET ABOUT AN ACCOUNT. A batch ticket is about a client's own spreadsheet and
        has no account to file a note against — `addNote` is per account and a sheet is not one.
        Its record is the ticket itself and the rows below, which is why it has a page of its own.
        Absent rather than disabled: a panel of controls that all refuse reads as a fault.
      */}
      {canSendBack(q, currentUser?.id) && (
        <SendBack
          toName={q.raisedByName}
          busy={busy}
          onSend={async (question) => {
            setError(null)
            try {
              await updateQuery(q.id, { ownerId: q.raisedBy, stage: 'agent' }, {
                accountId: q.accountId,
                actorId: currentUser?.id ?? null,
                actorName: currentUser?.name ?? null,
                note: sendBackNote(q.raisedByName, question),
                debtorName: data.account?.debtorName ?? null,
                bell: `${currentUser?.name ?? 'The team leader'} sent back${data.account?.debtorName ? ` ${data.account.debtorName}` : ' a ticket'} with a question for you.`,
              })
              await load()
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
      )}

      {q.accountId && (
        <TicketWork
          canReachClient={mayWriteToClient}
          canEmail={forwardWhy === null}
          clientWhy={clientWhy}
          emailWhy={forwardWhy}
          busy={busy}
          onEmail={() => setWriting(true)}
          onNote={async (body) => {
            await addNote({
              accountId: q.accountId as string,
              body,
              authorName: currentUser?.name ?? null,
              createdBy: currentUser?.id ?? null,
              /* THE ONE FIELD THAT PUTS IT IN BOTH PLACES AT ONCE — the firm's "it should live in
                 the client section and on the ticket" is this, and it has been here all along. */
              queryId: q.id,
              kind: 'note',
            })
            setNotes(await fetchQueryNotes(q.id).catch(() => notes))
          }}
          onCall={async (who, said) => {
            await addNote({
              accountId: q.accountId as string,
              /* WHO WAS SPOKEN TO IS PART OF THE RECORD, not a separate column: six months later
                 the question is "who at the client said that", and a note that cannot answer it is
                 a note nobody can rely on. Folded into the sentence so it survives being read on
                 the account's timeline, where there is no ticket around it to explain. */
              body: who ? `Called ${who}. ${said}` : `Called the client. ${said}`,
              authorName: currentUser?.name ?? null,
              createdBy: currentUser?.id ?? null,
              queryId: q.id,
              kind: 'call',
            })
            setNotes(await fetchQueryNotes(q.id).catch(() => notes))
          }}
        />
      )}

      {/*
        AND THE WHOLE CONVERSATION UNDER IT, as ONE list.
        -------------------------------------------------
        THE FIRM, showing a design of what a dispute ticket should look like: the internal note, the
        client's email and the debtor's own words one under the other, each labelled with who said
        it.

        IT WAS TWO CARDS -- the notes inside TicketWork and the correspondence in TicketEmails --
        so the question a ticket exists to answer, what passed between the three parties and in
        what order, could only be answered by reading two lists and merging them in your head.

        THE VOICE IS DERIVED FROM THE ADDRESS, which is why the client's own people are passed in:
        `account_emails` carries the OTHER party's address whichever end they were on, so "client or
        debtor" is a question only this page can answer. See ticketThread.
      */}
      <TicketThread
        entries={ticketThread({
          notes,
          emails,
          clientAddresses,
        })}
        canForward={forwardWhy === null}
        why={forwardWhy}
        onForward={(emailId) => {
          const found = emails.find((e) => e.id === emailId)
          if (found) { setReplyTo(null); setForwarding(found) }
        }}
        onReply={replyOnTicket}
        replyHint={`Goes to ${replyHintTo()} by email${portalLine ? ', and shows in their client portal' : ''}.`}
      />
      </div>

      {/*
        WHO HAS IT, SINCE WHEN, AND WHEN IT COMES BACK — in a rail rather than in a row under the
        description, which is where they were. Three labels across the foot of a card read as a
        caption on the sentence above them; standing beside it they read as the state of the
        ticket, which is what somebody opening it at nine in the morning is actually asking.
      */}
      {target && (
        <SendBack testId="refer-agent" toName={target.name} busy={busy}
          choices={targets} choice={target.id} onChoice={setReferTo}
          title="Refer it"
          subtitle={`To ${target.name} (${target.rung.toLowerCase()}). Say what the client wants to know -- it goes to their desk, they are told, and their answer comes back to you.`}
          placeholder="The client asks whether the debtor has made an arrangement. What is the latest?"
          button={`Refer to ${target.name}`}
          onSend={async (reason) => {
            setError(null)
            try {
              await updateQuery(q.id, { ownerId: target.id, stage: target.stage }, {
                accountId: q.accountId,
                actorId: currentUser?.id ?? null,
                actorName: currentUser?.name ?? null,
                note: referNote(target.name, reason),
                debtorName: data.account?.debtorName ?? null,
                bell: `${currentUser?.name ?? 'The liaison'} referred${data.account?.debtorName ? ` ${data.account.debtorName}` : ' a ticket'} to you: ${reason.trim().slice(0, 120)}`,
              })
              await load()
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
      )}
      {/* NOT WHERE SEND BACK ALREADY IS: a ticket a clerk raised goes back to the clerk; feedback is for one
          nobody inside raised -- the client's, from the portal -- or one referred down from the liaison. */}
      {canGiveFeedback(q, currentUser?.id, data.liaisonId) && !canSendBack(q, currentUser?.id) && (
        <SendBack testId="agent-feedback" toName={liaisonName} busy={busy}
          title="Give your feedback"
          subtitle={`What you know about this one. It goes back to ${liaisonName ?? 'the liaison'}, who answers the client.`}
          placeholder="Spoke to the debtor today. Promised R500 on the 25th; arrangement captured."
          button={`Send to ${liaisonName ?? 'the liaison'}`}
          onSend={async (feedback) => {
            setError(null)
            try {
              await updateQuery(q.id, { ownerId: data.liaisonId, stage: 'liaison' }, {
                accountId: q.accountId,
                actorId: currentUser?.id ?? null,
                actorName: currentUser?.name ?? null,
                note: feedbackNote(currentUser?.name ?? null, feedback),
                debtorName: data.account?.debtorName ?? null,
                bell: `${currentUser?.name ?? 'The agent'} answered on${data.account?.debtorName ? ` ${data.account.debtorName}` : ' a ticket'}: ${feedback.trim().slice(0, 120)}`,
              })
              await load()
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
      )}

      {q.accountId && (
        <Card>
          <CardHeader title="Where it stands" />
          <dl className="space-y-3 mt-1">
            <Fact label="With" value={ownerName ?? 'Nobody yet'} />
            <Fact label="Raised" value={`${formatDate(q.raisedAt)}${q.raisedByName ? ` by ${q.raisedByName}` : ''}`} />
            <Fact label={q.status === 'closed' ? 'Closed' : 'Age'}
              value={q.status === 'closed' ? formatDate(q.closedAt ?? q.raisedAt) : `${ageInDays(q)} days`} />
            {/*
              WHERE IT STANDS, AND IT IS THE FIRST THING ASKED OF A TICKET.

              THE FIRM: "it says awaiting liaison, but it's actually already been escalated to the
              client. So it should say awaiting client feedback and when to follow up next." This
              rail carried who OWNS it and when it is chased and never which of those two states it
              was in -- so a ticket that had gone to a client read exactly like one that had not.
            */}
            <Fact label="Stage" value={stageLine({ stage: q.stage, chaseOn: q.chaseOn }).label} />
            {/* The chase date is the only thing on this page that can be WRONG rather than merely
                old, so it is the one that gets a colour. */}
            <Fact label="Follow up" tone={stale ? 'bad' : undefined}
              value={q.chaseOn ? formatDate(q.chaseOn) : 'Not booked'} />
            {q.requestFor && <Fact label="Asking for" value={q.requestFor} />}
            {data.clientName && <Fact label="Client" value={data.clientName} />}
          </dl>
        </Card>
      )}
      {/*
        THE TICKET'S CLOCK (S14). The firm: "every query has like a timer on to say how long has it been, how
        long did it take to resolve this" -- and BOTH figures: the time it sat with us, and the whole time it
        was open. Office hours, so a Friday-afternoon ticket answered first thing Monday reads as an hour.
      */}
      {q.accountId && (() => {
        const t = ticketTimes({
          raisedAt: q.raisedAt, closedAt: q.status === 'closed' ? q.closedAt : null, stages,
          firstReplyAt: emails.filter((e) => e.direction === 'out').map((e) => e.occurredAt).sort()[0] ?? null,
        }, clockNow().toISOString())
        return (
          <Card>
            <CardHeader title={t.resolved ? 'How long it took' : 'Clock'} subtitle="Office hours: 08:00–16:30 on working days" />
            <dl className="space-y-3 mt-1" data-testid="ticket-clock">
              <Fact label={t.resolved ? 'Open for' : 'Open'} value={formatWorkingTime(t.open)} />
              <Fact label="With us" value={formatWorkingTime(t.withUs)} />
              <Fact label="With the client" value={formatWorkingTime(t.withClient)} />
              <Fact label="First response" value={t.firstResponse === null ? 'Not yet' : formatWorkingTime(t.firstResponse)} />
            </dl>
          </Card>
        )
      })()}
      </div>
      )}

      {tab === 'Emails' && (
        <div data-testid="ticket-emails">
          <EmailsPanel
            emails={[...emails].reverse()}
            canSend={forwardWhy === null}
            emptyText="No email on this ticket yet."
            onCompose={() => { setReplyTo(null); setForwarding(null); setWriting(true) }}
            onReply={(e) => startReply(e, false)}
            onReplyAll={(e) => startReply(e, true)}
            onForward={(e) => { setReplyTo(null); setForwarding(e) }}
            /* Read FOR EVERYBODY, as on the account: on a ticket unread means nobody has looked. */
            onRead={(e) => {
              setEmails((list) => list.map((x) => (x.id === e.id ? { ...x, readAt: clockNow().toISOString() } : x)))
              void markRepliesRead([e.id])
            }}
            onUnread={(e) => {
              setEmails((list) => list.map((x) => (x.id === e.id ? { ...x, readAt: null } : x)))
              void markRepliesUnread([e.id])
            }}
          />
          {forwardWhy && <p className="mt-2 text-xs text-slate-500">{forwardWhy}</p>}
        </div>
      )}

      {q.accountId && tab === 'Notes' && (
        <Card>
          <CardHeader title="Notes" subtitle="What people wrote and rang about on this ticket, newest first. Each is on the account too." />
          <form className="mt-3 space-y-2" data-testid="ticket-note-form" onSubmit={(e) => {
            e.preventDefault()
            const body = noteDraft.trim()
            if (!body) return
            setBusy(true)
            void addNote({
              accountId: q.accountId as string, body, authorName: currentUser?.name ?? null,
              createdBy: currentUser?.id ?? null, queryId: q.id, kind: 'note',
            })
              .then(() => fetchQueryNotes(q.id)).then((n) => { setNotes(n); setNoteDraft('') })
              .catch((x: unknown) => setError(x instanceof Error ? x.message : String(x)))
              .finally(() => setBusy(false))
          }}>
            <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} rows={3}
              placeholder="Write a note on this ticket…" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            <button type="submit" disabled={busy || !noteDraft.trim()}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-gold-400 text-navy-950 border border-gold-500 disabled:opacity-50">
              Add note
            </button>
          </form>
          {personNotes.length === 0
            ? <p className="text-sm text-slate-400 mt-4">No notes on this ticket yet.</p>
            : (
              <ul className="mt-4 divide-y divide-slate-100" data-testid="ticket-notes">
                {[...personNotes].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((n) => (
                  <li key={n.id} className="py-2.5">
                    <p className="text-[11px] text-slate-400">
                      {n.kind === 'call' ? 'Call · ' : ''}{n.authorName ?? 'Somebody at the firm'} · {formatDate(n.createdAt)}
                    </p>
                    <p className="text-sm text-slate-700 whitespace-pre-wrap wrap-anywhere mt-0.5">{n.body}</p>
                  </li>
                ))}
              </ul>
            )}
        </Card>
      )}

      {data.batch && !draft && (
        <Card><p className="text-sm text-slate-400">
          The sheet this came from is no longer on file, so the rows cannot be listed.
        </p></Card>
      )}

      <RowTable
        title="Not brought in — the client must send these again"
        intro="No account was opened for these, so nothing is being done on them."
        rows={notBroughtIn}
        /*
         * THE SHEET, AGAIN, FROM HERE. THE FIRM: "it should also be in the query ticket, and once
         * the query has been resolved it can be erased."
         *
         * BUILT WHEN IT IS ASKED FOR, never stored. A copy written beside the draft would be a
         * second record of the same thing, would go stale the moment a row was corrected, and
         * would be the thing that has to be erased. Generated from the frozen draft there is
         * nothing to erase and nothing that can disagree with it -- and when the query closes the
         * page stops offering it rather than something having to go and delete a file.
         */
        download={q.status === 'closed' || !draft ? null : () => {
          downloadBytes(
            rejectedSheetName(data.batch?.reference ?? 'handover'),
            buildXlsx('To correct', rejectedSheetRows(notBroughtIn.map((r) => ({
              values: r.values, problems: r.planned?.problems ?? [],
            })))),
            XLSX_MIME,
          )
        }} />
      <RowTable
        title="Brought in, but the client must confirm"
        intro="These are open and being worked while we wait."
        rows={toConfirm} />

      {/*
        THE SECOND GO, IN THE TICKET. THE FIRM: "this ticket for a handover that is in an awaiting
        state should show all of the details like it's ready for an import, and when the details
        is changed it can be approved and imported."

        THE SAME TABLE THE IMPORT SCREEN DRAWS, against the same library functions -- drawn twice
        it would drift, and the failure would not be two tables looking different but one of them
        judging a row by rules the other had moved on from.
      */}
      {followUp && (
        <DraftTable
          judged={followUp}
          busy={busy ? 'Working' : null}
          /* One job on this page, so the approval's progress IS whatever is running. */
          approving={busy ? 'Working' : null}
          error={error}
          backLabel="Put it away"
          onBack={() => setFollowUp(null)}
          onEdit={async (rowId, key, value) => {
            /* ONE CELL, MERGED IN THE DATABASE. Built by spreading this screen's copy of the row
               it would put back whatever that copy is behind on, and it is a round trip behind
               after every edit -- see setDraftRowValue. */
            await setDraftRowValue(rowId, key, value)
            await reload(followUp.draft.id)
          }}
          onExclude={async (rowId, excluded) => {
            await updateDraftRow(rowId, { excluded })
            await reload(followUp.draft.id)
          }}
          onDecide={async (rowId, decision, note, allocateTo = null) => {
            /* The desk travels with the decision here too -- the ticket draws the same table and
               a second go at a refused row is the same question about who works it. */
            if (decision === 'accepted') await acceptDraftRow(rowId, note, allocateTo)
            else if (decision === 'rejected') await rejectDraftRow(rowId, note)
            else await clearDraftRowDecision(rowId)
            await reload(followUp.draft.id)
          }}
          onApprove={importFollowUp}
          onDiscard={async () => {
            await discardDraft(followUp.draft.id)
            setFollowUp(null)
          }} />
      )}

      {/*
        RAISED BY A BUTTON, never by opening the ticket. Creating a draft as a side effect of
        looking at a page is how somebody ends up with one they did not ask for -- and a draft
        sitting in "waiting to be approved" that nobody started is a queue nobody trusts.
      */}
      {!followUp && q.status !== 'closed' && data.batch && notBroughtIn.length > 0 && (
        <Card>
          <CardHeader
            title="Import these once the client has corrected them"
            subtitle={`${notBroughtIn.length} ${notBroughtIn.length === 1 ? 'account' : 'accounts'} `
              + 'could not be opened. Their details come across as they were sent, so they can be '
              + 'corrected here and imported without the client re-sending the whole sheet.'} />
          {imported && <p className="text-sm text-positive-700 mt-3">{imported}</p>}
          {error && <p className="text-sm text-negative-700 mt-3">{error}</p>}
          <button type="button" disabled={busy} onClick={() => void raiseFollowUp()}
            className="mt-3 inline-flex items-center gap-2 text-sm font-medium px-4 py-2
              rounded-lg bg-gold-400 text-navy-950 border border-gold-500 disabled:opacity-40">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            Correct these and import them
          </button>
        </Card>
      )}

      {/*
        THE OTHER HALF OF THE COLUMN WE ASKED THEM TO FILL IN. Offered only while the query is
        open: once it is closed the answers are already on the accounts, and a paste box on a
        finished query invites somebody to write a month-old correction over a newer one.
      */}
      {q.status !== 'closed' && data.batch && (
        <ReplyAnswers accountFor={(ref) => (ref ? openedFor.get(ref) ?? null : null)} />
      )}

      {/*
        THE SAME COMPOSER EVERY OTHER SCREEN USES, which is the whole reason this was a small
        change. It sends through the person's own mailbox, appends to their Sent folder and hands
        the message back here to be filed and charged.

        THE ORIGINAL IS QUOTED AS PLAIN TEXT, like the account's own forward and unlike the mail
        page's. account_emails stores a SNIPPET rather than the message's markup, so there is no
        html here to keep the shape of — and `forwardBody` says so on the message when only the
        stored preview was available, rather than sending a truncated forward that reads complete.
      */}
      {/*
        ONE COMPOSE BOX FOR BOTH, because they produce exactly the same record: a message to the
        client, charged item 1(a), filed on the ticket and on the account. `forwarding` carries the
        debtor's own words into it; "Email the client" opens it with the ticket's subject and the
        question already written, which is the firm's "it should already be able to draft an email
        for the client" — a liaison should not have to retype what the ticket already says.

        Two modals would be two `onSent` handlers, and the one nobody was watching would be the one
        that forgot to file it against the ticket.
      */}
      {(forwarding || writing || replyTo) && (
        <ComposeEmailModal
          /* A REPLY GOES BACK TO WHOEVER WROTE IT (S14) -- the client's person, or the debtor whose words
             were filed here -- and is threaded under their message. Everything else starts with the client. */
          to={replyTo ? replyTo.debtorAddress : (data.clientEmail ?? data.clientPeople[0]?.email ?? '')}
          inReplyTo={replyTo?.messageId ?? null}
          initialCc={replyTo ? replyCc : undefined}
          /* The message being answered sits UNDER the box, never inside it -- see ComposeEmailModal.quoted. */
          quoted={replyTo?.body ?? undefined}
          /*
            EVERYBODY AT THE CLIENT, NOT JUST THE ADDRESS ON THE COMPANY RECORD.

            THE FIRM: "if I say email, it already says Rinda at novacall.co.za. But there's another
            person on the client's records as well. So there should be an option to CC, or who from
            the client do you want to send it to -- which person at the client."

            The box has taken a list all along; it was being handed one. A client is an organisation
            with people in it, and which of them a dispute goes to is a decision the liaison makes
            per ticket -- the accounts clerk for a reconciliation, the manager for a complaint. Cc
            is already on the box behind "Add Cc", and it takes the same list.
          */
          recipients={recipients}
          forwardAttachments={forwarding
            ? { accountEmailId: forwarding.id, names: forwarding.attachmentNames }
            : undefined}
          initialSubject={replyTo
            ? replySubject(replyTo.subject)
            : forwarding
            ? forwardSubject(forwarding.subject)
            : !q.accountId
            ? sheetTicketSubject({ sheetReference: data.batch?.reference ?? null, ticketNo: q.ticketNo })
            : ticketSubject({
              kind: q.kind,
              requestFor: q.requestFor,
              description: q.description,
              debtorName: data.account?.debtorName ?? null,
              accountNumber: data.account?.accountNumber ?? null,
              clientReference: data.account?.clientReference ?? null,
              ticketNo: q.ticketNo,
            })}
          /* A reply starts empty, as on the account: the original is quoted below the box. */
          initialBody={replyTo
            ? portalLine
            : forwarding
            ? forwardBody(
              {
                fromName: forwarding.direction === 'in'
                  ? forwarding.sentByName
                  : (currentUser?.name ?? null),
                fromAddress: forwarding.direction === 'in'
                  ? forwarding.debtorAddress
                  : (forwarding.ourAddress ?? mailbox ?? ''),
                subject: forwarding.subject,
                occurredAt: forwarding.occurredAt,
              },
              forwarding.body ?? '',
              /* The sync keeps a snippet, not the whole message. Saying so is the honest half:
                 a forward that silently ends mid-sentence reads to the client as all there was. */
              false,
            )
            : !q.accountId
            ? sheetTicketBody({
              sheetReference: data.batch?.reference ?? null,
              description: q.description,
              contact: data.clientContact,
              from: currentUser?.name ?? null,
              ticketNo: q.ticketNo,
            })
            : ticketBody({
              kind: q.kind,
              requestFor: q.requestFor,
              description: q.description,
              debtorName: data.account?.debtorName ?? null,
              accountNumber: data.account?.accountNumber ?? null,
              clientReference: data.account?.clientReference ?? null,
              contact: data.clientContact,
              from: currentUser?.name ?? null,
              ticketNo: q.ticketNo,
            })}
          contextNote={q.accountId
            ? `Goes out from ${mailbox ?? 'your mailbox'} and is charged R25 under `
              + 'item 1(a). It is filed against this dispute as well as the account.'
            /* NOT CHARGED (Stephan, S15): a sheet has no debtor to charge. Said, so nobody wonders. */
            : `Goes out from ${mailbox ?? 'your mailbox'} and is filed on this ticket. `
              + 'Not charged: it is about the client\'s handover sheet, not a debtor\'s account.'}
          onClose={() => { setForwarding(null); setWriting(false); setReplyTo(null) }}
          onSent={(rawSubject, bodyText, messageId, from) => {
            const answering = replyTo
            /* Who it went to, for the record: the person answered, else the client. */
            const sentTo = answering ? answering.debtorAddress : (data.clientEmail ?? '')
            const toClient = !answering
              || clientAddresses.some((a) => a.trim().toLowerCase() === answering.debtorAddress.trim().toLowerCase())
            setForwarding(null); setWriting(false); setReplyTo(null)
            /*
             * AND ON THE CLIENT'S OWN EMAILS (R-12). Nicole asked a client for a statement from a ticket and
             * the client's profile showed nothing: the message was filed on the ticket and the account, which is
             * where the debtor's record lives, and the client's Emails tab reads Email ACTIVITIES. Only a
             * message that went to the client -- answering the debtor from here is not the client's correspondence.
             * No charge: that is raised by recordSentEmail below, once.
             */
            const clientId = data.batch?.companyId ?? data.account?.companyId
            if (toClient && clientId) {
              addActivity({ type: 'Email', subject: rawSubject, notes: bodyText, companyId: clientId, emailMessageId: messageId ?? undefined })
            }
            /*
             * CHARGED, RECORDED AND FILED ON THE TICKET. The firm's ruling: "raising the dispute
             * charges a charge. I think it should charge the debtor for it. And also
             * correspondence to charge." Item 3 on the dispute and item 1(a) on the message are
             * two chargeable things; recordSentEmail raises the second exactly as it does for a
             * demand letter to the debtor.
             *
             * The subject arrives with the modal's own "Email sent: " framing, which is the CRM
             * activity convention and means nothing on an account. Stripped so what is filed is
             * the subject that actually went out.
             */
            const recorded = !q.accountId
              /* A SHEET TICKET (S15): filed on the ticket alone, no fee, no account timeline. */
              ? recordSheetTicketEmail({
                queryId: q.id,
                to: sentTo,
                from: from ?? null,
                subject: rawSubject.replace(/^Email sent:\s*/i, ''),
                body: bodyText,
                messageId: messageId ?? null,
                inReplyTo: answering?.messageId ?? null,
                actor: { id: currentUser?.id ?? null, name: currentUser?.name ?? null },
              })
              : recordSentEmail({
              accountId: q.accountId,
              to: sentTo,
              /* The modal leaves both undefined where it could not learn them; the ledger wants
                 a null. Passing undefined through PostgREST omits the column instead of clearing
                 it, which is a different thing on an update and a habit not worth having. */
              from: from ?? null,
              subject: rawSubject.replace(/^Email sent:\s*/i, ''),
              body: bodyText,
              messageId: messageId ?? null,
              inReplyTo: answering?.messageId ?? null,
              queryId: q.id,
              actor: { id: currentUser?.id ?? null, name: currentUser?.name ?? null },
            })
            void recorded
              /* The card has to show it went. Re-read rather than pushed, so what is drawn is what
                 was actually filed -- including the charge, which is computed server-side. */
              .then(() => fetchQueryEmails(q.id))
              .then(setEmails)
              .catch(() => { /* the message went; a list that did not refresh is not an error. */ })
            /* AND THE THREAD, because recordSentEmail writes an account note for the send and the
               panel above is what reads it back. Separately caught: a mail list that refreshed and
               a thread that did not is still a message that went out. */
            void fetchQueryNotes(q.id).then(setNotes).catch(() => { /* see above */ })

            /*
             * AND THE TICKET IS NOW WITH THE CLIENT, BECAUSE IT IS.
             *
             * THE FIRM: "now it says awaiting liaison, but it's actually already been escalated to
             * the client."
             *
             * They were reading a true record of a stale state. Writing to the client WAS the
             * escalation -- the message went, it is in the thread, it is charged -- and the stage
             * only moved if somebody separately remembered to press "Send to client". A state with
             * no record behind it is the fault this codebase keeps meeting; this is the other half
             * of it, a record with no state in front of it.
             *
             * ONLY ON THE WAY UP. A ticket already with the client stays there -- a second email
             * is a chase, not a fresh escalation -- and nothing here moves a ticket BACK, which is
             * the liaison's own decision when the client answers.
             */
            /* AND ONLY WHEN IT WENT TO THE CLIENT (S14): answering the debtor's own email from here is not
               an escalation to anybody. */
            if (q.stage !== 'client' && toClient) {
              void updateQuery(q.id, { stage: 'client' }, {
                accountId: q.accountId,
                actorId: currentUser?.id ?? null,
                actorName: currentUser?.name ?? null,
                note: 'Sent to the client.',
              })
                .then(() => fetchQuery(q.id))
                .then(setData)
                .catch(() => { /* the message went; the stage can be moved by hand. */ })
            }
          }}
        />
      )}
    </div>
  )
}

function Fact({ label: name, value, tone }: { label: string; value: string; tone?: 'bad' }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{name}</dt>
      <dd className={`text-sm ${tone === 'bad' ? 'text-negative-700' : 'text-slate-700'}`}>{value}</dd>
    </div>
  )
}

/**
 * The rows, as the email lists them.
 *
 * ONE PROBLEM PER LINE, not one per row: a row with three things wrong is three things the client
 * has to fix, and folding them into one line is how the third gets missed.
 */
function RowTable({ title, intro, rows, download }: {
  title: string
  intro: string
  rows: JudgedDraft['rows']
  /** Offered where these rows can go back to the client as a sheet. Null on a closed query. */
  download?: (() => void) | null
}) {
  /* Nothing at all is not worth a heading. An empty table under "the client must send these
     again" reads as a list that failed to load. */
  if (rows.length === 0) return null
  return (
    <Card padded={false}>
      <div className="p-5 pb-3">
        <CardHeader title={title} subtitle={intro}
          action={download ? (
            <button type="button" onClick={download}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:underline">
              <Download size={13} /> Send these back to the client
            </button>
          ) : undefined} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="px-5 py-2 font-medium">Their reference</th>
              <th className="px-3 py-2 font-medium">Debtor</th>
              <th className="px-3 py-2 font-medium">Field</th>
              <th className="px-3 py-2 font-medium">Their sheet says</th>
              <th className="px-3 py-2 pr-5 font-medium">What we need</th>
            </tr>
          </thead>
          <tbody>
            {rows.flatMap((row) => (row.planned?.problems ?? []).map((p, i) => (
              <tr key={`${row.id}:${i}`} className="border-t border-slate-100 align-top">
                <td className="px-5 py-2 whitespace-nowrap text-slate-600">
                  {row.values.client_reference ?? '—'}
                </td>
                <td className="px-3 py-2 text-slate-600">{row.values.name ?? '—'}</td>
                <td className="px-3 py-2 text-slate-600">{p.key ? label(p.key) : '—'}</td>
                <td className="px-3 py-2 text-slate-600">
                  {givenFor({ reference: null, name: null, note: null, values: row.values, problems: [] }, p.key)}
                </td>
                <td className={`px-3 py-2 pr-5 ${p.level === 'refuse' ? 'text-negative-700' : 'text-slate-600'}`}>
                  {p.level === 'refuse' && <AlertTriangle size={11} className="inline mr-1 -mt-0.5" />}
                  {p.message}
                </td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
