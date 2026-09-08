/**
 * Prove the zip and spreadsheet readers work on the real exports.
 *
 * They use DecompressionStream and DOMParser, which are browser APIs — so this runs them in a
 * real browser against the real files rather than testing a Node stand-in that would not be the
 * code the import actually uses.
 *
 *   node scripts/qa/check-readers.mjs <file> [file ...]
 *
 * Prints what each file parsed into. Exits non-zero if any file fails to read.
 */
import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const files = process.argv.slice(2).filter((a) => !a.startsWith('-'))
if (files.length === 0) {
  console.error('Usage: node scripts/qa/check-readers.mjs <file> [file ...]')
  process.exit(2)
}

const { chromium } = await import(
  `${execSync('npm root -g', { encoding: 'utf8' }).trim()}/playwright/index.mjs`
)

// A page served by Vite, so the readers arrive as modules exactly as the app loads them.
const server = spawn('npm', ['run', 'dev', '--', '--port', '5198'], { stdio: ['ignore', 'pipe', 'pipe'] })
const stop = () => { if (!server.killed) server.kill('SIGTERM') }
process.on('exit', stop)

const ORIGIN = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('dev server did not start')), 60_000)
  let buffered = ''
  server.stdout.on('data', (d) => {
    buffered += String(d)
    const m = /http:\/\/localhost:(\d+)/.exec(buffered)
    if (m) { clearTimeout(timer); resolve(`http://localhost:${m[1]}`) }
  })
  server.on('exit', (c) => { clearTimeout(timer); reject(new Error(`dev server exited (${c})`)) })
})

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage()
page.on('pageerror', (e) => console.error('pageerror:', e.message))

// Any served route will do — the point is an origin the module graph can be imported from.
await page.goto(`${ORIGIN}/login`, { waitUntil: 'networkidle' })

let failed = false
for (const file of files) {
  const bytes = Array.from(new Uint8Array(fs.readFileSync(file)))
  const name = path.basename(file)
  try {
    const result = await page.evaluate(async ({ bytes, name }) => {
      const { readSingleCsvFromZip } = await import('/src/lib/zip.ts')
      const { readXlsx } = await import('/src/lib/xlsx.ts')
      const { parseCsv } = await import('/src/lib/csv.ts')
      const buffer = new Uint8Array(bytes).buffer
      const lower = name.toLowerCase()
      const rows = lower.endsWith('.zip') ? parseCsv(await readSingleCsvFromZip(buffer))
        : lower.endsWith('.xlsx') ? await readXlsx(buffer)
          : parseCsv(new TextDecoder().decode(buffer))
      // Dates are the part most likely to be silently wrong, so show every one the file has.
      const dateKeys = Object.keys(rows[0] ?? {}).filter((k) => /date/i.test(k))
      const dates = rows.map((r) => dateKeys.map((k) => r[k]).filter(Boolean).join(' ')).filter(Boolean)
      return {
        rows: rows.length,
        columns: Object.keys(rows[0] ?? {}).length,
        sample: rows[0] ?? {},
        dates: [...new Set(dates)].slice(0, 6),
      }
    }, { bytes, name })
    const keys = Object.keys(result.sample).slice(0, 4)
    console.log(`PASS  ${name}`)
    console.log(`        ${result.rows} rows x ${result.columns} columns`)
    for (const k of keys) console.log(`        ${k} = ${JSON.stringify(result.sample[k]).slice(0, 60)}`)
    if (result.dates.length) console.log(`        dates seen: ${result.dates.join(' | ')}`)
  } catch (e) {
    failed = true
    console.error(`FAIL  ${name}\n        ${e instanceof Error ? e.message.split('\n')[0] : e}`)
  }
}

await browser.close()
stop()
process.exit(failed ? 1 : 0)
