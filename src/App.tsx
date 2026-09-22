import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppStoreProvider } from './store/AppStore'
import { AuthProvider } from './store/AuthContext'
import { ThemeProvider } from './store/ThemeContext'
import { BuzzBoxProvider } from './store/BuzzBoxContext'
import { RequireAuth } from './components/auth/RequireAuth'
import { NewVersionWatcher } from './components/NewVersionWatcher'
import { LoginPage } from './pages/auth/LoginPage'
import { AppLayout } from './components/layout/AppLayout'
import { DashboardRouter } from './pages/DashboardRouter'
import { RequireClientAccess } from './components/auth/RequireClientAccess'
import { CollectorDashboard } from './pages/CollectorDashboard'
/*
 * LOADED ON DEMAND -- EVERY SCREEN EXCEPT THE TWO YOU LAND ON.
 *
 * THE FIRM: "it's slow to load ... I think the speed can pick up."
 *
 * Three screens were split before this, and the other twenty-one were compiled into the first
 * file the browser downloads, so opening the login page fetched the mail client, the diary, the
 * letter editor and the charting library. Nobody uses twenty-one screens before the first paint,
 * and on an iPad over mobile data that download is the wait.
 *
 * LoginPage, AppLayout and DashboardRouter stay eager on purpose: they are what is on the screen
 * a second after the app opens, and fetching them in a second round trip would move the wait
 * rather than remove it. CollectorProfile is split because it, not Reports, is what was dragging
 * the charting library into the first download.
 */
const ReportsPage = lazy(() => import('./pages/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })))
const LibraryPage = lazy(() => import('./pages/library/LibraryPage').then((m) => ({ default: m.LibraryPage })))
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const LeadsList = lazy(() => import('./pages/leads/LeadsList').then((m) => ({ default: m.LeadsList })))
const LeadDetail = lazy(() => import('./pages/leads/LeadDetail').then((m) => ({ default: m.LeadDetail })))
const DealsBoard = lazy(() => import('./pages/deals/DealsBoard').then((m) => ({ default: m.DealsBoard })))
const DealDetail = lazy(() => import('./pages/deals/DealDetail').then((m) => ({ default: m.DealDetail })))
const ContactsList = lazy(() => import('./pages/contacts/ContactsList').then((m) => ({ default: m.ContactsList })))
const ContactDetail = lazy(() => import('./pages/contacts/ContactDetail').then((m) => ({ default: m.ContactDetail })))
const CompaniesList = lazy(() => import('./pages/companies/CompaniesList').then((m) => ({ default: m.CompaniesList })))
const CompanyDetail = lazy(() => import('./pages/companies/CompanyDetail').then((m) => ({ default: m.CompanyDetail })))
const AccountsList = lazy(() => import('./pages/accounts/AccountsList').then((m) => ({ default: m.AccountsList })))
const AccountDetail = lazy(() => import('./pages/accounts/AccountDetail').then((m) => ({ default: m.AccountDetail })))
const DisputesBoard = lazy(() => import('./pages/accounts/DisputesBoard').then((m) => ({ default: m.DisputesBoard })))
const QueryDetail = lazy(() => import('./pages/queries/QueryDetail').then((m) => ({ default: m.QueryDetail })))
const LibraryWorkflows = lazy(() => import('./pages/library/LibraryWorkflows').then((m) => ({ default: m.LibraryWorkflows })))
const LibraryLetterhead = lazy(() => import('./pages/library/LibraryLetterhead').then((m) => ({ default: m.LibraryLetterhead })))
const LibraryFirm = lazy(() => import('./pages/library/LibraryFirm').then((m) => ({ default: m.LibraryFirm })))
const CollectorProfile = lazy(() => import('./pages/CollectorProfile').then((m) => ({ default: m.CollectorProfile })))
const DiaryPage = lazy(() => import('./pages/diary/DiaryPage').then((m) => ({ default: m.DiaryPage })))
const MailPage = lazy(() => import('./pages/mail/MailPage').then((m) => ({ default: m.MailPage })))
const TasksPage = lazy(() => import('./pages/tasks/TasksPage').then((m) => ({ default: m.TasksPage })))
const CalendarPage = lazy(() => import('./pages/calendar/CalendarPage').then((m) => ({ default: m.CalendarPage })))
const ActivitiesPage = lazy(() => import('./pages/activities/ActivitiesPage').then((m) => ({ default: m.ActivitiesPage })))
const RepDetailPage = lazy(() => import('./pages/reps/RepDetailPage').then((m) => ({ default: m.RepDetailPage })))

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppStoreProvider>
         <BuzzBoxProvider>
          <NewVersionWatcher />
          {/* A lazily-loaded route needs a boundary; the fallback is deliberately nothing, so a
              fast chunk does not flash a spinner on its way in. */}
          <Suspense fallback={null}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              element={
                <RequireAuth>
                  <AppLayout />
                </RequireAuth>
              }
            >
              <Route path="/" element={<DashboardRouter />} handle={{ title: 'Dashboard' }} />
              <Route path="/leads" element={<LeadsList />} handle={{ title: 'Leads' }} />
              <Route path="/leads/:id" element={<LeadDetail />} handle={{ title: 'Lead Details' }} />
              <Route path="/deals" element={<DealsBoard />} handle={{ title: 'Deals' }} />
              <Route path="/deals/:id" element={<DealDetail />} handle={{ title: 'Deal Details' }} />
              <Route path="/contacts" element={<ContactsList />} handle={{ title: 'Contacts' }} />
              <Route path="/contacts/:id" element={<ContactDetail />} handle={{ title: 'Contact Details' }} />
              {/* A hidden link is not a permission: a pre-legal agent who types the URL lands back
                  on the book they are meant to be working. */}
              <Route path="/companies" element={<RequireClientAccess><CompaniesList /></RequireClientAccess>} handle={{ title: 'Clients' }} />
              <Route path="/companies/:id" element={<RequireClientAccess><CompanyDetail /></RequireClientAccess>} handle={{ title: 'Client Details' }} />
              <Route path="/mail" element={<MailPage />} handle={{ title: 'Mail' }} />
              <Route path="/accounts" element={<AccountsList />} handle={{ title: 'Accounts' }} />
              {/*
                THE OLD WAY IN, KEPT AS A REDIRECT. The read-only page that lived here showed the
                firm's 160-day chart transcribed from paper; the workflow is now stored, editable
                and in the library, so the page is retired rather than kept as a second copy of a
                process that would drift from the first.

                The two things that page was FOR did not go with it — dating every step against a
                handover you pick, and the warning that the fourth clerk is never reached — both
                moved onto the builder, which is the only reason retiring it was safe.

                Before the :id route in the file, though React Router would rank the static
                segment above the dynamic one either way. Kept in this order so that reading the
                table does not suggest an account could ever be called "workflows".
              */}
              <Route path="/accounts/workflows"
                element={<Navigate to="/library/workflows/standard-collections" replace />} />
              <Route path="/accounts/:id" element={<AccountDetail />} handle={{ title: 'Account' }} />
              <Route path="/diary" element={<DiaryPage />} handle={{ title: 'Diary' }} />
              <Route path="/performance" element={<CollectorDashboard />} handle={{ title: 'Collections' }} />
              {/* One collector's own page. Open to everybody, at the firm's instruction: "they
                  should also be able to see the entire company's performance, and where they
                  stand relative to everybody else." */}
              <Route path="/performance/:userId" element={<CollectorProfile />} handle={{ title: 'Collector' }} />
              <Route path="/queries" element={<DisputesBoard />} handle={{ title: 'Disputes' }} />
              {/* THE FIRM: "a query should have a card, like the same as a deal, with the details
                  of the query on the inside." Before this a query had no page and both lists
                  opened the ACCOUNT -- which a query about a whole handover sheet does not have. */}
              <Route path="/queries/:id" element={<QueryDetail />} handle={{ title: 'Query' }} />
              <Route path="/tasks" element={<TasksPage />} handle={{ title: 'Tasks' }} />
              <Route path="/calendar" element={<CalendarPage />} handle={{ title: 'Calendar' }} />
              <Route path="/activities" element={<ActivitiesPage />} handle={{ title: 'Activities' }} />
              {/* The firm's own wording, kept apart from the machinery that sends it. Its own
                  route rather than a Settings tab: a library is working content somebody
                  maintains, not a setting somebody configures once. */}
              <Route path="/library" element={<LibraryPage />} handle={{ title: 'Library' }} />
              {/* The workflows, moved out of Settings at the firm's instruction: "if we are
                  building a workflow, currently it lives in the accounts section. I think it
                  should live in the library section." A workflow is content somebody writes, not
                  a setting -- and it belongs beside the wording it sends, because
                  workflow_nodes.template_id points straight at message_templates.

                  The open workflow is a route parameter rather than component state, so a draft
                  being argued about can be linked to. In Settings it had no address at all. */}
              <Route path="/library/workflows" element={<LibraryWorkflows />} handle={{ title: 'Workflows' }} />
              <Route path="/library/workflows/:key" element={<LibraryWorkflows />} handle={{ title: 'Workflows' }} />
              {/* The paper the letters print on. Beside them rather than in Settings, because the
                  margins are what keep the words off the logo -- that is typography, not config. */}
              <Route path="/library/letterhead" element={<LibraryLetterhead />} handle={{ title: 'Letterhead' }} />
              <Route path="/library/firm" element={<LibraryFirm />} handle={{ title: 'The firm' }} />
              <Route path="/reports" element={<ReportsPage />} handle={{ title: 'Reports' }} />
              <Route path="/settings" element={<SettingsPage />} handle={{ title: 'Settings' }} />
              <Route path="/reps/:id" element={<RepDetailPage />} handle={{ title: 'Rep Performance' }} />
            </Route>
          </Routes>
          </Suspense>
         </BuzzBoxProvider>
        </AppStoreProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App
