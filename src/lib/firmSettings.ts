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
import { useEffect, useState } from 'react'
import { DEFAULT_TIME_ZONE } from './calendarInvite.ts'

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

/**
 * THE FIRM'S OWN CLOCK, CACHED, because a floating calendar invitation needs it on every render.
 *
 * A booking confirmation carries no zone at all -- RFC 5545 says such a time is read on the
 * observer's clock -- so the mail card, the accept and the calendar all have to know which clock
 * that is. Fetching the whole settings row on each of them would be three round trips to answer a
 * question whose answer changes about once a decade.
 *
 * NEVER THROWS, like fetchFirmSettings: a settings row that failed to load gives Johannesburg,
 * which is the default in the column anyway. Getting this wrong by an hour is bad; getting it
 * wrong by refusing to place the meeting at all is what this whole change is undoing.
 *
 * `forgetFirmTimeZone` is for the settings screen, which has just changed it.
 */
let zoneCache: string | null = null
export async function firmTimeZone(): Promise<string> {
  if (zoneCache) return zoneCache
  const { data } = await supabase.from('firm_settings').select('time_zone').maybeSingle()
  zoneCache = (data as { time_zone?: string } | null)?.time_zone || DEFAULT_TIME_ZONE
  return zoneCache
}
export function forgetFirmTimeZone(): void { zoneCache = null }

/**
 * The same answer, for a component that has to decide something while it renders.
 *
 * THE CARD AND THE WRITE MUST AGREE. The invite card works out whether a meeting can be placed at
 * an hour; acceptInvite works out the hour. They used to compute it two different ways and the
 * screen was the one that was wrong -- it stayed quiet while the event was stored with no date.
 * Now they run the same function over the same zone, and this is how the synchronous half gets it.
 *
 * It starts on the default rather than on null, so the first render places a floating time on
 * Johannesburg rather than reporting it unplaceable for a frame.
 */
export function useFirmTimeZone(): string {
  const [zone, setZone] = useState(zoneCache ?? DEFAULT_TIME_ZONE)
  useEffect(() => {
    let alive = true
    void firmTimeZone().then((z) => { if (alive) setZone(z) })
    return () => { alive = false }
  }, [])
  return zone
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
    vat_rate: next.vatRate,
    time_zone: next.timeZone,
    parked_credit_months: next.parkedCreditMonths,
    payover_lag_months: next.payoverLagMonths,
    payouts_statement_only: next.payoutsStatementOnly,
    /* Echoed as loaded, like the switch above. The figure is SET only by set_trust_opening_balance,
       which logs it with a reason; this keeps the five lists whole (check-firm-settings). */
    trust_opening_balance: next.trustOpeningBalance,
    trust_opening_date: next.trustOpeningDate,
    /*
     * WRITTEN BACK LIKE EVERY OTHER FIELD, AND THE DATABASE IS WHAT KEEPS IT SAFE.
     *
     * Leaving it out of this list is the failure CLAUDE.md describes: five hand-written lists that
     * have to stay in step, and a column missing from one of them reads as undefined for ever. But
     * a settings tab opened before the engine was switched on would, on save, write back the null
     * it loaded and quietly turn the engine off -- payments still captured, none of them split,
     * and the first sign a payover run short by a month. So the switch is frozen in the database
     * once the engine has split anything (`protect_finance_cutover`), which reverts rather than
     * raises: somebody saving the firm's phone number was not asking about the allocation engine.
     */
    finance_cutover_at: next.financeCutoverAt,
    updated_at: new Date().toISOString(),
    updated_by: me.user?.id ?? null,
  }).eq('id', true)
  /* The zone may have just changed; the next invitation must not be placed on the old one. */
  forgetFirmTimeZone()
  if (error) throw new Error(error.message)
}


