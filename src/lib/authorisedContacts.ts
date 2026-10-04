/**
 * WHO MAY BE TOLD ANYTHING ABOUT THIS ACCOUNT -- the rows, and the reads and writes behind them.
 *
 * THE FIRM: "this is the part that cannot live in a collector's head. Every account needs an
 * authorised contacts table, and the opening script's verification tick must read from it."
 *
 * THE RULES ARE NOT HERE. What a capacity may be told is CAPACITIES in callScripts.ts, which is
 * pure and which a QA check can import; this file is the thin layer that fetches and saves, like
 * accountCharges is for the fee engine. The split matters more here than usual: the matrix is the
 * thing that keeps the firm out of trouble with the Council for Debt Collectors, and a rule that
 * lives behind a Supabase import is a rule no check can hold.
 */
import { supabase } from './supabase'
import { CAPACITIES, mayBeTold, type TellLevel } from './callScripts.ts'

/** Named by hand, like every mapper here. See the warning about silent drops in CLAUDE.md. */
const COLUMNS = 'id, account_id, name, capacity, contact, proof, proof_on_file, '
  + 'verified_by, verified_at, expires_on, notes, created_at'

export interface AuthorisedContact {
  id: string
  accountId: string
  name: string
  /** One of CAPACITIES' ids. The database constrains it to the same closed list. */
  capacity: string
  contact: string | null
  /** What is actually held, in the words somebody wrote: "Letters of Executorship, 3 March". */
  proof: string | null
  /** THE GATE. False and the row authorises nothing, whatever its capacity would allow. */
  proofOnFile: boolean
  verifiedBy: string | null
  verifiedAt: string | null
  /** A mandate or a power of attorney with an end date. Null means it does not expire by itself. */
  expiresOn: string | null
  notes: string | null
  createdAt: string
}

/* eslint-disable @typescript-eslint/no-explicit-any -- rows arrive as untyped JSON. */
function toContact(r: any): AuthorisedContact {
  return {
    id: r.id,
    accountId: r.account_id,
    name: r.name,
    capacity: r.capacity,
    contact: r.contact ?? null,
    proof: r.proof ?? null,
    proofOnFile: !!r.proof_on_file,
    verifiedBy: r.verified_by ?? null,
    verifiedAt: r.verified_at ?? null,
    expiresOn: r.expires_on ?? null,
    notes: r.notes ?? null,
    createdAt: r.created_at,
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function fetchAuthorisedContacts(accountId: string): Promise<AuthorisedContact[]> {
  const { data, error } = await supabase
    .from('account_authorised_contacts')
    .select(COLUMNS)
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map(toContact)
}

export async function addAuthorisedContact(input: {
  accountId: string
  name: string
  capacity: string
  contact?: string | null
  proof?: string | null
  proofOnFile: boolean
  expiresOn?: string | null
  notes?: string | null
  actorId: string | null
}): Promise<AuthorisedContact> {
  const { data, error } = await supabase
    .from('account_authorised_contacts')
    .insert({
      account_id: input.accountId,
      name: input.name.trim(),
      capacity: input.capacity,
      contact: (input.contact ?? '').trim() || null,
      proof: (input.proof ?? '').trim() || null,
      proof_on_file: input.proofOnFile,
      /*
       * WHO SAID THE PROOF IS HELD, AND WHEN -- stamped only where it IS held.
       *
       * THE FIRM ASKED FOR "who verified it and when" as a column of the table. A row added with
       * nothing behind it has not been verified by anybody, and stamping the person who typed it
       * would make the weekly exception report -- "any row with no proof on file" -- read as
       * though somebody had checked.
       */
      verified_by: input.proofOnFile ? input.actorId : null,
      verified_at: input.proofOnFile ? new Date().toISOString() : null,
      expires_on: input.expiresOn || null,
      notes: (input.notes ?? '').trim() || null,
      created_by: input.actorId,
    })
    .select(COLUMNS)
    .single()
  if (error) throw new Error(error.message)
  return toContact(data)
}

/**
 * MARK THE PROOF AS HELD, which is the only field on a row that changes.
 *
 * NOT A GENERAL UPDATE. Everything else on the row is what somebody was told on a call -- a name,
 * a capacity, a number -- and editing those in place would rewrite the record of who was
 * authorised on the day a disclosure was made. A contact whose details change is a new row; this
 * is the one transition the firm described ("the proof has arrived").
 */
export async function recordProof(input: {
  id: string
  proof: string
  actorId: string | null
}): Promise<void> {
  const { error } = await supabase
    .from('account_authorised_contacts')
    .update({
      proof: input.proof.trim(),
      proof_on_file: true,
      verified_by: input.actorId,
      verified_at: new Date().toISOString(),
    })
    .eq('id', input.id)
  if (error) throw new Error(error.message)
}

/**
 * IS THIS ROW GOOD TODAY? Three things have to be true and the firm wrote all three.
 *
 *   1. THE PROOF IS ON FILE. "A row with no proof on file is not an authorised contact, however
 *      long it has been there."
 *   2. IT HAS NOT EXPIRED. A mandate with an end date is worth nothing the day after.
 *   3. ITS CAPACITY ALLOWS SOMETHING AT ALL. A spouse row with a signed letter attached is still
 *      `anyone_else`, which is told nothing -- the proof is not what authorises, the capacity is.
 *
 * TAKES THE DAY rather than reading a clock, so a check can ask about tomorrow.
 */
export function isLive(contact: AuthorisedContact, today: string): boolean {
  if (!contact.proofOnFile) return false
  if (contact.expiresOn && contact.expiresOn < today) return false
  return mayBeTold(contact.capacity, true) !== 'nothing'
}

/** What this row may be told today, with the proof and the expiry taken into account. */
export function tellLevelFor(contact: AuthorisedContact, today: string): TellLevel {
  if (contact.expiresOn && contact.expiresOn < today) return 'nothing'
  return mayBeTold(contact.capacity, contact.proofOnFile)
}

/**
 * THE SURETY WE MAY NAME, for {{surety_name}}.
 *
 * ONLY OFF A LIVE ROW. A surety is a debtor in their own right -- script-surety says exactly that
 * -- and the thing that makes them one is the signed deed of suretyship being on file. Naming
 * somebody as a surety on the strength of a row nobody has evidence for is the firm asserting a
 * liability it cannot prove.
 */
export function suretyName(contacts: AuthorisedContact[], today: string): string | null {
  const row = contacts.find((c) => c.capacity === 'surety' && isLive(c, today))
  return row?.name ?? null
}

/**
 * THE ROWS A WEEKLY EXCEPTION REPORT IS FOR.
 *
 * THE FIRM: "audit the authorised contacts list. Any row with no proof on file, and any disclosure
 * made to a contact added on the same call, should surface on a weekly exception report."
 *
 * THE FIRST HALF IS ANSWERABLE FROM THE ROW and is this. The second half needs a call recording
 * beside a row's created_at and is not pretended at here -- a report that claimed to find
 * same-call disclosures and only found missing proof would be worse than one that says what it
 * looked at.
 */
export function needsProof(contacts: AuthorisedContact[]): AuthorisedContact[] {
  return contacts.filter((c) => !c.proofOnFile && c.capacity !== 'anyone_else')
}

/** Expired rows, which read as authorised until somebody looks at the date. */
export function expired(contacts: AuthorisedContact[], today: string): AuthorisedContact[] {
  return contacts.filter((c) => c.expiresOn !== null && c.expiresOn < today)
}

/** The capacity's label, for a screen. Falls back to the stored word rather than to nothing. */
export function capacityLabel(capacity: string): string {
  return CAPACITIES.find((c) => c.id === capacity)?.label ?? capacity
}
