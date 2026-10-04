/**
 * SYNCING SOMEBODY ELSE'S MAILBOX, BECAUSE THE REPLY IS IN IT.
 *
 * THE FIRM ASKED THE QUESTION FIRST: "an email is sent from, for example, an account's been
 * allocated to Itu Meleng, it goes out from her email address normally. However, it doesn't sync
 * because... only after she's been logged in. So if she's not logged in or it did not sync, how
 * does that sync work?"
 *
 * IT DID NOT. There were two doors and neither answered that: `sync` reads THE CALLER'S OWN
 * mailbox, and `sync-all` reads everybody's but checked `Authorization: Bearer $CRON_SECRET`
 * INSTEAD of a session -- so the only thing that ever read the whole company's mail was the cron
 * at 05:00 UTC. A collector who could see the reply was sitting in a colleague's inbox had to wait
 * a night for it.
 *
 * THEN THE ANSWER: "give an option to sync your email address and to sync for the whole company
 * for now, just for in the interim... when we go over to Pro, it'll sync every couple of minutes."
 * So this is the interim lever, and it is built as one -- nothing here has to be undone when the
 * cron starts running every few minutes; the button stays as the manual override.
 *
 * THREE THINGS HOLD IT UP AND EACH IS A DIFFERENT FAILURE:
 *
 *   - THE CRON MUST STILL GET IN. Its request carries no session at all. Make the session the
 *     only way in and the nightly run stops, silently, and nobody finds out until a debtor's
 *     reply never arrives.
 *   - A STRANGER MUST NOT. Without CRON_SECRET set, the bearer check passes vacuously -- that is
 *     deliberate for local and preview -- so the session branch is what refuses an anonymous
 *     caller in production, and it has to be there.
 *   - AND A PRESS MUST STOP ITSELF. Vercel kills a function at its duration cap; killed, the
 *     browser gets nothing and the mailboxes that WERE read are invisible because no answer came
 *     back. The budget ends the loop in time to say how far it got.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-sync-everyone.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(--|\/\/).*$/gm, '')

const all = code('api/_lib/email/sync-all.ts')
const mine = code('api/_lib/email/sync.ts')
const router = code('api/email/[action].ts')
const settings = code('src/pages/settings/SettingsPage.tsx')
const lib = code('api/_lib/emailSync.ts')
const vercel = JSON.parse(read('vercel.json'))

/* ---------------- both doors exist, and they are different doors ---------------- */

ok('the router serves both', /\bsync,/.test(router) && /'sync-all': syncAll,/.test(router))
/* NOT A NEW FUNCTION. Vercel Hobby caps serverless functions at 12 and api/ is at exactly 12 --
   both of these live behind the one dynamic route, which is why this could be built at all. */
check('...as actions on one function, not two', (read('api/email/[action].ts').match(/^export default/gm) ?? []).length, 1)
ok('your own mailbox is still its own door', /\.eq\('user_id', caller\.id\)/.test(mine))

/* ---------------- the cron still gets in ---------------- */

/*
 * THE ORDER IS LOAD-BEARING. The cron is recognised BEFORE a session is demanded, because a cron
 * request has none. Ask for the session first and the nightly run gets a 401 every night.
 */
ok('the cron is recognised by its bearer',
  /const fromCron = !cronSecret \|\| req\.headers\.authorization === `Bearer \$\{cronSecret\}`/.test(all))
ok('...and is not asked for a session', /if \(!fromCron\) \{[\s\S]{0,300}?requireCaller/.test(all))
/* AND A CALLER WITH NEITHER IS REFUSED. This is the half that would be missed: with no
   CRON_SECRET set the bearer test passes for everyone, so the session branch is the only thing
   standing between an anonymous POST and every mailbox in the firm. */
ok('...while anyone else must be signed in',
  /const caller = await requireCaller\(req, admin\)[\s\S]{0,200}?if \(!caller\) \{[\s\S]{0,160}?401/.test(all))

/* ---------------- a press stops itself ---------------- */

ok('a press has a time budget', /const PRESS_BUDGET_MS = /.test(all))
/* UNDER VERCEL'S CAP WITH ROOM TO ANSWER. A budget at or above the cap is no budget at all. */
const budget = Number((all.match(/const PRESS_BUDGET_MS = ([\d_]+)/) ?? [])[1]?.replace(/_/g, ''))
ok('...that leaves room to reply before the function is killed', budget > 0 && budget <= 55_000)
ok('...applied to the loop', /Date\.now\(\) - started > PRESS_BUDGET_MS/.test(all))
/*
 * AND WHAT IS LEFT IS COUNTED RATHER THAN DROPPED. Without `remaining` the person is told "6 of 6"
 * when nine were never reached -- a partial run reported as a complete one, which is worse than
 * the timeout it replaced.
 */
ok('...with what it did not reach counted', /remaining \+= 1/.test(all))
ok('...and handed back', /\bremaining,/.test(all))
/*
 * THE CRON IS NEVER BUDGETED. It is not a person waiting on a spinner, and stopping it at fifty
 * seconds would leave mailboxes unread with nothing asking for them again until the next run.
 */
ok('the budget applies to a press only', /if \(pressed && Date\.now\(\) - started/.test(all))
/*
 * THE RECENCY SKIP IS NOT PRESS-ONLY ANY MORE, AND THAT IS THE POINT.
 *
 * It was, while the sweep ran once a night -- a nightly run wants every mailbox whatever happened
 * during the day. The sweep now runs every few minutes (see check-sync-starvation for why), and
 * at that cadence re-walking eighteen folders of a mailbox the person is sitting in front of is
 * fourteen thousand mailbox opens a day against a server that counts them. Both callers skip a
 * mailbox read a moment ago; they differ only in how long "a moment" is.
 */
ok('both the press and the sweep skip a mailbox just read',
  /const freshFor = pressed \? RECENT_MS : SWEEP_RECENT_MS/.test(all))
ok('...and neither is gated on who asked', !/if \(pressed && conn\.last_synced_at/.test(all))

/* ---------------- and the column the skip reads actually arrives ---------------- */

/*
 * CLAUDE.md's WARNING, IN ITS USUAL SHAPE. `last_synced_at` missing from the row type is not a
 * type error in a `select('*')` -- it reads as undefined, the skip never fires, and every press
 * re-walks eighteen folders of a mailbox somebody read a second ago.
 */
ok('the connection row carries when it was last synced', /last_synced_at\?: string \| null/.test(lib))
ok('...and the sync writes it', /last_synced_at: new Date\(\)\.toISOString\(\)/.test(lib))

/* ---------------- one mailbox at a time, still ---------------- */

/*
 * THE CLAIM IS WHAT MAKES A SECOND PRESS HARMLESS. Mail servers cap concurrent connections per
 * account; two people pressing "Sync everyone" at once without it is two IMAP sessions down every
 * mailbox in the firm, and everything those people do queues behind them.
 */
ok('every mailbox is still claimed before it is read', /await claimSync\(admin, conn\.user_id\)/.test(all))
ok('...and released afterwards', /finally \{[\s\S]{0,120}?releaseSync\(admin, conn\.user_id\)/.test(all))

/* ---------------- what the person is told ---------------- */

ok('the answer says how many mailboxes there were', /mailboxes: all\.length,/.test(all))
ok('...how much came in', /\blogged,/.test(all))
ok('...and what failed', /\bfailed,/.test(all))
/* A FAILED MAILBOX IS STILL RECORDED ON THE ROW, which is what turns "nobody ran the job" into
   "this mailbox has been refusing us since the 24th". */
ok('...with the reason kept on the connection', /sync_error: message\.slice\(0, 500\)/.test(all))

/* ---------------- the button ---------------- */

ok('the settings card offers it', /Sync everyone/.test(settings))
ok('...posting to the same action the cron uses', /'\/api\/email\/sync-all'/.test(settings))
/*
 * ITS OWN SPINNER. Sharing `syncing` with the personal button puts the spinner on the wrong
 * control and disables the one that is free -- and these two are pressed one after the other.
 */
ok('...with its own busy state', /const \[syncingAll, setSyncingAll\]/.test(settings))
ok('...on the right button', /disabled=\{syncingAll\}/.test(settings))
/* THE PARTIAL RUN REACHES THE SCREEN, or the budget is a thing the server does and nobody knows. */
ok('...and it reports what is left to do', /press again to finish/.test(settings))
/* AND THE PAGE RE-READS. Sync writes activities and notifications server-side; without this a
   just-synced email only appears after a full refresh, which is the bug the personal button
   already had to fix. */
ok('...then re-reads what the sync wrote',
  /handleSyncEveryone\(\)[\s\S]{0,1400}?refreshSyncedData\(\)/.test(settings))

/* ---------------- the nightly run is untouched ---------------- */

const cron = (vercel.crons ?? []).find((c) => c.path === '/api/email/sync-all')
ok('the cron still points at it', !!cron)
/* THE SCHEDULE IS WHAT CHANGES ON PRO -- "it'll sync every couple of minutes" -- and nothing in
   the endpoint has to change for that. Asserted so the interim button is not mistaken for the
   permanent answer. */
ok('...on a schedule, which is the part Pro changes', typeof cron?.schedule === 'string')

console.log(`\ncheck-sync-everyone: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
