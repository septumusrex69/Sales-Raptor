import { Suspense, lazy } from 'react'
import { Route, Routes } from 'react-router-dom'
import { AppStoreProvider } from './store/AppStore'
import { AuthProvider } from './store/AuthContext'
import { ThemeProvider } from './store/ThemeContext'
import { BuzzBoxProvider } from './store/BuzzBoxContext'
import { RequireAuth } from './components/auth/RequireAuth'
import { NewVersionWatcher } from './components/NewVersionWatcher'
import { LoginPage } from './pages/auth/LoginPage'
import { AppLayout } from './components/layout/AppLayout'
import { DashboardRouter } from './pages/DashboardRouter'
import { LeadsList } from './pages/leads/LeadsList'
import { LeadDetail } from './pages/leads/LeadDetail'
import { DealsBoard } from './pages/deals/DealsBoard'
import { DealDetail } from './pages/deals/DealDetail'
import { ContactsList } from './pages/contacts/ContactsList'
import { ContactDetail } from './pages/contacts/ContactDetail'
import { RequireClientAccess } from './components/auth/RequireClientAccess'
import { CompaniesList } from './pages/companies/CompaniesList'
import { CompanyDetail } from './pages/companies/CompanyDetail'
import { AccountsList } from './pages/accounts/AccountsList'
import { AccountDetail } from './pages/accounts/AccountDetail'
import { DisputesBoard } from './pages/accounts/DisputesBoard'
import { WorkflowsPage } from './pages/accounts/WorkflowsPage'
import { CollectorDashboard } from './pages/CollectorDashboard'
import { CollectorProfile } from './pages/CollectorProfile'
import { DiaryPage } from './pages/diary/DiaryPage'
import { MailPage } from './pages/mail/MailPage'
import { TasksPage } from './pages/tasks/TasksPage'
import { CalendarPage } from './pages/calendar/CalendarPage'
import { ActivitiesPage } from './pages/activities/ActivitiesPage'
/*
 * Loaded on demand.
 *
 * Reports and Settings are the two heaviest screens and the two least often opened — Reports
 * pulls in the whole charting library for the sake of one page, and a collector who lives on
 * Accounts was downloading it on every first load. Splitting them takes roughly a third off what
 * the app fetches before it can show anything.
 */
const ReportsPage = lazy(() => import('./pages/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })))
const LibraryPage = lazy(() => import('./pages/library/LibraryPage').then((m) => ({ default: m.LibraryPage })))
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))
import { RepDetailPage } from './pages/reps/RepDetailPage'

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
              {/* Before the :id route in the file, though React Router would rank the static
                  segment above the dynamic one either way. Kept in this order so that reading the
                  table does not suggest an account could ever be called "workflows". */}
              <Route path="/accounts/workflows" element={<WorkflowsPage />} handle={{ title: 'Workflows' }} />
              <Route path="/accounts/:id" element={<AccountDetail />} handle={{ title: 'Account' }} />
              <Route path="/diary" element={<DiaryPage />} handle={{ title: 'Diary' }} />
              <Route path="/performance" element={<CollectorDashboard />} handle={{ title: 'Collections' }} />
              {/* One collector's own page. Open to everybody, at the firm's instruction: "they
                  should also be able to see the entire company's performance, and where they
                  stand relative to everybody else." */}
              <Route path="/performance/:userId" element={<CollectorProfile />} handle={{ title: 'Collector' }} />
              <Route path="/queries" element={<DisputesBoard />} handle={{ title: 'Disputes' }} />
              <Route path="/tasks" element={<TasksPage />} handle={{ title: 'Tasks' }} />
              <Route path="/calendar" element={<CalendarPage />} handle={{ title: 'Calendar' }} />
              <Route path="/activities" element={<ActivitiesPage />} handle={{ title: 'Activities' }} />
              {/* The firm's own wording, kept apart from the machinery that sends it. Its own
                  route rather than a Settings tab: a library is working content somebody
                  maintains, not a setting somebody configures once. */}
              <Route path="/library" element={<LibraryPage />} handle={{ title: 'Library' }} />
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
