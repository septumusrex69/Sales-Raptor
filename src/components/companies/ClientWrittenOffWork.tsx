import { useState } from 'react'
import { Ban, Loader2 } from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { supabase } from '../../lib/supabase'
import { clockNow } from '../../lib/clock'
import { formatDate } from '../../data/mockData'
import { mayChangeDormancy } from '../../lib/clientDormant'
import type { Company } from '../../types'

/**
 * "DON'T WORK OUR WRITTEN-OFF ACCOUNTS" (Raptor H12).
 *
 * THE FIRM: "accounts that we write off, or has been written off by a client on their instruction,
 * that's two different things. Unless the client asks us not to work on their accounts" -- and,
 * asked whether that should be a switch on the client, "yes". On: every campaign on the written-off
 * book (an SMS or email, a recovery call, a trace) leaves this client's accounts out, and says why.
 * Withdrawn accounts are never worked whatever this says, and live accounts are not touched by it.
 *
 * NOT DORMANCY. A dormant client has stopped sending work; it may still want old debts recovered.
 * The same people may change it as may change dormancy (the companies_update policy).
 */
export function ClientWrittenOffWork({ company }: { company: Company }) {
  const { users, showCompanyChange } = useAppStore()
  const { currentUser } = useAuth()
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const may = mayChangeDormancy(currentUser, company)
  const on = !!company.noWriteoffWorkAt
  if (!on && !may) return null

  async function write(next: boolean) {
    const at = clockNow().toISOString()
    const patch = next
      ? { no_writeoff_work_at: at, no_writeoff_work_reason: reason.trim() || null, no_writeoff_work_by: currentUser?.id ?? null }
      : { no_writeoff_work_at: null, no_writeoff_work_reason: null, no_writeoff_work_by: null }
    setBusy(true); setError(null)
    const { error: e } = await supabase.from('companies').update(patch).eq('id', company.id)
    setBusy(false)
    if (e) { setError(e.message); return }
    showCompanyChange(company.id, next
      ? { noWriteoffWorkAt: at, noWriteoffWorkReason: reason.trim() || null, noWriteoffWorkBy: currentUser?.id ?? null }
      : { noWriteoffWorkAt: null, noWriteoffWorkReason: null, noWriteoffWorkBy: null })
    setAsking(false); setReason('')
  }

  if (on) {
    const by = users.find((u) => u.id === company.noWriteoffWorkBy)?.name
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5" data-testid="client-no-writeoff">
        <Ban size={16} className="text-red-700" />
        <p className="flex-1 text-sm text-red-900">
          Not working its written-off accounts since {formatDate(company.noWriteoffWorkAt!)}{by ? `, recorded by ${by}` : ''}
          {company.noWriteoffWorkReason ? ` — ${company.noWriteoffWorkReason}` : ''}. No campaign reaches them.
        </p>
        {may && (
          <button type="button" disabled={busy} onClick={() => void write(false)} data-testid="client-no-writeoff-undo"
            className="text-xs font-medium text-red-800 underline disabled:opacity-40">{busy ? <Loader2 size={12} className="inline animate-spin" /> : 'Work them again'}</button>
        )}
        {error && <p className="w-full text-xs text-negative-700">{error}</p>}
      </div>
    )
  }
  return (
    <div className="text-right">
      {!asking ? (
        <button type="button" onClick={() => setAsking(true)} data-testid="client-no-writeoff-ask"
          className="text-xs text-slate-400 hover:text-slate-700">Don’t work this client’s written-off accounts…</button>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Their instruction, e.g. email of 26 Oct (optional)" autoFocus
            className="min-w-[14rem] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm" data-testid="client-no-writeoff-reason" />
          <button type="button" disabled={busy} onClick={() => void write(true)} data-testid="client-no-writeoff-save"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 disabled:opacity-40">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />} Stop working them
          </button>
          <button type="button" onClick={() => setAsking(false)} className="text-xs text-slate-500">Cancel</button>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-negative-700">{error}</p>}
    </div>
  )
}
