/**
 * THE APP SHELL NEVER SCROLLS (R-22: "Raptor goes up and the grey displays at the bottom").
 *
 * The shell (`.app-layout`) is exactly one window tall and only <main> may scroll. With
 * overflow:hidden the shell -- and the page behind it -- can STILL be scrolled by script and by the browser -- focus() or
 * scrollIntoView() on something that sticks out of it, find-in-page, a text-selection drag -- and
 * then the whole app, sidebar and top bar included, slides up and the grey page shows at the foot
 * (R-22's screenshot). overflow:clip cannot be scrolled at all.
 *
 * Here: something sticks out of the shell, the browser is asked to bring it into view, and the shell
 * must not have moved -- nor the sidebar and top bar with it.
 *
 * Run: node scripts/qa/e2e/app-shell-scroll.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('app-shell-scroll')
const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  const { page } = await signedInPage(browser, PROFILE, [
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [PROFILE] })],
    [(u) => /\/rest\/v1\/firm_settings/.test(u), () => ({ body: [{ firm_name: 'Bredell Ferreira', phone: '010 594 5065' }] })],
  ], [])
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  await page.locator('.app-layout').waitFor({ timeout: 20000 })
  await page.waitForTimeout(1500)

  const r = await page.evaluate(() => {
    const shell = document.querySelector('.app-layout')
    const bar = document.querySelector('.app-sidebar')
    const top = () => Math.round(bar.getBoundingClientRect().top)
    const before = { scroll: shell.scrollTop, top: top() }
    // Something that sticks out below the shell, then the browser is told to show it.
    const stray = document.createElement('button')
    stray.textContent = 'stray'
    stray.style.cssText = 'position:absolute;left:0;top:2400px;width:80px;height:30px'
    shell.appendChild(stray)
    stray.focus()
    stray.scrollIntoView()
    shell.scrollTop = 500
    shell.scrollTo(0, 500)
    const after = { scroll: shell.scrollTop, top: top() }
    const docScroll = document.documentElement.scrollTop
    stray.remove()
    return { before, after, h: shell.clientHeight, win: window.innerHeight, docScroll }
  })
  t.check('the shell is exactly the window tall', r.h, r.win)
  t.check('the shell starts unscrolled', r.before.scroll, 0)
  t.check('the shell cannot be scrolled, whoever asks', r.after.scroll, 0)
  t.check('the sidebar has not slid up', r.after.top, r.before.top)
  t.check('the page behind the shell has not scrolled either', r.docScroll, 0)
} catch (e) {
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message.split('\n')[0] : e})`, false)
} finally {
  if (browser) await browser.close()
  await stopServer(server)
}
const good = t.finish('The app shell cannot be scrolled: sidebar and top bar stay put however the browser is asked to bring something into view.')
process.exit(good ? 0 : 1)
