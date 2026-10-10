import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { rand } from '../../lib/money'
import { firmToday } from '../../lib/dateLabels'
import { formatDate } from '../../data/mockData'
import { fetchProcessedMonth, type ProcessedMonth } from '../../lib/payover'
import { BankImportCard, LatestStatement } from './BankImportCard'
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
    <div className="space-y-5">
      {/*
        THE FIRM'S OWN MOCK-UP, 7 October: two buttons on one line, one card of four figures, the
        last statement folded into a line, then the queue and what needs an account -- "This looks
        much better. Do something like this."

        THE TWO WAYS IN, NEXT TO EACH OTHER. A statement only ever carries money that reached the
        firm's own bank, so a debtor who paid the CLIENT direct never appears on one and has to be
        recorded by hand -- which is why Record payment is the gold one.
      */}
      <BankImportCard compact onImported={bump}
        leading={(
          <button type="button" onClick={() => setRecording(true)}
            title="By hand. A PTC never comes in on a statement — the debtor paid the client."
            className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg
              border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500">
            <Plus size={14} /> Record payment
          </button>
        )}
        trailing={<span className="ml-auto text-[13px] text-slate-500">{formatDate(firmToday())}</span>} />

      {/* THE FOUR FIGURES, IN ONE CARD. A dash while one is being read, never a nought it has not
          earned. Needs an account turns amber when there is something in it. */}
      <div className="card grid grid-cols-1 gap-px overflow-hidden bg-slate-200 sm:grid-cols-2 xl:grid-cols-4" data-testid="payments-overview">
        <OverviewTile label="Waiting for approval"
          value={pending ? rand(pending.total) : '—'}
          note={pending ? `${pending.count.toLocaleString('en-ZA')} payment${pending.count === 1 ? '' : 's'}` : 'Reading the queue…'} />
        <OverviewTile label="Processed into trust" value={month ? rand(month.trustAmount) : '—'}
          note={month ? `${month.trustCount.toLocaleString('en-ZA')} payments this month` : 'This month'} />
        <OverviewTile label="Paid to clients · PTC" value={month ? rand(month.ptcAmount) : '—'}
          note={month ? `${month.ptcCount.toLocaleString('en-ZA')} payments this month` : 'This month'} />
        <OverviewTile label="Needs an account" warn={!!unmatched && unmatched.count > 0}
          value={unmatched ? rand(unmatched.total) : '—'}
          note={unmatched ? `${unmatched.count.toLocaleString('en-ZA')} receipt${unmatched.count === 1 ? '' : 's'} in suspense` : 'Reading suspense…'} />
      </div>

      <LatestStatement refreshKey={changed} />

      {/*
        THE QUEUE IS THE DAY'S WORK: money arrives, somebody checks what each payment would do, and
        approves it. Nothing below this has happened until they do.
      */}
      <AwaitingApproval refreshKey={changed} onApproved={bump} onLoaded={onLoaded} />

      {/* SUSPENSE LIVES HERE, BELOW THE PENDING PAYMENTS, at the firm's asking -- named the way
          their mock-up names it: Needs an account. */}
      <UnallocatedReceipts refreshKey={changed} onPlaced={bump} onTotals={onUnmatched} />

      <p className="text-[12px] text-slate-400">
        Looking for a payment that has already been processed?{' '}
        <Link to="/trust/check" className="font-medium text-[var(--c-steel)] hover:underline">Payment history</Link>
        {' '}lists every posted receipt, and is where one is reversed.
      </p>

      {recording && (
        <RecordPaymentModal onClose={() => setRecording(false)}
          onDone={async () => { bump() }} />
      )}
    </div>
  )
}

/* One quarter of the overview card. The rules between them are the card's 1px gap showing through,
   so the four read as one panel of figures at any width rather than four cards competing with the
   queue. */
function OverviewTile({ label, value, note, warn }: {
  label: string; value: string; note?: string; warn?: boolean
}) {
  return (
    <div className="bg-[var(--color-card-solid,var(--color-card))] px-5 py-4">
      <p className="text-[13px] text-slate-500">{label}</p>
      <p className={`mt-1 text-[22px] font-semibold tabular-nums ${warn ? 'text-amber-700' : 'text-navy-950'}`}>{value}</p>
      {note && <p className="text-[12.5px] text-slate-500 mt-1">{note}</p>}
    </div>
  )
}
