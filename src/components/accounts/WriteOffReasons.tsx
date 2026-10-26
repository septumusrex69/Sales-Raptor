import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { writeOffReasonKey } from '../../lib/campaigns.ts'
import { WRITE_OFF_REASONS } from '../../lib/accountEnding'
import { fetchRecoveryReasons, type ReasonCount } from '../../lib/campaignApi'

/**
 * WHICH WRITE-OFF REASONS A CLOSED-BOOK CAMPAIGN GOES TO, for every box that asks it: the recovery
 * and trace calls (CallCampaignModal) and, since Raptor H12, an SMS or email to written-off accounts
 * (CampaignModal). One list, so the two boxes cannot offer the reasons in different shapes.
 *
 * THE REASONS AS THE BOX OFFERS THEM. Raptor's closed list BY NAME, each with its count (nought
 * included -- the list is the firm's and its shape should not change with the selection); then
 * anything else Raptor wrote; then the imported free text exactly as stored, most common first;
 * then "No reason recorded". Counted by the database over the selection, once the box needs them.
 */
export function useWriteOffReasons(ids: string[] | null, wanted: boolean, onError: (m: string) => void) {
  const [counts, setCounts] = useState<ReasonCount[] | null>(null)
  useEffect(() => {
    if (!wanted || !ids || counts) return
    let live = true
    fetchRecoveryReasons(ids)
      .then((r) => { if (live) setCounts(r) })
      .catch((e) => { if (live) onError(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [wanted, ids, counts, onError])

  const offered = useMemo(() => {
    const by = new Map((counts ?? []).map((r) => [r.key, r]))
    const closedList = WRITE_OFF_REASONS.map((label) => {
      const key = writeOffReasonKey({ endedAs: 'written_off', endedReason: label, writeOffReason: null })
      return { key, label, accounts: by.get(key)?.accounts ?? 0, group: 'Written off in Raptor' }
    })
    const listed = new Set(closedList.map((r) => r.key))
    const rest = (counts ?? []).filter((r) => !listed.has(r.key))
    return [
      ...closedList,
      ...rest.filter((r) => r.source === 'raptor').map((r) => ({ ...r, group: 'Written off in Raptor' })),
      ...rest.filter((r) => r.source === 'imported').map((r) => ({ ...r, group: 'Imported from Swordfish' })),
      ...rest.filter((r) => r.source === 'none').map((r) => ({ ...r, group: 'No reason' })),
    ]
  }, [counts])
  return { loaded: counts !== null, offered }
}

export function WriteOffReasonPicker({ loaded, offered, chosen, onToggle }: {
  loaded: boolean
  offered: ReturnType<typeof useWriteOffReasons>['offered']
  chosen: string[]
  onToggle: (key: string) => void
}) {
  if (!loaded) return <p className="text-xs text-slate-500 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Counting the reasons…</p>
  return (
    <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100" data-testid="recovery-reasons">
      {offered.map((r, i) => (
        <div key={r.key}>
          {(i === 0 || offered[i - 1].group !== r.group) && (
            <p className="px-3 pt-2 pb-1 text-[10.5px] uppercase tracking-wide text-slate-400">{r.group}</p>
          )}
          <label className={`flex items-center gap-2 px-3 py-1.5 text-sm ${r.accounts === 0 ? 'text-slate-400' : 'text-slate-700'}`}>
            <input type="checkbox" checked={chosen.includes(r.key)} disabled={r.accounts === 0}
              onChange={() => onToggle(r.key)} data-testid="recovery-reason" data-key={r.key} />
            <span className="flex-1 truncate">{r.label}</span>
            <span className="tabular-nums text-xs">{r.accounts.toLocaleString('en-ZA')}</span>
          </label>
        </div>
      ))}
    </div>
  )
}
