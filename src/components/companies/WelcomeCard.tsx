import { useMemo, useState } from 'react'
import { Check, Loader2, UserCheck } from 'lucide-react'
import clsx from 'clsx'
import { Card, CardHeader } from '../ui/Card'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { supabase } from '../../lib/supabase'
import { clockNow } from '../../lib/clock'
import { welcomeSteps, isLiaisonRole } from '../../lib/welcome'
import type { Company } from '../../types'

/**
 * A NEW CLIENT'S WELCOME, ON THE CLIENT (S8, 18 Oct).
 *
 * Two states. Waiting for a liaison: the closer picks one and presses Assign, and the welcome route
 * does the rest (api/_lib/email/welcome.ts). Assigned: the four steps the firm asked to see ticked --
 * mandate signed, liaison assigned, welcome email sent, welcome call made -- the last ticking itself
 * when the liaison logs a call on the client. Shown until the call is made, then it steps aside: a
 * client a year in does not need its welcome on the page.
 */
export function WelcomeCard({ company }: { company: Company }) {
  const { users, activities, userById, showCompanyChange, refreshSyncedData } = useAppStore()
  const { currentUser } = useAuth()
  const liaisons = useMemo(() => users.filter((u) => isLiaisonRole(u.role))
    .sort((a, b) => a.name.localeCompare(b.name)), [users])
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const steps = welcomeSteps(company, activities)
  const mayAssign = !!currentUser && (currentUser.role === 'Administrator' || currentUser.role.includes('Sales') || currentUser.role === 'Liaison Manager')
  if (!company.liaisonNeeded && (!company.liaisonAssignedAt || steps.every((s) => s.done))) return null

  async function assign() {
    setBusy(true); setError(null); setResult(null)
    try {
      const { data } = await supabase.auth.getSession()
      const res = await fetch('/api/email/welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
        body: JSON.stringify({ companyId: company.id, liaisonId: pick }),
      })
      const body = await res.json().catch(() => ({})) as { error?: string; sent?: boolean; fromLiaison?: boolean }
      if (!res.ok) throw new Error(body.error ?? `The assignment did not go through (${res.status}).`)
      const now = clockNow().toISOString()
      showCompanyChange(company.id, { accountOwnerId: pick, liaisonNeeded: false, liaisonAssignedAt: now, ...(body.sent ? { welcomeSentAt: now } : {}) })
      void refreshSyncedData()
      const name = userById(pick)?.name ?? 'The liaison'
      setResult(body.sent
        ? `${name} now looks after ${company.name}. The welcome email went from ${body.fromLiaison ? 'her mailbox' : 'your mailbox, introducing her'}, and a welcome call is on her list.`
        : `${name} now looks after ${company.name} and has a welcome call on her list, but the welcome email could not go${body.error ? `: ${body.error}` : '.'}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className={company.liaisonNeeded ? 'border-gold-300 bg-gold-50/60' : undefined}>
      <div data-testid="welcome-card">
        <CardHeader title={company.liaisonNeeded ? 'Assign a liaison' : 'Welcome'}
          subtitle={company.liaisonNeeded
            ? 'Signed online. Choose who looks after them: the welcome email goes from that liaison, and a welcome call goes on her list.'
            : 'A new client, from the signed mandate to the first call.'} />
        {company.liaisonNeeded && (
          mayAssign ? (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Liaison"
                className="min-w-[12rem] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <option value="">Choose a liaison…</option>
                {liaisons.map((u) => <option key={u.id} value={u.id}>{u.name}{u.role === 'Liaison Manager' ? ' (manager)' : ''}</option>)}
              </select>
              <button type="button" disabled={!pick || busy} onClick={() => void assign()} data-testid="welcome-assign"
                className="inline-flex items-center gap-2 rounded-lg bg-navy-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <UserCheck size={14} />} Assign and welcome
              </button>
            </div>
          ) : <p className="text-sm text-slate-500">Sales assigns the liaison.</p>
        )}
        {result && <p className="mt-2 text-sm text-emerald-700" role="status">{result}</p>}
        {error && <p className="mt-2 text-sm text-rose-600" role="alert">{error}</p>}
        <ol className="mt-3 grid gap-1.5 sm:grid-cols-2" data-testid="welcome-steps">
          {steps.map((s) => (
            <li key={s.key} className="flex items-center gap-2 text-sm">
              <span className={clsx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                s.done ? 'bg-emerald-600 text-white' : 'border border-slate-300 text-transparent')}><Check size={12} /></span>
              <span className={s.done ? 'text-slate-800' : 'text-slate-500'}>{s.label}</span>
              {s.when && <span className="text-xs text-slate-400">{s.when}</span>}
            </li>
          ))}
        </ol>
      </div>
    </Card>
  )
}
