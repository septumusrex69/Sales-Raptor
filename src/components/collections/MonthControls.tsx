import { CalendarClock, Users } from 'lucide-react'
import { SalesMonthPicker } from '../ui/SalesMonthPicker'
import { dayKey } from '../../lib/collectionPace.ts'
import type { CollectionsMonth } from '../../hooks/useCollectionsMonth'

/**
 * THE THREE CONTROLS THAT SAY WHAT THE FIGURES ARE OF: the period, the day they are read as at,
 * and whose they are.
 *
 * DRAWN AS TEXT, NOT AS A ROW OF FIELDS. The firm's own design has this line reading
 * "Collection period: 11 Sep – 10 Oct 2026 | As at: 18 Sep 2026 | All teams" with an icon in
 * front of each — three facts, not three boxes. The chrome comes off in the .hero-controls skin
 * rather than here, so the shared SalesMonthPicker is untouched on the eight other screens that
 * render it; the affordance does not come off with it, because the skin puts the box back on
 * hover and focus.
 *
 * ONE COMPONENT BECAUSE TWO SCREENS DRAW IT. The company dashboard and the collections dashboard
 * read the same month through the same hook, and three controls written out twice are three
 * controls that drift — one screen gaining a team filter the other does not have is enough to
 * make two people looking at "this month" be looking at different months.
 */
export function MonthControls({ month }: { month: CollectionsMonth }) {
  const { period, setPeriod, asAt, setAsAtKey, teamId, setTeamId, teamOptions } = month
  return (
    <>
      <SalesMonthPicker value={period} onChange={(p) => { setPeriod(p); setAsAtKey(null) }}
        referenceDate={new Date()} variant="dark" />
      <span className="hidden sm:block h-4 w-px bg-white/20" />
      <span className="flex items-center gap-2 text-xs text-white/60">
        <CalendarClock size={14} className="shrink-0 text-white/50" />
        <label htmlFor="collections-as-at">As at</label>
        <input id="collections-as-at" type="date" value={dayKey(asAt)}
          onChange={(e) => setAsAtKey(e.target.value || null)}
          min={dayKey(period.start)}
          max={dayKey(new Date() > period.end ? period.end : new Date())}
          aria-label="Read the report as at"
          className="rounded-lg border border-white/15 bg-white/10 px-2 py-1.5 text-xs text-white [color-scheme:dark]" />
      </span>
      {teamOptions.length > 0 && (
        <>
          <span className="hidden sm:block h-4 w-px bg-white/20" />
          <span className="flex items-center gap-2 text-xs text-white/60">
            <Users size={14} className="shrink-0 text-white/50" />
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)}
              aria-label="Team"
              className="rounded-lg border border-white/15 bg-white/10 px-2 py-1.5 text-xs text-white [color-scheme:dark]">
              <option value="">All teams</option>
              {teamOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </span>
        </>
      )}
    </>
  )
}
