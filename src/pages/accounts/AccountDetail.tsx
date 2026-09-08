import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  AlertTriangle, ArrowLeft, Banknote, Building2, CalendarClock, Check, CheckCircle2, FileText,
  Loader2, Mail, MapPin, MessageSquare, Phone, Plus, Printer, ShieldCheck, Smartphone, X, XCircle,
} from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { StatusPill } from './AccountsList'
import { fetchAccount, fetchLedgers, hasCommissionDrift, type AccountLedgers, type DebtorAccount } from '../../lib/accountBook'
import { buildStatement, type BalanceInput, type BalanceBreakdown, type StatementLine } from '../../lib/accountBalance'
import {
  addContact, addNote, addPromise, fetchWorkspace, isOverdue, nextPromise, resolvePromise,
  retireContact, verifyContact, CONTACT_KINDS,
  type AccountContact, type ContactKind, type PromiseToPay, type Workspace,
} from '../../lib/accountWorkspace'
import { buildTimeline, groupByDay, type TimelineEntry } from '../../lib/accountTimeline'
import { feeCeiling, scheduleFor } from '../../lib/annexureB'
import { formatCurrency, formatDate } from '../../data/mockData'

type Tab = 'Workspace' | 'Statement'

const TODAY = new Date().toISOString().slice(0, 10)

/**
 * One debtor account: who to call, what the story is, and what is owed.
 *
 * Three columns, because that is the shape of the work. A collector picks up an account and needs
 * a number to dial, the history to know what has already been tried, and the figures to know what
 * to ask for -- and needs all three at once, not behind tabs.
 *
 * The balance shown is **computed** from the three ledgers, not a stored figure. That is the point
 * of the whole model: a debtor, a client or the Council for Debt Collectors can ask how a number
 * was arrived at, and the Statement is the answer, line by line.
 */
export function AccountDetail() {
  const { id } = useParams<{ id: string }>()
  const { companies } = useAppStore()
  const { currentUser } = useAuth()
  const [account, setAccount] = useState<DebtorAccount | null>(null)
  const [ledgers, setLedgers] = useState<AccountLedgers | null>(null)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [tab, setTab] = useState<Tab>('Workspace')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
          const [l, w] = await Promise.all([fetchLedgers(a.id), fetchWorkspace(a.id)])
          if (!cancelled) { setLedgers(l); setWorkspace(w) }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [id])

  // Writes are few and small, so the whole workspace is refetched rather than patched in place.
  // The alternative is three sets of local reducers that can drift from what the database holds.
  const reloadWorkspace = useCallback(async () => {
    if (!account) return
    setWorkspace(await fetchWorkspace(account.id))
  }, [account])

  const client = companies.find((c) => c.id === account?.companyId)

  const statement = useMemo(() => {
    if (!account || !ledgers) return null
    const input: BalanceInput = {
      capitalHandedOver: account.capitalHandedOver,
      handoverDate: account.handoverDate,
      inDuplum: account.inDuplum,
      // An account written off stopped accruing then. Swordfish records the date inside the
      // comment ("Closed on 2026/09/07 ..."), which we do not have, so the last action stands in
      // for it -- imprecise, and labelled as such rather than presented as the closing date.
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
  if (error) return <Card className="border-rose-200 bg-rose-50/50"><p className="text-sm text-rose-700">{error}</p></Card>
  if (!account) return <Card><p className="text-sm text-slate-600">That account is not in the book.</p></Card>

  const b = statement?.breakdown
  const drift = hasCommissionDrift(account)
  const name = [account.debtorFirstName, account.debtorSurname].filter(Boolean).join(' ') || 'Unnamed debtor'
  const due = workspace ? nextPromise(workspace.promises) : undefined

  return (
    <div className="space-y-4">
      <Link to="/accounts" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={14} /> All accounts
      </Link>

      <Card padded={false}>
        <div className="p-5 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-lg font-semibold text-slate-800">{name}</h2>
              <StatusPill status={account.status} inDuplum={account.inDuplum} />
              {account.prescribed && (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-rose-50 text-rose-700"
                  title="Three years have run since the last payment or acknowledgement. It can no longer be enforced.">
                  prescribed
                </span>
              )}
              {due && isOverdue(due, TODAY) && (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-rose-50 text-rose-700">
                  promise overdue
                </span>
              )}
            </div>
            <p className="text-sm text-slate-600 mt-1 tabular-nums">
              {account.accountNumber}
              {account.debtorIdNumber && <> &middot; ID {account.debtorIdNumber}</>}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              {client ? <Link to={`/companies/${client.id}`} className="text-brand-600 hover:underline">{client.name}</Link> : 'Unknown client'}
              {account.clientReference && <> &middot; their ref {account.clientReference}</>}
              {account.handoverDate && <> &middot; handed over {formatDate(account.handoverDate)}</>}
            </p>
          </div>
          {account.swordfishAssignedTo && (
            <div className="text-right shrink-0">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Worked by</p>
              <p className="text-sm text-slate-700">{account.swordfishAssignedTo}</p>
              <p className="text-[11px] text-slate-400">in Swordfish</p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 border-t border-slate-100 divide-x divide-slate-100">
          <HeaderFigure label="Outstanding" value={b ? formatCurrency(b.balance) : '—'} note="capital + interest + fees, less payments" strong />
          <HeaderFigure label="To settle today" value={b ? formatCurrency(b.settlement) : '—'} note={b ? `includes ${formatCurrency(b.settlementFee)} receipt fee` : undefined} />
          <HeaderFigure label="Paid to date" value={b ? formatCurrency(b.payments) : '—'} note={`${ledgers?.payments.length ?? 0} payments`} />
          <HeaderFigure
            label="Next promise"
            value={due ? formatCurrency(due.amount) : '—'}
            note={due ? `due ${formatDate(due.dueOn)}` : 'none outstanding'}
            danger={!!due && isOverdue(due, TODAY)}
          />
        </div>
      </Card>

      {statement?.note && <Banner>{statement.note}</Banner>}

      {drift && (
        <Banner title={`Billed at ${pct(account.commissionRate)}, but the mandate says ${pct(account.commissionRateExpected)}`}>
          On capital of {formatCurrency(account.capitalHandedOver)}
          {account.commissionRateSource && <> under the {account.commissionRateSource.toLowerCase()}</>}.
          The billed rate is the record of what was actually charged &mdash; this is a flag, not a correction.
        </Banner>
      )}

      <div className="flex gap-1">
        {(['Workspace', 'Statement'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === t ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-100'}`}>
            {t}
            {t === 'Statement' && <span className="ml-1.5 text-[11px] text-slate-400 tabular-nums">{statement?.lines.length ?? 0}</span>}
          </button>
        ))}
      </div>

      {tab === 'Statement' ? (
        <Card><StatementTable statement={statement?.lines ?? []} account={account} /></Card>
      ) : (
        // Three columns only from xl. At iPad width the fixed side columns leave the timeline
        // about 120px wide, which is not a narrow column -- it is unreadable. So lg drops to two
        // columns with the timeline full-width underneath, and anything narrower stacks.
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,17rem)_minmax(0,1fr)_minmax(0,19rem)]">
          <div className="lg:order-1 xl:order-none">
            <DebtorPanel account={account} name={name} workspace={workspace} onChange={reloadWorkspace} userId={currentUser?.id ?? null} />
          </div>
          <div className="lg:order-3 lg:col-span-2 xl:order-none xl:col-span-1">
            <TimelinePanel
              entries={timeline}
              accountId={account.id}
              userName={currentUser?.name ?? null}
              userId={currentUser?.id ?? null}
              onChange={reloadWorkspace}
            />
          </div>
          <div className="space-y-4 lg:order-2 xl:order-none">
            <SummaryPanel account={account} breakdown={b} />
            <PromisePanel
              accountId={account.id}
              promises={workspace?.promises ?? []}
              userId={currentUser?.id ?? null}
              onChange={reloadWorkspace}
            />
            <PositionPanel account={account} ceiling={ceiling} chargedExclVat={ledgers?.totals.feesExclVat ?? 0} />
          </div>
        </div>
      )}
    </div>
  )
}

const pct = (r: number | null) => (r === null ? '—' : `${(r * 100).toFixed(r * 100 % 1 === 0 ? 0 : 1)}%`)

/* ---------- small shared pieces ---------- */

function HeaderFigure({ label, value, note, strong, danger }: {
  label: string; value: string; note?: string; strong?: boolean; danger?: boolean
}) {
  return (
    <div className="px-5 py-3.5">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-xl font-semibold tabular-nums mt-0.5 ${danger ? 'text-rose-600' : strong ? 'text-brand-700' : 'text-slate-800'}`}>{value}</p>
      {note && <p className={`text-[11px] mt-0.5 ${danger ? 'text-rose-500' : 'text-slate-500'}`}>{note}</p>}
    </div>
  )
}

function Banner({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <Card className="border-amber-200 bg-amber-50/40">
      <div className="flex gap-3 text-sm">
        <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
        <div>
          {title && <p className="font-medium text-amber-900">{title}</p>}
          <p className={`text-amber-800 ${title ? 'mt-1' : ''}`}>{children}</p>
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

/** Surfaces a failed write instead of leaving a button that silently did nothing. */
function useWriter(onChange: () => Promise<void>) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null)
    try {
      await fn()
      await onChange()
      return true
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setBusy(false)
    }
  }, [onChange])
  return { busy, err, run }
}

/* ---------- left: who you can reach ---------- */

const CONTACT_ICON: Record<ContactKind, typeof Phone> = {
  mobile: Smartphone, phone: Phone, work: Phone, email: Mail,
  address: MapPin, employer: Building2, other: FileText,
}

function DebtorPanel({ account, name, workspace, onChange, userId }: {
  account: DebtorAccount
  name: string
  workspace: Workspace | null
  onChange: () => Promise<void>
  userId: string | null
}) {
  const [adding, setAdding] = useState(false)
  const { busy, err, run } = useWriter(onChange)

  const live = (workspace?.contacts ?? []).filter((c) => !c.retiredAt)
  const retired = (workspace?.contacts ?? []).filter((c) => c.retiredAt)

  return (
    <Card className="xl:sticky xl:top-4 self-start">
      <PanelTitle action={
        <button onClick={() => setAdding((v) => !v)} className="text-xs text-brand-600 hover:underline inline-flex items-center gap-1">
          {adding ? <><X size={12} /> Cancel</> : <><Plus size={12} /> Add</>}
        </button>
      }>Debtor details</PanelTitle>

      <div className="space-y-1.5">
        <Field label="Name" value={name} />
        <Field label="ID number" value={account.debtorIdNumber} />
        <Field label="Client reference" value={account.clientReference} />
      </div>

      {adding && <ContactForm accountId={account.id} busy={busy} onDone={() => setAdding(false)} run={run} />}
      {err && <p className="text-xs text-rose-600 mt-2">{err}</p>}

      <div className="mt-4 pt-3 border-t border-slate-100">
        {live.length === 0 && !adding && (
          // Said plainly rather than left as empty rows nobody can explain.
          <p className="text-[11px] text-slate-400 leading-relaxed">
            No contact details yet. None of the Swordfish exports carried a debtor phone number,
            email or address &mdash; add what you get on a call.
          </p>
        )}
        <div className="space-y-2.5">
          {live.map((c) => (
            <ContactRow key={c.id} contact={c} userId={userId} busy={busy} run={run} />
          ))}
        </div>
        {retired.length > 0 && (
          <details className="mt-3">
            <summary className="text-[11px] text-slate-400 cursor-pointer hover:text-slate-600">
              {retired.length} retired
            </summary>
            <div className="space-y-1.5 mt-2">
              {retired.map((c) => (
                <p key={c.id} className="text-xs text-slate-400 line-through decoration-slate-300">
                  {c.value}
                  {c.retiredReason && <span className="no-underline ml-1.5">&mdash; {c.retiredReason}</span>}
                </p>
              ))}
            </div>
          </details>
        )}
      </div>
    </Card>
  )
}

function ContactRow({ contact, userId, busy, run }: {
  contact: AccountContact
  userId: string | null
  busy: boolean
  run: (fn: () => Promise<unknown>) => Promise<boolean>
}) {
  const Icon = CONTACT_ICON[contact.kind]
  const dialable = contact.kind === 'mobile' || contact.kind === 'phone' || contact.kind === 'work'
  const href = dialable ? `tel:${contact.value.replace(/\s/g, '')}` : contact.kind === 'email' ? `mailto:${contact.value}` : null
  return (
    <div className="flex items-start gap-2 text-sm group">
      <Icon size={14} className="text-slate-400 mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {href
          ? <a href={href} className="text-brand-700 hover:underline break-words">{contact.value}</a>
          : <span className="text-slate-700 break-words">{contact.value}</span>}
        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
          {contact.label && <span className="text-[11px] text-slate-400">{contact.label}</span>}
          {contact.isPrimary && <span className="text-[10px] px-1.5 rounded bg-slate-100 text-slate-500">primary</span>}
          {contact.verifiedAt
            ? <span className="text-[10px] px-1.5 rounded bg-emerald-50 text-emerald-700 inline-flex items-center gap-0.5">
                <ShieldCheck size={9} /> verified
              </span>
            : <button
                disabled={busy}
                onClick={() => run(() => verifyContact(contact.id, userId))}
                className="text-[10px] text-slate-400 hover:text-emerald-700 disabled:opacity-50">
                mark verified
              </button>}
          <button
            disabled={busy}
            onClick={() => {
              const reason = window.prompt('Why is this being retired? (wrong number, disconnected, ...)')
              if (reason !== null) run(() => retireContact(contact.id, reason))
            }}
            className="text-[10px] text-slate-300 hover:text-rose-600 disabled:opacity-50 opacity-0 group-hover:opacity-100 focus:opacity-100">
            retire
          </button>
        </div>
      </div>
    </div>
  )
}

function ContactForm({ accountId, busy, onDone, run }: {
  accountId: string
  busy: boolean
  onDone: () => void
  run: (fn: () => Promise<unknown>) => Promise<boolean>
}) {
  const [kind, setKind] = useState<ContactKind>('mobile')
  const [value, setValue] = useState('')
  const [label, setLabel] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!value.trim()) return
    const ok = await run(() => addContact({ accountId, kind, value, label }))
    if (ok) { setValue(''); setLabel(''); onDone() }
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-2 p-3 rounded-lg bg-slate-50 border border-slate-100">
      <select value={kind} onChange={(e) => setKind(e.target.value as ContactKind)}
        className="w-full text-sm rounded-lg border border-slate-200 px-2 py-1.5 bg-white">
        {CONTACT_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
      </select>
      <input value={value} onChange={(e) => setValue(e.target.value)} autoFocus
        placeholder={kind === 'email' ? 'name@example.co.za' : kind === 'address' ? 'Street, suburb, city' : '+27 ...'}
        className="w-full text-sm rounded-lg border border-slate-200 px-2 py-1.5" />
      <input value={label} onChange={(e) => setLabel(e.target.value)}
        placeholder="Whose is it? (optional)"
        className="w-full text-sm rounded-lg border border-slate-200 px-2 py-1.5" />
      <button type="submit" disabled={busy || !value.trim()}
        className="w-full text-sm font-medium py-1.5 rounded-lg bg-brand-600 text-white disabled:opacity-50">
        {busy ? 'Saving...' : 'Save contact'}
      </button>
    </form>
  )
}

/* ---------- middle: the story ---------- */

const TIMELINE_STYLE: Record<TimelineEntry['kind'], { icon: typeof Phone; ring: string; fg: string }> = {
  payment: { icon: Banknote, ring: 'bg-emerald-50', fg: 'text-emerald-600' },
  promise: { icon: CalendarClock, ring: 'bg-amber-50', fg: 'text-amber-600' },
  note: { icon: MessageSquare, ring: 'bg-slate-100', fg: 'text-slate-500' },
  action: { icon: FileText, ring: 'bg-brand-50', fg: 'text-brand-600' },
}

function TimelinePanel({ entries, accountId, userName, userId, onChange }: {
  entries: TimelineEntry[]
  accountId: string
  userName: string | null
  userId: string | null
  onChange: () => Promise<void>
}) {
  const [limit, setLimit] = useState(40)
  const [body, setBody] = useState('')
  const { busy, err, run } = useWriter(onChange)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!body.trim()) return
    const ok = await run(() => addNote({ accountId, body, authorName: userName, createdBy: userId }))
    if (ok) setBody('')
  }

  const days = groupByDay(entries.slice(0, limit))

  return (
    <Card>
      <PanelTitle>Activity timeline</PanelTitle>

      <form onSubmit={submit} className="mb-4">
        <textarea
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
        {err && <p className="text-xs text-rose-600 mt-2">{err}</p>}
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

      {entries.length > limit && (
        <button onClick={() => setLimit((n) => n + 100)} className="mt-4 text-sm text-brand-600 hover:underline">
          Show more &mdash; {(entries.length - limit).toLocaleString('en-ZA')} older
        </button>
      )}
    </Card>
  )
}

function TimelineRow({ entry }: { entry: TimelineEntry }) {
  const style = TIMELINE_STYLE[entry.kind]
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
              ? <span className={entry.kind === 'payment' && !reversed ? 'text-emerald-700 font-medium' : 'text-slate-600'}>
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

const PROMISE_CHIP: Record<string, string> = {
  open: 'bg-amber-50 text-amber-700',
  kept: 'bg-emerald-50 text-emerald-700',
  broken: 'bg-rose-50 text-rose-700',
  cancelled: 'bg-slate-100 text-slate-500',
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
        <Money label="Capital handed over" value={b?.capital} />
        <Money label="Interest accrued" value={b?.interest} note={`${account.interestRateAnnual}% a year`} />
        <Money label="Fees, incl VAT" value={b?.fees} />
        <Money label="Receipt fees on payments" value={b?.receiptFees} note="10% of each, max R610" />
        <Money label="Payments received" value={b ? -b.payments : undefined} />
        <div className="border-t border-slate-100 pt-2 mt-1 space-y-1.5">
          <Money label="Outstanding" value={b?.balance} strong />
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
 * never touches a balance -- it is kept or it is broken, and a person says which. Matching one
 * against an incoming payment is the collections engine's job, and that does not exist yet.
 */
function PromisePanel({ accountId, promises, userId, onChange }: {
  accountId: string
  promises: PromiseToPay[]
  userId: string | null
  onChange: () => Promise<void>
}) {
  const [adding, setAdding] = useState(false)
  const [amount, setAmount] = useState('')
  const [dueOn, setDueOn] = useState('')
  const [method, setMethod] = useState('')
  const { busy, err, run } = useWriter(onChange)

  const open = promises.filter((p) => p.status === 'open')
  const past = promises.filter((p) => p.status !== 'open')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const value = Number(amount)
    if (!(value > 0) || !dueOn) return
    const ok = await run(() => addPromise({ accountId, amount: value, dueOn, method, createdBy: userId }))
    if (ok) { setAmount(''); setDueOn(''); setMethod(''); setAdding(false) }
  }

  return (
    <Card>
      <PanelTitle action={
        <button onClick={() => setAdding((v) => !v)} className="text-xs text-brand-600 hover:underline inline-flex items-center gap-1">
          {adding ? <><X size={12} /> Cancel</> : <><Plus size={12} /> Take one</>}
        </button>
      }>Promise to pay</PanelTitle>

      {adding && (
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
      {err && <p className="text-xs text-rose-600 mb-2">{err}</p>}

      {open.length === 0 && past.length === 0 && !adding && (
        <p className="text-[11px] text-slate-400 leading-relaxed">
          No promise outstanding. Take one on the next call &mdash; it is the thing this account is measured by.
        </p>
      )}

      <div className="space-y-2">
        {open.map((p) => {
          const late = isOverdue(p, TODAY)
          return (
            <div key={p.id} className={`p-3 rounded-lg border ${late ? 'border-rose-200 bg-rose-50/50' : 'border-amber-200 bg-amber-50/40'}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className={`font-semibold tabular-nums ${late ? 'text-rose-700' : 'text-amber-800'}`}>{formatCurrency(p.amount)}</span>
                <span className={`text-[11px] ${late ? 'text-rose-600' : 'text-amber-700'}`}>
                  {late ? 'overdue ' : 'due '}{formatDate(p.dueOn)}
                </span>
              </div>
              {p.method && <p className="text-[11px] text-slate-500 mt-0.5">{p.method}</p>}
              <div className="flex gap-1.5 mt-2">
                <button disabled={busy} onClick={() => run(() => resolvePromise(p.id, 'kept', userId))}
                  className="flex-1 text-[11px] font-medium py-1 rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 inline-flex items-center justify-center gap-1">
                  <Check size={11} /> Kept
                </button>
                <button disabled={busy} onClick={() => run(() => resolvePromise(p.id, 'broken', userId))}
                  className="flex-1 text-[11px] font-medium py-1 rounded border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-50 inline-flex items-center justify-center gap-1">
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
                  {p.status === 'kept' ? <CheckCircle2 size={11} className="inline text-emerald-600 mr-1" /> : null}
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
            <span className={`tabular-nums ${chargedExclVat > ceiling.limit ? 'text-rose-600 font-medium' : 'text-slate-400'}`}>
              {formatCurrency(chargedExclVat)} of {formatCurrency(ceiling.limit)}
            </span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${chargedExclVat > ceiling.limit ? 'bg-rose-500' : chargedExclVat / ceiling.limit > 0.9 ? 'bg-amber-500' : 'bg-brand-500'}`}
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
 * The statement: every movement, in date order, with a running balance.
 *
 * This is the document a debtor is entitled to ask for and a client asks for when they query a
 * figure. It is deliberately plain -- printable as it stands, no colour carrying meaning that
 * would be lost in black and white.
 */
function StatementTable({ statement, account }: { statement: StatementLine[]; account: DebtorAccount }) {
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
                <td className={`px-3 py-1.5 ${l.kind === 'payment' ? 'text-emerald-700' : 'text-slate-700'}`}>{l.description}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{l.debit ? formatCurrency(l.debit) : ''}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{l.credit ? formatCurrency(l.credit) : ''}</td>
                <td className="px-3 py-1.5 text-right tabular-nums font-medium text-slate-900">{formatCurrency(l.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
