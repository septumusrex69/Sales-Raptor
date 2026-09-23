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
export { EMAIL_FONTS, emailBodyCss, emailBodyStyle } from './emailStyle.ts'

/*
 * THE ROW, THE SHAPE AND THE MAPPER LIVE NEXT DOOR, so the server can use them without dragging
 * the browser's Supabase client into a serverless function. Re-exported here because this is
 * still where the rest of the app looks for them.
 */
export * from './firmSettingsRow.ts'
import { COLUMNS, FIRM_UNSET, toSettings, type FirmSettings, type Row } from './firmSettingsRow.ts'

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
    trust_account_type: some(next.trustAccountType),
    payment_instruction: some(next.paymentInstruction),
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


