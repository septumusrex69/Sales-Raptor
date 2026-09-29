import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { rand } from '../../lib/money'
import { formatDate } from '../../data/mockData'
import { fetchAwaitingApproval, approvePayments, type AwaitingPayment } from '../../lib/payover'

/**
 * THE DAY'S PAYMENTS, WAITING TO BE APPROVED.
 *
 * THE FIRM: "There should be a state of payments and payments that should be approved on a daily
 * basis... You should be able to approve every payment singly, or approve all payments, or
 * highlight certain ones and approve them."
 *
 * NOTHING HERE HAS HAPPENED YET, and that is the point. The figures are `preview_allocation` --
 * the same arithmetic the collector's dry run uses -- so what is approved is what was shown. No
 * balance has moved, no receipt fee has been raised, and no payover run can see any of it: an
 * unapproved payment has no allocation, and a run gathers allocations.
 *
 * THEY CARRY OVER BY THEMSELVES. The firm: "if there's a payment that has not been approved on a
 * specific day, then it carries over and it stays there." This list is everything not yet
 * approved, whatever day it arrived -- no nightly job, and so no night it fails to run.
 */
export function AwaitingApproval({ refreshKey, onApproved }: {
  refreshKey: number
  onApproved: () => void
}) {
  const [rows, setRows] = useState<AwaitingPayment[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setRows(await fetchAwaitingApproval()) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load the day’s payments.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load, refreshKey])

  const total = useMemo(() => rows.reduce((n, r) => n + r.amount, 0), [rows])
  const pickedTotal = useMemo(
    () => rows.filter((r) => picked.has(r.paymentId)).reduce((n, r) => n + r.amount, 0),
    [rows, picked],
  )

  async function approve(ids: string[]) {
    if (ids.length === 0 || busy) return
    setBusy(true); setError(null)
    try {
      const out = await approvePayments(ids)
      /* A PAYMENT THAT COULD NOT GO THROUGH NAMES ITSELF and the rest still did -- the database
         approves them one at a time inside one call. Reported rather than swallowed. */
      if (out.problems.length > 0) {
        setError(`${out.approved} approved, ${out.skipped} could not be: ${out.problems.slice(0, 3).join('; ')}`)
      }
      setPicked(new Set())
      await load()
      onApproved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Those payments could not be approved.')
    } finally { setBusy(false) }
  }

  function toggle(id: string) {
    setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  if (loading) {
    return <Card><div className="py-8 text-center"><Loader2 className="mx-auto w-4 h-4 animate-spin text-slate-400" /></div></Card>
  }
  if (rows.length === 0) {
    return (
      <Card>
        <p className="py-4 text-center text-[13px] text-slate-500">
          No payments waiting. Everything that has arrived has been approved.
        </p>
      </Card>
    )
  }

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <h3 className="text-[15px] font-semibold text-slate-800">Payments waiting for you</h3>
          <p className="text-[12px] text-slate-500">
            Nothing has moved yet. These are the figures each one would post if you approve it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-semibold tabular-nums text-navy-950">{rand(total)}</span>
          <button type="button" disabled={busy || picked.size === 0}
            onClick={() => void approve([...picked])}
            className="text-xs font-medium px-2.5 py-1.5 rounded-md border border-slate-200
              text-slate-600 hover:border-[#c9a052] hover:bg-gold-50 disabled:opacity-40">
            Approve {picked.size} · {rand(pickedTotal)}
          </button>
          <button type="button" disabled={busy}
            onClick={() => void approve(rows.map((r) => r.paymentId))}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg
              border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500 disabled:opacity-40">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Approve all {rows.length}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-negative-50 px-4 py-2.5 text-[13px] text-negative-700">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px] whitespace-nowrap">
          <thead className="text-[10.5px] uppercase tracking-wide text-slate-500">
            <tr className="border-b border-slate-100">
              <th className="px-3 py-2">
                <input type="checkbox"
                  checked={picked.size === rows.length && rows.length > 0}
                  onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.paymentId)) : new Set())} />
              </th>
              <th className="px-2 py-2 text-left font-medium">Received</th>
              <th className="px-2 py-2 text-left font-medium">Account</th>
              <th className="px-2 py-2 text-left font-medium">Debtor</th>
              <th className="px-2 py-2 text-right font-medium">Payment</th>
              <th className="px-2 py-2 text-right font-medium">Receipt fee</th>
              {/*
                THE FIRM'S OWN WORDS, off their export: retained interest, retained legal fees,
                retained collection commission.

                AND THE THIRD ONE IS THE POINT. "Swordfish made that part of the retained legal
                fees. Not anything else. So I think it's important for us to split this." It is
                already split here and always has been -- to_interest, to_costs, commission and
                commission_vat are four columns on payment_allocations, never one. What was
                missing was the firm's names on them, so nobody could see that the thing they
                asked for was already true.

                INTEREST BEFORE FEES is the firm's order and the reverse of Swordfish's: VAT is on
                fees and not on interest, so taking interest first carries less risk if the debtor
                stops paying.
              */}
              <th className="px-2 py-2 text-right font-medium">Retained interest</th>
              <th className="px-2 py-2 text-right font-medium">Retained legal fees</th>
              <th className="px-2 py-2 text-right font-medium">Capital</th>
              <th className="px-2 py-2 text-right font-medium">Retained col. commission</th>
              <th className="px-2 py-2 text-right font-medium">VAT</th>
              <th className="px-2 py-2 text-right font-medium">To client</th>
              <th className="px-2 py-2 text-right font-medium">Due to BF</th>
              <th className="px-2 py-2 text-left font-medium">Type</th>
              <th className="px-2 py-2 text-left font-medium">Reference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.paymentId}
                className={`border-b border-slate-50 ${picked.has(r.paymentId) ? 'bg-gold-50/40' : ''}`}>
                <td className="px-3 py-1.5">
                  <input type="checkbox" checked={picked.has(r.paymentId)}
                    onChange={() => toggle(r.paymentId)} />
                </td>
                <td className="px-2 py-1.5 text-slate-600">{formatDate(r.receivedOn)}</td>
                <td className="px-2 py-1.5 text-slate-600">{r.caseNumber ?? r.accountNumber}</td>
                <td className="px-2 py-1.5 text-slate-600 max-w-[12rem] truncate">{r.debtor}</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-medium text-navy-950">{rand(r.amount)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{rand(r.receiptFee)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{rand(r.toInterest)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{rand(r.toCosts)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{rand(r.toCapital)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">
                  {/* NO RATE IS NOT A ZERO. Approving still writes the allocation, marked
                      needs_rate, and the exceptions screen carries it -- but a confident 0.00
                      here would read as "this client pays us nothing". */}
                  {r.hasRate ? rand(r.commission) : <span className="text-amber-700">no rate</span>}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{rand(r.commissionVat)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-[var(--c-green)]">{rand(r.toClient)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{rand(r.dueToBf)}</td>
                <td className="px-2 py-1.5">
                  {/* THE TWO DIRECTIONS OF MONEY, named the way the firm's own export names them. */}
                  <span className={`text-[10.5px] px-1.5 py-0.5 rounded ${
                    r.paidToClient
                      ? 'bg-[var(--tint-steel)] text-[var(--c-navy-mid)]'
                      : 'bg-slate-100 text-slate-600'}`}>
                    {r.paidToClient ? 'Client direct' : 'Direct'}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-slate-500 max-w-[14rem] truncate"
                  title={r.bankDescription ?? r.details ?? ''}>
                  {r.reference ?? r.bankDescription ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
