/**
 * The columns a client fills in to hand over new accounts.
 *
 * WHY THIS IS A LIST IN CODE AND NOT JUST A SPREADSHEET. Three things have to agree about these
 * columns: the .xlsx the firm emails to a client, the importer that reads it back, and the
 * headings the importer recognises from the sheet a client has not switched off yet. Written
 * three times they drift, and the failure is not a crash — it is a column quietly not arriving.
 *
 * WHAT THE OLD SHEET TAUGHT US, measured on one client's 45 rows rather than guessed at. Every
 * one of these is a column defined below to stop it happening again:
 *
 *   - THE SURNAME WAS IN "DEBTOR INITIALS", all 45 rows, and "Debtor Surname" was empty. Raptor
 *     addresses a debtor by surname, so that is 45 notices posted to "Dear Sir". The new sheet has
 *     ONE name column that is required, and `initials` is plainly optional beside it.
 *   - "DEBTOR ID" HELD A CELL PHONE, all 45 rows, identical to Cell Phone 1. Not one value was
 *     13 digits. {{debtor_id_masked}} would have printed a telephone number on a statutory demand.
 *   - 40 OF 42 "CELL PHONE 2" VALUES HAD LOST THEIR LEADING ZERO -- Excel read 0129403445 as a
 *     number and stored 129403445. Those numbers cannot be dialled. Every column below that holds
 *     digits-which-are-not-a-quantity is `text`, which is what the generated sheet formats them
 *     as, so Excel never gets the chance.
 *   - "AMOUNT" AND "CAPITAL ON DEFAULT" were identical in all 45 rows. One number, two names,
 *     and one day they disagree. There is one capital column here.
 *   - TWO UNLABELLED PERCENTAGES: "Interest Rate" 24 and "Percentage" 0.25. A percent and a
 *     fraction with nothing saying which was which. Neither is asked for now, at the firm's
 *     instruction -- the rate is in the agreement the firm already holds.
 *   - 31 OF 55 COLUMNS WERE EMPTY IN EVERY ROW, including every address line -- which is
 *     {{debtor_address}}, without which a section 129 cannot be posted at all. The rarely-used
 *     ones are not deleted, because one client's file is evidence about that client; they are
 *     moved to the end and marked as what they are.
 */

export type ColumnKind =
  /** Digits that are not a quantity: a phone, an ID, a reference. Formatted as TEXT in the sheet
   *  so Excel cannot eat a leading zero or turn 13 digits into 1.23457E+12. */
  | 'text'
  /** A real date, written yyyy-mm-dd, so "02/09/2024" can never mean two different days. */
  | 'date'
  | 'money'
  | 'number'
  /** A closed list, offered as a dropdown in the sheet. */
  | 'choice'

export interface HandoverColumn {
  /** Stable key. The label may be reworded for a client; this is what the importer maps onto. */
  key: string
  /** What the client reads at the top of the column. */
  label: string
  group: 'The account' | 'The debtor' | 'Reaching them' | 'Useful if you have it'
  kind: ColumnKind
  required?: true
  choices?: string[]
  /** One line on the notes sheet. Says what to put in, not what the column is called. */
  note: string
  /**
   * Headings on EARLIER sheets that mean this column.
   *
   * THE FIRM: "some clients could possibly take it some time to change the import sheet." So the
   * old headings are not history, they are input — and the mapping is sometimes a correction
   * rather than a rename. "Debtor Initials" is listed under the NAME column, because in the sheet
   * that exists today that is where the surname actually is. Matching is case- and
   * space-insensitive; see aliasIndex.
   */
  was?: string[]
}

export const HANDOVER_COLUMNS: HandoverColumn[] = [
  /* ---------------------------------------------------------------- the account */
  {
    key: 'client_reference', label: 'Your reference', group: 'The account', kind: 'text',
    required: true, was: ['Client Reference', 'Client Prefix', 'Swordfish Reference'],
    note: 'The number YOU know this debt by. It goes on every letter, so the debtor recognises it.',
  },
  {
    key: 'account_number', label: 'Account number', group: 'The account', kind: 'text',
    note: 'The account number on the agreement, if it differs from your reference.',
  },
  /*
   * THE LABEL IS THE CLIENT'S WORD, THE KEY IS RAPTOR'S.
   *
   * THE FIRM: "change that to handover amount ... we should still keep that capital on default,
   * possibly in Raptor, but the import should say handover amount, makes it easier."
   *
   * This is the reason `key` and `label` are separate fields rather than one string. Raptor calls
   * it capital on default because that is what in duplum is measured against -- rename the key
   * and the ceiling stops being about the right number. A client is not asked to know that; they
   * are asked what they are handing over. The NOTE carries the precision the label gives up,
   * because "handover amount" alone would collect a balance including interest from somebody.
   *
   * 'Capital outstanding' is in `was` because a sheet went out with that heading on it. Every
   * label this file has ever used stays readable -- the alias table is not only for the client's
   * old sheet, it is for ours.
   */
  {
    key: 'capital', label: 'Handover amount', group: 'The account', kind: 'money',
    required: true, was: ['Capital on Default', 'Amount', 'Capital outstanding'],
    note: 'The capital owing on the day it defaulted \u2014 what you are handing over, before '
      + 'interest and costs. Numbers only.',
  },
  {
    key: 'default_date', label: 'Date of default', group: 'The account', kind: 'date',
    required: true, was: ['Date of Default'],
    note: 'The day the account fell into default. In duplum runs from here, so it matters.',
  },
  /*
   * THE LAST PAYMENT, NOT "THE INTERRUPTOR". At the firm's instruction: "remove the things about
   * interest and the interruptor -- call it the last date of payment."
   *
   * The old sheet asked for an "Interruptor Before Handover Date", which is the right idea in the
   * wrong words: what actually interrupts prescription, nine times out of ten, is the debtor
   * paying something. A client's bookkeeper knows when they last received money. Nobody outside a
   * law firm knows what an interruptor is, and a column nobody understands is a column filled in
   * with a guess.
   *
   * Interest came out with it: the rate is in the agreement the firm already holds, and the old
   * sheet asked for it twice in two different units -- "Interest Rate" 24 and "Percentage" 0.25,
   * a percent and a fraction with nothing saying which was which.
   */
  {
    key: 'last_payment_date', label: 'Last date of payment', group: 'The account',
    kind: 'date', was: ['Interruptor Before Handover Date', 'Prescription last interrupted on'],
    note: 'The last time they paid anything, even a small amount. Leave empty if they never have.',
  },

  /* ---------------------------------------------------------------- the debtor */
  {
    key: 'debtor_kind', label: 'Person or business', group: 'The debtor', kind: 'choice',
    required: true, choices: ['Person', 'Business'],
    note: 'A business is never addressed as "Mr", and it is traced differently. Pick one.',
  },
  {
    key: 'name', label: 'Surname, or the business name', group: 'The debtor', kind: 'text',
    required: true, was: ['Debtor Surname', 'Debtor Initials'],
    note: 'REQUIRED. Every letter is addressed from this. A business puts its registered name here.',
  },
  {
    key: 'first_name', label: 'First name', group: 'The debtor', kind: 'text',
    was: ['Debtor Firstname'], note: 'Leave empty for a business.',
  },
  {
    key: 'second_name', label: 'Second name', group: 'The debtor', kind: 'text',
    was: ['Debtor Second Name'], note: 'If you have it.',
  },
  {
    key: 'initials', label: 'Initials', group: 'The debtor', kind: 'text',
    note: 'Initials only, e.g. J.P. The surname goes in the name column, not here.',
  },
  {
    key: 'title', label: 'Title', group: 'The debtor', kind: 'choice',
    choices: ['Mr', 'Mrs', 'Ms', 'Miss', 'Dr', 'Prof', 'Adv'],
    was: ['Debtor Title'],
    note: 'If you know it. Left empty, the letter addresses them by name without a title.',
  },
  {
    key: 'id_number', label: 'ID number', group: 'The debtor', kind: 'text',
    was: ['Debtor ID'],
    note: 'The 13-digit South African ID. NOT a telephone number. Leave empty rather than guess.',
  },
  {
    key: 'registration_number', label: 'Company registration number', group: 'The debtor',
    kind: 'text', note: 'For a business, e.g. 2019/940923/07.',
  },

  /* ---------------------------------------------------------------- reaching them */
  {
    key: 'cell_1', label: 'Cell number 1', group: 'Reaching them', kind: 'text',
    was: ['Cell Phone 1'], note: 'With the leading zero: 082 123 4567.',
  },
  { key: 'cell_2', label: 'Cell number 2', group: 'Reaching them', kind: 'text', was: ['Cell Phone 2'], note: 'If you have another.' },
  { key: 'cell_3', label: 'Cell number 3', group: 'Reaching them', kind: 'text', was: ['Cell Phone 3'], note: 'If you have another.' },
  { key: 'home_phone', label: 'Home number', group: 'Reaching them', kind: 'text', was: ['Home Phone 1'], note: 'A landline at home.' },
  { key: 'work_phone', label: 'Work number', group: 'Reaching them', kind: 'text', was: ['Work Phone 1'], note: 'A landline at work, and who to ask for if it is a switchboard.' },
  { key: 'email_1', label: 'Email address', group: 'Reaching them', kind: 'text', was: ['Email 1'], note: 'The one they actually read.' },
  { key: 'email_2', label: 'Second email address', group: 'Reaching them', kind: 'text', was: ['Email 2', 'Email 3'], note: 'A work address, usually.' },
  {
    key: 'street_1', label: 'Street address 1', group: 'Reaching them', kind: 'text',
    was: ['Street Address line 1'],
    note: 'A SECTION 129 IS POSTED TO AN ADDRESS. Without one the notice cannot go out at all.',
  },
  { key: 'street_2', label: 'Street address 2', group: 'Reaching them', kind: 'text', was: ['Street Address line 2'], note: 'Complex, unit number, farm name.' },
  { key: 'suburb', label: 'Suburb', group: 'Reaching them', kind: 'text', was: ['Street Address line 3'], note: '' },
  { key: 'city', label: 'Town or city', group: 'Reaching them', kind: 'text', was: ['Street Address line 4'], note: '' },
  { key: 'street_code', label: 'Code', group: 'Reaching them', kind: 'text', was: ['Street postal code'], note: 'Four digits, leading zero and all.' },
  { key: 'postal_1', label: 'Postal address 1', group: 'Reaching them', kind: 'text', was: ['Postal Address line 1'], note: 'Only if post goes somewhere else.' },
  { key: 'postal_2', label: 'Postal address 2', group: 'Reaching them', kind: 'text', was: ['Postal Address line 2'], note: '' },
  { key: 'postal_city', label: 'Postal town or city', group: 'Reaching them', kind: 'text', was: ['Postal Address line 3', 'Postal Address line 4'], note: '' },
  { key: 'postal_code', label: 'Postal code', group: 'Reaching them', kind: 'text', was: ['Postal code'], note: 'Four digits.' },

  /* ---------------------------------------------------------------- useful if you have it */
  /*
   * NOT DELETED, MOVED. Every one of these was empty in all 45 rows of the sheet we were sent --
   * but that is evidence about ONE client, and an employer's name is the difference between
   * tracing somebody and not. At the end, and marked, so nobody thinks they are being asked for
   * a debtor's marital status before they can hand over an account.
   */
  { key: 'employer', label: 'Employer', group: 'Useful if you have it', kind: 'text', note: 'The single most useful thing for tracing somebody who has moved.' },
  { key: 'occupation', label: 'Occupation', group: 'Useful if you have it', kind: 'text', was: ['Occupation'], note: '' },
  { key: 'next_of_kin', label: 'Next of kin', group: 'Useful if you have it', kind: 'text', note: 'A relative or partner, e.g. Maria Buitendag.' },
  { key: 'next_of_kin_phone', label: 'Next of kin number', group: 'Useful if you have it', kind: 'text', was: ['Next of Kin Number 1'], note: 'e.g. 082 123 4567.' },
  { key: 'notes', label: 'Anything we should know', group: 'Useful if you have it', kind: 'text', note: 'A dispute already raised, an arrangement already broken, a debtor who has died.' },
]

/** The order the groups appear in, taken from the columns so the two cannot disagree. */
export const HANDOVER_GROUPS = [...new Set(HANDOVER_COLUMNS.map((c) => c.group))]

/** A heading as written on any sheet, reduced to something comparable. */
export const headingKey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * Every heading the importer will accept, new and old, pointing at the column it means.
 *
 * THE FIRM: "some clients could possibly take it some time to change the import sheet." So this
 * is not a compatibility shim to be removed later -- it is how the importer reads at all, and an
 * old sheet is as valid an input as a new one. A heading nobody recognises is REPORTED, never
 * guessed at: the cost of mapping the wrong column is a debtor's telephone number printed where
 * an ID number should be, which is exactly what the old sheet did.
 */
export function aliasIndex(): Map<string, HandoverColumn> {
  const out = new Map<string, HandoverColumn>()
  for (const c of HANDOVER_COLUMNS) {
    for (const name of [c.label, c.key, ...(c.was ?? [])]) {
      const k = headingKey(name)
      /* First definition wins, and a collision is a mistake in the table rather than something to
         resolve at runtime -- check-handover-sheet.mjs refuses one. */
      if (!out.has(k)) out.set(k, c)
    }
  }
  return out
}
