import { Route, Routes } from 'react-router-dom'
import { AppStoreProvider } from './store/AppStore'
import { AppLayout } from './components/layout/AppLayout'
import { Dashboard } from './pages/Dashboard'
import { LeadsList } from './pages/leads/LeadsList'
import { LeadDetail } from './pages/leads/LeadDetail'
import { DealsBoard } from './pages/deals/DealsBoard'
import { DealDetail } from './pages/deals/DealDetail'
import { ContactsList } from './pages/contacts/ContactsList'
import { ContactDetail } from './pages/contacts/ContactDetail'
import { CompaniesList } from './pages/companies/CompaniesList'
import { CompanyDetail } from './pages/companies/CompanyDetail'
import { TasksPage } from './pages/tasks/TasksPage'
import { CalendarPage } from './pages/calendar/CalendarPage'
import { ActivitiesPage } from './pages/activities/ActivitiesPage'
import { ReportsPage } from './pages/reports/ReportsPage'
import { SettingsPage } from './pages/settings/SettingsPage'

function App() {
  return (
    <AppStoreProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} handle={{ title: 'Dashboard' }} />
          <Route path="/leads" element={<LeadsList />} handle={{ title: 'Leads' }} />
          <Route path="/leads/:id" element={<LeadDetail />} handle={{ title: 'Lead Details' }} />
          <Route path="/deals" element={<DealsBoard />} handle={{ title: 'Deals' }} />
          <Route path="/deals/:id" element={<DealDetail />} handle={{ title: 'Deal Details' }} />
          <Route path="/contacts" element={<ContactsList />} handle={{ title: 'Contacts' }} />
          <Route path="/contacts/:id" element={<ContactDetail />} handle={{ title: 'Contact Details' }} />
          <Route path="/companies" element={<CompaniesList />} handle={{ title: 'Companies' }} />
          <Route path="/companies/:id" element={<CompanyDetail />} handle={{ title: 'Company Details' }} />
          <Route path="/tasks" element={<TasksPage />} handle={{ title: 'Tasks' }} />
          <Route path="/calendar" element={<CalendarPage />} handle={{ title: 'Calendar' }} />
          <Route path="/activities" element={<ActivitiesPage />} handle={{ title: 'Activities' }} />
          <Route path="/reports" element={<ReportsPage />} handle={{ title: 'Reports' }} />
          <Route path="/settings" element={<SettingsPage />} handle={{ title: 'Settings' }} />
        </Route>
      </Routes>
    </AppStoreProvider>
  )
}

export default App
