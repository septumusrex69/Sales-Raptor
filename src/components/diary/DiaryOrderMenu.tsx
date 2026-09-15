import { useEffect, useRef, useState } from 'react'
import { ArrowUpDown, Check, ChevronDown } from 'lucide-react'
import {
  DIARY_KINDS, DIARY_KIND_ORDER, DIARY_ORDER_GROUPS, FIRM_DIARY_ORDER, orderLabel,
  type DiaryOrder,
} from '../../lib/diaryPriority.ts'

/**
 * What to look at first.
 *
 * NOT A FILTER, at the firm's instruction — nothing is hidden and the same accounts are in the
 * same list whichever of these is on. Only the order changes, which is why the box says so.
 *
 * Replaces a native <select> of thirteen options. Two things were wrong with it and only one of
 * them was that it looked like an iOS picker sheet on an iPad.
 *
 * The real fault was that the thirteen were not thirteen alternatives. They were ONE house
 * order, TWO ways to re-sort the whole day, and NINE ways to float a single kind to the top
 * while leaving the house order intact underneath — three different kinds of thing, listed as
 * peers, so "Most urgent first" and "Broken PTP first" read as competing answers to the same
 * question. They are not: the second is the first with one band lifted out of it. Grouping them
 * is what makes that readable, and a <select> cannot group with a sentence under the heading.
 *
 * The ladder itself is shown, numbered, under the firm's order. A house standard nobody can
 * read is folklore, and this is the only place in the app that states it.
 */
export function DiaryOrderMenu({ value, onChange }: {
  value: DiaryOrder
  onChange: (order: DiaryOrder) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 text-sm rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-700 hover:bg-slate-50"
        title="Reorders the list. Nothing is hidden.">
        <ArrowUpDown size={14} className="text-slate-400 shrink-0" />
        <span className="truncate max-w-[11rem]">{orderLabel(value)}</span>
        <ChevronDown size={14} className={`text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        /*
          Right-aligned and capped in height. It sits at the right-hand end of a toolbar, so a
          left-aligned panel runs off the screen on an iPad; and twelve options plus the ladder
          is taller than a phone, so it scrolls rather than pushing its own bottom off-screen.
        */
        <div className="absolute right-0 top-full mt-1.5 w-[19rem] max-h-[70vh] overflow-y-auto bg-white rounded-xl shadow-lg border border-slate-100 py-1.5 z-40">
          {DIARY_ORDER_GROUPS.map((group, i) => (
            <div key={group.heading} className={i > 0 ? 'mt-1 pt-1.5 border-t border-slate-100' : ''}>
              <p className="px-3.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {group.heading}
              </p>
              {group.note && <p className="px-3.5 pb-1 text-[11px] text-slate-400">{group.note}</p>}
              {group.options.map((o) => {
                const chosen = o.id === value
                return (
                  <button key={o.id} type="button"
                    onClick={() => { onChange(o.id); setOpen(false) }}
                    className={`w-full flex items-center gap-2 px-3.5 py-1.5 text-sm text-left ${
                      chosen ? 'text-navy-950 font-medium bg-slate-50' : 'text-slate-600 hover:bg-slate-50'}`}>
                    {/*
                      The tick holds its column whether or not it is showing. Letting it collapse
                      shifts every other label two millimetres left, and a list that moves as you
                      read down it is harder to scan than one with a gap in it.
                    */}
                    <Check size={14} className={chosen ? 'text-[var(--c-gold-dark)] shrink-0' : 'invisible shrink-0'} />
                    <span className="min-w-0">{o.label}</span>
                    {o.id === FIRM_DIARY_ORDER && (
                      <span className="ml-auto text-[10px] font-medium text-[var(--c-gold-dark)] bg-[var(--tint-gold)] rounded px-1.5 py-0.5 shrink-0">
                        Recommended
                      </span>
                    )}
                  </button>
                )
              })}
              {/*
                The ladder, stated once, where the order that uses it is chosen. Numbered because
                it IS a sequence — the number is the rung, not decoration — and titled with each
                kind's own reason so "why is a trace below a callback" has an answer on hover.
              */}
              {group.options.some((o) => o.id === FIRM_DIARY_ORDER) && (
                <ol className="px-3.5 pb-1.5 pt-0.5 space-y-0.5">
                  {DIARY_KIND_ORDER.map((k, n) => (
                    <li key={k} className="flex items-baseline gap-2 text-[11px] text-slate-500" title={DIARY_KINDS[k].why}>
                      <span className="w-3 shrink-0 text-right tabular-nums text-slate-300">{n + 1}</span>
                      <span className="min-w-0">{DIARY_KINDS[k].label}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
