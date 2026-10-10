/**
 * THE PAYOVER QUEUE, IN THE CYCLES THE FIRM WORKS IT IN.
 *
 * The firm, 8 Oct: the runs should read as "this month to process" and "previous month pending".
 * A flat list mixed them, and on the 11th that hides the one thing that matters -- a run from last
 * month that never got paid sits among this month's as if it were new.
 *
 * Relative to the cycle that is OPEN today (fetchCycle):
 *   - the cycle that ended the day before it opened is THIS MONTH'S payover, the one due now;
 *   - anything older and still in the queue is EARLIER, STILL PENDING -- late by definition;
 *   - the open cycle's own runs build themselves as payments are processed (refresh_payover_runs)
 *     and are said to be still open rather than mixed in with the month being paid.
 * Paid runs are grouped by their cycle with no urgency in the words: finished is finished.
 *
 * Pure, so a check can import it. Totals add the runs' own net figures; nothing is recomputed.
 */
export interface GroupableRun { periodStart: string; periodEnd: string; netPayover: number }

export interface CycleGroup<T extends GroupableRun> {
  key: string
  title: string
  tone: 'now' | 'late' | 'early' | 'done'
  /** The one-line state in the firm's words: what is happening to this money and when. */
  state: string
  /** The day this cycle's money is due out (the 11th, `lagMonths` after it closes). */
  paysOn: string
  periodStart: string
  periodEnd: string
  runs: T[]
  total: number
}

/*
 * THREE STATES, SAID IN WORDS AND ORDERED BY WHEN THE MONEY LEAVES (the firm, 10 Oct: "how am I
 * going to know which one is for this payment run and which one has already been switched off ...
 * closed and pending payment ... this month is running"). The queue used to put the running cycle
 * on top in small grey type; now the one that is paid soonest is first, as on the Trust overview:
 *   OVERDUE  -- closed, its payover day has passed, still not paid;
 *   CLOSED   -- the cut-off has passed, nothing more goes in, waiting for its payover day;
 *   RUNNING  -- still collecting: every payment approved today lands here until midnight on the 10th.
 */
export function groupRunsByCycle<T extends GroupableRun>(
  runs: T[], openStart: string | null, mode: 'open' | 'paid', lagMonths = 1,
): CycleGroup<T>[] {
  const byStart = new Map<string, T[]>()
  for (const r of runs) {
    const list = byStart.get(r.periodStart) ?? []
    list.push(r)
    byStart.set(r.periodStart, list)
  }
  const dueEnd = openStart ? dayBefore(openStart) : null
  return [...byStart.entries()]
    /* Paid: newest first (history). Working: oldest first -- the one that leaves soonest on top. */
    .sort(([a], [b]) => (mode === 'paid' ? (a < b ? 1 : a > b ? -1 : 0) : (a < b ? -1 : a > b ? 1 : 0)))
    .map(([start, list]) => {
      const end = list[0].periodEnd
      const paysOn = paysOnFor(end, lagMonths)
      const total = Math.round(list.reduce((s, r) => s + r.netPayover, 0) * 100) / 100
      let title: string; let tone: CycleGroup<T>['tone']; let state: string
      if (mode === 'paid') {
        title = 'Paid'; tone = 'done'; state = `Paid over · was due ${dayLabel(paysOn)}`
      } else if (openStart && start >= openStart) {
        title = 'Running'; tone = 'early'
        state = `Still collecting · closes at midnight on ${dayLabel(end)} · paid out ${dayLabel(paysOn)}`
      } else if (dueEnd && end === dueEnd) {
        title = 'Closed'; tone = 'now'
        state = `Nothing more goes in · check, approve and pay on ${dayLabel(paysOn)}`
      } else {
        title = 'Overdue'; tone = 'late'
        state = `Closed ${dayLabel(end)} · was due ${dayLabel(paysOn)} and is not yet paid`
      }
      return { key: start, title, tone, state, paysOn, periodStart: start, periodEnd: end, runs: list, total }
    })
}

/** The payover day: the day after the cycle closes, `lagMonths` later (a cycle ending 10 Sep pays 11 Oct). */
export function paysOnFor(end: string, lagMonths: number): string {
  const [y, m, d] = end.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + lagMonths, d + 1)).toISOString().slice(0, 10)
}

function dayLabel(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]}`
}

function dayBefore(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function periodLabel(start: string, end: string): string {
  const f = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}` }
  return `${f(start)} – ${f(end)}`
}
