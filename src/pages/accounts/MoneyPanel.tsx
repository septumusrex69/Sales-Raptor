import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { Card } from '../../components/ui/Card'
import { inputClass } from '../../components/ui/Modal'
import { rand, randOrDash, ratePercent } from '../../lib/money'
import { useAuth } from '../../store/AuthContext'
import { canViewFinance } from '../../lib/permissions'
import { fetchMoneyPosition, previewPayment, type MoneyPosition, type Preview } from '../../lib/payover'

/**
 * WHAT IS LEFT TO TAKE ON THIS ACCOUNT, AND WHAT A PAYMENT WOULD DO.
 *
 * ADMINISTRATOR ONLY, and it is the sharpest example of why the whole section is: this panel
 * shows what BF earns from a debtor, which is precisely the figure the company dashboard is
 * forbidden to carry. A collector working the account sees the balance and the payments; they do
 * not see the firm's cut.
 *
 * THE DRY RUN IS THE ENGINE, NOT A MODEL OF IT. `preview_allocation` gathers the same balances
 * through the same function `allocate_payment` uses and hands them to the same `finance_split`.
 * It writes nothing. The firm asked for this before agreeing a settlement or an arrangement --
 * which is exactly the moment a preview that disagreed with reality would cost money, because
 * somebody would have promised a debtor a number.
 *
 * THE FOUR BUCKETS ARE VAT-INCLUSIVE, because that is what the debtor owes. "Cannot take" is not
 * one thing and is not summed into a single figure: interest past the in duplum ceiling, costs
 * raised above the items 1-7 ceiling or since cancelled, and -- for receipt fees, which sit
 * outside that cap -- only a cancellation.
 */
export function MoneyPanel({ accountId }: { accountId: string }) {
  const { currentUser } = useAuth()
  const [pos, setPos] = useState<MoneyPosition | null>(null)
  const [loading, setLoading] = useState(true)
  const [what, setWhat] = useState('')
  const [direct, setDirect] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)

  const maySee = canViewFinance(currentUser?.role)

  const load = useCallback(async () => {
    if (!maySee) { setLoading(false); return }
    setLoading(true)
    try {
      const rows = await fetchMoneyPosition(accountId)
      setPos(rows[0] ?? null)
    } finally { setLoading(false) }
  }, [accountId, maySee])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const n = Number(what)
    if (!Number.isFinite(n) || n <= 0) { setPreview(null); return }
    let alive = true
    setBusy(true)
    const t = setTimeout(() => {
      void previewPayment(accountId, n, direct)
        .then((p) => { if (alive) setPreview(p) })
        .catch(() => { if (alive) setPreview(null) })
        .finally(() => { if (alive) setBusy(false) })
    }, 350)
    return () => { alive = false; clearTimeout(t) }
  }, [what, direct, accountId])

  if (!maySee) return null
  if (loading) return <Card><div className="py-6 text-center"><Loader2 className="mx-auto w-4 h-4 animate-spin text-slate-400" /></div></Card>
  if (!pos) return null

  const capReached = pos.costCapHeadroom <= 0 && pos.costCap > 0

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-slate-800">What is left to take</h3>
        <span className="text-xs text-slate-400">Administrator only — never shown to a client</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[460px] text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-slate-400">
              <th className="py-2" />
              <th className="py-2 text-right">Charged</th>
              <th className="py-2 text-right">Taken</th>
              <th className="py-2 text-right">Left</th>
              <th className="py-2 text-right">Cannot take</th>
            </tr>
          </thead>
          <tbody>
            <Bucket label="Capital" charged={pos.capitalHandedOver} taken={pos.capitalTaken} left={pos.capitalOutstanding} cant={null} />
            <Bucket label="Interest" charged={pos.interestCharged} taken={pos.interestTaken} left={pos.interestLeft} cant={pos.interestCantTake} />
            <Bucket label="Costs · items 1–7" charged={pos.costsCharged} taken={pos.costsTaken} left={pos.costsLeft} cant={pos.costsCantTake} />
            <Bucket label="Receipt fees · item 9" charged={pos.receiptFeesCharged} taken={pos.receiptFeesTaken} left={pos.receiptFeesLeft} cant={pos.receiptFeesCantTake} />
            <tr className="border-t-2 border-slate-800 text-sm">
              <td className="py-2 font-semibold text-slate-800">BF left to take</td>
              <td /><td />
              <td className="py-2 text-right font-semibold tabular-nums">{rand(pos.bfLeftToTake)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <Chip tone={capReached ? 'bad' : 'ok'}>
          {capReached
            ? `Items 1–7 ceiling reached · ${rand(pos.costCapUsed)} of ${rand(pos.costCap)}`
            : `Items 1–7 headroom ${rand(pos.costCapHeadroom)} of ${rand(pos.costCap)}`}
        </Chip>
        <Chip tone={pos.inDuplum ? 'bad' : 'ok'}>
          {pos.inDuplum ? 'In duplum reached' : `In duplum ceiling ${rand(pos.inDuplumCeiling)}`}
        </Chip>
        <Chip tone="plain">
          Commission earned {rand(pos.commissionEarned)} · potential {rand(pos.commissionPotential)}
          {pos.commissionRate === null ? ' · no rate on file' : ` at ${ratePercent(pos.commissionRate)}`}
        </Chip>
      </div>
      {capReached && (
        <p className="mt-2 text-xs text-slate-500">
          No further letters, calls, SMSs or consultations can be recovered from this debtor.
          Receipt fees sit outside the cap and still can.
        </p>
      )}

      {/* ---- the dry run ---- */}
      <div className="mt-5 border-t border-slate-100 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[13px] font-medium text-slate-700">If the debtor pays</label>
          <input value={what} onChange={(e) => setWhat(e.target.value)} inputMode="decimal"
            placeholder="500" className={clsx(inputClass, 'w-28')} />
          <label className="flex items-center gap-1.5 text-[13px] text-slate-600">
            <input type="checkbox" checked={direct} onChange={(e) => setDirect(e.target.checked)} />
            straight to the client
          </label>
          {busy && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
        </div>

        {preview && (
          <>
            <table className="mt-3 w-full max-w-md text-sm">
              <tbody>
                <Row label="Receipt fee charged (item 9)" value={preview.receiptFeeExcl + preview.receiptFeeVat} sub />
                <Row label="Half A → interest" value={preview.toInterest} sub />
                <Row label="Half A → costs, incl that fee" value={preview.toCosts} sub />
                <Row label="Half B → capital" value={preview.toCapital} />
                <Row label="Commission" value={-preview.commission} sub />
                <Row label="VAT on commission (SARS)" value={-preview.commissionVat} sub />
                {preview.excessCredit > 0 && <Row label="Overpaid — held as a credit" value={preview.excessCredit} sub />}
                <tr className="border-t border-slate-200">
                  <td className="py-1.5 font-medium text-slate-700">BF takes</td>
                  <td className="py-1.5 text-right font-medium tabular-nums">{rand(preview.bfTakes)}</td>
                </tr>
                <tr className="border-t-2 border-slate-800">
                  <td className="py-2 font-semibold text-slate-800">{direct ? 'Due to BF' : 'The client gets'}</td>
                  <td className="py-2 text-right font-semibold tabular-nums">
                    {rand(direct ? preview.dueToBf : preview.toClient)}
                  </td>
                </tr>
              </tbody>
            </table>
            <table className="mt-3 w-full max-w-md text-sm">
              <thead>
                <tr className="text-left text-[11px] font-medium uppercase tracking-[0.06em] text-slate-400">
                  <th className="py-1">Left after</th>
                  <th className="py-1 text-right">Before</th>
                  <th className="py-1 text-right">After</th>
                </tr>
              </thead>
              <tbody>
                <After label="Interest" before={preview.interestBefore} after={preview.interestAfter} />
                <After label="Costs, incl the new receipt fee" before={preview.costsBefore} after={preview.costsAfter} />
                <After label="Capital" before={preview.capitalBefore} after={preview.capitalAfter} />
              </tbody>
            </table>
            {!preview.hasRate && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
                No commission rate on this account or its client, so nothing is taken and the client
                would be paid all of the capital. Set one before this payment is paid over.
              </p>
            )}
            <p className="mt-2 text-xs text-slate-400">
              Nothing is written. The same balances and the same split as a payment that has
              actually arrived.
            </p>
          </>
        )}
      </div>
    </Card>
  )
}

function Bucket({ label, charged, taken, left, cant }: {
  label: string; charged: number; taken: number; left: number; cant: number | null
}) {
  return (
    <tr className="border-b border-slate-50">
      <td className="py-1.5 text-slate-700">{label}</td>
      <td className="py-1.5 text-right tabular-nums text-slate-500">{rand(charged)}</td>
      <td className="py-1.5 text-right tabular-nums text-emerald-700">{rand(taken)}</td>
      <td className="py-1.5 text-right tabular-nums font-medium">{rand(left)}</td>
      <td className="py-1.5 text-right tabular-nums text-negative-600">{randOrDash(cant)}</td>
    </tr>
  )
}

function Row({ label, value, sub }: { label: string; value: number; sub?: boolean }) {
  return (
    <tr className="border-b border-slate-50">
      <td className={clsx('py-1.5', sub ? 'pl-3 text-slate-500' : 'text-slate-700')}>{label}</td>
      <td className={clsx('py-1.5 text-right tabular-nums', sub ? 'text-slate-500' : 'text-slate-700')}>
        {value < 0 ? `− ${rand(Math.abs(value))}` : rand(value)}
      </td>
    </tr>
  )
}

function After({ label, before, after }: { label: string; before: number; after: number }) {
  return (
    <tr className="border-b border-slate-50">
      <td className="py-1.5 text-slate-600">{label}</td>
      <td className="py-1.5 text-right tabular-nums text-slate-400">{rand(before)}</td>
      <td className="py-1.5 text-right tabular-nums">{rand(after)}</td>
    </tr>
  )
}

function Chip({ children, tone }: { children: React.ReactNode; tone: 'ok' | 'bad' | 'plain' }) {
  return (
    <span className={clsx('rounded-full px-2.5 py-1 font-medium',
      tone === 'bad' ? 'bg-negative-50 text-negative-700'
        : tone === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600')}>
      {children}
    </span>
  )
}
