/**
 * What a message carries when it leaves: the files, the copies, and what is written down.
 *
 * WHY THIS EXISTS. The firm's instruction is that collectors stop using Outlook and work from
 * Raptor. They could not: /api/email/send accepted `to, subject, bodyHtml, inReplyTo` and nothing
 * else, so there was no way to attach a statement, an acknowledgement of debt or a section 129
 * letter, and no way to copy a colleague. For a debt-collection firm that is not a missing
 * convenience, it is the reason the mailbox could not be anybody's mail client.
 *
 * Three things here fail SILENTLY if they regress, which is why they are checked rather than
 * trusted:
 *
 *   1. Bcc leaking into the Sent copy. The recipient's message never carried the header; if ours
 *      does, anyone later shown that message — in Outlook, or in Raptor's own Sent tab — can read
 *      who was blind-copied. Nothing errors. The blind copy simply stops being blind.
 *   2. The send and the filed copy drifting apart, so the agent's own record of what they sent is
 *      not the message the debtor received.
 *   3. Attachment names not being recorded on the account. A statement that was sent and not
 *      written down is one nobody can prove was sent, and proving it is the point of sending it.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-send-envelope.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)

const send = readFileSync(new URL('../../api/email/send.ts', import.meta.url), 'utf8')
const composer = readFileSync(new URL('../../src/components/ComposeEmailModal.tsx', import.meta.url), 'utf8')
const accountEmails = readFileSync(new URL('../../src/lib/accountEmails.ts', import.meta.url), 'utf8')

const flat = (s) => s.replace(/\s+/g, ' ')

/**
 * The source with its comments removed.
 *
 * Needed, and found the hard way: the assertion that we do NOT spread a whole byte array into
 * String.fromCharCode matched the comment directly above the code explaining why we don't. A
 * check that reads prose as code reports a bug in its own documentation.
 */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')

/**
 * One call's arguments, from `name({` to the brace that closes it.
 *
 * Counted rather than searched for. The first attempt cut at the first `})`, which on a call
 * containing `...(cc ? { cc } : {})` lands three lines in — so the Bcc and the threading looked
 * absent when they were simply past the cut, and the check failed on correct code.
 */
function callArgs(src, opening) {
  const at = src.indexOf(opening)
  if (at === -1) return ''
  let depth = 0
  for (let i = at + opening.length - 1; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(at, i + 1)
    }
  }
  return ''
}

/* ------------------------------------------------------------------ *
 * The endpoint accepts what a collector actually needs to send
 * ------------------------------------------------------------------ */

ok('send accepts a Cc', /\bcc\b/.test(send) && /\.\.\.\(cc \? \{ cc \} : \{\}\)/.test(send))
ok('send accepts a Bcc', /\.\.\.\(bcc \? \{ bcc \} : \{\}\)/.test(send))
ok('send accepts attachments', /attachments\?:/.test(send))
ok('...and decodes them from base64', /Buffer\.from\(file\.dataBase64, 'base64'\)/.test(send))

/* ------------------------------------------------------------------ *
 * The Bcc must NOT be in the copy filed in the Sent folder
 * ------------------------------------------------------------------ */

/*
 * The two envelopes are built separately — one by nodemailer to send, one by MailComposer to
 * append to IMAP — so this compares them rather than reading either alone.
 */
const sendAt = send.indexOf('transporter.sendMail({')
const sentCopyAt = send.indexOf('new MailComposer({')
// Presence before order, and before anything about contents: if either call is gone, every
// assertion below would read an empty string and pass by describing nothing.
ok('the message is sent', sendAt !== -1)
ok('...and a copy is filed in the Sent folder', sentCopyAt !== -1)

if (sendAt !== -1 && sentCopyAt !== -1) {
  const outgoing = flat(callArgs(code(send), 'transporter.sendMail({'))
  const sentCopy = flat(callArgs(code(send), 'new MailComposer({'))
  // Both were extracted before anything is concluded from them: an empty string would satisfy
  // "does NOT carry the Bcc" by carrying nothing whatever.
  ok('the outgoing envelope was extracted', outgoing.length > 40)
  ok('the Sent-copy envelope was extracted', sentCopy.length > 40)

  ok('the message carries the Cc', outgoing.includes('cc'))
  ok('the message carries the Bcc', outgoing.includes('bcc'))
  ok('the Sent copy carries the Cc', sentCopy.includes('{ cc }'))
  // THE ONE THAT MATTERS. A blind copy in the Sent folder is not blind.
  check('the Sent copy does NOT carry the Bcc', sentCopy.includes('{ bcc }'), false)

  // Both must send the same files, or the agent's record is not the message the debtor got.
  ok('the message carries the attachments', outgoing.includes('attachments: mailAttachments'))
  ok('...and so does the Sent copy', sentCopy.includes('attachments: mailAttachments'))
  ok('...and both thread the same way',
    outgoing.includes('inReplyTo') && sentCopy.includes('inReplyTo'))
}

/* ------------------------------------------------------------------ *
 * Only the signature is inline
 * ------------------------------------------------------------------ */

/*
 * A cid makes a part an inline image the HTML points at. Give a debtor's statement one and it
 * disappears from the attachment list in their mail client while still being in the message —
 * they are told a statement was attached and cannot find it.
 */
{
  const stripped = code(send)
  const at = stripped.indexOf('const outgoing = [')
  ok('the attachment list was found', at !== -1)
  if (at !== -1) {
    const list = flat(stripped.slice(at, stripped.indexOf('const mailAttachments', at)))
    ok('the signature keeps its cid', list.includes('cid: SIGNATURE_CID'))
    check('...and it is the only part that has one', (list.match(/cid:/g) ?? []).length, 1)
  }
}

/* ------------------------------------------------------------------ *
 * The size ceiling, refused by name rather than by the platform
 * ------------------------------------------------------------------ */

/*
 * Vercel caps the request body of a serverless function and base64 inflates a file by about a
 * third, so past roughly 3 MB the request never reaches our code at all. Checked here so the
 * agent is told which file is the problem instead of seeing a generic failure after writing a
 * demand letter.
 */
/*
 * The ENFORCEMENT, not the constant.
 *
 * The first version of this asserted that the name MAX_TOTAL_BYTES appeared in the file, and a
 * test-break that renamed its declaration sailed through — the name was still there in the lines
 * that used it. A limit that is declared and never compared is not a limit.
 */
{
  const stripped = code(send)
  ok('the server adds up what it has been handed', /totalBytes \+= content\.length/.test(stripped))
  ok('...compares it against the ceiling', /if \(totalBytes > MAX_TOTAL_BYTES\)/.test(stripped))
  ok('...and refuses the request', /if \(totalBytes > MAX_TOTAL_BYTES\)[\s\S]{0,120}status\(400\)/.test(stripped))
}
ok('...with an explanation rather than a status code alone',
  /more than can be sent in one message/.test(send))
ok('the composer checks the same ceiling before sending', /MAX_TOTAL_BYTES/.test(composer))
ok('...and says so as files are added', /tooBig/.test(composer))
ok('...and will not let Send be pressed', /disabled=\{submitting \|\| tooBig\}/.test(composer))

/*
 * Base64 in chunks, not one spread call.
 *
 * String.fromCharCode(...bytes) on a three-megabyte file spreads hundreds of thousands of
 * arguments into one call and throws a range error — on exactly the large attachment this
 * feature exists to carry, so the failure would only ever appear in real use.
 */
ok('the file is encoded in chunks', /i \+= 8192/.test(code(composer)))
check('...not by spreading the whole array', /fromCharCode\(\.\.\.bytes\)/.test(code(composer)), false)

/* ------------------------------------------------------------------ *
 * What went is written down
 * ------------------------------------------------------------------ */

ok('the server names the parts it sent back to the caller',
  /attachmentNames: files\.map\(\(f\) => f\.filename\)/.test(send))
ok('the composer hands them to whoever is recording the message',
  /responseBody\.attachmentNames/.test(composer))
ok('and the account copy records them',
  /attachment_names: input\.attachmentNames \?\? \[\]/.test(accountEmails))

/* ------------------------------------------------------------------ */

if (failures.length > 0) {
  console.error(`check-send-envelope: ${failures.length} FAILED, ${pass} passed\n`)
  for (const f of failures) console.error(`  ✗ ${f}\n`)
  process.exit(1)
}
console.log(`check-send-envelope: ${pass} checks passed`)
console.log(`
A message can carry files and copies, the blind copy stays blind in the Sent folder, and what
went with it is recorded on the account.`)
