import { useMemo, useState } from 'react'
import { Check, Loader2, Mail, UserCheck } from 'lucide-react'
import clsx from 'clsx'
import { Card, CardHeader } from '../ui/Card'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { supabase } from '../../lib/supabase'
import { clockNow } from '../../lib/clock'
import { welcomeSteps, isLiaisonRole, maySendWelcome, welcomeSentLine } from '../../lib/welcome'
import type { Company } from '../../types'

/**
 * A NEW CLIENT'S WELCOME, ON THE CLIENT (S8, 18 Oct; the welcome made the liaison's press, 23 Oct).
 *
 * Three states. Waiting for a liaison: the closer picks one and presses Assign, and the assign route
 * (api/_lib/email/assignLiaison.ts) makes the client hers, puts "Send welcome email" and "Welcome
 * call" on her list and tells her -- it SENDS NOTHING. Assigned, not yet welcomed: the liaison (or a
 * Liaison Manager, or an Administrator) presses Send welcome email, and the welcome route sends it as
 * it always has. Welcomed: "Welcome email sent on <date> by <name>", and Send it again only behind a
 * confirm -- because what went wrong on 23 Oct was a welcome that went without its liaison knowing,
 * and the next way it goes wrong is the same client welcomed twice. The four steps tick from facts;
 * the card steps aside once the call is made.
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
  const [confirmAgain, setConfirmAgain] = useState(false)

  const steps = welcomeSteps(company, activities)
  const mayAssign = !!currentUser && (currentUser.role === 'Administrator' || currentUser.role.includes('Sales') || currentUser.role === 'Liaison Manager')
  const maySend = maySendWelcome(currentUser, company)
  const liaisonName = userById(company.accountOwnerId)?.name ?? 'the liaison'
  const sentLine = welcomeSentLine(company, company.welcomeSentBy ? userById(company.welcomeSentBy)?.name : null)
  if (!company.liaisonNeeded && (!company.liaisonAssignedAt || steps.every((s) => s.done))) return null

  async function post(action: 'assign-liaison' | 'welcome', payload: Record<string, unknown>) {
    const { data } = await supabase.auth.getSession()
    const res = await fetch(`/api/email/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
      body: JSON.stringify(payload),
    })
    const body = await res.json().catch(() => ({})) as { error?: string; sent?: boolean; fromLiaison?: boolean; sentAt?: string; sentBy?: string }
    if (!res.ok) throw new Error(body.error ?? `That did not go through (${res.status}).`)
    return body
  }

  async function assign() {
    setBusy(true); setError(null); setResult(null)
    try {
      await post('assign-liaison', { companyId: company.id, liaisonId: pick })
      showCompanyChange(company.id, { accountOwnerId: pick, liaisonNeeded: false, liaisonAssignedAt: clockNow().toISOString() })
      void refreshSyncedData()
      const name = userById(pick)?.name ?? 'The liaison'
      setResult(`${name} now looks after ${company.name}. She has been told, and two tasks are on her list: send the welcome email, and the welcome call.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function send(again: boolean) {
    setBusy(true); setError(null); setResult(null); setConfirmAgain(false)
    try {
      const body = await post('welcome', { companyId: company.id, ...(again ? { again: true } : {}) })
      if (!body.sent) throw new Error(`The welcome email could not go${body.error ? `: ${body.error}` : '.'}`)
      showCompanyChange(company.id, { welcomeSentAt: body.sentAt ?? clockNow().toISOString(), welcomeSentBy: body.sentBy ?? currentUser?.id ?? null })
      void refreshSyncedData()
      setResult(`The welcome email went to ${company.name} from ${body.fromLiaison ? `${liaisonName}'s mailbox` : 'your mailbox, introducing the liaison'}.`)
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
            ? 'Signed online. Choose who looks after them: she is told, and sending the welcome email and the welcome call go on her list.'
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
                {busy ? <Loader2 size={14} className="animate-spin" /> : <UserCheck size={14} />} Assign
              </button>
            </div>
          ) : <p className="text-sm text-slate-500">Sales assigns the liaison.</p>
        )}
        {!company.liaisonNeeded && !company.welcomeSentAt && (
          maySend ? (
            <div className="mt-1">
              <button type="button" disabled={busy} onClick={() => void send(false)} data-testid="welcome-send"
                className="inline-flex items-center gap-2 rounded-lg bg-navy-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Send welcome email
              </button>
              <p className="mt-1 text-xs text-slate-500">It goes from {liaisonName}'s mailbox and introduces her.</p>
            </div>
          ) : <p className="text-sm text-slate-500" data-testid="welcome-waiting">Waiting for {liaisonName} to send the welcome email.</p>
        )}
        {sentLine && (
          <div className="mt-1 flex flex-wrap items-center gap-2" data-testid="welcome-sent">
            <p className="text-sm text-slate-700">{sentLine}.</p>
            {maySend && !confirmAgain && (
              <button type="button" disabled={busy} onClick={() => setConfirmAgain(true)} data-testid="welcome-again"
                className="text-xs font-medium text-slate-500 underline hover:text-slate-700">Send it again</button>
            )}
            {maySend && confirmAgain && (
              <span className="flex items-center gap-2 text-xs">
                <span className="text-slate-600">It has already gone once. Send it again?</span>
                <button type="button" disabled={busy} onClick={() => void send(true)} data-testid="welcome-again-confirm"
                  className="rounded-md bg-navy-900 px-2.5 py-1 font-semibold text-white disabled:opacity-40">Yes, send again</button>
                <button type="button" onClick={() => setConfirmAgain(false)} className="text-slate-500 underline">No</button>
              </span>
            )}
          </div>
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
              {s.hint && <span className="text-xs text-slate-400">({s.hint})</span>}
            </li>
          ))}
        </ol>
      </div>
    </Card>
  )
}
