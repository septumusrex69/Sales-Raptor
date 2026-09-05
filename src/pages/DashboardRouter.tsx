import { useAppStore } from '../store/AppStore'
import { useAuth } from '../store/AuthContext'
import { Dashboard } from './Dashboard'
import { CommunicationsDashboard } from './CommunicationsDashboard'
import { AdminOverview } from './AdminOverview'

/**
 * Which dashboard lands on "/" depends on who's looking: Administrators see
 * both departments via AdminOverview, a Communications-team member sees
 * CommunicationsDashboard, and everyone else (Sales, or no team at all)
 * sees the original Sales Dashboard — today's behavior stays the default.
 */
export function DashboardRouter() {
  const { teams } = useAppStore()
  const { currentUser } = useAuth()

  if (currentUser?.role === 'Administrator') return <AdminOverview />

  const myTeam = teams.find((t) => t.id === currentUser?.teamId)
  if (myTeam?.kind === 'Communications') return <CommunicationsDashboard />

  return <Dashboard />
}
