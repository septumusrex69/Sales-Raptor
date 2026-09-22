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
import { planHandover, toDebtorInput } from '../../src/lib/handoverImport.ts'
import { toAccountRow, validateNewDebtor } from '../../src/lib/newDebtor.ts'
import { HANDOVER_COLUMNS } from '../../src/lib/handoverSheet.ts'

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
  title: 'Mr', initials: 'J H', second_name: 'Hendrik',
  capital: '48250.00', id_number: '8503125009089',
  cell_1: '082 123 4567', street_1: '14 Protea Street', suburb: 'Wonderboom',
  city: 'Pretoria', street_code: '0182', next_of_kin: 'Maria', next_of_kin_phone: '083 234 5678',
}, '2026-03-18')
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

/*
 * ---------- every name column a client fills in reaches the account ----------
 *
 * THE FIRM: "I imported some of this data, but it shows, for example, the full name Zanele
 * Sithole. It doesn't show the surname and the name, stuff like that."
 *
 * THE TITLE, THE INITIALS AND THE SECOND NAME WERE DROPPED. The sheet asks for all five, the
 * draft table shows all five, and toAccountRow wrote two -- so three columns were collected from
 * a client, judged, displayed and then quietly discarded on the way to the ledger. Nothing
 * failed; the account just opened without them.
 *
 * Asserted at BOTH ends, because either alone passes while the value goes nowhere: the mapping
 * out of the sheet, and the row that actually reaches the database.
 */
check('the title comes off the sheet', input.title, 'Mr')
check('...and the initials', input.initials, 'J H')
check('...and the second name', input.secondName, 'Hendrik')

const row = toAccountRow(input, 'company-1', 'handover-1')
check('the title reaches the account row', row.debtor_title, 'Mr')
check('...and the initials', row.debtor_initials, 'J H')
check('...and the second name', row.debtor_second_name, 'Hendrik')
check('...beside the two that always did',
  [row.debtor_first_name, row.debtor_surname], ['Johannes', 'Van Der Westhuizen'])
/* Absent is null, not an empty string: the panel prints "Not recorded" for a blank and would
   print nothing at all for '', which reads as a field that failed to load. */
const bare = toAccountRow(toDebtorInput({
  name: 'Dube', capital: '100',
}, '2026-01-01'), 'company-1', null)
check('a name column nobody filled in is null rather than empty',
  [bare.debtor_title, bare.debtor_initials, bare.debtor_second_name], [null, null, null])

/*
 * ---------- and the question asked of every column at once ----------
 *
 * The three above were found by looking at one debtor on one screen. This asks it of all forty,
 * so the next one does not wait for somebody to notice. It is a RATCHET, not a pass/fail: the
 * list below is what is known to go nowhere, and the assertion is that the gap is exactly that.
 * A new column that reaches nothing fails here; so does one that starts reaching something and
 * is left on the list, which is the half that keeps the list honest.
 *
 * WHAT IS ON IT IS REPORTED TO THE FIRM, NOT DECIDED HERE. Each of these has somewhere it could
 * plausibly live -- a contact row, a note, last_payment_at -- and where a column belongs is the
 * firm's call, not a thing to guess at while fixing a name field.
 */
const GOES_NOWHERE = [
  /* debtor_accounts.last_payment_at exists and nothing writes to it. Prescription runs off this
     and the firm asked for the column by name: "call it the last date of payment". */
  'last_payment_date',
  /* account_contacts takes mobile / phone / email rows with a label, so all of these have a home
     and none of them is written. */
  'cell_3', 'home_phone', 'email_2', 'other_phone', 'other_phone_2', 'other_email',
  'other_contact_note',
  /* No column anywhere. The employer contact carries a label that could hold it. */
  'occupation',
  /* account_notes, which is where the decision note already goes -- the firm's own words for
     where an import's remarks belong: "that goes on the notes or the main comment". */
  'notes',
  /* THE ONE THAT IS DELIBERATE. THE FIRM: "we will never be posting something. Never ever we
     will post a letter. We will send everything via email." Still asked for on the sheet, since
     a summons is served somewhere, but nothing downstream reads a postal address. */
  'postal_1', 'postal_2', 'postal_city', 'postal_code',
]
const NOT_CARRIED = new Set([
  /* Read as debtorKind rather than stored as text, and asserted separately below. */
  'debtor_kind',
  /* READ BY THE PLANNER, CARRIED AS A DATE. toDebtorInput is deliberately not allowed near this
     cell -- it holds whatever was typed into it, and it goes into a `date` column. See below. */
  'default_date',
  /* Folded into the one address the account keeps, on its own lines. */
  'street_1', 'street_2', 'suburb', 'city', 'street_code',
  /* Read into the single identity field, whose meaning debtorKind decides. */
  'registration_number',
  ...GOES_NOWHERE,
])
const carried = code(read('../../src/lib/handoverImport.ts'))
const dropped = HANDOVER_COLUMNS
  .map((c) => c.key)
  .filter((k) => !NOT_CARRIED.has(k) && !carried.includes(`v('${k}')`))
check(`every sheet column either reaches the account or is on the known list${
  dropped.length ? ` (new: ${dropped.join(', ')})` : ''}`, dropped, [])
/* The other direction: a column that has started arriving must come OFF the list, or the list
   quietly becomes a record of what used to be broken. */
const fixed = GOES_NOWHERE.filter((k) => carried.includes(`v('${k}')`))
check(`nothing on the known list is silently already fixed${
  fixed.length ? ` (take off: ${fixed.join(', ')})` : ''}`, fixed, [])

/*
 * PERSON OR COMPANY, WRITTEN. No import has ever set it, so every account the sheet opened came
 * out a person -- the same state the Swordfish import left the book in, with sixteen accounts
 * named "(Pty) Ltd" filed as people. The panel turns on this column: what it calls itself,
 * whether the identity field is an ID or a registration number, whether the numbers on it are
 * the debtor's own, and what a trace searches on.
 */
const business = toDebtorInput({
  name: 'Adowa Property Managers', debtor_kind: 'Business',
  registration_number: '2016/210735/07', capital: '100',
}, '2026-01-01')
check('a business row opens as a company', business.debtorKind, 'company')
check('...with its registration number as its identity', business.idNumber, '2016/210735/07')
check('...and it reaches the row',
  toAccountRow(business, 'c1', null).debtor_kind, 'company')
const person = toDebtorInput({ name: 'Dube', debtor_kind: 'Person', id_number: '8503125009089' }, null)
check('a person row opens as a person', person.debtorKind, 'individual')
check('...with the ID number, not the registration one', person.idNumber, '8503125009089')
/* Anything a client typed that is neither reads as a person, which is what the column defaults
   to and what the planner already warns about -- it must not silently become a company. */
check('an unrecognised word is a person',
  toDebtorInput({ name: 'Dube', debtor_kind: 'Individual' }, null).debtorKind, 'individual')
check('...and so is a blank', toDebtorInput({ name: 'Dube' }, null).debtorKind, 'individual')

/* ---------- one query for the sheet, not one per row ---------- */

/*
 * THE FIRM: "let's say there's a handover sheet of 500 imports and 50 of them have problems. Now
 * there'll be 50 different individual queries. I think we should have a query per handover sheet."
 *
 * Fifty rows on a liaison's client page, each the same sentence about a different debtor, and
 * fifty things to chase and close separately when the client answers all of them in one reply.
 */
ok('the import raises its query against the batch', /raiseQuery\(\{\s*handoverId,/.test(lib))
/* THE LOOP IS GONE, not merely joined by a batch one. Left in place it would raise fifty-one. */
ok('...and no longer one per corrected row',
  !/for \(const \[i, row\] of corrections\.entries\(\)\)/.test(lib))
ok('...exactly once', (lib.match(/await raiseQuery\(/g) ?? []).length === 1)
/* The description names the sheet and the counts -- see check-import-corrections for the words. */
ok('...describing the sheet rather than one debtor', /batchQueryDescription\(\{/.test(lib))
/*
 * NEVER CHARGED, and now it cannot be: a batch has no account to raise a fee against. Annexure B
 * item 3 recovers the time a DEBTOR's objection cost; a client's own sheet being wrong is not
 * something any debtor pays for. Three locks, and this asserts the two that live in code.
 */
ok('...and charges nobody', /charge: false/.test(lib))
const queries = code(read('../../src/lib/accountQueries.ts'))
ok('...with a fee that cannot be raised without an account',
  /escalationChargeable\(input\.kind \?\? 'dispute'\) && !!input\.accountId/.test(queries))
/* An account note is per account, and a batch is not one. Writing one would need an account id
   that does not exist. */
ok('a sheet-level query writes no account note', /if \(input\.accountId\) \{/.test(queries))

/*
 * AND THE DATABASE KEEPS EVERY QUERY PARENTED. account_id had to become nullable for a batch
 * query to exist at all, and a nullable column with no check is a table that will quietly accept
 * a query belonging to nothing -- which nothing would ever show, because every list joins.
 */
ok('a query hangs off an account or a batch', /handover_id uuid references public\.handovers/.test(schema))
ok('...and never off neither',
  /check \(account_id is not null or handover_id is not null\)/.test(schema))
ok('...which needed account_id to stop being required',
  /alter column account_id drop not null/.test(schema))

/* ---------- the refused rows go back as a sheet ---------- */

/*
 * THE FIRM: "those ones that were rejected, they should be attached in the email sent to the
 * client liaison. Only the rejected ones. And it should also be downloaded automatically for the
 * user, should also be in the query ticket, and once the query has been resolved it can be
 * erased."
 *
 * NOTHING IS STORED, and that is what answers the last of those four. A file written beside the
 * draft would be a second record of the same thing, would go stale the moment a row was
 * corrected, and would be the thing somebody has to remember to erase. Built from the frozen
 * draft each time, there is nothing to erase and nothing that can disagree with it.
 */
ok('the approval builds the sheet of refused rows', /rejectedSheetRows\(notBroughtIn\)/.test(lib))
/* ONLY the refused ones. The accepted-with-a-warning rows are open and being worked; asking the
   client to send them again would have them re-handing over accounts already on the book. */
ok('...from the rows that were NOT brought in', !/rejectedSheetRows\(corrections\)/.test(lib))
ok('...and only when there were any', /notBroughtIn\.length > 0\s*\?/.test(lib))
ok('...attached to the liaison\u2019s email', /attachments: \[attachment\]/.test(lib))
ok('...as base64, which is how the send endpoint takes one', /toBase64\(refusedSheet\.bytes\)/.test(lib))
/* Handed back to whoever ran the import as well, so they are holding what the client is holding
   -- and can send it on themselves if the email did not go. */
ok('...and handed to the person who ran the import', /downloadBytes\(result\.refusedSheet/.test(card))
ok('...only when something was refused',
  /if \(result\.refusedSheet\) \{/.test(card))

/* ---------- a query has a page of its own ---------- */

/*
 * THE FIRM: "a query should have a card, like the same as a deal, with the details of the query
 * on the inside ... if you click on that little query for this date's handover sheet, then it
 * goes in there."
 *
 * A query had no page: the board and the client list both opened the ACCOUNT -- a different
 * question, and one a sheet-level query cannot answer because it has no account.
 */
const app = code(read('../../src/App.tsx'))
ok('there is a route for one query', /path="\/queries\/:id"/.test(app))
const detail = code(read('../../src/pages/queries/QueryDetail.tsx'))
/*
 * THE ROWS ARE READ BACK, NOT STORED ON THE QUERY. The draft is frozen once approved and is the
 * record of what the client sent; a description copied onto the query at approval would be true
 * on the day and slowly stop being true.
 */
ok('...which reads the sheet back off the frozen draft', /fetchDraftForHandover\(/.test(detail))
ok('...and keeps the email\u2019s two groups', /Not brought in/.test(detail) && /must confirm/.test(detail))
/* A draft that has been tidied away must leave the query readable rather than the page broken. */
ok('...and survives the draft being gone', /no longer on file/.test(detail))
/* AND THE SHEET IS OFFERED FROM HERE TOO -- built on the spot, never stored. */
/* THE REFUSED ONES, named. `rejectedSheetRows(` alone passed with `toConfirm` handed to it --
   which would ask the client to re-send the accounts that ARE open and being worked. */
ok('the ticket can send the refused rows back',
  /rejectedSheetRows\(notBroughtIn\.map\(/.test(detail))
ok('...built when it is asked for rather than stored', /downloadBytes\(/.test(detail))
/*
 * "Once the query has been resolved it can be erased." A closed query stops offering it, which
 * is the whole of erasing when nothing was written down.
 */
ok('...and a closed query no longer offers it',
  /q\.status === 'closed' \|\| !draft \? null/.test(detail))
const clientList = code(read('../../src/pages/companies/ClientQueries.tsx'))
ok('the client page opens the query', /to=\{`\/queries\/\$\{q\.id\}`\}/.test(clientList))
/* A batch has no debtor, so naming one would link to /accounts/null -- a page that says the
   account is gone. */
ok('...and only links a debtor where there is one', /q\.accountId \? \(/.test(clientList))

/* ---------- a second go at the rows that could not be opened ---------- */

/*
 * THE FIRM: "in the query ticket, specifically this ticket for a handover that is in an awaiting
 * state, it should show all of the details like it's ready for an import, and when the details is
 * changed it can be approved and imported."
 *
 * A NEW DRAFT, NEVER THE OLD ONE REOPENED, and that is the assertion this section exists for. An
 * approved draft is frozen because it is the only record of what the client sent and what was
 * corrected on the way in; editing a refused row back into it rewrites that record. The refused
 * rows are COPIED, and the copy goes through the ordinary path -- same planner, same gate, same
 * approval, its own batch.
 */
ok('the refused rows can be raised again', /export async function startFollowUpDraft/.test(lib))
ok('...as a new draft', /from\('handover_drafts'\)\.insert\(\{[\s\S]{0,400}?from_query_id/.test(lib))
/* THE ORIGINAL IS NEVER TOUCHED. Nothing in the follow-up may update the draft it copied from,
   or the frozen record stops being one. */
const followUp = lib.slice(
  lib.indexOf('export async function startFollowUpDraft'),
  lib.indexOf('export async function fetchDraft(id'))
ok('...and the original draft is only read', !/update\(/.test(followUp))
ok('...its rows only read', !/handover_draft_rows'\)\.update/.test(followUp))
/* THE SAME TEST FOR "not brought in" the email and the ticket use, so the three cannot come to
   mean different things about the same row. */
ok('...taking the rows nothing was opened for',
  /r\.excluded \|\| r\.planned\?\.refused/.test(followUp))
/*
 * ONE PER QUERY, and by a unique index rather than a read-then-write. Two people opening the same
 * ticket at once is an ordinary Tuesday, and check-then-insert gives them a draft each.
 */
ok('...one follow-up per query, enforced by the database',
  /create unique index if not exists handover_drafts_from_query_idx/.test(schema))
ok('...and pressing the button twice finds the one already there',
  /const already = await followUpDraft\(/.test(followUp))
/*
 * RENUMBERED FROM 2. Every message about a row says "Row 7", and 7 on this sheet would be 7 on a
 * sheet nobody is looking at.
 */
ok('...with the rows numbered for the new sheet', /line: i \+ 2/.test(followUp))
/* Named for the sheet it came out of: a liaison looking at the queue a week later has to tell it
   from the original at a glance. */
/* The source spells the dash as an escape inside a template literal, where it IS interpreted --
   so this matches the source's own spelling rather than the character it produces. */
ok('...and named for the sheet it came from',
  /original\.draft\.filename\.replace\([\s\S]{0,40}?corrected/.test(followUp))

/*
 * THE SAME TABLE THE IMPORT SCREEN DRAWS. Drawn twice they drift, and the failure is not two
 * tables that look different -- it is one of them judging a row by rules the other has moved on
 * from.
 */
ok('the import screen\u2019s table is shared rather than copied',
  /export function DraftTable/.test(card))
ok('...and the ticket uses that one', /<DraftTable/.test(detail))
ok('...driven by the same library calls',
  /updateDraftRow\(rowId, \{ excluded \}\)/.test(detail)
  && /acceptDraftRow\(rowId, note\)/.test(detail)
  && /approveDraft\(\{/.test(detail))
/* Through approveDraft, which is what opens the accounts, raises the references, writes the
   notes and tells the client -- a second import path would do some of that and not the rest. */
/* WIRED TO THE BUTTON, not merely present in the file. Asserted only as "approveDraft appears
   somewhere", this passed with the button's handler emptied -- the function was still there,
   doing nothing for anybody. */
ok('...and imported through the one approval',
  /approveDraft\(\{[\s\S]{0,200}?draftId: followUp/.test(detail)
  && /onApprove=\{importFollowUp\}/.test(detail))
/*
 * RAISED BY A BUTTON, never by opening the ticket. A draft created as a side effect of looking at
 * a page is one nobody asked for, and a "waiting to be approved" queue with strangers in it is a
 * queue nobody trusts.
 */
ok('opening the ticket only reads', /followUpDraft\(found\.query\.id/.test(detail))
ok('...and raising one is a button', /raiseFollowUp\(\)/.test(detail))
/* Nothing to correct means nothing to offer: a button on a handover where everything came in
   would open an empty draft. */
ok('...offered only where something was refused', /notBroughtIn\.length > 0 && \(/.test(detail))

/*
 * ---- A CELL IS WRITTEN ON ITS OWN, NEVER AS THE WHOLE ROW ----
 *
 * THE FIRM, on a handover it could not approve: "I changed the contact details in the handover
 * sheet ... and then it accepted it and then the ticket went away, but now it tells me that it
 * has not gone away."
 *
 * Both screens used to save a corrected cell by spreading the screen's copy of the row and
 * writing the whole `values` object back. Every edit re-reads and re-judges the draft, which is a
 * round trip -- so that copy is one edit behind, and writing it back put the previous value in
 * again. The correction saved, the warning cleared, and a moment later it was there again.
 *
 * The browser check beside this proves the behaviour. This holds the shape, because the shape is
 * what makes it impossible: there is no way to ask for a whole-row write any more.
 */
ok('a cell is set through the database’s own merge',
  /rpc\('set_draft_row_value'/.test(lib))
ok('...and updateDraftRow cannot write values at all',
  /export async function updateDraftRow/.test(lib)
  && !/values\?: Record<string, string \| null>/.test(lib))
/* Both screens, because the query ticket draws the same table and had the same bug. */
ok('the import screen writes one cell', /setDraftRowValue\(rowId, key, value\)/.test(card))
ok('...and so does the query ticket', /setDraftRowValue\(rowId, key, value\)/.test(detail))
ok('neither builds a row out of its own copy',
  !/\{ \.\.\.row\.values, \[key\]/.test(card) && !/\{ \.\.\.row\.values, \[key\]/.test(detail))
/*
 * AND A KEY NOBODY RECOGNISES FAILS WHERE IT IS TYPED. An unknown one is not dangerous -- the
 * planner reads named keys and ignores the rest -- but it would be written, stored, and silently
 * do nothing for ever.
 */
ok('...and an unknown column is refused rather than stored',
  /HANDOVER_COLUMNS\.some\(\(c\) => c\.key === key\)/.test(lib))

/*
 * ---- THE NEWEST READ WINS ----
 *
 * Two re-reads can be out at once and nothing makes them come back in the order they were sent.
 * The older one landing last redraws the pre-edit judgement: a corrected row goes back to being a
 * problem while the database is right the whole time.
 */
ok('an out-of-date read is thrown away rather than drawn',
  /readSeq\.current \+= 1/.test(card) && /seq !== readSeq\.current/.test(card))

/*
 * ---- A BLUR THAT CHANGED NOTHING SAVES NOTHING ----
 *
 * A date is stored as the sheet's reader produced it and drawn day-first, so a guard comparing
 * the box with the STORED value never matched and merely tabbing through a date cell saved the
 * row. Two rows of the firm's own draft on staging carry a date nobody typed.
 */
ok('a blur is judged against what the box was showing',
  /e\.target\.value\.trim\(\) === shown\.trim\(\)/.test(card))

/*
 * ---- A TYPED DATE NEVER REACHES A DATE COLUMN ----
 *
 * The handover table shows a date as 18/03/2026 and invites somebody to correct it there. What
 * they type is stored exactly as typed, and the approval used to hand that string to Postgres.
 *
 * Supabase runs DateStyle MDY, so it splits two ways and the loud half is the lucky one:
 *   15/03/2026 -> "date/time field value out of range", which is what the firm hit
 *   03/04/2026 -> accepted, and stored as 4 MARCH
 * In duplum, interest and prescription all run from this date. A silently transposed one is
 * wrong for the life of the account and nothing anywhere would say so.
 *
 * So the row carries the date it was JUDGED on, and that is the only one allowed near the
 * database. Asserted through planHandover rather than on the parser, because the bug was not in
 * the parsing -- it was that a correctly parsed date sat there while the raw cell went to
 * Postgres instead.
 */
const typed = planHandover({
  rows: [
    ['Your reference', 'Handover amount', 'Date of default', 'Person or business', 'Surname'],
    ['BF-206', '2075', '15/03/2026', 'Person', 'Mahlangu'],
    /* The dangerous one: every part of it is a plausible month as well as a plausible day. */
    ['BF-207', '900', '03/04/2026', 'Person', 'Jacobs'],
  ],
  today: '2026-09-22',
})
check('a day-first date is carried as a date', typed.rows[0].defaultDate, '2026-03-15')
check('...and the third of April is the third of April',
  typed.rows[1].defaultDate, '2026-04-03')
check('the account opens on that, not on what was typed',
  toDebtorInput(typed.rows[1].values, typed.rows[1].defaultDate).handoverDate, '2026-04-03')
/* The guard that makes the route impossible rather than merely unused: toDebtorInput cannot read
   the cell at all, so no caller can reintroduce this by forgetting. */
ok('toDebtorInput cannot reach the date cell', !carried.includes("v('default_date')"))
/*
 * AND THE LAST LINE OF DEFENCE, on the function every path to an account goes through. A check
 * that only lives in the import is a check the by-hand form and every future caller do not have.
 */
check('a date that is not a date cannot open an account',
  validateNewDebtor({
    ...input, handoverDate: '15/03/2026', interestRateAnnual: '0',
  }, '2026-09-22').some((p) => p.field === 'handoverDate'), true)
check('...and one that is, can',
  validateNewDebtor({
    ...input, handoverDate: '2026-03-15', interestRateAnnual: '0',
  }, '2026-09-22').some((p) => p.field === 'handoverDate'), false)

/*
 * ---- NOTHING IS WRITTEN UNTIL EVERY ROW CAN BE OPENED ----
 *
 * The approval inserted the batch, then opened the accounts one at a time, and a row the database
 * refused threw straight out -- leaving the batch and however many accounts had already gone in,
 * with the draft still in the queue as though nothing had happened. Pressing Approve again opened
 * them all again. It happened to the firm twice in two minutes on one sheet: two batches, five
 * accounts each, the same five references on the book twice.
 *
 * A half-import is worse than a failed one in every way that matters.
 */
const build = lib.indexOf('const built = going.map(')
const validate = lib.indexOf('validateNewDebtor(debtor, input.today)')
const batchInsert = lib.indexOf("from('handovers').insert(")
const firstAccount = lib.indexOf('createDebtorAccount(')
/* PRESENCE BEFORE ORDER. indexOf returns -1, so an order-only assertion passes vacuously the
   moment the thing it orders is deleted -- which is the trap CLAUDE.md names. */
ok('the rows are built before anything is written', build >= 0)
ok('...and checked', validate >= 0)
ok('...and there is a batch and an account to order against',
  batchInsert >= 0 && firstAccount >= 0)
ok('every row is checked before the batch exists', build < validate && validate < batchInsert)
ok('...and before the first account is opened', validate < firstAccount)
/* WIRED TO THE COUNT, not merely present in the file. Asserted as "the sentence appears
   somewhere" this passed with the condition replaced by `if (false)` -- the words were still
   there, telling nobody anything. */
/*
 * AND IT STOPS THE RIGHT THINGS ONLY.
 *
 * validateNewDebtor answers "would the by-hand form save this", which is stricter than "can the
 * database store it" -- deliberately. An ID number that is not an ID number is a WARNING on an
 * import: the draft asks about it and somebody presses Accept. Run unfiltered, this check would
 * have held eleven good accounts on the firm's own sheet over two bad ID numbers, which is the
 * screen overruling a decision a person had already made on it.
 *
 * So the blocking set is the fields that land in a `date` or a `numeric`. Asserted both ways --
 * what must stop a batch and what must not -- because a set like this drifts in both directions
 * and only one of them is visible.
 */
ok('only a value the database itself would refuse stops a batch',
  /const STOPS_A_WRITE = new Set\(\['handoverDate', 'capital', 'interestRateAnnual'\]\)/.test(lib)
  && /\.filter\(\(p\) => STOPS_A_WRITE\.has\(p\.field\)\)/.test(lib))
check('...so a bad ID number does not hold the handover',
  validateNewDebtor({ ...input, idNumber: '0823456789', handoverDate: '2026-03-18',
    interestRateAnnual: '0' }, '2026-09-22')
    .filter((p) => ['handoverDate', 'capital', 'interestRateAnnual'].includes(p.field)).length, 0)
check('...and a date the database cannot read does',
  validateNewDebtor({ ...input, handoverDate: '15/03/2026', interestRateAnnual: '0' }, '2026-09-22')
    .filter((p) => ['handoverDate', 'capital', 'interestRateAnnual'].includes(p.field)).length, 1)

ok('a row that cannot open an account stops the whole import',
  /if \(unopenable\.length > 0\) \{\s*throw new Error\(/.test(lib)
  && /nothing on this handover was imported/i.test(lib))
/* And the throw is above the batch, or it stops nothing that has not already happened. */
ok('...before there is a batch to leave behind',
  lib.indexOf('if (unopenable.length > 0)') < batchInsert)

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
