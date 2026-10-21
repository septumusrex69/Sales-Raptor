/**
 * A DEBTOR'S NAME, WRITTEN OUT.
 *
 * THE FIRM ASKED FOR THE PARTS AND THEN ASKED FOR THEM BACK TOGETHER. First: "I imported some of
 * this data, but it shows, for example, the full name Zanele Sithole. It doesn't show the surname
 * and the name" — so the panel drew all five columns, which is how you check an import, and that
 * was right at the time. Then, looking at it in use: "I know previously I told you to separate
 * the surname and the things, but rather do it like this. It looks better."
 *
 * SO THE PARTS DID NOT GO ANYWHERE, THEY MOVED ONE CLICK. The columns are still five, the editor
 * still shows them one per box, and the identity check that catches a surname filed under
 * initials still runs. What changed is the resting state: a person reading an account sees a
 * name, and a person checking an import presses it.
 *
 * ITS OWN FILE, PURE, so a check can run it: this is the string a screen leads with, and it is
 * assembled from five nullable columns of which any combination can be empty.
 */
export interface DebtorNameParts {
  debtorTitle?: string | null
  debtorFirstName?: string | null
  debtorSecondName?: string | null
  debtorSurname?: string | null
}

/**
 * "Mr Ryno Buitendag", or as much of it as the book actually holds.
 *
 * THE TITLE IS PART OF IT. addressAs falls back to the surname alone when there is none, and the
 * firm found a section 129 of their own opening "Dear buitendag" — so a name with no title in
 * front of it is a thing somebody should be able to see without opening the editor.
 *
 * EMPTY RATHER THAN A GAP, and empty means the caller says "Not recorded" in its own words. A
 * name assembled out of nothing returns '' and never ' ' — a blank that occupies a line reads as
 * a name nobody bothered to finish.
 */
export function fullDebtorName(parts: DebtorNameParts): string {
  return [parts.debtorTitle, parts.debtorFirstName, parts.debtorSecondName, parts.debtorSurname]
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(' ')
}
