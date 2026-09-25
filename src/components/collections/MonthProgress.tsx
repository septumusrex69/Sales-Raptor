import { Card } from '../ui/Card'
import { targetLaps, type MonthPace, type PaceLine } from '../../lib/collectionPace.ts'

/**
 * A ratio as the firm writes it. One decimal, because 0.8% and 1.2% are different problems.
 *
 * Exported rather than copied: the month bar and the tables under it print the same percentage,
 * and two roundings of one figure on one screen is two figures as far as a reader is concerned.
 */
export const pctText = (v: number | null): string => (v === null ? '—' : `${(v * 100).toFixed(1)}%`)

/**
 * The month on one bar, with the day's pace marked on it.
 *
 * THE MARKER IS THE POINT. A bar alone says 36% and leaves the reader to work out whether that is
 * good; the line at 30% says it is ahead, on the day it is being read. It is the same comparison
 * the status pills make, drawn once for the whole floor.
 */
export function MonthProgress({ pace, line, note, tone = 'light' }: {
  pace: MonthPace
  line: PaceLine | null
  note?: string
  /**
   * 'dark' renders it inside the company dashboard's hero, in the glass panel, rather than as a
   * card of its own — which is how the collections floor draws it now that the photograph has
   * moved.
   *
   * A VARIANT RATHER THAN A SECOND COMPONENT, deliberately. The month bar is the same three facts
   * wherever it is drawn — what was achieved, what was expected by now, how many days are left —
   * and a second implementation for the dark panel is a second place for those to disagree with
   * the tables underneath. Only the colours change; every figure comes from the same pace object.
   */
  tone?: 'light' | 'dark'
}) {
  const { fill, laps, over } = targetLaps(line?.achieved ?? null)
  const marker = Math.min(100, Math.round(pace.expected * 100))
  const dark = tone === 'dark'

  const body = (
    <>
      <div className={`px-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 ${dark ? 'pt-2' : 'pt-3'}`}>
        <p className={dark ? 'text-sm text-white/60' : 'text-sm text-slate-500'}>
          Monthly progress{' '}
          <span className={`font-semibold tabular-nums ${dark ? 'text-white' : 'text-slate-800'}`}>
            {line?.achieved === null || line?.achieved === undefined
              ? 'no target set'
              : `${pctText(line.achieved)} achieved`}
          </span>
          {laps > 0 && (
            <span className={`ml-2 text-xs font-medium ${dark ? 'text-[#3ecf8e]' : 'text-emerald-700'}`}>
              {laps === 1 ? 'past target' : `${laps} targets over`}
            </span>
          )}
        </p>
        <p className={`text-xs tabular-nums ${dark ? 'text-white/45' : 'text-slate-400'}`}>
          {pace.daysWorked} of {pace.workDays} working days completed
          {pace.finished ? ' · month closed' : ` · ${pace.daysLeft} remaining`}
        </p>
      </div>
      <div className={`px-4 pb-1 ${dark ? 'pt-2' : 'pt-3'}`}>
        {/* Thinner on the dark panel, at the firm's instruction: over a photograph a 10px bar
            reads as a widget, and the figure beside it is what anybody actually reads. */}
        <div className={`relative rounded-full ${dark ? 'h-1.5 bg-white/12' : 'h-2.5 bg-slate-200'}`}>
          <div className={`h-full rounded-full ${
            over ? (dark ? 'bg-[#3ecf8e]' : 'bg-emerald-500') : (dark ? 'bg-[#d8b76b]' : 'bg-gold-400')
          }`} style={{ width: `${Math.round(fill * 100)}%` }} />
          {/* Hidden once the month is over: there is no pace left to keep, only a result. */}
          {!pace.finished && (
            <div className={`absolute inset-y-[-3px] w-px ${dark ? 'bg-white/55' : 'bg-slate-500'}`}
              style={{ left: `${marker}%` }} />
          )}
        </div>
      </div>
      <div className={`px-4 relative ${dark ? 'pb-2 h-4' : 'pb-3 h-4'}`}>
        {!pace.finished && (
          <span className={`absolute text-[11px] tabular-nums -translate-x-1/2 whitespace-nowrap ${
            dark ? 'text-white/45' : 'text-slate-500'
          }`} style={{ left: `calc(${marker}% + 1rem)` }}>
            {marker}% expected by now
          </span>
        )}
      </div>
      {note && (
        <p className={`px-4 pb-3 -mt-1 text-xs ${dark ? 'text-[#e4c68a]' : 'text-amber-700'}`}>{note}</p>
      )}
    </>
  )

  return dark ? <div>{body}</div> : <Card padded={false}>{body}</Card>
}
