/**
 * SIGNING A DOCUMENT ONLINE, AND THE THREE THINGS THAT MAKE IT SAFE TO DO WITH NO PASSWORD.
 *
 * THE FIRM: "building the online signature for the AOD... make space for where there can be
 * signatures like at the bottom of the pages for initials and stuff. For that you can basically
 * build in an online signature platform. Forget about the OTP for now. Just anyone with a link can
 * open it, for testing."
 *
 * "ANYONE WITH A LINK" IS A SECURITY MODEL, not the absence of one, and it only holds while three
 * things are true: the token cannot be guessed, the token cannot be used to find anything but its
 * own row, and what was signed cannot change afterwards. Most of this file is those three.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-signing.mjs
 */
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import {
  SIGNING_CLOSED, TOKEN_BYTES, isOpen, newToken, signingLink, urlSafe,
} from '../../src/lib/signingRules.ts'
import { blankLetter, fillLetter } from '../../src/lib/letterDocument.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const code = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[ \t]*\/\/.*$/gm, ' ')

const sql = read('supabase/schema.sql')
const lib = code('src/lib/signingRules.ts')
const page = code('src/pages/sign/SignPage.tsx')
const pad = code('src/components/ui/SignaturePad.tsx')
const app = code('src/App.tsx')

/* ---------------------------------------------------------------------------------------------
 * ONE: THE TOKEN CANNOT BE GUESSED
 * ------------------------------------------------------------------------------------------- */

check('a token is 32 bytes', TOKEN_BYTES, 32)
/* 32 bytes base64 is 43 characters once the padding is dropped. Asserted on the real output
   rather than on the constant, because the encoder is where a token gets shortened by accident. */
const token = newToken(webcrypto)
check('...which is 43 characters', token.length, 43)
/* THE CSPRNG, NEVER Math.random. A token a clock can be seeded into is a token that can be walked,
   and these documents carry an ID number, a balance and shortly a signature. */
ok('it comes from the platform CSPRNG', /getRandomValues/.test(lib))
ok('...and never from Math.random', !/Math\.random/.test(lib))
/* AND TWO OF THEM DIFFER, which is the assertion that actually fails if somebody returns a
   constant. A thousand draws with no repeat is cheap and is the whole point of the field. */
const many = new Set(Array.from({ length: 1000 }, () => newToken(webcrypto)))
check('...and a thousand of them are a thousand', many.size, 1000)

/*
 * URL-SAFE, AND THE THREE CHARACTERS ARE THE WHOLE REASON.
 *
 * A '+' in a token becomes a SPACE the moment the link goes through anything that form-decodes it,
 * and the signer then meets "this link is not valid" on a document they were asked to sign. The
 * padding goes for the same reason: a trailing '=' is what a mail client cuts when it decides
 * where a link ends.
 */
const all = urlSafe(Uint8Array.from({ length: 256 }, (_, i) => i))
ok('no plus survives encoding', !all.includes('+'))
ok('...no slash either', !all.includes('/'))
ok('...and no padding', !all.includes('='))
ok('...and what is left is url-safe', /^[A-Za-z0-9_-]+$/.test(all))

/* THE LINK IS ABSOLUTE, because it is pasted into an email and a relative path is not a link. */
check('the link is built from the origin it was made on',
  signingLink('abc', 'https://raptor.example.com'), 'https://raptor.example.com/sign/abc')
/* A TRAILING SLASH ON THE ORIGIN MUST NOT DOUBLE. "//sign/abc" is a protocol-relative URL to a
   host called "sign", which is a link that leaves the site entirely. */
check('...with no doubled slash', signingLink('abc', 'https://x.test/'), 'https://x.test/sign/abc')

/* ---------------------------------------------------------------------------------------------
 * TWO: THE TOKEN FINDS NOTHING BUT ITS OWN ROW
 * ------------------------------------------------------------------------------------------- */

/*
 * THE ANON ROLE HAS NO RIGHTS ON THE TABLE. This is the one that matters most: a table grant plus
 * any readable policy would let anybody list every acknowledgement of debt the firm has ever sent,
 * each carrying a person's ID number and their balance.
 */
ok('the anon role is revoked from the table',
  /revoke all on table public\.signing_requests from anon/.test(sql))
/* AND THE DOORS IT DOES HAVE ARE THE TWO FUNCTIONS, both taking a token. */
ok('opening is granted to anon', /grant execute on function public\.signing_open\(text\) to anon/.test(sql))
ok('...and signing is too', /grant execute on function public\.signing_sign\([^)]*\) to anon/.test(sql))

const openFn = sql.slice(sql.lastIndexOf('create or replace function public.signing_open('))
ok('opening is security definer', /security definer/.test(openFn.slice(0, 600)))
ok('...pinned to the public schema', /set search_path to 'public'/.test(openFn.slice(0, 600)))
ok('...and matches on the token', /where r\.token = p_token/.test(openFn.slice(0, 900)))
/*
 * IT RETURNS WHAT THE SIGNER MAY SEE AND NOTHING MORE. A debtor opening their own acknowledgement
 * of debt has no business holding Raptor's internal keys, and a link forwarded to a third party
 * should hand over the document and no more.
 */
const returns = openFn.slice(0, openFn.indexOf('language sql'))
for (const leak of ['account_id', 'created_by', 'signed_ip', 'signer_email']) {
  ok(`...and never hands out ${leak}`, !returns.includes(leak))
}

/* ---------------------------------------------------------------------------------------------
 * THREE: IT CAN ONLY BE SIGNED ONCE, AND THE DATABASE IS WHAT SAYS SO
 * ------------------------------------------------------------------------------------------- */

const signFn = sql.slice(sql.lastIndexOf('create or replace function public.signing_sign('))
/*
 * THE UPDATE MATCHES ON state = 'sent'. A second submission -- a double tap, a retried request, a
 * forwarded link opened twice -- changes no rows. A check in the browser is one the browser can be
 * talked past, and the thing being protected is the only copy of somebody's signature.
 */
ok('signing only matches a request still waiting', /and state = 'sent'/.test(signFn))
ok('...and reports whether it actually did anything', /get diagnostics v_done = row_count/.test(signFn))
/* NOT AN EXCEPTION on a second attempt: a link already used is an ordinary thing for a signer to
   meet, and an error there reads as a fault in the firm's system. */
ok('...returning false rather than raising', /return v_done > 0/.test(signFn))
/* BOTH MARKS ARE REQUIRED. ECTA s13 wants a method that identifies the person AND indicates their
   approval; a drawn squiggle alone identifies nobody. */
ok('a signature is required', /Sign in the box before submitting/.test(signFn))
ok('...and so is a typed name', /Type your full name before submitting/.test(signFn))
ok('...and the page asks for both too',
  /Your signature/.test(page) && /Your full name/.test(page))
/* AND FOR THE INTENTION, which is the third limb: somebody has to mean it. */
ok('...and that they meant it', /I intend my signature above to be my signature on it/.test(page))

/* ---------------------------------------------------------------------------------------------
 * WHAT WAS SIGNED CANNOT CHANGE AFTERWARDS
 * ------------------------------------------------------------------------------------------- */

/*
 * THE BLOCKS ARE ANSWERED AT SEND TIME. Everywhere else in Raptor a letter merges as it is drawn,
 * which is right for a notice the firm prints today. It is wrong for an instrument somebody signs:
 * a document that re-merged itself would show the court a different balance from the one the
 * debtor agreed to.
 */
const filled = fillLetter(
  { ...blankLetter(), blocks: [{ kind: 'paragraph', spans: [{ text: 'I owe {{balance}} on {{case_number}}.' }] }] },
  { balance: 'R 2 500,81', case_number: 'RAP-123855' },
)
check('the stored document has its figures in it',
  filled.blocks[0].spans[0].text, 'I owe R 2 500,81 on RAP-123855.')
/* EVERY KIND OF BLOCK, not just paragraphs. A field left standing inside a table cell is a set of
   braces on a signed instrument, and the firm's acknowledgement of debt is mostly tables. */
const everywhere = fillLetter({ ...blankLetter(), blocks: [
  { kind: 'heading', level: 1, spans: [{ text: 'For {{debtor_name}}' }] },
  { kind: 'list', ordered: false, items: [[{ text: 'Account {{case_number}}' }]] },
  { kind: 'table', rows: [[{ spans: [{ text: '{{balance}}' }] }]] },
  { kind: 'signature', widthMm: 70, spans: [{ text: '{{debtor_name}}' }] },
] }, { debtor_name: 'Promise Sikelele', case_number: 'RAP-1', balance: 'R 1,00' })
check('a heading is answered', everywhere.blocks[0].spans[0].text, 'For Promise Sikelele')
check('...a list item too', everywhere.blocks[1].items[0][0].text, 'Account RAP-1')
check('...a table cell too', everywhere.blocks[2].rows[0][0].spans[0].text, 'R 1,00')
check('...and the line somebody signs on', everywhere.blocks[3].spans[0].text, 'Promise Sikelele')
/* AND NOTHING IS LEFT UNANSWERED ANYWHERE. The assertion the four above are really making, said
   once against the whole document, so a block kind added later cannot slip through. */
ok('no merge field survives into a signed document',
  !JSON.stringify(everywhere).includes('{{'))

ok('the panel freezes what it sends', /fillLetter\(doc, values\)\.blocks/.test(code('src/pages/accounts/SigningPanel.tsx')))
/* AND THE SIGNING PAGE MERGES NOTHING, because there is nothing left in them to merge. Passing
   real values there would be a second, later resolution -- the exact thing being prevented. */
ok('...and the signing page resolves nothing itself', /filled: true, values: \{\} \}/.test(page))

/* ---------------------------------------------------------------------------------------------
 * THE PAGE IS OUTSIDE THE FIRM
 * ------------------------------------------------------------------------------------------- */

/*
 * ABOVE RequireAuth. A debtor has no Raptor login and never will; inside the guard they would be
 * bounced to a login page they cannot pass, and inside AppLayout they would be shown the firm's
 * own navigation on the way through.
 */
const guard = app.indexOf('<RequireAuth>')
const route = app.indexOf('path="/sign/:token"')
ok('the signing route exists', route > 0)
ok('...and is mounted above the auth guard', route > 0 && guard > 0 && route < guard)

/* A LINK THAT FINDS NOTHING SAYS SO WITHOUT CONFIRMING WHICH TOKENS EXIST -- the same reason a
   login says "wrong email or password" rather than which of the two. */
ok('a dead link does not say why', /No document here/.test(page))
ok('...and never names the token', !/token.*does not exist|no such token/i.test(page))

/* THE FOUR STATES EACH HAVE A SENTENCE, so nobody telephones the firm about a link that is
   behaving correctly. */
for (const state of ['signed', 'declined', 'cancelled']) {
  ok(`a ${state} request explains itself`, (SIGNING_CLOSED[state] ?? '').length > 20)
}
ok('only a sent request can be signed',
  isOpen('sent') && !isOpen('signed') && !isOpen('declined') && !isOpen('cancelled'))

/* ---------------------------------------------------------------------------------------------
 * AND THE BOX YOU SIGN IN WORKS ON A TABLET, WHICH IS WHAT THE FIRM USES
 * ------------------------------------------------------------------------------------------- */

/*
 * touch-action: none IS LOAD-BEARING. Without it the browser treats the first drag as a scroll,
 * the page moves under the finger and nothing is drawn -- the single commonest reason a signature
 * pad appears broken on a tablet.
 */
ok('the pad does not let the browser scroll instead', /touchAction: 'none'/.test(pad))
/*
 * AND THE STROKE FOLLOWS THE FINGER OFF THE EDGE. Without pointer capture a signature that
 * overshoots the box stops dead at the boundary, which is how one comes out missing its last
 * letter.
 */
ok('...and the stroke survives leaving the box', /setPointerCapture/.test(pad))
/* ONE SET OF HANDLERS for a mouse, a finger and a stylus. */
ok('...through pointer events rather than two code paths',
  /onPointerDown/.test(pad) && !/onTouchStart/.test(pad))
/* A TAP IS A MARK: a path with one point strokes nothing, so the first point is drawn to itself. */
ok('...and a single tap still draws', /ctx\.lineTo\(x, y\)\s*\n\s*ctx\.stroke\(\)/.test(pad))
/* THE PROMPT NEVER SWALLOWS THE FIRST STROKE, which is the one somebody makes before reading. */
ok('...and the placeholder is not in the way', /pointer-events-none/.test(pad))
/* RESIZING A CANVAS CLEARS IT, so the fit must not run on every render -- that would wipe a
   signature as it was being drawn. */
ok('...and refitting does not wipe what is drawn',
  /if \(canvas\.width === Math\.round\(width \* ratio\)/.test(pad))

/* INITIALS ARE THEIR OWN MARK, at the firm's request: "make space for where there can be
   signatures like at the bottom of the pages for initials and stuff". A page initial is not a
   small signature -- it says somebody read that page -- so it is captured separately. */
ok('initials are captured apart from the signature', /Your initials/.test(page))
ok('...and stored apart', /initials_png/.test(sql))

console.log(`\ncheck-signing: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
