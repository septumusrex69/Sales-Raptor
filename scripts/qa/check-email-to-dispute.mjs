/**
 * AN EMAIL AND THE DISPUTE IT BELONGS TO.
 *
 * THE FIRM, WORKING THROUGH THEIR OWN SEQUENCE OUT LOUD: "if, for example, the debtor disputes
 * something and says he has a dispute and they say that they're going to email it, then the
 * moment that the email comes, you can say, link it to a current dispute and then you can choose
 * the dispute that is there available. Then it's that email and they need to automatically know
 * that we've received the dispute. ... you should be able to decide what to do with it as well.
 * Maybe you don't want to escalate it. Maybe you can resolve it yourself."
 *
 * FOUR THINGS WOULD GO WRONG SILENTLY AND THIS HOLDS THEM:
 *
 *   - A SECOND TICKET FOR ONE OBJECTION. Pressing "this is a dispute" on an account that already
 *     has one open used to raise a second, which `one_open_dispute_per_account` refuses -- after
 *     item 3 had been charged for it. The link path exists so the honest answer is reachable.
 *   - THE DEBTOR PAYING TWICE. Item 3 is raised when the dispute is raised. A debtor whose
 *     objection arrives on the telephone first and in the post afterwards must not pay again for
 *     the post.
 *   - A DISPUTE THAT NEVER BECOMES WRITTEN. `received_on` and `in_writing` are what
 *     workflow_start_on_dispute reads to end the invitation and start the real sequence -- and
 *     what stops the collection ones. Nothing reached them from an email until now.
 *   - A BARE TICKET. The buttons raised a dispute with no classification, no dictated issue,
 *     nobody's name on it and no chase date. The firm asked for the box instead.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-email-to-dispute.mjs
 */
import { readFileSync } from 'node:fs'
import { ESCALATION_KINDS, ESCALATION_KIND_ORDER, escalationCard } from '../../src/lib/disputeCategories.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(--|\/\/).*$/gm, '')

const api = code('api/_lib/email/ticket.ts')
const modal = code('src/pages/accounts/EscalateModal.tsx')
const detail = code('src/pages/accounts/AccountDetail.tsx')
const board = code('src/pages/accounts/DisputesBoard.tsx')
const panel = code('src/pages/accounts/QueryPanel.tsx')
const mailLib = code('src/lib/userMail.ts')
const sql = read('supabase/schema.sql')

/* ---------------- linking, rather than raising a second ---------------- */

ok('the endpoint takes a ticket to add the email to', /const queryId = typeof body\.queryId === 'string'/.test(api))
/* THE THREE WAYS A DEBTOR'S LETTER ENDS UP SOMEWHERE IT DOES NOT BELONG. Each is refused with a
   sentence, because the caller picked from a list and a bare "no" reads as a broken screen. */
ok('...refusing one on a different account', /open\.account_id !== accountId/.test(api))
ok('...one that has been answered', /open\.status === 'closed'/.test(api))
ok('...and one that is not there', /'That ticket no longer exists\.'/.test(api))

/*
 * AND THE DISPUTE IS NOW IN WRITING. This is the whole point of the link: `received_on` and
 * `in_writing` are what workflow_start_on_dispute reads.
 */
ok('linking an email marks the dispute received in writing',
  /received_on: today, in_writing: true/.test(api))
/* ONLY WHERE IT WAS NOT ALREADY. Writing the same values again changes nothing in the database --
   the trigger guards on the OLD row -- but it would put a second "received in writing" line on
   the timeline for an email that only confirmed what we had. */
ok('...only where it was not already',
  /nowInWriting = open\.kind === 'dispute'\s*\n?\s*&& !open\.in_writing && !open\.received_on/.test(api))
/* A REQUEST IS NOT A DISPUTE AND HAS NO SUCH STATE. */
ok('...and never on a request', /open\.kind === 'dispute'/.test(api))

/*
 * THE TRIGGER IS WHAT MAKES THAT UPDATE MEAN ANYTHING, and it has to fire on an UPDATE of those
 * two columns -- an insert-only trigger would leave a verbal dispute verbal for ever.
 *
 * READ THE LAST DEFINITION: schema.sql is append-only, so an earlier copy is the superseded one.
 */
const trigAt = sql.lastIndexOf('create trigger workflow_start_on_dispute')
ok('the dispute trigger exists', trigAt > 0)
ok('...and fires on an update of exactly those two columns',
  /after insert or update of in_writing, received_on on public\.account_queries/
    .test(sql.slice(trigAt, trigAt + 300)))

/* ---------------- and the debtor does not pay twice ---------------- */

ok('nothing is charged on the link path', /if \(!queryId && escalationChargeable\(kind\)\)/.test(api))
/* THE TIMELINE SAYS WHICH HAPPENED. On a link nothing was raised -- an email was filed against
   something that existed -- and where that email stopped the collection sequences, the history
   has to say so or nobody reading it tomorrow can tell why they stopped. */
ok('the note says the dispute was received in writing',
  /The dispute was received in writing by email/.test(api))
ok('...and says only that an email was filed where nothing changed',
  /An email was filed against this/.test(api))

/* ---------------- the buttons open the box ---------------- */

ok('the account hands the message to the Escalate box',
  /setClassifying\(\{ email: e, kind: k \}\)/.test(detail))
ok('...with the ticket it could be added to', /openQueries=\{queries\}/.test(detail))
ok('...and which button was pressed', /initialKind=\{classifying\.kind\}/.test(detail))

/* PREFILLED, BECAUSE THE RETYPE IS WHERE DISPUTES GET MIS-RECORDED. */
ok('the box opens on the email’s own words', /const written = \(fromEmail\.body \?\? ''\)/.test(modal))
ok('...capped the same way the endpoint caps', /written\.length > 4000/.test(modal))

/*
 * ON A DISPUTE IT DEFAULTS TO THE OPEN ONE. `one_open_dispute_per_account` refuses a second, so
 * "this is a dispute" on an account that already has one can only mean the writing has arrived --
 * and a box that opened on "raise a new one" would open on the option the database refuses.
 */
ok('a dispute off an email defaults to the one already open',
  /initialKind === 'dispute' && openDispute \? `link:\$\{openDispute\.id\}` : 'new'/.test(modal))

/* ONLY THE TWO THINGS THAT CAN ARRIVE IN AN EMAIL. A decision and a litigation recommendation are
   things somebody DECIDES -- the endpoint refuses them, so offering them would be a button that
   fails after the words have been typed. */
ok('only a dispute or a request is offered on an email',
  /fromEmail \? ESCALATION_KIND_ORDER\.filter\(\(k\) => k === 'dispute' \|\| k === 'request'\)/.test(modal))

/* AN EMAIL IS THE WRITING. Asking "how did it reach us?" there is asking somebody to confirm what
   they are looking at. */
ok('the box does not ask how it reached us', /kind === 'dispute' && !fromEmail && \(/.test(modal))

/* ---------------- escalate it, or keep it ---------------- */

ok('the box asks what happens to it now', /const askKeepOrEscalate = /.test(modal))
/* KEEPING IT MEANS IT IS YOURS, NOT NOBODY'S. nav_counts reads owner_id, so an unassigned ticket
   is counted on nobody's badge -- which is how the firm came to say "requests don't show up at
   the liaison". */
ok('...and keeping it puts your own name on it',
  /const ownerId = keepIt \? \(actor\.id \?\? null\) : \(toId \|\| ''\)|const ownerId = keepIt \? \(actor\.id \?\? null\) : \(toId \|\| null\)/.test(modal))
ok('...and it warns when nobody is on it at all',
  /\{!ownerId && \(/.test(modal))
/* IT DOES NOT PRETEND KEEPING IT IS THE QUIET OPTION: a written dispute has stopped collecting
   either way, and the line says so. */
ok('...saying collection stops either way',
  /the collection sequences stop until the dispute is answered/.test(modal))

/* A TICKET SOMEBODY IS HOLDING DOES NOT CHANGE HANDS BECAUSE AN EMAIL ARRIVED ON IT. */
ok('an owner already on the ticket is left alone',
  /ownerId: linkedTo && linkedTo\.ownerId \? null : ownerId/.test(modal))

/* ---------------- and a request is not "For litigation" ---------------- */

/*
 * THE CHAIN WITH A FALLBACK, ON THREE SCREENS. The board drew its chip with
 * `kind === 'help' ? 'Team leader asked' : 'For litigation'`, so the day `request` was added every
 * request on the board announced itself as a recommendation to sue -- and so did every import
 * correction. A record cannot fall through.
 */
for (const k of [...ESCALATION_KIND_ORDER, 'import']) {
  ok(`${k} has words of its own`, typeof ESCALATION_KINDS[k].cardLabel === 'string' && ESCALATION_KINDS[k].cardLabel.length > 0)
  ok(`...and a tint of its own`, typeof ESCALATION_KINDS[k].cardTint === 'string' && ESCALATION_KINDS[k].cardTint.length > 0)
}
check('a request says so', escalationCard('request').label, 'Request')
check('...and is not told it is for litigation', escalationCard('request').label === 'For litigation', false)
check('an import correction says so too', escalationCard('import').label, 'Client data')
/* EVERYTHING RAISED BEFORE THE KIND COLUMN EXISTED READS AS A DISPUTE, which is what it was --
   and it has to agree with clientSection, which already reads a null that way. */
check('a row with no kind reads as the dispute it was', escalationCard(null).label, 'Dispute')

/* NO TWO KINDS WEAR THE SAME TINT, or the colour says nothing. The firm asked for it: "a request
   and a dispute looks exactly the same. Maybe there should be different colors." */
const tints = [...ESCALATION_KIND_ORDER, 'import'].map((k) => ESCALATION_KINDS[k].cardTint)
check('every kind is a different colour', new Set(tints).size, tints.length)

/* AND ALL THREE SCREENS READ IT FROM THERE, rather than each keeping its own chain. */
ok('the board’s cards read the kind’s own words', /escalationCard\(q\.kind\)\.label/.test(board))
ok('...and its list does too', (board.match(/escalationCard\(q\.kind\)/g) ?? []).length >= 4)
ok('the account’s own panel reads them as well', /escalationCard\(q\.kind\)\.label/.test(panel))
ok('...and none of them still has a fallback chain',
  !/'For litigation'/.test(board) && !/'For litigation'/.test(panel))

/* ---------------- the client's half of the call ---------------- */

ok('the browser can hand the endpoint a ticket to link to', /queryId: input\.queryId \?\? null/.test(mailLib))
ok('...and hears back whether that made it written', /nowInWriting: !!body\.nowInWriting/.test(mailLib))

console.log(`\ncheck-email-to-dispute: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
