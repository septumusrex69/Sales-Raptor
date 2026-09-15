import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight,
  ListChecks, Loader2, Play, Users, X,
} from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { useAuth } from '../../store/AuthContext'
import { useAppStore } from '../../store/AppStore'
import { canViewClients } from '../../lib/permissions'
import { longDate, shortDate } from '../../components/diary/DiaryDatePicker'
import { MoveDiaryModal } from '../../components/diary/MoveDiaryModal'
import { CompleteDiaryModal } from '../../components/diary/CompleteDiaryModal'
import {
  countOutOfCirculation, fetchDay, fetchDayLoads, fetchTeamLoad, debtorName,
  type DayLoads, type DayOfWork, type DiaryRow, type AgentLoad,
} from '../../lib/diary.ts'
import {
  DIARY_KINDS, DIARY_ORDER_LABELS, dayLoad, dayLoadSentence, dayName, inMonth, monthGrid,
  nearPrescription, orderDiary, overdueBy, shiftDate, shiftMonth, todayIso,
  type DayLoadLevel, type DiaryOrder,
} from '../../lib/diaryPriority.ts'
import { formatCurrency } from '../../data/mockData'

/**
 * An agent's working day.
 *
 * The shape of this page is an argument about the book it inherits. 279 of the 327 diarised
 * accounts that came across from Swordfish were already overdue, 102 of them by more than six
 * months. Put that in one list with today's work and today's work is never reached; roll it
 * silently forward, as the sales side does with tasks, and the record of what was missed is
 * gone. So: two lists, both visible, neither pretending.
 *
 * WHAT IS DUE TODAY comes first and is short enough to finish. THE BACKLOG sits under it, most
 * urgent first, with a tool to move a pile of it onto real days rather than one entry at a time.
 */

type DiaryTab = 'Today' | 'Backlog' | 'Month' | 'Team'

export function DiaryPage() {
  const { currentUser } = useAuth()
  const { users } = useAppStore()
  const [params, setParams] = useSearchParams()

  /*
   * The LOCAL day, not a UTC timestamp.
   *
   * toISOString() rolls a South African evening into tomorrow: an agent opening the app at ten at
   * night would be shown work that is not due yet, and today's would have vanished.
   */
  const today = todayIso()
  const tab = (params.get('tab') as DiaryTab) ?? 'Today'

  /*
   * WHICH DAY is on screen, which is not always today.
   *
   * The firm asked to be able to work tomorrow's diary once today's is clear, and to look at any
   * other day besides. In the URL so it survives opening an account and coming back, and so a
   * team leader can send somebody a link to a particular day.
   */
  const viewDay = params.get('day') ?? today
  const isToday = viewDay === today
  // A team leader can stand in somebody else's diary. Defaults to your own.
  const viewing = params.get('who') ?? currentUser?.id ?? null
  /*
   * How the agent wants the list ordered.
   *
   * In the URL rather than in state: a collector who has set "promises due first" and opens an
   * account has set it for the day, not for one render, and coming back must not silently put
   * them back on the default.
   */
  const order = (params.get('order') as DiaryOrder) ?? 'urgent'

  const [day, setDay] = useState<DayOfWork | null>(null)
  const [team, setTeam] = useState<AgentLoad[] | null>(null)
  /** Active accounts nobody is booked to ring. The number the circulation rule exists to kill. */
  const [adrift, setAdrift] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [completing, setCompleting] = useState<DiaryRow | null>(null)
  const [moving, setMoving] = useState<DiaryRow[] | null>(null)
  /*
   * Which rows are ticked.
   *
   * Ids rather than rows, so a selection survives the list reloading underneath it — a colleague
   * moving something into your day must not silently change what you thought you had selected.
   * Cleared whenever the day, the owner or the tab changes, because a selection that outlives
   * what you were looking at is how somebody re-diarises the wrong forty accounts.
   */
  const [picked, setPicked] = useState<Set<string>>(new Set())
  /*
   * Selecting is a MODE you enter on purpose, at the firm's instruction.
   *
   * Tick boxes sitting on every row all day is how somebody catches one with a thumb on an iPad
   * and re-diarises an account they never meant to touch. Pressing Select is a small, deliberate
   * "I am about to do something to several of these" — and until then the rows are just rows.
   */
  const [selecting, setSelecting] = useState(false)
  useEffect(() => { setPicked(new Set()); setSelecting(false) }, [viewDay, viewing, tab])

  const owner = users.find((u) => u.id === viewing)
  const isMine = viewing === currentUser?.id

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [d, t, a] = await Promise.all([
        fetchDay({ ownerId: viewing, date: viewDay }),
        fetchTeamLoad(today),
        // A count that fails is not worth an error over a page that otherwise works.
        countOutOfCirculation().catch(() => null),
      ])
      setDay(d); setTeam(t); setAdrift(a)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [viewing, viewDay, today])

  useEffect(() => { void load() }, [load])

  const setParam = useCallback((key: string, value: string | null) => {
    const p = new URLSearchParams(params)
    if (value === null) p.delete(key); else p.set(key, value)
    setParams(p, { replace: true })
  }, [params, setParams])

  const setTab = (next: DiaryTab) => setParam('tab', next)

  /**
   * Move the day on screen — and show that day's work when you get there.
   *
   * THE TAB HAS TO FOLLOW THE DAY. It did not, and the result looked broken: on Backlog, pressing
   * an arrow moved the heading and the four tiles to the 18th while the list underneath carried
   * on showing the backlog, because the backlog is what the Backlog tab renders whatever date is
   * set. Somebody who had just re-diarised three accounts onto the 21st went to look at the 21st
   * and saw overdue work instead.
   *
   * It is not that the backlog ignores the date — "overdue" means before the day being viewed,
   * so it does change. But nobody presses a day to see what was overdue as of that day. They
   * press it to see what they have to work, so that is what it now shows.
   *
   * Both parameters move in one write. Two calls would be two navigations, and the second would
   * be built from a stale copy of the first's search params.
   */
  const goToDay = (date: string) => {
    const p = new URLSearchParams(params)
    if (date === today) p.delete('day'); else p.set('day', date)
    // From anywhere, not only the Backlog: pressing a day means "show me that day".
    p.set('tab', 'Today')
    setParams(p, { replace: true })
  }

  /**
   * The rows actually on screen, in the order asked for.
   *
   * Worked out once rather than in each branch, because "select all" and the bulk bar have to
   * mean exactly what is visible — a selection that quietly included rows below the fold would
   * be the worst possible bug in a tool that moves two hundred records at a time.
   */
  const shown = useMemo(() => {
    if (!day || (tab !== 'Today' && tab !== 'Backlog')) return []
    const source = tab === 'Today' ? day.due : day.overdue
    return orderDiary(
      source.map((r) => ({
        ...r,
        prescriptionOn: r.account.prescriptionDate,
        outstanding: r.account.capitalOutstanding,
      })),
      order, today,
    )
  }, [day, tab, order, today])

  const togglePick = useCallback((id: string) => {
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const pickedRows = useMemo(() => shown.filter((r) => picked.has(r.id)), [shown, picked])

  const todayLoad = useMemo(
    () => dayLoad({ date: viewDay, booked: day?.due.length ?? 0, capacity: owner?.diaryCapacity }),
    [viewDay, day, owner],
  )

  return (
    <div className="space-y-4">
      {/*
        WHICH DAY. Arrows either side, the day named where it has a name, and a way back to today
        that only appears when you are not on it.

        Asked for so an agent who has cleared today can get on with tomorrow rather than waiting
        for it. Working ahead is a good habit and the app should not be the thing that stops it.
      */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => goToDay(shiftDate(viewDay, -1))}
          className="p-2 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
          title="The day before">
          <ChevronLeft size={15} />
        </button>
        <button onClick={() => goToDay(shiftDate(viewDay, 1))}
          className="p-2 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
          title="The day after">
          <ChevronRight size={15} />
        </button>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800">{longDate(viewDay)}</p>
          {dayName(viewDay, today) && (
            <p className="text-[11px] text-slate-400">{dayName(viewDay, today)}</p>
          )}
        </div>
        {!isToday && (
          <button onClick={() => goToDay(today)}
            className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">
            Back to today
          </button>
        )}
      </div>

      {/* The four numbers that decide what the day looks like. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label={isToday ? 'Due today' : `Due ${shortDate(viewDay)}`} value={day ? String(day.due.length) : '—'}
          note={day ? dayLoadSentence(todayLoad) : undefined}
          tone={todayLoad.level === 'over' || todayLoad.level === 'full' ? 'warn' : undefined} />
        {/*
          The oldest by DATE, not the last in the list. The list is ordered by the priority
          ladder, so its last row is the least urgent thing — which is usually not the oldest,
          and reading it as such would have put a comfortable date under an ugly number.
        */}
        <Tile label="Overdue" value={day ? String(day.overdue.length) : '—'}
          note={day?.overdue.length
            ? `oldest ${shortDate(day.overdue.reduce((old, r) => (r.dueOn < old ? r.dueOn : old), day.overdue[0].dueOn))}`
            : 'nothing behind'}
          tone={day && day.overdue.length > 0 ? 'bad' : undefined} />
        <Tile label="Worth working" value={day ? formatCurrency(
          [...day.due, ...day.overdue].reduce((sum, r) => sum + r.account.capitalOutstanding, 0),
        ) : '—'} note="capital on today's list" />
        <PrescribingTile day={day} today={today} />
      </div>

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 p-4 border-b border-slate-100">
          <div className="flex gap-1">
            {(['Today', 'Backlog', 'Month', 'Team'] as DiaryTab[]).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`text-sm font-medium px-3 py-1.5 rounded-lg transition-colors ${
                  tab === t ? 'bg-navy-950 text-white' : 'text-slate-500 hover:bg-slate-100'
                }`}>
                {/*
                  The first tab is the DAY being looked at, so it cannot keep saying "Today" once
                  that day is the 18th — a tab reading Today above a list of Friday's work is the
                  same confusion the arrows caused, one line further down.
                */}
                {t === 'Today' && !isToday ? shortDate(viewDay) : t}
                {t === 'Backlog' && day && day.overdue.length > 0 && (
                  <span className="ml-1.5 text-[11px] opacity-80">{day.overdue.length}</span>
                )}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {/*
            What to look at first.

            Not a filter, at the firm's instruction — nothing is hidden, the same accounts are in
            the same list. The ladder is the right default and the wrong law: a collector with a
            settlement meeting at eleven wants the big balances, one chasing a bad month wants
            every promise that is due, one back from leave wants the oldest thing. See orderDiary.
          */}
          {tab !== 'Team' && (
            <select
              value={order}
              onChange={(e) => {
                const p = new URLSearchParams(params)
                p.set('order', e.target.value)
                setParams(p, { replace: true })
              }}
              className="text-sm rounded-lg border border-slate-200 px-2.5 py-1.5 bg-white max-w-[13rem]"
              title="Reorders the list. Nothing is hidden."
            >
              {DIARY_ORDER_LABELS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          )}

          {/* Standing in someone else's diary. Only offered where there is more than one. */}
          {users.length > 1 && (
            <select
              value={viewing ?? ''}
              onChange={(e) => {
                const p = new URLSearchParams(params)
                if (e.target.value) p.set('who', e.target.value); else p.set('who', '')
                setParams(p, { replace: true })
              }}
              className="text-sm rounded-lg border border-slate-200 px-2.5 py-1.5 bg-white max-w-[14rem]"
            >
              <option value="">Nobody's yet — unassigned</option>
              {users.filter((u) => u.status === 'Active').map((u) => (
                <option key={u.id} value={u.id}>{u.id === currentUser?.id ? `${u.name} (me)` : u.name}</option>
              ))}
            </select>
          )}

          {/*
            Enter and leave selecting. Only where there is something to select — a Select button
            over an empty list is a button that does nothing.
          */}
          {(tab === 'Today' || tab === 'Backlog') && shown.length > 0 && (
            selecting ? (
              <button onClick={() => { setSelecting(false); setPicked(new Set()) }}
                className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                <X size={14} /> Done
              </button>
            ) : (
              <button onClick={() => setSelecting(true)}
                className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                <ListChecks size={14} /> Select
              </button>
            )
          )}

          {/*
            The loop the firm asked for: open the first account, work it, press one button, land
            on the next. Only offered when there is something to work — a button that opens
            nothing teaches people not to trust it.
          */}
          {isMine && day && (day.due.length > 0 || day.overdue.length > 0) && (
            <Link
              to={`/accounts/${(day.due[0] ?? day.overdue[0]).accountId}?diary=${(day.due[0] ?? day.overdue[0]).id}`}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500"
            >
              <Play size={14} />
              Work my diary
            </Link>
          )}
        </div>

        <div className="p-4">
          {error && (
            <p className="flex items-center gap-2 text-sm text-negative-700 mb-3">
              <AlertTriangle size={15} /> {error}
            </p>
          )}
          {loading && <p className="flex items-center gap-2 text-sm text-slate-400 py-8 justify-center">
            <Loader2 size={15} className="animate-spin" /> Reading the diary…
          </p>}

          {/*
            What you do with a handful of ticked accounts.

            Re-diarise and nothing else, deliberately. Marking work DONE in bulk cannot be right:
            every finished entry takes an outcome and a next date, and a button that applied one
            sentence to forty different conversations would produce forty identical, useless
            records — exactly the kind of tidy-looking history that tells a team leader nothing.
            Moving forty accounts to another day is one decision about forty accounts, which is a
            different thing, and it is the one the firm asked for.
          */}
          {!loading && selecting && (
            <div className="flex flex-wrap items-center gap-2 mb-3 rounded-lg bg-navy-950 text-white px-3 py-2.5">
              <button
                onClick={() => setPicked(picked.size === shown.length ? new Set() : new Set(shown.map((r) => r.id)))}
                className="text-sm font-medium underline decoration-slate-500 underline-offset-4 hover:decoration-white">
                {picked.size === shown.length ? 'Clear all' : `Select all ${shown.length}`}
              </button>
              <span className="text-sm">
                {pickedRows.length === 0 ? 'None selected' : `${pickedRows.length} selected`}
              </span>
              {pickedRows.length > 0 && (
                <span className="text-xs text-slate-400">
                  {formatCurrency(pickedRows.reduce((sum, r) => sum + r.account.capitalOutstanding, 0))}
                </span>
              )}
              <div className="flex-1" />
              <button onClick={() => setMoving(pickedRows)} disabled={pickedRows.length === 0}
                className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500 disabled:opacity-40 disabled:hover:bg-gold-400">
                <CalendarClock size={14} /> Re-diarise
              </button>
            </div>
          )}

          {!loading && tab === 'Today' && day && (
            <DiaryList
              rows={shown}
              picked={selecting ? picked : undefined}
              onPick={selecting ? togglePick : undefined}
              today={today}
              empty={day.overdue.length > 0
                ? 'Nothing is due today — but there is a backlog behind you.'
                : 'Nothing is due today.'}
              onComplete={setCompleting}
              onMove={(r) => setMoving([r])}
            />
          )}

          {!loading && tab === 'Backlog' && day && (
            <Backlog
              rows={shown}
              picked={selecting ? picked : undefined}
              onPick={selecting ? togglePick : undefined}
              today={today}
              capacity={owner?.diaryCapacity}
              onComplete={setCompleting}
              onMove={setMoving}
            />
          )}

          {/*
            A month at a glance, with the count on every day. The same question the date picker
            answers when you are booking one account — "how full is that day" — asked about your
            own diary, so you can see where the week is heavy before you get to it.
          */}
          {!loading && tab === 'Month' && (
            <MonthView
              anchor={params.get('month') ?? viewDay}
              onAnchor={(m) => setParam('month', m)}
              ownerId={viewing}
              capacity={owner?.diaryCapacity ?? null}
              today={today}
              selected={viewDay}
              /*
                One call, not two. It was `goToDay(date); setTab('Today')`, and both build a
                URLSearchParams from the same render's `params` — so the second write clobbered
                the day the first had just set, and clicking a day in the month landed you on
                today. goToDay now moves both together.
              */
              onPick={goToDay}
            />
          )}

          {!loading && tab === 'Team' && team && <TeamLoad loads={team} today={today} adrift={adrift} />}
        </div>
      </Card>

      {completing && (
        <CompleteDiaryModal
          entry={completing}
          onClose={() => setCompleting(null)}
          onDone={async () => { setCompleting(null); await load() }}
        />
      )}
      {moving && moving.length > 0 && (
        <MoveDiaryModal
          entries={moving}
          ownerId={viewing}
          capacity={owner?.diaryCapacity ?? null}
          onClose={() => setMoving(null)}
          onDone={async () => {
            setMoving(null)
            // Out of selecting automatically. The firm asked for this in the mailbox and it is
            // the same annoyance here: having done the thing, nobody wants to press Done as well.
            setSelecting(false); setPicked(new Set())
            await load()
          }}
        />
      )}
    </div>
  )
}

/* ---------- the list ---------- */

export function DiaryList({ rows, today, empty, onComplete, onMove, picked, onPick }: {
  rows: DiaryRow[]
  today: string
  empty: string
  onComplete: (row: DiaryRow) => void
  onMove: (row: DiaryRow) => void
  /** Ticked ids. Omit to render a list with no tick boxes at all. */
  picked?: Set<string>
  onPick?: (id: string) => void
}) {
  if (rows.length === 0) {
    return (
      <p className="flex items-center gap-2 justify-center text-sm text-slate-400 py-10">
        <CheckCircle2 size={16} className="text-[var(--c-green)]" /> {empty}
      </p>
    )
  }
  return (
    <div className="@container">
      {/*
        Headings, but only once the row is actually laid out in columns. Below that width the
        row stacks and each value sits next to its own label's worth of context, so a header
        would be pointing at nothing.
      */}
      <div className={`${DIARY_GRID} hidden @3xl:grid pb-1.5 border-b border-slate-100`}>
        <span className={COL_HEAD}>
          {/* Select all — and "all" means exactly what is on screen, nothing below the fold. */}
          {picked && onPick && rows.length > 0 && (
            <input
              type="checkbox"
              checked={rows.every((r) => picked.has(r.id))}
              onChange={() => {
                const allOn = rows.every((r) => picked.has(r.id))
                for (const r of rows) {
                  if (allOn === picked.has(r.id)) onPick(r.id)
                }
              }}
              className="rounded border-slate-300 mr-2 align-middle"
              title={rows.every((r) => picked.has(r.id)) ? 'Clear the selection' : `Select all ${rows.length}`}
            />
          )}
          Account
        </span>
        <span className={COL_HEAD}>Status</span>
        <span className={COL_HEAD}>Client</span>
        <span className={`${COL_HEAD} text-right`}>Outstanding</span>
        <span />
      </div>
      <ul className="divide-y divide-slate-100">
        {rows.map((row) => (
          <DiaryRowItem key={row.id} row={row} today={today} onComplete={onComplete} onMove={onMove}
            picked={picked?.has(row.id)} onPick={onPick && (() => onPick(row.id))} />
        ))}
      </ul>
    </div>
  )
}

/**
 * One grid, shared by the header and every row, so the columns actually line up.
 *
 * Written once as a constant rather than repeated: two copies of a column template drift by a
 * quarter of a rem and the whole list stops reading as a table.
 *
 * Two shapes, and a container query decides which — NOT a window query. This list is full width
 * on the diary page and could sit in a panel half that wide; `@3xl` asks how much room the list
 * itself has, which is the question. Asking the window instead is what put a details grid off
 * the edge of its card twice already in this codebase.
 *
 * Narrow: the account spans the width, then status and client share a line, then the money and
 * the buttons share the next. Wide: five columns, and the empty middle of the row — which the
 * firm pointed at — carries what it was always missing.
 *
 * THE LAST COLUMN IS A FIXED WIDTH, NOT `auto`, and that is not a preference. With `auto` the
 * track is sized by its content, and the header's last cell is empty — so the header's action
 * column collapsed to nothing, its `1fr` grew by the difference, and every heading sat about
 * ten rem to the right of the values underneath it. The firm spotted it immediately. A fixed
 * track means the header and the rows cannot disagree, whatever either happens to contain.
 */
const DIARY_GRID =
  'grid gap-x-3 gap-y-1.5 grid-cols-2 @3xl:grid-cols-[minmax(0,1fr)_9.5rem_11rem_7.5rem_10rem] @3xl:items-center'

const COL_HEAD = 'text-[10px] font-semibold uppercase tracking-wide text-slate-400'

export function DiaryRowItem({ row, today, onComplete, onMove, picked, onPick }: {
  row: DiaryRow
  today: string
  onComplete: (row: DiaryRow) => void
  onMove: (row: DiaryRow) => void
  picked?: boolean
  onPick?: () => void
}) {
  const { companies } = useAppStore()
  const { currentUser } = useAuth()

  const late = overdueBy(row.dueOn, today)
  const prescribing = nearPrescription(row.account.prescriptionDate, today)
  const meta = DIARY_KINDS[row.kind]

  /*
   * Whose book this account came out of.
   *
   * Read from the store rather than fetched with the row — every page already holds the
   * companies, so this costs nothing. It matters in a day list because the same debtor can owe
   * two different clients, and what a collector may say on the phone depends on which one.
   */
  const client = companies.find((c) => c.id === row.account.companyId)
  // The name is shown to everyone; only the LINK is withheld, exactly as the account page does
  // it. A pre-legal agent works debtors, and the client's mandate and rates are not their
  // business — but knowing who they are collecting for is.
  const canOpenClient = canViewClients(currentUser?.role)

  return (
    <li className="py-2.5">
      <div className={DIARY_GRID}>
        {/* The account: who, and why it is back. */}
        <div className="col-span-2 @3xl:col-span-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {onPick && (
              <input type="checkbox" checked={!!picked} onChange={onPick}
                className="rounded border-slate-300 shrink-0"
                title={`Select ${debtorName(row)}`} />
            )}
            <Link to={`/accounts/${row.accountId}?diary=${row.id}`}
              className="font-medium text-sm text-slate-800 hover:text-[var(--c-steel)] truncate">
              {debtorName(row)}
            </Link>
            {prescribing && (
              <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--tint-rust-deep)] text-[var(--c-rust-deep)]"
                title={`Prescribes ${longDate(row.account.prescriptionDate as string)} — after that it cannot be enforced`}>
                prescribing
              </span>
            )}
            {late && (
              <span className="text-[11px] font-medium text-[var(--c-rust)]"
                title={`Was due ${longDate(row.dueOn)}`}>
                {late}
              </span>
            )}
          </div>
          {/*
            Why it is back, in the words of whoever booked it. This is the field the imported
            book does not have, and the reason an agent currently has to read a whole timeline
            before they can pick up the phone.
          */}
          <p className="text-xs text-slate-500 mt-0.5 truncate">
            {row.reason || row.account.mainComment || <span className="text-slate-300">No note about why</span>}
          </p>
        </div>

        {/* Status: what kind of work this is, which is also where it sits on the ladder. */}
        <div className="min-w-0">
          <span className="inline-block max-w-full truncate text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-500"
            title={meta.why}>
            {meta.label}
          </span>
        </div>

        {/* Client. Truncated in the column, whole in the tooltip — a client called "Mzansi
            Micro-Lending (Pty) Ltd" is unreadable at eleven rem and unmistakable on hover. */}
        <div className="min-w-0 text-xs text-slate-500">
          {client
            ? canOpenClient
              ? <Link to={`/companies/${client.id}`} title={client.name}
                  className="hover:text-[var(--c-steel)] hover:underline truncate block">{client.name}</Link>
              : <span title={client.name} className="truncate block">{client.name}</span>
            : <span className="text-slate-300" title="This account is not linked to a client">—</span>}
        </div>

        <div className="text-sm font-medium text-slate-700 tabular-nums @3xl:text-right">
          {formatCurrency(row.account.capitalOutstanding)}
        </div>

        <div className="flex items-center justify-end gap-2">
          <button onClick={() => onMove(row)}
            className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
            title="Move it to another day. The original entry keeps its date and says who moved it.">
            Move
          </button>
          <button onClick={() => onComplete(row)}
            className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
            Done
          </button>
          <Link to={`/accounts/${row.accountId}?diary=${row.id}`}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="Open the account">
            <ChevronRight size={16} />
          </Link>
        </div>
      </div>
    </li>
  )
}

/* ---------- the backlog, and the tool for it ---------- */

function Backlog({ rows, today, capacity, onComplete, onMove, picked, onPick }: {
  rows: DiaryRow[]
  today: string
  capacity: number | null | undefined
  onComplete: (row: DiaryRow) => void
  onMove: (rows: DiaryRow[]) => void
  picked?: Set<string>
  onPick?: (id: string) => void
}) {
  if (rows.length === 0) {
    return (
      <p className="flex items-center gap-2 justify-center text-sm text-slate-400 py-10">
        <CheckCircle2 size={16} className="text-[var(--c-green)]" /> Nothing behind you.
      </p>
    )
  }
  const perDay = capacity && capacity > 0 ? capacity : 30
  const days = Math.ceil(rows.length / perDay)

  return (
    <div>
      {/*
        Says how big the hole is in days rather than only in rows. "214 accounts" is a number;
        "seven working days of work" is a decision about whether one person can clear it or
        whether it has to be shared out.
      */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3 rounded-lg bg-slate-50 px-3 py-2.5">
        <p className="text-sm text-slate-600">
          <span className="font-medium">{rows.length} account{rows.length === 1 ? '' : 's'}</span> behind
          {' '}— about {days} working day{days === 1 ? '' : 's'} at {perDay} a day.
        </p>
        <button onClick={() => onMove(rows)}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
          <CalendarClock size={14} />
          Re-diarise all {rows.length}
        </button>
      </div>
      <DiaryList rows={rows} today={today} empty="" onComplete={onComplete} onMove={(r) => onMove([r])}
        picked={picked} onPick={onPick} />
    </div>
  )
}


/* ---------- a month at a glance ---------- */

const MONTH_LEVEL: Record<DayLoadLevel, string> = {
  free: 'text-slate-700',
  filling: 'text-[var(--c-gold-dark)] bg-[var(--tint-gold)]',
  full: 'text-[var(--c-rust)] bg-[var(--tint-rust)]',
  over: 'text-[var(--c-rust-deep)] bg-[var(--tint-rust-deep)]',
}

/**
 * The month, with a count on every day.
 *
 * The same question the date picker answers while you are booking one account — how full is that
 * day — asked about the whole month, so a heavy week is visible before you walk into it rather
 * than on the morning it arrives. Click a day and it opens.
 *
 * One query for the whole grid, not one per day: forty-two round trips to draw a calendar is how
 * a page comes to take a second to change month.
 */
function MonthView({ anchor, onAnchor, ownerId, capacity, today, selected, onPick }: {
  anchor: string
  onAnchor: (month: string) => void
  ownerId: string | null
  capacity: number | null
  today: string
  selected: string
  onPick: (date: string) => void
}) {
  const [loads, setLoads] = useState<DayLoads | null>(null)
  const [busy, setBusy] = useState(true)

  const days = useMemo(() => monthGrid(anchor), [anchor])

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    fetchDayLoads({ ownerId, from: days[0], to: days[days.length - 1] })
      .then((l) => { if (!cancelled) setLoads(l) })
      // A calendar that cannot count is still a calendar. Better than a page that will not open.
      .catch(() => { if (!cancelled) setLoads(new Map()) })
      .finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [ownerId, days])

  const total = days
    .filter((d) => inMonth(d, anchor))
    .reduce((sum, d) => sum + (loads?.get(d) ?? 0), 0)

  return (
    <div className="@container">
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => onAnchor(shiftMonth(anchor, -1))}
          className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
          title="The month before">
          <ChevronLeft size={15} />
        </button>
        <div className="text-center">
          <p className="text-sm font-semibold text-slate-800">
            {new Intl.DateTimeFormat('en-ZA', { month: 'long', year: 'numeric', timeZone: 'UTC' })
              .format(new Date(`${anchor.slice(0, 7)}-01T00:00:00Z`))}
            {busy && <Loader2 size={12} className="inline ml-2 animate-spin text-slate-400" />}
          </p>
          <p className="text-[11px] text-slate-400">
            {total === 0 ? 'Nothing booked this month' : `${total} account${total === 1 ? '' : 's'} booked`}
          </p>
        </div>
        <button onClick={() => onAnchor(shiftMonth(anchor, 1))}
          className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
          title="The month after">
          <ChevronRight size={15} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <span key={d} className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 text-center">
            {/* One letter on a phone, three where there is room. */}
            <span className="@md:hidden">{d.slice(0, 1)}</span>
            <span className="hidden @md:inline">{d}</span>
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((date) => {
          const booked = loads?.get(date) ?? 0
          const load = dayLoad({ date, booked, capacity })
          const here = inMonth(date, anchor)
          const isToday = date === today

          return (
            <button
              key={date}
              onClick={() => onPick(date)}
              title={`${longDate(date)} — ${dayLoadSentence(load)}`}
              className={[
                'rounded-lg border px-1 py-2 text-center transition-colors min-h-[3.25rem]',
                // Days from the neighbouring months stay visible but recede: they are context,
                // not this month's work.
                here ? 'border-slate-200 hover:border-slate-300' : 'border-transparent opacity-40',
                load.closed ? 'bg-slate-50' : MONTH_LEVEL[load.level],
                date === selected ? 'ring-2 ring-navy-900 ring-offset-1' : '',
              ].join(' ')}
            >
              <span className={`block text-sm leading-none ${isToday ? 'font-bold text-navy-950' : 'font-semibold'}`}>
                {Number(date.slice(8, 10))}
              </span>
              {/*
                The count, and nothing where there is none. A month of zeroes is harder to scan
                than a month with numbers only where the work is.
              */}
              <span className="block text-[11px] leading-none mt-1.5 tabular-nums">
                {booked > 0 ? booked : load.closed ? '' : <span className="text-slate-300">–</span>}
              </span>
            </button>
          )
        })}
      </div>

      <p className="text-[11px] text-slate-400 mt-3">
        Tap a day to work it. Weekends and public holidays are shaded — nobody is at a desk.
      </p>
    </div>
  )
}

/* ---------- who is carrying what ---------- */

function TeamLoad({ loads, today, adrift }: { loads: AgentLoad[]; today: string; adrift: number | null }) {
  return (
    <>
      {/*
        Accounts in NOBODY'S diary — active, collectable, and with nothing booked to ring them.
        This is the audit behind the firm's rule that an account always stays in circulation. The
        finish box now enforces the rule at the moment of closing; a rule with no number behind it
        is one nobody can tell has been followed. It stood at 355 the day the Swordfish book
        landed, and it should trend to nothing.

        Counted rather than prevented, because the database cannot sensibly refuse to leave an
        account un-diarised: an import creates thousands at once, and a write-off legitimately
        empties one.
      */}
      {adrift !== null && adrift > 0 && (
        <p className="rounded-lg bg-[var(--tint-rust)] px-3 py-2.5 mb-3 text-sm text-[var(--c-rust)]">
          <span className="font-medium">
            {adrift >= 2000 ? '2 000+' : adrift} active account{adrift === 1 ? '' : 's'}
          </span>
          {' '}in nobody&rsquo;s diary — nothing is booked to ring them.
        </p>
      )}

      {loads.length === 0
        ? <p className="text-sm text-slate-400 py-10 text-center">Nobody has anything open.</p>
        : <TeamRows loads={loads} today={today} />}
    </>
  )
}

function TeamRows({ loads, today }: { loads: AgentLoad[]; today: string }) {
  const { users } = useAppStore()
  return (
    <ul className="divide-y divide-slate-100 -my-2">
      {loads.map((l) => {
        const person = users.find((u) => u.id === l.ownerId)
        const load = dayLoad({ date: today, booked: l.due, capacity: person?.diaryCapacity })
        return (
          <li key={l.ownerId ?? 'unassigned'} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link to={`/diary?who=${l.ownerId ?? ''}&tab=Backlog`}
              className="font-medium text-sm text-slate-800 hover:text-[var(--c-steel)] min-w-[9rem]">
              {person?.name ?? <span className="text-slate-400 italic">Nobody — unassigned</span>}
            </Link>
            <span className="text-xs text-slate-500">{l.due} due · {dayLoadSentence(load)}</span>
            {l.overdue > 0 && (
              <span className="text-xs font-medium text-[var(--c-rust)]">
                {l.overdue} behind{l.oldest ? `, oldest ${shortDate(l.oldest)}` : ''}
              </span>
            )}
            <div className="flex-1" />
            {l.overdue > 0 && (
              <Link to={`/diary?who=${l.ownerId ?? ''}&tab=Backlog`}
                className="inline-flex items-center gap-1 text-xs font-medium text-[var(--c-steel)] hover:underline">
                <Users size={12} /> Re-diarise
              </Link>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * How many of today's accounts are running out of time.
 *
 * Its own component only so that a zero is not painted amber. A tile that warns when there is
 * nothing to warn about is a tile people stop reading, and this is the one number on the page
 * that has to still mean something in six months.
 */
function PrescribingTile({ day, today }: { day: DayOfWork | null; today: string }) {
  const count = day
    ? [...day.due, ...day.overdue].filter((r) => nearPrescription(r.account.prescriptionDate, today)).length
    : null
  return (
    <Tile label="About to prescribe" value={count === null ? '—' : String(count)}
      note="within 60 days" tone={count ? 'warn' : undefined} />
  )
}

function Tile({ label, value, note, tone }: {
  label: string; value: string; note?: string; tone?: 'warn' | 'bad'
}) {
  return (
    <Card className={tone === 'bad' ? 'border-[var(--c-rust)]/30' : tone === 'warn' ? 'border-[var(--c-gold)]/40' : undefined}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-xl font-semibold mt-1 ${
        tone === 'bad' ? 'text-[var(--c-rust)]' : tone === 'warn' ? 'text-[var(--c-gold-dark)]' : 'text-slate-800'
      }`}>{value}</p>
      {note && <p className="text-[11px] text-slate-400 mt-0.5">{note}</p>}
    </Card>
  )
}
