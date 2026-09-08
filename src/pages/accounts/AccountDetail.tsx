import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react'
import { Card, CardHeader } from '../../components/ui/Card'
import { useAppStore } from '../../store/AppStore'
import { StatusPill } from './AccountsList'
import { fetchAccount, fetchLedgers, hasCommissionDrift, type AccountLedgers, type DebtorAccount } from '../../lib/accountBook'
import { feeCeiling, scheduleFor } from '../../lib/annexureB'
import { formatCurrency, formatDate } from '../../data/mockData'

type Tab = 'Payments' | 'Fees' | 'Interest'

/**
 * One debtor account, and the three ledgers that make up what it owes.
 *
 * The balance shown is Swordfish's closing figure, labelled as such. Raptor can replay the
 * ledgers to derive its own, and will — but showing a derived balance before the engine that
 * derives it has been checked against the old system would be inventing a number, which is
 * exactly what the migration was careful not to do.
 */
export function AccountDetail() {
  const { id } = useParams<{ id: string }>()
  const { companies } = useAppStore()
  const [account, setAccount] = useState<DebtorAccount | null>(null)
  const [ledgers, setLedgers] = useState<AccountLedgers | null>(null)
  const [tab, setTab] = useState<Tab>('Payments')
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

  const ceiling = useMemo(() => {
    if (!account) return null
    const schedule = scheduleFor(account.lastActionAt ?? account.handoverDate ?? new Date().toISOString())
    return { limit: feeCeiling(account.capitalHandedOver, schedule), schedule }
  }, [account])

  if (loading) return <div className="p-10 grid place-items-center text-slate-400"><Loader2 size={20} className="animate-spin" /></div>
  if (error) return <Card className="border-rose-200 bg-rose-50/50"><p className="text-sm text-rose-700">{error}</p></Card>
  if (!account) return <Card><p className="text-sm text-slate-600">That account is not in the book.</p></Card>

  const drift = hasCommissionDrift(account)
  const name = [account.debtorFirstName, account.debtorSurname].filter(Boolean).join(' ') || 'Unnamed debtor'
  const charged = ledgers?.totals.feesExclVat ?? 0

  return (
    <div className="space-y-4">
      <Link to="/accounts" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={14} /> All accounts
      </Link>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-lg font-semibold text-slate-800">{account.accountNumber}</h2>
              <StatusPill status={account.status} inDuplum={account.inDuplum} />
              {account.prescribed && (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-rose-50 text-rose-700">prescribed</span>
              )}
            </div>
            <p className="text-sm text-slate-600 mt-1">{name}</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {client ? <Link to={`/companies/${client.id}`} className="text-brand-600 hover:underline">{client.name}</Link> : 'Unknown client'}
              {account.clientReference && <> · their ref {account.clientReference}</>}
              {account.handoverDate && <> · handed over {formatDate(account.handoverDate)}</>}
            </p>
          </div>
          {account.swordfishAssignedTo && (
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Worked by</p>
              <p className="text-sm text-slate-700">{account.swordfishAssignedTo}</p>
            </div>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Figure label="Capital handed over" value={formatCurrency(account.capitalHandedOver)} />
        <Figure label="Paid to date" value={formatCurrency(ledgers?.totals.paid ?? 0)} note={`${ledgers?.payments.length ?? 0} payments`} />
        <Figure label="Interest accrued" value={formatCurrency(ledgers?.totals.interest ?? 0)} note={`${account.interestRateAnnual}% a year`} />
        <Figure
          label="Balance at import"
          value={account.swordfishBalanceAtImport === null ? '—' : formatCurrency(account.swordfishBalanceAtImport)}
          note="Swordfish's closing figure"
        />
      </div>

      {drift && (
        <Card className="border-amber-200 bg-amber-50/40">
          <div className="flex gap-3">
            <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-amber-900">
                Billed at {pct(account.commissionRate)}, but the mandate says {pct(account.commissionRateExpected)}
              </p>
              <p className="text-amber-800 mt-1">
                On capital of {formatCurrency(account.capitalHandedOver)}
                {account.commissionRateSource && <> under the {account.commissionRateSource.toLowerCase()}</>}.
                The billed rate is what was actually charged and is kept as the record — this is a flag, not a correction.
              </p>
            </div>
          </div>
        </Card>
      )}

      {ceiling && (
        <Card>
          <CardHeader
            title="Annexure B fee ceiling"
            subtitle={`Items 1 to 7 may not exceed the capital or ${formatCurrency(ceiling.schedule.itemsOneToSevenCeiling)}, whichever is the lesser · ${ceiling.schedule.citation}`}
          />
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-slate-600">
              <strong className="tabular-nums text-slate-800">{formatCurrency(charged)}</strong> charged of{' '}
              <span className="tabular-nums">{formatCurrency(ceiling.limit)}</span>
            </span>
            <span className={`tabular-nums text-xs ${charged > ceiling.limit ? 'text-rose-600 font-medium' : 'text-slate-400'}`}>
              {charged > ceiling.limit
                ? `${formatCurrency(charged - ceiling.limit)} over the statutory limit`
                : `${formatCurrency(ceiling.limit - charged)} left`}
            </span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full mt-2 overflow-hidden">
            <div
              className={`h-full rounded-full ${charged > ceiling.limit ? 'bg-rose-500' : charged / ceiling.limit > 0.9 ? 'bg-amber-500' : 'bg-brand-500'}`}
              style={{ width: `${Math.min(100, ceiling.limit ? (100 * charged) / ceiling.limit : 0)}%` }}
            />
          </div>
          {ledgers && ledgers.totals.feeCount > 0 && (
            <p className="text-[11px] text-slate-400 mt-2">
              {ledgers.fees.filter((f) => !f.billed).length.toLocaleString('en-ZA')} of {ledgers.totals.feeCount.toLocaleString('en-ZA')} actions
              on this account carry no charge — recorded as history, not as revenue.
            </p>
          )}
        </Card>
      )}

      <Card padded={false}>
        <div className="flex gap-1 p-2 border-b border-slate-100">
          {(['Payments', 'Fees', 'Interest'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === t ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-100'}`}
            >
              {t}
              <span className="ml-1.5 text-[11px] text-slate-400 tabular-nums">
                {t === 'Payments' ? ledgers?.payments.length ?? 0 : t === 'Fees' ? ledgers?.totals.feeCount ?? 0 : ledgers?.accruals.length ?? 0}
              </span>
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          {tab === 'Payments' && <PaymentsTable ledgers={ledgers} />}
          {tab === 'Fees' && <FeesTable ledgers={ledgers} />}
          {tab === 'Interest' && <InterestTable ledgers={ledgers} />}
        </div>
      </Card>
    </div>
  )
}

const pct = (r: number | null) => (r === null ? '—' : `${(r * 100).toFixed(r * 100 % 1 === 0 ? 0 : 1)}%`)

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-xl font-semibold text-slate-800 tabular-nums mt-0.5">{value}</p>
      {note && <p className="text-[11px] text-slate-500 mt-0.5">{note}</p>}
    </Card>
  )
}

function Empty({ what }: { what: string }) {
  return <p className="p-8 text-center text-sm text-slate-400">No {what} on this account.</p>
}

const Th = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
  <th className={`px-4 py-2.5 font-medium ${right ? 'text-right' : 'text-left'}`}>{children}</th>
)

function PaymentsTable({ ledgers }: { ledgers: AccountLedgers | null }) {
  if (!ledgers?.payments.length) return <Empty what="payments" />
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
          <Th>Received</Th><Th>How</Th><Th>Reference</Th><Th right>Amount</Th>
        </tr>
      </thead>
      <tbody>
        {ledgers.payments.map((p) => (
          <tr key={p.id} className="border-b border-slate-50 last:border-0">
            <td className="px-4 py-2.5 text-slate-700">{formatDate(p.receivedAt)}</td>
            <td className="px-4 py-2.5">
              {p.paidToClient ? (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-sky-50 text-sky-700"
                  title="The client banked this directly and owes us our share. It settles in the month-end reconciliation.">
                  paid to client
                </span>
              ) : (
                <span className="text-slate-500">{p.method ?? '—'}</span>
              )}
            </td>
            <td className="px-4 py-2.5 text-slate-400 text-xs">{p.details ?? p.reference ?? '—'}</td>
            <td className={`px-4 py-2.5 text-right tabular-nums ${p.reversedAt ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
              {formatCurrency(p.amount)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function FeesTable({ ledgers }: { ledgers: AccountLedgers | null }) {
  if (!ledgers?.fees.length) return <Empty what="fees" />
  return (
    <>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
            <Th>Date</Th><Th>Action</Th><Th>By</Th><Th right>Excl VAT</Th><Th right>Incl VAT</Th>
          </tr>
        </thead>
        <tbody>
          {ledgers.fees.map((f) => (
            <tr key={f.id} className="border-b border-slate-50 last:border-0">
              <td className="px-4 py-2 text-slate-600">{formatDate(f.incurredAt)}</td>
              <td className="px-4 py-2">
                <span className={f.billed ? 'text-slate-700' : 'text-slate-400'}>{f.description}</span>
                {f.segments > 1 && <span className="text-[11px] text-slate-400 ml-1.5">×{f.segments}</span>}
                {f.cancelledAt && (
                  <span className="text-[11px] text-slate-400 ml-1.5" title="Cancelled. The fee stands: it attaches to the action being issued.">
                    cancelled
                  </span>
                )}
              </td>
              <td className="px-4 py-2 text-slate-400 text-xs">{f.performedBy ?? '—'}</td>
              <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                {f.billed ? formatCurrency(f.amountExclVat) : <span className="text-slate-300">—</span>}
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                {f.billed ? formatCurrency(f.amountExclVat + f.vatAmount) : <span className="text-slate-300">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {ledgers.totals.feeCount > ledgers.fees.length && (
        <p className="px-4 py-3 text-xs text-slate-400 border-t border-slate-100">
          Showing the most recent {ledgers.fees.length.toLocaleString('en-ZA')} of {ledgers.totals.feeCount.toLocaleString('en-ZA')} actions.
          The totals above cover all of them.
        </p>
      )}
    </>
  )
}

function InterestTable({ ledgers }: { ledgers: AccountLedgers | null }) {
  if (!ledgers?.accruals.length) return <Empty what="interest" />
  return (
    <>
      <p className="px-4 pt-3 text-xs text-slate-400">
        Periods may overlap. Swordfish runs concurrent accrual streams — interest on the balance
        alongside interest on fees, which start earning as they are raised — so two periods can
        share a start date without either being wrong.
      </p>
      <table className="w-full text-sm mt-2">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
            <Th>From</Th><Th right>Days</Th><Th right>Accrued</Th><Th right>Recoverable</Th>
          </tr>
        </thead>
        <tbody>
          {ledgers.accruals.map((a) => (
            <tr key={a.id} className="border-b border-slate-50 last:border-0">
              <td className="px-4 py-2 text-slate-600">{formatDate(a.accruedOn)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-slate-500">{a.days}</td>
              <td className="px-4 py-2 text-right tabular-nums text-slate-700">{formatCurrency(a.amountAccrued)}</td>
              <td className={`px-4 py-2 text-right tabular-nums ${a.amountRecoverable < a.amountAccrued ? 'text-amber-700' : 'text-slate-500'}`}>
                {formatCurrency(a.amountRecoverable)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
