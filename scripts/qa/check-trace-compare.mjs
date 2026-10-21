/**
 * What a second bureau trace found that the first one did not.
 *
 * THE FIRM: "if we have to update a trace, let's say three months later we do a trace and we can
 * update it -- like, okay, well, there's a new trace. And then it should compare it with the data
 * from the old trace and show you if there's any new data."
 *
 * TWO THINGS HERE ARE WORTH A CHECK AND THE SECOND IS THE ONE THAT MATTERS.
 *
 *   - The matching is on the NUMBER, not on how it was typed. 082 123 4567 and 0821234567 are one
 *     number, and reported as two the feature is worse than useless: it manufactures work on
 *     every re-trace, which is exactly the thing it was asked for to prevent.
 *   - Nothing claims a finding is DEAD. A number missing from a newer report is not a
 *     disconnected number -- bureaux age records out and two profiles carry different columns --
 *     and only a collector who dialled it may say otherwise. That claim lives in TraceOutcome.
 *
 * Run: node --experimental-strip-types scripts/qa/check-trace-compare.mjs
 */
import { readFileSync } from 'node:fs'
import {
  compareTraceReports, compareTraces, comparisonLine, previousTraceFor, traceKey,
} from '../../src/lib/traceCompare.ts'
import { reportsLine, traceSubjects } from '../../src/lib/traceSubjects.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) pass += 1
  else failures.push(`${name}\n    expected ${e}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

const item = (kind, value, over = {}) => ({
  id: `${kind}:${value}`, traceId: 't', accountId: 'a', kind, value, label: null,
  peopleLinked: null, seenOn: null, amount: null, status: null,
  outcome: null, outcomeAt: null, outcomeNote: null, promotedContactId: null, ...over,
})

/* ---------- a number is its digits ---------- */

/*
 * SOUTH AFRICA WRITES ONE NUMBER AT LEAST FOUR WAYS, and the bureau's own columns are not
 * consistent between a consumer profile and a commercial one. Compared as typed, every re-trace
 * reports the same four numbers as four new findings.
 */
check('spacing is not a different number',
  traceKey('mobile', '082 123 4567'), traceKey('mobile', '0821234567'))
check('...nor brackets and dashes',
  traceKey('mobile', '(082) 123-4567'), traceKey('mobile', '0821234567'))
/* +27 IS the leading nought. Kept apart, a profile that switched to the international form would
   report every number on it as new -- the same failure wearing a different hat. */
check('...nor the international form',
  traceKey('mobile', '+27 82 123 4567'), traceKey('mobile', '0821234567'))
/* AND THE THREE PHONE COLUMNS ARE ONE. A bureau files a number under Mobile on one report and
   under Home on the next; which column it sat in is not a fact about the debtor. */
check('the same number under a different column is the same number',
  traceKey('work', '0821234567'), traceKey('mobile', '0821234567'))
/* But a different number is still different, or the folding has eaten the distinction. */
ok('a different number is a different number',
  traceKey('mobile', '0821234567') !== traceKey('mobile', '0831234567'))
/*
 * A THIRTEEN-DIGIT ID TYPED INTO A PHONE COLUMN IS LEFT ALONE. The +27 rule fires only on a real
 * country code and a nine-digit subscriber number, or an ID beginning 27 would be rewritten.
 */
ok('an ID number in a phone column is not rewritten as a number',
  traceKey('phone', '2701015800085').includes('2701015800085'))

check('an email is not case', traceKey('email', 'A@B.co.za'), traceKey('email', 'a@b.co.za'))
/*
 * AN ADDRESS IS FOLDED, NOT STRIPPED. Spacing and punctuation come out; letters and digits stay,
 * because "Unit 3" and "Unit 8" must remain two addresses.
 */
check('an address that gained a comma is the same address',
  traceKey('address', '12 Protea Street, Sunnyside'), traceKey('address', '12 Protea Street Sunnyside'))
ok('...but a different unit number is a different address',
  traceKey('address', 'Unit 3 Protea') !== traceKey('address', 'Unit 8 Protea'))

/* ---------- what the second report bought ---------- */

const before = [
  item('mobile', '082 123 4567'),
  item('address', '12 Protea Street, Sunnyside'),
  item('employer', 'Acme Mining'),
]
const after = [
  item('mobile', '0821234567'),
  item('mobile', '0839998888'),
  item('address', '12 Protea Street Sunnyside'),
  item('email', 'j@example.co.za'),
]
const c = compareTraceReports(after, before)
check('what is genuinely new is counted', c.added, 2)
check('...what carried over is counted', c.carried, 2)
check('...and what was on the earlier one and is not on this one', c.dropped, 1)
check('...which is the employer', c.changes.find((x) => x.state === 'dropped')?.value, 'Acme Mining')
/* NEW FIRST, because that is the order somebody reads them in and the order of what each is
   worth. A re-trace is read to find the two lines that changed. */
check('the new findings come first',
  c.changes.slice(0, 2).map((x) => x.state), ['new', 'new'])
/* The bureau's own order is kept within a state: the first number on a profile is generally the
   one it is most confident of, and re-ranking it is not ours to do. */
check('...in the order the bureau gave them',
  c.changes.filter((x) => x.state === 'new').map((x) => x.value), ['0839998888', 'j@example.co.za'])
/* A dropped finding carries no item: there is nothing on this report to act on. */
check('a dropped finding has nothing to act on',
  c.changes.find((x) => x.state === 'dropped')?.item, null)

/* A FIRST TRACE IS ALL NEW, which is the case that would otherwise divide by nothing. */
check('the first trace is all new', compareTraceReports(after, []).added, after.length)
check('...and nothing carried', compareTraceReports(after, []).carried, 0)
check('an empty report finds nothing', compareTraceReports([], before).added, 0)
check('...and says the lot is not on it', compareTraceReports([], before).dropped, 3)

/* ---------- and what it says ---------- */

ok(`the line names what is new (${comparisonLine(c)})`, /2 new findings/.test(comparisonLine(c)))
ok('...and what carried over', /2 were on the earlier one too/.test(comparisonLine(c)))
/*
 * ABSENCE IS NOT EVIDENCE, AND THIS IS THE ASSERTION THE WHOLE FILE TURNS ON. A number missing
 * from a newer report is NOT a dead number: bureaux age records out, a consumer profile and a
 * commercial one carry different columns, and two pulls minutes apart can differ. Only a
 * collector who dialled it may say otherwise, and that claim lives in TraceOutcome.
 */
const line = comparisonLine(c)
ok('nothing is called gone, dead or disconnected',
  !/\bgone\b|\bdead\b|disconnected|no longer/i.test(line))
ok('...it says what is true instead', /is not on this one/.test(line))
/*
 * ASKED OF THE SOURCE AS WELL, because the next person to write a sentence in here is who this is
 * for. Comments are stripped FIRST: they discuss the words at length -- that is the point of them
 * -- and read with the prose in, an apostrophe in "bureau's" opened a span that swallowed half a
 * paragraph and matched. The word "dropped" is the state's name in code and reaches no screen.
 */
const source = readFileSync(new URL('../../src/lib/traceCompare.ts', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const sentences = [...source.matchAll(/'([^']*)'|`([^`]*)`/g)].map((m) => m[1] ?? m[2])
ok(`...and no sentence in the file claims it either (${
  sentences.filter((x) => /\b(gone|dead|disconnected)\b/i.test(x)).join(' | ')})`,
  !sentences.some((x) => /\b(gone|dead|disconnected)\b/i.test(x)))

/*
 * NOTHING NEW IS SAID OUT LOUD, and that is not a consolation prize. A second search the account
 * has been charged Annexure B item 4(c) for, which found nothing the first one did not, is a fact
 * worth putting in front of whoever decides to run a third.
 */
const nothingNew = comparisonLine(compareTraceReports(before, before))
ok(`a search that bought nothing says so (${nothingNew})`,
  /Nothing on this report that the previous one did not already have/.test(nothingNew))
check('...and counts none', compareTraceReports(before, before).added, 0)

/* Singulars, because "1 new findings" is the thing people notice and stop trusting. */
ok('one is not "1 new findings"',
  /\b1 new finding\b/.test(comparisonLine(compareTraceReports([...before, item('mobile', '0831112222')], before))))
ok('...and one dropped is not "1 findings"',
  /\b1 finding on the earlier report is not on this one\b/
    .test(comparisonLine(compareTraceReports(before.slice(0, 2), before))))

/* compareTraces is what the screen lists; the counts above are derived from it and must agree. */
check('the list and the counts are the same thing',
  compareTraces(after, before).length, c.changes.length)

/* ---------- and it is read against the right earlier report ---------- */

/*
 * THE SAME SUBJECT, AND THAT IS THE WHOLE OF THE CARE HERE. A company account carries one trace
 * for the company and one for each director, so "the previous trace" by date is very often a
 * different PERSON -- and compared against it every finding on both would be reported as new,
 * which is worse than saying nothing at all.
 */
const trace = (id, over = {}) => ({
  id, subjectKind: 'debtor', directorId: null, subjectName: null, enquiredOn: null,
  createdAt: '2026-01-01T00:00:00Z', items: [], ...over,
})

const debtorNew = trace('d2', { enquiredOn: '2026-09-01' })
const debtorOld = trace('d1', { enquiredOn: '2026-06-01' })
const directorOne = trace('x1', { subjectKind: 'director', directorId: 'dir-1', enquiredOn: '2026-08-01' })
check('the previous report about the same person is found',
  previousTraceFor([debtorNew, directorOne, debtorOld], debtorNew)?.id, 'd1')
check('...and a director’s report is not read as the debtor’s',
  previousTraceFor([debtorNew, directorOne], debtorNew), null)
check('...nor one director’s as another’s',
  previousTraceFor([
    trace('x2', { subjectKind: 'director', directorId: 'dir-2', enquiredOn: '2026-09-01' }),
    directorOne,
  ], trace('x2', { subjectKind: 'director', directorId: 'dir-2', enquiredOn: '2026-09-01' })), null)
check('a first report has nothing to compare against',
  previousTraceFor([debtorOld], debtorOld), null)

/*
 * ORDERED BY WHEN THE BUREAU LOOKED, not by when the PDF was filed. A report pulled in March can
 * be uploaded today -- enquiredOn comes off the report itself -- so ordering on createdAt alone
 * would call the six-month-old one "newer" and report its stale numbers as new findings.
 */
const filedToday = trace('late', { enquiredOn: '2026-03-01', createdAt: '2026-09-22T00:00:00Z' })
const pulledRecently = trace('recent', { enquiredOn: '2026-09-01', createdAt: '2026-09-01T00:00:00Z' })
check('the earlier report is the one the bureau looked at earlier',
  previousTraceFor([filedToday, pulledRecently], pulledRecently)?.id, 'late')
/* And the newest is never compared against something pulled AFTER it. */
check('...and a later report is not offered as the earlier one',
  previousTraceFor([filedToday, pulledRecently], filedToday), null)

/* ---------------------------------------------------------------------------------------------
 * ONE PERSON, ONE TRACE
 *
 * THE FIRM: "there should not be two traces on a single individual... one person can have one
 * trace on the trace results. If it's the second one, a next of kin, it opens a new trace."
 *
 * WHICH IS A DIFFERENT CUT OF THE SAME DATA. previousTraceFor answers "what should THIS report be
 * read against"; traceSubjects answers "how many people are on this account, and which report
 * speaks for each". They key on the same thing deliberately -- two statements of "the same
 * subject" would eventually disagree, and that failure shows as a card claiming an update with
 * nothing new on it, for ever.
 * ------------------------------------------------------------------------------------------- */

const named = (id, over) => trace(id, { subjectName: null, ...over })

{
  const subjects = traceSubjects([debtorNew, directorOne, debtorOld])
  /* TWO PEOPLE OUT OF THREE REPORTS. This is the whole of what the firm was looking at: the
     debtor traced twice drew two cards carrying the same address, employer and next of kin. */
  check('three reports about two people are two subjects', subjects.length, 2)
  check('...and the debtor comes first', subjects[0].kind, 'debtor')
  /* THE LATEST SPEAKS FOR THE SUBJECT, and the one before it is what the card compares against. */
  check('...showing their newest report', subjects[0].latest.id, 'd2')
  check('...against their own previous one', subjects[0].previous?.id, 'd1')
  check('...and counting how many there are', subjects[0].reports, 2)
  /* A director traced once has nothing to compare against and must not borrow the debtor's. */
  check('a first report has no previous one', subjects[1].previous, null)
  check('...and says so by counting one', subjects[1].reports, 1)
}

/*
 * WHEN THE BUREAU LOOKED, NOT WHEN THE ROW WAS WRITTEN -- the same rule previousTraceFor uses. A
 * PDF filed today can be a report pulled in March, so ordering on createdAt alone would make a
 * six-month-old report the one the card draws and report its stale numbers as this week's news.
 */
{
  const stale = named('late', { enquiredOn: '2026-03-01', createdAt: '2026-09-22T00:00:00Z' })
  const fresh = named('recent', { enquiredOn: '2026-09-01', createdAt: '2026-09-01T00:00:00Z' })
  const [only] = traceSubjects([stale, fresh])
  check('the card draws the report the bureau pulled last', only.latest.id, 'recent')
  check('...and compares it against the older one', only.previous?.id, 'late')
}

/*
 * A DIRECTOR IS KEYED ON THEIR ID, NOT THEIR NAME. A bureau prints "E FERREIRA" on one report and
 * "Elizabeth Ferreira" on the next, and those are one person -- keyed on the name they would be
 * two subjects, and the second report would draw as a brand new person with nothing to compare
 * against, which is the bug this whole change is about.
 */
{
  const first = named('f1', { subjectKind: 'director', directorId: 'dir-9', subjectName: 'E FERREIRA', enquiredOn: '2026-05-01' })
  const second = named('f2', { subjectKind: 'director', directorId: 'dir-9', subjectName: 'Elizabeth Ferreira', enquiredOn: '2026-09-01' })
  const subjects = traceSubjects([second, first])
  check('two spellings of one director are one subject', subjects.length, 1)
  check('...named as the newest report has them', subjects[0].name, 'Elizabeth Ferreira')
  /* AND A DIRECTOR WITH NO ID FALLS BACK TO THE NAME rather than joining every unidentified
     director into one. Squeezed and lowercased, so spacing and case do not split them. */
  const a = named('a', { subjectKind: 'director', directorId: null, subjectName: 'Jan  Botha' })
  const b = named('b', { subjectKind: 'director', directorId: null, subjectName: 'jan botha' })
  check('...and one without an id is matched on the name', traceSubjects([a, b]).length, 1)
  const c = named('c', { subjectKind: 'director', directorId: null, subjectName: 'Someone Else' })
  check('...but not to a different name', traceSubjects([a, c]).length, 2)
}

/* THE DEBTOR'S CARD IS NOT HEADED WITH THEIR NAME. It is the heading of the account they are
   looking at, and repeating it is the bulk the firm asked to be rid of. */
check('the debtor\'s own card needs no name on it', traceSubjects([debtorNew])[0].name, null)
/* AND "2 reports" IS SAID ONLY WHERE THERE ARE TWO. A line reading "1 report" on every ordinary
   first trace is furniture. */
check('one report says nothing about how many there are',
  reportsLine(traceSubjects([debtorNew])[0]), null)
check('...and two say so', reportsLine(traceSubjects([debtorNew, debtorOld])[0]),
  '2 reports — showing the latest')

/* NOTHING AT ALL IS NOT A CRASH. An account with no trace draws no cards, and a function that
   threw on an empty list would take the whole panel with it. */
check('an account with no trace has no subjects', traceSubjects([]).length, 0)

/* ---------- and it is on the screen, not merely computed ---------- */

const detail = readFileSync(new URL('../../src/pages/accounts/AccountDetail.tsx', import.meta.url), 'utf8')
/*
 * AND IT IS ON THE CARD NOW, NOT OVER THE PANEL.
 *
 * THE FIRM, looking at an account traced twice: "there should not be two traces on a single
 * individual... one person can have one trace on the trace results." The panel drew a card per
 * REPORT, so a debtor traced twice got two cards carrying the same address, the same employer and
 * the same next of kin -- and the comparison had to be a banner above them both, because with two
 * cards for one person there was no card it belonged to.
 *
 * Grouped by subject there is one, and on a company account with four directors a single banner
 * was answering for whichever of them happened to be traced last.
 */
ok('the panel groups the reports by who they are about', /traceSubjects\(traces\)/.test(detail))
ok('...and draws one card for each person', /subjects\.map\(\(subject\) =>/.test(detail))
ok('...comparing that person\'s newest report with their own previous one',
  /compareTraceReports\(trace\.items, subject\.previous\.items\)/.test(detail))
/* One report has nothing to say, and a line saying so would be a line about nothing. */
ok('...and says nothing where there is only one report',
  /subject\.previous\s*\n?\s*\? compareTraceReports/.test(detail))

/*
 * AND WHAT IS NEW IS LISTED, NOT COUNTED. THE FIRM: "it only shows the new results -- oh, there's
 * a new phone number, or oh, there's a new address, or oh, this guy bought a new property -- and
 * it kind of flags that, puts it on top, like new info."
 *
 * "4 new findings on this report" still leaves somebody reading the whole card to find the four,
 * which is the work they were complaining about.
 */
ok('the new findings are named', /newFindingWord\(c\.kind\)/.test(detail))
ok('...under a heading that dates them', /New since \{earlierOn/.test(detail))
ok('...and a second search that bought nothing says so',
  /Nothing on this report the one before it did not already have\./.test(detail))
/*
 * AND NOTHING DROPPED IS DRAWN. A number on the earlier report and not on this one is not a dead
 * number: bureaux age records out and two profiles carry different columns. Only a collector who
 * dialled it may say otherwise. Asserted as an absence over the block that lists the new ones.
 */
{
  const card = detail.slice(detail.indexOf('function TraceFound'), detail.indexOf('function Finding'))
  ok('the card lists what is new', /c\.state === 'new'/.test(card))
  ok('...and never what is missing', !/'dropped'/.test(card))
}

console.log(`${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
