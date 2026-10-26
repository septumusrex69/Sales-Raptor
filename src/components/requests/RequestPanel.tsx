import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Check, ChevronLeft, ChevronRight, FileText, HelpCircle, Loader2, MessageSquare, Moon, Paperclip, X,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { UserAvatar } from '../ui/Avatar'
import { ZoomableImage } from '../ui/ZoomableImage'
import { formatDateTime } from '../../data/mockData'
import {
  MAX_CHOICES, OTHER_CHOICE, PRIORITY_LABEL, STATUS_LABEL, VERDICT_LABEL, answerBody, answerTo, choicesOk, mayAnswer, mayDecide, mayTest, mayWithdraw,
  parseChoices, requestLabel, stageOf, testState, tickedOf, titleOf,
  type ChangeRequest, type RequestEvent, type RequestFileMeta, type RequestPriority, type RequestStatus,
} from '../../lib/changeRequests'
import { addEvent, answerQuestion, answerTest, askClaude, fileDataUrl, listEvents, updateRequest, withdrawRequest } from '../../lib/changeRequestsApi'
import type { User } from '../../types'

/**
 * ONE REQUEST, IN A PANEL BESIDE THE LIST (Raptor H12, the Feedback Centre).
 *
 * THE FIRM: "When you select R-5 or R-6, a panel should slide in from the right without leaving the
 * Requests page ... the original request, screenshots, Claude's analysis, implementation
 * suggestions, decisions required, status, and a chronological activity history ... accept,
 * decline, request clarification, assign someone, or approve implementation directly from the
 * ticket."
 *
 * THE ACTIONS SAY THE NEXT STEP, not every status there is: a Submitted request offers Approve /
 * Request info / Decline; an Approved one Start development; one In development Release (with how
 * to test it, which the person who asked reads). Release is not the end: the person who asked
 * TESTS it (testState), here, with It works / Not right yet.
 */
export function RequestPanel({ r, files, users, me, onClose, onPrev, onNext, onChanged }: {
  r: ChangeRequest
  files: RequestFileMeta[]
  users: User[]
  me: User | null
  onClose: () => void
  onPrev: (() => void) | null
  onNext: (() => void) | null
  onChanged: () => void
}) {
  const userOf = (id: string | null) => (id ? users.find((u) => u.id === id) : undefined)
  const asker = userOf(r.created_by)
  const admin = mayDecide(me)
  const isAsker = me?.id === r.created_by
  const test = testState(r)
  const [events, setEvents] = useState<RequestEvent[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /* One box for words, used by whichever action needs them: a decline's reason, a question, how to test. */
  const [composing, setComposing] = useState<null | 'decline' | 'question' | 'comment' | 'sendback'>(null)
  const [words, setWords] = useState('')
  /* A question's options, one per line; empty is a question that wants words. */
  const [choiceWords, setChoiceWords] = useState('')
  const choices = parseChoices(choiceWords)

  const loadEvents = useCallback(() => {
    listEvents(r.id).then(setEvents).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [r.id])
  useEffect(() => { setEvents(null); setComposing(null); setWords(''); setChoiceWords(''); setError(null); loadEvents() }, [loadEvents])

  async function act(fn: () => Promise<void>) {
    setBusy(true); setError(null)
    try { await fn(); setComposing(null); setWords(''); setChoiceWords(''); onChanged(); loadEvents() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const move = (status: RequestStatus, note?: string) => act(() => updateRequest(r.id, {
    status, ...(note !== undefined ? { admin_note: note.trim() || null } : {}),
  }))

  /* Approve, and put it on Claude's queue, in one press. */
  async function approveAndBuild() {
    await act(async () => {
      await updateRequest(r.id, { status: 'accepted' })
      await askClaude(r, me, true)
    })
  }

  function submitWords() {
    const w = words.trim()
    if (!w || !me) return
    if (composing === 'decline') void move('declined', w)
    else if (composing === 'question') void act(() => addEvent(r.id, 'question', w, me.id, choices))
    else if (composing === 'comment') void act(() => addEvent(r.id, 'comment', w, me.id))
    else if (composing === 'sendback') void act(() => answerTest(r.number, false, w))
  }

  const PROMPT: Record<NonNullable<typeof composing>, { label: string; placeholder: string; button: string }> = {
    decline: { label: 'Why not? They are told.', placeholder: 'e.g. Covered by R-8, which does the same.', button: 'Decline' },
    question: { label: `Ask ${asker?.name ?? 'them'} — they are notified and can answer here.`, placeholder: 'e.g. Which reference do you mean: ours or the client’s?', button: 'Send question' },
    comment: { label: 'Add a note to the history.', placeholder: 'Write a note…', button: 'Add note' },
    sendback: { label: 'What is still not right?', placeholder: 'e.g. The reference is still missing on disputes.', button: 'Send it back' },
  }

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[30rem] flex-col border-l border-slate-200 bg-white shadow-2xl"
      data-testid="request-panel" data-number={r.number} aria-label={`Request ${requestLabel(r)}`}>
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
        <span className="rounded-md bg-navy-900 px-2 py-1 font-mono text-xs font-bold text-white">{requestLabel(r)}</span>
        <StagePill r={r} />
        <div className="ml-auto flex items-center gap-1">
          <IconButton label="Previous request" disabled={!onPrev} onClick={() => onPrev?.()}><ChevronLeft size={16} /></IconButton>
          <IconButton label="Next request" disabled={!onNext} onClick={() => onNext?.()}><ChevronRight size={16} /></IconButton>
          <IconButton label="Close" onClick={onClose}><X size={16} /></IconButton>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold leading-snug text-slate-800" data-testid="request-panel-title">{titleOf(r)}</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <Field label="Requested by">
              <span className="flex items-center gap-2">
                <UserAvatar userId={r.created_by} size={28} />
                <span><span className="block font-medium text-slate-800">{asker?.name ?? 'Somebody'}</span><span className="block text-xs text-slate-500">{asker?.role}</span></span>
              </span>
            </Field>
            <Field label="Sent">{formatDateTime(r.created_at)}</Field>
            <Field label="Department">{r.department ? <Chip tone="gold">{r.department}</Chip> : '—'}</Field>
            <Field label="Size">{r.review_size ? <Chip tone="slate">{r.review_size}</Chip> : '—'}</Field>
            <Field label="Pane">{r.pane ? (r.page_path ? <Link to={r.page_path} className="text-brand-700 hover:underline">{r.pane} →</Link> : r.pane) : '—'}</Field>
            <Field label="Assigned to">
              {admin ? (
                <select value={r.assigned_to ?? ''} disabled={busy} aria-label="Assigned to" data-testid="request-assign"
                  onChange={(e) => void act(() => updateRequest(r.id, { assigned_to: e.target.value || null }))}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs">
                  <option value="">Nobody yet</option>
                  {users.filter((u) => u.status !== 'Inactive').sort((a, b) => a.name.localeCompare(b.name))
                    .map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              ) : (userOf(r.assigned_to)?.name ?? 'Nobody yet')}
            </Field>
          </div>
        </div>

        <Section label="What they asked">
          <p className="whitespace-pre-wrap text-sm text-slate-800" data-testid="request-panel-description">{r.description}</p>
        </Section>

        {/* CLAUDE'S READING, kept apart from the status: a request can be Approved and still need an answer. */}
        {r.reviewed_at && (
          <div className="rounded-xl bg-slate-50 p-4" data-testid="request-panel-review">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Moon size={15} /> From the nightly review</p>
            <p className="mt-0.5 text-xs text-slate-500">Reviewed {formatDateTime(r.reviewed_at)}{r.review_verdict ? ` · ${VERDICT_LABEL[r.review_verdict]}` : ''}</p>
            {r.review_summary && <p className="mt-2 text-sm text-slate-700">{r.review_summary}</p>}
            {r.review_questions.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-amber-800">
                {r.review_questions.map((q, i) => <li key={i}>{q}</li>)}
              </ul>
            )}
          </div>
        )}

        {files.length > 0 && (
          <Section label={<span className="inline-flex items-center gap-1"><Paperclip size={12} /> Screenshots and files ({files.length})</span>}>
            <RequestFiles files={files} />
          </Section>
        )}

        {/* TESTED IS THE ASKER'S WORD. */}
        {test === 'waiting' && mayTest(me, r) && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid="request-test">
            <p className="text-sm font-semibold text-amber-900">{isAsker ? 'This is released. Please test it.' : `Waiting for ${asker?.name ?? 'the person who asked'} to test it.`}</p>
            <p className="mt-0.5 text-xs text-amber-900/80" data-testid="request-test-how">
              {r.admin_note ? <><strong className="font-medium">How to test:</strong> {r.admin_note}</> : 'Try what you asked for, then say here whether it works.'}
              {r.done_in ? ` (${r.done_in})` : ''}
            </p>
            {composing !== 'sendback' && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="primary" disabled={busy} data-testid="request-test-works" onClick={() => void act(() => answerTest(r.number, true, ''))}>It works</Button>
                <Button size="sm" variant="secondary" disabled={busy} data-testid="request-test-not-right" onClick={() => { setComposing('sendback'); setWords('') }}>Not right yet</Button>
              </div>
            )}
          </div>
        )}
        {test === 'works' && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800" data-testid="request-tested">Tested and working{r.tested_by ? `, said by ${userOf(r.tested_by)?.name ?? 'the person who asked'}` : ''}{r.tested_note ? `: ${r.tested_note}` : '.'}</p>}
        {test === 'sent back' && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">Sent back after testing: {r.tested_note}</p>}

        <Section label="Activity">
          {events === null ? <p className="text-xs text-slate-400"><Loader2 size={12} className="inline animate-spin" /> Reading the history…</p> : (
            <ol className="space-y-2.5" data-testid="request-activity">
              {events.map((e) => (
                <EventLine key={e.id} e={e} who={userOf(e.by_id)?.name ?? null}>
                  {(e.choices?.length ?? 0) >= 2 && (
                    <ChoiceAnswer q={e} answer={answerTo(e, events)} canAnswer={mayAnswer(me, r, e)} askerName={asker?.name ?? 'the person who asked'}
                      busy={busy} onAnswer={(body) => { if (me) void act(() => answerQuestion(r.id, e.id, body, me.id)) }} />
                  )}
                </EventLine>
              ))}
            </ol>
          )}
          {(admin || isAsker) && composing === null && (
            <button type="button" onClick={() => { setComposing('comment'); setWords('') }} className="mt-2 inline-flex items-center gap-1 text-xs text-brand-700 hover:underline" data-testid="request-add-note">
              <MessageSquare size={12} /> {isAsker && !admin ? 'Reply or add a note' : 'Add a note'}
            </button>
          )}
        </Section>

        {composing && (
          <div className="space-y-2 rounded-lg border border-slate-200 p-3" data-testid="request-compose">
            <p className="text-xs font-semibold text-slate-600">{PROMPT[composing].label}</p>
            <textarea value={words} onChange={(e) => setWords(e.target.value)} rows={3} autoFocus placeholder={PROMPT[composing].placeholder}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" data-testid="request-compose-words" />
            {composing === 'question' && (
              <label className="block space-y-1">
                <span className="text-xs text-slate-600">Options to tick, one per line (optional, up to {MAX_CHOICES}). They can always choose Other and write their own.</span>
                <textarea value={choiceWords} onChange={(e) => setChoiceWords(e.target.value)} rows={3}
                  placeholder={'e.g.\nRaptor\u2019s case number\nThe client\u2019s reference'}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" data-testid="request-compose-choices" />
                {!choicesOk(choices) && <span className="text-xs text-amber-700">Add a second option, or leave this empty to ask for words.</span>}
              </label>
            )}
            <div className="flex gap-2">
              <Button size="sm" variant={composing === 'decline' || composing === 'sendback' ? 'danger' : 'primary'} disabled={busy || !words.trim() || (composing === 'question' && !choicesOk(choices))}
                onClick={submitWords} data-testid="request-compose-send">{PROMPT[composing].button}</Button>
              <Button size="sm" variant="ghost" onClick={() => setComposing(null)}>Cancel</Button>
            </div>
          </div>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>

      {/* THE NEXT STEP, pinned to the bottom where a thumb finds it on the iPad. */}
      {admin && composing === null && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-3" data-testid="request-actions">
          {/*
            YOU DECIDE, CLAUDE BUILDS (the firm, 26 Oct: "it should only be released ... if you have
            told me that it's been done ... I would have to be able to ... click on it and say, okay,
            well, Claude, please do this"). In development and Released are Claude's moves, made when
            the work is on the preview -- there is no button here for them, so nothing reads as
            released that nobody built.
          */}
          {r.status === 'new' && <>
            <Button variant="primary" disabled={busy} onClick={() => void approveAndBuild()} data-testid="request-approve-build">Approve &amp; ask Claude</Button>
            <Button variant="secondary" disabled={busy} onClick={() => void move('accepted')} data-testid="request-approve">Approve only</Button>
            <Button variant="secondary" disabled={busy} onClick={() => setComposing('question')} icon={<HelpCircle size={14} />} data-testid="request-ask">Request info</Button>
            <Button variant="danger" disabled={busy} onClick={() => setComposing('decline')} data-testid="request-decline">Decline</Button>
          </>}
          {r.status === 'accepted' && <>
            {r.build_requested_at ? (
              <>
                <span className="text-xs text-violet-800" data-testid="request-queued">Queued for Claude since {formatDateTime(r.build_requested_at)}</span>
                <Button variant="ghost" disabled={busy} onClick={() => void act(() => askClaude(r, me, false))} data-testid="request-unqueue">Take it off the queue</Button>
              </>
            ) : (
              <Button variant="primary" disabled={busy} onClick={() => void act(() => askClaude(r, me, true))} data-testid="request-build">Ask Claude to build it</Button>
            )}
            <Button variant="secondary" disabled={busy} onClick={() => setComposing('question')} icon={<HelpCircle size={14} />} data-testid="request-ask">Request info</Button>
            <Button variant="danger" disabled={busy} onClick={() => setComposing('decline')} data-testid="request-decline">Decline</Button>
          </>}
          {r.status === 'building' && <>
            <span className="text-xs text-amber-800" data-testid="request-building">Claude is building it. It is released here, with how to test, when it is on the preview.</span>
            <Button variant="secondary" disabled={busy} onClick={() => setComposing('question')} icon={<HelpCircle size={14} />} data-testid="request-ask">Request info</Button>
          </>}
          {(r.status === 'done' || r.status === 'declined') && (
            <Button variant="secondary" disabled={busy} onClick={() => void move('accepted')} data-testid="request-reopen">Reopen</Button>
          )}
          <select value={r.priority} disabled={busy} aria-label="Priority" className="ml-auto rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
            onChange={(e) => void act(() => updateRequest(r.id, { priority: e.target.value as RequestPriority }))}>
            {(['high', 'normal', 'low'] as const).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]} priority</option>)}
          </select>
        </div>
      )}
      {!admin && mayWithdraw(me, r) && composing === null && (
        <div className="border-t border-slate-100 px-5 py-3">
          <button type="button" disabled={busy} onClick={() => void act(async () => { await withdrawRequest(r.id); onClose() })}
            className="text-xs text-slate-500 hover:text-red-700" data-testid="request-withdraw">Withdraw this request</button>
        </div>
      )}
    </aside>
  )
}

/** Where a request stands, with the asker's test beside it once it is released. */
export function StagePill({ r }: { r: ChangeRequest }) {
  const stage = stageOf(r)
  const tone = r.status === 'done' ? 'bg-emerald-50 text-emerald-700' : r.status === 'declined' ? 'bg-slate-100 text-slate-600'
    : r.status === 'building' ? 'bg-amber-50 text-amber-800' : r.status === 'accepted' ? 'bg-indigo-50 text-indigo-700'
      : stage === 'Reviewed' ? 'bg-violet-50 text-violet-700' : 'bg-sky-50 text-sky-700'
  const test = testState(r)
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`} data-testid="request-status">{stage}</span>
      {r.status === 'accepted' && r.build_requested_at && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-800" data-testid="request-queued-pill">Queued for Claude</span>}
      {test === 'works' && <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white">Tested ✓</span>}
      {test === 'waiting' && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">To test</span>}
      {test === 'sent back' && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">Sent back</span>}
    </span>
  )
}

/**
 * A QUESTION'S OPTIONS: ticks for the person who asked until they answer, then the one they chose,
 * ticked, for everybody. Other opens a box for their own words.
 */
function ChoiceAnswer({ q, answer, canAnswer, askerName, busy, onAnswer }: {
  q: RequestEvent; answer: Pick<RequestEvent, 'body' | 'at'> | null; canAnswer: boolean; askerName: string; busy: boolean; onAnswer: (body: string) => void
}) {
  const [pick, setPick] = useState<string | null>(null)
  const [other, setOther] = useState('')
  const choices = q.choices ?? []
  const open = canAnswer && !answer
  const ticked = answer ? tickedOf(choices, answer.body) : pick
  const send = answerBody(pick, other)
  return (
    <div className="mt-1.5 space-y-1" data-testid="request-choices" data-answered={answer ? 'yes' : 'no'}>
      {[...choices, OTHER_CHOICE].map((c) => {
        const on = ticked === c
        return (
          <button key={c} type="button" role="radio" aria-checked={on} disabled={!open || busy} onClick={() => setPick(c)} data-testid="request-choice"
            className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[13px] ${on ? 'border-emerald-400 bg-emerald-50 text-emerald-900' : 'border-slate-200 text-slate-700'} ${open ? 'hover:border-slate-300' : 'cursor-default'}`}>
            <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white'}`}>{on && <Check size={12} />}</span>
            <span>{c}</span>
          </button>
        )
      })}
      {open && pick === OTHER_CHOICE && (
        <textarea value={other} onChange={(e) => setOther(e.target.value)} rows={2} autoFocus placeholder="Your suggestion…"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" data-testid="request-choice-other" />
      )}
      {open && <Button size="sm" variant="primary" disabled={busy || !send} onClick={() => { if (send) onAnswer(send) }} data-testid="request-choice-send">Send answer</Button>}
      {answer && ticked === OTHER_CHOICE && <p className="text-[13px] text-emerald-900" data-testid="request-choice-other-said">{answer.body}</p>}
      {!answer && !canAnswer && <p className="text-xs text-slate-500">Waiting for {askerName} to choose.</p>}
    </div>
  )
}

function EventLine({ e, who, children }: { e: RequestEvent; who: string | null; children?: ReactNode }) {
  /* Nobody's name on a move is Claude's: the reviewer and the builder write as the database owner. */
  const name = who ?? (e.kind === 'reviewed' ? 'The nightly review' : 'Claude')
  const what = e.kind === 'sent' ? 'sent the request'
    : e.kind === 'reviewed' ? 'read it'
      : e.kind === 'status' ? `moved it to ${e.to_status ? STATUS_LABEL[e.to_status] : '?'}`
        : e.kind === 'tested' ? 'tested it'
          : e.kind === 'assigned' ? (e.body ? `gave it to ${e.body}` : 'took it off everybody')
            : e.kind === 'question' ? 'asked' : e.answers ? 'answered' : 'wrote'
  const body = e.kind === 'assigned' ? null : e.body
  return (
    <li className="flex gap-2.5 text-sm" data-kind={e.kind}>
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${e.kind === 'question' ? 'bg-amber-500' : e.kind === 'comment' ? 'bg-brand-500' : 'bg-slate-300'}`} />
      <div className="min-w-0">
        <p className="text-slate-700"><strong className="font-medium">{name}</strong> {what} <span className="text-xs text-slate-400">· {formatDateTime(e.at)}</span></p>
        {body && <p className={`mt-0.5 whitespace-pre-wrap rounded-md px-2 py-1 text-[13px] ${e.kind === 'question' ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-700'}`}>{body}</p>}
        {children}
      </div>
    </li>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <div className="mt-0.5 text-slate-700">{children}</div>
    </div>
  )
}

function Section({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      {children}
    </div>
  )
}

export function Chip({ tone, children }: { tone: 'gold' | 'slate'; children: ReactNode }) {
  return <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${tone === 'gold' ? 'bg-gold-100 text-navy-900' : 'bg-slate-100 text-slate-600'}`}>{children}</span>
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}
      className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-30">{children}</button>
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
