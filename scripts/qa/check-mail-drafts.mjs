/**
 * UNSENT EMAIL IS KEPT, BACKSPACE NEVER LEAVES THE BOX, A FORWARD OPENS AT ONCE, AND A SENT COPY THAT DID
 * NOT FILE SAYS SO (S15, Raptor · Handover 14). Stephan: forwarding "takes very long to load"; "if I highlight
 * a specific area ... and I press backspace, it takes me out of that email draft"; "add a drafts section";
 * "it told me that it forwarded, but it's not in my sent items ... I refreshed. It's not even there."
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-mail-drafts.mjs
 */
import fs from 'node:fs'

const store = new Map()
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }
const { saveDraft, findDraft, listDrafts, dropDraft, draftKeyFor } = await import('../../src/lib/mailDrafts.ts')

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass += 1
  else failures.push(`${name}\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`)
}
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

const k1 = draftKeyFor({ forwardOf: 'm1', title: 'Forward', subject: 'Fwd: x' })
const k2 = draftKeyFor({ forwardOf: 'm2', title: 'Forward', subject: 'Fwd: x' })
check('a forward of one message is not a forward of another', k1 === k2, false)
check('the same box opened again finds its own key', k1, draftKeyFor({ forwardOf: 'm1', title: 'Forward', subject: 'Fwd: x' }))
saveDraft({ key: k1, title: 'Forward', to: 'a@b.co.za', cc: '', subject: 'Fwd: x', body: 'Please see', inReplyTo: null, quotedHtml: '<p>orig</p>' })
check('a draft is kept and found again', findDraft(k1)?.body, 'Please see')
check('...with the edited original', findDraft(k1)?.quotedHtml, '<p>orig</p>')
saveDraft({ key: k1, title: 'Forward', to: 'a@b.co.za', cc: '', subject: 'Fwd: x', body: 'Please see below', inReplyTo: null, quotedHtml: 'x'.repeat(200000) })
check('saving again replaces, never doubles', listDrafts().length, 1)
check('...and an original too big to keep keeps the words only', findDraft(k1)?.quotedHtml ?? null, null)
dropDraft(k1)
check('sending removes it', findDraft(k1), null)
const broken = globalThis.localStorage
globalThis.localStorage = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
check('a browser that will not store anything is no draft, never an error', (() => { try { saveDraft({ key: 'z', title: '', to: '', cc: '', subject: '', body: 'x', inReplyTo: null, quotedHtml: null }); return listDrafts() } catch { return 'threw' } })(), [])
globalThis.localStorage = broken

const compose = strip(fs.readFileSync('src/components/ComposeEmailModal.tsx', 'utf8'))
check('the compose box saves as it is typed, after a pause', /saveDraft\(\{ key: draftKey/.test(compose) && /setTimeout\(/.test(compose), true)
check('...offers it back when the same box opens', /findDraft\(draftKey\)/.test(compose) && /data-testid="draft-restore"/.test(compose), true)
check('...and drops it once sent, before saying so', compose.indexOf('dropDraft(draftKey)\n      onSent(') > 0, true)
check('the forwarded original is shown, and editable', /contentEditable=\{!quotedLoading\}/.test(compose), true)
check('...and what is SENT is what the box holds', /quotedHtml \? \(quoteRef\.current\?\.innerHTML \?\? quotedHtml\) : ''/.test(compose), true)
check('Send waits while the original is still on its way', /disabled=\{submitting \|\| fetchingForward \|\| quotedLoading\}/.test(compose), true)
const modal = strip(fs.readFileSync('src/components/ui/Modal.tsx', 'utf8'))
check('Backspace outside a box you type in never means Back inside a dialog',
  /e\.key === 'Backspace'/.test(modal) && /isContentEditable/.test(modal) && /if \(!typing\) e\.preventDefault\(\)/.test(modal), true)
const mail = strip(fs.readFileSync('src/pages/mail/MailPage.tsx', 'utf8'))
const fwd = mail.slice(mail.indexOf('async function startForward'), mail.indexOf('async function startForward') + 900)
check('a forward opens before the original is fetched', fwd.indexOf('loading: true') > 0 && fwd.indexOf('loading: true') < fwd.indexOf('await fetchMailBody'), true)
check('...and the original only fills the forward that asked for it', /f\?\.mail\.id === mail\.id/.test(fwd), true)
check('the Mail page lists drafts', /data-testid="mail-drafts-tab"/.test(mail) && /listDrafts\(\)/.test(mail), true)
check('a copy that did not reach Sent Items is said, not hidden', /filedInSent === false/.test(mail), true)
const as = strip(fs.readFileSync('api/_lib/email/sendAsUser.ts', 'utf8'))
check('the Sent copy failing is logged with its reason, never a bare catch', /the Sent copy was not filed: /.test(as) && !/catch \{\s*\}/.test(as), true)
const send = strip(fs.readFileSync('api/_lib/email/send.ts', 'utf8'))
check('the sent copy goes on the Sent list at once, keyed as the sync keys it', /from\('user_emails'\)\.upsert\(/.test(send) && /onConflict: 'user_id,message_id', ignoreDuplicates: true/.test(send), true)
check('...only where the server said which uid it filed it under', /if \(copy\?\.uid && result\.messageId\)/.test(send), true)
check('...and the screen is told whether it filed', /filedInSent: !!copy/.test(send), true)

if (failures.length) {
  console.log(`check-mail-drafts: ${pass} passed, ${failures.length} failed`)
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`check-mail-drafts: ${pass} passed, 0 failed`)
