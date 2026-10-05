import { Outlet } from 'react-router-dom'
import {
  ArrowDownToLine, ArrowUpRight, Briefcase, CheckCheck, CircleGauge, Scale, Settings,
  TriangleAlert,
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
 * SIX ITEMS, AND AT SIX IT NEEDS NO HEADINGS. The strip this replaced carried the same six plus
 * Back office, which is the firm's own income and was held apart from them by nothing but a
 * comment. Under a workspace that names itself Trust, Back office is visibly in the wrong room
 * and has moved to the other one.
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
    <div className="flex gap-6 h-full">
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
