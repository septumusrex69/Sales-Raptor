import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { TitleSlotProvider } from './TitleSlot'
import { ReminderWatcher } from '../reminders/ReminderWatcher'
import { NewWorkPopup } from '../collections/NewWorkPopup'

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
  /* /accounts/workflows now redirects into the library, so it needs no title of its own -- but
     the static-before-dynamic ordering below still matters for anything added later. */
  { test: /^\/accounts\/[^/]+$/, title: 'Account' },
  { test: /^\/accounts/, title: 'Accounts' },
  /* The one query before the board, or /queries/:id would be headed "Disputes" -- and a query
     about a client's handover sheet is precisely not one. Static-before-dynamic, as above. */
  { test: /^\/queries\/[^/]+$/, title: 'Query' },
  { test: /^\/queries/, title: 'Disputes' },
  /* The workflows first: /library/workflows would otherwise be titled "Library", which is the
     same mistake /accounts/workflows was written to avoid one section up. */
  { test: /^\/library\/workflows/, title: 'Workflows' },
  { test: /^\/library\/letterhead/, title: 'Letterhead' },
  { test: /^\/library/, title: 'Library' },
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
        {/*
          Also around every page, and for the same reason: a clerk is told that seven accounts
          landed wherever they happen to be, not only if they think to open the book. It decides
          for itself whether there is anything to say — see newWorkPopup, which is null nearly
          always.
        */}
        <NewWorkPopup />
      </div>
    </TitleSlotProvider>
  )
}
