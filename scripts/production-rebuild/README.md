# Rebuilding production's database from staging's structure (Raptor · Handover 20)

Written by S21 (Raptor · Handover 19, 11 Nov). Stephan chose **"code + database structure"**: production gets
staging's structure exactly, keeps its own people, and the real book arrives at the cut-over (end of 10 Dec).

**Nothing here runs from the app or from `npm run qa`.** These are a person's tools, run by a session with the Supabase
Management API token saved as a network secret for `api.supabase.com` (it is, on this environment; the proxy adds it --
nobody pastes it anywhere). There is no direct database connection from a session, so no `pg_dump`: everything goes
through `POST /v1/projects/<ref>/database/query`, which refuses a body over about 1 MB.

## Why not just run schema.sql

`schema.sql` is append-only history written to be re-run over an existing database, not replayed from empty:

- it alters tables before it creates them (line ~59, `user_emails`);
- it had lost the end of `trust_creditors_on_run()` to a merge (repaired in `27befca7`) -- so it is not a trustworthy
  record on its own;
- some live objects were never mirrored into it (`error_reports`, from the old `Main` branch), and a few columns,
  checks and indexes only exist because statements ran in an order the file does not have.

So the file is replayed, and **staging's live catalogue decides**: anything that differs afterwards is set from staging.

## How it works

One transaction on production, in one API call (`gen.sh` writes it):

1. **prelude** (`i < 1`): staging's default privileges in `public` (production's were tightened on 8 Oct, so nothing
   built there was granted the way staging's is);
2. **cleardown** (`cleardown.sql`): drop every view, table, function, sequence and type Raptor made in `public` --
   not the schema (its default privileges live on it) and nothing an extension owns;
3. **replay** (`1 .. n`): every statement of `schema.sql`, each in its own sub-transaction, failures collected;
4. **fix-up** (`100000+`, from `genfix.py`): from staging's catalogue -- missing tables and columns, column types,
   defaults and not-nulls, changed or missing functions, constraints, indexes, triggers, policies, and every table's and
   function's grants reset to exactly staging's;
5. **restore** (`200000+`, from `genrestore.py`): production's people (with role, grants, revokes and grade taken from
   their staging profile by email), its team (placed in Sales), its mailbox connections and BuzzBox settings, and
   `deployment.kind = 'production'`.

The statements live in a holding table, `_rebuild.stmts`, on production (outside `public`; loaded in 400 kB pieces).
**Dry run** raises at the end with the errors, a fingerprint of production's catalogue and its row counts, so everything
rolls back; `dry.sh` compares the fingerprint with staging's. **Real run** commits only if every replay error is on
`_rebuild.allowed` (statement number + message prefix, copied from a clean dry run); anything new rolls it all back.

The rehearsal on 11 Nov: 20 replay errors, all superseded by the fix-up; **0 differences** on 4,518 catalogue objects
plus the cron job; 11 people, 1 team, 3 mailbox connections and BuzzBox restored; deployment `production`.

## Steps

`REBUILD_DIR` is a private work folder **outside the repo** -- it holds production's rows (people's emails, mailbox
connections), and this repository is public.

```bash
export REBUILD_DIR=/path/to/private/folder   # e.g. the session's scratchpad
H=scripts/production-rebuild
```

1. **Back up production** (every non-empty `public` table as JSON into `$REBUILD_DIR/prod-backup/<table>.json`) --
   `genrestore.py` reads `teams`, `profiles`, `email_connections`, `buzzbox_settings` from there. Re-take it right
   before the real run.
2. **Fingerprint staging**: the `fp-body.sql` CTE followed by `select json_object_agg(k, v) j from items`, run on
   `kvkajxpremantdkhmjvb` -> `fp-staging.json` (the object under `.[0].j`); and `cron.job` the same way ->
   `fp-staging-cron.json`.
3. **Staging details** for the fix-up -> `staging-details.json`: `pg_policies` (public, storage), every `public`
   relation's kind/RLS/ACL, every non-extension function's ACL, every column (type, not null, default, attnum). And
   `staging-fns.json`: `pg_get_functiondef` for each function the diff names. And `staging-profiles.json`: role,
   grants, revokes, collector_grade by lower(email) for production's people.
4. `create schema if not exists _rebuild; create table if not exists _rebuild.stmts(i int primary key, q text not null)`
   on production (revoke from public, anon, authenticated), then `$H/reload.sh` (splits `schema.sql`, loads it).
5. `$H/dry.sh` -> errors and the diff. `python3 $H/genfix.py` (reads the dry result) -> `$H/loadfix.sh` -> `$H/dry.sh`
   again. Repeat until "only on staging 0 / only on production 0 / different 0" and no error at 100000+.
6. `python3 $H/genrestore.py`, load its statements at 200000+ (as `loadfix.sh` does), dry run again: no error at 200000+.
7. Build `_rebuild.allowed` from that dry run's errors (all must be below 100000), `$H/gen.sh real`, run
   `run-real.sql` with `$H/q.sh qcvesjzoiznrvunjrqpv`. **This is the destructive step: it needs Stephan's explicit
   go-ahead** (the permission system stopped it on 11 Nov without one).
8. Fingerprint production again and compare; `drop schema _rebuild cascade`.

**Statement numbers move whenever `schema.sql` grows**, so the allow-list from one dry run is only good for the
statements loaded for that run. Reload, dry-run and rebuild the allow-list together, never separately.
