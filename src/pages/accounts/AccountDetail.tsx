import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Loader2, Printer } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { useAppStore } from '../../store/AppStore'
import { StatusPill } from './AccountsList'
import { fetchAccount, fetchLedgers, hasCommissionDrift, type AccountLedgers, type DebtorAccount } from '../../lib/accountBook'
import { buildStatement, type BalanceInput, type StatementLine } from '../../lib/accountBalance'
import { feeCeiling, scheduleFor } from '../../lib/annexureB'
import { formatCurrency, formatDate } from '../../data/mockData'

type Tab = 'Overview' | 'Statement' | 'Activity'

/**
 * One debtor account: what is owed, how it got there, and everything that has been done about it.
 *
 * The balance shown is **computed** from the three ledgers, not a stored figure. That is the
 * point of the whole model: a debtor, a client or the Council for Debt Collectors can ask how a
 * number was arrived at, and the Statement tab is the answer, line by line.
 */
export function AccountDetail() {
  const { id } = useParams<{ id: string }>()
  const { companies } = useAppStore()
  const [account, setAccount] = useState<DebtorAccount | null>(null)
  const [ledgers, setLedgers] = useState<AccountLedgers | null>(null)
  const [tab, setTab] = useState<Tab>('Overview')
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
        if (a) setLedgers(await fetchLedgers(a.id))
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [id])

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

  const ceiling = useMemo(() => {
    if (!account) return null
    const schedule = scheduleFor(account.lastActionAt ?? account.handoverDate ?? new Date().toISOString())
    return { limit: feeCeiling(account.capitalHandedOver, schedule), schedule }
  }, [account])

  if (loading) return <div className="p-10 grid place-items-center text-slate-400"><Loader2 size={20} className="animate-spin" /></div>
  if (error) return <Card className="border-rose-200 bg-rose-50/50"><p className="text-sm text-rose-700">{error}</p></Card>
  if (!account) return <Card><p className="text-sm text-slate-600">That account is not in the book.</p></Card>

  const b = statement?.breakdown
  const drift = hasCommissionDrift(account)
  const name = [account.debtorFirstName, account.debtorSurname].filter(Boolean).join(' ') || 'Unnamed debtor'
  const chargedExclVat = ledgers?.totals.feesExclVat ?? 0

  return (
    <div className="space-y-4">
      <Link to="/accounts" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={14} /> All accounts
      </Link>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
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
            </div>
            <p className="text-sm text-slate-600 mt-1 tabular-nums">
              {account.accountNumber}
              {account.debtorIdNumber && <> · ID {account.debtorIdNumber}</>}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              {client ? <Link to={`/companies/${client.id}`} className="text-brand-600 hover:underline">{client.name}</Link> : 'Unknown client'}
              {account.clientReference && <> · their ref {account.clientReference}</>}
              {account.handoverDate && <> · handed over {formatDate(account.handoverDate)}</>}
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
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Figure label="Outstanding" value={b ? formatCurrency(b.balance) : '—'} note="capital + interest + fees − paid" strong />
        <Figure label="To settle today" value={b ? formatCurrency(b.settlement) : '—'} note={b ? `includes ${formatCurrency(b.settlementFee)} receipt fee` : undefined} />
        <Figure label="Capital handed over" value={formatCurrency(account.capitalHandedOver)} note={account.handoverDate ? formatDate(account.handoverDate) : undefined} />
        <Figure label="Paid to date" value={b ? formatCurrency(b.payments) : '—'} note={`${ledgers?.payments.length ?? 0} payments`} />
      </div>

      {statement?.note && (
        <Card className="border-amber-200 bg-amber-50/40">
          <div className="flex gap-3 text-sm">
            <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-amber-900">{statement.note}</p>
          </div>
        </Card>
      )}

      {drift && (
        <Card className="border-amber-200 bg-amber-50/40">
          <div className="flex gap-3 text-sm">
            <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-amber-900">
                Billed at {pct(account.commissionRate)}, but the mandate says {pct(account.commissionRateExpected)}
              </p>
              <p className="text-amber-800 mt-1">
                On capital of {formatCurrency(account.capitalHandedOver)}
                {account.commissionRateSource && <> under the {account.commissionRateSource.toLowerCase()}</>}.
                The billed rate is the record of what was actually charged — this is a flag, not a correction.
              </p>
            </div>
          </div>
        </Card>
      )}

      <Card padded={false}>
        <div className="flex gap-1 p-2 border-b border-slate-100">
          {(['Overview', 'Statement', 'Activity'] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === t ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-100'}`}>
              {t}
              {t === 'Activity' && <span className="ml-1.5 text-[11px] text-slate-400 tabular-nums">{ledgers?.fees.length ?? 0}</span>}
              {t === 'Statement' && <span className="ml-1.5 text-[11px] text-slate-400 tabular-nums">{statement?.lines.length ?? 0}</span>}
            </button>
          ))}
        </div>

        <div className="p-5">
          {tab === 'Overview' && (
            <div className="grid lg:grid-cols-3 gap-5">
              <Section title="Debtor">
                <Field label="Name" value={name} />
                <Field label="ID number" value={account.debtorIdNumber} />
                <Field label="Client reference" value={account.clientReference} />
                {/* Nothing to dial: no export supplied so far carries a debtor phone number or
                    email. Said plainly rather than left as an empty row nobody can explain. */}
                <p className="text-[11px] text-slate-400 pt-1 leading-relaxed">
                  No phone number or email — none of the Swordfish exports carry debtor contact details.
                </p>
              </Section>

              <Section title="How the balance is made up">
                <Money label="Capital handed over" value={b?.capital} />
                <Money label="Interest accrued" value={b?.interest} note={`${account.interestRateAnnual}% a year`} />
                <Money label="Fees, incl VAT" value={b?.fees} />
                <Money label="Receipt fees on payments" value={b?.receiptFees} note="10% of each, max R610" />
                <Money label="Payments received" value={b ? -b.payments : undefined} />
                <div className="border-t border-slate-100 pt-2 mt-1">
                  <Money label="Outstanding" value={b?.balance} strong />
                  <Money label="Receipt fee if settled" value={b?.settlementFee} />
                  <Money label="To settle today" value={b?.settlement} strong />
                </div>
              </Section>

              <Section title="Position">
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
                <Field label="Commission" value={account.commissionRate === null ? 'not resolved' : pct(account.commissionRate)} />
                <Field label="Status" value={[account.status, account.subStatus].filter(Boolean).join(' · ')} />
                <Field label="Bucket" value={account.bucket} />
                <Field label="Prescribes" value={account.prescriptionDate ? formatDate(account.prescriptionDate) : null} />
                <Field label="Diary date" value={account.diaryDate ? formatDate(account.diaryDate) : null} />
                <Field label="Last action" value={account.lastActionAt ? formatDate(account.lastActionAt) : null} />
                <Field label="Written off" value={account.writeOffReason} />
              </Section>
            </div>
          )}

          {tab === 'Statement' && statement && <StatementTable statement={statement.lines} account={account} />}
          {tab === 'Activity' && <ActivityList ledgers={ledgers} />}
        </div>
      </Card>
    </div>
  )
}

const pct = (r: number | null) => (r === null ? '—' : `${(r * 100).toFixed(r * 100 % 1 === 0 ? 0 : 1)}%`)

function Figure({ label, value, note, strong }: { label: string; value: string; note?: string; strong?: boolean }) {
  return (
    <Card className={strong ? 'border-brand-200' : undefined}>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-xl font-semibold tabular-nums mt-0.5 ${strong ? 'text-brand-700' : 'text-slate-800'}`}>{value}</p>
      {note && <p className="text-[11px] text-slate-500 mt-0.5">{note}</p>}
    </Card>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[11px] uppercase tracking-wide text-slate-400 mb-2.5">{title}</h4>
      <div className="space-y-1.5">{children}</div>
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

/**
 * The statement: every movement, in date order, with a running balance.
 *
 * This is the document a debtor is entitled to ask for and a client asks for when they query a
 * figure. It is deliberately plain — printable as it stands, no colour carrying meaning that
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

/**
 * Everything done on the account, charged or not.
 *
 * Most of it is not charged: past the Annexure B ceiling the work continues and the money stops,
 * so an account can carry eight hundred actions and seventy-seven charges. Both belong here —
 * the free ones are the record of effort, which is exactly what somebody asks about when they
 * want to know whether an account was worked.
 */
function ActivityList({ ledgers }: { ledgers: AccountLedgers | null }) {
  const [limit, setLimit] = useState(60)
  if (!ledgers?.fees.length) return <p className="text-sm text-slate-400 py-6 text-center">No activity on this account.</p>
  const shown = ledgers.fees.slice(0, limit)
  return (
    <>
      <div className="space-y-0.5">
        {shown.map((f) => (
          <div key={f.id} className="flex items-baseline gap-3 py-1.5 border-b border-slate-50 last:border-0 text-sm">
            <span className="text-slate-400 tabular-nums w-24 shrink-0">{formatDate(f.incurredAt)}</span>
            <span className={`flex-1 min-w-0 ${f.billed ? 'text-slate-700' : 'text-slate-400'}`}>
              {f.description}
              {f.segments > 1 && <span className="text-[11px] text-slate-400 ml-1.5">×{f.segments}</span>}
              {f.cancelledAt && (
                <span className="text-[11px] text-slate-400 ml-1.5" title="Cancelled. The fee stands: it attaches to the action being issued.">
                  cancelled
                </span>
              )}
            </span>
            <span className="text-xs text-slate-400 w-32 truncate shrink-0 text-right">{f.performedBy ?? ''}</span>
            <span className="tabular-nums w-20 text-right shrink-0">
              {f.billed
                ? <span className="text-slate-700">{formatCurrency(f.amountExclVat + f.vatAmount)}</span>
                : <span className="text-slate-300" title="Work done past the Annexure B ceiling. Real history, no money.">not charged</span>}
            </span>
          </div>
        ))}
      </div>
      {ledgers.fees.length > limit && (
        <button onClick={() => setLimit((n) => n + 200)} className="mt-3 text-sm text-brand-600 hover:underline">
          Show more — {(ledgers.fees.length - limit).toLocaleString('en-ZA')} older
        </button>
      )}
    </>
  )
}
