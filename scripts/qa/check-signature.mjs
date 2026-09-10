/**
 * The signature block, and whether the image really travels inside the message.
 *
 * A remote image in a signature is blocked by Outlook, Gmail and Apple Mail until the reader
 * asks, so the block carrying the sender's face and numbers arrives as a grey box. The fix is to
 * embed it — and "embedded" is not something a typecheck can confirm, so the last check here
 * actually composes a message and looks for the bytes in it.
 *
 *   node --experimental-strip-types scripts/qa/check-signature.mjs
 */
import MailComposer from 'nodemailer/lib/mail-composer/index.js'
import { SIGNATURE_CID, composeBody, signatureHtml } from '../../api/_lib/signature.ts'

let failed = 0
function check(name, ok, detail) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok && detail) console.log(`        ${detail}`)
}

const image = { width: 320, align: 'left' }

/* The html. */
{
  const linked = signatureHtml('Felicia Thobejane\nSales Manager', image, 'https://cdn.example/sig.png')
  check('text newlines become line breaks', linked.includes('Felicia Thobejane<br>Sales Manager'))
  check('a linked image points at the url', linked.includes('src="https://cdn.example/sig.png"'))

  const embedded = signatureHtml(null, image, `cid:${SIGNATURE_CID}`)
  check('an embedded image points at the cid', embedded.includes(`src="cid:${SIGNATURE_CID}"`))
  check('the width is carried through', embedded.includes('width="320"'))
  check('alt is not empty — the picture holds the sender’s name and numbers',
    /alt="[^"]+"/.test(embedded))

  check('centre alignment sets auto margins', signatureHtml(null, { ...image, align: 'center' }, 'x').includes('margin:8px auto 0'))
  check('right alignment pushes it right', signatureHtml(null, { ...image, align: 'right' }, 'x').includes('margin:8px 0 0 auto'))

  check('no signature at all is empty', signatureHtml(null, null, null) === '')
  check('text with no image still works', signatureHtml('Regards', null, null) === 'Regards')
  // An image with nowhere to point is not rendered as a broken tag.
  check('an image with no source is dropped', signatureHtml('Regards', image, null) === 'Regards')

  check('the body is separated from the signature', composeBody('<p>Hi</p>', 'sig') === '<p>Hi</p><br><br>sig')
  check('a body with no signature is left alone', composeBody('<p>Hi</p>', '') === '<p>Hi</p>')
}

/*
 * The part that matters. Compose a real message the way send.ts does and confirm the picture is
 * in it — as an inline part the reader's client already holds, not a link it has to go and fetch.
 */
{
  // A one-pixel PNG is enough: what is being tested is that the bytes travel, not what they are.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const html = composeBody('<p>Hi Mel,</p>', signatureHtml(null, image, `cid:${SIGNATURE_CID}`))
  const raw = (await new MailComposer({
    from: 'felicia@bredellferreira.co.za', to: 'reception@bredellferreira.co.za', subject: 'Test', html,
    attachments: [{ filename: 'signature', content: png, contentType: 'image/png', cid: SIGNATURE_CID }],
  }).compile().build()).toString()

  check('the message declares an inline part', /Content-Disposition:\s*inline/i.test(raw))
  check('under the id the html points at', raw.includes(`<${SIGNATURE_CID}>`))
  check('carrying the image bytes', raw.includes(png.toString('base64').slice(0, 32)))
  check('and it is a related multipart, not an attachment list', /multipart\/related/i.test(raw))
  check('no http reference to the image is left in the body',
    !/src="https?:/.test(html), 'a linked src would still be blocked by Outlook')
}

console.log(failed === 0 ? '\nAll checks passed.\n' : `\n${failed} check(s) failed.\n`)
process.exit(failed ? 1 : 0)
