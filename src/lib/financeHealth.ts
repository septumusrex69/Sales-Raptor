/**
 * IS THE MONEY STILL ADDING UP?
 *
 * The firm asked for "a trigger that says that something is messing with the finances, or one of
 * the fees are not charging, or something is not there, broken, whatever, and influences the
 * remittance."
 *
 * THIS IS NOT THE QA SUITE AND IT IS IMPORTANT NOT TO CONFUSE THEM. `npm run qa` runs before code
 * ships and catches somebody breaking the arithmetic. This runs against REAL ROWS, in the app,
 * and catches an account whose ledgers no longer reconcile — whatever put it in that state,
 * including an import, a hand-edit in the database, or a bug that shipped anyway.
 *
 * FOUR RULES, AND WHY EACH ONE IS WORTH A SIREN RATHER THAN A NOTE:
 *
 *   1. THE LEDGERS RECONCILE. capital + interest + fees + receipt fees − payments is the balance.
 *      If that does not hold, the number on the debtor's statement is not the number the ledgers
 *      contain, and one of the two is what the client is remitted on.
 *   2. IN DUPLUM HOLDS (NCA s103(5)). Once in default, interest plus fees plus costs may not
 *      exceed the capital outstanding. Over-recovery here is the thing the Council for Debt
 *      Collectors exists to hear about.
 *   3. EVERY FEE IS PRICED ON THE GAZETTE IN FORCE THE DAY IT WAS RAISED, and is an item the
 *      gazette actually prices. A 2019 action charged at the 2026 amount is an overcharge; a fee
 *      with no Annexure B item is a charge nobody can justify.
 *   4. EVERY PAYMENT IS ALLOCATED TO EXACTLY ITSELF. This is the remittance rule: a payment split
 *      into parts that add up to more or less than the payment is money appearing or vanishing
 *      between what the debtor paid and what the client is sent.
 *
 * NOTHING HERE FIXES ANYTHING. The firm's own rule: imported history stays exactly as imported,
 * because remittances have already been passed on it, and corrections are a decision made case by
 * case. So this counts and names; it never writes.
 *
 * `checked` IS REPORTED ALONGSIDE `problems`, and the surface must show it. A rule that examined
 * no rows found no faults, and reporting that as "all clear" is worse than reporting nothing —
 * payment_allocations is empty today because the remittance engine is not built, so rule 4 would
 * otherwise read as a clean bill of health on a table nobody has written to.
 */
import { scheduleFor, type AnnexureBSchedule } from './annexureB.ts'

export type FinanceSeverity = 'broken' | 'suspect'

export interface FinanceFinding {
  /**
   * `broken` is an arithmetic contradiction: the rows cannot all be true at once. `suspect` is a
   * figure that is legal but outside what the firm's own rules allow, which a person has to look
   * at rather than a machine decide.
   */
  severity: FinanceSeverity
  rule: 'reconciles' | 'in-duplum' | 'fee-tariff' | 'allocation'
  /** The account this is about, so somebody can go and open it. */
  accountId: string
  reference: string | null
  /** What is wrong, in the firm's words, with the numbers in it. */
  message: string
  /** What the gap is worth, where the fault is an amount. Null where it is not about an amount. */
  randsOut: number | null
}

export interface FinanceReport {
  findings: FinanceFinding[]
  /**
   * How many rows each rule actually examined.
   *
   * THE ANTIDOTE TO A CLEAN BILL OF HEALTH NOBODY EARNED. Zero examined and zero found is not
   * "fine" — it is "nothing was looked at", and the two must never render the same way.
   */
  checked: Record<FinanceFinding['rule'], number>
}

/** A cent. Money is held as numeric and read back as a float, so exact equality is a trap. */
const CENT = 0.005
const near = (a: number, b: number) => Math.abs(a - b) < CENT
const rand = (n: number) => `R ${n.toFixed(2)}`

export interface AccountLedgers {
  accountId: string
  reference: string | null
  /** Capital outstanding, which is what in duplum measures against. */
  capitalOutstanding: number
  /** True once the account is in default, which is when in duplum starts to bite. */
  inDuplum: boolean
  /** The ceiling the database computed. Zero where none has been struck. */
  inDuplumCeiling: number
  /** What the balance computation says the debtor owes, and what it is made of. */
  breakdown: {
    capital: number
    interest: number
    fees: number
    receiptFees: number
    payments: number
    balance: number
    withheld: number
  }
  fees: {
    id: string
    annexureItem: string | null
    amountExclVat: number
    incurredAt: string
    countsTowardFeeCap: boolean
  }[]
  payments: {
    id: string
    amount: number
    /**
     * The split, or null where none has been computed.
     *
     * NULL IS NOT ZERO. A payment with no allocation has not been remitted yet; a payment
     * allocated to zero has been remitted with nothing going anywhere, which is a fault.
     */
    allocation: {
      toInterest: number
      toReceiptFee: number
      toFees: number
      toCapital: number
      commission: number
      commissionVat: number
      toClient: number
    } | null
  }[]
}

/**
 * Look at one account's money and say what does not hold.
 *
 * PURE, so the check script can hand it rows it built by hand and assert on the findings. It
 * takes a schedule resolver rather than reaching for the current date, because a fee raised in
 * 2019 is priced on the 2017 gazette and a function that quietly used today's would report every
 * historical fee as wrong.
 */
export function auditAccount(
  a: AccountLedgers,
  scheduleAt: (date: string) => AnnexureBSchedule = scheduleFor,
): FinanceReport {
  const findings: FinanceFinding[] = []
  const checked: FinanceReport['checked'] = {
    reconciles: 0, 'in-duplum': 0, 'fee-tariff': 0, allocation: 0,
  }
  const say = (
    severity: FinanceSeverity,
    rule: FinanceFinding['rule'],
    message: string,
    randsOut: number | null = null,
  ) => findings.push({ severity, rule, accountId: a.accountId, reference: a.reference, message, randsOut })

  /* ---------- 1. the ledgers reconcile ---------- */

  const b = a.breakdown
  checked.reconciles += 1
  const expected = b.capital + b.interest + b.fees + b.receiptFees - b.payments
  if (!near(expected, b.balance)) {
    /*
     * ONE EXCEPTION, AND IT IS NOT A FAULT: where a cap withheld interest or fees, the balance is
     * deliberately below the sum of its parts and `withheld` is the difference. Subtracting it
     * first is what tells a real contradiction apart from in duplum doing its job.
     */
    if (!near(expected - b.withheld, b.balance)) {
      say('broken', 'reconciles',
        `The ledgers do not add up: capital, interest and fees less payments come to `
        + `${rand(expected - b.withheld)} and the balance says ${rand(b.balance)}.`,
        Math.abs(expected - b.withheld - b.balance))
    }
  }

  /* ---------- 2. in duplum ---------- */

  if (a.inDuplum) {
    checked['in-duplum'] += 1
    const nonCapital = b.interest + b.fees + b.receiptFees
    /*
     * NCA s103(5): once in default, interest plus fees plus costs may not exceed the CAPITAL
     * OUTSTANDING. Measured against the capital, not against the ceiling column, because the
     * ceiling is itself computed -- and a wrong ceiling is one of the things worth catching.
     */
    if (nonCapital > a.capitalOutstanding + CENT) {
      say('broken', 'in-duplum',
        `In duplum is breached: interest and fees come to ${rand(nonCapital)} against capital `
        + `outstanding of ${rand(a.capitalOutstanding)}.`,
        nonCapital - a.capitalOutstanding)
    }
    /* And the stored ceiling should be the capital. A ceiling of zero on an account in default is
       the exact shape of a mapper dropping the column, which is how this was found worth adding. */
    if (a.inDuplumCeiling > 0 && !near(a.inDuplumCeiling, a.capitalOutstanding)) {
      say('suspect', 'in-duplum',
        `The in duplum ceiling says ${rand(a.inDuplumCeiling)} where capital outstanding is `
        + `${rand(a.capitalOutstanding)}.`,
        Math.abs(a.inDuplumCeiling - a.capitalOutstanding))
    }
  }

  /* ---------- 3. every fee priced on the gazette of its own day ---------- */

  let cappedTotal = 0
  for (const fee of a.fees) {
    checked['fee-tariff'] += 1
    if (fee.countsTowardFeeCap) cappedTotal += fee.amountExclVat

    if (!fee.annexureItem) {
      say('suspect', 'fee-tariff',
        `A fee of ${rand(fee.amountExclVat)} carries no Annexure B item, so nothing prices it.`,
        fee.amountExclVat)
      continue
    }
    const schedule = scheduleAt(fee.incurredAt)
    const item = schedule.items.find((i) => i.id === fee.annexureItem)
    if (!item) {
      say('broken', 'fee-tariff',
        `A fee is charged under item ${fee.annexureItem}, which the `
        + `${schedule.effectiveFrom.slice(0, 4)} gazette does not price.`,
        fee.amountExclVat)
      continue
    }
    /* Items 1(b), 4(a) and 9 carry no flat amount -- they point at the Magistrates' Courts rules
       or at a percentage -- so there is nothing to compare and nothing to report. */
    if (item.amount === null || item.amount === undefined) continue
    if (!near(fee.amountExclVat, item.amount)) {
      say('broken', 'fee-tariff',
        `Item ${fee.annexureItem} was charged at ${rand(fee.amountExclVat)} on `
        + `${fee.incurredAt.slice(0, 10)}, where the ${schedule.effectiveFrom.slice(0, 4)} gazette `
        + `prices it at ${rand(item.amount)}.`,
        Math.abs(fee.amountExclVat - item.amount))
    }
  }

  /*
   * AND THE ITEMS 1-7 CEILING. The capital or the gazette's figure, whichever is lower -- so on a
   * small debt the cap is the debt. Measured against the schedule in force TODAY, because the
   * ceiling applies to the running total rather than to any one fee.
   */
  if (a.fees.length > 0) {
    const today = scheduleAt(new Date().toISOString())
    const ceiling = Math.min(a.capitalOutstanding, today.itemsOneToSevenCeiling)
    if (ceiling > 0 && cappedTotal > ceiling + CENT) {
      say('broken', 'fee-tariff',
        `Fees under items 1 to 7 come to ${rand(cappedTotal)} against a ceiling of `
        + `${rand(ceiling)}.`,
        cappedTotal - ceiling)
    }
  }

  /* ---------- 4. every payment allocated to exactly itself ---------- */

  for (const p of a.payments) {
    /* No allocation is not a fault: it is a payment the remittance engine has not reached. It is
       also not CHECKED, which is why `checked` only counts the ones that had one. */
    if (!p.allocation) continue
    checked.allocation += 1
    const al = p.allocation
    const split = al.toInterest + al.toReceiptFee + al.toFees + al.toCapital
    if (!near(split, p.amount)) {
      say('broken', 'allocation',
        `A payment of ${rand(p.amount)} is split into parts adding to ${rand(split)}.`,
        Math.abs(split - p.amount))
    }
    /*
     * THE REMITTANCE HALF. What the client is sent plus what the firm keeps has to be the
     * payment: anything else is money that either appears on a remittance advice or disappears
     * before it.
     */
    const out = al.toClient + al.commission + al.commissionVat + al.toFees + al.toReceiptFee
    if (!near(out, p.amount)) {
      say('broken', 'allocation',
        `A payment of ${rand(p.amount)} remits ${rand(al.toClient)} to the client and keeps `
        + `${rand(al.commission + al.commissionVat + al.toFees + al.toReceiptFee)}, which comes `
        + `to ${rand(out)}.`,
        Math.abs(out - p.amount))
    }
    if (al.toClient < -CENT || al.commission < -CENT) {
      say('broken', 'allocation',
        `A payment of ${rand(p.amount)} allocates a negative amount.`, null)
    }
  }

  return { findings, checked }
}

/** Every account's report, folded into one. */
export function auditBook(
  accounts: AccountLedgers[],
  scheduleAt: (date: string) => AnnexureBSchedule = scheduleFor,
): FinanceReport {
  const findings: FinanceFinding[] = []
  const checked: FinanceReport['checked'] = {
    reconciles: 0, 'in-duplum': 0, 'fee-tariff': 0, allocation: 0,
  }
  for (const a of accounts) {
    const r = auditAccount(a, scheduleAt)
    findings.push(...r.findings)
    for (const k of Object.keys(checked) as FinanceFinding['rule'][]) checked[k] += r.checked[k]
  }
  return { findings, checked }
}

/** What the firm is out of pocket, or over-recovered, across everything found. */
export const randsAtStake = (r: FinanceReport): number =>
  r.findings.reduce((n, f) => n + (f.randsOut ?? 0), 0)

export const RULE_LABELS: Record<FinanceFinding['rule'], string> = {
  reconciles: 'Ledgers that do not add up',
  'in-duplum': 'In duplum',
  'fee-tariff': 'Fees against the gazette',
  allocation: 'Payments and what is remitted',
}

/**
 * The one line a person should read first.
 *
 * SAYS WHAT WAS LOOKED AT, not only what was found. "Nothing wrong" and "nothing examined" are
 * different sentences and the second one is the more urgent of the two — an empty
 * payment_allocations table today means the remittance rule has never once run.
 */
export function headline(r: FinanceReport): string {
  const broken = r.findings.filter((f) => f.severity === 'broken').length
  const suspect = r.findings.length - broken
  const examined = Object.values(r.checked).reduce((n, v) => n + v, 0)
  if (examined === 0) return 'Nothing has been checked yet.'
  if (broken === 0 && suspect === 0) return `Nothing wrong across ${examined} checks.`
  const parts: string[] = []
  if (broken > 0) parts.push(`${broken} broken`)
  if (suspect > 0) parts.push(`${suspect} to look at`)
  return `${parts.join(', ')} across ${examined} checks.`
}
