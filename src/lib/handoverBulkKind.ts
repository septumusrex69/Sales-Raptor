/**
 * PERSON OR BUSINESS, ANSWERED ONCE FOR EVERY ROW THAT HAS THE SAME PROBLEM (Raptor R-5).
 *
 * Rinda, from Settings > Data Import: old handover sheets (and the Swordfish import) rarely say
 * whether a debtor is a person or a business, and answering it row by row on a sheet of two
 * hundred is the job people stop doing properly. Stephan narrowed it: person-or-business only, on
 * NEW handover drafts only, before anything is saved -- "for now make it available for new imports
 * to choose in bulk". The Swordfish import is a separate piece of work, and nothing here touches an
 * account that already exists: imported history is frozen at what was imported (CLAUDE.md).
 *
 * WHICH ROWS: only the ones where the import is GUESSING. A stated answer, a registration number
 * and a valid ID number are facts (debtorKindFrom), and a bulk "Person" that overwrote a close
 * corporation's registration number would be exactly the quiet mistake this feature exists to
 * prevent. So the bulk choice is offered for the two soft readings -- a name that looks registered,
 * and no evidence at all -- and for a word nobody recognises ("Sole proprietor", "Debtor").
 * Rows the planner refuses, or the person excluded, are left alone.
 *
 * Pure: it takes the rows as the screen has them, and check-handover-bulk-kind holds it.
 */
import { debtorKindFrom } from './handoverImport.ts'

export type KindGuess = 'registered-name' | 'no-evidence' | 'unrecognised-word'

export interface KindRow {
  id: string
  line: number
  excluded: boolean
  values: Record<string, string | null>
}

export interface KindGroup {
  guess: KindGuess
  /** What the group says about itself, in the firm's words. */
  label: string
  rows: KindRow[]
}

/** The words the sheet's own dropdown offers, which debtorKindFrom reads as stated. */
export const KIND_WORDS = { person: 'Person', business: 'Business' } as const

const LABELS: Record<KindGuess, string> = {
  'registered-name': 'The name looks like a registered business (Pty, Ltd, CC, Trust ...)',
  'no-evidence': 'The sheet does not say, and there is no ID or registration number',
  'unrecognised-word': 'The sheet has a word that is neither Person nor Business',
}

/** The rows whose kind is a guess, grouped by why. Empty groups are left out. */
export function kindGroups(rows: KindRow[]): KindGroup[] {
  const by: Record<KindGuess, KindRow[]> = {
    'registered-name': [], 'no-evidence': [], 'unrecognised-word': [],
  }
  for (const r of rows) {
    if (r.excluded) continue
    const read = debtorKindFrom(r.values)
    if (read.from === 'stated' || read.from === 'registration-number' || read.from === 'id-number') continue
    if ((r.values.debtor_kind ?? '').trim()) by['unrecognised-word'].push(r)
    else if (read.from === 'registered-name') by['registered-name'].push(r)
    else by['no-evidence'].push(r)
  }
  return (Object.keys(by) as KindGuess[])
    .filter((g) => by[g].length > 0)
    .map((g) => ({ guess: g, label: LABELS[g], rows: by[g] }))
}
