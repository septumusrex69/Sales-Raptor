import { Outlet } from 'react-router-dom'
import {
  ArrowDownToLine, ArrowUpRight, Briefcase, CheckCheck, CircleGauge, Scale, Settings, TriangleAlert,
} from 'lucide-react'
import { WorkspaceRail, type RailItem } from '../../components/layout/WorkspaceRail'

/**
 * THE TRUST ACCOUNT: money held for other people.
 *
 * THE FIRM ASKED FOR THE TWO BOOKS APART: "the trust and the business should be separated. It
 * shouldn't be in the same tab in finance. It should be like outside, for example. So the trust,
 * we have one place where we manage the trust and we have another place outside where we manage
 * the business."
 *
 * SIX ITEMS, AND AT SIX IT NEEDS NO HEADINGS. The strip this replaced carried six too, of which one
 * -- Back office -- is the firm's OWN income and was held apart from the rest by nothing but a
 * comment. Under a workspace that names itself Trust it is visibly in the wrong room, and it has
 * moved to the other one.
 *
 * THE TRUST LEDGER IS HERE NOW, AND WAS DELIBERATELY ABSENT UNTIL IT OPENED. The creditors
 * ledger, the debtors inside it and the reconciliation were live in the DATABASE with no page, and
 * listing them would have drawn a menu item that opens nothing -- "a menu item that always refuses
 * is worse than no menu item", which this app has paid for once already. check-workspace-split
 * still fails the day any rail item names a route that does not exist.
 *
 * THE ORDER IS THE ORDER THE WORK HAPPENS IN, which is the firm's own instruction about the old
 * strip -- "first I want to see the payments. So first we work with payments. And then we work
 * with a pay over queue." Overview sits above all of it because it is the only screen that
 * answers "is the trust account right", and that question comes before any day's work on it.
 */
const ITEMS: RailItem[] = [
  { to: '/trust', label: 'Overview', icon: CircleGauge, end: true },
  { to: '/trust/payments', label: 'Payments in', icon: ArrowDownToLine },
  { to: '/trust/check', label: 'Check', icon: CheckCheck },
  { to: '/trust/payover', label: 'Payover runs', icon: ArrowUpRight },
  { to: '/trust/ledger', label: 'Trust ledger', icon: Scale },
  { to: '/trust/exceptions', label: 'Exceptions', icon: TriangleAlert },
]

export function TrustLayout() {
  return (
    <div className="flex h-full">
      <WorkspaceRail
        title="Trust"
        subtitle="Money held for other people"
        items={ITEMS}
        settings={{ to: '/trust/settings', label: 'Trust settings', icon: Settings }}
        door={{ to: '/business', label: 'Business account', icon: Briefcase }}
      />
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  )
}
