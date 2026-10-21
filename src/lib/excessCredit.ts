/**
 * WHAT HAPPENS TO AN OVERPAYMENT — the four answers, with nothing that talks to the database.
 *
 * A debtor who pays more than they owe leaves a credit in the trust account that is THEIRS, not the
 * client's and not the firm's. It holds the payover run until somebody decides, which is deliberate:
 * a run that went out with an undecided credit in it would be an invoice the client has, built on
 * money that might have to come back.
 *
 * SPLIT FROM excessCreditApi.ts the way accountEnding.ts is split from its own calls, and for the
 * same reason: a file importing the Supabase client cannot be imported by a QA check.
 */

export type ExcessDisposal = 'refund' | 'moved' | 'released' | 'parked'

export const DISPOSALS: {
  id: ExcessDisposal
  label: string
  blurb: string
  /** What the person has to supply before it can be done. */
  needs?: 'payable_to' | 'move_to'
}[] = [
  {
    id: 'refund',
    label: 'Refund it to the debtor',
    blurb: 'It is their money. A payment out of the trust account, payable to whoever they name.',
    needs: 'payable_to',
  },
  {
    id: 'moved',
    label: 'Move it to another of their accounts',
    blurb: 'They have more than one file with us and the money is better used on another.',
    needs: 'move_to',
  },
  {
    id: 'released',
    label: 'Release it to the client',
    blurb: 'The debtor agreed it may go to what they still owe. It joins the next payover.',
  },
  {
    /*
     * THE FOURTH, AND THE FIRM ASKED FOR IT BY DESCRIBING THE PROBLEM: *"who are we going to pay
     * five rand to? We're going to give the guy a call, and the costs are going to be already more
     * than 20 rand... It can go to us or whatever."*
     *
     * PARKING DECIDES NOTHING ABOUT THE MONEY. It is still the debtor's — nothing moves in the
     * trust ledger — it simply stops holding the payover run and gets a date to come back on. What
     * happens at that date is a separate press, by somebody who can see how long it waited.
     */
    id: 'parked',
    label: 'Park it and come back to it',
    blurb: 'Too small or too hard to return right now. It stays the debtor’s and waits.',
  },
]

/**
 * WHEN A REFUND COSTS MORE THAN IT RETURNS.
 *
 * The firm's own arithmetic: a telephone call to arrange a refund costs more than R20 by the time
 * somebody has made it, so refunding R5 loses money and returns almost nothing.
 *
 * IT IS A SUGGESTION, NOT A RULE. The screen leans towards parking below this and says why; every
 * disposal stays available at every amount, because "too small to bother with" is a judgement about
 * a particular debtor and the firm makes those case by case.
 */
export const NOT_WORTH_REFUNDING = 20

export function disposalAdvice(amount: number): { suggest: ExcessDisposal; because: string } {
  if (amount < NOT_WORTH_REFUNDING) {
    return {
      suggest: 'parked',
      because: `Arranging a refund costs the firm more than R${NOT_WORTH_REFUNDING} in time before `
        + 'anything is paid, so returning this one would lose money and give the debtor almost '
        + 'nothing. Parking it keeps it theirs while somebody decides.',
    }
  }
  return {
    suggest: 'refund',
    because: 'It is the debtor’s money and it is worth returning. A refund leaves the trust '
      + 'account, so it needs somebody to pay it to.',
  }
}

/** A credit parked and waiting, and whether its period has run. */
export interface ParkedCredit {
  allocationId: string
  accountId: string
  caseNumber: string | null
  debtor: string
  client: string | null
  amount: number
  parkedOn: string | null
  ripeOn: string | null
  /** Its period has run, so the firm may take it. */
  ripe: boolean
  takenAt: string | null
  reason: string | null
}

/**
 * WHAT THE PARKED LIST SAYS ABOUT ONE ROW.
 *
 * THREE STATES, AND THE MIDDLE ONE IS THE POINT. Waiting is the ordinary state and most rows sit in
 * it; ripe means the period has run and somebody may now decide; taken means the firm has it, and
 * that is reversible because the case this has to survive is the debtor coming back afterwards.
 */
export function parkedState(c: ParkedCredit): 'taken' | 'ripe' | 'waiting' {
  if (c.takenAt) return 'taken'
  return c.ripe ? 'ripe' : 'waiting'
}
