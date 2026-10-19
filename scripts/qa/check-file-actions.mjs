/**
 * EVERY FILE RAPTOR OFFERS CAN BE OPENED OR DOWNLOADED, AND A DOWNLOAD SAVES IT (19 Oct).
 *
 * THE FIRM, on a mail attachment: "When I want to download an attachment, it opens it in Raptor
 * ... I should see an option to open it or download it. And then it directly downloads to the
 * device. It asks you where to save it. The same should work for every single document and PDF,
 * whatever is generated throughout Raptor."
 *
 * The cause was one idiom copied a dozen times: a blob URL, an `<a download>` clicked out of the
 * page, the URL revoked on the next line. Safari on an iPad shows such a PDF IN the tab, over
 * Raptor. So this holds four things:
 *
 *   1. saveFile on an iPad is the share sheet ("Save to Files" asks where), a cancelled sheet is not
 *      an error, and a sheet Safari refuses this long after the tap asks for a second tap rather
 *      than falling back to the very download that caused this;
 *   2. the browser's own download is done the way Safari honours (in the page, revoked later);
 *   3. Open opens the TAB ON THE PRESS, before any await, or it is a pop-up Safari blocks;
 *   4. no screen builds its own download or window any more -- every file goes through FileActions
 *      or saveFile -- and the screens the firm named actually use it.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-file-actions.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const root = new URL('../../', import.meta.url)
const read = (f) => readFileSync(new URL(f, root), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

/* ---------------- 1 and 2. saveFile, run against a stubbed browser ---------------- */

const clicks = []
const revoked = []
let appended = 0
const fakeDocument = {
  createElement: () => {
    const el = { style: {}, click() { clicks.push({ href: el.href, download: el.download, target: el.target, inPage: appended > 0 }) }, remove() { appended -= 1 } }
    return el
  },
  body: { appendChild: () => { appended += 1 } },
}
globalThis.document = fakeDocument
globalThis.URL.createObjectURL = () => 'blob:x'
globalThis.URL.revokeObjectURL = (u) => revoked.push(u)
const timers = []
const realTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms) => { timers.push(ms); return 0 }

const ipad = (share) => Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', maxTouchPoints: 5, share, canShare: () => true },
})
const mac = () => Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', maxTouchPoints: 0 },
})

const { saveFile, isAppleTouch, mimeFor } = await import('../../src/lib/fileSave.ts')
const pdf = new Blob(['%PDF'], { type: 'application/pdf' })

ipad(async () => {})
ok('an iPad that calls itself a Mac is an iPad', isAppleTouch())
mac()
ok('...and a Mac is not', !isAppleTouch())

let shared = null
ipad(async (d) => { shared = d })
check('on an iPad, Download is the share sheet', await saveFile(pdf, 'Notice.pdf'), 'saved')
check('...with the file in it, under its own name', shared?.files?.[0]?.name, 'Notice.pdf')
check('...and nothing clicked behind it', clicks.length, 0)

ipad(async () => { const e = new Error('x'); e.name = 'AbortError'; throw e })
check('closing the sheet is not an error', await saveFile(pdf, 'Notice.pdf'), 'cancelled')
check('...and does not download anyway', clicks.length, 0)

ipad(async () => { const e = new Error('x'); e.name = 'NotAllowedError'; throw e })
check('a sheet refused this long after the tap asks for a second tap', await saveFile(pdf, 'Notice.pdf'), 'needs-tap')
check('...rather than the download that drew the PDF over Raptor', clicks.length, 0)
check('on that second tap a refusal falls back to a download', await saveFile(pdf, 'Notice.pdf', { fromTap: true }), 'saved')
check('...one', clicks.length, 1)

clicks.length = 0; timers.length = 0; revoked.length = 0
mac()
check('on a computer it is an ordinary download', await saveFile(pdf, 'Notice.pdf'), 'saved')
check('...of the file under its name', clicks[0]?.download, 'Notice.pdf')
ok('...clicked IN the page (Firefox ignores a detached link)', clicks[0]?.inPage === true)
check('...aimed at a new tab, so a browser without `download` leaves Raptor where it is', clicks[0]?.target, '_blank')
check('...and NOT revoked on the next line (Safari reads it after the click returns)', revoked.length, 0)
ok('...but a minute later', timers.includes(60_000))
globalThis.setTimeout = realTimeout

check('a file with no type is typed from its name', mimeFor('Statement.PDF'), 'application/pdf')

/* ---------------- 3. Open opens the tab on the press ---------------- */

const actions = strip(read('src/components/ui/FileActions.tsx'))
const openFn = actions.slice(actions.indexOf('async function open()'), actions.indexOf('async function save('))
ok('FileActions has an Open', openFn.length > 0 && /'Open'/.test(actions))
ok('...and a Download', /'Download'/.test(actions))
const pendingAt = openFn.indexOf('openPending()')
const awaitAt = openFn.indexOf('await ')
ok('the tab is opened', pendingAt > 0)
ok('...BEFORE anything is awaited (after an await it is a pop-up)', pendingAt > 0 && awaitAt > 0 && pendingAt < awaitAt)
ok('...and closed again when the file cannot be got', /tab\.fail\(\)/.test(openFn))
ok('a refused share sheet offers the second tap with the file in hand',
  /outcome === 'needs-tap'\) \{ setReady\(file\)/.test(actions) && /save\(ready\)/.test(actions))
ok('both words are always on screen, never on hover', !/group-hover|hover:inline|hidden group/.test(actions))

/* ---------------- 4. nobody builds their own any more ---------------- */

const walk = (dir) => readdirSync(new URL(dir, root)).flatMap((n) => {
  const p = join(dir, n)
  return statSync(new URL(p, root)).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : []
})
const files = walk('src')
const ownDownload = files.filter((f) => f !== 'src/lib/fileSave.ts' && /\.download\s*=|\bdownload=\{?["'`]/.test(strip(read(f))))
check('no screen builds its own <a download> (fileSave.ts is the one place)', ownDownload, [])
/* window.open is for files only in fileSave.ts; the rest are a telephone, an email, WhatsApp and a
   tracing website, none of them a file. */
const OPEN_ALLOWED = new Set(['src/lib/fileSave.ts', 'src/pages/leads/LeadsList.tsx', 'src/pages/accounts/TraceButton.tsx'])
const ownWindow = files.filter((f) => !OPEN_ALLOWED.has(f) && /window\.open\(/.test(strip(read(f))))
check('no screen opens its own window for a file', ownWindow, [])
const navigates = files.filter((f) => /window\.location\.href\s*=\s*u\b|location\.href = data\.signedUrl/.test(strip(read(f))))
check('...nor sends Raptor itself to one', navigates, [])

for (const [what, file] of [
  ['a mail attachment', 'src/pages/mail/MailPage.tsx'],
  ['an attachment on the account’s Emails tab', 'src/pages/accounts/EmailsPanel.tsx'],
  ['an attachment on an activity', 'src/components/EmailActivityRow.tsx'],
  ['a client’s filed mandate', 'src/components/companies/MandateCard.tsx'],
  ['an account’s documents', 'src/pages/accounts/AccountWorkspacePanels.tsx'],
  ['the summary and statement of account', 'src/components/collections/AccountDocuments.tsx'],
  ['the payment simulation', 'src/components/collections/RepaymentCalculator.tsx'],
  ['a payover statement, and the copies sent', 'src/pages/finance/RunDetail.tsx'],
  ['the copies on the client’s payovers', 'src/components/companies/ClientPayoversPanel.tsx'],
  ['a trace report', 'src/pages/accounts/TraceWorkspaceModal.tsx'],
  ['a letter’s PDF preview', 'src/components/letters/PreviewPdf.tsx'],
  ['a client’s settlement acceptance', 'src/components/accounts/SettlementPanel.tsx'],
]) ok(`${what} offers Open and Download`, /<FileActions\b/.test(read(file)))
for (const [what, file] of [
  ['a CSV export', 'src/lib/csvExport.ts'], ['a spreadsheet', 'src/lib/xlsxWrite.ts'],
  ['the collections floor’s export', 'src/pages/CollectorDashboard.tsx'], ['the trust bank file', 'src/pages/trust/TrustPaymentsOut.tsx'],
]) ok(`${what} is saved through saveFile`, /saveFile\(/.test(strip(read(file))))

/* OPEN SHOWS IT, DOWNLOAD SAVES IT: a signed address is inline only when Open asked for it. */
const ws = strip(read('src/lib/accountWorkspace.ts'))
ok('a document’s address is inline only for Open', /opts\.inline \? undefined : \{ download: filename \|\| true \}/.test(ws))
ok('...and opening and downloading one are both a perusal', /openDocument\(doc, userId, \{ inline \}\)/.test(read('src/pages/accounts/AccountWorkspacePanels.tsx')))

if (failures.length) {
  console.log(`check-file-actions: ${pass} passed, ${failures.length} failed`)
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`check-file-actions: ${pass} passed, 0 failed`)
