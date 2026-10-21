/**
 * DOES THE TRUST BALANCE, AND IF NOT, WHAT EXACTLY IS WRONG WITH IT?
 *
 * THE FIRM, on the overview they sketched: "it shows all the money that's currently in the trust
 * fund and where that money should go. If the trust fund balances in the overview, then everything
 * is fine."
 *
 * THAT SENTENCE IS THE WHOLE SPECIFICATION, and it only means something if the screen can say NO.
 *
 * THE RECONCILIATION THE SKETCH DREW CANNOT SAY NO. It read "trust ledger balance, LESS amounts
 * accounted for, = unexplained difference", with the four owners above it -- clients, the firm,
 * debtors, and receipts nobody has placed. In Raptor those four are not four measurements that
 * might fail to agree with a fifth: `trust_position` derives the ledger balance BY ADDING THEM UP.
 * Their sum is the balance by construction, so that difference is 0.00 on every row of data that
 * can ever exist. It was checked against staging rather than argued about -- net owed R7 873,60,
 * sum of owners R7 873,60, gap R0,00 -- and it is an algebraic identity, not a clean account.
 *
 * A GREEN LIGHT THAT CANNOT GO RED IS WORSE THAN NO LIGHT, because people stop reading the ones
 * that can -- which is the firm's own rule about warnings, applied to the most important screen
 * they have. So the panel keeps the shape the firm liked and fills it with the four things that
 * CAN actually be wrong with a trust account, each one a real comparison:
 *
 *   1. THE BANK AGAINST THE LEDGER. The only reconciliation on the page between two independently
 *      measured things -- what the bank statement says is there, and what Raptor says is owed out
 *      of it. Short is the serious direction: money has left that nothing accounts for.
 *   2. MONEY NOBODY OWNS. A receipt in the trust account with no debtor against it is in the
 *      balance and has no owner, so "where that money should go" has no answer for it.
 *   3. A CLIENT WHO OWES THE TRUST. A PTC makes a trust DEBTOR of a client. It is not a shortfall
 *      -- the cash is still there -- but it is money the firm has paid out ahead of recovering it.
 *   4. A PAYOVER THAT HAS GONE PAST ITS DAY. Client money sitting in trust after the day it was
 *      due out is the firm holding somebody else's money longer than it said it would.
 *
 * PURE, AND IN ITS OWN FILE, so `check-trust-balance` can import it: `trust.ts` pulls in the
 * Supabase client and can only ever be read back as text. The same reason `emailStyle.ts` is held
 * apart from `firmSettings.ts`.
 *
 * STRUCTURAL INPUTS rather than the fetched types, for the same reason -- and because a check
 * should be able to build the failing case by hand without a database.
 */

export type TrustCheckTone = 'clear' | 'warn' | 'bad'

export interface TrustCheck {
  id: 'bank' | 'unidentified' | 'owed_in' | 'overdue'
  /** What was asked, in the firm's words rather than the column's. */
  question: string
  tone: TrustCheckTone
  /** The answer, one line. Names the amount when there is one, because "check this" is not a fact. */
  answer: string
  /** The figure at stake, or null where the check is about a count rather than an amount. */
  amount: number | null
}

export interface TrustBalanceInput {
  /** What the bank statement says is in the trust account. */
  trustCash: number
  /** What Raptor says is owed out of it. */
  netOwed: number
  /** Cash less what is owed. Negative is short, and short is the serious one. */
  difference: number
  /** Receipts in the account that nobody has placed to a party. */
  unidentified: number
  /** Clients in debit — they owe the trust rather than are owed by it. */
  owedByClients: number
}

export interface OverdueCycle {
  /** Already-formatted, because formatting a date is not this function's job. */
  label: string
  toClients: number
}

const r2 = (v: number): number => Math.round(v * 100) / 100

/**
 * The four checks, always all four, always in this order.
 *
 * ALL FOUR EVEN WHEN THEY PASS, which is the half that makes the panel worth opening. A list that
 * only shows problems is a list somebody cannot tell apart from a list that failed to load — and
 * the firm's sentence is about being told that everything IS fine, not only about being told when
 * it is not.
 */
export function trustChecks(
  input: TrustBalanceInput,
  overdue: OverdueCycle[] = [],
  money: (v: number) => string = (v) => v.toFixed(2),
): TrustCheck[] {
  const checks: TrustCheck[] = []

  const diff = r2(input.difference)
  checks.push({
    id: 'bank',
    question: 'Does the bank agree with the ledger?',
    amount: diff,
    tone: diff === 0 ? 'clear' : 'bad',
    answer: diff === 0
      ? 'The bank holds exactly what Raptor says is owed out of it.'
      : diff < 0
        /* SHORT IS NAMED AS A SHORTFALL. It is the one thing on this page that is a breach rather
           than a job, and softening it to "a difference" is how it gets left for a week. */
        ? `The bank holds ${money(Math.abs(diff))} less than is owed. Money has left the trust `
          + 'account that nothing accounts for.'
        : `The bank holds ${money(diff)} more than is owed. Something has come in that nobody is `
          + 'yet recorded as being owed.',
  })

  const unknown = r2(input.unidentified)
  checks.push({
    id: 'unidentified',
    question: 'Does every rand in there have an owner?',
    amount: unknown,
    tone: unknown === 0 ? 'clear' : 'warn',
    answer: unknown === 0
      ? 'Every receipt has been placed to a client, a debtor or the firm.'
      : `${money(unknown)} is in the account with nobody's name on it. Until it is placed, there `
        + 'is no answer to where it should go.',
  })

  const owedIn = r2(input.owedByClients)
  checks.push({
    id: 'owed_in',
    question: 'Is any client in debit to the trust?',
    amount: owedIn,
    tone: owedIn === 0 ? 'clear' : 'warn',
    answer: owedIn === 0
      ? 'No client owes the trust. Every balance is money held for somebody.'
      /* NOT A SHORTFALL, AND SAYING SO IS THE POINT. The cash is all there; a trust debtor is the
         firm having paid a client ahead of recovering it, which is a collection job, not a breach.
         Drawn in the same red as a shortfall it would send somebody to the bank for nothing. */
      : `${money(owedIn)} has been paid to clients ahead of being recovered. The cash is still `
        + 'there; this is money to collect back, not a shortfall.',
  })

  const late = r2(overdue.reduce((s, c) => s + c.toClients, 0))
  checks.push({
    id: 'overdue',
    question: 'Has every payover gone out on its day?',
    amount: overdue.length ? late : 0,
    tone: overdue.length === 0 ? 'clear' : 'warn',
    answer: overdue.length === 0
      ? 'No cycle is holding client money past the day it was due out.'
      : overdue.length === 1
        ? `${money(late)} for ${overdue[0].label} is past its payover day and still in trust.`
        : `${money(late)} across ${overdue.length} cycles is past its payover day and still in `
          + 'trust.',
  })

  return checks
}

/**
 * Does the whole account balance?
 *
 * ONLY THE BANK CHECK DECIDES THIS, and the other three deliberately do not. "Balances" is a
 * statement about the ARITHMETIC — cash against what is owed — and it stays true while there is
 * work outstanding on the account. An unplaced receipt and a late payover are both jobs somebody
 * has to do; neither means the trust account is wrong, and folding them in would put the page in
 * the red on a day when nothing is actually missing.
 */
export function trustBalances(checks: TrustCheck[]): boolean {
  return checks.every((c) => c.id !== 'bank' || c.tone === 'clear')
}

/** Everything still to be done, whether or not the account balances. */
export function trustTodo(checks: TrustCheck[]): TrustCheck[] {
  return checks.filter((c) => c.tone !== 'clear')
}

/**
 * The headline over the panel.
 *
 * THE FIRM'S OWN SENTENCE, both halves of it: "if the trust fund balances in the overview, then
 * everything is fine" — so when it balances AND nothing is outstanding, the screen says so plainly
 * rather than making somebody read four rows to find out that there is nothing to read.
 */
export function trustVerdict(checks: TrustCheck[]): { tone: TrustCheckTone; line: string } {
  const todo = trustTodo(checks)
  if (!trustBalances(checks)) {
    return { tone: 'bad', line: 'The trust account does not balance.' }
  }
  if (todo.length === 0) {
    return { tone: 'clear', line: 'The trust account balances and there is nothing outstanding.' }
  }
  return {
    tone: 'warn',
    line: todo.length === 1
      ? 'The trust account balances. One thing still needs doing.'
      : `The trust account balances. ${todo.length} things still need doing.`,
  }
}

/**
 * THE THREE FIGURES ACROSS THE TOP: WHAT IS IN THE TRUST, HOW MUCH OF IT IS ACCOUNTED FOR, AND
 * HOW MUCH IS NOT.
 *
 * The firm, 10 Oct, of the band that read "Bank balance / Trust ledger balance / Bank / ledger
 * difference": "the trust balance should be the main thing ... this is how much is in the trust.
 * This has been accounted for. This has not been accounted for. And then ... the breakdown." The
 * old band put two balances side by side and asked the reader to subtract; this one starts from
 * the money and says how much of it has a name on it.
 *
 * ACCOUNTED FOR IS THE OWNERS THE SCREEN DREW, summed by the caller from the same rows it shows --
 * clients, the firm, debtors, less what clients owe back. Not a figure read from the database: a
 * total the page did not add up itself is a total that can disagree with the rows above it.
 *
 * NOT ACCOUNTED FOR IS WHAT IS LEFT, and it is split into what it is made of, because "R950 not
 * accounted for" is two different jobs depending on why:
 *   - UNPLACED: receipts on the statement nobody has put against a debtor (Exceptions);
 *   - GAP: the bank against the ledger -- money in the account the books do not know about, or (the
 *     serious direction) books owing money the account does not hold;
 *   - RESIDUAL: anything neither explains. Nil whenever the parts and trust_position agree, and
 *     drawn only when they do not, so the page can still say "this does not add up".
 */
export interface TrustHeadline {
  inTrust: number
  accounted: number
  notAccounted: number
  unplaced: number
  /** Receipts in the bank waiting for approval (10 Oct) -- part of the bank/ledger gap, named. */
  awaiting: number
  /** The bank/ledger gap. */
  gap: number
  /** The gap less what is waiting for approval: what nothing on the page explains yet. */
  otherGap: number
  residual: number
}

export function trustHeadline(input: {
  trustCash: number
  /** The owners the screen drew, already summed: clients + firm + debtors - owed back. */
  owners: number
  unidentified: number
  difference: number
  awaiting?: number
}): TrustHeadline {
  const inTrust = r2(input.trustCash)
  const accounted = r2(input.owners)
  const notAccounted = r2(inTrust - accounted)
  const unplaced = r2(input.unidentified)
  const gap = r2(input.difference)
  const awaiting = r2(input.awaiting ?? 0)
  return {
    inTrust, accounted, notAccounted, unplaced, awaiting, gap, otherGap: r2(gap - awaiting),
    residual: r2(notAccounted - unplaced - gap),
  }
}
