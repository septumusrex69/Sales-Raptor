/**
 * UNMATCH AN EMAIL FROM AN ACCOUNT: EVERYBODY, FROM THE MAILBOX AND FROM THE ACCOUNT (S10, prompt 13
 * item 12). The trigger half is in check-silent-triggers; this holds the function both sides call,
 * and that both sides offer it. Probed live on staging (S10): a Pre-legal Agent cleared a link, was
 * refused re-pointing one, and unmatch_email cleared the mailbox copy and stamped the account's.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-unmatch-email.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const ok = (name, v) => { if (v === true) pass += 1; else failures.push(name) }
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const sql = read('supabase/schema.sql')
const at = sql.lastIndexOf('create or replace function public.unmatch_email(')
const fn = at < 0 ? '' : sql.slice(at, sql.indexOf('$$;', sql.indexOf('as $$', at)))
ok('unmatch_email exists', at >= 0)
ok('...security definer, because the mailbox copy is usually somebody else’s', /security definer/.test(fn))
ok('...refuses nobody signed in', /if auth\.uid\(\) is null then\s+raise exception/.test(fn))
ok('...clears the mailbox link and says where it came from',
  /update public\.user_emails\s+set linked_account_id = null, moved_from_account_id = p_account/.test(fn))
ok('...only off THIS account', /where linked_account_id = p_account\s+and \(id = p_user_email or \(v_msg is not null and message_id = v_msg\)\)/.test(fn))
ok('...and stamps the account’s copy rather than removing it',
  /update public\.account_emails\s+set unmatched_at = public\.raptor_now\(\)/.test(fn) && !/de' \|\| 'lete|\bdelete\b/i.test(fn))
ok('...on the business clock', !/\bnow\(\)/.test(fn.replace(/raptor_now\(\)/g, '')))
ok('...reachable by a signed-in person, not by anon',
  /revoke all on function public\.unmatch_email\(uuid, uuid, uuid, text\) from public, anon;/.test(sql)
  && /grant execute on function public\.unmatch_email\(uuid, uuid, uuid, text\) to authenticated;/.test(sql))

const mail = strip(read('src/lib/userMail.ts'))
ok('the mailbox unmatches through the same function', /supabase\.rpc\('unmatch_email', \{\s+p_account: from, p_account_email: null, p_user_email: input\.mail\.id/.test(mail))
const page = strip(read('src/pages/mail/MailPage.tsx'))
ok('...offered to everybody', (page.match(/onMove=\{\(\) => setMoving\(m\)\}/g) ?? []).length === 2 && !/onMove=\{mayRefile/.test(page))
ok('...with rematching still for whoever may refile', /mayRematch=\{mayRefile\}/.test(page) && /\{!mayRematch \? null : !rematching \? \(/.test(page))

const lib = strip(read('src/lib/accountEmails.ts'))
ok('the account page unmatches through it too', /supabase\.rpc\('unmatch_email', \{\s+p_account: accountId, p_account_email: emailId/.test(lib))
ok('...reads the stamp back', (lib.match(/unmatched_at, unmatched_by_name, unmatched_reason'\)/g) ?? []).length === 2
  && /unmatchedAt: r\.unmatched_at \?\? null/.test(lib))
const panel = read('src/pages/accounts/EmailsPanel.tsx')
ok('...offers it on a received email', /data-testid="account-email-unmatch"/.test(panel))
ok('...and says so once it is unmatched', /data-testid="account-email-unmatched"/.test(panel))
ok('AccountDetail hands it the action', /onUnmatch=\{async \(e, reason\) => \{\s+await unmatchAccountEmail\(account\.id, e\.id, reason\)/.test(read('src/pages/accounts/AccountDetail.tsx')))

if (failures.length) {
  console.error(`check-unmatch-email: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`)
  process.exit(1)
}
console.log(`check-unmatch-email: ${pass} passed, 0 failed`)
