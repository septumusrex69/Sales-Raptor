/**
 * THE CASE FILES COME IN WITH THE DEBTOR.
 *
 * THE FIRM: "attach the case files. PDFs, Excel, images or whatever. When you upload a debtor."
 *
 * THE ONE WAY IN THAT COULD NOT CARRY PAPERWORK. A batch import has always taken the client's PDFs
 * -- "their PDFs, if there are any", matched to accounts by filename -- and the account page takes
 * them afterwards. A debtor captured BY HAND had neither, so the mandate, the contract and the
 * invoices sat in somebody's inbox until they remembered to open the account and upload them. An
 * account whose paperwork is somewhere else is an account nobody can answer a dispute on.
 *
 * WHAT IS GUARDED HERE:
 *
 *   - THEY GO THROUGH uploadDocument, not a second upload path. The storage path, the row, the
 *     orphan cleanup and the perusal fee all live there, and a file arriving this way has to be
 *     the same kind of thing as one uploaded on the account page.
 *   - AFTER THE ACCOUNT EXISTS, because they are filed against its id.
 *   - AND A FAILURE IS SAID. The account IS open; this cannot undo that and must not pretend to.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-case-files.mjs
 */
import { readFileSync } from 'node:fs'
import { fileSize } from '../../src/lib/fileSize.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
/* Comments off before any source assertion: the files below explain at length why a second upload
   path would be wrong, and a grep cannot tell the explanation from the thing. */
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(--|\/\/).*$/gm, '')

const modal = code('src/components/companies/AddDebtorModal.tsx')
const page = code('src/pages/companies/CompanyDetail.tsx')

/* ---------------- the box asks for them ---------------- */

ok('the add-a-debtor box takes files', /const \[files, setFiles\] = useState<File\[\]>\(\[\]\)/.test(modal))
ok('...more than one at a time', /type="file" multiple/.test(modal))
/*
 * ANY TYPE, WHICH IS THE FIRM'S OWN WORD: "PDFs, Excel, images or whatever." A client sends a
 * scanned mandate as a JPEG and an age analysis as a spreadsheet, and an `accept` of PDFs would
 * send them away to convert their own paperwork. The documents panel has never restricted it
 * either, which is the behaviour this has to match.
 */
ok('...of any kind', !/accept=/.test(modal))
/* ADDED TO WHAT IS THERE. The mandate and the invoices are usually in two folders, and a picker
   that forgot the first choice on the second makes somebody gather them elsewhere first. */
ok('...adding to what was already chosen',
  /setFiles\(\(f\) => \[\.\.\.f, \.\.\.Array\.from\(e\.target\.files \?\? \[\]\)\]\)/.test(modal))
/* AND THE SAME FILE TWICE IN A ROW STILL REGISTERS: an input that keeps its value fires no change
   event the second time, so re-choosing a file somebody removed by mistake would do nothing. */
ok('...and the same file can be chosen again', /e\.target\.value = ''/.test(modal))
/*
 * NAMED AND REMOVABLE. A count alone cannot tell somebody they attached the WRONG CLIENT'S
 * mandate, which is the mistake worth catching before the account opens rather than after.
 */
ok('the chosen files are listed by name', /\{files\.map\(\(f, i\) =>/.test(modal))
ok('...and can be taken off again',
  /setFiles\(\(all\) => all\.filter\(\(_, n\) => n !== i\)\)/.test(modal))
/* HELD UNTIL THE ACCOUNT EXISTS, not uploaded as they are chosen: they are filed against an id the
   save writes, and choosing them commits nobody to anything until Add debtor is pressed. */
ok('...and handed back with the form rather than uploaded early',
  /onSave\(form, note\.trim\(\) \|\| null, files\)/.test(modal))
ok('...with nothing uploading from the box itself', !/uploadDocument/.test(modal))

/* ---------------- and the page files them ---------------- */

/*
 * THROUGH THE ONE UPLOAD PATH. uploadDocument is where the storage path, the row, the cleanup of
 * an orphaned file when the row fails, and the perusal fee all live. A second path here would be a
 * second place that decides what a document is and what it costs.
 */
ok('the case files go through the one upload path', /await uploadDocument\(\{/.test(page))
ok('...onto the account that was just opened', /accountId: account\.id,\s*\n\s*file,/.test(page))
/*
 * AFTER THE ACCOUNT, for the same reason the note is: they hang off an id that does not exist
 * until the row above is written. Asserted by position, because that is the whole of the rule.
 */
const atCreate = page.indexOf('await createDebtorAccount(')
const atUpload = page.indexOf('await uploadDocument({')
ok('the account is opened first', atCreate > 0)
ok('...and the files filed after it', atUpload > 0 && atUpload > atCreate)
/*
 * ONE AT A TIME. In parallel the first failure leaves the rest mid-flight with nothing able to say
 * which landed, and the report below would be a guess.
 */
ok('...one at a time, so what failed is known', /for \(const file of files\) \{/.test(page))
/*
 * AND A FAILURE IS SAID, NOT SWALLOWED -- exactly as the note's is. The account IS open, so this
 * names what did not arrive rather than pretending the whole thing failed. A mandate silently
 * missing is found months later, by somebody answering a dispute.
 */
ok('a file that did not save is reported',
  /The account was opened, but \$\{failed\.length\} of \$\{files\.length\}/.test(page))
ok('...naming which ones', /failed\.push\(`\$\{file\.name\}/.test(page))

/* ---------------- one formatter, not two ---------------- */

/*
 * THE SIZE IS FORMATTED IN ONE PLACE. It began inside ComposeEmailModal, where an attachment's
 * size decides whether a message can be sent at all; this box shows the same figure. Two copies
 * drift silently -- one screen saying 1 MB where the other says 1.0 MB is reported as a bug in
 * whichever was seen second.
 */
check('bytes read as bytes', fileSize(512), '512 B')
check('...kilobytes as kilobytes', fileSize(2048), '2 KB')
check('...and megabytes to one decimal', fileSize(3 * 1024 * 1024), '3.0 MB')
const compose = code('src/components/ComposeEmailModal.tsx')
ok('the compose box reads it from there', /from '\.\.\/lib\/fileSize\.ts'/.test(compose))
ok('...and does not keep its own copy', !/function fileSize\(/.test(compose))
ok('the add-a-debtor box reads it from there too', /from '\.\.\/\.\.\/lib\/fileSize\.ts'/.test(modal))

console.log(`\ncheck-case-files: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
