/**
 * THE FIRM'S CLOCK IN THE BROWSER (prompt 10: a staging clock, so several months can be tested in
 * one afternoon).
 *
 * THE DATABASE KEEPS THE CLOCK. raptor_now() / raptor_today() are the real moment and the real
 * Johannesburg day on production, always; on a staging database whose clock has been moved they are
 * the staging day at the real time of day. The app reads them ONCE PER PAGE LOAD (`raptor_clock`,
 * loaded by AppLayout before any page draws) and from then on every date DECISION in the browser --
 * which cycle is open, what is due today, how old something is, the date a form starts on -- comes
 * from here, never from `new Date()`.
 *
 * AN OFFSET, NOT A FROZEN MOMENT. What is stored is how far the firm's clock is from this machine's;
 * `clockNow()` adds it to the machine's own time. So the time of day keeps running (a page left open
 * all afternoon still knows it is the afternoon), and on production, where the database says the real
 * time, the offset is the few milliseconds between the server's clock and this one.
 *
 * WHAT STAYS ON THE MACHINE'S CLOCK, on purpose: timers and stopwatches (the idle sign-out, a call's
 * timeout), cache-busting and file-name stamps, and the real-world stamps -- an email marked read, a
 * mailbox's last sync, updated_at. Those are about this machine and the outside world, and the
 * Supabase session's own expiry arithmetic is one of them -- which is why this is a function the app
 * calls rather than a patched global Date.
 *
 * PURE: no Supabase import, so the QA checks can import it. `src/lib/clockLoad.ts` fetches.
 */

export interface FirmClock {
  /** The firm's moment when the clock was read, as the database gave it. */
  businessNow: string
  /** The firm's day, yyyy-mm-dd. */
  businessToday: string
  /** The real moment and the real Johannesburg day, as the database gave them. */
  realNow: string
  realToday: string
  /** This database is staging. */
  staging: boolean
  /** ...and its clock has been moved off the real date (a row exists). */
  moved: boolean
}

let offsetMs = 0
let current: FirmClock | null = null

/**
 * Take the clock the database answered with. `readAt` is this machine's time when the answer
 * arrived, which is what the offset is measured against.
 */
export function applyClock(clock: FirmClock, readAt: number = Date.now()): void {
  current = clock
  offsetMs = new Date(clock.businessNow).getTime() - readAt
}

/** The clock as last read, or null before the first read (and in a check that never set one). */
export function firmClockState(): FirmClock | null {
  return current
}

/** Forget it -- for a check, and for signing out. */
export function resetClock(): void {
  current = null
  offsetMs = 0
}

/** The firm's NOW. Use this wherever the app decides something by the date. */
export function clockNow(): Date {
  return new Date(Date.now() + offsetMs)
}

/** The firm's now in milliseconds -- for the places that did arithmetic on Date.now(). */
export function clockNowMs(): number {
  return Date.now() + offsetMs
}

/**
 * The firm's TODAY, yyyy-mm-dd, in Johannesburg.
 *
 * JOHANNESBURG'S DAY, NOT UTC'S. Many screens wrote `new Date().toISOString().slice(0, 10)`, which
 * is the UTC date -- yesterday in Johannesburg between midnight and two in the morning. This is the
 * one answer.
 */
export function clockToday(): string {
  return johannesburgDay(clockNow())
}

/** A moment's day in Johannesburg, yyyy-mm-dd. `en-CA` because its short date IS yyyy-mm-dd. */
export function johannesburgDay(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at)
}

const parse = (iso: string) => new Date(`${iso}T00:00:00Z`)
const fmt = (d: Date) => d.toISOString().slice(0, 10)

/** An ISO day moved by whole days. */
export function daysAfter(iso: string, days: number): string {
  return fmt(new Date(parse(iso).getTime() + days * 86_400_000))
}

/**
 * The days a jump walks through, in order: every day after `from` up to and including `to`.
 * Empty when `to` is not after `from` -- the clock only goes forward.
 */
export function jumpDays(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = daysAfter(from, 1); d <= to; d = daysAfter(d, 1)) out.push(d)
  return out
}

/**
 * THE JUMP BUTTONS' TARGETS, for a clock standing on `today`.
 *
 * "+1 day"; "to the 11th" -- the day a cycle closes and its runs may be approved; "to the 10th" --
 * the last day of the cycle. Each is the NEXT such day strictly after today, because the clock only
 * goes forward and a button that would not move it is a button that does nothing.
 */
export function jumpTargets(today: string): { plusOne: string; toEleventh: string; toTenth: string } {
  const nextDayOfMonth = (dom: number) => {
    let d = daysAfter(today, 1)
    while (Number(d.slice(8, 10)) !== dom) d = daysAfter(d, 1)
    return d
  }
  return { plusOne: daysAfter(today, 1), toEleventh: nextDayOfMonth(11), toTenth: nextDayOfMonth(10) }
}

/** "11 Jul 2026" -- the banner's way of writing a day. */
export function bannerDate(iso: string): string {
  return parse(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/**
 * THE BANNER'S SENTENCE: "Staging date 11 Jul 2026 (real date 10 Oct 2026)". Null where there is
 * nothing to say -- production, or before the clock has been read.
 */
export function bannerLine(clock: FirmClock | null): string | null {
  if (!clock || !clock.staging) return null
  return `Staging date ${bannerDate(clock.businessToday)} (real date ${bannerDate(clock.realToday)})`
}
