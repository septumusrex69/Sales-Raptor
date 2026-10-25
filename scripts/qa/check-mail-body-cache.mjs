/**
 * READING YOUR OWN MAIL WITHOUT WAITING FOR A MAIL SERVER.
 *
 * THE FIRM: "doing anything on the mailbox is super slow except writing -- reading something is
 * super slow... isn't there some way we can mimic the way Outlook works to make it super fast and
 * slick?"
 *
 * WHAT WAS SLOW, EXACTLY. Opening a message asked /api/email/attachment for its body, which opened
 * a TLS connection to the mail server, logged in, selected a folder and fetched the message --
 * every time, for every message, including one read a minute earlier. Nothing about the LIST was
 * slow: user_emails is indexed on (user_id, occurred_at desc), the list select takes no body, and
 * 990 rows of it on staging is 1,6 MB. The list was never the thing.
 *
 * AND THE BODY WAS ALREADY IN OUR HANDS. The sync fetches every message whole (`source: true`) and
 * parses it, to cut 240 characters out and drop the rest. Keeping it costs NOTHING at the mail
 * server -- it is a storage decision, which is how it was made ("metadata and a snippet only") and
 * is the half that was wrong. account_emails has held a debtor's correspondence in full since it
 * was built, which is the precedent.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-mail-body-cache.mjs
 */
import { readFileSync } from 'node:fs'
import {
  bodyToStore, extractPictures, hasCachedBody, inlinePictures, needsPictures, sha256Hex,
  storedPictureHashes, tooBigFor, withoutEmbeddedPictures,
  CALENDAR_LIMIT, HTML_LIMIT, PICTURE_PREFIX, TEXT_LIMIT,
} from '../../src/lib/mailBodyCache.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')

const AT = '2026-10-03T09:00:00.000Z'
const body = (over = {}) => ({ text: 'Good day,\n\nPlease settle.', html: '<p>Please settle.</p>', calendar: '', ...over })

/* ---------------------------------------------------------------------------------------------
 * WHAT IS KEPT
 * ------------------------------------------------------------------------------------------- */

check('an ordinary message is kept whole', bodyToStore(body(), AT), {
  body_text: 'Good day,\n\nPlease settle.',
  body_html: '<p>Please settle.</p>',
  body_calendar: null,
  body_cached_at: AT,
})
/* NOT TRUNCATED. A body cut off at a limit reads as a sender who stopped mid-sentence, and
   nothing on screen can tell the reader which of the two it was. */
const long = { text: 'x'.repeat(TEXT_LIMIT + 1), html: '<p>ok</p>', calendar: '' }
check('a message over the limit keeps nothing of its text', bodyToStore(long, AT).body_text, null)
check('...and is not cut off instead', bodyToStore(long, AT).body_text, null)
/* THE OTHER PARTS SURVIVE: a huge text part is no reason to lose markup small enough to keep. */
check('...while the markup beside it is still kept', bodyToStore(long, AT).body_html, '<p>ok</p>')
check('a newsletter’s markup is not kept',
  bodyToStore({ text: 'hi', html: 'y'.repeat(HTML_LIMIT + 1), calendar: '' }, AT).body_html, null)
/* ...AND NOR ARE ITS WORDS (10 Oct): the text alone made every later open show the flat version
   instead of going back to the mailbox for the message as written. */
check('...nor its plain text, so the reader goes to the mailbox for it',
  bodyToStore({ text: 'hi', html: 'y'.repeat(HTML_LIMIT + 1), calendar: '' }, AT).body_text, null)
check('the markup limit holds a long pasted thread (a million characters)', HTML_LIMIT, 1_000_000)
check('an oversized ICS is not kept',
  bodyToStore({ text: '', html: '', calendar: 'z'.repeat(CALENDAR_LIMIT + 1) }, AT).body_calendar, null)
/* EXACTLY AT THE LIMIT IS INSIDE IT, or the limit is one character tighter than it says. */
check('a message exactly at the limit is kept',
  bodyToStore({ text: 'x'.repeat(TEXT_LIMIT), html: '', calendar: '' }, AT).body_text?.length, TEXT_LIMIT)

/* AND THE ROW IS MARKED EITHER WAY, which is what stops the reader asking the mail server again
   and again for a message there is nothing to fetch. */
check('the row is always stamped', bodyToStore({ text: '', html: '', calendar: '' }, AT).body_cached_at, AT)

/* ---------------------------------------------------------------------------------------------
 * AND WHETHER THERE IS ANYTHING THERE TO READ
 * ------------------------------------------------------------------------------------------- */

const row = (over = {}) =>
  ({ body_text: null, body_html: null, body_calendar: null, body_cached_at: AT, ...over })

ok('a cached message reads out of the row', hasCachedBody(row({ body_text: 'hello' })))
ok('...markup alone is enough', hasCachedBody(row({ body_html: '<p>hi</p>' })))
ok('...and so is a meeting request with no words in it', hasCachedBody(row({ body_calendar: 'BEGIN:VCALENDAR' })))
/* NEVER LOOKED AT: every row that existed before this, which must still go to the mailbox. */
ok('a row nobody has cached goes to the mailbox',
  !hasCachedBody(row({ body_text: 'hello', body_cached_at: null })))
/*
 * AND THE OVERSIZED ONE TOO. It is stamped but holds nothing, and the stamp is what stops it being
 * re-cached on every open -- reading `body_cached_at` alone would hand the reader an empty message
 * and call it the body.
 */
ok('a message too big to keep still goes to the mailbox', !hasCachedBody(row()))

/* ---------------------------------------------------------------------------------------------
 * THE PICTURES, WHICH ARE THE ONE THING THE CACHE CANNOT ANSWER
 * ------------------------------------------------------------------------------------------- */

/*
 * A SIGNATURE LOGO IS ATTACHED TO THE MESSAGE AND REFERRED TO AS cid:. The pictures are not kept
 * -- they are most of a message's size -- so the words come out of the cache at once and the
 * pictures follow from the mailbox. Waiting for the whole message because a signature has a logo
 * in it is most business email, and is the slowness this set out to fix.
 */
ok('a message with an embedded picture says so',
  needsPictures('<p>Regards</p><img src="cid:image001.png@01D9">'))
ok('...however it is quoted', needsPictures("<img src='cid:x'>") && needsPictures('<img src=cid:x>'))
ok('...and whatever the case', needsPictures('<IMG SRC="CID:X">'))
ok('a message with no pictures needs nothing more', !needsPictures('<p>Please settle.</p>'))
/*
 * A REMOTE PICTURE IS NOT ONE OF THESE. It is fetched from somebody else's server or held back by
 * emailHtml, and going to the mailbox for it would find nothing -- it was never in the message.
 */
ok('a remote picture is not fetched from the mailbox',
  !needsPictures('<img src="https://tracker.example/pixel.gif">'))
ok('...and neither is nothing at all', !needsPictures(null) && !needsPictures(''))

/*
 * AND THE PICTURES THE PARSER HAD ALREADY PUT INTO THE MARKUP (24 Oct, S11). mailparser rewrites
 * every cid: into a data: URI by default, so the logos were stored inside body_html after all --
 * 645 MB of a 710 MB staging database, until the disk filled. They come out at bodyToStore, and
 * (the firm: "save one image somewhere ... like Microsoft") each is saved ONCE, by fingerprint.
 */
const LOGO_B64 = 'iVBORw0KGgo'.repeat(4000)
const LOGO = 'data:image/png;base64,' + LOGO_B64
const LOGO_REF = PICTURE_PREFIX + sha256Hex(LOGO_B64)
const signed = `<p>Regards</p><img src="${LOGO}" alt="BF">`
const kept = bodyToStore(body({ html: signed }), AT).body_html
ok('a picture the parser drew into the markup is not stored', !!kept && !kept.includes('base64'))
ok('...the words around it are', !!kept && kept.includes('<p>Regards</p>'))
ok('...and the attribute after it survives', !!kept && kept.includes('alt="BF"'))
check('...replaced by its fingerprint', kept, `<p>Regards</p><img src="${LOGO_REF}" alt="BF">`)
check('...which the page reads back to fetch it from the store', storedPictureHashes(kept), [sha256Hex(LOGO_B64)])

/* ONE FILE PER PICTURE, HOWEVER MANY TIMES IT APPEARS -- the whole point of the store. */
const twice = extractPictures(`<img src="${LOGO}"><p>x</p><img src="${LOGO}">`)
check('the same logo twice in one message is one picture to save', twice.pictures.length, 1)
check('...saved with its type and its bytes', [twice.pictures[0].contentType, twice.pictures[0].base64 === LOGO_B64], ['image/png', true])
/* AND THE SAME LOGO ON TWO MESSAGES IS THE SAME NAME, which is what makes the second one free. */
check('the same logo on another message has the same fingerprint',
  extractPictures(`<div><img src="${LOGO}"></div>`).pictures[0].hash, twice.pictures[0].hash)
/* A REAL HASH: a collision would show one sender another firm's logo. */
check('the fingerprint is SHA-256', sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')

/* UNQUOTED: base64 letters and `=` look like the next attribute, and must not swallow it. */
check('an unquoted picture does not take the next attribute with it',
  withoutEmbeddedPictures('<img src=data:image/gif;base64,R0lGOD== alt=x>'), `<img src=${PICTURE_PREFIX}${sha256Hex('R0lGOD==')} alt=x>`)
check('a background picture in a style goes too',
  withoutEmbeddedPictures("<td style=\"background:url('data:image/jpeg;base64,/9j/4AAQ')\">"),
  `<td style="background:url('${PICTURE_PREFIX}${sha256Hex('/9j/4AAQ')}')">`)
check('markup with no pictures is untouched', withoutEmbeddedPictures('<p>Please settle.</p>'), '<p>Please settle.</p>')
/* MEASURED AFTER, so a big logo no longer pushes an ordinary message out of the cache. */
ok('a message over the limit only because of its pictures is now kept',
  bodyToStore(body({ html: '<p>hi</p><img src="data:image/png;base64,' + 'A'.repeat(HTML_LIMIT) + '">' }), AT).body_html !== null)

/*
 * THE MAILBOX'S OWN cid:s ARE PUT BACK BEFORE THE WRITE-BACK. The fast read returns markup with
 * `cid:image001...` and the pictures beside it; stored like that, every later open would go back
 * to the mail server for a logo the store could answer.
 */
const fromMailbox = inlinePictures('<img src="cid:image001.png@01D9">',
  [{ cid: '<image001.png@01D9>', dataUri: LOGO }])
check('a mailbox picture is drawn back into its markup', fromMailbox, `<img src="${LOGO}">`)
check('...so the write-back stores it by fingerprint like any other', withoutEmbeddedPictures(fromMailbox), `<img src="${LOGO_REF}">`)
check('...and a cid with no picture is left as it was',
  inlinePictures('<img src="cid:missing">', [{ cid: 'other', dataUri: LOGO }]), '<img src="cid:missing">')

/* WHY A MESSAGE IS STILL SLOW, for the sync's log: a message that is slower than its neighbours
   for no visible reason is a bug report nobody can answer. */
check('an oversized body says which part was too big',
  tooBigFor({ text: 'x'.repeat(TEXT_LIMIT + 1), html: 'y'.repeat(HTML_LIMIT + 1), calendar: '' }),
  'text and html over the cache limit')
check('...and an ordinary one says nothing', tooBigFor(body()), null)

/* ---------------------------------------------------------------------------------------------
 * BOTH ENDS OF THE CACHE
 * ------------------------------------------------------------------------------------------- */

/*
 * THE SYNC FILLS IT, which is the half that costs nothing: the message is already fetched whole
 * and already parsed by the time this runs.
 */
const sync = read('api/_lib/emailSync.ts')
ok('the sync keeps the body it already has', /\.\.\.bodyToStore\(/.test(sync))
ok('...the markup beside the text', /html: parsed\.html \|\| '',/.test(sync))
/*
 * AND THE TEXT OF AN HTML-ONLY MESSAGE. `parsed.text` is empty on one, so the snippet in the list
 * was blank on marketing mail and on most mail sent from a phone. plainText falls back to
 * stripping the markup, which is what the read path has always done.
 */
ok('...reading an html-only message as text',
  /body: plainText\(parsed\.text, parsed\.html \|\| undefined\)/.test(sync))

/*
 * AND THE READ FILLS IT TOO, which is what makes this reach the mail that is ALREADY in the
 * mailbox: every row that arrived before any of this becomes fast the first time it is opened.
 */
const route = read('api/_lib/email/attachment.ts')
ok('the read route writes what it fetched back onto the row',
  /from\('user_emails'\)\s*\n?\s*\.update\(bodyToStore\(/.test(route))
/* NEVER FATAL. The caller came to read their mail; a cache that cannot be written is a slower
   read next time and nothing worse. (S11: the pictures are saved first, then the row.) */
ok('...without the response waiting on it', /void savePictures\(admin, extractPictures\(fullHtml\)\.pictures\)/.test(route))
ok('...with the mailbox pictures drawn back in first', /const fullHtml = inlinePictures\(body\.html, body\.images/.test(route))
ok('the sync saves the pictures before it writes the row',
  sync.indexOf('await savePictures(admin, extractPictures(') >= 0
  && sync.indexOf('await savePictures(admin, extractPictures(') < sync.indexOf(".from('user_emails')\n    .upsert("))
/* PRESENCE BEFORE ORDER -- indexOf returns -1, so an order-only assertion passes vacuously the
   day the thing it orders is deleted. */
const writeAt = route.indexOf('.update(bodyToStore(')
const respondAt = route.indexOf('res.status(200).json({\n        ok: true,\n        text: body.text,')
ok('both the write-back and the answer are there', writeAt >= 0 && respondAt >= 0)
ok('...and the message is answered after the cache is filled', writeAt < respondAt)

/* ---------------------------------------------------------------------------------------------
 * AND THE BROWSER ASKS RAPTOR BEFORE IT ASKS A MAIL SERVER
 * ------------------------------------------------------------------------------------------- */

const lib = read('src/lib/userMail.ts')
ok('there is a cached read', /export async function fetchCachedBody/.test(lib))
/* THE FOUR COLUMNS AND NOTHING ELSE. This runs on every open; selecting the row would carry the
   recipients, the links and five embedded joins for a body. */
ok('...taking the body and nothing else',
  /\.select\('body_text, body_html, body_calendar, body_cached_at'\)/.test(lib))
/* YOUR OWN MAIL. Not asserted as a filter here -- the select carries no user_id and does not need
   one, because the row's select policy is `user_id = auth.uid()` and this read goes through it.
   The uncached path runs with the service key, which is why IT checks by hand. */
ok('the privacy rule is the database’s, as it is for the list',
  /user_emails_own_select/.test(read('supabase/schema.sql')))

const page = read('src/pages/mail/MailPage.tsx')
ok('the page asks for the cached body first', /cached = await fetchCachedBody\(mail\.id\)/.test(page))
/* AND STOPS THERE where the message draws no pictures, which is the whole win: no request, no
   mail server, no serverless cold start. */
ok('...and does not go to the mailbox when there is nothing left to fetch',
  /if \(!cached\.pictures\) \{[\s\S]{0,160}return/.test(page))
/* NO SPINNER ON A READ THAT TAKES A FEW TENS OF MILLISECONDS: one that appears and vanishes
   inside a frame is a flicker that makes a fast screen feel broken. */
ok('...without a spinner on the fast path', /setReading\(cached \? null : mail\.id\)/.test(page))
/* AND A MAILBOX THAT CANNOT BE REACHED IS NOT AN ERROR WHERE THE MESSAGE IS ALREADY ON SCREEN --
   only its pictures are missing, and a warning that fires when nothing is wrong is worse than
   none. */
ok('...and a failed picture fetch does not report a message nobody can read',
  /if \(!cached\) \{\s*\n\s*setReadError/.test(page))

/* ---------------------------------------------------------------------------------------------
 * AND THE PAGE READS AHEAD, SO THE BACKLOG IS FAST TOO
 * ------------------------------------------------------------------------------------------- */

/*
 * THE FIRM, asked where the worst wait still is: "clicking on a mail to read it."
 *
 * The sync fixes every message that arrives from now on and the write-back fixes a message the
 * SECOND time it is opened. The mail already sitting in the mailbox -- which is most of what
 * anybody is reading this week -- is still a trip to the mail server the first time it is
 * clicked. So the top of the list is fetched BEFORE the click.
 *
 * The behaviour is checked in a browser, in e2e/mail, by counting the requests; what is held here
 * is that the rules it depends on are still written down.
 */
/* THE LIST KNOWS WHICH ROWS ARE ALREADY HELD, which is what stops it warming them again. */
ok('the list carries the stamp', /body_cached_at,/.test(lib))
ok('...and never the body itself, which is why the list is fast',
  !/\bbody_html\b[\s\S]{0,40}\bbody_text\b/.test(lib.slice(lib.indexOf('const COLUMNS'), lib.indexOf('const COLUMNS') + 900)))
ok('...read onto the row by hand', /cached: !!r\.body_cached_at/.test(lib))

/* A HANDFUL AT A TIME AND A CAP ON THE SITTING. Mail servers cap connections per account; warming
   a thousand-message mailbox on open takes it down for the person actually reading. */
ok('the page reads a screen ahead', /const WARM_AHEAD = \d+/.test(page))
ok('...and stops after a sitting’s worth', /const WARM_SITTING_MAX = \d+/.test(page))
ok('...one at a time rather than all at once', /for \(const mail of queue\) \{/.test(page))
/*
 * AND KEYED ON WHICH MESSAGES ARE ON SCREEN RATHER THAN ON THE ARRAY. `items` is rebuilt whenever
 * a flag on one row changes -- marking a message read maps the whole list -- so an effect keyed on
 * the array read ahead for six more messages on every click.
 */
ok('...on a new list rather than on every re-render',
  /\}, \[items\.map\(\(m\) => m\.id\)\.join\(','\), session\?\.access_token\]\)/.test(page))
ok('...and never the same message twice in one sitting', /!warmed\.current\.has\(m\.id\)/.test(page))
/* SILENT WHEN IT FAILS: nobody asked for these. An error about a message somebody has not clicked
   is a warning that fires when nothing has gone wrong. */
ok('...and says nothing when it cannot', /SILENT, AND DELIBERATELY SO/.test(page))

/*
 * THE PICTURE STORE, FROM THE BROWSER (S11). A cached message's logos come out of the store, and
 * only what the store does not answer sends the page to the mailbox.
 */
ok('the cached read fetches its pictures from the store',
  /const images = hashes\.length > 0 \? await fetchStoredPictures\(hashes\)/.test(lib))
ok('...out of the private mail-pictures bucket', /storage\.from\('mail-pictures'\)\.download\(/.test(lib))
ok('...remembered for the sitting, so the firm’s own logo downloads once', /pictureMemory\.set\(hash, dataUri\)/.test(lib))
ok('...and only pictures the store did not answer count as missing',
  /pictures: needsPictures\(images\.reduce\(/.test(lib))
ok('the page draws the stored pictures', /setBodyImages\(\(i\) => \(\{ \.\.\.i, \[mail\.id\]: cached\.images \}\)\)/.test(page))
/* AND THE 30 DAYS: the firm's number, run by the cron that already runs every five minutes. */
const store = read('api/_lib/mailPictures.ts')
ok('a picture unused for 30 days is deleted', /PICTURE_EXPIRY_DAYS = 30\b/.test(store))
ok('...by the sync cron', /expireMailPictures\(admin\)/.test(read('api/_lib/email/sync-all.ts')))
ok('...the file before the row, so no file is ever orphaned',
  store.indexOf('.remove(hashes.map(picturePath))') >= 0
  && store.indexOf('.remove(hashes.map(picturePath))') < store.indexOf(".from('mail_pictures').delete()"))
ok('the store table is in the schema', /create table if not exists public\.mail_pictures/.test(read('supabase/schema.sql')))

/* THE COLUMNS EXIST. A select naming a column that is not there empties the whole request, which
   is what check-select-columns exists for -- this is the schema half of the same guard. */
const schema = read('supabase/schema.sql')
for (const col of ['body_text', 'body_html', 'body_calendar', 'body_cached_at']) {
  ok(`${col} is in the schema`, new RegExp(`add column if not exists ${col}`).test(schema))
}

console.log(`\ncheck-mail-body-cache: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
