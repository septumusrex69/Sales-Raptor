import { Outlet } from 'react-router-dom'
import { CalendarDays, CalendarRange, History, Percent, Users } from 'lucide-react'
import { WorkspaceRail, type RailItem } from '../../components/layout/WorkspaceRail'
import { useAuth } from '../../store/AuthContext'
import { canViewPay } from '../../lib/permissions'

/**
 * PEOPLE: EMPLOYEE PROFILES, PAY, AND THE CLERKS' COLLECTION COMMISSION (22 Oct 2026).
 *
 * THE FIRM (Stephan): "start building ... salaries. Like an employee, basically an employee profile
 * and an HR type of function. What each person's performance metrics are, what their salaries are."
 *
 * ITS OWN WORKSPACE, like Trust and Business, and for the same reason: who may see it is a different
 * list again. Pay is seen by two people the firm named -- "not by role, not even all Administrators"
 * -- so it cannot live inside Business (an Administrator's tick) or Settings (everybody's users).
 *
 * NEVER ON THE COMPANY DASHBOARD. CLAUDE.md: no commission there, ever; that includes the clerks'.
 *
 * WHAT IS NOT HERE YET, ON PURPOSE: the sales and communications commission schemes and the KPIs.
 * The firm: "I'll share that with you later." Their people show a basic salary and say the scheme is
 * not set up, rather than a scheme somebody guessed.
 */
/*
 * LEAVE (23 Oct) IS THE ONE ITEM HERE THAT IS NOT PAY, and the only one somebody without people.pay
 * is shown: any Administrator, and a team leader for their own team. The pay items are drawn for the
 * pay holders only -- a rail item that always refuses teaches people the rail lies.
 */
const PAY_ITEMS: RailItem[] = [
  { to: '/people', label: 'People', icon: Users, end: true },
  { to: '/people/month', label: 'Month summary', icon: CalendarRange },
  { to: '/people/commission', label: 'Commission rules', icon: Percent },
  { to: '/people/carried', label: 'Carried over', icon: History },
]
const LEAVE_ITEM: RailItem = { to: '/people/leave', label: 'Leave', icon: CalendarDays }

export function PeopleLayout() {
  const { currentUser } = useAuth()
  const pay = canViewPay(currentUser)
  const items = pay ? [...PAY_ITEMS.slice(0, 2), LEAVE_ITEM, ...PAY_ITEMS.slice(2)] : [LEAVE_ITEM]
  return (
    <div className="flex min-h-full">
      <WorkspaceRail title="People" subtitle={pay ? 'Profiles, pay and leave' : 'Leave'} items={items} />
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  )
}
