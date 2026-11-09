import { useCallback, useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Check, Pencil, Plus, X } from 'lucide-react'
import { Card, CardHeader } from '../ui/Card'
import { controlClass, inputClass } from '../ui/Modal'
import { useAuth } from '../../store/AuthContext'
import {
  CLOSED_STAGES, addListValue, fetchListUsage, mayEditSalesLists, removeListValue, renameListValue, reorderList,
  setStageProbability, stageProbability, useSalesLists, type SalesList,
} from '../../lib/salesLists'

/**
 * ONE OF THE FIRM'S SALES LISTS, SAVED (Raptor H19): Pipelines, Lead Sources, Rejection Reasons.
 *
 * Stephan, 9 Nov: an Administrator or the Sales Manager changes them (everybody else sees them); a value still on
 * leads or deals is never orphaned -- a rename renames it on every row, and removing one in use asks where its rows
 * go and moves them. Built-in values (the ones Raptor's own code uses by name) are marked and keep their name.
 * The database holds every one of these rules (sales_list_* functions); this screen only says them first.
 */
export function SalesListTab({ list, title, subtitle, rowNoun }: { list: SalesList; title: string; subtitle: string; rowNoun: string }) {
  const { currentUser } = useAuth()
  const mayEdit = mayEditSalesLists(currentUser?.role)
  const lists = useSalesLists()
  const isStages = list === 'deal_stage'
  const values = isStages ? lists.stages : list === 'lead_source' ? lists.sources : lists.reasons
  const builtIn = (v: string) => lists.items ? !!lists.items.find((i) => i.list === list && i.value === v)?.builtIn : true
  const [usage, setUsage] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState('')
  const [addChance, setAddChance] = useState('40')
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null)
  const [removing, setRemoving] = useState<{ value: string; moveTo: string } | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const refreshUsage = useCallback(() => { void fetchListUsage(list).then(setUsage) }, [list])
  useEffect(() => { refreshUsage() }, [refreshUsage])

  const run = async (what: () => Promise<number>, said: (n: number) => string) => {
    setBusy(true); setError(null); setDone(null)
    try {
      const n = await what()
      setDone(said(n))
      setRenaming(null); setRemoving(null)
      refreshUsage()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const moved = (n: number) => (n === 1 ? `1 ${rowNoun}` : `${n} ${rowNoun}s`)

  // Where a removed value's rows may go: anything else still on the list (for deal stages, only an open stage).
  const destinations = (v: string) => values.filter((x) => x !== v && !(isStages && CLOSED_STAGES.includes(x)))
  const open = isStages ? lists.openStages : values
  const move = (v: string, by: -1 | 1) => {
    const order = [...open]
    const i = order.indexOf(v)
    const j = i + by
    if (i < 0 || j < 0 || j >= order.length) return
    ;[order[i], order[j]] = [order[j], order[i]]
    void run(() => reorderList(list, order), () => 'Order saved.')
  }

  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      {!mayEdit && (
        <p className="mb-3 text-[12.5px] text-slate-500" data-testid="sales-list-read-only">
          Only an Administrator or the Sales Manager changes this list.
        </p>
      )}
      <div className="border-y border-slate-100 text-[12.5px]" data-testid={`sales-list-${list}`}>
        {values.map((v, i) => {
          const uses = usage[v] ?? 0
          const fixed = builtIn(v)
          const closed = isStages && CLOSED_STAGES.includes(v)
          return (
            <div key={v} className="border-b border-slate-50 last:border-b-0" data-testid="sales-list-row" data-value={v}>
              <div className="flex items-center gap-3 px-3 py-1.5 hover:bg-slate-50">
                <span className="text-slate-400 w-5 tabular-nums">{i + 1}</span>
                {renaming?.from === v ? (
                  <form className="flex flex-1 items-center gap-2" onSubmit={(e) => {
                    e.preventDefault()
                    void run(() => renameListValue(list, v, renaming.to), (n) => `Renamed${n ? `, with ${moved(n)}` : ''}.`)
                  }}>
                    <input autoFocus className={`${inputClass} py-1`} value={renaming.to} aria-label={`New name for ${v}`}
                      onChange={(e) => setRenaming({ from: v, to: e.target.value })} />
                    <button type="submit" disabled={busy} className="p-1 rounded-md text-brand-600 hover:bg-brand-50" title="Save the new name"><Check size={14} /></button>
                    <button type="button" onClick={() => setRenaming(null)} className="p-1 rounded-md text-slate-400 hover:bg-slate-100" title="Cancel"><X size={14} /></button>
                  </form>
                ) : (
                  <span className="font-medium text-slate-700 flex-1 truncate">{v}</span>
                )}
                {fixed && <span className="shrink-0 rounded px-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-100"
                  title="Raptor itself uses this one by name, so it keeps its name and cannot be removed">built in</span>}
                {isStages && !closed && (
                  fixed || !mayEdit ? (
                    <span className="shrink-0 w-16 text-right tabular-nums text-slate-400" title="Chance of closing">{stageProbability(v, lists.items)}%</span>
                  ) : (
                    <ChanceInput value={stageProbability(v, lists.items)} disabled={busy}
                      onSave={(n) => void run(() => setStageProbability(v, n).then(() => 0), () => `Chance of closing for ${v} saved.`)} />
                  )
                )}
                <span className="shrink-0 w-24 text-right text-slate-400 tabular-nums" data-testid="sales-list-uses">
                  {uses ? `${uses} in use` : 'not in use'}
                </span>
                {mayEdit && (
                  <span className="shrink-0 flex items-center gap-0.5 w-24 justify-end">
                    {!closed && open.length > 1 && (
                      <>
                        <button onClick={() => move(v, -1)} disabled={busy || open.indexOf(v) === 0} title="Move up"
                          className="p-0.5 rounded-md text-slate-300 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-30"><ArrowUp size={13} /></button>
                        <button onClick={() => move(v, 1)} disabled={busy || open.indexOf(v) === open.length - 1} title="Move down"
                          className="p-0.5 rounded-md text-slate-300 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-30"><ArrowDown size={13} /></button>
                      </>
                    )}
                    {!fixed && (
                      <>
                        <button onClick={() => { setRemoving(null); setRenaming({ from: v, to: v }) }} disabled={busy} title={`Rename ${v}`}
                          className="p-0.5 rounded-md text-slate-300 hover:text-brand-600 hover:bg-brand-50"><Pencil size={13} /></button>
                        <button onClick={() => {
                          setRenaming(null)
                          if (uses) setRemoving({ value: v, moveTo: destinations(v)[0] ?? '' })
                          else void run(() => removeListValue(list, v), () => `${v} removed.`)
                        }} disabled={busy} title={`Remove ${v}`} data-testid="sales-list-remove"
                          className="p-0.5 rounded-md text-slate-300 hover:text-red-500 hover:bg-red-50"><X size={13} /></button>
                      </>
                    )}
                  </span>
                )}
              </div>
              {removing?.value === v && (
                <form className="mx-3 mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900"
                  data-testid="sales-list-move" onSubmit={(e) => {
                    e.preventDefault()
                    void run(() => removeListValue(list, v, removing.moveTo), (n) => `${v} removed; ${moved(n)} moved to ${removing.moveTo}.`)
                  }}>
                  <span>{moved(uses)} {uses === 1 ? 'uses' : 'use'} <b>{v}</b>. Move them to</span>
                  <select className={`${controlClass} w-auto py-1`} value={removing.moveTo} aria-label="Move them to"
                    onChange={(e) => setRemoving({ value: v, moveTo: e.target.value })}>
                    {destinations(v).map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <button type="submit" disabled={busy || !removing.moveTo}
                    className="text-sm font-medium px-3 py-1 rounded-lg bg-brand-600 text-white hover:bg-brand-700">Move them and remove {v}</button>
                  <button type="button" onClick={() => setRemoving(null)} className="text-sm text-amber-800 hover:underline">Cancel</button>
                </form>
              )}
            </div>
          )
        })}
      </div>
      {error && <p className="mt-3 text-sm text-red-600" role="alert" data-testid="sales-list-error">{error}</p>}
      {done && !error && <p className="mt-3 text-sm text-emerald-700" data-testid="sales-list-done">{done}</p>}
      {mayEdit && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const v = adding.trim()
            if (!v) return
            const chance = isStages ? Math.max(0, Math.min(100, Number(addChance) || 0)) : undefined
            void run(() => addListValue(list, v, chance).then(() => { setAdding(''); return 0 }),
              () => `${v} added${isStages ? ', before Won and Rejected' : ''}.`)
          }}
          className="flex gap-2 mt-4 pt-4 border-t border-slate-100"
        >
          <input className={inputClass} placeholder={isStages ? 'New stage name' : `Add a ${rowNounFor(list)}`} value={adding}
            onChange={(e) => setAdding(e.target.value)} data-testid="sales-list-add-input" maxLength={60} />
          {isStages && (
            <label className="flex items-center gap-1 text-xs text-slate-500 shrink-0" title="The chance a deal at this stage closes, for the forecast">
              <input type="number" min={0} max={100} className={`${controlClass} w-16`} value={addChance} onChange={(e) => setAddChance(e.target.value)} aria-label="Chance of closing" />%
            </label>
          )}
          <button type="submit" disabled={busy} data-testid="sales-list-add"
            className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 shrink-0">
            <Plus size={15} /> Add
          </button>
        </form>
      )}
    </Card>
  )
}

function rowNounFor(list: SalesList): string {
  return list === 'lead_source' ? 'lead source' : list === 'rejection_reason' ? 'rejection reason' : 'stage'
}

function ChanceInput({ value, disabled, onSave }: { value: number; disabled: boolean; onSave: (n: number) => void }) {
  const [text, setText] = useState(String(value))
  useEffect(() => { setText(String(value)) }, [value])
  const commit = () => {
    const n = Math.max(0, Math.min(100, Math.round(Number(text))))
    if (Number.isFinite(n) && n !== value) onSave(n)
    else setText(String(value))
  }
  return (
    <span className="shrink-0 w-16 flex items-center justify-end gap-0.5 text-slate-400">
      <input type="number" min={0} max={100} value={text} disabled={disabled} aria-label="Chance of closing"
        onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
        className="w-11 rounded border border-slate-200 px-1 py-0.5 text-right tabular-nums text-slate-600" />%
    </span>
  )
}
