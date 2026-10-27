import type { User } from '../types.js'

/**
 * "REQUEST A CHANGE" FROM INSIDE RAPTOR (S12, 26 Oct).
 *
 * THE FIRM: "As people are testing the software, I want them to ... queue things for me so that I
 * can code it ... You take a screenshot of what you need and then you put it in Raptor ... and a
 * description of what changes you want. And then it would flag on my side." Then: "Anyone can see
 * requests", and every night a session "can check for new requests ... and then show them to me in
 * the group list."
 *
 * Anybody sends one and sees them all; only an Administrator moves one along -- the database says so
 * (change_requests_update), and this file says the same in the browser. The night's review is a
 * Claude session writing one change_request_reviews row; it groups and asks, it never builds.
 *
 * PURE: no Supabase, no DOM, so check-change-requests can hold it. The browser's shrinking of a
 * picture is in RequestChangeModal; the database calls are in changeRequestsApi.
 */

export type RequestStatus = 'new' | 'accepted' | 'building' | 'done' | 'declined'
export type RequestPriority = 'low' | 'normal' | 'high'

export interface ChangeRequest {
  id: string
  number: number
  description: string
  page_path: string | null
  page_title: string | null
  /** The pane it was sent from (paneOf), stored as it was then. Null on the first few requests. */
  pane: string | null
  /** The department it is for, chosen by the sender. Null on the first few requests. */
  department: RequestDepartment | null
  status: RequestStatus
  priority: RequestPriority
  admin_note: string | null
  done_in: string | null
  created_by: string
  created_at: string
  decided_by: string | null
  decided_at: string | null
  closed_at: string | null
  /** The asker's answer once it is Done (change_request_tested): true works, false sent back. */
  tested_ok: boolean | null
  tested_note: string | null
  tested_at: string | null
  tested_by: string | null
  /** Who is building or answering it (feedback_centre). */
  assigned_to: string | null
  /*
   * THE NIGHTLY REVIEW'S READING OF IT -- not its status (the firm: "a request can be Accepted while
   * Claude's review says Needs clarification. Those are two different things"). Written by the
   * scheduled session; null until a night has read it.
   */
  review_title: string | null
  review_verdict: ReviewVerdict | null
  review_size: 'small' | 'medium' | 'large' | null
  review_summary: string | null
  review_questions: string[]
  reviewed_at: string | null
  /** On Claude's build queue since (Raptor H12): set by "Ask Claude to build it", cleared by the builder. */
  build_requested_at: string | null
  build_requested_by: string | null
}

export type ReviewVerdict = 'ready' | 'decision' | 'blocked'
export const VERDICT_LABEL: Record<ReviewVerdict, string> = {
  ready: 'Ready to implement', decision: 'Needs your decision', blocked: 'Blocked',
}

/** One line of a request's history (change_request_events). */
export interface RequestEvent {
  id: string
  request_id: string
  kind: 'sent' | 'reviewed' | 'status' | 'tested' | 'assigned' | 'comment' | 'question' | 'edited'
  body: string | null
  from_status: RequestStatus | null
  to_status: RequestStatus | null
  by_id: string | null
  at: string
  /** A question's options to tick (Raptor H12); null on a question that wants words. */
  choices?: string[] | null
  /** The question this comment answers, when it is a ticked answer. */
  answers?: string | null
}

/*
 * A QUESTION WITH OPTIONS TO TICK (Raptor H12). The firm, of the plain question on R-6: "Can't we
 * build this like you have ... to choose the option by means of a tick. Or choose other. And then
 * write other suggestion." So a question may carry two to six choices, and the person who asked
 * answers by ticking one -- or Other, with their own words. The answer is an ordinary comment with
 * `answers` pointing at the question, so it notifies the Administrators the way any reply does and
 * reads in the history as what it is, and the builder finds it where it already looks.
 */
export const OTHER_CHOICE = 'Other'
export const MAX_CHOICES = 6

/** The choices typed one per line: numbering and bullets dropped, blanks and repeats gone, at most six. */
export function parseChoices(text: string): string[] {
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const c = line.replace(/^\s*(?:\d+[.)]|[-•*])\s*/, '').trim()
    if (c && c.toLowerCase() !== OTHER_CHOICE.toLowerCase() && !out.some((o) => o.toLowerCase() === c.toLowerCase())) out.push(c)
  }
  return out.slice(0, MAX_CHOICES)
}

/** One choice needs no more; at least two are what make it a choice. */
export function choicesOk(choices: string[]): boolean {
  return choices.length === 0 || choices.length >= 2
}

/** What a tick sends: the choice as written, or "Other: <their words>"; null while it says nothing. */
export function answerBody(choice: string | null, other: string): string | null {
  if (choice === null) return null
  if (choice !== OTHER_CHOICE) return choice
  const w = other.trim()
  return w ? `${OTHER_CHOICE}: ${w}` : null
}

/** The answer given to a question, if any -- the latest, should two have crossed. */
export function answerTo<E extends Pick<RequestEvent, 'kind' | 'answers' | 'at'>>(q: Pick<RequestEvent, 'id'>, events: E[]): E | null {
  const a = events.filter((e) => e.kind === 'comment' && e.answers === q.id)
  return a.length ? a.reduce((x, y) => (y.at > x.at ? y : x)) : null
}

/** Which tick the answer was: a listed choice, Other, or none of them (null). */
export function tickedOf(choices: string[], body: string | null): string | null {
  if (!body) return null
  if (choices.includes(body)) return body
  return body.startsWith(`${OTHER_CHOICE}:`) ? OTHER_CHOICE : null
}

/** The person who asked answers their own request's questions; an Administrator answers for nobody. */
export function mayAnswer(user: Pick<User, 'id'> | null | undefined, r: Pick<ChangeRequest, 'created_by'>, q: Pick<RequestEvent, 'kind' | 'choices'>): boolean {
  return !!user && user.id === r.created_by && q.kind === 'question' && (q.choices?.length ?? 0) >= 2
}

export interface RequestFileMeta {
  id: string
  request_id: string
  name: string
  mime: string
  bytes: number
  purged_at: string | null
}

export interface ReviewGroup {
  title: string
  request_numbers: number[]
  what: string
  questions: string[]
  size: 'small' | 'medium' | 'large' | null
}

export interface RequestReview {
  id: string
  created_at: string
  summary: string
  groups: ReviewGroup[]
  /** Every request the night read -- what its tiles count and filter to. */
  request_ids: string[]
}

/*
 * WHICH PANE, WHICH DEPARTMENT (the firm, 26 Oct): "it should be clear ... in which pane is it coming
 * from, to which department is it relevant ... is it in collections, is it in sales, is it in comms
 * ... or just an overall function." The pane is read off the address; the department is the
 * sender's choice, suggested from the pane, because a liaison asking about the Accounts screen may
 * be asking for the call centre or for herself. The database holds the same list
 * (change_requests_department_known).
 */
export const REQUEST_DEPARTMENTS = ['Call centre', 'Sales', 'Communications', 'Finance', 'Administration', 'Whole system'] as const
export type RequestDepartment = typeof REQUEST_DEPARTMENTS[number]
export const DEPARTMENT_HINT: Record<RequestDepartment, string> = {
  'Call centre': 'Collections: accounts, the diary, debtors, disputes',
  Sales: 'Leads, deals, contacts, proposals',
  Communications: 'Clients and their liaisons, handover sheets, news',
  Finance: 'Trust, payovers, the business account',
  Administration: 'People, leave, settings, the library',
  'Whole system': 'Something everywhere: menus, mail, search, speed',
}

/** Most specific first: /dashboard/collections must not be read as the Dashboard. */
const PANES: { test: RegExp; pane: string; department: RequestDepartment }[] = [
  { test: /^\/dashboard\/collections/, pane: 'Collections dashboard', department: 'Call centre' },
  { test: /^\/dashboard\/sales/, pane: 'Sales dashboard', department: 'Sales' },
  { test: /^\/accounts/, pane: 'Accounts', department: 'Call centre' },
  { test: /^\/diary/, pane: 'Diary', department: 'Call centre' },
  { test: /^\/performance/, pane: 'Collections', department: 'Call centre' },
  { test: /^\/queries/, pane: 'Disputes', department: 'Call centre' },
  { test: /^\/leads/, pane: 'Leads', department: 'Sales' },
  { test: /^\/deals/, pane: 'Deals', department: 'Sales' },
  { test: /^\/contacts/, pane: 'Contacts', department: 'Sales' },
  { test: /^\/reps/, pane: 'Rep performance', department: 'Sales' },
  { test: /^\/companies/, pane: 'Clients', department: 'Communications' },
  { test: /^\/(news|campaigns)/, pane: 'News & campaigns', department: 'Communications' },
  { test: /^\/trust/, pane: 'Trust', department: 'Finance' },
  { test: /^\/business/, pane: 'Business', department: 'Finance' },
  { test: /^\/people/, pane: 'People', department: 'Administration' },
  { test: /^\/settings/, pane: 'Settings', department: 'Administration' },
  { test: /^\/library/, pane: 'Library', department: 'Administration' },
  { test: /^\/reports/, pane: 'Reports', department: 'Whole system' },
  { test: /^\/mail/, pane: 'Mail', department: 'Whole system' },
  { test: /^\/(tasks|calendar|activities)/, pane: 'Tasks & calendar', department: 'Whole system' },
  { test: /^\/requests/, pane: 'Requests', department: 'Whole system' },
  { test: /^\/$/, pane: 'Dashboard', department: 'Whole system' },
]

/** The pane an address belongs to, and the department it suggests. Unknown pages: the whole system. */
export function paneOf(path: string | null | undefined): { pane: string; department: RequestDepartment } {
  const p = (path ?? '').split(/[?#]/)[0] || '/'
  const hit = PANES.find((x) => x.test.test(p))
  return hit ? { pane: hit.pane, department: hit.department } : { pane: 'Other', department: 'Whole system' }
}

/** In the order a request travels, and the words the screen uses. */
export const STATUSES: RequestStatus[] = ['new', 'accepted', 'building', 'done', 'declined']
/*
 * THE FIRM'S WORKFLOW WORDS (Raptor H12): "Submitted, Reviewed, Approved, In development, Released."
 * The stored values stay what they were (new / accepted / building / done) -- the policies, the
 * triggers and every row already say them -- and only the words change. "Reviewed" is not a status
 * anybody sets: it is a Submitted request a night has read (stageOf).
 */
export const STATUS_LABEL: Record<RequestStatus, string> = {
  new: 'Submitted', accepted: 'Approved', building: 'In development', done: 'Released', declined: 'Declined',
}

/** Where a request stands in the workflow, Reviewed included. */
export function stageOf(r: Pick<ChangeRequest, 'status' | 'reviewed_at'>): string {
  return r.status === 'new' && r.reviewed_at ? 'Reviewed' : STATUS_LABEL[r.status]
}

/** Its title: the night's short title where there is one, else the first line the person wrote. */
export function titleOf(r: Pick<ChangeRequest, 'review_title' | 'description'>): string {
  return (r.review_title ?? '').trim() || r.description.trim().split(/\n+/)[0] || 'Untitled request'
}

/*
 * THE SHELVES SAY WHOSE MOVE IT IS (Stephan, S14, 27 Oct: "everything is a little bit confusing
 * here ... maybe we should move it from new to somewhere else, testing, declined, or accepted").
 * H12's single Open shelf mixed what waits on HIM with what waits on Claude, and Released mixed what
 * waits on the tester with what is finished. Now:
 *   decide    -- Needs a decision: new (read by the night or not), or approved and not yet given to Claude
 *   claude    -- With Claude: on the build queue, or being built
 *   test      -- To test: released and not yet tested ("Not right yet" sends it back to approved)
 *   finished  -- Done: released and tested ✓
 * The stored statuses are unchanged; this is only how the list sorts them.
 */
export type Shelf = 'decide' | 'claude' | 'test' | 'finished' | 'declined' | 'all'
export const SHELVES: readonly [Shelf, string][] = [
  ['decide', 'Needs a decision'], ['claude', 'With Claude'], ['test', 'To test'], ['finished', 'Done'], ['declined', 'Declined'], ['all', 'All'],
]
export function onShelf(r: Pick<ChangeRequest, 'status' | 'build_requested_at' | 'tested_ok'>, shelf: Shelf): boolean {
  switch (shelf) {
    case 'all': return true
    case 'decide': return r.status === 'new' || (r.status === 'accepted' && !r.build_requested_at)
    case 'claude': return r.status === 'building' || (r.status === 'accepted' && !!r.build_requested_at)
    case 'test': return r.status === 'done' && r.tested_ok !== true
    case 'finished': return r.status === 'done' && r.tested_ok === true
    case 'declined': return r.status === 'declined'
  }
}

/**
 * Is an open request waiting for the person who asked to answer a question? A question with options
 * waits until it is ticked; a question for words waits until they write anything after it. Questions
 * answer themselves no other way -- an Administrator's own note does not answer for them.
 */
export function waitingOnAsker(
  r: Pick<ChangeRequest, 'id' | 'created_by' | 'status'>,
  events: Pick<RequestEvent, 'id' | 'request_id' | 'kind' | 'by_id' | 'at' | 'answers' | 'choices'>[],
): boolean {
  if (!isOpen(r.status)) return false
  const mine = events.filter((e) => e.request_id === r.id)
  return mine.some((q) => q.kind === 'question' && !mine.some((a) => a.kind === 'comment' && (
    (q.choices?.length ?? 0) >= 2 ? a.answers === q.id : (a.by_id === r.created_by && a.at > q.at))))
}

/** A night's tiles: how many of the requests it read are ready, need a decision, or are blocked. */
export function reviewTiles(rows: Pick<ChangeRequest, 'id' | 'review_verdict'>[], ids: string[]): Record<'reviewed' | ReviewVerdict, number> {
  const mine = rows.filter((r) => ids.includes(r.id))
  return {
    reviewed: ids.length,
    ready: mine.filter((r) => r.review_verdict === 'ready').length,
    decision: mine.filter((r) => r.review_verdict === 'decision').length,
    blocked: mine.filter((r) => r.review_verdict === 'blocked').length,
  }
}
export const PRIORITY_LABEL: Record<RequestPriority, string> = { low: 'Low', normal: 'Normal', high: 'High' }

/** Open is everything still to be decided or built: not yet released or declined. */
export function isOpen(s: RequestStatus): boolean {
  return s === 'new' || s === 'accepted' || s === 'building'
}

/** The firm decides what gets built: the role, as the database's policy writes it. */
export function mayDecide(user: Pick<User, 'role'> | null | undefined): boolean {
  return user?.role === 'Administrator'
}

/** The person who sent it may take it back while nobody has looked at it. */
/*
 * WHO MAY CORRECT THE WORDS, AND UNTIL WHEN (S14, Stephan: "edit a request after it's already been sent
 * through, just to correct spelling, mistakes"). The sender or an Administrator, until Claude starts
 * building -- New, Approved or Queued for Claude. The database holds the same rule
 * (change_request_edit) and keeps the words it replaced on the history.
 */
export function mayEdit(user: Pick<User, 'id' | 'role'> | null | undefined, r: Pick<ChangeRequest, 'created_by' | 'status'>): boolean {
  return !!user && (user.id === r.created_by || user.role === 'Administrator') && (r.status === 'new' || r.status === 'accepted')
}

export function mayWithdraw(user: Pick<User, 'id'> | null | undefined, r: Pick<ChangeRequest, 'created_by' | 'status'>): boolean {
  return !!user && r.created_by === user.id && r.status === 'new'
}

/*
 * TESTED IS THE ASKER'S WORD, DONE IS THE BUILDER'S (Raptor H12; the firm: "so that she can test it
 * and approve that ... it works"). An answer counts only if it came AFTER the request was last
 * marked Done -- a request sent back, rebuilt and marked Done again is waiting for a new answer,
 * whatever the old one said.
 */
export type TestState = 'not done' | 'waiting' | 'works' | 'sent back'
export function testState(r: Pick<ChangeRequest, 'status' | 'tested_ok' | 'tested_at' | 'decided_at'>): TestState {
  if (r.status !== 'done') return r.tested_ok === false && r.status === 'accepted' ? 'sent back' : 'not done'
  const fresh = !!r.tested_at && (!r.decided_at || r.tested_at >= r.decided_at)
  return fresh && r.tested_ok === true ? 'works' : 'waiting'
}

/** Who may answer: the person who asked, or an Administrator answering for them. */
export function mayTest(user: Pick<User, 'id' | 'role'> | null | undefined, r: Pick<ChangeRequest, 'created_by'>): boolean {
  return !!user && (user.id === r.created_by || user.role === 'Administrator')
}

/** "R-12": what people say out loud, and what the night's review groups by. */
export function requestLabel(r: Pick<ChangeRequest, 'number'>): string {
  return `R-${r.number}`
}

/*
 * WHAT MAY BE ATTACHED, AND HOW BIG. A screenshot is shrunk in the browser to at most
 * PICTURE_MAX_SIDE on its longer side before it leaves (a phone photo's size), so these limits are
 * for what arrives AFTER that. The database holds the same numbers (change_request_files): a file
 * is a column there so a Claude session can read it, and Supabase ran out of room once already.
 */
export const PICTURE_MAX_SIDE = 1600
export const MAX_FILE_BYTES = 5 * 1024 * 1024
export const MAX_FILES = 5
export const ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const

/** Why a file may not go, or null. Said before anything is sent. */
export function fileProblem(f: { name: string; type: string; size: number }): string | null {
  const isImage = f.type.startsWith('image/')
  if (!isImage && f.type !== 'application/pdf') return `${f.name} is not a picture or a PDF.`
  /* A picture is shrunk before it is measured, so only a PDF can be refused for size here. */
  if (!isImage && f.size > MAX_FILE_BYTES) return `${f.name} is ${(f.size / 1048576).toFixed(1)} MB; a PDF may be 5 MB at most.`
  return null
}

/** The size a picture is drawn at to fit PICTURE_MAX_SIDE, never enlarged. */
export function fitWithin(width: number, height: number, max = PICTURE_MAX_SIDE): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 }
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/** Base64 length -> bytes, for the row's `bytes`. */
export function base64Bytes(b64: string): number {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad)
}

/**
 * THE NIGHT'S GROUPS, READ DEFENSIVELY. A session writes them as JSON through SQL; a missing field
 * or a number written as a string must not take the screen down, and a group with no title is not
 * a group. Anything unreadable is dropped rather than drawn half.
 */
export function parseReviewGroups(raw: unknown): ReviewGroup[] {
  if (!Array.isArray(raw)) return []
  const out: ReviewGroup[] = []
  for (const g of raw) {
    if (!g || typeof g !== 'object') continue
    const o = g as Record<string, unknown>
    const title = typeof o.title === 'string' ? o.title.trim() : ''
    if (!title) continue
    const numbers = Array.isArray(o.request_numbers)
      ? o.request_numbers.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0)
      : []
    const size = o.size === 'small' || o.size === 'medium' || o.size === 'large' ? o.size : null
    out.push({
      title,
      request_numbers: [...new Set(numbers)],
      what: typeof o.what === 'string' ? o.what.trim() : '',
      questions: Array.isArray(o.questions) ? o.questions.filter((q): q is string => typeof q === 'string' && !!q.trim()).map((q) => q.trim()) : [],
      size,
    })
  }
  return out
}

/** Newest first, and within a day the high ones on top -- the order the list is read in. */
export function sortRequests<R extends Pick<ChangeRequest, 'created_at' | 'priority' | 'number'>>(rows: R[]): R[] {
  const weight: Record<RequestPriority, number> = { high: 0, normal: 1, low: 2 }
  return [...rows].sort((a, b) =>
    weight[a.priority] - weight[b.priority] || b.created_at.localeCompare(a.created_at) || b.number - a.number)
}
