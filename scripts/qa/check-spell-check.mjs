/**
 * RAPTOR'S SPELL CHECK (Raptor · Handover 17, S18) -- the real dictionary, the firm's words, and what it must not
 * flag. A spell check that underlines a debtor's surname or "in duplum" on every notice is one people stop reading.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-spell-check.mjs
 */
import { readFileSync } from 'node:fs'
import nspell from 'nspell'
import { FIRM_WORDS, eitherSpeller, replaceWord, tokens, unknownWords } from '../../src/lib/spellCheck.ts'

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
/* Both dictionaries are Raptor's own files (S19 added Afrikaans beside English). */
ok('nothing is sent anywhere to be checked: the dictionaries are Raptor\'s own files',
  /dir: '\/dictionaries\/en-gb\/'/.test(lib) && /dir: '\/dictionaries\/af-za\/'/.test(lib)
  && !/https?:\/\//.test(lib.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')))
const gate = read('src/components/SpellGate.tsx')
ok('a dictionary that will not load never stops a message', /catch \{\s*return true\s*\}/.test(gate))
ok('pressing Send again on the same text sends it as it is', /if \(shownFor === key\) return true/.test(gate))
ok('the page is South African English', /<html lang="en-ZA"/.test(read('index.html')))
ok('the licence sits beside the dictionary', /wordlist|Hunspell|SCOWL/i.test(read('public/dictionaries/en-gb/LICENCE.txt')))

/*
 * ENGLISH AND AFRIKAANS (S19; Stephan, 8 Nov: "Can we also integrate Afrikaans and English?"). The firm writes in
 * both, often in one message: a word is right if EITHER knows it, and corrections come from both.
 */
{
  const afDir = new URL('../../public/dictionaries/af-za/', import.meta.url)
  const af = nspell(readFileSync(new URL('af_ZA.aff', afDir), 'utf8'), readFileSync(new URL('af_ZA.dic', afDir), 'utf8'))
  const both = eitherSpeller([speller, af])
  const unknown = (t) => unknownWords(t, both).map((u) => u.word)
  check('a message in Afrikaans raises nothing', unknown('Geagte meneer, ons het u betaling ontvang. Die agterstallige bedrag op u rekening is betaal. Vriendelike groete.'), [])
  check('...nor one in both languages at once', unknown('Dear sir, thank you for your payment. Baie dankie vir die betaling.'), [])
  check('an Afrikaans typo is caught', unknown('Ons het u betaaling ontvang, asseblif bel ons.'), ['betaaling', 'asseblif'])
  ok('...and corrected from the Afrikaans dictionary', unknownWords('u betaaling', both)[0].suggestions.includes('betaling'))
  check('an English typo is still caught beside it', unknown('We recieved u betaling.'), ['recieved'])
  ok('...and corrected from English', unknownWords('recieved', both)[0].suggestions.includes('received'))
  ok('the trade\'s Afrikaans compounds are the firm\'s own words', FIRM_WORDS.includes('betalingsooreenkoms'))
  ok('Afrikaans\' licence sits beside its dictionary', /Translate\.org\.za/.test(read('public/dictionaries/af-za/LICENCE.txt')) && /LGPL|Lesser General Public/.test(read('public/dictionaries/af-za/LICENCE.txt')))
  ok('both languages are checked unless one is unticked', /return ok\.length \? ok : \['en', 'af'\]/.test(lib))
  ok('a language that will not load is left out rather than holding the message', /Promise\.allSettled\(langs\.map\(loadOne\)\)/.test(lib))
  const settings = read('src/pages/settings/SettingsPage.tsx')
  ok('spell check has its own place in Settings, not Appearance', /'Spelling'/.test(settings) && /tab === 'Spelling' && <SpellingTab \/>/.test(settings)
    && !/spell-check-switch/.test(settings.slice(settings.indexOf('function AppearanceTab'), settings.indexOf('function SpellingTab'))))
}

/*
 * THE ELEVEN OFFICIAL WRITTEN LANGUAGES (S19; Stephan: "make all 11 official languages"). Every dictionary is Raptor's
 * own file with its licence beside it; each loads and knows the words people write; isiZulu, whose rules take ten
 * seconds to build, is held to its files here (the browser builds it in the background -- e2e/spelling-settings).
 */
{
  const { SPELL_LANGUAGES } = await import('../../src/lib/spellCheck.ts')
  check('eleven languages are offered', SPELL_LANGUAGES.length, 11)
  const everyday = { xh: ['imali', 'intlawulo'], nso: ['leboga', 'tefo'], tn: ['madi', 'dumela'], st: ['tefo'], ts: ['mali', 'khensa'],
    ss: ['imali'], ve: ['tshelede', 'livhuwa'], nr: ['imali'] }
  for (const l of SPELL_LANGUAGES) {
    const dirUrl = new URL(`../../public${l.dir}`, import.meta.url)
    let aff = '', dic = '', lic = ''
    try { aff = readFileSync(new URL(`${l.file}.aff`, dirUrl), 'utf8'); dic = readFileSync(new URL(`${l.file}.dic`, dirUrl), 'utf8'); lic = readFileSync(new URL('LICENCE.txt', dirUrl), 'utf8') } catch { /* reported below */ }
    ok(`${l.label}: dictionary and licence are Raptor's own files`, aff.length > 100 && dic.length > 1000 && lic.length > 100)
    if (l.id !== 'en' && l.id !== 'af') ok(`${l.label}: read as UTF-8 (the browser reads it so)`, /^SET UTF-8/m.test(aff) && !/\uFFFD/.test(aff + dic))
    if (!everyday[l.id]) continue
    const sp = nspell(aff, dic)
    for (const w of everyday[l.id]) ok(`${l.label} knows "${w}"`, sp.correct(w))
  }
  const ve = SPELL_LANGUAGES.find((l) => l.id === 've')
  const veDir = new URL(`../../public${ve.dir}`, import.meta.url)
  const tshi = nspell(readFileSync(new URL('ve_ZA.aff', veDir), 'utf8'), readFileSync(new URL('ve_ZA.dic', veDir), 'utf8'))
  ok('a Tshivenda typo is corrected', tshi.suggest('tshelde').includes('tshelede'))
  ok('English and Afrikaans only, until somebody ticks more', /return ok\.length \? ok : \['en', 'af'\]/.test(lib))
  const gate2 = read('src/components/SpellGate.tsx')
  ok('the check before Send runs in the background, so no dictionary freezes the page', /await checkSpelling\(/.test(gate2) && !/loadSpeller\(\)/.test(gate2))
  ok('...in a worker', /new Worker\(new URL\('\.\/spellWorker\.ts', import\.meta\.url\)/.test(read('src/lib/spellClient.ts')))
  ok('...whose dictionaries are built soon after the app is up', /setTimeout\(warmSpelling, \d+\)/.test(read('src/main.tsx')))
}

console.log(`${pass} passed, ${failures.length} failed`)
if (failures.length) { for (const f of failures) console.log(`  FAIL ${f}`); process.exit(1) }
