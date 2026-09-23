/**
 * Who else was on it, and answering all of them.
 *
 * The firm, looking at an open message: "I can't see all the other recipients of an email. And I
 * also can't respond to all recipients." Both halves of that are one chain, and the chain is only
 * as good as its weakest hop:
 *
 *     the message arrives  ->  emailSync reads To and Cc off the headers
 *     the row is written   ->  to_recipients / cc_recipients on user_emails
 *     the row is read      ->  userMail's COLUMNS, then toItem's mapper
 *     the screen           ->  RecipientLines, under the sender
 *     the reply            ->  replyAllTo decides the Cc, the composer shows it, /api/email/send
 *                              puts it on the message AND on the Sent copy
 *
 * Every one of those hops fails silently if it is missed. A mapper that forgets the column reads
 * as "nobody else was on it" for ever; a send that drops the Cc reaches the debtor and not their
 * attorney, and nothing anywhere says so. The pure rules are checked in check-sent-mail.mjs --
 * this file checks the wiring those rules hang off.
 *
 * Also here: the toolbar's shape. Nine equal buttons in one wrapping row put Block sender under
 * Reply on a narrow pane; the firm asked for Reply / Reply all / Forward in front and the filing
 * decisions behind the dots.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-reply-all.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const schema = read('../../supabase/schema.sql')
const sync = read('../../api/_lib/emailSync.ts')
/*
 * THE ROUTE AND THE SENDER, READ TOGETHER, because together they are what happens when somebody
 * POSTs /api/email/send. The sending itself moved into sendAsUser when the workflow runner needed
 * it -- the runner sends the same templates through the same mailboxes unattended, and two
 * senders would drift with the unattended one drifting unseen. The rules below are unchanged;
 * only which file holds them moved.
 */
const send = read('../../api/_lib/email/send.ts')
  + read('../../api/_lib/email/sendAsUser.ts')
const mail = read('../../src/lib/userMail.ts')
const page = read('../../src/pages/mail/MailPage.tsx')
const composer = read('../../src/components/ComposeEmailModal.tsx')

/*
 * Cutting one function out of a file before asserting on it, because a regex over a whole file is
 * satisfied by ANY line in it -- and this file has already been bitten once by a guard that
 * passed because a different function mentioned the same string. Returns '' rather than throwing
 * so a moved anchor is reported as the failure it is, on the line that names it, instead of as a
 * TypeError somewhere below.
 */
function slice(src, from, to, label) {
  const a = src.indexOf(from)
  if (a === -1) { failures.push(`${label}: could not find its opening anchor -- ${from}`); return '' }
  const b = src.indexOf(to, a + from.length)
  if (b === -1) { failures.push(`${label}: could not find its closing anchor -- ${to}`); return '' }
  return src.slice(a, b)
}

/* ---------- 1. the columns exist, and are lists rather than nothing ---------- */

/*
 * NOT NULL DEFAULT '[]'. Nullable, every consumer would need its own null guard and the one that
 * forgot would crash on mail synced before the column existed -- which is all of it.
 */
for (const col of ['to_recipients', 'cc_recipients']) {
  const line = schema.split('\n').find((l) => l.includes(`user_emails add column if not exists ${col}`)) ?? ''
  ok(`${col} is on user_emails`, line !== '')
  ok(`${col} is jsonb`, /\bjsonb\b/.test(line))
  ok(`${col} is never null`, /not null/.test(line))
  ok(`${col} starts out empty rather than absent`, /default '\[\]'::jsonb/.test(line))
}

/*
 * BCC IS DELIBERATELY ABSENT and the schema says why: a blind copy is not on the message that
 * arrives, so a column for it could only ever be empty -- and an empty Bcc line on the screen
 * would read as "nobody was blind-copied", which we cannot know.
 */
ok('the schema says why there is no Bcc', /[Bb]cc/.test(
  slice(schema, 'comment on column public.user_emails.to_recipients', 'user_emails.cc_recipients', 'the recipients comments')
  + slice(schema, 'comment on column public.user_emails.cc_recipients', ';', 'the Cc comment')))

/* ---------- 2. the sync reads everyone off the headers ---------- */

const people = slice(sync, 'const people = (field: unknown)', 'const toRecipients', 'the people() flattener')

/*
 * BOTH SHAPES. mailparser hands back an AddressObject, or an array of them when the header was
 * written twice -- and a message with two To headers is exactly the one where dropping the second
 * loses somebody from a reply-all.
 */
ok('an array of address objects is flattened', /Array\.isArray\(field\)/.test(people))
ok('...and a single one is wrapped rather than dropped', /field \? \[field\] : \[\]/.test(people))
ok('every value on each header is taken, not the first', /flatMap/.test(people))
/* An address with no address is not a person and would become an empty entry on the To line. */
ok('an entry with no address is dropped', /filter\(\(v\) => !!v\.address\)/.test(people))
/*
 * STORED NORMALISED, because replyAllTo matches on the address to take you out of your own
 * reply-all. Stored as the header wrote them, "Me@Firm.co.za" and "me@firm.co.za" are two people
 * and one of them is you.
 */
ok('addresses are stored normalised', /normaliseAddress\(v\.address/.test(people))

const filing = slice(sync, 'await fileUserEmail(admin, conn.user_id, {', 'noRecordNeeded', 'the fileUserEmail call')
ok('To is captured off the message', /const toRecipients = people\(parsed\.to\)/.test(sync))
ok('Cc is captured off the message', /const ccRecipients = people\(parsed\.cc\)/.test(sync))
ok('...and To is handed to the row being filed', /\btoRecipients,/.test(filing))
ok('...and Cc with it', /\bccRecipients,/.test(filing))

const insert = slice(sync, 'toRecipients?:', 'onConflict', 'fileUserEmail’s insert')
ok('To is written to the column', /to_recipients: message\.toRecipients \?\? \[\]/.test(insert))
ok('Cc is written to the column', /cc_recipients: message\.ccRecipients \?\? \[\]/.test(insert))

/* ---------- 3. the mapper carries them ---------- */

/*
 * THE DOCUMENTED TRAP, and the reason this section exists at all: a column present in the
 * database, in the type and in the select but missing from the hand-written mapper reads as
 * undefined for ever and nothing fails. diary_capacity sat in that state for months.
 */
const columns = slice(mail, 'const COLUMNS = `', '\n`', 'userMail’s COLUMNS')
ok('to_recipients is selected', /to_recipients/.test(columns))
ok('cc_recipients is selected', /cc_recipients/.test(columns))

const mapper = slice(mail, 'function toItem(r: MailRow)', '\n}', 'userMail’s toItem')
ok('to_recipients is mapped', /toRecipients:/.test(mapper))
ok('cc_recipients is mapped', /ccRecipients:/.test(mapper))
/*
 * GUARDED WITH Array.isArray. jsonb comes back as whatever was put in it, and a row written by
 * hand or by an older sync can hold null -- .length on which is a blank screen, not a blank line.
 */
ok('a row without a list reads as nobody, not as a crash',
  /toRecipients: Array\.isArray\(r\.to_recipients\) \? r\.to_recipients : \[\]/.test(mapper))
ok('...and the same for Cc',
  /ccRecipients: Array\.isArray\(r\.cc_recipients\) \? r\.cc_recipients : \[\]/.test(mapper))

/* ---------- 4. the screen says who else was on it ---------- */

const lines = slice(page, 'function RecipientLines', 'function InviteCard', 'RecipientLines')
const rules = readFileSync(new URL('../../src/lib/emailRules.ts', import.meta.url), 'utf8')
/*
 * SILENT WHERE THERE IS NOBODY. Most mail is addressed to one person and gains nothing from a
 * line saying so -- and mail synced before these columns existed has empty lists, where a "To"
 * label with nothing after it would read as a bug.
 */
ok('nobody to name means no lines at all',
  /if \(mail\.toRecipients\.length === 0 && mail\.ccRecipients\.length === 0\) return null/.test(lines))
/* With the colon a mail client writes, which is also how the firm reads them on paper. */
ok('To is labelled', />To:</.test(lines))
ok('Cc is labelled', />Cc:</.test(lines))
/*
 * NAMES ON SCREEN, ADDRESSES IN THE TITLE. recipientLine writes real header values and is what
 * goes into a Cc box; printed on screen it is four wrapped lines for three people, which is what
 * the firm called bulky. So the visible text is names and the full list is the hover.
 */
ok('each line shows names rather than addresses', (lines.match(/recipientSummary\(/g) ?? []).length === 2)
ok('...with the real addresses still one hover away', (lines.match(/title=\{recipientLine\(/g) ?? []).length === 2)
/* One line each: the saving is the whole point, so a long list must not be allowed to wrap. */
ok('a long list is cut off rather than wrapping onto four lines', /truncate/.test(lines))
/* Your own address reads as "you", which is shorter and is what every mail client does. */
ok('the agent themselves is not listed by name', /recipientSummary\(mail\.toRecipients, own\)/.test(lines))
/*
 * AND A LONG LIST IS COUNTED, NOT CLIPPED -- "To: Ruben +4", which is Spark's and is what the firm
 * sent over. A clipped line ends mid-address and says nothing about how much was clipped.
 */
ok('...and a long list says how many were left out', /\+\$\{labels\.length - shown\}/.test(rules))

/*
 * ON BOTH SCREENS. The mailbox has a reading pane and a plain list, and they are separate
 * renderings of the same message -- shown in one and not the other, Reply all would sit on a row
 * that never says who it would copy.
 */
ok('the reading pane names the other recipients',
  /<RecipientLines mail=\{m\} mine=\{\[mailbox, currentUser\?\.email\]\} \/>/.test(page))
ok('the expanded list row names them too',
  /<RecipientLines mail=\{mail\} mine=\{mine\} \/>/.test(page))

/* ---------- 5. reply-all ---------- */

const body = slice(page, 'function MailBody', '\nfunction InviteCard', 'MailBody')
/*
 * The bar is its own component now: it renders floating at the foot of the reading pane and as an
 * ordinary row at the top of an expanded list row, and writing it twice would have been two sets
 * of buttons waiting to drift.
 */
const row = slice(page, 'function MessageActions', '\nfunction BarButton', 'the action bar')

/*
 * OFFERED ONLY WHERE THERE IS SOMEBODY TO COPY. On a message addressed to you alone, reply-all
 * does exactly what reply does, and a button that silently duplicates its neighbour is a button
 * people learn to distrust.
 */
ok('Reply all is offered only when more than one person was on it',
  /\(mail\.toRecipients\.length \+ mail\.ccRecipients\.length\) > 1/.test(row))
ok('...and it is on the bar, not behind the dots', /label="Reply all"/.test(row))

const startReply = slice(page, 'function startReply', '\n  }', 'startReply')
ok('replying knows which kind it is', /function startReply\(mail: MailItem, all = false\)/.test(startReply))
ok('...and says so before anything else happens', /setReplyAll\(all\)/.test(startReply))

const cc = slice(page, 'function replyAllCc', '\n  }', 'replyAllCc')
/*
 * UNDEFINED, NOT EMPTY, on an ordinary reply. The composer shows its Cc box only when it is given
 * one, and an empty Cc field on every reply is a control nobody fills in and everybody reads past.
 */
ok('an ordinary reply carries no Cc at all', /if \(!replyAll\) return undefined/.test(cc))
ok('the sender is where the reply goes', /from: \{ name: mail\.fromName, address: mail\.fromAddress \}/.test(cc))
ok('everyone on To is considered', /to: mail\.toRecipients/.test(cc))
ok('everyone on Cc is considered', /cc: mail\.ccRecipients/.test(cc))
/*
 * BOTH OF YOUR ADDRESSES. The connected mailbox is how the message reached you and is the one on
 * the original; the signed-in address is the other one you might have been copied at. Left in,
 * every reply-all drops a copy back in your own inbox and the thread doubles every round.
 */
ok('the mailbox that received it is you', /mailbox/.test(cc))
ok('...and so is the address you signed in with', /currentUser\?\.email/.test(cc))
ok('the Cc is rendered as a header line', /return recipientLine\(cc\)/.test(cc))

ok('the composer opens with that Cc', /initialCc=\{replyAllCc\(replying\)\}/.test(page))

/*
 * THE MAILBOX IS ASKED, not assumed from the login. Mail is read from a connected mailbox that is
 * not always the address somebody signs in with -- a shared info@ is the ordinary case -- and
 * getting it wrong copies the firm on its own reply.
 */
ok('the connected mailbox is read from the server', /\/api\/email\/status/.test(page))

/* ---------- 6. the composer ---------- */

/*
 * SHOWN AND EDITABLE, because the list is the part somebody has to be able to check: a reply-all
 * that quietly copied a debtor's attorney would be the firm's mistake, not the sender's, and the
 * only moment to catch it is before Send.
 */
/*
 * OPEN ON A REPLY-ALL, OFFERED EVERYWHERE ELSE. It was reply-all only, which was the wrong half of
 * the rule -- the firm: "when you forward an email you should be able to Cc other people."
 * Forwarding a debtor's dispute to the client is exactly the message their attorney should be
 * copied on, and an agent who cannot do it here does it in Outlook.
 */
ok('the Cc box opens by itself on a reply-all',
  /const \[showCc, setShowCc\] = useState\(initialCc !== undefined\)/.test(composer))
/* Collapsed rather than absent: a box on every message is one nobody fills in and everybody
   reads past, which is what it was before. One quiet line instead. */
ok('...and is one line away on everything else', />\s*<Plus size=\{12\} \/> Add Cc/.test(composer))
ok('...which opens the same field', /setShowCc\(true\)/.test(composer))
ok('...and it opens with the people who were on the original', /useState\(initialCc \?\? ''\)/.test(composer))
ok('...and it is a field, not a label', /onChange=\{\(e\) => setCc\(e\.target\.value\)\}/.test(composer))
/* Cleared to nothing, the message goes to the one recipient -- not to an empty Cc header. */
ok('an emptied Cc box sends no Cc', /\.\.\.\(cc\.trim\(\) \? \{ cc: cc\.trim\(\) \} : \{\}\)/.test(composer))

/* ---------- 7. the send, in both places ---------- */

/*
 * THE FIELD, NOT ITS NEIGHBOURS. This pinned the whole destructure in order and went red the day
 * an unrelated field was added beside it -- a check that fails on correct code is a check somebody
 * deletes. What matters is that `cc` is read off the body at all.
 */
ok('the endpoint accepts a Cc', /const \{[^}]*\bcc\b[^}]*\} = \(req\.body/.test(send))

const SPREAD = /\.\.\.\(message\.cc && message\.cc\.trim\(\) \? \{ cc: message\.cc \} : \{\}\)/
/*
 * BOTH PLACES, AND NOW BY CONSTRUCTION. The message goes out through nodemailer and a second copy
 * is composed for the mailbox's own Sent folder. Cc on the first and not the second, and the Sent
 * copy shows a message that reached fewer people than it did -- which is the copy anybody checks
 * months later when a client asks whether their attorney was told.
 *
 * THIS USED TO COUNT THE SPREAD TWICE, once per call. When the sender was lifted out for the
 * workflow runner the two calls came to share ONE `envelope` object, so the property the count
 * was standing in for is now impossible to get wrong rather than merely checked -- and the count
 * of two became a count of one. Asserted as the rule instead: the Cc is decided once, and the
 * thing it was decided on is what BOTH calls are given.
 */
check('the Cc is decided in exactly one place', (send.match(new RegExp(SPREAD, 'g')) ?? []).length, 1)
ok('...on the envelope both calls are built from', /const envelope = \{[\s\S]{0,600}?\.\.\.\(message\.cc/.test(send))
ok('...which is what actually goes out', /sendMail\(envelope\)/.test(send))
ok('...and what is filed in the Sent folder', /new MailComposer\(envelope\)/.test(send))

/* ---------- 8. three answers in front, the filing behind the dots ---------- */

const more = slice(body, 'const moreActions: RowMenuItem[] = [', '\n  ]', 'moreActions')

/*
 * WHAT AN OPEN MESSAGE IS FOR stays in the row. These three are why the mailbox stopped being
 * read-only, and putting any of them one click away would undo that.
 */
for (const label of ['Reply', 'Reply all', 'Forward', 'Mark unread']) {
  /* Asserted as the button's own text -- "/> Reply" -- so a comment mentioning it cannot pass. */
  /* Asserted on the button's own text or its label -- a comment mentioning it cannot pass. */
  ok(`${label} is in the row`,
    row.includes(`/> ${label}\n`) || row.includes(`label="${label}"`))
  ok(`...and ${label} is not buried in the menu`, !more.includes(`label: '${label}'`))
}

/*
 * THE FILING DECISIONS go behind the dots. They are taken once per message and never in a hurry,
 * so they cost a click and buy back a row that reads at a glance.
 */
for (const label of ['Mark as open', 'Put back in the queue', 'Move to junk',
  'Not junk', 'Unmatch', 'Block sender']) {
  ok(`${label} is in the menu`, more.includes(`label: '${label}'`))
  ok(`...and ${label} is not also a button on the bar`,
    !row.includes(`> ${label}`) && !row.includes(`label="${label}"`))
}

/* Each still carries the rule that decides whether it is offered at all. */
ok('Unmatch is only on mail filed on a debtor account',
  /mail\.linkedTo\?\.kind === 'account' && onMove/.test(more))
ok('free mail and junk are hidden on filed mail', (more.match(/!mail\.isFiled/g) ?? []).length === 2)
ok('junk reverses on mail already in junk', /mail\.isJunk/.test(more))
ok('free mail reverses on mail already marked free', /mail\.noRecordAt/.test(more))
/* Blocking is the only one that reads as damage, and it is last. */
ok('Block sender is marked as the damaging one', /label: 'Block sender'[\s\S]*danger: true/.test(more))

/*
 * THE ACCOUNT LINK STAYS OUT IN FRONT, and it stays a Link. Middle-click and "open in new tab"
 * both work on one and neither survives being an item in a menu -- which matters when you are
 * working a message and want the account beside it.
 */
ok('the account is still one click away', /<Link to=\{mail\.linkedTo\.path\}/.test(row))
/* And the bar stays put while a long message scrolls under it -- the firm liked that in Spark. */
/*
 * AND IT STAYS ON SCREEN, which is what the firm liked in Spark: "it stays there, so if you scroll
 * up or down through the email it kind of stays there as a little bar." Floating at the foot of the
 * pane rather than pinned to the top of it -- the old complaint was about a bar you had to REACH,
 * and one that is always on screen never has to be reached.
 */
ok('the bar stays on screen while the message scrolls', /'sticky bottom-3 z-20/.test(row))
/* And it must not swallow clicks on the message underneath it. */
ok('...without eating clicks on the message under it',
  /pointer-events-none/.test(row) && /pointer-events-auto/.test(row))
/* Its own menu opens upwards, or it opens off the bottom of the screen. */
ok('...and its menu opens upwards', /up=\{sticky\}/.test(row))

/*
 * AND EVERY ICON ON IT HAS A NAME. Floating, these are icons and nothing else -- a button with no
 * accessible name cannot be read out, cannot be hovered for an answer, and "which arrow was
 * reply-all?" is exactly the question a collector should not have to answer from memory.
 */
const barButton = slice(page, 'function BarButton', '\nfunction ', 'BarButton')
ok('an icon on the bar says what it is on hover', /title=\{label\}/.test(barButton))
ok('...and to a screen reader', /aria-label=\{label\}/.test(barButton))
/* And spells it out where there is room for it, which is the list placement. */
ok('...and spells it out where there is room', /\{!sticky && label\}/.test(barButton))
ok('...and it is not in the menu instead', !/linkedTo\.path/.test(more))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
Every recipient survives the trip from the header to the screen, a reply-all copies them without
copying you, the Cc reaches the Sent copy as well as the message, and the toolbar leads with the
three things an open message is actually for.`)
