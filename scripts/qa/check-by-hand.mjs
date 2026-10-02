/**
 * THE COMPOSE BOX OFFERS ONLY WHAT A PERSON SENDS BY HAND.
 *
 * THE FIRM: "you can remove all of the email templates from the emails except for the statement of
 * account and now the acknowledgements of debt, because the other stuff works with workflows."
 *
 * READ AS A SCOPE CHANGE, NOT A DELETE, AND THE NUMBERS ARE WHY: 33 of the collections templates
 * are referenced by 48 workflow_nodes -- the section 129 sequence, all three dispute sequences and
 * the arrangement sequences. Removing the rows would not tidy the compose box; it would break every
 * workflow the firm has. That is the assertion this file mostly holds.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-by-hand.mjs
 */
import { readFileSync } from 'node:fs'
import { BY_HAND_SEED_KEYS, offeredByHand } from '../../src/lib/byHand.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ')

const picker = code('src/components/library/UseTemplate.tsx')
const lib = code('src/lib/byHand.ts')
const E = (seedKey, kind = 'email') => ({ kind, seedKey })

/* ---------------------------------------------------------------------------------------------
 * WHAT IS OFFERED, AND WHAT IS NOT
 * ------------------------------------------------------------------------------------------- */

ok('the statement of account is offered', offeredByHand(E('email-account-statement-individual')))
ok('...for a company too', offeredByHand(E('email-account-statement-company')))
ok('the acknowledgement of debt is offered', offeredByHand(E('email-aod-individual')))
ok('...for a company too', offeredByHand(E('email-aod-company')))

/*
 * AND WHAT THE WORKFLOWS SEND IS NOT. These are the ones the firm meant by "the other stuff works
 * with workflows": a section 129 covering email that a collector could send by hand is a statutory
 * notice issued twice, on two clocks.
 */
ok('a section 129 covering email is not offered',
  !offeredByHand(E('email-s129-covering-individual')))
ok('...nor a final notice', !offeredByHand(E('email-final-notice-individual')))
ok('...nor a dispute acknowledgement', !offeredByHand(E('email-dispute-received-individual')))

/* ---------------------------------------------------------------------------------------------
 * ANYTHING THE FIRM WROTE IS THEIRS TO SEND
 * ------------------------------------------------------------------------------------------- */

/*
 * A template with no seed key was typed by somebody at this firm for their own use, and it is not
 * this rule's business to hide it: they made it to send it. Without this the firm would write a
 * template in the Library and then be unable to find it in a compose box, which reads as the
 * Library being broken.
 */
ok('a template the firm wrote is offered', offeredByHand(E(null)))

/* ---------------------------------------------------------------------------------------------
 * AND NOTHING ELSE IS NARROWED
 * ------------------------------------------------------------------------------------------- */

/*
 * EMAILS ONLY, which is exactly what was asked for. The same argument could be made about SMSs --
 * 16 are sent by workflows -- and is deliberately NOT made, because there is no by-hand SMS in the
 * list: narrowing that picker would leave a collector with nothing in it but whatever the firm has
 * typed themselves. Emptying a control nobody complained about is the worse mistake.
 */
ok('an SMS the workflow sends is still offered', offeredByHand(E('sms-s129-individual', 'sms')))
ok('a call script is still offered', offeredByHand(E('script-first-contact', 'call_script')))
ok('a letter is still offered', offeredByHand(E('letter-s129-individual', 'letter')))

/* ---------------------------------------------------------------------------------------------
 * KEYED ON THE SEED KEY, NEVER THE NAME
 * ------------------------------------------------------------------------------------------- */

/*
 * A name is the firm's to edit -- the Library is where they correct their own wording -- and
 * renaming "Statement of account (individual)" must not silently empty the picker. seed_key is set
 * by the migration that seeded the row and is editable nowhere in the app.
 */
ok('the rule never looks at a name', !/\.name/.test(lib))
ok('...and every entry is a seed key', BY_HAND_SEED_KEYS.every((k) => /^[a-z0-9-]+$/.test(k)))
/* BOTH AUDIENCES FOR EVERY ONE. The collections library is written twice all the way down, and a
   list carrying the individual half of a pair would hide the company half from a company account
   with no error anywhere. */
const pairs = new Set(BY_HAND_SEED_KEYS.map((k) => k.replace(/-(individual|company)$/, '')))
for (const stem of pairs) {
  ok(`${stem} is offered to both audiences`,
    BY_HAND_SEED_KEYS.includes(`${stem}-individual`) && BY_HAND_SEED_KEYS.includes(`${stem}-company`))
}

/* ---------------------------------------------------------------------------------------------
 * THE PICKER USES IT, AND THE LIBRARY DOES NOT
 * ------------------------------------------------------------------------------------------- */

ok('the compose box picker narrows its list', /offeredByHand\(r\)/.test(picker))
/*
 * AND THE LIBRARY PAGE STILL SHOWS EVERYTHING. That is where the firm reads and edits its own
 * wording; a template hidden there would be one nobody could correct, which is a worse failure
 * than a crowded picker. Held as an absence.
 */
ok('the library page is not narrowed', !/offeredByHand/.test(code('src/pages/library/LibraryPage.tsx')))

/*
 * AND NOTHING WAS DELETED. The whole point: the rows the workflows send must still exist. Held by
 * asserting the rule only ever FILTERS -- it has no delete, no update, and no database at all.
 */
ok('the rule touches no database', !/supabase|delete|update\(/.test(lib))

console.log(`\ncheck-by-hand: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
