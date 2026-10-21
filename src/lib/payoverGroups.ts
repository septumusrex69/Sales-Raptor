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
  runs: T[], openStart: string | null, mode: 'open' | 'paid', lagMonths = 1, today: string | null = null,
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
        /* FINALISED (11 Oct): paid, or below nil and carried forward -- nothing left to do on it. */
        title = 'Finalised'; tone = 'done'; state = `Paid over or carried forward · was due ${dayLabel(paysOn)}`
      } else if (openStart && start >= openStart) {
        title = 'Collecting'; tone = 'early'
        state = collectingState(end, lagMonths)
      } else if (today && today === paysOn) {
        /* ITS DAY IS TODAY, and that is not late. With a lag of a month the cycle being paid on the
           11th is not the one that closed last night -- read only off `dueEnd`, it was called
           Overdue on the very morning it fell due (11 Oct). */
        title = 'Due today'; tone = 'now'
        state = `Paid out today · approve, make the EFT, then email the advice`
      } else if (today ? today < paysOn : (dueEnd !== null && end === dueEnd)) {
        /* APPROVED, PAID AND ADVISED ON THE DAY (11 Oct): until then it stays Ready and takes in what is raised for it. */
        title = 'Waiting'; tone = 'now'
        state = `Nothing more goes in · approved, paid and advised on ${dayLabel(paysOn)}`
      } else {
        title = 'Overdue'; tone = 'late'
        state = `Closed ${dayLabel(end)} · was due ${dayLabel(paysOn)} and is not yet paid`
      }
      return { key: start, title, tone, state, paysOn, periodStart: start, periodEnd: end, runs: list, total }
    })
}

/** What the open cycle's band says, with or without a run in it yet. */
export function collectingState(end: string, lagMonths: number): string {
  return `Still collecting · closes at midnight on ${dayLabel(end)} · paid out ${dayLabel(paysOnFor(end, lagMonths))}`
}

/*
 * FOUR TABS, ONE CYCLE EACH (S7, the firm, 12 Oct: "in the closed to pay, two months were mixed.
 * That's confusing"). With a payover a month after the cycle closes there are always THREE live
 * cycles -- the one collecting, the one that closed and waits a month for its day, and the one due
 * now -- and the queue had two working tabs, so on the 11th "Closed · to pay" held both the cycle
 * paid that morning and the one that closed the night before and pays next month.
 *
 *   COLLECTING -- the open cycle; payments approved today land here.
 *   WAITING    -- closed, before its payout day. Checked and fixed; approved on the day.
 *   TO PAY     -- on or after its payout day (or released early, with a reason), not finished.
 *                 An overdue cycle is here too, in red, on top.
 *   HISTORY    -- finished: paid, or below nil and carried forward.
 *
 * Decided by the date alone, so a run moves tab on the morning its day comes and nobody moves it.
 */
export type QueueTab = 'collecting' | 'waiting' | 'topay' | 'history'

export interface TabbableRun { periodStart: string; periodEnd: string }

export function queueTabOf(
  r: TabbableRun, opts: { final: boolean; released: boolean; openStart: string | null; today: string | null; lagMonths: number },
): QueueTab {
  if (opts.final) return 'history'
  if (opts.openStart && r.periodStart >= opts.openStart) return 'collecting'
  if (opts.released) return 'topay'
  /* With no today known the run is shown as due rather than hidden as waiting. */
  if (opts.today && opts.today < paysOnFor(r.periodEnd, opts.lagMonths)) return 'waiting'
  return 'topay'
}

/** Opens on what is due; if nothing is, on what is waiting; then on what is collecting. */
export function defaultQueueTab(counts: Record<QueueTab, number>): QueueTab {
  if (counts.topay > 0) return 'topay'
  if (counts.waiting > 0 || counts.collecting === 0) return 'waiting'
  return 'collecting'
}

/** The address's ?tab=, old names included: a link from before S7 still lands somewhere sensible. */
export function parseQueueTab(param: string | null): QueueTab | null {
  switch (param) {
    case 'collecting': case 'running': return 'collecting'
    case 'waiting': return 'waiting'
    case 'topay': case 'closed': return 'topay'
    case 'history': case 'paid': case 'finalised': return 'history'
    default: return null
  }
}

/** History's month picker: every payout day a finished run belongs to, newest first. */
export function historyPayouts(runs: { periodEnd: string }[], lagMonths: number): string[] {
  return [...new Set(runs.map((r) => paysOnFor(r.periodEnd, lagMonths)))].sort().reverse()
}

export function payoutLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `Payout ${d} ${MONTHS[m - 1]} ${y}`
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

/*
 * WHAT A RUN'S PILL SAYS DEPENDS ON THE TAB IT IS IN (S7, the firm, 13 Oct: "where it says ready,
 * it's a little bit confusing because it looks like it's ready to pay over ... it should still be
 * like in a yellow state ... Collecting is red, like busy collecting ... ready would be in the to pay
 * section"). The stored status 'ready' means "nothing wrong on it" -- true of a run still collecting,
 * of one waiting for its day and of one due today, and only the last is ready for anything. So the
 * word comes from where the run stands, and the colour with it: red still collecting, yellow checked
 * and waiting, blue ready to approve. Every other status keeps its own word.
 */
export type PillTone = 'collecting' | 'waiting' | 'ready' | 'review' | 'approved' | 'sent' | 'paid' | 'void'
export function runPill(status: string, tab: QueueTab): { label: string; tone: PillTone } {
  if (status === 'ready') {
    if (tab === 'collecting') return { label: 'Collecting', tone: 'collecting' }
    if (tab === 'waiting') return { label: 'Checked · waiting', tone: 'waiting' }
    return { label: 'Ready to approve', tone: 'ready' }
  }
  if (status === 'needs_review') return { label: 'Needs review', tone: 'review' }
  if (status === 'approved') return { label: 'Approved', tone: 'approved' }
  if (status === 'sent') return { label: 'Sent', tone: 'sent' }
  if (status === 'paid') return { label: 'Paid', tone: 'paid' }
  return { label: 'Void', tone: 'void' }
}
