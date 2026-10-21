/**
 * THREE BOOKS: ACTIVE, ON HOLD AND CLOSED.
 *
 * THE FIRM, AFTER THE FIRST TEST IMPORT: "The Accounts screen opens on 'Whole book', which mixes
 * accounts collectors should ring today with accounts that are paid up, written off, withdrawn or
 * frozen. The tiles add them all together: 'Capital handed over R438 769' includes R71 287 on
 * KIS0007, which is paid in full. The work shortcuts (Gone quiet 19, No diary date and so on) count
 * closed and frozen accounts nobody may chase."
 *
 * THE BOOK IS DERIVED, NOT SET. `debtor_accounts.book` is a stored generated column over the row's
 * own closure and hold fields, and this file is the browser's reading of the SAME rule -- it does
 * not decide anything the database has not already decided. The firm's instruction was explicit:
 * "do not add a second status that can drift from the first."
 *
 * WHOLE BOOK IS A FOURTH CHOICE AND NOT A BOOK. It is search and audit: every account, narrowed by
 * nothing. It stays available and it is no longer where the screen opens.
 */

export type Book = 'active' | 'on_hold' | 'closed'
/** What the chooser offers. `whole` is not a book -- it is the absence of one. */
export type BookChoice = Book | 'whole'

export const BOOK_CHOICES: {
  id: BookChoice
  label: string
  /** One line on hover: what is in it, and who reads it. */
  hint: string
  countKey: 'active' | 'on_hold' | 'closed' | 'whole_book'
}[] = [
  {
    id: 'active',
    label: 'Active',
    hint: 'Open and workable: new, a demand running, promises and arrangements, re-opened. '
      + 'What a collector rings today.',
    countKey: 'active',
  },
  {
    id: 'on_hold',
    label: 'On hold',
    hint: 'Stopped for a reason, with a date to look again: frozen, debt review, deceased, '
      + 'insolvent, a written dispute, or waiting on the client.',
    countKey: 'on_hold',
  },
  {
    id: 'closed',
    label: 'Closed',
    hint: 'Paid up, settled, written off or withdrawn. History, reporting and payovers.',
    countKey: 'closed',
  },
  {
    id: 'whole',
    label: 'Whole book',
    hint: 'Every account, narrowed by nothing. For finding one, not for working a list.',
    countKey: 'whole_book',
  },
]

/** Where the Accounts screen opens. Not the whole book, which is nobody's question. */
export const DEFAULT_BOOK: BookChoice = 'active'

export function bookLabel(book: string | null | undefined): string {
  return BOOK_CHOICES.find((b) => b.id === book)?.label ?? 'Active'
}

/** A URL's `book`, or the default. An unknown value narrows to the default rather than to nothing. */
export function parseBook(value: string | null | undefined): BookChoice {
  return BOOK_CHOICES.some((b) => b.id === value) ? (value as BookChoice) : DEFAULT_BOOK
}

/* ------------------------------------------------------------------------------------------
 * ON HOLD: THE SEVEN REASONS, AND EVERY ONE OF THEM NEEDS A DATE
 * ------------------------------------------------------------------------------------------ */

export type HoldReason =
  | 'frozen' | 'debt_review' | 'deceased' | 'insolvent'
  | 'business_rescue' | 'dispute_in_writing' | 'awaiting_client'

export const HOLD_REASONS: { id: HoldReason; label: string; blurb: string }[] = [
  { id: 'frozen', label: 'Frozen',
    blurb: 'The client asked for work to stop, or the firm did. Nothing is wrong with the file.' },
  { id: 'debt_review', label: 'Under debt review',
    blurb: 'A debt counsellor is on it. Section 86 stops collection on this debt.' },
  { id: 'deceased', label: 'Deceased',
    blurb: 'The debtor has died. The claim is against the estate and goes to the executor.' },
  { id: 'insolvent', label: 'Insolvent or sequestrated',
    blurb: 'Handled by the trustee. Nothing may be demanded from the debtor direct.' },
  { id: 'business_rescue', label: 'Business rescue',
    blurb: 'A moratorium is in force under chapter 6. The practitioner is the point of contact.' },
  { id: 'dispute_in_writing', label: 'Dispute received in writing',
    blurb: 'A written dispute is open and unresolved. Collection waits on the answer.' },
  { id: 'awaiting_client', label: 'Waiting on the client',
    blurb: 'An instruction, a document or a decision is outstanding from the client.' },
]

export function holdLabel(reason: string | null | undefined): string {
  return HOLD_REASONS.find((h) => h.id === reason)?.label ?? 'On hold'
}

/*
 * THE FOUR OF THESE THAT ARE ALSO CALL-SCRIPT HARD STOPS. The firm's own list -- deceased, debt
 * review, insolvent, a written dispute -- is the one the scripts already refuse to dial on, and
 * putting an account on hold for one of them is saying the same thing about the whole file.
 * Named here so the two cannot drift: a reason added to one and not the other is an account the
 * screen says is on hold and the dialler still rings.
 */
export const HARD_STOP_HOLDS: HoldReason[] = [
  'deceased', 'debt_review', 'insolvent', 'dispute_in_writing',
]

/* ------------------------------------------------------------------------------------------
 * CLOSED: THE FOUR ENDINGS
 * ------------------------------------------------------------------------------------------ */

export type ClosureKind = 'paid_up' | 'settled' | 'written_off' | 'withdrawn'

export const CLOSURE_KINDS: { id: ClosureKind; label: string }[] = [
  { id: 'paid_up', label: 'Paid up' },
  { id: 'settled', label: 'Settled' },
  { id: 'written_off', label: 'Written off' },
  { id: 'withdrawn', label: 'Withdrawn by the client' },
]

export function closureLabel(kind: string | null | undefined): string {
  return CLOSURE_KINDS.find((c) => c.id === kind)?.label ?? 'Closed'
}

/**
 * HOW AN ACCOUNT ENDED, FOR A ROW THAT CAME FROM SWORDFISH AND NEVER SAID.
 *
 * `ended_as` is the firm's own assertion and wins wherever it exists. The eight written-off test
 * accounts have none: they carry the status 'Written-off' and a `write_off_reason` in Swordfish's
 * words, and IMPORTED HISTORY IS FROZEN AT WHAT WAS IMPORTED -- so the reason is READ rather than
 * rewritten into a column the firm never filled in. The firm's own mapping: "Paid in Full" is paid
 * up, "Settled by way of..." is settled, everything else is written off.
 *
 * On the twenty test accounts this gives 5 paid up, 1 settled and 2 written off, which is what the
 * firm counted by hand.
 */
export function closureKind(account: {
  endedAs?: string | null
  status?: string | null
  writeOffReason?: string | null
}): ClosureKind | null {
  if (account.endedAs) return account.endedAs as ClosureKind
  if (!/written.off|^closed/i.test(account.status ?? '')) return null
  const why = account.writeOffReason ?? ''
  if (/paid\s*in\s*full/i.test(why)) return 'paid_up'
  if (/^\s*settled/i.test(why)) return 'settled'
  return 'written_off'
}

/**
 * WHICH BOOK A ROW IS IN, read the same way the generated column reads it.
 *
 * NOT THE SOURCE OF TRUTH AND NOT A SECOND ONE. The database decides and the list filters on the
 * column; this exists so a screen holding an account in memory can say which book it is in without
 * a round trip, and so a check can hold the two readings against each other.
 */
export function bookOf(account: {
  endedAs?: string | null
  status?: string | null
  holdReason?: string | null
}): Book {
  if (account.endedAs) return 'closed'
  if (/^written.off|^closed/i.test(account.status ?? '')) return 'closed'
  if (account.holdReason || /^frozen/i.test(account.status ?? '')) return 'on_hold'
  return 'active'
}

/**
 * IS THIS HOLD DUE A LOOK?
 *
 * Two things land in the manager's queue and they are different problems. A hold whose review date
 * has passed is one somebody undertook to come back to and has not; a hold with NO review date at
 * all is an account parked before the date was required -- every frozen account that came across
 * from Swordfish is one -- and nobody has ever undertaken to look at it.
 */
export type ReviewState = 'due' | 'never_set' | 'waiting'

export function reviewState(
  account: { holdReviewOn?: string | null; status?: string | null; holdReason?: string | null },
  today: string,
): ReviewState {
  if (!account.holdReviewOn) return 'never_set'
  return account.holdReviewOn <= today ? 'due' : 'waiting'
}
