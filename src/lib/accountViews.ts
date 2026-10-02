/**
 * The questions somebody opens the account list to ask.
 *
 * THE DEFAULT VIEW WAS THE PROBLEM. Six figures of accounts sorted alphabetically by account
 * number is nobody's question — you open the book, you land on "Abc1111", and you cannot tell
 * whether you are looking at the whole thing or a stray filter. The answer is not to start blank
 * and make people build a query before they see anything; it is to land somewhere worth landing.
 *
 * A view is nothing but a set of URL parameters with a name and a count. That matters: clicking
 * one leaves the URL saying exactly what is on screen, so a view can be pasted, bookmarked,
 * narrowed further by hand, and cleared — none of which is true of a hidden "mode".
 *
 * The counts are what turn these from links into queues. "No diary date" gets clicked once;
 * "No diary date 355" gets worked.
 */

import type { Department } from './departments'

export type AccountViewId =
  | 'whole_book'
  | 'my_desk'
  | 'unallocated'
  | 'adrift'
  | 'broken_promises'
  | 'promises_due'
  | 'gone_quiet'

export interface AccountView {
  id: AccountViewId
  label: string
  /** One line on hover. What the view means, in the firm's terms rather than the column's. */
  hint: string
  /** Only a team leader or administrator is offered this one. */
  leadersOnly?: boolean
  /** The key in account_view_counts this view's badge reads. */
  countKey: string
}

/** How many days of silence counts as quiet, for the view. The filter panel offers others. */
export const QUIET_VIEW_DAYS = 30

export const ACCOUNT_VIEWS: AccountView[] = [
  {
    id: 'whole_book',
    label: 'Whole book',
    hint: 'Every account, narrowed by nothing.',
    countKey: 'whole_book',
  },
  {
    id: 'my_desk',
    label: 'My desk',
    hint: 'The accounts allocated to you.',
    countKey: 'my_desk',
  },
  {
    id: 'unallocated',
    label: 'Unallocated',
    hint: 'On nobody’s desk. Nothing here is anybody’s job until it is shared out.',
    leadersOnly: true,
    countKey: 'unallocated',
  },
  {
    id: 'adrift',
    label: 'No diary date',
    hint: 'Live, and nobody is booked to ring it. The firm’s own hole, not the debtor’s.',
    countKey: 'adrift',
  },
  {
    /*
     * READS THE BUCKET, NOT THE SUB-STATUS, and the difference is not academic. Swordfish files
     * 40 accounts under 'Failed PTPs' while only 3 carry sub-status 'Payment Default' — and 13 of
     * the 40 still say 'Promise To Pay', a live promise the old system had already flagged as
     * broken. Reading the sub-status here would find three of the forty.
     */
    id: 'broken_promises',
    label: 'Broken promises',
    hint: 'A promised payment did not arrive. Speed is what recovers these.',
    countKey: 'broken_promises',
  },
  {
    id: 'promises_due',
    label: 'Promises due',
    hint: 'The debtor has promised to pay. These are the ones to confirm.',
    countKey: 'promises_due',
  },
  {
    id: 'gone_quiet',
    label: 'Gone quiet',
    /* The firm's words: an account has ACTIONS logged against it. "Never worked" is what you do
       to a construction site. accountBook's own note already said it the right way round. */
    hint: `No action logged in ${QUIET_VIEW_DAYS} days — including accounts with none at all yet.`,
    countKey: 'gone_quiet',
  },
]

/**
 * The URL a view asks for.
 *
 * `currentUserId` rather than a magic "me" token in the URL: a link to "my desk" that means a
 * different desk depending on who opens it is a link that cannot be sent to anybody, which is
 * most of what a link is for.
 */
export function viewParams(id: AccountViewId, currentUserId: string | null): URLSearchParams {
  const p = new URLSearchParams()
  switch (id) {
    case 'whole_book': break
    case 'my_desk': if (currentUserId) p.set('who', currentUserId); break
    case 'unallocated': p.set('who', 'nobody'); break
    case 'adrift': p.set('adrift', '1'); break
    case 'broken_promises': p.set('bucket', 'Failed PTPs'); break
    case 'promises_due': p.set('sub', 'Promise To Pay'); break
    case 'gone_quiet': p.set('quiet', String(QUIET_VIEW_DAYS)); break
  }
  return p
}

/**
 * Which view the screen is currently showing, if any.
 *
 * EXACT MATCH, not "contains". A view is lit only when the filters are precisely its own —
 * because the moment somebody narrows a view by hand it has stopped being that view, and a tab
 * that stays lit while the list beneath it says something else is worse than no tab at all.
 *
 * The client is excluded from the comparison: scoping the book to one client is orthogonal to
 * which question is being asked of it, and "My desk, at Growthpoint" is still My desk.
 */
export function activeView(params: URLSearchParams, currentUserId: string | null): AccountViewId | null {
  const actual = new URLSearchParams(params)
  actual.delete('client')
  actual.delete('page')

  for (const view of ACCOUNT_VIEWS) {
    const want = viewParams(view.id, currentUserId)
    if (sameParams(actual, want)) return view.id
  }
  return null
}

function sameParams(a: URLSearchParams, b: URLSearchParams): boolean {
  const keys = new Set([...a.keys(), ...b.keys()])
  for (const k of keys) {
    // A key present but empty is the same as absent: the filter panel writes '' to clear.
    if ((a.get(k) ?? '') !== (b.get(k) ?? '')) return false
  }
  return true
}

export interface ViewCounts {
  whole_book: number
  my_desk: number
  unallocated: number
  adrift: number
  broken_promises: number
  promises_due: number
  gone_quiet: number
}

/** The views this person is offered. An agent is not shown the unallocated pile; it is not theirs. */
export function viewsFor(canSeeOtherDesks: boolean): AccountView[] {
  return ACCOUNT_VIEWS.filter((v) => !v.leadersOnly || canSeeOtherDesks)
}

/* ---------------------------------------------------------------------------------------------
 * WHERE THE BOOK OPENS, AND WHY IT IS NOT THE WHOLE BOOK.
 *
 * THE FIRM: "when a debt collector or a team leader, you know, like a pre-legal clerk, if they go
 * in on the accounts pane, they can see all the accounts. Now, that's fine. But I think by default
 * they should only see their own book unless they change the scope function. They should be able to
 * see any account in the book, but when they click on Accounts, what they view is their accounts
 * that they are working."
 *
 * BOTH HALVES MATTER AND THE SECOND IS THE EASY ONE TO LOSE. This is a landing, not a permission:
 * nothing is hidden, Whole book stays one click away with its own count on it, and a pasted link to
 * somebody else's account still opens. What changes is only what you see when you ask for nothing
 * in particular -- and the whole book is nobody's question. A collector opening twenty-three
 * thousand accounts sorted by account number has to build a filter before the screen is about their
 * day, and the one view that always is sat behind a click.
 *
 * DERIVED FROM THE DEPARTMENT, NOT FROM A SECOND LIST OF ROLES. The call centre is the department
 * whose people carry accounts and a diary -- departments.ts says so in its own blurb -- and
 * COLLECTING_ROLES is already derived from the same map for the hand-out box. A fourth hand-written
 * role list is the drift this codebase has watched happen twice.
 *
 * AN EMPTY DESK IS A TRUE SCREEN, not a broken one, so a collector with nothing allocated still
 * lands on My desk and reads that they have none -- which is the fact they need. What would be a
 * broken screen is landing an ADMINISTRATOR there: they carry no book at all, so an empty My desk
 * would be the whole of what Raptor showed them, and they get the book they actually work with.
 * ------------------------------------------------------------------------------------------- */

/**
 * The view somebody lands on when they ask for the book and nothing else.
 *
 * Pure and role-shaped rather than count-shaped: deciding it off a live count means the first
 * paint is one view and the second is another, and a screen that moves under somebody is worse
 * than a screen that opened somewhere they did not expect.
 */
export function landingView(department: Department): AccountViewId {
  return department === 'Call centre' ? 'my_desk' : 'whole_book'
}

/**
 * Should a bare /accounts be redirected, and to what?
 *
 * NULL FOR ANYTHING THE URL ALREADY SAYS, which is the guard the whole thing rests on. THE URL IS
 * THE STATE on this screen -- a view is nothing but parameters -- so a link somebody was sent, a
 * bookmark, a filter they built, and the Whole book button itself all produce a URL that must win.
 * Only the complete absence of a question gets an answer put in its place.
 *
 * `client` and `page` are not questions. Arriving from a client record at /accounts?client=X is
 * still "show me the book" -- about one client -- so it lands on that client's share of my desk
 * rather than on their whole book, and the parameter is carried through.
 */
export function landingParams(
  params: URLSearchParams,
  department: Department,
  currentUserId: string | null,
): URLSearchParams | null {
  const asked = new URLSearchParams(params)
  asked.delete('client')
  asked.delete('page')
  if ([...asked.keys()].some((k) => (asked.get(k) ?? '') !== '')) return null

  const view = landingView(department)
  /* NOTHING TO REDIRECT TO. `my_desk` without an id is the whole book wearing a different name --
     see viewParams -- so a session that has not resolved its user yet is left alone rather than
     sent somewhere that means something else. */
  if (view === 'whole_book' || !currentUserId) return null

  const next = viewParams(view, currentUserId)
  const client = params.get('client')
  if (client) next.set('client', client)
  return next
}
