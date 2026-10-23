/**
 * Writes the handover sheet the firm sends to a client.
 *
 * THE SHEET ITSELF IS DRAWN BY src/lib/handoverTemplate.ts, the same module the import screen's
 * "Download the handover sheet" and the mandate and welcome emails use. This script is only the
 * command-line door to it: read the rows, call newHandoverSheet, write the bytes. It used to carry
 * its own zip and its own XML on node:zlib, which the browser has no copy of -- and two writers of
 * one sheet is a sheet the importer reads differently the first time somebody changes one of them.
 * check-handover-template reads this file back to hold that.
 *
 * WHY A SCRIPT AND NOT A FILE IN THE REPO. The columns will change -- the firm has already been
 * through one round of this -- and a spreadsheet checked in as a binary is a spreadsheet that
 * drifts from the importer reading it. The columns live in src/lib/handoverSheet.ts, which the
 * importer also reads, and this draws the .xlsx from them. Change the list, run this, send the
 * new sheet; the importer already knows about it.
 *
 * WHAT THE FILE DOES THAT THE OLD ONE DID NOT, and each one is a failure measured on the old
 * sheet's 45 rows rather than a preference:
 *
 *   - EVERY COLUMN OF DIGITS-THAT-ARE-NOT-A-QUANTITY IS FORMATTED AS TEXT. 40 of 42 "Cell Phone
 *     2" values in the old sheet had lost their leading zero, because Excel read 0129403445 as a
 *     number. Those numbers cannot be dialled. A text column is never converted.
 *   - DATES ARE A DATE FORMAT, dd/mm/yyyy, WHICH IS HOW SOUTH AFRICA WRITES THEM. This was
 *     yyyy-mm-dd first, to dodge "02/09/2024" meaning two different days -- but that was solving
 *     the wrong problem in the wrong place. A date-formatted cell stores a SERIAL NUMBER; the
 *     format is only what the person sees. So the ambiguity never reaches the importer either
 *     way, and showing a South African bookkeeper an ISO date buys nothing and reads as foreign.
 *     What a client types day-first into a date column on a South African machine is parsed
 *     day-first by Excel, and arrives here as a number that means one day.
 *   - THE REQUIRED COLUMNS ARE COLOURED AND MARKED, so "the surname is missing" is visible while
 *     the file is being filled in rather than after 45 letters have gone out unaddressed.
 *   - A SECOND SHEET SAYS WHAT EACH COLUMN IS FOR in the firm's words, with one worked example.
 *     The example is on the notes sheet, NOT as a row in the data, because an example row left in
 *     by accident is a fictional debtor in the book.
 *
 * IT ALSO FILLS THE SHEET IN, which is what converts a client off their old one.
 *
 * THE FIRM: "some clients could possibly take it some time to change the import sheet." A client
 * who has been sent the blank sheet still has a book in the old shape, and the one thing that
 * actually moves them across is being handed their own accounts back in the new columns. So the
 * rows can be supplied, and they are written through the same column list and the same cell
 * formats as the blank file -- there is no second writer to drift from this one.
 *
 * A CONVERSION SHIPS WITH ITS OWN ACCOUNT OF ITSELF. Reading an old sheet is never a pure rename:
 * a column lands somewhere different, a leading zero is put back, a value is left out because it
 * was not what its heading claimed. `notes` writes those onto a third sheet inside the workbook,
 * beside the data they describe, because a conversion explained in an email is a conversion
 * nobody can check a year later.
 *
 * Run: node scripts/handover-template.mjs [output.xlsx] [--rows rows.json] [--old]
 *
 * --old writes the Swordfish-era sheet instead: its 55 headings in their order, nothing filled in.
 *
 * rows.json is { "rows": [ { <column key>: value } ], "notes": [ [heading, text] ] }. A date is
 * an ISO day, money is a number, everything else is a string; an absent key is an empty cell.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { HANDOVER_COLUMNS, HANDOVER_GROUPS } from '../src/lib/handoverSheet.ts'
import { newHandoverSheet, oldHandoverSheet, handoverSheetFilename, FORMATTED_ROWS } from '../src/lib/handoverTemplate.ts'

const args = process.argv.slice(2)
const rowsFlag = args.indexOf('--rows')
const old = args.includes('--old')
const supplied = rowsFlag === -1 ? { rows: [], notes: [] }
  : JSON.parse(readFileSync(args[rowsFlag + 1], 'utf8'))
const DATA = supplied.rows ?? []
const NOTES = supplied.notes ?? []
if (old && (DATA.length || NOTES.length)) {
  /* The old sheet is handed out empty. Converting a client is done INTO the new one. */
  console.error('--old writes an empty old-format sheet; --rows fills in the new one.')
  process.exit(1)
}

const out = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--rows')
  ?? handoverSheetFilename(old ? 'old' : 'new')

let bytes
try {
  bytes = old ? await oldHandoverSheet() : await newHandoverSheet({ rows: DATA, notes: NOTES })
} catch (e) {
  /* A key that matches no column would be written nowhere and noticed by nobody. */
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
}
writeFileSync(out, bytes)

console.log(`${out}`)
if (old) {
  console.log('The old (Swordfish-era) sheet: its 55 headings, digit columns held as text.')
} else {
  const required = HANDOVER_COLUMNS.filter((c) => c.required).length
  console.log(`${HANDOVER_COLUMNS.length} columns, ${required} of them required, across ${HANDOVER_GROUPS.length} groups.`)
  console.log(`${HANDOVER_COLUMNS.filter((c) => c.kind === 'text').length} formatted as text, so no leading zero is eaten.`)
  if (DATA.length) console.log(`${DATA.length} accounts filled in, and ${FORMATTED_ROWS} formatted rows below them.`)
  if (NOTES.length) console.log(`${NOTES.length} notes on "What we changed".`)
}
