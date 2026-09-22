/**
 * Whether a handover is ready to approve, and what is still waiting on a person.
 *
 * THE FIRM: "currently you need to go down and read that, but then you have to go back up and
 * remove the account if there is a problem ... I think if there is an issue with a handover it
 * should be in a pending state, and the approving cannot happen if all of the bottom things have
 * not been sorted out. For example an ID number is not correct -- then you could say accept it,
 * or reject it. You can also put in a note to the person working the account: the ID number is
 * wrong and needs to be confirmed."
 *
 * WHAT CHANGED IS WHO DECIDES. Approve used to take whatever was importable and leave the rest
 * behind, so a warning was advice somebody could scroll past -- and forty-five of them under a
 * table is advice everybody scrolls past. Now every row carrying a problem needs an answer, and
 * the answer is recorded against the row: accepted, with a note for the collector who gets the
 * account, or rejected.
 *
 * A REFUSED ROW CANNOT BE ACCEPTED. There is nothing to accept: no capital, or no date of
 * default, or no name to address a letter from. It is corrected in the table or it is rejected,
 * and offering "accept" on it would be offering to open a ledger that cannot be right.
 *
 * PURE, AND HERE, because the gate is the part worth being sure of -- a bug that lets an
 * undecided row through is invisible until a collector rings a debtor about somebody else's debt.
 */

export type Decision = 'accepted' | 'rejected' | null

export interface DecidableRow {
  id: string
  line: number
  excluded: boolean
  decision: Decision
  note: string | null
  /** From planHandover: null while the draft is still being read. */
  planned: { problems: { level: 'refuse' | 'warn' }[]; refused: boolean } | null
}

/**
 * Is this row still waiting on a person?
 *
 * ANY decision settles it, accepted or rejected — including on a REFUSED row, where rejecting is
 * the only answer available. Written to settle only on 'rejected' first, which left a rejected
 * refusal still blocking the approval: a screen with no way out of it.
 */
export function needsDecision(row: DecidableRow): boolean {
  if (row.decision !== null) return false
  return (row.planned?.problems.length ?? 0) > 0
}

/** Rows still waiting on a person, in the order they appear in the file. */
export function undecided(rows: DecidableRow[]): DecidableRow[] {
  return rows.filter(needsDecision).sort((a, b) => a.line - b.line)
}

/**
 * Whether "accept" may be offered on a row at all.
 *
 * A refused row is not one of them, and neither is a row with nothing wrong: offering a decision
 * where there is nothing to decide is how a screen teaches somebody to press buttons without
 * reading them.
 */
export function canAccept(row: DecidableRow): boolean {
  return (row.planned?.problems.length ?? 0) > 0 && !row.planned?.refused
}

export interface Readiness {
  /** True when approve may run. */
  ready: boolean
  /** Rows that still need a person, if any. */
  waiting: DecidableRow[]
  /** How many rows would actually open an account. */
  importing: number
  /** What to say on or beside the button. One sentence, in the firm's words. */
  why: string | null
}

/**
 * THE GATE. Approve is offered only when nothing is waiting AND something would come of it.
 *
 * The count of what would be imported is here rather than beside the button, because the two have
 * to agree: a button reading "Approve 44 handovers" on a draft the gate is holding is the screen
 * disagreeing with itself, which is the state the firm was looking at.
 */
export function readiness(rows: DecidableRow[]): Readiness {
  const waiting = undecided(rows)
  /*
   * WHAT WILL DEFINITELY OPEN AN ACCOUNT, which excludes anything still waiting on somebody.
   *
   * Counted without that, a held handover offered "Approve 44 handovers" while refusing to do it,
   * and the 44 included rows whose fate nobody had decided yet. The number grows as decisions are
   * made, which is the honest thing for it to do.
   */
  const importing = rows.filter((r) => !r.excluded && r.decision !== 'rejected'
    && !r.planned?.refused && !needsDecision(r)).length

  if (waiting.length > 0) {
    const lines = waiting.slice(0, 4).map((r) => r.line).join(', ')
    const more = waiting.length > 4 ? `, and ${waiting.length - 4} more` : ''
    return {
      ready: false,
      waiting,
      importing,
      why: waiting.length === 1
        ? `Row ${lines} needs a decision before this handover can be approved.`
        : `${waiting.length} rows need a decision before this handover can be approved — `
          + `${lines}${more}.`,
    }
  }
  if (importing === 0) {
    return {
      ready: false,
      waiting,
      importing,
      why: 'Nothing on this handover would be imported.',
    }
  }
  return { ready: true, waiting, importing, why: null }
}

/**
 * The note that goes onto the account, or null.
 *
 * THE FIRM: "a note from admin -- the handover was accepted, but the ID number is incorrect, or
 * there are no email addresses, or whatever the reason is. That's overwritten the flag that the
 * account gave. Show it to them."
 *
 * SO THE PROBLEMS GO IN TOO, not just what somebody typed. The person accepting the row knows
 * what they overrode; the collector who gets the account three weeks later does not, and a note
 * reading only "confirm this" is a note nobody can act on. Written as one body because that is
 * what account_notes holds, with the typed part first: it is the instruction, and the list under
 * it is the evidence.
 */
export function noteForAccount(
  row: { note: string | null; planned: { problems: { message: string }[] } | null },
): string | null {
  const typed = (row.note ?? '').trim()
  const problems = (row.planned?.problems ?? []).map((p) => p.message)
  if (!typed && problems.length === 0) return null

  const head = typed || 'Accepted on import with the following outstanding:'
  if (problems.length === 0) return head
  return [head, '', ...problems.map((m) => `• ${m}`)].join('\n')
}
