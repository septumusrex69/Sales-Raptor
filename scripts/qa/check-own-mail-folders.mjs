/**
 * R-13 (S19, Raptor H18): A PERSON'S OWN MAIL FOLDERS, read back from source and schema.
 *
 * Rinda: "file our emails into the relevant subfolder keeping our inbox to a minimum." So a message in a folder must
 * leave the Inbox, the Archive AND the sidebar badge -- the badge was once a different count from the tab it stands
 * for ("a badge that says 3 over a list of 5"), and a folder is a new way for the two to disagree. And the mapper must
 * carry folder_id: a column in the select but not in toItem reads undefined for ever (CLAUDE.md).
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-own-mail-folders.mjs
 */
import { readFileSync } from 'node:fs'
import { folderNameProblem } from '../../src/lib/mailFolderRules.ts'

let pass = 0
const failures = []
const ok = (name, v) => { if (v === true) pass += 1; else failures.push(`${name}\n    expected true\n    got      ${JSON.stringify(v)}`) }
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const mail = read('src/lib/userMail.ts')
const schema = read('supabase/schema.sql')
const lastFn = (name) => {
  const at = schema.lastIndexOf(`create or replace function public.${name}(`)
  return at < 0 ? '' : schema.slice(at, schema.indexOf('$$;', at))
}

/* The tabs. */
ok('the Inbox leaves filed mail to its folder', /filter === 'all'\) out = out[^\n]*\.is\('folder_id', null\)/.test(mail))
ok('...and so does the Archive', /filter === 'done'\) out = out[^\n]*\.is\('folder_id', null\)/.test(mail))
ok('a folder is its own view', /else if \(input\.folderId\) out = out\.eq\('folder_id', input\.folderId\)/.test(mail))
ok('...asked before any tab, so a folder is never also narrowed to a tab',
  mail.indexOf("else if (input.folderId)") > 0 && mail.indexOf("else if (input.folderId)") < mail.indexOf("else if (input.filter === 'sent')"))

/* The mapper. */
ok('folder_id is selected', /done_at, folder_id,/.test(mail))
ok('...on the row type', /folder_id: string \| null/.test(mail))
ok('...and carried by toItem', /folderId: r\.folder_id \?\? null/.test(mail))

/* The sidebar badge stands for the Inbox. */
const nav = lastFn('nav_counts')
ok('nav_counts is in the schema', nav.length > 0)
ok('...and leaves filed mail out of the Mail badge, as the Inbox does', /done_at is null[\s\S]*folder_id is null[\s\S]*read_at is null/.test(nav))

/* The database: one person's folders, and a message only into its owner's. */
ok('mail_folders is one person\'s (RLS on user_id)', /create policy mail_folders_own on public\.mail_folders for all to authenticated\s+using \(user_id = auth\.uid\(\)\) with check \(user_id = auth\.uid\(\)\)/.test(schema))
ok('deleting a folder sends its mail back to the inbox', /add column folder_id uuid references public\.mail_folders\(id\) on delete set null/.test(schema))
ok('a message goes only into its owner\'s folder', /user_emails_folder_is_theirs[\s\S]*f\.user_id = new\.user_id/.test(lastFn('user_emails_folder_is_theirs')))

/* Names. */
const have = [{ id: 'a', name: 'Statements', companyId: null, createdAt: '' }]
ok('a folder needs a name', folderNameProblem('  ', have) === 'Give the folder a name.')
ok('...not one the person already has, whatever its case', /already have a folder called/.test(folderNameProblem('statements', have) ?? ''))
ok('...but renaming a folder to its own name is fine', folderNameProblem('Statements', have, 'a') === null)

/* Reading a filed message moves no tab's unread number: it is in no tab (bumpUnread). */
{
  const { bumpUnread } = await import('../../src/lib/emailRules.ts')
  const counts = { all: 3, done: 0, junk: 0, sent: 0 }
  ok('reading a filed message leaves the Inbox count alone', bumpUnread(counts, { isSent: false, isJunk: false, doneAt: null, folderId: 'f1' }, -1).all === 3)
  ok('...while reading an Inbox message still moves it', bumpUnread(counts, { isSent: false, isJunk: false, doneAt: null, folderId: null }, -1).all === 2)
}

console.log(`check-own-mail-folders: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
if (failures.length) process.exit(1)
