import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { useAppStore } from '../../store/AppStore'
import { departmentOf } from '../../lib/departments.ts'
import { defaultPayBasis, PAY_BASIS_LABEL } from '../../lib/clerkCommission.ts'
import { fetchEmployeeProfiles, type EmployeeProfile } from '../../lib/peopleApi'
import { rand } from '../../lib/money'

/**
 * EVERYBODY WITH A LOGIN, AND WHAT THE FIRM PAYS THEM.
 *
 * Read off the user list the rest of the app already has (AppStore), joined to employee_profiles --
 * so somebody invited this morning is here before anybody has written their profile, with a blank
 * where the salary will go rather than missing from the list.
 */
export function PeopleList() {
  const { users } = useAppStore()
  const [profiles, setProfiles] = useState<EmployeeProfile[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetchEmployeeProfiles()
      .then((p) => { if (live) setProfiles(p) })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not read the profiles.') })
    return () => { live = false }
  }, [])

  const rows = useMemo(() => {
    const byId = new Map((profiles ?? []).map((p) => [p.userId, p]))
    return [...users]
      .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'Active' ? -1 : 1))
      .map((u) => ({ user: u, profile: byId.get(u.id) ?? null }))
  }, [users, profiles])

  return (
    <div className="space-y-5">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-xl font-semibold tracking-tight text-slate-800">People</h1>
        <span className="text-xs text-slate-400">Everybody with a login, and what they are paid</span>
      </div>
      {error && <Card className="p-4 text-sm text-negative-700 bg-negative-50 border-negative-100">{error}</Card>}
      {profiles === null && !error ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-8">
          <Loader2 size={16} className="animate-spin" /> Reading the profiles…
        </div>
      ) : (
        <Card className="overflow-hidden" padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full list-table whitespace-nowrap" data-testid="people-list">
              <thead>
                <tr className="bg-slate-50 text-slate-400">
                  <th className="text-left font-medium px-4 py-2.5">Name</th>
                  <th className="text-left font-medium px-4 py-2.5">Job title</th>
                  <th className="text-left font-medium px-4 py-2.5">Department</th>
                  <th className="text-left font-medium px-4 py-2.5">Pay basis</th>
                  <th className="text-right font-medium px-4 py-2.5">Basic salary</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ user, profile }) => {
                  const basis = profile?.payBasis ?? defaultPayBasis(user.role)
                  return (
                    <tr key={user.id} className="border-t border-slate-100">
                      <td className="px-4 py-1.5">
                        <Link to={`/people/${user.id}`} className="text-brand-700 hover:underline font-medium">{user.name}</Link>
                        {user.status !== 'Active' && <span className="ml-2 text-[11px] text-slate-400">Inactive</span>}
                      </td>
                      <td className="px-4 py-1.5 text-slate-700">{profile?.jobTitle ?? <span className="text-slate-400">{user.role}</span>}</td>
                      <td className="px-4 py-1.5 text-slate-600">{departmentOf(user.role)}</td>
                      <td className="px-4 py-1.5 text-slate-600">{PAY_BASIS_LABEL[basis].split(' (')[0]}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums">
                        {profile?.basicSalary === null || profile?.basicSalary === undefined
                          ? <span className="text-slate-400">Not set</span> : rand(profile.basicSalary)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
