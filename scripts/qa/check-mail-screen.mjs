/**
 * The shape of the mail screen, and the lead that comes off an email.
 *
 * The firm rebuilt this page's layout in a mockup and handed it over: "Make it look much better.
 * Try harder." Six things in that picture were not in Raptor, and each of them is here because the
 * thing it fixes is invisible rather than broken -- a page that is merely plainer than it should
 * be never fails anything, so nothing stops it drifting back.
 *
 *  1. THE MAILBOX IS NAMED. Raptor reads a connected mailbox that is not always the address
 *     somebody signs in with, and an agent who cannot see which one they are reading cannot tell
 *     whether a message is missing or was never sent here.
 *  2. THE SENDER GETS A FACE. A mailbox is scanned by correspondent, and that only works if the
 *     colour is derived from the address -- a random one is worse than none.
 *  3. THE MESSAGE HAS A HEADING: subject, then when, then who from, then who else. It was one
 *     truncated grey line carrying the name, the address and the day together.
 *  4. THREE ANSWERS IN FRONT AND THE DOTS HARD RIGHT. Checked in check-reply-all.mjs.
 *  5. AN UNMATCHED MESSAGE SAYS SO. That is the state that costs money: a reply sent from one
 *     goes out earning nothing and leaves no trace on any statement.
 *  6. A LEAD CAN BE MADE FROM THE MESSAGE. The picker answers "which of our records is this?" and
 *     has nothing to say when the answer is "none of them, yet" -- which is the most valuable
 *     email the firm gets.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-mail-screen.mjs
 */
import { readFileSync } from 'node:fs'
import { isLeadIntake, parseLeadIntake } from '../../src/lib/leadIntake.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const page = read('../../src/pages/mail/MailPage.tsx')
const pane = read('../../src/components/email/ReadingPane.tsx')
const menu = read('../../src/components/ui/RowMenu.tsx')
const composer = read('../../src/components/ComposeEmailModal.tsx')
const sync = read('../../api/_lib/emailSync.ts')
const mapper = read('../../src/lib/userMail.ts')
const send = read('../../api/email/send.ts')
const quick = read('../../src/components/layout/QuickAdd.tsx')

/* One function cut out before asserting on it -- a regex over a whole file is satisfied by any
   line in it, and this file has been bitten by exactly that before. */
function slice(src, from, to, label) {
  const a = src.indexOf(from)
  if (a === -1) { failures.push(`${label}: could not find its opening anchor -- ${from}`); return '' }
  const b = src.indexOf(to, a + from.length)
  if (b === -1) { failures.push(`${label}: could not find its closing anchor -- ${to}`); return '' }
  return src.slice(a, b)
}

/* ---------- 1. a face per sender ---------- */

const colour = slice(page, 'const SENDER_COLOURS', '\n}\n', 'senderColour')
/*
 * DERIVED FROM THE ADDRESS, which is the whole point. Today's message from this debtor has to be
 * the same colour as last week's, or the avatar is decoration and costs a row its width for
 * nothing. Math.random or an index into the visible page would both look fine in a screenshot.
 */
ok('the colour is computed from the address', /senderColour\(address: string\)/.test(colour))
ok('...character by character, so it cannot depend on the page', /charCodeAt\(i\)/.test(colour))
ok('...and nothing about it is random', !/Math\.random/.test(colour))
ok('...nor drawn from where the row happens to sit', !/index/.test(colour))

const summary = slice(page, 'function MailSummary', '\nfunction MessageActions', 'MailSummary')
ok('every row in the list carries one',
  /<Avatar name=\{mail\.fromName \|\| mail\.fromAddress\} color=\{senderColour\(mail\.fromAddress\)\}/.test(summary))
/*
 * A SPAN, NOT A DIV. This whole summary renders inside the button that opens the message, and a
 * div inside a button is invalid markup that React will render and the browser will re-parent.
 */
ok('...as a span, because the row is a button', !/<div/.test(summary))
/* The narrow column gets a smaller one, for the same reason its rows drop the sender's address. */
ok('the reading pane column gets a smaller one', /size=\{tight \? 32 : 36\}/.test(summary))

/* ---------- 2. the message's own heading ---------- */

const detail = slice(page, 'renderDetail={(m) => (', '<MailBody mail={m}', 'the reading pane heading')

ok('the subject leads, and reads as a heading', /<h3 className="text-base font-semibold text-navy-950/.test(detail))
/*
 * THE TIME AS WELL AS THE DAY. "Today" stops being an answer the moment two messages from the
 * same debtor are open, and an hour apart is a different story from a week apart.
 */
ok('the day it came is beside the subject', /relativeDayLabel\(m\.occurredAt\)/.test(detail))
ok('...and the time of day with it', /timeOfDay\(m\.occurredAt\)/.test(detail))
/* Digits that line up, because two of these read as a pair. */
ok('...set in figures that line up', /tabular-nums/.test(detail))

ok('the sender has a face here too', /<Avatar name=\{m\.fromName \|\| m\.fromAddress\}/.test(detail))
ok('...at the size a heading wants', /size=\{40\}/.test(detail))
ok('the sender is named in full weight', /font-semibold text-navy-950">\{m\.fromName \|\| m\.fromAddress\}/.test(detail))
/*
 * THE ADDRESS IN ANGLE BRACKETS after the name, which is how every mail client writes it and how
 * anybody checking a message really is from their client expects to read it.
 */
ok('...with the address after it', /&lt;\{m\.fromAddress\}&gt;/.test(detail))
/* Wrapped rather than truncated: a half-shown address looks like the whole of a shorter one. */
ok('...which wraps rather than being cut off', /break-words/.test(detail))
ok('and then who else was on it', /<RecipientLines mail=\{m\} mine=/.test(detail))
/*
 * THE MATCH BUTTON IS GONE FROM THE CORNER. It said what to press and never said why; the bar
 * under the actions says both. Left here as well, an unmatched message would offer two.
 */
ok('there is no second Match button in the corner', !/startLink/.test(detail))
/* Where it IS filed still shows, and says what kind -- "On a lead" and "On a debtor account" are
   different enough that leaving the kind off would mislead. */
ok('a filed message still says where it went', /On \{m\.linkedTo\.label\}/.test(detail))
ok('...and what kind of record that is', /CRM_OR_ACCOUNT\[m\.linkedTo\.kind\]/.test(detail))

/* ---------- 3. an unmatched message says so ---------- */

const bar = slice(page, 'function NotMatchedBar', '\n/**', 'NotMatchedBar')
ok('it names the state', /'Not matched yet'/.test(bar))
/*
 * AN ENQUIRY OFF THE WEBSITE IS NOT A QUESTION. Every other unmatched message asks one -- debtor,
 * client, nobody? -- and form@bredellferreira.co.za has exactly one answer, so the buttons swap
 * places. Offering "Match to a record" first there sends somebody hunting the book for a stranger
 * who by definition is not in it.
 */
ok('...unless it came off the contact form', /isLeadIntake\(mail\.fromAddress\)/.test(bar))
ok('...which says what it is instead', /A new enquiry off the website/.test(bar))
/*
 * AND WHAT IT COSTS, which is the reason it exists. Item 1(a) is R25 on every message we send and
 * a fee can only be raised against an account, so a reply typed on an unmatched message goes out
 * earning nothing. Said plainly rather than left to be discovered on the statement.
 */
ok('...and what replying from it would mean', /will not\s*\n?\s*appear on any record/.test(bar))
/*
 * EVERY ANSWER TO "WHAT IS THIS?", ON THE MESSAGE THAT IS STILL ASKING. The firm, on a bar that
 * offered two of them: "move to junk, mark as free, block the sender -- it's down there at the
 * three dots, but for a new email, which is completely new, it should be up there."
 *
 * The order is theirs and it runs from "this is work" to "this is not".
 */
/*
 * COUNTED, NOT MERELY PRESENT. The bar reads one way for a website enquiry and another for
 * everything else, and each branch writes its own buttons -- so "it exists somewhere in here" is
 * satisfied by the other branch, and one branch quietly losing a button passes. Matching and
 * making a lead are offered in BOTH, so both appear twice.
 */
ok('the picker is offered', /onClick=\{onLink\} className=\{primary\}/.test(bar))
/*
 * COUNTED, because each branch writes its own. "It exists somewhere in here" is satisfied by the
 * OTHER branch, so one branch quietly losing its lead button would pass.
 */
check('...and a brand-new lead, in both readings of the bar',
  (bar.match(/onClick=\{onCreateLead\}/g) ?? []).length, 2)
/* One button, two jobs: file it as open mail, or -- on an enquiry -- match it after all. */
ok('...filing it as open mail', /onClick=\{fromForm \? onLink : onNoRecord\}/.test(bar))
ok('...binning it', /onClick=\{\(\) => onJunk\(!mail\.isJunk\)\}/.test(bar))
ok('...stopping the sender', /onClick=\{onBlock\}/.test(bar))
/*
 * JUNK BOTH WAYS ROUND. A message can be unmatched AND in junk at once, and offering "Move to
 * junk" on one that is already there is a button that does nothing.
 */
ok('a message already in junk is offered the way back', /<Undo2 size=\{15\} \/> Not junk/.test(bar))

/* And the order swaps: an enquiry off the form has one answer, so it leads with the lead. */
ok('the enquiry leads with the lead',
  /fromForm \? \(\s*\n\s*<button onClick=\{onCreateLead\} className=\{primary\}>/.test(bar))

/*
 * BLOCKING IS NOT OFFERED ON A WEBSITE ENQUIRY, and this is the guard worth having. Every enquiry
 * off the site arrives from the SAME address, so blocking it from here would not silence one
 * time-waster -- it would silence the contact form, permanently, and the next fortnight's
 * enquiries would simply never arrive.
 */
ok('blocking is kept off a website enquiry', /\{!fromForm && \(\s*\n\s*<button onClick=\{onBlock\}/.test(bar))

/*
 * AND THE MENU GIVES THEM UP WHILE THE BAR HAS THEM. "Otherwise it should always be down there."
 * The same action in two places on one screen is how somebody ends up pressing neither.
 */
ok('the menu stands down while the bar is up', /const barIsUp = !mail\.isFiled && !mail\.noRecordAt/.test(page))
ok('...for filing as open', /!mail\.isFiled && !barIsUp/.test(page))
ok('...and for blocking, except on a website enquiry',
  /const barHasDisposal = barIsUp && !isLeadIntake\(mail\.fromAddress\)/.test(page))
/* An empty menu is worse than no menu: it reads as a feature that has broken. */
ok('and the dots disappear when there is nothing behind them',
  /\{moreActions\.length > 0 && \(/.test(page))
ok('matching is the one to press', /bg-gold-400/.test(bar))
/*
 * SILENT ON ANYTHING ALREADY ANSWERED. Filed mail has its record and free mail was deliberately
 * given "none" as its answer -- neither is a loose end, and a warning that fires when nothing is
 * wrong is worse than no warning, because people stop reading it.
 */
ok('filed mail is not nagged', /if \(mail\.isFiled \|\| mail\.noRecordAt\) return null/.test(bar))
/* And it is on the open message, under the actions, not on every row in the list. */
ok('it hangs off the open message', /<NotMatchedBar mail=\{mail\}/.test(page))

/* ---------- 4. a lead, out of the sender ---------- */

const lead = slice(page, 'function CreateLeadFromMailModal', '\nfunction LeadCreatedModal', 'the create-lead modal')

/*
 * THE REAL LEAD FORM, at the firm's instruction: "it should use the same lead form as adding an
 * actual lead -- this one is a small version, it should actually make a lead."
 *
 * So this is a WRAPPER. It works out the prefills and takes over what happens afterwards, and it
 * owns no fields of its own: a second, shorter form would have drifted within a month, because
 * what a lead needs is decided by what the sales side does with one and not by which screen
 * somebody happened to be on.
 */
ok('the mailbox uses the same form as Add Lead', /<LeadForm/.test(lead))
/*
 * AND THE SHARED FORM ACTUALLY TAKES WHAT IT IS HANDED. Exported and then ignoring `initial` would
 * look identical from the mailbox's side -- one form, no prefills, and nobody the wiser until
 * somebody types a name that was already in the message.
 */
ok('...which fills itself in from what it is given',
  /firstName: initial\?\.firstName \?\? ''/.test(quick)
  && /companyName: initial\?\.companyName \?\? ''/.test(quick)
  && /email: initial\?\.email \?\? ''/.test(quick))
/* And lets the caller decide what happens afterwards, instead of always opening the new lead. */
ok('...and hands the new lead back rather than navigating away',
  /if \(onCreated\) \{ onCreated\(lead\); return \}/.test(quick))
ok('...and owns no fields of its own', !/<input/.test(lead))
ok('...and no second Add Lead call beside it', !/addLead\(/.test(lead))

/*
 * AN ENQUIRY OFF THE WEBSITE IS READ OUT OF THE BODY, NEVER OFF THE HEADER. The From header is the
 * firm's OWN form address; put on the lead it would then match every later enquiry to that same
 * lead, so one afternoon's five enquiries would file themselves on one stranger.
 */
ok('a form enquiry is recognised', /const fromForm = isLeadIntake\(mail\.fromAddress\)/.test(lead))
ok('...and read out of the message', /parseLeadIntake\(text\)/.test(lead))
/*
 * EXCEPT THE NAME, WHICH IS THE ONE THING THE HEADER IS RIGHT ABOUT. The firm's form posts no name
 * field at all -- it puts the person's name in the From display name -- so here alone the body is
 * asked first and the header is the fallback.
 */
ok('...with the name falling back to the sender', /firstName: intake\.firstName \?\? split\.firstName/.test(lead))
const formBranch = slice(lead, 'const initial = fromForm', ': {', 'the form-enquiry prefills')
ok('...with their address taken from the body', /email: intake\.email \?\? ''/.test(formBranch))
ok('...and never from the sender', !/mail\.fromAddress/.test(formBranch))
/* It came off the website, and the source on the lead should say so rather than say "Email". */
ok('...and the source says the website', /source: 'Website' as LeadSource/.test(formBranch))

/*
 * FROM ANYBODY ELSE the header IS the person, and the prefills are guesses in editable boxes.
 */
ok('an ordinary sender has their name split', /splitPersonName\(mail\.fromName\)/.test(lead))
ok('...their company guessed off the domain', /companyFromDomain\(domain\)/.test(lead))
/* But never off a shared provider: "Gmail" in the Company box is worse than a blank one. */
ok('...but never off a shared provider', /isSharedDomain\(mail\.fromAddress\) \? ''/.test(lead))
ok('...and Email as the source, because that is where it came from', /source: 'Email' as LeadSource/.test(lead))

/*
 * FILED ON THE NEW LEAD IN THE SAME BREATH, which is the whole point of doing this from the
 * mailbox. A lead created from an email that is not then carrying that email is the same
 * three-screen problem with one screen removed.
 */
ok('the message is filed on the lead it created', /linkMailToRecord\(\{/.test(lead))
ok('...as a lead', /kind: 'lead'/.test(lead))
/*
 * The lead is already saved by the time the filing runs, so a failure there is reported rather
 * than swallowed -- and the lead is handed on regardless, because pretending nothing happened
 * would leave a record on the system that the screen says does not exist.
 */
ok('a filing that fails says so', /could not be filed on it/.test(lead))

/*
 * NOTHING IS CHARGED, and it says so. Annexure B prices work on DEBTOR ACCOUNTS; the sales side
 * raises no fees at all. Read with comments stripped: the block above the modal explains WHY, so
 * tested against the file as written this would pass with the sentence deleted off the screen.
 */
const leadVisible = lead.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
ok('the modal says nothing is charged', /Nothing is charged &mdash; Annexure B/.test(leadVisible))
ok('and no fee is raised anywhere in it', !/chargeMessage|chargeItem|raiseFee/.test(leadVisible))

/*
 * AND THEN IT ASKS. The firm: "once it says lead created, it should ask you -- go back to mail, or
 * go to the lead." Both are real answers: somebody working a morning's enquiries wants the next
 * message, somebody who has just met their best lead of the week wants to phone them.
 */
const done = slice(page, 'function LeadCreatedModal', '\nfunction ', 'the lead-created box')
ok('it says the lead exists', /title="Lead created"/.test(done))
ok('...and offers the mail back', />\s*Back to the mail\s*</.test(done))
ok('...and the lead itself', />\s*Open the lead\s*</.test(done))
ok('opening the lead navigates to it', /navigate\(`\/leads\/\$\{createdLead\.id\}`\)/.test(page))
/* Neither answer is the default one a stray Enter would take. */
ok('...and neither is chosen for you', !/autoFocus/.test(done))

/* ---------- 4b. what the contact form actually sends ---------- */

/*
 * The parser, exercised rather than read. These bodies come off a page somebody in marketing
 * edits, so the labels move -- and the cost of getting one wrong is a lead with the firm's own
 * switchboard on it, which somebody then phones.
 */
const FORM_BODY = [
  'Good Day',
  '',
  /*
   * THE FIRM'S OWN FORM, in its own words -- taken from a real enquiry and then rewritten with
   * invented details, because this repo is public. What it does NOT have is the point: no name
   * field and no email field. The person's name is in the From display name.
   */
  'We are looking for a service provider to collect money from customers dating back a few years.',
  'Contact Number: 021-555 0130',
  'Company or Business Name: Vaal Fire Services',
  'Subject: Debt Collecting',
  '',
  '--',
  'Bredell Ferreira',
  'Tel: 011 555 0100',
  'Email: info@bredellferreira.co.za',
].join('\n')

const parsed = parseLeadIntake(FORM_BODY)
/*
 * THE LABELS THE SITE ACTUALLY USES. "Contact Number" and "Company or Business Name" are not
 * spellings anybody would have guessed, and a parser that misses them hands back a blank form on
 * the one message the firm most wants turned into a lead.
 */
check('the company is read off the form', parsed.companyName, 'Vaal Fire Services')
/*
 * AND THEIR NUMBER, NOT THE FOOTER'S. These bodies carry the enquiry and then the firm's own
 * signature under it, with a switchboard number in it -- taking the last match would put the
 * firm's own number on the lead, which a salesperson would then phone.
 */
check('...and THEIR number, not the footer\u2019s', parsed.phone, '021-555 0130')
/*
 * "Subject" on this form is the SERVICE, not the email's subject line -- which on every one of
 * these reads "New Message From Bredell Ferreira" and tells nobody anything. It is the first
 * thing a salesperson needs and it was going nowhere.
 */
check('what they want is read too', parsed.topic, 'Debt Collecting')
/*
 * NO NAME FIELD AND NO EMAIL FIELD, which is the shape of the real thing and the reason the screen
 * falls back to the From display name for the name. Asserted, because a fixture that quietly grew
 * one would make that fallback untested.
 */
check('the form gives no name', parsed.firstName, undefined)
/* The only address in it is the firm's own, and that must never become the lead's. */
check('...and no address of theirs', parsed.email, undefined)

/* The other shapes a form can post, which the firm's may change to without telling anybody. */
const labelled = parseLeadIntake('Name: Ernest Mohlalisi\nEmail: ernest@example.co.za')
check('a name field is read where there is one', labelled.firstName, 'Ernest')
check('...and split', labelled.lastName, 'Mohlalisi')
check('...and their address with it', labelled.email, 'ernest@example.co.za')

/* An explicit Surname field beats splitting a Name field, where the form sends both. */
const split = parseLeadIntake('Name: Johan van der Merwe\nSurname: van der Merwe')
check('an explicit surname wins over a split one', split.lastName, 'van der Merwe')

/* The label on its own line, which is what an HTML form looks like once it has been flattened. */
const stacked = parseLeadIntake('Name:\nFelicia Nkosi\nEmail:\nfelicia@example.co.za')
check('a label on its own line still finds its value', stacked.firstName, 'Felicia')
/*
 * AND STOPS AT THE NEXT LABEL. A form that posts an empty Name followed by Email would otherwise
 * make the lead's first name "Email:" and their surname their own address.
 */
const empty = parseLeadIntake('Name:\nEmail: felicia@example.co.za')
check('an empty field does not eat the next label', empty.firstName, undefined)
check('...and that next label is still read', empty.email, 'felicia@example.co.za')

/*
 * A SENTENCE IS NOT A FIELD, even when it contains the word. The labels are anchored ^...$ and
 * that anchoring is the only thing standing between "we will need the company name:" and a lead
 * whose company is "please send it through" -- which somebody would then put on a quotation.
 */
const prose = parseLeadIntake('We will need the company name: please send it through')
check('prose is not mistaken for a company', prose.companyName, undefined)
/* Nor for a name: "...the company name" contains "name", which is a label of its own. */
check('...nor for a name', prose.firstName, undefined)

/*
 * A LAST RESORT FOR THE ADDRESS ONLY. Without one the lead is unreachable and the enquiry is
 * wasted -- but never an address at the firm's own domain, which is the form itself.
 */
check('an unlabelled address is still found',
  parseLeadIntake('Hi, please call me on my email joe@example.co.za').email, 'joe@example.co.za')
check('...but never the firm\u2019s own',
  parseLeadIntake('Sent via form@bredellferreira.co.za').email, undefined)

/* And which addresses count as the website at all. */
ok('the contact form is recognised', isLeadIntake('form@bredellferreira.co.za'))
ok('...whatever case it arrives in', isLeadIntake('Form@BredellFerreira.co.za'))
ok('...and an ordinary sender is not', !isLeadIntake('ernest@example.co.za'))

/* ---------- 5. the sender's name, at both ends ---------- */

/*
 * `.text` IS THE WHOLE HEADER, NOT THE NAME. Storing it made every list row read as a truncated
 * address, printed the address twice on the open message, and made the record button as wide as an
 * email address -- which is where most of the bulk the firm complained about actually came from.
 */
ok('the sync works the display name out', /const displayName = \(parsed\.from/.test(sync))
ok('...off the address value, not the formatted header', /parsed\.from\.value\?\.\[0\]\?\.name/.test(sync))
/*
 * BOTH PLACES. The mailbox row and the debtor account's own correspondence list each had their own
 * copy of the old expression, so the bug would have been fixed once and left standing once --
 * which is why it is worked out one line above and used twice.
 */
ok('neither store keeps the whole header any more', !/fromName: parsed\.from\?\.text/.test(sync))
ok('the mailbox row takes it', /fromName: displayName,/.test(sync))
/* The account's list has to print something, so there the fallback is the address. */
ok('...and the account\u2019s correspondence takes it too', /fromName: displayName \?\? fromAddress,/.test(sync))
/*
 * AND EVERYTHING ALREADY SYNCED IS CLEANED ON THE WAY OUT. Those rows cannot be re-read: the
 * upsert ignores duplicates on purpose, so a re-sync cannot overwrite an agent's filing.
 */
ok('what is already stored is cleaned when read', /fromName: senderName\(r\.from_name, r\.from_address\)/.test(mapper))

/* ---------- 6. the composer ---------- */

/*
 * BIG ENOUGH TO WRITE IN. The firm: "the one you made is very small -- make it bigger like Outlook,
 * and you could see at the bottom the previous email that it is going to reply to."
 */
ok('the composer is a place to write, not a dialog to answer', /width=\{760\}/.test(composer))
ok('...with room for more than a sentence', /rows=\{12\}/.test(composer))

/*
 * THE MESSAGE BEING ANSWERED, UNDER THE BOX AND NOT IN IT. Quoting into the box was tried and
 * removed: a debtor's reply already carries their own client's quoted chain, so it opened the
 * composer with two layers of "> " before anybody had typed a word.
 */
ok('the original is shown', /quoted \?: string|quoted\?: string/.test(composer))
ok('...below the box rather than inside it', !/setBody\(.*quoted/.test(composer))
/* As text, because this is mail from outside the building. */
ok('...as text, never as markup', /whitespace-pre-wrap break-words">\{quoted\.trim\(\)\}/.test(composer))
/* In its own scroller, or a long chain pushes Send off the bottom of the screen. */
ok('...and a long chain cannot push Send off the screen', /max-h-48 overflow-y-auto/.test(composer))
ok('the reply is given the message it is answering', /quoted=\{bodies\[replying\.id\]/.test(page))

/*
 * FILES, which the mailbox could not send at all -- forwarding a debtor's proof of payment meant
 * opening Outlook.
 */
ok('a file can be attached', /type="file" multiple/.test(composer))
ok('...and taken off again before sending', /aria-label=\{`Remove \$\{f\.filename\}`\}/.test(composer))
/*
 * CAPPED IN THE BROWSER, WITH THE NUMBER SAID. Vercel's own limit arrives as an empty 413 that the
 * client can only report as "could not reach the server" -- after the wait, and after somebody has
 * attached a debtor's bank statements.
 */
ok('too much is refused before the wait',
  /if \(already \+ adding > MAX_ATTACHMENT_BYTES\)/.test(composer))
ok('...and says how much is too much', /much as one message can carry/.test(composer))
/* And guarded again at the endpoint, because the browser's limit is a courtesy, not a control. */
ok('the endpoint guards it too', /too large to send in one message/.test(send))
/*
 * THE SIGNATURE SURVIVES AN ATTACHMENT. It rides in the same array with a cid and is referenced
 * from the HTML; replacing that array rather than adding to it would strip the sender's own
 * letterhead off every message that carried a file.
 */
ok('the signature still travels with the files', /cid: SIGNATURE_CID \}\]\s*\n?\s*: \[\]\),/.test(send))

/* ---------- 6a. dictating and spelling ---------- */

/*
 * THE SAME MICROPHONE AS THE REST OF RAPTOR. It has been on the diary and the account workspace
 * since it was built and was never put on the one box people write most in.
 *
 * Free and private, which is why it is the browser's own and not a service: Chrome and Safari do
 * the recognising themselves, nothing of ours is uploaded, and a debtor's email never leaves the
 * building to be transcribed by somebody else.
 */
ok('the composer has a microphone', /<DictateButton size="small" value=\{body\} onChange=\{setBody\} \/>/.test(composer))
/* The shared one, not a second implementation of the same thing. */
ok('...the shared one', /from '\.\/ui\/Dictate'/.test(composer))

/*
 * AND THE SPELLING IS CHECKED IN THE LANGUAGE IT IS WRITTEN IN. The browser has always done this
 * for nothing -- but with the page declaring lang="en" it checks an Afrikaans letter against an
 * English dictionary and underlines every word, which teaches people to ignore the underlines.
 */
ok('the message box is spell-checked', /spellCheck onChange/.test(composer))
ok('...in the language being dictated', /lang=\{lang\}/.test(composer))
/* One source of truth for that setting: DictateButton owns the picker and remembers the choice. */
ok('...read from the one place that owns it', /const \[lang\] = useState\(storedLanguage\)/.test(composer))

/* ---------- 6b. the mailbox is a screen, not a panel on one ---------- */

/*
 * THREE SCROLLBARS FOR ONE LIST was the bug. The pane was a fixed 38rem inside a page that scrolled
 * behind it, so the foot of the message -- where the action bar lives -- sat below the fold. The
 * firm: "you have to scroll down to the very bottom to see that ... it should pop up at the bottom
 * of the screen and stay stagnant."
 */
ok('the pane can take the height it is given', /fill\?: boolean/.test(pane))
/*
 * flex-1, NOT h-full. A percentage height on a flex child resolves against a height the parent has
 * not finished working out, which renders as a pane of zero height or of the wrong one.
 */
ok('...as a flex child rather than a percentage', /fill \? 'lg:flex-1 lg:min-h-0' : 'lg:h-\[38rem\]'/.test(pane))
ok('the mailbox asks for it', /<ReadingPane\s*\n\s*fill/.test(page))
ok('...and gives the page a height to divide up', /lg:h-full lg:flex lg:flex-col lg:min-h-0/.test(page))
ok('...through the card', /paneShowing \? 'lg:flex-1 lg:min-h-0 lg:flex lg:flex-col' : undefined/.test(page))
/*
 * ONLY AT lg. Below it there is no reading pane -- the list IS the page -- and a page that cannot
 * scroll is a list nobody can read past the first screen.
 */
ok('...and only where there are two columns to fill', !/(?<!lg:)h-full lg:flex/.test(page))

/* ---------- 7. the plumbing the layout hangs on ---------- */

/*
 * THE LIST HEADER SCROLLS NOTHING. A search box that scrolls away with the list is one you have to
 * go back up for, and the flex child below it needs min-h-0 or it grows past the pane instead of
 * scrolling -- which is the classic way this shape ships broken.
 */
ok('the pane can carry something above its list', /listHeader\?: ReactNode/.test(pane))
ok('...which stays put', /shrink-0 border-b border-slate-100">\{listHeader\}/.test(pane))
ok('...while the list under it scrolls', /flex-1 min-h-0 lg:overflow-y-auto/.test(pane))

/* The dots take the shape of their neighbours on a toolbar, and stay a bare icon on a table row. */
ok('the overflow menu can be drawn as a button', /bordered\?: boolean/.test(menu))
ok('...and says what it is when it is only an icon', /aria-label=\{label \?\? 'More actions'\}/.test(menu))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
The mailbox says which mailbox it is, a sender has the same face every time, an open message
reads as a message, an unmatched one says what that costs, and the enquiry from somebody nobody
knows yet becomes a lead without leaving the page.`)
