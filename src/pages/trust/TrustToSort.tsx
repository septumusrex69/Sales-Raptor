import { useCallback, useState } from 'react'
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
        <h2 className="text-lg font-semibold tracking-tight text-slate-800">Suspense</h2>
        <UnallocatedReceipts refreshKey={changed} onPlaced={bump} hidePayouts />
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
