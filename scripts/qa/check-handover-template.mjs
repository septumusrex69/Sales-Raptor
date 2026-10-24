/**
 * THE HANDOVER SHEET THE FIRM HANDS OUT IS THE ONE THE IMPORTER READS.
 *
 * The firm, 23 Oct: "Give me a copy of the handover template for the importer of the handovers.
 * That should go out on the welcome letter as well. And it should go out with the mandate as well
 * ... Export the new handover sheet or export the old handover sheet."
 *
 * So the sheet now leaves Raptor three ways -- the import screen's download, the mandate and the
 * welcome letter -- and the script that converts a client's old file writes it a fourth. What this
 * holds:
 *
 *   1. The NEW sheet the BROWSER writes (handoverTemplate.ts, run here exactly as the page runs it)
 *      is unzipped with node:zlib and read: the headings are HANDOVER_COLUMNS' labels in order, the
 *      required ones marked and coloured, every digit column text-formatted, every date column
 *      dd/mm/yyyy, and the notes sheet is there.
 *   2. The script is the same writer, not a lookalike: it imports the module, carries no zip or XML
 *      of its own, and the file it writes is byte-for-byte the module's.
 *   3. The OLD sheet is the old sheet's 55 headings in order, and every one of them is something the
 *      importer reads -- a column through aliasIndex or a decision through NOT_COLLECTED -- so what
 *      we hand out is what comes back in.
 *   4. The three places it leaves from actually send it.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-handover-template.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { HANDOVER_COLUMNS, aliasIndex, notCollectedIndex, headingKey } from '../../src/lib/handoverSheet.ts'
import {
  OLD_HANDOVER_HEADINGS, newHandoverSheet, oldHandoverSheet, handoverSheetFilename, oldHeadingKind,
  handoverSheetAttachment,
} from '../../src/lib/handoverTemplate.ts'
import { welcomeEmail } from '../../src/lib/welcomeEmail.ts'

const root = new URL('../..', import.meta.url).pathname
const read = (p) => readFileSync(join(root, p), 'utf8')

let pass = 0
const failures = []
const ok = (name, cond) => { if (cond) pass += 1; else failures.push(name) }
const check = (name, got, want) => {
  const a = JSON.stringify(got); const b = JSON.stringify(want)
  if (a === b) pass += 1; else failures.push(`${name}\n      got:  ${a}\n      want: ${b}`)
}

/* ---------------------------------------------------------------- a zip reader, node:zlib */

/** Every entry of a zip, by name, as text. Method 8 is inflated; method 0 is taken as it is. */
function unzip(bytes) {
  const buf = Buffer.from(bytes)
  const out = new Map()
  let i = 0
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8)
    const size = buf.readUInt32LE(i + 18)
    const nameLen = buf.readUInt16LE(i + 26)
    const extraLen = buf.readUInt16LE(i + 28)
    const name = buf.toString('utf8', i + 30, i + 30 + nameLen)
    const from = i + 30 + nameLen + extraLen
    const body = buf.subarray(from, from + size)
    out.set(name, { method, text: (method === 8 ? inflateRawSync(body) : body).toString('utf8') })
    i = from + size
  }
  return out
}

/** Row 1's cells: [{ ref, style, text }], in the order they are written. */
function headerCells(sheetXml) {
  const row = (sheetXml.match(/<row r="1"[^>]*>([\s\S]*?)<\/row>/) ?? [])[1] ?? ''
  return [...row.matchAll(/<c r="([A-Z]+)1" s="(\d+)"[^>]*>(?:<is><t[^>]*>([\s\S]*?)<\/t><\/is>)?<\/c>/g)]
    .map((m) => ({ ref: m[1], style: Number(m[2]), text: (m[3] ?? '').replace(/&amp;/g, '&') }))
}

/** cellXfs index -> number format code, so a style can be asked what it LOOKS like. */
function formats(stylesXml) {
  const custom = new Map([...stylesXml.matchAll(/<numFmt numFmtId="(\d+)" formatCode="([^"]*)"\/>/g)].map((m) => [Number(m[1]), m[2]]))
  const xfs = (stylesXml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/) ?? [])[1] ?? ''
  /* 49 is Excel's built-in "@", text; 0 is General. */
  return [...xfs.matchAll(/<xf numFmtId="(\d+)"/g)].map((m) => {
    const id = Number(m[1])
    return id === 49 ? '@' : id === 0 ? 'General' : (custom.get(id) ?? `#${id}`)
  })
}

/** The style a column's cell on row 2 carries -- the first row a client types into. */
function row2Style(sheetXml, ref) {
  const m = sheetXml.match(new RegExp(`<c r="${ref}2" s="(\\d+)"`))
  return m ? Number(m[1]) : -1
}

/* ---------------------------------------------------------------- 1. the new sheet */

const newBytes = await newHandoverSheet()
const z = unzip(newBytes)
ok('the new sheet is a zip with a workbook in it', z.has('xl/workbook.xml'))
ok('...whose parts are deflated, so it is small enough to ride on an email', z.get('xl/worksheets/sheet1.xml')?.method === 8)
ok('...and it is under 200 kB', newBytes.length < 200 * 1024)
const sheet1 = z.get('xl/worksheets/sheet1.xml')?.text ?? ''
const fmt = formats(z.get('xl/styles.xml')?.text ?? '')
const heads = headerCells(sheet1)

/* PRESENCE BEFORE ORDER: an empty header row would compare equal to nothing at all. */
check('the header row has one cell per column', heads.length, HANDOVER_COLUMNS.length)
check('...and the headings are HANDOVER_COLUMNS’ labels, in order',
  heads.map((h) => h.text.replace(/ \*$/, '')), HANDOVER_COLUMNS.map((c) => c.label))
check('every required column is marked *, and nothing else is',
  heads.filter((h) => h.text.endsWith(' *')).map((h) => h.text.replace(/ \*$/, '')),
  HANDOVER_COLUMNS.filter((c) => c.required).map((c) => c.label))
const reqStyles = new Set(heads.filter((_, i) => HANDOVER_COLUMNS[i].required).map((h) => h.style))
const optStyles = new Set(heads.filter((_, i) => !HANDOVER_COLUMNS[i].required).map((h) => h.style))
ok('...and coloured: required headings share one style the optional ones do not',
  reqStyles.size === 1 && optStyles.size === 1 && [...reqStyles][0] !== [...optStyles][0])
const reqXf = (z.get('xl/styles.xml')?.text.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? '')
  .split('<xf ').slice(1)[[...reqStyles][0] ?? -1] ?? ''
ok('...with a fill on it', /applyFill="1"/.test(reqXf) && !/fillId="0"/.test(reqXf))

const textCols = HANDOVER_COLUMNS.map((c, i) => [c, heads[i]?.ref]).filter(([c]) => c.kind === 'text')
ok('there are digit columns to hold to the text format', textCols.length > 10)
check('every digit column’s first row is formatted as TEXT, so no leading zero is eaten',
  textCols.filter(([, ref]) => fmt[row2Style(sheet1, ref)] !== '@').map(([c]) => c.key), [])
for (const key of ['cell_1', 'id_number', 'street_code', 'client_reference']) {
  ok(`...${key} among them`, textCols.some(([c]) => c.key === key))
}
const dateCols = HANDOVER_COLUMNS.map((c, i) => [c, heads[i]?.ref]).filter(([c]) => c.kind === 'date')
ok('there are date columns', dateCols.length >= 2)
check('every date column is formatted dd/mm/yyyy, as South Africa writes a date',
  dateCols.filter(([, ref]) => fmt[row2Style(sheet1, ref)] !== 'dd/mm/yyyy').map(([c]) => c.key), [])
/* And the column FORMAT too, which is what Excel applies past the formatted rows. */
const colStyles = [...sheet1.matchAll(/<col min="(\d+)"[^>]*style="(\d+)"/g)].map((m) => [Number(m[1]) - 1, Number(m[2])])
check('the column formats agree with the cells',
  colStyles.filter(([i, s]) => (HANDOVER_COLUMNS[i]?.kind === 'text' && fmt[s] !== '@') || (HANDOVER_COLUMNS[i]?.kind === 'date' && fmt[s] !== 'dd/mm/yyyy')).length, 0)
check('...one per column', colStyles.length, HANDOVER_COLUMNS.length)
ok('no row of data is written into the blank sheet -- an example row is a fictional debtor',
  !/<row r="2">[^]*?<t[^>]*>[^<]+<\/t>[^]*?<\/row>/.test(sheet1.split('<row r="3">')[0]))

const workbook = z.get('xl/workbook.xml')?.text ?? ''
ok('the notes sheet is in the workbook', /<sheet name="How to fill it in"/.test(workbook))
const notes = z.get('xl/worksheets/sheet2.xml')?.text ?? ''
check('...and explains every column', HANDOVER_COLUMNS.filter((c) => !notes.includes(`>${c.label.replace(/&/g, '&amp;')}<`)).map((c) => c.key), [])
ok('...with a worked example', notes.includes('One row, filled in'))
ok('a blank sheet has no "What we changed" tab', !workbook.includes('What we changed') && !z.has('xl/worksheets/sheet3.xml'))
check('the content types name exactly the sheets there are',
  ((z.get('[Content_Types].xml')?.text ?? '').match(/worksheets\/sheet\d\.xml/g) ?? []).length,
  [...z.keys()].filter((k) => k.startsWith('xl/worksheets/')).length)

/* ---------------------------------------------------------------- 2. the script is the module */

const script = read('scripts/handover-template.mjs')
ok('the script imports the browser’s writer', /from '\.\.\/src\/lib\/handoverTemplate\.ts'/.test(script))
ok('...and calls it', /newHandoverSheet\(/.test(script))
ok('...and has no zip of its own', !/deflateRawSync|0x04034b50|crc32/.test(script))
ok('...and no sheet XML of its own', !/<worksheet|<styleSheet|<row r=/.test(script))
const dir = mkdtempSync(join(tmpdir(), 'handover-template-'))
try {
  const out = join(dir, 'blank.xlsx')
  execFileSync(process.execPath, ['scripts/handover-template.mjs', out], { cwd: root, stdio: 'pipe' })
  ok('the script writes the same bytes the browser does', Buffer.compare(readFileSync(out), Buffer.from(newBytes)) === 0)
  const outOld = join(dir, 'old.xlsx')
  execFileSync(process.execPath, ['scripts/handover-template.mjs', outOld, '--old'], { cwd: root, stdio: 'pipe' })
  ok('...and --old writes the old sheet the browser does', Buffer.compare(readFileSync(outOld), Buffer.from(await oldHandoverSheet())) === 0)
} finally {
  rmSync(dir, { recursive: true, force: true })
}

/* ---------------------------------------------------------------- 3. the old sheet */

const zo = unzip(await oldHandoverSheet())
const oldSheet = zo.get('xl/worksheets/sheet1.xml')?.text ?? ''
const oldFmt = formats(zo.get('xl/styles.xml')?.text ?? '')
const oldHeads = headerCells(oldSheet)
check('the old sheet carries all 55 of the old headings', oldHeads.length, 55)
check('...exactly as and in the order the firm’s file had them', oldHeads.map((h) => h.text), [...OLD_HANDOVER_HEADINGS])
check('...on one sheet', [...zo.keys()].filter((k) => k.startsWith('xl/worksheets/')), ['xl/worksheets/sheet1.xml'])
ok('...with no row of anybody’s data in it', !/<row r="2">[^]*?<t[^>]*>[^<]+<\/t>/.test(oldSheet))

/*
 * THE IMPORTER READS WHAT WE HAND OUT. Every heading is a column (aliasIndex) or a decision
 * (NOT_COLLECTED, reported with its reason). "Client Division" was the one heading nobody had
 * decided about until S11, when the firm put it on NOT_COLLECTED; so there is now NO exception,
 * and a heading added to the old sheet without a decision fails here.
 */
const alias = aliasIndex()
const declined = notCollectedIndex()
check('every old heading is read by the importer -- a column or a decision',
  OLD_HANDOVER_HEADINGS.filter((h) => !alias.has(headingKey(h)) && !declined.has(headingKey(h))), [])
ok('...and "Client Division" is a decision with its reason',
  declined.get(headingKey('Client Division')) === 'the client is chosen when the batch is uploaded')

const oldRefs = new Map(oldHeads.map((h) => [h.text, h.ref]))
const oldDigits = OLD_HANDOVER_HEADINGS.filter((h) => alias.get(headingKey(h))?.kind === 'text'
  || /Phone|Fax|Kin Number|Passport|ID|code$/i.test(h))
ok('the old sheet has digit columns', oldDigits.length > 20)
check('...and every one is formatted as TEXT, which the original was not',
  oldDigits.filter((h) => oldFmt[row2Style(oldSheet, oldRefs.get(h))] !== '@'), [])
const oldDates = OLD_HANDOVER_HEADINGS.filter((h) => alias.get(headingKey(h))?.kind === 'date' || /Date$/.test(h))
ok('the old sheet has date columns', oldDates.length >= 3)
check('...each formatted dd/mm/yyyy',
  oldDates.filter((h) => oldFmt[row2Style(oldSheet, oldRefs.get(h))] !== 'dd/mm/yyyy'), [])
check('...and the kind table agrees with the importer for every mapped heading',
  OLD_HANDOVER_HEADINGS.filter((h) => alias.has(headingKey(h)) && alias.get(headingKey(h)).kind !== 'choice'
    && oldHeadingKind(h) !== alias.get(headingKey(h)).kind), [])

/* ---------------------------------------------------------------- 4. where it leaves from */

check('the new sheet’s filename', handoverSheetFilename('new'), 'Bredell Ferreira handover sheet.xlsx')
check('the old sheet’s filename', handoverSheetFilename('old'), 'Bredell Ferreira handover sheet (old format).xlsx')
check('...named for the firm when firm settings say who that is', handoverSheetFilename('new', 'Acme Legal'), 'Acme Legal handover sheet.xlsx')
check('...and never a filename with a slash in it', handoverSheetFilename('new', 'A/B'), 'A B handover sheet.xlsx')

const att = await handoverSheetAttachment()
check('the attachment is the new sheet, by name', att.filename, 'Bredell Ferreira handover sheet.xlsx')
ok('...as base64 of the same bytes', Buffer.from(att.content, 'base64').equals(Buffer.from(newBytes)))
check('...as a spreadsheet', att.contentType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

const importCard = read('src/components/settings/HandoverImportCard.tsx')
ok('the import screen offers the downloads', /<HandoverSheetDownload\s*\/>/.test(importCard))
const dl = read('src/components/settings/HandoverSheetDownload.tsx')
ok('...both of them, the new one recommended', dl.includes('New handover sheet (recommended)') && dl.includes('Old handover sheet'))
ok('...drawn by the shared writer', /handoverSheetBytes\(/.test(dl) && /handoverSheetFilename\(/.test(dl))

const mandate = read('src/components/leads/SendMandateModal.tsx')
ok('the mandate draws the sheet', /handoverSheetAttachment\(/.test(mandate))
ok('...and puts it in the composer beside the PDF, where it can be taken off',
  /initialAttachments=\{compose\.sheet \? \[compose\.file, compose\.sheet\]/.test(mandate))
ok('...and the default text says so only when it goes', /sheetFile \? 'Also attached is our handover sheet/.test(mandate))

const card = read('src/components/companies/WelcomeCard.tsx')
ok('the welcome draws the sheet', /handoverSheetAttachment\(/.test(card))
ok('...sends it to the welcome route', /attachments: \[\{ filename: sheet\.filename/.test(card))
ok('...and shows it, with a way to take it off', /aria-label=\{`Remove \$\{sheetName\}`\}/.test(card) && /setWithSheet\(false\)/.test(card))

const route = read('api/_lib/email/welcome.ts')
check('the welcome route passes it to BOTH sends (her mailbox, and the closer’s fallback)',
  (route.match(/await sendAsUser\(admin, [a-zA-Z.]+, \{ to, .*bodyHtml: mail\.html, attachments: sheets \}\)/g) ?? []).length, 2)
ok('...takes only one spreadsheet', /\.slice\(0, 1\)/.test(route) && /\\\.xlsx\$/.test(route))
ok('...and the letter mentions it only when it is attached', /handoverSheetAttached: sheets\.length > 0/.test(route))

const said = welcomeEmail({ clientName: 'Abc', contactName: null, liaison: { name: 'Bonita M', email: null, phone: null, whatsapp: null }, closerName: null, bannerUrl: 'x', handoverSheetAttached: true })
const unsaid = welcomeEmail({ clientName: 'Abc', contactName: null, liaison: { name: 'Bonita M', email: null, phone: null, whatsapp: null }, closerName: null, bannerUrl: 'x' })
ok('the welcome letter points at the sheet when it is attached', /attached our handover sheet/.test(said.text))
ok('...and not when it is not', !/handover sheet/.test(unsaid.text))

/* ANNEXURE B: a mandate and a welcome are sales and client correspondence, not a debtor's account.
   CLAUDE.md: fees are charged on ACCOUNTS ONLY. Nothing that sends the sheet raises one. */
for (const [name, src] of [['SendMandateModal', mandate], ['WelcomeCard', card], ['welcome route', route], ['HandoverSheetDownload', dl]]) {
  ok(`${name} raises no Annexure B charge`, !/annexureB|raise_charge|account_charges|chargeFor\(/i.test(src))
}

/* ---------------------------------------------------------------- report */

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
The sheet the firm hands out -- downloaded from the import screen, attached to the mandate and to
the welcome letter, or written by the script -- is one writer's output, and every heading on either
sheet is one the importer reads.`)
