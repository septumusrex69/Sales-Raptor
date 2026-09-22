/**
 * The clerk is told, and told the truth.
 *
 * THE FIRM: "then it should go to the clerk dashboard and ping, or there should be some sort of
 * notification that's being shown to the clerk that, oh, you've received seven new handovers and
 * referrals ... and then it should give you an option to go to your diary to look at them, or
 * just to see them, the list of them."
 *
 * THREE THINGS HERE ARE WORTH A CHECK AND ONLY ONE OF THEM IS THE WORDING. A bell that goes to
 * the person who pressed the button teaches everybody to ignore bells. Two bells for one action
 * does the same thing faster. And a count taken off the plan rather than off what was written
 * tells a clerk they have twelve accounts when nine landed -- which the clerk cannot check
 * without doing the hand-out again by hand.
 *
 * The count comes from handOutWrite, so this also reads that file back: the maps it passes in are
 * filled as each write SUCCEEDS, never from `plan.placements`.
 */
import { readFileSync } from 'node:fs'
import { handOutNotices } from '../../src/lib/handOutNotice.ts'
import { newWorkPopup } from '../../src/lib/newWork.ts'

let pass = 0
const failures = []
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass += 1; return }
  failures.push(`${label}\n    expected ${e}\n    got      ${a}`)
}
const ok = (label, actual) => check(label, actual, true)

const m = (o) => new Map(Object.entries(o))
const none = new Map()

/* ---------- who is told ---------- */

const plain = handOutNotices({
  allocated: m({ ann: 7, bongi: 3 }),
  referred: m({ ann: 7, bongi: 3 }),
  handoverId: 'batch-1',
  actorId: 'lead',
})
check('one notice per person, not two', plain.length, 2)
check('the people told', plain.map((n) => n.userId).sort(), ['ann', 'bongi'])
check('allocated wins over referred for the same person',
  plain.map((n) => n.type), ['handover.allocated', 'handover.allocated'])

const toSelf = handOutNotices({
  allocated: m({ lead: 4, ann: 1 }),
  referred: m({ lead: 4, ann: 1 }),
  actorId: 'lead',
})
check('the person who pressed the button is not told', toSelf.map((n) => n.userId), ['ann'])

const referOnly = handOutNotices({
  allocated: none,
  referred: m({ ann: 5 }),
  actorId: 'lead',
})
check('refer-only says referred, not allocated', referOnly.map((n) => n.type),
  ['handover.referred'])
ok('and does not claim the account is theirs',
  !/allocated/i.test(referOnly[0]?.message ?? 'allocated'))

/* A person who is referred accounts they already own, in the same hand-out as somebody else's
   allocation, must still be told -- the skip is only for people already named as allocated. */
const mixed = handOutNotices({
  allocated: m({ ann: 2 }),
  referred: m({ ann: 2, cebo: 6 }),
  actorId: 'lead',
})
check('somebody referred but not allocated is still told',
  mixed.map((n) => `${n.userId}:${n.type}`),
  ['ann:handover.allocated', 'cebo:handover.referred'])

check('nobody is told about nothing', handOutNotices({
  allocated: m({ ann: 0 }), referred: m({ ann: 0 }), actorId: 'lead',
}).length, 0)

/* ---------- what it says ---------- */

ok('the count is in the message', /\b7\b/.test(plain.find((n) => n.userId === 'ann').message))
ok('one account is not "1 accounts"',
  /\b1 account\b/.test(handOutNotices({
    allocated: m({ ann: 1 }), referred: m({ ann: 1 }),
  })[0].message))
ok('and several are not "5 account"',
  /\b5 accounts\b/.test(handOutNotices({
    allocated: none, referred: m({ ann: 5 }),
  })[0].message))
ok('an allocation names the diary, because that is the other half of the rule',
  /diary/i.test(plain[0].message))

/* ---------- where "see them" goes ---------- */

check('the batch is the list when there is one', plain[0].link, '/accounts?handover=batch-1')
check('and their own desk when there is not',
  handOutNotices({ allocated: none, referred: m({ ann: 2 }) })[0].link, '/accounts?who=me')

/*
 * The link has to be one the accounts list actually understands. `handover` is a filter param
 * there; if somebody renames it, this link becomes a page showing the whole book and looking
 * like the allocation never happened.
 */
const filters = readFileSync('src/lib/accountFilters.ts', 'utf8')
ok('`handover` is a real filter param on the accounts list', /'handover'/.test(filters))
ok('and it clears with the rest of them',
  /FILTER_PARAMS = \[[\s\S]*?'handover',[\s\S]*?\] as const/.test(filters))

/* ---------- the counts are of writes, not of the plan ---------- */

const writer = readFileSync('src/lib/handOutWrite.ts', 'utf8')
ok('the writer sends the notices at all', /handOutNotices\(/.test(writer))
ok('and calls notify_user with each one', /rpc\('notify_user'/.test(writer))
ok('the allocated count is bumped where the update succeeded, after the error check',
  /if \(error\) throw new Error\(`Allocating failed[\s\S]{0,200}?bump\(allocatedBy, userId, chunk\.length\)/
    .test(writer))
ok('the booked count is not taken from plan.placements',
  !/referred: .*placements/.test(writer))
/*
 * A notifications table that refuses must not undo an allocation that succeeded: the accounts are
 * on the desks either way, and a team leader shown an error would reasonably run the whole
 * hand-out a second time.
 */
ok('a bell that will not ring does not throw away the hand-out',
  /rpc\('notify_user'[\s\S]{0,400}?\} catch \{/.test(writer))

/* ---------- approving points at the allocation ---------- */

/*
 * THE FIRM: "the moment after that, it should go into a state where it's ready to allocate and
 * refer the accounts to the clerks." Approving opened the accounts and said so, and nothing on
 * the screen said where they had gone -- so the next step was to leave Settings, find the book
 * and rebuild the filter by hand. The link is that step.
 */
const card = readFileSync('src/components/settings/HandoverImportCard.tsx', 'utf8')
ok('approving offers the allocation', /Allocate and refer \{allocate\.count/.test(card))
ok('and links to the batch it just imported',
  /\/accounts\?handover=\$\{allocate\.handoverId\}/.test(card))
/*
 * AND LANDS IN THE HAND-OUT, not on a filtered list with the work still to find. THE FIRM: "after
 * I've accepted the handovers, it should immediately go to a state of where they should be
 * allocated and referred." Both halves: the link asks for it, and the list acts on the asking.
 */
ok('...and opens the hand-out rather than just filtering',
  /&handout=1/.test(card))
const list = readFileSync('src/pages/accounts/AccountsList.tsx', 'utf8')
ok('the list opens the hand-out when the link says so',
  /get\('handout'\) !== '1'/.test(list) && /setAllocating\(\{ kind: 'matching', query \}\)/.test(list))
/* EVERYTHING THE FILTER MATCHES, not the page. A batch is often more than one page, and handing
   out the first fifty of two hundred is the worst outcome because it looks finished. */
ok('...on everything the batch matches, not the first page',
  /setAllMatching\(true\)[\s\S]{0,120}?setAllocating\(\{ kind: 'matching'/.test(list))
/* Once. Closing it must not have it open again on the next render. */
ok('...and only once', /if \(handOutOpened \|\| !canSeeOthers\) return/.test(list))
/* An import that opened nothing has nothing to allocate, and a link to an empty list reads as a
   bug in the import rather than as an import that correctly imported nothing. */
ok('but not when nothing was opened', /if \(result\.created > 0\)[\s\S]{0,120}?setAllocate/.test(card))
/* Cleared when the next approval starts, or the previous batch's link sits under the new one. */
ok('and the previous batch\u2019s link is cleared first',
  /setBusy\('Opening the accounts'\)[\s\S]{0,80}?setAllocate\(null\)/.test(card))

/* ---------- the ping ---------- */

/*
 * The pop-up interrupts somebody who may be on a call, so what is worth checking is the three
 * rules that keep it OFF the screen -- not the box itself.
 */
const note = (over = {}) => ({
  id: over.id ?? 'n1',
  type: over.type ?? 'handover.allocated',
  message: over.message ?? '7 accounts allocated to you and booked into your diary.',
  createdAt: '2026-09-22T08:00:00Z',
  read: over.read ?? false,
  link: over.link === undefined ? '/accounts?handover=batch-1' : over.link,
})

ok('a fresh hand-out notice interrupts somebody',
  newWorkPopup([note()], '/') !== null)
check('and says what the notice said',
  newWorkPopup([note()], '/').lines, [note().message])
check('"see them" is the batch', newWorkPopup([note()], '/').seeLink,
  '/accounts?handover=batch-1')

check('a notice already read does not', newWorkPopup([note({ read: true })], '/'), null)
check('nor does anything that is not a hand-out',
  newWorkPopup([note({ type: 'Proposal viewed' }), note({ type: 'Email received' })], '/'), null)
check('nor an empty bell', newWorkPopup([], '/'), null)

/* Already looking at the thing the box would offer to show them. */
check('not over the list it points at',
  newWorkPopup([note()], '/accounts?handover=batch-1'), null)
check('not over the diary', newWorkPopup([note()], '/diary'), null)
ok('but the unfiltered book still gets it',
  newWorkPopup([note()], '/accounts') !== null)

/* Two batches in one morning have no single list; showing one of them under "see them" would
   quietly hide the other half of the work. */
const twoBatches = newWorkPopup([
  note({ id: 'a', link: '/accounts?handover=batch-1' }),
  note({ id: 'b', type: 'handover.referred', link: '/accounts?handover=batch-2', message: '3 accounts referred to you to work.' }),
], '/')
check('two batches fall back to the desk', twoBatches.seeLink, '/accounts?who=me')
check('and both are spoken for', twoBatches.notices.map((n) => n.id), ['a', 'b'])

/* A notice written without a link at all must not produce `see them` pointing at nothing. */
check('a notice with no link still has somewhere to go',
  newWorkPopup([note({ link: null })], '/').seeLink, '/accounts?who=me')

const popup = readFileSync('src/components/collections/NewWorkPopup.tsx', 'utf8')
ok('the card offers the diary', /'\/diary'/.test(popup))
ok('and a way to close it', /aria-label="Close"/.test(popup))
ok('every way out marks the notices read, closing included',
  /function clear\(\)[\s\S]{0,200}?markNotificationRead/.test(popup)
  && /onClick=\{clear\}/.test(popup)
  && /function go\([\s\S]{0,120}?clear\(\)/.test(popup))
/* Mounted around every page: a clerk is told wherever they are, not only if they open the book. */
const layout = readFileSync('src/components/layout/AppLayout.tsx', 'utf8')
ok('and it is mounted in the shell', /<NewWorkPopup \/>/.test(layout))

if (failures.length > 0) {
  console.log(`${pass} passed, ${failures.length} failed\n`)
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
Handing a stack of accounts out now tells the people who got them, once each, counting only what
actually landed, and the "see them" link is the batch rather than their whole book. The person who
pressed the button is not told about their own action, and a notifications table that refuses
cannot undo an allocation that worked.`)
