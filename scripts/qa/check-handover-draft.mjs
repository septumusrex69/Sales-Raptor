/**
 * The handover a person can fix before it becomes accounts.
 *
 * THE FIRM: "it will scan each handover to see if everything is fine ... if it does not, some
 * handovers should not be accepted, and it should show why. Then you should be able to edit it in
 * the handover state on Raptor, and when it's ready say approve handover."
 *
 * Three promises in that sentence, and this file holds all three:
 *   - NOTHING becomes an account until somebody approves it
 *   - a row that is not accepted says WHY, and can be edited
 *   - an edit is JUDGED AGAIN, by the same code that judged the file
 *
 * The third is the one that rots quietly. A verdict stored beside a row is a verdict made before
 * the row was edited, and the screen would go on refusing something already fixed -- so the
 * verdict is never stored, and this refuses a column that would store one.
 */
import { readFileSync } from 'node:fs'
import { toDebtorInput } from '../../src/lib/handoverImport.ts'

let pass = 0
const failures = []
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass += 1; return }
  failures.push(`${label}\n    expected ${e}\n    got      ${a}`)
}
const ok = (label, actual) => check(label, actual, true)

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const schema = code(read('../../supabase/schema.sql'))
const lib = code(read('../../src/lib/handoverDraft.ts'))
const card = code(read('../../src/components/settings/HandoverImportCard.tsx'))
const tab = code(read('../../src/components/settings/DataImportTab.tsx'))

/* ---------- 1. the draft is in the database ---------- */

/*
 * THE FIRM CHOSE THIS after the trade was put to them: a two-hundred-row handover is an afternoon
 * of corrections, and an afternoon in a browser tab is one closed laptop away from nothing. It
 * also means the person who uploaded the sheet is not the only one who can finish it.
 */
ok('there is a table for a handover being worked on',
  /create table if not exists public\.handover_drafts \(/.test(schema))
ok('...and one for its rows', /create table if not exists public\.handover_draft_rows \(/.test(schema))
ok('...with the client it belongs to, picked rather than read from the sheet',
  /company_id uuid not null references public\.companies/.test(schema))

/*
 * THE VERDICT IS NOT STORED. planHandover works it out on every read, so a corrected cell is
 * judged by the code that judged the file. A `problems` or `refused` column here would be a
 * judgement made before the edit, and the screen would refuse a row somebody had already fixed.
 */
const rowsTable = schema.match(/create table if not exists public\.handover_draft_rows \(([\s\S]*?)\n\);/)
ok('the rows table is readable', rowsTable !== null)
ok('...and stores no verdict of its own',
  !/\b(problems|refused|is_valid|errors)\b/.test(rowsTable?.[1] ?? 'problems'))
ok('...so the draft is judged on every read', /planHandover\(\{/.test(lib))

/* ---------- 2. nothing becomes an account until approve ---------- */

/*
 * READING A SHEET AND OPENING AN ACCOUNT ARE DIFFERENT ACTS. Reading is free and repeatable;
 * opening a ledger is not, and in duplum is stamped at handover and never recalculated.
 */
ok('reading the sheet only holds it', /export async function saveDraft\(/.test(lib))
ok('...and approving is a separate call', /export async function approveDraft\(/.test(lib))
const save = lib.match(/export async function saveDraft\(([\s\S]*?)\n\}/)
ok('...which the holding step does not do',
  !/createDebtorAccount/.test(save?.[1] ?? 'createDebtorAccount'))

/*
 * AND THE ACCOUNTS ARE OPENED THE SAME WAY "ADD DEBTOR" OPENS ONE. An import with its own insert
 * would differ from the by-hand form in one field nobody thought about -- the in duplum ceiling,
 * the opening balance, the status a new account starts in. One path, one answer.
 */
ok('approval goes through the by-hand form’s own row builder', /toAccountRow\(/.test(lib))
ok('...and its contact rows', /toContactRows\(/.test(lib))
ok('...and its insert', /createDebtorAccount\(/.test(lib))

/*
 * THE BATCH IS CREATED BEFORE THE ACCOUNTS. This cannot be a transaction from a browser, so a run
 * that dies half way has to leave something findable: a batch holding the accounts that landed,
 * rather than orphans nobody can gather up again.
 */
const approve = lib.match(/export async function approveDraft\(([\s\S]*?)\n\}\n/)
ok('the approval is readable', approve !== null)
const body = approve?.[1] ?? ''
ok('...and the batch is created before the first account',
  body.indexOf("from('handovers')") !== -1
  && body.indexOf("from('handovers')") < body.indexOf('createDebtorAccount'))

/* A draft already approved cannot be approved again, or one sheet opens the accounts twice. */
ok('a handover cannot be approved twice', /already been approved/.test(lib))

/* ---------- 3. an approved draft is frozen ---------- */

/*
 * It is the record of what was imported AND what was corrected on the way in -- the only place
 * that says a capital figure was typed differently from the sheet the client sent. Edited
 * afterwards it would describe accounts that do not match it.
 */
ok('an approved handover is protected from later edits',
  /protect_approved_handover_draft\b/.test(schema))
ok('...and its rows are too', /protect_approved_handover_draft_row\b/.test(schema))
/* Silently, like protect_closed_diary_entries next door: the screen cannot reach an approved
   draft, so anything arriving there is a mistake somewhere else. */
ok('...by putting the old row back rather than raising', /return old;/.test(schema))

/* ---------- 4. the screen says why, and lets it be fixed ---------- */

ok('the card exists and is the import’s own', /export function HandoverImportCard\(/.test(card))
/* Matched as an ELEMENT rather than as the exact string it used to be: it takes a prop now (the
   client somebody arrived from), and an order assertion anchored to a literal that no longer
   appears is an indexOf of -1, which sorts before everything and passes on nothing. */
const cardAt = tab.indexOf('<HandoverImportCard')
ok('...and sits at the top of the collections side',
  cardAt !== -1 && cardAt < tab.indexOf('Bring the book across from Swordfish'))
ok('the client is chosen on the screen', /Whose handover is this/.test(card))
ok('...and the PDFs come in together', /multiple/.test(card) && /matchDocuments\(/.test(card))
ok('every row can be typed into', /onBlur=\{/.test(card))
ok('...and a row can be left out without being deleted', /onExclude\(/.test(card))
ok('the reasons are shown against the row number', /Row \{row\.line\}/.test(card))

/*
 * APPROVE IS HELD UNTIL EVERY PROBLEM HAS AN ANSWER, and this file asserted the opposite until
 * the firm said otherwise.
 *
 * It used to import whatever was importable and leave the rest behind, on the argument that
 * holding a whole batch until every row is perfect is how a client waits a week for 194 good
 * accounts because six have no date of default. That argument was sound about REFUSALS and wrong
 * about the screen it produced: forty-five identical warnings under a table, none of which
 * anybody had to do anything about.
 *
 * THE FIRM: "it should be in a pending state, and the approving cannot happen if all of the
 * bottom things have not been sorted out ... you could say accept it, or reject it."
 *
 * The 194 good accounts still go in -- rejecting the six takes six clicks, and the difference is
 * that somebody has now SEEN them. See check-handover-decision.mjs for the gate itself.
 */
ok('approve is held until nothing is waiting on a person', /judged\.gate\.ready/.test(card))
ok('...and says which rows it is waiting for', /judged\.gate\.why/.test(card))
/* The count beside the button comes off the gate, so the button cannot offer to import a number
   of accounts it is simultaneously refusing to import. */
ok('...and counts what it would import off the same gate', /judged\.gate\.importing/.test(card))
/* Each problem is answerable where it is written, rather than sending somebody back up a
   forty-column table to find the right row. */
ok('every problem offers a decision beside it', /<DecisionRow/.test(card))
ok('...with a note for whoever works the account', /A note for whoever works this account/.test(card))
/*
 * AND IT CAN BE SPOKEN. THE FIRM: "you should be able to write a note and dictate and tell the
 * note, just don't have to write it, just to talk."
 *
 * This note is the record of why an account whose ID number nobody could verify was accepted
 * anyway, and it is written by somebody working down eleven of them on an iPad. The shared
 * DictateButton, not a second implementation: it already handles the browser ending a session on
 * a pause, which is the difference between dictating a note and dictating its first sentence.
 */
ok('...which can be dictated rather than typed',
  /<DictateButton size="small" value=\{note\} onChange=\{setNote\} \/>/.test(card))
ok('...using the shared one', /from '\.\.\/ui\/Dictate'/.test(card))
/* A textarea, because a spoken note is sentences: a one-line box scrolls sideways and shows the
   end of what was said, which is the half nobody needs to check. */
ok('...into a box that shows more than the last few words it heard',
  /<textarea\s+value=\{note\}/.test(card))

/* ---------- 5. a draft row opens the account it describes ---------- */

/*
 * The mapping from a sheet's columns to the by-hand form's input. The surname is the one that
 * matters: on the OLD sheet it arrives out of "Debtor Initials", and everything downstream
 * addresses a debtor from it.
 */
const input = toDebtorInput({
  client_reference: 'GPS3/10103', name: 'Van Der Westhuizen', first_name: 'Johannes',
  capital: '48250.00', default_date: '2026-03-18', id_number: '8503125009089',
  cell_1: '082 123 4567', street_1: '14 Protea Street', suburb: 'Wonderboom',
  city: 'Pretoria', street_code: '0182', next_of_kin: 'Maria', next_of_kin_phone: '083 234 5678',
})
check('the surname becomes the surname', input.surname, 'Van Der Westhuizen')
check('the reference is the client’s own', input.clientReference, 'GPS3/10103')
check('the handover amount opens the ledger', input.capital, '48250.00')
/* The account opens at the date of default, because that is what in duplum runs from. */
check('and it opens at the date of default', input.handoverDate, '2026-03-18')
check('the address arrives on its own lines',
  input.address, '14 Protea Street\nWonderboom\nPretoria\n0182')
check('next of kin comes across', [input.kin1Name, input.kin1Phone], ['Maria', '083 234 5678'])
/*
 * INTEREST IS NOUGHT, NOT A GUESSED 24%. The sheet stopped asking for a rate at the firm's
 * instruction -- it is in the agreement the firm already holds. An account opened at nought is
 * one somebody notices; opened at a rate nobody chose, it is one nobody does.
 */
check('interest is left at nought rather than guessed', input.interestRateAnnual, '0')

/* ---------------------------------------------------------------- report */

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
A handover read, held in the database, and turned into accounts only when somebody says so -- with
the verdict recomputed on every read rather than stored beside the row, so an edit takes effect
instead of being argued with. The accounts are opened through the same path "Add debtor" uses, the
batch is created before the first of them so a run that dies leaves something findable, and an
approved handover is frozen because it is the only record of what was corrected on the way in.`)
