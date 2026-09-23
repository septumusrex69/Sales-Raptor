import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../store/AuthContext'
import { AlertTriangle, CalendarClock, Loader2, UserCheck } from 'lucide-react'
import { Modal, FormField, inputClass } from '../../components/ui/Modal'
import { DictateButton } from '../../components/ui/Dictate'
import {
  planHandOut, planSummary, type HandOutPlan, type PlannableCollector,
} from '../../lib/handOut.ts'
import { loadHandOutContext, type HandOutContext } from '../../lib/handOutData.ts'
import { commitHandOut, handOutSummary, type HandOutMode } from '../../lib/handOutWrite.ts'
import { unallocatedCount } from '../../lib/accountAllocation.ts'
import { BULK_CEILING, type Selection } from '../../lib/accountAllocation.ts'
import { ACCOUNT_BANDS, COLLECTOR_GRADES, bookCeilingOf } from '../../lib/collectorGrade.ts'
import { addWorkingDays } from '../../lib/workingDays.ts'
import type { Team, User } from '../../types'

const DEFAULT_WINDOW = 5

/*
 * The windows anybody actually asks for. A free number box let somebody type 37, which is not a
 * decision anybody makes — the real choice is "today", "this week", "over a fortnight" — and the
 * planner's own limit is 40 working days, so the top of this list stays inside it.
 */
const WINDOW_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30] as const

/** A chip in the second row: what it is called, and exactly who it stands for. */
interface PickGroup { id: string; label: string; ids: string[] }

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
export function HandOutModal({
  selection, selectedCount, users, teams, actor, handoverId, onClose, onDone,
}: {
  selection: Selection
  /** What the bulk bar said, so the modal can show a figure before its own load finishes. */
  selectedCount: number
  users: User[]
  teams: Team[]
  actor: { id: string | null; name: string | null }
  /**
   * The batch, when the list itself is narrowed to one — which is how somebody arrives here from
   * an approved handover. Passed through only so the clerk's notification links to those accounts
   * rather than to their whole desk.
   */
  handoverId?: string | null
  onClose: () => void
  onDone: (message: string) => void | Promise<void>
}) {
  const [context, setContext] = useState<HandOutContext | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [startOn, setStartOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [windowDays, setWindowDays] = useState(DEFAULT_WINDOW)
  const [mode, setMode] = useState<HandOutMode>('allocate_and_refer')
  /*
   * How many of these are on nobody's desk, which decides whether "Refer only" is a thing that
   * can be done to them at all. Null while it is being counted -- see the note by the choice.
   */
  const [unowned, setUnowned] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [search, setSearch] = useState('')
  /*
   * How you are choosing, not who you chose — the selection itself stays in `chosen`, so the
   * checkbox list and the chips are never two sources of truth that can disagree. A chip is lit
   * when everybody in that group is ticked, which means unticking one person turns the chip off
   * by itself rather than leaving it lying about what is selected.
   */
  const [pickBy, setPickBy] = useState<'everyone' | 'rank' | 'team'>('everyone')
  const [onlyChosen, setOnlyChosen] = useState(false)
  const [evenSplit, setEvenSplit] = useState(false)
  const [keepKind, setKeepKind] = useState(false)
  /*
   * Numbers a person has set by hand, userId → exactly this many. Everything else re-shares
   * around them. Kept out of `chosen` because they answer different questions — who is in this
   * hand-out at all, and how much of it one of them takes.
   */
  const [pinned, setPinned] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const { session } = useAuth()
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  /*
   * How much of everyone's diary is worth fetching. Generous on the far end, because the planner
   * is allowed to run past the window rather than drop accounts — but bounded, because the
   * planner's own limit is 40 working days and four times a thirty-day window would ask every
   * collector for half a year of diary to answer a question about six weeks of it.
   */
  const to = useMemo(
    () => addWorkingDays(startOn, Math.min(windowDays * 4, 45)), [startOn, windowDays])

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

  /*
   * WHETHER THESE ACCOUNTS HAVE OWNERS AT ALL, which decides whether refer-only is on offer.
   *
   * ITS OWN REQUEST, not read off `context.accounts`: that list is capped at BULK_CEILING and is
   * loaded for the diary planner, so counting inside it would answer "are the first five thousand
   * unowned" and quietly say yes on a bigger batch. A count in the database answers the question
   * that was asked.
   *
   * A FAILURE LEAVES IT NULL, and null keeps the choice OPEN rather than closing it. A count that
   * did not come back is not evidence that these accounts have no owner, and removing somebody's
   * option because a request failed is the screen making a decision on no information.
   */
  useEffect(() => {
    let cancelled = false
    setUnowned(null)
    void unallocatedCount(selection)
      .then((n) => { if (!cancelled) setUnowned(n) })
      .catch(() => { if (!cancelled) setUnowned(null) })
    return () => { cancelled = true }
  }, [selection])

  /*
   * Offered only where every account in the hand-out already has an owner. A MIXED selection --
   * some owned, some not -- still offers it, because referring the owned ones is a real thing
   * somebody may be doing; what is withheld is the case where it could not mean anything.
   */
  const referOnlyPossible = unowned === null || unowned < selectedCount

  /* And if it stops being possible while it is chosen, the choice goes back rather than being
     submitted as something the screen no longer offers. */
  useEffect(() => {
    if (!referOnlyPossible && mode === 'refer') setMode('allocate_and_refer')
  }, [referOnlyPossible, mode])

  const plan: HandOutPlan | null = useMemo(() => {
    if (!context) return null
    const collectors = context.collectors.filter((c) => chosen.has(c.userId))
    if (collectors.length === 0) return null
    return planHandOut({
      accounts: context.accounts,
      collectors,
      startOn,
      windowDays,
      /*
       * EVERYTHING GOES OUT, including accounts already sitting in a diary — at the firm's
       * instruction, and they are right. Handing an account to somebody IS moving the work, so
       * refusing to move a date that a previous holder set defeats the point. It is not silent
       * either: diarise() supersedes the old entry, which keeps its original date and records
       * who moved it and when. That audit trail is exactly what made skipping unnecessary.
       */
      skipAlreadyBooked: false,
      evenSplit,
      keepKind,
      /*
       * Only for people who are actually in the hand-out. A pin left behind on somebody who has
       * since been unticked would eat budget for a desk that is not on the screen.
       */
      pinned: Object.fromEntries(
        Object.entries(pinned).filter(([id]) => chosen.has(id))),
    })
  }, [context, chosen, startOn, windowDays, evenSplit, keepKind, pinned])

  /*
   * BY NAME, AND IT WAS BY WHO IS TAKING MOST. That ordering was added so the four people a plan
   * used were not buried among thirty-five, and it had to go the moment the rows became
   * adjustable: pressing minus changed somebody's share, which changed their place in the list,
   * which moved the row out from under the finger that pressed it. On an iPad the next press
   * lands on a different person.
   *
   * Nothing is lost by it. The job this list does is choosing WHO is in the hand-out; the grid
   * below already lists everybody taking work, in the order the plan gave it to them, and "show
   * only chosen" narrows this one. Two views, two jobs, and the one you argue with holds still.
   */
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (context?.collectors ?? [])
      .filter((c) => (!onlyChosen || chosen.has(c.userId)) && (!q || c.name.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [context, chosen, search, onlyChosen])

  const everyone = useMemo(
    () => (context?.collectors ?? []).map((c) => c.userId), [context])

  /*
   * The two ways of grouping a floor, each with the ids behind it so the chip can both select
   * them and know whether it is lit. Empty groups are dropped: a grade nobody holds and a team
   * with no collectors in it are both buttons that appear to do nothing.
   *
   * "Not graded" and "No team" are real groups, not leftovers. Most of this firm's floor is
   * ungraded — a rank picker that silently omitted them would make a third of the collectors
   * unreachable by any chip, which is the same shape of bug as the grade gate that used to
   * filter real pre-legal clerks out of the list entirely.
   */
  const grades = useMemo<PickGroup[]>(() => {
    const all = context?.collectors ?? []
    const out: PickGroup[] = COLLECTOR_GRADES.map((g) => ({
      id: g,
      label: g,
      ids: all.filter((c) => c.grade === g && !c.ungraded).map((c) => c.userId),
    }))
    const ungraded = all.filter((c) => c.ungraded).map((c) => c.userId)
    if (ungraded.length > 0) out.push({ id: 'ungraded', label: 'Not graded', ids: ungraded })
    return out.filter((g) => g.ids.length > 0)
  }, [context])

  const groups = useMemo<PickGroup[]>(() => {
    const all = context?.collectors ?? []
    const out: PickGroup[] = teams.map((t) => ({
      id: t.id,
      label: t.name,
      ids: all.filter((c) => teamOf(users, c.userId) === t.id).map((c) => c.userId),
    }))
    const none = all.filter((c) => !teamOf(users, c.userId)).map((c) => c.userId)
    if (none.length > 0) out.push({ id: 'none', label: 'No team', ids: none })
    return out.filter((g) => g.ids.length > 0)
  }, [context, teams, users])

  /* Whole group in, or whole group out. Half a team ticked means the chip is unlit and clicking
   * it completes the team rather than clearing it — the reading a person expects from a chip
   * that is not lit. */
  const toggleGroup = useCallback((ids: string[]) => setChosen((prev) => {
    const next = new Set(prev)
    if (ids.every((id) => next.has(id))) for (const id of ids) next.delete(id)
    else for (const id of ids) next.add(id)
    return next
  }), [])

  /*
   * A NUDGE IS SET FROM WHAT IS ON SCREEN, not from the last pin. Clicking minus on a row reading
   * 19 pins it at 18 whether or not it was already pinned, so the buttons step the number the
   * person is looking at rather than some earlier one they have forgotten about.
   */
  const nudge = useCallback((id: string, by: number) => {
    const now = plan?.collectors.find((c) => c.userId === id)?.taking ?? 0
    setPinned((prev) => ({ ...prev, [id]: Math.max(0, now + by) }))
  }, [plan])

  const unpin = useCallback((id: string) => setPinned((prev) => {
    const next = { ...prev }
    delete next[id]
    return next
  }), [])

  const toggle = useCallback((id: string) => setChosen((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  }), [])

  const tooMany = (context?.accounts.length ?? 0) > BULK_CEILING
  /* How many the "keep what it is" box would actually apply to — the rest have nothing to keep. */
  const keptCount = useMemo(
    () => (context?.accounts ?? []).filter((a) => a.currentKind).length, [context])
  const handSet = useMemo(
    () => Object.keys(pinned).filter((id) => chosen.has(id)).length, [pinned, chosen])
  /*
   * A pin the plan could not honour — the grade gate refused every remaining account, or the
   * diaries ran out of room. Named rather than left as a number that quietly disagrees with what
   * somebody typed.
   */
  const shortPins = useMemo(
    () => (plan?.collectors ?? []).filter((c) => c.pinShort), [plan])

  /*
   * The same arithmetic the planner does, so the line above the plan and the plan itself cannot
   * drift. Read off the plan once it exists — its placements are what will actually be booked,
   * which is a smaller number than the selection whenever the grade gate turns something away.
   */
  const perDay = Math.max(1, Math.ceil(
    (plan?.placements.length ?? context?.accounts.length ?? 0) / Math.max(1, windowDays)))

  async function commit() {
    if (!plan) return
    setBusy({ done: 0, total: plan.placements.length }); setError(null)
    try {
      const res = await commitHandOut({
        plan, mode, actor, reason, handoverId,
        /* So a single allocation's handover goes out now rather than on the next daily sweep.
           See commitHandOut -- a batch is deliberately left to the sweep. */
        accessToken: session?.access_token ?? null,
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
                  {' '}<span className="text-slate-500">
                    {context.alreadyBookedCount} already sit in a diary and will be moved to the
                    new date — the old entry keeps its date and records who moved it.
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
                Nobody here works a collections book, so there is no one to hand these to. Give
                somebody the Pre-legal Agent or Pre-legal Team Leader role in{' '}
                <span className="font-medium">Settings → Users</span>; a grade is optional and
                only widens which accounts they may be given.
              </p>
            ) : (
              <>
                {/*
                  A LIST, NOT A GRID OF CARDS. Eight collectors fitted in cards; thirty-five do
                  not — that is eighteen rows of ninety-pixel tiles inside a modal, and choosing
                  four of them means scrolling past thirty-one you do not want. On an iPad it is
                  most of a screen before the plan is even visible.

                  So: one line each, a search box, and the choice summarised above the list so it
                  stays visible while you scroll. The quick-picks remain, because "everyone on
                  Bravo" should not require finding six names.
                */}
                <div>
                  {/*
                    TWO ROWS, NOT ONE FLAT LIST OF CHIPS. Everything used to sit on one line:
                    Everyone, four grades, five teams and None, wrapping onto three rows of
                    look-alike buttons where "Senior" and "Pre-legal Echo" read as the same kind
                    of thing. They are not — one is a rank and the other is a team, and the firm
                    asked for exactly that distinction: pick how you are choosing, then choose.

                    And the second row MULTI-SELECTS, because "two of the five teams" was the
                    thing the flat row could not do at all: each chip replaced the selection, so
                    picking Bravo threw Alpha away.
                  */}
                  <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                    <span className="text-xs font-medium text-slate-500 mr-0.5">Who</span>
                    <Pick on={pickBy === 'everyone'}
                      onClick={() => { setPickBy('everyone'); setChosen(new Set(everyone)) }}>
                      Everyone
                    </Pick>
                    {/*
                      Only offered where they would narrow something: with one team, or with
                      nobody graded, the mode is a button that appears to do nothing.
                    */}
                    {grades.length > 0 && (
                      <Pick on={pickBy === 'rank'} onClick={() => { setPickBy('rank'); setChosen(new Set()) }}>
                        Rank
                      </Pick>
                    )}
                    {groups.length > 0 && (
                      <Pick on={pickBy === 'team'} onClick={() => { setPickBy('team'); setChosen(new Set()) }}>
                        Team
                      </Pick>
                    )}
                    <Pick onClick={() => setChosen(new Set())} quiet>None</Pick>
                  </div>

                  {pickBy !== 'everyone' && (
                    <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                      {(pickBy === 'rank' ? grades : groups).map((g) => (
                        <Pick key={g.id} on={g.ids.every((id) => chosen.has(id))}
                          onClick={() => toggleGroup(g.ids)}>
                          {g.label}
                          <span className="text-slate-400 tabular-nums"> {g.ids.length}</span>
                        </Pick>
                      ))}
                    </div>
                  )}

                  <input
                    className={`${inputClass} mb-1.5`}
                    placeholder={`Search ${context.collectors.length} collectors by name…`}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />

                  {/*
                    The choice, stated above the list. Scrolling a list of thirty-five to find who
                    is ticked is exactly the work the search box was added to avoid, and the
                    count is the only thing that makes "did I get everyone" answerable at a glance.
                  */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-1 text-[11px]">
                    <span className={chosen.size === 0 ? 'text-amber-700' : 'text-slate-500'}>
                      {chosen.size === 0
                        ? 'Nobody chosen'
                        : `${chosen.size} of ${context.collectors.length} chosen`}
                    </span>
                    {plan && plan.placements.length > 0 && (
                      <span className="text-slate-400 tabular-nums">
                        taking {plan.placements.length.toLocaleString('en-ZA')} between them
                      </span>
                    )}
                    {/*
                      SAID OUT LOUD, because a hand-set figure is the one thing on this screen the
                      plan did not decide — and with thirty-nine rows the ring on a row somebody
                      nudged an hour ago is easy to scroll past. One way back for all of them, so
                      "start again from what the rule says" is a click rather than an audit.
                    */}
                    {handSet > 0 && (
                      <span className="text-brand-700">
                        {handSet === 1 ? '1 set by hand' : `${handSet} set by hand`}
                        <button type="button" onClick={() => setPinned({})}
                          className="ml-1.5 text-brand-600 hover:underline">Reset</button>
                      </span>
                    )}
                    {chosen.size > 0 && (
                      <button type="button" onClick={() => setOnlyChosen((v) => !v)}
                        className="text-brand-600 hover:underline ml-auto">
                        {onlyChosen ? 'Show all' : 'Show only chosen'}
                      </button>
                    )}
                  </div>

                  {/*
                    Capped and scrolled rather than growing with the team. A modal that is taller
                    than the screen hides its own Done button, which is how somebody ends up
                    unable to finish a hand-out they have already set up.
                  */}
                  {/*
                    data-qa, and the only one in the app so far. The e2e check for "searching
                    narrows the list" read the whole page and passed by accident: it asserted a
                    name was absent, and the name was absent from the list but present in the plan
                    preview below, which names everybody taking work. Scoping the assertion to the
                    list is the fix; the hook is what makes scoping possible.
                  */}
                  {/*
                    A HEADER, because "14/500" on a row next to "+2 (9)" in the grid below is two
                    different number pairs on one screen with nothing saying which is which — and
                    the firm asked what it meant, which is the only evidence that matters. One is
                    the BOOK: how many accounts they carry against their ceiling. The other is a
                    DAY in the diary. A title attribute does not answer it; on an iPad there is
                    nothing to hover.
                  */}
                  <div className="flex items-center gap-2 px-2.5 pb-1 text-[10px] uppercase tracking-wide text-slate-400">
                    <span className="w-3.5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1">Collector</span>
                    <span className="shrink-0 w-16 text-right">Grade</span>
                    <span className="shrink-0 w-20 text-right">On the book</span>
                    {/*
                      A DAY, at the firm's request, and it belongs here for a reason they will hit
                      again: it explains the day grid but NOT the split. Bongani works 35 a day
                      where everybody else works 50, which is why his row fills more slowly — and
                      it is not why he takes fewer accounts. The book is.
                    */}
                    <span className="shrink-0 w-12 text-right">A day</span>
                    <span className="shrink-0 w-[4.75rem] text-right pr-4">Taking</span>
                  </div>

                  <div data-qa="collector-list"
                    className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-50">
                    {visible.length === 0 ? (
                      <p className="px-2.5 py-3 text-xs text-slate-400">
                        {search.trim() ? `Nobody matching “${search.trim()}”.` : 'Nobody to show.'}
                      </p>
                    ) : visible.map((c) => {
                      const ceiling = bookCeilingOf(c.bookCeiling)
                      const taking = plan?.collectors.find((x) => x.userId === c.userId)
                      const over = c.inPlayNow > ceiling
                      return (
                        <label key={c.userId}
                          className={`flex items-center gap-2 px-2.5 py-1.5 cursor-pointer ${
                            chosen.has(c.userId) ? 'bg-brand-50/60' : 'hover:bg-slate-50'}`}>
                          <input type="checkbox" className="shrink-0 accent-brand-600"
                            checked={chosen.has(c.userId)} onChange={() => toggle(c.userId)} />
                          <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{c.name}</span>
                          <span className="shrink-0 w-16 text-right text-[11px] text-slate-400">
                            {c.ungraded ? 'Not graded' : c.grade}
                          </span>
                          <span className={`shrink-0 text-[11px] tabular-nums w-20 text-right ${
                            over ? 'text-amber-700' : 'text-slate-500'}`}
                            title={over
                              ? `${c.inPlayNow - ceiling} over their ceiling of ${ceiling}`
                              : `${c.inPlayNow} of ${ceiling} on the book, ${c.capacity} a day`}>
                            {c.inPlayNow}/{ceiling}
                          </span>
                          <span className="shrink-0 w-12 text-right text-[11px] tabular-nums text-slate-400"
                            title={`Works ${c.capacity} accounts a day`}>
                            {c.capacity}
                          </span>
                          {/*
                            THE PLAN'S FIGURE, AND AN ARGUMENT WITH IT. A leader knows things the
                            distributor cannot: the training course, the disciplinary, the
                            resignation on Friday. Their words — "if I think Ayanda shouldn't get
                            19, rather get like 7, because I know something else is happening."

                            Minus and plus set the number for that person; everybody else
                            re-shares what is left, by whatever rule is in force. A figure set by
                            hand is ringed so it never reads as the rule's own, and clicking it
                            hands the row back to the rule.

                            onClick with stopPropagation because the whole row is a <label> for
                            the checkbox — without it, nudging somebody would untick them.
                          */}
                          <span className="shrink-0 flex items-center justify-end gap-0.5 w-[4.75rem]">
                            <Step label={`Give ${c.name} one fewer`}
                              disabled={(taking?.taking ?? 0) <= 0}
                              onClick={() => nudge(c.userId, -1)}>−</Step>
                            <button type="button"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); unpin(c.userId) }}
                              disabled={!taking?.pinned}
                              title={taking?.pinned
                                ? `Set by hand. Tap to let the plan decide ${c.name}’s share again.`
                                : undefined}
                              className={`text-[11px] font-medium tabular-nums px-1 rounded ${
                                taking?.pinned ? 'ring-1 ring-brand-300 bg-brand-50' : ''} ${
                                taking?.pinShort ? 'text-amber-700'
                                  : !taking || taking.taking === 0 ? 'text-slate-300'
                                    : taking.overBy > 0 ? 'text-rose-700' : 'text-brand-700'}`}>
                              {taking && taking.taking > 0 ? `+${taking.taking}` : taking?.pinned ? '0' : '·'}
                            </button>
                            <Step label={`Give ${c.name} one more`}
                              onClick={() => nudge(c.userId, 1)}>+</Step>
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>

                {/*
                  min-w-0 IS THE FIX, and the grid was not. A grid item's min-width defaults to
                  auto, meaning it will not shrink below its content's intrinsic width — and on
                  iOS an input[type=date] has a large one. So the date box overflowed its column
                  and sat under the next field's label, which is what the firm kept seeing and
                  what moving from flex to grid did not touch: w-full sets the width and does
                  nothing about the minimum.

                  Stacked below sm as well. Two columns of a modal on a phone is two columns of
                  nothing.
                */}
                {/*
                  ONE PANEL FOR HOW THE HAND-OUT IS SHAPED, rather than three loose controls with
                  three different spacings between them. The two fields, the rate they imply and
                  the even-split box are one decision and now read as one.

                  Each field is its own column with min-w-0 AND overflow-hidden. The overflow is
                  belt and braces: index.css turns off the native sizing that makes an iOS date
                  input outgrow its column, and this makes the column unable to be overrun even if
                  some future browser finds another way to do it. Three reports of these two boxes
                  sitting on top of each other is enough to stop relying on one mechanism.
                */}
                <div className="rounded-lg border border-slate-200 p-3 space-y-2.5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="min-w-0 overflow-hidden">
                      <span className="block text-xs font-medium text-slate-500 mb-1.5">Starting</span>
                      <input type="date" className={inputClass} value={startOn}
                        onChange={(e) => setStartOn(e.target.value)} />
                    </div>
                    {/*
                      A DROPDOWN, NOT A NUMBER BOX. The firm's report was that it "doesn't work for
                      me" — a spinner is a desktop control, and on an iPad it is a small box you
                      have to summon a keyboard for to change a number you were only ever going to
                      pick from a handful. Every option spells out its own unit, so the label above
                      it does not have to be the long sentence that was colliding with the date.
                    */}
                    <div className="min-w-0 overflow-hidden">
                      <span className="block text-xs font-medium text-slate-500 mb-1.5">Spread over</span>
                      <select className={inputClass} value={windowDays}
                        onChange={(e) => setWindowDays(Number(e.target.value))}>
                        {WINDOW_CHOICES.map((n) => (
                          <option key={n} value={n}>{n === 1 ? '1 working day' : `${n} working days`}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/*
                    THE NUMBER IN ARITHMETIC THE PERSON CAN CHECK. The box used to mean "by when",
                    so five days produced two and the firm asked why; it now means how hard the work
                    is pushed, and the only honest way to say that is to show the rate it implies.
                    The firm's own framing: it shows you the aggression of the allocation, and the
                    thing being traded is room in the diary for whatever is handed out tomorrow.
                  */}
                  <p className="text-[11px] text-slate-500">
                    About <span className="font-medium text-slate-700">{perDay.toLocaleString('en-ZA')} a day</span>{' '}
                    across {windowDays} working {windowDays === 1 ? 'day' : 'days'}.{' '}
                    {windowDays === 1
                      ? 'Everything lands on one day, which leaves no room for tomorrow\u2019s hand-out.'
                      : 'Fewer days fills diaries faster; more days leaves room for the next hand-out.'}
                  </p>

                  {/*
                    OFF BY DEFAULT, and that is a decision rather than a convenience. The ordinary
                    hand-out gives each person a share of the room they have, which protects a book
                    that is nearly full — right for sharing out a handover, and wrong for the job
                    the firm does most. Sharing out a shuffle, they want the split flat: "a hundred
                    accounts over ten users means each one should get ten. Exactly." So it is a
                    choice on the screen rather than an argument in the planner.
                  */}
                  <label className="flex items-start gap-2 cursor-pointer pt-0.5">
                    <input type="checkbox" className="mt-0.5 shrink-0 accent-brand-600"
                      checked={evenSplit} onChange={(e) => setEvenSplit(e.target.checked)} />
                    <span className="text-xs text-slate-600">
                      Distribute the accounts equally
                      <span className="block text-[11px] text-slate-400">
                        Everybody chosen takes the same number, whatever they are already carrying.
                        A book ceiling crossed is shown in red rather than avoided.
                      </span>
                    </span>
                  </label>

                  {/*
                    WHAT THE WORK IS, as against whose it is. Off by default: the usual reason to
                    hand an account out is that it needs working, and then the firm's ladder should
                    decide where it lands — a broken promise belongs above a routine follow-up
                    whoever is holding it. But a hand-out is sometimes only a change of desk, and
                    re-filing every account as the import thinks it should be throws away what the
                    last collector actually found out.
                  */}
                  <label className="flex items-start gap-2 cursor-pointer pt-0.5">
                    <input type="checkbox" className="mt-0.5 shrink-0 accent-brand-600"
                      checked={keepKind} onChange={(e) => setKeepKind(e.target.checked)} />
                    <span className="text-xs text-slate-600">
                      Keep the diary status they already have
                      <span className="block text-[11px] text-slate-400">
                        {keptCount > 0
                          ? `${keptCount.toLocaleString('en-ZA')} of these already sit in a diary and would keep `
                            + 'what they are filed as. The rest are worked out from the account.'
                          : 'None of these are in a diary yet, so every one is worked out from the account.'}
                      </span>
                    </span>
                  </label>
                </div>

                {/*
                  A CHOICE OF TWO, NOT TWO SWITCHES. The firm's rule is that an allocation cannot
                  happen without a referral, though a referral can happen on its own — so
                  "allocate but do not book" is not offered. It was a checkbox here until now, and
                  clearing it produced exactly the state this feature exists to end: an account on
                  somebody's desk with nobody booked to ring it.

                  AND SOMETIMES A CHOICE OF ONE. THE FIRM, on a handover that has just been
                  approved: "there's no option of just referring. It should be allocated and
                  referred."

                  Refer-only leaves ownership alone, which needs there to be an owner. On an
                  account nobody holds it books a diary entry against a book that is not anybody's
                  — the same fault as "allocate but do not book", seen from the other side. So it
                  is offered when these accounts have owners and withheld when they do not, which
                  is a question about the BOOK rather than about where the person came from: a
                  freshly imported batch is the common case and not the rule.
                */}
                <div>
                  <span className="block text-xs font-medium text-slate-500 mb-1.5">What are you doing</span>
                  <div className="grid sm:grid-cols-2 gap-1.5">
                    <ModeCard
                      chosen={mode === 'allocate_and_refer'} onChoose={() => setMode('allocate_and_refer')}
                      label="Allocate and refer"
                      note="The account becomes theirs, and they are booked to work it." />
                    {referOnlyPossible && (
                      <ModeCard
                        chosen={mode === 'refer'} onChoose={() => setMode('refer')}
                        label="Refer only"
                        note="They are booked to work it. Whose account it is does not change." />
                    )}
                  </div>
                  {/*
                    SAID, RATHER THAN A MISSING BUTTON. Somebody who has used this screen before
                    will look for the second card, and a gap where it was is a thing that reads as
                    broken. Named with the number, because "some of these" is not checkable.
                  */}
                  {!referOnlyPossible && unowned !== null && (
                    <p className="text-[11px] text-slate-400 mt-1.5">
                      {unowned === 1
                        ? 'This account is on nobody’s desk, so there is no owner for a referral to leave in place.'
                        : `These ${unowned.toLocaleString('en-ZA')} accounts are on nobody’s desk, so there is no owner for a referral to leave in place.`}
                      {' '}Allocating is what gives them one.
                    </p>
                  )}
                </div>

                {chosen.size === 0
                  ? (
                    <p className="text-sm text-slate-500 bg-slate-50 rounded-lg px-3 py-2.5">
                      Nobody chosen, so there is nothing to plan. Pick at least one collector above.
                    </p>
                  )
                  : plan && <PlanPreview plan={plan} collectors={context.collectors} />}

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
          {/*
            BOTH WARNINGS, NOT WHICHEVER WON. These were a ternary chain, so the book-ceiling
            notice suppressed the one about running past the window — and with the even split on
            somebody is nearly always over a ceiling, which meant the overrun notice was
            effectively never shown. That is how switching from ten working days to four looked
            like a screen that had not noticed: it had, the diaries were full, and the only line
            that would have said so had been crowded out by the other warning.
          */}
          <span className="text-xs text-slate-400">
            {busy
              ? `Booking ${busy.done} of ${busy.total}…`
              : [
                  plan?.ranPastWindow
                    ? `Every diary in those ${plan.windowDays} days is full, so it runs on to ${plan.lastDate}.`
                    : null,
                  overCount > 0
                    ? `${overCount} ${overCount === 1 ? 'person goes' : 'people go'} over their book ceiling. Nothing is blocked.`
                    : null,
                  shortPins.length > 0
                    ? `${shortPins.map((c) => c.name).join(', ')} could not take the number you set — `
                      + 'there were not enough accounts they may be given.'
                    : null,
                ].filter(Boolean).join(' ')}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 px-2">
              Cancel
            </button>
            <button type="button" onClick={() => void commit()}
              disabled={!!busy || !plan || plan.placements.length === 0 || tooMany}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-navy-950 text-white hover:bg-navy-900 disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" />
                : mode === 'refer' ? <CalendarClock size={14} /> : <UserCheck size={14} />}
              {mode === 'refer' ? 'Refer' : 'Allocate and refer'}
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
function PlanPreview({ plan, collectors }: {
  plan: HandOutPlan
  /** Read for what is ALREADY in each diary — see the cells below. */
  collectors: PlannableCollector[]
}) {
  const dates = [...new Set(plan.days.map((d) => d.date))].sort()
  const taking = plan.collectors.filter((c) => c.taking > 0)
  const diaries = useMemo(
    () => new Map(collectors.map((c) => [c.userId, c])), [collectors])

  /*
   * Counted over exactly the cells the table draws, so the sentence under it cannot disagree with
   * what is on screen. A separate pass over plan.days would miss the days this hand-out does not
   * touch — and somebody already over on Thursday is the case a leader most needs counted.
   */
  const overDays = useMemo(() => {
    let n = 0
    for (const c of taking) {
      const desk = diaries.get(c.userId)
      for (const d of dates) {
        const cell = plan.days.find((x) => x.userId === c.userId && x.date === d)
        const capacity = cell?.capacity ?? desk?.capacity ?? 0
        const total = (cell?.existing ?? desk?.bookedByDay[d] ?? 0) + (cell?.added ?? 0)
        if (capacity > 0 && total > capacity) n += 1
      }
    }
    return n
  }, [taking, dates, diaries, plan])

  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <p className="px-3 py-2 text-xs text-slate-600 bg-slate-50 border-b border-slate-100">
        {planSummary(plan)}
      </p>

      {dates.length > 0 && (
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
            {/*
              Hooked so the browser check can count these rows against the sentence above them.
              The summary and the grid are computed from the same plan by two different bits of
              code, and "40 accounts across 9 people" sitting over a grid of three rows is the
              kind of disagreement only a rendered page shows.
            */}
            <tbody data-qa="plan-rows">
              {taking.map((c) => (
                <tr key={c.userId} className="border-b border-slate-50 last:border-0">
                  <td className="px-3 py-1.5 text-slate-700 whitespace-nowrap">
                    {c.name}
                    <span className="text-slate-400"> · {c.grade}</span>
                  </td>
                  {dates.map((d) => {
                    /*
                     * WHAT THEY WILL HAVE THAT DAY, not what they are allowed. The firm's point,
                     * and they are right: "/50" is the same number on every row of every column
                     * and tells you nothing you did not already know. The day's real total does —
                     * one or two red cells is nobody's problem, and a screen full of them says the
                     * pacing is wrong and the window wants widening before anything is written.
                     *
                     * So a cell reads "+3 47": three from this plan, forty-seven in the diary
                     * afterwards. Days this plan does not touch still show what is sitting there,
                     * because a Thursday already at 58 is exactly the thing a leader needs to see
                     * before deciding how hard to push the rest.
                     */
                    const desk = diaries.get(c.userId)
                    const cell = plan.days.find((x) => x.userId === c.userId && x.date === d)
                    const added = cell?.added ?? 0
                    const existing = cell?.existing ?? desk?.bookedByDay[d] ?? 0
                    const capacity = cell?.capacity ?? desk?.capacity ?? 0
                    const total = existing + added
                    if (total === 0) return <td key={d} className="px-2 py-1.5 text-center text-slate-300">·</td>
                    const over = capacity > 0 && total > capacity
                    const full = capacity > 0 && total === capacity
                    return (
                      <td key={d} className={`px-2 py-1.5 text-center tabular-nums whitespace-nowrap ${
                        over ? 'text-rose-700' : full ? 'text-amber-700' : 'text-slate-500'}`}
                        title={`${existing} already booked, ${added} added by this hand-out, `
                          + `${capacity} a day — ${total} on the day`}>
                        {added > 0 && <span className="text-brand-700 font-medium">+{added}</span>}
                        {/*
                          IN BRACKETS, because a bare grey number beside "+2" was read as a second
                          quantity rather than as the result — the firm asked what the small 9 was.
                          "(9)" is the one shape that says "and then there will be nine", and it
                          is the same convention the caption under the table now spells out.

                          ALWAYS, and it was conditional on the day already holding something. The
                          reasoning was that "+1 (1)" prints the same number twice, which is true
                          and was the wrong trade: it made a bare "+1" ambiguous. A leader could
                          not tell an empty diary from a figure the screen had decided not to
                          show, and asked which it was. A column is only scannable while every
                          cell has the same shape; one where the second number comes and goes has
                          to be interpreted, and reading this grid at a glance is its whole job.
                        */}
                        <span className={over || full ? 'font-semibold' : ''}>
                          {added > 0 ? ' ' : ''}({total})
                        </span>
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

      {dates.length > 0 && (
        /*
         * WHAT THE COLOURS MEAN, AND HOW MUCH RED THERE IS. The firm's own reading of this table:
         * one or two over is nobody's problem, but a lot of red means the pacing is wrong and the
         * answer is a wider window, not a different set of people. So it is counted rather than
         * left to be eyeballed across forty rows — and when there is none, the sentence says so
         * plainly instead of leaving a warning shape on a screen where nothing is wrong.
         */
        <p className="px-3 py-1.5 text-[11px] text-slate-400 border-t border-slate-100">
          <span className="text-brand-700 font-medium">+3</span> is what this hand-out books that
          day. <span className="text-slate-500">(9)</span> is what they will have in the diary
          afterwards — so <span className="text-slate-500">(1)</span> means the day was empty, and a
          dot means nothing is booked and nothing is being added.{' '}
          {overDays === 0
            ? 'Nobody goes past their daily limit.'
            : <span className="text-rose-700">
                {overDays === 1
                  ? '1 day goes past somebody’s daily limit'
                  : `${overDays.toLocaleString('en-ZA')} days go past somebody’s daily limit`}
                {' '}— a wider window spreads them out.
              </span>}
        </p>
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

/** Which team somebody is in. The collector list carries no team, so it is read off the people. */
function teamOf(users: User[], userId: string): string | undefined {
  return users.find((u) => u.id === userId)?.teamId
}

/** A quick-pick. Small and chip-shaped, because with five teams these now wrap onto a second row. */
function Pick({ onClick, children, quiet, on }: {
  onClick: () => void; children: React.ReactNode; quiet?: boolean; on?: boolean
}) {
  return (
    <button type="button" onClick={onClick}
      aria-pressed={on}
      className={`text-[11px] rounded-full border px-2 py-0.5 ${
        quiet
          ? 'border-slate-200 text-slate-400 hover:text-slate-600 ml-auto'
          : on
            ? 'border-navy-950 bg-navy-950 text-white'
            : 'border-slate-200 text-slate-600 hover:border-brand-300 hover:text-brand-700'}`}>
      {children}
    </button>
  )
}

/** One nudge on a collector's row. Tiny on purpose: thirty-nine rows of these sit in a modal. */
function Step({ onClick, children, label, disabled }: {
  onClick: () => void; children: React.ReactNode; label: string; disabled?: boolean
}) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled}
      /* The row is a <label>, so a bare click would toggle the checkbox behind this. */
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick() }}
      className="w-4 h-4 leading-none rounded text-[11px] text-slate-400 hover:bg-slate-200
        hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent">
      {children}
    </button>
  )
}

function ModeCard({ chosen, onChoose, label, note }: {
  chosen: boolean; onChoose: () => void; label: string; note: string
}) {
  return (
    <button type="button" onClick={onChoose}
      className={`text-left rounded-lg border px-2.5 py-2 ${
        chosen ? 'border-navy-950 bg-navy-950 text-white' : 'border-slate-200 hover:bg-slate-50'}`}>
      <span className={`block text-sm leading-tight ${chosen ? 'font-medium' : 'text-slate-700'}`}>{label}</span>
      <span className={`block text-[11px] leading-snug ${chosen ? 'text-white/70' : 'text-slate-400'}`}>{note}</span>
    </button>
  )
}
