import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock, Loader2, UserCheck } from 'lucide-react'
import { Modal, FormField, inputClass } from '../../components/ui/Modal'
import { DictateButton } from '../../components/ui/Dictate'
import { planHandOut, planSummary, type HandOutPlan } from '../../lib/handOut.ts'
import { loadHandOutContext, type HandOutContext } from '../../lib/handOutData.ts'
import { commitHandOut, handOutSummary } from '../../lib/handOutWrite.ts'
import { BULK_CEILING, type Selection } from '../../lib/accountAllocation.ts'
import { ACCOUNT_BANDS, bookCeilingOf } from '../../lib/collectorGrade.ts'
import { addWorkingDays } from '../../lib/workingDays.ts'
import type { User } from '../../types'

const DEFAULT_WINDOW = 5

/**
 * Handing a stack of accounts out.
 *
 * TWO DIFFERENT THINGS IN ONE BOX, because they are nearly always done together and were never
 * the same. ALLOCATING changes whose book an account is in. BOOKING IN puts it in a diary on a
 * day. Allocating without booking is exactly how 355 accounts arrived belonging to somebody and
 * diarised by nobody, so booking is on by default — but either can be turned off.
 *
 * THE PLAN IS SHOWN BEFORE ANYTHING IS WRITTEN, and it is the same object the writer commits.
 * Not a summary of what will probably happen: the actual placements. A distributor that decides
 * where a billion rand of work goes and reports afterwards is one nobody can refuse.
 */
export function HandOutModal({ selection, selectedCount, users, actor, onClose, onDone }: {
  selection: Selection
  /** What the bulk bar said, so the modal can show a figure before its own load finishes. */
  selectedCount: number
  users: User[]
  actor: { id: string | null; name: string | null }
  onClose: () => void
  onDone: (message: string) => void | Promise<void>
}) {
  const [context, setContext] = useState<HandOutContext | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [startOn, setStartOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [windowDays, setWindowDays] = useState(DEFAULT_WINDOW)
  const [alsoBook, setAlsoBook] = useState(true)
  const [alsoAllocate, setAlsoAllocate] = useState(true)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The window decides how much of everyone's diary is worth fetching. Generous on the far end,
  // because the planner is allowed to run past the window rather than drop accounts.
  const to = useMemo(() => addWorkingDays(startOn, windowDays * 4), [startOn, windowDays])

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    void loadHandOutContext({ selection, users, from: startOn, to, limit: BULK_CEILING + 1 })
      .then((c) => {
        if (cancelled) return
        setContext(c)
        // Everybody graded, to begin with: the commonest hand-out is "share this out", and a
        // preselected list means the plan appears immediately instead of after six clicks.
        setChosen((prev) => (prev.size > 0 ? prev : new Set(c.collectors.map((x) => x.userId))))
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selection, users, startOn, to])

  const plan: HandOutPlan | null = useMemo(() => {
    if (!context) return null
    const collectors = context.collectors.filter((c) => chosen.has(c.userId))
    if (collectors.length === 0) return null
    return planHandOut({
      accounts: context.accounts,
      collectors,
      startOn,
      windowDays,
      skipAlreadyBooked: true,
    })
  }, [context, chosen, startOn, windowDays])

  const toggle = useCallback((id: string) => setChosen((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  }), [])

  const tooMany = (context?.accounts.length ?? 0) > BULK_CEILING

  async function commit() {
    if (!plan) return
    setBusy({ done: 0, total: plan.placements.length }); setError(null)
    try {
      const res = await commitHandOut({
        plan, alsoAllocate, alsoBook, actor, reason,
        onProgress: (done, total) => setBusy({ done, total }),
      })
      await onDone(handOutSummary(res, (id) =>
        context?.accounts.find((a) => a.id === id)?.label))
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  // See planSummary: overBy already counts only what this plan added, so no `taking` guard.
  const overCount = plan?.collectors.filter((c) => c.overBy > 0).length ?? 0

  return (
    <Modal title="Hand out accounts" onClose={onClose} width={760}>
      <div className="space-y-3">
        {loading ? (
          <p className="text-sm text-slate-400 inline-flex items-center gap-1.5 py-6">
            <Loader2 size={14} className="animate-spin" />
            Reading {selectedCount.toLocaleString('en-ZA')} accounts, everyone’s book and everyone’s diary…
          </p>
        ) : !context ? null : (
          <>
            <p className="text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2.5">
              <span className="font-medium tabular-nums">{context.accounts.length.toLocaleString('en-ZA')}</span>
              {' '}{context.accounts.length === 1 ? 'account' : 'accounts'} to hand out.
              {context.alreadyBookedCount > 0 && (
                <>
                  {' '}<span className="text-amber-700">
                    {context.alreadyBookedCount} already sit in somebody’s diary and are left alone.
                  </span>
                </>
              )}
            </p>

            {tooMany && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                That is more than {BULK_CEILING} accounts. Narrow the filters, or work through it a client at a time.
              </p>
            )}

            {context.collectors.length === 0 ? (
              /*
               * A grade is what makes somebody a collector, so an ungraded team has nobody to
               * hand work to — and saying where the grades are set beats an empty list.
               */
              <p className="text-sm text-slate-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Nobody has a collector grade yet, so there is no one to hand these to.
                Set grades on each person in <span className="font-medium">Settings → People</span>.
              </p>
            ) : (
              <>
                <div>
                  <span className="block text-xs font-medium text-slate-500 mb-1.5">Who</span>
                  <div className="grid sm:grid-cols-2 gap-1.5">
                    {context.collectors.map((c) => {
                      const ceiling = bookCeilingOf(c.bookCeiling)
                      const taking = plan?.collectors.find((x) => x.userId === c.userId)
                      return (
                        <label key={c.userId}
                          className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 cursor-pointer ${
                            chosen.has(c.userId) ? 'border-brand-200 bg-brand-50/60' : 'border-slate-200'}`}>
                          <input type="checkbox" className="mt-1 accent-brand-600"
                            checked={chosen.has(c.userId)} onChange={() => toggle(c.userId)} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm text-slate-800 leading-tight">{c.name}</span>
                            <span className="block text-[11px] text-slate-500 tabular-nums">
                              {c.grade} · {c.inPlayNow}/{ceiling} on the book · {c.capacity} a day
                            </span>
                            {/*
                              Said plainly, because it is the reason this person is getting
                              little or nothing and the plan would otherwise look arbitrary.
                            */}
                            {c.inPlayNow > ceiling && (
                              <span className="block text-[11px] text-amber-700">
                                already {(c.inPlayNow - ceiling).toLocaleString('en-ZA')} over their ceiling
                              </span>
                            )}
                            {taking && taking.taking > 0 && (
                              <span className={`block text-[11px] font-medium tabular-nums ${
                                taking.overBy > 0 ? 'text-rose-700' : 'text-brand-700'}`}>
                                taking {taking.taking} → {taking.after}
                                {taking.overBy > 0 && ` (${taking.overBy} over)`}
                              </span>
                            )}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  <FormField label="Starting">
                    <input type="date" className={inputClass} value={startOn}
                      onChange={(e) => setStartOn(e.target.value)} />
                  </FormField>
                  <FormField label="Over how many working days">
                    <input type="number" min={1} max={40} className={inputClass} value={windowDays}
                      onChange={(e) => setWindowDays(Math.max(1, Number(e.target.value) || 1))} />
                  </FormField>
                </div>

                <div className="flex flex-wrap gap-4">
                  <Toggle checked={alsoBook} onChange={setAlsoBook}
                    label="Book them into the diary"
                    note="Off makes this a plain allocation with no dates." />
                  <Toggle checked={alsoAllocate} onChange={setAlsoAllocate}
                    label="Put them on that person’s desk"
                    note="Off books the work without changing whose book it is." />
                </div>

                {plan && <PlanPreview plan={plan} alsoBook={alsoBook} />}

                <FormField label="Why (optional)">
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                    placeholder="Sharing out the September handover."
                    className={`${inputClass} resize-none`} />
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    <DictateButton size="small" value={reason} onChange={setReason} />
                    <span className="text-[11px] text-slate-400">
                      Goes on every account&rsquo;s timeline and onto each diary entry.
                    </span>
                  </div>
                </FormField>
              </>
            )}
          </>
        )}

        {error && <p className="text-sm text-negative-700">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <span className="text-xs text-slate-400">
            {busy
              ? `Booking ${busy.done} of ${busy.total}…`
              : overCount > 0
                ? `${overCount} ${overCount === 1 ? 'person goes' : 'people go'} over their book ceiling. Nothing is blocked.`
                : plan?.ranPastWindow
                  ? `Runs past the ${windowDays} days you asked for, to ${plan.lastDate}.`
                  : ''}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 px-2">
              Cancel
            </button>
            <button type="button" onClick={() => void commit()}
              disabled={!!busy || !plan || plan.placements.length === 0 || tooMany || (!alsoBook && !alsoAllocate)}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-navy-950 text-white hover:bg-navy-900 disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" />
                : alsoBook ? <CalendarClock size={14} /> : <UserCheck size={14} />}
              {alsoBook ? 'Hand out and book' : 'Allocate'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

/**
 * The plan, as two views of the same thing: who is getting what, and when they will do it.
 *
 * The day grid is the half that answers "is this actually going to happen". A person taking 80
 * accounts sounds fine until you see it is 80 on Monday.
 */
function PlanPreview({ plan, alsoBook }: { plan: HandOutPlan; alsoBook: boolean }) {
  const dates = [...new Set(plan.days.map((d) => d.date))].sort()
  const taking = plan.collectors.filter((c) => c.taking > 0)

  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <p className="px-3 py-2 text-xs text-slate-600 bg-slate-50 border-b border-slate-100">
        {planSummary(plan)}
      </p>

      {alsoBook && dates.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th className="px-3 py-1.5 font-medium">Collector</th>
                {dates.map((d) => (
                  <th key={d} className="px-2 py-1.5 font-medium text-center whitespace-nowrap">
                    {new Date(`${d}T00:00:00Z`).toLocaleDateString('en-ZA', {
                      weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
                    })}
                  </th>
                ))}
                <th className="px-3 py-1.5 font-medium text-right">New</th>
              </tr>
            </thead>
            <tbody>
              {taking.map((c) => (
                <tr key={c.userId} className="border-b border-slate-50 last:border-0">
                  <td className="px-3 py-1.5 text-slate-700 whitespace-nowrap">
                    {c.name}
                    <span className="text-slate-400"> · {c.grade}</span>
                  </td>
                  {dates.map((d) => {
                    const cell = plan.days.find((x) => x.userId === c.userId && x.date === d)
                    if (!cell || cell.added === 0) return <td key={d} className="px-2 py-1.5 text-center text-slate-300">·</td>
                    const full = cell.existing + cell.added >= cell.capacity
                    return (
                      <td key={d} className="px-2 py-1.5 text-center tabular-nums"
                        title={`${cell.existing} already booked, ${cell.added} added, ${cell.capacity} a day`}>
                        <span className={full ? 'text-amber-700 font-medium' : 'text-slate-700'}>
                          +{cell.added}
                        </span>
                        <span className="text-slate-400"> /{cell.capacity}</span>
                      </td>
                    )
                  })}
                  <td className="px-3 py-1.5 text-right tabular-nums font-medium text-slate-800">{c.taking}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {plan.unplaced.length > 0 && (
        /*
         * Named, never silently dropped. An account that could not be handed out is one nobody is
         * working, which is the state this whole feature exists to end -- so it says which, and why.
         */
        <div className="px-3 py-2 border-t border-slate-100 bg-amber-50/50">
          <p className="text-xs text-amber-800 flex items-start gap-1.5">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <span>
              <span className="font-medium">{plan.unplaced.length} not handed out.</span>{' '}
              {reasonLine(plan)}
            </span>
          </p>
        </div>
      )}
    </div>
  )
}

function reasonLine(plan: HandOutPlan): string {
  const counts = new Map<string, number>()
  for (const u of plan.unplaced) counts.set(u.reason, (counts.get(u.reason) ?? 0) + 1)
  const say: Record<string, string> = {
    already_booked: 'already in a diary',
    no_one_graded: `nobody chosen is graded for them (${ACCOUNT_BANDS.map((b) => b.label).join(' / ')})`,
    no_room: 'no room in the days planned',
  }
  return [...counts].map(([reason, n]) => `${n} ${say[reason] ?? reason}`).join('; ') + '.'
}

function Toggle({ checked, onChange, label, note }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; note: string
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer max-w-[20rem]">
      <input type="checkbox" className="mt-0.5 shrink-0 accent-brand-600"
        checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">
        <span className="block text-sm text-slate-700 leading-tight">{label}</span>
        <span className="block text-[11px] text-slate-400 leading-snug">{note}</span>
      </span>
    </label>
  )
}
