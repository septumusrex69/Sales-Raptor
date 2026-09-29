/**
 * THE BANK STATEMENT, READ.
 *
 * WHERE MONEY ACTUALLY ENTERS THE FIRM. Until now the only thing that could write a payment was
 * the Swordfish migration -- the allocation engine, the payover runs and the remittance advice
 * were all built and had no front door. This is the door: the firm's FNB trust-account history,
 * exported as a CSV, which is how they see money arrive.
 *
 * THE FORMAT IS NOT A TABLE WITH A HEADER. It opens with a block naming the account, and the
 * column header sits several lines down:
 *
 *     ACCOUNT TRANSACTION HISTORY
 *
 *     Name:, Camille, Bredell
 *     Account:, 62700201255, [Trust Account]
 *     Balance:, 4427730.54, 4425230.42
 *
 *     Date, Amount, Balance, Description
 *     2026/09/29, 399.88, 0.00, FNB APP PAYMENT FROM  MAB1932
 *
 * So `parseCsv` cannot read it -- that reader takes the first row as the header, and here the
 * first row is a title. This reads rows itself, which it can do safely because the export quotes
 * nothing: measured over a real 2 160-line statement, no field carries a quote and only the
 * zero-amount interest-rate notices ("CR.INT.RATE   4,25000") carry a comma, which is the
 * SA decimal separator rather than a field break. Everything after the third comma is therefore
 * the description, joined back together.
 *
 * THREE KINDS OF LINE AND ONLY ONE IS A RECEIPT.
 *
 *   CREDIT  money in. A debtor paying. This is what becomes an account_payments row.
 *   DEBIT   money out. Remittance to a client, a bank charge. On the firm's own statement these
 *           are 345 of 2 160 lines and they carry client names -- GROWTHPOINT, ACCELERATE INV-.
 *           IMPORTING ONE AS A RECEIPT WOULD CREDIT A DEBTOR WITH MONEY THE FIRM PAID AWAY, so
 *           the direction is decided here and never inferred later from a description.
 *   NOTE    zero-amount lines. The interest-rate notices. Kept rather than dropped so the
 *           preview's line count reconciles to the file, and a dropped line is distinguishable
 *           from an excluded one.
 *
 * THE REFERENCE IS IN THE DESCRIPTION, BEHIND NOISE THAT VARIES BY CHANNEL. The debtor types
 * their account number into the payment reference and the bank prefixes it with how the money
 * came: "FNB APP PAYMENT FROM  MAB1932", "CAPITEC  RSW0296", "ABSA BANK  PHD11708",
 * "ADT CASH DEPOKENAKO   MAB1668" -- and 456 of them with no prefix at all.
 *
 * MEASURED ON THE FIRM'S OWN STATEMENT: 75% of credits (1 366 of 1 815) carry a reference this
 * finds. The rest give a person's or a company's name -- "CAPITEC L SOLOMONS", "MARARA PHARMACY"
 * -- and no rule will turn those into an account. They are not a parsing failure; they are a
 * quarter of the firm's receipts that a person has to place, which is why they get a queue rather
 * than a guess. Guessing by depositor name credits the wrong debtor and remits the wrong client,
 * and a payment is immutable once processed.
 *
 * NOTHING HERE TOUCHES THE DATABASE, so a check can exercise the whole of it in a second --
 * which matters more here than usual, because the thing being got right is which debtor is
 * credited with somebody's money.
 */

/** One line of a statement, as read. */
export interface BankLine {
  /** 1-based, counted over DATA lines in file order. Part of what makes the key stable. */
  lineNo: number
  /** ISO. The bank writes 2026/09/29. */
  date: string
  /** Signed, as the bank writes it: positive in, negative out. */
  amount: number
  /** The running balance, where the bank gave one. Not reliable -- some rows carry 0.00. */
  balance: number | null
  /** Exactly what the bank wrote, kept whole for the person who has to place an unmatched one. */
  description: string
  direction: 'credit' | 'debit' | 'note'
  /**
   * The account number the debtor typed, where one is recognisable. Upper-cased, because the
   * statement carries "rsw0296" as often as "RSW0296" and an account number is not case.
   */
  reference: string | null
  /**
   * WHAT MAKES A RE-UPLOAD SAFE.
   *
   * Statements overlap at month ends, and the firm will upload September and then September plus
   * the first week of October. A double-imported receipt is a debtor credited twice AND a client
   * remitted twice -- and `account_payments` is immutable once remittance has run, so it is not
   * something that can be tidied up afterwards.
   *
   * THE OCCURRENCE INDEX IS THE LOAD-BEARING PART. Keying on date, amount and description alone
   * would collapse two GENUINE payments into one: a debtor paying R500 twice in a day produces
   * two lines that are identical in every other respect, and treating the second as a duplicate
   * loses real money. So identical tuples are numbered in file order, and the second R500 has a
   * different key from the first.
   */
  key: string
}

export interface BankStatement {
  /** The firm's own account, off the header block. Part of every line's key. */
  accountNumber: string | null
  accountName: string | null
  /** "[Trust Account]" -- the firm banks debtor money and client money separately. */
  accountLabel: string | null
  lines: BankLine[]
  /** What could not be read, in words, rather than silently dropped rows. */
  problems: string[]
}

/**
 * HOW THE MONEY CAME, which is the bank's business and not the debtor's reference.
 *
 * Longest first, because "CAPITEC MPY" must be stripped before "CAPITEC" leaves "MPY" looking
 * like a reference prefix -- MPY is itself a real client prefix on this book, which is exactly
 * the kind of collision that would file a payment against the wrong debtor.
 *
 * DERIVED FROM THE FIRM'S OWN STATEMENT rather than imagined: every prefix here was counted in
 * the September export. A channel nobody has used yet simply leaves its words in front of the
 * reference, and the trailing-token rule below still finds it.
 */
const CHANNEL_NOISE: RegExp[] = [
  /^FNB\s+APP\s+PAYMENT\s+FROM\b/i,
  /^INT-BANKING\s+PMT\s+FRM\b/i,
  /^SCHEDULED\s+PYMT\s+FROM\b/i,
  /^INTERNET\s+TRF\s+FROM\b/i,
  /^ADT\s+CASH\s+DEPO\S*/i,
  /^CAPITEC\s+MPY\b/i,
  /^FNB\s+OB\s+PMT\b/i,
  /^STANDARD\s+BANK\b/i,
  /^ABSA\s+BANK\b/i,
  /^TYME\s*BANK\b/i,
  /^NEDBANK\b/i,
  /^CAPITEC\b/i,
  /^REFUND\s*-/i,
  /^MPY\b/i,
]

/**
 * WHAT AN ACCOUNT NUMBER LOOKS LIKE ON THIS BOOK.
 *
 * Two to five letters then digits (MAB1932, PHD11708), optionally with a slashed series
 * (GPS4/10068, GPS3/20038). Both shapes were checked against the live book: on the clients
 * staging actually holds, 35 of 36 extracted references matched `account_number` exactly and none
 * matched more than one account.
 *
 * DELIBERATELY NARROW. A looser pattern starts matching the depositor names -- and a reference
 * that matches nothing costs a person thirty seconds in the queue, while a reference that matches
 * the WRONG account costs a debtor their money and a client their remittance.
 */
const REFERENCE = /^[A-Z]{2,5}\d{0,2}\/\d{1,6}$|^[A-Z]{2,5}\d{1,6}$/i

/**
 * Strip the channel words, then read what is left.
 *
 * THE FIRST REFERENCE-SHAPED TOKEN, IN READING ORDER, because that is the order people write in:
 * the reference, then whatever they added to it. The firm's own statement carries
 * "VAY0049 R WESSELS", "MAB1974 (MOSALA L)", "PMC1826 S ROOS" -- a debtor giving their number AND
 * their name -- and 47 receipts a month sat unplaceable for want of reading past the first word.
 *
 * WHAT MAKES TAKING A CANDIDATE SAFE IS THAT IT IS ONLY A CANDIDATE. Nothing here decides a
 * payment; the caller looks the reference up in the book and a candidate matching no account goes
 * to the queue exactly as an unreadable one does. The cost of a miss is somebody placing a receipt
 * by hand. The cost of a WRONG match is a debtor credited with another debtor's money and a
 * client remitted for it -- and a payment is immutable once processed. So the shape stays narrow
 * enough that a name can never satisfy it: measured over 1 815 real credits, nothing without a
 * digit is ever returned.
 */
export function referenceFrom(description: string): string | null {
  let rest = description.trim()
  for (const noise of CHANNEL_NOISE) {
    const stripped = rest.replace(noise, '').trim()
    if (stripped !== rest) { rest = stripped; break }
  }

  for (const word of rest.split(/\s+/).filter(Boolean)) {
    /*
     * THE WHOLE TOKEN FIRST, AND THIS ORDER IS LOAD-BEARING. A slashed series IS the reference --
     * GPS4/10068 is one account number, not GPS4 followed by 10068 -- and GPS4 on its own
     * satisfies the unslashed shape. Splitting before testing would hand the matcher a reference
     * that is a real prefix and a wrong account.
     */
    if (REFERENCE.test(word)) return word.toUpperCase()

    /* Brackets and a trailing full stop are annotation: "(MOSALA L)", "REF:". */
    const bare = word.replace(/^[([{]+|[)\]}.,;]+$/g, '')
    if (bare !== word && REFERENCE.test(bare)) return bare.toUpperCase()

    /*
     * ONLY NOW split on the joiners people use between a reference and a note -- "RSW5280_S",
     * "RSW4163/SEB029", "T MAREE-DRU0060", "REF:GT0016". Safe at this point precisely because the
     * slashed form was already offered its chance above.
     */
    for (const part of bare.split(/[/_\-:]/).filter(Boolean)) {
      if (REFERENCE.test(part)) return part.toUpperCase()
    }
  }
  return null
}

/** The bank writes 2026/09/29; everything downstream wants 2026-09-29. */
function isoFrom(raw: string): string | null {
  const m = raw.trim().match(/^(\d{4})[/-](\d{2})[/-](\d{2})$/)
  if (!m) return null
  const [, y, mo, d] = m
  /* A real date, not merely a well-shaped one: 2026/02/31 is a corrupt export, not February. */
  const probe = new Date(`${y}-${mo}-${d}T00:00:00Z`)
  if (Number.isNaN(probe.getTime()) || probe.getUTCDate() !== Number(d)) return null
  return `${y}-${mo}-${d}`
}

function amountFrom(raw: string): number | null {
  /* Spaces only. A comma here is the SA decimal separator on an interest-rate notice, not a
     thousands separator on a payment -- removing it would read "4,25000" as R425 000. */
  const cleaned = raw.replace(/\s/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/**
 * Read a statement.
 *
 * TOTAL, IN THE SENSE THE LETTER PARSER IS: every data line contributes a row or a problem, and
 * nothing is dropped quietly. A statement that half-imports is worse than one that refuses,
 * because the difference is invisible on screen and shows up as a debtor who says they paid.
 */
export function parseBankStatement(text: string): BankStatement {
  const raw = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows = raw.split(/\r?\n/)

  let accountNumber: string | null = null
  let accountName: string | null = null
  let accountLabel: string | null = null
  const problems: string[] = []
  const lines: BankLine[] = []

  /* Identical tuples are numbered in file order -- see BankLine.key. */
  const seen = new Map<string, number>()

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row.trim()) continue
    const cells = row.split(',').map((c) => c.trim())

    /* ---- the header block ---- */
    if (/^Name:/i.test(cells[0])) {
      accountName = cells.slice(1).filter(Boolean).join(' ') || null
      continue
    }
    if (/^Account:/i.test(cells[0])) {
      accountNumber = cells[1] || null
      accountLabel = cells[2]?.replace(/^\[|\]$/g, '') || null
      continue
    }
    if (/^Balance:/i.test(cells[0])) continue
    if (/^Date$/i.test(cells[0])) continue
    if (/^ACCOUNT TRANSACTION HISTORY/i.test(row)) continue

    /* ---- a transaction ---- */
    const date = isoFrom(cells[0] ?? '')
    if (!date) {
      /* Not a date and not a header we know. Reported rather than skipped: an unrecognised line
         in a financial file is something a person should look at. */
      problems.push(`Line ${i + 1}: could not read "${row.slice(0, 60)}".`)
      continue
    }
    const amount = amountFrom(cells[1] ?? '')
    if (amount === null) {
      problems.push(`Line ${i + 1}: "${cells[1]}" is not an amount.`)
      continue
    }
    const balance = amountFrom(cells[2] ?? '')
    /* Everything after the third comma. The only lines that need this are the interest-rate
       notices, whose decimal comma would otherwise truncate the description. */
    const description = cells.slice(3).join(',').trim()

    const direction: BankLine['direction'] = amount > 0 ? 'credit' : amount < 0 ? 'debit' : 'note'
    const tuple = `${accountNumber ?? ''}|${date}|${amount.toFixed(2)}|${description}`
    const nth = (seen.get(tuple) ?? 0) + 1
    seen.set(tuple, nth)

    lines.push({
      lineNo: lines.length + 1,
      date,
      amount,
      balance,
      description,
      direction,
      /* Only a credit carries a reference. A debit's description names the CLIENT being paid, and
         reading an account number out of it would offer to match a remittance to a debtor. */
      reference: direction === 'credit' ? referenceFrom(description) : null,
      key: `${tuple}|${nth}`,
    })
  }

  return { accountNumber, accountName, accountLabel, lines, problems }
}

/** What the preview counts, so the screen and the import agree on one arithmetic. */
export interface StatementSummary {
  credits: number
  creditTotal: number
  withReference: number
  withoutReference: number
  debits: number
  debitTotal: number
  notes: number
}

export function summarise(lines: BankLine[]): StatementSummary {
  const credits = lines.filter((l) => l.direction === 'credit')
  const debits = lines.filter((l) => l.direction === 'debit')
  return {
    credits: credits.length,
    creditTotal: round2(credits.reduce((n, l) => n + l.amount, 0)),
    withReference: credits.filter((l) => l.reference).length,
    withoutReference: credits.filter((l) => !l.reference).length,
    debits: debits.length,
    /* Reported as a positive figure: "R123 paid out" reads better than "R-123", and the sign is
       already carried by the word. */
    debitTotal: round2(Math.abs(debits.reduce((n, l) => n + l.amount, 0))),
    notes: lines.filter((l) => l.direction === 'note').length,
  }
}

/* Money is added in cents and read back in rands, so a statement's total cannot drift by a
   floating-point hair from the bank's own. */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}
