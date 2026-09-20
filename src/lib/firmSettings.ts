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
 * THE TRUST ACCOUNT IS WHERE A DEBTOR PAYS IN, and it is deliberately not
 * `companies.banking_details`, which is where REMITTANCE GOES OUT to the client whose book it is.
 * Opposite directions. Paying one into the other is a debtor's money sitting in a client's
 * account and the firm finding out at month end.
 */
import { supabase } from './supabase'

const COLUMNS = 'firm_name, trust_bank, trust_account_number, signatory_name, signatory_title, '
  + 'email_font, email_size_pt, updated_at'

interface Row {
  firm_name: string
  trust_bank: string | null
  trust_account_number: string | null
  signatory_name: string | null
  signatory_title: string | null
  email_font: string
  email_size_pt: number | string
  updated_at: string
}

export interface FirmSettings {
  firmName: string
  /** Bank and branch code as a debtor reads it off a notice: "Standard Bank · 051001". */
  trustBank: string | null
  trustAccountNumber: string | null
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
 * Every money field is null, not an empty string, and that is the whole point: `mergeValuesFor`
 * turns null into a placeholder left standing and an empty string into a blank line. One of those
 * gets caught before it is posted; the other gets posted.
 */
export const FIRM_UNSET: FirmSettings = {
  firmName: 'Bredell Ferreira',
  trustBank: null,
  trustAccountNumber: null,
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
    trustBank: some(r.trust_bank),
    trustAccountNumber: some(r.trust_account_number),
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
  const { error } = await supabase.from('firm_settings').update({
    firm_name: next.firmName.trim() || 'Bredell Ferreira',
    /* Written back as NULL where somebody cleared the box, never as ''. An empty string would
       merge as a blank line on a notice and read as finished. */
    trust_bank: next.trustBank?.trim() || null,
    trust_account_number: next.trustAccountNumber?.trim() || null,
    signatory_name: next.signatoryName?.trim() || null,
    signatory_title: next.signatoryTitle?.trim() || null,
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
