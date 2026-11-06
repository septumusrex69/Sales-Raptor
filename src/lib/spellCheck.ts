/**
 * RAPTOR'S OWN SPELL CHECK (Raptor · Handover 17, S18, 6 Nov).
 *
 * Stephan: "Is there some sort of spell checker that we can put into Raptor?" -- then, of the two offered, "we can
 * do number 1 and 2. But also there should be an option to switch it off ... by default it's on, but the user can
 * switch it off." So, two things, one switch:
 *
 *   1. THE BROWSER'S UNDERLINES, asked for everywhere somebody types (the `spellcheck` attribute on <html>, which
 *      every box inherits), with the page declared South African English in index.html.
 *   2. A CHECK BEFORE ANYTHING GOES TO A DEBTOR: an email or an SMS is read against a British English dictionary
 *      (Hunspell en_GB-ise, the spelling South Africa writes) before it leaves, and the words it does not know are
 *      shown with suggestions. Sending anyway is always one press -- this catches typos, it does not hold notices.
 *
 * NOTHING LEAVES THE BROWSER. A grammar service was offered and turned down: the text is a debtor's personal
 * information, and sending it to a third party to be proof-read is a POPIA question nobody needs to answer.
 *
 * WHAT IT DOES NOT CHECK, ON PURPOSE -- because a warning that fires when nothing is wrong is worse than none, and
 * a list that names every debtor's surname is one people stop reading:
 *   - any word with a capital letter in it: names, places, clients, acronyms (RAP, PTP, SMS, NCA). The cost is that
 *     a typo in the first word of a sentence goes unflagged; the browser's underline still catches it.
 *   - anything with a digit, a merge field ({{balance}}), an email address or a web address.
 *   - the firm's own words (FIRM_WORDS) and the words this person added ("Add to my words", kept on this device).
 *
 * PURE where it can be: tokens() and unknownWords() take the speller as an argument, so check-spell-check can hold
 * them without a browser. loadSpeller() is the only part that fetches.
 */

const SWITCH_KEY = 'crm.spellCheck'
const MY_WORDS_KEY = 'crm.spellCheck.myWords'

/** On unless this person switched it off on this device. */
export function spellCheckEnabled(): boolean {
  try { return window.localStorage.getItem(SWITCH_KEY) !== 'off' } catch { return true }
}

export function setSpellCheckEnabled(on: boolean) {
  try { window.localStorage.setItem(SWITCH_KEY, on ? 'on' : 'off') } catch { /* the choice lasts this visit */ }
  applySpellCheckAttribute()
}

/** The browser's underlines follow the switch: every text box and the letter page inherit it from <html>. */
export function applySpellCheckAttribute() {
  try { document.documentElement.setAttribute('spellcheck', spellCheckEnabled() ? 'true' : 'false') } catch { /* no DOM */ }
}

/*
 * THE FIRM'S OWN WORDS -- lower case, because capitalised words are never checked. Collections and the National
 * Credit Act's vocabulary, and South African words a British dictionary does not carry. Add to it rather than
 * teaching people to ignore the panel.
 */
export const FIRM_WORDS: readonly string[] = [
  'duplum', 'annexure', 'annexures', 'payover', 'payovers', 'handover', 'handovers', 'debtor', 'debtors',
  'prelegal', 'pre', 'remittance', 'remittances', 'suspense', 'liaison', 'emolument', 'emoluments',
  'garnishee', 'judgement', 'judgment', 'summons', 'rand', 'rands', 'cents', 'eft', 'efts', 'ito', 'per',
  'whatsapp', 'email', 'emails', 'emailed', 'emailing', 'sms', 'smses', 'ok', 'okay', 'dear', 'kindly',
  'braai', 'bakkie', 'robot', 'robots', 'ja', 'nee', 'baie', 'dankie', 'sawubona', 'molo', 'ngiyabonga',
  'enkosi', 'thobela', 'dumela', 'lekker', 'eish', 'howzit', 'shame',
  // Found by running the 114 English templates on staging through it (6 Nov): the only two words it raised.
  'ombud', 'ombuds', 'ombudsman', 'diarise', 'diarised', 'diarising', 'rediarise', 'rediarised',
]

export function myWords(): string[] {
  try { return JSON.parse(window.localStorage.getItem(MY_WORDS_KEY) ?? '[]') as string[] } catch { return [] }
}
export function addMyWord(word: string) {
  const w = word.trim().toLowerCase()
  if (!w) return
  try {
    const next = Array.from(new Set([...myWords(), w])).sort()
    window.localStorage.setItem(MY_WORDS_KEY, JSON.stringify(next))
  } catch { /* nowhere to keep it */ }
}

/** The words of a message that are worth checking, each once, in the order they first appear. */
export function tokens(text: string): string[] {
  const cleaned = text
    .replace(/\{\{[^}]*\}\}/g, ' ')                       // merge fields
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ')         // web addresses
    .replace(/\S+@\S+/g, ' ')                             // email addresses
    .replace(/[‘’ʼ]/g, "'")                // curly apostrophes read as straight ones
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of cleaned.matchAll(/[A-Za-zÀ-ɏ0-9']+/g)) {
    const w = m[0].replace(/^'+|'+$/g, '')
    if (w.length < 2) continue
    if (/[0-9]/.test(w)) continue                         // amounts, dates, references
    if (/[A-ZÀ-Þ]/.test(w)) continue           // names, places, acronyms -- see the header
    if (seen.has(w)) continue
    seen.add(w)
    out.push(w)
  }
  return out
}

export interface Speller {
  correct(word: string): boolean
  suggest(word: string): string[]
}

export interface Unknown { word: string; suggestions: string[] }

/** The words the dictionary, the firm's list and this person's own words all do not know. */
export function unknownWords(text: string, speller: Speller, extra: Iterable<string> = []): Unknown[] {
  const known = new Set([...FIRM_WORDS, ...extra].map((w) => w.toLowerCase()))
  const out: Unknown[] = []
  for (const w of tokens(text)) {
    if (known.has(w)) continue
    /* A possessive or a contraction the dictionary lacks is read without its ending: "debtor's", "client's". */
    const bare = w.replace(/'s$/, '')
    if (known.has(bare) || speller.correct(w) || speller.correct(bare)) continue
    out.push({ word: w, suggestions: speller.suggest(w).slice(0, 3) })
  }
  return out
}

/** Every whole-word occurrence of `word` in `text` swapped for `by` -- what a suggestion's press does. */
export function replaceWord(text: string, word: string, by: string): string {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp(`(?<![A-Za-zÀ-ɏ'])${esc}(?![A-Za-zÀ-ɏ'])`, 'g'), by)
}

/*
 * THE DICTIONARY, FETCHED THE FIRST TIME SOMEBODY SENDS -- about 550 kB, which nobody who only reads the diary
 * should download. Hunspell's en_GB-ise from wordlist.sourceforge.net (the npm package dictionary-en-gb), served
 * from public/dictionaries/en-gb with its licence beside it; nspell builds the speller once per visit.
 */
const DICTIONARY = '/dictionaries/en-gb/'
let speller: Promise<Speller> | null = null
export function loadSpeller(): Promise<Speller> {
  if (!speller) {
    speller = (async () => {
      const [{ default: nspell }, aff, dic] = await Promise.all([
        import('nspell'),
        fetch(DICTIONARY + 'en_GB.aff').then((r) => { if (!r.ok) throw new Error('dictionary'); return r.text() }),
        fetch(DICTIONARY + 'en_GB.dic').then((r) => { if (!r.ok) throw new Error('dictionary'); return r.text() }),
      ])
      return nspell(aff, dic) as Speller
    })()
    speller.catch(() => { speller = null })              // a failed fetch is tried again next time
  }
  return speller
}
