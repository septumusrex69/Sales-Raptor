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
    hint: `Nothing logged in ${QUIET_VIEW_DAYS} days — including accounts never worked at all.`,
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
