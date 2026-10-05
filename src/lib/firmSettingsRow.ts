/**
 * THE FIRM'S OWN DETAILS, AS A ROW AND AS A SHAPE — AND THE MAPPER BETWEEN THEM.
 *
 * HELD APART FROM firmSettings.ts SO THE SERVER CAN USE THE MAPPER. That file reaches the
 * database through the browser's Supabase client, which throws at import in Node -- so a
 * serverless function cannot touch it, and the workflow runner needs these details on every
 * notice it sends. The same split, for the same reason, as emailStyle.ts beside it and runSteps.ts
 * beside accountRun.ts: the part worth sharing is the part with no client in it.
 *
 * AND THE MAPPER IS WHY THIS MATTERS RATHER THAN BEING TIDINESS. The row is snake_case and the
 * shape is camelCase, and the runner originally passed the RAW ROW through a cast -- so
 * `firmName` and `officeHours` read as undefined, every notice held on "{{firm_name}} and
 * {{firm_hours}}", and the firm's own details were sitting correctly in the table the whole time.
 * CLAUDE.md names this exact trap: firmSettings keeps five lists, and a cast walks past all of
 * them.
 *
 * Pure: no database, no clock, no network.
 */
import { CHARTER_EMAIL_STACK } from './charter.js'

/*
 * WRITTEN OUT, NOT BUILT FROM A LIST, and the reason is a check rather than taste:
 * check-select-columns.mjs resolves a const that is a literal or a concatenation of literals and
 * SILENTLY SKIPS anything else. A list mapped and joined here would read fine, cover nothing, and
 * take the count up by zero -- which is how that check was found not to be running at all once
 * before. check-firm-settings.mjs holds this string against schema.sql instead, in both
 * directions, so a column added to the table and forgotten here is a failure rather than a field
 * that reads `undefined` for ever.
 */
export const COLUMNS = 'firm_name, registration_number, vat_number, council_number, '
  + 'phone, phone_alt, email, website, physical_address, postal_address, office_hours, '
  + 'trust_bank, trust_branch_code, trust_account_name, trust_account_number, '
  + 'trust_account_type, payment_instruction, '
  + 'business_bank, business_branch_code, business_account_name, business_account_number, '
  + 'signatory_name, signatory_title, '
  + 'email_font, email_size_pt, vat_rate, time_zone, finance_cutover_at, updated_at'

export interface Row {
  firm_name: string
  registration_number: string | null
  vat_number: string | null
  council_number: string | null
  phone: string | null
  phone_alt: string | null
  email: string | null
  website: string | null
  physical_address: string | null
  postal_address: string | null
  office_hours: string | null
  trust_bank: string | null
  trust_branch_code: string | null
  trust_account_name: string | null
  trust_account_number: string | null
  trust_account_type: string | null
  payment_instruction: string | null
  business_bank: string | null
  business_branch_code: string | null
  business_account_name: string | null
  business_account_number: string | null
  signatory_name: string | null
  signatory_title: string | null
  email_font: string
  email_size_pt: number | string
  /* numeric comes back as a string over the wire, like every other numeric here. */
  vat_rate: number | string
  time_zone: string
  finance_cutover_at: string | null
  updated_at: string
}

export interface FirmSettings {
  firmName: string
  /** Company registration number, if the firm shows one. Printed, never acted on. */
  registrationNumber: string | null
  vatNumber: string | null
  /** Council for Debt Collectors number, where the firm shows it on correspondence. */
  councilNumber: string | null
  /** The office's own line — NOT {{agent_phone}}, which is whoever is dealing with the account. */
  phone: string | null
  phoneAlt: string | null
  email: string | null
  /** As typed: no scheme added, none stripped. A letterhead and a signature want different ones. */
  website: string | null
  /** Multi-line and merged as typed: an address is written on its own lines on a letterhead. */
  physicalAddress: string | null
  /** Where post is received, which is not always where the firm sits. Multi-line, like above. */
  postalAddress: string | null
  /** One free-text line, written the way it should read. Nothing in the app acts on it. */
  officeHours: string | null
  /** Where a DEBTOR pays in. Bank and branch code apart — the firm's own correction. */
  trustBank: string | null
  trustBranchCode: string | null
  /** The beneficiary name. An account number on its own is not enough to pay into. */
  trustAccountName: string | null
  trustAccountNumber: string | null
  /** The bank's own words for it: "Legal Practitioner Trust Account". Printed, never acted on. */
  trustAccountType: string | null
  /**
   * The standing paragraph asking a debtor to pay into that account rather than the client.
   * The firm's words, merged as typed, and offered to collections templates only.
   */
  paymentInstruction: string | null
  /** Where a CLIENT pays the firm what it still owes. Never where a debtor pays. */
  businessBank: string | null
  businessBranchCode: string | null
  businessAccountName: string | null
  businessAccountNumber: string | null
  signatoryName: string | null
  /** The firm's own correction: not "authorised agent" — a duly authorised legal representative. */
  signatoryTitle: string | null
  /** A full CSS stack, not a face. See EMAIL_FONTS. */
  emailFont: string
  emailSizePt: number
  /**
   * VAT AS A FRACTION: 0.15 is fifteen percent, the same unit as a commission rate.
   *
   * On the firm's settings rather than in code because it is a rate the firm changes when SARS
   * does -- and because the allocation engine, which runs in SQL, reads it from the same row.
   */
  vatRate: number
  /**
   * THE ZONE THE FIRM WORKS IN, AND WHAT A FLOATING INVITATION MEANS.
   *
   * RFC 5545 calls a DATE-TIME with neither a `Z` nor a `TZID` a FLOATING time, and says it is
   * read on the observer's own clock -- 10:30 means 10:30 wherever you are. Raptor used to refuse
   * those, so a booking confirmation went on the calendar with no time and sat in a banner above
   * the grid rather than on it. This is the clock they are read on.
   *
   * A SETTING RATHER THAN A CONSTANT because the firm asked for it that way: South Africa by
   * default, "unless you deliberately change it".
   */
  timeZone: string
  /**
   * WHEN THE ALLOCATION ENGINE STARTS SPLITTING PAYMENTS, AND NULL UNTIL THE FIRM SAYS SO.
   *
   * Payments CAPTURED on or after this are split by Raptor; everything earlier keeps the outcome
   * Swordfish gave it, because remittances have already been passed on it -- CLAUDE.md's rule
   * about imported history, applied to the one switch that could rewrite twenty thousand
   * accounts' worth of it. Null means the engine is off, which is the safe default and the value
   * it ships with.
   *
   * It is READ here and set nowhere in the app: switching the engine on is a decision with a date
   * on it, not a field somebody edits between two other fields on a settings page.
   */
  financeCutoverAt: string | null
  updatedAt: string
}

/**
 * WHAT THE FIRM FALLS BACK TO BEFORE ANYBODY HAS FILLED THIS IN.
 *
 * Every field is null, not an empty string, and that is the whole point: `mergeValuesFor`
 * turns null into a placeholder left standing and an empty string into a blank line. One of those
 * gets caught before it is posted; the other gets posted.
 */
export const FIRM_UNSET: FirmSettings = {
  firmName: 'Bredell Ferreira',
  registrationNumber: null,
  vatNumber: null,
  councilNumber: null,
  phone: null,
  phoneAlt: null,
  email: null,
  website: null,
  physicalAddress: null,
  postalAddress: null,
  officeHours: null,
  trustBank: null,
  trustBranchCode: null,
  trustAccountName: null,
  trustAccountNumber: null,
  trustAccountType: null,
  paymentInstruction: null,
  businessBank: null,
  businessBranchCode: null,
  businessAccountName: null,
  businessAccountNumber: null,
  signatoryName: null,
  signatoryTitle: null,
  emailFont: CHARTER_EMAIL_STACK,
  emailSizePt: 10.5,
  /* The rate today, and the one every figure in the codebase already assumes. */
  vatRate: 0.15,
  /* The zone every date in this codebase already names literally, in one place for once. */
  timeZone: 'Africa/Johannesburg',
  /* Off. An engine that switched itself on across the whole book would not be undoable. */
  financeCutoverAt: null,
  updatedAt: '',
}

/**
 * Named by hand, like every mapper here — and `Number()` on the size for the reason CLAUDE.md
 * gives: `numeric(4,1)` comes back from PostgREST as the STRING "10.5". Concatenated into a CSS
 * font-size it reads correctly and then silently does nothing the first time anybody does
 * arithmetic on it.
 */
export function toSettings(r: Row): FirmSettings {
  const some = (v: string | null): string | null => (v ?? '').trim() || null
  return {
    firmName: r.firm_name,
    registrationNumber: some(r.registration_number),
    vatNumber: some(r.vat_number),
    councilNumber: some(r.council_number),
    phone: some(r.phone),
    phoneAlt: some(r.phone_alt),
    email: some(r.email),
    website: some(r.website),
    physicalAddress: some(r.physical_address),
    postalAddress: some(r.postal_address),
    officeHours: some(r.office_hours),
    trustBank: some(r.trust_bank),
    trustBranchCode: some(r.trust_branch_code),
    trustAccountName: some(r.trust_account_name),
    trustAccountNumber: some(r.trust_account_number),
    trustAccountType: some(r.trust_account_type),
    paymentInstruction: some(r.payment_instruction),
    businessBank: some(r.business_bank),
    businessBranchCode: some(r.business_branch_code),
    businessAccountName: some(r.business_account_name),
    businessAccountNumber: some(r.business_account_number),
    signatoryName: some(r.signatory_name),
    signatoryTitle: some(r.signatory_title),
    emailFont: r.email_font,
    emailSizePt: Number(r.email_size_pt),
    vatRate: Number(r.vat_rate),
    /* A row written before the column existed reads null over the wire, and a null zone is a
       calendar that stops placing floating invitations -- the state this column exists to end. */
    timeZone: r.time_zone || 'Africa/Johannesburg',
    financeCutoverAt: r.finance_cutover_at ?? null,
    updatedAt: r.updated_at,
  }
}

/**
 * The firm's details, or the unset defaults.
 *
 * NEVER THROWS AND NEVER RETURNS NULL. This sits in the path of composing an email and of
 * previewing a letter, and a firm whose settings failed to load must still be able to write to a
 * debtor — on a notice showing `{{firm_bank}}` standing, which is the honest thing to show.
 */
