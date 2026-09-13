import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, Ban, Check, CheckSquare, ChevronDown, ChevronRight, ExternalLink, Inbox, Link2,
  Download, Loader2, MoveRight, Paperclip, Reply, RefreshCw, Search, ShieldAlert, Trash2,
  Undo2, X,
} from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Modal } from '../../components/ui/Modal'
import { useAuth } from '../../store/AuthContext'
import { relativeDayLabel } from '../../lib/dateLabels'
import { chargeMessage } from '../../lib/accountCharges'
import { recordSentEmail, replySubject } from '../../lib/accountEmails'
import { ComposeEmailModal } from '../../components/ComposeEmailModal'
import { fetchAccounts, type DebtorAccount } from '../../lib/accountBook'
import { useEmailView } from '../../lib/emailView'
import { EmailViewSwitcher } from '../../components/email/EmailViewSwitcher'
import { ReadingPane } from '../../components/email/ReadingPane'
import {
  blockedBy, blockSender, blockSenders, countNeedsFiling, countUnread, deleteMail,
  domainBlockProblem, domainOf, downloadAttachment, emptyJunk, fetchBlockedSenders, fetchMail,
  fetchMailBody, linkMailToAccount, linkMailToRecord, markMailRead, moveFiledMail,
  saveAccountContacts, setJunk, unblockSender, unmatchMail,
  type BlockedSender, type BlockOutcome, type InlineImage, type LinkedRecord, type MailFilter,
  type MailItem,
} from '../../lib/userMail'
import { useAppStore } from '../../store/AppStore'
import {
  findContactDetails, mergeCandidates, type ContactCandidate,
} from '../../lib/signature'
import { canRefileMail } from '../../lib/permissions'

/**
 * One agent's mailbox.
 *
 * It exists because of a hole the firm asked about: an email from a debtor that matches no
 * account and no CRM record used to be skipped by the sync and lost. At 50 agents taking 50-100
 * messages a day, nobody was ever going to find it by browsing 100 000 accounts.
 *
 * Three things happen here. A message is linked to a debtor account, which files it on that
 * account and raises the item 6 correspondence fee. Or it is thrown away, which forgets it in
 * Raptor and leaves it in Outlook. Or it is left alone, and the 30-day prune takes it.
 *
 * Your own mail only — enforced by the database, not by this page. Not even an administrator
 * reads a colleague's inbox.
 */
/** 'blocked' is not a mail filter — it is the blocklist itself, shown in the same place. */
type Pane = MailFilter | 'blocked'

/*
 * All first, and it is what the page opens on.
 *
 * The firm's call, and it follows from managing mail in one place: the tabs below All are
 * filters on one mailbox, not four mailboxes, and opening onto a filtered view hides mail from
 * somebody who came here to find a message. Every row carries its own state now — see
 * MailStatus — so nothing is lost by looking at the lot.
 */
const TABS: { id: Pane; label: string; hint: string }[] = [
  { id: 'all', label: 'All', hint: 'Your whole mailbox, junk aside' },
  { id: 'needs-filing', label: 'Needs matching', hint: 'Not on any record yet' },
  { id: 'filed', label: 'Matched', hint: 'On an account, lead, deal or client' },
  { id: 'junk', label: 'Junk', hint: 'Your mail server thought this was spam' },
  { id: 'blocked', label: 'Blocked', hint: 'Senders you never want to see again' },
]

const PAGE = 50

/** A debtor by name, falling back to whatever else identifies the account. */
const debtorLabel = (a: DebtorAccount) =>
  [a.debtorFirstName, a.debtorSurname].filter(Boolean).join(' ')
  || a.accountNumber
  || 'Unnamed debtor'

export function MailPage() {
  const { currentUser, session } = useAuth()
  const [filter, setFilter] = useState<Pane>('all')
  /*
   * Unread, and whether the list is narrowed to it.
   *
   * A toggle rather than a sixth tab: "unread junk" and "unread that still needs filing" are
   * both real questions, and a tab could only ever answer one of them. The count is scoped to
   * whichever tab and search are active, so the number on the button is the number of rows
   * pressing it leaves behind.
   */
  const [unread, setUnread] = useState(0)
  const [unreadOnly, setUnreadOnly] = useState(false)

  /*
   * Selection mode, off by default.
   *
   * The firm's call, and it buys back the left gutter: a tick box on every row, every day, to
   * serve the rare bulk action was the most prominent thing in the list and said nothing about
   * the message. That space now shows whether a message is unread — which is what somebody
   * scanning the list is actually looking for. Press Select and the boxes come back.
   */
  const [selecting, setSelecting] = useState(false)
  const [blocking, setBlocking] = useState<MailItem | null>(null)
  const [blocked, setBlocked] = useState<BlockedSender[]>([])
  const [emptying, setEmptying] = useState(false)
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<MailItem[]>([])
  const [more, setMore] = useState(false)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  /** The last load threw. Distinct from `error`, which any action can set. */
  const [loadFailed, setLoadFailed] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [linking, setLinking] = useState<MailItem | null>(null)
  /*
   * Set when the link modal was opened by Reply rather than by the Link button, so that filing
   * the message hands straight over to the composer instead of dropping you back on the list to
   * find it again.
   */
  const [linkThenReply, setLinkThenReply] = useState(false)
  const [replying, setReplying] = useState<MailItem | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  /*
   * Bodies, once fetched, kept for as long as the page is up.
   *
   * Each one is an IMAP round trip, so collapsing a message and opening it again should not pay
   * for it twice. Not cached beyond the page: it was never ours to store, which is the whole
   * reason it is fetched.
   */
  const [bodies, setBodies] = useState<Record<string, string>>({})
  /** Contact details read off each message's hrefs, keyed the same way as the bodies. */
  const [linkedDetails, setLinkedDetails] = useState<Record<string, ContactCandidate[]>>({})
  /**
   * The pictures drawn into each message, keyed the same way again.
   *
   * Signatures, in practice — and a signature that is a picture used to leave a blank where the
   * sender's name and number should be, which is exactly the part a collector needs.
   */
  const [bodyImages, setBodyImages] = useState<Record<string, InlineImage[]>>({})
  const [reading, setReading] = useState<string | null>(null)
  const [readError, setReadError] = useState<Record<string, string>>({})
  const [view, setView] = useEmailView()

  const load = useCallback(async (at = 0) => {
    if (!currentUser) return
    setLoading(true)
    setError(null)
    try {
      // The blocklist is a list of senders, not of mail: the effect below owns it, for every tab.
      if (filter === 'blocked') {
        setItems([])
        setMore(false)
        setPage(0)
        setChosen(new Set())
        return
      }
      const res = await fetchMail({
        userId: currentUser.id, filter, search, unreadOnly, offset: at * PAGE, limit: PAGE,
      })
      setItems(res.items)
      setMore(res.more)
      setPage(at)
      setChosen(new Set())
      setLoadFailed(false)
      // Alongside the page, so the badges track whatever the last action did.
      void countNeedsFiling(currentUser.id).then(setOutstanding).catch(() => {})
      void countUnread(currentUser.id, { filter, search }).then(setUnread).catch(() => {})
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      /*
       * Remembered separately from `error`, which every action shares.
       *
       * Without it a FAILED load fell through to the empty state, and the page cheerfully said
       * "Nothing waiting. Every email has been filed or thrown away." over a mailbox that had
       * simply not loaded. That is the worst possible thing to say when something is broken: it
       * is reassuring, it is wrong, and it sends somebody looking for their mail in Outlook
       * instead of telling us. It happened for real — see the leads.company fix.
       */
      setLoadFailed(true)
      setItems([])
      setMore(false)
    } finally {
      setLoading(false)
    }
  }, [currentUser, filter, search, unreadOnly])

  useEffect(() => { void load(0) }, [load])

  /*
   * The blocklist, loaded on every tab rather than only on the Blocked one.
   *
   * Every row now says whether its sender is blocked, so the list has to be in hand wherever
   * mail is shown. It is one small query per agent — their own patterns, nothing else — and it
   * reloads only when a block is added or removed, not on every page of mail.
   */
  /*
   * How many messages are still waiting, shown on the All tab.
   *
   * The firm asked for "a small thing by the All if there is a message outstanding that needs to
   * be attended to" — and it is needed precisely BECAUSE All is the landing view: a list that
   * mixes filed mail into unfiled gives no sense of how much is left, and the answer is the one
   * number somebody works down to zero.
   *
   * Counted in the database, not by filtering the page in hand: the page is 50 rows and the
   * answer is usually larger than that.
   */
  const [outstanding, setOutstanding] = useState(0)


  const [blocksVersion, setBlocksVersion] = useState(0)
  useEffect(() => {
    if (!currentUser) return
    let cancelled = false
    void fetchBlockedSenders(currentUser.id)
      .then((list) => { if (!cancelled) setBlocked(list) })
      // A blocklist we could not read costs a chip on some rows, not the mailbox. Nothing louder.
      .catch(() => {})
    return () => { cancelled = true }
  }, [currentUser, blocksVersion])

  /*
   * Read the mailbox now, not at 05:00 tomorrow.
   *
   * The cron syncs everyone once a day, which is the ceiling on the current plan. Opening your
   * own mailbox is the clearest possible signal that you want it current, so it pulls.
   */
  const syncMine = useCallback(async () => {
    const token = session?.access_token
    if (!token) return
    setSyncing(true)
    try {
      await fetch('/api/email/sync', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    } catch {
      // Offline, or no mailbox connected. The list still shows what was already synced.
    } finally {
      setSyncing(false)
      await load(0)
    }
  }, [session, load])

  const firstLoad = useRef(true)
  useEffect(() => {
    if (!firstLoad.current) return
    firstLoad.current = false
    void syncMine()
  }, [syncMine])

  const allChosen = items.length > 0 && chosen.size === items.length

  /**
   * Open a message and read it.
   *
   * Raptor holds a snippet, so opening one fetches the rest from the mailbox. Opening is also
   * what marks it read — the same rule as the account page, and for the same reason: a list where
   * everything is bold tells you nothing about what still needs attention.
   */
  async function toggle(mail: MailItem) {
    if (open === mail.id) { setOpen(null); return }
    await toggleTo(mail)
  }

  /**
   * Select and read a message, without the close-on-second-click of the list.
   *
   * In a reading pane, clicking the message you are already reading should keep reading it —
   * emptying the pane would be a click that undoes itself.
   */
  async function toggleTo(mail: MailItem) {
    setOpen(mail.id)

    if (!mail.readAt) {
      // Optimistic: the row un-bolds at once, and the write follows. A failed mark-read is not
      // worth an error over — it will still be there to open again.
      setItems((list) => list.map((m) => (
        m.id === mail.id ? { ...m, readAt: new Date().toISOString() } : m
      )))
      void markMailRead([mail.id]).catch(() => {})
    }

    if (bodies[mail.id] !== undefined) return
    const token = session?.access_token
    if (!token) return
    setReading(mail.id)
    setReadError((e) => { const next = { ...e }; delete next[mail.id]; return next })
    try {
      const { text, details, images } = await fetchMailBody(mail.id, token)
      setBodies((b) => ({ ...b, [mail.id]: text }))
      // Kept beside the text: these came out of the message's LINKS, which is the only thing an
      // image signature leaves behind.
      setLinkedDetails((d) => ({ ...d, [mail.id]: details }))
      setBodyImages((i) => ({ ...i, [mail.id]: images }))
    } catch (e) {
      // The snippet stays on screen, so this explains the gap rather than leaving it blank.
      setReadError((prev) => ({ ...prev, [mail.id]: e instanceof Error ? e.message : String(e) }))
    } finally {
      setReading(null)
    }
  }

  /**
   * Answer a message without leaving the mailbox.
   *
   * File first, then reply — and the reason is money, not tidiness. Item 1(a) is R25 on every
   * message we send, and a fee can only be raised against an account. A reply typed here for a
   * message that is on nobody's file goes out earning nothing and leaves no trace on any
   * statement; and because replying from the mailbox is EASIER than opening the account, the
   * easy path would quietly become the unbilled one. At 50 agents that is not a rounding error.
   *
   * So Reply on unlinked mail opens the account picker first. It is the same number of clicks as
   * today's "find the account, then reply" and it ends with both the fee and the record in place.
   * The picker still offers a way out for mail that genuinely belongs to no debtor — a supplier,
   * a colleague — but as the deliberate second choice, which is what it should be.
   */
  function startReply(mail: MailItem) {
    // Filed anywhere is enough — a lead's reply belongs on the lead, and the composer says
    // plainly that nothing will be charged for it.
    if (mail.isFiled) { setReplying(mail); return }
    setLinkThenReply(true)
    setLinking(mail)
  }

  /** Turning selection off drops the selection with it — a forgotten tick must not act later. */
  function toggleSelecting() {
    setSelecting((on) => {
      if (on) setChosen(new Set())
      return !on
    })
  }

  /** Filing on its own, with no reply waiting behind it. */
  function startLink(mail: MailItem) {
    setLinkThenReply(false)
    setLinking(mail)
  }

  /** Which attachment is being fetched, and why the last one failed. */
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  async function download(mail: MailItem, filename: string) {
    const token = session?.access_token
    if (!token) return
    setDownloading(filename)
    setDownloadError(null)
    try {
      await downloadAttachment({ mailId: mail.id, filename, accessToken: token })
    } catch (e) {
      // Beside the attachment rather than in the page's error line — it is about this one file,
      // and the message itself is fine.
      setDownloadError(e instanceof Error ? e.message : String(e))
    } finally {
      setDownloading(null)
    }
  }

  /** Moving a message that was filed on the wrong account. Administrators only. */
  const [moving, setMoving] = useState<MailItem | null>(null)
  const mayRefile = canRefileMail(currentUser?.role)

  /**
   * Move mail onto the junk shelf, or take it back off.
   *
   * The firm's point: the mail server's verdict is a guess, and something in Needs filing is
   * often simply spam it waved through. Junking it is the honest answer — it is neither filed
   * nor deleted — and it takes it out of All, which is where the work is.
   *
   * Reversible, and offered from the Junk tab itself, because the guess is wrong both ways: a
   * debtor writing from a free address lands in Junk often enough that a one-way move would be
   * a trap.
   */
  async function junkChosen(junk: boolean) {
    const ids = [...chosen]
    if (ids.length === 0) return
    try {
      const moved = await setJunk(ids, junk)
      const refused = ids.length - moved
      setStatus(
        `${moved} ${moved === 1 ? 'email' : 'emails'} ${junk ? 'moved to junk' : 'moved back to your mailbox'}.`
        + (refused > 0 ? ` ${refused} left alone — already matched to a record.` : '')
        + (junk ? ' Nothing deleted; empty the Junk tab when you want it gone.' : ''),
      )
      await load(page)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  /** The same, for the one message somebody has open. */
  async function junkOne(mail: MailItem, junk: boolean) {
    try {
      const moved = await setJunk([mail.id], junk)
      setStatus(moved === 0
        ? 'That email is matched to a record, so it stays out of junk.'
        : junk
          ? 'Moved to junk. Nothing deleted — it is under the Junk tab.'
          : 'Moved back to your mailbox.')
      setOpen(null)
      await load(page)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function bin() {
    const ids = [...chosen]
    if (ids.length === 0) return
    try {
      const gone = await deleteMail(ids)
      setStatus(`${gone} ${gone === 1 ? 'email' : 'emails'} removed from Raptor — still in your real mailbox.`)
      await load(page)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  /** What a block did, and what it refused, in one sentence. */
  function describeBlock(outcome: BlockOutcome): string {
    const parts: string[] = []
    if (outcome.blocked.length > 0) {
      parts.push(`Blocked ${outcome.blocked.length} ${outcome.blocked.length === 1 ? 'sender' : 'senders'}`)
    }
    if (outcome.removed > 0) {
      parts.push(`${outcome.removed} ${outcome.removed === 1 ? 'message' : 'messages'} cleared out of Raptor`)
    }
    if (outcome.refused.length > 0) {
      // Named, not counted. "One was skipped" is not something anybody can act on.
      parts.push(`left alone: ${outcome.refused.map((r) => `${r.address} (${r.reason})`).join(', ')}`)
    }
    return parts.length > 0 ? `${parts.join('. ')}.` : 'Nothing to block.'
  }

  async function blockChosen() {
    const picked = items.filter((m) => chosen.has(m.id))
    if (picked.length === 0 || !currentUser) return
    try {
      setStatus(describeBlock(await blockSenders({ userId: currentUser.id, mail: picked })))
      await load(page)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function readChosen() {
    const ids = [...chosen]
    if (ids.length === 0) return
    try {
      await markMailRead(ids)
      await load(page)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-4">
      <Card padded={false}>
        <div className="px-5 py-4 flex flex-wrap items-center gap-3 border-b border-slate-100">
          <div className="mr-auto min-w-0">
            <h2 className="text-sm font-semibold text-slate-800">My mailbox</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Everything stays until you match it or block the sender. Nothing is deleted on a
              timer, and nothing here is ever removed from your real mailbox.
            </p>
          </div>
          <label className={`relative ${filter === 'blocked' ? 'hidden' : ''}`}>
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Sender or subject"
              aria-label="Search your mailbox"
              className="text-sm rounded-lg border border-slate-200 pl-8 pr-3 py-2 w-52 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </label>
          <button onClick={() => void syncMine()} disabled={syncing}
            className="shrink-0 inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:border-[#c9a052] hover:bg-gold-50 disabled:opacity-50">
            {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {syncing ? 'Checking…' : 'Check now'}
          </button>
          {/* Junk earns its own one-tap answer: it is where the volume is and where nobody
              wants to read anything. */}
          {filter === 'junk' && items.length > 0 && (
            <button onClick={() => setEmptying(true)}
              className="shrink-0 inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 text-negative-700 hover:border-negative-100 hover:bg-negative-50">
              <Trash2 size={14} /> Empty junk
            </button>
          )}
          {/*
            Select, which is the only way the tick boxes appear.

            Off by default so the gutter can carry the unread mark instead — see `selecting`.
            It reads as pressed while it is on, because a mode you cannot see you are in is a
            mode that surprises you.
          */}
          {filter !== 'blocked' && items.length > 0 && (
            <button onClick={toggleSelecting} aria-pressed={selecting}
              className={`shrink-0 inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border transition-colors ${
                selecting
                  ? 'border-gold-500 bg-gold-400 text-navy-950'
                  : 'border-slate-200 text-slate-600 hover:border-[#c9a052] hover:bg-gold-50'}`}>
              {selecting ? <X size={14} /> : <CheckSquare size={14} />}
              {selecting ? 'Done' : 'Select'}
            </button>
          )}
          {/* Not on the blocklist, which is a list of senders rather than of mail. */}
          {filter !== 'blocked' && <EmailViewSwitcher view={view} onChange={setView} />}
        </div>

        {/*
          The tabs scroll if they must; the unread pill does not scroll with them.
          `ml-auto` inside an overflow-x-auto strip stops pushing right the moment the content
          overflows, which on a narrow screen would carry the pill off the edge — the one place
          somebody most needs to see it.
        */}
        <div className="border-b border-slate-200 flex items-center gap-2 pr-5">
          <div className="px-5 flex items-center gap-1 overflow-x-auto -mb-px min-w-0 flex-1">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setFilter(t.id)} title={t.hint}
                className={`shrink-0 px-3.5 py-2 text-sm font-medium border-b-2 inline-flex items-center gap-1.5 ${
                  filter === t.id ? 'border-gold-500 text-navy-950' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                {t.label}
                {/*
                  On All and on Needs filing, because they are the same number and it belongs
                  wherever somebody is looking for work. Nothing at zero — a badge showing 0 is
                  furniture, and it is what teaches people to stop reading the others.
                */}
                {(t.id === 'all' || t.id === 'needs-filing') && outstanding > 0 && (
                  <span className="min-w-4 h-4 px-1 rounded-full text-[10px] font-semibold
                    inline-flex items-center justify-center tabular-nums bg-gold-500 text-navy-950">
                    {outstanding > 99 ? '99+' : outstanding}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/*
            Unread, at the right end of the tab row — "at the top where there's All and stuff",
            as the firm put it, so the fact that something is unread is visible without reading
            a single row.

            A toggle, not a tab: it narrows whichever tab you are on, so "unread junk" and
            "unread that still needs filing" are both askable. The count is scoped to that same
            tab and search, so it is exactly what pressing it leaves behind.
          */}
          {filter !== 'blocked' && (
            <button
              onClick={() => setUnreadOnly((on) => !on)}
              aria-pressed={unreadOnly}
              title={unreadOnly ? 'Show read messages as well' : 'Show only what you have not read'}
              className={`shrink-0 my-1 inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium transition-colors ${
                unreadOnly
                  ? 'border-brand-500 bg-brand-500 text-white'
                  : unread > 0
                    ? 'border-brand-100 bg-brand-50 text-brand-700 hover:border-brand-500'
                    : 'border-slate-200 text-slate-400 hover:border-slate-300'}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${
                unreadOnly ? 'bg-white' : unread > 0 ? 'bg-brand-500' : 'bg-slate-300'}`} />
              {unread > 0 ? `${unread > 99 ? '99+' : unread} unread` : 'No unread'}
            </button>
          )}
        </div>

        {/* The bulk bar only exists once something is selected — an always-visible row of
            disabled buttons is furniture. */}
        {chosen.size > 0 && (
          <div className="px-5 py-2.5 bg-gold-50 border-b border-gold-100 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-navy-950 font-medium mr-auto">{chosen.size} selected</span>
            <button onClick={() => void readChosen()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-600 hover:bg-white">
              <Check size={14} /> Mark read
            </button>
            {/*
              Block, without opening anything. Address only — a whole-domain block stays behind
              the open message, because that one can silence a company and should cost a look.
            */}
            <button onClick={() => void blockChosen()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-600 hover:bg-white">
              <Ban size={14} /> Block {chosen.size === 1 ? 'sender' : 'senders'}
            </button>
            {/*
              Junk, both ways round. Which one is offered follows the tab you are standing on:
              on the Junk tab the useful action is rescuing something, everywhere else it is
              shelving it.
            */}
            {filter === 'junk' ? (
              <button onClick={() => void junkChosen(false)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-600 hover:bg-white">
                <Undo2 size={14} /> Not junk
              </button>
            ) : (
              <button onClick={() => void junkChosen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-600 hover:bg-white">
                <ShieldAlert size={14} /> Move to junk
              </button>
            )}
            <button onClick={() => void bin()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-negative-700 hover:bg-white">
              <Trash2 size={14} /> Delete from Raptor
            </button>
          </div>
        )}

        {status && <p className="px-5 py-2 text-[13px] text-[var(--c-green)] border-b border-slate-100">{status}</p>}
        {error && <p className="px-5 py-2 text-[13px] text-negative-700 border-b border-slate-100">{error}</p>}

        {loading ? (
          <div className="py-14 grid place-items-center text-slate-400">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : filter === 'blocked' ? (
          <BlockedList senders={blocked} onUnblock={async (id) => {
            await unblockSender(id)
            setBlocksVersion((v) => v + 1)
            setStatus('Unblocked. Their mail appears again from the next sync — not retroactively.')
            await load(0)
          }} />
        ) : loadFailed ? (
          <LoadFailed onRetry={() => void load(page)} />
        ) : items.length === 0 ? (
          <Empty filter={filter} searching={!!search.trim()} />
        ) : view === 'reading' ? (
          /*
           * Outlook's shape. The left column is summaries only: ReadingPane makes each row a
           * button, so a checkbox or a Link button nested inside it would be a control inside a
           * control. The actions move to the pane's own header instead, which is where Outlook
           * puts them too — and is why bulk select stays a list-view affair.
           */
          <ReadingPane
            items={items}
            selectedId={open}
            onSelect={(m) => void toggleTo(m)}
            emptyDetail="Pick a message on the left to read it."
            renderLead={(m) => (
              <span className="pl-4 pt-2.5 shrink-0">
                <RowGutter mail={m} selecting={selecting} chosen={chosen.has(m.id)}
                  onChoose={(on) => setChosen((prev) => {
                    const next = new Set(prev)
                    if (on) next.add(m.id)
                    else next.delete(m.id)
                    return next
                  })} />
              </span>
            )}
            renderRow={(m) => (
              /* pl-3 to match the list view's gap-3 between the gutter and the text. It was
                 dropped when the unread bar came off this row, which put the tick box hard up
                 against the sender. */
              <span className={`block pl-3 pr-3 py-2.5 ${!m.readAt ? 'bg-brand-50/60' : ''}`}>
                <MailSummary mail={m} tight blocked={blocked} />
              </span>
            )}
            renderDetail={(m) => (
              <div className="px-5 py-4">
                <div className="flex flex-wrap items-start gap-3 pb-3 mb-3 border-b border-slate-100">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-navy-950">{m.subject || '(no subject)'}</h3>
                    <p className="text-xs text-slate-400 mt-0.5 truncate">
                      {m.fromName || m.fromAddress}
                      {m.fromName && <span className="text-slate-300"> &middot; {m.fromAddress}</span>}
                      {' · '}{relativeDayLabel(m.occurredAt)}
                    </p>
                  </div>
                  {m.linkedTo ? (
                    // Said here rather than on every row in the list — one place, where somebody
                    // is actually looking at the message. The kind matters: "On a lead" and "On a
                    // debtor account" are different enough that leaving it off would mislead.
                    <span className="shrink-0 text-xs text-[var(--c-green)] inline-flex items-center gap-1 pt-1">
                      <Link2 size={12} />
                      On {m.linkedTo.label}
                      <span className="text-slate-400">&middot; {CRM_OR_ACCOUNT[m.linkedTo.kind]}</span>
                    </span>
                  ) : (
                    <button onClick={() => startLink(m)}
                      className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gold-500 bg-gold-400 text-navy-950">
                      <Link2 size={13} /> Match
                    </button>
                  )}
                </div>
                <MailBody mail={m} body={bodies[m.id]} images={bodyImages[m.id]}
                  loadingBody={reading === m.id}
                  bodyError={readError[m.id]} onBlock={() => setBlocking(m)}
                  onReply={() => startReply(m)} onJunk={(j) => void junkOne(m, j)}
                  onMove={mayRefile ? () => setMoving(m) : null}
                  onDownload={(f) => void download(m, f)}
                  downloading={downloading} downloadError={downloadError} />
              </div>
            )}
          />
        ) : (
          <>
            {selecting && (
              <div className="px-5 py-2 border-b border-slate-100">
                <label className="inline-flex items-center gap-2 text-xs text-slate-500">
                  <input type="checkbox" checked={allChosen}
                    onChange={(e) => setChosen(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())} />
                  Select all on this page
                </label>
              </div>
            )}
            <ul className="divide-y divide-slate-100">
              {items.map((m) => (
                <MailRow key={m.id} mail={m}
                  chosen={chosen.has(m.id)}
                  expanded={open === m.id}
                  blocked={blocked}
                  body={bodies[m.id]}
                  images={bodyImages[m.id]}
                  loadingBody={reading === m.id}
                  bodyError={readError[m.id]}
                  onToggle={() => void toggle(m)}
                  onBlock={() => setBlocking(m)}
                  selecting={selecting}
                  onChoose={(on) => setChosen((s) => {
                    const next = new Set(s)
                    if (on) next.add(m.id)
                    else next.delete(m.id)
                    return next
                  })}
                  onLink={() => startLink(m)}
                  onReply={() => startReply(m)}
                  onJunk={(j) => void junkOne(m, j)}
                  onMove={mayRefile ? () => setMoving(m) : null}
                  onDownload={(f) => void download(m, f)}
                  downloading={downloading} downloadError={downloadError} />
              ))}
            </ul>
          </>
        )}

        {(page > 0 || more) && (
          <div className="px-5 py-3 flex items-center justify-between border-t border-slate-100">
            <button disabled={page === 0} onClick={() => void load(page - 1)}
              className="text-sm text-slate-500 hover:text-slate-700 disabled:opacity-30">Previous</button>
            <span className="text-xs text-slate-400">Page {page + 1}</span>
            <button disabled={!more} onClick={() => void load(page + 1)}
              className="text-sm text-slate-500 hover:text-slate-700 disabled:opacity-30">Next</button>
          </div>
        )}
      </Card>

      {emptying && (
        <EmptyJunkModal
          count={items.length}
          userId={currentUser?.id ?? null}
          onClose={() => setEmptying(false)}
          onDone={(message) => {
            setEmptying(false); setStatus(message); setBlocksVersion((v) => v + 1); void load(0)
          }}
        />
      )}

      {blocking && (
        <BlockModal
          mail={blocking}
          userId={currentUser?.id ?? null}
          onClose={() => setBlocking(null)}
          onDone={(message) => {
            // The blocklist just changed, so every row's "sender blocked" chip is re-evaluated.
            setBlocking(null); setStatus(message); setBlocksVersion((v) => v + 1); void load(0)
          }}
        />
      )}

      {linking && (
        <LinkModal
          mail={linking}
          actor={{ id: currentUser?.id ?? null, name: currentUser?.name ?? null }}
          body={bodies[linking.id]}
          linked={linkedDetails[linking.id]}
          replying={linkThenReply}
          onClose={() => { setLinking(null); setLinkThenReply(false) }}
          onDone={(message, accountId, record) => {
            const mail = linking
            const goOn = linkThenReply
            setLinking(null)
            setLinkThenReply(false)
            setStatus(message)
            void load(page)
            /*
             * Straight into the composer, carrying what it was just filed against — the list
             * reload above has not finished and would hand back a stale copy of this row.
             *
             * accountId decides whether the reply is chargeable: a debtor account carries item
             * 1(a), a lead or a client carries nothing, and the composer says which.
             */
            if (goOn && mail) setReplying({ ...mail, linkedAccountId: accountId, isFiled: true, linkedTo: record })
          }}
          onSkip={() => {
            const mail = linking
            setLinking(null)
            setLinkThenReply(false)
            if (mail) setReplying(mail)
          }}
        />
      )}

      {moving && (
        <MoveModal
          mail={moving}
          actor={{ id: currentUser?.id ?? null, name: currentUser?.name ?? null }}
          onClose={() => setMoving(null)}
          onDone={(message) => { setMoving(null); setStatus(message); void load(page) }}
        />
      )}

      {replying && (
        <ComposeEmailModal
          to={replying.fromAddress}
          initialSubject={replySubject(replying.subject)}
          /*
           * The box starts empty, on purpose, exactly as it does on the account page. A debtor's
           * reply already carries their own client's quoted chain, so quoting it again opens the
           * message with two layers of "> " before the agent has typed a word — and the message
           * being answered is on the page behind this modal anyway.
           */
          inReplyTo={replying.messageId}
          /*
           * Three different truths, and the agent should know which one applies before typing.
           * A debtor is charged R25; a lead is not charged anything, because Annexure B is the
           * tariff for collecting a debt; and unfiled mail lands nowhere at all.
           */
          contextNote={replying.linkedAccountId
            ? `Goes out from your mailbox, lands on ${replying.linkedTo?.label ?? 'the account'}, and is charged R25 under item 1(a).`
            : replying.linkedTo
              ? `Goes out from your mailbox and is logged on ${replying.linkedTo.label}. No charge — Annexure B is for debtor accounts.`
              : 'This message is not matched to anything, so nothing will be charged and the reply will not appear on any record. It goes out from your mailbox and that is all.'}
          onClose={() => setReplying(null)}
          onSent={(rawSubject, bodyText, messageId, from) => {
            const answering = replying
            setReplying(null)
            if (!answering?.linkedAccountId) {
              // Said plainly rather than left to be discovered. The agent chose this path.
              setStatus(answering?.linkedTo
                ? `Reply sent and logged on ${answering.linkedTo.label}. No charge — Annexure B is for debtor accounts.`
                : 'Reply sent. Not charged and not recorded — it was not matched to anything.')
              return
            }
            /*
             * Identical to the account page's own send: charged under item 1(a), filed on
             * account_emails, and noted on the timeline. Reusing recordSentEmail is the point —
             * a second, subtly different way to bill an email is how two systems disagree.
             *
             * The subject arrives with the modal's "Email sent: " framing, which is the CRM
             * activity convention and means nothing on an account. Stripped so the debtor's own
             * subject line is what gets stored.
             */
            void recordSentEmail({
              accountId: answering.linkedAccountId,
              to: answering.fromAddress,
              from: from ?? null,
              subject: rawSubject.replace(/^Email sent: /, ''),
              body: bodyText,
              messageId: messageId ?? null,
              inReplyTo: answering.messageId,
              actor: { id: currentUser?.id ?? null, name: currentUser?.name ?? null },
            }).then((charge) => {
              setStatus(`Replied to ${answering.fromAddress}. ${chargeMessage(charge, '1a')}`)
              void load(page)
            }).catch((e) => setError(e instanceof Error ? e.message : String(e)))
          }}
        />
      )}
    </div>
  )
}

/**
 * The mailbox did not load. Said out loud, because the alternative is an empty list that reads
 * as "you have no mail" — and the one thing worse than a broken mailbox is a broken mailbox
 * nobody reports.
 */
function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="py-14 text-center">
      <AlertTriangle size={22} className="mx-auto text-gold-600" />
      <p className="text-sm font-medium text-slate-700 mt-3">Your mailbox could not be loaded.</p>
      <p className="text-[13px] text-slate-500 mt-1">
        This is not an empty mailbox — nothing was read, so nothing is missing. The reason is in
        the red line above.
      </p>
      <button onClick={onRetry}
        className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
        <RefreshCw size={13} /> Try again
      </button>
    </div>
  )
}

function Empty({ filter, searching }: { filter: Exclude<Pane, 'blocked'>; searching: boolean }) {
  if (searching) return <p className="py-14 text-center text-sm text-slate-400">Nothing matches that.</p>
  const words: Record<MailFilter, string> = {
    'needs-filing': 'Nothing waiting. Every email has been matched or thrown away.',
    filed: 'Nothing matched to a record yet.',
    all: 'Your mailbox is empty. Connect it under Settings → Integrations if you have not yet.',
    // Junk is a shelf, not a bin: nothing here has been deleted, it is just kept out of All.
    junk: 'Nothing in junk.',
  }
  return (
    <div className="py-14 text-center">
      <Inbox size={22} className="mx-auto text-slate-300" />
      <p className="text-sm text-slate-500 mt-3">{words[filter]}</p>
    </div>
  )
}

/**
 * The summary of a message: what both views show in the list.
 *
 * Split out of the row so the reading pane can use the same block down its left-hand side. Two
 * identical-looking lists maintained separately is how they end up disagreeing.
 */
/**
 * The left gutter: a tick box while selecting, otherwise the unread mark.
 *
 * ONE fixed-width element carrying both, so pressing Select swaps what is in the gutter without
 * moving a single row sideways. Two separate elements that appear and disappear would shift the
 * whole list every time the mode changed, which reads as the page glitching.
 *
 * The dot is the unread signal the firm asked for — "a little colourful show about it" — in the
 * space the tick boxes used to occupy every day for the sake of a rare bulk action.
 */
function RowGutter({ mail, selecting, chosen, onChoose }: {
  mail: MailItem
  selecting: boolean
  chosen: boolean
  onChoose: (on: boolean) => void
}) {
  return (
    <span className="w-4 shrink-0 grid place-items-center self-start mt-1.5">
      {selecting ? (
        <input type="checkbox" checked={chosen} onChange={(e) => onChoose(e.target.checked)}
          aria-label={`Select the email from ${mail.fromAddress}`} />
      ) : !mail.readAt ? (
        <span className="w-2 h-2 rounded-full bg-brand-500" title="Unread" />
      ) : null}
    </span>
  )
}

/**
 * What has happened to this message, on the row.
 *
 * The firm asked for it once All became the first tab: a single list of everything is only
 * useful if each row says where it stands, otherwise filed mail, junk and mail still waiting all
 * look identical.
 *
 * ON THE SUBJECT LINE, not on a line of its own. Rows were deliberately shortened earlier at the
 * firm's request ("Make it smaller"), and a status line per row would have put every one of those
 * pixels straight back. Right-aligned opposite the subject costs nothing.
 *
 * Three filing states, and they are mutually exclusive, so one chip: filed (and on what), junk,
 * or waiting. Blocked is NOT one of them — it describes the sender, not the message — so it
 * rides alongside as its own chip where it applies.
 */
function MailStatus({ mail, blocked, tight }: {
  mail: MailItem
  blocked: BlockedSender[]
  /** The reading pane's narrow column: labels shorten, the record name is dropped. */
  tight?: boolean
}) {
  const block = blockedBy(mail.fromAddress, blocked)
  const chip = 'shrink-0 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap'

  return (
    <>
      {mail.linkedTo ? (
        <span className={`${chip} bg-positive-50 text-[var(--c-green)] max-w-[14rem]`}
          title={`Matched to ${mail.linkedTo.label} — ${CRM_OR_ACCOUNT[mail.linkedTo.kind]}`}>
          <Link2 size={10} className="shrink-0" />
          <span className="truncate">{tight ? 'Matched' : `On ${mail.linkedTo.label}`}</span>
        </span>
      ) : mail.isJunk ? (
        <span className={`${chip} bg-slate-100 text-slate-500`}>
          <ShieldAlert size={10} /> Junk
        </span>
      ) : (
        /* Gold, because it is the only one of the three that is somebody's to act on. */
        <span className={`${chip} bg-gold-100 text-gold-700`}>
          <Inbox size={10} /> {tight ? 'Unmatched' : 'Needs matching'}
        </span>
      )}

      {block && (
        <span className={`${chip} bg-negative-50 text-negative-700`}
          title={`Nothing further from ${block.kind === 'domain' ? block.pattern : block.pattern} reaches Raptor. Unblock under the Blocked tab.`}>
          <Ban size={10} /> {tight ? 'Blocked' : 'Sender blocked'}
        </span>
      )}
    </>
  )
}

function MailSummary({ mail, tight, blocked }: {
  mail: MailItem
  /** The reading pane's narrow column: one line of preview, no sender address, short chips. */
  tight?: boolean
  /** The agent's blocklist, for marking a sender nothing further will arrive from. */
  blocked?: BlockedSender[]
}) {
  const unread = !mail.readAt
  return (
    /*
      Who, then what about, then what it says.
      
      The firm's ordering, and it is how a mailbox is actually read: you recognise the sender
      first and decide from that whether the subject is worth reading. Leading with the subject
      made every row start with a phrase like "Re: Account Abc1111" — indistinguishable from the
      next one — and buried the one thing that tells a debtor's reply from a newsletter.

      Three tiers of weight follow the same order: the sender carries the most, the subject
      less, the preview least. Unread deepens the sender rather than adding a fourth signal.
    */
    <span className="block min-w-0">
      {/* 1. Who it is from, and when. */}
      <span className="flex items-baseline gap-2">
        <span className={`text-sm truncate ${unread ? 'font-bold text-navy-950' : 'font-semibold text-slate-700'}`}>
          {mail.fromName || mail.fromAddress}
          {/* The address as well as the name, but not in the reading pane's narrow column,
              where it would push the name itself out of sight. */}
          {mail.fromName && !tight && (
            <span className="font-normal text-slate-400"> &middot; {mail.fromAddress}</span>
          )}
        </span>
        <span className="ml-auto shrink-0 text-xs text-slate-400">
          {relativeDayLabel(mail.occurredAt)}
        </span>
      </span>

      {/* 2. What it is about, and where the message stands. */}
      <span className="flex items-center gap-2 mt-0.5">
        <span className={`text-[13px] truncate ${unread ? 'text-slate-700' : 'text-slate-500'}`}>
          {mail.subject || '(no subject)'}
        </span>
        {mail.attachmentNames.length > 0 && <Paperclip size={12} className="shrink-0 text-slate-400" />}
        {/*
          Pushed to the right end of the subject line rather than given a line of its own — the
          state of a row belongs where the eye already is, and costs no height there.
        */}
        <span className="ml-auto flex items-center gap-1.5">
          <MailStatus mail={mail} blocked={blocked ?? []} tight={tight} />
        </span>
      </span>
      {/*
        One line in the pane, two in the list. A four-line row is one you scroll past rather than
        scan.
        
        `truncate` for the single line rather than `line-clamp-1`, deliberately. line-clamp needs
        display:-webkit-box, and two things go wrong with that here: Tailwind emits `.block` later
        in the stylesheet, so pairing them silently kills the clamp; and Safari can reserve the
        UNCLAMPED height while painting only the visible line, which is what left ~120px of blank
        space under every row with a preview on the firm's iPad. Chromium renders the same markup
        at 81px, which is why it took a screenshot to find.

        truncate is overflow+ellipsis+nowrap — no display trickery, identical everywhere.

        The two-line case still needs line-clamp, so it gets an explicit max height as well:
        whatever the browser thinks the box measures, the row cannot grow past two lines.
      */}
      {mail.snippet && (
        <span className={`block text-[13px] text-slate-400 mt-0.5 ${
          tight ? 'truncate' : 'line-clamp-2 max-h-[2.7em] overflow-hidden'}`}>
          {mail.snippet}
        </span>
      )}
    </span>
  )
}

/** The message itself, shared by the expanded row and the reading pane. */
function MailBody({
  mail, body, images, loadingBody, bodyError, onBlock, onReply, onJunk, onMove,
  onDownload, downloading, downloadError,
}: {
  mail: MailItem
  body?: string
  /** Pictures drawn into the message — a signature, nearly always. */
  images?: InlineImage[]
  loadingBody: boolean
  bodyError?: string
  onBlock: () => void
  onReply: () => void
  /** Shelve it, or rescue it. Absent on filed mail, which is a record either way. */
  onJunk: (junk: boolean) => void
  /** Unmatch it, or rematch it from the same box. Null for anyone who is not an administrator. */
  onMove: (() => void) | null
  /** Pull one attachment out of the mailbox. */
  onDownload: (filename: string) => void
  /** The file currently being fetched, so its own button shows the wait. */
  downloading: string | null
  downloadError: string | null
}) {
  return (
    <>
      {loadingBody && (
        <p className="text-[13px] text-slate-400 inline-flex items-center gap-1.5">
          <Loader2 size={13} className="animate-spin" /> Fetching the message from your mailbox&hellip;
        </p>
      )}

      {!loadingBody && body !== undefined && (
        /*
         * The message as it was written. `whitespace-pre-wrap` because an email's own line breaks
         * carry meaning — collapsing them turns a numbered arrangement into a paragraph.
         * `break-words` because a pasted URL would otherwise push the page wide.
         *
         * Rendered as TEXT, never as HTML: this is mail from outside the building, and putting a
         * stranger's markup into the page is not worth faithful formatting.
         */
        <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">
          {body.trim() || <span className="text-slate-400">This message has no text in it.</span>}
        </p>
      )}

      {/*
        The pictures the message was written WITH, as opposed to files attached to it.

        This is the answer to a signature that is an image. Raptor read those messages as three
        lines and a blank space where the sender's name, firm and number should have been —
        because the text scan finds nothing in a picture, and the picture was never sent to the
        browser at all. Now it is, and a collector can simply read it.

        Every src here is a data: URI carrying its own bytes. Nothing is fetched from anybody
        else's server, so a remote tracking pixel cannot report that this debtor's mail was
        opened, by whom, or when — see fetchMessageBody, which is where the bytes are read.
      */}
      {!loadingBody && images && images.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-400 mb-1.5">
            In this message
          </p>
          <div className="flex flex-wrap items-start gap-2">
            {images.map((img, i) => (
              <img
                key={img.cid || img.filename || i}
                src={img.dataUri}
                /* A signature picture has no useful alt text of its own; naming it as one is
                   more honest to a screen reader than an empty string or a filename. */
                alt={img.filename || 'Image from this message'}
                /* Capped so a full-width letterhead cannot push the reading pane wide or run
                   the actions off the bottom of the screen. */
                className="max-w-full max-h-40 w-auto rounded border border-slate-100 bg-white"
              />
            ))}
          </div>
        </div>
      )}

      {!loadingBody && bodyError && (
        <>
          {/* Fall back to what Raptor holds rather than showing nothing. */}
          {mail.snippet && (
            <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">{mail.snippet}</p>
          )}
          <p className="text-xs text-gold-600 mt-2">
            {bodyError} Showing the first {mail.snippet?.length ?? 0} characters Raptor saved.
          </p>
        </>
      )}

      {mail.attachmentNames.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {/*
            The files themselves are still not stored — each of these fetches out of the mailbox
            on demand and streams straight to the browser. Names alone were not enough: a debtor
            attaching proof of income to a payment arrangement is exactly the attachment a
            collector needs, and reading the filename then opening Outlook is not using Raptor.
          */}
          <Paperclip size={11} className="text-slate-400" />
          {mail.attachmentNames.map((name) => (
            <button key={name} onClick={() => onDownload(name)} disabled={downloading === name}
              title={`Download ${name}`}
              className="inline-flex items-center gap-1 max-w-full text-xs px-2 py-1 rounded-md border border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50">
              {downloading === name
                ? <Loader2 size={11} className="shrink-0 animate-spin" />
                : <Download size={11} className="shrink-0" />}
              <span className="truncate">{name}</span>
            </button>
          ))}
        </div>
      )}
      {downloadError && <p className="text-xs text-negative-700 mt-1.5">{downloadError}</p>}

      {/*
        Everything you can do with an open message, in one row.

        Reply is first and is the whole reason the mailbox stopped being read-only: answering a
        debtor used to mean finding their account and starting again there, so the mailbox was a
        filing tray rather than a place you worked. What it does depends on whether this message
        is on an account yet — see startReply.

        Blocking lives on the OPEN message rather than as another button on every row. It is the
        one action you should have read something before taking — and it is offered even on mail
        already linked to an account, because blocking a sender is about future noise, not about
        the message in front of you.
      */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={onReply}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500">
          <Reply size={13} /> Reply
        </button>

        {/*
          Through to the debtor's file, which is the other half of managing mail from one place:
          the message is here, but the balance, the arrangement and the history are there.

          A Link, not a button, so it behaves like one — middle-click and "open in new tab" both
          work, which matters when you are working a message and want the account beside it.
        */}
        {mail.linkedTo && (
          <Link to={mail.linkedTo.path}
            className="inline-flex items-center gap-1.5 max-w-full text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50">
            <ExternalLink size={13} className="shrink-0" />
            {/* Truncated: a double-barrelled name or a long deal name would otherwise make this
                button wider than a phone, and the row wraps rather than scrolls. */}
            <span className="truncate">Open {mail.linkedTo.label}</span>
          </Link>
        )}

        {/*
          Junk sits between "file it" and "block them": it says this message is not work,
          without claiming anything about the sender. Hidden on filed mail — a message on a
          record is neither junk nor anybody's to reclassify.
        */}
        {/*
          Only on mail already filed on a DEBTOR account, and only for an administrator — the
          database refuses it for anyone else, so offering the button would be a lie. Not offered
          on a lead or a client, where no fee is involved and nothing is at stake.
        */}
        {/*
          ONE button, and it says Unmatch.
          
          Two buttons made the agent choose between "rematch" and "unmatch" before knowing which
          they could actually do — and the answer to "which account should this be on?" is
          frequently "I do not know yet". So the box behind this leads with unmatching and offers
          rematching underneath, for when somebody does know.
        */}
        {mail.linkedTo?.kind === 'account' && onMove && (
          <button onClick={onMove}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50">
            <Undo2 size={13} /> Unmatch
          </button>
        )}

        {!mail.isFiled && (
          <button onClick={() => onJunk(!mail.isJunk)}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50">
            {mail.isJunk
              ? <><Undo2 size={13} /> Not junk</>
              : <><ShieldAlert size={13} /> Move to junk</>}
          </button>
        )}

        <button onClick={onBlock}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:border-negative-100 hover:bg-negative-50 hover:text-negative-700">
          {/* "Block", to match the Blocked tab. The long phrasing described the mechanism;
              this names the thing, and the two now obviously belong together. */}
          <Ban size={13} /> Block sender
        </button>
      </div>
    </>
  )
}

function MailRow({
  mail, chosen, expanded, selecting, blocked, body, images, loadingBody, bodyError, onToggle,
  onChoose, onLink, onBlock, onReply, onJunk, onMove, onDownload, downloading, downloadError,
}: {
  mail: MailItem
  chosen: boolean
  expanded: boolean
  /** Tick boxes are showing, so the gutter carries one instead of the unread mark. */
  selecting: boolean
  /** The agent's blocklist, so the row can say a sender is silenced. */
  blocked: BlockedSender[]
  /** The full text, once fetched. Undefined until then. */
  body?: string
  /** The pictures inside it, fetched alongside the text. */
  images?: InlineImage[]
  loadingBody: boolean
  bodyError?: string
  onToggle: () => void
  onChoose: (on: boolean) => void
  onLink: () => void
  onBlock: () => void
  onReply: () => void
  onJunk: (junk: boolean) => void
  onMove: (() => void) | null
  onDownload: (filename: string) => void
  downloading: string | null
  downloadError: string | null
}) {
  const unread = !mail.readAt
  return (
    /*
      Unread wears a bar down its left edge, in the brand blue rather than the gold used for
      selection — the two must not be mistakable for each other, since a row can be both.
      Read rows keep a transparent bar of the same width so nothing shifts sideways as mail is
      read, which would make the whole list twitch.
    */
    <li className={unread ? 'bg-brand-50/60' : undefined}>
      <div className="px-5 py-3 flex items-start gap-3">
        {/*
          The gutter sits OUTSIDE the button that opens the message. Nesting a checkbox inside
          the other means ticking a row to delete it also opens and reads it, which is the
          opposite of what somebody clearing spam wants.
        */}
        <RowGutter mail={mail} selecting={selecting} chosen={chosen} onChoose={onChoose} />

        <button onClick={onToggle} aria-expanded={expanded} className="min-w-0 flex-1 text-left">
          {/* Collapsed, the snippet is the preview. Open, the whole message replaces it below. */}
          <MailSummary mail={expanded ? { ...mail, snippet: null } : mail} blocked={blocked} />
        </button>

        <div className="shrink-0 flex items-center gap-2 pt-0.5">
          {/* Linked mail offers nothing: it is on an account, it raised a fee, and it is not
              anybody's to re-file or delete. The database refuses both as well. */}
          {!mail.isFiled && (
            <button onClick={onLink}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gold-500 bg-gold-400 text-navy-950">
              <Link2 size={13} /> Match
            </button>
          )}
          <button onClick={onToggle} aria-label={expanded ? 'Close this email' : 'Read this email'}
            className="text-slate-400 hover:text-slate-600">
            {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-5 pb-4 pl-[2.9rem]">
          <MailBody mail={mail} body={body} images={images} loadingBody={loadingBody}
            bodyError={bodyError} onBlock={onBlock} onReply={onReply} onJunk={onJunk}
            onMove={onMove} onDownload={onDownload}
            downloading={downloading} downloadError={downloadError} />
        </div>
      )}
    </li>
  )
}

/**
 * Clearing out junk, with the one choice that matters.
 *
 * Deleting junk is cheap and reversible in the sense that matters — the mail is still in Outlook.
 * Blocking the senders as well is what stops the same rubbish arriving again tomorrow, and it is
 * the difference between emptying a bin and stopping the delivery. Offered, not assumed: a
 * legitimate sender does end up in junk sometimes.
 */
function EmptyJunkModal({ count, userId, onClose, onDone }: {
  count: number
  userId: string | null
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [alsoBlock, setAlsoBlock] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    if (!userId) return
    setBusy(true)
    setError(null)
    try {
      const r = await emptyJunk({ userId, alsoBlock })
      const bits = [`${r.deleted} ${r.deleted === 1 ? 'message' : 'messages'} cleared out of Raptor`]
      if (r.blocked.length > 0) bits.push(`${r.blocked.length} senders blocked`)
      if (r.refused.length > 0) {
        bits.push(`left alone: ${r.refused.map((x) => `${x.address} (${x.reason})`).join(', ')}`)
      }
      onDone(`${bits.join('. ')}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Modal title="Empty junk" onClose={onClose} width={480}>
      <p className="text-sm text-slate-500">
        This removes {count === 1 ? 'the message' : `all ${count} messages`} in junk from Raptor.
        They stay in your real mailbox &mdash; nothing here touches Outlook.
      </p>

      <label className="flex items-start gap-2.5 mt-4 px-3.5 py-3 rounded-lg border border-slate-200 cursor-pointer">
        <input type="checkbox" checked={alsoBlock} className="mt-0.5"
          onChange={(e) => setAlsoBlock(e.target.checked)} />
        <span>
          <span className="block text-sm font-medium text-slate-800">
            Block these senders too
          </span>
          <span className="block text-xs text-slate-400 mt-0.5">
            Stops the same rubbish arriving again tomorrow. Addresses only, never whole domains,
            and never an address on a debtor&rsquo;s file.
          </span>
        </span>
      </label>

      {error && <p className="text-sm text-negative-700 mt-3">{error}</p>}

      <div className="flex items-center justify-end gap-2 mt-5">
        {busy && <Loader2 size={15} className="animate-spin text-slate-400" />}
        <button onClick={onClose} disabled={busy}
          className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50">
          Cancel
        </button>
        <button onClick={() => void run()} disabled={busy}
          className="text-sm font-medium px-3.5 py-2 rounded-lg border border-negative-100 bg-negative-50 text-negative-700 disabled:opacity-50">
          Empty junk
        </button>
      </div>

      {/* Anything rescued onto an account is a record and is never swept — said here because it
          is the one thing somebody might fear losing. */}
      <p className="text-xs text-slate-400 mt-4">
        Junk mail you have already linked to an account is left where it is.
      </p>
    </Modal>
  )
}

/** The blocklist: what you have silenced, and the way back. */
/**
 * The blocklist, newest block first.
 *
 * Ordered by when it was blocked rather than alphabetically, and the date is ON the row, because
 * this list is read for one reason: something stopped arriving and somebody wants to know what
 * they did recently. An alphabetical list makes that a search; a chronological one puts the
 * answer at the top. (fetchBlockedSenders does the ordering, in SQL.)
 */
function BlockedList({ senders, onUnblock }: {
  senders: BlockedSender[]
  onUnblock: (id: string) => Promise<void>
}) {
  if (senders.length === 0) {
    return (
      <div className="py-14 text-center">
        <Ban size={22} className="mx-auto text-slate-300" />
        <p className="text-sm text-slate-500 mt-3">Nothing blocked.</p>
        <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
          Open a message and choose &ldquo;Block sender&rdquo; to keep it out of Raptor for
          good. It stays in your real mailbox.
        </p>
      </div>
    )
  }
  return (
    <ul className="divide-y divide-slate-100">
      {senders.map((b) => (
        <li key={b.id} className="px-5 py-3 flex items-center gap-3">
          <span className="shrink-0 grid place-items-center w-7 h-7 rounded-full bg-slate-100 text-slate-400">
            <Ban size={13} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-slate-800 truncate">
              {b.kind === 'domain' ? `Everything from ${b.pattern}` : b.pattern}
            </p>
            <p className="text-xs text-slate-400 truncate">
              Blocked {relativeDayLabel(b.createdAt).toLowerCase()}
              {b.label && <> &middot; {b.label}</>}
            </p>
          </div>
          <button onClick={() => void onUnblock(b.id)}
            className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:border-[#c9a052] hover:bg-gold-50">
            <Undo2 size={13} /> Unblock
          </button>
        </li>
      ))}
    </ul>
  )
}

/**
 * Blocking a sender, with the two ways to do it and the reasons one of them may be refused.
 *
 * The refusals are the point of this box existing rather than it being a one-click action. A
 * blocked sender never becomes a row, so a mistake here is invisible: the mail simply stops, and
 * an account quietly looks unworked.
 */
function BlockModal({ mail, userId, onClose, onDone }: {
  mail: MailItem
  userId: string | null
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const domain = domainOf(mail.fromAddress)
  const domainProblem = domainBlockProblem(mail.fromAddress)

  async function block(scope: 'address' | 'domain') {
    if (!userId) return
    setBusy(true)
    setError(null)
    try {
      const { pattern, removed } = await blockSender({
        userId,
        address: mail.fromAddress,
        scope,
        label: mail.fromName ?? mail.subject ?? null,
      })
      onDone(
        `Blocked ${pattern}.`
        + (removed > 0 ? ` ${removed} ${removed === 1 ? 'message' : 'messages'} cleared out of Raptor.` : '')
        + ' Nothing from them will be imported again.',
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Modal title="Block this sender" onClose={onClose} width={480}>
      <p className="text-sm text-slate-500">
        Their mail will stop appearing in Raptor from the next sync, and anything of theirs still
        sitting here will be cleared out. It stays in your real mailbox &mdash; this only stops
        Raptor taking a copy.
      </p>

      <div className="mt-4 space-y-2">
        <button disabled={busy} onClick={() => void block('address')}
          className="w-full text-left px-3.5 py-3 rounded-lg border border-slate-200 hover:border-[#c9a052] hover:bg-gold-50 disabled:opacity-50">
          <span className="block text-sm font-medium text-slate-800">Just this address</span>
          <span className="block text-xs text-slate-400 mt-0.5 truncate">{mail.fromAddress}</span>
        </button>

        <button disabled={busy || !!domainProblem} onClick={() => void block('domain')}
          title={domainProblem ?? undefined}
          className="w-full text-left px-3.5 py-3 rounded-lg border border-slate-200 hover:border-[#c9a052] hover:bg-gold-50 disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:bg-transparent">
          <span className="block text-sm font-medium text-slate-800">
            Everything from {domain ?? 'this domain'}
          </span>
          <span className="block text-xs text-slate-400 mt-0.5">
            {domainProblem ?? 'Catches the same nuisance when it changes address, which spam does.'}
          </span>
        </button>
      </div>

      {error && (
        <p className="text-sm text-negative-700 mt-3 flex items-start gap-1.5">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          {error}
        </p>
      )}

      <p className="text-xs text-slate-400 mt-4">
        An address that is on a debtor&rsquo;s file cannot be blocked at all. Reversible from the
        Blocked tab, though unblocking is not retroactive &mdash; it lets their next message in,
        not the ones already skipped.
      </p>
      {busy && (
        <p className="text-xs text-slate-400 mt-2 inline-flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin" /> Blocking&hellip;
        </p>
      )}
    </Modal>
  )
}

/**
 * Choosing which account a message belongs to.
 *
 * A search rather than a list: there are 100 000 accounts, and the agent already has the name or
 * the number in front of them on the email.
 */
/** A CRM record the search box turned up. Not a debtor account — those page separately. */
interface CrmHit {
  kind: 'lead' | 'deal' | 'client' | 'contact'
  id: string
  label: string
  /** A second line telling two similar names apart — a company, an address, or the kind. */
  hint: string | null
}

const CRM_PATH: Record<CrmHit['kind'], (id: string) => string> = {
  lead: (id) => `/leads/${id}`,
  deal: (id) => `/deals/${id}`,
  client: (id) => `/companies/${id}`,
  contact: (id) => `/contacts/${id}`,
}

/** What to call each destination on screen. "Account" means a debtor, which is the one that bills. */
const CRM_OR_ACCOUNT: Record<LinkedRecord['kind'], string> = {
  account: 'Debtor account', lead: 'Lead', deal: 'Deal', client: 'Client', contact: 'Contact',
}

function LinkModal({ mail, actor, body, linked, replying, onClose, onDone, onSkip }: {
  mail: MailItem
  actor: { id: string | null; name: string | null }
  /** The message text, where it has been fetched — one source of the contact suggestions. */
  body?: string
  /** Details read off the message's links, which is what an image signature gives up. */
  linked?: ContactCandidate[]
  /** Opened by Reply rather than by the Link button: say so, and offer the way out. */
  replying?: boolean
  onClose: () => void
  /**
   * Filed. `accountId` is null when it went to a CRM record rather than a debtor account —
   * which is also what tells the caller whether a reply from here can be charged.
   */
  onDone: (message: string, accountId: string | null, record: LinkedRecord) => void
  /** Reply anyway, with nothing charged and nothing filed. Only offered when replying. */
  onSkip?: () => void
}) {
  const [term, setTerm] = useState('')
  const [hits, setHits] = useState<DebtorAccount[]>([])
  const [looking, setLooking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /*
   * CRM records come from the store, which already holds every lead, deal, client and contact
   * this user can see — so they filter in memory, instantly, with no round trip. Debtor accounts
   * cannot: there are 100 000 of them and they are fetched and paged. Hence one debounced search
   * below and one synchronous filter here, for what is a single search box on screen.
   */
  /*
   * Two steps for a debtor account, one for a CRM record.
   *
   * Picking a debtor no longer files it: there are decisions to make first — whether to keep the
   * address, and which of the details the message gave up are real. A lead has none of those and
   * no fee, so it files on the tap, as it always did.
   */
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(null)
  const [keepAddress, setKeepAddress] = useState(true)
  const [keepDetails, setKeepDetails] = useState<Set<string>>(new Set())

  /*
   * What the message gave up, from its words and its links together.
   *
   * Both, because they fail in opposite cases. A debtor typing "my new number is …" leaves it in
   * the text and nothing in the links; a corporate signature that renders as one picture leaves
   * nothing in the text and its number in a tel: href. Merging deduplicates the common case
   * where a signature carries the same number both ways.
   *
   * Nothing is fetched for this — no body, no suggestions, which is the honest outcome of
   * filing a message without reading it.
   */
  const suggestions = useMemo(
    () => mergeCandidates(body ? findContactDetails(body) : [], linked ?? []),
    [body, linked],
  )

  const { leads, deals, companies, contacts } = useAppStore()
  const crmHits = useMemo<CrmHit[]>(() => {
    const q = term.trim().toLowerCase()
    if (q.length < 2) return []
    const has = (...parts: (string | null | undefined)[]) =>
      parts.some((x) => x?.toLowerCase().includes(q))
    const out: CrmHit[] = []
    for (const l of leads) {
      if (out.length >= 12) break
      const name = [l.firstName, l.lastName].filter(Boolean).join(' ')
      // The lead number as text too — it is how the firm refers to a lead out loud.
      if (has(name, l.companyName, l.email, String(l.leadNumber))) {
        out.push({
          kind: 'lead',
          id: l.id,
          label: name || l.companyName || 'Unnamed lead',
          hint: l.companyName || l.email || null,
        })
      }
    }
    for (const d of deals) {
      if (out.length >= 12) break
      if (has(d.name)) out.push({ kind: 'deal', id: d.id, label: d.name, hint: 'Deal' })
    }
    for (const c of companies) {
      if (out.length >= 12) break
      if (has(c.name)) out.push({ kind: 'client', id: c.id, label: c.name, hint: 'Client' })
    }
    for (const c of contacts) {
      if (out.length >= 12) break
      const name = [c.firstName, c.lastName].filter(Boolean).join(' ')
      if (has(name, c.email)) out.push({ kind: 'contact', id: c.id, label: name || c.email || 'Unnamed contact', hint: c.email ?? null })
    }
    return out
  }, [term, leads, deals, companies, contacts])

  // Debounced, because otherwise this searches 100 000 rows on every keystroke.
  useEffect(() => {
    const q = term.trim()
    if (q.length < 2) { setHits([]); return }
    let cancelled = false
    setLooking(true)
    const t = setTimeout(() => {
      // Reuses the accounts list's own search — account number, client reference or surname —
      // rather than introducing a second, subtly different way to find a debtor.
      void fetchAccounts({ search: q, pageSize: 8 })
        .then((r) => { if (!cancelled) setHits(r.accounts) })
        .catch(() => { if (!cancelled) setHits([]) })
        .finally(() => { if (!cancelled) setLooking(false) })
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [term])

  /**
   * File against a CRM record. Nothing is charged — see linkMailToRecord.
   *
   * The message lands on that record's timeline and leaves the working list, which is the same
   * outcome as filing to a debtor minus the fee. Said in the status line either way, so nobody
   * has to remember which destinations cost the debtor money.
   */
  async function fileOn(hit: CrmHit) {
    setBusy(true)
    setError(null)
    try {
      await linkMailToRecord({ mail, to: hit, actor })
      onDone(`Matched to ${hit.label}. No charge — Annexure B is for debtor accounts.`, null, {
        kind: hit.kind, id: hit.id, label: hit.label, path: CRM_PATH[hit.kind](hit.id),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  async function link() {
    if (!picked) return
    const { id: accountId, label } = picked
    setBusy(true)
    setError(null)
    try {
      const charge = await linkMailToAccount({ mail, accountId, actor })

      /*
       * Saved AFTER the filing, and never allowed to undo it. The message is on the account and
       * the fee is raised; a contact that failed to save is a detail to re-enter, not a reason
       * to leave the agent looking at a red box over work that actually succeeded.
       */
      let saved = 0
      try {
        saved = await saveAccountContacts({
          accountId,
          details: [
            ...(keepAddress
              ? [{ kind: 'email' as const, value: mail.fromAddress, label: mail.fromName ?? undefined }]
              : []),
            ...suggestions
              .filter((c) => keepDetails.has(c.value))
              .map((c) => ({
                kind: c.kind,
                value: c.value,
                // Says where it came from, so a later audit can tell a detail lifted out of a
                // message from one somebody confirmed on a call.
                label: c.context === 'Linked in their signature' ? 'From their signature' : 'From their email',
              })),
          ],
          actor,
        })
      } catch (e) {
        console.error('[MailPage] filed, but the contact details did not save:', e)
      }

      onDone(
        `Matched to ${label}. ${chargeMessage(charge, '6')}`
        + (saved > 0 ? ` ${saved} contact ${saved === 1 ? 'detail' : 'details'} saved on the account.` : ''),
        accountId,
        { kind: 'account', id: accountId, label, path: `/accounts/${accountId}` },
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Modal title={replying ? 'Reply — what is this about?' : 'What is this about?'}
      onClose={onClose} width={520}>
      {replying && (
        // Why there is a step before the composer, said once, in plain terms.
        <p className="text-[13px] text-slate-500 mb-3">
          Matching it first is what puts your reply on the record it belongs to &mdash; and, on
          a debtor account, what raises the R25 for sending it. Pick where it goes and the reply
          opens next.
        </p>
      )}
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
        <p className="text-sm font-medium text-slate-800 truncate">{mail.subject || '(no subject)'}</p>
        <p className="text-xs text-slate-400 mt-0.5 truncate">From {mail.fromAddress}</p>
        {mail.snippet && <p className="text-[13px] text-slate-500 mt-1.5">{mail.snippet.slice(0, 160)}</p>}
      </div>

      {picked ? (
        /*
          STEP 2 — what else to keep. Only for a debtor account: a lead files on the tap, since
          there is no fee and no account_contacts to add to.
        */
        <>
          <div className="mt-4 rounded-lg border border-slate-200 px-3 py-2.5 flex items-center gap-2">
            <Link2 size={15} className="shrink-0 text-slate-400" />
            <span className="text-sm text-slate-800 min-w-0 flex-1">
              Matching to <strong className="font-semibold">{picked.label}</strong>
            </span>
            <button onClick={() => { setPicked(null); setError(null) }} disabled={busy}
              className="shrink-0 text-xs font-medium text-slate-500 hover:text-slate-700 underline underline-offset-2 disabled:opacity-50">
              Change
            </button>
          </div>

          {/*
            On by default, because it is the whole point: findAccount matches future mail against
            this, so saving it once means the next email from this debtor files itself. The
            consequence is stated rather than buried — automatic filing is also automatic
            charging, so the wrong address here bills quietly and repeatedly.
          */}
          <label className="flex items-start gap-2.5 mt-3 cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={keepAddress}
              onChange={(e) => setKeepAddress(e.target.checked)} />
            <span className="min-w-0">
              <span className="block text-sm text-slate-800">
                Save <strong className="font-medium">{mail.fromAddress}</strong> on this account
              </span>
              <span className="block text-xs text-slate-400 mt-0.5">
                Their next email then files itself &mdash; and charges R13 on its own. Leave this
                off if the address is not the debtor&rsquo;s.
              </span>
            </span>
          </label>

          {suggestions.length > 0 && (
            <div className="mt-3">
              <p className="text-sm font-medium text-slate-700">
                Also in this message <span className="font-normal text-slate-400">&mdash; tick what is right</span>
              </p>
              {/* Said once, because a number lifted off a signature looks authoritative and is
                  still a guess. */}
              <p className="text-xs text-slate-400 mt-0.5">
                Read out of what they wrote and out of their signature&rsquo;s links. Check each one.
              </p>
              {/*
                Off by default, every one of them. These are guesses from the debtor's own words,
                and a wrong number saved here is one a collector later phones.
              */}
              <div className="mt-1.5 space-y-1.5">
                {suggestions.map((c) => (
                  <label key={c.value} className="flex items-start gap-2.5 cursor-pointer">
                    <input type="checkbox" className="mt-0.5" checked={keepDetails.has(c.value)}
                      onChange={(e) => setKeepDetails((prev) => {
                        const next = new Set(prev)
                        if (e.target.checked) next.add(c.value)
                        else next.delete(c.value)
                        return next
                      })} />
                    <span className="min-w-0">
                      <span className="block text-sm text-slate-800 break-all">
                        {c.value}{' '}
                        <span className="text-slate-400">
                          &middot; {c.kind === 'mobile' ? 'Mobile' : c.kind === 'email' ? 'Another address' : 'Phone'}
                        </span>
                      </span>
                      <span className="block text-xs text-slate-400 mt-0.5 truncate">&ldquo;{c.context}&rdquo;</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <p className="text-xs text-slate-400 mt-4 flex items-start gap-1.5">
            <AlertTriangle size={13} className="shrink-0 mt-0.5 text-gold-600" />
            Matching charges the debtor R13 under item 6, correspondence received and attended
            to. It cannot be undone from here.
          </p>

          {error && <p className="text-sm text-negative-700 mt-3">{error}</p>}

          <div className="mt-5 flex items-center justify-end gap-2">
            <button onClick={onClose} disabled={busy}
              className="text-sm font-medium px-3 py-2 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              Cancel
            </button>
            <button onClick={() => void link()} disabled={busy}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500 disabled:opacity-50">
              {/*
                 The LABEL DOES NOT CHANGE while this works — only the icon does. A label that
                 swaps to a shorter word mid-click changes the button's width, and on the firm's
                 iPad that left the old glyphs painted under the new ones. Nothing is lost: the
                 spinner says it is working, and the button is disabled besides.
               */}
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
              {`Match to ${picked.label} · R13`}
            </button>
          </div>
        </>
      ) : (
      <>
      <label className="block mt-4">
        <span className="text-sm font-medium text-slate-700">Find the debtor, lead or client</span>
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          autoFocus
          placeholder="Surname, company, account number or lead number"
          className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 mt-1 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
      </label>

      {looking && <p className="text-xs text-slate-400 mt-2">Looking&hellip;</p>}

      {/*
        Two groups, and the heading on each is doing real work rather than decorating: the only
        difference an agent cannot see from a name is that the first group charges the debtor R13
        and the second charges nothing. Debtor accounts come first because this is a collections
        firm and that is what most of this mail is.
      */}
      <div className="mt-3 max-h-72 overflow-y-auto">
        {hits.length > 0 && (
          <>
            <p className="text-[11px] uppercase tracking-wide text-slate-400 pt-1 pb-1.5">
              Debtor accounts &mdash; charges R13
            </p>
            <div className="divide-y divide-slate-100">
              {hits.map((h) => (
                <button key={h.id}
                  onClick={() => setPicked({ id: h.id, label: debtorLabel(h) })}
                  className="w-full text-left px-1 py-2.5 hover:bg-slate-50">
                  <span className="block text-sm font-medium text-slate-800">{debtorLabel(h)}</span>
                  <span className="block text-xs text-slate-400">
                    {h.accountNumber ?? 'no account number'}
                    {h.clientReference && <> &middot; {h.clientReference}</>}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {crmHits.length > 0 && (
          <>
            <p className="text-[11px] uppercase tracking-wide text-slate-400 pt-3 pb-1.5">
              Leads, deals, clients &amp; contacts &mdash; no charge
            </p>
            <div className="divide-y divide-slate-100">
              {crmHits.map((h) => (
                <button key={`${h.kind}:${h.id}`} disabled={busy}
                  onClick={() => void fileOn(h)}
                  className="w-full text-left px-1 py-2.5 hover:bg-slate-50 disabled:opacity-50">
                  <span className="block text-sm font-medium text-slate-800">{h.label}</span>
                  <span className="block text-xs text-slate-400">
                    {CRM_OR_ACCOUNT[h.kind]}
                    {h.hint && h.hint !== CRM_OR_ACCOUNT[h.kind] && <> &middot; {h.hint}</>}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {term.trim().length >= 2 && !looking && hits.length === 0 && crmHits.length === 0 && (
          <p className="py-3 text-sm text-slate-400">Nothing in Raptor matches that.</p>
        )}
      </div>

      {error && <p className="text-sm text-negative-700 mt-3">{error}</p>}

      <p className="text-xs text-slate-400 mt-4 flex items-start gap-1.5">
        <AlertTriangle size={13} className="shrink-0 mt-0.5 text-gold-600" />
        Matching to a <strong className="font-medium">debtor account</strong> charges R13 under
        item 6, correspondence received and attended to, and cannot be undone from here. Matching
        to a lead, deal, client or contact charges nothing.
      </p>
      {busy && (
        <p className="text-xs text-slate-400 mt-2 inline-flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin" /> Matching&hellip;
        </p>
      )}

      {/*
        The way out, for mail that genuinely belongs to no debtor — a supplier, a colleague, the
        bank. Deliberately plain text rather than a second gold button: it is the right answer
        sometimes, and the wrong one by default, and the two should not look equally inviting.
      */}
      </>
      )}

      {replying && onSkip && (
        <div className="mt-4 pt-3 border-t border-slate-100">
          <button onClick={onSkip} disabled={busy}
            className="text-xs font-medium text-slate-500 hover:text-slate-700 underline underline-offset-2 disabled:opacity-50">
            This is not about anything in Raptor — reply without matching it
          </button>
          <p className="text-xs text-slate-400 mt-1">Nothing charged, and it appears on no account.</p>
        </div>
      )}
    </Modal>
  )
}


/**
 * Taking a message off the account it was wrongly matched to.
 *
 * UNMATCHING IS THE MAIN THING, and the box is built that way: the firm's point is that the
 * common case is "this is not theirs" and the right account is a separate question, often one
 * nobody can answer yet. Matching it to another account is offered underneath, for when somebody
 * does know.
 *
 * The fee note sits at the BOTTOM, small. It was a warning box above the fold, which put the
 * thing that does NOT happen ahead of the thing somebody came here to do. It still has to be
 * said — the R13 stays, this is not an undo — but it is a footnote, not the headline.
 */
function MoveModal({ mail, actor, onClose, onDone }: {
  mail: MailItem
  actor: { id: string | null; name: string | null }
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const was = mail.linkedTo?.label ?? 'the current account'

  /** The search is folded away until somebody says they know where it belongs. */
  const [rematching, setRematching] = useState(false)
  const [term, setTerm] = useState('')
  const [hits, setHits] = useState<DebtorAccount[]>([])
  const [looking, setLooking] = useState(false)
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(null)

  // Debounced, for the same reason the matching search is: 100 000 rows per keystroke otherwise.
  useEffect(() => {
    const q = term.trim()
    if (q.length < 2) { setHits([]); return }
    let cancelled = false
    setLooking(true)
    const t = setTimeout(() => {
      void fetchAccounts({ search: q, pageSize: 8 })
        .then((r) => { if (!cancelled) setHits(r.accounts) })
        .catch(() => { if (!cancelled) setHits([]) })
        .finally(() => { if (!cancelled) setLooking(false) })
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [term])

  async function unmatch() {
    setBusy(true)
    setError(null)
    try {
      await unmatchMail({ mail, reason, actor })
      onDone(`Unmatched from ${was}. It is back under Needs matching.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  async function rematch() {
    if (!picked) return
    setBusy(true)
    setError(null)
    try {
      const charge = await moveFiledMail({
        mail, toAccountId: picked.id, toLabel: picked.label, reason, actor,
      })
      onDone(`Rematched to ${picked.label}. ${chargeMessage(charge, '6')}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Modal title="Unmatch this email" onClose={onClose} width={520}>
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
        <p className="text-sm font-medium text-slate-800 truncate">{mail.subject || '(no subject)'}</p>
        <p className="text-xs text-slate-400 mt-0.5 truncate">
          From {mail.fromAddress} &middot; currently on {was}
        </p>
      </div>

      {/*
        THE MAIN ACTION, first and on its own. Everything else in this box is an alternative to
        it, which is the opposite of how this read before.
      */}
      <div className="mt-4 rounded-xl border border-gold-200 bg-gold-50/60 p-4">
        <p className="text-sm font-semibold text-navy-950">Take it off {was}</p>
        <p className="text-[13px] text-slate-500 mt-1">
          It goes back to <strong className="font-medium text-slate-600">Needs matching</strong>,
          where it waits with everything else. Match it to the right account whenever you work out
          which one that is.
        </p>

        <label className="block mt-3">
          <span className="text-xs font-medium text-slate-600">
            Why? <span className="font-normal text-slate-400">Optional</span>
          </span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
            placeholder="Wrong Mthembu"
            className="w-full text-sm rounded-lg border border-slate-200 bg-white px-3 py-2 mt-1 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
          {/* Kept on the message, never on the debtor's account — see unmatchMail. */}
          <span className="block text-xs text-slate-400 mt-1">
            Kept on the email, for the firm. Nothing is written onto anyone&rsquo;s account.
          </span>
        </label>

        <button onClick={() => void unmatch()} disabled={busy}
          className="mt-3 w-full inline-flex items-center justify-center gap-1.5 text-sm font-semibold px-3.5 py-2.5 rounded-lg border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500 disabled:opacity-50">
          {/* Fixed label, spinner for the wait — a label that shrinks mid-click leaves its old
              glyphs behind on the firm's iPad. */}
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Undo2 size={15} />}
          Unmatch from {was}
        </button>
      </div>

      {/* The second answer, for when somebody does know where it belongs. */}
      {!rematching ? (
        <button onClick={() => setRematching(true)} disabled={busy}
          className="mt-3 w-full text-left text-[13px] font-medium text-slate-600 hover:text-navy-950 px-1 py-1.5 disabled:opacity-50">
          <span className="inline-flex items-center gap-1.5">
            <MoveRight size={14} className="text-slate-400" />
            I know which account it should be on &mdash; match it there instead
          </span>
        </button>
      ) : (
        <div className="mt-3 rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-700 flex-1">Which account should it be on?</span>
            <button onClick={() => { setRematching(false); setPicked(null); setTerm('') }} disabled={busy}
              className="text-xs font-medium text-slate-500 hover:text-slate-700 underline underline-offset-2 disabled:opacity-50">
              Cancel
            </button>
          </div>

          {picked ? (
            <>
              <div className="mt-3 rounded-lg border border-slate-200 px-3 py-2.5 flex items-center gap-2">
                <MoveRight size={15} className="shrink-0 text-slate-400" />
                <span className="text-sm text-slate-800 min-w-0 flex-1">
                  Rematching to <strong className="font-semibold">{picked.label}</strong>
                </span>
                <button onClick={() => setPicked(null)} disabled={busy}
                  className="shrink-0 text-xs font-medium text-slate-500 hover:text-slate-700 underline underline-offset-2 disabled:opacity-50">
                  Change
                </button>
              </div>
              <button onClick={() => void rematch()} disabled={busy}
                className="mt-3 w-full inline-flex items-center justify-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg border border-slate-300 text-navy-950 hover:bg-slate-50 disabled:opacity-50">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <MoveRight size={14} />}
                Rematch to {picked.label} &middot; R13
              </button>
            </>
          ) : (
            <>
              <input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                autoFocus
                placeholder="Surname, account number or client reference"
                className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 mt-2 focus:outline-none focus:ring-2 focus:ring-brand-100"
              />
              {looking && <p className="text-xs text-slate-400 mt-2">Looking&hellip;</p>}
              <div className="mt-2 max-h-48 overflow-y-auto divide-y divide-slate-100">
                {/* The account it is already on is filtered out — matching it to itself is not a move. */}
                {hits.filter((h) => h.id !== mail.linkedAccountId).map((h) => (
                  <button key={h.id}
                    onClick={() => setPicked({ id: h.id, label: debtorLabel(h) })}
                    className="w-full text-left px-1 py-2.5 hover:bg-slate-50">
                    <span className="block text-sm font-medium text-slate-800">{debtorLabel(h)}</span>
                    <span className="block text-xs text-slate-400">
                      {h.accountNumber ?? 'no account number'}
                      {h.clientReference && <> &middot; {h.clientReference}</>}
                    </span>
                  </button>
                ))}
                {term.trim().length >= 2 && !looking && hits.length === 0 && (
                  <p className="py-3 text-sm text-slate-400">No account matches that.</p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {error && <p className="text-sm text-negative-700 mt-3">{error}</p>}

      {/*
        The footnote. It has to be said and it is not the headline: whichever way this goes, the
        R13 already raised is not reversed, because fees feed remittances and a processed
        remittance cannot be unwound. Finance corrects it forward.
      */}
      <p className="text-xs text-slate-400 mt-4 pt-3 border-t border-slate-100">
        The R13 already on {was} is not reversed either way, and the email stays on that account
        so the fee still has the correspondence behind it. Finance corrects it in the remittance.
      </p>
    </Modal>
  )
}
