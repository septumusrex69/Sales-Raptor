import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, Inbox, Link2, Loader2, Paperclip, RefreshCw,
  Search, ShieldAlert, Trash2,
} from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Modal } from '../../components/ui/Modal'
import { useAuth } from '../../store/AuthContext'
import { relativeDayLabel } from '../../lib/dateLabels'
import { chargeMessage } from '../../lib/accountCharges'
import { fetchAccounts, type DebtorAccount } from '../../lib/accountBook'
import {
  deleteMail, fetchMail, fetchMailBody, linkMailToAccount, markMailRead,
  type MailFilter, type MailItem,
} from '../../lib/userMail'

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
const TABS: { id: MailFilter; label: string; hint: string }[] = [
  { id: 'needs-filing', label: 'Needs filing', hint: 'Not yet on an account' },
  { id: 'filed', label: 'Filed', hint: 'Already on a debtor account' },
  { id: 'junk', label: 'Junk', hint: 'Your mail server thought this was spam' },
  { id: 'all', label: 'All', hint: 'Everything in the last 30 days' },
]

const PAGE = 50

/** A debtor by name, falling back to whatever else identifies the account. */
const debtorLabel = (a: DebtorAccount) =>
  [a.debtorFirstName, a.debtorSurname].filter(Boolean).join(' ')
  || a.accountNumber
  || 'Unnamed debtor'

export function MailPage() {
  const { currentUser, session } = useAuth()
  const [filter, setFilter] = useState<MailFilter>('needs-filing')
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<MailItem[]>([])
  const [more, setMore] = useState(false)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [linking, setLinking] = useState<MailItem | null>(null)
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
  const [reading, setReading] = useState<string | null>(null)
  const [readError, setReadError] = useState<Record<string, string>>({})

  const load = useCallback(async (at = 0) => {
    if (!currentUser) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetchMail({
        userId: currentUser.id, filter, search, offset: at * PAGE, limit: PAGE,
      })
      setItems(res.items)
      setMore(res.more)
      setPage(at)
      setChosen(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [currentUser, filter, search])

  useEffect(() => { void load(0) }, [load])

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
      const text = await fetchMailBody(mail.id, token)
      setBodies((b) => ({ ...b, [mail.id]: text }))
    } catch (e) {
      // The snippet stays on screen, so this explains the gap rather than leaving it blank.
      setReadError((prev) => ({ ...prev, [mail.id]: e instanceof Error ? e.message : String(e) }))
    } finally {
      setReading(null)
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
              The last 30 days. Anything you do not file is removed from Raptor automatically
              &mdash; it stays in your real mailbox either way.
            </p>
          </div>
          <label className="relative">
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
        </div>

        <div className="border-b border-slate-200">
          <div className="px-5 flex gap-1 overflow-x-auto -mb-px">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setFilter(t.id)} title={t.hint}
                className={`shrink-0 px-3.5 py-2 text-sm font-medium border-b-2 ${
                  filter === t.id ? 'border-gold-500 text-navy-950' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                {t.label}
              </button>
            ))}
          </div>
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
        ) : items.length === 0 ? (
          <Empty filter={filter} searching={!!search.trim()} />
        ) : (
          <>
            <div className="px-5 py-2 border-b border-slate-100">
              <label className="inline-flex items-center gap-2 text-xs text-slate-500">
                <input type="checkbox" checked={allChosen}
                  onChange={(e) => setChosen(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())} />
                Select all on this page
              </label>
            </div>
            <ul className="divide-y divide-slate-100">
              {items.map((m) => (
                <MailRow key={m.id} mail={m}
                  chosen={chosen.has(m.id)}
                  expanded={open === m.id}
                  body={bodies[m.id]}
                  loadingBody={reading === m.id}
                  bodyError={readError[m.id]}
                  onToggle={() => void toggle(m)}
                  onChoose={(on) => setChosen((s) => {
                    const next = new Set(s)
                    if (on) next.add(m.id)
                    else next.delete(m.id)
                    return next
                  })}
                  onLink={() => setLinking(m)} />
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

      {linking && (
        <LinkModal
          mail={linking}
          actor={{ id: currentUser?.id ?? null, name: currentUser?.name ?? null }}
          onClose={() => setLinking(null)}
          onDone={(message) => { setLinking(null); setStatus(message); void load(page) }}
        />
      )}
    </div>
  )
}

function Empty({ filter, searching }: { filter: MailFilter; searching: boolean }) {
  if (searching) return <p className="py-14 text-center text-sm text-slate-400">Nothing matches that.</p>
  const words: Record<MailFilter, string> = {
    'needs-filing': 'Nothing waiting. Every email has been filed or thrown away.',
    filed: 'Nothing filed against an account yet.',
    junk: 'Nothing in junk.',
    all: 'Your mailbox is empty. Connect it under Settings → Integrations if you have not yet.',
  }
  return (
    <div className="py-14 text-center">
      <Inbox size={22} className="mx-auto text-slate-300" />
      <p className="text-sm text-slate-500 mt-3">{words[filter]}</p>
    </div>
  )
}

function MailRow({
  mail, chosen, expanded, body, loadingBody, bodyError, onToggle, onChoose, onLink,
}: {
  mail: MailItem
  chosen: boolean
  expanded: boolean
  /** The full text, once fetched. Undefined until then. */
  body?: string
  loadingBody: boolean
  bodyError?: string
  onToggle: () => void
  onChoose: (on: boolean) => void
  onLink: () => void
}) {
  const unread = !mail.readAt
  return (
    <li className={unread ? 'bg-positive-50/40' : undefined}>
      <div className="px-5 py-3 flex items-start gap-3">
        {/*
          The checkbox sits OUTSIDE the button that opens the message. Nesting one inside the
          other means ticking a row to delete it also opens and reads it, which is the opposite
          of what somebody clearing spam wants.
        */}
        <input type="checkbox" checked={chosen} onChange={(e) => onChoose(e.target.checked)}
          aria-label={`Select the email from ${mail.fromAddress}`} className="mt-1.5 shrink-0" />

        <button onClick={onToggle} aria-expanded={expanded}
          className="min-w-0 flex-1 text-left">
          <span className="flex items-baseline gap-2">
            {unread && <span className="w-1.5 h-1.5 rounded-full bg-positive shrink-0 self-center" />}
            <span className={`text-sm truncate ${unread ? 'font-semibold text-navy-950' : 'font-medium text-slate-800'}`}>
              {mail.subject || '(no subject)'}
            </span>
            {mail.attachmentNames.length > 0 && <Paperclip size={12} className="shrink-0 text-slate-400" />}
            {mail.isJunk && (
              <span className="shrink-0 inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                <ShieldAlert size={10} /> Junk
              </span>
            )}
          </span>
          <span className="block text-xs text-slate-400 mt-0.5 truncate">
            {mail.fromName || mail.fromAddress}
            {mail.fromName && <span className="text-slate-300"> &middot; {mail.fromAddress}</span>}
            {' · '}{relativeDayLabel(mail.occurredAt)}
          </span>
          {/* Collapsed, the snippet is the preview. Open, the whole message replaces it below. */}
          {!expanded && mail.snippet && (
            <span className="block text-[13px] text-slate-500 mt-1 line-clamp-2">{mail.snippet}</span>
          )}
          {mail.linkedAccount && (
            <span className="text-xs text-[var(--c-green)] mt-1.5 inline-flex items-center gap-1">
              <Link2 size={11} />
              On {mail.linkedAccount.debtorName ?? 'an account'}
              {mail.linkedAccount.accountNumber && <> &middot; {mail.linkedAccount.accountNumber}</>}
            </span>
          )}
        </button>

        <div className="shrink-0 flex items-center gap-2 pt-0.5">
          {/* Linked mail offers nothing: it is on an account, it raised a fee, and it is not
              anybody's to re-file or delete. The database refuses both as well. */}
          {!mail.linkedAccountId && (
            <button onClick={onLink}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gold-500 bg-gold-400 text-navy-950">
              <Link2 size={13} /> Link to account
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
          {loadingBody && (
            <p className="text-[13px] text-slate-400 inline-flex items-center gap-1.5">
              <Loader2 size={13} className="animate-spin" /> Fetching the message from your mailbox&hellip;
            </p>
          )}

          {!loadingBody && body !== undefined && (
            /*
             * The message as it was written. `whitespace-pre-wrap` because an email's own line
             * breaks carry meaning — collapsing them turns a numbered arrangement into a
             * paragraph. `break-words` because a pasted URL would otherwise push the page wide.
             *
             * Rendered as TEXT, never as HTML: this is mail from outside the building, and
             * putting a stranger's markup into the page is not worth faithful formatting.
             */
            <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">
              {body.trim() || <span className="text-slate-400">This message has no text in it.</span>}
            </p>
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
            <p className="text-xs text-slate-400 mt-3">
              {/* Names only. The files stay in the mailbox — see fetchAttachment. */}
              <Paperclip size={11} className="inline mr-1" />
              {mail.attachmentNames.join(', ')}
            </p>
          )}
        </div>
      )}
    </li>
  )
}

/**
 * Choosing which account a message belongs to.
 *
 * A search rather than a list: there are 100 000 accounts, and the agent already has the name or
 * the number in front of them on the email.
 */
function LinkModal({ mail, actor, onClose, onDone }: {
  mail: MailItem
  actor: { id: string | null; name: string | null }
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [term, setTerm] = useState('')
  const [hits, setHits] = useState<DebtorAccount[]>([])
  const [looking, setLooking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  async function link(accountId: string, label: string) {
    setBusy(true)
    setError(null)
    try {
      const charge = await linkMailToAccount({ mail, accountId, actor })
      onDone(`Filed on ${label}. ${chargeMessage(charge, '6')}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Modal title="Which account is this about?" onClose={onClose} width={520}>
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
        <p className="text-sm font-medium text-slate-800 truncate">{mail.subject || '(no subject)'}</p>
        <p className="text-xs text-slate-400 mt-0.5 truncate">From {mail.fromAddress}</p>
        {mail.snippet && <p className="text-[13px] text-slate-500 mt-1.5">{mail.snippet.slice(0, 160)}</p>}
      </div>

      <label className="block mt-4">
        <span className="text-sm font-medium text-slate-700">Find the debtor</span>
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          autoFocus
          placeholder="Surname, account number or client reference"
          className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 mt-1 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
      </label>

      {looking && <p className="text-xs text-slate-400 mt-2">Looking&hellip;</p>}

      <div className="mt-3 max-h-64 overflow-y-auto divide-y divide-slate-100">
        {hits.map((h) => (
          <button key={h.id} disabled={busy}
            onClick={() => void link(h.id, debtorLabel(h))}
            className="w-full text-left px-1 py-2.5 hover:bg-slate-50 disabled:opacity-50">
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

      {error && <p className="text-sm text-negative-700 mt-3">{error}</p>}

      <p className="text-xs text-slate-400 mt-4 flex items-start gap-1.5">
        <AlertTriangle size={13} className="shrink-0 mt-0.5 text-gold-600" />
        Filing this charges the debtor R13 under item 6, correspondence received and attended to.
        It cannot be undone from here.
      </p>
      {busy && (
        <p className="text-xs text-slate-400 mt-2 inline-flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin" /> Filing&hellip;
        </p>
      )}
    </Modal>
  )
}
