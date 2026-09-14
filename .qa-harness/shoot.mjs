const { chromium } = await import(
  (await import('node:child_process')).execSync('npm root -g', { encoding: 'utf8' }).trim() + '/playwright/index.mjs'
)
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', ignoreDefaultArgs: ['--proxy-server'] })
const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto('file://' + process.cwd() + '/.qa-harness/index.html')
await page.waitForTimeout(700)

// Measure every probe: does anything inside it stick out of it?
const report = await page.evaluate(() => {
  const out = []
  for (const box of document.querySelectorAll('[data-probe]')) {
    const b = box.getBoundingClientRect()
    let worstLeft = 0, worstRight = 0, culprit = ''
    for (const el of box.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      const overLeft = b.left - r.left
      const overRight = r.right - b.right
      if (overLeft > worstLeft) { worstLeft = overLeft; culprit = el.className || el.tagName }
      if (overRight > worstRight) { worstRight = overRight; culprit = el.className || el.tagName }
    }
    out.push({
      probe: box.getAttribute('data-probe'),
      width: Math.round(b.width),
      scrollOverflow: box.scrollWidth - box.clientWidth,
      overLeft: Math.round(worstLeft),
      overRight: Math.round(worstRight),
      culprit: String(culprit).slice(0, 80),
    })
  }
  return out
})
console.table(report)
if (errors.length) { console.log('\nconsole errors:'); for (const e of errors) console.log('  ' + e) }
await page.screenshot({ path: '.qa-harness/picker.png', fullPage: true })
await browser.close()
