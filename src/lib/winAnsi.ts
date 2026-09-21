/**
 * TEXT THAT A PDF CAN ACTUALLY PRINT.
 *
 * The firm, trying to attach a section 129 they had pasted in from Word: "WinAnsi cannot encode
 * ' ' (0x0009)". The letter would not attach and the message named a character nobody can see.
 *
 * WHERE THE TAB CAME FROM, because it matters for the fix. The notice was copied out of a Word
 * document on a tablet, and a Word TABLE copied as plain text separates its cells with TABS. So
 * the moment somebody pastes a table that way, every row carries tab characters — invisible in
 * the editor, because HTML collapses them, and fatal at the PDF.
 *
 * THE 14 STANDARD PDF FONTS SPEAK WinAnsi, which is Windows-1252 and nothing else. That is not a
 * choice this codebase made: embedding a full Unicode font would add a megabyte to every letter,
 * and `letterPdf` deliberately uses the standard faces so a notice is a few tens of kilobytes.
 * The repertoire is therefore fixed, and it is written out below rather than discovered by
 * catching exceptions — a function that works by try/catch around a font cannot be reasoned about
 * or checked without one.
 *
 * TWO KINDS OF CHARACTER IT CANNOT PRINT, and they deserve opposite treatment:
 *
 *   - ONES THAT CARRY NO MEANING A LETTER NEEDS — a tab, a thin space, a zero-width joiner, a
 *     byte-order mark. These are fixed quietly. Refusing to attach a statutory demand over an
 *     invisible character somebody's word processor left behind helps nobody.
 *   - ONES THAT ARE REAL WORDS — an arrow, a ≥, a Chinese character. Substituting for these would
 *     silently change what the debtor is told. They are REPORTED so the caller can refuse, and
 *     the caller does.
 */

/**
 * Every code point Windows-1252 can represent.
 *
 * WRITTEN OUT, NOT GUESSED. The 0x80–0x9F band is the part people get wrong: in Latin-1 it is
 * control characters, and in Windows-1252 it is the curly quotes, the dashes, the bullet and the
 * euro — exactly the characters a letter written in Word is full of. Losing them would strip the
 * punctuation out of every notice the firm has ever written.
 *
 * check-pdf-text.mjs holds this list against pdf-lib itself, character by character, so the two
 * cannot drift.
 */
const WIN_ANSI_EXTRAS = '€‚ƒ„…†‡ˆ‰Š‹Œ'
  + 'Ž‘’“”•–—˜™š›œžŸ'

const EXTRAS = new Set([...WIN_ANSI_EXTRAS].map((c) => c.codePointAt(0)!))

/** Can a standard PDF font draw this character at all? */
export function isPrintable(code: number): boolean {
  /* The ordinary keyboard. */
  if (code >= 0x20 && code <= 0x7e) return true
  /* Latin-1's accented half, which carries every South African surname with a diacritic in it,
     and the non-breaking space that en-ZA groups thousands with. */
  if (code >= 0xa0 && code <= 0xff) return true
  return EXTRAS.has(code)
}

/**
 * Characters that cannot be printed but mean nothing a letter would miss.
 *
 * SPACE-LIKE ONES BECOME A SPACE, the rest are dropped. A tab is the important one: it is what a
 * Word table copied as plain text puts between its cells, so it is what turns up in a pasted
 * notice. One space, not several — a tab was a column separator in a document that no longer has
 * columns, and padding it out would leave ragged gaps mid-sentence.
 */
const HARMLESS: Record<number, string> = {
  0x09: ' ',   // tab — the one the firm hit
  0x0b: ' ',   // vertical tab
  0x0c: ' ',   // form feed
  0x200b: '',  // zero-width space
  0x200c: '',  // zero-width non-joiner
  0x200d: '',  // zero-width joiner
  0x2060: '',  // word joiner
  0xfeff: '',  // byte-order mark, which is what a file pasted whole begins with
  0x00ad: '',  // soft hyphen — a hint about where to break, not a hyphen
  0x2028: ' ', // line separator
  0x2029: ' ', // paragraph separator
}

/** The several Unicode spaces, all of which a letter can say with an ordinary one. */
const SPACES = new Set([
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x202f, 0x205f, 0x3000,
])

export interface Printable {
  /** The same words, with everything a standard PDF font cannot draw taken out. */
  text: string
  /**
   * The characters that were REAL and had to go — an arrow, a ≥, anything outside Windows-1252.
   * Empty on almost every letter. Deduplicated and in the order they were met, so a message built
   * from it names each problem once.
   */
  unprintable: string[]
}

/**
 * One run of text, made printable.
 *
 * NEWLINES ARE NOT HANDLED HERE and must not reach a PDF: the layout engine has already broken
 * the letter into lines by the time anything is drawn, so a newline arriving at this point is a
 * bug in the layout rather than a character to clean up. It is reported like any other.
 */
export function printableForPdf(text: string): Printable {
  let out = ''
  const unprintable: string[] = []
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    /*
     * THE QUIET FIXES ARE ASKED FIRST, and the soft hyphen is why. Windows-1252 CAN encode it —
     * at 0xAD, where the glyph is an ordinary hyphen. So a soft hyphen, which means "you may
     * break the word here" and is meant to be invisible, prints as a hyphen in the middle of a
     * word. Asked in the other order it passes as printable and a debtor reads "out-standing".
     */
    if (code in HARMLESS) { out += HARMLESS[code]; continue }
    if (isPrintable(code)) { out += ch; continue }
    if (SPACES.has(code)) { out += ' '; continue }
    if (!unprintable.includes(ch)) unprintable.push(ch)
  }
  return { text: out, unprintable }
}

/**
 * What to tell somebody who has a character in their letter that cannot be printed.
 *
 * NAMES THE CHARACTER AND ITS CODE. "WinAnsi cannot encode" is the library talking to itself;
 * what a person needs is which character, so they can find it and take it out. The code point is
 * there because several of these look identical to something ordinary.
 */
export function unprintableMessage(chars: string[]): string {
  const named = chars
    .map((c) => `“${c}” (U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`)
    .join(', ')
  return chars.length === 1
    ? `The letter contains a character that cannot be printed: ${named}. Take it out and try again.`
    : `The letter contains characters that cannot be printed: ${named}. Take them out and try again.`
}
