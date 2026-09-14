/**
 * Can Raptor take a message apart without downloading all of it?
 *
 * WHY THIS MATTERS ENOUGH TO TEST. Reading an email used to mean pulling the whole thing across
 * from Johannesburg — every attachment included — so that a collector could read three
 * paragraphs. It now asks the server what the message is MADE of and fetches only the pieces
 * somebody will look at. That is a large speed win and a new way to be wrong: get a part number
 * or a content-transfer-encoding wrong and nothing throws, the debtor's email simply renders as
 * mojibake or as nothing at all.
 *
 * THE STRUCTURES ARE REAL. Rather than hand-writing what I think a BODYSTRUCTURE looks like —
 * which would only test my own assumption twice — these go through imapflow's own response
 * parser, the same code that runs against the live mail server. If my reading of the format is
 * wrong, these fail.
 *
 *   node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-mime-parts.mjs
 */
import { createRequire } from 'node:module'
import {
  assembleBody, decodeQuotedPrintable, decodeTransfer, describeParts, flattenParts,
  inlineImagesFromParsed, partContent, plainText, readableParts, toText,
} from '../../api/_lib/mime.ts'

const require = createRequire(import.meta.url)
const handler = require('imapflow/lib/handler/imap-handler')
const tools = require('imapflow/lib/tools')

let failures = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) {
    failures += 1
    console.error(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`)
  } else {
    console.log(`ok   ${name}`)
  }
}

/** A BODYSTRUCTURE as a mail server would send it, parsed by imapflow's own parser. */
async function structure(bodystructure) {
  const line = `* 1 FETCH (BODYSTRUCTURE ${bodystructure})`
  const parsed = await handler.parser(Buffer.from(line), { literals: [] })
  return tools.parseBodystructure(parsed.attributes[1][1])
}

/* ---------------------------------------------------------------- *
 * The message this whole rewrite is about
 *
 * A debtor replies, signs off with a picture, and attaches a four-megabyte scan of a mandate.
 * The old code fetched all four megabytes to show three paragraphs, and threw the signature away.
 * ---------------------------------------------------------------- */

const TEXT = '("TEXT" "PLAIN" ("CHARSET" "utf-8") NIL NIL "QUOTED-PRINTABLE" 120 4 NIL NIL NIL NIL)'
const HTML = '("TEXT" "HTML" ("CHARSET" "utf-8") NIL NIL "QUOTED-PRINTABLE" 900 12 NIL NIL NIL NIL)'
const SIG = '("IMAGE" "PNG" ("NAME" "sig.png") "<sig@bredellferreira.co.za>" NIL "BASE64" 41000 NIL ("INLINE" ("FILENAME" "sig.png")) NIL NIL)'
const PDF = '("APPLICATION" "PDF" ("NAME" "mandate.pdf") NIL NIL "BASE64" 4200000 NIL ("ATTACHMENT" ("FILENAME" "mandate.pdf")) NIL NIL)'

const realMessage = await structure(
  `(((${TEXT}${HTML} "ALTERNATIVE" ("BOUNDARY" "alt") NIL NIL NIL)${SIG} "RELATED" ("BOUNDARY" "rel") NIL NIL NIL)${PDF} "MIXED" ("BOUNDARY" "mix") NIL NIL NIL)`,
)
const real = flattenParts(realMessage)

check('every leaf is found, with the part number BODY[...] takes',
  real.map((p) => `${p.part}:${p.type}`),
  ['1.1.1:text/plain', '1.1.2:text/html', '1.2:image/png', '2:application/pdf'])

check('the signature keeps the cid its HTML refers to it by', real[2].cid, 'sig@bredellferreira.co.za')
check('the attachment keeps its filename, for the download route to match on',
  real[3].filename, 'mandate.pdf')
check('the encoding is carried, because we now undo it ourselves', real[0].encoding, 'quoted-printable')
check('the charset is carried, or every apostrophe becomes a question mark', real[0].charset, 'utf-8')

check('only the parts a person will look at are fetched — NOT the four-megabyte scan',
  readableParts(real).parts.map((p) => p.part),
  ['1.1.1', '1.1.2', '1.2'])

/* ---------------------------------------------------------------- *
 * What it refuses to fetch, which is the half that keeps it fast
 * ---------------------------------------------------------------- */

const pixel = '("IMAGE" "GIF" NIL "<px@track>" NIL "BASE64" 60 NIL ("INLINE" NIL) NIL NIL)'
const huge = '("IMAGE" "JPEG" ("NAME" "photo.jpg") "<p@x>" NIL "BASE64" 3000000 NIL ("INLINE" NIL) NIL NIL)'
const attachedHtml = '("TEXT" "HTML" ("CHARSET" "utf-8") NIL NIL "BASE64" 400 6 NIL ("ATTACHMENT" ("FILENAME" "report.html")) NIL NIL)'

const noisy = flattenParts(await structure(
  `(${TEXT}${pixel}${huge}${attachedHtml} "MIXED" ("BOUNDARY" "m") NIL NIL NIL)`,
))
check('a tracking pixel is not a signature', readableParts(noisy).parts.map((p) => p.part), ['1'])
// A pixel was never going to be looked at, so it is not reported as missing. A three-megabyte
// photograph WAS, so it is — a blank space with no explanation is how this got reported broken.
check('the pixel is not counted as something we failed to show', readableParts(noisy).skippedImages, 1)

const plainImage = '("IMAGE" "PNG" ("NAME" "chart.png") NIL NIL "BASE64" 40000 NIL ("ATTACHMENT" ("FILENAME" "chart.png")) NIL NIL)'
check('an image ATTACHED rather than drawn in stays in the attachment list, not the body',
  readableParts(flattenParts(await structure(
    `(${TEXT}${plainImage} "MIXED" ("BOUNDARY" "m") NIL NIL NIL)`,
  ))).parts.map((p) => p.part),
  ['1'])

check('nothing at all is fetched when there is no text to anchor it',
  readableParts(flattenParts(await structure(`(${plainImage}${PDF} "MIXED" ("BOUNDARY" "m") NIL NIL NIL)`))).parts,
  [])

/*
 * The case that broke it in the field. A real designed sign-off — photograph, logo, banner, at
 * the resolution a retina screen wants — is several hundred kilobytes an image. The first caps
 * threw exactly that away and the message rendered blank, which is indistinguishable from the
 * feature never having worked.
 */
const REAL_SIG_A = '("IMAGE" "JPEG" ("NAME" "banner.jpg") "<a@urbanhaus>" NIL "BASE64" 420000 NIL ("INLINE" ("FILENAME" "banner.jpg")) NIL NIL)'
const REAL_SIG_B = '("IMAGE" "PNG" ("NAME" "logo.png") "<b@urbanhaus>" NIL "BASE64" 260000 NIL ("INLINE" ("FILENAME" "logo.png")) NIL NIL)'
const richSig = readableParts(flattenParts(await structure(
  `(${TEXT}${REAL_SIG_A}${REAL_SIG_B} "RELATED" ("BOUNDARY" "r") NIL NIL NIL)`,
)))
check('a real designed signature fits — both pictures, neither dropped',
  [richSig.parts.map((p) => p.part), richSig.skippedImages],
  [['1', '2', '3'], 0])

/* ---------------------------------------------------------------- *
 * Shapes that are easy to get wrong
 * ---------------------------------------------------------------- */

const single = flattenParts(await structure(TEXT))
check('a message with no multipart at all is section 1, not section ""',
  single.map((p) => p.part), ['1'])

// A forwarded .eml. Recursing into it would put the forwarded message's own words into the body
// a collector reads, where they look as though this sender wrote them.
const FORWARD = `("MESSAGE" "RFC822" ("NAME" "fw.eml") NIL NIL "7BIT" 5000 (NIL "Fwd" NIL NIL NIL NIL NIL NIL NIL NIL) ${TEXT} 60 NIL ("ATTACHMENT" ("FILENAME" "fw.eml")) NIL NIL)`
check('a forwarded message stays an attachment rather than becoming part of the text',
  flattenParts(await structure(`(${TEXT}${FORWARD} "MIXED" ("BOUNDARY" "m") NIL NIL NIL)`))
    .map((p) => `${p.part}:${p.type}`),
  ['1:text/plain', '2:message/rfc822'])

check('rubbish in is not an exception out', flattenParts(null), [])

/* ---------------------------------------------------------------- *
 * Undoing the encodings, which mailparser used to do for us
 * ---------------------------------------------------------------- */

check('quoted-printable: =XX back to the character it stands for',
  decodeQuotedPrintable('Kan ek R600 =E2=82=AC betaal?').toString('utf8'),
  'Kan ek R600 € betaal?')
check('quoted-printable: a soft line break is not a line break',
  decodeQuotedPrintable('my number is 083 555 =\r\n9922').toString('utf8'),
  'my number is 083 555 0199')
check('quoted-printable: a lone = that is not an escape survives',
  decodeQuotedPrintable('total = R1 234').toString('utf8'), 'total = R1 234')
check('base64 is decoded', decodeTransfer(Buffer.from('R29laWUgZGFn'), 'base64').toString('utf8'), 'Goeie dag')
check('7bit is already the bytes', decodeTransfer(Buffer.from('Goeie dag'), '7bit').toString('utf8'), 'Goeie dag')

// Still common in South African business mail, and reading it as UTF-8 mangles every apostrophe.
check('windows-1252 is decoded as windows-1252',
  toText(Buffer.from([0x64, 0x69, 0x65, 0x20, 0x66, 0x69, 0x72, 0x6d, 0x92, 0x73]), 'windows-1252'),
  'die firm’s')
check('an unknown charset label falls back rather than throwing',
  toText(Buffer.from('Goeie dag'), 'utf-8879'), 'Goeie dag')

/* ---------------------------------------------------------------- *
 * Putting the fetched parts back together
 * ---------------------------------------------------------------- */

// A one-pixel PNG, so the assembled data: URI is a real image a browser would render.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const { parts: wanted } = readableParts(real)
const fetched = {
  bodyParts: new Map([
    ['1.1.1', Buffer.from('Goeie dag. My nuwe nommer is 083 555 =\r\n0199.')],
    ['1.1.2', Buffer.from('<p>Goeie dag.</p><a href=3D"tel:0835550199">x</a>')],
    ['1.2', Buffer.from(PNG.toString('base64'))],
  ]),
}
const body = assembleBody(wanted, fetched)

check('the text is decoded and the soft break healed',
  body.text, 'Goeie dag. My nuwe nommer is 083 555 0199.')
check('the HTML is kept too, because that is where an image signature hides its tel: link',
  body.html.includes('href="tel:0835550199"'), true)
check('the signature comes back as a picture the browser can render without asking anyone',
  body.images.map((i) => `${i.cid}|${i.dataUri.slice(0, 15)}`),
  ['sig@bredellferreira.co.za|data:image/png;'])
check('and it is byte-for-byte the image that was sent',
  Buffer.from(body.images[0].dataUri.split(',')[1], 'base64').equals(PNG), true)

const missingPicture = assembleBody(wanted, { bodyParts: new Map([['1.1.1', Buffer.from('Goeie dag.')]]) })
check('a part the server never sent is skipped, not rendered as nothing',
  missingPicture.text, 'Goeie dag.')
check('and a picture that did not arrive is reported, not left as a silent gap',
  missingPicture.imagesSkipped, 1)

// Null is the signal to fall back to fetching the whole message, so it has to be null and not
// an empty body — an empty body would render as a blank message the agent cannot explain.
check('nothing usable means null, which is what makes the caller fall back',
  assembleBody(wanted, { bodyParts: new Map() }), null)
check('a failed fetch means null too', assembleBody(wanted, false), null)

// One line break per block, which is what plainText has always done — the point here is that
// HTML-only mail still arrives as words rather than as tags.
check('HTML-only mail is reduced to something readable',
  assembleBody(
    readableParts(flattenParts(await structure(`(${HTML} "MIXED" ("BOUNDARY" "m") NIL NIL NIL)`))).parts,
    { bodyParts: new Map([['1', Buffer.from('<p>Goeie dag</p><b>Groete</b><br>J M van Wyk')]]) },
  ).text,
  'Goeie dag\nGroete\nJ M van Wyk')

/*
 * A part the server decoded for us via FETCH BINARY. Decoding it a second time would turn a
 * perfectly good message into rubbish, silently.
 */
check('a part that arrived already decoded is not decoded twice',
  partContent(
    { bodyParts: new Map([['1', Buffer.from('Goeie dag')]]), binaryParts: new Set(['1']) },
    { part: '1', type: 'text/plain', encoding: 'base64', size: 9 },
  ).toString('utf8'),
  'Goeie dag')

/* ---------------------------------------------------------------- *
 * The slow fallback path has to reach the same answer
 * ---------------------------------------------------------------- */

check('mailparser\'s attachments give up the same signature',
  inlineImagesFromParsed([
    { contentType: 'image/png', cid: 'sig@bf', filename: 'sig.png', content: Buffer.alloc(9000, 1) },
    { contentType: 'image/gif', cid: 'px@track', content: Buffer.alloc(60) },
    { contentType: 'application/pdf', filename: 'mandate.pdf', contentDisposition: 'attachment', content: Buffer.alloc(9000) },
  ]).images.map((i) => i.cid),
  ['sig@bf'])

check('and the slow path reports an oversized picture too',
  inlineImagesFromParsed([
    { contentType: 'image/jpeg', cid: 'huge@x', content: Buffer.alloc(4 * 1024 * 1024) },
  ]).skippedImages,
  1)

check('no attachments is not an error', inlineImagesFromParsed(undefined).images, [])
check('an empty message is not an error', plainText('', ''), '')

// The log line that explains a missing signature without needing anyone to reproduce it. Types,
// sizes and dispositions only — a filename or an address in a log is a debtor's data in a log.
const described = describeParts(real)
check('the diagnostic describes the shape', described.includes('1.2:image/png/base64/41000b/cid/inline'), true)
check('and never carries a filename', /mandate\.pdf|sig\.png/.test(described), false)

console.log(failures === 0
  ? '\nPASS — a message is taken apart from its structure, only the readable parts are fetched,'
    + ' both encodings are undone, and an image signature survives to the screen'
  : `\nFAILED ${failures} check(s)`)
process.exit(failures === 0 ? 0 : 1)
