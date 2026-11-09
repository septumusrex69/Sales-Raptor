import { useCallback, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { rand } from '../../lib/money'
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
   * SUSPENSE AS A TILE THAT OPENS (S21 · Raptor H19). Stephan, 9 Nov: "the suspense is basically, you click on the
   * suspense and it opens it. So it will show you the suspense and total number ... Then you can search a payment, for
   * example, in there." Folded, it is the count and the total; open, the whole list with its search. Opened already
   * when a link names it (#suspense, as the overview's Needs attention does). The list stays MOUNTED while folded, so
   * the tile's figures are the list's own (onTotals) rather than a second read that could disagree with it.
   */
  const [suspenseOpen, setSuspenseOpen] = useState(() => typeof window !== 'undefined' && window.location.hash === '#suspense')
  const [suspense, setSuspense] = useState<{ count: number; total: number } | null>(null)
  const onSuspense = useCallback((count: number, total: number) => setSuspense({ count, total }), [])
  return (
    <div className="space-y-6" data-testid="to-sort">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-800">To sort</h1>
        <p className="mt-1 text-sm text-slate-500">
          Money in the trust account that is not yet anybody&rsquo;s: suspense, statement lines to allocate,
          overpayments to decide, and anything else holding a payover up.
        </p>
        <nav className="mt-3 flex flex-wrap gap-2 text-[12.5px]">
          {[['#suspense', 'Suspense'], ['#lines', 'Statement lines'], ['#overpayments', 'Overpayments'], ['#other', 'Other']].map(([href, label]) => (
            <a key={href} href={href} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600 hover:bg-slate-50">{label}</a>
          ))}
        </nav>
      </div>

      <section id="suspense" className="space-y-2">
        <button type="button" onClick={() => setSuspenseOpen((o) => !o)} aria-expanded={suspenseOpen} data-testid="suspense-tile"
          className="card flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-slate-50">
          {suspenseOpen ? <ChevronDown size={18} className="text-slate-400" /> : <ChevronRight size={18} className="text-slate-400" />}
          <span className="min-w-0 flex-1">
            <span className="block text-lg font-semibold tracking-tight text-slate-800">Suspense</span>
            <span className="block text-[12.5px] text-slate-500">
              {suspense ? `${suspense.count.toLocaleString('en-ZA')} receipt${suspense.count === 1 ? '' : 's'} with no account yet` : 'Reading suspense…'}
              {suspenseOpen ? '' : ' · open it to search and place them'}
            </span>
          </span>
          <span className={`text-xl font-semibold tabular-nums ${suspense && suspense.count > 0 ? 'text-amber-700' : 'text-slate-800'}`} data-testid="suspense-total">
            {suspense ? rand(suspense.total) : '—'}
          </span>
        </button>
        <div hidden={!suspenseOpen}>
          <UnallocatedReceipts refreshKey={changed} onPlaced={bump} hidePayouts onTotals={onSuspense} />
        </div>
      </section>

      <section id="lines" className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight text-slate-800">Statement lines to allocate</h2>
        <BankLinesToAllocate />
      </section>

      <section className="space-y-2">
        <TrustOverpayments embedded />
        <ParkedCredits />
      </section>

      <section id="other" className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight text-slate-800">Anything else holding a payover up</h2>
        <FinanceExceptions embedded />
      </section>
    </div>
  )
}
