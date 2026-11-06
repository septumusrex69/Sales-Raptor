/**
 * RAPTOR'S SPELL CHECK (Raptor · Handover 17, S18) -- the real dictionary, the firm's words, and what it must not
 * flag. A spell check that underlines a debtor's surname or "in duplum" on every notice is one people stop reading.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-spell-check.mjs
 */
import { readFileSync } from 'node:fs'
import nspell from 'nspell'
import { FIRM_WORDS, replaceWord, tokens, unknownWords } from '../../src/lib/spellCheck.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) pass += 1; else failures.push(`${name}\n    expected ${e}\n    got      ${a}`)
}
const ok = (name, v) => check(name, v, true)

const dir = new URL('../../public/dictionaries/en-gb/', import.meta.url)
const speller = nspell(readFileSync(new URL('en_GB.aff', dir), 'utf8'), readFileSync(new URL('en_GB.dic', dir), 'utf8'))
const words = (t, extra) => unknownWords(t, speller, extra).map((u) => u.word)

/* ---------- it catches what it is for ---------- */
check('typos are found', words('We recieved your paymnet and will seperate the amounts.'), ['recieved', 'paymnet', 'seperate'])
ok('...with the right word among the suggestions', unknownWords('please recieve this', speller)[0].suggestions.includes('receive'))
check('each word once', words('teh balance, teh interest, teh fees'), ['teh'])

/* ---------- and is quiet where it must be ---------- */
const notice = `Dear Mr Khumalo,

Kindly note that your account RAP-125318 with Highveld Glass has been handed over to Bredell Ferreira for collection.
The balance of {{balance}} is due by {{respond_by}}. Interest is charged at 2% a month, subject to the in duplum rule
under section 103(5) of the National Credit Act, and fees under Annexure B. Pay by EFT to the trust account and quote
your case number. You may email info@bredellferreira.co.za or visit https://bredellferreira.co.za. We've organised a
payover to the client's remittance; the debtor's realised colour-coded statement is attached.`
check('a real notice in the firm\'s words raises nothing', words(notice), [])
check('the two words the firm\'s 114 templates raised are known now', words('lodge it with the ombud; it is diarised'), [])
check('capitals are never checked: names, places, acronyms', tokens('Sipho Mthembu PTP NCA Soweto'), [])
check('...nor digits, merge fields, emails or web addresses', tokens('R1500 {{debtor_name}} a@b.co.za www.x.co.za 3rd'), [])
ok('British spelling, not American: "organise" and "colour" pass', words('organise colour').length === 0)
check('...and the American spelling is offered the British one', unknownWords('color', speller)[0]?.suggestions.includes('colour'), true)
check('a word added on this device is not raised again', words('the gogo paid', ['gogo']), [])
ok('the firm\'s list is lower case (capitalised words are never checked anyway)', FIRM_WORDS.every((w) => w === w.toLowerCase()))
ok('...and every word on it is one the dictionary lacks or a deliberate South Africanism', FIRM_WORDS.length > 20)

/* ---------- a suggestion replaces whole words only ---------- */
check('replaceWord swaps every whole occurrence', replaceWord('teh and teh, not tehran', 'teh', 'the'), 'the and the, not tehran')
check('...and not inside another word or a name', replaceWord("teh's Tehran", 'teh', 'the'), "teh's Tehran")

/* ---------- wired where messages leave ---------- */
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
for (const f of ['src/components/ComposeEmailModal.tsx', 'src/pages/accounts/SmsModal.tsx', 'src/components/record/CrmSmsModal.tsx']) {
  const src = read(f)
  ok(`${f}: checked before it sends`, /if \(!\(await spell\.clear\(\[/.test(src) && /spell\.panel\(\[/.test(src))
}
const lib = read('src/lib/spellCheck.ts')
ok('the switch is on unless switched off', /getItem\(SWITCH_KEY\) !== 'off'/.test(lib))
ok('the underlines follow the switch, from <html>', /documentElement\.setAttribute\('spellcheck'/.test(lib))
ok('nothing is sent anywhere to be checked: the dictionary is Raptor\'s own file', /const DICTIONARY = '\/dictionaries\/en-gb\/'/.test(lib) && !/https?:\/\//.test(lib.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')))
const gate = read('src/components/SpellGate.tsx')
ok('a dictionary that will not load never stops a message', /catch \{\s*return true\s*\}/.test(gate))
ok('pressing Send again on the same text sends it as it is', /if \(shownFor === key\) return true/.test(gate))
ok('the page is South African English', /<html lang="en-ZA"/.test(read('index.html')))
ok('the licence sits beside the dictionary', /wordlist|Hunspell|SCOWL/i.test(read('public/dictionaries/en-gb/LICENCE.txt')))

console.log(`${pass} passed, ${failures.length} failed`)
if (failures.length) { for (const f of failures) console.log(`  FAIL ${f}`); process.exit(1) }
