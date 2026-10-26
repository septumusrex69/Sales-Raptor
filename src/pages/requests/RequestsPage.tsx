import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, CheckCircle2, ChevronDown, Columns3, FileText, Hourglass, LayoutDashboard, Lightbulb, List, Loader2, Moon, Paperclip, Search,
} from 'lucide-react'
import { DashboardHero } from '../../components/dashboard/DashboardHero'
import { UserAvatar } from '../../components/ui/Avatar'
import { Chip, RequestPanel, StagePill } from '../../components/requests/RequestPanel'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { formatDate, formatDateTime } from '../../data/mockData'
import {
  REQUEST_DEPARTMENTS, VERDICT_LABEL, onShelf, waitingOnAsker, requestLabel, reviewTiles, sortRequests, titleOf,
  type ChangeRequest, type RequestDepartment, type RequestFileMeta, type RequestReview, type ReviewVerdict, type Shelf,
} from '../../lib/changeRequests'
import { listFiles, listQuestionThreads, listRequests, listReviews } from '../../lib/changeRequestsApi'

/**
 * THE FEEDBACK CENTRE (Raptor H12) -- "Request a change", worked as a development queue.
 *
 * THE FIRM: "Raptor is currently treating the Requests page like a report, rather than a proper
 * feedback and development management system ... Nightly Review -- what was reviewed, what can
 * proceed, what needs your decision, and any blockers. New Requests ... All Tickets ... Clicking a
 * number should filter the relevant tickets ... the nightly review should not disappear the following
 * morning ... The selected view should be remembered for each user ... keep the existing Raptor
 * sidebar and overall branding."
 *
 * THREE VIEWS OF ONE LIST, AND ONE FILTER OVER ALL THREE: Overview (the night, what waits, the
 * tickets), List (compact rows), Board (the workflow's columns). Switching keeps the search, the
 * shelf and the department. A ticket opens in RequestPanel beside whichever is showing, and its
 * address (?r=12) is what every notification links to.
 *
 * NO PHOTOGRAPH IN THE HEADER, though the firm's mock-up had one: "there should only be one very
 * special page" (CLAUDE.md, the company dashboard). This wears the ordinary DashboardHero.
 */
type View = 'overview' | 'list' | 'board'
type TileFilter = { reviewId: string; verdict: ReviewVerdict | 'reviewed' } | null

const VIEW_KEY = (uid: string | undefined) => `raptor.requests.view.${uid ?? 'anon'}`
/* Remembered per person on this device: a convenience, so a failure to read or write it is silent. */
function readView(uid: string | undefined): View {
  try { const v = window.localStorage.getItem(VIEW_KEY(uid)); return v === 'list' || v === 'board' ? v : 'overview' } catch { return 'overview' }
}

export function RequestsPage() {
  const { users } = useAppStore()
  const { currentUser } = useAuth()
  const [params, setParams] = useSearchParams()
  const focus = Number(params.get('r')) || null
  const [rows, setRows] = useState<ChangeRequest[] | null>(null)
  const [files, setFiles] = useState<RequestFileMeta[]>([])
  const [reviews, setReviews] = useState<RequestReview[]>([])
  const [reviewIndex, setReviewIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [view, setViewState] = useState<View>(() => readView(currentUser?.id))
  // The list opens on Open, with All last as the option to put on (Stephan, Raptor H12): what is not yet
  // finished is what somebody comes here for; everything else is one press away.
  const [shelf, setShelf] = useState<Shelf>('open')
  const [threads, setThreads] = useState<Awaited<ReturnType<typeof listQuestionThreads>>>([])
  const [dept, setDept] = useState<RequestDepartment | 'all'>('all')
  const [search, setSearch] = useState('')
  const [tile, setTile] = useState<TileFilter>(null)

  useEffect(() => { setViewState(readView(currentUser?.id)) }, [currentUser?.id])
  const setView = (v: View) => {
    setViewState(v)
    try { window.localStorage.setItem(VIEW_KEY(currentUser?.id), v) } catch { /* a convenience only */ }
  }

  const load = useCallback(() => {
    Promise.all([listRequests(), listFiles(), listReviews(), listQuestionThreads()])
      .then(([r, f, v, q]) => { setRows(r); setFiles(f); setReviews(v); setThreads(q) })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  useEffect(() => { load() }, [load])

  const review = reviews[reviewIndex] ?? null
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? ''
    const tileIds = tile ? reviews.find((v) => v.id === tile.reviewId)?.request_ids ?? [] : null
    return sortRequests((rows ?? []).filter((r) =>
      (view === 'board' || onShelf(r, shelf))   // the board IS every stage; the shelf is the list's
      && (dept === 'all' || r.department === dept)
      && (!tileIds || (tileIds.includes(r.id) && (tile?.verdict === 'reviewed' || r.review_verdict === tile?.verdict)))
      && (!q || `${requestLabel(r)} ${titleOf(r)} ${r.description} ${nameOf(r.created_by)} ${r.pane ?? ''}`.toLowerCase().includes(q))))
  }, [rows, shelf, view, dept, search, tile, reviews, users])

  const counts = useMemo(() => {
    const all = rows ?? []
    const n = (s: Shelf) => all.filter((r) => onShelf(r, s)).length
    return { all: n('all'), open: n('open'), done: n('done'), declined: n('declined') }
  }, [rows])
  /* Who each open request waits on, by first name, for the "Needs feedback from" pill. */
  const feedbackFrom = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of rows ?? []) {
      if (waitingOnAsker(r, threads)) m.set(r.id, users.find((u) => u.id === r.created_by)?.name.split(' ')[0] ?? 'them')
    }
    return m
  }, [rows, threads, users])

  const open = focus ? (rows ?? []).find((r) => r.number === focus) ?? null : null
  const openAt = open ? shown.findIndex((r) => r.id === open.id) : -1
  const go = (r: ChangeRequest | undefined) => { if (r) setParams({ r: String(r.number) }) }
  const close = () => setParams({})

  function pickTile(verdict: ReviewVerdict | 'reviewed') {
    if (!review) return
    setTile({ reviewId: review.id, verdict }); setShelf('all'); setDept('all'); setSearch('')
    if (view === 'board') setView('list')
  }

  return (
    <div className="max-w-6xl space-y-5">
      <DashboardHero eyebrow="Feedback centre" title="Build a better Raptor"
        subtitle="Ideas, feedback and changes asked for by the team. Press the light bulb at the top of any page to add one." />

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1" role="tablist" aria-label="View" data-testid="requests-views">
          {([['overview', 'Overview', LayoutDashboard], ['list', 'List', List], ['board', 'Board', Columns3]] as const).map(([v, label, Icon]) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm ${view === v ? 'bg-gold-100 font-semibold text-navy-900' : 'text-slate-600 hover:text-slate-900'}`}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {rows === null && !error && <p className="text-sm text-slate-400"><Loader2 size={14} className="inline animate-spin" /> Reading the requests…</p>}

      {rows !== null && view === 'overview' && (
        <>
          <NightlyReview review={review} index={reviewIndex} count={reviews.length} rows={rows} onPick={setReviewIndex} onTile={pickTile} active={tile} />
          <WaitingOnYou rows={rows} onOpen={go} />
        </>
      )}

      {rows !== null && (
        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-800">{view === 'board' ? 'The workflow' : 'Requests'}</h2>
              <p className="text-xs text-slate-500">Submitted → Reviewed → Approved → In development → Released → tested by the person who asked.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm">
                <Search size={14} className="text-slate-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search requests…" className="w-40 outline-none" data-testid="requests-search" />
              </label>
              <select value={dept} onChange={(e) => setDept(e.target.value as RequestDepartment | 'all')} aria-label="Department"
                className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700" data-testid="requests-department">
                <option value="all">Every department</option>
                {REQUEST_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>
          {view !== 'board' && (
            <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Which requests" data-testid="requests-shelf">
              {([['open', 'Open'], ['done', 'Released'], ['declined', 'Declined'], ['all', 'All']] as const).map(([s, label]) => (
                <button key={s} type="button" role="radio" aria-checked={shelf === s} onClick={() => { setShelf(s); setTile(null) }}
                  className={`rounded-lg border px-3 py-1 text-sm ${shelf === s && !tile ? 'border-navy-900 bg-navy-900 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                  {label} ({counts[s]})
                </button>
              ))}
              {tile && (
                <button type="button" onClick={() => setTile(null)} data-testid="requests-tile-filter"
                  className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-1 text-sm text-violet-800">
                  {tile.verdict === 'reviewed' ? 'Read by the night' : VERDICT_LABEL[tile.verdict]} ✕
                </button>
              )}
            </div>
          )}
          {view === 'board'
            ? <RequestBoard rows={shown} files={files} onOpen={go} openId={open?.id ?? null} feedbackFrom={feedbackFrom} />
            : <RequestTable rows={shown} files={files} onOpen={go} openId={open?.id ?? null} feedbackFrom={feedbackFrom} />}
        </section>
      )}

      {open && (
        <RequestPanel key={open.id} r={open} files={files.filter((f) => f.request_id === open.id)} users={users} me={currentUser}
          onClose={close} onChanged={load}
          onPrev={openAt > 0 ? () => go(shown[openAt - 1]) : null}
          onNext={openAt >= 0 && openAt < shown.length - 1 ? () => go(shown[openAt + 1]) : null} />
      )}
    </div>
  )
}

/**
 * LAST NIGHT'S REVIEW, AND EVERY NIGHT BEFORE IT. Four tiles a person acts on, each a filter on the
 * tickets below; the night's own words under them, short. No review yet: one quiet line, not a box.
 */
function NightlyReview({ review, index, count, rows, onPick, onTile, active }: {
  review: RequestReview | null; index: number; count: number; rows: ChangeRequest[]
  onPick: (i: number) => void; onTile: (v: ReviewVerdict | 'reviewed') => void; active: TileFilter
}) {
  if (!review) return <p className="text-sm text-slate-500"><Moon size={14} className="mr-1 inline" /> No nightly review yet. The first one runs at 01:47.</p>
  const t = reviewTiles(rows, review.request_ids)
  const tiles: { v: ReviewVerdict | 'reviewed'; n: number; label: string; hint: string; tone: string; Icon: typeof FileText }[] = [
    { v: 'reviewed', n: t.reviewed, label: 'Requests read', hint: 'Reviewed overnight', tone: 'bg-sky-50 text-sky-900', Icon: FileText },
    { v: 'ready', n: t.ready, label: 'Ready to implement', hint: 'Can proceed', tone: 'bg-emerald-50 text-emerald-900', Icon: CheckCircle2 },
    { v: 'decision', n: t.decision, label: 'Need your decision', hint: 'Questions to answer', tone: 'bg-amber-50 text-amber-900', Icon: Hourglass },
    { v: 'blocked', n: t.blocked, label: 'Blocked', hint: 'Missing information', tone: 'bg-red-50 text-red-900', Icon: AlertTriangle },
  ]
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="requests-review">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-navy-900 text-gold-300"><Moon size={20} /></span>
          <div>
            <h2 className="text-lg font-semibold text-slate-800">{index === 0 ? 'Last night’s review' : 'An earlier review'}</h2>
            <label className="relative inline-flex items-center text-sm text-slate-500">
              <select value={index} onChange={(e) => onPick(Number(e.target.value))} aria-label="Which night" data-testid="requests-review-night"
                className="appearance-none bg-transparent pr-5 outline-none">
                {Array.from({ length: count }, (_, i) => i).map((i) => <option key={i} value={i}>{i === index ? formatDate(review.created_at) : `Review ${count - i}`}</option>)}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-0" />
            </label>
          </div>
        </div>
        <p className="text-xs text-slate-400">{count} review{count === 1 ? '' : 's'} kept</p>
      </div>
      <p className="mt-3 max-w-3xl text-sm text-slate-600">{review.summary}</p>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(({ v, n, label, hint, tone, Icon }) => (
          <button key={v} type="button" onClick={() => onTile(v)} data-testid={`requests-tile-${v}`}
            className={`rounded-xl p-4 text-left transition hover:shadow ${tone} ${active?.reviewId === review.id && active.verdict === v ? 'ring-2 ring-navy-900' : ''}`}>
            <Icon size={18} className="opacity-70" />
            <p className="mt-2 flex items-baseline gap-2"><span className="text-2xl font-bold">{n}</span><span className="text-sm font-medium">{label}</span></p>
            <p className="text-xs opacity-70">{hint}</p>
          </button>
        ))}
      </div>
    </section>
  )
}

/** WHAT WAITS ON SOMEBODY: new requests to decide, and released ones still to be tested. */
function WaitingOnYou({ rows, onOpen }: { rows: ChangeRequest[]; onOpen: (r: ChangeRequest) => void }) {
  const fresh = sortRequests(rows.filter((r) => r.status === 'new'))
  if (!fresh.length) return null
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="requests-waiting">
      <h2 className="flex items-center gap-2 text-base font-semibold text-slate-800"><Lightbulb size={17} className="text-gold-500" /> New requests waiting for a decision ({fresh.length})</h2>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {fresh.slice(0, 6).map((r) => (
          <button key={r.id} type="button" onClick={() => onOpen(r)} className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-left hover:border-slate-300 hover:shadow-sm">
            <span className="whitespace-nowrap rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-700">{requestLabel(r)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-slate-800">{titleOf(r)}</span>
              <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                {r.department && <Chip tone="gold">{r.department}</Chip>}
                {r.review_verdict && <span>{VERDICT_LABEL[r.review_verdict]}</span>}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

function Asker({ id }: { id: string }) {
  const { users } = useAppStore()
  const u = users.find((x) => x.id === id)
  return <span className="inline-flex items-center gap-1.5"><UserAvatar userId={id} size={22} /><span className="truncate">{u?.name ?? 'Somebody'}</span></span>
}

/** COMPACT ROWS: the whole list readable at a glance, one click to open. */
function RequestTable({ rows, files, onOpen, openId, feedbackFrom }: {
  rows: ChangeRequest[]; files: RequestFileMeta[]; onOpen: (r: ChangeRequest) => void; openId: string | null; feedbackFrom: Map<string, string>
}) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-slate-400" data-testid="requests-empty">No requests here. Press the light bulb at the top of any page to ask for a change.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="requests-list">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
            <th className="px-2 py-2 font-medium">#</th>
            <th className="px-2 py-2 font-medium">Title</th>
            <th className="px-2 py-2 font-medium">Department</th>
            <th className="px-2 py-2 font-medium">Size</th>
            <th className="px-2 py-2 font-medium">Status</th>
            <th className="px-2 py-2 font-medium">Requested by</th>
            <th className="px-2 py-2 font-medium">Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const n = files.filter((f) => f.request_id === r.id).length
            return (
              <tr key={r.id} onClick={() => onOpen(r)} data-testid="request-card" data-number={r.number}
                className={`cursor-pointer border-b border-slate-50 hover:bg-slate-50 ${openId === r.id ? 'bg-gold-50' : ''}`}>
                <td className="w-px px-2 py-2.5"><span className="whitespace-nowrap rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-700" data-testid="request-number">{requestLabel(r)}</span></td>
                <td className="max-w-[22rem] px-2 py-2.5">
                  <span className="block truncate font-medium text-slate-800" data-testid="request-title">{titleOf(r)}</span>
                  {n > 0 && <span className="inline-flex items-center gap-0.5 text-[11px] text-slate-400"><Paperclip size={11} />{n}</span>}
                </td>
                <td className="px-2 py-2.5">{r.department ? <Chip tone="gold">{r.department}</Chip> : <span className="text-slate-300">—</span>}</td>
                <td className="px-2 py-2.5">{r.review_size ? <Chip tone="slate">{r.review_size}</Chip> : <span className="text-slate-300">—</span>}</td>
                <td className="px-2 py-2.5"><StagePill r={r} feedbackFrom={feedbackFrom.get(r.id)} /></td>
                <td className="px-2 py-2.5 text-slate-700" data-testid="request-asker"><Asker id={r.created_by} /></td>
                <td className="whitespace-nowrap px-2 py-2.5 text-xs text-slate-500">{formatDateTime(r.created_at)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** THE WORKFLOW AS COLUMNS -- the development queue the firm asked for. Declined is left off the board. */
function RequestBoard({ rows, files, onOpen, openId, feedbackFrom }: {
  rows: ChangeRequest[]; files: RequestFileMeta[]; onOpen: (r: ChangeRequest) => void; openId: string | null; feedbackFrom: Map<string, string>
}) {
  const cols: { title: string; pick: (r: ChangeRequest) => boolean }[] = [
    { title: 'Submitted', pick: (r) => r.status === 'new' && !r.reviewed_at },
    { title: 'Reviewed', pick: (r) => r.status === 'new' && !!r.reviewed_at },
    { title: 'Approved', pick: (r) => r.status === 'accepted' },
    { title: 'In development', pick: (r) => r.status === 'building' },
    { title: 'Released', pick: (r) => r.status === 'done' },
  ]
  return (
    <div className="grid gap-3 overflow-x-auto md:grid-cols-5" data-testid="requests-board">
      {cols.map((c) => {
        const mine = rows.filter(c.pick)
        return (
          <div key={c.title} className="min-w-[12rem] rounded-xl bg-slate-50 p-2" data-testid="requests-board-column" data-column={c.title}>
            <p className="px-1 pb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{c.title} ({mine.length})</p>
            <div className="space-y-2">
              {mine.map((r) => (
                <BoardCard key={r.id} r={r} n={files.filter((f) => f.request_id === r.id).length} onOpen={onOpen} open={openId === r.id} feedbackFrom={feedbackFrom.get(r.id)} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function BoardCard({ r, n, onOpen, open, feedbackFrom }: { r: ChangeRequest; n: number; onOpen: (r: ChangeRequest) => void; open: boolean; feedbackFrom?: string }): ReactNode {
  return (
    <button type="button" onClick={() => onOpen(r)} data-testid="request-card" data-number={r.number}
      className={`w-full rounded-lg border bg-white p-2.5 text-left shadow-sm hover:shadow ${open ? 'border-gold-400' : 'border-slate-200'}`}>
      <span className="flex items-center justify-between gap-1">
        <span className="whitespace-nowrap font-mono text-[11px] font-semibold text-slate-500">{requestLabel(r)}</span>
        {r.priority === 'high' && <span className="rounded-full bg-red-50 px-1.5 text-[10px] text-red-700">High</span>}
      </span>
      <span className="mt-1 block text-sm font-medium leading-snug text-slate-800">{titleOf(r)}</span>
      <span className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
        {r.department && <Chip tone="gold">{r.department}</Chip>}
        {n > 0 && <span className="inline-flex items-center gap-0.5"><Paperclip size={10} />{n}</span>}
        {feedbackFrom && <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-medium text-amber-900" data-testid="request-feedback">Needs feedback from {feedbackFrom}</span>}
      </span>
      <span className="mt-1.5 block"><Asker id={r.created_by} /></span>
    </button>
  )
}
