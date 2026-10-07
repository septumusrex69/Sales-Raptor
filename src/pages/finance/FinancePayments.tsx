import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { rand } from '../../lib/money'
import { firmToday } from '../../lib/dateLabels'
import { fetchProcessedMonth, type ProcessedMonth } from '../../lib/payover'
import { BankImportCard } from './BankImportCard'
import { UnallocatedReceipts } from './UnallocatedReceipts'
import { RecordPaymentModal } from './RecordPaymentModal'
import { AwaitingApproval } from './AwaitingApproval'

/**
 * PAYMENTS IN: WHERE THE DAY'S MONEY IS PROCESSED, AND NOTHING ELSE.
 *
 * THE FIRM, REDESIGNING IT: "Payments in is only for processing current payments. If you want to
 * go find the payment that is processed, you should go to other panes." So, top to bottom:
 *
 *   1. THE TWO WAYS MONEY ARRIVES, side by side -- record a payment by hand (a PTC never reaches a
 *      statement), or choose a statement.
 *   2. THE OVERVIEW: pending processing, processed into trust, paid directly to the client, and
 *      unmatched/suspense. The two "processed" tiles are this month's, summed in the database.
 *   3. THE QUEUE of payments still to process -- and only those.
 *   4. SUSPENSE, below the pending payments, where the firm asked for it.
 *
 * WHAT WENT: the list of every payment ever, with its "Every client" and "Trust and client-direct"
 * filters. A processed payment is found on Check (every posted receipt, checked against the
 * formulas) and the trust ledger. REVERSING ONE moved with it to Check -- it was this list's row
 * action and the only place in the app that could reverse a payment, so removing the list without
 * moving it would have removed the firm's only way to undo a posted receipt.
 */
export function FinancePayments() {
  /* Bumped whenever an import, a placement or an approval changes the ledger, so the queue, the
     tiles and suspense reload together rather than disagreeing about what has been placed. */
  const [changed, setChanged] = useState(0)
  const [recording, setRecording] = useState(false)
  const [pending, setPending] = useState<{ count: number; total: number } | null>(null)
  const [unmatched, setUnmatched] = useState<{ count: number; total: number } | null>(null)
  const [month, setMonth] = useState<ProcessedMonth | null>(null)
  const bump = useCallback(() => setChanged((n) => n + 1), [])

  useEffect(() => {
    const today = firmToday()
    let live = true
    fetchProcessedMonth(`${today.slice(0, 8)}01`, today)
      .then((m) => { if (live) setMonth(m) })
      .catch(() => { if (live) setMonth(null) })
    return () => { live = false }
  }, [changed])

  const onLoaded = useCallback((count: number, total: number) => setPending({ count, total }), [])
  const onUnmatched = useCallback((count: number, total: number) => setUnmatched({ count, total }), [])

  return (
    <div className="space-y-4">
      {/*
        THE TWO WAYS IN, NEXT TO EACH OTHER. Said beside the button because it is the thing people
        get wrong: a statement only ever carries money that reached the firm's own bank, so a
        debtor who paid the CLIENT direct never appears on one and has to be recorded by hand.
      */}
      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <div className="card p-5 h-full">
          <h3 className="font-semibold text-[15px] text-slate-800">Record a payment</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            By hand. A PTC never comes in on a statement — the debtor paid the client.
          </p>
          <button type="button" onClick={() => setRecording(true)}
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg
              border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500">
            <Plus size={14} /> Record a payment
          </button>
        </div>
        <BankImportCard onImported={bump} />
      </div>

      {/* THE OVERVIEW. A dash while a figure is being read, never a nought it has not earned. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="payments-overview">
        <OverviewTile label="Pending processing" tone="gold"
          value={pending ? rand(pending.total) : '—'}
          note={pending ? `${pending.count.toLocaleString('en-ZA')} waiting for approval` : 'Reading the queue…'} />
        <OverviewTile label="Processed in trust" value={month ? rand(month.trustAmount) : '—'}
          note={month ? `${month.trustCount.toLocaleString('en-ZA')} this month` : 'This month'} />
        <OverviewTile label="Paid directly to client" value={month ? rand(month.ptcAmount) : '—'}
          note={month ? `${month.ptcCount.toLocaleString('en-ZA')} PTCs this month` : 'This month'} />
        <OverviewTile label="Unmatched / suspense" tone={unmatched && unmatched.count > 0 ? 'warn' : undefined}
          value={unmatched ? rand(unmatched.total) : '—'}
          note={unmatched ? `${unmatched.count.toLocaleString('en-ZA')} to place, below the queue` : 'Reading suspense…'} />
      </div>

      {/*
        THE QUEUE IS THE DAY'S WORK: money arrives, somebody checks what each payment would do, and
        approves it. Nothing below this has happened until they do.
      */}
      <AwaitingApproval refreshKey={changed} onApproved={bump} onLoaded={onLoaded} />

      {/* SUSPENSE LIVES HERE, BELOW THE PENDING PAYMENTS, at the firm's asking. */}
      <UnallocatedReceipts refreshKey={changed} onPlaced={bump} onTotals={onUnmatched} />

      <p className="text-[12px] text-slate-400">
        Looking for a payment that has already been processed?{' '}
        <Link to="/trust/check" className="font-medium text-[var(--c-steel)] hover:underline">Check</Link>
        {' '}lists every posted receipt, and is where one is reversed.
      </p>

      {recording && (
        <RecordPaymentModal onClose={() => setRecording(false)}
          onDone={async () => { bump() }} />
      )}
    </div>
  )
}

function OverviewTile({ label, value, note, tone }: {
  label: string; value: string; note?: string; tone?: 'gold' | 'warn'
}) {
  return (
    <div className={`card px-4 py-3 ${tone === 'gold' ? 'border-l-4 border-l-gold-400' : tone === 'warn' ? 'border-l-4 border-l-amber-500' : ''}`}>
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-[18px] font-semibold tabular-nums text-navy-950">{value}</p>
      {note && <p className="text-[11.5px] text-slate-400 mt-0.5">{note}</p>}
    </div>
  )
}
