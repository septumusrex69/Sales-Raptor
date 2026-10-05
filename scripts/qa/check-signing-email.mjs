/**
 * THE ACKNOWLEDGEMENT OF DEBT GOES OUT BY EMAIL, WITH A BUTTON, AND IT CHARGES ITEM 4(a).
 *
 * THREE INSTRUCTIONS FROM THE FIRM, each of which the panel failed on their first run.
 *
 *   ONLY THE AoD IS SIGNED FROM A DEBTOR'S FILE: "the acknowledgement of debt that's sent to
 *   signature is the only thing that needs to be signed from the debtor's pane." And again, after
 *   it still offered the whole library: "the only document, and I repeat myself, is the
 *   acknowledgement of debt that can be signed within the debtor's pane. All of the other ones are
 *   not in." A debtor's signature on a section 129 means nothing and muddies what a signature on
 *   the file is for.
 *
 *   IT IS SENT, NOT SHOWN: "my instruction was you have to send it from email... and in the link,
 *   make it nice and big, like just don't make it a link and highlight it blue -- make it like a
 *   picture, or like a button that you can see, like sign the acknowledgement of debt." The panel
 *   stopped at a link on the screen, so their first signing request was never sent at all.
 *
 *   AND IT CHARGES: "it should charge the fee in accordance with acknowledgement of debt... the two
 *   different fees that I added, it depends on the amount: it's below 50,000 and over 50,000 for
 *   the claim amount." Item 4(a) carries no single figure in the Annexure -- the Magistrates'
 *   Courts Rules band it -- so before this the ledger recorded R0,00 for an acknowledgement of
 *   debt.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-signing-email.mjs
 */
import { readFileSync } from 'node:fs'
import {
  isSignable, signingButtonHtml, signingEmailBody, signingLinkLine,
} from '../../src/lib/signingRules.ts'
import {
  acknowledgementOfDebtFee, bandAmount, itemAmountFor, scheduleFor, unitAmountFor,
} from '../../src/lib/annexureB.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

const panel = read('src/pages/accounts/SigningPanel.tsx')
const composer = read('src/components/ComposeEmailModal.tsx')
const account = read('src/pages/accounts/AccountDetail.tsx')
const charges = read('src/lib/accountCharges.ts')
const engine = read('src/lib/chargeEngine.ts')

/* ------------------------------------------------ two documents, and nothing else */

/*
 * THE SEED KEYS HERE WERE WRONG, AND SO WERE THE ONES IN THE CODE.
 *
 * This read `seedKey: 'aod-individual'`, matching SIGNABLE_SEED_KEYS, which read the same. The rows
 * in the database are seeded as `letter-aod-individual` -- see seed-aod.mjs -- so the key branch
 * never matched a real template and every acknowledgement of debt has been found by the NAME regex
 * underneath it. The check agreed with the code and both were wrong about the data, which is the
 * failure a check written from the same assumption cannot catch.
 *
 * SO THE KEYS ARE THE ONES SOMETHING IS ACTUALLY SEEDED WITH, and the name is deliberately one the
 * regex does not match -- otherwise this passes on the fallback again and proves nothing.
 */
ok('the seeded acknowledgement for a person is signable by its key',
  isSignable({ seedKey: 'letter-aod-individual', name: 'Anything at all' }))
ok('...and the one for a company',
  isSignable({ seedKey: 'letter-aod-company', name: 'Anything at all' }))
/* AND THE AFFORDABILITY ASSESSMENT, which the firm added to a list they had closed twice: "we will
   call them the affordability assessment letters and build them in exactly like the
   acknowledgement of debt so that they can sign it online." */
ok('the affordability assessment is signable too',
  isSignable({ seedKey: 'letter-affordability-individual', name: 'Anything at all' })
  && isSignable({ seedKey: 'letter-affordability-company', name: 'Anything at all' }))
/* THE NAME IS THE HALF THAT STILL WORKS when the firm writes a third one for a particular client,
   which is a thing they do and which no seed key covers. */
ok('one the firm wrote themselves is signable by its name',
  isSignable({ seedKey: null, name: 'Acknowledgement of Debt - Woolworths' }))
ok('...however they cased it', isSignable({ seedKey: null, name: 'ACKNOWLEDGEMENT OF DEBT' }))

/* AND NOTHING ELSE IS. These four are the firm's own letters and every one of them was on the
   picker: each is a notice the firm SENDS, and a signature pad under one invites a debtor to sign
   a demand. */
for (const name of ['Section 129 notice', 'Final notice', 'Credit bureau listing notice',
  'Intended summons', 'Letter of demand']) {
  check(`${name} is not signed from a debtor’s file`, isSignable({ seedKey: null, name }), false)
}
/* A SEED KEY THAT IS NOT ON THE LIST DOES NOT LET A LETTER THROUGH, or the list is decoration. */
check('a seeded notice is still refused',
  isSignable({ seedKey: 'notice-s129', name: 'Section 129 notice' }), false)

/* THE PANEL ASKS THAT ONE FUNCTION rather than matching a name of its own -- written twice, the
   picker and the rule drift, and the drift shows up as a debtor signing a notice. */
ok('the picker filters on isSignable', /isSignable\(r\)/.test(panel))
ok('...imported from the rules', /isSignable[\s\S]{0,120}?from '\.\.\/\.\.\/lib\/signingRules\.ts'/.test(panel))
/*
 * AND ONLY THE HALF WRITTEN FOR THIS DEBTOR. THE FIRM: "why would you ask for the employer and for
 * the company at the same time? If you're speaking to a company, you're speaking to a company."
 * The same applies to the document itself: the library is written twice all the way down.
 */
ok('...and on the debtor in front of it',
  /r\.audience === null \|\| r\.audience === debtorKind/.test(panel))

/* ------------------------------------------------ the button */

const html = signingButtonHtml('https://raptor.example/sign/abc')
/*
 * A TABLE, AND THAT IS NOT A STYLE CHOICE. Outlook on Windows renders mail through Word, which
 * ignores padding on an anchor -- so a styled <a> is a blue line of text there, which is the exact
 * thing the firm asked to be rid of.
 */
ok('the button is a table', /<table[^>]*role="presentation"/.test(html))
ok('...with the colour on the cell', /<td[^>]*bgcolor="#0f2744"/.test(html))
ok('...and the anchor filling it', /<a href="https:\/\/raptor\.example\/sign\/abc"/.test(html))
ok('...saying what it does', /Sign the acknowledgement of debt/.test(html))
ok('...and never underlined blue', /text-decoration:none/.test(html) && /color:#ffffff/.test(html))
/*
 * AND THE ADDRESS IN PLAIN TEXT, WHICH MOVED OUT OF THE BUTTON AND INTO THE WORDS.
 *
 * It was a small grey line under the button, for a reader whose client blocks images. That reader
 * is still served -- the body is rendered into the same HTML -- and three more are now: the firm,
 * whose Emails tab files the TEXT of a message and so showed no link at all ("the email doesn't
 * send the link to the thing"); anybody forwarding it; and anybody reading the address out over
 * the telephone.
 *
 * SO THE BUTTON IS JUST THE BUTTON, and carries the address once rather than twice.
 */
check('the button carries the address once', html.split('https://raptor.example/sign/abc').length, 2)
ok('...and no longer spells it out itself', !/Or copy this address/.test(html))
ok('the words carry it instead', signingLinkLine('https://raptor.example/sign/abc')
  .includes('https://raptor.example/sign/abc'))
ok('...labelled, so it does not read as a stray string',
  /^Open the document here:/.test(signingLinkLine('https://x')))
/* AND THE PANEL PUTS IT ON THE MESSAGE, which is the half that reaches the firm's own record. */
ok('the panel appends it to the body it hands the composer',
  /signingLinkLine\(url\)/.test(panel))
/* A QUOTE IN A URL CANNOT BREAK OUT OF THE ATTRIBUTE. Tokens are base64url and carry none, which
   is a reason to be careful rather than a reason not to be: this is markup in a legal notice. */
const quoted = signingButtonHtml('https://x/sign/a"b')
ok('a quote in the address is escaped', !/href="https:\/\/x\/sign\/a"b"/.test(quoted)
  && /&quot;/.test(quoted))

/* ------------------------------------------------ what the email says */

const body = signingEmailBody('Promise Sikelele', 'RRC00004')
/*
 * SHORT, AT THE FIRM'S ASKING: "maybe make the script or the writing for the acknowledgement of
 * debt very short. That's quite a little bit long right now."
 *
 * AND SHORT FOR A REASON. Everything that matters -- the amount, the terms, what signing means --
 * is in the acknowledgement they are about to read. A covering email that explains the agreement
 * is a second version of the agreement, and the two can disagree.
 */
ok('the covering words are three lines, not a letter', body.split('\n\n').length <= 3)
ok('...addressed to the debtor', body.startsWith('Dear Promise Sikelele,'))
ok('...and carry our own reference', /RRC00004/.test(body))
/* RAPTOR'S REFERENCE, NOT THE CLIENT'S. 21% of the book shares a client reference with another
   account -- see CLAUDE.md -- so it cannot identify the file somebody telephones about. */
ok('...which is the case number', /Our reference is RRC00004/.test(body))
/* A BLANK LINE IS A PARAGRAPH, which is what emailBodyHtml splits on. Written as single newlines
   the whole message draws as one block in every mail client. */
ok('the paragraphs are blank lines', /\n\n/.test(body))
/* AND IT STILL WORKS WITH NEITHER. 19 668 of 19 912 live accounts have no identity number; a name
   and a reference are no safer a bet. */
const bare = signingEmailBody(null, null)
ok('no name still opens properly', bare.startsWith('Good day,'))
ok('...and no reference says nothing about one', !/reference/i.test(bare))

/* ------------------------------------------------ it actually goes out */

ok('issuing one hands a message to the composer', /onEmail\(\{/.test(panel))
/*
 * AND THE WORDS ARE THE FIRM'S, OUT OF THE LIBRARY.
 *
 * signingEmailBody is now the FALLBACK and nothing more. The firm has a covering email for this in
 * the Library, written twice -- once for a person and once for a company -- and they asked to be
 * able to rewrite it: "it also just writes a bunch of bullshit in the template... I'll tell you
 * what to do." A sentence hard-coded in the panel is a sentence they would have to ask somebody to
 * change, so the panel merges the library row and keeps three short lines for the day the row is
 * missing: an agreement must not fail to go out because somebody deactivated a template.
 */
ok('...in the firm’s own covering words, merged',
  /renderTemplate\(cover\.body, values\)\.text/.test(panel))
/*
 * FOUND BY THE SEED KEY, WHICH NOBODY CAN EDIT -- and there are two sets of them now, because each
 * document carries its own. A note saying "attached is an acknowledgement of debt" on a form asking
 * what somebody earns is a different document described.
 */
ok('...found by the seed key, which nobody can edit',
  /covering: \{ individual: 'email-aod-individual', company: 'email-aod-company' \}/.test(panel)
  && /individual: 'email-affordability-individual'/.test(panel))
ok('...and the one that is sent is the one for the document chosen',
  /coverings\.find\(\(r\) => r\.seedKey === doc_\.covering\[debtorKind\]\)/.test(panel))
ok('...with the short wording kept as the fallback',
  /: signingEmailBody\(debtorName, caseNumber\)/.test(panel))
ok('...and the button under it', /appendHtml: signingButtonHtml\(url\)/.test(panel))
/*
 * THE BUTTON CANNOT TRAVEL IN THE BODY. The box is prose and emailBodyHtml ESCAPES it -- which is
 * a fix that stays, because a debtor called "Smit & Seun" put a raw ampersand into the markup of a
 * legal notice. Typed into the message, a table arrives as the text of a table.
 */
ok('the composer appends it as markup', /emailBodyHtml\(body\) \+ \(appendHtml \?\? ''\)/.test(composer))
/* AFTER THE PROSE AND BEFORE THE QUOTED ORIGINAL: the button is about the words above it. */
ok('...after what was typed and before any forward',
  /emailBodyHtml\(body\) \+ \(appendHtml \?\? ''\) \+ \(quotedHtml \?\? ''\)/.test(composer))
/* AND SAID ON THE SCREEN, so nobody has to send one to find out what goes out under their words. */
ok('the box says the button is included', /appendHtml && appendNote/.test(composer))
/* THE ACCOUNT PAGE OPENS ITS OWN COMPOSER with it -- not a second send box inside the panel,
   which would be a second place that charges item 1(a) and records a sent message. */
ok('the account page carries the message into its composer',
  /appendHtml=\{signingEmail\?\.appendHtml\}/.test(account))
ok('...and addresses it to the debtor', /setComposeTo\(emailContact\?\.value \?\? ''\)/.test(account))
/*
 * AND IT IS CLEARED WITH EVERY OTHER COMPOSE STATE. Left behind, the next ordinary email to this
 * debtor carries a Sign the acknowledgement of debt button for a document sent an hour ago -- and
 * that link still works, which makes it the worst version of this bug rather than a cosmetic one.
 */
const startCompose = account.slice(account.indexOf('function startCompose()'))
ok('a fresh compose drops the signing button',
  /setSigningEmail\(null\)/.test(startCompose.slice(0, startCompose.indexOf('\n  }'))))

/* ------------------------------------------------ the fee */

/* THE BOUNDARY, CONFIRMED: exactly R50,000 falls in the HIGHER band. */
check('under R50 000 is R161', acknowledgementOfDebtFee(49999.99), 161)
check('exactly R50 000 is R209', acknowledgementOfDebtFee(50000), 209)
check('over it is R209', acknowledgementOfDebtFee(125000), 209)
check('a nil claim is still the lower band', acknowledgementOfDebtFee(0), 161)
/* ONE PIECE OF ARITHMETIC. The engine resolves the band through the same function the fee helper
   does -- written twice, the statement and the quote eventually disagree about one boundary. */
check('the band arithmetic is shared', bandAmount([{ below: 50000, amount: 161 }, { amount: 209 }], 50000), 209)

const schedule = scheduleFor('2026-10-01')
const item4a = schedule.items.find((i) => i.id === '4a')
/*
 * ITEM 4(a) HAS NO SINGLE AMOUNT IN THE ANNEXURE, and that is the bug this fixed: the engine read
 * `amount` and got null, charged nought, and wrote an unbilled row for an acknowledgement of debt.
 */
check('item 4(a) names no single figure', item4a.amount, null)
check('...and has bands instead', item4a.bandedAmounts.length, 2)
check('one unit, told the claim, is the band', unitAmountFor(item4a, 60000), 209)
/* NULL RATHER THAN ZERO WHERE NOTHING SAYS WHAT THE DEBT IS. A zero reads as "this is free",
   which for item 1(b) -- a registered letter under section 57 -- is the wrong thing to print. */
check('...and null where nobody said', unitAmountFor(item4a, undefined), null)
check('an unpriced item stays unpriced',
  unitAmountFor(schedule.items.find((i) => i.id === '1b'), 60000), null)

check('the engine prices it off the claim', itemAmountFor('4a', 1, 0, schedule, 60000), 209)
check('...and the lower band under R50 000', itemAmountFor('4a', 1, 0, schedule, 1000), 161)
/* UNCHANGED FOR EVERY OTHER ITEM, which is forty existing callers that pass no claim at all. */
check('an email is still R25 with no claim named', itemAmountFor('1a', 1, 0, schedule), 25)
check('...and with one', itemAmountFor('1a', 1, 0, schedule, 999999), 25)

ok('the claim is carried through the engine', /debtAmount\?: number/.test(engine))
ok('...into the arithmetic', /itemAmountFor\(input\.itemId, quantity, spentOnItem, schedule, input\.debtAmount\)/.test(engine))
ok('there is one helper that charges it', /export async function chargeAcknowledgementOfDebt/.test(charges))
ok('...under item 4(a)', /ACKNOWLEDGEMENT_OF_DEBT_ITEM_ID = '4a'/.test(charges))
ok('...on the firm’s own action code', /actionCode: 'acknowledgement_of_debt'/.test(charges))
ok('...banded on the claim handed in', /debtAmount: input\.claimAmount/.test(charges))
/* NEVER THROWS: the document has been issued and the link is in somebody's hands. A fee that will
   not write is something to report afterwards, not a reason to pretend nothing was sent. */
ok('...and a fee that will not write never undoes the issue', /\[aod\] the document was issued/.test(charges))

/* RAISED ON ISSUE. The gazette pays for the instrument AND "the necessary consultation", both of
   which have happened by the time the link exists -- and the firm said "the moment that thing is
   issued". A debtor who reads it and refuses has still had the consultation. */
ok('the panel charges when it issues one', /chargeAcknowledgementOfDebt\(\{/.test(panel))
ok('...off the claim the document states', /claimAmount=\{statement\?\.breakdown\?\.balance \?\? null\}/.test(account))
/*
 * AND IT IS SAID ON THE SCREEN, in three different sentences for three different facts: it
 * charged, a cap left nothing, or there was no claim figure to band it on. The last one is the
 * firm's to notice -- it means the fee has to be raised by hand.
 */
ok('what it charged is on the screen', /under item 4\(a\)/.test(panel))
ok('...and a cap is said apart from a missing claim',
  /a cap left no room/.test(panel) && /could not be decided/.test(panel))
/* NOTHING IS CHARGED ON A GUESS. No claim figure, no fee: a band guessed at is a fee the firm
   cannot defend when a debtor's attorney asks which one applied. */
ok('no claim means no charge',
  /claimAmount === null\) \? null\s*\n\s*: await chargeAcknowledgementOfDebt/.test(panel))
/*
 * AND NOTHING IS CHARGED ON THE FORM AT ALL.
 *
 * Item 4(a) prices the DRAWING of an acknowledgement of debt, banded on the claim, and it runs to
 * hundreds of rand. An affordability assessment is a set of questions: nothing is drafted and
 * nothing is acknowledged. A debtor charged 4(a) for a questionnaire is a wrong charge on a
 * statement the firm has to be able to defend, and it is one line of code away.
 */
ok('the affordability assessment raises nothing',
  /charges: false,[\s\S]{0,160}noun: 'affordability assessment'/.test(panel)
  && /!doc_\.charges \|\| claimAmount === null/.test(panel))

if (failures.length > 0) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-signing-email: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length > 0 ? 1 : 0)
