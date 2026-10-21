import { useEffect, useMemo, useState } from 'react'
import {
  CalendarClock, CalendarDays, MapPin, MessageSquare, Plus, Search, Users, Video,
} from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { Card } from '../../components/ui/Card'
import { PriorityBadge, TaskStatusBadge } from '../../components/ui/Badge'
import { UserAvatar } from '../../components/ui/Avatar'
import { Modal, FormField, inputClass } from '../../components/ui/Modal'
import { RescheduleTaskModal } from '../../components/ui/RescheduleTaskModal'
import { formatDate, TODAY } from '../../data/mockData'
import { readParam } from '../../lib/drilldown'
import { fetchCalendarEvents, type CalendarEvent } from '../../lib/calendarEvents.ts'
import {
  dayCounts, dayHeadline, joinLink, localDay, meetingTime, meetingWith, planDay,
  prepareOn, prepareTitle, shiftDay,
  taskTime, weekStrip, type DayTicket,
} from '../../lib/dayPlan.ts'
import { fetchOpenQueries } from '../../lib/accountQueries.ts'
import { TaskDayPicker } from '../../components/tasks/TaskDayPicker'
import type { Task, TaskPriority, TaskType, User } from '../../types'
import { isAssignableOwner } from '../../lib/permissions'
import { clockNow } from '../../lib/clock.ts'

/*
 * THE FIRM: "I think it's important to see next week as well."
 *
 * AND BOTH WEEKS ARE NOW CALENDAR WEEKS, Monday to Sunday, which is a change to what "This Week"
 * meant. It was a ROLLING SEVEN DAYS from today -- so on a Thursday it reached into the middle of
 * next week, and the two buttons would have overlapped by three days with no way to tell which
 * one a task on Tuesday belonged to. A week the firm can name is the only kind two buttons can
 * divide. It covers the whole week including the days already gone: a task missed on Monday is
 * part of this week, and Overdue is the view for reading it as a miss.
 */
const VIEWS = ['My Tasks', 'Team Tasks', 'Overdue', 'Today', 'Tomorrow', 'This Week', 'Next Week', 'Completed'] as const
type View = (typeof VIEWS)[number]

function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function formatLongDate(dateParam: string) {
  return new Date(`${dateParam}T00:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })
}

export function TasksPage() {
  const { tasks, users, companies, updateTask, addTask } = useAppStore()
  const { currentUser } = useAuth()
  const reps = useMemo(() => users.filter((u) => isAssignableOwner(u.role)), [users])
  /* THE CLIENTS A TASK CAN BE ABOUT, by name, so a picker reads as a list of clients rather than
     a list of ids. Sorted, because a select nobody can find a name in twice is a select nobody
     uses. */
  const companyOptions = useMemo(
    () => companies.map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)),
    [companies],
  )
  const [searchParams, setSearchParams] = useSearchParams()
  const [view, setView] = useState<View>(() => {
    const fromUrl = readParam(searchParams, 'view')
    return (VIEWS as readonly string[]).includes(fromUrl ?? '') ? (fromUrl as View) : 'My Tasks'
  })
  const [dateFilter, setDateFilter] = useState<string | undefined>(() => readParam(searchParams, 'date'))
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  /*
   * THE DAY'S MEETINGS, fetched here rather than taken from AppStore.
   *
   * A calendar event belongs to ONE person and RLS scopes it to them, where everything in the
   * store is the firm's shared sales data -- CalendarPage says the same and for the same reason.
   * A calendar that will not load costs the meetings, not the page.
   */
  const [meetings, setMeetings] = useState<CalendarEvent[]>([])
  useEffect(() => {
    if (!currentUser) return
    let cancelled = false
    void fetchCalendarEvents(currentUser.id)
      .then((list) => { if (!cancelled) setMeetings(list) })
      .catch(() => { /* the work still shows. */ })
    return () => { cancelled = true }
  }, [currentUser])
  const [rescheduleTask, setRescheduleTask] = useState<Task | null>(null)
  const [editTask, setEditTask] = useState<Task | null>(null)
  const [cancelTask, setCancelTask] = useState<Task | null>(null)

  const today = startOfDay(TODAY)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  /*
   * THE TWO WEEKS, AS SETS OF DAYS.
   *
   * MEMBERSHIP OF A SET OF 'YYYY-MM-DD', not a pair of timestamps to compare against. A task's
   * dueDate carries an hour, so a >= / <= range has to get the boundary instants exactly right at
   * both ends and gets them wrong the first time somebody books a task for five in the afternoon
   * on the Sunday. weekStrip is the same Monday-first week the day pickers draw.
   */
  const thisWeek = useMemo(() => new Set(weekStrip(localDay(today), 1)), [today])
  const nextWeek = useMemo(
    () => new Set(weekStrip(shiftDay(localDay(today), 7), 1)),
    [today],
  )
  /* The day picker on the list, open or shut. Shut by default: the views answer most questions and
     a calendar permanently above the table is a calendar, which is the other page. */
  const [pickDay, setPickDay] = useState(false)

  // Every view except the explicit "Team Tasks" escape hatch is scoped to
  // the logged-in rep's own tasks — Administrators/Sales Managers keep
  // seeing everyone everywhere, matching how Dashboard/Leads/Deals/
  // Contacts/Calendar already default. currentUser is briefly null right
  // after sign-in (the profile loads asynchronously), so this is computed
  // fresh each render rather than cached in state — it naturally narrows
  // the instant the profile arrives, with no stale-default risk.
  const scopeToSelf = !!currentUser && currentUser.role !== 'Administrator' && currentUser.role !== 'Sales Manager'
  const scopedTasks = useMemo(() => (scopeToSelf ? tasks.filter((t) => t.ownerId === currentUser?.id) : tasks), [tasks, scopeToSelf, currentUser])

  const filtered = useMemo(() => {
    let list = [...scopedTasks]
    if (dateFilter) {
      // Matches exactly what Calendar shows for this day (same status
      // exclusion), so clicking through gives a consistent picture.
      list = list.filter((t) => t.status !== 'Cancelled' && localDay(new Date(t.dueDate)) === dateFilter)
    } else {
      switch (view) {
        case 'My Tasks':
          list = list.filter((t) => t.ownerId === currentUser?.id && t.status !== 'Completed' && t.status !== 'Cancelled')
          break
        case 'Team Tasks':
          list = tasks.filter((t) => t.status !== 'Completed' && t.status !== 'Cancelled')
          break
        case 'Overdue':
          list = list.filter((t) => new Date(t.dueDate) < today && t.status !== 'Completed' && t.status !== 'Cancelled')
          break
        case 'Today':
          list = list.filter((t) => startOfDay(new Date(t.dueDate)).getTime() === today.getTime())
          break
        case 'Tomorrow':
          list = list.filter((t) => startOfDay(new Date(t.dueDate)).getTime() === tomorrow.getTime())
          break
        case 'This Week':
          list = list.filter((t) => thisWeek.has(localDay(new Date(t.dueDate))))
          break
        case 'Next Week':
          list = list.filter((t) => nextWeek.has(localDay(new Date(t.dueDate))))
          break
        case 'Completed':
          list = list.filter((t) => t.status === 'Completed')
          break
      }
    }
    if (search) {
      const q = search.toLowerCase()
      list = list.filter((t) => t.title.toLowerCase().includes(q) || (t.relatedToLabel ?? '').toLowerCase().includes(q))
    }
    return list.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
  }, [scopedTasks, tasks, view, dateFilter, search, today, tomorrow, thisWeek, nextWeek, currentUser])

  /*
   * WHICH ONE DAY THIS PAGE IS ABOUT, or null where it is about a range.
   *
   * Meetings are shown only where the answer is a single day. A week of tasks with meetings
   * threaded through it is a calendar, and there is already a calendar; what the firm asked for
   * is the other direction -- "what do you need to do for the day" -- which is a question about
   * one square.
   */
  const dayShown = dateFilter
    ?? (view === 'Today' ? localDay(today)
      : view === 'Tomorrow' ? localDay(tomorrow)
        : null)

  /*
   * THE DAY, ASSEMBLED IN ONE PLACE. planDay is the only thing that decides what a day holds --
   * see dayPlan.ts on why a meeting stays in calendar_events and is merged at the read instead of
   * being copied into `tasks`.
   */
  /*
   * THE THIRD THING A DAY IS MADE OF, AND THE ONE THAT WAS MISSING.
   *
   * THE FIRM ASKED FOR THE LIAISON'S DAY -- meetings, tasks AND tickets. A client liaison's work
   * is mostly tickets: a dispute to answer, a client to chase, a request to put. This page showed
   * them meetings and tasks only, so the one place they could see their work was a board they had
   * to go and look at, and their day said they had nothing on.
   *
   * THEIR OWN, AND OPEN. fetchOpenQueries returns the whole queue -- it is what the board is drawn
   * from -- and the day is one person's: a ticket on somebody else's desk is not on your Tuesday.
   * dayPlan then keeps only the ones with a chase date landing on the day.
   *
   * NOT COPIED INTO `tasks`. The rule a meeting already follows, for the reason written out at
   * length in dayPlan.ts: two things to complete for one obligation, and nothing keeps them in
   * step.
   */
  const [tickets, setTickets] = useState<DayTicket[]>([])
  useEffect(() => {
    let cancelled = false
    void fetchOpenQueries()
      .then((rows) => {
        if (cancelled) return
        setTickets(rows.map((r) => ({
          id: r.id,
          description: r.description,
          kind: r.kind,
          chaseOn: r.chaseOn,
          status: r.status,
          ownerId: r.ownerId,
          accountId: r.accountId,
          debtorName: r.debtorName,
        })))
      })
      /* A QUEUE THAT WILL NOT LOAD COSTS THE TICKETS, not the day. The meetings and the tasks are
         on the screen and are what most people open this page for. */
      .catch(() => { if (!cancelled) setTickets([]) })
    return () => { cancelled = true }
  }, [])

  const myTickets = useMemo(
    () => tickets.filter((t) => t.ownerId === currentUser?.id),
    [tickets, currentUser?.id],
  )

  const plan = useMemo(
    () => (dayShown
      ? planDay({ day: dayShown, meetings, tasks: scopedTasks, tickets: myTickets })
      : null),
    [dayShown, meetings, scopedTasks, myTickets],
  )

  function selectView(v: View) {
    setView(v)
    setDateFilter(undefined)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('date')
      next.set('view', v)
      return next
    })
  }

  /* THE DAY GOES IN THE URL, like the one the calendar links to. Same parameter, so a day chosen
     here and a day arrived at from a calendar square are the same state -- and the back button
     works, which is what somebody expects after pressing into a day. */
  function setDay(day: string) {
    setDateFilter(day)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('date', day)
      return next
    })
  }

  function clearDateFilter() {
    setDateFilter(undefined)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('date')
      return next
    })
  }

  /*
   * HOW FULL EACH DAY ALREADY IS, for whichever day picker is open.
   *
   * ONE CALCULATION FOR BOTH PICKERS and for the day headline, because they are answering the same
   * question -- dayPlan.dayCounts walks the two lists once. The meetings are the signed-in
   * person's: a calendar event belongs to one person and RLS scopes it to them, which is why
   * giving a task to somebody else shows their tasks with a note saying so.
   */
  const myCounts = useMemo(
    () => dayCounts({
      meetings,
      tasks: scopedTasks.filter((t) => t.ownerId === currentUser?.id),
      /* THE SAME THREE LISTS THE DAY ITSELF IS DRAWN FROM, or the number under the 8th is not the
         number of rows the 8th shows -- which is the drift dayPlan exists to prevent. */
      tickets: myTickets,
    }),
    [meetings, scopedTasks, currentUser, myTickets],
  )

  const counts = useMemo(() => {
    const overdue = scopedTasks.filter((t) => new Date(t.dueDate) < today && t.status !== 'Completed' && t.status !== 'Cancelled').length
    const dueToday = scopedTasks.filter((t) => startOfDay(new Date(t.dueDate)).getTime() === today.getTime() && t.status !== 'Completed').length
    const open = scopedTasks.filter((t) => t.status !== 'Completed' && t.status !== 'Cancelled').length
    const completed = scopedTasks.filter((t) => t.status === 'Completed').length
    return { overdue, dueToday, open, completed }
  }, [scopedTasks, today])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-xs text-slate-400">Overdue</p>
          <p className="text-xl font-bold text-[var(--c-rust-deep)] mt-1">{counts.overdue}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-400">Due Today</p>
          <p className="text-xl font-bold text-slate-800 mt-1">{counts.dueToday}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-400">Open Tasks</p>
          <p className="text-xl font-bold text-slate-800 mt-1">{counts.open}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-400">Completed</p>
          <p className="text-xl font-bold text-[var(--c-green)] mt-1">{counts.completed}</p>
        </Card>
      </div>

      {dateFilter ? (
        <div className="flex flex-wrap items-center gap-2.5">
          {/* The same control that chose the day, so a wrong day is one press from the right one
              rather than a clear-and-start-again. */}
          <button onClick={() => setPickDay((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg
              border border-slate-200 text-slate-600 hover:bg-slate-50">
            <CalendarDays size={13} /> Another day
          </button>
          {/* THE DAY, AND WHAT IS IN IT. "Tasks — 14 October" named the filter; the firm asked
              what you need to DO that day, and the count of meetings beside the count of tasks is
              the one glance that answers it. */}
          <h2 className="text-sm font-semibold text-slate-700">{formatLongDate(dateFilter)}</h2>
          {plan && <span className="text-xs text-slate-400">{dayHeadline(plan)}</span>}
          <button onClick={clearDateFilter} className="text-xs font-medium text-brand-600 hover:underline">
            Clear date filter
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {VIEWS.map((v) => (
            <button
              key={v}
              onClick={() => selectView(v)}
              className={`text-sm font-medium px-3 py-1.5 rounded-lg ${view === v ? 'bg-brand-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              {v}
            </button>
          ))}
          {/*
            A DAY OF THEIR OWN CHOOSING.

            THE FIRM: "in the tasks, maybe I should like be able to search for a specific day for
            my tasks." Seven named views cover the week either side of today and nothing else --
            the 14th of next month was reachable only by going to the calendar, finding the square
            and clicking it, which is a long way round to a list this page already draws.
          */}
          <button onClick={() => setPickDay((v) => !v)}
            className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg
              ${pickDay ? 'bg-slate-700 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            <CalendarDays size={14} /> A day
          </button>
        </div>
      )}

      {/*
        AND THE PICKER ITSELF, WITH THE COUNTS ON IT.

        `allowPast`, which is the one way this differs from the box that books a task: looking back
        at last Tuesday is most of what a day filter is for, and booking onto it is not possible.
      */}
      {pickDay && (
        <Card className="p-4">
          <TaskDayPicker
            value={dateFilter ?? ''}
            onChange={(day) => { setDay(day); setPickDay(false) }}
            counts={myCounts}
            today={localDay(today)}
            allowPast
          />
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 w-64">
          <Search size={15} className="text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks..." className="text-sm outline-none flex-1 min-w-0" />
        </div>
        {/* "1 tasks" was on this screen every time a day held one. The firm's words are the firm's
            words even in a count. */}
        <span className="text-xs text-slate-400">
          {filtered.length === 1 ? '1 task' : `${filtered.length} tasks`}
        </span>
        <button onClick={() => setAddOpen(true)} className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
          <Plus size={15} /> Add Task
        </button>
      </div>

      {/*
        MEETINGS FIRST, BECAUSE THEY ARE THE PART OF THE DAY ALREADY SPENT.
        
        THE FIRM, after a client's Teams invitation reached the calendar and nothing else: "it
        added it to my calendar, but it didn't add it to my tasks. I think it should add it to the
        task as well."
        
        IT IS NOT A TASK AND IT IS NOT TICKABLE -- there is no checkbox on these rows. A meeting is
        over when the hour has passed, not when somebody says so, and dayPlan.ts explains at length
        why it stays in its own table rather than being copied into `tasks`. What it does have is a
        way back to the event, because the thing you want at nine in the morning is the dial-in.
        
        ABSENT RATHER THAN EMPTY on a day with none: a card headed "Meetings" over a line saying
        "none" is a row of furniture, and CLAUDE.md is clear that something which fires when
        nothing is wrong teaches people to stop reading.
      */}
      {plan && plan.meetings.length > 0 && (
        <Card padded={false}>
          <div className="px-5 py-2.5 border-b border-slate-100 flex items-center gap-2">
            <CalendarClock size={14} className="text-[var(--c-steel)]" />
            <span className="text-xs font-medium text-slate-500">
              {plan.meetings.length === 1 ? 'Meeting' : 'Meetings'} — where you have to be
            </span>
          </div>
          {/* Every list on this page is one line a row at 12.5px -- the checking list's density,
              which the firm asked for on every list in the app. What used to be a second line
              under each title now rides after it in grey. */}
          <div>
            {plan.meetings.map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-3 py-1.5 text-[12.5px] whitespace-nowrap border-b border-slate-50 last:border-0 hover:bg-slate-50">
                {/* The clock in its own column so the eye runs down the times, and a whole-day
                    event says so rather than showing a 00:00 nobody meant. */}
                <span className="w-14 shrink-0 font-semibold tabular-nums text-slate-600">
                  {meetingTime(m) ?? 'All day'}
                </span>
                <div className="min-w-0 flex-1 flex items-center gap-2">
                  <span className="font-medium text-slate-700 truncate min-w-0" title={m.title}>{m.title}</span>
                  {/* WHO IT IS WITH, FIRST. The firm's point on the calendar is the same here: a
                      subject names the subject, and what you want at nine in the morning is who
                      you are sitting with. */}
                  <span className="text-slate-400 flex items-center gap-2 min-w-0">
                    {meetingWith(m, [currentUser?.email ?? '']) && (
                      <span className="truncate">with {meetingWith(m, [currentUser?.email ?? ''])}</span>
                    )}
                    {m.location && (
                      <span className="inline-flex items-center gap-1 truncate" title={m.location}>
                        <MapPin size={11} className="shrink-0" /> {m.location}
                      </span>
                    )}
                    {m.attendees.length > 0 && (
                      <span className="inline-flex items-center gap-1 shrink-0">
                        <Users size={11} /> {m.attendees.length}
                      </span>
                    )}
                  </span>
                </div>
                {/*
                  JOIN, STRAIGHT OFF THE DAY'S LIST. THE FIRM: "if the link is pulled in there into
                  the task, that'd be cool." This page is what somebody has open at nine in the
                  morning, and making them go to the calendar, find the meeting and open it to
                  reach a URL that was in the invitation all along is three presses too many.
                */}
                {joinLink(m.notes, m.location) && (
                  <a href={joinLink(m.notes, m.location) as string}
                    target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1
                      rounded-md border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500 shrink-0">
                    <Video size={12} /> Join
                  </a>
                )}
                {/*
                  A MEETING CAN RAISE THE WORK IT NEEDS DOING BEFORE IT.

                  Offered on the day's list rather than inside the calendar, because this is the
                  page somebody has open when they look at tomorrow and think "I need the figures
                  for that". A preparation task raised from the calendar is one more screen away
                  from the moment the thought happens.

                  DATED THE WORKING DAY BEFORE, not "tomorrow minus one" -- see prepareOn. A
                  Monday meeting prepared on Sunday is a task nobody sees.
                */}
                <button type="button"
                  onClick={() => {
                    addTask({
                      title: prepareTitle(m.title),
                      dueDate: prepareOn(dayShown ?? localDay(clockNow()), localDay(clockNow())),
                      /* "Research" is the firm's own word for reading up before something. There
                         is no 'Preparation' in TaskType and adding one for this would be a tenth
                         word for a thing the list already has. */
                      type: 'Research',
                      /* WHOSE MEETING IT IS. A preparation task belongs to the person who has to
                         walk into the room, which on this page is always the signed-in user --
                         the calendar shown here is their own. */
                      ownerId: currentUser?.id,
                    })
                  }}
                  className="text-xs font-medium text-slate-500 hover:text-slate-800 hover:underline shrink-0">
                  Prepare
                </button>
                <Link to="/calendar" className="text-xs font-medium text-brand-600 hover:underline shrink-0">
                  Open
                </Link>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/*
        THE TICKETS DUE TO BE COME BACK TO TODAY.

        AFTER THE MEETINGS AND BEFORE THE TASKS, which is the order of how much of the day is
        already spoken for: a meeting is an hour you have given away, a ticket is a conversation
        somebody else is waiting on, and a task is your own.

        ABSENT RATHER THAN EMPTY, like the meetings card above and for the same reason -- a card
        headed "Tickets" over a line saying none is furniture.

        AND IT LINKS TO THE TICKET, not to the account: the ticket is where the work is done, which
        is what the ticket screen was built for.
      */}
      {plan && plan.tickets.length > 0 && (
        <Card padded={false}>
          <div className="px-5 py-2.5 border-b border-slate-100 flex items-center gap-2">
            <MessageSquare size={14} className="text-[var(--c-steel)]" />
            <span className="text-xs font-medium text-slate-500">
              {plan.tickets.length === 1 ? 'Ticket' : 'Tickets'} — what somebody is waiting on
            </span>
          </div>
          <div>
            {plan.tickets.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-3 py-1.5 text-[12.5px] whitespace-nowrap border-b border-slate-50 last:border-0 hover:bg-slate-50">
                {/* WHAT KIND, in its own column so the eye can skip the disputes -- they are the
                    ones with a clock on them. */}
                <span className="w-20 shrink-0 text-[11px] font-semibold uppercase tracking-wide
                  text-slate-400">
                  {t.kind === 'dispute' ? 'Dispute' : t.kind === 'request' ? 'Request' : 'Help'}
                </span>
                <span className="min-w-0 flex-1 truncate" title={t.debtorName ? `${t.description} · ${t.debtorName}` : t.description}>
                  <span className="font-medium text-slate-700">{t.description}</span>
                  {t.debtorName && <span className="text-slate-400"> · {t.debtorName}</span>}
                </span>
                <Link to={`/queries/${t.id}`}
                  className="text-xs font-medium text-brand-600 hover:underline shrink-0">
                  Open
                </Link>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card padded={false}>
        <div>
          {filtered.map((t) => {
            const overdue = new Date(t.dueDate) < today && t.status !== 'Completed' && t.status !== 'Cancelled'
            return (
              <div key={t.id} className="flex items-center gap-3 px-3 py-1.5 text-[12.5px] whitespace-nowrap border-b border-slate-50 last:border-0 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={t.status === 'Completed'}
                  onChange={(e) => updateTask(t.id, { status: e.target.checked ? 'Completed' : 'Not Started', completedAt: e.target.checked ? clockNow().toISOString() : undefined })}
                  className="w-3.5 h-3.5 accent-brand-600 shrink-0"
                />
                <div className="min-w-0 flex-1 flex items-center gap-1.5">
                  <span className={`font-medium truncate min-w-0 ${t.status === 'Completed' ? 'text-slate-400 line-through' : 'text-slate-700'}`} title={t.title}>
                    {t.title}
                  </span>
                  {t.autoRescheduledFrom && t.status !== 'Completed' && (
                    <span
                      title={`Originally due ${formatDate(t.autoRescheduledFrom)} — missed and auto-moved to today`}
                      className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--c-gold)] bg-[var(--tint-gold)] px-1.5 py-0.5 rounded normal-case"
                    >
                      Auto-moved from {formatDate(t.autoRescheduledFrom)}
                    </span>
                  )}
                  <span className="text-slate-400 truncate min-w-0" title={t.relatedToLabel}>
                    · {t.type} {t.relatedToLabel ? `· ${t.relatedToLabel}` : ''}
                  </span>
                </div>
                <PriorityBadge priority={t.priority} />
                <TaskStatusBadge status={t.status} />
                {/*
                  THE TIME, WHERE SOMEBODY SET ONE. It has been on every task all along -- dueDate
                  is a full timestamp -- and was shown nowhere, so a task booked for a nine
                  o'clock call read the same as one due sometime that week.
                  
                  AND "ANY TIME" WHERE THEY DID NOT, said out loud rather than left blank: on a
                  day's list a missing time next to three timed ones reads as something that
                  failed to load. See dayPlan.taskTime for how a task with no time is told apart.
                */}
                <span className={`font-medium w-24 text-right tabular-nums shrink-0 ${overdue ? 'text-[var(--c-rust-deep)]' : 'text-slate-500'}`}>
                  {dayShown
                    ? (taskTime(t) ?? <span className="text-slate-300">Any time</span>)
                    : formatDate(t.dueDate)}
                </span>
                <UserAvatar userId={t.ownerId} size={18} />
                {/*
                  EDIT, RESCHEDULE, CANCEL. THE FIRM: "you should also be able to edit a task, the
                  name of the task, and also cancel a task -- the cancel reason."

                  Reschedule stays its own button rather than folding into Edit: moving a date is
                  the thing that happens fifty times a day, and burying it inside a form with six
                  fields would make the common case the slow one.

                  CANCEL IS ABSENT ON ONE ALREADY FINISHED. There is nothing to call off, and a
                  button that refuses is worse than one that is not there.
                */}
                <button onClick={() => setEditTask(t)} className="text-xs font-medium text-brand-600 hover:underline shrink-0">
                  Edit
                </button>
                <button onClick={() => setRescheduleTask(t)} className="text-xs font-medium text-brand-600 hover:underline shrink-0">
                  Reschedule
                </button>
                {t.status !== 'Completed' && t.status !== 'Cancelled' && (
                  <button onClick={() => setCancelTask(t)}
                    className="text-xs font-medium text-slate-400 hover:text-[var(--c-rust-deep)] shrink-0">
                    Cancel
                  </button>
                )}
              </div>
            )
          })}
          {filtered.length === 0 && <p className="text-center text-slate-400 text-sm py-10">No tasks in this view.</p>}
        </div>
      </Card>

      {(addOpen || editTask) && (
        <TaskModal
          reps={reps}
          companies={companyOptions}
          defaultOwnerId={currentUser?.id ?? ''}
          /*
            THE WHOLE STORE, NOT THE SCOPED LIST. The box can give a task to somebody else, and
            what that person's day already holds is the figure the firm asked to see -- a count
            drawn from the signed-in person's own tasks would describe the wrong day entirely.
          */
          allTasks={tasks}
          meetings={meetings}
          currentUserId={currentUser?.id ?? ''}
          today={localDay(today)}
          editing={editTask ?? undefined}
          onClose={() => { setAddOpen(false); setEditTask(null) }}
          onSave={(input) => {
            if (editTask) updateTask(editTask.id, input)
            else addTask(input)
          }}
        />
      )}
      {/*
        CANCELLING ASKS WHY, and the answer goes on the client's file.

        THE FIRM: "you should also be able to cancel a task -- the cancel reason... the client has
        cancelled the meeting, and then it will also be on the notes of the client."
      */}
      {cancelTask && (
        <CancelTaskModal
          task={cancelTask}
          onClose={() => setCancelTask(null)}
          onCancel={(reason) => {
            updateTask(cancelTask.id, {
              status: 'Cancelled',
              cancelReason: reason,
              cancelledAt: clockNow().toISOString(),
            })
            setCancelTask(null)
          }}
        />
      )}
      {rescheduleTask && (
        <RescheduleTaskModal
          task={rescheduleTask}
          onClose={() => setRescheduleTask(null)}
          onSave={(dueDate) => updateTask(rescheduleTask.id, { dueDate, autoRescheduledFrom: undefined })}
        />
      )}
    </div>
  )
}

/**
 * ADDING A TASK AND EDITING ONE ARE THE SAME BOX.
 *
 * THE FIRM: "you should also be able to edit a task, the name of the task."
 *
 * There was no way to change anything about a task but its date -- a title typed wrong stayed
 * wrong, and the only way out was to cancel it and type it again, which leaves two rows on the
 * client's file for one piece of work. ONE COMPONENT, because two would drift: the day picker, the
 * blank time and the client are the same decisions whichever end you came in at.
 */
function TaskModal({
  reps,
  companies,
  defaultOwnerId,
  allTasks,
  meetings,
  currentUserId,
  today,
  /** The task being changed, or undefined when one is being made. */
  editing,
  onClose,
  onSave,
}: {
  reps: User[]
  companies: { id: string; name: string }[]
  defaultOwnerId: string
  allTasks: Task[]
  meetings: CalendarEvent[]
  currentUserId: string
  /** 'YYYY-MM-DD'. Passed down rather than read from the clock, like every other picker here. */
  today: string
  editing?: Task
  onClose: () => void
  onSave: (input: Partial<Task> & { title: string; dueDate: string }) => void
}) {
  /*
   * THE TIME OPENS BLANK, and that is what makes a time on a task mean anything.
   *
   * It defaulted to 09:00, so every task ever added carried a nine o'clock nobody chose -- and
   * dayPlan.taskTime has no companion flag to read, only the timestamp, so a defaulted time is
   * indistinguishable from a wanted one. Blank, a time is a decision; filled in for you, it is
   * noise that the day's list would then print as fact.
   */
  const [form, setForm] = useState(() => {
    if (!editing) {
      return {
        title: '', type: 'Follow-up' as TaskType, priority: 'Medium' as TaskPriority,
        ownerId: defaultOwnerId, date: '', time: '', companyId: '',
      }
    }
    /* THE DAY AND THE TIME COME APART AGAIN, through the same function the list reads them with --
       taskTime is what decides whether a time was ever chosen, and an edit box that guessed
       differently would put 00:00 into a field somebody deliberately left blank. */
    return {
      title: editing.title,
      type: editing.type,
      priority: editing.priority,
      ownerId: editing.ownerId,
      date: localDay(new Date(editing.dueDate)),
      time: taskTime(editing) ?? '',
      companyId: editing.companyId ?? '',
    }
  })

  /*
   * WHAT THE OWNER'S DAY ALREADY HOLDS -- recomputed when the owner changes, because the question
   * is about THEIR day and not about the day of whoever is typing.
   *
   * MEETINGS ONLY FOR YOURSELF, and said out loud when it is somebody else. A calendar event
   * belongs to one person and RLS scopes it to them, so there is no honest way to count another
   * rep's meetings from here -- and a total that silently left them out would be the firm asking
   * "how many meetings do I have that day" and being shown a number that cannot answer it.
   */
  const mine = form.ownerId === currentUserId
  const counts = useMemo(
    () => dayCounts({
      meetings: mine ? meetings : [],
      tasks: allTasks.filter((t) => t.ownerId === form.ownerId),
    }),
    [mine, meetings, allTasks, form.ownerId],
  )
  /* Wide enough for seven columns: the grid caps itself at 32rem. */
  return (
    <Modal title={editing ? 'Edit task' : 'Add Task'} onClose={onClose} width={520}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!form.title || !form.date) return
          /* Midnight where no time was given -- which is exactly what taskTime reads back as
             "any time that day". An empty string here would make an Invalid Date. */
          onSave({
            title: form.title,
            type: form.type,
            priority: form.priority,
            ownerId: form.ownerId,
            dueDate: new Date(`${form.date}T${form.time || '00:00'}`).toISOString(),
            /*
              THE CLIENT, SO THE WORK LANDS ON THEIR FILE.

              THE FIRM: "it could be attached to a client -- this client has a meeting on the 15th.
              Schedule the meeting, goes onto the notes of the client... so all the data is
              captured there."

              `companyId` has been on a task all along and nothing on this screen could set it, so
              every task added here was attached to nobody. AppStore writes an activity on the
              client when a task is created, completed or cancelled -- all three were working and
              all three had nothing to write to.

              UNDEFINED, NOT AN EMPTY STRING: the column is a uuid, and '' is not one.
            */
            companyId: form.companyId || undefined,
            relatedToLabel: companies.find((c) => c.id === form.companyId)?.name,
          })
          onClose()
        }}
      >
        <FormField label="Task Title" required>
          <input className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required autoFocus />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Type">
            <select className={inputClass} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as TaskType })}>
              {(['Call', 'Follow-up', 'Email', 'Proposal', 'Meeting', 'WhatsApp', 'Research', 'Internal task', 'Other'] as TaskType[]).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Priority">
            <select className={inputClass} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}>
              {(['Low', 'Medium', 'High', 'Urgent'] as TaskPriority[]).map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </FormField>
        </div>
        {/*
          THE DAY, WITH THE DAY'S LOAD ON IT.

          THE FIRM: "it asks you when, but it should look like a rediarisation almost thing, to
          show you how many meetings do you have for a specific day." It was an
          `<input type="date">`, which accepts the 8th exactly as readily when the 8th already
          holds four client meetings. ABOVE the time rather than beside it, because it is now a
          three-week grid and not a field.
        */}
        <FormField label="Day" required>
          <TaskDayPicker
            value={form.date}
            onChange={(date) => setForm({ ...form, date })}
            counts={counts}
            today={today}
            note={mine ? undefined
              : 'Counting their tasks only — a calendar belongs to the person whose it is.'}
          />
        </FormField>
        {/*
          WHOSE AND WHAT TIME, AFTER THE DAY.

          The time used to sit beside Type and Priority, which put it two fields above the date it
          is a time ON. The day is now a grid rather than a field, so the order reads the way the
          decision is made: what it is, which day, then whose it is and whether an hour was meant.
        */}
        {/*
          WHOSE CLIENT IT IS ABOUT. Optional, because most tasks are about nobody -- and a required
          client would have somebody picking one at random to get past the form.
        */}
        <FormField label="Client">
          <select className={inputClass} value={form.companyId}
            onChange={(e) => setForm({ ...form, companyId: e.target.value })}>
            <option value="">Not about a client</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <span className="block text-[11px] text-slate-400 mt-1">
            Booking it, finishing it and cancelling it all go onto their file.
          </span>
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Owner">
            <select className={inputClass} value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })}>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Time">
            <input type="time" className={inputClass} value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
            {/* SAID ON THE FIELD, because an empty box that is not marked optional reads as one
                somebody forgot to fill in. Most work is "sometime today" and the firm said so. */}
            <span className="block text-[11px] text-slate-400 mt-1">
              Optional &mdash; leave it blank for any time that day.
            </span>
          </FormField>
        </div>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            {editing ? 'Save changes' : 'Add Task'}
          </button>
        </div>
      </form>
    </Modal>
  )
}


/**
 * CALLING A TASK OFF, AND SAYING WHY.
 *
 * THE FIRM: "you should also be able to cancel a task -- the cancel reason... the client has
 * cancelled the meeting, and then it will also be on the notes of the client, the place where the
 * client lives. So all the data is captured there."
 *
 * 'Cancelled' HAS BEEN A STATUS ALL ALONG and the only thing it could ever say was that somebody
 * had cancelled. A meeting the CLIENT called off and one the firm dropped because it was no longer
 * needed are the same row, and six months later that is the whole question: a client who keeps
 * moving appointments is a different problem from a firm that keeps forgetting them.
 *
 * THE REASON IS ASKED FOR AND NOT REQUIRED. A required one is a box everybody fills with a full
 * stop, and a file of full stops is worse than a file with gaps in it -- the gaps at least read as
 * gaps. What the box does instead is make the useful answer the easy one.
 */
function CancelTaskModal({ task, onClose, onCancel }: {
  task: Task
  onClose: () => void
  onCancel: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  return (
    <Modal title={`Cancel this ${task.type.toLowerCase()}?`} onClose={onClose} width={440}>
      <p className="text-sm text-slate-500">
        <span className="font-medium text-slate-700">{task.title}</span>
        {task.relatedToLabel && <span> &middot; {task.relatedToLabel}</span>}
      </p>
      {/*
        NOTHING IS DELETED. A cancelled task stays on the list under Completed's own filter and on
        the client's file for ever -- which is the point of recording it at all.
      */}
      <p className="text-[13px] text-slate-500 mt-2">
        It comes off the working lists and stays on the record.
        {task.companyId && ' This goes onto the client’s file.'}
      </p>

      <FormField label="Why?">
        <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="The client moved it to next month" autoFocus />
        <span className="block text-[11px] text-slate-400 mt-1">
          Optional &mdash; but it is the half somebody reading this in six months actually needs.
        </span>
      </FormField>

      <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
        <button type="button" onClick={onClose}
          className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
          Keep it
        </button>
        <button type="button" onClick={() => onCancel(reason.trim())}
          className="text-sm font-medium px-3.5 py-2 rounded-lg bg-[var(--c-rust-deep)] text-white hover:brightness-110">
          Cancel the {task.type.toLowerCase()}
        </button>
      </div>
    </Modal>
  )
}
