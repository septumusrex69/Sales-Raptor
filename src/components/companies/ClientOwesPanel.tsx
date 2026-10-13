import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { Card } from '../ui/Card'
import { controlClass, inputClass } from '../ui/Modal'
import { rand } from '../../lib/money'
import { clockToday } from '../../lib/clock.ts'
import { useAuth } from '../../store/AuthContext'
import { canViewBusiness, canViewFinance } from '../../lib/permissions'
import { arrangementStatus, type Arrangement } from '../../lib/clientArrangement'
import {
  cancelArrangement, fetchArrangement, fetchClientReceipts, fetchOwedItems, recordClientPayment, setArrangement,
  type OwedItem,
} from '../../lib/clientStatement'

/**
 * WHAT THIS CLIENT OWES THE FIRM, AND THEIR PAYMENTS AGAINST IT (S7).
 *
 * The firm, 12 Oct: "what if the client pays partially? What if he makes an installment arrangement
 * to pay with us? ... shouldn't we just have a statement?" So the payment is recorded HERE, against
 * the client, in any amount up to what they owe, and the database applies it oldest first. The run
 * page offers the same form for convenience; this is where it belongs, beside the ledger it changes.
 *
 * Drawn only when there is something owed or an arrangement standing: a box that says "owes nothing"
 * on every client is a warning that fires when nothing is wrong.
 */
export function ClientOwesPanel({ companyId, onChanged }: { companyId: string; onChanged?: () => void }) {
  const { currentUser } = useAuth()
  const may = canViewFinance(currentUser) && canViewBusiness(currentUser)
  const [items, setItems] = useState<OwedItem[] | null>(null)
  const [arr, setArr] = useState<Arrangement | null>(null)
  const [receipts, setReceipts] = useState<{ amount: number; receivedOn: string; reference: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'idle' | 'pay' | 'arrange'>('idle')
  const [busy, setBusy] = useState(false)
  const today = clockToday()
  /* the payment form */
  const [amount, setAmount] = useState('')
  const [on, setOn] = useState(today)
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  /* the arrangement form */
  const [instalment, setInstalment] = useState('')
  const [firstDue, setFirstDue] = useState(today)
  const [count, setCount] = useState('3')

  const load = useCallback(async () => {
    try {
      const [i, a, r] = await Promise.all([fetchOwedItems(companyId), fetchArrangement(companyId), fetchClientReceipts(companyId)])
      setItems(i); setArr(a); setReceipts(r)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [companyId])
  useEffect(() => { void load() }, [load])

  if (items === null) {
    return error ? <p className="text-[13px] text-negative-700">{error}</p> : null
  }
  const total = Math.round(items.reduce((t, i) => t + i.remaining, 0) * 100) / 100
  if (total === 0 && !arr) return null
  const status = arr ? arrangementStatus(arr, receipts, today) : null

  async function pay() {
    setBusy(true); setError(null)
    try {
      await recordClientPayment({ companyId, amount: Number(amount), receivedOn: on, reference, note })
      setMode('idle'); setAmount(''); setReference(''); setNote('')
      await load(); onChanged?.()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not record the payment.') } finally { setBusy(false) }
  }
  async function arrange() {
    setBusy(true); setError(null)
    try {
      await setArrangement(companyId, Number(instalment), firstDue, Number(count))
      setMode('idle'); await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not set up the arrangement.') } finally { setBusy(false) }
  }
  async function cancel() {
    setBusy(true); setError(null)
    try { await cancelArrangement(companyId); await load() } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not cancel the arrangement.')
    } finally { setBusy(false) }
  }

  return (
    <Card padded={false} className="overflow-hidden border-t-[3px] border-t-negative-400">
      <div data-testid="client-owes" className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h3 className="text-[16px] font-semibold text-slate-800">What they owe us</h3>
          <p className="text-[12.5px] text-slate-500">
            A payment into the business account clears the oldest first. What is still owed at their next payover comes off it.
          </p>
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold tabular-nums text-negative-700" data-testid="client-owes-total">{rand(total)}</div>
          {may && total > 0 && mode === 'idle' && (
            <div className="mt-1 flex gap-2 justify-end">
              <button type="button" data-testid="record-client-payment"
                onClick={() => { setMode('pay'); setAmount(total.toFixed(2)); setReference(items[0]?.kind === 'shortfall' ? `BF ${items[0].label}` : '') }}
                className="rounded-md bg-navy-900 px-3 py-1 text-[12.5px] font-medium text-white hover:bg-navy-800">
                Record a payment
              </button>
              <button type="button" data-testid="set-arrangement"
                onClick={() => { setMode('arrange'); setInstalment(arr ? String(arr.instalment) : (Math.ceil(total / 3 * 100) / 100).toFixed(2)) }}
                className="rounded-md border border-slate-200 px-3 py-1 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50">
                {arr ? 'Change arrangement' : 'Arrangement'}
              </button>
            </div>
          )}
        </div>
      </div>

      {error && <p className="bg-negative-50 px-5 py-2 text-[13px] text-negative-700">{error}</p>}

      {mode === 'pay' && (
        <div className="space-y-2 border-b border-slate-100 bg-slate-50/60 px-5 py-3 text-[13px]" data-testid="client-payment-form">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-slate-600">Amount
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount paid" className={`${controlClass} w-32`} />
            </label>
            <label className="flex items-center gap-1.5 text-slate-600">Received
              <input type="date" value={on} max={today} onChange={(e) => setOn(e.target.value)} className={`${controlClass} w-40`} />
            </label>
            <label className="flex items-center gap-1.5 text-slate-600">Reference
              <input value={reference} onChange={(e) => setReference(e.target.value)} aria-label="Reference" className={`${controlClass} w-48`} />
            </label>
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className={inputClass} />
          {Number(amount) > 0 && Number(amount) < total && (
            <p className="text-[12.5px] text-slate-500">A part payment: {rand(Math.round((total - Number(amount)) * 100) / 100)} stays owed.</p>
          )}
          {Number(amount) > total && (
            <p className="text-[12.5px] text-negative-700">That is more than they owe ({rand(total)}).</p>
          )}
          <div className="flex gap-2">
            <button type="button" disabled={busy || !(Number(amount) > 0) || Number(amount) > total || !reference.trim() || !on}
              onClick={() => void pay()}
              className="rounded-md bg-navy-900 px-3 py-1 font-medium text-white hover:bg-navy-800 disabled:opacity-50">
              {busy ? <Loader2 size={13} className="inline animate-spin" /> : 'Record it'}
            </button>
            <button type="button" onClick={() => setMode('idle')} className="text-slate-500 underline">Cancel</button>
          </div>
        </div>
      )}

      {mode === 'arrange' && (
        <div className="space-y-2 border-b border-slate-100 bg-slate-50/60 px-5 py-3 text-[13px]" data-testid="arrangement-form">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-slate-600">Each month
              <input inputMode="decimal" value={instalment} onChange={(e) => setInstalment(e.target.value)} aria-label="Instalment" className={`${controlClass} w-32`} />
            </label>
            <label className="flex items-center gap-1.5 text-slate-600">First due
              <input type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} aria-label="First due" className={`${controlClass} w-40`} />
            </label>
            <label className="flex items-center gap-1.5 text-slate-600">Payments
              <input inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} aria-label="Number of payments" className={`${controlClass} w-20`} />
            </label>
          </div>
          {Number(instalment) > 0 && Number(count) > 0 && (
            <p className="text-[12.5px] text-slate-500">
              {count} × {rand(Number(instalment))} = {rand(Math.round(Number(instalment) * Number(count) * 100) / 100)}
              {Math.abs(Number(instalment) * Number(count) - total) > 0.005 && ` against ${rand(total)} owed`}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" disabled={busy || !(Number(instalment) > 0) || !(Number(count) >= 1) || !firstDue} onClick={() => void arrange()}
              className="rounded-md bg-navy-900 px-3 py-1 font-medium text-white hover:bg-navy-800 disabled:opacity-50">
              {arr ? 'Replace it' : 'Set it up'}
            </button>
            <button type="button" onClick={() => setMode('idle')} className="text-slate-500 underline">Cancel</button>
          </div>
        </div>
      )}

      {items.length > 0 && (
        <table className="w-full list-table whitespace-nowrap">
          <thead>
            <tr className="text-left text-slate-400">
              <th className="px-5 py-2 font-medium">What</th>
              <th className="px-3 py-2 font-medium">Due</th>
              <th className="px-3 py-2 text-right font-medium">Owed</th>
              <th className="px-3 py-2 text-right font-medium">Paid</th>
              <th className="px-5 py-2 text-right font-medium">Still owed</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-t border-slate-50" data-testid="owed-item">
                <td className="px-5 py-1.5 text-slate-800">
                  {i.kind === 'shortfall'
                    ? <Link to={`/trust/runs/${i.id}`} className="hover:text-gold-700">Payover {i.label} came out below nil</Link>
                    : <>Invoice {i.label}</>}
                </td>
                <td className="px-3 py-1.5 tabular-nums text-slate-500">{fmtDay(i.dueOn)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{rand(i.owed)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{i.paid ? rand(i.paid) : '—'}</td>
                <td className="px-5 py-1.5 text-right font-semibold tabular-nums text-negative-700">{rand(i.remaining)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {arr && status && (
        <div className={clsx('flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3 text-[13px]',
          status.behind > 0 ? 'border-negative-100 bg-negative-50' : 'border-slate-100 bg-positive-50')} data-testid="arrangement-status">
          <span className="text-slate-700">
            <b>Arrangement:</b> {arr.instalments} × {rand(arr.instalment)} a month from {fmtDay(arr.firstDue)}.{' '}
            {status.finished ? 'Paid in full.'
              : status.behind > 0 ? <b className="text-negative-700">Behind by {rand(status.behind)}</b>
                : status.dueCount === 0 ? `First payment due ${fmtDay(arr.firstDue)}.`
                  : 'Up to date.'}
            {' '}<span className="text-slate-500">{rand(status.paidSince)} paid of {rand(status.dueSoFar)} due so far{status.nextDue ? ` · next ${fmtDay(status.nextDue)}` : ''}.</span>
          </span>
          {may && (
            <button type="button" disabled={busy} onClick={() => void cancel()} className="text-[12.5px] text-slate-500 underline">Cancel arrangement</button>
          )}
        </div>
      )}
    </Card>
  )
}

/* Written out: en-ZA abbreviates September to "Sept" (CLAUDE.md). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}
