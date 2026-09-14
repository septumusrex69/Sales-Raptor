/**
 * Joining spoken words onto a note.
 *
 * This is the part of dictation that decides whether people keep using it. Speech arrives as a
 * bare run of words — no capital at the front, no space at the back, no idea what came before —
 * and left alone it produces "Spoke to himsays he will pay on the 25th", which is what makes
 * somebody give up on the feature in the first week.
 *
 * Every case below is a real shape of collections note: amounts, surnames, account references,
 * two sentences dictated in two goes.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-dictation.mjs
 */
import {
  appendSpeech, dictationError, storedLanguage, dictationSupported,
  DICTATION_LANGUAGES, DEFAULT_DICTATION_LANGUAGE, NO_DICTATION_HELP,
} from '../../src/lib/dictation.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) pass += 1
  else failures.push(`${name}\n     got      ${a}\n     expected ${e}`)
}
const ok = (name, cond) => { if (cond) pass += 1; else failures.push(name) }

/* ---------- 1. the joins ---------- */

check('the first phrase is capitalised',
  appendSpeech('', 'spoke to the debtor'), 'Spoke to the debtor')

check('a second phrase mid-sentence is not capitalised',
  appendSpeech('Spoke to the debtor', 'and he agreed to pay'),
  'Spoke to the debtor and he agreed to pay')

check('a new sentence after a full stop is capitalised',
  appendSpeech('Spoke to the debtor.', 'he agreed to pay'),
  'Spoke to the debtor. He agreed to pay')

check('after a question mark too',
  appendSpeech('Did he pay?', 'no he did not'), 'Did he pay? No he did not')

check('after an exclamation too',
  appendSpeech('He paid!', 'at last'), 'He paid! At last')

// The one that produces "himsays" without this.
check('a space is added between phrases',
  appendSpeech('Spoke to him', 'says he will pay on the 25th'),
  'Spoke to him says he will pay on the 25th')

check('trailing space in the box does not become a double space',
  appendSpeech('Spoke to him   ', 'he will pay'), 'Spoke to him he will pay')

check('leading and trailing space on the speech is trimmed',
  appendSpeech('Spoke to him', '   he will pay   '), 'Spoke to him he will pay')

check('runs of space inside the speech are collapsed',
  appendSpeech('', 'he    will   pay'), 'He will pay')

// Dictated punctuation arrives as its own fragment and must not be pushed off with a space.
check('a comma joins straight on', appendSpeech('Spoke to him', ', then he hung up'),
  'Spoke to him, then he hung up')
check('a full stop joins straight on', appendSpeech('Spoke to him', '.'), 'Spoke to him.')

/* ---------- 2. what must NOT be touched ---------- */

// Only the first letter is ever changed. Anything else wrecks the things that matter most in a
// collections note.
check('an amount survives', appendSpeech('', 'R2 000 was paid'), 'R2 000 was paid')
check('an amount mid-sentence survives',
  appendSpeech('He paid', 'R2 000 on the 25th'), 'He paid R2 000 on the 25th')
check('a surname keeps its capital',
  appendSpeech('Spoke to', 'Nomvula van der Westhuizen'), 'Spoke to Nomvula van der Westhuizen')
check('an account reference is not re-cased',
  appendSpeech('', 'reference GPS3/20028 refers'), 'Reference GPS3/20028 refers')
check('an already-capitalised phrase is left alone',
  appendSpeech('', 'Tjobecom confirmed it'), 'Tjobecom confirmed it')
check('a lower-case name mid-sentence is left alone',
  appendSpeech('Spoke to him about', 'the iCollect account'), 'Spoke to him about the iCollect account')

/* ---------- 3. nothing from nothing ---------- */

check('silence adds nothing', appendSpeech('Spoke to him', ''), 'Spoke to him')
check('whitespace adds nothing', appendSpeech('Spoke to him', '   '), 'Spoke to him')
check('silence into an empty box stays empty', appendSpeech('', ''), '')
check('an empty box and real speech', appendSpeech('', 'hello'), 'Hello')

/* ---------- 4. a note dictated in several goes ---------- */

// The realistic case: somebody talks, pauses, talks again. Each final phrase arrives separately.
const spoken = [
  'spoke to the debtor this morning',
  '.',
  'he says the insurance pays out on the 28th',
  'and he will settle the full',
  'R6 030 then',
  '.',
]
check('a whole note reads as sentences',
  spoken.reduce(appendSpeech, ''),
  'Spoke to the debtor this morning. He says the insurance pays out on the 28th and he will settle the full R6 030 then.')

/* ---------- 5. the surrounding machinery ---------- */

// South African English leads, because a recogniser set to en-US turns local names into noise.
check('South African English is the default', DEFAULT_DICTATION_LANGUAGE, 'en-ZA')
check('and it is offered first', DICTATION_LANGUAGES[0].code, 'en-ZA')
ok('Afrikaans is offered', DICTATION_LANGUAGES.some((l) => l.code === 'af-ZA'))
ok('every language has a label', DICTATION_LANGUAGES.every((l) => l.code && l.label))

// Outside a browser there is no API and nothing may throw for asking.
check('unsupported outside a browser', dictationSupported(), false)
check('the stored language falls back without localStorage', storedLanguage(), 'en-ZA')

// Every error says what to DO. 'aborted' is the exception: stopping on purpose reports as an
// error, and saying so would be nonsense.
check('a blocked microphone explains itself',
  dictationError('not-allowed').includes('Allow it'), true)
check('no microphone explains itself',
  dictationError('audio-capture').includes('plugged in'), true)
check('stopping on purpose says nothing', dictationError('aborted'), '')
ok('an unknown code still says something', dictationError('what-is-this').length > 10)
ok('every error message ends in a full stop', ['not-allowed', 'audio-capture', 'network', 'no-speech', 'nope']
  .every((c) => dictationError(c).trim().endsWith('.')))

// The help for a browser that cannot do it has to name a way out on each kind of machine.
for (const machine of ['iPad', 'Windows', 'Mac']) {
  ok(`the fallback help names ${machine}`, NO_DICTATION_HELP.includes(machine))
}

/* ---------- report ---------- */

if (failures.length) {
  console.error(`FAIL — ${failures.length} of ${pass + failures.length} checks\n`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`PASS — ${pass} checks: dictated phrases join into sentences, and an amount, a`)
console.log('       surname and an account reference all survive the joining untouched.')
