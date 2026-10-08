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
  periodStart: string
  periodEnd: string
  runs: T[]
  total: number
}

export function groupRunsByCycle<T extends GroupableRun>(
  runs: T[], openStart: string | null, mode: 'open' | 'paid',
): CycleGroup<T>[] {
  const byStart = new Map<string, T[]>()
  for (const r of runs) {
    const list = byStart.get(r.periodStart) ?? []
    list.push(r)
    byStart.set(r.periodStart, list)
  }
  const dueEnd = openStart ? dayBefore(openStart) : null
  return [...byStart.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([start, list]) => {
      const end = list[0].periodEnd
      const total = Math.round(list.reduce((s, r) => s + r.netPayover, 0) * 100) / 100
      let title: string; let tone: CycleGroup<T>['tone']
      if (mode === 'paid') { title = `Paid — ${periodLabel(start, end)}`; tone = 'done' }
      else if (openStart && start >= openStart) { title = 'This cycle so far — still open'; tone = 'early' }
      else if (dueEnd && end === dueEnd) { title = 'This month to process'; tone = 'now' }
      else { title = 'Earlier, still pending'; tone = 'late' }
      return { key: start, title, tone, periodStart: start, periodEnd: end, runs: list, total }
    })
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
