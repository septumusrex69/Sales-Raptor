/**
 * A FORWARD KEEPS THE MESSAGE'S FILES (R-8). The firm: "When you forward an email it removes the
 * attachment can we please keep the attachment and remove it manually if we have to."
 *
 * Holds: what fits goes and what does not is NAMED (never silently dropped), and all three
 * places that forward an email hand the composer the original's files.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-forward-attachments.mjs
 */
import { readFileSync } from 'node:fs'
import { planForwardAttachments, leftOffNote, fetchForwardAttachments } from '../../src/lib/forwardAttachments.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) pass++
  else failures.push(`${name}\n     expected ${e}\n     actual   ${a}`)
}

const f = (filename, size) => ({ filename, size })
const plan = planForwardAttachments([
  { name: 'a.pdf', file: f('a.pdf', 100) },
  { name: 'b.pdf', file: f('b.pdf', 950) },
  { name: 'c.jpg', file: null },
  { name: 'd.png', file: f('d.png', 50) },
], 1000)
check('what fits goes, in order', plan.kept.map((x) => x.filename), ['a.pdf', 'd.png'])
check('what is too big or failed is named', plan.left, ['b.pdf', 'c.jpg'])
check('all fitting leaves nothing and says nothing', leftOffNote([]), '')
check('a left-off file is named in the note', /b\.pdf/.test(leftOffNote(['b.pdf'])), true)

/* The fetcher, with a stand-in for the mailbox. */
const blob = (text, type) => new Blob([text], { type })
globalThis.FileReader = class {
  readAsDataURL(b) { b.arrayBuffer().then((buf) => { this.result = `data:;base64,${Buffer.from(buf).toString('base64')}`; this.onload() }) }
}
const got = await fetchForwardAttachments({
  mailId: 'm1', names: ['ok.pdf', 'gone.pdf'], accessToken: 't', maxBytes: 1000,
  fetchOne: async ({ filename }) => { if (filename === 'gone.pdf') throw new Error('x'); return blob('hello', 'application/pdf') },
})
check('a fetched file keeps name, type and content', got.files, [{ filename: 'ok.pdf', contentType: 'application/pdf', size: 5, content: 'aGVsbG8=' }])
check('a file that could not be fetched is named', got.left, ['gone.pdf'])

/* Wiring: every forward hands the composer the original's files. */
const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const has = (p, re) => re.test(src(p))
check('mail page forward passes the files', has('src/pages/mail/MailPage.tsx', /forwardAttachments=\{\{ mailId: forwarding\.mail\.id, names: forwarding\.mail\.attachmentNames/), true)
check('account forward passes the files', has('src/pages/accounts/AccountDetail.tsx', /forwardAttachments=\{forwardOf[\s\S]{0,80}forwardOf\.attachmentNames/), true)
check('ticket forward passes the files', has('src/pages/queries/QueryDetail.tsx', /forwardAttachments=\{forwarding[\s\S]{0,80}forwarding\.attachmentNames/), true)
check('the composer fetches them and holds Send until they arrive', has('src/components/ComposeEmailModal.tsx', /disabled=\{submitting \|\| fetchingForward\}/), true)

console.log(`\ncheck-forward-attachments: ${pass} passed, ${failures.length} failed`)
if (failures.length) { console.log(failures.join('\n')); process.exit(1) }
