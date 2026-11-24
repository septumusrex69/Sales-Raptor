/**
 * A REPLY THE WAY OUTLOOK DOES IT, AND THE CONVERSATION UNDER THE MESSAGE (S22 · Raptor H20, 18 Nov).
 *
 * Stephan, answering a client's corrections table: "If I open an email and I scroll down, I want to see all relevant
 * emails pertaining to that email ... I can't respond and edit something on the response ... Can you do it like
 * Outlook, please?"
 *
 * Held here: the reply carries the original underneath under Outlook's header, in the editable box a forward uses
 * (mailbox and account page alike); the signature lands between the note and the quote, not under the chain; the
 * open message has the rest of its trail stacked beneath it; and the corrections table no longer squeezes its short
 * columns to a letter wide.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-outlook-reply.mjs
 */
import { readFileSync } from 'node:fs'
import { replyQuoteHtml } from '../../src/lib/emailRules.ts'
import { composeBody, QUOTE_MARK } from '../../src/lib/emailSignature.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

/* ---------------- the quote ---------------- */
const q = replyQuoteHtml({
  fromName: 'Smit & Seun', fromAddress: 'accounts@smit.co.za', subject: 'Re: Handover corrections',
  occurredAt: '2026-11-18T08:30:00Z', to: ['stephan@firm.example'], cc: ['rinda@firm.example', ''],
}, '<table><tr><td>DCR2181</td></tr></table>')
ok('Outlook’s header: From, Sent, To, Cc, Subject, in that order',
  /From:<\/b> Smit &amp; Seun &lt;accounts@smit\.co\.za&gt;[\s\S]*Sent:<\/b>[\s\S]*To:<\/b> stephan@firm\.example[\s\S]*Cc:<\/b> rinda@firm\.example<br>[\s\S]*Subject:<\/b> Re: Handover corrections/.test(q))
ok('the sender’s name is escaped', !/Smit & Seun/.test(q))
ok('the original rides underneath as itself -- the table, not its text', /<table><tr><td>DCR2181<\/td><\/tr><\/table>/.test(q))
ok('no "> " chevrons: nothing is pasted into the box', !/&gt; |^> /m.test(q.replace(/&lt;accounts@smit\.co\.za&gt;/, '')))
ok('an empty Cc says nothing rather than "Cc:" alone',
  !/Cc:/.test(replyQuoteHtml({ fromName: null, fromAddress: 'a@b.co', subject: null, occurredAt: '2026-11-18T08:30:00Z' }, 'x')))

/* ---------------- the signature, between the note and the quote ---------------- */
check('with a quote, the signature goes in front of it',
  composeBody(`<p>Hi</p>${QUOTE_MARK}<div>original</div>`, '<b>SIG</b>'), `<p>Hi</p><br><br><b>SIG</b>${QUOTE_MARK}<div>original</div>`)
check('without one, at the end as before', composeBody('<p>Hi</p>', '<b>SIG</b>'), '<p>Hi</p><br><br><b>SIG</b>')
check('no signature, no change', composeBody(`<p>Hi</p>${QUOTE_MARK}<div>o</div>`, ''), `<p>Hi</p>${QUOTE_MARK}<div>o</div>`)
ok('the mark is an HTML comment, so a mail reader draws nothing for it', /^<!--[\s\S]*-->$/.test(QUOTE_MARK))

const compose = read('src/components/ComposeEmailModal.tsx')
ok('the compose box sends the mark in front of the quote',
  /\+ \(quotedHtml \? QUOTE_MARK \+ \(quoteRef\.current\?\.innerHTML \?\? quotedHtml\) : ''\)/.test(compose))
ok('...and shows the signature above it, not after the original', !/afterOriginal \/>/.test(compose))
ok('a reply needs something typed or the original edited -- an untouched reply is refused',
  /\(!body\.trim\(\) && \(!quotedHtml \|\| \(quoteKind === 'reply' && quoteTick === 0\)\)\) \? 'a message'/.test(compose))
ok('a reply is not titled "Forward"', /quotedHtml && quoteKind === 'forward' \? 'Forward'/.test(compose))

/* ---------------- the two places a reply is written ---------------- */
const mail = read('src/pages/mail/MailPage.tsx')
const replyBox = mail.slice(mail.indexOf('{replying && ('), mail.indexOf('onClose={() => setReplying(null)}'))
ok('the mailbox reply quotes the original, editable', /quoteKind="reply"/.test(replyBox) && /quotedHtml=\{replyQuote/.test(replyBox))
ok('...no longer the read-only text', !/quoted=\{bodies\[replying\.id\]/.test(replyBox))
ok('...somebody else’s markup cleaned first', /replyQuoteHtml\(\{[\s\S]*?sanitizeEmailFragment\(html, \{ images, showPictures: true \}\)\.html/.test(mail))
const account = read('src/pages/accounts/AccountDetail.tsx')
ok('the account page reply quotes it too, under the same header',
  /replyTo && !forwardOf && !signingEmail && !simulation \? \{\s*quoteKind: 'reply' as const,\s*quotedHtml: replyQuoteHtml\(/.test(account))

/* ---------------- the conversation under the open message ---------------- */
ok('the open message has the rest of its trail beneath it', /below=\{currentUser \? \(\s*<ConversationBelow/.test(mail))
ok('...drawn before the floating bar', mail.indexOf('{below}') > 0 && mail.indexOf('{below}') < mail.lastIndexOf('{sticky && <MessageActions {...bar} />}'))
ok('...by the same rule as the list’s conversations', /const \{ trail, loading \} = useConversationTrail\(mail, onPage, userId, mine\)/.test(mail))
ok('...each body through the reading pane’s sanitiser, pictures held back',
  /sanitizeEmailHtml\(full\.html, \{ images: full\.images, showPictures: false \}\)/.test(mail))
const trail = read('src/components/email/ConversationTrail.tsx')
ok('the strip above uses the same hook', /export function useConversationTrail\(/.test(trail) && /= useConversationTrail\(mail, onPage, userId, mine\)/.test(trail))

/* ---------------- the corrections table ---------------- */
const corr = read('src/lib/importCorrections.ts')
ok('Debtor and Field stay on one line', /white-space:nowrap">Debtor<\/th>/.test(corr) && /white-space:nowrap">Field<\/th>/.test(corr))
ok('...and the explanation is given a width to wrap in', /<th width="260"[^>]*>What we need<\/th>/.test(corr))

if (failures.length > 0) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-outlook-reply: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length > 0 ? 1 : 0)
