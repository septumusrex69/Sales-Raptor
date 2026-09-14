/**
 * Driving dictation with a fake recogniser.
 *
 * Two of the things fixed here cannot be read off the source, because they are behaviour over
 * time rather than structure:
 *
 *   - do the words land IN the box, or beside the button?
 *   - does a PAUSE kill the session?
 *
 * The second was a real bug: Chrome ends a recognition session after a few seconds of quiet
 * whatever `continuous` says, so a long note stopped dead the first time somebody thought
 * mid-sentence. Nothing in the file looked wrong. Only driving it showed it.
 *
 * So this installs a fake SpeechRecognition before the page loads, then plays a real dictation
 * through it: interim words, a final phrase, a silence timeout, more words, and Stop.
 *
 *   npm run build && node .qa-harness/build.mjs && node .qa-harness/dictate-drive.mjs
 */
import { execSync } from 'node:child_process'
const { chromium } = await import(execSync('npm root -g', { encoding: 'utf8' }).trim() + '/playwright/index.mjs')

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  ignoreDefaultArgs: ['--proxy-server'],
})
const page = await browser.newPage({ viewport: { width: 900, height: 900 } })
const problems = []
page.on('pageerror', (e) => problems.push(`page error: ${String(e).slice(0, 200)}`))

await page.addInitScript(() => {
  window.__sessions = 0
  window.__live = []
  class Fake {
    constructor() { window.__live.push(this) }
    start() { window.__sessions += 1 }
    stop() { this.onend && this.onend() }
    abort() {}
    say(text, isFinal) {
      this.onresult({ resultIndex: 0, results: { length: 1, 0: { isFinal, 0: { transcript: text } } } })
    }
    /** What Chrome does after a few seconds of quiet, whatever `continuous` says. */
    silenceTimeout() { this.onend && this.onend() }
  }
  for (const name of ['SpeechRecognition', 'webkitSpeechRecognition']) {
    Object.defineProperty(window, name, { value: Fake, writable: true, configurable: true })
  }
})

await page.goto('file://' + process.cwd() + '/.qa-harness/index.html')
await page.waitForTimeout(400)

const probe = page.locator('[data-probe="dictate"]').first()
const field = probe.locator('[data-probe-field]')
const say = (t, f) => page.evaluate(([t, f]) => window.__live.at(-1).say(t, f), [t, f])
const sessions = () => page.evaluate(() => window.__sessions)

const check = async (name, actual, expected) => {
  const a = JSON.stringify(await actual), e = JSON.stringify(expected)
  if (a !== e) problems.push(`${name}\n     got      ${a}\n     expected ${e}`)
}

await probe.locator('button', { hasText: 'Dictate' }).click()
await page.waitForTimeout(150)

// The words belong in the box being written, not in a grey caption somewhere else.
await say('spoke to the debtor', false)
await check('interim words land in the box', field.inputValue(), 'Spoke to the debtor')

// Settling a phrase must not duplicate what the interim already showed.
await say('spoke to the debtor', true)
await check('a final phrase settles without doubling', field.inputValue(), 'Spoke to the debtor')

// THE BUG. A pause ends the browser's session; the button must start another.
const before = await sessions()
await page.evaluate(() => window.__live.at(-1).silenceTimeout())
await page.waitForTimeout(600)
const after = await sessions()
if (after <= before) problems.push('a pause killed dictation — the session was not restarted')
await check('the text survives the pause', field.inputValue(), 'Spoke to the debtor')

// And the note carries on past it, which is the whole point.
await say('he will pay on the 25th', true)
await check('a long note continues after a pause',
  field.inputValue(), 'Spoke to the debtor he will pay on the 25th')

// Stop means stop. A restart loop that ignores it would hold the microphone open for ever.
await probe.locator('button', { hasText: 'Listening' }).click()
await page.waitForTimeout(600)
if ((await sessions()) !== after) problems.push('Stop did not stop — it restarted anyway')

await browser.close()

if (problems.length) {
  console.error(`FAIL — ${problems.length} problem(s)\n`)
  for (const p of problems) console.error(`  ✗ ${p}`)
  process.exit(1)
}
console.log('PASS — dictation writes into the box, survives a pause mid-sentence, and stops when told.')
