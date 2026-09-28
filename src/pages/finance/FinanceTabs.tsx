import { NavLink } from 'react-router-dom'
import clsx from 'clsx'

/**
 * The Finance section's own nav.
 *
 * FOUR ITEMS, NOT SIX. Prompt 5 listed an Overview, Payments, Exceptions, Payover runs, an account
 * ledger tab and a settings page; prompt 7 folded the overview and the run list into the work
 * queue, because they were the same screen asked for twice. The account ledger lives on the
 * account, where the account is, and the tariff settings live in Settings with the firm's other
 * settings. What is left is four places a person actually goes.
 *
 * BACK OFFICE IS A SEPARATE ITEM AND NOT ON THE QUEUE, on the firm's instruction in prompt 7D.
 * The queue is about paying clients; the back office is about what BF still has to come, and
 * mixing the two puts the firm's own income on the screen somebody works a client's money from.
 */
const TABS = [
  { to: '/finance', label: 'Payover queue', end: true },
  { to: '/finance/payments', label: 'Payments' },
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
