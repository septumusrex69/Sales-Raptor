import { useAppStore } from '../store/AppStore'
import { useAuth } from '../store/AuthContext'
import { Dashboard } from './Dashboard'
import { CollectorDashboard } from './CollectorDashboard'
import { CommunicationsDashboard } from './CommunicationsDashboard'
import { AdminOverview } from './AdminOverview'


/**
 * Which dashboard lands on "/" depends on who is looking.
 *
 * COLLECTIONS PEOPLE NOW LAND ON THE COLLECTIONS DASHBOARD, which is the firm's own correction:
 * they found that screen by clicking a collector's name and asked why it was not what people see
 * when they open Raptor. It was not, because "/" had no collections branch at all — an
 * Administrator got the admin overview, the Communications team got theirs, and EVERYBODY ELSE
 * got the SALES dashboard. A pre-legal agent therefore opened the app on leads and deals.
 *
 * BY TEAM AND BY ROLE, NOT FOR EVERYONE. The firm's first thought was that the whole company
 * should land there; a sales rep opening on the collections floor is the same mistake in the
 * other direction, and the sales dashboard is somebody's actual work. So the rule is: if you
 * collect, or your team collects, that is what you see. One line either way if the firm decides
 * otherwise — but nobody now lands on a department they do not work in.
 *
 * THE ROLE DECIDES, because a team is optional and a role is not. A pre-legal agent whose team
 * was never set would otherwise fall through to sales, which is precisely the person this was
 * written for. (There is no Collections team kind to ask -- TeamKind is Sales or Communications.)
 *
 * PRE-LEGAL ONLY, NOT EVERY COLLECTING ROLE. collectorGrade's COLLECTING_ROLES includes Liaison
 * and Liaison Manager, because they may be given accounts -- but a liaison's day is clients,
 * leads and deals, and they own those records. Sending them to the collections floor would take
 * away the screen their own work is on. The two pre-legal roles are the ones who open Raptor to
 * collect, so they are the two that move.
 */
/* All three collections roles: the manager and the leaders carry a book like the agents do,
   so the collections floor is the screen they open Raptor on. */
const PRE_LEGAL = ['Pre-legal Agent', 'Pre-legal Team Leader', 'Call Centre Manager']
export function DashboardRouter() {
  const { teams } = useAppStore()
  const { currentUser } = useAuth()

  if (currentUser?.role === 'Administrator') return <AdminOverview />

  /*
   * THE ROLE IS ASKED BEFORE THE TEAM, which is what the paragraph above always said and what the
   * code did not do. The team was asked first, so a PRE-LEGAL AGENT filed under a Communications
   * team opened Raptor on the Communications dashboard -- client servicing, courtesy calls and
   * meetings -- with not one collections figure on it.
   *
   * The firm met this with a profile whose team was three weeks stale: the role said pre-legal,
   * the team still said Communications, and the team won. A role is deliberate and a team is
   * optional, so when the two disagree the role is the better evidence of what somebody does all
   * day. Everyone else on a Communications team is unaffected.
   */
  if (currentUser?.role && PRE_LEGAL.includes(currentUser.role)) return <CollectorDashboard />

  const myTeam = teams.find((t) => t.id === currentUser?.teamId)
  if (myTeam?.kind === 'Communications') return <CommunicationsDashboard />

  return <Dashboard />
}
