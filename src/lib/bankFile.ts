/**
 * THE BANK FILE: EVERY PAYMENT OUT OF TRUST THIS MONTH, IN ONE UPLOAD (S7, the firm, 13 Oct).
 *
 * "We're gonna need like an export sheet to pay all of the different people ... making payments to
 * all of the clients once a month", and then: "you should, for example, choose which you will be able
 * to include and exclude. For example, for a refund, if you don't have the debtor's banking details
 * yet, it stays in a pending state."
 *
 * So a payment is IN THE FILE only if it is ticked AND it can be paid: its day has come (a payover
 * before its payout day is not, unless released early on the run) and the bank has everything it
 * needs -- whose account, which bank, a six-digit branch code and an account number. Anything short
 * of that is PENDING and says what is missing; it cannot be ticked, so a file never carries a line
 * the bank would bounce.
 *
 * THE FORMAT is FNB's own: the Payments CSV that Online Banking Enterprise imports under Payments ->
 * Add (+) -> Import (the firm sent the template, "BInSol - U ver 1.00", then FNB's "Payments - CSV
 * Import Guide", June 2025). See `bankFileCsv`. The reference is the BF reference on both sides,
 * because that is the string the statement import matches on.
 *
 * Pure, so a check can hold it.
 */
export interface OutgoingPayment {
  kind: 'payover' | 'refund' | 'drawing'
  id: string
  payee: string
  amount: number
  reference: string | null
  status: string
  dueOn: string | null
  holder: string | null
  bank: string | null
  branch: string | null
  accountNo: string | null
  companyId: string | null
  accountId: string | null
  caseNumber: string | null
}

/** What stops this payment going in the file, in words; empty when it can go. */
export function whatIsMissing(p: OutgoingPayment): string[] {
  const out: string[] = []
  if (p.status === 'scheduled') out.push('not yet due')
  if (!(p.amount > 0)) out.push('nothing to pay')
  /* FNB's amount column is eleven characters, "99999999.99"; a larger payment cannot be written. */
  if (Math.round(p.amount * 100) > FNB_MAX_CENTS) out.push('too large for one bank payment')
  if (!p.reference) out.push('no reference')
  if (!p.holder?.trim()) out.push('account holder')
  if (!p.bank?.trim()) out.push('bank')
  if (!/^\d{6}$/.test((p.branch ?? '').replace(/\s/g, ''))) out.push('branch code')
  if (!/^\d{6,16}$/.test((p.accountNo ?? '').replace(/\s/g, ''))) out.push('account number')
  return out
}

/** The pending reason in words: all four bank fields missing is one thing, said once. */
export function pendingWords(missing: string[]): string {
  const bank = ['account holder', 'bank', 'branch code', 'account number']
  const allBank = bank.every((b) => missing.includes(b))
  return (allBank ? [...missing.filter((m) => !bank.includes(m)), 'no banking details'] : missing).join(', ')
}

export const canPay = (p: OutgoingPayment): boolean => whatIsMissing(p).length === 0

/** Only banking details missing (not "not yet due"): the row offers to add them. */
export const needsBanking = (p: OutgoingPayment): boolean =>
  whatIsMissing(p).some((m) => ['account holder', 'bank', 'branch code', 'account number'].includes(m))

/* ============================================================================================
 * FNB ONLINE BANKING ENTERPRISE: THE PAYMENTS CSV.
 *
 * What FNB's import guide (June 2025) lays down, row by row:
 *   row 1  the template's own name, as FNB's template carries it
 *   row 2  A: the ACTION DATE -- the day the recipients are to be paid. Written CCYY/MM/DD, the
 *          guide's first format; a date in any other shape is silently replaced by TODAY, which is
 *          why the shape is not a matter of taste.
 *   row 3  A: the OWN ACCOUNT the batch is paid FROM -- the firm's TRUST account (firm_settings),
 *          never the business account: this file is client and debtor money leaving trust.
 *          B: the HASH TOTAL, mandatory only where hash totals are switched on for the profile and
 *          to be LEFT BLANK where they are not. Off by default; see `fnbHashTotal`.
 *   row 4  the column headings, A to AJ
 *   row 5+ one payment a row: A name (20), B account (20), C account type (1), D branch (6),
 *          E amount (11), F own reference (20), G recipient reference (20), H-V up to five email
 *          notifications (Yes / address / subject), W-AD fax -- "please leave these fields blank,
 *          fax notifications are no longer supported" -- and AE-AJ two SMS notifications.
 *
 * NO FIELD IS EVER QUOTED. Every free-text field is reduced to letters, digits, spaces and - / .
 * before it is written, so a comma or a quote cannot reach the file and nothing needs escaping.
 * Quoting would also be correct CSV; a file that never needs it is correct as well for an importer
 * that simply splits on commas, and FNB's guide does not say which kind theirs is.
 *
 * LEADING ZEROS ARE KEPT BY WRITING THE DIGITS AS THEY ARE, WITH NO APOSTROPHE. FNB's advice to type
 * ' before a number is advice about EXCEL: the apostrophe is how Excel is told a cell is text, and
 * Excel does not write it into the .csv it saves -- so the file FNB's importer is used to receiving
 * has 051001 in it, not '051001. Raptor writes that file directly, so it writes what Excel would
 * have saved; an apostrophe here would be a character in the account number. (A Standard Bank
 * branch code, 051001, is the everyday case; a hash total under twelve digits, zero-filled, is
 * another.) What loses the zero is OPENING the file in Excel and saving it again, which is why the
 * screen says to upload it as downloaded.
 * ============================================================================================ */

/** The name FNB's template carries in A1 ("BInSol - U ver 1.00", as the firm sent it). */
export const FNB_TEMPLATE_NAME = 'BInSol - U ver 1.00'

/** R99 999 999.99 -- the most FNB's eleven-character amount column holds. */
export const FNB_MAX_CENTS = 9_999_999_999

/** Columns A to AJ, as the import guide numbers them: 7 payment, 5 x 3 email, 2 x 4 fax, 2 x 3 SMS. */
export const FNB_HEADINGS: readonly string[] = [
  'RECIPIENT NAME', 'RECIPIENT ACCOUNT', 'RECIPIENT ACCOUNT TYPE', 'BRANCHCODE', 'AMOUNT', 'OWN REFERENCE', 'RECIPIENT REFERENCE',
  ...[1, 2, 3, 4, 5].flatMap((n) => [`EMAIL ${n} NOTIFY`, `EMAIL ${n} ADDRESS`, `EMAIL ${n} SUBJECT`]),
  ...[1, 2].flatMap((n) => [`FAX ${n} NOTIFY`, `FAX ${n} CODE`, `FAX ${n} NUMBER`, `FAX ${n} SUBJECT`]),
  ...[1, 2].flatMap((n) => [`SMS ${n} NOTIFY`, `SMS ${n} CODE`, `SMS ${n} NUMBER`]),
]

/**
 * Column C, FNB's codes: 0 public recipient, 1 current (cheque/bond), 2 savings, 3 transmission,
 * 4 bond, 6 subscription share, D eWallet Pro, S eWallet Send Money, F FNB card, W WesBank.
 */
export type FnbAccountType = '0' | '1' | '2' | '3' | '4' | '6' | 'D' | 'S' | 'F' | 'W'

/**
 * RAPTOR DOES NOT KNOW WHAT KIND OF ACCOUNT A PAYEE BANKS WITH -- neither `companies` nor a refund
 * keeps it, only holder, bank, branch and number. The payees are clients (businesses), debtors being
 * refunded and the firm itself, and a current account is what the firm pays into nearly always, so
 * every row says 1. If FNB refuses a savings account on it, keeping the type with the banking
 * details is the fix, and `BankFileOptions.accountType` is where it plugs in.
 */
export const FNB_DEFAULT_ACCOUNT_TYPE: FnbAccountType = '1'

/** An FNB payment notification by email (columns H-J). FNB charges for each one. */
export interface FnbEmailNotice { address: string; subject: string }

export interface BankFileOptions {
  /** The trust account the batch is paid FROM (row 3, A). */
  ownAccount: string
  /** The action date, YYYY-MM-DD (the firm's calendar day). */
  actionDate: string
  /**
   * Fill row 3's hash total. OFF unless the firm's FNB profile has hash totals switched on: FNB says
   * to leave the field blank where they are not, and a file it rejects pays nobody.
   */
  hashTotal?: boolean
  /** Column C for a payment; FNB_DEFAULT_ACCOUNT_TYPE where not given. */
  accountType?: (p: OutgoingPayment) => FnbAccountType
  /**
   * An FNB email notification for a payment, or null for none. OFF by default and nothing passes it
   * today: FNB charges for every notification, and Raptor already emails the client its own
   * remittance advice, which says more than FNB's would.
   */
  notify?: (p: OutgoingPayment) => FnbEmailNotice | null
}

/**
 * Free text cut down to what an alphanumeric bank field certainly takes: letters without accents,
 * digits, spaces and - / . ; "&" reads "and" rather than vanishing, anything else becomes a space,
 * runs of spaces become one, and the result is cut to the field's length. The BF references are
 * already inside this set, so the reference the statement import matches on is never changed.
 */
export function fnbText(v: string | null | undefined, max: number): string {
  return (v ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^A-Za-z0-9 ./-]/g, ' ')
    .replace(/\s+/g, ' ').trim()
    .slice(0, max).trim()
}

const digits = (v: string | null | undefined): string => (v ?? '').replace(/\D/g, '')

/** An email address with nothing in it that could break a column, cut at FNB's 100. */
const fnbEmail = (v: string): string => v.trim().replace(/[^A-Za-z0-9@._+-]/g, '').slice(0, 100)

/** YYYY-MM-DD as CCYY/MM/DD, the first of the six date shapes FNB's guide accepts. */
export function fnbDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) throw new Error(`Not a date: ${iso}`)
  return `${m[1]}/${m[2]}/${m[3]}`
}

/**
 * FNB'S HASH TOTAL FOR A CSV FILE, as the guide words it: (1) "Add the digits of the Recipient
 * Account Numbers (column B) of each transaction record", (2) "once the total sum of the accounts in
 * point 1 has been determined, add the 11-digit Own Account Number (Column A3) only once", (3) "use
 * the last 12 digits (right justified)", with the example 12345678987654321 -> 678987654321.
 *
 * "Add the digits of" reads two ways -- add up the account NUMBERS, or add up every DIGIT in them.
 * This is the first, and the guide's own text is why: point 2 speaks of "the total sum of the
 * ACCOUNTS"; it adds an eleven-digit account number to that total, which beside a digit sum of a few
 * hundred would make the total nothing but the firm's own account; and its example total is
 * seventeen digits long, which a sum of digits could only reach with trillions of payments in one
 * file. Summing the numbers is also what a bank hash total has always been (Bankserv's ACB hash
 * sums the homing account numbers the same way). Should a test import say otherwise,
 * `fnbHashTotalDigitSum` is the other reading and swapping the one call in `bankFileCsv` is the
 * whole change.
 *
 * BigInt, because eleven-digit account numbers summed over a month's payovers pass 2^53, and a hash
 * total off in its last digit fails the import. Zero-filled to twelve, "right justified".
 */
export function fnbHashTotal(recipientAccounts: string[], ownAccount: string): string {
  const sum = recipientAccounts.reduce((t, a) => t + BigInt(digits(a) || '0'), 0n) + BigInt(digits(ownAccount) || '0')
  return sum.toString().slice(-12).padStart(12, '0')
}

/** The other reading of point 1 -- every digit of every recipient account added -- kept to switch to. */
export function fnbHashTotalDigitSum(recipientAccounts: string[], ownAccount: string): string {
  const sum = recipientAccounts.reduce((t, a) => t + [...digits(a)].reduce((s, d) => s + BigInt(d), 0n), 0n)
    + BigInt(digits(ownAccount) || '0')
  return sum.toString().slice(-12).padStart(12, '0')
}

/** The own account as FNB wants it (digits, spaces and dashes taken out), or null when it is not one. */
export function fnbOwnAccount(v: string | null | undefined): string | null {
  const raw = (v ?? '').replace(/[\s-]/g, '')
  return /^\d{6,16}$/.test(raw) ? raw : null
}

/**
 * The file: ticked and payable payments only, in the order given. Every row is padded to the 36
 * columns A-AJ, which is how Excel saves FNB's own template. Amounts carry a dot and two places and
 * no thousands separator. Throws, rather than writing a file FNB would refuse -- or one paying from
 * somewhere else -- when the trust account number is not a usable account number.
 */
export function bankFileCsv(payments: OutgoingPayment[], ticked: Set<string>, opts: BankFileOptions): string {
  const own = fnbOwnAccount(opts.ownAccount)
  if (!own) throw new Error('The trust account number in the firm\'s details is not an account number the bank can pay from.')
  const rows = payments.filter((p) => ticked.has(keyOf(p)) && canPay(p))
  const width = FNB_HEADINGS.length
  const line = (cells: string[]): string => [...cells, ...Array<string>(Math.max(0, width - cells.length)).fill('')].join(',')
  const accounts = rows.map((p) => digits(p.accountNo))
  const hash = opts.hashTotal ? fnbHashTotal(accounts, own) : ''
  const payment = (p: OutgoingPayment, i: number): string => {
    const notice = opts.notify?.(p) ?? null
    const address = notice ? fnbEmail(notice.address) : ''
    return line([
      /* A holder in a script the field cannot carry would leave the name empty; the payee's name stands in. */
      fnbText(p.holder, 20) || fnbText(p.payee, 20),
      accounts[i],
      opts.accountType?.(p) ?? FNB_DEFAULT_ACCOUNT_TYPE,
      digits(p.branch),
      (Math.round(p.amount * 100) / 100).toFixed(2),
      fnbText(p.reference, 20),
      fnbText(p.reference, 20),
      ...(notice && address ? ['Yes', address, fnbText(notice.subject, 25)] : []),
    ])
  }
  return [
    line([FNB_TEMPLATE_NAME]),
    line([fnbDate(opts.actionDate)]),
    line([own, hash]),
    line([...FNB_HEADINGS]),
    ...rows.map(payment),
  ].join('\r\n') + '\r\n'
}

export const keyOf = (p: Pick<OutgoingPayment, 'kind' | 'id'>): string => `${p.kind}:${p.id}`

/** Ticked by default: everything that can be paid today. */
export function defaultTicked(payments: OutgoingPayment[]): Set<string> {
  return new Set(payments.filter(canPay).map(keyOf))
}

/** The total of what would go in the file, in cents so a long list cannot drift. */
export function fileTotal(payments: OutgoingPayment[], ticked: Set<string>): number {
  return payments.filter((p) => ticked.has(keyOf(p)) && canPay(p)).reduce((t, p) => t + Math.round(p.amount * 100), 0) / 100
}
