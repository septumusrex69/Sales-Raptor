import type { ClientPosition } from './clientPosition.ts'

/**
 * The detail under an account's position.
 *
 * TWO LAYERS, NOT ONE LIST. The POSITION says where an account is, exactly one per account, so
 * the counts add up to the book. FLAGS say why, as many as are true at once — an account can be
 * in Section 129 AND under debt review AND the debtor unemployed, and all three matter.
 *
 * The firm's own client-facing document grouped these under eleven "titles" -- Section 129,
 * Promise To Pay, Tracing, Delinquent Payer and so on -- and the titles are deliberately NOT
 * reproduced here. They were four different questions wearing one hat: where the work is
 * (Section 129, Tracing), what the debtor is doing (PTP, Payment Default), the debtor's legal
 * situation (Deceased, Liquidation) and who holds the account (Refer Back To Client). An account
 * is routinely several of those at once, so a single title cannot answer, and the book shows
 * staff working around it -- flags stacked with semicolons, and "Debtor avoiding contact" on 380
 * accounts despite appearing nowhere in the document.
 *
 * So: the titles are dropped, the position is derived, and the flags keep the firm's own words.
 *
 * SELF-IDENTIFYING NAMES. The document used "Verified" and "Unverified" under three different
 * titles -- liquidation, debt review and a deceased estate -- which means the stored string
 * "Verified" cannot be read at all without a parent the data does not carry. Renamed here so
 * each one says what it is. `legacy` records what the imported book calls it.
 */

export interface AccountFlag {
  /** Stored on the account. Never change one without migrating the book. */
  value: string
  /** What it says to a client. The firm's words. */
  description: string
  /**
   * The position this flag implies when nothing stronger applies.
   *
   * Advisory, not binding: the position is derived from records first — money, a promise, an
   * open dispute — and a flag only speaks where the records are silent. A flag that could
   * override a payment would let a stale label hide a debtor who has started paying.
   */
  implies?: ClientPosition
  /** What the imported Swordfish book calls this, where the two differ. */
  legacy?: string
  /** Shown to the client on their report. Some flags are internal working state. */
  clientFacing: boolean
}

export const ACCOUNT_FLAGS: AccountFlag[] = [
  /* ---------- the Section 129 process ---------- */
  {
    value: 'Section 129 issued',
    legacy: 'Section 129 in process',
    description:
      'A Section 129 letter of demand has been issued. The debtor may settle, arrange instalments '
      + 'or raise a dispute within the period allowed. We telephone the debtor as soon as it goes '
      + 'out, to arrange payment without waiting for the period to run.',
    implies: 'legal',
    clientFacing: true,
  },
  {
    value: 'Awaiting documents',
    legacy: 'Document & data management',
    description: 'Referred internally for additional information or documentation before we can proceed.',
    clientFacing: true,
  },

  /* ---------- paying, or meant to be ---------- */
  {
    value: 'Instalment arrangement',
    description: 'The debtor has arranged instalments, or a settlement, to clear the account.',
    implies: 'arranged',
    clientFacing: true,
  },
  {
    value: 'Slow payer',
    description:
      'Paying monthly, but small amounts against the capital outstanding. We keep the relationship '
      + 'positive through the down-payment period and work to increase the instalment.',
    implies: 'arranged',
    clientFacing: true,
  },
  {
    value: 'Irregular payer',
    description:
      'An arrangement exists but the debtor keeps to no fixed pattern. We are working towards fixed '
      + 'instalments; the relationship is what recovers the money here.',
    implies: 'arranged',
    clientFacing: true,
  },
  {
    value: 'Discount requested',
    description: 'The debtor has asked for a discount or settlement figure. Awaiting your decision.',
    clientFacing: true,
  },
  {
    value: 'Settlement requested',
    description: 'The debtor has asked for a settlement figure to clear the account in one payment.',
    clientFacing: true,
  },
  {
    value: 'Payment default',
    description:
      'An arranged instalment was not paid. We make contact immediately — speed is what recovers a '
      + 'defaulted payment. If the default stands, credit bureau listing or legal action is the '
      + 'next recourse.',
    implies: 'broken_arrangement',
    clientFacing: true,
  },

  /* ---------- disputes ---------- */
  {
    value: 'Awaiting written dispute',
    description:
      'The debtor says the account is in dispute and has been asked to put it in writing. A grace '
      + 'period applies, in line with legislation.',
    implies: 'disputed',
    clientFacing: true,
  },
  {
    value: 'Dispute overdue',
    description:
      'The written dispute was not received within the grace period. We are following up to '
      + 'establish what the dispute is. If nothing comes, listing or legal action is the recourse.',
    implies: 'disputed',
    clientFacing: true,
  },
  {
    value: 'Dispute resolution process',
    description:
      'A written dispute has been received and is being resolved with our legal team. We will come '
      + 'to you if we need help resolving it.',
    implies: 'disputed',
    clientFacing: true,
  },

  /* ---------- finding them ---------- */
  {
    value: 'Debtor avoiding contact',
    /*
     * THE MOST-USED FLAG ON THE BOOK — 380 accounts — and absent from the firm's document
     * entirely. Kept because the book says it is real, and worded carefully: it is a judgement
     * about the debtor, so it should not be reached for merely because nobody has rung.
     */
    description:
      'Contact details appear to work but the debtor does not respond to us. Attempts continue '
      + 'across different numbers and times of day.',
    implies: 'not_paying',
    clientFacing: true,
  },
  {
    value: 'New trace request',
    description:
      'We could not make contact on the details supplied, so a trace has been lodged with the major '
      + 'credit and information bureaus for updated contact details.',
    implies: 'tracing',
    clientFacing: true,
  },
  {
    value: 'Details updated from trace',
    description: 'The trace returned new details for the debtor. Contact is being attempted again.',
    implies: 'tracing',
    clientFacing: true,
  },
  {
    value: 'Untraceable',
    legacy: 'Untracable',
    description:
      'The debtor cannot be reached on the details you supplied, the bureaus returned nothing new, '
      + 'the updated details also failed, and other tracing routes hold nothing useful.',
    implies: 'tracing',
    clientFacing: true,
  },

  /* ---------- why no money is coming ---------- */
  {
    value: 'Unemployed',
    description: 'The debtor is unemployed. We check back periodically for a change in employment.',
    implies: 'not_paying',
    clientFacing: true,
  },
  {
    value: 'Pensioner',
    description:
      'The debtor is a pensioner, commonly SASSA, and cannot pay for financial reasons. We keep '
      + 'trying; the account moves to an instalment arrangement once anything can be recovered.',
    implies: 'not_paying',
    clientFacing: true,
  },
  {
    value: 'Hospitalisation',
    description:
      'The debtor is in hospital. We stay in touch with the debtor or close relatives to administer '
      + 'the matter and recover payment.',
    implies: 'not_paying',
    clientFacing: true,
  },
  {
    value: 'Foreign debtor',
    description:
      'The debtor is a foreign national. Recovery is harder — language, and the risk of the debtor '
      + 'leaving the country.',
    implies: 'not_paying',
    clientFacing: true,
  },
  {
    value: 'Business closed',
    description:
      'The debtor business is no longer trading. Smaller companies often do not go through a formal '
      + 'liquidation, which makes the position hard to establish.',
    implies: 'not_paying',
    clientFacing: true,
  },
  {
    value: 'Refuses to pay',
    legacy: 'Non-Cooperative',
    /*
     * THE ONLY FLAG THAT MEANS WILL NOT RATHER THAN CANNOT, and the reason "Not paying" is the
     * position rather than "Refusing to pay". It is what turns an account into a litigation
     * candidate, so it must be something a person deliberately recorded after speaking to the
     * debtor — never inferred from silence.
     */
    description: 'The debtor has been reached and has refused to pay.',
    implies: 'not_paying',
    clientFacing: true,
  },

  /* ---------- somebody else is administering the debtor ---------- */
  {
    value: 'Debt review',
    description:
      'The debtor is under debt review. Where a payment schedule is approved, instalments come to '
      + 'us from the debt review practitioner.',
    implies: 'under_administration',
    clientFacing: true,
  },
  {
    value: 'Debt review confirmed',
    legacy: 'Verified',
    description: 'A claim has been submitted with the debt review practitioner and payments are expected on the approved schedule.',
    implies: 'under_administration',
    clientFacing: true,
  },
  {
    value: 'Business rescue',
    description: 'The debtor company is in business rescue. We deal with the rescue practitioner.',
    implies: 'under_administration',
    clientFacing: true,
  },
  {
    value: 'Liquidation or sequestration claimed',
    legacy: 'Unverified',
    description:
      'The debtor states they are in liquidation or sequestration. We are awaiting confirmation '
      + 'from the liquidator or trustee.',
    implies: 'under_administration',
    clientFacing: true,
  },
  {
    value: 'Liquidation or sequestration confirmed',
    legacy: 'Verified',
    description:
      'Confirmed by the liquidator or trustee. We are establishing whether a claim against the '
      + 'insolvent estate is worth submitting.',
    implies: 'under_administration',
    clientFacing: true,
  },
  {
    value: 'Death reported',
    legacy: 'Unverified',
    description: 'A next of kin has told us the debtor has died. A death certificate has been requested.',
    implies: 'under_administration',
    clientFacing: true,
  },
  {
    value: 'Death certificate received',
    legacy: 'Verified',
    description:
      'The death certificate is on file. We are contacting the executor to establish whether a '
      + 'claim against the estate is viable. Where no next of kin can be reached, death is '
      + 'confirmed by trace.',
    implies: 'under_administration',
    clientFacing: true,
  },
  {
    value: 'Claim submitted',
    description: 'A claim has been submitted against the estate.',
    implies: 'under_administration',
    clientFacing: true,
  },
  {
    value: 'Estate insolvent',
    description: 'The executor has confirmed the estate is insolvent. We will refer the matter back to you.',
    implies: 'under_administration',
    clientFacing: true,
  },

  /* ---------- going back to the client ---------- */
  {
    value: 'Legal action',
    description: 'Referred to an attorney for further legal action against the debtor, on your instruction.',
    implies: 'legal',
    clientFacing: true,
  },
  {
    value: 'Settled',
    description: 'Settled, by payment or by compromise.',
    implies: 'closed',
    clientFacing: true,
  },
  {
    value: 'Prescribed',
    description:
      'Prescribed under the Prescription Act. This happens automatically three years after the sale '
      + 'or service date.',
    implies: 'closed',
    clientFacing: true,
  },
  {
    value: 'Withdrawn',
    description: 'You have withdrawn the account.',
    implies: 'closed',
    clientFacing: true,
  },
  {
    value: 'Recommended write-off',
    description:
      'The debtor has failed or refused to pay and further legal action is not viable — a low claim '
      + 'amount, an untraceable debtor, no verifiable assets, or your decision not to litigate.',
    implies: 'closed',
    clientFacing: true,
  },
]

const BY_VALUE = new Map(ACCOUNT_FLAGS.map((f) => [f.value.toLowerCase(), f]))
const BY_LEGACY = new Map(
  ACCOUNT_FLAGS.filter((f) => f.legacy).map((f) => [(f.legacy as string).toLowerCase(), f]),
)

/**
 * A stored flag string, resolved to a known flag.
 *
 * Tries the current name first and the imported book's name second. Ambiguous legacy names —
 * "Verified" meant three different things — resolve to whichever flag claims them first, which
 * is why re-filing those accounts is owed rather than guessable. Unknown strings return null
 * rather than throwing: the book is full of words nobody chose, and a report that falls over on
 * one of them is worse than one that skips it.
 */
export function flagFor(raw: string | null | undefined): AccountFlag | null {
  const key = (raw ?? '').trim().toLowerCase()
  if (!key) return null
  return BY_VALUE.get(key) ?? BY_LEGACY.get(key) ?? null
}

/**
 * The flags on an account, in the order they are stored.
 *
 * The imported book joins them with semicolons — "Awaiting written dispute; Debtor avoiding
 * contact; Section 129 in process" — which is itself the argument for flags being a list rather
 * than a single title.
 */
export function parseFlags(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(';')
    .map((f) => f.trim())
    .filter(Boolean)
}

/** Only what a client should read. Internal working state stays internal. */
export function clientFlags(raw: string | null | undefined): AccountFlag[] {
  return parseFlags(raw)
    .map(flagFor)
    .filter((f): f is AccountFlag => f !== null && f.clientFacing)
}

/**
 * The position the flags suggest, where the records say nothing.
 *
 * LAST RESORT, DELIBERATELY. A flag is a label somebody set once and may never revisit; a
 * payment, a promise and an open dispute are facts with dates on them. Where they disagree the
 * facts win, so a debtor who has started paying is never reported as unemployed and idle because
 * of a flag set in March.
 *
 * Where several flags imply different positions, the one nearest the top of ACCOUNT_FLAGS wins:
 * the list is ordered from the most constraining to the least.
 */
export function positionFromFlags(raw: string | null | undefined): ClientPosition | null {
  const order = new Map(ACCOUNT_FLAGS.map((f, i) => [f.value, i]))
  let best: { pos: ClientPosition; rank: number } | null = null
  for (const name of parseFlags(raw)) {
    const flag = flagFor(name)
    if (!flag?.implies) continue
    const rank = order.get(flag.value) ?? Number.MAX_SAFE_INTEGER
    if (!best || rank < best.rank) best = { pos: flag.implies, rank }
  }
  return best?.pos ?? null
}
