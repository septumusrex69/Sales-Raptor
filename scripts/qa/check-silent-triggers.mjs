/**
 * THE THREE TRIGGERS THAT REVERT WITHOUT SAYING SO.
 *
 * CLAUDE.md lists two of them under "things that bite", and the first one first:
 *
 *   - `protect_closed_diary_entries` SILENTLY REVERTS edits to done/moved entries. It does not
 *     raise.
 *   - `protect_filed_mail_target` reverts link changes on `user_emails` for non-Administrators.
 *   - `protect_profile_privileged_fields` freezes `role`, `status` and `team_id` on `profiles`
 *     for anybody who is not an Administrator. It is not in CLAUDE.md, which is part of how it
 *     came to have no check at all.
 *
 * THAT IS WHY THEY NEED A CHECK MORE THAN A TRIGGER THAT THROWS DOES. A trigger that raises
 * announces itself the moment it stops working, because the error people expected stops arriving.
 * One that quietly restores the old value announces nothing at all: if it stops restoring, the
 * edit simply succeeds, and the first person to find out is whoever reads a diary entry that was
 * closed last month and now says something else.
 *
 * WHAT WAS HERE BEFORE, and why it was not enough. The only assertions on the diary trigger were
 * two "must NOT contain" lines -- that it does not freeze `moved_to` and does not freeze
 * `moved_reason`. Nothing asserted it freezes anything. The audit of this suite deleted the
 * restorations entirely, and then replaced the guard with `if false then` so the trigger ran and
 * did nothing; both left the whole suite green. `protect_filed_mail_target` had no check at all.
 *
 * SO THIS ASSERTS THE POSITIVE CONTENT: the function exists, the trigger is attached to the right
 * table at the right moment, the guard is the right condition, and every field that must be
 * restored is restored. The two absence lines are kept and are now scoped to the function's own
 * body, so the prose explaining an absence cannot satisfy it.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-silent-triggers.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

const sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')

/**
 * The body of `create or replace function public.<name>` up to its closing `$$;`.
 *
 * BOUNDED BY THE STATEMENT TERMINATOR, never by a character count. A window of "the next 2 500
 * characters" is a guess that is right until somebody adds a line, and the audit found two
 * assertions in this suite reading past their subject into the next function.
 *
 * schema.sql is APPEND-ONLY, so a later migration replaces a function by redefining it at the end
 * of the file. The LAST definition is the one the database has; taking the first would check a
 * version that has been superseded.
 */
function functionBody(name) {
  const marker = `create or replace function public.${name}`
  const at = sql.lastIndexOf(marker)
  if (at === -1) return null
  const end = sql.indexOf('$$;', at)
  if (end === -1) return null
  return sql.slice(at, end)
}

/** The same, for the `create trigger` statement. */
function triggerStatement(name, table) {
  const re = new RegExp(`create trigger ${name}\\s+([\\s\\S]*?);`, 'g')
  const all = [...sql.matchAll(re)].map((m) => m[1].replace(/\s+/g, ' ').trim())
  return all.filter((s) => s.includes(`on public.${table}`)).pop() ?? null
}

/* ------------------------------------------------------------------ the diary */

/*
 * "EVERYTHING THAT'S BEEN LOGGED AND BOOKED AS STAMPED AND CANNOT BE CHANGED." The firm's own
 * words. A done or moved diary entry is the record of what a collector did on a day, and the
 * diary is what the collections figures are counted off.
 */
{
  const body = functionBody('protect_closed_diary_entries')
  ok('the diary trigger exists', body !== null)

  const trigger = triggerStatement('protect_closed_diary_entries', 'diary_entries')
  ok('...and is attached to diary_entries', trigger !== null)
  if (trigger) {
    /* BEFORE, or the restoration happens after the row is already written. FOR EACH ROW, or it
       fires once per statement and restores nothing. */
    ok(`...before update, for each row (${trigger})`,
      /before update/i.test(trigger) && /for each row/i.test(trigger))
  }

  if (body) {
    /*
     * THE GUARD. Replacing this condition with `if false then` leaves the trigger running and
     * doing nothing -- the exact mutation that left the old suite green.
     */
    ok('...and it acts on entries that are done or moved',
      /if\s+old\.state\s+in\s*\(\s*'done'\s*,\s*'moved'\s*\)\s+then/i.test(body))

    /*
     * EVERY FIELD IT MUST RESTORE. Asserted one by one rather than as a count, so a failure names
     * the field somebody removed rather than saying nine is not ten.
     *
     * `due_on` and `kind` are the two the audit deleted. They are also the two that matter most:
     * moving a closed entry's date moves work between days in the collections figures, and
     * changing its kind moves it between rungs of the diary ladder.
     */
    const frozen = [
      'account_id', 'owner_id', 'due_on', 'kind', 'state', 'source',
      'done_at', 'done_by', 'moved_at', 'moved_by',
    ]
    const missing = frozen.filter((f) => !new RegExp(`new\\.${f}\\s*:=\\s*old\\.${f}\\b`).test(body))
    check('...restoring every field of a closed entry', missing, [])

    /*
     * AND THE TWO IT MUST NOT FREEZE, kept from the old check and now scoped to the FUNCTION
     * BODY rather than to a window of the file. Where an entry was moved TO, and why, is written
     * as part of closing it -- freezing those would make the close itself impossible.
     */
    ok('...while leaving where it moved to', !/new\.moved_to\s*:=/.test(body))
    ok('...and why it moved', !/new\.moved_reason\s*:=/.test(body))
  }
}

/* ------------------------------------------------------------------ filed mail */

/*
 * RE-FILING IS A MONEY ACTION. Moving an already-filed message onto a different debtor raises a
 * second item 6 fee (R13) on the destination and writes that debtor's timeline. Filing UNFILED
 * mail stays open to everyone, because that is the everyday work -- the rule is only about mail
 * that already has a home.
 */
{
  const body = functionBody('protect_filed_mail_target')
  ok('the filed-mail trigger exists', body !== null)

  const trigger = triggerStatement('protect_filed_mail_target', 'user_emails')
  ok('...and is attached to user_emails', trigger !== null)
  if (trigger) {
    ok(`...before update, for each row (${trigger})`,
      /before update/i.test(trigger) && /for each row/i.test(trigger))
  }

  if (body) {
    /*
     * The role test, which the audit replaced with `if false then` to no effect anywhere.
     *
     * NOW `is distinct from` RATHER THAN A BARE `<>`, AND REQUIRED THAT WAY. This assertion used
     * to demand the bare form, which is the fail-open comparison CLAUDE.md records:
     * current_user_role() is NULL with no session, `null <> 'Administrator'` is NULL, `if NULL
     * then` does not run, and every restoring line below it is skipped -- for exactly the caller
     * that should be refused hardest. So the check now holds the SAFE form, and the old spelling
     * fails here rather than sitting in the schema looking deliberate.
     */
    ok('...and it lets an Administrator through and nobody else',
      /if\s+public\.current_user_role\(\)\s+is distinct from\s+'Administrator'\s+then/i.test(body))
    ok('...failing closed rather than open when there is no session',
      !/current_user_role\(\)\s*<>/.test(body))

    /*
     * ALL FIVE LINKS, each re-asserted ONLY where the old value was not null. The `is not null`
     * is what keeps filing unfiled mail open to everyone, so it is asserted rather than assumed:
     * without it the trigger would freeze every message at unfiled, for ever.
     */
    const links = [
      'linked_account_id', 'linked_lead_id', 'linked_deal_id',
      'linked_company_id', 'linked_contact_id',
    ]
    const notRestored = links.filter((f) =>
      !new RegExp(`new\\.${f}\\s*:=\\s*old\\.${f}\\b`).test(body))
    check('...restoring every link on an already-filed message', notRestored, [])
    const notGuarded = links.filter((f) =>
      !new RegExp(`old\\.${f}\\s+is\\s+not\\s+null`, 'i').test(body))
    check('...and only where it was already filed', notGuarded, [])
  }
}

/* ------------------------------------------------------------------ who you are */

/*
 * THE ONE THAT STOPS SOMEBODY MAKING THEMSELVES AN ADMINISTRATOR, and the most serious of the
 * three -- found by a review of this suite, which disabled its guard and watched every one of
 * 5 093 checks stay green.
 *
 * WHY IT IS THE ONLY THING STANDING THERE. `profiles_update` is granted on
 * `auth.uid() = id or current_user_role() = 'Administrator'` -- so every signed-in person may
 * update their OWN profile row, which is what makes Settings → Profile work at all. Row-level
 * security therefore cannot be what refuses a role change; it has already said yes. This trigger
 * is what throws the value away afterwards.
 *
 * AND ROLE IS NOT A LABEL. It decides canViewClients (a client's commission rate and mandate),
 * canFreezeAccounts, and who may re-file mail that is already on a debtor. A Pre-legal Agent who
 * could write `role = 'Administrator'` on themselves would have the whole book's commercial terms
 * by the next page load.
 *
 * The policy itself is deliberately NOT asserted here. Tightening it would be an improvement, and
 * a check that goes red on an improvement is a check people learn to edit rather than read.
 */
{
  const body = functionBody('protect_profile_privileged_fields')
  ok('the profile trigger exists', body !== null)

  const trigger = triggerStatement('protect_profile_privileged_fields', 'profiles')
  ok('...and is attached to profiles', trigger !== null)
  if (trigger) {
    /* BEFORE, or the role is already written by the time it is put back. */
    ok(`...before update, for each row (${trigger})`,
      /before update/i.test(trigger) && /for each row/i.test(trigger))
  }

  if (body) {
    /*
     * THE GUARD, and the exact mutation that proved this file needed a third block: replaced with
     * `if false then`, the trigger still fires, still returns the row, and restores nothing.
     *
     * AND `is distinct from`, FOR THE SAME REASON AS ITS SIBLING ABOVE -- with the sharper edge
     * that this one now also protects the capability grants, so a comparison that yields NULL
     * would leave a self-edit free to write them.
     */
    ok('...and it lets an Administrator through and nobody else',
      /if\s+public\.current_user_role\(\)\s+is distinct from\s+'Administrator'\s+then/i.test(body))
    ok('...failing closed rather than open when there is no session',
      !/current_user_role\(\)\s*<>/.test(body))

    /*
     * AND THE SERVER GETS THROUGH, which is a carve-out this trigger did not have and cost the
     * firm a colleague's role.
     *
     * THE FIRM: "I added Camille as an administrator and she came on as a salesperson."
     * `api/invite-user.ts` creates the account, then updates the profile to the chosen role --
     * on the SERVICE KEY, which has no signed-in user. `current_user_role()` is NULL there, so
     * once the comparison above became `is distinct from` (correctly), the server's own update
     * started being reverted. Silently. The endpoint saw success and told the administrator the
     * role was set.
     *
     * IT IS THE `role` GUC AND IT HAS TO BE. This function is `security definer` owned by
     * postgres, so `current_user` inside it is 'postgres' for EVERY caller -- authenticated, anon
     * and service_role alike. A carve-out written `current_user = 'service_role'` would never
     * match; written `current_user = 'postgres'` it would match everybody and silently delete the
     * whole protection. PostgREST sets the role GUC per request and SECURITY DEFINER does not
     * touch it: measured on staging, an authenticated request reads 'authenticated' in here.
     */
    ok('...while the server, which has already checked the caller, is let through',
      /current_setting\('role', true\)[\s\S]{0,40}=\s*'service_role'/.test(body))
    /* THE TRAP, ASSERTED AS AN ABSENCE because it is the version that looks right and is not. */
    ok('...not by a current_user that is the definer for everybody',
      !/current_user\s*=\s*'/.test(body))
    /* AND NOBODY ELSE IS NAMED. 'postgres' or 'supabase_admin' here would be a second door. */
    const roles = [...body.matchAll(/'(service_role|postgres|supabase_admin|authenticated|anon)'/g)]
      .map((m) => m[1])
    check('...and the server is the only caller excused', [...new Set(roles)], ['service_role'])

    /*
     * THE THREE FIELDS, one assertion each so a failure names the one somebody removed.
     *
     *   role     what the app is allowed to show and do
     *   status   whether the account works at all -- a suspended person restoring themselves
     *   team_id  whose book and whose figures, and which team leader sees the work
     */
    const frozen = ['role', 'status', 'team_id']
    const missing = frozen.filter((f) => !new RegExp(`new\\.${f}\\s*:=\\s*old\\.${f}\\b`).test(body))
    check('...freezing role, status and team for everybody else', missing, [])

    /*
     * AND NOTHING ELSE IS FROZEN. Editing your own name, telephone number or signature from
     * Settings → Profile is the ordinary case this trigger has to stay out of the way of -- and a
     * trigger that quietly discarded those would be indistinguishable from a page that failed to
     * save.
     */
    const ownToEdit = ['name', 'phone', 'email_signature', 'avatar_url']
    const overreach = ownToEdit.filter((f) => new RegExp(`new\\.${f}\\s*:=`).test(body))
    check('...and leaving alone what anybody may edit about themselves', overreach, [])
  }
}

/* ------------------------------------------------------------------ the shape of the guard */

/*
 * ALL THREE ARE `security definer`, and that is load-bearing rather than incidental: a trigger
 * that ran as the person being restrained would be refused by the same RLS it exists to backstop.
 */
for (const name of [
  'protect_closed_diary_entries', 'protect_filed_mail_target', 'protect_profile_privileged_fields',
]) {
  const body = functionBody(name)
  if (!body) continue
  ok(`${name} runs as its definer`, /security\s+definer/i.test(body))
  /* And with a fixed search_path, or a table of the same name earlier on somebody's path is the
     table it silently protects instead. */
  /* EITHER SPELLING. `set search_path = public` and `set search_path to 'public'` pin the same
     thing, and CLAUDE.md writes the second -- a check that knew only the first reported a
     correctly written function as unpinned. The guarantee is that it is fixed, not how it is
     spelt. */
  ok(`...with search_path pinned`,
    /set\s+search_path\s*(=|to)\s*'?public'?/i.test(body))
  /*
   * NONE OF THEM RAISES, and that is the documented design rather than an oversight -- CLAUDE.md
   * says
   * the diary one "does not raise". Asserted so that changing it to raise is a decision somebody
   * makes on purpose: every caller in the app is written expecting a silent revert, and a trigger
   * that suddenly throws would surface as a failed save on a screen with no handler for it.
   */
  ok(`...and reverts rather than raising`, !/raise\s+exception/i.test(body))
}

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
The three triggers that revert without saying so, asserted for what they DO rather than only for
what they must not: the guard condition, the table and moment they fire on, and every field they
restore, named one at a time. A trigger that raises announces itself when it breaks; one that
quietly restores the old value announces nothing at all -- and the profile one is the only thing
standing between a Pre-legal Agent and making themselves an Administrator.`)
