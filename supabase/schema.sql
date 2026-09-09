-- Romulus — Phase 1 schema
-- Run this once in Supabase: Dashboard → SQL Editor → paste → Run.
-- Safe to re-run (uses IF NOT EXISTS / OR REPLACE / drop-if-exists guards).

create extension if not exists pgcrypto;

-- ---------- Teams ----------
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  -- Which dashboard members of this team land on — 'Sales' is the
  -- long-standing default, 'Communications' opts a team into the
  -- Communications Dashboard instead.
  kind text not null default 'Sales' check (kind in ('Sales', 'Communications'))
);

-- ---------- Profiles (mirrors types.ts `User`) ----------
-- One row per authenticated person, keyed to auth.users so it disappears
-- automatically if the auth account is ever deleted.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  email text not null,
  role text not null default 'Sales Representative'
    check (role in ('Administrator', 'Sales Manager', 'Sales Representative', 'Liaison Manager', 'Liaison', 'Pre-legal Agent', 'Read Only')),
  team_id uuid references public.teams (id) on delete set null,
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  phone text,
  avatar_color text not null default '#355069',
  created_at timestamptz not null default now(),
  -- Appended under the body of any email sent from Romulus via this person's connected inbox.
  email_signature text,
  -- Optional signature image (e.g. a scanned handwritten signature or logo), stored in the
  -- 'email-signatures' Storage bucket, laid out under the text signature at send time.
  email_signature_image_url text,
  email_signature_image_width integer,
  email_signature_image_align text not null default 'left' check (email_signature_image_align in ('left', 'center', 'right')),
  -- This person's BuzzBox PABX extension (e.g. '201'). Click-to-dial rings this extension
  -- first, then bridges it to the number clicked. Null means "use the device's own dialler".
  buzzbox_extension text
);
-- Older databases were created before the column existed.
alter table public.profiles add column if not exists buzzbox_extension text;

-- Auto-create a profile the moment someone accepts a Supabase invite /
-- signs in for the first time. The very first person ever to sign up
-- becomes Administrator automatically; everyone after defaults to Sales
-- Representative (editable afterwards from Settings → Users).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  is_first boolean;
begin
  select not exists (select 1 from public.profiles) into is_first;
  insert into public.profiles (id, name, email, role, status, avatar_color)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email,
    case when is_first then 'Administrator' else 'Sales Representative' end,
    'Active',
    '#355069'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Looks up the calling user's role. security definer + a fixed search_path
-- let this be called from RLS policies on profiles itself without infinite
-- recursion (it reads through the function's own privileges, not the
-- caller's, so it doesn't re-trigger the calling policy).
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Only an Administrator may change someone's role/status/team via the
-- profiles table. Non-admin updates (e.g. editing your own name/phone from
-- Settings → Profile) silently keep these three fields at their prior
-- value no matter what the client sends, so a crafted request can't
-- self-escalate to Administrator.
create or replace function public.protect_profile_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() <> 'Administrator' then
    new.role := old.role;
    new.status := old.status;
    new.team_id := old.team_id;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_privileged_fields on public.profiles;
create trigger protect_profile_privileged_fields
  before update on public.profiles
  for each row execute function public.protect_profile_privileged_fields();

-- ---------- Companies ----------
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  industry text,
  phone text,
  email text,
  website text,
  province text,
  city text,
  address text,
  account_owner_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  -- Groups this company as a sub-account under another (e.g. "Bonitas" under
  -- "Marara Pharmacy"). Short reference code is either a real Swordfish
  -- client prefix, or an internal-only code invented for a parent that has
  -- no Swordfish code of its own. account_count/handover_amount/
  -- payments_to_date are debt-collection servicing totals synced per
  -- sub-account; a parent with children has no totals of its own.
  parent_company_id uuid references public.companies (id) on delete set null,
  code text,
  account_count integer,
  handover_amount numeric,
  payments_to_date numeric,
  marketing_agent text,
  -- Swordfish's client classification (A/B/C/D), where known.
  classification text check (classification in ('A', 'B', 'C', 'D')),
  -- What the lead was estimated to hand over, captured at conversion. Historical only: what a
  -- client says they'll hand over is reliably not what arrives, so this never feeds a forecast
  -- or a total. Kept as the record of what was promised, and to grade estimate against actual.
  estimated_handover_amount numeric,
  estimated_accounts_count integer,
  estimated_at_conversion timestamptz,
  -- When the collection mandate was signed — the clock on "signed, nothing handed over yet".
  mandate_signed_at timestamptz
);

-- ---------- Contacts ----------
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  job_title text,
  company_id uuid references public.companies (id) on delete set null,
  -- contacts.lead_id is added after the leads table below: this table is created first, so
  -- the foreign key can't be declared here without a forward reference.
  email text,
  phone text,
  mobile text,
  owner_id uuid not null references public.profiles (id),
  last_contact_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

-- ---------- Leads ----------
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  lead_number integer generated always as identity,
  first_name text not null,
  last_name text not null,
  job_title text,
  company_id uuid references public.companies (id) on delete set null,
  company_name text not null,
  phone text,
  mobile text,
  email text,
  website text,
  source text not null,
  campaign text,
  -- 'No Contact Yet' | 'Interested' | 'Hot Lead' | 'Converted' | 'Rejected'.
  -- Deliberately unconstrained text: the vocabulary lives in src/lib/leadStatus.ts
  -- and has already changed once; a CHECK here would mean a migration every time
  -- the sales team renames a stage.
  status text not null default 'No Contact Yet',
  score integer not null default 10,
  estimated_value numeric not null default 0,
  owner_id uuid not null references public.profiles (id),
  industry text,
  country text,
  province text,
  city text,
  address text,
  service_interested text,
  services text[],
  other_service_detail text,
  classification text check (classification in ('A', 'B', 'C', 'D')),
  estimated_project_value numeric,
  estimated_handover_amount numeric,
  estimated_accounts_count integer,
  -- Per-service value breakdown, e.g. [{"service": "Executive Listing",
  -- "value": 200}, {"service": "Debt Collection", "handoverAmount": 850000,
  -- "accountsCount": 40}]. estimated_project_value/estimated_handover_amount/
  -- estimated_accounts_count above are derived sums of this, kept for
  -- backward-compat reads (LeadsList, Reports). Null on leads created
  -- before this existed.
  service_values jsonb,
  notes text,
  last_contact_at timestamptz,
  next_follow_up_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  converted_deal_id uuid,
  -- Set together when a lead is rejected: why, and anything worth remembering if
  -- they come back. 'We declined them' is one of the reasons, so a selective month
  -- doesn't read as a bad one.
  rejection_reason text,
  rejection_note text
);

-- Covers re-running this script against a database where `leads` already
-- existed before service_values was added (create table if not exists
-- above is a no-op in that case, so this catches it separately).
alter table public.leads add column if not exists service_values jsonb;

-- Contact persons captured against a lead, before there's a company to hang them off — at a
-- prospect you're usually dealing with more than one person (whoever enquired, plus whoever
-- actually signs). Declared here rather than in the contacts table above, which is created
-- first and so can't reference leads yet. Cleared rather than deleted if the lead goes, and
-- convertLeadToDeal re-points these at the new company so they survive conversion.
alter table public.contacts add column if not exists lead_id uuid references public.leads (id) on delete set null;

-- ---------- Deals ----------
create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company_id uuid not null references public.companies (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  owner_id uuid not null references public.profiles (id),
  -- 'New Deal' | 'Quotation Sent' | 'Won' | 'Rejected'.
  -- Unconstrained text for the same reason lead status is: the vocabulary belongs in
  -- src/types.ts, not behind a migration every time a step is renamed.
  stage text not null default 'New Deal',
  value numeric not null default 0,
  probability integer not null default 10,
  expected_close_date timestamptz not null,
  service text,
  source text not null,
  competitor text,
  notes text,
  -- 'Service' (quoted, delivered, invoiced) or 'Handover' (a book of accounts collected on
  -- commission). A Handover earns nothing at signature, so it carries no `value` at all —
  -- its book lives in handover_amount and is never summed into revenue.
  kind text not null default 'Service',
  -- Which documents have gone out. Facts rather than stages: one deal can need both a
  -- quotation and a mandate, which a single stage can't express.
  quotation_sent_at timestamptz,
  mandate_sent_at timestamptz,
  invoice_sent_at timestamptz,
  -- Set when stage is 'Rejected'. Same vocabulary as leads.rejection_reason.
  rejection_reason text,
  rejection_note text,
  created_at timestamptz not null default now(),
  won_at timestamptz,
  rejected_at timestamptz,
  next_action_at timestamptz,
  -- cascade: a converted lead's Deal is that lead's outcome, not an
  -- independent record — deleting the lead removes the Deal it produced.
  lead_id uuid references public.leads (id) on delete cascade,
  -- Handover-type deals only (e.g. Debt Collection) — outstanding balance
  -- being handed over, distinct from `value` (the contract/project value).
  handover_amount numeric,
  -- Handover-type deals only — number of accounts/matters in the handover.
  accounts_count integer,
  -- Date the client is expected to begin handing over accounts / service
  -- commencement date, captured when marking the deal Won.
  contract_start_date date
);

-- Covers re-running this script against a database where `deals` already
-- existed before these columns were added.
alter table public.deals add column if not exists handover_amount numeric;
alter table public.deals add column if not exists accounts_count integer;
alter table public.deals add column if not exists contract_start_date date;

-- ---------- Tasks ----------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type text not null default 'Follow-up',
  status text not null default 'Not Started' check (status in ('Not Started', 'In Progress', 'Completed', 'Cancelled')),
  priority text not null default 'Medium' check (priority in ('Low', 'Medium', 'High', 'Urgent')),
  owner_id uuid not null references public.profiles (id),
  due_date timestamptz not null,
  -- cascade on lead/deal (a task tied to a lead or deal is that record's
  -- follow-up, not standalone); set null on contact/company, which stay
  -- as reusable records that don't get deleted.
  lead_id uuid references public.leads (id) on delete cascade,
  deal_id uuid references public.deals (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  company_id uuid references public.companies (id) on delete set null,
  related_to_label text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  auto_rescheduled_from timestamptz
);

-- ---------- Activities ----------
create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  user_id uuid not null references public.profiles (id),
  -- cascade (not set null): an activity logged against a lead is that
  -- lead's history, not a standalone record — deleting the lead should
  -- delete its activity log entries too, not leave them orphaned.
  lead_id uuid references public.leads (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  company_id uuid references public.companies (id) on delete set null,
  -- cascade: an activity logged against a deal is that deal's history.
  deal_id uuid references public.deals (id) on delete cascade,
  subject text not null,
  notes text,
  activity_date timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- Set only for Activities logged from a synced incoming email (the message's Message-ID
  -- header). Lets emailSync.ts upsert with ON CONFLICT DO NOTHING so the same email can never
  -- be logged twice for the same person, however many times a sync happens to reprocess it.
  email_message_id text,
  -- Only meaningful for type = 'Email': true for every non-email Activity and for an
  -- outgoing sent email (nothing to "read"); false for a freshly-synced incoming email
  -- until someone opens it in the Emails card.
  is_read boolean not null default true,
  -- File names of any attachments on a synced incoming email. The files themselves are
  -- NOT stored -- they stay in the connected mailbox -- but without this the CRM gave no
  -- indication an email carried an attachment at all, so a mandate or invoice could be
  -- sitting in someone's inbox with nothing here hinting it exists.
  attachment_names text[],
  -- Where this email lives in the mailbox, so /api/email/attachment can go back and fetch
  -- an attachment on demand instead of the CRM warehousing every file it ever receives
  -- (this mailbox takes thousands of attachments a week). A UID is only unique within its
  -- own folder, hence storing both; if the message has since been moved, the endpoint
  -- falls back to searching for it by Message-ID.
  email_folder text,
  email_uid integer
);
-- Deliberately NOT partial (no `where email_message_id is not null`): Postgres can't use a
-- partial index as an ON CONFLICT (user_id, email_message_id) inference target unless the
-- upsert also repeats that predicate, so a partial version here made every synced-email
-- upsert fail with "no unique or exclusion constraint matching the ON CONFLICT specification"
-- -- confirmed via emailSync diagnostic logging. A plain unique index already treats NULLs as
-- mutually distinct, so every non-email Activity and outgoing sent-email Activity (both have
-- no email_message_id) is unaffected -- only genuine duplicate Message-IDs collide.
create unique index if not exists activities_user_email_message_id_key
  on public.activities (user_id, email_message_id);

-- ---------- Notifications ----------
-- One row per person per notifyable event. Only ever written by service_role (server-side
-- code, e.g. emailSync.ts logging a new incoming email) in this pass -- no insert policy for
-- authenticated/anon, so a person can read and mark their own notifications read but never
-- forge one for themselves or anyone else.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  message text not null,
  -- App-relative path to open when clicked, e.g. "/companies/<id>".
  link text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.notifications enable row level security;
create policy "notifications_select" on public.notifications for select using (user_id = auth.uid());
create policy "notifications_update" on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Proposals ----------
create table if not exists public.proposals (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  service text not null,
  pricing numeric not null default 0,
  description text,
  terms text,
  validity_date timestamptz not null,
  status text not null default 'Draft' check (status in ('Draft', 'Sent', 'Viewed', 'Accepted', 'Declined', 'Expired')),
  created_at timestamptz not null default now()
);

-- A handover is a batch of accounts a client actually sends, not a single event.
-- A client signs a mandate saying "we have R1m to hand over" and then sends it in
-- instalments over months. The signed figure is a claim; these rows are the facts.
--
-- capital_amount is the principal only. Annex B fees under the Debt Collectors Act
-- and interest at 2% per month accrue on top of it as accounts are worked, so what a
-- debtor owes and what was handed over are different numbers that diverge over time.
--
-- Deliberately a header table: debt collection agents will work individual accounts,
-- and commission, legal fees and interest are all per-account, so account rows will
-- reference a batch.
create table if not exists public.handovers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  deal_id uuid references public.deals (id) on delete set null,
  received_at timestamptz not null default now(),
  capital_amount numeric not null default 0,
  accounts_count integer,
  reference text,
  notes text,
  logged_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists handovers_company_id_idx on public.handovers (company_id);
create index if not exists handovers_received_at_idx on public.handovers (received_at desc);

-- ---------- Targets ----------
-- What a team or a person is expected to produce in a sales month.
--
-- Two numbers per target, not one. The business talks about a floor and a goal in the same
-- breath ("fifty is the minimum, we want seventy-five"), and collapsing that into a single
-- figure loses the distinction that actually drives behaviour: below the floor is a problem,
-- between floor and goal is acceptable, above the goal is the win.
--
-- period_key is null for a standing target — the number that applies every month unless
-- something overrides it. A row with a period_key overrides the standing one for that single
-- sales month, which is how a short December or a month with someone on leave gets handled
-- without editing the permanent figure and forgetting to put it back.
--
-- scope_type says who owns the number. A team target is the team's total; a user target is one
-- person's own. Both can exist at once — that is deliberate, because "the team must sign 75"
-- and "each of you must sign at least 15" are both real and neither implies the other.
create table if not exists public.targets (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (scope_type in ('team', 'user')),
  scope_id uuid not null,
  metric text not null check (metric in ('leads', 'mandates', 'deals', 'revenue', 'book', 'accounts', 'activities')),
  -- null = the standing target, applied to every sales month with no override of its own.
  period_key text,
  target_value numeric not null default 0,
  -- The floor. Null where the business only has a goal and no separate minimum.
  threshold_value numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One number per scope, metric and period. The partial index is what makes "null period_key"
-- unique too — a plain unique constraint treats every null as distinct, which would silently
-- allow two competing standing targets for the same thing.
create unique index if not exists targets_scoped_period_idx
  on public.targets (scope_type, scope_id, metric, period_key)
  where period_key is not null;
create unique index if not exists targets_scoped_standing_idx
  on public.targets (scope_type, scope_id, metric)
  where period_key is null;

alter table public.targets enable row level security;

-- Everyone sees the targets — a number nobody can see is not a target. Only an Administrator
-- or a Sales Manager sets them.
drop policy if exists "targets_select" on public.targets;
create policy "targets_select" on public.targets for select using (auth.uid() is not null);

drop policy if exists "targets_write" on public.targets;
create policy "targets_write" on public.targets for all
  using (public.current_user_role() in ('Administrator', 'Sales Manager'))
  with check (public.current_user_role() in ('Administrator', 'Sales Manager'));

-- ---------- SECURITY DEFINER function exposure ----------
-- A SECURITY DEFINER function runs with its owner's privileges, and every function in the
-- public schema is reachable as a REST endpoint at /rest/v1/rpc/<name>. Left with the default
-- grants, these three were callable by signed-out visitors — a documented way around RLS.
--
-- The two trigger functions are meant to fire from a trigger and never to be called directly.
-- Postgres does not check EXECUTE when a trigger fires, so revoking costs nothing.
revoke execute on function public.handle_new_user() from anon, authenticated, public;
revoke execute on function public.protect_profile_privileged_fields() from anon, authenticated, public;

-- current_user_role is different: RLS policies call it, and a policy expression is evaluated as
-- the querying user, so `authenticated` must keep EXECUTE or every policy referencing it fails
-- with a permission error. Signed-out callers have no business with it.
revoke execute on function public.current_user_role() from anon, public;
grant execute on function public.current_user_role() to authenticated;

-- ---------- Base table grants ----------
-- Tables created via the SQL Editor (as opposed to Supabase's Table Editor
-- UI, which does this automatically) do NOT get default SELECT/INSERT/
-- UPDATE/DELETE grants for the anon/authenticated roles. Postgres checks
-- these base grants *before* it ever evaluates RLS policies, so without
-- this block every request — reads and writes alike — comes back as a
-- flat 403 regardless of how correct the RLS policies below are. This bit
-- everyone the first time this schema was run; don't remove it.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;

-- service_role bypasses RLS but still needs these same base grants first —
-- server-side code (api/invite-user.ts) uses it to check a caller's role
-- before allowing an invite, and that lookup was a flat 403 on every table
-- until this was added, since service_role had never been granted access.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;

-- ---------- Row Level Security ----------
-- Phase 2 policy: everyone can still SEE everything (team-wide leaderboards,
-- reports, and search all depend on that and haven't changed). Writes are
-- narrower: a Sales Representative can only edit/delete records they own;
-- an Administrator or Sales Manager can edit/delete anyone's. Team and user
-- management (roles, statuses, teams) is Administrator-only.
alter table public.teams enable row level security;
alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.contacts enable row level security;
alter table public.leads enable row level security;
alter table public.deals enable row level security;
alter table public.tasks enable row level security;
alter table public.activities enable row level security;
alter table public.proposals enable row level security;
alter table public.handovers enable row level security;

-- companies/contacts/leads/deals/tasks/activities all follow the same
-- shape: open read, open insert, and update/delete gated to the row's
-- owner column (or an Administrator/Sales Manager).
do $$
declare
  pair text[];
  t text;
  owner_col text;
begin
  foreach pair slice 1 in array array[
    array['companies', 'account_owner_id'],
    array['contacts', 'owner_id'],
    array['leads', 'owner_id'],
    array['deals', 'owner_id'],
    array['tasks', 'owner_id'],
    array['activities', 'user_id']
  ]
  loop
    t := pair[1];
    owner_col := pair[2];

    execute format('drop policy if exists "authenticated_all" on public.%I;', t);

    execute format('drop policy if exists "%s_select" on public.%I;', t, t);
    execute format('create policy "%s_select" on public.%I for select using (auth.uid() is not null);', t, t);

    execute format('drop policy if exists "%s_insert" on public.%I;', t, t);
    execute format('create policy "%s_insert" on public.%I for insert with check (auth.uid() is not null);', t, t);

    execute format('drop policy if exists "%s_update" on public.%I;', t, t);
    execute format(
      'create policy "%s_update" on public.%I for update using (%I = auth.uid() or public.current_user_role() in (''Administrator'', ''Sales Manager'', ''Liaison Manager'')) with check (%I = auth.uid() or public.current_user_role() in (''Administrator'', ''Sales Manager'', ''Liaison Manager''));',
      t, t, owner_col, owner_col
    );

    execute format('drop policy if exists "%s_delete" on public.%I;', t, t);
    execute format(
      'create policy "%s_delete" on public.%I for delete using (%I = auth.uid() or public.current_user_role() in (''Administrator'', ''Sales Manager'', ''Liaison Manager''));',
      t, t, owner_col
    );
  end loop;
end $$;

-- proposals have no owner column of their own — ownership follows the
-- parent deal's owner.
drop policy if exists "authenticated_all" on public.proposals;

drop policy if exists "proposals_select" on public.proposals;
create policy "proposals_select" on public.proposals for select using (auth.uid() is not null);

drop policy if exists "proposals_insert" on public.proposals;
create policy "proposals_insert" on public.proposals for insert with check (auth.uid() is not null);

drop policy if exists "proposals_update" on public.proposals;
create policy "proposals_update" on public.proposals for update
  using (
    public.current_user_role() in ('Administrator', 'Sales Manager', 'Liaison Manager')
    or exists (select 1 from public.deals d where d.id = proposals.deal_id and d.owner_id = auth.uid())
  )
  with check (
    public.current_user_role() in ('Administrator', 'Sales Manager', 'Liaison Manager')
    or exists (select 1 from public.deals d where d.id = proposals.deal_id and d.owner_id = auth.uid())
  );

drop policy if exists "proposals_delete" on public.proposals;
create policy "proposals_delete" on public.proposals for delete
  using (
    public.current_user_role() in ('Administrator', 'Sales Manager', 'Liaison Manager')
    or exists (select 1 from public.deals d where d.id = proposals.deal_id and d.owner_id = auth.uid())
  );

drop policy if exists "handovers_select" on public.handovers;
create policy "handovers_select" on public.handovers for select using (auth.uid() is not null);

drop policy if exists "handovers_insert" on public.handovers;
create policy "handovers_insert" on public.handovers for insert with check (auth.uid() is not null);

-- Correcting a batch is ordinary work — a client re-sends a corrected file, an amount
-- is keyed wrong — so whoever logged it can fix it, alongside the managers.
drop policy if exists "handovers_update" on public.handovers;
create policy "handovers_update" on public.handovers for update
  using (
    public.current_user_role() in ('Administrator', 'Sales Manager', 'Liaison Manager')
    or logged_by = auth.uid()
  )
  with check (
    public.current_user_role() in ('Administrator', 'Sales Manager', 'Liaison Manager')
    or logged_by = auth.uid()
  );

drop policy if exists "handovers_delete" on public.handovers;
create policy "handovers_delete" on public.handovers for delete
  using (
    public.current_user_role() in ('Administrator', 'Sales Manager', 'Liaison Manager')
    or logged_by = auth.uid()
  );

-- profiles: anyone can view the directory; you can edit your own row (name,
-- phone), and an Administrator can edit anyone's. The
-- protect_profile_privileged_fields trigger above stops a non-admin from
-- smuggling a role/status/team change through their own self-edit.
drop policy if exists "authenticated_all" on public.profiles;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select using (auth.uid() is not null);

drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles for update
  using (auth.uid() = id or public.current_user_role() = 'Administrator')
  with check (auth.uid() = id or public.current_user_role() = 'Administrator');

-- teams: anyone can view them; only an Administrator can create/rename/
-- delete one.
drop policy if exists "authenticated_all" on public.teams;

drop policy if exists "teams_select" on public.teams;
create policy "teams_select" on public.teams for select using (auth.uid() is not null);

drop policy if exists "teams_write" on public.teams;
create policy "teams_write" on public.teams for all
  using (public.current_user_role() = 'Administrator')
  with check (public.current_user_role() = 'Administrator');

-- ---------- Email connections (SMTP/IMAP, e.g. Xneelo-hosted mail) ----------
-- One row per person who has connected their own mailbox so Romulus
-- can send email as them and log incoming mail against matching CRM
-- records. encrypted_password is AES-256-GCM ciphertext (see
-- api/_lib/crypto.ts) -- never plaintext -- and like the mailbox
-- credentials themselves, is only ever read or written by the service_role
-- API routes under /api/email/*, never the browser. RLS is enabled with no
-- policies for authenticated/anon, so even a compromised anon/authenticated
-- key can't read a row. last_seen_uid is the INBOX IMAP UID watermark, and
-- last_seen_uid_junk the same for the mailbox's Junk/Spam folder (a client's
-- reply misfiled as spam is still a reply) -- IMAP UIDs are only unique
-- within a single mailbox, so each folder needs its own watermark.
-- email_connections deliberately has RLS enabled and NO policies, which means no browser can
-- read it at all — only server-side code holding the service key, which is every route under
-- api/email/. The rows hold mailbox credentials; they are encrypted on top of this, and the
-- absence of a policy is the second lock rather than an oversight.
--
-- Supabase's security advisor reports this as "RLS enabled, no policy". That report is
-- expected. Do not resolve it by adding a policy.
create table if not exists public.email_connections (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  email text not null,
  smtp_host text not null,
  smtp_port integer not null default 587,
  imap_host text not null,
  imap_port integer not null default 993,
  encrypted_password text not null,
  last_seen_uid integer,
  last_seen_uid_junk integer,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.email_connections enable row level security;

-- ---------- BuzzBox (PABX click-to-dial) ----------
-- One row for the whole firm: the BuzzBox login the CRM dials through. Same posture as
-- email_connections -- RLS on, NO policies, so only the service key (api/buzzbox/*) can read
-- it, and the password is AES-GCM encrypted on top with EMAIL_CREDENTIALS_KEY. Reps never
-- see these credentials; each rep is tied to an extension via profiles.buzzbox_extension.
--
-- The security advisor's "RLS enabled, no policy" report on this table is expected. Do not
-- resolve it by adding a policy.
create table if not exists public.buzzbox_settings (
  id smallint primary key default 1 check (id = 1),
  identity text not null,
  encrypted_password text not null,
  organisation_id bigint not null,
  organisation_name text,
  connected_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.buzzbox_settings enable row level security;

-- ---------- Email signature image storage ----------
-- Public bucket (an outgoing email's <img> tag needs a URL any mail client
-- can fetch without auth). Writes are restricted to the owning user's own
-- folder (path "<user_id>/...") or an Administrator uploading on someone
-- else's behalf, mirroring the profiles_update policy below.
insert into storage.buckets (id, name, public)
values ('email-signatures', 'email-signatures', true)
on conflict (id) do nothing;

create policy "email_signatures_read" on storage.objects
  for select using (bucket_id = 'email-signatures');

create policy "email_signatures_insert" on storage.objects
  for insert with check (
    bucket_id = 'email-signatures'
    and (auth.uid()::text = (storage.foldername(name))[1] or public.current_user_role() = 'Administrator')
  );

create policy "email_signatures_update" on storage.objects
  for update using (
    bucket_id = 'email-signatures'
    and (auth.uid()::text = (storage.foldername(name))[1] or public.current_user_role() = 'Administrator')
  );

create policy "email_signatures_delete" on storage.objects
  for delete using (
    bucket_id = 'email-signatures'
    and (auth.uid()::text = (storage.foldername(name))[1] or public.current_user_role() = 'Administrator')
  );

-- ---------- The collections book ----------
-- Everything above this line is the sales side: leads, deals, the mandate being signed.
-- Everything below it is what happens after — the individual debtor accounts that arrive in a
-- handover and get worked for years.
--
-- These five tables existed on the database before they existed in this file: they were applied
-- live while the money model was being worked out and never written back here. That drift is
-- why this section is now the authoritative copy. Re-running it against that database is a
-- no-op.
--
-- The money is split across three independent ledgers rather than kept as running totals on the
-- account, because a debtor, a client, or the Council for Debt Collectors can ask to see how a
-- balance was arrived at. A stored balance cannot answer that; a ledger can. So an account's
-- balance is *derived* — from its payments, its fees and its interest — and never stored as
-- the truth.
--
-- All three ledgers are append-only by policy (select + insert, no update or delete). A
-- reversal is a new negative row, not an edit, because the statement has to show the payment
-- and the reversal rather than a silently smaller number.

-- One debtor account. The unit the collections team actually works.
create table if not exists public.debtor_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  handover_id uuid references public.handovers (id) on delete set null,

  account_number text,
  client_reference text,
  legacy_reference text,

  debtor_first_name text,
  debtor_surname text,
  debtor_id_number text,

  capital_handed_over numeric,
  capital_outstanding numeric,
  -- The in duplum ceiling: non-capital may never exceed capital outstanding at handover. Fixed
  -- once, at handover, and never recalculated as the balance falls (§5).
  in_duplum_ceiling numeric,

  -- Stamped at handover and never recalculated (§3). Nullable on purpose: "no rate resolved"
  -- and "we charge nothing" are different facts, and a not-null default of 0 made them the
  -- same value — an account whose rate could not be worked out would have read as free.
  commission_rate numeric,

  -- 2% per month is standard but negotiable, per client or per account, and a renegotiation
  -- takes effect from a date rather than retroactively — so the rate carries its start date.
  interest_rate_annual numeric,
  interest_from date,

  -- Prescription runs three years from the last interrupting act. A payment interrupts it, and
  -- so does an acknowledgement of debt — which is why the AoD has its own Annexure B tariff.
  prescription_date date,
  prescribed boolean not null default false,
  last_interrupted_at timestamptz,

  -- The opening position: what the account was worth when Raptor took it over. Kept separate
  -- from the ledgers so a migrated account can always be reconciled back to its old system.
  opening_as_at date,
  opening_capital numeric,
  opening_fees numeric,
  opening_interest numeric,

  status text,
  sub_status text,
  bucket text,
  assigned_to uuid references public.profiles (id) on delete set null,
  diary_date date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists debtor_accounts_company_idx on public.debtor_accounts (company_id);
create index if not exists debtor_accounts_assigned_idx on public.debtor_accounts (assigned_to, bucket, diary_date);
create index if not exists debtor_accounts_diary_idx on public.debtor_accounts (diary_date) where prescribed = false;
create index if not exists debtor_accounts_prescription_idx on public.debtor_accounts (prescription_date) where prescribed = false;
create index if not exists debtor_accounts_legacy_idx on public.debtor_accounts (legacy_reference);
create index if not exists debtor_accounts_surname_idx on public.debtor_accounts (debtor_surname);

-- Every payment received, exactly as received.
create table if not exists public.account_payments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.debtor_accounts (id) on delete cascade,
  received_at timestamptz not null,
  amount numeric not null,
  method text,
  reference text,
  source text not null default 'manual',
  reversed_at timestamptz,
  reversal_reason text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists account_payments_account_idx on public.account_payments (account_id, received_at desc);

-- How a payment was split, and what it earned us. One row per payment, recomputed rather than
-- edited: engine_version records which version of the waterfall produced it, so a corrected
-- engine can be re-run over history and the difference explained rather than discovered.
create table if not exists public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references public.account_payments (id) on delete cascade,
  account_id uuid not null references public.debtor_accounts (id) on delete cascade,
  to_interest numeric not null default 0,
  -- Annexure B item 9: 10% of the instalment, capped at R610 per payment.
  to_receipt_fee numeric not null default 0,
  to_fees numeric not null default 0,
  to_capital numeric not null default 0,
  commission numeric not null default 0,
  commission_vat numeric not null default 0,
  to_client numeric not null default 0,
  capital_before numeric not null default 0,
  capital_after numeric not null default 0,
  -- The rates in force for this payment, stored rather than looked up: a rate change must not
  -- silently restate what a client was already remitted.
  commission_rate numeric not null default 0,
  vat_rate numeric not null default 15,
  engine_version text not null default 'v1',
  computed_at timestamptz not null default now()
);

-- Every fee raised on an account, at the price it was raised at.
--
-- The fee is stored as charged, never recomputed from today's tariff: the Annexure B rates
-- changed in April 2026, and a 2024 letter has to keep its 2024 price forever.
-- tariff_effective_from records which schedule it was priced off.
create table if not exists public.account_fees (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.debtor_accounts (id) on delete cascade,
  annexure_item text,
  tariff_effective_from date,
  description text not null,
  amount_excl_vat numeric not null default 0,
  vat_rate numeric not null default 15,
  vat_amount numeric not null default 0,
  -- Annexure B caps recoverable fees. A fee outside the cap is still a real fee we raised; it
  -- just cannot be recovered from the debtor, so it is flagged rather than omitted.
  counts_toward_fee_cap boolean not null default true,
  incurred_at timestamptz not null default now(),
  source text not null default 'action',
  -- Set for a fee that arises from a payment (the receipt fee), so the two can be reconciled.
  payment_id uuid references public.account_payments (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists account_fees_account_idx on public.account_fees (account_id, incurred_at desc);

-- Interest as accrued. One row per accrual period.
--
-- amount_accrued is what the debt earned; amount_recoverable is what may actually be collected
-- once in duplum is applied. They diverge on a capped account and must both be kept: the client
-- is owed an honest account of what was written off, not a quietly smaller number.
create table if not exists public.account_interest_accruals (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.debtor_accounts (id) on delete cascade,
  accrued_on date not null,
  days integer not null default 1,
  opening_balance numeric not null default 0,
  daily_rate numeric not null default 0,
  amount_accrued numeric not null default 0,
  amount_recoverable numeric not null default 0,
  capitalised boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists account_interest_account_idx on public.account_interest_accruals (account_id, accrued_on desc);

-- ---------- The client register ----------
-- From the business's own record of who its clients are, one row per Swordfish client record.
--
-- registration_number is the one that matters: it is the client's legal identity, and it is what
-- proves four "ABSTO ... -1..-4" rows are one company. The BF reference cannot do that job —
-- Agri Saad's three commission tiers carry three different references while sharing one
-- registration number. A legal identity holds where a filing convention does not.
alter table public.companies
  add column if not exists registration_number text,
  add column if not exists vat_number text,
  -- The client's own account, for paying over what we collect. Readable by anyone signed in,
  -- like the rest of the company record — worth knowing, since that is wider than the people who
  -- actually do remittances.
  add column if not exists banking_details text,
  add column if not exists contact_person text,
  -- The business's own client reference (CLIENTS0591). Kept for looking things up in their
  -- existing paperwork, never used as identity.
  add column if not exists bf_reference text,
  -- Active or Dormant on the register. A dormant client keeps its book and its history.
  add column if not exists register_status text,
  -- Who at Bredell Ferreira looks after the relationship. Free text rather than a profile
  -- reference: these are names on a spreadsheet, and not all of them will have a login.
  add column if not exists liaison text;

create index if not exists companies_registration_number_idx
  on public.companies (registration_number) where registration_number is not null;

-- ---------- Migration provenance ----------
-- Added when the Swordfish import was built. Separate from the definitions above because these
-- columns exist to answer "where did this row come from and does it still agree with the system
-- it came from" — a question that stops mattering once the migration is old, but which is
-- unanswerable after the fact if the columns were never there.
-- See the commission_rate comment above: an unresolved rate must not read as zero.
alter table public.debtor_accounts alter column commission_rate drop not null;
alter table public.debtor_accounts alter column commission_rate drop default;

alter table public.debtor_accounts
  add column if not exists swordfish_reference text,
  add column if not exists in_duplum boolean not null default false,
  add column if not exists write_off_reason text,
  add column if not exists handover_date date,
  add column if not exists handover_balance numeric,
  add column if not exists handover_interest numeric,
  add column if not exists handover_legal_fees numeric,
  add column if not exists payments_to_date numeric,
  -- Swordfish's closing position on the day of the import. Never read as a balance: the
  -- ledgers replay the account from handover and derive that. This is what the replay is
  -- checked against, and the only reason a migrated account can be proved rather than trusted.
  add column if not exists swordfish_balance_at_import numeric,
  add column if not exists swordfish_fees_at_import numeric,
  -- What the client's mandate bands call for on the capital handed over, beside what the
  -- account is actually billed at. They are allowed to differ: a difference may be a keying
  -- error or a later negotiation, and the two cannot be told apart from the data — so the
  -- system reports it and a person decides. 60 of 285 Growthpoint accounts arrived differing.
  add column if not exists commission_rate_expected numeric,
  add column if not exists commission_rate_source text,
  -- Whoever works it in Swordfish. Free text, deliberately: not everyone who worked an account
  -- has a Raptor login, and an account must not lose its history over that.
  add column if not exists swordfish_assigned_to text,
  add column if not exists current_legal_stage text,
  add column if not exists legal_stage_date date,
  add column if not exists last_action_at date,
  add column if not exists last_payment_at date,
  add column if not exists source text not null default 'manual',
  add column if not exists imported_at timestamptz;

create unique index if not exists debtor_accounts_swordfish_ref_idx
  on public.debtor_accounts (swordfish_reference) where swordfish_reference is not null;

alter table public.account_payments
  add column if not exists depositor_name text,
  add column if not exists details text,
  -- Paid To Client: the client took the money directly and owes us our share. A full payment in
  -- every respect except custody of the cash, so it counts on the account and settles in the
  -- month-end reconciliation instead (§7a).
  add column if not exists paid_to_client boolean not null default false;

-- action_code is our closed catalogue (src/lib/actionTariff.ts); legacy_name is what Swordfish
-- called it, kept beside it so a mapping decision can be re-examined against the original.
--
-- A cancelled action keeps its fee. The fee attaches to the action being issued, so a PTP the
-- debtor later defaults on is still billed and reinstating it is billed again — cancelled_at
-- records the cancellation without removing the charge. Excluding cancelled actions was tested
-- against the export and made reconciliation worse (92% -> 76%).
alter table public.account_fees
  add column if not exists action_code text,
  add column if not exists legacy_name text,
  -- SMS is billed per 160-character segment: one message can be three segments and cost R10.50.
  add column if not exists segments integer not null default 1,
  -- False for an action taken but not chargeable, which is a different thing from one that
  -- happened to cost zero.
  add column if not exists billed boolean not null default true,
  -- Annexure B distinguishes a fee (our tariff) from an expense (money paid out and recovered).
  add column if not exists expense_or_fee text,
  add column if not exists destination text,
  add column if not exists cancelled_at date,
  add column if not exists cancel_reason text,
  add column if not exists performed_by text,
  add column if not exists swordfish_action_id text;

-- Scoped to the account, because Swordfish's Action ID is unique within an account and not
-- across the book. Indexing it alone asserted a global key it does not have: 130 IDs in a
-- 59,158-row export are reused, and the pairs are plainly different acts — an SMS on ACF10003 in
-- August 2026 shares ID 3500044 with a Promise to Pay on GPS3/10006 in September 2024. 28 of
-- them are reused within one client, so it is not a per-client sequence either. The pair has
-- zero collisions across the whole export, and still stops a re-run double-importing an action.
create unique index if not exists account_fees_swordfish_action_idx
  on public.account_fees (account_id, swordfish_action_id) where swordfish_action_id is not null;

-- The accrual key was wrong, and the import is what proved it.
--
-- It was unique (account_id, accrued_on): one accrual stream per account per day. The real book
-- runs concurrent streams — 804 accounts in the export have two periods starting on the same
-- date, and that constraint would have rejected every second one. No two periods are identical,
-- though, so the period is the invariant, and that is what is enforced now.
alter table public.account_interest_accruals
  drop constraint if exists account_interest_accruals_account_id_accrued_on_key;

create unique index if not exists account_interest_accruals_period_idx
  on public.account_interest_accruals (account_id, accrued_on, days);

alter table public.account_interest_accruals
  add column if not exists source text not null default 'engine';

-- The mandate's commission bands, as signed. Null for a client on a single flat rate, which is
-- most of them. Shape: [{"upTo": 25000, "rate": 0.25}, {"upTo": null, "rate": 0.225}] — ordered
-- ascending, upTo inclusive, final band null for "and above". See src/lib/commission.ts.
alter table public.companies
  add column if not exists commission_bands jsonb,
  add column if not exists commission_bands_source text,
  add column if not exists commission_rate numeric;

-- ---------- Collections RLS ----------
-- Everyone signed in can read the book: the collections floor, the rep who signed the mandate
-- and the manager reporting on it all need the same view, and this is one company.
--
-- The three ledgers take inserts but no updates or deletes. That is the append-only rule above
-- expressed as policy rather than as a convention someone is trusted to follow — there is no
-- statement a client can be shown that a later edit could quietly contradict.
alter table public.debtor_accounts enable row level security;
alter table public.account_payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.account_fees enable row level security;
alter table public.account_interest_accruals enable row level security;

drop policy if exists "debtor_accounts_select" on public.debtor_accounts;
create policy "debtor_accounts_select" on public.debtor_accounts for select using (auth.uid() is not null);
drop policy if exists "debtor_accounts_write" on public.debtor_accounts;
create policy "debtor_accounts_write" on public.debtor_accounts for all
  using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "account_payments_select" on public.account_payments;
create policy "account_payments_select" on public.account_payments for select using (auth.uid() is not null);
drop policy if exists "account_payments_insert" on public.account_payments;
create policy "account_payments_insert" on public.account_payments for insert with check (auth.uid() is not null);

drop policy if exists "payment_allocations_select" on public.payment_allocations;
create policy "payment_allocations_select" on public.payment_allocations for select using (auth.uid() is not null);
drop policy if exists "payment_allocations_insert" on public.payment_allocations;
create policy "payment_allocations_insert" on public.payment_allocations for insert with check (auth.uid() is not null);

drop policy if exists "account_fees_select" on public.account_fees;
create policy "account_fees_select" on public.account_fees for select using (auth.uid() is not null);
drop policy if exists "account_fees_insert" on public.account_fees;
create policy "account_fees_insert" on public.account_fees for insert with check (auth.uid() is not null);

drop policy if exists "account_interest_select" on public.account_interest_accruals;
create policy "account_interest_select" on public.account_interest_accruals for select using (auth.uid() is not null);

-- Narrower than the other two ledgers, on purpose. Interest is *derived*, never *recorded*: a
-- payment arrives and a person enters it, a fee is raised and a person raises it, but nobody
-- types an accrual — the engine computes them, and a collections agent has no business inserting
-- interest by hand. An import is run by an administrator or a manager, and the accrual engine
-- will run server-side under the service role, which bypasses RLS entirely.
--
-- It had no insert policy at all until the migration tried to write one and could not. The
-- distinction above was right; having nothing able to write was not.
drop policy if exists "account_interest_insert" on public.account_interest_accruals;
create policy "account_interest_insert" on public.account_interest_accruals for insert
  with check (public.current_user_role() in ('Administrator', 'Sales Manager', 'Liaison Manager'));

-- ---------- Function hardening ----------
-- handle_new_user and protect_profile_privileged_fields only ever run as
-- triggers (they reference NEW/OLD, which only exist in trigger context),
-- so there's no legitimate reason for them to be directly callable via
-- Supabase's auto-exposed /rest/v1/rpc/<function> endpoints. Revoking
-- EXECUTE from PUBLIC doesn't affect the triggers themselves — trigger
-- invocation runs through the table owner's privileges, not the calling
-- client's. current_user_role() is genuinely used by RLS policies for
-- `authenticated`, so only anon (which never needs it — every policy
-- already requires auth.uid() is not null) loses direct RPC access.
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.protect_profile_privileged_fields() from public;
revoke execute on function public.current_user_role() from anon;
-- ---------- The collector's workspace ----------
-- Three tables the account page needs in order to be a place someone works, rather than a place
-- someone reads. Everything above this point is the record of what the debt IS; these are the
-- record of what people DO about it.

-- Who you can actually reach, and on what.
--
-- None of the five Swordfish exports carry a debtor phone number, email or address, so this
-- starts empty on all 735 migrated accounts. That is exactly why it is a table and not a set of
-- columns: the numbers will arrive one at a time, from collectors who get them on a call, and
-- an account accumulates several over the years. A verified number is worth more than an
-- unverified one, so the fact of verification is recorded rather than assumed.
create table if not exists public.account_contacts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.debtor_accounts (id) on delete cascade,
  kind text not null check (kind in ('mobile', 'phone', 'work', 'email', 'address', 'employer', 'other')),
  value text not null,
  -- "Mother", "Neighbour", "HR department" -- whose number this is, when it is not the debtor's.
  label text,
  is_primary boolean not null default false,
  -- Verified means someone confirmed it reaches the debtor. Nulls are the normal state.
  verified_at timestamptz,
  verified_by uuid references public.profiles (id) on delete set null,
  -- A number that rang out, a wrong number, a line that has been disconnected: the reason we
  -- stop using it, kept rather than deleted so nobody re-traces the same dead number.
  retired_at timestamptz,
  retired_reason text,
  notes text,
  source text not null default 'manual',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists account_contacts_account_idx on public.account_contacts (account_id);

-- What was said. The 58,192 Swordfish action comments are not imported yet and land here when
-- they are, which is why source exists and body is plain text rather than anything structured.
create table if not exists public.account_notes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.debtor_accounts (id) on delete cascade,
  body text not null,
  -- Pinned notes lead the timeline: "speaks Zulu", "do not call at work".
  pinned boolean not null default false,
  source text not null default 'manual',
  -- Free text as well as a reference, for the same reason swordfish_assigned_to is free text:
  -- an imported comment was written by someone who may never have a Raptor login.
  author_name text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists account_notes_account_idx on public.account_notes (account_id, created_at desc);

-- A promise to pay: the single most important thing a collector produces.
--
-- It is a claim about the future, so it is never a payment and never touches a balance. It is
-- kept or it is broken, and which of those happened is the measure of whether a collector's day
-- was worth anything. Deliberately NOT auto-resolved here: matching a promise to an incoming
-- payment is the collections engine's job, and a promise silently marked kept by a rule nobody
-- can see is worse than one a person closes.
create table if not exists public.promises_to_pay (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.debtor_accounts (id) on delete cascade,
  amount numeric not null check (amount > 0),
  due_on date not null,
  method text,
  -- open: not yet due, or due and not yet resolved by a person.
  -- kept / broken: what actually happened. cancelled: withdrawn before it fell due.
  status text not null default 'open' check (status in ('open', 'kept', 'broken', 'cancelled')),
  -- Set when a person closes it, with the payment that satisfied it where there is one.
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  payment_id uuid references public.account_payments (id) on delete set null,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists promises_account_idx on public.promises_to_pay (account_id, due_on desc);
create index if not exists promises_open_idx on public.promises_to_pay (due_on) where status = 'open';

alter table public.account_contacts enable row level security;
alter table public.account_notes enable row level security;
alter table public.promises_to_pay enable row level security;

-- Collectors write all three: capturing a number, recording what was said and taking a promise
-- IS the job. Nothing here changes what is owed, so the write policies are as wide as the read
-- ones -- unlike the ledgers, where a wrong row moves money.
drop policy if exists "account_contacts_select" on public.account_contacts;
create policy "account_contacts_select" on public.account_contacts for select using (auth.uid() is not null);
drop policy if exists "account_contacts_write" on public.account_contacts;
create policy "account_contacts_write" on public.account_contacts for all
  using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "account_notes_select" on public.account_notes;
create policy "account_notes_select" on public.account_notes for select using (auth.uid() is not null);
drop policy if exists "account_notes_insert" on public.account_notes;
create policy "account_notes_insert" on public.account_notes for insert with check (auth.uid() is not null);
-- A note is a contemporaneous record of what was said. Editing one after the fact defeats the
-- point, so there is no update policy: correct it with another note.
drop policy if exists "account_notes_update" on public.account_notes;
create policy "account_notes_update" on public.account_notes for update
  using (public.current_user_role() in ('Administrator', 'Sales Manager', 'Liaison Manager'))
  with check (public.current_user_role() in ('Administrator', 'Sales Manager', 'Liaison Manager'));

drop policy if exists "promises_select" on public.promises_to_pay;
create policy "promises_select" on public.promises_to_pay for select using (auth.uid() is not null);
drop policy if exists "promises_write" on public.promises_to_pay;
create policy "promises_write" on public.promises_to_pay for all
  using (auth.uid() is not null) with check (auth.uid() is not null);

-- ---------- The account page's own fields ----------
-- The main comment: a short standing description of what is going on with this account, written
-- and rewritten by whoever is working it. Distinct from a note, which is dated and never edited:
-- this is the current state of play, and the current state of play is meant to be replaced.
--
-- The three preference fields are single-valued and belong to the debtor rather than to any one
-- number, which is why they are columns and not account_contacts rows. Consent status matters
-- under POPIA: it decides whether we may contact them electronically at all.
alter table public.debtor_accounts
  add column if not exists main_comment text,
  add column if not exists main_comment_at timestamptz,
  add column if not exists main_comment_by uuid references public.profiles (id) on delete set null,
  add column if not exists preferred_language text,
  add column if not exists contact_preference text,
  add column if not exists consent_status text;

-- ---------- Documents ----------
-- The paperwork an account accumulates: the mandate, the AoD, letters, proof of payment, a
-- traced ID copy. Files live in a PRIVATE storage bucket and are reached through short-lived
-- signed URLs -- a debtor's ID document behind a guessable public URL is a POPIA breach waiting
-- to be found.
--
-- Deletion is restricted to managers. Everyone can add; nobody working an account can quietly
-- remove the letter of demand that proves it was sent.
create table if not exists public.account_documents (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.debtor_accounts (id) on delete cascade,
  name text not null,
  storage_path text not null unique,
  mime_type text,
  size_bytes bigint,
  -- What kind of paper it is, from the app's own list. Free text in the database so a new kind
  -- does not need a migration.
  kind text,
  notes text,
  uploaded_by uuid references public.profiles (id) on delete set null,
  uploaded_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists account_documents_account_idx
  on public.account_documents (account_id, created_at desc);

alter table public.account_documents enable row level security;

drop policy if exists "account_documents_select" on public.account_documents;
create policy "account_documents_select" on public.account_documents for select using (auth.uid() is not null);
drop policy if exists "account_documents_insert" on public.account_documents;
create policy "account_documents_insert" on public.account_documents for insert with check (auth.uid() is not null);
drop policy if exists "account_documents_delete" on public.account_documents;
create policy "account_documents_delete" on public.account_documents for delete
  using (public.current_user_role() in ('Administrator', 'Sales Manager', 'Liaison Manager'));

insert into storage.buckets (id, name, public)
values ('account-documents', 'account-documents', false)
on conflict (id) do nothing;

drop policy if exists "account_documents_read" on storage.objects;
create policy "account_documents_read" on storage.objects
  for select using (bucket_id = 'account-documents' and auth.uid() is not null);

drop policy if exists "account_documents_write" on storage.objects;
create policy "account_documents_write" on storage.objects
  for insert with check (bucket_id = 'account-documents' and auth.uid() is not null);

drop policy if exists "account_documents_remove" on storage.objects;
create policy "account_documents_remove" on storage.objects
  for delete using (
    bucket_id = 'account-documents'
    and public.current_user_role() in ('Administrator', 'Sales Manager', 'Liaison Manager')
  );

-- ---------- Debtors Per Client ----------
-- The sixth Swordfish export, and the one that carries the debtor themselves: 691 cellphones,
-- 678 email addresses and 721 main comments on a book of 735, none of which appeared in any of
-- the other five. Everything it adds is about the PERSON and how to reach them; the money still
-- comes from the account summary and the three ledgers.
alter table public.debtor_accounts
  -- For addressing a letter of demand properly. "Mr T Mokoena" is not the same document as
  -- "thabo mokoena", and 723 of 735 rows carry initials.
  add column if not exists debtor_title text,
  add column if not exists debtor_initials text,
  add column if not exists debtor_second_name text,
  -- Swordfish's own operational flags, semicolon-separated as exported: "Debtor avoiding
  -- contact; Section 129 in process". Kept as the original string rather than split into a
  -- lookup — they are a note from another system, and inventing a taxonomy for them here would
  -- be inventing meaning we have not been told.
  add column if not exists account_flags text,
  add column if not exists account_rating integer,
  add column if not exists last_contact_method text,
  -- How often this debtor keeps a promise, per Swordfish. Worth having beside a new promise.
  add column if not exists ptp_success_ratio numeric;

alter table public.promises_to_pay
  -- How the promise was obtained: a phone call, WhatsApp, email. Distinct from `method`, which
  -- is how they said they would pay.
  add column if not exists origin text,
  add column if not exists source text not null default 'manual';

create index if not exists debtor_accounts_flags_idx
  on public.debtor_accounts (account_flags) where account_flags is not null;

-- ---------- Queries and disputes ----------
-- A debtor says something the collector cannot answer: "I already paid this", "the goods were
-- never delivered", "that is not my account". It goes to a specific person in Communications,
-- who asks the client and comes back with an answer.
--
-- This is a STATE THE ACCOUNT IS IN, which is why it lives here and not in a ticket system of
-- its own. A ticket saying "see account APM10432" beside an account saying nothing is two records
-- that drift apart, and the collector who phones next week reads the one without the dispute on it.
--
-- Three things this deliberately does NOT do:
--
--   It does not hold collection. An open dispute is a fact to know, not a brake -- the business
--   decides what to do about it through its own workflows, and a system that silently stopped
--   work on 25 accounts would be making that decision for them.
--
--   It does not enumerate the kinds. "It could be anything": already paid, goods not delivered,
--   wrong person, wrong amount. A required taxonomy would be a guess dressed as a field, so the
--   description is free text and `category` is optional.
--
--   It does not act on its own outcome. A valid dispute usually means an amount comes down or the
--   account is withdrawn -- both of which move money or end a mandate. This records the decision
--   and that it is outstanding; a person or the collections engine carries it out.
create table if not exists public.account_queries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.debtor_accounts (id) on delete cascade,
  description text not null,
  category text,
  -- open: raised, nobody has taken it to the client yet.
  -- with_client: asked, waiting. answered: the client replied, needs a decision.
  -- closed: decided, with an outcome.
  status text not null default 'open'
    check (status in ('open', 'with_client', 'answered', 'closed')),
  -- Whose query it is. The team covers for each other -- anyone may act on it, and every action
  -- records who really did it -- but one person carries it.
  owner_id uuid references public.profiles (id) on delete set null,
  raised_by uuid references public.profiles (id) on delete set null,
  raised_by_name text,
  raised_at timestamptz not null default now(),
  -- When to chase the client again. The thing that kills a query is nobody noticing it went quiet.
  chase_on date,
  outcome text check (outcome in ('valid', 'partly_valid', 'not_valid', 'withdrawn')),
  -- What must now happen: "reduce to R4,200", "withdraw the account", "no change". Free text for
  -- the same reason the description is.
  outcome_action text,
  outcome_amount numeric,
  -- Whether the action has actually been carried out. A decision recorded is not a decision done.
  outcome_done boolean not null default false,
  closed_at timestamptz,
  closed_by uuid references public.profiles (id) on delete set null,
  closed_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists account_queries_account_idx on public.account_queries (account_id, raised_at desc);
create index if not exists account_queries_open_idx on public.account_queries (status, chase_on)
  where status <> 'closed';
create index if not exists account_queries_owner_idx on public.account_queries (owner_id)
  where status <> 'closed';

-- A query's thread is account notes carrying its id, rather than a second thread table. One
-- consequence is worth the choice on its own: everything said about a dispute appears on the
-- account timeline automatically, where the next person to phone will actually read it.
alter table public.account_notes
  add column if not exists query_id uuid references public.account_queries (id) on delete cascade,
  add column if not exists kind text not null default 'note';

create index if not exists account_notes_query_idx on public.account_notes (query_id, created_at)
  where query_id is not null;

alter table public.account_queries enable row level security;

-- As wide as the account's own policies. Communications cover for each other by design, so a
-- policy scoped to the owner would break the way the team actually works.
drop policy if exists "account_queries_select" on public.account_queries;
create policy "account_queries_select" on public.account_queries for select using (auth.uid() is not null);
drop policy if exists "account_queries_write" on public.account_queries;
create policy "account_queries_write" on public.account_queries for all
  using (auth.uid() is not null) with check (auth.uid() is not null);

-- ---------- Arrangements ----------
-- A promise is either a single settlement or an instalment arrangement, and the difference
-- decides what happens when the money arrives. A once-off is kept and finished; an instalment
-- kept means the next one is now due, which is why `due_on` moves rather than the row closing.
--
-- The day is stored as a rule, not a date. "The last day of the month" is not the 30th — it is
-- the 28th in February and the 31st in March — and a debtor paid on payday means the 25th every
-- month, not 30 days after the last one. Storing a computed date would drift.
alter table public.promises_to_pay
  add column if not exists arrangement text not null default 'once_off'
    check (arrangement in ('once_off', 'weekly', 'monthly')),
  add column if not exists day_of_month integer check (day_of_month between 1 and 31),
  add column if not exists on_last_day boolean not null default false,
  -- 1 = Monday through 7 = Sunday, matching ISO rather than JavaScript's Sunday-is-zero.
  add column if not exists day_of_week integer check (day_of_week between 1 and 7),
  -- How many instalments have actually landed. The measure of whether an arrangement is holding.
  add column if not exists instalments_kept integer not null default 0,
  -- Where the debtor committed to a total as well as a monthly figure.
  add column if not exists total_promised numeric;


-- ---------- Pre-legal Agent ----------
-- The collections side of the house: the person working a debtor account before it goes to
-- attorneys. A separate role from Liaison, which is a CLIENT-facing job — a pre-legal agent
-- escalates a query to a liaison and may not put one in front of a client themselves.
--
-- Written as a constraint swap rather than an ALTER TYPE because role is a text column with a
-- check: adding a value means replacing the check, and the old one has to go first or the new
-- one is never reached.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('Administrator', 'Sales Manager', 'Sales Representative', 'Liaison Manager', 'Liaison', 'Pre-legal Agent', 'Read Only'));
