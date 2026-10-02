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
 *     addresses a debtor by surname, so that is 45 notices addressed "Dear Sir". The new sheet has
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
 *   - 31 OF 55 COLUMNS WERE EMPTY IN EVERY ROW, including every address line and, in three rows,
 *     the email address -- and THE EMAIL IS THE ONE THAT STOPS A NOTICE. The firm: "we will never
 *     be posting something. Never ever we will post a letter. We will send everything via email."
 *     The street address is still asked for, because a summons is served at one, but nothing
 *     waits on it. The rarely-used
 *     ones are not deleted, because one client's file is evidence about that client; they are
 *     moved to the end and marked as what they are.
 */

export type ColumnKind =
  /** Digits that are not a quantity: a phone, an ID, a reference. Formatted as TEXT in the sheet
   *  so Excel cannot eat a leading zero or turn 13 digits into 1.23457E+12. */
  | 'text'
  /**
   * A real date, formatted dd/mm/yyyy — how South Africa writes one, at the firm's correction.
   *
   * The format is what the person SEES; a date cell stores a serial number, so the importer gets
   * an unambiguous day whichever way it is displayed. Showing an ISO date to a South African
   * bookkeeper bought nothing and read as foreign.
   */
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
    | 'Anything else worth ringing'
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
    note: 'Day/month/year. The day the account fell into default \u2014 in duplum runs from here.',
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
    note: 'Day/month/year. The last time they paid anything, even a small amount. Leave empty if '
      + 'they never have.',
  },

  /* ---------------------------------------------------------------- the debtor */
  /*
   * ASKED FOR, NOT REQUIRED -- and it was required, which put a false sentence on the screen.
   *
   * THE FIRM imported eight accounts off their own Swordfish sheet and read "This sheet has no
   * Person or business. Nothing can be imported from it." above eight accounts that had imported
   * perfectly. Both halves were wrong: the old sheet has no such column and never will, and
   * `Role` -- which is the column it carries -- says debtor or surety, a different fact entirely.
   *
   * A REQUIRED COLUMN NO OLD SHEET CAN SUPPLY REFUSES EVERY OLD SHEET, which is the opposite of
   * the firm's instruction that "any import should work on the old import file from Swordfish".
   * The flag was never enforced, so what it actually produced was a red line nobody could act on
   * over an import that had worked -- a warning that fires when nothing is wrong, and those teach
   * people to stop reading the line.
   *
   * AND THE ANSWER IS IN THE SHEET ANYWAY. A thirteen-digit South African ID that passes its
   * checksum belongs to a person; a company registration number belongs to a business; a name
   * ending "(Pty) Ltd" is a business whatever column it arrived in. `debtorKindFrom` reads those,
   * says on the row how it decided, and falls back to a person -- which is what the database column
   * has always defaulted to. The dropdown stays on the current sheet, because a client who KNOWS
   * should not have us inferring it.
   */
  {
    key: 'debtor_kind', label: 'Person or business', group: 'The debtor', kind: 'choice',
    choices: ['Person', 'Business'],
    note: 'A business is never addressed as "Mr", and it is traced differently. Pick one. Left '
      + 'empty, we read it off the ID or registration number.',
  },
  {
    key: 'name', label: 'Surname, or the business name', group: 'The debtor', kind: 'text',
    /* 'Surname' plain is here because it is what somebody types when they shorten our own
       heading, and it went unrecognised -- which on the required name column means every row
       refused for having no name. Found by a test fixture that had done exactly that. */
    required: true, was: ['Debtor Surname', 'Debtor Initials', 'Surname'],
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
    /* NOT FOR POSTING. The firm: "we will never be posting something. Never ever we will post a
       letter. We will send everything via email." What an address is actually for here is a
       sheriff serving a summons and a tracer knocking on a door, so it says that instead. */
    note: 'Where they live or trade. A summons is served at a physical address, and it is where '
      + 'a trace starts.',
  },
  { key: 'street_2', label: 'Street address 2', group: 'Reaching them', kind: 'text', was: ['Street Address line 2'], note: 'Complex, unit number, farm name.' },
  { key: 'suburb', label: 'Suburb', group: 'Reaching them', kind: 'text', was: ['Street Address line 3'], note: '' },
  { key: 'city', label: 'Town or city', group: 'Reaching them', kind: 'text', was: ['Street Address line 4'], note: '' },
  { key: 'street_code', label: 'Code', group: 'Reaching them', kind: 'text', was: ['Street postal code'], note: 'Four digits, leading zero and all.' },
  /* THE FIRM DOES NOT POST, so this cannot be introduced as where their post goes. It is kept
     because it is a fact about the debtor a client already holds, and because the old sheet's
     four postal columns have to keep being readable -- not because anything is sent to it. */
  { key: 'postal_1', label: 'Postal address 1', group: 'Reaching them', kind: 'text', was: ['Postal Address line 1'], note: 'Only if it differs from the street address.' },
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
  /* A SECOND ONE, at the firm's request. One relative is one telephone that may be out of use;
     the point of a next of kin is to have somewhere to go when the debtor's own numbers stop
     answering, and one of them is not a list. */
  { key: 'next_of_kin_2', label: 'Second next of kin', group: 'Useful if you have it', kind: 'text', note: 'Another relative, e.g. Pieter Buitendag.' },
  { key: 'next_of_kin_2_phone', label: 'Second next of kin number', group: 'Useful if you have it', kind: 'text', was: ['Next of Kin Number 2'], note: 'e.g. 083 234 5678.' },
  { key: 'notes', label: 'Anything we should know', group: 'Useful if you have it', kind: 'text', note: 'A dispute already raised, an arrangement already broken, a debtor who has died.' },

  /* ---------------------------------------------------------------- anything else to ring
   *
   * A BLOCK FOR THE NUMBERS THAT FIT NOWHERE ELSE, at the firm's request. The named columns above
   * cover the debtor, their work and their next of kin; a client who has an employer's
   * switchboard, a neighbour, or the attorney who wrote to them last year had nowhere to put it
   * and the old sheet's answer was a fourth column of every kind, thirty-one of which were empty
   * in every row.
   *
   * ONE PLACE, WITH A LINE SAYING WHOSE IT IS, which is the thing a collector actually needs: a
   * number nobody can say whose it is gets rung once and never again.
   */
  { key: 'other_phone', label: 'Another number', group: 'Anything else worth ringing', kind: 'text', note: 'Any other number for them, e.g. 011 456 7890.' },
  { key: 'other_phone_2', label: 'And another', group: 'Anything else worth ringing', kind: 'text', note: 'e.g. 084 345 6789.' },
  { key: 'other_email', label: 'Another email address', group: 'Anything else worth ringing', kind: 'text', note: 'e.g. j.vdwesthuizen@work.co.za.' },
  { key: 'other_contact_note', label: 'Whose numbers are these', group: 'Anything else worth ringing', kind: 'text', note: 'Say whose they are, e.g. "his employer\u2019s switchboard, ask for Sarah".' },
]

/* ---------------------------------------------------------------------------------------------
 * THE COLUMNS THE FIRM HAS DECIDED NOT TO ASK FOR.
 *
 * WHY THIS LIST EXISTS AT ALL, which is the firm reading their own import back: the screen said
 * "Not recognised, so not imported: Role, Interest Rate, Interest Date, Percentage, Client
 * Division, Home Phone 2, ... Capital on Default, Debtor Surname" over twenty-eight headings, and
 * nearly none of that was true.
 *
 * THREE DIFFERENT THINGS WERE BEING SAID IN ONE SENTENCE, and only the smallest of them was what
 * the sentence claimed:
 *
 *   1. A heading nobody has ever decided about. `Role`, `Client Division`. THIS is "not
 *      recognised", it is a question for a person, and there turn out to be two of them.
 *   2. A heading that LOST A CONTEST to its twin and whose data came in anyway. "Capital on
 *      Default" sat beside "Amount" with the same figure in both; "Debtor Surname" was empty and
 *      "Debtor Initials" held every surname. Both were read, correctly, through the other column
 *      — and telling the firm the handover amount was "not imported" is the most alarming
 *      possible way to describe an import that worked.
 *   3. A heading the firm DELIBERATELY DOES NOT COLLECT. "Interest Rate" is not unrecognised;
 *      Raptor knows exactly what it is and declines it, because the rate is in the agreement the
 *      firm already holds. Filing a decision under "not recognised" invites somebody to undo it.
 *
 * So this list is the third kind, written down, with the reason beside each — and the importer
 * reports the three apart. A warning that fires when nothing is wrong is worse than no warning,
 * because people stop reading it, and twenty-six false alarms were burying the two real ones.
 *
 * IT IS NOT A WAY TO DROP A COLUMN QUIETLY. Every heading here is still REPORTED, and reported
 * with a count: a `Home Phone 2` that is empty in every row is a line of housekeeping, and one
 * with eight numbers in it is a client handing us telephone numbers we are throwing away. Those
 * are different sentences and the importer writes whichever is true.
 * ------------------------------------------------------------------------------------------- */

export interface NotCollectedColumn {
  /** Every heading that means this, as the old sheets write it. */
  headings: string[]
  /** Why it is not asked for, in the firm's terms. Shown beside the heading. */
  why: string
}

export const NOT_COLLECTED: NotCollectedColumn[] = [
  /*
   * THE INTEREST BLOCK, at the firm's instruction: "remove the things about interest and the
   * interruptor." The old sheet asked for the rate TWICE in two different units -- "Interest Rate"
   * 24 and "Percentage" 0.25, a percent and a fraction with nothing saying which was which -- and
   * `toDebtorInput` opens every account at 0% on purpose, because an account at nought is one
   * somebody notices and an account at a guessed 24% is one nobody does.
   */
  {
    headings: ['Interest Rate', 'Percentage', 'Interest Date'],
    why: 'the rate is in the agreement you have already sent us, so the account opens at 0% and '
      + 'the firm sets it from the agreement',
  },
  /*
   * THE FOURTH COLUMN OF EVERY KIND. The old sheet carried four of each telephone, four emails,
   * three faxes and three next of kin; thirty-one of its fifty-five columns were empty in every
   * row. The current sheet asks for the ones that get used and gives everything else ONE place
   * with a line saying whose it is -- see 'Anything else worth ringing' above. A number nobody can
   * say whose it is gets rung once and never again.
   */
  {
    headings: [
      'Home Phone 2', 'Home Phone 3', 'Home Phone 4',
      'Work Phone 2', 'Work Phone 3', 'Work Phone 4',
      'Cell Phone 4', 'Email 4', 'Next of Kin Number 3',
    ],
    why: 'the sheet now asks for one spare number under "Another number", with a line saying '
      + 'whose it is',
  },
  /* THE FIRM DOES NOT FAX, and has not for the life of this system. Listed rather than left
     unrecognised so that nobody "fixes" it by adding a fax column. */
  { headings: ['Fax Number 1', 'Fax Number 2', 'Fax Number 3'], why: 'the firm does not send faxes' },
  /*
   * AND THE DEBTOR'S CIRCUMSTANCES. The firm's own words on the group these came out of: nobody
   * should think "they are being asked for a debtor's marital status before they can hand over an
   * account". None of them changes how a debt is collected. The employer and the occupation DO --
   * they are how somebody who has moved is traced -- and both are still asked for.
   */
  {
    headings: ['Nationality', 'Gender', 'Marital Status', 'Number of Children', 'Passport number'],
    why: 'none of it changes how the debt is collected, and the sheet asks for the employer and '
      + 'occupation instead, which is what a trace runs on',
  },
]

/** Heading, reduced, to the reason the firm does not collect it. */
export function notCollectedIndex(): Map<string, string> {
  const out = new Map<string, string>()
  for (const c of NOT_COLLECTED) {
    for (const h of c.headings) out.set(headingKey(h), c.why)
  }
  return out
}

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
