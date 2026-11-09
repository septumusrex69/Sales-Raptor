/**
 * S17's three compose problems (Stephan, 5 Nov), held (S21 · Raptor H19).
 *
 *   1. "I try to add Rinda ... multiple people to CC" -- the Cc line takes several people, and the firm's own
 *      people are found by name.
 *   2. "the thing where I was writing was going down" -- on an iPad the dialog is pinned to what the keyboard
 *      leaves on screen.
 *   3. "show me the email signature that I uploaded ... how it will look relative to the text" -- the compose
 *      box draws the signature with the send's own functions.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-compose-cc-signature.mjs
 */
import { readFileSync } from 'node:fs'
import {
  isRecipient, joinRecipientLine, normaliseRecipients, notAddresses, recipientList, splitRecipientLine, suggestRecipients,
} from '../../src/lib/recipientSuggest.ts'
import { composeBody, signatureHtml } from '../../src/lib/emailSignature.ts'
import * as served from '../../api/_lib/signature.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
/* Comments out, so a rule is held by the code and not by the sentence explaining it. */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/* ---------- 1. several people on the Cc line ---------- */

check('a line reads as its addresses', recipientList('a@x.co.za, b@y.co.za; c@z.com').join('|'), 'a@x.co.za|b@y.co.za|c@z.com')
check('...each once, whatever the case', recipientList('A@x.co.za, a@X.co.za').join('|'), 'A@x.co.za')
check('...and blanks are not people', recipientList(' , ,a@x.co.za, ').join('|'), 'a@x.co.za')
const line = splitRecipientLine('a@x.co.za, b@y.co.za, rin')
check('the last piece is what is being typed', line.draft, 'rin')
check('...and the rest are chosen', line.chosen.join('|'), 'a@x.co.za|b@y.co.za')
check('a trailing comma is a finished line and an empty box', splitRecipientLine('a@x.co.za, ').draft, '')
check('...and it goes back the way it came', joinRecipientLine(['a@x.co.za', 'b@y.co.za'], 'rin'), 'a@x.co.za, b@y.co.za, rin')
check('...a line of one is the address alone', joinRecipientLine([], 'a@x.co.za'), 'a@x.co.za')
check('what is sent has no trailing comma', normaliseRecipients('a@x.co.za, b@y.co.za, '), 'a@x.co.za, b@y.co.za')
check('...and an empty line sends nothing', normaliseRecipients(' , '), '')
check('half a name is named before it goes', notAddresses('a@x.co.za, rinda').join('|'), 'rinda')
check('...and a line of addresses has nothing to name', notAddresses('a@x.co.za; b@y.co.za').length, 0)
/* Stephan, 9 Nov: "I try to add Nicholas and Camille ... it keeps removing one." A reply-all writes "Name <address>". */
check('a reply-all\'s "Name <address>" is a person, not a mistake', notAddresses('Stephan <stephan@x.co.za>, Camille <camille@x.co.za>').length, 0)
check('...and is a finished entry', isRecipient(' Camille <camille@x.co.za> '), true)
check('...while half a name still is not', isRecipient('Camille <camille@'), false)

/* A colleague is found by her NAME from the first letters -- and is not thrown at an empty box. */
const all = [
  { address: 'r.roos@bredellferreira.co.za', name: 'Rinda Roos', uses: 0, lastUsed: null, colleague: true },
  { address: 'accounts@client.co.za', name: null, uses: 40, lastUsed: null },
]
check('"rin" finds Rinda by her name', suggestRecipients(all, 'rin')[0]?.address, 'r.roos@bredellferreira.co.za')
check('...and an empty box offers no colleague', suggestRecipients(all, '').length, 0)

const field = code('../../src/components/RecipientField.tsx')
ok('the field has a several-people mode', /multiple\?: boolean/.test(field))
ok('...drawn as chips, each with its own X', /data-testid="recipient-chip"/.test(field) && /aria-label=\{`Take \$\{a\} off`\}/.test(field))
ok('...picking somebody ADDS them rather than replacing the line', /onChange\(joinRecipientLine\(\[\.\.\.finished\(\), s\.address\]\)\)/.test(field))
ok('...counting a pre-filled person left last on the line as chosen', /return isRecipient\(draft\) \? \[\.\.\.chosen, draft\.trim\(\)\] : chosen/.test(field))
ok('...and making them a chip the moment the box takes focus', /if \(multiple\) commitDraft\(\)/.test(field))
ok('...a comma finishes an address', /\[,;\]\\s\*\$/.test(field))
ok('...Backspace in an empty box takes the last one off', /e\.key === 'Backspace' && query === '' && line\.chosen\.length > 0/.test(field))
ok('...leaving the box keeps a finished address', /onBlur=\{\(\) => \{ setFocused\(false\); commitDraft\(\) \}\}/.test(field))
ok('...nobody on the line is offered again', /for \(const c of line\.chosen\) seen\.add/.test(field))
ok('...and the box is text, not one browser "email"', /type=\{multiple \? 'text' : 'email'\}/.test(field))
ok('a colleague is never offered the X', /!s\.onRecord && !s\.colleague && \(/.test(field))

const compose = code('../../src/components/ComposeEmailModal.tsx')
ok('the Cc line is the several-people box', /<RecipientField multiple value=\{cc\}/.test(compose))
ok('...and both lines know the firm\'s people', (compose.match(/colleagues=\{colleagues\}/g) ?? []).length === 2)
ok('...the active ones, never the writer', /u\.status === 'Active' && !!u\.email && u\.id !== currentUser\?\.id/.test(compose))
ok('Send names a Cc that is not an address', /const badCc = notAddresses\(cc\)/.test(compose)
  && compose.indexOf('const badCc') < compose.indexOf('setSubmitting(true)'))
ok('...and sends each address once', /cc: normaliseRecipients\(cc\)/.test(compose))
/* The route hands the string to nodemailer unchanged, and nodemailer takes a comma-separated Cc. */
ok('the route still passes the Cc through whole', /\.\.\.\(message\.cc && message\.cc\.trim\(\) \? \{ cc: message\.cc \} : \{\}\)/.test(read('../../api/_lib/email/sendAsUser.ts')))

/* ---------- 2. the iPad keyboard ---------- */

const modal = code('../../src/components/ui/Modal.tsx')
ok('the dialog reads the visual viewport', /window\.visualViewport/.test(modal) && /v\.addEventListener\('resize', update\)/.test(modal))
ok('...and follows its scroll too', /v\.addEventListener\('scroll', update\)/.test(modal))
ok('...pins the overlay to it while the keyboard is up', /top: keyboard\.top, height: keyboard\.height/.test(modal))
ok('...and fits the card inside it', /maxHeight: keyboard\.height - 32/.test(modal))
ok('...and leaves a desktop alone (no keyboard, no change)', /window\.innerHeight - v\.height > 120/.test(modal))

/* ---------- 3. the signature, as it goes out ---------- */

ok('the server re-exports the screen\'s functions', /export \{ SIGNATURE_CID, composeBody, signatureHtml, type SignatureImage \} from '\.\.\/\.\.\/src\/lib\/emailSignature\.js'/.test(read('../../api/_lib/signature.ts')))
check('...so the two are ONE function, not two copies', served.signatureHtml, signatureHtml)
check('...and one composeBody', served.composeBody, composeBody)
ok('the send still calls them', /composeBody\(message\.bodyHtml, signatureHtml\(signatureText, image, imageSrc\), emailStyle\)/.test(read('../../api/_lib/email/sendAsUser.ts')))
ok('the signature is drawn with the same three', /signatureHtml\(user\?\.emailSignature/.test(compose)
  && /composeBody\('', signature, style\)/.test(compose) && /emailBodyStyle\(firm\)/.test(compose))
/* Stephan, 9 Nov: "just make it part of the email. It's not necessary to have like a separate box for that." */
ok('...INSIDE the message box, under the text', compose.indexOf('data-testid="message-box"') > 0
  && compose.indexOf('<SignatureInline user={currentUser} firm={firm} />') > compose.indexOf('data-testid="message-box"'))
ok('...with no label and no preview panel of its own', !/How the email ends/.test(compose) && !/SignaturePreview/.test(compose))
ok('...sandboxed, so stored HTML never runs', /sandbox="allow-same-origin"/.test(compose) && !/allow-scripts/.test(compose))
ok('...and under the original on a forward', /\{quotedHtml && <SignatureInline user=\{currentUser\} firm=\{firm\} afterOriginal \/>\}/.test(compose))
/* The gap the send puts between the message and the signature is the preview's gap: composeBody's own. */
check('composeBody leaves two breaks before the signature', composeBody('Body', 'Sig'), 'Body<br><br>Sig')

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
The Cc line takes several people and finds colleagues by name; Send names a Cc that is not an address and
sends each once. On an iPad the dialog stays on the part of the screen the keyboard leaves. And the signature
under the box is drawn by the send's own functions -- one composeBody, not a copy.`)
