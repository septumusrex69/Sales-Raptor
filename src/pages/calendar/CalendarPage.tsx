import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { useDefaultOwnerFilter, isAssignableOwner} from '../../lib/permissions'
import { Card } from '../../components/ui/Card'
import { UserAvatar } from '../../components/ui/Avatar'
import { companyById, formatDate, TODAY } from '../../data/mockData'
import { DEAL_CLOSE_EVENT_COLOR, TASK_TYPE_COLORS } from '../../lib/colors'
import { fetchCalendarEvents, type CalendarEvent } from '../../lib/calendarEvents.ts'

/* A meeting is neither a task nor a deal date, so it does not borrow either one's colour. */
const MEETING_EVENT_COLOR = 'var(--c-steel)'
import { buildDrilldownUrl } from '../../lib/drilldown'
import type { Task } from '../../types'

type ViewMode = 'Month' | 'Week' | 'Day'
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface CalEvent {
  id: string
  /** Client/company name — the primary thing shown, per the calendar's whole purpose of surfacing who a day's work is about. */
  primary: string
  /** Task type (e.g. "Follow-up") or "Expected Close" for a deal's close-date marker. */
  type: string
  /** Free-text detail (task title) — only set when distinct from `primary`, so we don't repeat the same string twice on cramped chips. */
  note?: string
  date: Date
  color: string
  ownerId: string
  href: string
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** Local YYYY-MM-DD — deliberately not toISOString(), which shifts to UTC and can land on the wrong day. */
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function tasksUrlForDate(d: Date) {
  return buildDrilldownUrl('/tasks', { date: ymd(d) })
}

export function CalendarPage() {
  const { tasks, deals, users } = useAppStore()
  const { currentUser } = useAuth()
  const reps = useMemo(() => users.filter((u) => isAssignableOwner(u.role)), [users])
  const [owner, setOwner] = useDefaultOwnerFilter(undefined, currentUser)
  const [view, setView] = useState<ViewMode>('Month')
  const [cursor, setCursor] = useState(new Date(TODAY))

  /*
   * MEETINGS, which this page could not show until there was a table to keep them in.
   *
   * Their own fetch rather than AppStore's: a calendar event belongs to ONE person and RLS scopes
   * it to them, where everything in the store is the firm's shared sales data. Loading it through
   * the store would put one person's meetings behind a cache every other page also reads.
   */
  const [meetings, setMeetings] = useState<CalendarEvent[]>([])
  useEffect(() => {
    if (!currentUser) return
    let cancelled = false
    void fetchCalendarEvents(currentUser.id)
      .then((list) => { if (!cancelled) setMeetings(list) })
      .catch(() => { /* a calendar we could not read costs the meetings, not the page. */ })
    return () => { cancelled = true }
  }, [currentUser])

  /*
   * The ones that could not be placed. Same test as the grid uses to place them, so the two
   * cannot disagree about which meetings are missing.
   */
  const undated = useMemo(
    () => meetings.filter((m) => (m.allDay ? m.startsOn : m.startsAt) === null),
    [meetings],
  )

  const events = useMemo<CalEvent[]>(() => {
    const taskEvents = tasks
      .filter((t: Task) => t.status !== 'Cancelled')
      .filter((t) => owner === 'All' || t.ownerId === owner)
      .map((t) => {
        const date = new Date(t.dueDate)
        return {
          id: `t-${t.id}`,
          primary: t.relatedToLabel || t.title,
          type: t.type,
          note: t.relatedToLabel ? t.title : undefined,
          date,
          color: TASK_TYPE_COLORS[t.type] ?? 'var(--c-grey-light)',
          ownerId: t.ownerId,
          href: tasksUrlForDate(date),
        }
      })
    const closeEvents = deals
      .filter((d) => d.stage !== 'Won' && d.stage !== 'Rejected')
      .filter((d) => owner === 'All' || d.ownerId === owner)
      .map((d) => ({
        id: `d-${d.id}`,
        primary: companyById(d.companyId)?.name ?? d.name,
        type: 'Expected Close',
        note: d.name,
        date: new Date(d.expectedCloseDate),
        color: DEAL_CLOSE_EVENT_COLOR,
        ownerId: d.ownerId,
        href: `/deals/${d.id}`,
      }))
    /*
     * An accepted meeting, on the day it is actually on.
     *
     * UNDATED ONES ARE LEFT OFF, not placed at midnight. An invite that named no timezone has no
     * hour anybody can stand behind -- see inviteInstant -- and a meeting shown on the wrong day
     * is worse than one somebody has to open the mail to find.
     */
    const meetingEvents = meetings
      /* Somebody else's meetings are not shown even to a manager: it is a personal calendar. */
      .filter(() => owner === 'All' || owner === currentUser?.id)
      /* flatMap, so an undated meeting is simply absent rather than a null the list has to
         carry and then narrow back out — the narrowing is where the type lies get told. */
      .flatMap((m): CalEvent[] => {
        const when = m.allDay ? m.startsOn : m.startsAt
        if (when === null) return []
        return [{
          id: `m-${m.id}`,
          primary: m.title,
          type: 'Meeting',
          note: m.location ?? undefined,
          date: new Date(when),
          color: MEETING_EVENT_COLOR,
          ownerId: m.ownerId,
          href: '/mail',
        }]
      })

    return [...taskEvents, ...closeEvents, ...meetingEvents]
  }, [tasks, deals, owner, meetings, currentUser])

  function shift(amount: number) {
    const next = new Date(cursor)
    if (view === 'Month') next.setMonth(next.getMonth() + amount)
    else if (view === 'Week') next.setDate(next.getDate() + amount * 7)
    else next.setDate(next.getDate() + amount)
    setCursor(next)
  }

  const title =
    view === 'Month'
      ? cursor.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
      : view === 'Day'
        ? cursor.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
        : `Week of ${formatDate(startOfWeek(cursor).toISOString())}`

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => shift(-1)} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500">
            <ChevronLeft size={16} />
          </button>
          <h2 className="text-base font-semibold text-slate-800 w-64">{title}</h2>
          <button onClick={() => shift(1)} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500">
            <ChevronRight size={16} />
          </button>
          <button onClick={() => setCursor(new Date(TODAY))} className="text-xs font-medium text-brand-600 hover:underline ml-1">
            Today
          </button>
        </div>
        <div className="flex items-center gap-2">
          <select value={owner} onChange={(e) => setOwner(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-600 outline-none">
            <option value="All">All Owners</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <div className="flex items-center bg-slate-100 rounded-lg p-1">
            {(['Day', 'Week', 'Month'] as ViewMode[]).map((v) => (
              <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 text-xs font-medium rounded-md ${view === v ? 'bg-white shadow-sm text-slate-700' : 'text-slate-500'}`}>
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/*
        MEETINGS WITH NO HOUR, SAID OUT LOUD.
        A meeting Raptor could not place has no square to sit in, and it used to be dropped from
        the grid without a word -- so somebody who accepted an invitation, was told the organiser
        had been notified, and then found nothing on their calendar had no way of telling whether
        it had failed or they were looking in the wrong month. It happened for real, to an
        ordinary Outlook invitation whose timezone name Raptor did not recognise. A line is not a
        fix for that, but silence is a lie.
      */}
      {undated.length > 0 && (
        <div className="rounded-lg border border-gold-300 bg-gold-50 px-3 py-2.5">
          <p className="text-xs font-medium text-[var(--c-gold-deep)]">
            {undated.length === 1
              ? 'One accepted meeting has no time Raptor could work out, so it is not on the grid:'
              : `${undated.length} accepted meetings have no time Raptor could work out, so they are not on the grid:`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {undated.map((m) => (
              <li key={m.id} className="text-xs text-slate-700">
                {m.title}
                {m.organiserName && <span className="text-slate-500"> &middot; {m.organiserName}</span>}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-slate-500 mt-1">
            The invitation gave a timezone Raptor could not read. Open the message in Mail to see
            the time the organiser sent.
          </p>
        </div>
      )}

      {view === 'Month' && <MonthView cursor={cursor} events={events} />}
      {view === 'Week' && <WeekView cursor={cursor} events={events} />}
      {view === 'Day' && <DayView cursor={cursor} events={events} />}
    </div>
  )
}

function startOfWeek(d: Date) {
  const x = new Date(d)
  x.setDate(x.getDate() - x.getDay())
  x.setHours(0, 0, 0, 0)
  return x
}

function MonthView({ cursor, events }: { cursor: Date; events: CalEvent[] }) {
  const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const gridStart = startOfWeek(firstOfMonth)
  const days = Array.from({ length: 42 }).map((_, i) => {
    const d = new Date(gridStart)
    d.setDate(d.getDate() + i)
    return d
  })

  return (
    <Card padded={false}>
      <div className="grid grid-cols-7 border-b border-slate-100">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-xs font-medium text-slate-400 text-center py-2.5">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const inMonth = d.getMonth() === cursor.getMonth()
          const isToday = sameDay(d, TODAY)
          const dayEvents = events.filter((e) => sameDay(e.date, d))
          return (
            <div key={i} className={`min-h-[100px] border-b border-r border-slate-50 p-1.5 ${inMonth ? '' : 'bg-slate-50/40'}`}>
              <Link
                to={tasksUrlForDate(d)}
                className={`inline-flex items-center justify-center w-6 h-6 text-xs rounded-full hover:ring-2 hover:ring-brand-200 ${isToday ? 'bg-brand-600 text-white font-semibold' : inMonth ? 'text-slate-600' : 'text-slate-300'}`}
              >
                {d.getDate()}
              </Link>
              <div className="mt-1 space-y-1">
                {dayEvents.slice(0, 3).map((e) => (
                  <Link
                    key={e.id}
                    to={e.href}
                    className="block text-[10px] font-medium px-1.5 py-0.5 rounded truncate hover:brightness-95"
                    style={{ backgroundColor: `${e.color}1a`, color: e.color }}
                    title={`${e.primary} — ${e.type}${e.note ? ` (${e.note})` : ''}`}
                  >
                    {e.primary}
                  </Link>
                ))}
                {dayEvents.length > 3 && <div className="text-[10px] text-slate-400 px-1.5">+{dayEvents.length - 3} more</div>}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function WeekView({ cursor, events }: { cursor: Date; events: CalEvent[] }) {
  const start = startOfWeek(cursor)
  const days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    return d
  })
  return (
    <div className="grid grid-cols-7 gap-3">
      {days.map((d) => {
        const dayEvents = events.filter((e) => sameDay(e.date, d)).sort((a, b) => a.date.getTime() - b.date.getTime())
        const isToday = sameDay(d, TODAY)
        return (
          <Card key={d.toISOString()} padded={false} className={isToday ? 'ring-2 ring-brand-500/40' : ''}>
            <Link to={tasksUrlForDate(d)} className="block px-3 py-2 border-b border-slate-100 text-center hover:bg-slate-50">
              <p className="text-[11px] text-slate-400">{WEEKDAYS[d.getDay()]}</p>
              <p className={`text-sm font-semibold ${isToday ? 'text-brand-600' : 'text-slate-700'}`}>{d.getDate()}</p>
            </Link>
            <div className="p-2 space-y-1.5 min-h-[220px]">
              {dayEvents.map((e) => (
                <Link
                  key={e.id}
                  to={e.href}
                  className="block text-[11px] px-1.5 py-1 rounded hover:brightness-95"
                  style={{ backgroundColor: `${e.color}1a`, color: e.color }}
                  title={`${e.date.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })} · ${e.type}${e.note ? ` · ${e.note}` : ''}`}
                >
                  <span className="font-semibold">{e.primary}</span>
                  <span className="block text-[10px] opacity-80 truncate">
                    {e.date.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })} · {e.type}
                  </span>
                </Link>
              ))}
            </div>
          </Card>
        )
      })}
    </div>
  )
}

function DayView({ cursor, events }: { cursor: Date; events: CalEvent[] }) {
  const dayEvents = events.filter((e) => sameDay(e.date, cursor)).sort((a, b) => a.date.getTime() - b.date.getTime())
  return (
    <Card padded={false}>
      <div className="divide-y divide-slate-50">
        {dayEvents.length === 0 && <p className="text-center text-slate-400 text-sm py-10">No events scheduled for this day.</p>}
        {dayEvents.map((e) => (
          <Link key={e.id} to={e.href} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: e.color }} />
            <span className="text-sm text-slate-500 w-16 shrink-0">{e.date.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-700 truncate">{e.primary}</p>
              <p className="text-xs text-slate-400">
                {e.type}
                {e.note ? ` · ${e.note}` : ''}
              </p>
            </div>
            <UserAvatar userId={e.ownerId} size={24} />
          </Link>
        ))}
      </div>
    </Card>
  )
}
