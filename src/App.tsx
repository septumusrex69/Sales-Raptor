import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { AppStoreProvider } from './store/AppStore'
import { AuthProvider } from './store/AuthContext'
import { ThemeProvider } from './store/ThemeContext'
import { BuzzBoxProvider } from './store/BuzzBoxContext'
import { RequireAuth } from './components/auth/RequireAuth'
import { NewVersionWatcher } from './components/NewVersionWatcher'
import { LoginPage } from './pages/auth/LoginPage'
/* LAZY, because it is the one page nobody signed in ever opens: a debtor's chunk has no business
   in the bundle a collector downloads every morning. */
const SignPage = lazy(() => import('./pages/sign/SignPage'))
import { AppLayout } from './components/layout/AppLayout'
import { DashboardRouter } from './pages/DashboardRouter'
import { RequireClientAccess } from './components/auth/RequireClientAccess'
import { RequireFinance } from './components/auth/RequireFinance'
import { RequireBusiness } from './components/auth/RequireBusiness'
import { RequireIncome } from './components/auth/RequireIncome'

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
/* The three other department dashboards. Split because they are no longer what anybody lands
   on -- "/" is the company dashboard now, and these are one click further in. */
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })))
const CommunicationsDashboard = lazy(() => import('./pages/CommunicationsDashboard').then((m) => ({ default: m.CommunicationsDashboard })))
const AdminOverview = lazy(() => import('./pages/AdminOverview').then((m) => ({ default: m.AdminOverview })))
/*
 * THE FINANCE SECTION, LAZILY. Nobody but an Administrator can open any of it, and most of them
 * will not open it most days -- so none of it belongs in the download everybody waits for.
 * check-app-boot holds that rule for every screen past the ones you land on.
 */
const FinanceWorkQueue = lazy(() => import('./pages/finance/FinanceWorkQueue').then((m) => ({ default: m.FinanceWorkQueue })))
const RunDetail = lazy(() => import('./pages/finance/RunDetail').then((m) => ({ default: m.RunDetail })))
const FinanceExceptions = lazy(() => import('./pages/finance/FinanceExceptions').then((m) => ({ default: m.FinanceExceptions })))
const BackOffice = lazy(() => import('./pages/finance/BackOffice').then((m) => ({ default: m.BackOffice })))
const FinanceSettings = lazy(() => import('./pages/finance/FinanceSettings').then((m) => ({ default: m.FinanceSettings })))
const FinancePayments = lazy(() => import('./pages/finance/FinancePayments').then((m) => ({ default: m.FinancePayments })))
const TrustLayout = lazy(() => import('./pages/trust/TrustLayout').then((m) => ({ default: m.TrustLayout })))
const TrustOverview = lazy(() => import('./pages/trust/TrustOverview').then((m) => ({ default: m.TrustOverview })))
const TrustLedger = lazy(() => import('./pages/trust/TrustLedger').then((m) => ({ default: m.TrustLedger })))
const TrustPaymentsOut = lazy(() => import('./pages/trust/TrustPaymentsOut').then((m) => ({ default: m.TrustPaymentsOut })))
const BusinessLayout = lazy(() => import('./pages/business/BusinessLayout').then((m) => ({ default: m.BusinessLayout })))
const BusinessOverview = lazy(() => import('./pages/business/BusinessOverview').then((m) => ({ default: m.BusinessOverview })))
const BusinessExpenses = lazy(() => import('./pages/business/BusinessExpenses').then((m) => ({ default: m.BusinessExpenses })))
const BusinessIncome = lazy(() => import('./pages/business/BusinessIncome').then((m) => ({ default: m.BusinessIncome })))
const BusinessDrawings = lazy(() => import('./pages/business/BusinessDrawings').then((m) => ({ default: m.BusinessDrawings })))
const CheckPayments = lazy(() => import('./pages/finance/CheckPayments').then((m) => ({ default: m.CheckPayments })))
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

/**
 * ONE PAYOVER RUN, AT ITS OLD ADDRESS.
 *
 * The only moved path that carries a parameter, so it cannot be a plain <Navigate to="...">: the
 * run's id has to be read off the old URL and put back into the new one. Worth the component --
 * a run's page is what the firm links to when they send somebody a payover to look at, and those
 * links are in sent mail where nobody can fix them.
 */
function RunRedirect() {
  const { id } = useParams()
  return <Navigate to={`/trust/runs/${id}`} replace />
}

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
            {/*
              THE ONE ROUTE OUTSIDE THE FIRM.
              
              A debtor signing an acknowledgement of debt has no Raptor login and never will -- the
              firm's instruction was "anyone with a link can open it" -- so this sits ABOVE
              RequireAuth and outside AppLayout. Inside either, an outsider would be bounced to a
              login page they cannot pass, or shown the firm's own navigation on the way through.
              
              The token in the path is the whole of the authority; signing_open is the only door it
              opens, and it reaches exactly one row. See src/lib/signing.ts.
            */}
            <Route path="/sign/:token" element={<SignPage />} />
            <Route
              element={
                <RequireAuth>
                  <AppLayout />
                </RequireAuth>
              }
            >
              <Route path="/" element={<DashboardRouter />} handle={{ title: 'Dashboard' }} />
              {/*
                ONE DASHBOARD PER DEPARTMENT, behind "Go to my dashboard" on the company screen.
                The paths are the ones DEPARTMENT_DASHBOARD names in src/lib/departments.ts, and
                check-departments holds the two against each other -- a button pointing at a route
                that does not exist would land somebody on a blank page rather than their floor.

                /performance stays as it was: it is the link every collector's name on every table
                already points at, and breaking those to tidy a URL would be a change nobody asked
                for.
              */}
              <Route path="/dashboard/collections" element={<CollectorDashboard />} handle={{ title: 'Collections' }} />
              <Route path="/dashboard/sales" element={<Dashboard />} handle={{ title: 'Sales' }} />
              <Route path="/dashboard/communications" element={<CommunicationsDashboard />} handle={{ title: 'Communications' }} />
              <Route path="/dashboard/admin" element={<AdminOverview />} handle={{ title: 'Administration' }} />
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
              {/*
                TWO WORKSPACES, BECAUSE THEY ARE TWO BOOKS.

                THE FIRM: "the trust and the business should be separated. It shouldn't be in the
                same tab in finance. It should be like outside, for example. So the trust, we have
                one place where we manage the trust and we have another place outside where we
                manage the business."

                They are separately governed and separately audited, and "Finance" over both of
                them said they were one pot with two drawers. The six screens that were tabs in a
                strip are now a rail inside /trust; Back office, which is the firm's OWN income and
                spent its life fifth in that strip, has moved to /business where it belongs.

                EVERY OLD ADDRESS STILL LANDS. The paths below are redirects, not leftovers: the
                payover queue is linked from emails the firm has already sent, and /finance is in
                somebody's bookmarks. A moved section that breaks them is a moved section people
                stop using.

                PAYMENTS KEEPS ITS PLACE IN THE ORDER, at the firm's instruction about the old
                strip: "first I want to see the payments. So first we work with payments. And then
                we work with a pay over queue." What is above it now is the Overview, which is the
                only screen that answers whether the trust account is right at all -- and that
                question comes before any day's work on it.
              */}
              <Route path="/trust" element={<RequireFinance><TrustLayout /></RequireFinance>}>
                <Route index element={<TrustOverview />} handle={{ title: 'Trust overview' }} />
                <Route path="payments" element={<FinancePayments />} handle={{ title: 'Payments in' }} />
                <Route path="check" element={<CheckPayments />} handle={{ title: 'Check what has gone through' }} />
                <Route path="payover" element={<FinanceWorkQueue />} handle={{ title: 'Payover runs' }} />
                <Route path="runs/:id" element={<RunDetail />} handle={{ title: 'Payover run' }} />
                <Route path="payments-out" element={<TrustPaymentsOut />} handle={{ title: 'Payments to make' }} />
                <Route path="ledger" element={<TrustLedger />} handle={{ title: 'Trust ledger' }} />
                <Route path="exceptions" element={<FinanceExceptions />} handle={{ title: 'Exceptions' }} />
                <Route path="settings" element={<FinanceSettings />} handle={{ title: 'Trust settings' }} />
              </Route>

              <Route path="/business" element={<RequireBusiness><BusinessLayout /></RequireBusiness>}>
                <Route index element={<BusinessOverview />} handle={{ title: 'Business overview' }} />
                <Route path="income" element={<RequireIncome><BusinessIncome /></RequireIncome>} handle={{ title: 'Income' }} />
                <Route path="expenses" element={<BusinessExpenses />} handle={{ title: 'Expenses' }} />
                <Route path="drawings" element={<BusinessDrawings />} handle={{ title: 'Drawings' }} />
                <Route path="back-office" element={<BackOffice />} handle={{ title: 'Back office' }} />
              </Route>

              {/* The old addresses. Every one of them, so nothing anybody saved goes dead. */}
              <Route path="/finance" element={<Navigate to="/trust" replace />} />
              <Route path="/finance/payments" element={<Navigate to="/trust/payments" replace />} />
              <Route path="/finance/check" element={<Navigate to="/trust/check" replace />} />
              <Route path="/finance/payover" element={<Navigate to="/trust/payover" replace />} />
              <Route path="/finance/runs/:id" element={<RunRedirect />} />
              <Route path="/finance/exceptions" element={<Navigate to="/trust/exceptions" replace />} />
              <Route path="/finance/settings" element={<Navigate to="/trust/settings" replace />} />
              {/* Back office changed WORKSPACE as well as address, which is the one redirect here
                  that is a decision rather than a move. */}
              <Route path="/finance/back-office" element={<Navigate to="/business/back-office" replace />} />
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
