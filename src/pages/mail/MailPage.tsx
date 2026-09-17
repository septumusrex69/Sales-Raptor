import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertTriangle, Ban, Check, CheckSquare, ChevronDown, ChevronRight, CircleCheck, ExternalLink,
  Inbox, Link2, Download, Loader2, Mail as MailIcon, MoveRight, Paperclip, PenLine, Reply, RefreshCw,
  Forward as ForwardIcon,
  Search, ShieldAlert, Trash2, Undo2, X, CalendarDays, CalendarPlus, ReplyAll,
  Filter, Info, UserPlus,
} from 'lucide-react'
import { Avatar } from '../../components/ui/Avatar'
import { Card } from '../../components/ui/Card'
import { RowMenu, type RowMenuItem } from '../../components/ui/RowMenu'
import { Modal } from '../../components/ui/Modal'
import { inviteHeadline, inviteWhen, parseInvite, type CalendarInvite } from '../../lib/calendarInvite.ts'
import {
  acceptInvite, eventForInvite, fetchCalendarEvents, removeCalendarEvent, type CalendarEvent,
} from '../../lib/calendarEvents.ts'
import { useAuth } from '../../store/AuthContext'
import { relativeDayLabel, timeOfDay } from '../../lib/dateLabels'
import { chargeMessage } from '../../lib/accountCharges'
import { recordSentEmail, replySubject } from '../../lib/accountEmails'
import {
  companyFromDomain, forwardBody, forwardSubject, recipientLine, recipientSummary, replyAllTo,
  splitPersonName,
} from '../../lib/emailRules'
import { ComposeEmailModal } from '../../components/ComposeEmailModal'
import { fetchAccounts, type DebtorAccount } from '../../lib/accountBook'
import { useEmailView } from '../../lib/emailView'
import { EmailViewSwitcher } from '../../components/email/EmailViewSwitcher'
import { ReadingPane } from '../../components/email/ReadingPane'
import { ZoomableImage } from '../../components/ui/ZoomableImage'
import {
  addSenderRule, blockedBy, blockSender, blockSenders, clearNoRecordNeeded, countNeedsFiling,
  countUnread, debtorFileFor, deleteMail, fetchSenderRules, markNoRecordNeeded, removeSenderRule,
  ruledBy,
  domainBlockProblem, domainOf, downloadAttachment, emptyJunk, fetchBlockedSenders, fetchMail,
  isSharedDomain,
  fetchMailBody, linkMailToAccount, linkMailToRecord, markMailRead, markMailUnread, moveFiledMail,
  saveAccountContacts, setJunk, unblockSender, unmatchMail,
  type BlockedSender, type BlockOutcome, type DebtorFile, type InlineImage, type LinkedRecord,
  type MailFilter, type MailItem, type SenderRule,
} from '../../lib/userMail'
import { useAppStore } from '../../store/AppStore'
import { LeadForm } from '../../components/layout/QuickAdd'
import { isLeadIntake, parseLeadIntake } from '../../lib/leadIntake'
import type { Lead, LeadSource } from '../../types'
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
  /*
   * Suppliers, the accountant, the telephone provider.
   *
   * Real work mail that belongs on nobody's file: not junk, and the sender must not be blocked
   * because you need their mail. Before this it lived in Needs matching for ever, and a work
   * queue with permanent residents is a queue nobody reads.
   *
   * The firm's word, and it was called "No record needed" first. That name described what the
   * database does with the row. "Free" describes the thing that actually matters to the person
   * marking it: mail on an account raises Annexure B item 6 for receiving it, and this mail
   * raises nothing. Free of a file and free of a fee, which is the same decision either way.
   */
  { id: 'no-record', label: 'Free mail', hint: 'Suppliers and the like — dealt with, on nobody\u2019s file, and nothing charged' },
  { id: 'junk', label: 'Junk', hint: 'Your mail server thought this was spam' },
  /*
   * Read off the mailbox's own Sent folder rather than only what Raptor sent, so mail sent from
   * Outlook or a phone is here too. Its own tab and no other: sent mail is not waiting to be
   * matched and is not part of the incoming working list.
   */
  { id: 'sent', label: 'Sent', hint: 'What you have sent, from anywhere' },
  { id: 'blocked', label: 'Blocked', hint: 'Senders you have blocked, and senders whose mail always arrives free' },
]

const PAGE = 50

/*
 * A colour per sender, the same one every time.
 *
 * The point of an avatar in a mail list is not decoration -- it is that the eye finds a
 * correspondent before it reads a word, which is how anybody actually scans a mailbox. That only
 * works if the colour is STABLE: derived from the address, so today's message from this debtor is
 * the same colour as last week's, and a random or index-based colour would be worse than none.
 *
 * Deep enough to carry white initials at every one of them; the palette was picked for that and
 * not for variety.
 */
const SENDER_COLOURS = [
  '#1f3a5f', '#7a5230', '#3f5c3a', '#5a3a5c', '#2f5d5f', '#6b3b3b', '#3b4a6b', '#6b5a2f',
]
function senderColour(address: string): string {
  let hash = 0
  for (let i = 0; i < address.length; i += 1) hash = (hash * 31 + address.charCodeAt(i)) >>> 0
  return SENDER_COLOURS[hash % SENDER_COLOURS.length]
}

/** A debtor by name, falling back to whatever else identifies the account. */
const debtorLabel = (a: DebtorAccount) =>
  [a.debtorFirstName, a.debtorSurname].filter(Boolean).join(' ')
  || a.accountNumber
  || 'Unnamed debtor'

export function MailPage() {
  const { currentUser, session } = useAuth()
  // Only for logging a reply on a lead, deal, client or contact — see the reply handler.
  const { addActivity } = useAppStore()
  const navigate = useNavigate()
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
  /** The message being settled — the box that also offers to settle the sender for good. */
  const [settling, setSettling] = useState<MailItem | null>(null)
  const [senderRules, setSenderRules] = useState<SenderRule[]>([])
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
  /** The message a new lead is being made out of. See CreateLeadFromMailModal. */
  const [creatingLead, setCreatingLead] = useState<MailItem | null>(null)
  /** The lead that came out of it, until somebody says where they would rather be. */
  const [createdLead, setCreatedLead] = useState<Lead | null>(null)
  /*
   * Set when the link modal was opened by Reply rather than by the Link button, so that filing
   * the message hands straight over to the composer instead of dropping you back on the list to
   * find it again.
   */
  const [linkThenReply, setLinkThenReply] = useState(false)
  const [replying, setReplying] = useState<MailItem | null>(null)
  /** Whether the open reply is answering everybody. Decides the Cc the composer opens with. */
  const [replyAll, setReplyAll] = useState(false)
  /*
   * WHICH ADDRESS IS ME.
   *
   * Asked of the mailbox rather than taken from the login, because they are not always the same
   * person's: mail can be read from a connected mailbox that differs from the address somebody
   * signs in with. Both are used, because either one being on the original is enough to mean "me"
   * -- and being copied on your own reply-all doubles the thread every round.
   */
  const [mailbox, setMailbox] = useState<string | null>(null)
  useEffect(() => {
    const token = session?.access_token
    if (!token) return
    let cancelled = false
    void fetch('/api/email/status', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((b: { email?: string | null }) => { if (!cancelled) setMailbox(b.email ?? null) })
      /* Not knowing costs a reply-all one address it might have dropped, not the mailbox. */
      .catch(() => {})
    return () => { cancelled = true }
  }, [session])
  /** A brand-new message to anybody. Not a reply, so it carries no thread and no record. */
  const [composing, setComposing] = useState(false)
  /** A message being passed on, with the original underneath it. */
  const [forwarding, setForwarding] = useState<{ mail: MailItem; body: string; complete: boolean } | null>(null)
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
  /** Pictures that were in the message and were too large to carry, so the page can say so. */
  const [imagesSkipped, setImagesSkipped] = useState<Record<string, number>>({})
  /** The raw ICS of a meeting request, kept beside its text. Parsed on render — see parseInvite. */
  const [calendars, setCalendars] = useState<Record<string, string>>({})
  /*
   * This person's own calendar, so an invite already accepted says so rather than offering to add
   * it a second time. Loaded once; accepting one adds to it in place.
   */
  const [events, setEvents] = useState<CalendarEvent[]>([])

  /**
   * Put a meeting request on this person's own calendar.
   *
   * The event is added to the list in place rather than by refetching: the card is looking at
   * `events` to decide whether to say "in your calendar", and a round trip there would leave the
   * button reading "Add" for a second after somebody pressed it.
   */
  async function accept(invite: CalendarInvite, mailId: string) {
    if (!currentUser) return
    const event = await acceptInvite({ invite, ownerId: currentUser.id, userEmailId: mailId })
    setEvents((list) => [...list.filter((e) => e.id !== event.id), event])
    setStatus(`Added to your Raptor calendar${event.startsAt || event.startsOn ? '' : ' \u2014 without a time, because the invite did not give one in any timezone'}.`)
  }

  async function dropEvent(id: string) {
    await removeCalendarEvent(id)
    setEvents((list) => list.filter((e) => e.id !== id))
    setStatus('Taken off your Raptor calendar.')
  }
  useEffect(() => {
    if (!currentUser) return
    let cancelled = false
    void fetchCalendarEvents(currentUser.id)
      .then((list) => { if (!cancelled) setEvents(list) })
      /* A calendar we could not read costs a button its "already added" state, not the mailbox. */
      .catch(() => {})
    return () => { cancelled = true }
  }, [currentUser])
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
    // The other half of the same question — which senders never need matching. Loaded together
    // because the Blocked tab shows both and the same version counter refreshes them.
    void fetchSenderRules(currentUser.id)
      .then((list) => { if (!cancelled) setSenderRules(list) })
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
      const { text, details, images, imagesSkipped: skipped, calendar } = await fetchMailBody(mail.id, token)
      setBodies((b) => ({ ...b, [mail.id]: text }))
      setCalendars((c) => ({ ...c, [mail.id]: calendar }))
      // Kept beside the text: these came out of the message's LINKS, which is the only thing an
      // image signature leaves behind.
      setLinkedDetails((d) => ({ ...d, [mail.id]: details }))
      setBodyImages((i) => ({ ...i, [mail.id]: images }))
      setImagesSkipped((n) => ({ ...n, [mail.id]: skipped }))
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
  function startReply(mail: MailItem, all = false) {
    setReplyAll(all)
    // Filed anywhere is enough — a lead's reply belongs on the lead, and the composer says
    // plainly that nothing will be charged for it.
    if (mail.isFiled) { setReplying(mail); return }
    setLinkThenReply(true)
    setLinking(mail)
  }

  /**
   * The Cc a reply-all opens with, or undefined for an ordinary reply.
   *
   * Undefined rather than empty, because the composer shows the Cc box only when it is given one
   * — an empty Cc field on every reply is a control nobody fills in and everybody reads past.
   *
   * `mine` is the connected mailbox: it is on the original, because that is how the message
   * reached us, and left in every reply-all would drop a copy back in our own inbox.
   */
  function replyAllCc(mail: MailItem): string | undefined {
    if (!replyAll) return undefined
    const { cc } = replyAllTo({
      from: { name: mail.fromName, address: mail.fromAddress },
      to: mail.toRecipients,
      cc: mail.ccRecipients,
      mine: [mailbox, currentUser?.email].filter((a): a is string => !!a),
    })
    return recipientLine(cc)
  }

  /**
   * A bulk action has finished, so selection mode ends with it.
   *
   * Picking messages, choosing what to do with them and then having to press Done was a second
   * click that said nothing: the action IS the end of selecting. Worse, the page sat there
   * afterwards with the tick boxes still showing and nothing ticked, which reads as though the
   * action had not gone through.
   *
   * Only bulk actions call this. The single-message actions on an open message leave selection
   * alone, because they were never part of it.
   */
  async function afterBulk() {
    setSelecting(false)
    // load() clears the ticks; this clears the gutter they were sitting in.
    await load(page)
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
      await afterBulk()
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
      await afterBulk()
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
      await afterBulk()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function readChosen() {
    const ids = [...chosen]
    if (ids.length === 0) return
    try {
      await markMailRead(ids)
      await afterBulk()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  /** Back into the queue — the decision was wrong, or something changed. */
  async function undoNoRecord(mail: MailItem) {
    try {
      await clearNoRecordNeeded([mail.id])
      setStatus('Back under Needs matching.')
      setOpen(null)
      await load(page)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function noRecordChosen() {
    const ids = [...chosen]
    if (ids.length === 0) return
    try {
      const done = await markNoRecordNeeded(ids, currentUser?.id ?? null)
      const refused = ids.length - done
      setStatus(
        `${done} ${done === 1 ? 'email' : 'emails'} marked as free mail.`
        + (refused > 0 ? ` ${refused} left alone — already matched to a record.` : ''),
      )
      await afterBulk()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  /** Put them back the way they were found. */
  async function unreadChosen() {
    const ids = [...chosen]
    if (ids.length === 0) return
    try {
      await markMailUnread(ids)
      await afterBulk()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  /**
   * Put ONE message back to unread — the one that actually gets used.
   *
   * It closes the message as well, and that is the whole point rather than a nicety: leaving it
   * open would mean the very next click re-opened it and marked it read again, so the button
   * would undo itself. Closing it is also what somebody means by the action — put this back on
   * the pile, I will deal with it later.
   */
  /**
   * Start a forward, with the original underneath it.
   *
   * THE BODY IS FETCHED, not taken from the row. The mailbox stores a 240-character snippet and
   * the message itself stays in the mailbox — forwarding the snippet would send somebody a
   * truncated message with no sign it had been cut. Where the fetch fails the snippet goes
   * instead, and says so in the quoted block rather than passing itself off as the whole thing.
   */
  async function startForward(mail: MailItem) {
    const token = session?.access_token
    if (!token) { setForwarding({ mail, body: mail.snippet ?? '', complete: false }); return }
    try {
      const full = await fetchMailBody(mail.id, token)
      setForwarding({ mail, body: full.text || mail.snippet || '', complete: !!full.text })
    } catch {
      setForwarding({ mail, body: mail.snippet ?? '', complete: false })
    }
  }

  async function unreadOne(mail: MailItem) {
    // Optimistic, like marking read on open: the row goes bold at once and the write follows.
    setItems((list) => list.map((m) => (m.id === mail.id ? { ...m, readAt: null } : m)))
    setOpen(null)
    try {
      await markMailUnread([mail.id])
      setStatus('Put back as unread. It is waiting for you in the mailbox.')
      await load(page)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      await load(page)
    }
  }

  /*
   * Whether the reading pane is on screen, which decides where the search bar is drawn.
   *
   * The pane carries it in its own left column; every other state of this page -- loading, the
   * blocklist, a failed load, an empty result -- has no pane, so the bar is drawn above the list
   * instead. Worked out once, here, because two copies of this condition would eventually
   * disagree and put two search boxes on the screen.
   */
  const paneShowing = !loading && !loadFailed && filter !== 'blocked'
    && items.length > 0 && view === 'reading'

  return (
    <div className="space-y-4">
      <Card padded={false}>
        {/*
          THE MAILBOX, NAMED, AND THE ONE BUTTON THAT WRITES SOMETHING.

          The firm, on a layout they preferred: "New email at the right top. So cool." It used to
          sit at the left of a bar it shared with Check now, Select and the search box -- five
          controls of equal weight, only one of which starts anything. Up here with the mailbox
          address it has the row to itself, and everything that SORTS mail lives below with the
          tabs, where sorting belongs.

          (It was moved to the left once before, for the opposite reason: the heading's
          description made the row wrap after the button, so on an iPad the bar began with "Check
          now". Giving the title its own block fixes that properly -- the buttons cannot be
          carried anywhere by text they no longer share a row with.)
        */}
        {/*
          THE NAME AND THE BUTTONS ON ONE ROW; the explanation under it.

          They shared a wrapping row with the description, and the description is long enough that
          the buttons wrapped BELOW it -- the firm: "that sentence is very long and it goes over,
          so the new mail is moved down." Text and buttons cannot be asked to share a wrapping row
          and keep their order; this is the second time that has bitten this bar, so this time the
          two are separated rather than re-ordered.
        */}
        <div className="px-5 pt-4 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-x-4 gap-y-2 flex-wrap">
            <div className="flex items-baseline gap-2.5 min-w-0">
              <h2 className="text-lg font-semibold text-navy-950 shrink-0">Mail</h2>
              {/*
                WHICH MAILBOX, said out loud. Raptor reads a connected mailbox that is not always
                the address somebody signs in with -- a shared info@ is the ordinary case -- and an
                agent who cannot see which one they are reading cannot tell whether a message is
                missing or was simply never sent here.
              */}
              <span className="text-sm text-slate-400 truncate">{mailbox ?? currentUser?.email ?? ''}</span>
            </div>

            <div className="ml-auto shrink-0 flex items-center gap-2">
            {/*
              A message to anybody, from here. Every other compose in Raptor hangs off a record --
              a debtor, a lead, a deal -- which covers replying and covers nothing else. Writing to
              an attorney, a client's accountant or a bureau had to be done in Outlook, which is
              how a mailbox managed in one place stops being managed in one place.

              GOLD, which it was argued out of once: Select turns gold-400 while selecting is on,
              and two gold buttons on one bar would have spent the only signal saying which mode
              you are in. They are no longer on one bar. Select sits with the tabs, this sits with
              the mailbox name, and gold can go back to meaning "the thing to press".
            */}
            <button onClick={() => setComposing(true)}
              className="shrink-0 inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg border border-gold-500 bg-gold-400 text-navy-950 shadow-sm hover:bg-gold-500">
              <PenLine size={14} />
              New email
            </button>
            {/*
              Check now, as an icon. The word was carrying no weight beside a circular arrow that
              every mail client on earth uses for the same thing, and spelling it out made the pair
              read as two equal choices rather than one action and one refresh.
            */}
            <button onClick={() => void syncMine()} disabled={syncing}
              aria-label="Check for new mail now"
              title={syncing ? 'Checking your mailbox\u2026' : 'Check for new mail now'}
              className="shrink-0 inline-flex items-center justify-center px-3 py-2 rounded-lg border border-slate-200 text-slate-500 hover:border-[#c9a052] hover:bg-gold-50 disabled:opacity-50">
              {syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            </button>
            </div>
          </div>
          {/* Under the row rather than in it, so it can be as long as it needs to be. */}
          <p className="text-xs text-slate-400 mt-1.5">
            Everything stays until you match it or block the sender. Nothing is deleted on a
            timer, and nothing here is ever removed from your real mailbox.
          </p>
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
            HOW THE MAIL IS LAID OUT, at the right end of the tab row.

            Which tab you are on and how it is displayed are one question asked twice, so they
            share a line -- and it keeps these away from New email, which is the only control on
            this page that starts something rather than sorting what is already here.

            Searching and narrowing to unread are NOT here. They belong over the list itself; see
            MailSearchBar.
          */}
          <div className="shrink-0 flex items-center gap-2 py-1.5">
            {/* Junk earns its own one-tap answer: it is where the volume is and where nobody
                wants to read anything. */}
            {filter === 'junk' && items.length > 0 && (
              <button onClick={() => setEmptying(true)}
                className="shrink-0 inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-negative-700 hover:border-negative-100 hover:bg-negative-50">
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
                className={`shrink-0 inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border transition-colors ${
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
        </div>

        {/* The bulk bar only exists once something is selected — an always-visible row of
            disabled buttons is furniture. */}
        {chosen.size > 0 && (
          <div className="px-5 py-2.5 bg-gold-50 border-b border-gold-100 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-navy-950 font-medium mr-auto">{chosen.size} selected</span>
            {/*
              Read and unread, and only the one that would change something. Offering both on a
              selection that is all read means one of the two buttons is furniture, and a button
              that does nothing when you press it is worse than no button.
            */}
            {items.some((m) => chosen.has(m.id) && !m.readAt) && (
              <button onClick={() => void readChosen()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-600 hover:bg-white">
                <Check size={14} /> Mark read
              </button>
            )}
            {items.some((m) => chosen.has(m.id) && !!m.readAt) && (
              <button onClick={() => void unreadChosen()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-600 hover:bg-white">
                <MailIcon size={14} /> Mark unread
              </button>
            )}
            {/* A morning's worth of supplier mail, cleared in one go — which is how it arrives. */}
            {items.some((m) => chosen.has(m.id) && !m.isSettled) && (
              <button onClick={() => void noRecordChosen()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-600 hover:bg-white">
                <CircleCheck size={14} /> Mark as free
              </button>
            )}
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

        {/*
          SEARCHING AND NARROWING SIT OVER THE LIST, at the firm's instruction: "the search mail in
          the left with the unread only ... you can filter that stuff there."

          They used to be a box at the right end of the page's top bar and a pill at the end of the
          tab row -- two controls that do one job, in two places, neither of them near the thing
          they act on. In the reading pane they go inside the left column and stay put while it
          scrolls (see ReadingPane's listHeader); everywhere else the same bar sits directly above
          the list. Rendered here only when the pane is not, so there is never a second one.
        */}
        {filter !== 'blocked' && !paneShowing && (
          <div className="border-b border-slate-100">
            <MailSearchBar search={search} onSearch={setSearch}
              unreadOnly={unreadOnly} onUnreadOnly={setUnreadOnly} unread={unread} />
          </div>
        )}

        {loading ? (
          <div className="py-14 grid place-items-center text-slate-400">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : filter === 'blocked' ? (
          /*
           * One tab for every standing decision about a sender, because they are one question
           * asked twice: what should happen to mail from this person, before anybody reads it?
           * Splitting them across two tabs would have somebody hunting for a rule under Blocked.
           */
          <>
            <BlockedList senders={blocked} onUnblock={async (id) => {
              await unblockSender(id)
              setBlocksVersion((v) => v + 1)
              setStatus('Unblocked. Their mail appears again from the next sync — not retroactively.')
              await load(0)
            }} />
            <SenderRulesList rules={senderRules} onRemove={async (id) => {
              await removeSenderRule(id)
              setBlocksVersion((v) => v + 1)
              setStatus('Their mail will ask to be matched again. What is already settled stays settled.')
              await load(0)
            }} />
          </>
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
            listHeader={
              <MailSearchBar search={search} onSearch={setSearch}
                unreadOnly={unreadOnly} onUnreadOnly={setUnreadOnly} unread={unread} />
            }
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
              /*
                A COLUMN AT LEAST AS TALL AS THE PANE, so the floating bar has a bottom to sit on.
                Sticky alone is not enough: a three-line message ends three lines down, and the bar
                would hang there in the middle of an empty pane instead of at the foot of it. With
                min-h-full and mt-auto it is at the bottom of a short message and stays on screen
                through a long one, which is the whole behaviour the firm liked in Spark.
              */
              <div className="px-5 py-4 min-h-full flex flex-col">
                {/*
                  THE MESSAGE'S OWN HEADING: what it is about, when it came, who it is from and
                  who else was on it -- in that order, and each on its own line.

                  It used to be one truncated grey line carrying the name, the address and the day
                  together, under a subject set at the same size as a row in the list. The firm, on
                  a layout that gave the sender an avatar and a line of their own: "the name of the
                  person that's displayed at the top ... it looks much better than yours."

                  The time as well as the day, because "Today" stops being an answer the moment you
                  have two messages from the same debtor open -- see timeOfDay.
                */}
                <div className="flex items-start gap-3">
                  <h3 className="text-base font-semibold text-navy-950 min-w-0 flex-1 text-balance">
                    {m.subject || '(no subject)'}
                  </h3>
                  <span className="shrink-0 pt-1 text-xs text-slate-400 whitespace-nowrap">
                    {relativeDayLabel(m.occurredAt)}{' '}
                    <span className="tabular-nums">{timeOfDay(m.occurredAt)}</span>
                  </span>
                </div>

                <div className="flex items-start gap-3 mt-3 pb-3 mb-3 border-b border-slate-100">
                  <Avatar name={m.fromName || m.fromAddress} color={senderColour(m.fromAddress)}
                    size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm min-w-0">
                      <span className="font-semibold text-navy-950">{m.fromName || m.fromAddress}</span>
                      {/*
                        The address in angle brackets after the name, which is how every mail client
                        writes it and how anybody checking that a message really is from their client
                        expects to read it. Breaking rather than truncating: a half-shown address is
                        worse than a wrapped one, because it looks like the whole of a shorter one.
                      */}
                      {m.fromName && (
                        <span className="text-slate-400 break-words"> &lt;{m.fromAddress}&gt;</span>
                      )}
                    </p>
                    {/*
                      WHO ELSE WAS ON IT, at the firm's instruction: "I can't see all the other
                      recipients of an email." A debtor who copies their attorney, or a client who
                      copies two of their own people, read as a private message -- and somebody
                      answering it had no way to know the answer needed to reach three people.
                    */}
                    <RecipientLines mail={m} mine={[mailbox, currentUser?.email]} />
                  </div>
                  {/*
                    Where it is filed, said here rather than on every row in the list -- one place,
                    where somebody is actually looking at the message. The kind matters: "On a lead"
                    and "On a debtor account" are different enough that leaving it off would mislead.

                    Nothing here when it is filed nowhere. That case is no longer a small button in
                    the corner: it is a bar under the actions that says so and offers both ways out.
                    See NotMatchedBar.
                  */}
                  {m.linkedTo && (
                    <span className="shrink-0 text-xs text-[var(--c-green)] inline-flex items-center gap-1 pt-1">
                      <Link2 size={12} />
                      On {m.linkedTo.label}
                      <span className="text-slate-400">&middot; {CRM_OR_ACCOUNT[m.linkedTo.kind]}</span>
                    </span>
                  )}
                </div>
                <MailBody mail={m} body={bodies[m.id]} images={bodyImages[m.id]}
                  calendar={calendars[m.id]} events={events}
                  onAccept={(inv) => accept(inv, m.id)} onRemoveEvent={dropEvent}
                  skippedImages={imagesSkipped[m.id]}
                  loadingBody={reading === m.id}
                  bodyError={readError[m.id]} onBlock={() => setBlocking(m)}
                  onReply={() => startReply(m)} onReplyAll={() => startReply(m, true)}
                  onForward={() => startForward(m)} onJunk={(j) => void junkOne(m, j)}
                  onMove={mayRefile ? () => setMoving(m) : null}
                  onUnread={() => void unreadOne(m)}
                  onNoRecord={() => setSettling(m)}
                  onUndoNoRecord={() => void undoNoRecord(m)}
                  onLink={() => startLink(m)}
                  onCreateLead={() => setCreatingLead(m)}
                  sticky
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
                  mine={[mailbox, currentUser?.email]}
                  chosen={chosen.has(m.id)}
                  expanded={open === m.id}
                  blocked={blocked}
                  body={bodies[m.id]}
                  images={bodyImages[m.id]}
                  calendar={calendars[m.id]}
                  events={events}
                  onAccept={(inv) => accept(inv, m.id)}
                  onRemoveEvent={dropEvent}
                  skippedImages={imagesSkipped[m.id]}
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
                  onReplyAll={() => startReply(m, true)}
                  onForward={() => startForward(m)}
                  onJunk={(j) => void junkOne(m, j)}
                  onMove={mayRefile ? () => setMoving(m) : null}
                  onUnread={() => void unreadOne(m)}
                  onNoRecord={() => setSettling(m)}
                  onUndoNoRecord={() => void undoNoRecord(m)}
                  onCreateLead={() => setCreatingLead(m)}
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

      {settling && (
        <NoRecordModal
          mail={settling}
          userId={currentUser?.id ?? null}
          rule={ruledBy(settling.fromAddress, senderRules)}
          onClose={() => setSettling(null)}
          onDone={(message) => {
            setSettling(null); setStatus(message); setBlocksVersion((v) => v + 1); void load(0)
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

      {creatingLead && (
        <CreateLeadFromMailModal
          mail={creatingLead}
          body={bodies[creatingLead.id]}
          actor={{ id: currentUser?.id ?? null, name: currentUser?.name ?? null }}
          onClose={() => setCreatingLead(null)}
          onCreated={(lead) => {
            setCreatingLead(null)
            setCreatedLead(lead)
            /* Reloaded now rather than when the box closes, so the row behind it is already
               showing "On <the lead>" whichever way the question is answered. */
            void load(page)
          }}
        />
      )}

      {createdLead && (
        <LeadCreatedModal
          lead={createdLead}
          onClose={() => {
            setCreatedLead(null)
            setStatus('Lead created, and this email is filed on it.')
          }}
          onOpen={() => navigate(`/leads/${createdLead.id}`)}
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

      {composing && (
        <ComposeEmailModal
          contextNote={'This goes out from your mailbox and lands on no record. To put a message on '
            + 'a debtor\u2019s file, send it from the account instead — that is what charges item 1(a) '
            + 'and files the copy.'}
          onClose={() => setComposing(false)}
          onSent={() => { setComposing(false); setStatus('Sent.'); void load(page) }}
        />
      )}

      {forwarding && (
        <ComposeEmailModal
          initialSubject={forwardSubject(forwarding.mail.subject)}
          initialBody={forwardBody(forwarding.mail, forwarding.body, forwarding.complete)}
          /*
            NOT inReplyTo. A forward starts a new conversation with somebody who was not in the
            old one; threading it onto the original would file the recipient's reply against the
            debtor the original came from.
          */
          contextNote={'Forwarded from your mailbox. It lands on no record and nothing is charged '
            + '\u2014 a forward is not correspondence with the debtor.'}
          onClose={() => setForwarding(null)}
          onSent={() => { setForwarding(null); setStatus('Forwarded.'); void load(page) }}
        />
      )}

      {replying && (
        <ComposeEmailModal
          to={replying.fromAddress}
          initialCc={replyAllCc(replying)}
          initialSubject={replySubject(replying.subject)}
          /*
           * The message being answered, under the box. Falls back to the snippet where the body
           * has not been fetched -- 240 characters of it is still the difference between knowing
           * what you are answering and guessing.
           */
          quoted={bodies[replying.id] ?? replying.snippet ?? undefined}
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
              /*
               * THE ACTIVITY, WHICH WAS NOT BEING WRITTEN.
               *
               * This branch already told the agent "Reply sent and logged on Acme" and then
               * logged nothing: ComposeEmailModal hands the sent subject and body back for the
               * caller to record, the account branch below records it through recordSentEmail,
               * and this one simply returned. So a reply to a lead went out, the agent was told
               * it was on the lead's history, and it was on nothing — the worst shape a message
               * can take, because nobody goes looking for what they were told is already there.
               *
               * Written the same way the lead and deal pages write their own sent mail: one
               * Email activity carrying the subject and body. No charge, and there is nothing to
               * charge — Annexure B prices collecting a debt, and none of these is a debt.
               */
              const on = answering?.linkedTo
              if (on) {
                addActivity({
                  type: 'Email',
                  // Kept with the modal's "Email sent: " framing, which is the CRM activity
                  // convention on the lead and deal pages. Stripped only on the account side,
                  // where account_emails stores the debtor's own subject line.
                  subject: rawSubject,
                  notes: bodyText,
                  emailMessageId: messageId ?? undefined,
                  leadId: on.kind === 'lead' ? on.id : undefined,
                  dealId: on.kind === 'deal' ? on.id : undefined,
                  companyId: on.kind === 'client' ? on.id : undefined,
                  contactId: on.kind === 'contact' ? on.id : undefined,
                })
              }
              // Said plainly rather than left to be discovered. The agent chose this path.
              setStatus(on
                ? `Reply sent and logged on ${on.label}. No charge — Annexure B is for debtor accounts.`
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
    'needs-filing': 'Nothing waiting. Every email has been matched, settled or thrown away.',
    filed: 'Nothing matched to a record yet.',
    'no-record': 'Nothing here yet. Mark a supplier\u2019s email as free and it lands here.',
    all: 'Your mailbox is empty. Connect it under Settings → Integrations if you have not yet.',
    // Junk is a shelf, not a bin: nothing here has been deleted, it is just kept out of All.
    junk: 'Nothing in junk.',
    sent: 'Nothing sent yet. This fills from your mailbox\u2019s Sent folder, so mail you send from Outlook or your phone shows here too.',
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
/**
 * Searching this mailbox, and narrowing it to what has not been read.
 *
 * One component with two homes -- inside the reading pane's list column, or above the plain list
 * -- because they are the same control over the same list and drifting into two would be two
 * places to fix a search that stopped working.
 *
 * UNREAD IS A DROPDOWN, not a tab and not a toggle. It narrows whichever tab you are standing on,
 * so "unread junk" and "unread that still needs matching" are both askable; a tab could only ever
 * have answered one of them. The count rides in the option itself, which is the honest place for
 * it -- it is the number of rows choosing that option leaves behind.
 */
function MailSearchBar({ search, onSearch, unreadOnly, onUnreadOnly, unread }: {
  search: string
  onSearch: (value: string) => void
  unreadOnly: boolean
  onUnreadOnly: (on: boolean) => void
  /** Unread within the tab and search already applied, so the number matches what you would get. */
  unread: number
}) {
  return (
    <div className="px-4 py-3 flex items-center gap-2">
      <label className="relative min-w-0 flex-1">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search mail&hellip;"
          aria-label="Search your mailbox"
          className="w-full text-sm rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
      </label>

      {/*
        A real <select>: the keyboard, the screen reader and an iPad's own picker all come free,
        and the firm works on iPads. Styled rather than rebuilt, so what is on screen is still the
        control the browser knows about.
      */}
      <div className="relative shrink-0">
        <Filter size={13} aria-hidden
          className={`absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none ${
            unreadOnly ? 'text-brand-700' : 'text-slate-400'}`} />
        <select
          value={unreadOnly ? 'unread' : 'all'}
          onChange={(e) => onUnreadOnly(e.target.value === 'unread')}
          aria-label="Narrow this list"
          className={`appearance-none text-sm font-medium rounded-lg border pl-7 pr-7 py-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-100 ${
            /* Tinted while it is narrowing, because a filter you cannot see is on is a mailbox
               with mail missing from it. */
            unreadOnly
              ? 'border-brand-500 bg-brand-50 text-brand-700'
              : 'border-slate-200 bg-white text-slate-600'}`}
        >
          <option value="all">All mail</option>
          <option value="unread">{unread > 0 ? `Unread only \u00b7 ${unread}` : 'Unread only'}</option>
        </select>
        <ChevronDown size={13} aria-hidden
          className={`absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none ${
            unreadOnly ? 'text-brand-700' : 'text-slate-400'}`} />
      </div>
    </div>
  )
}

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
      ) : mail.noRecordAt ? (
        /* Settled, but on nobody's file — so it must not wear the green "Matched" chip, which
           would have a supplier's invoice claiming to be on somebody's account. */
        <span className={`${chip} bg-slate-100 text-slate-500`}
          title="Dealt with — it belongs on nobody's file and nothing was charged">
          <CircleCheck size={10} className="shrink-0" />
          <span className="truncate">{tight ? 'Free' : 'Free mail'}</span>
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
    <span className="flex items-start gap-3 min-w-0">
      {/*
        The sender, as a face before it is a name. See senderColour -- the colour is the whole
        point, and it is why this is worth the width: a mailbox is scanned by correspondent, and
        recognising one takes a glance where reading a name takes a beat.

        A span, because this whole summary renders inside a button and a div there is invalid.
      */}
      <Avatar name={mail.fromName || mail.fromAddress} color={senderColour(mail.fromAddress)}
        size={tight ? 32 : 36} />

      <span className="block min-w-0 flex-1">
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
    </span>
  )
}

/**
 * Everything you can do with an open message, in one bar, in one of two places.
 *
 * See the placement note in MailBody: floating at the foot of the reading pane, an ordinary row at
 * the top of an expanded list row. Written once so the two cannot end up offering different things.
 */
function MessageActions({
  mail, sticky, moreActions, onReply, onReplyAll, onForward, onUnread,
}: {
  mail: MailItem
  sticky: boolean
  moreActions: RowMenuItem[]
  onReply: () => void
  onReplyAll: () => void
  onForward: () => void
  onUnread: () => void
}) {
  /*
   * SPARK'S BAR, WHICH THE FIRM SENT OVER: "I kind of like the one that Spark did better -- it's
   * smaller and it's kind of nicer ... it stays there, so if you scroll up or down through the
   * email it kind of stays there as a little bar."
   *
   * A floating pill at the foot of the message, icon-only, with the overflow at one end and the
   * one action you actually came for set apart at the other. Three things follow from that shape
   * and each of them is the point:
   *
   *  - IT FLOATS, so the old complaint ("it's sitting there at the bottom and I have to scroll
   *    down all the way to do anything") does not come back. It is at the bottom AND always on
   *    screen, which the version at the top of the message only managed by being in the way.
   *  - IT IS ICONS, which is where the bulk went. Six labelled buttons and a record name wrapped
   *    onto a second row on an iPad; six icons do not.
   *  - REPLY KEEPS ITS WORD. Spark's accent button is separated and unlabelled, and a row of
   *    near-identical arrows is fine for somebody who uses Spark all day. A collector should not
   *    have to work out which arrow is reply-all, so the ones that are only arrows carry tooltips
   *    and the one that matters carries its name.
   */
  return (
    <div className={sticky
      /* pointer-events-none on the rail so the bar does not swallow clicks on the message under
       it; restored on the pill itself, which is the only part anybody aims at. */
      ? 'sticky bottom-3 z-20 mt-auto pt-4 flex justify-center pointer-events-none'
      : 'flex flex-wrap items-center gap-1.5 pb-2'}>
      <div className={sticky
      ? 'pointer-events-auto inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-white/95 backdrop-blur px-1.5 py-1 shadow-lg'
      : 'contents'}>

      {/*
        Not yet, which is a legitimate answer. Without it, opening a message to see whether it
        was urgent was the same act as deciding it was not. First, as it is in Spark.
      */}
      <BarButton sticky={sticky} onClick={onUnread} label="Mark unread" icon={<MailIcon size={15} />} />

      {/*
        REPLY ALL, at the firm's instruction: "I also can't respond to all recipients." A debtor
        who copies their attorney was answered privately, so the attorney never saw the answer
        to the question they had been copied on.

        Absent where nobody else was on it, rather than present and doing the same as Reply.
      */}
      {(mail.toRecipients.length + mail.ccRecipients.length) > 1 && (
        <BarButton sticky={sticky} onClick={onReplyAll} label="Reply all" icon={<ReplyAll size={15} />} />
      )}

      {/*
        FORWARD, which Reply alone could not cover. Passing a debtor's dispute to the client who
        has to answer it, or a mandate to the attorney, is everyday work that otherwise meant
        opening Outlook — and mail managed in two places is mail managed in neither.
      */}
      <BarButton sticky={sticky} onClick={onForward} label="Forward" icon={<ForwardIcon size={15} />} />

      {/*
        Through to the debtor's file, which is the other half of managing mail from one place:
        the message is here, but the balance, the arrangement and the history are there.

        Still a Link, because middle-click and "open in new tab" both work on one and neither
        survives being anything else — which matters when you are working a message and want
        the account beside it. Its label lives in the tooltip on the bar, where the record name
        was the widest thing on the row and the reason it wrapped.
      */}
      {mail.linkedTo && (
        <Link to={mail.linkedTo.path} title={`Open ${mail.linkedTo.label}`}
          aria-label={`Open ${mail.linkedTo.label}`}
          className={sticky
            ? 'inline-flex items-center justify-center w-9 h-9 rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800'
            : 'inline-flex items-center gap-1 min-w-0 max-w-[15rem] text-[13px] font-medium px-2 py-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-50'}>
          <ExternalLink size={15} className="shrink-0" />
          {!sticky && <span className="truncate">Open {mail.linkedTo.label}</span>}
        </Link>
      )}

      {/*
        The rest, behind the dots. They are filing decisions -- taken once per message and never
        in a hurry -- so they cost a click and buy back a bar that reads at a glance.
      */}
      <div className={sticky ? '' : 'ml-auto'}>
        <RowMenu width="w-56" bordered={!sticky} up={sticky}
          label="More things to do with this message" items={moreActions} />
      </div>

      {/* A hairline, so the thing you came for is not just another icon in the row. */}
      {sticky && <span aria-hidden className="mx-1 w-px h-5 bg-slate-200" />}

      {/*
        REPLY, set apart, where Spark puts its own accent button. It is the whole reason the
        mailbox stopped being read-only: answering a debtor used to mean finding their account
        and starting again there, so the mailbox was a filing tray rather than a place you
        worked. What it does depends on whether this message is on an account yet -- see
        startReply.
      */}
      <button onClick={onReply}
        className={`inline-flex items-center gap-1.5 font-medium border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500 ${
          sticky ? 'text-[13px] px-3.5 py-1.5 rounded-full' : 'text-[13px] px-3 py-1.5 rounded-lg'}`}>
        <Reply size={15} /> Reply
      </button>
      </div>
    </div>

  )
}

/**
 * One icon on that bar.
 *
 * Icon-only where it floats and labelled where it does not, because the two placements have
 * different room and the same buttons. A tooltip AND an aria-label on both: an icon with neither
 * is a button nobody can name, and "which arrow was reply-all?" is exactly the question a
 * collector should not have to answer from memory.
 */
function BarButton({ sticky, onClick, label, icon }: {
  sticky: boolean
  onClick: () => void
  label: string
  icon: ReactNode
}) {
  return (
    <button onClick={onClick} title={label} aria-label={label}
      className={sticky
        ? 'inline-flex items-center justify-center w-9 h-9 rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800'
        : 'inline-flex items-center gap-1.5 text-[13px] font-medium px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'}>
      {icon}
      {!sticky && label}
    </button>
  )
}

/** The message itself, shared by the expanded row and the reading pane. */
function MailBody({
  mail, body, images, calendar, events, onAccept, onRemoveEvent, skippedImages, loadingBody,
  bodyError, onBlock, onReply, onReplyAll, onForward, onJunk, onMove, onUnread, onNoRecord,
  onUndoNoRecord, onLink, onCreateLead, onDownload, downloading, downloadError, sticky,
}: {
  mail: MailItem
  body?: string
  /** The raw ICS where this was a meeting request. Parsed here — see parseInvite. */
  calendar?: string
  /** This person's calendar, so an invite already on it says so. */
  events: CalendarEvent[]
  onAccept: (invite: CalendarInvite) => Promise<void>
  onRemoveEvent: (id: string) => Promise<void>
  /** Pictures drawn into the message — a signature, nearly always. */
  images?: InlineImage[]
  /** How many were left behind for being too big. Said out loud rather than left as a gap. */
  skippedImages?: number
  loadingBody: boolean
  bodyError?: string
  onBlock: () => void
  onReply: () => void
  /**
   * Answer everybody who was on it.
   *
   * Offered only where there IS somebody else — a message addressed to one person has nothing
   * for this button to do, and one that does nothing is one people stop believing.
   */
  onReplyAll: () => void
  /** Pass it on to somebody who was not in the conversation — an attorney, the client. */
  onForward: () => void
  /** Shelve it, or rescue it. Absent on filed mail, which is a record either way. */
  onJunk: (junk: boolean) => void
  /** Unmatch it, or rematch it from the same box. Null for anyone who is not an administrator. */
  onMove: (() => void) | null
  /** Put it back on the pile, and close it. */
  onUnread: () => void
  /** It belongs on nobody's file — a supplier, the accountant, a service provider. */
  onNoRecord: () => void
  /** Undo that, and put it back in the queue. */
  onUndoNoRecord: () => void
  /** Put it on a record -- the picker, which searches leads, deals, clients and the book. */
  onLink: () => void
  /**
   * Make a NEW lead out of the sender and file the message on it.
   *
   * The half the picker could never cover: an enquiry from somebody the firm has never dealt with
   * matches nothing, and the honest answer was to leave the mailbox, add a lead, come back and
   * find the message again. Three screens for the most valuable email of the day.
   */
  onCreateLead: () => void
  /**
   * Pin the toolbar to the top of the pane it is scrolling in.
   *
   * Only in the reading pane, where the message has a scroll container of its own. In the list an
   * open message scrolls with the page, and a bar stuck to the top of the window there would sit
   * over whichever OTHER message happened to be under it.
   */
  sticky?: boolean
  /** Pull one attachment out of the mailbox. */
  onDownload: (filename: string) => void
  /** The file currently being fetched, so its own button shows the wait. */
  downloading: string | null
  downloadError: string | null
}) {
  /*
   * The overflow menu's contents, decided here rather than in the markup.
   *
   * Each entry carries its own reason for being offered at all:
   *
   * - UNMATCH is only on mail filed on a DEBTOR account, and only where the caller may refile it —
   *   the database refuses it for anybody else, so offering the button would be a lie. It is ONE
   *   item and it says Unmatch, because two items made the agent choose between "rematch" and
   *   "unmatch" before knowing which they could do, and the answer to "which account should this
   *   be on?" is frequently "I do not know yet". The box behind it offers rematching underneath.
   * MARK UNREAD IS NOT HERE. It is on the bar itself, where Spark puts it and where it belongs:
   * it is the one of these that gets pressed in a hurry -- "not yet", said while scanning -- and
   * it was in both places for one commit, which is one place too many.
 *
   * - FREE MAIL is the third answer to "what is this?" and the one the mailbox had no word for. A
   *   telephone provider's invoice is not junk and belongs on no account. Hidden on matched mail:
   *   that is on a record and a fee may have been raised against it, so calling it free would be a
   *   contradiction the database refuses anyway.
   * - JUNK sits between "file it" and "block them": this message is not work, without claiming
   *   anything about the sender. Hidden on filed mail — a message on a record is neither junk nor
   *   anybody's to reclassify.
   * - BLOCK is last and is the only one marked as damage. It is the one action you should have
   *   read something before taking, which is why it is on the open message and not on every row —
   *   and it is offered even on mail already filed, because blocking is about future noise and not
   *   about the message in front of you.
   */
  const moreActions: RowMenuItem[] = [
    ...(mail.linkedTo?.kind === 'account' && onMove
      ? [{ label: 'Unmatch', icon: <Undo2 size={15} />, onClick: onMove }]
      : []),
    ...(!mail.isFiled
      ? [mail.noRecordAt
        ? { label: 'Put back in the queue', icon: <Undo2 size={15} />, onClick: onUndoNoRecord }
        : { label: 'Mark as free', icon: <CircleCheck size={15} />, onClick: onNoRecord }]
      : []),
    ...(!mail.isFiled
      ? [mail.isJunk
        ? { label: 'Not junk', icon: <Undo2 size={15} />, onClick: () => onJunk(false) }
        : { label: 'Move to junk', icon: <ShieldAlert size={15} />, onClick: () => onJunk(true) }]
      : []),
    /* "Block", to match the Blocked tab. The long phrasing described the mechanism; this names
       the thing, and the two now obviously belong together. */
    { label: 'Block sender', icon: <Ban size={15} />, onClick: onBlock, danger: true },
  ]

  /* Gathered once, because the bar renders in one of two places and a second argument list would
     be a second set of buttons waiting to happen. */
  const bar = {
    mail, sticky: !!sticky, moreActions, onReply, onReplyAll, onForward, onUnread,
  }

  return (
    <>
      {/*
        IN THE LIST, THE ACTIONS STAY AT THE TOP, at the firm's earlier instruction: "it's sitting
        there at the bottom and I have to scroll down all the way to do anything."

        That complaint is about a bar you have to REACH. Spark's floating one never has to be
        reached -- it is at the foot of the pane and always on screen -- so in the reading pane it
        goes to the bottom and floats. An expanded row in the list has no scroll container of its
        own, so there is nothing for a bar to float in and nothing to stop it sitting over the next
        message; there it stays an ordinary row, above the message, where it always was.

        One component, two placements, so the two cannot drift into different sets of buttons.
      */}
      {!sticky && <MessageActions {...bar} />}

      {/*
        WHERE THIS MESSAGE IS FILED, and both ways of fixing it when the answer is nowhere.

        A "Match" button in the corner of the header said what to press and never said why, so an
        unmatched message looked exactly like a matched one to anybody not already looking for the
        difference. It is the state that costs money -- a reply sent from an unmatched message goes
        out earning nothing -- so it states itself.
      */}
      <NotMatchedBar mail={mail} onLink={onLink} onCreateLead={onCreateLead} />
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

      {/* A rule under the controls, so the message reads as the message and not as more toolbar. */}
      <div className="border-b border-slate-100 mb-3" />

      {/*
        A MEETING REQUEST, READ. Until now an invite rendered as "This message has no text in it":
        its body is a text/calendar part, and the reader took text/plain and text/html only. A
        collector could see somebody had written and nothing about what was being asked.

        Above the message text on purpose. Where there IS text as well it is the organiser's
        covering note, and what the meeting actually is beats a note about it.
      */}
      {!loadingBody && (
        <InviteCard ics={calendar} events={events} onAccept={onAccept} onRemove={onRemoveEvent} />
      )}

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
      {!loadingBody && body !== undefined && !images?.length && !!skippedImages && (
        /* A gap with no explanation reads as a broken feature — which is exactly how the first
           version of this was reported. If the picture is not here, the message says why. */
        <p className="text-xs text-slate-400 mt-3">
          {skippedImages === 1
            ? 'One picture in this message was too large to show here.'
            : `${skippedImages} pictures in this message were too large to show here.`}
        </p>
      )}

      {!loadingBody && images && images.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-400 mb-1.5">
            In this message
          </p>
          <div className="flex flex-wrap items-start gap-2">
            {images.map((img, i) => (
              <ZoomableImage
                key={img.cid || img.filename || i}
                src={img.dataUri}
                /* A signature picture has no useful alt text of its own; naming it as one is
                   more honest to a screen reader than an empty string or a filename. */
                alt={img.filename || 'Image from this message'}
                /*
                  Twice the height it used to be. A signature sets its own telephone number in
                  about eight points, and at 160px the number was there but not readable — which
                  is no better than not showing it. The width cap still stops a full-width
                  letterhead pushing the reading pane wide, and it is the width that binds on a
                  phone; click it for anything bigger.
                */
                className="max-w-full max-h-80 w-auto block"
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

      {sticky && <MessageActions {...bar} />}

    </>
  )
}

/**
 * A meeting request, as the four things somebody needs to decide whether to go.
 *
 * WHAT IT DOES NOT DO IS PRETEND. Raptor has no calendar to put a meeting in -- CalendarPage
 * renders tasks and deal dates, there is no events table and no connection to Outlook or Google
 * -- so there is no Accept button here. A button that notified the organiser and put the meeting
 * nowhere would be worse than none: the collector would believe it was in their day.
 *
 * The .ics is attached to the message and downloads from the row above, which opens in whatever
 * calendar they actually use. That is the honest answer until Raptor has one of its own.
 */
/**
 * Where this message is filed, when the answer is nowhere.
 *
 * SAID, not implied. An unmatched message used to look exactly like a matched one apart from a
 * small "Match" button in the corner of the header, and that is the state that costs money: item
 * 1(a) is R25 on every message we send and a fee can only be raised against an account, so a reply
 * typed on an unmatched message goes out earning nothing and leaves no trace on any statement.
 *
 * TWO WAYS OUT, because there are two reasons a message matches nothing:
 *
 *  - It belongs to somebody already on the system and just has not been joined up yet. That is the
 *    picker, which searches leads, deals, clients and the whole book.
 *  - It is from somebody the firm has never dealt with. That is a new lead -- and it is the most
 *    valuable email of the day, so it should not be the one that sends you to another screen.
 *
 * Nothing is charged either way. Annexure B is for debtor accounts; the sales side raises nothing.
 */
function NotMatchedBar({ mail, onLink, onCreateLead }: {
  mail: MailItem
  onLink: () => void
  onCreateLead: () => void
}) {
  /* Filed mail has its answer, and free mail has been given one deliberately -- neither is a
     loose end, and a bar over both would be a warning that fires when nothing is wrong. */
  if (mail.isFiled || mail.noRecordAt) return null

  /*
   * AN ENQUIRY OFF THE WEBSITE IS NOT A QUESTION. Every other unmatched message asks one -- debtor,
   * client, nobody? -- and form@bredellferreira.co.za has exactly one answer, so the two buttons
   * swap places and the wording stops hedging. Offering "Match to a record" first here would send
   * somebody hunting the book for a stranger who by definition is not in it.
   */
  const fromForm = isLeadIntake(mail.fromAddress)

  const primary = 'inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500'
  const secondary = 'inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-slate-300'

  return (
    <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3
      flex flex-wrap items-center gap-x-3 gap-y-2.5">
      <Info size={16} className="shrink-0 text-slate-400" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-800">
          {fromForm ? 'A new enquiry off the website' : 'Not matched yet'}
        </p>
        <p className="text-xs text-slate-400 mt-0.5">
          {fromForm
            ? 'It came through the contact form, so it belongs to nobody yet. Their details are in the message.'
            : 'This email is not on a lead, a deal or a debtor account. Replying from here will not appear on any record.'}
        </p>
      </div>
      <div className="shrink-0 flex items-center gap-2">
        {fromForm ? (
          <>
            <button onClick={onCreateLead} className={primary}>
              <UserPlus size={15} /> Create lead
            </button>
            <button onClick={onLink} className={secondary}>
              <Link2 size={15} /> Match instead
            </button>
          </>
        ) : (
          <>
            <button onClick={onLink} className={primary}>
              <Link2 size={15} /> Match to a record
            </button>
            <button onClick={onCreateLead} className={secondary}>
              <UserPlus size={15} /> Create lead
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * To and Cc, under the sender, on ONE LINE EACH.
 *
 * The firm, on three recipients spread down four lines: "all of this is underneath each other,
 * make it in a line next to each other to save space, because it's becoming bulky down there."
 *
 * The saving is in what is printed, not in the font. `recipientLine` writes real header values --
 * "Stephan Ferreira <stephan@bredellferreira.co.za>" -- because that is what goes into a Cc box
 * and out on the wire; on screen the addresses are the part nobody reads and four fifths of the
 * width. So: names, the mailbox owner as "you", and the full list in the title for the one time
 * somebody does need to check an address.
 *
 * Absent entirely where there is nobody to name: a message addressed to one person, which is most
 * of them, gains nothing from a line saying so. Mail synced before these columns existed has
 * empty lists and is silent for the same reason -- it says nothing rather than claiming nobody
 * else was on it.
 */
function RecipientLines({ mail, mine }: {
  mail: MailItem
  /** The addresses that are this agent's, so they read as "you" rather than as a third name. */
  mine?: (string | null | undefined)[]
}) {
  if (mail.toRecipients.length === 0 && mail.ccRecipients.length === 0) return null
  const own = (mine ?? []).filter((a): a is string => !!a)
  const line = 'text-xs text-slate-400 truncate'
  /*
   * "+4" RATHER THAN A CUT-OFF LINE, which is Spark's and is what the firm sent over. A clipped
   * line ends mid-address and says nothing about how much was clipped; a count is exact, and nine
   * people on a message is itself worth knowing before you answer it.
   */
  return (
    <div className="mt-0.5">
      {mail.toRecipients.length > 0 && (
        <p className={line} title={recipientLine(mail.toRecipients)}>
          <span className="text-slate-500">To:</span> {recipientSummary(mail.toRecipients, own)}
        </p>
      )}
      {mail.ccRecipients.length > 0 && (
        <p className={line} title={recipientLine(mail.ccRecipients)}>
          <span className="text-slate-500">Cc:</span> {recipientSummary(mail.ccRecipients, own)}
        </p>
      )}
    </div>
  )
}

function InviteCard({ ics, events, onAccept, onRemove }: {
  ics?: string
  events: CalendarEvent[]
  onAccept: (invite: CalendarInvite) => Promise<void>
  onRemove: (id: string) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const invite = parseInvite(ics)
  if (!invite) return null

  const when = inviteWhen(invite.when)
  const people = invite.attendees.filter((a) => a.name || a.email)
  const already = eventForInvite(events, invite)

  async function run(work: () => Promise<void>) {
    setBusy(true); setError(null)
    try { await work() } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className={`mb-3 rounded-lg border px-3 py-2.5 ${
      /* A cancellation is not an invitation and must not look like one. */
      invite.cancelled ? 'border-negative-100 bg-negative-50' : 'border-gold-300 bg-gold-50'
    }`}>
      <p className={`text-[11px] uppercase tracking-wide font-medium inline-flex items-center gap-1.5 ${
        invite.cancelled ? 'text-negative-700' : 'text-[var(--c-gold-deep)]'
      }`}>
        <CalendarDays size={12} /> {inviteHeadline(invite)}
      </p>

      <p className={`text-sm font-medium mt-1 break-words ${
        invite.cancelled ? 'text-negative-700 line-through' : 'text-navy-950'
      }`}>
        {invite.summary ?? 'Untitled meeting'}
      </p>

      <dl className="mt-1.5 space-y-0.5">
        {when && <InviteLine label="When" value={when} note={invite.repeats} />}
        {invite.location && <InviteLine label="Where" value={invite.location} />}
        {invite.organiser && (
          <InviteLine label="Called by"
            value={invite.organiser.name ?? invite.organiser.email ?? 'Unknown'}
            note={invite.organiser.name ? invite.organiser.email : null} />
        )}
        {people.length > 0 && (
          <InviteLine label={people.length === 1 ? 'Also asked' : `Also asked (${people.length})`}
            value={people.slice(0, 4).map((a) => a.name ?? a.email).join(', ')
              + (people.length > 4 ? `, and ${people.length - 4} more` : '')} />
        )}
      </dl>

      {invite.cancelled ? (
        <p className="text-[11px] text-negative-700 mt-1.5">
          The organiser has called this off. Nothing to add.
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {busy && <Loader2 size={13} className="animate-spin text-slate-400" />}
          {already ? (
            /*
              ALREADY ON IT, AND THE UNDO BESIDE IT. Matched on the invite's UID rather than on
              its title and time, because a revised invitation changes the time and is still the
              same meeting -- which is exactly when somebody presses the button again.
            */
            <>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-positive-700">
                <Check size={12} /> In your Raptor calendar
              </span>
              <button type="button" disabled={busy} onClick={() => void run(() => onRemove(already.id))}
                className="text-[11px] font-medium text-slate-500 hover:underline">
                Take it off
              </button>
            </>
          ) : (
            <button type="button" disabled={busy} onClick={() => void run(() => onAccept(invite))}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500 disabled:opacity-50">
              <CalendarPlus size={13} /> Add to my calendar
            </button>
          )}
          {/*
            WHAT THIS DOES NOT DO, said plainly. Adding it here does not tell the organiser
            anything -- that is an iTIP reply and Raptor does not send one yet. Somebody who
            believed the organiser had been told would not turn up expected.
          */}
          <span className="text-[11px] text-slate-500">
            {already
              ? 'The organiser has not been told either way \u2014 reply if they are expecting one.'
              : 'Goes on your Raptor calendar only. The organiser is not notified.'}
          </span>
        </div>
      )}

      {/*
        A FLOATING TIME CANNOT BE PUT IN A DAY. The invite named no zone, which means "whatever
        the reader's clock says" -- so it is stored without one and the calendar shows it as
        undated rather than inventing an hour.
      */}
      {!invite.cancelled && invite.when.startsAt && !invite.when.allDay && !invite.when.timeZone && (
        <p className="text-[11px] text-gold-700 mt-1.5">
          The invite gives no timezone, so this cannot be placed at an hour with any confidence.
        </p>
      )}

      {error && <p className="text-[11px] text-negative-700 mt-1.5">{error}</p>}
    </div>
  )
}

/** One line of the invite. Values wrap; a Teams link is long and must not push the pane wide. */
function InviteLine({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <div className="flex flex-wrap gap-x-2 text-[11px]">
      <dt className="text-slate-500 shrink-0">{label}</dt>
      <dd className="text-slate-800 min-w-0 break-words">
        {value}
        {note && <span className="text-slate-400"> · {note}</span>}
      </dd>
    </div>
  )
}

function MailRow({
  mail, chosen, expanded, selecting, blocked, body, images, calendar, events, onAccept,
  onRemoveEvent, skippedImages, loadingBody,
  bodyError, mine, onToggle, onChoose, onLink, onCreateLead, onBlock, onReply, onReplyAll,
  onForward, onJunk, onMove,
  onUnread, onNoRecord, onUndoNoRecord, onDownload, downloading, downloadError,
}: {
  mail: MailItem
  /** The raw ICS where this was a meeting request. Passed through to MailBody. */
  calendar?: string
  events: CalendarEvent[]
  onAccept: (invite: CalendarInvite) => Promise<void>
  onRemoveEvent: (id: string) => Promise<void>
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
  /** And how many were left behind for being too big. */
  skippedImages?: number
  loadingBody: boolean
  bodyError?: string
  onToggle: () => void
  onChoose: (on: boolean) => void
  onLink: () => void
  onBlock: () => void
  onReply: () => void
  onReplyAll: () => void
  onForward: () => void
  onJunk: (junk: boolean) => void
  onMove: (() => void) | null
  onUnread: () => void
  onNoRecord: () => void
  onUndoNoRecord: () => void
  onCreateLead: () => void
  /** This agent's own addresses, so a recipient line can say "you" instead of naming them. */
  mine: (string | null | undefined)[]
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
          {/*
            WHO ELSE WAS ON IT, here as well as in the reading pane. The firm: "I can't see all the
            other recipients of an email." Offering Reply all on a row that never says who would be
            copied is worse than not offering it -- the one thing somebody must be able to check
            before pressing it is the list.
          */}
          <div className="-mt-1 mb-2.5">
            <RecipientLines mail={mail} mine={mine} />
          </div>
          <MailBody mail={mail} body={body} images={images} calendar={calendar}
            events={events} onAccept={onAccept} onRemoveEvent={onRemoveEvent}
            skippedImages={skippedImages}
            loadingBody={loadingBody}
            bodyError={bodyError} onBlock={onBlock} onReply={onReply} onReplyAll={onReplyAll}
            onForward={onForward} onJunk={onJunk}
            onMove={onMove} onUnread={onUnread}
            onNoRecord={onNoRecord} onUndoNoRecord={onUndoNoRecord}
            onLink={onLink} onCreateLead={onCreateLead} onDownload={onDownload}
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

/**
 * Senders whose mail never needs matching, newest first.
 *
 * Sits under the blocklist on the same tab, because they answer one question — what happens to
 * this sender's mail before anybody reads it — with opposite answers. Keeping them apart would
 * have somebody looking for a rule under "Blocked" and concluding it was never saved.
 *
 * The heading says what it does rather than naming the feature, because "rules" means nothing to
 * somebody who did not build it.
 */
function SenderRulesList({ rules, onRemove }: {
  rules: SenderRule[]
  onRemove: (id: string) => Promise<void>
}) {
  const [busy, setBusy] = useState<string | null>(null)
  return (
    <div className="border-t border-slate-100">
      <div className="px-5 py-3 bg-slate-50/70">
        <p className="text-sm font-semibold text-slate-700">Always free</p>
        <p className="text-xs text-slate-400 mt-0.5">
          Suppliers and the like. Their mail still arrives and is still searchable &mdash; it
          simply lands already dealt with instead of joining the queue.
        </p>
      </div>

      {rules.length === 0 ? (
        <p className="px-5 py-6 text-center text-xs text-slate-400">
          Nothing yet. Open a supplier&rsquo;s email, choose &ldquo;Mark as free&rdquo;, and
          you can settle the sender for good from there.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rules.map((r) => (
            <li key={r.id} className="px-5 py-3 flex items-center gap-3">
              <span className="shrink-0 grid place-items-center w-7 h-7 rounded-full bg-slate-100 text-slate-400">
                <CircleCheck size={13} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800 truncate">
                  {r.kind === 'domain' ? `Anyone at ${r.pattern}` : r.pattern}
                </p>
                <p className="text-xs text-slate-400 truncate">
                  Added {relativeDayLabel(r.createdAt).toLowerCase()}
                  {r.label && <> &middot; {r.label}</>}
                </p>
              </div>
              <button
                disabled={busy === r.id}
                onClick={async () => {
                  setBusy(r.id)
                  try { await onRemove(r.id) } finally { setBusy(null) }
                }}
                className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50">
                {busy === r.id ? <Loader2 size={12} className="animate-spin" /> : 'Remove'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
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
/**
 * "This belongs on nobody's file", and optionally "nor does anything else from them".
 *
 * Deliberately the same shape as the Block box, because the two questions are neighbours and an
 * agent should not have to learn a second layout to answer one of them. What they MEAN is
 * opposite, and the copy says so plainly: blocking stops the mail existing in Raptor at all,
 * this lets it in and stops it asking for attention.
 *
 * The sender rule is the half that earns its keep. A supplier writes every week, and settling
 * the same address fifty times a year is the sort of chore that ends with somebody blocking them
 * instead — and then losing an invoice.
 */
function NoRecordModal({ mail, userId, rule, onClose, onDone }: {
  mail: MailItem
  userId: string | null
  /** A standing rule already covering this sender, if there is one. */
  rule: SenderRule | null
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const domain = domainOf(mail.fromAddress)
  const domainProblem = domainBlockProblem(mail.fromAddress)

  async function settle(scope: 'address' | 'domain' | null) {
    if (!userId) return
    setBusy(true)
    setError(null)
    try {
      const done = await markNoRecordNeeded([mail.id], userId)
      if (done === 0) {
        setError('That email is on a record already, so it stays matched.')
        setBusy(false)
        return
      }
      if (!scope) {
        onDone('Marked as free mail. It is out of the queue and still in your mailbox.')
        return
      }
      const { pattern, settled } = await addSenderRule({
        userId, address: mail.fromAddress, scope, label: mail.fromName ?? null,
      })
      onDone(
        `Nothing from ${pattern} will ask to be matched again.`
        + (settled > 1 ? ` ${settled} of their messages settled.` : '')
        + ' Their mail still arrives, and you can still match it later.',
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Modal title="Free mail" onClose={onClose} width={480}>
      <p className="text-sm text-slate-500">
        For mail that is real work but belongs on nobody&rsquo;s file &mdash; a supplier, the
        accountant, a service provider. It leaves <strong className="font-medium text-slate-600">
        Needs matching</strong>, stays in All, stays searchable, and stays in your real mailbox.
        Nothing is deleted and no fee is raised.
      </p>

      {rule && (
        /* Saying so up front, because otherwise the second and third buttons look like they do
           nothing — the rule is already there and pressing them changes nothing. */
        <p className="text-xs text-slate-500 mt-3 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
          You already have a rule for <span className="font-medium">{rule.pattern}</span>, so their
          mail arrives settled. This one predates it.
        </p>
      )}

      <div className="mt-4 space-y-2">
        <button disabled={busy} onClick={() => void settle(null)}
          className="w-full text-left px-3.5 py-3 rounded-lg border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500 disabled:opacity-50">
          <span className="block text-sm font-semibold">Just this message</span>
          <span className="block text-xs text-navy-950/70 mt-0.5">
            One decision, this once.
          </span>
        </button>

        <button disabled={busy || !!rule} onClick={() => void settle('address')}
          className="w-full text-left px-3.5 py-3 rounded-lg border border-slate-200 hover:border-[#c9a052] hover:bg-gold-50 disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:bg-transparent">
          <span className="block text-sm font-medium text-slate-800">
            And never ask about this address again
          </span>
          <span className="block text-xs text-slate-400 mt-0.5 truncate">{mail.fromAddress}</span>
        </button>

        <button disabled={busy || !!rule || !!domainProblem} onClick={() => void settle('domain')}
          title={domainProblem ?? undefined}
          className="w-full text-left px-3.5 py-3 rounded-lg border border-slate-200 hover:border-[#c9a052] hover:bg-gold-50 disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:bg-transparent">
          <span className="block text-sm font-medium text-slate-800">
            Or anyone at {domain ?? 'this domain'}
          </span>
          <span className="block text-xs text-slate-400 mt-0.5">
            {domainProblem ?? 'A whole firm — their accounts desk, their support desk, all of them.'}
          </span>
        </button>
      </div>

      {error && (
        <p className="text-sm text-negative-700 mt-3 flex items-start gap-1.5">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          {error}
        </p>
      )}

      {/* The distinction that matters, said where somebody is about to choose. */}
      <p className="text-xs text-slate-400 mt-4">
        This is not a block. Their mail still arrives and is still searchable, and you can still
        match it to a record later if it turns out to belong on one. Rules are yours alone and
        come off again under the Blocked tab.
      </p>
      {busy && (
        <p className="text-xs text-slate-400 mt-2 inline-flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin" /> Settling&hellip;
        </p>
      )}
    </Modal>
  )
}

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
  /*
   * Whether this can be blocked at all, asked when the box opens rather than after the click.
   *
   * It used to offer both choices, let you press one, and only then say no — with a footnote
   * underneath stating the rule in general terms, which read as a caution rather than a refusal.
   * The address is on the file because a tick box put it there at matching time, so the agent has
   * no memory of it and nothing on screen said which account to go and look at. A dead end.
   */
  const [onFile, setOnFile] = useState<DebtorFile | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    void debtorFileFor(mail.fromAddress)
      .then((f) => { if (alive) setOnFile(f) })
      // A lookup that fails must not silently turn the guard off: blockSender checks again on the
      // server side and refuses there, so the worst case is the old behaviour, not a wrong block.
      .catch(() => { if (alive) setOnFile(null) })
    return () => { alive = false }
  }, [mail.fromAddress])
  const checking = onFile === undefined
  const refused = !!onFile

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
      {/*
        The refusal comes first and says what to do about it, because it is the whole answer: no
        amount of reading the rest helps if this address cannot be blocked.
      */}
      {refused && onFile && (
        <div className="rounded-lg border border-gold-200 bg-gold-50 p-3.5 mb-4">
          <p className="text-sm text-navy-950 flex items-start gap-1.5">
            <AlertTriangle size={14} className="shrink-0 mt-0.5 text-gold-600" />
            <span>
              <span className="font-medium">{mail.fromAddress}</span> is saved as a contact on{' '}
              <span className="font-medium">{onFile.label}</span>
              {onFile.accountNumber ? ` (${onFile.accountNumber})` : ''}.
            </span>
          </p>
          <p className="text-xs text-slate-500 mt-2">
            Blocking it would stop that debtor&rsquo;s mail reaching Raptor at all, and because a
            blocked sender never becomes a row, nobody would see it go missing. Take the address
            off the account first, then block it.
          </p>
          {/*
            The way out. It usually got onto the file by the tick box when this message was
            matched — so Unmatch offers to take it off again, which is the one-click route.
          */}
          <Link to={`/accounts/${onFile.accountId}`}
            className="inline-flex items-center gap-1.5 mt-3 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-slate-300">
            <ExternalLink size={13} /> Open {onFile.label}
          </Link>
        </div>
      )}

      <p className="text-sm text-slate-500">
        Their mail will stop appearing in Raptor from the next sync, and anything of theirs still
        sitting here will be cleared out. It stays in your real mailbox &mdash; this only stops
        Raptor taking a copy.
      </p>

      <div className="mt-4 space-y-2">
        <button disabled={busy || checking || refused} onClick={() => void block('address')}
          className="w-full text-left px-3.5 py-3 rounded-lg border border-slate-200 hover:border-[#c9a052] hover:bg-gold-50 disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:bg-transparent">
          <span className="block text-sm font-medium text-slate-800">Just this address</span>
          <span className="block text-xs text-slate-400 mt-0.5 truncate">{mail.fromAddress}</span>
        </button>

        <button disabled={busy || checking || refused || !!domainProblem} onClick={() => void block('domain')}
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

      {/* The general rule is said above, and only when it applies. What is left is the part that
          is true either way. */}
      <p className="text-xs text-slate-400 mt-4">
        Reversible from the Blocked tab, though unblocking is not retroactive &mdash; it lets
        their next message in, not the ones already skipped.
      </p>
      {(busy || checking) && (
        <p className="text-xs text-slate-400 mt-2 inline-flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin" />
          {busy ? 'Blocking\u2026' : 'Checking whether this address is on a debtor\u2019s file\u2026'}
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
/**
 * A NEW LEAD, OUT OF AN EMAIL FROM SOMEBODY NOBODY KNOWS YET.
 *
 * The picker answers "which of our records is this?" and has nothing to say when the answer is
 * "none of them, yet" — which is the case for the single most valuable email the firm gets. Before
 * this, the honest route was: read the enquiry, leave the mailbox, add a lead, come back, find the
 * message again, match it. Three screens, and the step people skipped was the last one, so the
 * enquiry that started the relationship was not on the lead that came out of it.
 *
 * THE REAL LEAD FORM, at the firm's instruction: "it should use the same lead form as adding an
 * actual lead -- this one is a small version, it should actually make a lead." So this is a
 * wrapper: it works out what to prefill, hands LeadForm the values, and takes over what happens
 * after the lead is saved. A second, shorter form would have drifted within a month.
 *
 * WHERE THE PREFILLS COME FROM depends on who sent it, and the difference matters:
 *
 *  - FROM THE WEBSITE'S FORM, the From header is the firm's OWN address. Reading the lead's
 *    details off it would put form@bredellferreira.co.za on the lead — and saved there it would
 *    match every later enquiry to that same lead, so one afternoon's five enquiries would file
 *    themselves on one stranger. Everything comes out of the body instead. See parseLeadIntake.
 *  - FROM ANYBODY ELSE, the header is the person. The name is split out of one field, the company
 *    read off the domain but never off gmail, and their address is theirs.
 *
 * Every one of them is a guess in an editable box, in front of somebody reading the message.
 */
function CreateLeadFromMailModal({ mail, body, actor, onClose, onCreated }: {
  mail: MailItem
  /** The message text, where it has been fetched — the only source for a form enquiry. */
  body?: string
  actor: { id: string | null; name: string | null }
  onClose: () => void
  /** The lead exists and the email is on it. The caller asks where to go next. */
  onCreated: (lead: Lead) => void
}) {
  const store = useAppStore()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  const text = body ?? mail.snippet ?? ''
  const fromForm = isLeadIntake(mail.fromAddress)
  const intake = fromForm ? parseLeadIntake(text) : {}
  const split = splitPersonName(mail.fromName)
  const domain = domainOf(mail.fromAddress)

  const initial = fromForm
    ? {
      /*
       * THE NAME IS THE ONE THING THE HEADER IS RIGHT ABOUT. The firm's form posts a Contact
       * Number, a Company or Business Name and a Subject -- and no name field at all, because it
       * puts the person's name in the From display name instead. So the body is asked first and
       * the header is the fallback, which is the opposite way round from every other field here.
       */
      firstName: intake.firstName ?? split.firstName,
      lastName: intake.lastName ?? split.lastName,
      companyName: intake.companyName ?? '',
      phone: intake.phone ?? '',
      /*
       * NEVER THE FROM HEADER. It is form@bredellferreira.co.za -- the firm's own address -- and
       * saved on a lead it would match every later enquiry to that same lead. Blank is the honest
       * answer where the form did not ask for one, and the Contact Number is what makes the lead
       * reachable.
       */
      email: intake.email ?? '',
      source: 'Website' as LeadSource,
    }
    : {
      firstName: split.firstName,
      lastName: split.lastName,
      /* Only where the domain says something: "Gmail" in the Company box is worse than a blank. */
      companyName: isSharedDomain(mail.fromAddress) ? '' : companyFromDomain(domain),
      phone: '',
      email: mail.fromAddress,
      /* Email, because that is literally where this one came from. */
      source: 'Email' as LeadSource,
    }

  return (
    <LeadForm
      store={store}
      navigate={navigate}
      onClose={onClose}
      title="Create lead"
      initial={initial}
      intro={(
        <>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 mb-4">
            <p className="text-sm font-medium text-slate-800 truncate">{mail.subject || '(no subject)'}</p>
            <p className="text-xs text-slate-400 mt-0.5 truncate">
              {fromForm
                ? 'An enquiry off the website\u2019s contact form. Their details are read out of the message, not off the sender.'
                : `From ${mail.fromAddress}`}
            </p>
          </div>
          {/*
            NOTHING IS CHARGED, and it says so. Annexure B prices work on DEBTOR ACCOUNTS; the sales
            side raises no fees at all. The rest of this page talks about money constantly, so
            silence here would read as "some fee, unstated".
          */}
          <p className="text-xs text-slate-400 -mt-1 mb-3">
            This email is filed on the lead once it is saved. Nothing is charged &mdash; Annexure B
            prices work on debtor accounts, and the sales side raises no fees.
          </p>
          {error && <p className="text-sm text-negative-700 mb-3">{error}</p>}
        </>
      )}
      onCreated={(lead) => {
        /*
         * FILED ON THE NEW LEAD IN THE SAME BREATH, which is the whole point of doing this from the
         * mailbox. A lead created from an email that is not then carrying that email is the same
         * three-screen problem with one screen removed.
         *
         * The lead is already saved by the time this runs, so a failure here is not a reason to
         * pretend nothing happened: it is reported and the lead is handed on regardless.
         */
        void linkMailToRecord({
          mail,
          to: {
            kind: 'lead',
            id: lead.id,
            label: [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.companyName,
          },
          actor,
        })
          .then(() => onCreated(lead))
          .catch((e: unknown) => setError(
            `The lead was created, but this email could not be filed on it: ${
              e instanceof Error ? e.message : String(e)}`,
          ))
      }}
    />
  )
}

/**
 * The lead exists. Where would you rather be?
 *
 * At the firm's instruction: "once it says lead created, it should ask you -- go back to mail, or
 * go to the lead." Both are real answers and neither is right for everybody: somebody working a
 * morning's enquiries wants the next message, and somebody who has just met their best lead of the
 * week wants to phone them.
 *
 * Asked rather than assumed, because the wrong guess is expensive in one direction — thrown out of
 * a queue you were half way through — and free in the other.
 */
function LeadCreatedModal({ lead, onClose, onOpen }: {
  lead: Lead
  onClose: () => void
  onOpen: () => void
}) {
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.companyName
  return (
    <Modal title="Lead created" onClose={onClose} width={440}>
      <p className="text-sm text-slate-600">
        <strong className="font-semibold text-slate-800">{name}</strong> is on the leads list
        {lead.companyName && name !== lead.companyName ? ` at ${lead.companyName}` : ''}, and this
        email is filed on it.
      </p>
      <p className="text-xs text-slate-400 mt-2">
        Nothing was charged &mdash; Annexure B is for debtor accounts.
      </p>
      <div className="flex items-center justify-end gap-2 mt-5">
        <button onClick={onClose}
          className="text-sm font-medium px-3.5 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
          Back to the mail
        </button>
        <button onClick={onOpen}
          className="text-sm font-medium px-3.5 py-2 rounded-lg border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500">
          Open the lead
        </button>
      </div>
    </Modal>
  )
}

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

  /*
   * Is the sender's address saved as a contact on the very account we are taking this off?
   *
   * Because that is the same mistake seen twice. Matching a message ticks "save this address" by
   * default, so a newsletter matched to a debtor by accident ends up ON their file — and from
   * then on it cannot be blocked, with nothing anywhere saying why. That happened: a Yahoo
   * Finance brief was matched to a debtor, unmatched again, and blocking it was still refused.
   *
   * Offered, never assumed. The address may have been the debtor's all along with only this one
   * message matched wrongly, and quietly deleting a real contact is not ours to decide.
   */
  const [savedOnFile, setSavedOnFile] = useState<DebtorFile | null>(null)
  const [alsoRemove, setAlsoRemove] = useState(false)
  useEffect(() => {
    let alive = true
    void debtorFileFor(mail.fromAddress)
      .then((f) => {
        // Only when it is on THIS account. On another debtor's file it is somebody else's fact.
        if (alive && f && f.accountId === mail.linkedAccountId) setSavedOnFile(f)
      })
      .catch(() => { /* Not knowing just means the tick box is not offered. */ })
    return () => { alive = false }
  }, [mail.fromAddress, mail.linkedAccountId])

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
      const removeContact = alsoRemove && !!savedOnFile
      await unmatchMail({ mail, reason, actor, removeContact })
      /*
       * WHERE IT ACTUALLY WENT, not where it usually goes.
       *
       * This said "It is back under Needs matching" unconditionally, and for a junk message that
       * is simply false — Needs matching excludes junk, so the agent unmatched a newsletter, was
       * told where to find it, looked there, and found an empty list. Junk is the common case
       * for an unmatch, too: matching a newsletter to a debtor by mistake is exactly the thing
       * being undone.
       *
       * A message settled some other way (marked as free mail, or still on a lead or a
       * deal) is not in Needs matching either, and saying so beats sending somebody hunting.
       */
      const landsIn = mail.isJunk ? 'Junk'
        : mail.noRecordAt ? 'Free mail'
          : 'Needs matching'
      onDone(
        `Unmatched from ${was}. You will find it under ${landsIn}.`
        + (removeContact ? ` ${mail.fromAddress} is off their contacts, so it can be blocked now.` : ''),
      )
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

        {/*
          The address that came with it. Only shown when there is one, so the ordinary unmatch —
          a debtor's genuine reply on the wrong file — is not cluttered by it.
        */}
        {savedOnFile && (
          <label className="flex items-start gap-2 mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 cursor-pointer">
            <input type="checkbox" checked={alsoRemove} disabled={busy}
              onChange={(e) => setAlsoRemove(e.target.checked)} className="mt-0.5 shrink-0" />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-slate-700">
                Also take {mail.fromAddress} off their contacts
              </span>
              <span className="block text-xs text-slate-400 mt-0.5">
                It was saved onto this account when the email was matched. While it is there the
                sender cannot be blocked. Leave it if the address really is theirs.
              </span>
            </span>
          </label>
        )}

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
