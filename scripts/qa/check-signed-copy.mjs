/**
 * THE SIGNATURE GOES IN THE SIGNATURE BLOCK, AND THE SIGNED COPY IS A PDF.
 *
 * TWO INSTRUCTIONS FROM THE FIRM, both after watching a debtor sign their first acknowledgement of
 * debt online.
 *
 *   WHERE THE MARK GOES: "he signs it, but the signature just like randomly hangs down there. The
 *   signature is not signed on the document. It's not put in the right place. It should be put in
 *   the block where it's being put in the right place." The page drew the agreement with empty
 *   rules and then put the PNG in a card underneath it. That is a document and a photograph of a
 *   squiggle, not a signed document.
 *
 *   WHAT IS KEPT: "it saves now, but it saves like the online version. It doesn't save a PDF. It
 *   should save a PDF and send a PDF to the debtor and save it on the document." Opening the filed
 *   row took a collector to /sign/<token>. A web page cannot be posted to an attorney, attached to
 *   a summons, or kept once the deployment it lives on is gone.
 *
 * WHAT THIS GUARDS THAT A SCREENSHOT WOULD NOT. Three of them, and each is silent:
 *
 *   - THE MARK ON THE WRONG RULE. An acknowledgement of debt has three signature rules and the
 *     debtor signs two; stamping one person's drawing on all three shows a court an agreement
 *     signed for both sides by the same hand. It looks completely normal.
 *   - THE ROLE LOST ON A ROUND TRIP. `signer` has no appearance, so editing the template in the
 *     page editor would quietly turn the debtor's rule into nobody's -- and the next signature
 *     would land on neither.
 *   - THE PAGINATION MOVING. The mark is drawn in the 10mm of air the block already reserves. A
 *     version that added space for it would break a nine-page agreement in different places from
 *     the one the debtor read.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-signed-copy.mjs
 */
import { readFileSync } from 'node:fs'
import {
  MARK_MAX_MM, markBox, marked, pngSize, signerOf, stampLine,
} from '../../src/lib/signedMark.ts'
import { signingSmsText } from '../../src/lib/signingRules.ts'
import {
  blankLetter, documentHtmlToBlocks, letterToHtml, A4_LETTERHEAD,
} from '../../src/lib/letterDocument.ts'
import { planLetter } from '../../src/lib/letterLayout.ts'
import { aod } from '../letters/aod.mjs'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

/* ---------------------------------------------------------------------------------------------
 * A PNG THAT IS ONLY A HEADER, which is all pngSize reads
 * ------------------------------------------------------------------------------------------- */

/*
 * BUILT RATHER THAN PASTED. The point is that the WIDTH AND HEIGHT are known, so markBox's
 * arithmetic can be checked against them -- a pasted specimen would make the expected numbers
 * magic. pngSize reads the first 24 bytes and nothing else: the 8-byte signature, the IHDR length
 * and tag, then width and height as big-endian 32-bit integers. Those offsets are fixed by the
 * format, which is why reading them is safe and why 24 bytes is enough.
 */
function fakePng(width, height) {
  const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]
  for (const n of [width, height]) {
    bytes.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255)
  }
  return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`
}

const WIDE = fakePng(600, 200)   /* 3:1, the shape a signature actually is */
const TALL = fakePng(100, 400)   /* 1:4, which the height cap has to bite on */

check('a PNG header gives up its size', pngSize(WIDE), { width: 600, height: 200 })
/* NULL RATHER THAN A GUESS. A square default would draw somebody's signature stretched, and a
   stretched signature on an instrument the firm would sue on is worse than a small one. */
check('something that is not a PNG is refused', pngSize('data:image/jpeg;base64,AAAA'), null)
check('...and so is a data URL with rubbish in it', pngSize('data:image/png;base64,!!!!'), null)
check('...and a PNG whose signature bytes are wrong',
  pngSize(`data:image/png;base64,${Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]).toString('base64')}`), null)

/* ---------------------------------------------------------------------------------------------
 * HOW BIG THE MARK IS DRAWN
 * ------------------------------------------------------------------------------------------- */

const signed = { signaturePng: WIDE, name: 'Alianna Lubuschangne', signedAt: '2026-10-04T18:58:51Z' }

const wide = markBox(signed, 70)
/* THE RULE'S OWN WIDTH IS THE BOUND THAT BITES ON A WIDE SIGNATURE. 600x200 scaled to 10mm tall
   would be 30mm wide, which fits -- so the height cap is what decides, and the aspect is kept. */
check('a 3:1 mark is capped by the air above the rule', wide, { wMm: 30, hMm: 10 })
ok('...and never taller than that air', (wide?.hMm ?? 0) <= MARK_MAX_MM)

/* AND A TALL ONE IS CAPPED THE OTHER WAY ROUND, which is the case a height-only cap gets wrong:
   100x400 at 10mm tall is 2.5mm wide, which is fine -- so take a rule narrow enough to bite. */
const narrow = markBox({ ...signed, signaturePng: WIDE }, 15)
check('a mark wider than its rule is brought back to it', narrow, { wMm: 15, hMm: 5 })
ok('...keeping its own proportions', Math.abs((narrow.wMm / narrow.hMm) - 3) < 0.001)

const tall = markBox({ ...signed, signaturePng: TALL }, 70)
check('a tall mark is capped by the air, not by the rule', tall, { wMm: 2.5, hMm: 10 })

check('a mark whose picture cannot be read draws nothing',
  markBox({ ...signed, signaturePng: 'not a png' }, 70), null)

/* ---------------------------------------------------------------------------------------------
 * WHAT IS WRITTEN UNDER IT
 * ------------------------------------------------------------------------------------------- */

/*
 * A SQUIGGLE IDENTIFIES NOBODY. ECTA s13(3) asks for a method that identifies the person AND
 * indicates their approval, so the typed name and the moment the database recorded go under the
 * mark, on the document -- not in a row on a screen inside Raptor. A court reading the PDF should
 * not have to be told where it came from.
 */
const stamp = stampLine(signed)
ok('the stamp names who signed', stamp.includes('Alianna Lubuschangne'))
ok('...and when, in the firm’s own date format', /4 October 2026/.test(stamp))
ok('...and says it was done electronically', /electronically/i.test(stamp))
/* A TIMESTAMP THAT WILL NOT PARSE IS PRINTED AS IT STANDS rather than as "Invalid Date", which is
   a phrase nobody can act on and which would go onto an instrument. */
ok('an unreadable date is printed rather than mangled',
  stampLine({ ...signed, signedAt: 'whenever' }).endsWith('whenever'))

/* ---------------------------------------------------------------------------------------------
 * WHOSE RULE IS WHOSE
 * ------------------------------------------------------------------------------------------- */

const sig = (spans, extra = {}) => ({ kind: 'signature', widthMm: 70, spans, ...extra })

check('the role on the block wins',
  signerOf(sig([{ text: 'for the Creditor — anybody' }], { signer: 'debtor' })), 'debtor')
/* THE TEXT IS THE FALLBACK, and only for documents already FROZEN onto requests that went out
   before the role existed. Nothing can go back and re-tag those. */
check('...and the words decide where there is no role',
  signerOf(sig([{ text: 'for the Creditor — Bredell Ferreira, duly authorised agent' }])), 'creditor')
check('...anything else being the debtor’s',
  signerOf(sig([{ text: 'The Defendant — Promise Sikelele' }])), 'debtor')

ok('the debtor’s rule takes the mark', marked(sig([], { signer: 'debtor' }), signed))
ok('...and the creditor’s does not', !marked(sig([], { signer: 'creditor' }), signed))
ok('...and an unsigned document marks nothing', !marked(sig([], { signer: 'debtor' }), null))

/* ---------------------------------------------------------------------------------------------
 * AND THE AGREEMENT ITSELF IS TAGGED
 * ------------------------------------------------------------------------------------------- */

/*
 * TWO RULES, BOTH THE DEBTOR'S, AND THE CREDITOR'S IS GONE.
 *
 * THE FIRM, reading a signed copy: "for the creditor, I don't think we have to sign that. I think
 * that's not really necessary." They are right about what the document is. An acknowledgement of
 * debt is the DEBTOR's admission; a counter-signature adds nothing to it, and an unsigned rule on
 * every copy that comes back reads as a document only half completed.
 *
 * SO THE COUNT IS THE ASSERTION: the debtor signs in Part B and again on the consent to judgment
 * in Annexure A, and nobody else signs at all.
 */
for (const kind of ['individual', 'company']) {
  const rules = aod(kind).blocks.filter((b) => b.kind === 'signature')
  check(`the ${kind} agreement has two signature rules`, rules.length, 2)
  check(`...both of them the debtor’s`, rules.filter((b) => signerOf(b) === 'debtor').length, 2)
  check(`...and none the creditor’s`, rules.filter((b) => signerOf(b) === 'creditor').length, 0)
  /* MARKED EXPLICITLY RATHER THAN LEFT TO THE TEXT. The fallback exists for frozen documents; a
     template that relied on it would break the day somebody added a witness line. */
  ok(`...both saying so on the block`, rules.every((b) => b.signer))
  /*
   * AND NO "SIGNED AT ____ ON ____" ABOVE EITHER. The firm: "it still says signed at, which is not
   * fine." It is a wet-signature line -- two blanks filled in with a pen -- and nobody asks an
   * online signer what town they are sitting in, so it printed empty directly above a signature
   * with the date it was asking for already written underneath by the stamp.
   */
  ok(`...and the ${kind} agreement asks nobody where they signed`,
    !/Signed at/.test(JSON.stringify(aod(kind).blocks)))
}

/* ---------------------------------------------------------------------------------------------
 * THE SCREEN DRAWS IT ON THE RULE
 * ------------------------------------------------------------------------------------------- */

const doc = { ...blankLetter(), blocks: aod('individual').blocks }
const html = letterToHtml(doc, { filled: false, values: {}, signed })
const unsignedHtml = letterToHtml(doc, { filled: false, values: {} })

const marks = (html.match(/<img class="ltr-mark"/g) ?? [])
check('the mark is drawn on both of the debtor’s rules', marks.length, 2)
check('an unsigned document draws none of them',
  (unsignedHtml.match(/<img class="ltr-mark"/g) ?? []).length, 0)
/*
 * INSIDE THE RULE, NOT AFTER IT. `.ltr-rule` is the 10mm box with the line along its bottom, so an
 * image inside it sits ON the line where a wet signature would. After it, the mark is back to
 * hanging under the document -- which is the firm's complaint with a different stylesheet.
 */
ok('...inside the rule rather than under it',
  /<div class="ltr-rule" style="width:70mm"><img class="ltr-mark"/.test(html))
/*
 * AND NOT ON THE CREDITOR'S.
 *
 * SLICED FROM THE RULE'S OWN BLOCK, not from a fixed number of characters before the words -- the
 * block before this one is the DEBTOR's and does carry a mark, so a slice that overruns reads as a
 * failure on correct code. Take the last `.ltr-sig` opening before the creditor's words.
 */
/*
 * AND THE CREDITOR'S RULE IS NOT THERE TO BE MARKED. It was, and the check sliced its block to
 * prove the mark stayed off it; the firm has since removed the rule itself, so what is asserted
 * now is its absence -- and `marked` is still held to the role above, which is what would stop a
 * mark landing on a creditor's rule if one ever came back.
 */
ok('...and there is no creditor’s rule to mark', !/for the Creditor/.test(html))
ok('...nor one declared on any block', !/data-signer="creditor"/.test(html))
ok('the stamp goes under the name', /<div class="ltr-stamp">Signed electronically by/.test(html))

/* ---------------------------------------------------------------------------------------------
 * AND THE ROLE SURVIVES THE PAGE EDITOR
 * ------------------------------------------------------------------------------------------- */

/*
 * THIS IS THE SILENT ONE. `signer` has no appearance to be read back from, so without the data
 * attribute the round trip would drop it -- and the debtor's own rule would become nobody's the
 * first time somebody opened the template in the editor to change a word. Nothing would say so.
 *
 * READ BACK OFF THE UNSIGNED RENDERING, because that is what the editor draws.
 */
const back = documentHtmlToBlocks(unsignedHtml)
const backRules = back.filter((b) => b.kind === 'signature')
check('the editor gives back two rules', backRules.length, 2)
check('...with the roles they went in with',
  backRules.map((b) => b.signer), ['debtor', 'debtor'])
/* AND A ROLE NOBODY RECOGNISES IS NOT CARRIED. A hand-edited attribute would otherwise produce a
   signature rule whose owner is a typo, which nothing will ever stamp. */
const odd = documentHtmlToBlocks(
  '<div class="ltr-sig" data-signer="landlord"><div class="ltr-rule" style="width:70mm"></div>'
  + '<div>Somebody</div></div>')
check('a role outside the two is dropped rather than kept', odd[0]?.signer, undefined)

/* ---------------------------------------------------------------------------------------------
 * THE PDF PLACES IT, AND DOES NOT MOVE THE PAGE BREAKS
 * ------------------------------------------------------------------------------------------- */

/* A measure that is near enough: the plan's geometry is what is being checked, not the face. */
const measure = (text, sizePt) => text.length * sizePt * 0.17

const plan = planLetter(doc, A4_LETTERHEAD, { measure, filled: false, values: {}, signed })
const plain = planLetter(doc, A4_LETTERHEAD, { measure, filled: false, values: {} })

const images = plan.pages.flatMap((p) => p.ops).filter((o) => o.op === 'image')
check('the plan draws the mark twice', images.length, 2)
check('an unsigned plan draws it not at all',
  plain.pages.flatMap((p) => p.ops).filter((o) => o.op === 'image').length, 0)
ok('...both of them the signer’s own picture', images.every((o) => o.src === WIDE))

/*
 * ON THE LINE, which is the whole of "put it in the right place": the image's BOTTOM edge is the
 * rule's own y. Measured against the rule drawn on the same page, because a mark placed relative
 * to nothing is a mark somewhere on the page.
 */
const page1 = plan.pages.find((p) => p.ops.some((o) => o.op === 'image'))
const firstMark = page1.ops.find((o) => o.op === 'image')
/*
 * READ DEFENSIVELY. The first version of this indexed the rule it expected to find, so a mark
 * drawn BELOW its line -- which is the firm's original complaint, "it just randomly hangs down
 * there" -- made the check throw a TypeError two lines under the assertion that should have
 * reported it, and the run printed nothing at all. That trap is on the record in CLAUDE.md.
 */
const itsRule = page1.ops.find((o) => o.op === 'line' && o.widthMm === 0.3
  && Math.abs(o.y1Mm - (firstMark.yMm + firstMark.hMm)) < 1)
ok('the mark sits on its own rule', Boolean(itsRule))
ok('...starting at the same left edge',
  !!itsRule && Math.abs(itsRule.x1Mm - firstMark.xMm) < 0.01)
ok('...and above the line rather than through it',
  !!itsRule && firstMark.yMm + firstMark.hMm <= itsRule.y1Mm)
/* AND NOT UNDER ANY OF THEM. The failure that matters is a mark hanging below the document, so it
   is asserted against directly rather than only through the rule it was expected to find. */
const ruleYs = page1.ops.filter((o) => o.op === 'line' && o.widthMm === 0.3).map((o) => o.y1Mm)
ok('...and never below a rule it is supposed to be on',
  ruleYs.some((y) => Math.abs(y - (firstMark.yMm + firstMark.hMm)) < 1))

/*
 * AND THE PICTURE ITSELF COSTS NOTHING.
 *
 * It is drawn in the 10mm of air the block already reserves -- "room for a pen", which is exactly
 * what it is. A version that added space for the picture would paginate a nine-page agreement
 * differently from the one the debtor read and signed, which is a different document however
 * similar it looks.
 *
 * THE STAMP LINE IS THE ONE THING ADDED, and it is a line of words: the name and the date under
 * the mark, which is the half that makes a drawing mean anything. So what is asserted is that
 * NOTHING ELSE is -- every other run of text on the document is the same run, in the same place.
 * That is the honest version of "nothing moved": the picture moves nothing, and the sentence under
 * it moves what a sentence moves.
 */
check('the signed copy has the same number of pages', plan.pages.length, plain.pages.length)
/* The stamp is the only grey text on the document -- see the colour planLetter gives it. */
const notStamp = (p) => p.ops.filter((o) => o.op === 'text' && o.colour !== '#6b7280')
check('...and every other run of text is untouched',
  plan.pages.map((p) => notStamp(p).length), plain.pages.map((p) => notStamp(p).length))
/*
 * AND THE PROOF THAT THE PICTURE COST NOTHING is the RULE it sits on: if the mark had taken space
 * of its own, the line under it -- and the name under that -- would have moved down the page. Both
 * rules are compared, on the page they are on and to the millimetre.
 *
 * TEXT AFTER A STAMP DOES MOVE, by the height of the stamp, and that is not hidden here: it is a
 * line of words added to the document, and a line of words pushes what is under it. What must not
 * move is anything the picture is responsible for.
 */
const rules = (p) => p.pages.flatMap((pg, i) => pg.ops
  .filter((o) => o.op === 'line' && o.widthMm === 0.3)
  .map((o) => ({ page: i, y: o.y1Mm, x: o.x1Mm, to: o.x2Mm })))
const was = rules(plain)
const now = rules(plan)
check('...the same three rules, on the same pages',
  now.map((r) => r.page), was.map((r) => r.page))
/* THE FIRST ONE IS THE ASSERTION ABOUT THE PICTURE. Nothing above it changed, so if the mark had
   taken space of its own this is where it would show, to the millimetre. */
check('...the first of them exactly where it was unsigned', now[0], was[0])
/*
 * AND THE ONES AFTER IT HAVE MOVED BY A LINE OF WORDS AND NOT BY A PICTURE. The stamp under the
 * first rule pushes what follows it down, which is what any line does; 10mm would mean the mark
 * had claimed its own space, which is the failure this is here for.
 */
ok('...and the rest moved by a stamp line, not by a picture',
  now.every((r, i) => r.y - was[i].y >= 0 && r.y - was[i].y < MARK_MAX_MM))
const stamps = plan.pages.flatMap((p) => p.ops)
  .filter((o) => o.op === 'text' && o.colour === '#6b7280')
ok('the stamp is there and is set smaller than the body', stamps.length > 0
  && stamps.every((o) => o.sizePt < doc.defaults.size))

/* ---------------------------------------------------------------------------------------------
 * THE DRAWER EMBEDS EACH PICTURE ONCE
 * ------------------------------------------------------------------------------------------- */

const pdf = read('src/lib/letterPdf.ts')
/* ONCE PER DISTINCT PICTURE, not once per use: the same signature is on two rules, and embedding
   it twice would put two copies of it in the file. */
ok('pictures are embedded before any page is drawn',
  /const images = new Map[\s\S]{0,400}?plan\.pages/.test(pdf))
ok('...once per distinct picture', /if \(images\.has\(src\)\) return/.test(pdf))
/* AND A MARK THAT WILL NOT EMBED DRAWS NOTHING rather than refusing the document. The agreement
   has already been signed; producing no copy of it at all is the worse failure. */
ok('...and one that will not embed does not stop the copy',
  /try \{ images\.set\(src, await pdf\.embedPng\(src\)\) \} catch/.test(pdf))

/* ---------------------------------------------------------------------------------------------
 * THE INITIALS, AT THE FOOT OF EVERY PAGE
 * ------------------------------------------------------------------------------------------- */

/*
 * THE FIRM ASKED FOR THEM AT THE START -- "make space for where there can be signatures like at
 * the bottom of the pages for initials and stuff" -- and then, reading a signed copy: "the
 * initials also don't appear on the page." They were captured on the signing form and drawn
 * nowhere at all.
 *
 * A PAGE INITIAL IS NOT A SMALL SIGNATURE. It is what somebody puts on EVERY page to say they
 * read that page, so it is repeated per page rather than placed once -- which is why it lives on
 * the plan beside the running line and not in any one page's ops.
 */
const INITIALS = fakePng(300, 120)
const withInitials = { ...signed, initialsPng: INITIALS }
const planI = planLetter(doc, A4_LETTERHEAD, { measure, filled: false, values: {}, signed: withInitials })

ok('the plan carries the initials', Boolean(planI.signedInitials))
check('...as the picture the signer drew', planI.signedInitials?.src, INITIALS)
ok('...and not as a page op, so every page gets them',
  planI.pages.flatMap((p) => p.ops).filter((o) => o.op === 'image').length === 2)
check('a signer who gave none leaves them off', plan.signedInitials, null)

/*
 * IN THE BOTTOM MARGIN, which is what makes them free. Inside the text frame they would need a
 * strip of their own, and a signed copy would then break a nine-page agreement in different places
 * from the one the debtor read.
 */
const frameBottom = A4_LETTERHEAD.heightMm - A4_LETTERHEAD.marginBottomMm
ok(`...below the last line of text (${planI.signedInitials?.yMm.toFixed(1)}mm)`,
  (planI.signedInitials?.yMm ?? 0) >= frameBottom)
/* AND ABOVE THE LETTERHEAD'S OWN PRINTED FOOTER, which starts at 279.8mm on the firm's paper. */
ok('...and clear of the letterhead’s printed footer',
  (planI.signedInitials?.yMm ?? 0) + (planI.signedInitials?.hMm ?? 0) < 279.8)
ok('...capped at five millimetres', (planI.signedInitials?.hMm ?? 99) <= MARK_MAX_MM / 2)
/* RIGHT-ALIGNED, because the running line is left-aligned at the same height: "Page 2 of 4" on the
   left and the initials on the right, sharing the strip without meeting. */
check('...right-aligned to the text frame',
  Math.round((planI.signedInitials?.xMm ?? 0) + (planI.signedInitials?.wMm ?? 0)),
  A4_LETTERHEAD.widthMm - A4_LETTERHEAD.marginRightMm)
/* AND THEY COST NOTHING. The pages break exactly where they did without them. */
check('the pages break where they did unsigned', planI.pages.length, plain.pages.length)

/* THE DRAWER REPEATS THEM. Asserted on the source, because a plan cannot show what a page loop
   does with it -- and the failure this guards is initials on page one only. */
ok('the drawer puts them on every page',
  /plan\.signedInitials\)[\s\S]{0,80}?images\.get\(plan\.signedInitials\.src\)/.test(pdf))
ok('...inside the loop that adds the pages',
  pdf.indexOf('if (plan.signedInitials) {') > pdf.indexOf('plan.pages.forEach('))
/* AND BOTH RENDERERS HAND THEM OVER, which is where they went missing in the first place: the
   signing page captured them, the database stored them, and nothing ever passed them on. */
for (const file of ['src/lib/signedCopy.ts', 'src/pages/sign/SignPage.tsx']) {
  ok(`${file} passes the initials on`, /initialsPng: request\.initialsPng/.test(read(file)))
}
ok('the signed input reaches the plan',
  /signed: input\.signed \?\? null/.test(pdf))

/* ---------------------------------------------------------------------------------------------
 * AND THE COPY IS FILED AS A PDF
 * ------------------------------------------------------------------------------------------- */

const copy = read('src/lib/signedCopy.ts')
/* FROM THE REQUEST ALONE. Nothing is re-merged against the account: an agreement that re-read
   today's balance would show a court a different figure from the one the debtor agreed to. */
ok('the copy is drawn from the frozen request', /await openSigningRequest\(token\)/.test(copy))
ok('...and only once it is signed', /request\.state !== 'signed'/.test(copy))
ok('...on the letterhead frozen with it', /page\.backgroundUrl/.test(copy))
ok('...with the mark passed to the renderer', /signed,\n\s*\}\)/.test(copy))
/* THE FILE FIRST, THEN THE ROW -- the same order uploadDocument uses, and for the same reason: a
   row pointing at a file that failed to upload is a broken link in the list. */
ok('the file goes up before the row is repointed',
  copy.indexOf('.upload(') < copy.indexOf(".from('account_documents')\n    .update("))
ok('...and a row that will not update leaves no orphan behind',
  /\.remove\(\[path\]\)/.test(copy))
/* NOTHING IS CHARGED HERE. Item 4(a) was raised when the agreement was ISSUED and item 6 is
   raised by openDocument for the reading; filing the bytes is neither. */
ok('filing the bytes charges nothing', !/charge/i.test(copy.replace(/\/\*[\s\S]*?\*\//g, '')))

/* ---------------------------------------------------------------------------------------------
 * THE SIGNED COPY GOES BACK BY ITSELF, AND ONLY ONCE
 * ------------------------------------------------------------------------------------------- */

/*
 * THE FIRM: "it should go out as an email after it's signed in a PDF format to the debtor and to
 * the debt collector." Before this it sat on the account until somebody noticed it, which on their
 * first run meant the debtor signed and heard nothing back.
 *
 * THE SIGNER CANNOT SEND IT. They are anonymous: no mailbox, and the anon role has no rights on
 * anything this needs. So a server route does it, and the three things that must hold are that it
 * cannot be made to send something else, cannot send twice, and does not take the signing page
 * down with it when the mail fails.
 */
const route = read('api/_lib/email/signedCopy.ts')
const page = read('src/pages/sign/SignPage.tsx')
const panel = read('src/pages/accounts/SigningPanel.tsx')
const sql = read('supabase/schema.sql')

/* NOTHING THE CALLER SENDS IS TRUSTED EXCEPT THE TOKEN. Anybody holding a link could otherwise
   email the firm's own collector a doctored agreement, on the firm's letterhead, from the firm's
   mailbox. Asserted as the absence of every other input rather than the presence of the token. */
ok('the route reads the token and nothing else off the request',
  /\(req\.body as \{ token\?: unknown \}\)\?\.token/.test(route))
for (const field of ['req.body.to', 'req.body.pdf', 'req.body.subject', 'req.body.body']) {
  check(`...never ${field}`, route.includes(field), false)
}
/* AND THE DOCUMENT COMES OFF THE FROZEN REQUEST, which is the other half of the same rule. */
ok('...and draws from the request it read', /letterToPdf\(\{\s*\n\s*doc,/.test(route))
ok('...refusing anything not signed', /request\.state !== 'signed'/.test(route))

/*
 * ONCE. A reload, a second tab, a debtor who taps back -- each would be another copy and another
 * item 1(a) charged to them. The claim is an UPDATE conditional on the column still being null, so
 * the second caller matches no rows; a flag read and then written would let two callers through
 * between the read and the write.
 */
ok('the route claims the send before it sends',
  /\.update\(\{ copy_sent_at: new Date\(\)\.toISOString\(\) \}\)[\s\S]{0,120}?\.is\('copy_sent_at', null\)/
    .test(route))
ok('...and stops where the claim found nothing',
  /if \(!claimed \|\| claimed\.length === 0\)/.test(route))
const atClaim = route.indexOf("copy_sent_at: new Date()")
ok('...before a word of it goes out', atClaim > 0 && atClaim < route.indexOf('sendAsUser('))
/* AND THE COLUMN EXISTS TO BE CLAIMED. */
ok('signing_requests carries the column',
  /alter table public\.signing_requests\s*\n\s*add column if not exists copy_sent_at timestamptz;/
    .test(sql))

/* TO THE DEBTOR AND TO THE COLLECTOR, which is what the firm asked for -- and as one message with
   a copy rather than two, so there is one charge and one thread a reply can land in. */
ok('it goes to the debtor', /const to = \(live\.find/.test(route))
ok('...copied to the collector', /cc: collector\?\.email/.test(route))
ok('...from the collector’s own mailbox', /sendAsUser\(admin, account\.assigned_to,/.test(route))
/* AND IS RECORDED, or the one message the firm did not send by hand is the one with no record. */
ok('...and is filed against the account', /from\('account_emails'\)\s*\n?\s*\.insert\(\{/.test(route))

/*
 * AND THE SIGNING PAGE DOES NOT WAIT FOR IT OR SHOW ITS FAILURE. The document IS signed -- that is
 * in the database already, and it is what the debtor came to do. An error about an email they were
 * never told to expect reads as the signature having failed.
 */
ok('the signing page asks for the copy', /\/api\/email\/signed-copy/.test(page))
ok('...only where the signature took', /if \(done\) \{[\s\S]{0,200}?signed-copy/.test(page))
ok('...and swallows a failure rather than reporting one',
  /signed-copy[\s\S]{0,300}?\}\)\.catch\(\(\) => \{/.test(page))

/* ---------------------------------------------------------------------------------------------
 * THE LINK BY SMS, WHERE EVERY CHARACTER IS MONEY
 * ------------------------------------------------------------------------------------------- */

/*
 * THE FIRM: "you should email the link or you should SMS the link or somehow... because now you
 * copy the link. That's bullshit."
 *
 * ONE CHARACTER OUTSIDE THE GSM ALPHABET drops the whole message to UCS-2 and cuts every segment
 * from 160 characters to 70 -- a curly apostrophe, or the non-breaking space en-ZA puts in its own
 * thousands. It has cost the firm money before; see CLAUDE.md.
 */
const smsText = signingSmsText('https://raptor.example/sign/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG')
ok('the SMS carries the address', smsText.includes('/sign/abcdefg'))
// eslint-disable-next-line no-control-regex
ok('...in plain GSM characters only', !/[^\x20-\x7e]/.test(smsText))
ok('...and says who it is from, so it is not read as a scam', /Bredell Ferreira/.test(smsText))
/*
 * AND IT FITS IN ONE SEGMENT ON THE FIRM'S OWN DOMAIN, which is the assertion worth making rather
 * than a character count on the words: 160 characters is a GSM segment, R3.50 under item 1(c),
 * charged to the DEBTOR. The first draft said the same thing in eighty-seven characters of words
 * and bought a second one.
 */
const real = signingSmsText(`https://raptor.bredellferreira.co.za/sign/${'a'.repeat(43)}`)
ok(`...and fits one segment on the firm’s own domain (${real.length} of 160)`, real.length <= 160)
/* AND THE BOX THAT SENDS IT IS THE ONE THAT KNOWS THE PRICE, not a second sender in the panel. */
ok('the panel hands it to the SMS box', /onSms\(signingSmsText\(made\.url\)\)/.test(panel))
ok('...which takes words it did not write', /initialText\?: string/.test(read('src/pages/accounts/SmsModal.tsx')))

/* ---------------------------------------------------------------------------------------------
 * AND THE FILED PDF CAN BE SAVED
 * ------------------------------------------------------------------------------------------- */

/*
 * THE FIRM, of a signed copy: "it opens like as something, I don't know if it's a PDF or whatever,
 * but I can't download it, I can't save it."
 *
 * THAT IS CONTENT-DISPOSITION. Served inline, Safari on an iPad renders a PDF in its own reader
 * with no filename and no obvious way out -- on a document the firm needs to keep, post to an
 * attorney or attach to a summons.
 */
const store = read('src/lib/accountWorkspace.ts')
ok('a document arrives as a file rather than a view',
  /createSignedUrl\(storagePath, 60, \{ download: filename \|\| true \}\)/.test(store))
ok('...under the name the row carries', /documentUrl\(path, doc\.name\)/.test(store))

if (failures.length > 0) {
  console.error(`\ncheck-signed-copy: ${pass} passed, ${failures.length} failed\n`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`check-signed-copy: ${pass} passed, 0 failed`)
