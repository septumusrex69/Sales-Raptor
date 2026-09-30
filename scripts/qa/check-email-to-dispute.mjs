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
  /nowInWriting = !open\.in_writing && !open\.received_on/.test(api))
/*
 * IT USED TO SAY `open.kind === 'dispute' && ...` HERE, and that clause is gone because the guard
 * above it is stronger: a request can no longer be linked at all, so a linked ticket is a dispute
 * by construction. Asserted as the guard rather than as the clause -- a check that kept insisting
 * on the clause would be holding a belt whose braces do more work.
 */
ok('...and never on a request, because one cannot be linked',
  /open\.kind !== 'dispute'/.test(api))

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

/*
 * AND THE EMAIL'S OWN WORDS ARE ON THE SCREEN, beside the box rather than in it.
 *
 * IT USED TO PREFILL THE BOX, on the argument that "the retype is where disputes get
 * mis-recorded". That argument was right about the risk and wrong about the cure: what it
 * produced was not a careful record but the quoted thread as a summary, with the agent's own
 * reading of it written nowhere. The firm sent it back. See the description assertions below.
 */
ok('what the email said is shown while the note is written',
  /const emailWords = fromEmail/.test(modal))
ok('...falling back to the subject on a message with no text',
  /\(fromEmail\.subject \?\? ''\)\.trim\(\)/.test(modal))

/*
 * ON A DISPUTE IT DEFAULTS TO THE OPEN ONE. `one_open_dispute_per_account` refuses a second, so
 * "this is a dispute" on an account that already has one can only mean the writing has arrived --
 * and a box that opened on "raise a new one" would open on the option the database refuses.
 */
ok('a dispute off an email defaults to the one already open',
  /initialKind === 'dispute' && openDispute \? `link:\$\{openDispute\.id\}` : 'new'/.test(modal))

/*
 * ONLY THE TWO THINGS THAT CAN ARRIVE IN AN EMAIL. A decision and a litigation recommendation are
 * things somebody DECIDES -- the endpoint refuses them, so offering them would be a button that
 * fails after the words have been typed.
 *
 * THE RULE IS UNCHANGED AND THE MECHANISM IS NOT. It used to be a filter on the ladder, which
 * meant the box re-asked, as a radio pair, the question the button on the message had just
 * answered -- the firm: "these two buttons take you to the same page." Off an email the ladder is
 * now HIDDEN and the kind is stated, with one link to the other of the two. So the guarantee comes
 * from two facts instead of one filter, and both are held here.
 */
ok('the ladder is not offered on an email at all',
  /\$\{linkedTo \|\| fromEmail \? 'hidden' : ''\}/.test(modal))
ok('...so what it opens on is whichever button was pressed',
  /fromEmail && initialKind \? initialKind :/.test(modal))
/* AND THE ONE WAY TO CHANGE IT GOES BETWEEN EXACTLY THOSE TWO. Anything else here would be a
   third kind reachable off an email, which is the thing the endpoint refuses. */
ok('...and the only way to change it is between those two',
  /const other = kind === 'dispute' \? 'request' : 'dispute'/.test(modal))
/* THE MESSAGE ITSELF STILL OFFERS ONLY THOSE TWO, which is where the kind comes from. */
ok('...as are the buttons on the message',
  /onClassify\(email, 'dispute'\)/.test(read('src/pages/accounts/EmailsPanel.tsx'))
  && /onClassify\(email, 'request'\)/.test(read('src/pages/accounts/EmailsPanel.tsx'))
  && !/onClassify\(email, '(help|litigation|import)'\)/.test(read('src/pages/accounts/EmailsPanel.tsx')))

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

/* ---------------- and a request is not a dispute, on either side of the wire -------------- */

/*
 * THE FIRM: "it should be able to link to an open dispute for sure, but it should not be able to
 * link to an open query, like an open information request, because an information request is an
 * internal thing... it just creates the complexity of the dispute handling procedure much worse."
 *
 * THE OLD BEHAVIOUR WAS WORSE THAN CONFUSING. The box offered every open ticket of either kind, so
 * on an account with two requests open and no dispute, "This is a dispute" showed two options both
 * reading "Add it to the open request" -- which is exactly what the firm hit and described as not
 * being asked WHICH dispute. And the endpoint ACCEPTED it: ticketKind followed the ticket, so a
 * debtor's written dispute was filed as "an email was filed against this request". No dispute
 * recorded, in_writing never set, workflow_start_on_dispute never fired, item 3 never raised, and
 * the collection sequences still running against a debt the debtor had disputed in writing.
 */
ok('the box offers only an open dispute to link to',
  /openQueries\.filter\(\(q\) => q\.status !== 'closed' && q\.kind === 'dispute'\)/.test(modal))
ok('...and says so in the question it asks', /Is this about the open dispute\?/.test(modal))
/* NO REQUEST WORDING LEFT ON THE LINK PATH, or the screen still offers what the server refuses. */
ok('...with no "add it to the open request" left anywhere',
  !/Add it to the open \{q\.kind/.test(modal) && !/Add it to the open request/.test(modal))

/*
 * AND THE ENDPOINT REFUSES IT, which is where the rule belongs. A filter in a browser is a
 * convenience; anything that writes a debtor's dispute has to be guarded where it is written.
 */
ok('the endpoint refuses a request as the target', /open\.kind !== 'dispute'/.test(api))
ok('...saying why, and what to do instead',
  /cannot be added to an information request[\s\S]{0,120}?Raise a dispute from it instead/.test(read('api/_lib/email/ticket.ts')))
/*
 * THE BRANCH THAT FOLLOWED THE TICKET'S OWN KIND IS GONE. It is the line that turned a dispute
 * into a request, and a guard above it is worth nothing if the assignment below still reaches for
 * whatever the row happened to say.
 */
ok('a linked ticket is a dispute by construction', /ticketKind = 'dispute'/.test(api))
ok('...not whatever the row happened to say',
  !/ticketKind = open\.kind === 'request'/.test(api))

/* ---------------- the ticket's description is the agent's note, not the email ------------- */

/*
 * THE FIRM: "it asks you about the nature of the dispute, but there's no way and no place to make
 * a note. So the email now goes into the description, whereas the email should come to the ticket
 * in another form. The note should be something mandatory made by the clerk raising the dispute,
 * to give more of a description of what is actually happening."
 *
 * THE BOX WAS DECORATIVE ON THIS PATH. It opened pre-filled with the email body, and whatever was
 * typed over it was thrown away -- raiseTicketFromEmail never sent a description and the endpoint
 * built its own out of `mail.body`. So every dispute raised from an email carried forty lines of
 * quoted thread as its summary, clamped to two lines on the liaison's board, and the one person
 * who had actually read the email wrote nothing down.
 *
 * WHAT THE DEBTOR WROTE IS NOT WHAT IT MEANS. "I want to dispute the account" is the email; "says
 * the vehicle went back in March and he has the collection note" is what a liaison has to answer.
 */
ok('the box no longer opens full of the email', /const \[description, setDescription\] = useState\(''\)/.test(modal))
ok('...and the email is shown beside it instead', /What they wrote/.test(modal))
ok('...read-only, so the summary cannot become the thread again',
  /emailWords[\s\S]{0,400}?whitespace-pre-wrap/.test(modal))
ok('...asking for the agent\u2019s own words', /What is the issue, in your words\?/.test(modal))

/* IT TRAVELS NOW. The assertion that the box is empty is worth nothing if what is typed in it
   still goes nowhere. */
ok('the note is sent with the ticket', /description: description\.trim\(\)/.test(modal))
ok('...carried by the client', /description: input\.description/.test(mailLib))
ok('...and stored by the endpoint', /const description = written\.length > 4000/.test(api))

/*
 * AND THE EMAIL BODY IS NOT A FALLBACK. That is how the old behaviour comes back one quiet
 * afternoon -- a caller that forgets the field, and the description silently becomes the thread.
 */
ok('the email body is no longer a description', !/mail\.body \?\? ''\)\.replace/.test(api))
ok('...and an empty note is refused rather than defaulted',
  /!queryId && !description/.test(api))
/* ON THE RAISE PATH ONLY: linking an email to an open dispute needs no new summary, because that
   ticket already has one. */
ok('...except when adding to a ticket that already has one', /Only where a ticket is being RAISED/.test(read('api/_lib/email/ticket.ts')))

/* AND THE SCREEN REFUSES OUT LOUD. A bare `return` on the one field the liaison works from is the
   dead-button silence the compose box had. */
ok('the box says why it will not submit',
  /setError\('Say what this is about in your own words/.test(modal))

console.log(`\ncheck-email-to-dispute: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
