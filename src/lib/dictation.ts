/**
 * Talking instead of typing.
 *
 * Uses the SPEECH RECOGNITION BUILT INTO THE BROWSER, which costs nothing and needs no account,
 * no key and no supplier. Chrome, Edge and Safari all have it; Firefox does not, and that is
 * handled rather than ignored — the firm's people are on whatever machine is in front of them.
 *
 * This file is the part with no browser in it: what counts as supported, which language to listen
 * in, and how a spoken fragment joins onto what is already in the box. That last one sounds
 * trivial and is not — speech arrives without capitals, without full stops and without any idea
 * what came before it, and getting the joins wrong is what makes dictated text read as dictated.
 */

/* ---------- what the browser gives us ---------- */

/**
 * The API is prefixed on Safari and Chrome and absent on Firefox, and TypeScript's DOM library
 * does not describe it at all. Only the parts actually used are declared.
 */
export interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechResultEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}

export interface SpeechResultEventLike {
  resultIndex: number
  results: {
    length: number
    [index: number]: { isFinal: boolean; 0: { transcript: string } }
  }
}

type Ctor = new () => SpeechRecognitionLike

/** The constructor, whatever this browser calls it, or null where there is none. */
export function speechRecognition(): Ctor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function dictationSupported(): boolean {
  return speechRecognition() !== null
}

/**
 * What to tell somebody whose browser cannot do it.
 *
 * Names the way out rather than the fault. Every machine in the firm has dictation in the
 * operating system — the microphone key on an iPad, Windows logo + H, fn twice on a Mac — so
 * nobody is actually stuck, they just have to be told where it is.
 */
export const NO_DICTATION_HELP =
  'This browser cannot listen. Use your device’s own dictation instead: the microphone key '
  + 'on an iPad keyboard, Windows logo + H on a PC, or press fn twice on a Mac. Chrome, Edge and '
  + 'Safari all work here.'

/* ---------- which language ---------- */

/**
 * The languages the firm actually collects in.
 *
 * South African English first because it is what most calls are in, and because a recogniser set
 * to en-US turns "Nomvula" and "Tjobecom" into noise. Afrikaans is here because a fair number of
 * these conversations happen in it, and a collector should not have to translate their own note
 * before writing it down.
 */
export const DICTATION_LANGUAGES: { code: string; label: string }[] = [
  { code: 'en-ZA', label: 'English (South Africa)' },
  { code: 'af-ZA', label: 'Afrikaans' },
  { code: 'en-GB', label: 'English (UK)' },
]

export const DEFAULT_DICTATION_LANGUAGE = 'en-ZA'

/** Remembered per person, because most people dictate in the same language every time. */
export const DICTATION_LANGUAGE_KEY = 'raptor.dictation.language'

export function storedLanguage(): string {
  try {
    const saved = localStorage.getItem(DICTATION_LANGUAGE_KEY)
    if (saved && DICTATION_LANGUAGES.some((l) => l.code === saved)) return saved
  } catch {
    // Private windows and cleared site data both throw here. The default is fine.
  }
  return DEFAULT_DICTATION_LANGUAGE
}

export function rememberLanguage(code: string): void {
  try { localStorage.setItem(DICTATION_LANGUAGE_KEY, code) } catch { /* not worth an error */ }
}

/* ---------- joining speech onto what is already there ---------- */

/** Sentence-ending punctuation, after which the next word is capitalised. */
const ENDS_SENTENCE = /[.!?]["')\]]?\s*$/

/**
 * Add a spoken fragment to whatever is already in the box.
 *
 * Speech arrives as a bare run of words: no capital at the front, no space at the back, and no
 * knowledge of what preceded it. Left alone it produces "Spoke to himsays he will pay" — which is
 * the thing that makes people give up on dictation in the first week.
 *
 * So: one space between, a capital where a sentence has just ended (or at the very start), and
 * nothing touched in the middle of a sentence, because "R2 000" and "Tjobecom" are not this
 * function's business.
 */
export function appendSpeech(existing: string, spoken: string): string {
  const fragment = spoken.trim().replace(/\s+/g, ' ')
  if (!fragment) return existing

  const before = existing.replace(/\s+$/, '')
  const startsSentence = before === '' || ENDS_SENTENCE.test(before)
  const piece = startsSentence ? capitaliseFirst(fragment) : fragment

  if (before === '') return piece
  // A fragment that opens with punctuation joins straight on: " , and he hung up" reads wrong.
  if (/^[,.;:!?]/.test(piece)) return before + piece
  return `${before} ${piece}`
}

function capitaliseFirst(text: string): string {
  // Deliberately only the first letter. Upper-casing more would wreck an account number or a
  // surname the recogniser got right.
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * What a recogniser error means in words somebody can act on.
 *
 * The raw codes are things like 'not-allowed' and 'audio-capture', which tell a collector
 * nothing. Every message here says what to DO.
 */
export function dictationError(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'The microphone is blocked. Allow it for this site in your browser settings, then try again.'
    case 'audio-capture':
      return 'No microphone was found. Check that one is plugged in and not in use by another app.'
    case 'network':
      return 'Speech recognition could not reach the network. Check the connection and try again.'
    case 'no-speech':
      return 'Nothing was heard. Try again, a little closer to the microphone.'
    case 'aborted':
      // Stopping on purpose reports as an error. Saying so would be nonsense.
      return ''
    default:
      return 'Dictation stopped unexpectedly. Try again, or type it instead.'
  }
}
