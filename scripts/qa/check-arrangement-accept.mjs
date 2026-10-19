/**
 * CONFIRM AND ACCEPT A PAYMENT ARRANGEMENT (S9, 19 Oct). The firm: "once a promise has been made and
 * it's been captured ... they should just click here to confirm and accept ... it's not going to be
 * an acknowledgement of debt. It's a signed document in terms of 4B ... 250."
 *
 * Holds: the document states the agreed terms and is not an acknowledgement of debt; only the
 * arrangement-confirmed email carries the button, in accept mode, linked to the promise; accepting
 * needs a typed name, writes who and when into the document, and only works once and only on an
 * accept request; item 4(b) is raised by the signed-copy route, claimed BEFORE it is charged so it is
 * raised once, and released if the charge fails.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-arrangement-accept.mjs
 */
import { readFileSync } from 'node:fs'
import { arrangementDocument, DOCUMENT_SIGNED_ITEM } from '../../src/lib/arrangementDocument.ts'

let pass = 0
const failures = []
const ok = (name, cond) => { if (cond) pass += 1; else failures.push(name) }
const check = (name, got, want) => ok(`${name}\n    expected ${JSON.stringify(want)}\n    got      ${JSON.stringify(got)}`, JSON.stringify(got) === JSON.stringify(want))
const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const textOf = (blocks) => JSON.stringify(blocks)

/* ---------- the document ---------- */
const doc = arrangementDocument({
  debtor_name: 'Mr Pompies', case_number: 'BF-004321', client_name: 'Rinda Roo', balance: 'R 12,500.00',
  ptp_amount: 'R 500.00', ptp_frequency: 'every month', ptp_date: '1 November 2026',
})
ok('it states the instalment, how often and the first payment', /R 500\.00/.test(textOf(doc)) && /every month/.test(textOf(doc)) && /1 November 2026/.test(textOf(doc)))
ok('...against our case number and the balance', /BF-004321/.test(textOf(doc)) && /R 12,500\.00/.test(textOf(doc)))
ok('...and is not an acknowledgement of debt (the firm’s word)', !/acknowledg|section 5[78]/i.test(textOf(doc)))
check('no instalment or no first date: no document to accept, nor to charge for',
  [arrangementDocument({ ptp_date: '1 Nov' }), arrangementDocument({ ptp_amount: 'R 500' })], [null, null])
check('accepting it is item 4(b)', DOCUMENT_SIGNED_ITEM, '4b')

/* ---------- the email ---------- */
const step = strip(read('api/_lib/workflow/step.ts'))
ok('only the arrangement-confirmed email carries it', /chosen\?\.seed_key\?\.startsWith\('email-ptp-confirmed'\) && promiseRow\?\.id && origin/.test(step))
ok('...as a request in accept mode, tied to the promise', /mode: 'accept', promise_id: promiseRow\.id/.test(step))
ok('...with the Confirm and accept button after the firm’s wording', /bodyHtml: emailBodyHtml\(bodyText\) \+ acceptHtml/.test(step) && /signingButtonHtml\(url, 'Confirm and accept'\)/.test(step))
ok('...and the address in the filed email too', /body: bodyText,/.test(step))
ok('...and nothing is charged when it is sent: nothing has been signed yet', !/DOCUMENT_SIGNED_ITEM/.test(step))
const origin = read('api/_lib/workflow/siteOrigin.ts')
ok('the link opens the deployment the email came from (a preview’s token is in staging)', /VERCEL_ENV === 'production'/.test(origin) && /VERCEL_BRANCH_URL/.test(origin))

/* ---------- accepting ---------- */
const sql = read('supabase/schema.sql')
const fn = sql.slice(sql.lastIndexOf('create or replace function public.signing_accept('))
const accept = fn.slice(0, fn.indexOf('$$;'))
ok('a typed name is required', /if v_name = '' then\s+raise exception/.test(accept))
ok('...only an accept request, only once, only while open', /r\.state = 'sent' and r\.mode = 'accept'/.test(accept) && /expires_at is null or r\.expires_at > now\(\)/.test(accept))
ok('...and who and when are written into the document itself', /body = r\.body \|\| jsonb_build_array/.test(accept) && /Confirmed and accepted online by/.test(accept))
ok('...callable by the debtor, who is not signed in', /grant execute on function public\.signing_accept\(text, text, text\) to anon, authenticated/.test(sql))
const doc2 = sql.slice(sql.lastIndexOf('create or replace function public.signing_document('))
ok('the page is told the mode', /r\.mode/.test(doc2.slice(0, doc2.indexOf('$$;'))))
const page = strip(read('src/pages/sign/SignPage.tsx'))
ok('the page asks no drawing on an acceptance', /request\?\.mode !== 'accept' && \(<>\s*<SignaturePad/.test(page))
ok('...and calls signing_accept, then the copy-and-charge route', /\? await acceptDocument\(\{ token, name: signer \}\)/.test(page) && /\/api\/email\/signed-copy/.test(page))

/* ---------- the charge ---------- */
const copy = strip(read('api/_lib/email/signedCopy.ts'))
const claimAt = copy.indexOf(".update({ fee_charged_at: new Date().toISOString() })")
const chargeAt = copy.indexOf('chargeItemWith(admin as unknown as ChargeDb')
ok('item 4(b) is raised by the signed-copy route', chargeAt > 0 && /itemId: DOCUMENT_SIGNED_ITEM/.test(copy))
ok('...only for an accepted arrangement on an account, not yet charged', /request\.mode === 'accept' && request\.account_id && !request\.fee_charged_at/.test(copy))
ok('...claimed BEFORE it is charged, so two calls raise it once', claimAt > 0 && claimAt < chargeAt && /\.is\('fee_charged_at', null\)/.test(copy))
ok('...and released if the charge fails, so it is not silently never raised', /update\(\{ fee_charged_at: null \}\)/.test(copy))
ok('...before the copy is claimed: a copy already sent does not skip the charge',
  chargeAt > 0 && chargeAt < copy.indexOf("if (!request || request.state !== 'signed' || request.copy_sent_at)"))

if (failures.length) { console.error(`check-arrangement-accept: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`); process.exit(1) }
console.log(`check-arrangement-accept: ${pass} passed, 0 failed`)
