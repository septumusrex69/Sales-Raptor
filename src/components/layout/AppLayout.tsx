import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { TitleSlotProvider } from './TitleSlot'

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
  { test: /^\/accounts\/[^/]+$/, title: 'Account' },
  { test: /^\/accounts/, title: 'Accounts' },
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
      </div>
    </TitleSlotProvider>
  )
}
