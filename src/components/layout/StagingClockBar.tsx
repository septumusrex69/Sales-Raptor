import { useState } from 'react'
import { CalendarClock, ChevronsRight, Eraser } from 'lucide-react'
import { useAuth } from '../../store/AuthContext'
import { bannerDate, bannerLine, daysAfter, jumpTargets, type FirmClock } from '../../lib/clock.ts'
import { clearStaging, jumpStagingClock } from '../../lib/clockLoad'

/**
 * THE STAGING CLOCK'S BANNER, ON EVERY SCREEN, AND ITS CONTROLS (prompt 10).
 *
 * EVERYBODY ON STAGING SEES THE BANNER: "Staging date 11 Jul 2026 (real date 10 Oct 2026)". A
 * person testing the July payover must never mistake it for the real one, and somebody who opens
 * staging without knowing the clock was moved must be told before they read a single date.
 *
 * ONLY AN ADMINISTRATOR SEES THE BUTTONS, and the database refuses anybody else anyway
 * (staging_clock_guard). Forward only: +1 day, to the 11th (the cycle has closed -- its runs may be
 * approved), to the 10th (the last day of the cycle), or a picked date. Going back is Clear staging.
 *
 * A JUMP RELOADS THE PAGE when it lands, because the app reads the clock ONCE PER PAGE LOAD (see
 * lib/clock.ts) -- a page carrying on with yesterday's "today" after the clock moved is exactly the
 * disagreement the clock exists to prevent.
 *
 * NOTHING ON PRODUCTION. `clock.staging` is the database's own deployment row, so a preview build
 * pointed at production draws no banner and no buttons.
 */
export function StagingClockBar({ clock }: { clock: FirmClock | null }) {
  const { currentUser } = useAuth()
  const line = bannerLine(clock)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState('')
  const [clearing, setClearing] = useState(false)
  const [clearFrom, setClearFrom] = useState('')
  const [typed, setTyped] = useState('')

  if (!clock || !line) return null
  const isAdmin = currentUser?.role === 'Administrator'
  const today = clock.businessToday
  const targets = jumpTargets(today)

  const jump = async (to: string) => {
    setError(null)
    setBusy(`Moving the clock to ${bannerDate(to)}…`)
    const done = await jumpStagingClock(to, null, (reached) =>
      setBusy(`Moving the clock to ${bannerDate(to)} — reached ${bannerDate(reached)}…`))
    if (!done.ok) {
      setBusy(null)
      setError(done.error)
      return
    }
    window.location.reload()
  }

  const clear = async () => {
    setError(null)
    setBusy('Clearing staging…')
    const done = await clearStaging(clearFrom, typed)
    if (!done.ok) {
      setBusy(null)
      setError(done.error)
      return
    }
    window.location.reload()
  }

  const button = 'inline-flex items-center gap-1 rounded-md border border-amber-700/30 bg-white/70 px-2 py-0.5 text-[12px] font-medium text-amber-950 hover:bg-white disabled:opacity-50'

  return (
    <div data-testid="staging-clock" role="status"
      className="shrink-0 border-b border-amber-700/30 bg-amber-100 px-4 py-1.5 text-[12.5px] text-amber-950">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5 font-semibold" data-testid="staging-clock-line">
          <CalendarClock size={14} aria-hidden /> {line}
        </span>
        {isAdmin && !busy && (
          <span className="flex flex-wrap items-center gap-1.5" data-testid="staging-clock-controls">
            <button type="button" className={button} onClick={() => void jump(targets.plusOne)}>+1 day</button>
            <button type="button" className={button} onClick={() => void jump(targets.toEleventh)}
              title="The cycle closes: its payover runs can be approved">
              <ChevronsRight size={12} aria-hidden /> To the 11th · {bannerDate(targets.toEleventh)}
            </button>
            <button type="button" className={button} onClick={() => void jump(targets.toTenth)}
              title="The last day of the cycle">
              <ChevronsRight size={12} aria-hidden /> To the 10th · {bannerDate(targets.toTenth)}
            </button>
            {picking ? (
              <span className="inline-flex items-center gap-1">
                <input type="date" aria-label="Jump to" min={daysAfter(today, 1)} value={picked}
                  onChange={(e) => setPicked(e.target.value)}
                  className="rounded border border-amber-700/30 bg-white px-1 py-0.5 text-[12px]" />
                <button type="button" className={button} disabled={!picked || picked <= today}
                  onClick={() => void jump(picked)}>Go</button>
                <button type="button" className="text-[12px] underline" onClick={() => setPicking(false)}>Cancel</button>
              </span>
            ) : (
              <button type="button" className={button} onClick={() => setPicking(true)}>Pick a date</button>
            )}
            <button type="button" className={`${button} ml-2`} onClick={() => setClearing((v) => !v)}>
              <Eraser size={12} aria-hidden /> Clear staging…
            </button>
          </span>
        )}
        {busy && <span className="italic" data-testid="staging-clock-busy">{busy}</span>}
        {error && <span className="font-medium text-red-700" data-testid="staging-clock-error">{error}</span>}
      </div>
      {isAdmin && clearing && !busy && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 border-t border-amber-700/20 pt-1.5"
          data-testid="staging-clear">
          <span>
            Empties every client, account, payment, payover run, statement line and trust entry on
            staging, and starts the clock again on the day you pick. People, templates, workflows and
            settings stay. The clock does not go back any other way.
          </span>
          <input type="date" aria-label="Start the clock on" value={clearFrom}
            onChange={(e) => setClearFrom(e.target.value)}
            className="rounded border border-amber-700/30 bg-white px-1 py-0.5 text-[12px]" />
          <input type="text" aria-label="Type CLEAR STAGING" placeholder="Type CLEAR STAGING" value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="w-40 rounded border border-amber-700/30 bg-white px-1.5 py-0.5 text-[12px]" />
          <button type="button" className={button} disabled={!clearFrom || typed !== 'CLEAR STAGING'}
            onClick={() => void clear()}>Clear and start the clock</button>
        </div>
      )}
    </div>
  )
}
