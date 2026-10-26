import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronDown, FileText, Image as ImageIcon, Loader2 } from 'lucide-react'
import { Card, CardHeader } from '../../components/ui/Card'
import { UserAvatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { ZoomableImage } from '../../components/ui/ZoomableImage'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { formatDate, formatDateTime } from '../../data/mockData'
import type { User } from '../../types'
import {
  PRIORITY_LABEL, REQUEST_DEPARTMENTS, STATUSES, STATUS_LABEL, isOpen, mayDecide, mayTest, mayWithdraw, testState, requestLabel, sortRequests,
  type ChangeRequest, type RequestDepartment, type RequestFileMeta, type RequestPriority, type RequestReview, type RequestStatus,
} from '../../lib/changeRequests'
import { answerTest, fileDataUrl, latestReview, listFiles, listRequests, updateRequest, withdrawRequest } from '../../lib/changeRequestsApi'

/**
 * CHANGE REQUESTS (S12, changeRequests.ts): everything people asked Raptor to do differently.
 *
 * LAST NIGHT'S REVIEW FIRST, when there is one: the firm asked for the requests "in the group list",
 * and the groups are what somebody deciding reads -- the list underneath is where one request is
 * found. The list opens on the OPEN ones; Done and Declined are a tap away, never mixed in.
 */
type Shelf = 'open' | 'done' | 'declined' | 'all'

const STATUS_TONE: Record<RequestStatus, string> = {
  new: 'bg-sky-50 text-sky-700', accepted: 'bg-indigo-50 text-indigo-700', building: 'bg-amber-50 text-amber-800',
  done: 'bg-emerald-50 text-emerald-700', declined: 'bg-slate-100 text-slate-600',
}

export function RequestsPage() {
  const { users } = useAppStore()
  const { currentUser } = useAuth()
  const [params, setParams] = useSearchParams()
  const focus = Number(params.get('r')) || null
  const [rows, setRows] = useState<ChangeRequest[] | null>(null)
  const [files, setFiles] = useState<RequestFileMeta[]>([])
  const [review, setReview] = useState<RequestReview | null>(null)
  const [shelf, setShelf] = useState<Shelf>('open')
  const [dept, setDept] = useState<RequestDepartment | 'all'>('all')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    Promise.all([listRequests(), listFiles(), latestReview()])
      .then(([r, f, v]) => { setRows(r); setFiles(f); setReview(v) })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  useEffect(() => { load() }, [load])

  /* A link to one request (a notification, a review group) opens its shelf, whatever it is on. */
  useEffect(() => {
    const r = focus && rows?.find((x) => x.number === focus)
    if (r && !isOpen(r.status)) setShelf(r.status === 'done' ? 'done' : 'declined')
  }, [focus, rows])

  const userOf = (id: string) => users.find((u) => u.id === id)
  const counts = useMemo(() => {
    const all = rows ?? []
    return { open: all.filter((r) => isOpen(r.status)).length, done: all.filter((r) => r.status === 'done').length,
      declined: all.filter((r) => r.status === 'declined').length, all: all.length }
  }, [rows])
  const shown = useMemo(() => sortRequests((rows ?? []).filter((r) =>
    (shelf === 'all' ? true : shelf === 'open' ? isOpen(r.status) : r.status === shelf)
    && (dept === 'all' || r.department === dept))), [rows, shelf, dept])
  const byNumber = useMemo(() => new Map((rows ?? []).map((r) => [r.number, r])), [rows])

  return (
    <div className="space-y-5 max-w-5xl">
      <p className="text-sm text-slate-500">
        What people have asked Raptor to do differently. Press the light bulb at the top of any page to add one.
      </p>

      {/* No review, no card: a "nothing new" box every morning is a box people learn to skip. */}
      {review && review.groups.length > 0 && (
        <Card>
          <div data-testid="requests-review">
            <CardHeader title={`The night's review · ${formatDate(review.created_at)}`} subtitle={review.summary} />
            <div className="grid gap-3 sm:grid-cols-2">
              {review.groups.map((g, i) => (
                <div key={i} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-slate-800">{g.title}</p>
                    {g.size && <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{g.size}</span>}
                  </div>
                  {g.what && <p className="mt-1 text-slate-600">{g.what}</p>}
                  {g.request_numbers.length > 0 && (
                    <p className="mt-1.5 flex flex-wrap gap-1.5">
                      {g.request_numbers.map((n) => (
                        <button key={n} type="button" onClick={() => setParams({ r: String(n) })}
                          className="rounded-md bg-brand-50 px-1.5 py-0.5 text-xs font-medium text-brand-700 hover:underline"
                          title={byNumber.get(n)?.description}>R-{n}</button>
                      ))}
                    </p>
                  )}
                  {g.questions.length > 0 && (
                    <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-amber-800">
                      {g.questions.map((q, j) => <li key={j}>{q}</li>)}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs" role="radiogroup" aria-label="Which requests" data-testid="requests-shelf">
          {(['open', 'done', 'declined', 'all'] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={shelf === v} onClick={() => setShelf(v)}
              className={`rounded-md px-2.5 py-1 ${shelf === v ? 'bg-navy-900 text-white' : 'text-slate-600 hover:text-slate-900'}`}>
              {v === 'open' ? 'Open' : v === 'done' ? 'Done' : v === 'declined' ? 'Declined' : 'All'} ({counts[v]})
            </button>
          ))}
        </div>
        <select value={dept} onChange={(e) => setDept(e.target.value as RequestDepartment | 'all')} aria-label="Department"
          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700" data-testid="requests-department">
          <option value="all">Every department</option>
          {REQUEST_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {rows === null && !error && <p className="text-sm text-slate-400"><Loader2 size={14} className="inline animate-spin" /> Reading the requests…</p>}
      {rows !== null && shown.length === 0 && (
        <p className="text-sm text-slate-400" data-testid="requests-empty">
          {shelf === 'open' ? 'Nothing waiting. Press the light bulb at the top of any page to ask for a change.' : 'None here.'}
        </p>
      )}
      <div className="space-y-2.5" data-testid="requests-list">
        {shown.map((r) => (
          <RequestCard key={r.id} r={r} files={files.filter((f) => f.request_id === r.id)} userOf={userOf}
            focused={focus === r.number} canDecide={mayDecide(currentUser)} canWithdraw={mayWithdraw(currentUser, r)}
            canTest={mayTest(currentUser, r)} isAsker={currentUser?.id === r.created_by} onChanged={load} />
        ))}
      </div>
    </div>
  )
}

function RequestCard({ r, files, userOf, focused, canDecide, canWithdraw, canTest, isAsker, onChanged }: {
  r: ChangeRequest; files: RequestFileMeta[]; userOf: (id: string) => User | undefined
  focused: boolean; canDecide: boolean; canWithdraw: boolean; canTest: boolean; isAsker: boolean; onChanged: () => void
}) {
  const [open, setOpen] = useState(focused)
  const [note, setNote] = useState(r.admin_note ?? '')
  const [doneIn, setDoneIn] = useState(r.done_in ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (focused) setOpen(true) }, [focused])

  async function act(fn: () => Promise<void>) {
    setBusy(true); setError(null)
    try { await fn(); onChanged() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const move = (status: RequestStatus) => act(() => updateRequest(r.id, {
    status, admin_note: note.trim() || null, ...(status === 'done' ? { done_in: doneIn.trim() || null } : {}),
  }))

  const asker = userOf(r.created_by)
  const decider = r.decided_by ? userOf(r.decided_by) : null
  const pictures = files.filter((f) => f.mime.startsWith('image/')).length
  const test = testState(r)
  const tester = r.tested_by ? userOf(r.tested_by) : null
  const [testNote, setTestNote] = useState('')
  const [sayingNo, setSayingNo] = useState(false)
  const pdfs = files.length - pictures
  /* The first line is the title: people write "Diary: make broken promises red" and then explain. */
  const [title, ...rest] = r.description.trim().split(/\n+/)
  const more = rest.join('\n').trim()

  return (
    <div data-testid="request-card" data-number={r.number}
      className={`overflow-hidden rounded-xl border bg-white shadow-sm transition ${focused ? 'border-brand-300 ring-2 ring-brand-200' : 'border-slate-200'} ${open ? '' : 'hover:border-slate-300 hover:shadow'}`}>
      {/*
        THE WHOLE ROW IS THE BUTTON, and it LOOKS like one (the firm, 26 Oct: "I couldn't see that I
        need to be clicking on it"): a chevron that turns, a hover, and the words "Open" / "Close".
      */}
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid="request-toggle"
        className={`flex w-full items-start gap-3 px-4 py-3 text-left ${open ? 'bg-slate-50' : 'hover:bg-slate-50'}`}>
        {/* The number people say out loud ("R-2"), as the notifications and the night's review say it. */}
        <div className="flex h-10 min-w-[3rem] shrink-0 items-center justify-center rounded-lg bg-navy-900 px-2 font-mono text-sm font-bold text-white" data-testid="request-number">
          {requestLabel(r)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="min-w-0 truncate text-[15px] font-semibold text-slate-800" data-testid="request-title">{title}</p>
          {/* WHICH DEPARTMENT, WHICH PANE (the firm, 26 Oct): first thing under the title, so the list can be read by them. */}
          {(r.department || r.pane) && (
            <p className="mt-1 flex flex-wrap gap-1.5 text-[11px]" data-testid="request-where">
              {r.department && <span className="rounded-full bg-gold-100 px-2 py-0.5 font-semibold text-navy-900">{r.department}</span>}
              {r.pane && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{r.pane} pane</span>}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500" data-testid="request-asker">
            <span className="inline-flex items-center gap-1.5">
              <UserAvatar userId={r.created_by} size={18} />
              <span>Asked by <strong className="font-medium text-slate-700">{asker?.name ?? 'Somebody'}</strong>{asker?.role ? ` · ${asker.role}` : ''}</span>
            </span>
            <span>· {formatDateTime(r.created_at)}</span>
            {r.page_title && !r.pane && <span>· on {r.page_title}</span>}
            {pictures > 0 && <span className="inline-flex items-center gap-0.5"><ImageIcon size={12} />{pictures} screenshot{pictures === 1 ? '' : 's'}</span>}
            {pdfs > 0 && <span className="inline-flex items-center gap-0.5"><FileText size={12} />{pdfs} PDF{pdfs === 1 ? '' : 's'}</span>}
          </div>
          {test === 'sent back' && tester && r.tested_at ? (
            <p className="mt-1 text-xs text-red-700" data-testid="request-decider">
              Sent back by <strong className="font-medium">{tester.name}</strong> after testing · {formatDateTime(r.tested_at)}
            </p>
          ) : decider && r.decided_at ? (
            <p className="mt-1 text-xs text-slate-500" data-testid="request-decider">
              {STATUS_LABEL[r.status]} by <strong className="font-medium text-slate-700">{decider.name}</strong> · {formatDateTime(r.decided_at)}
            </p>
          ) : null}
          {test === 'works' && tester && r.tested_at && (
            <p className="mt-0.5 text-xs text-emerald-700">Tested and working, said by <strong className="font-medium">{tester.name}</strong> · {formatDateTime(r.tested_at)}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <div className="flex items-center gap-1.5">
            {r.priority !== 'normal' && <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${r.priority === 'high' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-500'}`}>{PRIORITY_LABEL[r.priority]}</span>}
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[r.status]}`} data-testid="request-status">{STATUS_LABEL[r.status]}</span>
            {test === 'works' && <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white" data-testid="request-tested">Tested ✓</span>}
            {test === 'waiting' && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">Waiting for a test</span>}
            {test === 'sent back' && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">Sent back</span>}
          </div>
          <span className="inline-flex items-center gap-0.5 text-xs font-medium text-brand-700">
            {open ? 'Close' : 'Open'} <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </span>
        </div>
      </button>
      {open && (
        <div className="space-y-4 border-t border-slate-100 px-4 py-4 sm:pl-[4.75rem]">
          <Section label="What they asked">
            <p className="whitespace-pre-wrap text-sm text-slate-800">{more ? `${title}\n\n${more}` : title}</p>
            {r.page_path && (
              <p className="mt-1.5 text-xs text-slate-500">Asked from <Link to={r.page_path} className="font-medium text-brand-700 hover:underline">{r.page_title || r.page_path} →</Link></p>
            )}
          </Section>
          {files.length > 0 && <Section label="Screenshots and files"><RequestFiles files={files} /></Section>}

          {/*
            TEST IT (the firm: "so that she can test it and approve that ... it works"). Done is the
            builder's word; this is the asker's. It works closes it; Not right yet sends it back to
            Accepted with what is wrong, and the administrators are told either way.
          */}
          {test === 'waiting' && canTest && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid="request-test">
              <p className="text-sm font-semibold text-amber-900">{isAsker ? 'This is done. Please test it.' : `Waiting for ${asker?.name ?? 'the person who asked'} to test it.`}</p>
              {/* HOW TO TEST is the note written when it was marked Done -- the page it was asked from is
                  often not where the change landed (R-3 was asked from the Dashboard). */}
              <p className="mt-0.5 text-xs text-amber-900/80" data-testid="request-test-how">
                {r.admin_note
                  ? <><strong className="font-medium">How to test:</strong> {r.admin_note}</>
                  : r.page_path
                    ? <>Open <Link to={r.page_path} className="font-medium underline">{r.page_title || r.page_path}</Link>, try what you asked for, then say here whether it works.</>
                    : 'Try what you asked for, then say here whether it works.'}
                {r.done_in ? ` (${r.done_in})` : ''}
              </p>
              {sayingNo && (
                <textarea value={testNote} onChange={(e) => setTestNote(e.target.value)} rows={2} autoFocus data-testid="request-test-note"
                  placeholder="What is still not right?" className="mt-2 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm" />
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {!sayingNo ? (
                  <>
                    <Button size="sm" variant="primary" disabled={busy} data-testid="request-test-works"
                      onClick={() => void act(() => answerTest(r.number, true, ''))}>It works</Button>
                    <Button size="sm" variant="secondary" disabled={busy} data-testid="request-test-not-right"
                      onClick={() => setSayingNo(true)}>Not right yet</Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="danger" disabled={busy || !testNote.trim()} data-testid="request-test-send-back"
                      onClick={() => void act(() => answerTest(r.number, false, testNote))}>Send it back</Button>
                    <Button size="sm" variant="ghost" onClick={() => setSayingNo(false)}>Cancel</Button>
                  </>
                )}
              </div>
            </div>
          )}
          {(test === 'works' || test === 'sent back') && r.tested_note && (
            <Section label={test === 'works' ? 'What they said when they tested it' : 'What is still not right'}>
              <p className={`text-sm ${test === 'works' ? 'text-emerald-800' : 'text-red-800'}`}>{r.tested_note}</p>
            </Section>
          )}
          {(r.admin_note || r.done_in) && !canDecide && test !== 'waiting' && (
            <Section label="From the administrator">
              {r.admin_note && <p className="text-sm text-slate-700">{r.admin_note}</p>}
              {r.done_in && <p className="text-xs text-emerald-700">Built in {r.done_in}</p>}
            </Section>
          )}

          {canDecide && (
            <Section label="Decide">
              <div className="space-y-2 rounded-lg bg-slate-50 p-3" data-testid="request-decide">
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="A note for the person who asked (a decline needs one)"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" data-testid="request-note" />
                <div className="flex flex-wrap items-center gap-2">
                  {STATUSES.filter((s) => s !== r.status && s !== 'new').map((s) => (
                    <Button key={s} size="sm" variant={s === 'declined' ? 'danger' : s === 'done' ? 'primary' : 'secondary'} disabled={busy || (s === 'declined' && !note.trim())}
                      onClick={() => void move(s)} data-testid={`request-move-${s}`}>
                      {s === 'accepted' ? 'Accept' : s === 'building' ? 'Being built' : s === 'done' ? 'Mark done' : 'Decline'}
                    </Button>
                  ))}
                  <select value={r.priority} disabled={busy} aria-label="Priority"
                    onChange={(e) => void act(() => updateRequest(r.id, { priority: e.target.value as RequestPriority }))}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs">
                    {(['high', 'normal', 'low'] as const).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]} priority</option>)}
                  </select>
                  {r.status !== 'done' && (
                    <input value={doneIn} onChange={(e) => setDoneIn(e.target.value)} placeholder="Built in (optional, e.g. S14)"
                      className="min-w-[10rem] flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs" />
                  )}
                </div>
              </div>
            </Section>
          )}
          {canWithdraw && (
            <button type="button" disabled={busy} onClick={() => void act(() => withdrawRequest(r.id))}
              className="text-xs text-slate-500 hover:text-red-700" data-testid="request-withdraw">Withdraw this request</button>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  )
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      {children}
    </div>
  )
}

/** The pictures and PDFs, read only when the request is opened. */
function RequestFiles({ files }: { files: RequestFileMeta[] }) {
  const [urls, setUrls] = useState<Record<string, string | null>>({})
  useEffect(() => {
    let live = true
    for (const f of files) {
      if (f.purged_at) continue
      void fileDataUrl(f).then((u) => { if (live) setUrls((cur) => ({ ...cur, [f.id]: u })) }).catch(() => undefined)
    }
    return () => { live = false }
  }, [files])
  return (
    <div className="flex flex-wrap gap-2" data-testid="request-files">
      {files.map((f) => {
        if (f.purged_at) return <span key={f.id} className="text-xs text-slate-400">{f.name} (removed 30 days after it closed)</span>
        const url = urls[f.id]
        if (f.mime.startsWith('image/')) {
          return url
            ? <ZoomableImage key={f.id} src={url} alt={f.name} className="h-28 w-40 rounded-lg border border-slate-200 object-cover" />
            : <div key={f.id} className="flex h-28 w-40 items-center justify-center rounded-lg border border-slate-200 bg-slate-50"><Loader2 size={16} className="animate-spin text-slate-400" /></div>
        }
        return (
          <a key={f.id} href={url ?? undefined} download={f.name} target="_blank" rel="noreferrer"
            className="flex h-28 w-40 flex-col items-center justify-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 text-center text-xs text-slate-600 hover:bg-slate-100">
            <FileText size={20} /><span className="w-full truncate">{f.name}</span>
          </a>
        )
      })}
    </div>
  )
}
