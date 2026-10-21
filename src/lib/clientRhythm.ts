/**
 * EACH CLIENT'S HANDOVER RHYTHM, AND WHO IS LATE AGAINST IT (S8, 18 Oct).
 *
 * The firm: "see patterns in terms of dates we receive handovers ... especially from existing
 * clients", and agreed the first thing to build is each client's own rhythm: "hands over about every
 * 30 days, usually around the 25th" -- so a client who always sends on the 25th and has not by the
 * 30th is flagged NOW, not sixty days later when Gone quiet finally catches it.
 *
 * Pure, so a check can hold the rules:
 *   - a rhythm needs at least three handover days (two gaps); fewer is "not enough to tell";
 *   - the rhythm is the MEDIAN gap, so one odd month does not move it;
 *   - "around the Nth" is said only when the client's days of the month sit within a week of each
 *     other (interquartile spread up to 7 days); otherwise only the gap is said;
 *   - late is past the expected day by more than a grace of a quarter of the gap, at least a week:
 *     a client on a monthly rhythm is late eight days past due, not the morning after.
 */
export interface HandoverDay { day: string; accounts: number }

export interface Rhythm {
  /** Handover days in the span. */
  days: number
  /** The usual gap between handovers, in days; null with too few to tell. */
  everyDays: number | null
  /** The usual day of the month, where the client keeps to one. */
  aroundDay: number | null
  lastDay: string | null
  /** When the next was due, on the usual gap. */
  expected: string | null
  /** Days past expected plus grace; 0 when not late. */
  daysLate: number
  state: 'no_pattern' | 'on_pattern' | 'late'
}

const DAY = 86_400_000
const toDays = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY }
const fromDays = (n: number) => new Date(n * DAY).toISOString().slice(0, 10)
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const quantile = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); const i = (s.length - 1) * q; const lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo) }

export function rhythm(days: HandoverDay[], todayIso: string): Rhythm {
  const sorted = [...new Set(days.map((d) => d.day.slice(0, 10)))].sort()
  const lastDay = sorted[sorted.length - 1] ?? null
  if (sorted.length < 3) return { days: sorted.length, everyDays: null, aroundDay: null, lastDay, expected: null, daysLate: 0, state: 'no_pattern' }
  const gaps = sorted.slice(1).map((d, i) => toDays(d) - toDays(sorted[i]))
  const every = Math.round(median(gaps))
  const doms = sorted.map((d) => Number(d.slice(8, 10)))
  const spread = quantile(doms, 0.75) - quantile(doms, 0.25)
  const aroundDay = spread <= 7 ? Math.round(median(doms)) : null
  const expected = toDays(lastDay as string) + every
  const grace = Math.max(7, Math.round(every * 0.25))
  const late = toDays(todayIso) - (expected + grace)
  return { days: sorted.length, everyDays: every, aroundDay, lastDay, expected: fromDays(expected), daysLate: late > 0 ? toDays(todayIso) - expected : 0, state: late > 0 ? 'late' : 'on_pattern' }
}

/** "about every 30 days, usually around the 25th" */
export function rhythmWords(r: Rhythm): string {
  if (r.everyDays === null) return 'not enough handovers to tell'
  const every = r.everyDays >= 26 && r.everyDays <= 35 ? 'about once a month' : r.everyDays <= 9 ? `about every ${r.everyDays} days (weekly-ish)` : `about every ${r.everyDays} days`
  const nth = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`
  return r.aroundDay ? `${every}, usually around the ${nth(r.aroundDay)}` : every
}

/**
 * A TYPICAL MONTH (the firm's second choice): for each day of the month, the average accounts that
 * arrived on it over the span, so a month-end or payday peak shows. Calendar days 1 to 31; a day the
 * month does not have (the 31st in June) is averaged over the months that do.
 */
export function typicalMonth(rows: { day: string; accounts: number; newAccounts?: number }[], fromIso: string, toIso: string, who: 'all' | 'existing' | 'new' = 'existing'): { dom: number; average: number }[] {
  const start = new Date(`${fromIso}T12:00:00Z`), end = new Date(`${toIso}T12:00:00Z`)
  const totals = new Map<number, number>()
  for (const r of rows) {
    const n = who === 'all' ? r.accounts : who === 'new' ? (r.newAccounts ?? 0) : r.accounts - (r.newAccounts ?? 0)
    const dom = Number(r.day.slice(8, 10))
    totals.set(dom, (totals.get(dom) ?? 0) + n)
  }
  /* How many times each day of the month occurred in the span. */
  const occurs = new Map<number, number>()
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) occurs.set(d.getUTCDate(), (occurs.get(d.getUTCDate()) ?? 0) + 1)
  return Array.from({ length: 31 }, (_, i) => i + 1).map((dom) => ({ dom, average: occurs.get(dom) ? Math.round(((totals.get(dom) ?? 0) / (occurs.get(dom) as number)) * 10) / 10 : 0 }))
}
