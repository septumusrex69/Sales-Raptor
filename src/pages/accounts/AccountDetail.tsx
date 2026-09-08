import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  AlertTriangle, ArrowLeft, Check, CheckCircle2, Loader2, Mail, MessageCircle, MessageSquare,
  Phone, Plus, Printer, ShieldAlert, StickyNote, X, XCircle,
} from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { DashboardHero } from '../../components/dashboard/DashboardHero'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { StatusPill } from './AccountsList'
import { fetchAccount, fetchLedgers, hasCommissionDrift, type AccountLedgers, type DebtorAccount } from '../../lib/accountBook'
import { buildStatement, type BalanceInput, type BalanceBreakdown, type StatementLine } from '../../lib/accountBalance'
import {
  addNote, addPromise, fetchDocuments, fetchWorkspace, isOverdue, nextPromise, resolvePromise,
  saveMainComment, type AccountDocument, type PromiseToPay, type Workspace,
} from '../../lib/accountWorkspace'
import { buildTimeline, groupByDay, type TimelineEntry } from '../../lib/accountTimeline'
import { styleFor, PROMISE_CHIP } from './timelineStyle'
import { DebtorDetailsPanel, DocumentsPanel, MainComment, useWriter } from './AccountWorkspacePanels'
import { ComposeEmailModal } from '../../components/ComposeEmailModal'
import { feeCeiling, scheduleFor } from '../../lib/annexureB'
import { formatCurrency, formatDate } from '../../data/mockData'

type Tab = 'Overview' | 'Transactions' | 'Documents'

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
  const { companies } = useAppStore()
  const { currentUser } = useAuth()
  const [account, setAccount] = useState<DebtorAccount | null>(null)
  const [ledgers, setLedgers] = useState<AccountLedgers | null>(null)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [documents, setDocuments] = useState<AccountDocument[]>([])
  const [tab, setTab] = useState<Tab>('Overview')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [composeTo, setComposeTo] = useState<string | null>(null)

  // The action bar drives the panels below it rather than opening modals of its own: "Add Note"
  // puts the cursor in the note box that is already on the page, so there is one way to write a
  // note and not two that can drift apart.
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const [promiseOpen, setPromiseOpen] = useState(false)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true); setError(null)
    ;(async () => {
      try {
        const a = await fetchAccount(id)
        if (cancelled) return
        setAccount(a)
        if (a) {
          const [l, w, d] = await Promise.all([fetchLedgers(a.id), fetchWorkspace(a.id), fetchDocuments(a.id)])
          if (!cancelled) { setLedgers(l); setWorkspace(w); setDocuments(d) }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [id])

  // Writes are few and small, so everything is refetched rather than patched in place. The
  // alternative is several sets of local reducers that can drift from what the database holds.
  const reload = useCallback(async () => {
    if (!account) return
    const [a, w, d] = await Promise.all([fetchAccount(account.id), fetchWorkspace(account.id), fetchDocuments(account.id)])
    if (a) setAccount(a)
    setWorkspace(w)
    setDocuments(d)
  }, [account])

  const { busy: savingComment, run: runComment } = useWriter(reload)

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
      writtenOffAt: /written.off/i.test(account.status) ? account.lastActionAt : null,
      ledgers: {
        payments: ledgers.payments
          .filter((p) => !p.reversedAt)
          .map((p) => ({ date: p.receivedAt.slice(0, 10), amount: p.amount, paidToClient: p.paidToClient })),
        fees: ledgers.fees.map((f) => ({
          date: f.incurredAt.slice(0, 10),
          description: f.description,
          exclVat: f.amountExclVat,
          vat: f.vatAmount,
          billed: f.billed,
        })),
        interest: ledgers.accruals.map((i) => ({ from: i.accruedOn, days: i.days, amount: i.amountAccrued })),
      },
    }
    return buildStatement(input)
  }, [account, ledgers])

  const timeline = useMemo(
    () => buildTimeline(ledgers, workspace?.notes ?? [], workspace?.promises ?? []),
    [ledgers, workspace],
  )

  const ceiling = useMemo(() => {
    if (!account) return null
    const schedule = scheduleFor(account.lastActionAt ?? account.handoverDate ?? new Date().toISOString())
    return { limit: feeCeiling(account.capitalHandedOver, schedule) }
  }, [account])

  if (loading) return <div className="p-10 grid place-items-center text-slate-400"><Loader2 size={20} className="animate-spin" /></div>
  if (error) return <Card className="border-negative-100 bg-negative-50"><p className="text-sm text-negative-700">{error}</p></Card>
  if (!account) return <Card><p className="text-sm text-slate-600">That account is not in the book.</p></Card>

  const b = statement?.breakdown
  const drift = hasCommissionDrift(account)
  const name = [account.debtorFirstName, account.debtorSurname].filter(Boolean).join(' ') || 'Unnamed debtor'
  const due = workspace ? nextPromise(workspace.promises) : undefined
  const emailContact = workspace?.contacts.find((c) => c.kind === 'email' && !c.retiredAt)
  const canDelete = ['Administrator', 'Sales Manager', 'Liaison Manager'].includes(currentUser?.role ?? '')

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
        eyebrow="Debtor"
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            {name}
            {account.accountNumber && (
              <span className="font-mono text-[11px] font-bold text-navy-950 bg-gold-400 px-2 py-0.5 rounded-md align-middle"
                title="Our reference for this account">
                {account.accountNumber}
              </span>
            )}
          </span>
        }
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            <span className="text-white/50">Client</span>
            {client
              ? <Link to={`/companies/${client.id}`} className="text-gold-400 hover:underline">{client.name}</Link>
              : <span>Unknown</span>}
            {account.clientReference && <><span className="text-white/30">·</span><span>their ref {account.clientReference}</span></>}
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
        <div className="mt-2.5 text-right leading-tight ml-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-gold-500">Pre-legal agent</p>
          <p className="text-sm font-semibold text-white">{account.swordfishAssignedTo ?? 'Unassigned'}</p>
          {account.swordfishAssignedTo && <p className="text-[11px] text-white/50">from Swordfish</p>}
        </div>
      </DashboardHero>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Figure label="Balance" value={b ? formatCurrency(b.balance) : '—'} note="capital + interest + fees, less payments" strong />
        <Figure label="To settle today" value={b ? formatCurrency(b.settlement) : '—'} note={b ? `includes ${formatCurrency(b.settlementFee)} receipt fee` : undefined} />
        <Figure label="Collected" value={b ? formatCurrency(b.payments) : '—'} note={`${ledgers?.payments.length ?? 0} payments`} />
        <Figure
          label="Next promise"
          value={due ? formatCurrency(due.amount) : '—'}
          note={due ? `due ${formatDate(due.dueOn)}` : 'none outstanding'}
          danger={!!due && isOverdue(due, TODAY)}
        />
      </div>

      <MainComment account={account} busy={savingComment}
        onSave={(text) => runComment(() => saveMainComment(account.id, text, currentUser?.id ?? null))} />

      <ActionBar
        onEmail={emailContact ? () => setComposeTo(emailContact.value) : undefined}
        onNote={() => { setTab('Overview'); setTimeout(() => noteRef.current?.focus(), 0) }}
        onPromise={() => { setTab('Overview'); setPromiseOpen(true) }}
      />

      {statement?.note && <Banner>{statement.note}</Banner>}

      {drift && (
        <Banner title={`Billed at ${pct(account.commissionRate)}, but the mandate says ${pct(account.commissionRateExpected)}`}>
          On capital of {formatCurrency(account.capitalHandedOver)}
          {account.commissionRateSource && <> under the {account.commissionRateSource.toLowerCase()}</>}.
          The billed rate is the record of what was actually charged &mdash; this is a flag, not a correction.
        </Banner>
      )}

      <div className="flex gap-1 border-b border-slate-200">
        {(['Overview', 'Transactions', 'Documents'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t ? 'border-gold-500 text-navy-950' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {t}
            {t === 'Transactions' && <span className="ml-1.5 text-[11px] text-slate-400 tabular-nums">{statement?.lines.length ?? 0}</span>}
            {t === 'Documents' && <span className="ml-1.5 text-[11px] text-slate-400 tabular-nums">{documents.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'Transactions' && (
        <Card><StatementTable statement={statement?.lines ?? []} account={account} breakdown={b} /></Card>
      )}

      {tab === 'Documents' && (
        <DocumentsPanel accountId={account.id} documents={documents} onChange={reload}
          userId={currentUser?.id ?? null} userName={currentUser?.name ?? null} canDelete={canDelete} />
      )}

      {tab === 'Overview' && (
        // Three columns only from xl. At iPad width the fixed side columns leave the timeline
        // about 120px wide, which is not a narrow column — it is unreadable. So lg drops to two
        // columns with the timeline full-width underneath, and anything narrower stacks.
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,19rem)_minmax(0,1fr)_minmax(0,19rem)]">
          <div className="lg:order-1 xl:order-none">
            <DebtorDetailsPanel account={account} name={name} workspace={workspace} onChange={reload}
              userId={currentUser?.id ?? null} onEmail={setComposeTo} />
          </div>
          <div className="lg:order-3 lg:col-span-2 xl:order-none xl:col-span-1">
            <TimelinePanel
              entries={timeline}
              accountId={account.id}
              userName={currentUser?.name ?? null}
              userId={currentUser?.id ?? null}
              onChange={reload}
              noteRef={noteRef}
            />
          </div>
          <div className="space-y-4 lg:order-2 xl:order-none">
            <SummaryPanel account={account} breakdown={b} />
            <PromisePanel
              accountId={account.id}
              promises={workspace?.promises ?? []}
              userId={currentUser?.id ?? null}
              onChange={reload}
              open={promiseOpen}
              setOpen={setPromiseOpen}
            />
            <PositionPanel account={account} ceiling={ceiling} chargedExclVat={ledgers?.totals.feesExclVat ?? 0} />
          </div>
        </div>
      )}

      {composeTo && (
        <ComposeEmailModal
          to={composeTo}
          recipients={(workspace?.contacts ?? [])
            .filter((c) => c.kind === 'email' && !c.retiredAt)
            .map((c) => ({ email: c.value, label: c.label ?? undefined }))}
          initialSubject={`Account ${account.accountNumber ?? ''} - ${name}`.trim()}
          contextNote="Sent from this account. A note recording what was sent is added to the timeline."
          onClose={() => setComposeTo(null)}
          onSent={(subject, bodyText) => {
            const to = composeTo
            setComposeTo(null)
            // The account's own record of the message. A note rather than a fee: an outgoing
            // email IS a chargeable action under Annexure B item 4, but raising that charge is
            // the collections engine's decision, not a side effect of a Send button.
            void addNote({
              accountId: account.id,
              body: `Email sent to ${to}\nSubject: ${subject}\n\n${bodyText}`,
              authorName: currentUser?.name ?? null,
              createdBy: currentUser?.id ?? null,
            }).then(reload)
          }}
        />
      )}
    </div>
  )
}

const pct = (r: number | null) => (r === null ? '—' : `${(r * 100).toFixed(r * 100 % 1 === 0 ? 0 : 1)}%`)

/* ---------- the action bar ---------- */

/**
 * What you can do to this account, in one row.
 *
 * Three of these work. Four are placeholders, and they say so rather than looking live and doing
 * nothing — a disabled button with a reason is honest; a button that swallows a click teaches
 * people not to trust the row.
 *
 * Record Payment is deliberately absent. A payment is not something a collector asserts: it
 * arrives in a bank account and is reconciled against the book, and a button that lets someone
 * type one in is a hole in the ledger.
 */
function ActionBar({ onEmail, onNote, onPromise }: {
  onEmail?: () => void
  onNote: () => void
  onPromise: () => void
}) {
  const soon = 'Not built yet — needs a provider connected and a decision on whether it charges the debtor.'
  return (
    <div className="flex flex-wrap gap-2">
      <Action icon={Phone} label="Call" title={soon} />
      <Action icon={MessageCircle} label="WhatsApp" title={soon} />
      <Action icon={MessageSquare} label="SMS" title={soon} />
      <Action icon={Mail} label="Email" onClick={onEmail}
        title={onEmail ? 'Send from your connected mailbox' : 'No email address on this account yet'} />
      <Action icon={StickyNote} label="Add Note" onClick={onNote} title="Write on the timeline" />
      <Action icon={Check} label="Promise to Pay" onClick={onPromise} title="Record what they agreed to" primary />
      <Action icon={ShieldAlert} label="Escalate" title="Not built yet — needs the legal handover flow." />
    </div>
  )
}

function Action({ icon: Icon, label, onClick, title, primary }: {
  icon: typeof Phone; label: string; onClick?: () => void; title?: string; primary?: boolean
}) {
  const disabled = !onClick
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium border transition-colors ${
        disabled
          ? 'border-dashed border-slate-200 text-slate-300 cursor-not-allowed'
          : primary
            ? 'border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500'
            : 'border-slate-200 text-slate-700 bg-white hover:bg-slate-50'}`}
    >
      <Icon size={14} /> {label}
    </button>
  )
}

/* ---------- small shared pieces ---------- */

function Figure({ label, value, note, strong, danger }: {
  label: string; value: string; note?: string; strong?: boolean; danger?: boolean
}) {
  return (
    <Card className={strong ? 'border-gold-100' : undefined}>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-xl font-semibold tabular-nums mt-0.5 ${danger ? 'text-negative' : strong ? 'text-navy-950' : 'text-slate-800'}`}>{value}</p>
      {note && <p className={`text-[11px] mt-0.5 ${danger ? 'text-negative-700' : 'text-slate-500'}`}>{note}</p>}
    </Card>
  )
}

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

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    // flex-wrap, so a value too wide to sit beside its label drops to its own full-width line
    // instead of being squeezed and broken mid-way. A reference number split across two lines
    // with one stray digit is a number someone will read out wrong over the phone.
    <div className="flex flex-wrap justify-between gap-x-3 text-sm">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className="text-slate-800 text-right min-w-0 break-words ml-auto">{value || '—'}</span>
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
        {value === undefined ? '—' : formatCurrency(value)}
      </span>
    </div>
  )
}

/* ---------- middle: the story ---------- */

const PAGE_SIZES = [5, 10, 20, 50] as const

function TimelinePanel({ entries, accountId, userName, userId, onChange, noteRef }: {
  entries: TimelineEntry[]
  accountId: string
  userName: string | null
  userId: string | null
  onChange: () => Promise<void>
  noteRef: React.RefObject<HTMLTextAreaElement | null>
}) {
  const [limit, setLimit] = useState<number>(10)
  const [body, setBody] = useState('')
  const { busy, err, run } = useWriter(onChange)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!body.trim()) return
    const ok = await run(() => addNote({ accountId, body, authorName: userName, createdBy: userId }))
    if (ok) setBody('')
  }

  const shown = limit >= entries.length ? entries : entries.slice(0, limit)
  const days = groupByDay(shown)

  return (
    <Card>
      <div className="flex items-center justify-between gap-2 mb-3">
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
            <option value={entries.length || 1}>All {entries.length.toLocaleString('en-ZA')}</option>
          </select>
          <span className="text-slate-400">of {entries.length.toLocaleString('en-ZA')}</span>
        </label>
      </div>

      <form onSubmit={submit} className="mb-4">
        <textarea
          ref={noteRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={body ? 3 : 1}
          placeholder="Add a note - what was said, what was agreed..."
          className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
        {body.trim() && (
          <div className="flex items-center gap-2 mt-2">
            <button type="submit" disabled={busy}
              className="text-sm font-medium px-3 py-1.5 rounded-lg bg-brand-600 text-white disabled:opacity-50">
              {busy ? 'Saving...' : 'Post note'}
            </button>
            <button type="button" onClick={() => setBody('')} className="text-sm text-slate-500 hover:text-slate-700">Cancel</button>
          </div>
        )}
        {err && <p className="text-xs text-negative-700 mt-2">{err}</p>}
      </form>

      {entries.length === 0 && <p className="text-sm text-slate-400 py-6 text-center">Nothing has happened on this account yet.</p>}

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

      {entries.length > shown.length && (
        <button onClick={() => setLimit((n) => n + 20)}
          className="mt-4 pt-3 border-t border-slate-100 w-full text-sm text-brand-600 hover:underline">
          Show 20 more &mdash; {(entries.length - shown.length).toLocaleString('en-ZA')} older
        </button>
      )}
    </Card>
  )
}

function TimelineRow({ entry }: { entry: TimelineEntry }) {
  const style = styleFor(entry)
  const Icon = style.icon
  const reversed = entry.status === 'reversed'
  return (
    <div className="flex gap-3">
      <div className={`w-7 h-7 rounded-full grid place-items-center shrink-0 ${style.ring}`}>
        <Icon size={13} className={style.fg} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className={`text-sm min-w-0 ${entry.kind === 'note' ? 'whitespace-pre-wrap' : ''} ${reversed ? 'line-through text-slate-400' : 'text-slate-700'}`}>
            {entry.title}
            {entry.status && entry.kind === 'promise' && <PromiseChip status={entry.status} />}
          </p>
          <span className="text-sm tabular-nums shrink-0">
            {entry.amount != null
              ? <span className={entry.kind === 'payment' && !reversed ? 'text-positive-700 font-medium' : 'text-slate-600'}>
                  {formatCurrency(entry.amount)}
                </span>
              : entry.free
                ? <span className="text-slate-300 text-xs" title="Work done past the Annexure B ceiling. Real history, no money.">not charged</span>
                : null}
          </span>
        </div>
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

/* ---------- right: the figures ---------- */

function SummaryPanel({ account, breakdown }: { account: DebtorAccount; breakdown: BalanceBreakdown | undefined }) {
  const b = breakdown
  return (
    <Card>
      <PanelTitle>Account summary</PanelTitle>
      <div className="space-y-1.5">
        <Money label="Original amount" value={b?.capital} />
        <Money label="Interest accrued" value={b?.interest} note={`${account.interestRateAnnual}% a year`} />
        <Money label="Fees, incl VAT" value={b?.fees} />
        <Money label="Receipt fees on payments" value={b?.receiptFees} note="10% of each, max R610" />
        <Money label="Collected" value={b ? -b.payments : undefined} />
        <div className="border-t border-slate-100 pt-2 mt-1 space-y-1.5">
          <Money label="Balance" value={b?.balance} strong />
          <Money label="Receipt fee if settled" value={b?.settlementFee} />
          <Money label="To settle today" value={b?.settlement} strong />
        </div>
      </div>
    </Card>
  )
}

/**
 * Promises to pay.
 *
 * The one thing a collector actually produces on a call. It is a claim about the future, so it
 * never touches a balance — it is kept or it is broken, and a person says which. Matching one
 * against an incoming payment is the collections engine's job, and that does not exist yet.
 */
function PromisePanel({ accountId, promises, userId, onChange, open, setOpen }: {
  accountId: string
  promises: PromiseToPay[]
  userId: string | null
  onChange: () => Promise<void>
  open: boolean
  setOpen: (v: boolean) => void
}) {
  const [amount, setAmount] = useState('')
  const [dueOn, setDueOn] = useState('')
  const [method, setMethod] = useState('')
  const { busy, err, run } = useWriter(onChange)

  const outstanding = promises.filter((p) => p.status === 'open')
  const past = promises.filter((p) => p.status !== 'open')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const value = Number(amount)
    if (!(value > 0) || !dueOn) return
    const ok = await run(() => addPromise({ accountId, amount: value, dueOn, method, createdBy: userId }))
    if (ok) { setAmount(''); setDueOn(''); setMethod(''); setOpen(false) }
  }

  return (
    <Card>
      <PanelTitle action={
        <button onClick={() => setOpen(!open)} className="text-xs text-brand-600 hover:underline inline-flex items-center gap-1">
          {open ? <><X size={12} /> Cancel</> : <><Plus size={12} /> Take one</>}
        </button>
      }>Promise to pay</PanelTitle>

      {open && (
        <form onSubmit={submit} className="space-y-2 p-3 rounded-lg bg-slate-50 border border-slate-100 mb-3">
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoFocus
            placeholder="Amount, e.g. 5000" className="w-full text-sm rounded-lg border border-slate-200 px-2 py-1.5" />
          <input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} min={TODAY}
            className="w-full text-sm rounded-lg border border-slate-200 px-2 py-1.5" />
          <input value={method} onChange={(e) => setMethod(e.target.value)}
            placeholder="How? (EFT, debit order ...)" className="w-full text-sm rounded-lg border border-slate-200 px-2 py-1.5" />
          <button type="submit" disabled={busy || !(Number(amount) > 0) || !dueOn}
            className="w-full text-sm font-medium py-1.5 rounded-lg bg-brand-600 text-white disabled:opacity-50">
            {busy ? 'Saving...' : 'Record promise'}
          </button>
        </form>
      )}
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
                <span className={`font-semibold tabular-nums ${late ? 'text-negative-700' : 'text-navy-950'}`}>{formatCurrency(p.amount)}</span>
                <span className={`text-[11px] ${late ? 'text-negative' : 'text-gold-600'}`}>
                  {late ? 'overdue ' : 'due '}{formatDate(p.dueOn)}
                </span>
              </div>
              {p.method && <p className="text-[11px] text-slate-500 mt-0.5">{p.method}</p>}
              <div className="flex gap-1.5 mt-2">
                <button disabled={busy} onClick={() => run(() => resolvePromise(p.id, 'kept', userId))}
                  className="flex-1 text-[11px] font-medium py-1 rounded border border-positive-100 text-positive-700 hover:bg-positive-50 disabled:opacity-50 inline-flex items-center justify-center gap-1">
                  <Check size={11} /> Kept
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
                <span className="tabular-nums text-slate-500">{formatCurrency(p.amount)}</span>
                <PromiseChip status={p.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

function PositionPanel({ account, ceiling, chargedExclVat }: {
  account: DebtorAccount
  ceiling: { limit: number } | null
  chargedExclVat: number
}) {
  return (
    <Card>
      <PanelTitle>Position</PanelTitle>
      {ceiling && (
        <div className="pb-3">
          <div className="flex items-baseline justify-between text-xs mb-1">
            <span className="text-slate-500">Annexure B fee ceiling</span>
            <span className={`tabular-nums ${chargedExclVat > ceiling.limit ? 'text-negative font-medium' : 'text-slate-400'}`}>
              {formatCurrency(chargedExclVat)} of {formatCurrency(ceiling.limit)}
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
              : `${formatCurrency(ceiling.limit - chargedExclVat)} of chargeable work left.`}
          </p>
        </div>
      )}
      <div className="space-y-1.5">
        <Field label="Commission" value={account.commissionRate === null ? 'not resolved' : pct(account.commissionRate)} />
        <Field label="Status" value={[account.status, account.subStatus].filter(Boolean).join(' · ')} />
        <Field label="Bucket" value={account.bucket} />
        <Field label="Prescribes" value={account.prescriptionDate ? formatDate(account.prescriptionDate) : null} />
        <Field label="Diary date" value={account.diaryDate ? formatDate(account.diaryDate) : null} />
        <Field label="Last action" value={account.lastActionAt ? formatDate(account.lastActionAt) : null} />
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
                <td className={`px-3 py-1.5 ${l.kind === 'payment' ? 'text-positive-700' : 'text-slate-700'}`}>{l.description}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{l.debit ? formatCurrency(l.debit) : ''}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-positive-700">{l.credit ? formatCurrency(l.credit) : ''}</td>
                <td className="px-3 py-1.5 text-right tabular-nums font-medium text-slate-900">{formatCurrency(l.balance)}</td>
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
                <td className="px-3 pt-3 text-right tabular-nums font-medium text-slate-900">{formatCurrency(breakdown.balance)}</td>
              </tr>
              <tr>
                <td className="px-3 py-1 text-slate-500 text-xs" colSpan={2}>
                  Receipt fee on settlement
                  <span className="block text-[11px] text-slate-400">
                    10% of the balance, capped, plus VAT &mdash; charged only when the settlement is received
                  </span>
                </td>
                <td colSpan={2} />
                <td className="px-3 py-1 text-right tabular-nums text-slate-700">{formatCurrency(breakdown.settlementFee)}</td>
              </tr>
              <tr className="border-t border-slate-200">
                <td className="px-3 pt-2 pb-3 font-semibold text-slate-900" colSpan={2}>To settle in full today</td>
                <td colSpan={2} />
                <td className="px-3 pt-2 pb-3 text-right tabular-nums font-semibold text-navy-950">{formatCurrency(breakdown.settlement)}</td>
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
