/**
 * THE BLANKS A SIGNER FILLS IN, AND THE ONES THEY MAY NEVER TOUCH.
 *
 * THE FIRM: "you currently pull the data from the PTP. But there's a scenario where no PTP exists.
 * So when you send it, it should use the PTP data, or it should ask: use the PTP data or leave it
 * blank. So then you will put a small line where the person can fill in whatever it is that they
 * need to fill in, based on an arrangement that they would like to make. If there's any missing
 * documentation, make provisions for that being filled in by the individual completing the
 * document."
 *
 * WHAT THIS REPLACES WENT OUT WITH THE BRACES SHOWING. An acknowledgement of debt on an account
 * with no promise to pay had no instalment terms to print, and nothing to put in their place -- so
 * item 3 of the firm's own AoD read "Lubuschangne. Registration number: . Domicilium:
 * {{debtor_address}}" on a document somebody was being asked to sign. Two failures in one line: a
 * field with nothing behind it, and a field the DEBTOR is the only person who can answer.
 *
 * ---------------------------------------------------------------------------------------------
 * THE MONEY IS PRINTED, NOT ASKED FOR
 * ---------------------------------------------------------------------------------------------
 *
 * THE RULE IS NOT "whatever Raptor could not answer". A balance Raptor failed to merge would
 * become a box on the debtor's screen, and an acknowledgement of debt whose amount the debtor
 * typed in is not an acknowledgement of anything -- it is an offer, drawn on the firm's letterhead,
 * that the firm would later have to argue it never made. So the list below is CLOSED and names
 * only two kinds of thing:
 *
 *   - THEIR OWN PARTICULARS. An address, an identity or registration number, an employer. The
 *     debtor is the authority on these; the firm's copy is whatever a client's sheet said in 2019.
 *   - THE TERMS THEY ARE OFFERING. What they will pay, how often, and from when. This is the whole
 *     of what the firm asked for: the arrangement a person would like to make.
 *
 * Everything else -- capital, fees, interest, the balance, the case number, the firm's own banking
 * details -- prints as Raptor has it or prints as nothing, and a collector fixes it before it
 * goes out. There is no syntax for making one of them fillable, which is deliberate: a per-document
 * override is a thing somebody uses once at four in the afternoon.
 *
 * Pure: no database, no clock. The sender decides; this decides what the sender is allowed to ask.
 */

/**
 * How the signer's page draws the box, and how the answer is checked.
 *
 * `amount` AND `choice` ARE NOT TEXT BOXES, and the firm's own reasoning is why:
 *
 *   "a figure for how much is going to be paid should be a figure, not just type it in there,
 *   because there could be typos. There is an R -- some people can put R for rand and others
 *   could not. That might influence the way that the payment is captured."
 *
 * They are right, and it is worse than typos: "R500", "500", "R 500.00" and "r500,00" are four
 * strings for one number, and the one that reaches a payment arrangement decides what the firm
 * thinks it was promised. So an amount is a NUMBER the page draws an R beside, and a frequency is
 * a CHOICE -- "rather give the option, for example, monthly, weekly or bi-weekly, or other, and
 * then you can type in other."
 */
export type BlankKind = 'text' | 'lines' | 'amount' | 'date' | 'choice'

export interface Blank {
  /** The merge field this fills, without the braces. */
  key: string
  /** What the signer is asked for, in their words rather than the template's. */
  label: string
  kind: BlankKind
  /** For a `choice`: what may be picked. The last one admits anything, typed beside it. */
  options?: string[]
  /**
   * Which kind of debtor is asked this at all.
   *
   * THE FIRM: "why would you ask for the employer and for the company at the same time? If you're
   * speaking to a company, you're speaking to a company. If you're speaking to an individual,
   * you're speaking to an individual."
   *
   * Exactly so -- a company has no employer and a person has no registration number, and asking
   * both makes the form read as something nobody looked at. Absent means both.
   */
  forKind?: 'individual' | 'company'
  /**
   * Whether the document can be signed without it.
   *
   * NOT EVERYTHING IS. A debtor who will not give their employer should still be able to sign the
   * acknowledgement -- refusing would cost the firm the instrument over a field it was not going to
   * sue on. The terms of the arrangement are required, because an AoD with no instalment in it
   * acknowledges a debt and promises nothing.
   */
  required: boolean
}

/**
 * THE CLOSED LIST. A field not named here can never become a box on the signer's page.
 *
 * Keyed by the merge field so the sender's choice, the frozen document and the signed answer all
 * speak one vocabulary -- the same one the templates are written in.
 */
/** What the firm offers as a payment frequency. The last admits anything, typed beside it. */
export const FREQUENCIES = ['Monthly', 'Fortnightly', 'Weekly', 'Other']

export const FILLABLE: Blank[] = [
  { key: 'debtor_address', label: 'Your street address', kind: 'lines', required: true },
  {
    key: 'debtor_id_masked',
    label: 'Your identity number',
    kind: 'text',
    /*
     * ASKED IN FULL AND NOT MASKED, which the key does not say and the label must. 97% of the book
     * has no identity number at all, and the debtor is the only person who can supply theirs; what
     * the firm PRINTS of it afterwards is masking's business, not this form's.
     */
    required: false,
    forKind: 'individual',
  },
  {
    key: 'debtor_reg_no',
    label: 'Company registration number',
    kind: 'text',
    required: false,
    forKind: 'company',
  },
  /*
   * HOW TO REACH THEM, CONFIRMED BY THEM. The firm: "maybe there should be like information like
   * your work number, home, your cell phone number, work number, and email address, just kind of
   * to confirm that stuff."
   *
   * NONE OF THEM REQUIRED, and that follows the rule already written above: a debtor who will not
   * give a work number should still be able to sign. Refusing the instrument over a field the firm
   * was never going to sue on costs the firm the agreement -- and every one of these is a line that
   * simply LEAVES the document when it is not answered, which is what optional means here.
   *
   * THE EMAIL IS ASKED FOR EVEN THOUGH THEY ARRIVED BY EMAIL. The address the link was sent to is
   * whatever a client's sheet carried in 2019; this is the one they are telling the firm to use,
   * and the two are different facts often enough to be worth the box.
   */
  { key: 'debtor_mobile', label: 'Your cellphone number', kind: 'text', required: false },
  { key: 'debtor_work_phone', label: 'Your work number', kind: 'text', required: false },
  { key: 'debtor_home_phone', label: 'Your home number', kind: 'text', required: false },
  { key: 'debtor_email', label: 'Your email address', kind: 'text', required: false },
  { key: 'debtor_employer', label: 'Your employer', kind: 'text', required: false, forKind: 'individual' },
  /*
   * THE ARRANGEMENT, WHICH IS THE WHOLE POINT. Required together: an instalment with no date and a
   * date with no instalment are each half a promise, and half a promise on a signed instrument is
   * an argument waiting to happen.
   */
  { key: 'ptp_amount', label: 'What you will pay each time', kind: 'amount', required: true },
  {
    key: 'ptp_frequency',
    label: 'How often you will pay it',
    kind: 'choice',
    options: FREQUENCIES,
    required: true,
  },
  { key: 'ptp_date', label: 'The date of your first payment', kind: 'date', required: true },
]

const BY_KEY = new Map(FILLABLE.map((b) => [b.key, b]))

/** May this merge field be left for the signer? */
export function isFillable(key: string): boolean {
  return BY_KEY.has(key)
}

/** The blank for a field, or null where the firm may not ask the debtor for it. */
export function blankFor(key: string): Blank | null {
  return BY_KEY.get(key) ?? null
}

/**
 * The blanks to send with a document, given which fields the sender chose to leave open.
 *
 * SILENTLY DROPS WHAT IT MAY NOT ASK, rather than refusing the send. The sender's list comes from
 * a form, and a key that is not fillable is a bug in the caller rather than something to tell a
 * collector about at the moment they are trying to get a document out. The CHECK is what catches
 * it, and the document simply prints that field as Raptor has it.
 */
export function blanksFor(keys: string[], debtorKind: 'individual' | 'company' = 'individual'): Blank[] {
  const want = new Set(keys)
  /* In the order the firm's documents read, not the order somebody ticked them -- and never a
     question for the other kind of debtor. */
  return FILLABLE.filter((b) => want.has(b.key) && (!b.forKind || b.forKind === debtorKind))
}

/**
 * AN AMOUNT A DEBTOR TYPED, AS A NUMBER.
 *
 * THE FIRM: "there is an R -- some people can put R for rand and others could not. That might
 * influence the way that the payment is captured."
 *
 * The page draws the R and takes digits, so this is mostly a second lock rather than the only one:
 * a pasted "R 1 500,00", a thousands space, a comma for a decimal point and a full stop for one
 * all have to come out as 1500. Returns null where there is no number in it at all, which is what
 * keeps "five hundred" out of an arrangement.
 */
export function amountOf(typed: string): number | null {
  const cleaned = (typed ?? '')
    .replace(/[Rr\s\u00a0]/g, '')
    /* A COMMA IS A DECIMAL POINT HERE. en-ZA writes 1 500,00 -- read as a thousands separator,
       a debtor offering R1,50 a month would be recorded as R150. */
    .replace(/,/g, '.')
  if (!/^\d*\.?\d+$/.test(cleaned)) return null
  const value = Number(cleaned)
  return Number.isFinite(value) && value > 0 ? value : null
}

/**
 * What is still missing before this can be signed.
 *
 * NAMES THE FIELDS RATHER THAN COUNTING THEM. "Fill in 2 more" is a sentence somebody reads twice
 * and still has to hunt; "Your street address and the date of your first payment" is the answer.
 */
export function missingBlanks(blanks: Blank[], filled: Record<string, string>): Blank[] {
  return blanks.filter((b) => {
    const given = (filled[b.key] ?? '').trim()
    if (b.required && !given) return true
    /* AN AMOUNT THAT IS NOT A NUMBER IS NOT AN ANSWER. "about five hundred" in an instalment field
       is a promise nobody can diarise, and it would reach a collector as though it were one. */
    if (b.kind === 'amount' && given && amountOf(given) === null) return true
    return false
  })
}

/**
 * The document's values with the signer's answers merged in.
 *
 * THE SIGNER'S ANSWER WINS ONLY WHERE THERE WAS A BLANK. A value Raptor printed is not overwritten
 * by a stray key in the filled map -- which is the lock that keeps a balance a balance even if
 * something downstream were ever persuaded to send one.
 */
export function withFilled(
  values: Record<string, string>,
  blanks: Blank[],
  filled: Record<string, string>,
): Record<string, string> {
  const out = { ...values }
  for (const b of blanks) {
    const given = (filled[b.key] ?? '').trim()
    if (given) out[b.key] = given
  }
  return out
}

/**
 * One line of the firm's own words about what the debtor wrote, for the diary entry a collector
 * reads.
 *
 * THE FIRM CHOSE THIS OVER WRITING THE ARRANGEMENT STRAIGHT ONTO THE BOOK: a debtor could type ten
 * rand a month, and an arrangement nobody read is one the firm is holding itself to. So the signed
 * document raises the offer and a person accepts it.
 */
export function offerLine(blanks: Blank[], filled: Record<string, string>): string | null {
  const amount = (filled.ptp_amount ?? '').trim()
  const every = (filled.ptp_frequency ?? '').trim()
  const from = (filled.ptp_date ?? '').trim()
  if (!amount && !from) return null
  if (!blanks.some((b) => b.key === 'ptp_amount' || b.key === 'ptp_date')) return null
  const bits = [amount && `${amount}`, every && `${every}`, from && `from ${from}`].filter(Boolean)
  return `The debtor offered ${bits.join(' ')} when they signed. Accept it or telephone them.`
}
