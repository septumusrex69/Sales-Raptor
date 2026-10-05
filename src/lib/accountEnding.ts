/**
 * THE THREE WAYS AN ACCOUNT ENDS -- THE RULES, WITH NOTHING THAT TALKS TO THE DATABASE.
 *
 * SPLIT FROM accountEndingApi.ts FOR THE REASON emailStyle.ts IS SPLIT FROM firmSettings.ts: a file
 * that imports the Supabase client cannot be imported by a QA check, which can then only read it
 * back as text. Every rule worth asserting -- what each preset charges, what carries VAT, which
 * ending a balance makes truthful -- lives here, so check-account-ending runs the real arithmetic
 * rather than matching strings in the source.
 *
 * The firm, asked what was missing: *"Do we have an option to make accounts paid up? Write accounts
 * off? Freeze accounts? Or withdraw accounts?"* Freezing already existed; the other three did not.
 *
 * WITHDRAWN IS NOT WRITTEN OFF, and the difference is who decided and who pays. A withdrawal is the
 * CLIENT taking the file back, and the firm invoices for work already done. A write-off is the FIRM
 * cancelling the debt under its own mandate, and what it produces is a conversation with the client
 * rather than a charge.
 */

export type AccountEnding = 'paid_up' | 'written_off' | 'withdrawn'

export const ENDING_LABEL: Record<AccountEnding, string> = {
  paid_up: 'Paid up',
  written_off: 'Written off',
  withdrawn: 'Withdrawn by the client',
}

/* ------------------------------------- withdrawing ------------------------------------- */

/** What the firm has invested in the account, before anybody decides what to charge for it. */
export interface WithdrawalBasis {
  fees: number
  interest: number
  /** What the commission WOULD have been, reckoned on the balance still outstanding. */
  commission: number
  vatRate: number
  capital: number
  commissionRate: number
}


/** Which of the three the client is being charged for. */
export interface WithdrawalCharge {
  fees: boolean
  interest: boolean
  commission: boolean
  /** A figure somebody typed, which replaces the three boxes entirely. */
  amount?: number | null
}

/**
 * THE FIRM'S TWO CASES, AS PRESETS.
 *
 * Both are quoted from the firm because the difference between them is a judgement about fault, not
 * an arithmetic rule, and somebody reading this later needs to know which is which:
 *
 *   AN ARRANGEMENT WAS MADE — *"If they made an arrangement with a client, then we would charge
 *   them the commission, the interest, and the fees that we've already invested because the
 *   commission should have come to us because they made an arrangement due to the result of our
 *   work."* The debtor came to the table because the firm pushed; the client is collecting the
 *   result of work they did not do.
 *
 *   IT SHOULD NEVER HAVE BEEN HANDED OVER — *"If a client just wants to withdraw an account because
 *   they missed a payment on their side and their data shouldn't have been handed over, we've
 *   already invested money in the account. Then we usually just charge them the fees and not the
 *   interest."* The client made the mistake, but the firm still spent money, so it recovers its
 *   outlay and nothing more.
 *
 * THEY ARE STARTING POINTS, NOT RULES. Every box stays tickable afterwards and a typed figure
 * overrides all of them — the firm asked for exactly that: *"so we should have tick boxes what we
 * charge or we can charge an amount we type in."*
 */
export const WITHDRAWAL_PRESETS: {
  id: string
  label: string
  why: string
  charge: WithdrawalCharge
}[] = [
  {
    id: 'arrangement',
    label: 'They made an arrangement with the debtor',
    why: 'The debtor came to the table because of our work, so the commission would have been ours.',
    charge: { fees: true, interest: true, commission: true },
  },
  {
    id: 'not_handed_over',
    label: 'It should never have been handed over',
    why: 'Their mistake, but we have already spent money on it. We recover the outlay and no more.',
    charge: { fees: true, interest: false, commission: false },
  },
  {
    id: 'nothing',
    label: 'Charge them nothing',
    why: 'Goodwill. No invoice is raised at all.',
    charge: { fees: false, interest: false, commission: false },
  },
]

/**
 * WHAT THE CLIENT WILL BE INVOICED, worked out in the browser so the figure moves as the boxes do.
 *
 * IT IS A PREVIEW, NOT THE CHARGE. `withdraw_account` computes the same sum from the same basis and
 * is what actually raises it — this exists so somebody can see the number before they commit, and
 * the two are held together by check-account-ending rather than by hope.
 *
 * INTEREST CARRIES NO VAT. It is not a service the firm rendered, it is the cost of money; fees and
 * commission are services and are VATed.
 */
export function withdrawalTotal(basis: WithdrawalBasis, charge: WithdrawalCharge): {
  excl: number; vat: number; incl: number
} {
  if (charge.amount !== null && charge.amount !== undefined) {
    const excl = round(charge.amount)
    const vat = round(excl * basis.vatRate)
    return { excl, vat, incl: round(excl + vat) }
  }
  let excl = 0
  let vatable = 0
  if (charge.fees) { excl += basis.fees; vatable += basis.fees }
  if (charge.interest) { excl += basis.interest }
  if (charge.commission) { excl += basis.commission; vatable += basis.commission }
  const vat = round(vatable * basis.vatRate)
  return { excl: round(excl), vat, incl: round(round(excl) + vat) }
}

/* Two decimals, away from zero, the way every other money figure in Raptor rounds. */
function round(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100
}


/* --------------------------------- paid up and written off --------------------------------- */

/**
 * WHICH OF THE TWO THIS IS, AND THE THRESHOLD IS WORDING RATHER THAN A GATE.
 *
 * The firm's own rule is that money comes first: *"any payment has gone through the division before
 * it is decided to write off."* So a balance still standing is not paid up — it is a residue
 * somebody has decided to let go, and that is a write-off with a reason.
 *
 * R50 IS WHERE THE FIRM STOPS CHASING, which they confirmed as wording only. It changes what the
 * screen SAYS, never what it allows: a R40 residue is still a write-off, it is simply the ordinary
 * kind nobody needs to agonise over. Making it a gate would be the app deciding something the firm
 * said it decides case by case.
 */
export const SMALL_RESIDUE = 50

export function endingAdvice(balance: number): { ending: AccountEnding; because: string } {
  /*
   * THE SENTENCE DOES NOT RESTATE THE FIGURE. The screen says what is outstanding in its own
   * words immediately above this one, so repeating it here printed the same clause twice in a
   * row -- which reads as a bug even though both halves were correct.
   */
  if (balance <= 0) {
    return { ending: 'paid_up', because: 'The debt was settled in full.' }
  }
  if (balance < SMALL_RESIDUE) {
    return {
      ending: 'written_off',
      because: `That is under R${SMALL_RESIDUE}, which is less than it costs to chase, but `
        + 'letting it go is still a write-off and it still needs a reason.',
    }
  }
  return {
    ending: 'written_off',
    because: 'Closing it now cancels that balance, which is the firm\u2019s decision to make '
      + 'and the client\u2019s to be told about.',
  }
}

/**
 * THE REASONS A WRITE-OFF CAN CARRY.
 *
 * A CLOSED LIST BECAUSE THE QUESTION IS ASKED LATER. "What has this client written off, and why"
 * is a question free text cannot answer, and the liaison's conversation with the client starts from
 * whichever of these it was.
 *
 * NOTE WHAT CHANGED: these used to be described as reasons a REQUEST quotes, on the belief that the
 * client decides every write-off. The firm corrected that — they hold the mandate — so the same
 * list now names a decision the firm has made rather than one it is asking for.
 */
export const WRITE_OFF_REASONS = [
  'Uncontactable',
  'Cannot pay',
  'Deceased, no estate',
  'Sequestrated, no dividend',
  'Liquidated, no dividend',
  'Prescribed',
  'Disputed and conceded',
  'Small residue, not worth chasing',
] as const

export type WriteOffReason = typeof WRITE_OFF_REASONS[number]
