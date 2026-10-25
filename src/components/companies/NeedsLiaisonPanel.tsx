import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Moon, UserCheck } from 'lucide-react'
import { Card, CardHeader } from '../ui/Card'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { supabase } from '../../lib/supabase'
import { clockNow } from '../../lib/clock'
import { canBeClientLiaison } from '../../lib/permissions'
import { dormantPatch, isDormant } from '../../lib/clientDormant'
import { fromSwordfish } from '../../lib/mandateRule'

/**
 * THE CLIENTS WAITING FOR A LIAISON, HANDLED IN BULK (S11).
 *
 * THE FIRM: "With a swordfish import for them, you should be able to do something with them in bulk,
 * for example. Needs a liaison, like assign them in bulk, or leave us dormant." A Swordfish import
 * can leave dozens of clients with nobody on staff named as their liaison, and opening each one to
 * press Assign is how they stay unassigned. So: tick, then either give them all to one liaison (the
 * same route the client page's Assign uses -- an imported client gets no welcome, a new one gets her
 * two tasks) or mark them dormant (clientDormant.ts: nobody is asked to look after them).
 *
 * Drawn only where there is something waiting, and only for somebody who may assign: Sales, a
 * Liaison Manager or an Administrator -- the assign route's own rule.
 */
export function NeedsLiaisonPanel() {
  const { companies, users, showCompanyChange, refreshSyncedData } = useAppStore()
  const { currentUser } = useAuth()
  const waiting = useMemo(() => companies.filter((c) => c.liaisonNeeded && !isDormant(c))
    .sort((a, b) => a.name.localeCompare(b.name)), [companies])
  const liaisons = useMemo(() => users.filter((u) => u.status === 'Active' && canBeClientLiaison(u)), [users])
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [pick, setPick] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState<'assign' | 'dormant' | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const role = currentUser?.role ?? ''
  const mayAssign = role === 'Administrator' || role.includes('Sales') || role === 'Liaison Manager'
  /* The companies_update policy: a Sales REPRESENTATIVE may assign (through the route) but may not
     write the client row, so dormancy is offered to the three roles the policy names. */
  const mayDormant = ['Administrator', 'Sales Manager', 'Liaison Manager'].includes(role)
  if (!mayAssign || (waiting.length === 0 && !done)) return null

  const chosen = waiting.filter((c) => ticked.has(c.id))
  const all = waiting.length > 0 && chosen.length === waiting.length
  const toggle = (id: string) => setTicked((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  async function assign() {
    setBusy('assign'); setError(null); setDone(null)
    try {
      const { data } = await supabase.auth.getSession()
      const res = await fetch('/api/email/assign-liaison', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
        body: JSON.stringify({ companyIds: chosen.map((c) => c.id), liaisonId: pick }),
      })
      const body = await res.json().catch(() => ({})) as { assigned?: number; error?: string | null }
      if (!res.ok) throw new Error(body.error ?? `That did not go through (${res.status}).`)
      const now = clockNow().toISOString()
      for (const c of chosen) showCompanyChange(c.id, { accountOwnerId: pick, liaisonNeeded: false, liaisonAssignedAt: now })
      const name = users.find((u) => u.id === pick)?.name ?? 'The liaison'
      const imported = chosen.filter((c) => fromSwordfish(c)).length
      setDone(`${name} now looks after ${body.assigned ?? chosen.length} ${chosen.length === 1 ? 'client' : 'clients'} and has been told.`
        + (imported === chosen.length ? ' No welcome: existing clients from Swordfish.'
          : imported ? ` The ${chosen.length - imported} new ones have her welcome tasks.` : ' Her welcome tasks are on her list.')
        + (body.error ? ` Not all went: ${body.error}` : ''))
      setTicked(new Set())
      void refreshSyncedData()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function markDormant() {
    setBusy('dormant'); setError(null); setDone(null)
    try {
      const patch = dormantPatch(reason, currentUser?.id ?? null, clockNow().toISOString())
      const { error: e } = await supabase.from('companies').update(patch).in('id', chosen.map((c) => c.id))
      if (e) throw new Error(e.message)
      for (const c of chosen) {
        showCompanyChange(c.id, { dormantAt: patch.dormant_at, dormantReason: patch.dormant_reason, dormantBy: patch.dormant_by, liaisonNeeded: false })
      }
      setDone(`${chosen.length} ${chosen.length === 1 ? 'client is' : 'clients are'} marked dormant. They are under Dormant on the list, and a new account from any of them wakes it.`)
      setTicked(new Set()); setReason('')
      void refreshSyncedData()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="border-gold-300 bg-gold-50/60">
      <div data-testid="needs-liaison-panel">
        <CardHeader title={waiting.length ? `${waiting.length} ${waiting.length === 1 ? 'client needs' : 'clients need'} a liaison` : 'Clients needing a liaison'}
          subtitle="Tick them, then give them to one liaison or mark them dormant. A client from Swordfish gets no welcome; a new client gets her welcome tasks." />
        {done && <p className="mb-2 text-sm text-emerald-700" data-testid="needs-liaison-done">{done}</p>}
        {error && <p className="mb-2 text-sm text-[var(--c-rust-deep)]">{error}</p>}
        {waiting.length > 0 && (
          <>
            <label className="mb-1 flex items-center gap-2 text-xs text-slate-500">
              <input type="checkbox" checked={all} onChange={() => setTicked(all ? new Set() : new Set(waiting.map((c) => c.id)))}
                data-testid="needs-liaison-all" />
              All {waiting.length}
            </label>
            <ul className="mb-3 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white">
              {waiting.map((c) => (
                <li key={c.id} className="flex items-center gap-2 border-b border-slate-50 px-3 py-1.5 text-sm last:border-0">
                  <input type="checkbox" checked={ticked.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Choose ${c.name}`} />
                  <Link to={`/companies/${c.id}`} className="truncate text-slate-700 hover:text-brand-600">{c.name}</Link>
                  {fromSwordfish(c) && <span className="ml-auto shrink-0 text-[11px] text-slate-400">from Swordfish</span>}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Liaison"
                className="min-w-[12rem] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <option value="">Choose a liaison…</option>
                {liaisons.map((u) => <option key={u.id} value={u.id}>{u.name}{u.role === 'Liaison Manager' ? ' (manager)' : ''}</option>)}
              </select>
              <button type="button" disabled={!pick || chosen.length === 0 || !!busy} onClick={() => void assign()}
                data-testid="needs-liaison-assign"
                className="inline-flex items-center gap-2 rounded-lg bg-navy-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                {busy === 'assign' ? <Loader2 size={14} className="animate-spin" /> : <UserCheck size={14} />}
                Assign {chosen.length || ''}
              </button>
            </div>
            {mayDormant && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why dormant? (optional)"
                  className="min-w-[12rem] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                <button type="button" disabled={chosen.length === 0 || !!busy} onClick={() => void markDormant()}
                  data-testid="needs-liaison-dormant"
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-40">
                  {busy === 'dormant' ? <Loader2 size={14} className="animate-spin" /> : <Moon size={14} />}
                  Mark {chosen.length || ''} dormant
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  )
}
