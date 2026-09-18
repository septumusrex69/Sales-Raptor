import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { TitleSlotProvider } from './TitleSlot'
import { ReminderWatcher } from '../reminders/ReminderWatcher'

const TITLES: { test: RegExp; title: string }[] = [
  { test: /^\/$/, title: 'Dashboard' },
  { test: /^\/leads\/[^/]+$/, title: 'Lead Details' },
  { test: /^\/leads/, title: 'Leads' },
  { test: /^\/deals\/[^/]+$/, title: 'Deal Details' },
  { test: /^\/deals/, title: 'Deals' },
  { test: /^\/contacts\/[^/]+$/, title: 'Contact Details' },
  { test: /^\/contacts/, title: 'Contacts' },
  { test: /^\/companies\/[^/]+$/, title: 'Client Details' },
  { test: /^\/companies/, title: 'Clients' },
  { test: /^\/tasks/, title: 'Tasks' },
  { test: /^\/calendar/, title: 'Calendar' },
  { test: /^\/activities/, title: 'Activities' },
  { test: /^\/reports/, title: 'Reports' },
  { test: /^\/settings/, title: 'Settings' },
  { test: /^\/reps\/[^/]+$/, title: 'Rep Performance' },
  /*
   * The two Collections routes, which were missing from this table entirely — so the bar above
   * them carried no heading at all. That mattered less while the panel underneath opened with
   * the word "Collections" in gold; the firm's own design for it does not, and a screen that
   * names itself nowhere is a screen somebody lands on from a link with no idea what they are
   * looking at. The specific route first: /performance/<id> would otherwise match the general
   * one and a collector's own figures would be titled with the whole floor's screen.
   */
  { test: /^\/performance\/[^/]+$/, title: 'Collector' },
  { test: /^\/performance/, title: 'Collections' },
  { test: /^\/accounts\/[^/]+$/, title: 'Account' },
  { test: /^\/accounts/, title: 'Accounts' },
  { test: /^\/queries/, title: 'Disputes' },
]

export function AppLayout() {
  const location = useLocation()
  // No fallback to 'Dashboard': a route missing from this table would then sit under a heading
  // naming a different page, which is how /accounts spent its first day calling itself Dashboard.
  // An empty heading is visibly unfinished; a wrong one is not.
  const title = TITLES.find((t) => t.test.test(location.pathname))?.title ?? ''

  return (
    <TitleSlotProvider>
      <div className="flex h-dvh w-full overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar title={title} />
          <main className="flex-1 overflow-y-auto p-6">
            <Outlet />
          </main>
        </div>
        {/*
          Mounted around every page, not on the account it belongs to. A reminder that only
          appeared on that account would be useless by definition — the whole point is that an
          hour has passed and you are somewhere else.
        */}
        <ReminderWatcher />
      </div>
    </TitleSlotProvider>
  )
}
