import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

const TITLES: { test: RegExp; title: string }[] = [
  { test: /^\/$/, title: 'Dashboard' },
  { test: /^\/leads\/[^/]+$/, title: 'Lead Details' },
  { test: /^\/leads/, title: 'Leads' },
  { test: /^\/deals\/[^/]+$/, title: 'Deal Details' },
  { test: /^\/deals/, title: 'Deals' },
  { test: /^\/contacts\/[^/]+$/, title: 'Contact Details' },
  { test: /^\/contacts/, title: 'Contacts' },
  { test: /^\/companies\/[^/]+$/, title: 'Company Details' },
  { test: /^\/companies/, title: 'Companies' },
  { test: /^\/tasks/, title: 'Tasks' },
  { test: /^\/calendar/, title: 'Calendar' },
  { test: /^\/activities/, title: 'Activities' },
  { test: /^\/reports/, title: 'Reports' },
  { test: /^\/settings/, title: 'Settings' },
  { test: /^\/reps\/[^/]+$/, title: 'Rep Performance' },
]

export function AppLayout() {
  const location = useLocation()
  const title = TITLES.find((t) => t.test.test(location.pathname))?.title ?? 'Dashboard'

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar title={title} />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
