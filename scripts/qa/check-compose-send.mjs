/**
 * THE THREE WAYS A SEND CAN FAIL THAT A BROWSER TEST CANNOT REACH.
 *
 * `e2e/compose-send` clicks the real button and is the check that matters: it proves the press
 * produces a sentence. Three failures cannot be staged there -- a session that expired while the
 * page sat open, a request too large for the platform, and the 413 that comes back from the edge
 * rather than from the mailbox -- so they are held here, against the source.
 *
 * ALL THREE WERE SILENT, and silence is the whole complaint. The firm pressed Send on a reply with
 * two photographs on it and got nothing: no error, no spinner, no request. The deployment's own
 * logs show /api/email/send was never called, so whatever stopped it stopped it in the browser,
 * and every one of these paths returned without setting a word.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-compose-send.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

const src = read('src/components/ComposeEmailModal.tsx')

/* The submit handler on its own: every assertion below is about what happens on the press. */
const submit = (() => {
  const at = src.indexOf('async function handleSubmit')
  const end = src.indexOf('\n  return (', at)
  return at < 0 || end < 0 ? '' : src.slice(at, end)
})()
ok('the submit handler is where it was', submit.length > 400)

/* ---------------- nothing leaves without saying so ---------------- */

/*
 * THE ASSERTION THAT IS THE BUG. A bare `return` in here is a press that does nothing and says
 * nothing -- there were three, and between them they cover an expired session, a missing field and
 * a message too large. Read as: no `return` on a line of its own without a setError above it.
 */
const lines = submit.split('\n').map((l) => l.trim())
const silent = lines
  .map((l, i) => [l, i])
  .filter(([l]) => l === 'return' || l === 'return;')
  /*
   * A `return` is fine when the block it ends said something first. Walk back from it to the top
   * of its block -- a blank line, a brace, or the `try` -- rather than a fixed number of lines: a
   * setError argument runs to three lines here, and a window that fits today's wrapping is a check
   * that fails the next time somebody reflows it.
   */
  .filter(([, i]) => {
    for (let n = i - 1; n >= 0 && i - n <= 10; n -= 1) {
      const l = lines[n]
      if (l.includes('setError(')) return false
      if (l === '' || l === '}' || l.endsWith('{')) break
    }
    return true
  })
  .map(([, i]) => i)
check('no press returns without a sentence', silent, [])
/* The guard above is worthless if nothing returns at all, so count what it cleared. */
ok('...and there are failure paths for it to have cleared',
  lines.filter((l) => l === 'return').length >= 3)

/* And each of the three by name, because "no bare return" also passes on a handler that has been
   deleted. Assert presence, not only absence -- an order-only check passes vacuously. */
ok('a missing field is named rather than counted', /setError\(`This needs \$\{missingField\}/.test(submit))
ok('...and the three it can be are the three the form requires',
  /!address\.trim\(\) \? 'who it goes to'/.test(submit)
  && /!subject\.trim\(\) \? 'a subject'/.test(submit)
  && /\(!body\.trim\(\) && !quotedHtml\) \? 'a message'/.test(submit))

/*
 * THE EXPIRED SESSION, which is the one that could not be guessed from the screen. An iPad left on
 * a page for an afternoon comes back with the token refreshed away underneath it; everything
 * already drawn still works and the next thing needing a bearer token does not.
 */
ok('an expired session says so', /setError\('Your session has expired\./.test(submit))
/* AND IT PROMISES THE WORDS ARE SAFE. Somebody who has typed a page of a letter needs to know that
   signing in again is not going to cost them it. */
ok('...and that what was typed is not lost', /stays in this box/.test(submit))

/* ---------------- the browser is not allowed to refuse instead ---------------- */

/*
 * A `required` field the browser enforces is refused by BLOCKING THE SUBMIT and drawing a bubble
 * on the control. In a modal somebody has scrolled to the bottom of, on an iPad, that bubble is
 * off the screen and the press reads as a dead button. The attributes stay -- they are what marks
 * the field and what a screen reader announces -- and the enforcing does not.
 */
ok('the form does its own checking', /<form onSubmit=\{handleSubmit\} noValidate>/.test(src))
ok('...while the fields still say they are required',
  /value=\{subject\}[\s\S]{0,120}?required/.test(src)
  && /<RecipientField value=\{address\}[\s\S]{0,120}?required/.test(src))
/* AND THE ASTERISK AGREES WITH THE BOX. Marked required on a forward, where the original IS the
   message and the box may be left empty, it marks a field nothing enforces. */
ok('...and the message is marked required only where it is',
  /<FormField label="Message" required=\{!quotedHtml\}>/.test(src))

/* ---------------- too large is ours to refuse, not the platform's ---------------- */

/*
 * MEASURED ON THE WHOLE REQUEST. The attachment ceiling guards what somebody attached, which was
 * the only large thing this box carried when it was written. A FORWARD carries a second: quotedHtml
 * is the original's markup with its inline pictures already data: URIs, and a signature with a
 * logo and five social icons is most of a megabyte before anybody attaches anything.
 */
ok('the whole request is measured, not only the files', /payload\.length > MAX_REQUEST_BYTES/.test(submit))
ok('...on the JSON that is actually posted', /const payload = JSON\.stringify\(/.test(submit))
ok('...and it is the payload that is sent', /body: payload,/.test(submit))
/* UNDER THE PLATFORM'S OWN LIMIT, or ours never fires and the edge's 413 is what people get. */
const ceiling = /const MAX_REQUEST_BYTES = (\d+) \* 1024 \* 1024/.exec(src)
ok('there is a ceiling of our own', ceiling !== null)
ok('...below the 4.5 MB the platform refuses at', Number(ceiling?.[1] ?? 99) < 4.5)

/*
 * AND A 413 IS THE PLATFORM, NOT THE MAILBOX. It arrives from the edge with no JSON in it, so it
 * used to wear the fallback sentence -- which sends somebody to Settings to reconnect a mailbox
 * that was never the problem.
 */
ok('a 413 is told apart from a mailbox that is not connected', /res\.status === 413/.test(submit))
ok('...and does not send anybody to Settings',
  /413[\s\S]{0,200}?too large to send in one go/.test(submit))

/* ---------------- and the failure the server DOES answer still shows ---------------- */

ok('the server’s own sentence is preferred to ours', /responseBody\.error \?\?/.test(submit))
ok('...and the composer stays open on any failure',
  (submit.match(/setSubmitting\(false\)/g) ?? []).length >= 3)

console.log(`\ncheck-compose-send: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
