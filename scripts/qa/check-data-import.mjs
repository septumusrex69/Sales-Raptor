/**
 * The import screen: which half of the business each file belongs to, and what the one control
 * that is not a file actually does.
 *
 * WHY THIS FILE EXISTS. The firm looked at this screen and read it wrong three times over, which
 * is the screen's fault and not theirs:
 *
 *   1. "On a client level ... that'll go with the collections. And then on the lead side, that's
 *      something different. SPLIT THEM." Six file pickers in one flat list, with nothing saying
 *      that the leads workbook and the book migration have nothing to do with each other. Split
 *      into two headings first, then -- drawn on a screenshot as two boxes side by side -- into
 *      two TABS, because stacked, the sales half still sat above the collections half and read
 *      as step one of it.
 *   2. "If I import a client, the client allocation doesn't work here." It never did. The control
 *      was labelled "Clients land on", which reads as allocating clients to collectors; what it
 *      sets is the owner every NEW client record starts under so that none arrives ownerless.
 *   3. "The debtors per client report ... is in two places. Please clarify that." One export,
 *      two jobs: read as part of the migration that BUILDS the book, and run on its own
 *      afterwards against accounts the book already has.
 *
 * Every one of those was fixed with WORDS, and words are what get tidied by the next person who
 * does not know why they were chosen. So the words are held here.
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass += 1; return }
  failures.push(`${label}\n    expected ${e}\n    got      ${a}`)
}
const ok = (label, actual) => check(label, actual, true)

const src = readFileSync(new URL('../../src/components/settings/DataImportTab.tsx', import.meta.url), 'utf8')
/* Comments stripped: every rule below is EXPLAINED in a comment beside the code that keeps it,
   so read as written, each of these checks would be answered by its own explanation. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/* ---------- 1. the two sides are tabs, and nothing crosses between them ---------- */

/*
 * THE FIRM DREW THIS: two boxes side by side, "Collections | Sales", over a pair of stacked
 * headings. The headings were the right split in the wrong shape -- stacked, the sales half sat
 * above the collections half and read as step one of it, which is what the headings were added to
 * stop. A person importing is on one side of the business that morning; the other side's cards
 * are something to scroll past.
 */
ok('the screen has a side to pick', /function Sides\(/.test(code))
ok('...offering Collections', /'collections', 'Collections'/.test(code))
ok('...and Sales', /'sales', 'Sales'/.test(code))
/* Collections first, because that is where the work is: the book is hundreds of thousands of
   accounts and the leads workbook is a few hundred rows once a month. */
ok('...opening on collections', /useState<'collections' \| 'sales'>\('collections'\)/.test(code))

/*
 * EVERY CARD IS BEHIND ITS OWN SIDE. A tab that changes a heading and leaves the cards where they
 * were is worse than the stacked headings it replaced, because now the screen actively disagrees
 * with itself. Each of the three is asserted to be guarded, by name.
 */
ok('the leads workbook only appears on the sales side',
  /\{side === 'sales' && <LeadsImportCard \/>\}/.test(code))
ok('the monthly refresh only appears on the collections side',
  /\{side === 'collections' && <DebtorDetailsCard \/>\}/.test(code))
ok('...and so does the migration', /\{side === 'collections' && \(/.test(code))

/*
 * PRESENCE BEFORE ORDER. CLAUDE.md names this trap: indexOf returns -1, so an order-only
 * assertion passes vacuously the moment the thing it orders is deleted.
 */
const at = (needle) => code.indexOf(needle)
for (const marker of ['<LeadsImportCard />', 'Bring the book across from Swordfish',
  '<DebtorDetailsCard />', "{side === 'collections' && ("]) {
  ok(`the screen still has ${marker}`, at(marker) !== -1)
}

/*
 * THE COLLECTIONS BRANCH CARRIES THE BOOK AND NOTHING ELSE. Read as the actual span of the
 * branch rather than as a slice between two headings, because the headings are gone -- and a
 * leads card that drifted inside it would render on the wrong tab while still looking right in
 * the source.
 */
const branch = code.slice(at("{side === 'collections' && ("), code.indexOf('</>'))
ok('the collections side holds the migration', /Bring the book across from Swordfish/.test(branch))
ok('...and nothing from the sales side', !/LeadsImportCard/.test(branch))

/*
 * THE REFRESH COMES AFTER THE MIGRATION, which is the whole answer to "it is in two places".
 * Above it, the same file name twice reads as a duplicated step. Below it, in order, it reads as
 * what happens next -- and the card says which is which itself, so the order is not carrying the
 * explanation alone.
 */
ok('the monthly refresh sits below the migration it follows',
  at('Bring the book across from Swordfish') < at('<DebtorDetailsCard />'))
ok('...and says it is the same file as the one above',
  /same Debtors Per Client file as above/.test(code))
ok('...and which of the two is the one to run every month',
  /the one to run every month/i.test(code))
/* The migration says it is a once-only thing in its own subtitle, rather than by sitting first. */
ok('the migration says it is once, at the start', /Once, at the start/.test(code))

/* The sentence under the tabs describes the tab you are on, not the one you are not. */
ok('the blurb follows the tab', /tabs\.find\(\(\[k\]\) => k === side\)/.test(code))

/* ---------- 2. the control that is not client allocation ---------- */

/*
 * THE LABEL WAS THE LIE. "Clients land on" beside a list of people reads as allocating clients to
 * collectors, and the firm read it exactly that way. What ownerId does is written into
 * companies.account_owner_id for every client record the register creates -- a starting point, so
 * that three hundred new clients do not arrive with no owner at all.
 */
ok('the old label is gone', !/Clients land on/.test(code))
ok('...replaced by one that says what is being set',
  /New client records start under/.test(code))
/* Said outright, because "starts under" could still be read as allocation by somebody in a hurry. */
ok('...and the help says in words that this is not client allocation',
  /Not client allocation/.test(code))
ok('...and says where allocation actually happens',
  /set on the client itself/.test(code))

/*
 * AND IT IS STILL A PICKER OF PEOPLE, not of clients. The firm asked for a CLIENT picker -- "so
 * that you can choose which client does the handover batch fall on" -- and that belongs to an
 * import of one batch onto one existing client, which does not exist yet. Renaming this control
 * to look like that one would be worse than leaving it wrong: it would look built.
 */
const picker = code.match(/New client records start under[\s\S]*?<\/label>/)
ok('the picker is readable', picker !== null)
ok('...and still offers people, because it is setting an owner', /u\.name/.test(picker?.[0] ?? ''))

/* ---------- 3. nothing here belongs to the other side ---------- */

/* ---------------------------------------------------------------- report */

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
The import screen read three ways it did not mean. Two sides that are now tabs rather than stacked
headings, with every card behind its own side so the screen cannot disagree with itself; an owner
picker that says outright it is not client allocation; and the monthly refresh sitting after the
migration it follows, saying it is the same file. Words and structure are what the next person
tidies, so both are held here.`)
