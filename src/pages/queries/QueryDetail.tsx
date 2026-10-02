import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Building2, Download, Loader2, Upload } from 'lucide-react'
import { Card, CardHeader } from '../../components/ui/Card'
import { useAuth } from '../../store/AuthContext'
import { useAppStore } from '../../store/AppStore'
import { formatDate } from '../../data/mockData'
import {
  ageInDays, closeQuery, fetchQuery, isStale,
  QUERY_OUTCOME_LABEL, QUERY_STAGE_LABEL,
  type QueryStage,
} from '../../lib/accountQueries'
import {
  acceptDraftRow, approveDraft, clearDraftRowDecision, discardDraft, fetchDraft,
  fetchDraftForHandover, followUpDraft, rejectDraftRow, setDraftRowValue,
  startFollowUpDraft, updateDraftRow,
  type JudgedDraft,
} from '../../lib/handoverDraft'
import { DraftTable } from '../../components/settings/HandoverImportCard'
import { fetchClientCommissionRate } from '../../lib/accountBook'
import { HANDOVER_COLUMNS } from '../../lib/handoverSheet.ts'
import { givenFor } from '../../lib/importCorrections.ts'
import { ReplyAnswers } from '../../components/queries/ReplyAnswers'
import { TicketEmails } from '../../components/queries/TicketEmails'
import { TicketWork } from '../../components/queries/TicketWork'
import { addNote, fetchQueryNotes, type AccountNote } from '../../lib/accountWorkspace'
import { ComposeEmailModal } from '../../components/ComposeEmailModal'
import {
  fetchQueryEmails, recordSentEmail, type AccountEmail,
} from '../../lib/accountEmails'
import { forwardBody, forwardSubject } from '../../lib/emailRules.ts'
import { ticketBody, ticketSubject } from '../../lib/ticketEmail.ts'
import { canSendToClient } from '../../lib/disputeCategories.ts'
import { canViewClients } from '../../lib/permissions.ts'
import { fetchAccounts } from '../../lib/accountBook'
import { rejectedSheetName, rejectedSheetRows } from '../../lib/rejectedSheet.ts'
import { buildXlsx, downloadBytes, XLSX_MIME } from '../../lib/xlsxWrite.ts'

const TODAY = () => new Date().toISOString().slice(0, 10)

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
  const { users } = useAppStore()
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
  const [writing, setWriting] = useState(false)
  /* Whether the signed-in person has a mailbox at all. Mail goes out through their OWN, so the
     button says why it is disabled rather than failing on Send. Null while we are asking. */
  const [mailbox, setMailbox] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true); setError(null)
    try {
      const found = await fetchQuery(id)
      setData(found)
      /*
       * NEVER FATAL. A ticket whose correspondence cannot be read is still a ticket somebody has
       * to work — the description, the owner and the chase date are all on the row itself. An
       * empty list simply hides the card.
       */
      setEmails(await fetchQueryEmails(id).catch(() => []))
      /* NEVER FATAL, for the same reason as the mail above: a thread that will not load leaves a
         ticket somebody can still work from the row itself. */
      setNotes(await fetchQueryNotes(id).catch(() => []))
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
      const result = await approveDraft({
        draftId: followUp.draft.id,
        today: TODAY(),
        /* THE CLIENT'S RATE, read fresh rather than off a row in memory: commission is the
           client's, and a stale copy of it is an account invoiced at the wrong rate for life. */
        commissionRate: await fetchClientCommissionRate(followUp.draft.companyId).catch(() => null),
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

  async function close(outcome: 'valid' | 'not_valid') {
    if (!data) return
    setBusy(true); setError(null)
    try {
      await closeQuery(data.query.id, { outcome }, {
        accountId: data.query.accountId,
        actorId: currentUser?.id ?? null,
        actorName: currentUser?.name ?? null,
      })
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
  const forwardWhy = !mayWriteToClient
    ? 'Only a liaison or a manager writes to the client about a dispute.'
    : !mailbox
      ? 'Connect your mailbox in Settings before you can forward anything.'
      : null

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
          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-slate-100">
            <button type="button" disabled={busy} onClick={() => void close('valid')}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-gold-400 text-navy-950 border border-gold-500 disabled:opacity-50">
              The client has answered
            </button>
            <button type="button" disabled={busy} onClick={() => void close('not_valid')}
              className="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-50">
              Close without an answer
            </button>
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
      {q.accountId && (
        <TicketWork
          notes={notes}
          canEmail={forwardWhy === null}
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
        DIRECTLY UNDER THE TICKET, above everything about the sheet. On a dispute this is the only
        other thing on the page, and on a batch ticket the rows below it run to hundreds — put the
        debtor's own words under those and nobody would ever reach them.
      */}
      <TicketEmails
        emails={emails}
        canForward={forwardWhy === null}
        why={forwardWhy}
        onForward={setForwarding}
      />
      </div>

      {/*
        WHO HAS IT, SINCE WHEN, AND WHEN IT COMES BACK — in a rail rather than in a row under the
        description, which is where they were. Three labels across the foot of a card read as a
        caption on the sentence above them; standing beside it they read as the state of the
        ticket, which is what somebody opening it at nine in the morning is actually asking.
      */}
      {q.accountId && (
        <Card>
          <CardHeader title="Where it stands" />
          <dl className="space-y-3 mt-1">
            <Fact label="With" value={ownerName ?? 'Nobody yet'} />
            <Fact label="Raised" value={`${formatDate(q.raisedAt)}${q.raisedByName ? ` by ${q.raisedByName}` : ''}`} />
            <Fact label={q.status === 'closed' ? 'Closed' : 'Age'}
              value={q.status === 'closed' ? formatDate(q.closedAt ?? q.raisedAt) : `${ageInDays(q)} days`} />
            {/* The chase date is the only thing on this page that can be WRONG rather than merely
                old, so it is the one that gets a colour. */}
            <Fact label="Chase" tone={stale ? 'bad' : undefined}
              value={q.chaseOn ? formatDate(q.chaseOn) : 'Not set'} />
            {q.requestFor && <Fact label="Asking for" value={q.requestFor} />}
            {data.clientName && <Fact label="Client" value={data.clientName} />}
          </dl>
        </Card>
      )}
      </div>

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
      {(forwarding || writing) && q.accountId && (
        <ComposeEmailModal
          to={data.clientEmail ?? ''}
          recipients={data.clientEmail
            ? [{ email: data.clientEmail, label: data.clientContact ?? data.clientName ?? undefined }]
            : []}
          initialSubject={forwarding
            ? forwardSubject(forwarding.subject)
            : ticketSubject({
              kind: q.kind,
              requestFor: q.requestFor,
              description: q.description,
              debtorName: data.account?.debtorName ?? null,
              accountNumber: data.account?.accountNumber ?? null,
            })}
          initialBody={forwarding
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
            : ticketBody({
              kind: q.kind,
              requestFor: q.requestFor,
              description: q.description,
              debtorName: data.account?.debtorName ?? null,
              accountNumber: data.account?.accountNumber ?? null,
              contact: data.clientContact,
              from: currentUser?.name ?? null,
            })}
          contextNote={`Goes out from ${mailbox ?? 'your mailbox'} and is charged R25 under `
            + 'item 1(a). It is filed against this dispute as well as the account.'}
          onClose={() => { setForwarding(null); setWriting(false) }}
          onSent={(rawSubject, bodyText, messageId, from) => {
            setForwarding(null); setWriting(false)
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
            void recordSentEmail({
              accountId: q.accountId as string,
              to: data.clientEmail ?? '',
              /* The modal leaves both undefined where it could not learn them; the ledger wants
                 a null. Passing undefined through PostgREST omits the column instead of clearing
                 it, which is a different thing on an update and a habit not worth having. */
              from: from ?? null,
              subject: rawSubject.replace(/^Email sent:\s*/i, ''),
              body: bodyText,
              messageId: messageId ?? null,
              queryId: q.id,
              actor: { id: currentUser?.id ?? null, name: currentUser?.name ?? null },
            })
              /* The card has to show it went. Re-read rather than pushed, so what is drawn is what
                 was actually filed -- including the charge, which is computed server-side. */
              .then(() => fetchQueryEmails(q.id))
              .then(setEmails)
              .catch(() => { /* the message went; a list that did not refresh is not an error. */ })
            /* AND THE THREAD, because recordSentEmail writes an account note for the send and the
               panel above is what reads it back. Separately caught: a mail list that refreshed and
               a thread that did not is still a message that went out. */
            void fetchQueryNotes(q.id).then(setNotes).catch(() => { /* see above */ })
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
