import { Outlet } from 'react-router-dom'
import { ArrowRightLeft, Briefcase, Landmark, Receipt, TrendingUp } from 'lucide-react'
import { WorkspaceRail, type RailItem } from '../../components/layout/WorkspaceRail'
import { useAuth } from '../../store/AuthContext'
import { canViewIncome } from '../../lib/permissions'

/**
 * THE FIRM'S OWN ACCOUNTS: what Bredell Ferreira earned, spent, and is owed.
 *
 * THE FIRM ASKED FOR IT OUTSIDE THE TRUST, NOT UNDER IT: "the trust and the business should be
 * separated. It shouldn't be in the same tab in finance. It should be like outside, for example.
 * So the trust, we have one place where we manage the trust and we have another place outside
 * where we manage the business."
 *
 * EXPENSES ARRIVED AND SO THE RAIL GREW. It listed two items while the firm's own spending was
 * database-less, because nothing is listed here that does not open -- a rail of greyed-out items
 * promising screens that do not exist is a menu that lies, and check-workspace-split fails the day
 * one is added without a route. Income and Drawings arrived the same way, each with its route.
 *
 * INCOME IS LISTED ONLY FOR WHOEVER MAY OPEN IT. business.income is in no role, the Administrator's
 * included ("not even for an administrator"), so for nearly everybody the item is simply not there
 * -- an item that opens onto a redirect is the same lie as a greyed-out one.
 *
 * BACK OFFICE IS THE ONE, AND IT MOVED HERE RATHER THAN BEING WRITTEN. It is what the firm still
 * has to come in -- its own income -- and it spent its whole life as the fifth tab in a strip of
 * trust screens, held apart from them by nothing but a comment in FinanceTabs explaining that it
 * must not be mixed with the payover queue. Under a workspace that names itself, the comment
 * becomes the structure.
 */
const INCOME: RailItem = { to: '/business/income', label: 'Income', icon: TrendingUp }
const ITEMS: RailItem[] = [
  { to: '/business', label: 'Overview', icon: Briefcase, end: true },
  { to: '/business/expenses', label: 'Expenses', icon: Receipt },
  { to: '/business/drawings', label: 'Drawings', icon: ArrowRightLeft },
  { to: '/business/back-office', label: 'Back office', icon: Landmark },
]

export function BusinessLayout() {
  const { currentUser } = useAuth()
  const items = canViewIncome(currentUser) ? [ITEMS[0], INCOME, ...ITEMS.slice(1)] : ITEMS
  return (
    <div className="flex gap-6 h-full">
      <WorkspaceRail
        title="Business"
        subtitle="The firm's own money"
        items={items}
        door={{ to: '/trust', label: 'Trust account', icon: Landmark }}
      />
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  )
}
