import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { rand } from '../../lib/money'
import { fetchLinesToAllocate } from '../../lib/bankAllocationApi'
import { fetchExceptions, type ExceptionJob } from '../../lib/payover'
import { UnallocatedReceipts } from '../finance/UnallocatedReceipts'
import { BankLinesToAllocate } from '../../components/finance/BankLinesToAllocate'
import { ParkedCredits } from '../../components/finance/ParkedCredits'
import { FinanceExceptions } from '../finance/FinanceExceptions'
import { TrustOverpayments } from './TrustOverpayments'

/**
 * TO SORT: EVERYTHING IN THE TRUST ACCOUNT THAT IS NOT YET SOMEBODY'S, ON ONE PAGE (S7).
 *
 * The firm, 13 Oct: "there's a tab for overpayments and then there's another tab for exceptions. And
 * then, for example, the suspense account ... I don't know where we can see the suspense account."
 * Three menu items for one job -- money that needs a decision before it can be paid over -- and the
 * firm's own word for the first of them, suspense, was on none of them. So one page, in the order the
 * money arrives:
 *   1. SUSPENSE -- receipts on the statement nobody has placed on an account (the same list as Payments
 *      in, Needs an account; placed from either);
 *   2. statement lines to allocate -- money out, or a credit that is not a debtor's;
 *   3. overpayments -- decided, refunded, parked, start to finish;
 *   4. the rest -- a missing commission rate, money on a closed file.
 * /trust/overpayments still opens (it is linked from mail already sent) and lands here.
 */
export function TrustToSort() {
  const [changed, setChanged] = useState(0)
  const bump = useCallback(() => setChanged((n) => n + 1), [])
  /*
   * EVERY SECTION A TILE THAT OPENS (S21 · Raptor H19). Stephan, 9 Nov, of suspense first: "you click on the suspense
   * and it opens it. So it will show you the suspense and total number"; then of the whole Trust area: "it's still a
   * little bit complicated". So each of the four is folded to its count and total, and opens to the list it always
   * was. A link that names a section (#suspense, #overpayments) opens it already.
   *
   * THE FIGURES ARE THE SECTIONS' OWN DATA: suspense counts itself (onTotals, the list stays mounted while folded);
   * the other three read the same functions their lists read (fetchLinesToAllocate, finance_exception_jobs), so a
   * tile cannot say one thing and open on another.
   */
  const hash = typeof window !== 'undefined' ? window.location.hash : ''
  const [suspense, setSuspense] = useState<{ count: number; total: number } | null>(null)
  const onSuspense = useCallback((count: number, total: number) => setSuspense({ count, total }), [])
  const [lines, setLines] = useState<{ count: number; total: number } | null>(null)
  const [jobs, setJobs] = useState<ExceptionJob[] | null>(null)
  useEffect(() => {
    let live = true
    fetchLinesToAllocate()
      .then((l) => { if (live) setLines({ count: l.length, total: r2(l.reduce((t, x) => t + Math.abs(x.amount), 0)) }) })
      .catch(() => { if (live) setLines(null) })
    fetchExceptions()
      .then((j) => { if (live) setJobs(j) })
      .catch(() => { if (live) setJobs(null) })
    return () => { live = false }
  }, [changed])
  const over = jobs?.filter((j) => j.kind === 'excess_credit') ?? null
  const other = jobs?.filter((j) => j.kind !== 'excess_credit') ?? null
  const sum = (xs: ExceptionJob[]) => r2(xs.reduce((t, x) => t + Math.abs(x.amount ?? 0), 0))

  return (
    <div className="space-y-4" data-testid="to-sort">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-800">To sort</h1>
        <p className="mt-1 text-sm text-slate-500">
          Money in the trust account that is not yet anybody&rsquo;s. Open the one you are working on.
        </p>
      </div>

      <Fold id="suspense" testId="suspense-tile" title="Suspense" open={hash === '#suspense'}
        figures={suspense} noun={['receipt with no account yet', 'receipts with no account yet']} totalTestId="suspense-total">
        <UnallocatedReceipts refreshKey={changed} onPlaced={bump} hidePayouts onTotals={onSuspense} />
      </Fold>

      <Fold id="lines" testId="lines-tile" title="Statement lines to allocate" open={hash === '#lines'}
        figures={lines} noun={['line to allocate', 'lines to allocate']}>
        <BankLinesToAllocate />
      </Fold>

      <Fold id="overpayments" testId="overpayments-tile" title="Overpayments" open={hash === '#overpayments'}
        figures={over ? { count: over.length, total: sum(over) } : null} noun={['overpayment to decide', 'overpayments to decide']}>
        <TrustOverpayments embedded />
        <ParkedCredits />
      </Fold>

      <Fold id="other" testId="other-tile" title="Anything else holding a payover up" open={hash === '#other'}
        figures={other ? { count: other.length, total: sum(other) } : null} noun={['item', 'items']}>
        <FinanceExceptions embedded />
      </Fold>
    </div>
  )
}

const r2 = (v: number): number => Math.round(v * 100) / 100

/* One folded section: the title, how many and how much, and the list under it. The list stays mounted while folded
   (hidden), so it keeps its own state -- a search typed, a row opened -- when the tile is folded and opened again. */
function Fold({ id, testId, title, open: startOpen, figures, noun, totalTestId, children }: {
  id: string; testId: string; title: string; open: boolean
  figures: { count: number; total: number } | null; noun: [string, string]; totalTestId?: string; children: ReactNode
}) {
  const [open, setOpen] = useState(startOpen)
  const busy = !!figures && figures.count > 0
  return (
    <section id={id} className="scroll-mt-4 space-y-2">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid={testId}
        className="card flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-slate-50">
        {open ? <ChevronDown size={18} className="text-slate-400" /> : <ChevronRight size={18} className="text-slate-400" />}
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-semibold tracking-tight text-slate-800">{title}</span>
          <span className="block text-[12.5px] text-slate-500">
            {figures ? (figures.count === 0 ? 'Nothing to sort' : `${figures.count.toLocaleString('en-ZA')} ${figures.count === 1 ? noun[0] : noun[1]}`) : 'Reading…'}
          </span>
        </span>
        <span className={`text-xl font-semibold tabular-nums ${busy ? 'text-amber-700' : 'text-slate-800'}`} data-testid={totalTestId}>
          {figures ? rand(figures.total) : '—'}
        </span>
      </button>
      <div hidden={!open}>{children}</div>
    </section>
  )
}
