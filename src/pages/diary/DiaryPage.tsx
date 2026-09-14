import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, Loader2, Play, Users,
} from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { useAuth } from '../../store/AuthContext'
import { useAppStore } from '../../store/AppStore'
import { longDate, shortDate } from '../../components/diary/DiaryDatePicker'
import { MoveDiaryModal } from '../../components/diary/MoveDiaryModal'
import { CompleteDiaryModal } from '../../components/diary/CompleteDiaryModal'
import {
  fetchDay, fetchTeamLoad, debtorName,
  type DayOfWork, type DiaryRow, type AgentLoad,
} from '../../lib/diary.ts'
import {
  DIARY_KINDS, dayLoad, dayLoadSentence, nearPrescription, overdueBy,
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

type DiaryTab = 'Today' | 'Backlog' | 'Team'

export function DiaryPage() {
  const { currentUser } = useAuth()
  const { users } = useAppStore()
  const [params, setParams] = useSearchParams()

  const today = new Date().toISOString().slice(0, 10)
  const tab = (params.get('tab') as DiaryTab) ?? 'Today'
  // A team leader can stand in somebody else's diary. Defaults to your own.
  const viewing = params.get('who') ?? currentUser?.id ?? null

  const [day, setDay] = useState<DayOfWork | null>(null)
  const [team, setTeam] = useState<AgentLoad[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [completing, setCompleting] = useState<DiaryRow | null>(null)
  const [moving, setMoving] = useState<DiaryRow[] | null>(null)

  const owner = users.find((u) => u.id === viewing)
  const isMine = viewing === currentUser?.id

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [d, t] = await Promise.all([
        fetchDay({ ownerId: viewing, date: today }),
        fetchTeamLoad(today),
      ])
      setDay(d); setTeam(t)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [viewing, today])

  useEffect(() => { void load() }, [load])

  const setTab = (next: DiaryTab) => {
    const p = new URLSearchParams(params)
    p.set('tab', next)
    setParams(p, { replace: true })
  }

  const todayLoad = useMemo(
    () => dayLoad({ date: today, booked: day?.due.length ?? 0, capacity: owner?.diaryCapacity }),
    [today, day, owner],
  )

  return (
    <div className="space-y-4">
      {/* The four numbers that decide what the day looks like. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Due today" value={day ? String(day.due.length) : '—'}
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
            {(['Today', 'Backlog', 'Team'] as DiaryTab[]).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`text-sm font-medium px-3 py-1.5 rounded-lg transition-colors ${
                  tab === t ? 'bg-navy-950 text-white' : 'text-slate-500 hover:bg-slate-100'
                }`}>
                {t}
                {t === 'Backlog' && day && day.overdue.length > 0 && (
                  <span className="ml-1.5 text-[11px] opacity-80">{day.overdue.length}</span>
                )}
              </button>
            ))}
          </div>

          <div className="flex-1" />

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

          {!loading && tab === 'Today' && day && (
            <DiaryList
              rows={day.due}
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
              rows={day.overdue}
              today={today}
              capacity={owner?.diaryCapacity}
              onComplete={setCompleting}
              onMove={setMoving}
            />
          )}

          {!loading && tab === 'Team' && team && <TeamLoad loads={team} today={today} />}
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
          onDone={async () => { setMoving(null); await load() }}
        />
      )}
    </div>
  )
}

/* ---------- the list ---------- */

function DiaryList({ rows, today, empty, onComplete, onMove }: {
  rows: DiaryRow[]
  today: string
  empty: string
  onComplete: (row: DiaryRow) => void
  onMove: (row: DiaryRow) => void
}) {
  if (rows.length === 0) {
    return (
      <p className="flex items-center gap-2 justify-center text-sm text-slate-400 py-10">
        <CheckCircle2 size={16} className="text-[var(--c-green)]" /> {empty}
      </p>
    )
  }
  return (
    <ul className="divide-y divide-slate-100 -my-2">
      {rows.map((row) => <DiaryRowItem key={row.id} row={row} today={today} onComplete={onComplete} onMove={onMove} />)}
    </ul>
  )
}

export function DiaryRowItem({ row, today, onComplete, onMove }: {
  row: DiaryRow
  today: string
  onComplete: (row: DiaryRow) => void
  onMove: (row: DiaryRow) => void
}) {
  const late = overdueBy(row.dueOn, today)
  const prescribing = nearPrescription(row.account.prescriptionDate, today)
  const meta = DIARY_KINDS[row.kind]

  return (
    <li className="py-2.5">
      {/*
        A container query, not a window one. This list sits in a card that is full width on the
        diary page and half of it inside a panel, and `sm:` asks about the WINDOW — which is how
        the contact panels on the record pages ended up running off their cards twice.
      */}
      <div className="@container">
        <div className="flex flex-col @md:flex-row @md:items-center gap-2 @md:gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Link to={`/accounts/${row.accountId}?diary=${row.id}`}
                className="font-medium text-sm text-slate-800 hover:text-[var(--c-steel)] truncate">
                {debtorName(row)}
              </Link>
              <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-500"
                title={meta.why}>
                {meta.label}
              </span>
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

          <div className="flex items-center gap-2 @md:gap-3 shrink-0">
            <span className="text-sm font-medium text-slate-700 tabular-nums">
              {formatCurrency(row.account.capitalOutstanding)}
            </span>
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
      </div>
    </li>
  )
}

/* ---------- the backlog, and the tool for it ---------- */

function Backlog({ rows, today, capacity, onComplete, onMove }: {
  rows: DiaryRow[]
  today: string
  capacity: number | null | undefined
  onComplete: (row: DiaryRow) => void
  onMove: (rows: DiaryRow[]) => void
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
      <DiaryList rows={rows} today={today} empty="" onComplete={onComplete} onMove={(r) => onMove([r])} />
    </div>
  )
}

/* ---------- who is carrying what ---------- */

function TeamLoad({ loads, today }: { loads: AgentLoad[]; today: string }) {
  const { users } = useAppStore()
  if (loads.length === 0) {
    return <p className="text-sm text-slate-400 py-10 text-center">Nobody has anything open.</p>
  }
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
