import { NavLink } from 'react-router-dom'
import clsx from 'clsx'

/**
 * The Finance section's own nav.
 *
 * FIVE ITEMS, NOT SIX. Prompt 5 listed an Overview, Payments, Exceptions, Payover runs, an account
 * ledger tab and a settings page; prompt 7 folded the overview and the run list into the work
 * queue, because they were the same screen asked for twice. The account ledger lives on the
 * account, where the account is, and the tariff settings live in Settings with the firm's other
 * settings. What is left is four places a person actually goes.
 *
 * BACK OFFICE IS A SEPARATE ITEM AND NOT ON THE QUEUE, on the firm's instruction in prompt 7D.
 * The queue is about paying clients; the back office is about what BF still has to come, and
 * mixing the two puts the firm's own income on the screen somebody works a client's money from.
 */
/*
 * PAYMENTS FIRST, THEN THE PAYOVER QUEUE. The firm: "the first pane and the first tab that I want
 * to see... first I want to see the payments. So first we work with payments. And then we work
 * with a pay over queue."
 *
 * AND IT IS THE ORDER THE WORK HAPPENS IN, which is why it is worth moving rather than arguing:
 * money arrives, it is allocated and approved, and only then is there anything to pay a client
 * with. The queue was the index because it was built first.
 */
/*
 * AND A FIFTH, FOR WHAT HAS ALREADY GONE THROUGH. The firm: "you can add whatever you need for the
 * administrator to ensure that we can double check every single thing that comes in." Payments is
 * the queue -- receipts that have NOT posted, checked before they do. Check is the other half:
 * every receipt that HAS, with the same formulas run over what the engine actually wrote. It sits
 * next to Payments because it is the same money one step later, and before Exceptions because an
 * exception is something Raptor already noticed, while this is where somebody looks for what it
 * did not.
 */
const TABS = [
  { to: '/finance', label: 'Payments', end: true },
  { to: '/finance/check', label: 'Check' },
  { to: '/finance/payover', label: 'Payover queue' },
  { to: '/finance/exceptions', label: 'Exceptions' },
  { to: '/finance/back-office', label: 'Back office' },
  { to: '/finance/settings', label: 'Settings' },
]

export function FinanceTabs() {
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-100 pb-2">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) => clsx(
            'rounded-lg px-3 py-1.5 text-[13.5px] font-medium transition-colors',
            isActive ? 'bg-slate-100 text-slate-800' : 'text-slate-500 hover:bg-slate-50',
          )}
        >
          {t.label}
        </NavLink>
      ))}
    </div>
  )
}
