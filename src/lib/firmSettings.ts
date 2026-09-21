/**
 * The firm's own details — the other half of every letter.
 *
 * WHY THIS EXISTS AT ALL. Nine merge fields were written, checked and exported with nothing in
 * the app able to fill them. `mergeValuesFor` has been passing null for the trust account since
 * the day it was written, and `firmName` was a string literal typed into `AccountDetail.tsx`.
 * Null is the honest answer — `renderTemplate` leaves `{{firm_bank}}` STANDING on the page rather
 * than printing a blank line that reads as finished — but it also means a section 129 cannot
 * actually be posted, because the debtor is told to pay and not told where.
 *
 * ONE ROW, ENFORCED BY THE DATABASE. See the table: `id` is a boolean that must be true, so a
 * second row is refused by the primary key. Two rows of firm settings is a letter carrying
 * whichever trust account the query happened to return first — right in testing, wrong in
 * production, because the ordering changes.
 *
 * THREE DIRECTIONS OF MONEY, THREE PLACES, and mixing any two of them is the expensive mistake
 * this file exists to make hard:
 *
 *   - the TRUST account, below — a debtor pays IN;
 *   - the BUSINESS account, below — a client pays the firm IN, for commission still outstanding.
 *     The firm's words: "there's also an account that is still outstanding with our client";
 *   - `companies.banking_details`, which is NOT here — remittance goes OUT to the client whose
 *     book it is.
 *
 * A debtor's money in a client's account is found at month end, not on the day, so the two that
 * both take money in are stored as separate columns, shown under separate headings, and offered
 * to separate halves of the merge vocabulary. See MERGE_FIELDS: there is no collections field
 * that names the business account, so a debtor notice cannot print it even by mistake.
 */
import { supabase } from './supabase'

/*
 * WRITTEN OUT, NOT BUILT FROM A LIST, and the reason is a check rather than taste:
 * check-select-columns.mjs resolves a const that is a literal or a concatenation of literals and
 * SILENTLY SKIPS anything else. A list mapped and joined here would read fine, cover nothing, and
 * take the count up by zero — which is how that check was found not to be running at all once
 * before. check-firm-settings.mjs holds this string against schema.sql instead, in both
 * directions, so a column added to the table and forgotten here is a failure rather than a field
 * that reads `undefined` for ever.
 */
const COLUMNS = 'firm_name, registration_number, vat_number, council_number, '
  + 'phone, phone_alt, email, website, physical_address, postal_address, office_hours, '
  + 'trust_bank, trust_branch_code, trust_account_name, trust_account_number, '
  + 'business_bank, business_branch_code, business_account_name, business_account_number, '
  + 'signatory_name, signatory_title, '
  + 'email_font, email_size_pt, updated_at'

interface Row {
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
  business_bank: string | null
  business_branch_code: string | null
  business_account_name: string | null
  business_account_number: string | null
  signatory_name: string | null
  signatory_title: string | null
  email_font: string
  email_size_pt: number | string
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
  businessBank: null,
  businessBranchCode: null,
  businessAccountName: null,
  businessAccountNumber: null,
  signatoryName: null,
  signatoryTitle: null,
  emailFont: 'Georgia, "Times New Roman", Times, serif',
  emailSizePt: 10.5,
  updatedAt: '',
}

/**
 * Named by hand, like every mapper here — and `Number()` on the size for the reason CLAUDE.md
 * gives: `numeric(4,1)` comes back from PostgREST as the STRING "10.5". Concatenated into a CSS
 * font-size it reads correctly and then silently does nothing the first time anybody does
 * arithmetic on it.
 */
function toSettings(r: Row): FirmSettings {
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
    businessBank: some(r.business_bank),
    businessBranchCode: some(r.business_branch_code),
    businessAccountName: some(r.business_account_name),
    businessAccountNumber: some(r.business_account_number),
    signatoryName: some(r.signatory_name),
    signatoryTitle: some(r.signatory_title),
    emailFont: r.email_font,
    emailSizePt: Number(r.email_size_pt),
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
export async function fetchFirmSettings(): Promise<FirmSettings> {
  const { data, error } = await supabase.from('firm_settings').select(COLUMNS).maybeSingle()
  if (error || !data) return FIRM_UNSET
  return toSettings(data as unknown as Row)
}

export async function saveFirmSettings(next: Omit<FirmSettings, 'updatedAt'>): Promise<void> {
  const { data: me } = await supabase.auth.getUser()
  /* Written back as NULL where somebody cleared the box, never as ''. An empty string would merge
     as a blank line on a notice and read as finished. */
  const some = (v: string | null): string | null => (v ?? '').trim() || null
  const { error } = await supabase.from('firm_settings').update({
    firm_name: next.firmName.trim() || 'Bredell Ferreira',
    registration_number: some(next.registrationNumber),
    vat_number: some(next.vatNumber),
    council_number: some(next.councilNumber),
    phone: some(next.phone),
    phone_alt: some(next.phoneAlt),
    email: some(next.email),
    website: some(next.website),
    physical_address: some(next.physicalAddress),
    postal_address: some(next.postalAddress),
    office_hours: some(next.officeHours),
    trust_bank: some(next.trustBank),
    trust_branch_code: some(next.trustBranchCode),
    trust_account_name: some(next.trustAccountName),
    trust_account_number: some(next.trustAccountNumber),
    business_bank: some(next.businessBank),
    business_branch_code: some(next.businessBranchCode),
    business_account_name: some(next.businessAccountName),
    business_account_number: some(next.businessAccountNumber),
    signatory_name: some(next.signatoryName),
    signatory_title: some(next.signatoryTitle),
    email_font: next.emailFont,
    email_size_pt: next.emailSizePt,
    updated_at: new Date().toISOString(),
    updated_by: me.user?.id ?? null,
  }).eq('id', true)
  if (error) throw new Error(error.message)
}

/**
 * THE FACES AN EMAIL MAY BE SET IN, and why the list is this short.
 *
 * A mail client cannot fetch a webfont. Gmail, Outlook and Apple Mail all ignore `@font-face`
 * entirely, so a face the reader does not already have installed silently becomes Times New
 * Roman — which means offering a long list would be offering choices that do not survive the
 * send. These are the faces that ship with Windows and macOS both.
 *
 * Stored as the whole stack rather than the family name, so the fallback travels with the choice
 * and a Linux reader gets a sensible substitute instead of the browser's default.
 */
export const EMAIL_FONTS: { label: string; value: string }[] = [
  { label: 'Georgia', value: 'Georgia, "Times New Roman", Times, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", Tahoma, sans-serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
]

/**
 * The style an outgoing message is wrapped in.
 *
 * INLINE, AND ON A WRAPPER RATHER THAN IN A <style> BLOCK, because Gmail strips <head> and every
 * stylesheet in it. An inline style on a containing div is the only thing every mail client
 * honours, and it is what every newsletter in the world does for the same reason.
 */
export const emailBodyStyle = (s: Pick<FirmSettings, 'emailFont' | 'emailSizePt'>): string =>
  `font-family:${s.emailFont};font-size:${s.emailSizePt}pt;line-height:1.5;color:#1f2937`
