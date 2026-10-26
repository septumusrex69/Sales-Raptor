import { useState } from 'react'
import { kindGroups, KIND_WORDS, type KindRow } from '../../lib/handoverBulkKind.ts'

/**
 * PERSON OR BUSINESS, FOR EVERY ROW THAT HAS THE SAME PROBLEM (Raptor R-5).
 *
 * Shown above a NEW handover's table, only while some row's kind is a guess. Pressing a choice does
 * not write: it shows how many rows it will change and who they are, and the second press writes
 * -- a bulk change on a sheet nobody has read row by row is the kind that needs a look first.
 * It edits the DRAFT's cells only; nothing becomes an account until the batch is approved, and an
 * account already imported is not reachable from here.
 */
export function BulkKindPanel({ rows, busy, onApply }: {
  rows: KindRow[]
  busy: boolean
  onApply: (rowIds: string[], word: string) => Promise<void>
}) {
  const [confirming, setConfirming] = useState<{ guess: string, word: string } | null>(null)
  const groups = kindGroups(rows)
  if (groups.length === 0) return null

  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5" data-testid="bulk-kind">
      <p className="text-sm font-medium text-slate-700 mb-0.5">Person or business — answer many at once</p>
      <p className="text-xs text-slate-500 mb-2">
        Raptor is guessing these. Choose for every row in a group, or leave them and answer row by row.
        Nothing is saved as an account until you approve the batch.
      </p>
      <div className="space-y-2">
        {groups.map((g) => {
          const active = confirming?.guess === g.guess ? confirming : null
          return (
            <div key={g.guess} className="text-xs text-slate-600">
              <p>
                <span className="font-medium tabular-nums">{g.rows.length}</span>{' '}
                {g.rows.length === 1 ? 'row' : 'rows'} — {g.label}
              </p>
              {active ? (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span>
                    Change {g.rows.length} {g.rows.length === 1 ? 'row' : 'rows'} to {active.word}:{' '}
                    {g.rows.slice(0, 6).map((r) => r.values.name || `row ${r.line}`).join(', ')}
                    {g.rows.length > 6 ? ` and ${g.rows.length - 6} more` : ''}.
                  </span>
                  <button type="button" disabled={busy}
                    onClick={() => { setConfirming(null); void onApply(g.rows.map((r) => r.id), active.word) }}
                    className="font-medium px-2.5 py-1 rounded bg-gold-400 text-navy-950 border border-gold-500 disabled:opacity-40">
                    Yes, change {g.rows.length}
                  </button>
                  <button type="button" onClick={() => setConfirming(null)}
                    className="font-medium text-slate-500 hover:text-slate-700">Cancel</button>
                </div>
              ) : (
                <div className="mt-1 flex gap-2">
                  {[KIND_WORDS.person, KIND_WORDS.business].map((word) => (
                    <button key={word} type="button" disabled={busy}
                      onClick={() => setConfirming({ guess: g.guess, word })}
                      className="font-medium px-2.5 py-1 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40">
                      All {g.rows.length} are {word === 'Person' ? 'people' : 'businesses'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
