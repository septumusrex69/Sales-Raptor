import { useState } from 'react'
import { Loader2, Moon, Sun } from 'lucide-react'
import { Card } from '../ui/Card'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { supabase } from '../../lib/supabase'
import { clockNow } from '../../lib/clock'
import { activePatch, dormantLine, dormantPatch, isDormant, mayChangeDormancy } from '../../lib/clientDormant'
import { canBeClientLiaison } from '../../lib/permissions'
import type { Company } from '../../types'

/**
 * ONE CLIENT'S DORMANCY, on its own page (S11, clientDormant.ts).
 *
 * A dormant client says so at the top of its page, with why and since when, and Make active. An
 * active one offers Mark dormant quietly -- a link, not a button, because it is the rare thing to do
 * on a client page and should not sit there looking like the next step. Only for the people the
 * companies_update policy lets write the row; anybody else sees the line and no controls.
 */
export function ClientDormancy({ company }: { company: Company }) {
  const { users, showCompanyChange } = useAppStore()
  const { currentUser } = useAuth()
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const may = mayChangeDormancy(currentUser, company)
  const dormant = isDormant(company)
  if (!dormant && !may) return null

  async function write(patch: Record<string, unknown>, local: Partial<Company>) {
    setBusy(true); setError(null)
    const { error: e } = await supabase.from('companies').update(patch).eq('id', company.id)
    setBusy(false)
    if (e) { setError(e.message); return }
    showCompanyChange(company.id, local)
    setAsking(false); setReason('')
  }

  if (dormant) {
    const owner = users.find((u) => u.id === company.accountOwnerId)
    /* Waking a client whose owner is not a liaison asks for one -- the same rule the database applies
       when a new account wakes it (client_wakes_on_account). */
    const needs = !owner || owner.status !== 'Active' || !canBeClientLiaison(owner)
    return (
      <Card className="border-slate-300 bg-slate-50">
        <div data-testid="client-dormant" className="flex flex-wrap items-center gap-3">
          <Moon size={16} className="text-slate-500" />
          <p className="flex-1 text-sm text-slate-700">
            {dormantLine(company, company.dormantBy ? users.find((u) => u.id === company.dormantBy)?.name ?? null : null)}
          </p>
          {may && (
            <button type="button" disabled={busy} data-testid="client-make-active"
              onClick={() => void write(activePatch(needs), { dormantAt: null, dormantReason: null, dormantBy: null, liaisonNeeded: needs })}
              className="inline-flex items-center gap-2 rounded-lg bg-navy-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Sun size={14} />} Make active
            </button>
          )}
        </div>
        {error && <p className="mt-2 text-xs text-negative-700">{error}</p>}
      </Card>
    )
  }

  return (
    <div className="text-right">
      {!asking ? (
        <button type="button" onClick={() => setAsking(true)} data-testid="client-mark-dormant"
          className="text-xs text-slate-400 hover:text-slate-700">Mark this client dormant…</button>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why dormant? (optional)" autoFocus
            className="min-w-[12rem] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm" />
          <button type="button" disabled={busy}
            onClick={() => {
              const patch = dormantPatch(reason, currentUser?.id ?? null, clockNow().toISOString())
              void write(patch, { dormantAt: patch.dormant_at, dormantReason: patch.dormant_reason, dormantBy: patch.dormant_by, liaisonNeeded: false })
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 disabled:opacity-40">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Moon size={14} />} Mark dormant
          </button>
          <button type="button" onClick={() => setAsking(false)} className="text-xs text-slate-500">Cancel</button>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-negative-700">{error}</p>}
    </div>
  )
}
