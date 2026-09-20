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
    check (role in ('Administrator', 'Sales Manager', 'Sales Representative', 'Liaison Manager', 'Liaison', 'Pre-legal Team Leader', 'Pre-legal Agent', 'Read Only')),
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
  buzzbox_extension text,
  -- How many accounts a working day holds for this person before the diary warns about
  -- overbooking. Per agent rather than firm-wide, because a phone-heavy collector and one
  -- working through letters and SMS do not have the same day. Null means the firm default
  -- (DEFAULT_DIARY_CAPACITY in src/lib/diaryPriority.ts).
  diary_capacity integer,
  -- How this person likes their diary ordered, when they have said. Null means "never chosen",
  -- which is the firm's own order (FIRM_DIARY_ORDER in src/lib/diaryPriority.ts) rather than an
  -- absence defaulted somewhere else.
  --
  -- Plain text with no CHECK on purpose: the values include 'first:<kind>', so pinning them here
  -- would mean a migration every time the diary grows a kind of work. The app refuses anything it
  -- no longer offers and falls back, so a retired value reads as "never chosen", not as an error.
  diary_order text
);
-- Older databases were created before these columns existed.
alter table public.profiles add column if not exists buzzbox_extension text;
alter table public.profiles add column if not exists diary_capacity integer;
alter table public.profiles add column if not exists diary_order text;
alter table public.user_emails add column if not exists is_sent boolean not null default false;
alter table public.user_emails add column if not exists to_address text;
alter table public.user_emails add column if not exists to_name text;
-- Its own watermark: sharing the inbox one would make the first Sent sync skip everything older
-- than the newest inbox message, which on a busy mailbox is everything.
alter table public.email_connections add column if not exists last_seen_uid_sent integer;

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

-- ---------- The two lines the next person needs ----------
--
-- The debtor's account has had a main comment since the firm asked for it, and it is the first
-- thing anybody reads on that page. The sales side had nothing like it: a lead or a client could
-- carry forty activities and no answer to "what is going on here?" short of reading all forty.
--
-- Deliberately NOT a note. A note is a thing that happened, dated, and it belongs on the timeline
-- with the others. This is the current state of affairs, overwritten as it changes, which is why
-- it is a column on the record rather than a row in a list.
alter table public.leads
  add column if not exists main_comment text,
  add column if not exists main_comment_at timestamptz,
  add column if not exists main_comment_by uuid references public.profiles (id) on delete set null;

alter table public.companies
  add column if not exists main_comment text,
  add column if not exists main_comment_at timestamptz,
  add column if not exists main_comment_by uuid references public.profiles (id) on delete set null;

alter table public.deals
  add column if not exists main_comment text,
  add column if not exists main_comment_at timestamptz,
  add column if not exists main_comment_by uuid references public.profiles (id) on delete set null;

-- And on a contact, which was the one record page left without it. A grammar with one exception
-- is a grammar people stop trusting -- and there is a real use: "prefers to be called after four",
-- "goes through his PA" is about the person, not the client they happen to work for.
alter table public.contacts
  add column if not exists main_comment text,
  add column if not exists main_comment_at timestamptz,
  add column if not exists main_comment_by uuid references public.profiles (id) on delete set null;

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

-- Where an imported lead came from, and who was working it before Raptor existed.
--
-- `source_marketer` is a name, not a reference: the sales team's leads workbook names six people
-- who worked these leads and none of them are Raptor users. Pointing owner_id at a stand-in and
-- losing the name would make three years of the book unattributable, so the name is kept as
-- written and owner_id holds whoever the import was run as.
--
-- `legacy_key` is the workbook's own identity for a lead — company, email and start date,
-- flattened. It is what makes the import re-runnable: next month's workbook is the same file with
-- another tab on it, and upserting on this key updates the leads already brought across instead
-- of importing the whole book a second time. Unique, and deliberately NOT a partial index:
-- Postgres cannot infer a partial index from `on conflict (legacy_key)`, which is exactly what
-- PostgREST's upsert emits. A plain unique btree allows any number of NULLs, so leads created by
-- hand in the app — which have no legacy key and never will — are unaffected.
alter table public.leads add column if not exists source_marketer text;
alter table public.leads add column if not exists legacy_key text;
create unique index if not exists leads_legacy_key_idx on public.leads (legacy_key);

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
  -- DERIVED, not written by hand: the soonest open diary_entries row for this account, kept in
  -- step by the sync_account_diary_date trigger at the bottom of this file. It stays on the
  -- account because the book lists fifty rows at a time out of a table that will reach six
  -- figures, and "when is this next due" has to come off the account row itself.
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

-- Every account waiting on a client is the list the monthly report leads with. Partial, so it
-- indexes only the handful actually outstanding.
create index if not exists debtor_accounts_client_action_idx
  on public.debtor_accounts (company_id, client_action_due)
  where client_action_ask is not null;

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
  -- A FREEZE IS THREE FACTS, NOT A LABEL. 150 of 736 accounts read "Frozen" and nothing else,
  -- which cannot answer a client asking why theirs has not moved in four months -- and cannot
  -- tell the firm whether it was the client who asked for the stop. Keys not labels ('firm',
  -- not the firm's name), so a rebrand is a TypeScript change and not a data migration.
  -- THE ONE CLIENT-FACING FLAG THAT CANNOT BE DERIVED. Green, amber and grey follow from the
  -- sub-status; "we are waiting on YOU" is true of a disputed, frozen or legal account alike.
  -- Raised by the ask being present — a request with no words is not a request, and a boolean
  -- beside it would only be a second thing to keep in step.
  add column if not exists client_action_ask text,
  add column if not exists client_action_due date,
  add column if not exists client_action_raised_at timestamptz,
  add column if not exists client_action_raised_by uuid references public.profiles (id) on delete set null,
  add column if not exists frozen_by text check (frozen_by in ('firm', 'client')),
  add column if not exists frozen_reason text,
  add column if not exists frozen_at timestamptz,
  add column if not exists frozen_by_user uuid references public.profiles (id) on delete set null,
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
  -- Who put the words there, which is what the timeline's "just what people wrote" reads:
  --   manual     a person typed it into Raptor
  --   swordfish  a person typed it into the old system -- still their writing
  --   system     Raptor composed it ("Trace done — 4 credit bureau searches")
  -- Recorded at the source rather than pattern-matched off the body, so a collector who writes
  -- "Trace done, nothing came back" in their own words is not mistaken for the machine.
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

  /*
   * WHAT THIS ESCALATION IS.
   *
   * The table was built for one thing: a debtor saying something is wrong. The firm then
   * described two more, and both are escalations in exactly the same sense — this account needs
   * somebody else's attention, with an owner, a chase date and an answer — but neither is a
   * dispute:
   *
   *   'help'       an agent asking a team leader what to do. Internal supervision.
   *   'litigation' the debtor will not pay and collections has nothing left to try. A
   *                recommendation to the liaison to instruct the attorneys.
   *
   * One table rather than three, because all three need the same queue and the same chasing, and
   * three would mean three places to look for "what is waiting on me".
   *
   * IT DECIDES WHO PAYS. A dispute raises Annexure B item 3, because the debtor's objection is
   * what caused someone else's time to be spent. The other two are the firm's own business —
   * supervising its staff, and deciding whether to sue — and a debtor is never billed for either.
   * raiseQuery() refuses to charge on anything but a dispute, and this column is what lets it
   * know. Everything raised before the column existed reads as a dispute, which is what it was.
   */
  kind text not null default 'dispute' check (kind in ('dispute', 'help', 'litigation')),

  -- A classification says why the DEBTOR is objecting, so it means nothing on the other two.
  category text,
  constraint account_queries_category_only_on_dispute check (kind = 'dispute' or category is null),
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

create index if not exists account_queries_kind_idx
  on public.account_queries (kind, status) where status <> 'closed';
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

-- One row per call Raptor placed, so BuzzBox's webhook can find its way back to an account.
--
-- BuzzBox does not echo our `reference` in its call events, and its own call id (externalId) is
-- only knowable AFTER the call is placed. So the dial writes a row here first, and the webhook
-- matches on the two things both sides do know: which extension rang, and which number it rang.
create table if not exists public.account_calls (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.debtor_accounts (id) on delete cascade,
  placed_by uuid references public.profiles (id) on delete set null,
  -- Free text as well as the reference, like every other author column on this account: the
  -- person covering for someone else is who actually made the call.
  placed_by_name text,
  extension text,
  -- Exactly as Raptor dialled it.
  number text not null,
  -- The last nine digits, maintained by Postgres so it can never drift from `number`.
  --
  -- We dial E.164 without the plus (27835550344); BuzzBox reports the local form (0835550344).
  -- Neither string equals the other, so matching happens on the subscriber digits they share.
  number_tail text generated always as (right(regexp_replace(number, '[^0-9]', '', 'g'), 9)) stored,
  placed_at timestamptz not null default now(),

  -- What BuzzBox told us afterwards. Null until it does, and null forever for a call placed
  -- through the tel: fallback, where there is no PABX to report anything.
  external_id text,
  answered_at timestamptz,
  ended_at timestamptz,
  hangup_cause text,

  -- The claim stamp for the consultation fee.
  --
  -- Both legs of a call report being answered, and a provider that gets no 200 will retry. This
  -- column is what makes the fee happen exactly once: the webhook claims it with a conditional
  -- update that only succeeds when it is still null, and charges only if the claim succeeded.
  consultation_charged_at timestamptz
);

-- Once a call is identified, later events find it directly.
create unique index if not exists account_calls_external_idx
  on public.account_calls (external_id) where external_id is not null;
-- ...and before that, by who rang whom, most recent first.
create index if not exists account_calls_match_idx
  on public.account_calls (number_tail, placed_at desc);
create index if not exists account_calls_account_idx
  on public.account_calls (account_id, placed_at desc);

alter table public.account_calls enable row level security;

-- As wide as the account's own policies: collectors cover for each other, and a call anyone
-- placed is part of the account's history.
drop policy if exists "account_calls_select" on public.account_calls;
create policy "account_calls_select" on public.account_calls for select using (auth.uid() is not null);
drop policy if exists "account_calls_insert" on public.account_calls;
create policy "account_calls_insert" on public.account_calls for insert with check (auth.uid() is not null);
-- No update policy for signed-in users on purpose. What happened on a call is BuzzBox's account
-- of it, written by the webhook with the service key, and not something a browser may revise.

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
  check (role in ('Administrator', 'Sales Manager', 'Sales Representative', 'Liaison Manager', 'Liaison', 'Pre-legal Team Leader', 'Pre-legal Agent', 'Read Only'));

-- ---------- The collection commission, as charged ----------
-- "All Payments Incl Balances" replaced "All Payments per Client" as the payments export. It is
-- the only Swordfish report that carries the receipt fee actually charged on a payment, and the
-- only one with a stable key per payment.
--
-- The commission matters because the gazetted maximum and the charged maximum are not the same
-- number: Swordfish billed a maximum of R502 from December 2023 to March 2026 where Annexure B
-- item 9 says R509. Recomputing history from the gazette would show a balance no debtor was ever
-- billed, so the charged figure is stored and preferred where it exists.
alter table public.account_payments
  add column if not exists swordfish_payment_id text,
  add column if not exists collection_commission numeric;

-- Partial, so the many payments Raptor takes in itself — which have no Swordfish id — do not
-- collide with each other on null.
create unique index if not exists account_payments_swordfish_id_idx
  on public.account_payments (swordfish_payment_id)
  where swordfish_payment_id is not null;

-- ---------- SMS ----------
--
-- Every SMS the firm sends, and every reply that comes back.
--
-- Its own table rather than a note, because an SMS has a life after it is written: it is accepted,
-- then delivered or not, and a debtor may answer it. A timeline entry cannot change its mind.
create table if not exists public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  -- WHO THIS IS ADDRESSED TO, and with it who pays. Exactly one of the five is set.
  --
  -- account_id is a DEBTOR, and only a debtor's message raises Annexure B item 1(c) at R3,50 a
  -- segment, because that tariff recovers the cost of collecting from them. The other four are
  -- the firm's own side of the business: a lead owes the firm nothing, and a client is the party
  -- paying the firm. Nothing is charged for those.
  --
  -- Written as columns and constraints rather than as a rule in the application, because a rule
  -- somebody has to remember is a rule that gets forgotten the day a new page is added.
  account_id uuid references public.debtor_accounts (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete cascade,
  deal_id uuid references public.deals (id) on delete cascade,
  company_id uuid references public.companies (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete cascade,
  direction text not null default 'outbound' check (direction in ('outbound', 'inbound')),
  -- International format, digits only, as the network addresses it.
  msisdn text not null,
  body text not null,
  -- What the network will actually send, which is what Annexure B item 1(c) is charged per.
  segments integer not null default 1,
  encoding text,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'delivered', 'failed', 'received')),
  status_detail text,
  -- Ours, sent as `id` and echoed back on the delivery report. How a DLR finds its row.
  reference text unique,
  provider_id text,
  -- The provider's own words, verbatim. The API documentation is not reachable from the build
  -- environment, so the first real sends are what teach us the shape of a response.
  provider_raw text,
  fee_id uuid references public.account_fees (id) on delete set null,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),

  -- One record, not several. A message on both a lead and an account would be ambiguous about
  -- who pays for it, and ambiguity in a fee is the one thing this table exists to prevent.
  constraint sms_messages_one_target check (
    (account_id is not null)::int
      + (lead_id is not null)::int
      + (deal_id is not null)::int
      + (company_id is not null)::int
      + (contact_id is not null)::int = 1
  ),
  -- A fee can only hang off a debtor. This is the structural half of "fees for SMSs are never
  -- charged to clients, deals or leads": even the service key, which bypasses RLS entirely, cannot
  -- write a fee onto a message that is not addressed to an account.
  constraint sms_messages_fee_needs_account check (fee_id is null or account_id is not null)
);

create index if not exists sms_messages_account_idx on public.sms_messages (account_id, created_at desc);
create index if not exists sms_messages_lead_idx on public.sms_messages (lead_id, created_at desc) where lead_id is not null;
create index if not exists sms_messages_deal_idx on public.sms_messages (deal_id, created_at desc) where deal_id is not null;
create index if not exists sms_messages_company_idx on public.sms_messages (company_id, created_at desc) where company_id is not null;
create index if not exists sms_messages_contact_idx on public.sms_messages (contact_id, created_at desc) where contact_id is not null;
create index if not exists sms_messages_reference_idx on public.sms_messages (reference);
create index if not exists sms_messages_provider_idx on public.sms_messages (provider_id) where provider_id is not null;

alter table public.sms_messages enable row level security;

-- Readable by anyone signed in: what was already said to a debtor is part of the account.
drop policy if exists sms_messages_read on public.sms_messages;
create policy sms_messages_read on public.sms_messages for select to authenticated using (true);
-- Writes are server-side only. Nothing in the browser holds the provider token.

-- ---------- Email with the debtor ----------
--
-- Correspondence with a debtor, in both directions, on the account it belongs to.
--
-- Deliberately its own table rather than `activities`. That table is the CRM's: its rows hang off
-- contacts, leads, deals and companies, which is the sales side of the business. A debtor is none
-- of those — their history is account_notes and their money is Annexure B — so an email to one
-- belongs here, with the account, where the statement and the timeline can both see it.
--
-- The body is stored rather than pointed at. The mailbox is the archive for attachments (see
-- fetchAttachment in api/_lib/emailSync.ts, and the reasoning there about not warehousing files),
-- but the WORDS of a demand and the words of the reply to it are the record of what was said, and
-- a record that disappears when somebody's mailbox is closed is not a record.
create table if not exists public.account_emails (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.debtor_accounts (id) on delete cascade,
  -- 'out' we sent it, 'in' the debtor did.
  direction text not null check (direction in ('out', 'in')),
  -- The debtor's address, whichever end of the exchange it was on. One column rather than
  -- from/to because this is the question anyone actually asks of the row: who, on their side.
  debtor_address text not null,
  -- The mailbox on our side — the agent's own connected address. Recorded because it decides
  -- where a reply will land, which matters when an agent leaves.
  our_address text,
  subject text,
  body text,
  -- RFC 5322 Message-ID. The only durable handle a reply carries back to what it answers, and
  -- therefore the whole reason a debtor's reply can find its own account. Unique: one message
  -- is one row, however many mailboxes sync it or however often a sync reruns.
  message_id text,
  in_reply_to text,
  -- Names only. The files stay in the mailbox — see fetchAttachment.
  attachment_names text[] not null default '{}',
  -- Breadcrumb back to the message for on-demand attachment fetching.
  email_folder text,
  email_uid bigint,
  -- Null on an inbound message: the debtor sent that one.
  sent_by uuid references public.profiles (id) on delete set null,
  -- Whose inbox an INBOUND message landed in, and whether they have looked at it.
  --
  -- These are what let the Messages menu count a debtor's reply, exactly as it already counts
  -- CRM mail. Without them a reply is discoverable only by opening the account it belongs to,
  -- which across 100 000 accounts means it is not discoverable at all.
  --
  -- received_by is the mailbox owner, deliberately NOT the account's assigned collector: it is
  -- literally whose inbox the message is in, and therefore who is already expecting it.
  received_by uuid references public.profiles (id) on delete set null,
  -- Null means unread. A timestamp rather than a boolean, so "when did someone first see this"
  -- is answerable later without another column.
  read_at timestamptz,
  -- Free text as well as the reference, like every other author column on an account.
  sent_by_name text,
  -- What this message earned, excluding VAT. Item 1(a), R25, on everything we send — the firm's
  -- instruction: "25 rand for every email sent or responded to". Null on an inbound message,
  -- which raises nothing on its own: the reply to it is what earns the fee. Zero where a cap
  -- left no room, which is a different thing from null and the Emails list says so.
  --
  -- The amount rather than a reference to the fee row, so the list can show what a message cost
  -- without a join, and without the charge engine having to hand back an id it does not
  -- currently produce. account_fees remains the ledger; this is a copy for display.
  charged_excl_vat numeric(12,2),
  -- When the message was sent or received, which is not when we wrote the row: a sync can pick
  -- up a reply hours later, and the timeline has to show when the debtor actually wrote.
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Deliberately NOT a partial index ("where message_id is not null"), which is the obvious way to
-- write this and is wrong. A partial unique index cannot be inferred by "on conflict
-- (message_id)", which is exactly what PostgREST emits for an upsert: Postgres raises 42P10 and
-- the inbound sync throws on the first reply it tries to file. Nothing is lost by dropping the
-- predicate — nulls are distinct in a unique index, so any number of messages may have no id.
-- This also serves the thread lookup: In-Reply-To/References name a Message-ID we sent.
create unique index if not exists account_emails_message_idx
  on public.account_emails (message_id);
create index if not exists account_emails_account_idx
  on public.account_emails (account_id, occurred_at desc);
-- The Messages menu's query: my unread inbound mail, newest first.
create index if not exists account_emails_unread_idx
  on public.account_emails (received_by, occurred_at desc)
  where direction = 'in' and read_at is null;

alter table public.account_emails enable row level security;

-- As wide as the account's own policies: collectors cover for each other, and correspondence
-- anyone sent is part of the account's history.
drop policy if exists "account_emails_select" on public.account_emails;
create policy "account_emails_select" on public.account_emails for select using (auth.uid() is not null);
drop policy if exists "account_emails_insert" on public.account_emails;
create policy "account_emails_insert" on public.account_emails for insert with check (auth.uid() is not null);
-- Marking your own mail read is the ONE thing a browser may change here. Everything else about a
-- message -- who sent it, what it said, what it cost -- is a record. Scoped to the recipient so
-- one agent cannot clear another's unread count. Inbound rows are written by the sync with the
-- service key, which these policies do not constrain.
drop policy if exists "account_emails_mark_read" on public.account_emails;
create policy "account_emails_mark_read" on public.account_emails for update
  using (received_by = auth.uid()) with check (received_by = auth.uid());

-- ---------- An agent's mailbox, inside Raptor ----------
--
-- Every message the sync reads goes here, whether or not it could be matched to anything. That
-- is the point: an email from a debtor we cannot place used to be skipped and lost, and at
-- 50 agents x 50-100 messages a day nobody was ever going to find it by browsing accounts.
--
-- METADATA ONLY. No bodies. A short snippet is enough to recognise a message; the full text
-- stays in the mailbox and is fetched on demand, the same principle already used for
-- attachments (see fetchAttachment in api/_lib/emailSync.ts). Storing bodies instead would be
-- ~4 GB a year and climbing.
--
-- NOTHING IS PRUNED. A 30-day sweep of unmatched mail was removed at the firm's instruction: an
-- email is either matched to a record or it is junk to be blocked, and deleting one on a timer
-- only means it disappears before anyone gets to it. Measured cost of keeping everything: a row
-- averages 459 bytes and ~1.8x that again in indexes, so about 3 MB a day and 1.1 GB a year at
-- 3 750 messages a day, against ~89 MB steady state under the old sweep. That is Supabase's
-- 500 MB free tier in five to six months, and years on Pro's 8 GB.
create table if not exists public.user_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,

  -- Where to find the message again, for fetching its body or an attachment on demand.
  folder text not null,
  uid bigint not null,
  -- The sync always sets this, falling back to a synthetic "user:folder:uid" when a message
  -- carries no Message-ID of its own.
  message_id text,

  from_address text not null,
  from_name text,
  subject text,
  -- The first couple of hundred characters. Enough to tell a debtor's reply from a newsletter.
  snippet text,
  attachment_names text[] not null default '{}',
  -- Arrived in the Junk folder. Kept rather than dropped so a debtor's email that a mail server
  -- wrongly binned can still be rescued, but hidden by default in the UI.
  is_junk boolean not null default false,

  occurred_at timestamptz not null,
  read_at timestamptz,

  -- Where this message was filed, either by the sync matching it or by an agent linking it.
  -- Once any of these is set, the message is part of that record and may no longer be deleted.
  --
  -- A debtor account and a CRM record are genuinely different destinations, not two flavours of
  -- one: filing to an account raises an Annexure B fee against a debtor, filing to a lead or a
  -- client raises nothing, because the tariff is for collecting a debt and there is no debt.
  -- Same column shape the activities table already uses, so the two agree about what "on a lead"
  -- means.
  linked_account_id uuid references public.debtor_accounts (id) on delete set null,
  linked_lead_id uuid references public.leads (id) on delete set null,
  linked_deal_id uuid references public.deals (id) on delete set null,
  linked_company_id uuid references public.companies (id) on delete set null,
  linked_contact_id uuid references public.contacts (id) on delete set null,
  linked_at timestamptz,
  linked_by uuid references public.profiles (id) on delete set null,

  /*
   * Where a mis-filed message came from, and why an administrator moved it.
   *
   * ON THE MAILBOX ROW, deliberately, and NOT as a note on the debtor's account. account_notes
   * has no visibility flag, so anything written there can end up in front of the debtor on a
   * statement or in an answer to a query — and "filed here in error" is precisely the sentence
   * that invites the query it was meant to pre-empt. The firm's instruction, and it is right.
   * user_emails is internal: RLS scopes it to the mailbox owner and nothing debtor-facing reads
   * it.
   *
   * The trail is still whole: linked_by and linked_at say who moved it and when, these two say
   * what it came off and why.
   */
  moved_from_account_id uuid references public.debtor_accounts (id) on delete set null,
  moved_reason text,

  /*
   * "Is this message filed anywhere?" -- asked by the mailbox's tabs, the delete guard, the
   * retention prune and the sidebar badge.
   *
   * Generated rather than written, so those four can never disagree. The alternative is the same
   * five-way OR copied into a dozen queries, and the first one that gets missed when a sixth
   * link is added is a bug nobody sees: mail that is filed but still counted as waiting, which
   * is how a sales reply ends up on a debtor's account with an R13 against it.
   */
  is_filed boolean generated always as (
    linked_account_id is not null
    or linked_lead_id is not null
    or linked_deal_id is not null
    or linked_company_id is not null
    or linked_contact_id is not null
  ) stored,

  /*
   * Mail that belongs on nobody's file.
   *
   * The firm's manager asked the question that exposed the gap: a telephone provider, an
   * accountant, a supplier writes in. It is real work mail, so it is not junk; you need their
   * mail, so the sender cannot be blocked; and it belongs to no debtor, lead or client, so it
   * can never be matched. It sat in Needs matching for ever -- and a work queue with permanent
   * residents stops being a work queue, because within a month nobody reads the number on it.
   *
   * So: a third answer to "what is this?", beside matched and junk. Somebody has looked at it
   * and decided it needs no record. It stays in All, stays searchable, stays in the real
   * mailbox, and stops counting as work.
   */
  no_record_at timestamptz,
  no_record_by uuid references public.profiles (id) on delete set null,

  /*
   * Everything a person has dealt with, however they dealt with it.
   *
   * Generated for the same reason is_filed is: the alternative is "is_filed = false and
   * no_record_at is null" copied into every query that asks what is still waiting, and the first
   * one that gets missed is mail that has been handled but still counted as work.
   *
   * Deliberately NOT folded into is_filed. Filed means "on a record", and the Matched tab means
   * exactly that; a supplier's invoice is on no record at all and would be a lie in that list.
   */
  /*
   * SENT MAIL IS A DIFFERENT ANIMAL, and the columns say so rather than the code having to
   * remember. The sync files an incoming message onto a debtor's account and raises Annexure B
   * item 6 for RECEIVING it; a message we sent is item 1(a), already charged when it went out.
   * Putting sent mail through the same path would bill the debtor twice for one email, so it
   * gets a mailbox row and nothing else — see api/_lib/emailSync.ts.
   *
   * to_address because "who is this from" is the wrong question about a sent message: From is
   * always us, and the useful address is the recipient.
   */
  is_sent boolean not null default false,
  to_address text,
  to_name text,

  is_settled boolean generated always as (
    linked_account_id is not null
    or linked_lead_id is not null
    or linked_deal_id is not null
    or linked_company_id is not null
    or linked_contact_id is not null
    or no_record_at is not null
  ) stored,

  created_at timestamptz not null default now()
);

-- A message cannot be both on a record and on nobody's file.
--
-- Without this the two states can disagree, and the disagreement is visible: the row would wear
-- the green "Matched" chip and also sit in the No record needed tab, and nobody reading the
-- screen could say which was true.
--
-- Not a trap for the useful case. Matching CLEARS no_record_at -- matching is the strongest
-- statement anybody can make about a message, so it overrides "needs no record" exactly as it
-- already overrides junk. A supplier's email that turns out to be a debtor's simply matches.
-- See linkMailToAccount and linkMailToRecord.
alter table public.user_emails
  drop constraint if exists user_emails_no_record_unmatched;
alter table public.user_emails
  add constraint user_emails_no_record_unmatched check (
    no_record_at is null
    or (
      linked_account_id is null
      and linked_lead_id is null
      and linked_deal_id is null
      and linked_company_id is null
      and linked_contact_id is null
    )
  );

-- One message per mailbox, never twice. Per USER rather than globally: a message addressed to
-- two agents legitimately appears in both their mailboxes.
--
-- Not partial, deliberately. A partial unique index cannot be inferred by "on conflict", which
-- is what PostgREST emits for an upsert -- Postgres raises 42P10 and the sync dies on the first
-- message it re-reads. That exact mistake was made and fixed on account_emails today.
create unique index if not exists user_emails_message_idx
  on public.user_emails (user_id, message_id);

-- The mailbox list.
create index if not exists user_emails_inbox_idx
  on public.user_emails (user_id, occurred_at desc);
-- Unread count, and the "needs filing" view.
-- The Sent tab, newest first. Partial, so it indexes sent mail rather than the whole mailbox.
create index if not exists user_emails_sent_idx
  on public.user_emails (user_id, occurred_at desc)
  where is_sent = true;
create index if not exists user_emails_unfiled_idx
  on public.user_emails (user_id, occurred_at desc)
  where is_filed = false and is_junk = false;
-- What is still waiting. is_settled, not is_filed: mail marked as needing no record has been
-- dealt with and must not sit in the queue.
create index if not exists user_emails_unsettled_idx
  on public.user_emails (user_id, occurred_at desc)
  where is_settled = false and is_junk = false;
-- The prune index is gone with the prune. Nothing sweeps this table by age any more.

alter table public.user_emails enable row level security;

-- Your mail is yours. Not scoped by role: an administrator has no more business reading a
-- colleague's inbox than a collector does, and the monitoring the firm wants is answerable from
-- counts rather than contents. The sync writes with the service key, which RLS does not
-- constrain, so there is no insert policy for browsers at all.
drop policy if exists "user_emails_own_select" on public.user_emails;
create policy "user_emails_own_select" on public.user_emails for select
  using (user_id = auth.uid());
-- Marking read, and linking to an account.
drop policy if exists "user_emails_own_update" on public.user_emails;
create policy "user_emails_own_update" on public.user_emails for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Throwing away spam. Only ever your own, and only while it is unlinked -- once a message is on
-- an account it is part of that account's history and the fee raised against it. Both halves
-- verified against staging: another agent's delete and a delete of linked mail each affect
-- zero rows.
drop policy if exists "user_emails_own_delete" on public.user_emails;
create policy "user_emails_own_delete" on public.user_emails for delete
  using (user_id = auth.uid() and linked_account_id is null);

-- ---------- Senders an agent never wants to see again ----------
--
-- The firm's idea, and the best storage lever there is: repeat senders — newsletters, agencies,
-- the same scam every week — are most of the 3 750 messages a day. A blocked sender is skipped
-- at sync time and never becomes a row at all. With nothing pruned on a timer, this is now the
-- ONLY thing keeping the table's growth down, which makes it more important than it was.
--
-- Per agent, not firm-wide. It matches the rest of the mailbox (your mail is yours) and, more
-- importantly, it means one person cannot silence a sender for everyone else — blocking a
-- client's domain by accident would be invisible and expensive. The storage saving is the same
-- either way, because each agent's mailbox is its own set of rows.
--
-- Two guards live in the application rather than here, because both need lookups a constraint
-- cannot do: an address on a debtor's account_contacts row can never be blocked (their mail
-- would simply stop, and nobody would see it go missing), and a whole-domain block is refused
-- for shared providers like gmail.com, where a debtor writing from one is the normal case.
-- See blockSender in src/lib/userMail.ts.
create table if not exists public.mail_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,

  -- Lowercased. Either a full address ('winner@prize-claim.example') or a bare domain
  -- ('prize-claim.example'), which kind says which.
  pattern text not null,
  kind text not null check (kind in ('address', 'domain')),

  -- What it was called when it was blocked, so the list reads as something a person recognises
  -- rather than a column of addresses.
  label text,
  created_at timestamptz not null default now()
);

-- One block per sender per agent. Not partial: "on conflict" inference needs it whole.
create unique index if not exists mail_blocks_pattern_idx
  on public.mail_blocks (user_id, pattern);

alter table public.mail_blocks enable row level security;

-- Your list, yours to change. Nobody else reads or writes it, including an administrator.
drop policy if exists "mail_blocks_own" on public.mail_blocks;
create policy "mail_blocks_own" on public.mail_blocks for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Senders whose mail never needs matching ----------
--
-- The point of marking one message as needing no record is lost if you have to repeat it on the
-- same supplier every week. A rule settles their mail as it arrives, so it lands in All already
-- dealt with and never joins the queue.
--
-- Its own table rather than a third `kind` on mail_blocks, because the two mean opposite things:
-- a block stops the mail existing in Raptor at all, this one lets it in and stops it asking for
-- attention. Sharing a table would have the Blocked tab listing senders nobody blocked.
--
-- Per agent, like the blocklist, and for the same reason: one person's rule must not quietly
-- empty a colleague's work queue. Easy to widen later if the firm wants shared rules; impossible
-- to un-widen once somebody's mail has gone missing because of somebody else's rule.
create table if not exists public.mail_sender_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,

  -- Lowercased. A full address ('accounts@telkom.co.za') or a bare domain ('telkom.co.za').
  pattern text not null,
  kind text not null check (kind in ('address', 'domain')),

  -- Room to grow. Today there is one rule; 'always_junk' is the obvious next one, and adding it
  -- should not need a second table.
  action text not null default 'no_record' check (action in ('no_record')),

  -- What they were called when the rule was made, so the list reads as names not addresses.
  label text,
  created_at timestamptz not null default now()
);

-- One rule per sender per agent, and whole rather than partial so "on conflict" can infer it.
create unique index if not exists mail_sender_rules_pattern_idx
  on public.mail_sender_rules (user_id, pattern);

alter table public.mail_sender_rules enable row level security;

-- Your rules, yours to change. Nobody else reads or writes them, including an administrator.
drop policy if exists "mail_sender_rules_own" on public.mail_sender_rules;
create policy "mail_sender_rules_own" on public.mail_sender_rules for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Re-filing a message is an administrator action
-- ---------------------------------------------------------------------------
-- Moving a message that is ALREADY on a record moves a debtor's correspondence between accounts
-- and raises a second item 6 fee on the destination. That is a money action, so a check in the
-- browser is not a boundary.
--
-- A trigger rather than an RLS policy, because the rule is about a TRANSITION rather than about
-- a row: an agent may still file unfiled mail (null -> account), still mark it read, still move
-- it to junk. What they may not do is re-point a message that is already filed. RLS sees only
-- the new row; a before-update trigger sees both.
--
-- Reverts silently rather than raising, exactly as protect_profile_privileged_fields does, so a
-- crafted request keeps the prior value and changes nothing.
create or replace function public.protect_filed_mail_target()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() <> 'Administrator' then
    -- Only ever re-assert a link that was ALREADY set. Filing unfiled mail stays open to
    -- everyone, which is the everyday action.
    if old.linked_account_id is not null then new.linked_account_id := old.linked_account_id; end if;
    if old.linked_lead_id is not null then new.linked_lead_id := old.linked_lead_id; end if;
    if old.linked_deal_id is not null then new.linked_deal_id := old.linked_deal_id; end if;
    if old.linked_company_id is not null then new.linked_company_id := old.linked_company_id; end if;
    if old.linked_contact_id is not null then new.linked_contact_id := old.linked_contact_id; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_filed_mail_target on public.user_emails;
create trigger protect_filed_mail_target
  before update on public.user_emails
  for each row execute function public.protect_filed_mail_target();


-- ---------------------------------------------------------------------------
-- nav_counts: the three numbers on the sidebar
-- ---------------------------------------------------------------------------
-- One round trip for all three. A sidebar that fired one query per badge would run four
-- requests on every page change, for numbers nobody asked for.
--
-- Security invoker, and every clause is scoped by auth.uid(): the caller can only ever be
-- counting their own rows, so this adds no read the caller did not already have through RLS.
--
-- Each count is something ONE PERSON CAN CLEAR TODAY. That rule is the whole design. A count
-- of all open disputes, or of every task a person owns, sits at the same number for months,
-- and a badge that never moves teaches people to stop reading the other two.
create or replace function public.nav_counts()
returns table (mail integer, tasks integer, disputes integer)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select
    -- UNREAD mail, whether or not it has been matched. Junk excluded: it is not work.
    --
    -- This used to count only mail that still needed matching, on the theory that a matched
    -- message is already dealt with. In practice almost everything matches itself on arrival --
    -- every message in the book did -- so the badge sat at nought for ever and a new email
    -- arrived with nothing on the sidebar to say so. Unread is the thing a person actually
    -- clears, by reading it, and it is what somebody means when they ask whether mail has come.
    (select count(*)::integer from public.user_emails
      where user_id = auth.uid()
        and is_junk = false
        and read_at is null),
    -- Mine, still open, and due by the end of today. Not "all my tasks", which would be a
    -- permanent number nobody could ever clear.
    (select count(*)::integer from public.tasks
      where owner_id = auth.uid()
        and status not in ('Completed', 'Cancelled')
        and due_date < date_trunc('day', now()) + interval '1 day'),
    -- Disputes waiting on ME, not every dispute the firm has open. The difference between a
    -- number somebody works and a number that sits at 20 forever.
    -- Lowercase 'closed'. account_queries.status is one of open / with_client / answered /
    -- closed, so "not closed" is the whole of the open book, not just stage 'open'.
    (select count(*)::integer from public.account_queries
      where owner_id = auth.uid()
        and status <> 'closed');
$$;

grant execute on function public.nav_counts() to authenticated;

-- ---------- The collections diary ----------
--
-- One row per appointment an agent has with an account.
--
-- debtor_accounts.diary_date already existed and could not do this job: it holds ONE date, so a
-- promise due on the 25th and a dispute chase on the 10th cannot both exist; it has no reason, no
-- owner and no state; and moving it erases the fact that anything was ever missed. That last one
-- matters most -- a diary is what a team leader uses to judge whether the work was done, and a
-- record that silently changes is a record that lies.
--
-- So: rows, never edited in place. An entry is worked (done) or moved (a new entry replaces it,
-- and the old one keeps its original date and says who moved it and why). "Missed" is not a state
-- anybody writes; it is simply an open entry whose date has passed. Deriving it means there is no
-- nightly job to forget to run, and therefore no night on which the diary quietly lies.
--
-- What this replaces was not a blank page. The Swordfish book arrived with 327 diarised accounts
-- of which 279 were already overdue, 102 by more than six months, and one agent carrying 44
-- accounts all diarised onto a single day -- which is what an unbounded diary with no day-load
-- and no audit trail produces after a few years.

-- How urgent a kind of work is. Lower is sooner.
--
-- Immutable and in SQL because the priority column is generated from it and the day list is
-- ordered by it in the database -- a six-figure book cannot be sorted in the browser. The same
-- ladder is mirrored in src/lib/diaryPriority.ts for the labels, and
-- scripts/qa/check-diary-priority.mjs reads both and fails if they drift apart.
--
-- The ladder is the firm's: a debtor who promised and broke it comes before everything, because
-- they engaged and have shown they can pay. A fresh handover comes next -- debt collects best
-- when it is new. A routine chase comes last, however long it has been waiting. Without a ladder
-- a day that opens oldest-first buries a promise that broke this morning under the backlog.
create or replace function public.diary_priority(kind text) returns smallint
  language sql immutable strict as $$
  select case kind
    -- Promised and did not pay: a figure and a date agreed on a call, or an instalment on a
    -- running arrangement. ONE RUNG, at the firm's instruction -- either way a payment they
    -- committed to did not come. See the migration
    -- diary_merge_payment_default_into_promise_broken.
    when 'promise_broken'  then 10
    when 'new_account'     then 20   -- freshly handed over, never worked
    when 'promise_due'     then 30   -- check the money arrived
    when 'callback'        then 40   -- the debtor asked to be rung on this day
    when 'dispute_chase'   then 50   -- the seven-working-day clock is running
    -- Rang out, dead number, nobody home. The commonest real outcome of a day's calling.
    -- Below a dispute, which has a clock running; above a trace, which waits on somebody else.
    -- This one is still yours to act on.
    when 'no_contact'      then 55
    when 'trace'           then 60   -- waiting on a tracing result
    else 70                          -- 'review': the ordinary diarised chase
  end::smallint
$$;

create table if not exists public.diary_entries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.debtor_accounts (id) on delete cascade,
  -- Whose diary. Null is a real state: work that belongs to nobody yet, which a team leader
  -- has to hand out. 355 accounts arrived from Swordfish in exactly that condition.
  owner_id uuid references public.profiles (id) on delete set null,
  due_on date not null,

  kind text not null default 'review' check (kind in (
    'promise_broken', 'new_account', 'promise_due',
    'callback', 'dispute_chase', 'no_contact', 'trace', 'review'
  )),
  -- COMPUTED ON WRITE AND NEVER AGAIN. A stored generated column is not recomputed when the
  -- function behind it changes, so an edit to diary_priority() that MOVES a number owes a
  -- forced rewrite of every row on top of itself -- otherwise the table quietly disagrees with
  -- the function and the day is ordered by a ladder nobody can read any more.
  --
  -- And a rewrite has to reckon with protect_closed_diary_entries below, which reverts edits to
  -- entries already done or moved: without disabling it for the rewrite, closed rows keep their
  -- old value and the constraint fails. That is how the merge migration failed on its first run.
  priority smallint generated always as (public.diary_priority(kind)) stored,
  -- The agent's own words about why it is coming back. Shown in the day list, so the next
  -- person to open it does not have to read the whole timeline to know what was promised.
  reason text,

  state text not null default 'open' check (state in ('open', 'done', 'moved', 'cancelled')),

  -- Where it came from, so an inherited Swordfish date is never mistaken for something an
  -- agent in this firm chose.
  source text not null default 'manual'
    check (source in ('manual', 'swordfish', 'promise', 'dispute', 'handover', 'system')),
  promise_id uuid references public.promises_to_pay (id) on delete cascade,
  query_id uuid references public.account_queries (id) on delete cascade,

  -- Worked.
  done_at timestamptz,
  done_by uuid references public.profiles (id) on delete set null,
  outcome text,

  -- Moved. The replacement is a NEW row; this one keeps the date it was always due.
  moved_to uuid references public.diary_entries (id) on delete set null,
  moved_at timestamptz,
  moved_by uuid references public.profiles (id) on delete set null,
  moved_reason text,

  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  created_by_name text,

  -- A closed entry has to say when it closed, and an open one must not pretend it did.
  constraint diary_entries_done_stamped check ((state = 'done') = (done_at is not null)),
  constraint diary_entries_moved_stamped check ((state = 'moved') = (moved_at is not null))
);

-- The agent's own day: "my open work, most urgent first, oldest first within that".
create index if not exists diary_entries_owner_day_idx
  on public.diary_entries (owner_id, due_on, priority) where state = 'open';
-- Everything still open across the firm, for the team leader's view and the unassigned pile.
create index if not exists diary_entries_open_idx
  on public.diary_entries (due_on, priority) where state = 'open';
create index if not exists diary_entries_account_idx
  on public.diary_entries (account_id, due_on desc);
-- One open entry per promise and per dispute, so a sweep that runs twice cannot double-book a day.
create unique index if not exists diary_entries_one_open_per_promise
  on public.diary_entries (promise_id) where promise_id is not null and state = 'open';
create unique index if not exists diary_entries_one_open_per_query
  on public.diary_entries (query_id) where query_id is not null and state = 'open';

alter table public.diary_entries enable row level security;

-- Readable by anyone signed in. A team leader has to see the team's load to balance it.
drop policy if exists diary_entries_read on public.diary_entries;
create policy diary_entries_read on public.diary_entries
  for select to authenticated using (true);

-- Anyone signed in may diarise an account -- booking work for a colleague is ordinary
-- collections practice (a clerk redistributing an absent agent's day, a leader handing out the
-- unassigned pile). What nobody may do is rewrite a closed entry; that is the trigger below.
drop policy if exists diary_entries_write on public.diary_entries;
create policy diary_entries_write on public.diary_entries
  for insert to authenticated with check (true);
drop policy if exists diary_entries_update on public.diary_entries;
create policy diary_entries_update on public.diary_entries
  for update to authenticated using (true) with check (true);

-- A worked or moved entry is finished.
--
-- Re-opening one, or shifting the date it was always due, would rewrite the record a team leader
-- reads to see whether the day was worked. Reverts silently rather than raising, exactly as
-- protect_filed_mail_target does, so a crafted request keeps the prior values and changes
-- nothing. This is the same instinct as the firm's rule about remittances: once something is
-- booked, it is stamped.
create or replace function public.protect_closed_diary_entries() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if old.state in ('done', 'moved') then
    -- Everything except the audit trail of the closing itself.
    new.account_id := old.account_id;
    new.owner_id   := old.owner_id;
    new.due_on     := old.due_on;
    new.kind       := old.kind;
    new.state      := old.state;
    new.source     := old.source;
    new.done_at    := old.done_at;
    new.done_by    := old.done_by;
    new.moved_at   := old.moved_at;
    new.moved_by   := old.moved_by;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_closed_diary_entries on public.diary_entries;
create trigger protect_closed_diary_entries
  before update on public.diary_entries
  for each row execute function public.protect_closed_diary_entries();

-- debtor_accounts.diary_date is a mirror of the soonest open entry. See the column's own note.
create or replace function public.sync_account_diary_date() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  target uuid := coalesce(new.account_id, old.account_id);
begin
  update public.debtor_accounts
     set diary_date = (
       select min(due_on) from public.diary_entries
        where account_id = target and state = 'open'
     )
   where id = target;
  return null;
end;
$$;

drop trigger if exists sync_account_diary_date on public.diary_entries;
create trigger sync_account_diary_date
  after insert or update or delete on public.diary_entries
  for each row execute function public.sync_account_diary_date();

-- ---------- Reminders: "call me back in an hour" ----------
--
-- NOT the diary, and a separate table on purpose. The diary works in DAYS: it is the queue of
-- accounts somebody sits down to work, ordered by a priority ladder, and an entry in it is the
-- unit a team leader counts. A reminder lives inside one shift — minutes and hours — and exists
-- only until the person does it. A 15:40 callback put in the diary would either pollute
-- tomorrow's count or disappear at midnight, and the debtor was promised neither.
create table if not exists public.account_reminders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.debtor_accounts (id) on delete cascade,
  -- Whose screen it pops on. Not nullable: an unowned reminder reminds nobody.
  owner_id uuid not null references public.profiles (id) on delete cascade,
  due_at timestamptz not null,
  body text not null,
  -- waiting   not yet done; pops when due and keeps popping until it is answered
  -- done      the person confirmed they did it
  -- cancelled called off before it came round
  state text not null default 'waiting' check (state in ('waiting', 'done', 'cancelled')),
  -- How many times it was pushed back. Kept because a reminder snoozed nine times is something
  -- a team leader should be able to see, and because it stops a snooze leaving no trace.
  snoozes smallint not null default 0,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null
);

-- The watcher's only query, running once every thirty seconds per signed-in agent: my waiting
-- reminders that are due. Partial, because nothing else is ever asked for.
create index if not exists account_reminders_due_idx
  on public.account_reminders (owner_id, due_at)
  where state = 'waiting';

create index if not exists account_reminders_account_idx
  on public.account_reminders (account_id, due_at desc);

alter table public.account_reminders enable row level security;
grant select, insert, update, delete on public.account_reminders to authenticated;

-- Read open, like the rest of the debtor side: a team leader has to see what an agent is sitting
-- on. Changing one is the owner's own business, or an administrator's.
drop policy if exists account_reminders_select on public.account_reminders;
create policy account_reminders_select on public.account_reminders
  for select to authenticated using (auth.uid() is not null);

drop policy if exists account_reminders_insert on public.account_reminders;
create policy account_reminders_insert on public.account_reminders
  for insert to authenticated with check (auth.uid() is not null);

drop policy if exists account_reminders_update on public.account_reminders;
create policy account_reminders_update on public.account_reminders
  for update to authenticated
  using (owner_id = auth.uid() or public.current_user_role() = 'Administrator')
  with check (owner_id = auth.uid() or public.current_user_role() = 'Administrator');


-- ---------------------------------------------------------------------------
-- THE TABLE THAT CANNOT BE BACKFILLED
-- ---------------------------------------------------------------------------
--
-- A monthly client report answers "what moved this period" -- how many accounts went from being
-- worked to an arrangement, how many fell out of one. An account carries only its CURRENT status
-- and nothing remembers the one before it, so that question is unanswerable without this table.
-- Every month it does not exist is a month of movement that can never be recovered, which is why
-- it was built before the report that needs it rather than alongside it.
create table if not exists public.account_status_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.debtor_accounts (id) on delete cascade,

  -- Null on the first event: the account did not come from anywhere, it arrived.
  from_status text,
  from_sub_status text,
  to_status text,
  to_sub_status text,

  changed_at timestamptz not null default now(),
  -- Null is a real value and means nobody: an import, a migration, a trigger. Telling "the
  -- system did this" from "Meloney did this" is most of the value of the column.
  changed_by uuid references public.profiles (id) on delete set null,
  -- The freeze reason where there is one. Best-effort: the trigger fills it when it can see one.
  note text
);

-- The report reads a period across the whole book; the account page reads one account newest
-- first. Two indexes because those are two different scans.
create index if not exists account_status_events_account_idx
  on public.account_status_events (account_id, changed_at desc);
create index if not exists account_status_events_period_idx
  on public.account_status_events (changed_at);

-- WRITTEN BY A TRIGGER, NEVER BY THE APP. If application code wrote these rows, every path that
-- forgot to would lose history silently -- an import, a bulk action, a fix applied in SQL at half
-- past eleven. The table's whole value is that it is complete, and the only way to be complete is
-- to be unavoidable.
--
-- SECURITY DEFINER because the table is RLS-protected with no insert policy: nobody writes a
-- status event by hand, administrators included.
create or replace function public.record_account_status_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.account_status_events
      (account_id, to_status, to_sub_status, changed_by, note)
    values (new.id, new.status, new.sub_status, auth.uid(), new.frozen_reason);
    return new;
  end if;

  -- `is distinct from` rather than <>, so a change to or from NULL counts. An account whose
  -- sub-status is cleared has moved, and <> would silently say it had not.
  if new.status is distinct from old.status
     or new.sub_status is distinct from old.sub_status then
    insert into public.account_status_events
      (account_id, from_status, from_sub_status, to_status, to_sub_status, changed_by, note)
    values (
      new.id, old.status, old.sub_status, new.status, new.sub_status, auth.uid(),
      -- The reason that applies to the state being ENTERED. On an unfreeze the account's own
      -- reason is already cleared, so the event carries the one being left behind instead.
      coalesce(new.frozen_reason, old.frozen_reason)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists record_account_status_event on public.debtor_accounts;
create trigger record_account_status_event
  after insert or update on public.debtor_accounts
  for each row execute function public.record_account_status_event();

alter table public.account_status_events enable row level security;

-- Readable by anyone signed in, exactly like the accounts themselves. NO insert, update or
-- delete policy, deliberately: the trigger is the only writer and history cannot be rewritten.
drop policy if exists account_status_events_select on public.account_status_events;
create policy account_status_events_select on public.account_status_events
  for select using (auth.uid() is not null);

-- ONE DIARY DATE PER ACCOUNT, at the firm's instruction: booking a new one takes the old one
-- away. It was never enforced, and three accounts on the imported book carried two open entries
-- each -- invisible from the account, because debtor_accounts.diary_date shows only the soonest,
-- while still sitting in somebody's day.
--
-- Partial, on OPEN entries only: an account accumulates done and moved entries for ever and those
-- are its history rather than its queue. PostgREST cannot infer a partial index for an upsert,
-- which is wanted here -- a second open entry must be refused loudly, so diarise() supersedes the
-- first instead of quietly double-booking. See src/lib/diary.ts.
create unique index if not exists diary_entries_one_open_per_account
  on public.diary_entries (account_id)
  where state = 'open';

-- ---------- What the book actually holds ----------
--
-- The account list's filter panel needs to offer the sub-statuses and buckets that exist, not the
-- ones that existed when the panel was written. The alternative -- a hardcoded list -- is wrong
-- the first time Swordfish sends a new value: the filter silently lacks the option, and an option
-- you cannot pick is a pile of accounts nobody can find.
--
-- security invoker, so a Liaison sees facets for the accounts their RLS lets them see rather than
-- the firm's whole vocabulary. Aggregated, so it returns a dozen rows whatever the book's size.
create or replace function public.book_facets(p_company uuid default null)
returns table (kind text, value text, accounts integer)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select 'sub_status'::text, sub_status, count(*)::integer
    from public.debtor_accounts
   where sub_status is not null and sub_status <> ''
     and (p_company is null or company_id = p_company)
   group by 1, 2
  union all
  select 'bucket'::text, bucket, count(*)::integer
    from public.debtor_accounts
   where bucket is not null and bucket <> ''
     and (p_company is null or company_id = p_company)
   group by 1, 2
  order by 1, 3 desc, 2;
$$;

grant execute on function public.book_facets(uuid) to authenticated;

-- The filters the account list adds, indexed. Each is a clause fetchAccounts sends to the
-- database rather than filtering in the browser, and a six-figure book sequentially scanned per
-- keystroke is a screen that stops being used.
create index if not exists debtor_accounts_sub_status_idx
  on public.debtor_accounts (company_id, sub_status);
create index if not exists debtor_accounts_bucket_idx
  on public.debtor_accounts (company_id, bucket);
-- Nulls included on purpose: "never worked" IS last_action_at is null, so an index that skipped
-- them would miss exactly the accounts the filter exists to find.
create index if not exists debtor_accounts_last_action_idx
  on public.debtor_accounts (last_action_at);

-- Does the billed rate disagree with the signed mandate?
--
-- A stored column rather than a comparison in the browser. PostgREST cannot compare two columns
-- to each other, so this filter used to run over the fifty rows already fetched -- which gave a
-- list of four accounts under a pager that still read "1-50 of 736", because the count came back
-- before the filter ran. A number that confident and that wrong is worse than no number.
--
-- Rounded to four decimals on both sides: the rates are numerics carried from two systems, and
-- 0.12 against 0.120000001 is not a disagreement anybody would act on.
--
-- Null-safe by omission: an account with no rate, or no mandate to compare against, is not in
-- drift. It is unpriced, which is a different problem with a different conversation attached.
alter table public.debtor_accounts
  add column if not exists commission_drift boolean
  generated always as (
    commission_rate is not null
    and commission_rate_expected is not null
    and round(commission_rate, 4) <> round(commission_rate_expected, 4)
  ) stored;

create index if not exists debtor_accounts_commission_drift_idx
  on public.debtor_accounts (company_id) where commission_drift;

-- The four headline figures, counted in the database.
--
-- These used to be computed in the browser, which meant downloading every row in the book on
-- every open of the account list to produce four numbers. At 736 accounts that is unremarkable;
-- at the six figures this table is built for it is several megabytes across the Atlantic before
-- the first account appears, and then thrown away.
--
-- security invoker, so the figures describe the accounts the caller may actually see. A summary
-- that counts rows its reader is not allowed to open would be a quiet disclosure.
create or replace function public.book_summary(p_company uuid default null)
returns table (accounts integer, capital numeric, clients integer, commission_drift integer)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select
    count(*)::integer,
    coalesce(sum(capital_handed_over), 0),
    count(distinct company_id)::integer,
    count(*) filter (where commission_drift)::integer
  from public.debtor_accounts
  where p_company is null or company_id = p_company;
$$;

grant execute on function public.book_summary(uuid) to authenticated;

-- How much work each view on the account list holds, in one round trip.
--
-- The views row is only worth having if it says how many. "No diary date" with no number beside
-- it is a link somebody clicks once and stops clicking; "No diary date 355" is a queue. But seven
-- separate head-counts on every page open is seven requests before the first account appears, so
-- they are counted together.
--
-- security invoker, so the numbers describe the accounts the caller may actually see.
create or replace function public.account_view_counts(
  p_user uuid default null,
  p_company uuid default null,
  p_quiet_days integer default 30
)
returns table (
  whole_book integer,
  my_desk integer,
  unallocated integer,
  adrift integer,
  broken_promises integer,
  promises_due integer,
  gone_quiet integer
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select
    count(*)::integer,
    count(*) filter (where p_user is not null and assigned_to = p_user)::integer,
    count(*) filter (where assigned_to is null)::integer,
    -- The firm's own hole, not the debtor's: live, and nobody booked to ring it.
    count(*) filter (where diary_date is null and status ilike 'Active%')::integer,
    /*
     * BUCKET, not sub-status, and deliberately. Swordfish files 40 accounts under 'Failed PTPs'
     * while only 3 carry sub-status 'Payment Default' -- 13 of them still say 'Promise To Pay',
     * which is a live promise that the old system had already flagged as broken. The bucket is
     * the more truthful of the two signals, so the view reads it.
     */
    count(*) filter (where bucket = 'Failed PTPs')::integer,
    count(*) filter (where sub_status = 'Promise To Pay')::integer,
    -- A null counts: an account never worked at all is the quietest in the book.
    count(*) filter (
      where last_action_at < (current_date - p_quiet_days) or last_action_at is null
    )::integer
  from public.debtor_accounts
  where p_company is null or company_id = p_company;
$$;

grant execute on function public.account_view_counts(uuid, uuid, integer) to authenticated;

-- ---------- What a collector is trusted with, and how much of it ----------
--
-- Three numbers, all null by default, because null means "the company standard" rather than a
-- figure somebody typed once and forgot. The same shape diary_capacity already uses: the firm's
-- default lives in code (src/lib/collectorGrade.ts), a team leader overrides it per person, and
-- nothing has to be set for the app to behave sensibly the day a person is invited.
alter table public.profiles
  -- Junior, Skilled, Senior, Elite. Null means "not a collector" -- a liaison or a sales rep has
  -- no grade, and giving them one by default would put accounts on a desk that does not work them.
  --
  -- SET BY A PERSON, never computed. The collector's dashboard can show that somebody's numbers
  -- look like a Skilled collector's; a team leader decides. One large settlement is not a
  -- promotion, and it is an employment matter besides.
  add column if not exists collector_grade text
    check (collector_grade in ('Junior', 'Skilled', 'Senior', 'Elite')),
  -- The most accounts this person should carry at once, counting only what is IN PLAY. 372 of the
  -- 736 accounts on staging are written off; a collector "carrying 500" where 372 are dead is
  -- carrying 128, and a ceiling that counted the corpses would refuse them work they have room for.
  add column if not exists book_ceiling integer check (book_ceiling is null or book_ceiling > 0),
  -- How many of the day's slots are held back for work handed TO this person.
  --
  -- The firm's rule: a clerk who can work 45 a day may only diarise 35 of them himself, leaving
  -- 10 for whatever a team leader sends. It constrains the agent's own booking only -- the
  -- distributor fills to the full capacity -- so neither side has to know about the other.
  add column if not exists diary_reserve integer
    check (diary_reserve is null or diary_reserve >= 0);

-- How much each collector is actually carrying, and what it is worth.
--
-- IN PLAY ONLY, which is the whole point. "How many accounts has Stefan got" has two answers that
-- differ by a factor of four once a book has run a few years, and the one that decides whether he
-- can take more work is the one excluding the written-off, the frozen and the closed.
create or replace function public.collector_book_load()
returns table (user_id uuid, in_play_accounts integer, in_play_value numeric, total_accounts integer)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select
    assigned_to,
    count(*) filter (where status ilike 'Active%')::integer,
    coalesce(sum(capital_outstanding) filter (where status ilike 'Active%'), 0),
    count(*)::integer
  from public.debtor_accounts
  where assigned_to is not null
  group by assigned_to;
$$;

grant execute on function public.collector_book_load() to authenticated;

-- What is already booked in each person's diary, day by day.
--
-- Open entries only: a day's load is what is still to be done on it, not what was done. Bounded
-- to a date range because the caller is planning a window, and an unbounded count would carry
-- years of history to answer a question about next week.
create or replace function public.diary_day_load(p_from date, p_to date)
returns table (owner_id uuid, due_on date, entries integer)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select owner_id, due_on, count(*)::integer
  from public.diary_entries
  where state = 'open' and due_on between p_from and p_to
  group by owner_id, due_on;
$$;

grant execute on function public.diary_day_load(date, date) to authenticated;

-- ---------- Who held an account, and from when ----------
--
-- THE FIRM'S RULE: a payment belongs to whoever held the account ON THE DATE THE MONEY CAME IN,
-- not to whoever holds it today. Without this table the only answer available is "whoever holds
-- it now", so an account moving desks on the 28th hands its whole month's collections to the new
-- person -- and if commission or a promotion ever keys off these figures, that is an argument
-- nobody can settle.
--
-- EVENT ROWS, NOT SPANS. There is no `to_at`: the holder at any moment is the latest row at or
-- before it. A span has two ends that can disagree, and a closing write that can fail and leave
-- the account held by two people at once. One row per change cannot.
--
-- user_id is nullable and null MEANS SOMETHING: unallocated. Taking an account off every desk is
-- a real act a team leader performs, and a gap in the history would read as "still theirs".
create table if not exists public.account_desk_history (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.debtor_accounts (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  effective_from timestamptz not null default now(),
  -- change   observed: the trigger saw assigned_to move
  -- backfill reconstructed when this table was created; a guess, and marked as one
  -- import   set by a data load
  source text not null default 'change' check (source in ('change', 'backfill', 'import')),
  changed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- The lookup this exists for: the latest row at or before a moment, for one account.
create index if not exists account_desk_history_lookup_idx
  on public.account_desk_history (account_id, effective_from desc);
create index if not exists account_desk_history_user_idx
  on public.account_desk_history (user_id, effective_from);

alter table public.account_desk_history enable row level security;

-- Readable by everyone signed in, and WRITABLE BY NOBODY. The trigger below is security definer
-- and is the only writer. A ledger that decides who earned what should not be editable from the
-- browser by the people it measures.
drop policy if exists "account_desk_history_select" on public.account_desk_history;
create policy "account_desk_history_select" on public.account_desk_history
  for select using (auth.uid() is not null);

create or replace function public.record_account_desk_change() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  -- `is distinct from` rather than <>, so a move to or from NULL (unallocated) is recorded. With
  -- <> those two transitions are silently dropped -- exactly the ones a team leader performs
  -- when somebody leaves.
  if tg_op = 'INSERT' or (new.assigned_to is distinct from old.assigned_to) then
    insert into public.account_desk_history (account_id, user_id, effective_from, source, changed_by)
    values (new.id, new.assigned_to, now(),
            case when tg_op = 'INSERT' then 'import' else 'change' end, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists account_desk_change on public.debtor_accounts;
create trigger account_desk_change
  after insert or update of assigned_to on public.debtor_accounts
  for each row execute function public.record_account_desk_change();

-- Backfill: every account on a desk today, dated from when the firm received it. A
-- RECONSTRUCTION, marked `backfill` so it is never mistaken for something observed. It asserts
-- the current holder has had the account since handover, which is not known to be true -- but the
-- alternative is that every payment before today belongs to nobody.
insert into public.account_desk_history (account_id, user_id, effective_from, source)
select id, assigned_to,
       coalesce(handover_date::timestamptz, created_at, now() - interval '5 years'),
       'backfill'
  from public.debtor_accounts
 where assigned_to is not null
   and not exists (select 1 from public.account_desk_history h where h.account_id = debtor_accounts.id);

-- ---------- How every collector is doing over a period ----------
--
-- One call, every figure, aggregated in the database. Pulling payments, calls, emails, notes and
-- promises into the browser to count them is several megabytes to produce a dozen numbers, on a
-- book built for six figures.
--
-- A PAYMENT BELONGS TO WHOEVER HELD THE ACCOUNT ON THE DATE THE MONEY CAME IN -- the firm's
-- rule, read out of account_desk_history payment by payment. It replaces "whoever holds it now",
-- under which an account moving desks on the 28th handed its whole month's collections to the
-- new person. Where commission or a promotion keys off these figures, that is the difference
-- between a number and an argument.
--
-- Work is credited differently, and deliberately: a call is an act by a person, so it belongs to
-- whoever made it wherever the account has since gone.
--
-- A PROMISE THAT HAS NOT COME DUE IS NEITHER KEPT NOR BROKEN. Three numbers rather than two, so
-- the kept rate can be kept / (kept + broken) -- resolved only. Dividing by promises made would
-- score an agent nought for a promise due next week and penalise whoever takes promises
-- furthest out.
create or replace function public.collector_performance(p_from timestamptz, p_to timestamptz)
returns table (
  user_id uuid,
  in_play_accounts integer,
  in_play_value numeric,
  collected numeric,
  payments integer,
  calls integer,
  calls_answered integer,
  emails_sent integer,
  sms_sent integer,
  notes_written integer,
  promises_made integer,
  promises_kept integer,
  promises_broken integer,
  accounts_touched integer
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with book as (
    select assigned_to as uid,
           count(*) filter (where status ilike 'Active%')::integer as in_play,
           coalesce(sum(capital_outstanding) filter (where status ilike 'Active%'), 0) as value
      from public.debtor_accounts
     where assigned_to is not null
     group by assigned_to
  ),
  -- Reversed payments are not collections. A debit order that bounced was never money, and
  -- leaving it in would make somebody's best month the one where a payment failed.
  paid as (
    select h.user_id as uid,
           coalesce(sum(p.amount), 0) as collected,
           count(*)::integer as payments
      from public.account_payments p
      -- The holder at the moment the money landed: the latest history row at or before it.
      -- Indexed on (account_id, effective_from desc), so this is a one-row lookup per payment.
      cross join lateral (
        select dh.user_id
          from public.account_desk_history dh
         where dh.account_id = p.account_id
           and dh.effective_from <= p.received_at
         order by dh.effective_from desc
         limit 1
      ) h
     -- Reversed payments are not collections. A debit order that bounced was never money.
     where p.reversed_at is null
       and p.received_at >= p_from and p.received_at < p_to
       -- A payment on an account that was on nobody's desk that day belongs to nobody. Silently
       -- giving it to the current holder is the very thing this change removes.
       and h.user_id is not null
     group by h.user_id
  ),
  rang as (
    select placed_by as uid,
           count(*)::integer as calls,
           count(*) filter (where answered_at is not null)::integer as answered
      from public.account_calls
     where placed_by is not null and placed_at >= p_from and placed_at < p_to
     group by placed_by
  ),
  mailed as (
    select sent_by as uid, count(*)::integer as emails
      from public.account_emails
     where sent_by is not null and direction = 'out'
       and occurred_at >= p_from and occurred_at < p_to
     group by sent_by
  ),
  texted as (
    select created_by as uid, count(*)::integer as sms
      from public.sms_messages
     where created_by is not null and account_id is not null and direction = 'outbound'
       and created_at >= p_from and created_at < p_to
     group by created_by
  ),
  -- A person's own words only. Raptor composes system notes on every trace and freeze, and
  -- counting those rewards whoever clicked the most buttons.
  wrote as (
    select created_by as uid, count(*)::integer as notes
      from public.account_notes
     where created_by is not null and source = 'manual'
       and created_at >= p_from and created_at < p_to
     group by created_by
  ),
  promised as (
    select created_by as uid,
           count(*)::integer as made,
           count(*) filter (where status = 'kept')::integer as kept,
           count(*) filter (where status = 'broken')::integer as broken
      from public.promises_to_pay
     where created_by is not null
       and created_at >= p_from and created_at < p_to
     group by created_by
  ),
  -- DISTINCT ACCOUNTS, not actions. 300 actions across 40 accounts and across 300 are very
  -- different months, and only one of them is a book being worked.
  touched as (
    select uid, count(distinct account_id)::integer as accounts
      from (
        select placed_by as uid, account_id from public.account_calls
         where placed_by is not null and placed_at >= p_from and placed_at < p_to
        union all
        select sent_by, account_id from public.account_emails
         where sent_by is not null and direction = 'out'
           and occurred_at >= p_from and occurred_at < p_to
        union all
        select created_by, account_id from public.account_notes
         where created_by is not null and source = 'manual'
           and created_at >= p_from and created_at < p_to
      ) t
     group by uid
  )
  select
    pr.id, coalesce(b.in_play, 0), coalesce(b.value, 0),
    coalesce(pd.collected, 0), coalesce(pd.payments, 0),
    coalesce(r.calls, 0), coalesce(r.answered, 0),
    coalesce(m.emails, 0), coalesce(tx.sms, 0), coalesce(w.notes, 0),
    coalesce(pm.made, 0), coalesce(pm.kept, 0), coalesce(pm.broken, 0),
    coalesce(tc.accounts, 0)
  from public.profiles pr
  left join book b on b.uid = pr.id
  left join paid pd on pd.uid = pr.id
  left join rang r on r.uid = pr.id
  left join mailed m on m.uid = pr.id
  left join texted tx on tx.uid = pr.id
  left join wrote w on w.uid = pr.id
  left join promised pm on pm.uid = pr.id
  left join touched tc on tc.uid = pr.id
  -- Somebody may have collected in the period and hold nothing today, so a row is owed to
  -- anyone with a grade, a book, OR money credited to them.
  where pr.collector_grade is not null or b.in_play > 0 or pd.payments > 0;
$$;

grant execute on function public.collector_performance(timestamptz, timestamptz) to authenticated;

-- ============================================================================================
-- An account is a PERSON or a COMPANY, and almost everything downstream turns on which.
--
-- A person is chased through their own numbers. A company is chased through its directors --
-- which is a different shape of work, a different trace, and a different set of people who can
-- be rung. The firm's two newest accounts are both companies and neither could say so.
--
-- Defaulted to 'individual' because that is what the whole imported book is.
-- ============================================================================================
alter table public.debtor_accounts
  add column if not exists debtor_kind text not null default 'individual'
    check (debtor_kind in ('individual', 'company'));

comment on column public.debtor_accounts.debtor_kind is
  'individual or company. Decides how debtor_id_number reads: an ID number, or a registration number.';

comment on column public.debtor_accounts.debtor_id_number is
  'The debtor''s ID number, or for a company its registration number. See debtor_kind.';

-- The people behind a company, off its bureau profile.
--
-- A SEPARATE TABLE, NOT account_contacts, and the distinction is the point. A director is not a
-- way of reaching the company: they are a person with their own ID number, traceable in their
-- own right, whose directorship can end. One real profile carries six directors of whom four
-- have resigned -- filed as contacts they would be four dead ends a collector cannot tell from
-- the two who still matter.
create table if not exists public.account_directors (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.debtor_accounts (id) on delete cascade,
  -- The key that makes a director traceable on their own: their consumer report is keyed on it.
  id_number text,
  full_name text not null,
  -- Active or Resigned, as the bureau reports it. Only Active ones are worth a collector's day.
  status text check (status in ('Active', 'Resigned')),
  appointed_on date,
  source text not null default 'xds',
  -- When this person's own consumer trace was last pulled, so nobody pays for it twice.
  traced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (account_id, id_number, full_name)
);

create index if not exists account_directors_account_idx
  on public.account_directors (account_id, status);

alter table public.account_directors enable row level security;

drop policy if exists account_directors_read on public.account_directors;
create policy account_directors_read on public.account_directors
  for select to authenticated using (true);

drop policy if exists account_directors_write on public.account_directors;
create policy account_directors_write on public.account_directors
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- The practitioner, and the judgments already against the debtor.
--
-- Both came out of one real handover: a company in final liquidation carrying two default
-- judgments on its bureau profile. Nothing in the book could hold either fact, so a collector
-- opening it would have rung a company that legally cannot pay them.
-- ---------------------------------------------------------------------------

-- WHO TO DEAL WITH WHEN IT IS NO LONGER THE DEBTOR.
--
-- Once a debtor is liquidated, sequestrated, under curatorship, deceased, in business rescue or
-- under debt review, the debt is still owed but the DEBTOR IS NO LONGER THE PERSON TO ASK. The
-- claim goes to an appointed practitioner, and ringing the debtor instead is at best wasted time
-- and at worst unlawful. The firm already tracks this in a sub-status ('Liquidation/Sequestration')
-- which says the state and not the name — so the claim sat in somebody's head or in a note.
--
-- Six kinds, not free text, because each one is a different office with a different claim
-- procedure and a collector has to be able to tell them apart at a glance.
alter table public.debtor_accounts
  add column if not exists practitioner_kind text
    check (practitioner_kind in
      ('liquidator', 'trustee', 'curator', 'executor', 'business_rescue', 'debt_counsellor'));

alter table public.debtor_accounts add column if not exists practitioner_name text;
alter table public.debtor_accounts add column if not exists practitioner_firm text;
-- Their reference for the estate, which every claim submission has to quote back.
alter table public.debtor_accounts add column if not exists practitioner_reference text;
alter table public.debtor_accounts add column if not exists practitioner_phone text;
alter table public.debtor_accounts add column if not exists practitioner_email text;
-- The date of appointment. Claims run on deadlines counted from it.
alter table public.debtor_accounts add column if not exists practitioner_appointed_on date;

comment on column public.debtor_accounts.practitioner_kind is
  'Who to deal with instead of the debtor: liquidator, trustee, curator, executor, business '
  'rescue practitioner or debt counsellor. Null means the debtor is still the person to ask.';

-- JUDGMENTS ALREADY GRANTED AGAINST THE DEBTOR, by somebody else.
--
-- These are NOT the firm's own legal action — an account of ours on Section 129 or at attorney
-- has its own trail. These are other creditors' judgments, read off a bureau profile, and they
-- are the single strongest signal in the data about whether this debt will ever be collected: a
-- debtor with a default judgment for VAT from SARS is not a debtor who is about to settle.
--
-- Stored as ROWS, not a count, because the individual facts are what will be read: who sued, for
-- what, how long ago. A count cannot tell a R2 000 retail account in 2019 from SARS last year.
create table if not exists public.account_judgments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.debtor_accounts (id) on delete cascade,
  case_number text not null,
  -- As the bureau words it: 'JUDGEMENT BY DEFAULT', 'CONSENT TO JUDGEMENT'. A defended judgment
  -- and a default judgment say different things about the debtor.
  case_type text,
  -- What the debt was: 'VAT', 'CREDIT AGREEMENT', 'GOODS SOLD AND DELIVERED'.
  case_reason text,
  -- Who took it. SARS carries weight a trade creditor does not.
  plaintiff text,
  filed_on date,
  amount numeric(14,2),
  source text not null default 'xds',
  recorded_at timestamptz not null default now(),
  -- A re-pulled profile must update the judgment, never add a second copy of it.
  unique (account_id, case_number)
);

-- Read newest-first per account, which is the only way this table is ever queried.
create index if not exists account_judgments_account_idx
  on public.account_judgments (account_id, filed_on desc);

alter table public.account_judgments enable row level security;

drop policy if exists account_judgments_read on public.account_judgments;
create policy account_judgments_read on public.account_judgments
  for select to authenticated using (true);

drop policy if exists account_judgments_write on public.account_judgments;
create policy account_judgments_write on public.account_judgments
  for all to authenticated using (true) with check (true);

-- A judgment against a DIRECTOR is not a judgment against the company.
--
-- A director's own consumer profile carries their personal judgments. Filed on the account with
-- the company's own, they would inflate the one signal the firm has said will drive its
-- likelihood of collection -- a company with a clean record would read as having two judgments
-- because somebody who signed for it does.
--
-- They are still worth keeping: a director who has been sued personally is a different
-- conversation, and on a suretyship it is the same debt. So they are stored, and stored against
-- the person.
--
-- Null means the company (or, on an individual account, the debtor). That is the common case and
-- the one that counts.
alter table public.account_judgments
  add column if not exists against_director_id uuid
    references public.account_directors (id) on delete cascade;

comment on column public.account_judgments.against_director_id is
  'Null = against the debtor on this account. Set = against that director personally, off their '
  'own consumer profile. Never counted as a judgment against the company.';

-- The unique key has to widen with it: the same case number can appear on the company's profile
-- and on a director's, and they are two different records of two different judgments.
--
-- A partial index cannot express this -- the key is "one row per case per subject", where the
-- subject is either a director or the account itself -- so the null is folded to a fixed uuid.
alter table public.account_judgments
  drop constraint if exists account_judgments_account_id_case_number_key;

create unique index if not exists account_judgments_unique_case
  on public.account_judgments (account_id, case_number, coalesce(against_director_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Who paid for the trace, beside when it was pulled.
alter table public.account_directors
  add column if not exists traced_by uuid references public.profiles (id);

-- The row as the bureau printed it, kept when its columns could not be split.
--
-- A consumer report prints judgments as a table whose cells wrap, so the case type, the reason and
-- the plaintiff arrive as one run of words. Where that run cannot be split with certainty, the
-- judgment used to be shown and then dropped -- and the PLAINTIFF went with it, which is the part
-- a collector most wants: who sued, and are they still owed.
--
-- So the row is kept, with the words it was printed in, and the columns stay null rather than
-- being guessed at. It is a handful of characters per judgment and it is the difference between
-- "there is a judgment we could not read" and nothing at all.
alter table public.account_judgments add column if not exists source_text text;

comment on column public.account_judgments.source_text is
  'The judgment row as the bureau printed it, kept when the columns could not be split with '
  'certainty. Never a substitute for plaintiff -- it is shown as unread, not as a value.';

-- The other companies a director sits on.
--
-- Off their own consumer profile, which lists every directorship they hold or held. It matters in
-- two directions: a director who ACTIVELY runs four other companies is somebody with assets to
-- discuss, and one whose other directorships have all been resigned is somebody stepping away
-- from things -- which is worth knowing before an afternoon is spent on them.
--
-- The firm's instruction: mention the active ones, and let the rest be a small sign that they
-- exist rather than a list nobody reads.
create table if not exists public.account_director_companies (
  id uuid primary key default gen_random_uuid(),
  director_id uuid not null references public.account_directors (id) on delete cascade,
  company_name text not null,
  -- Active or Resigned, as the bureau reports it. Only the active ones are shown by name.
  status text check (status in ('Active', 'Resigned')),
  appointed_on date,
  -- Set where the bureau gives one, so a company can later be traced in its own right.
  registration_number text,
  source text not null default 'xds',
  created_at timestamptz not null default now(),
  unique (director_id, company_name)
);

create index if not exists account_director_companies_director_idx
  on public.account_director_companies (director_id, status);

alter table public.account_director_companies enable row level security;

drop policy if exists account_director_companies_read on public.account_director_companies;
create policy account_director_companies_read on public.account_director_companies
  for select to authenticated using (true);

drop policy if exists account_director_companies_write on public.account_director_companies;
create policy account_director_companies_write on public.account_director_companies
  for all to authenticated using (true) with check (true);

-- A trace, kept as something a collector works rather than a one-time import.
--
-- Until now an upload picked a few numbers out of the profile, wrote them into the account's
-- contacts and threw the rest away. The firm's instruction is the other way round: keep what the
-- search found, work inside it -- ring a number, mark it verified or dead -- and PROMOTE the ones
-- that turn out to be real onto the account's principal details.
--
-- That separation is the point. account_contacts is the curated list a collector rings; this is
-- the bureau's raw claim, which is often stale and occasionally about somebody else entirely.
create table if not exists public.account_traces (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.debtor_accounts (id) on delete cascade,
  -- Who the report is about. A company account gets one for the company and one per director.
  subject_kind text not null check (subject_kind in ('debtor', 'director')),
  director_id uuid references public.account_directors (id) on delete set null,
  report_kind text check (report_kind in ('commercial', 'consumer')),
  subject_name text,
  id_number text,
  registration_number text,
  company_status text,
  -- The bureau's own two readings. Kept as its words; we do not recompute or rescale them.
  contact_score text,
  risk_score text,
  enquired_on date,
  -- The PDF itself, where it was filed. Null when the collector chose not to keep it.
  document_id uuid references public.account_documents (id) on delete set null,
  pulled_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists account_traces_account_idx
  on public.account_traces (account_id, created_at desc);

-- Everything the trace said, one row at a time, with what we have since found out about it.
create table if not exists public.account_trace_items (
  id uuid primary key default gen_random_uuid(),
  trace_id uuid not null references public.account_traces (id) on delete cascade,
  -- Carried down from the trace so the account's panel reads its findings in one query. A trace
  -- cannot move between accounts, so the two can never disagree.
  account_id uuid not null references public.debtor_accounts (id) on delete cascade,
  kind text not null check (kind in
    ('phone', 'mobile', 'work', 'email', 'address', 'employer', 'directorship', 'property', 'link')),
  value text not null,
  -- The second column, whatever it is for that kind: a job title, a township, how a link was made.
  label text,
  -- WHAT THE BUREAU PRINTED, kept as evidence and never edited.
  people_linked integer,
  seen_on date,
  amount numeric(14,2),
  status text,
  -- WHAT WE FOUND OUT. Null until somebody has actually tried it.
  outcome text check (outcome in ('verified', 'no_answer', 'unreachable', 'not_theirs')),
  outcome_at timestamptz,
  outcome_by uuid references public.profiles (id),
  outcome_note text,
  -- Set once this has been put on the account's principal details, so it cannot be added twice
  -- and so the panel can show which findings have already earned their place.
  promoted_contact_id uuid references public.account_contacts (id) on delete set null,
  created_at timestamptz not null default now(),
  -- One row per thing per trace: a re-read of the same PDF must update, never duplicate.
  unique (trace_id, kind, value)
);

create index if not exists account_trace_items_account_idx
  on public.account_trace_items (account_id, kind);

alter table public.account_traces enable row level security;
alter table public.account_trace_items enable row level security;

drop policy if exists account_traces_read on public.account_traces;
create policy account_traces_read on public.account_traces
  for select to authenticated using (true);
drop policy if exists account_traces_write on public.account_traces;
create policy account_traces_write on public.account_traces
  for all to authenticated using (true) with check (true);

drop policy if exists account_trace_items_read on public.account_trace_items;
create policy account_trace_items_read on public.account_trace_items
  for select to authenticated using (true);
drop policy if exists account_trace_items_write on public.account_trace_items;
create policy account_trace_items_write on public.account_trace_items
  for all to authenticated using (true) with check (true);

-- A company is not reached on a number. It is reached through a PERSON who has one.
--
-- account_contacts was built for an individual debtor, where every number is theirs and saying so
-- is unnecessary. On a company it is the whole question: a collector ringing a switchboard number
-- needs to know they are asking for the accounts manager, not a director. Without that the list is
-- four numbers and a guess, and the call opens with the wrong name.
--
-- TWO COLUMNS AND NOT A TABLE, deliberately. A contact person is a name and a job title; they have
-- no history, no lifecycle and nothing else hangs off them. A table would buy referential tidiness
-- and cost a join on the hottest read on the account screen. Directors, who DO have a lifecycle,
-- already have their own table -- and a contact person is frequently not a director.
alter table public.account_contacts add column if not exists person_name text;
alter table public.account_contacts add column if not exists person_role text;

comment on column public.account_contacts.person_name is
  'Whose number or address this is, on a company account. Null means the debtor themselves, which '
  'is every individual account and the company''s own switchboard.';

comment on column public.account_contacts.person_role is
  'What they do there: "Accounts manager", "Director". Free text -- it is what the debtor called '
  'themselves on the phone, not a field we can offer a list for.';

-- Grouping the panel by person is the only query this adds, and it is per account.
create index if not exists account_contacts_person_idx
  on public.account_contacts (account_id, person_name);


-- ---------------------------------------------------------------------------
-- nav_counts: the mail badge was counting our own sent messages
-- ---------------------------------------------------------------------------
-- Sent mail is written into user_emails by the sync so the Sent tab has something to show, and
-- it is inserted settled (no_record_at set) because we know where it went. But nothing ever sets
-- read_at on it -- nobody "reads" a message they wrote -- so every sent message satisfied
-- "unread and not junk" for ever. A mailbox whose Sent folder syncs 2 000 messages put 2 000 on
-- the sidebar, and the badge could never be cleared by any action a person can take.
--
-- Same rule as the Mail page itself, which excludes is_sent from every tab but Sent.
--
-- FOUR columns, not the three defined earlier in this file. The diary column was added by
-- another session's migration against the shared staging database and is live there; the
-- definition above predates it. Postgres refuses a change to the OUT parameters of an existing
-- function (42P13), so the fourth column has to be carried whether or not this file ever saw it
-- added. The tasks, disputes and diary clauses below are the live ones, copied verbatim.
create or replace function public.nav_counts()
returns table (mail integer, tasks integer, disputes integer, diary integer)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select
    -- UNREAD mail, whether or not it has been matched. Junk excluded: it is not work. Sent
    -- excluded: we wrote it, and it is not waiting on anybody.
    --
    -- This used to count only mail that still needed matching, on the theory that a matched
    -- message is already dealt with. In practice almost everything matches itself on arrival --
    -- every message in the book did -- so the badge sat at nought for ever and a new email
    -- arrived with nothing on the sidebar to say so. Unread is the thing a person actually
    -- clears, by reading it, and it is what somebody means when they ask whether mail has come.
    (select count(*)::integer from public.user_emails
      where user_id = auth.uid()
        and is_junk = false
        and is_sent = false
        and read_at is null),
    -- Mine, still open, and due by the end of today. Not "all my tasks", which would be a
    -- permanent number nobody could ever clear.
    (select count(*)::integer from public.tasks
      where owner_id = auth.uid()
        and status not in ('Completed', 'Cancelled')
        and due_date < date_trunc('day', now()) + interval '1 day'),
    -- Disputes waiting on ME, not every dispute the firm has open. The difference between a
    -- number somebody works and a number that sits at 20 forever.
    -- Lowercase 'closed'. account_queries.status is one of open / with_client / answered /
    -- closed, so "not closed" is the whole of the open book, not just stage 'open'.
    (select count(*)::integer from public.account_queries
      where owner_id = auth.uid()
        and status <> 'closed'),
    -- My diary: what is due today, plus what I am already behind on.
    --
    -- The arrears are INCLUDED on purpose, even though including them risks exactly the failure
    -- this file warns about -- a badge that never reaches zero stops being read. The alternative
    -- is worse: a book arrived here with 279 overdue entries, and a badge that showed only
    -- today's work would read "4" to somebody three months behind. The number has to be able to
    -- frighten, or it is not telling the truth. It reaches zero when the diary is genuinely
    -- clear, which is the condition the firm actually wants to manage towards.
    (select count(*)::integer from public.diary_entries
      where owner_id = auth.uid()
        and state = 'open'
        and due_on <= current_date);
$$;

grant execute on function public.nav_counts() to authenticated;


-- ---------------------------------------------------------------------------
-- Raptor's own calendar
-- ---------------------------------------------------------------------------
-- The firm's instruction on a meeting request: "it should go to the Raptor calendar ... the
-- Raptor one should be the main one. Nah, I just keep it at Raptor for now."
--
-- Until now the Calendar page was a RENDERING of tasks and deal close dates -- there was nothing
-- an event could be stored in, so an invite could be read and not accepted, and the .ics went to
-- whatever calendar the device happened to have. This is the table that makes accepting mean
-- something.
--
-- PERSONAL, not the firm's. An event belongs to the person whose invitation it was. A shared
-- diary is a different thing with different rules about who may see what, and the collections
-- diary already exists for the work.
create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,

  title text not null,
  -- Null where the invite gave a floating time and no zone: that means "whatever the reader's
  -- own clock says", which is not a fact about the meeting and must not be recorded as one.
  starts_at timestamptz,
  ends_at timestamptz,
  -- A whole day is a DATE, not midnight. Stored separately so it is never shown as 00:00.
  all_day boolean not null default false,
  starts_on date,
  ends_on date,

  location text,
  notes text,

  source text not null default 'manual' check (source in ('manual', 'invite')),

  -- iTIP identity. The SAME meeting arrives again whenever the organiser changes anything, and
  -- without this every edit would land as a second copy in somebody's day.
  ical_uid text,
  organiser_name text,
  organiser_email text,
  -- As the invite gave them. Read, never joined on: these are people outside the firm.
  attendees jsonb not null default '[]'::jsonb,

  -- The message it came off, so the event can point back at what was agreed to.
  user_email_id uuid references public.user_emails(id) on delete set null,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

-- One meeting per person, however many times the organiser revises it. Partial, because a
-- hand-made event has no UID and several of those are not a duplicate of anything.
create unique index if not exists calendar_events_uid_idx
  on public.calendar_events (owner_id, ical_uid)
  where ical_uid is not null;

-- What the month, week and day views ask for: this person's events over a span.
create index if not exists calendar_events_owner_idx
  on public.calendar_events (owner_id, starts_at);

comment on column public.calendar_events.starts_at is
  'Null for an all-day event (see starts_on) and for an invite whose time was floating -- a '
  'floating time means the reader''s own clock and is not a fact about the meeting.';
comment on column public.calendar_events.ical_uid is
  'The invite''s UID. A revised invitation carries the same one, so it updates rather than '
  'arriving as a second meeting.';

alter table public.calendar_events enable row level security;

-- YOUR OWN CALENDAR AND NOBODY ELSE'S. Not a manager override either: this is a person's diary
-- of meetings they were invited to, which is a different thing from the collections diary the
-- firm manages.
create policy calendar_events_own_select on public.calendar_events
  for select using (owner_id = auth.uid());
create policy calendar_events_own_insert on public.calendar_events
  for insert with check (owner_id = auth.uid());
create policy calendar_events_own_update on public.calendar_events
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy calendar_events_own_delete on public.calendar_events
  for delete using (owner_id = auth.uid());


-- ---------------------------------------------------------------------------
-- Who else was on an email
-- ---------------------------------------------------------------------------
-- The firm: "I can't see all the other recipients of an email. And I also can't respond to all
-- recipients." user_emails carried to_address and to_name -- the FIRST recipient only, kept
-- because "who is this from" is the wrong question about a message we sent. A debtor who copies
-- their attorney, or a client who copies two of their own people, arrived looking like a private
-- message, and replying went back to the sender alone.
--
-- Whole lists, as the message carried them, with names: a reply-all has to reach exactly the
-- people the original did, and a name is what lets somebody check that before they send.
alter table public.user_emails add column if not exists to_recipients jsonb not null default '[]'::jsonb;
alter table public.user_emails add column if not exists cc_recipients jsonb not null default '[]'::jsonb;

comment on column public.user_emails.to_recipients is
  'Everyone on To, as [{name, address}] in the order the message carried them. to_address is the '
  'first of these and stays for the Sent tab, which shows one recipient per row.';
comment on column public.user_emails.cc_recipients is
  'Everyone on Cc. Bcc is deliberately absent: it is not in the message we received, and a list '
  'that looked complete while missing people would be worse than no list.';

-- ---------------------------------------------------------------------------
-- HOW FAR BACK THE MAILBOX HAS BEEN READ.
--
-- The firm, on two messages they could see in Spark and not in Raptor: "I don't see it in my
-- message ... I don't know why it's not mentioned in my inbox."
--
-- Because the sync only ever looked FORWARD. last_seen_uid is a high-water mark and every run asks
-- the server for UIDs above it; the very first run took the most recent 25 messages and set the
-- mark at the top of them. Everything older than that window was then unreachable for ever -- not
-- filtered, not hidden, simply never fetched, with nothing anywhere saying so.
--
-- These are the low-water marks. "Fetch older mail" walks down from them a batch at a time.
-- ---------------------------------------------------------------------------
alter table public.email_connections
  add column if not exists oldest_seen_uid integer,
  add column if not exists oldest_seen_uid_junk integer,
  add column if not exists oldest_seen_uid_sent integer;

comment on column public.email_connections.oldest_seen_uid is
  'How far BACK the INBOX has been read. last_seen_uid is the high-water mark and the sync only ever asks for UIDs above it, so everything older than the first sync''s 25-message window was invisible for ever -- which is how a client''s mail from before the mailbox was connected simply never appeared. Fetch older mail walks down from here.';
comment on column public.email_connections.oldest_seen_uid_junk is
  'The same low-water mark for the Junk/Spam folder. See oldest_seen_uid.';
comment on column public.email_connections.oldest_seen_uid_sent is
  'The same low-water mark for the Sent folder. See oldest_seen_uid.';

-- ---------------------------------------------------------------------------
-- SENT MAIL ARRIVES READ.
--
-- The firm: "all the sent emails are marked as unread -- sent emails should automatically be
-- read." Nothing sets read_at on a message you wrote, and opening one is the only thing that marks
-- mail read, so a synced Sent folder put a permanent column of bold rows on the Sent tab that no
-- action could clear. The sync now stamps read_at on the way in; this settles what is already
-- stored, dated to when the message was sent rather than to now.
-- ---------------------------------------------------------------------------
update public.user_emails
set read_at = coalesce(read_at, occurred_at)
where is_sent = true and read_at is null;

-- ---------------------------------------------------------------------------
-- THE OTHER FIFTEEN FOLDERS.
--
-- The firm reported two messages that were in their mail client and not in Raptor. The sync's own
-- log gave the answer: that server has EIGHTEEN folders and the sync read three of them --
-- INBOX, the Junk one and the Sent one. Archive, Blocked, "Spam Emails 1/2/3" and the rest were
-- never opened, so anything a server-side rule or another mail client filed into them was
-- invisible here, permanently, with nothing on screen saying so.
--
-- Three columns cannot hold eighteen watermarks, so the rest live here keyed by folder path.
-- Trash and Drafts are still skipped: deleted mail is deleted, and a draft is not correspondence.
-- ---------------------------------------------------------------------------
alter table public.email_connections
  add column if not exists folder_uids jsonb not null default '{}'::jsonb;

comment on column public.email_connections.folder_uids is
  'A high-water mark per IMAP folder, keyed by path. last_seen_uid / _junk / _sent stay as the marks for INBOX, Junk and Sent; every other folder on the server lives here.';

-- ---------------------------------------------------------------------------
-- AND THE LOW-WATER MARKS WERE WRONG.
--
-- They were set from a FORWARD run's own minimum UID, which on a mailbox that was already syncing
-- is the oldest of the four messages that happened to arrive that minute -- not the oldest message
-- Raptor holds. One read 59528 against a mailbox whose oldest stored message is 5101, so "fetch
-- older mail" would have spent its first dozen presses re-reading mail Raptor already had.
--
-- Cleared, so the floor is derived from the oldest row actually stored -- which is what the
-- backfill does when the column is null, and is right by construction.
-- ---------------------------------------------------------------------------
update public.email_connections
set oldest_seen_uid = null, oldest_seen_uid_junk = null, oldest_seen_uid_sent = null;

-- ---------------------------------------------------------------------------
-- "FETCH OLDER MAIL" IS GONE, and so are its columns.
--
-- The firm: "just remove that, please -- it's going to be a nightmare importing thousands of
-- messages from years ago until now." They are right, and it was also answering a question that
-- turned out to have a different answer: the mail they could not find was in folders the sync
-- never opened (see folder_uids above), not behind a date.
--
-- Dropped rather than left unused. They were added in this same session, the only value ever
-- written to one was wrong and has since been cleared, and nothing reads them.
-- ---------------------------------------------------------------------------
alter table public.email_connections
  drop column if exists oldest_seen_uid,
  drop column if exists oldest_seen_uid_junk,
  drop column if exists oldest_seen_uid_sent;

-- ---------- A collections target ----------
-- The collections side gets a target of its own: money received on accounts in the sales month.
-- One table for both halves of the firm because the scoping is identical — a team or a person,
-- standing or for one month — while which screen reads it is decided in src/lib/targets.ts, by
-- the `side` on each metric. A collections target on the sales dashboard reads as a rep who has
-- collected nothing, which is true and useless: the rep is not on the book.
alter table public.targets drop constraint if exists targets_metric_check;
alter table public.targets add constraint targets_metric_check
  check (metric in ('leads', 'mandates', 'deals', 'revenue', 'book', 'accounts', 'activities', 'collected'));

-- ---------- Answering a meeting request ----------
-- "Add to my calendar" failed with "there is no unique or exclusion constraint matching the ON
-- CONFLICT specification", and the reason was this index's WHERE clause. Postgres will only use a
-- PARTIAL index for an ON CONFLICT when the statement repeats the same predicate, and PostgREST's
-- upsert does not emit one — so every accepted invitation was refused. The same trap is recorded
-- in CLAUDE.md for the diary's one-open-entry index, where being refused loudly is what is wanted;
-- here it simply broke the button.
--
-- Dropping the predicate changes nothing about what is allowed. NULLs are distinct in a unique
-- btree index, so a person may still keep as many hand-made events with no UID as they like, and
-- an ON CONFLICT on a null UID matches nothing and inserts. Probed in a transaction that rolled
-- back: a revised invitation updates in place, two hand-made events coexist, and an upsert with a
-- null UID inserts a third.
drop index if exists public.calendar_events_uid_idx;
create unique index calendar_events_uid_idx
  on public.calendar_events (owner_id, ical_uid);

-- What this person told the organiser, and when.
--
-- On the MESSAGE rather than on the calendar event, because a declined meeting has no event and
-- "did I reply to this?" is a question about the invitation that was sent to me. A revised
-- invitation arrives as a new message and is answered again, which is correct: the organiser
-- asked twice.
alter table public.user_emails add column if not exists invite_response text
  check (invite_response in ('accepted', 'tentative', 'declined'));
alter table public.user_emails add column if not exists invite_responded_at timestamptz;

comment on column public.user_emails.invite_response is
  'The iTIP reply this person sent the organiser for a meeting request on this message. Null '
  'means they have not answered it.';

-- When a sync last STARTED, as opposed to last_synced_at which records when one finished.
--
-- Claimed before the mailbox is opened so that only one sync per person can be in flight. The
-- runtime logs showed three identical /api/email/sync calls landing in the same second — the mail
-- page, the messages menu and the cron — each walking eighteen folders over its own IMAP
-- connection against one mailbox. Mail servers cap concurrent connections per account, so the
-- three did not merely waste work: they queued behind each other and everything else the person
-- was doing, which is what "it loads and loads and loads" is.
alter table public.email_connections add column if not exists sync_started_at timestamptz;

-- ============================================================================================
-- What a collector does with a trace, and how a month looked day by day.
--
-- The firm, on the collector's own dashboard: "how many traces do they do, how effectively do
-- they work their traces" and "graphs in terms of previous months... their collections for the
-- last, let's say, 12 months, so they can see their progress".
--
-- A TRACE IS BOUGHT AND THEN WORKED, and they are two different things a month apart. Pulling one
-- costs the firm money and produces a list of numbers and addresses; working it is ringing them
-- and recording what happened. A collector who pulls forty traces and rings none of them has
-- spent the firm's money and moved nothing, and one number for both would hide that.
--
-- Findings are counted on the day the OUTCOME was recorded, whoever pulled the trace: a trace
-- bought in August and worked in September is September's effort.
-- ============================================================================================
drop function if exists public.collector_performance(timestamptz, timestamptz);

create function public.collector_performance(p_from timestamptz, p_to timestamptz)
returns table (
  user_id uuid,
  in_play_accounts integer,
  in_play_value numeric,
  collected numeric,
  payments integer,
  calls integer,
  calls_answered integer,
  emails_sent integer,
  sms_sent integer,
  notes_written integer,
  promises_made integer,
  promises_kept integer,
  promises_broken integer,
  accounts_touched integer,
  traces_pulled integer,
  trace_leads integer,
  traces_worked integer,
  traces_verified integer
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with book as (
    select assigned_to as uid,
           count(*) filter (where status ilike 'Active%')::integer as in_play,
           coalesce(sum(capital_outstanding) filter (where status ilike 'Active%'), 0) as value
      from public.debtor_accounts
     where assigned_to is not null
     group by assigned_to
  ),
  paid as (
    select h.user_id as uid,
           coalesce(sum(p.amount), 0) as collected,
           count(*)::integer as payments
      from public.account_payments p
      cross join lateral (
        select dh.user_id
          from public.account_desk_history dh
         where dh.account_id = p.account_id
           and dh.effective_from <= p.received_at
         order by dh.effective_from desc
         limit 1
      ) h
     where p.reversed_at is null
       and p.received_at >= p_from and p.received_at < p_to
       and h.user_id is not null
     group by h.user_id
  ),
  rang as (
    select placed_by as uid,
           count(*)::integer as calls,
           count(*) filter (where answered_at is not null)::integer as answered
      from public.account_calls
     where placed_by is not null and placed_at >= p_from and placed_at < p_to
     group by placed_by
  ),
  mailed as (
    select sent_by as uid, count(*)::integer as emails
      from public.account_emails
     where sent_by is not null and direction = 'out'
       and occurred_at >= p_from and occurred_at < p_to
     group by sent_by
  ),
  texted as (
    select created_by as uid, count(*)::integer as sms
      from public.sms_messages
     where created_by is not null and account_id is not null and direction = 'outbound'
       and created_at >= p_from and created_at < p_to
     group by created_by
  ),
  wrote as (
    select created_by as uid, count(*)::integer as notes
      from public.account_notes
     where created_by is not null and source = 'manual'
       and created_at >= p_from and created_at < p_to
     group by created_by
  ),
  promised as (
    select created_by as uid,
           count(*)::integer as made,
           count(*) filter (where status = 'kept')::integer as kept,
           count(*) filter (where status = 'broken')::integer as broken
      from public.promises_to_pay
     where created_by is not null
       and created_at >= p_from and created_at < p_to
     group by created_by
  ),
  touched as (
    select uid, count(distinct account_id)::integer as accounts
      from (
        select placed_by as uid, account_id from public.account_calls
         where placed_by is not null and placed_at >= p_from and placed_at < p_to
        union all
        select sent_by, account_id from public.account_emails
         where sent_by is not null and direction = 'out'
           and occurred_at >= p_from and occurred_at < p_to
        union all
        select created_by, account_id from public.account_notes
         where created_by is not null and source = 'manual'
           and created_at >= p_from and created_at < p_to
      ) t
     group by uid
  ),
  traced as (
    select t.pulled_by as uid,
           count(distinct t.id)::integer as traces,
           count(i.id)::integer as leads
      from public.account_traces t
      left join public.account_trace_items i on i.trace_id = t.id
     where t.pulled_by is not null
       and t.created_at >= p_from and t.created_at < p_to
     group by t.pulled_by
  ),
  trace_work as (
    select outcome_by as uid,
           count(*)::integer as worked,
           count(*) filter (where outcome = 'verified')::integer as verified
      from public.account_trace_items
     where outcome_by is not null
       and outcome_at >= p_from and outcome_at < p_to
     group by outcome_by
  )
  select
    pr.id, coalesce(b.in_play, 0), coalesce(b.value, 0),
    coalesce(pd.collected, 0), coalesce(pd.payments, 0),
    coalesce(r.calls, 0), coalesce(r.answered, 0),
    coalesce(m.emails, 0), coalesce(tx.sms, 0), coalesce(w.notes, 0),
    coalesce(pm.made, 0), coalesce(pm.kept, 0), coalesce(pm.broken, 0),
    coalesce(tc.accounts, 0),
    coalesce(tr.traces, 0), coalesce(tr.leads, 0),
    coalesce(tw.worked, 0), coalesce(tw.verified, 0)
  from public.profiles pr
  left join book b on b.uid = pr.id
  left join paid pd on pd.uid = pr.id
  left join rang r on r.uid = pr.id
  left join mailed m on m.uid = pr.id
  left join texted tx on tx.uid = pr.id
  left join wrote w on w.uid = pr.id
  left join promised pm on pm.uid = pr.id
  left join touched tc on tc.uid = pr.id
  left join traced tr on tr.uid = pr.id
  left join trace_work tw on tw.uid = pr.id
  where pr.collector_grade is not null or b.in_play > 0 or pd.payments > 0;
$$;

grant execute on function public.collector_performance(timestamptz, timestamptz) to authenticated;

-- Money in, day by day.
--
-- ONE ROUND TRIP FOR A YEAR, and the bucketing into sales months is left to the caller on purpose:
-- the firm's month is the 11th to the 10th, that rule already lives in src/lib/salesMonth.ts, and
-- writing it a second time in SQL is how two parts of Raptor end up disagreeing about which month
-- a payment fell in. A year of days is about 365 rows.
--
-- p_user null is the whole floor, which is what the company trend behind a collector's own line
-- is drawn from.
create or replace function public.collector_daily(
  p_user uuid, p_from timestamptz, p_to timestamptz
)
returns table (on_day date, collected numeric, payments integer)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select
    -- THE FIRM'S OWN DAY, not UTC. A payment at half past one in the morning in Johannesburg is
    -- still yesterday in UTC, and a day's total that disagrees with the bank statement by one
    -- payment is a day's total nobody will trust again.
    (p.received_at at time zone 'Africa/Johannesburg')::date as on_day,
    sum(p.amount) as collected,
    count(*)::integer as payments
  from public.account_payments p
  cross join lateral (
    select dh.user_id
      from public.account_desk_history dh
     where dh.account_id = p.account_id
       and dh.effective_from <= p.received_at
     order by dh.effective_from desc
     limit 1
  ) h
  where p.reversed_at is null
    and p.received_at >= p_from and p.received_at < p_to
    and h.user_id is not null
    and (p_user is null or h.user_id = p_user)
  group by 1
  order by 1;
$$;

grant execute on function public.collector_daily(uuid, timestamptz, timestamptz) to authenticated;

-- ---------- A debtor is a person or a company, and Raptor has to know which ----------
-- debtor_kind was added after the book was imported and defaults to 'individual', so three of the
-- firm's company accounts said so and the rest did not — the state CLAUDE.md already records:
-- "The firm's two newest accounts are both companies and neither could say so." The account screen
-- switches on this flag, so an unmarked company showed a panel headed "Debtor details" over a
-- field labelled "ID Number" holding 2016/210735/07.
--
-- ONLY THE UNAMBIGUOUS HALF IS MARKED HERE. A registration number in the identity field is proof:
-- nobody types 2019/123456/07 for a person. A company-shaped NAME is strong evidence and not proof
-- — `\bcc\b` matches a person with the initials C.C. — and the cost of being wrong is a real
-- person's account relabelled and their trace search refused. Those are left for a collector to
-- set in one click, which the screen now suggests.
--
-- Normalised on the way past as well: the bureau prefixes a letter of its own (K2016/210735/07)
-- and the firm's records do not, so two spellings of one company would never match a lookup keyed
-- on the number — which is exactly what a CIPC or bureau enquiry is.
update public.debtor_accounts
set debtor_kind = 'company',
    debtor_id_number = regexp_replace(
      trim(debtor_id_number), '^[A-Za-z]?\s*(\d{4})\s*/\s*(\d{4,7})\s*/\s*(\d{2})\s*$', '\1/\2/\3'
    )
where debtor_id_number ~* '^[A-Z]?\s*\d{4}\s*/\s*\d{4,7}\s*/\s*\d{2}\s*$'
  and (debtor_kind is distinct from 'company'
       or debtor_id_number <> regexp_replace(
            trim(debtor_id_number), '^[A-Za-z]?\s*(\d{4})\s*/\s*(\d{4,7})\s*/\s*(\d{2})\s*$', '\1/\2/\3'));


-- ---------- What the firm says to a debtor, kept where it can be read and reviewed ----------
--
-- Everything Raptor sends a debtor is currently written where it is sent: the SMS compose box,
-- the mail composer, queryLetters.ts. That survives while a collector writes one message to one
-- debtor. It stops surviving the moment a campaign sends the same words to four hundred people,
-- because the words are then the firm's position in writing, four hundred times over, and a
-- sentence the attorney would not have approved is four hundred problems rather than one.
--
-- queryLetters.ts already says these letters "move into the letters/SMS/WhatsApp template system
-- when that is built". This is that table.
create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('sms', 'email', 'call_script')),
  name text not null,
  -- Email only. An SMS has no subject and neither does a script somebody reads aloud; carrying
  -- one anyway means a screen renders an empty line above the words a collector is meant to say.
  subject text,
  body text not null,
  -- The rung this is written for, or null for one that suits any account.
  --
  -- NULLABLE ON PURPOSE. Fourteen positions times three kinds is forty-two pieces of wording, and
  -- a library that does nothing until all forty-two exist is a library nobody finishes filling. A
  -- null position is the general version and the resolver falls back to it -- which is also why a
  -- power hour never silently skips an account: the unusual positions, the ones with no script
  -- yet, are precisely the accounts somebody should be ringing.
  position text check (position is null or position in (
    'new', 'paying', 'arranged', 'broken_arrangement', 'refusing', 'cannot_pay', 'negotiating',
    'in_progress', 'tracing', 'disputed', 'legal', 'under_administration', 'frozen', 'closed'
  )),
  -- ISO 639-1. debtor_accounts.preferred_language exists and the firm works in more than one
  -- language, so a template says which one it is in rather than the reader guessing. English is
  -- the fallback, not a "default language" setting: a collector handed a script in the wrong
  -- language is a small awkwardness, one handed nothing is a call that does not happen.
  language text not null default 'en',
  active boolean not null default true,
  -- Stable name for a draft seeded by a migration, null for anything the firm writes itself.
  -- It is what makes seeding idempotent: a later migration can add a new draft without
  -- duplicating the ones already there, and without overwriting the firm's edits to them.
  seed_key text unique,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

-- An email carries a subject and the other two do not. Enforced here as well as in the form,
-- because a campaign will read these rows without going near the form.
alter table public.message_templates drop constraint if exists message_templates_subject_kind;
alter table public.message_templates add constraint message_templates_subject_kind check (
  (kind = 'email' and subject is not null and btrim(subject) <> '')
  or (kind <> 'email' and subject is null)
);

-- The resolver's only query: live templates of one kind, then position and language picked in
-- memory over a list that is dozens of rows, not thousands.
create index if not exists message_templates_kind_idx
  on public.message_templates (kind, position, language)
  where active;

alter table public.message_templates enable row level security;
grant select, insert, update, delete on public.message_templates to authenticated;

-- Everyone reads them: an agent has to be able to see the script they are meant to read.
drop policy if exists message_templates_select on public.message_templates;
create policy message_templates_select on public.message_templates
  for select to authenticated using (auth.uid() is not null);

-- WRITING IS NARROWER THAN READING, which is the whole point of a library. The wording is the
-- firm's legal position and the attorney signs it off; an agent who could edit it in the moment
-- would be writing the firm's correspondence for four hundred debtors by accident.
drop policy if exists message_templates_insert on public.message_templates;
create policy message_templates_insert on public.message_templates
  for insert to authenticated with check (
    public.current_user_role() in ('Administrator', 'Pre-legal Team Leader', 'Liaison Manager')
  );

drop policy if exists message_templates_update on public.message_templates;
create policy message_templates_update on public.message_templates
  for update to authenticated
  using (public.current_user_role() in ('Administrator', 'Pre-legal Team Leader', 'Liaison Manager'))
  with check (public.current_user_role() in ('Administrator', 'Pre-legal Team Leader', 'Liaison Manager'));

drop policy if exists message_templates_delete on public.message_templates;
create policy message_templates_delete on public.message_templates
  for delete to authenticated using (public.current_user_role() = 'Administrator');

create or replace function public.touch_message_template()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists message_templates_touch on public.message_templates;
create trigger message_templates_touch before update on public.message_templates
  for each row execute function public.touch_message_template();

-- ---------- The firm's first draft of what it says, so the library does not ship empty ----------
--
-- PLACEHOLDER WORDING, on the same footing as queryLetters.ts: this is a mechanism with words in
-- it, not settled correspondence. The firm's attorney has the final text. Everything here is
-- editable in the app precisely so that it can be replaced without a deployment.
--
-- SEEDED ONCE, BY KEY. `on conflict (seed_key) do nothing` is what makes this safe to re-run: a
-- later migration can add a draft nobody has written yet without duplicating the ones already
-- there, and without overwriting a word the firm has changed. A seed that overwrites edits is a
-- seed that quietly reverts the attorney.
--
-- Every SMS here fits a SINGLE segment against a long surname and a five-figure balance, which is
-- what keeps Annexure B item 1(c) at R3.50 rather than R7.00 for the same words. Straight
-- apostrophes only: one curly quote pasted from Word forces UCS-2, where a segment holds 70
-- characters instead of 160, and doubles the bill on its own.
insert into public.message_templates (seed_key, kind, name, subject, body, position, language) values

('sms-first-contact', 'sms', 'First contact', null,
 '{{firm_name}}: your account {{reference}} with {{client_name}} is overdue. Please call {{agent_phone}} to arrange payment.',
 null, 'en'),

('sms-broken-arrangement', 'sms', 'Broken arrangement', null,
 '{{firm_name}}: the arrangement on account {{reference}} has not been kept. Please call {{agent_phone}} today.',
 'broken_arrangement', 'en'),

('sms-ptp-reminder', 'sms', 'Promise due tomorrow', null,
 '{{firm_name}}: a reminder that your payment on account {{reference}} is due tomorrow. Queries: {{agent_phone}}.',
 'arranged', 'en'),

('sms-payment-received', 'sms', 'Payment received', null,
 '{{firm_name}}: thank you, your payment on {{reference}} is received. Balance {{balance}}. Queries {{agent_phone}}.',
 'paying', 'en'),

-- NOT ONE WORD ABOUT A DEBT. A traced number is unverified by definition, so this message may well
-- reach somebody who is not the debtor, and telling a third party that a person owes money is a
-- disclosure the firm cannot take back. It says who wants to speak to whom, and nothing else.
('sms-make-contact', 'sms', 'Please make contact (traced number)', null,
 '{{firm_name}} needs to speak to {{debtor_name}} on a confidential matter. Please call {{agent_phone}}.',
 'tracing', 'en')

on conflict (seed_key) do nothing;

-- ---------- Email. Plain text on purpose: the mail sender wraps it and appends the sender's
-- ---------- signature, so nothing here should try to be HTML. Annexure B item 1(a), R25 a send.
insert into public.message_templates (seed_key, kind, name, subject, body, position, language) values

('email-first-demand', 'email', 'Letter of demand', 'Account {{reference}} with {{client_name}}',
$b$Dear {{debtor_name}}

We act for {{client_name}} in respect of the above account, which has been handed to us for collection.

The balance outstanding as at {{today}} is {{balance}}.

We ask that you settle this amount, or contact us to arrange terms you can keep. We would rather agree an arrangement with you than escalate the matter, and an arrangement kept is the quickest way to close the account.

Please quote reference {{reference}} on any payment.

If you believe this amount is not owing, or is not owing by you, tell us why and we will put the account on hold while we take it up with our client.

Yours faithfully
{{agent_name}}
{{firm_name}}
{{agent_phone}}$b$,
 null, 'en'),

('email-broken-arrangement', 'email', 'Broken arrangement', 'Arrangement on account {{reference}}',
$b$Dear {{debtor_name}}

We agreed an arrangement on the above account and the payment due has not reached us.

The balance outstanding as at {{today}} is {{balance}}.

Please let us know what has happened. If your circumstances have changed we would rather rework the arrangement than have it fail a second time. An arrangement you cannot keep helps neither of us.

Please quote reference {{reference}} on any payment.

Yours faithfully
{{agent_name}}
{{firm_name}}
{{agent_phone}}$b$,
 'broken_arrangement', 'en'),

('email-arrangement-confirmed', 'email', 'Arrangement confirmed', 'Your arrangement on account {{reference}}',
$b$Dear {{debtor_name}}

We confirm the arrangement agreed today on the above account, which we administer for {{client_name}}.

The balance outstanding as at {{today}} is {{balance}}.

Please quote reference {{reference}} on every payment so that it is allocated to your account without delay.

If a payment is going to be late, tell us before the date rather than after it. We can usually work around a date that moves; we cannot work around a payment that simply does not arrive.

Yours faithfully
{{agent_name}}
{{firm_name}}
{{agent_phone}}$b$,
 'arranged', 'en'),

-- A SETTLEMENT FIGURE IS THE CLIENT'S TO GIVE, not the collector's, which is why this letter
-- carries no number beyond the balance. A figure offered without a mandate is one the firm may
-- have to honour.
('email-settlement-discussion', 'email', 'Settlement discussion', 'Account {{reference}}: your proposal',
$b$Dear {{debtor_name}}

Thank you for speaking to us about the above account.

The balance outstanding as at {{today}} is {{balance}}.

We have put your proposal to {{client_name}} and will come back to you as soon as we have their instruction. Nothing is agreed until we confirm it to you in writing.

In the meantime, please quote reference {{reference}} on any payment you are able to make. A payment now reduces the balance whatever is agreed later.

Yours faithfully
{{agent_name}}
{{firm_name}}
{{agent_phone}}$b$,
 'negotiating', 'en')

on conflict (seed_key) do nothing;

-- ---------- Call scripts, read on screen while the phone is ringing ----------
--
-- The shape matters as much as the words: OPEN is said aloud, the IF blocks are the three things
-- that actually come back, and NEVER is the law rather than house style:
--   * Debt Collectors Act 114 of 1998 and the Council's code: identify yourself and the firm, no
--     false or misleading statements, no threat of legal action that is not actually intended.
--   * NCA s126B: collecting on a PRESCRIBED debt is prohibited, and an acknowledgement revives
--     it. Raptor carries the flag; the script must not talk a debtor into one.
--   * NCA s129 is the statutory demand BEFORE court. An account on section 129 is in progress,
--     not legal, and a script that calls it legal action is a misrepresentation.
--   * The debt is confidential and may not be disclosed to a third party, which is the whole
--     difficulty of a trace call and the reason that script says nothing about money.
insert into public.message_templates (seed_key, kind, name, subject, body, position, language) values

('call-general', 'call_script', 'General collection call', null,
$b$OPEN
Good day, may I speak to {{debtor_name}}?
This is {{agent_name}} from {{firm_name}}. We handle the account {{reference}} for {{client_name}}.
Is it convenient to speak now?

STATE IT ONCE
The balance on the account is {{balance}}. I am calling to agree how it will be settled.

THEN STOP TALKING. The first person to speak after the figure usually concedes.

IF THEY CAN PAY IN FULL
Take the payment date and log the promise before you end the call.

IF THEY CANNOT PAY IN FULL
What can you manage, and on what date? Get a figure and a date, not "month end".
Log it as a promise to pay. An arrangement that is not logged did not happen.

IF THEY DISPUTE IT
Do not argue the merits. Record what they dispute, raise the dispute on the account, and tell them
the account is on hold while it is taken up with the client.

CLOSE
Repeat the amount and the date back to them, and say what happens if it is not met.
Confirm the number to call back on: {{agent_phone}}.

NEVER
- Never say legal action is coming unless the firm has instructions to take it.
- Never discuss the account with anybody other than the debtor. The debt is confidential.
- Never continue if the account is flagged prescribed. Section 126B of the National Credit Act
  prohibits collecting a prescribed debt, and an acknowledgement revives it. End the call and
  refer it to a team leader.$b$,
 null, 'en'),

('call-new', 'call_script', 'First contact', null,
$b$OPEN
Good day, may I speak to {{debtor_name}}?
This is {{agent_name}} from {{firm_name}}. {{client_name}} has handed your account to us.

THIS MAY BE THE FIRST THEY HAVE HEARD OF IT. Say what the account is before you say what is owed,
or the whole call goes on "what account?".

CONFIRM WHO YOU ARE SPEAKING TO
Before any detail: confirm the name and one other identifier. Giving the balance to the wrong
person is a disclosure the firm cannot take back.

STATE IT ONCE
The account is {{reference}} with {{client_name}} and the balance is {{balance}}.

CHECK THE DETAILS WHILE YOU HAVE THEM
This is the one call where a debtor will willingly confirm a number, an address and an employer.
Update them on the account before you end it. It is what stops this account becoming a trace.

ASK THE QUESTION
How would you like to settle this? Get a figure and a date.

CLOSE
Confirm the amount, the date and the reference {{reference}}.
The number to call back on is {{agent_phone}}.

NEVER
- Never say legal action is coming unless the firm has instructions to take it.
- Never discuss the account with anybody other than the debtor.
- Never continue if the account is flagged prescribed. Refer it to a team leader.$b$,
 'new', 'en'),

('call-broken-arrangement', 'call_script', 'Broken arrangement', null,
$b$OPEN
Good day, may I speak to {{debtor_name}}?
{{agent_name}} from {{firm_name}}, about account {{reference}}.

WHY THIS CALL IS DIFFERENT. They already agreed once. The purpose is not to agree again on the
same terms, which are terms they could not keep. It is to find out what changed and agree terms
they can.

ASK, DO NOT ACCUSE
We agreed a payment and it has not reached us. What happened?

Then listen. A broken arrangement is usually a changed circumstance, and the collector who finds
out what it is gets a second arrangement that holds.

IF THE CIRCUMSTANCES HAVE CHANGED
Rework the amount. A smaller payment that arrives beats a larger one that does not.

IF THERE IS NO REASON
Say plainly that a second broken arrangement limits what can be done, and get a date.

CLOSE
Repeat the new amount and date. Log the promise. The balance is {{balance}}.
Call back on {{agent_phone}}.

NEVER
- Never threaten a consequence the firm will not actually apply.
- Never discuss the account with anybody other than the debtor.
- Never continue if the account is flagged prescribed. Refer it to a team leader.$b$,
 'broken_arrangement', 'en'),

('call-arranged', 'call_script', 'Courtesy call on a live arrangement', null,
$b$OPEN
Good day, may I speak to {{debtor_name}}?
{{agent_name}} from {{firm_name}}. Nothing is wrong. I am calling ahead of your payment on
account {{reference}}.

THIS IS A COURTESY CALL AND MUST SOUND LIKE ONE. An account that is being paid is an account
working; a call that sounds like a demand is how a paying debtor becomes a difficult one.

CONFIRM
Your payment is due shortly. Is everything still in order for that date?

IF THEY SAY IT WILL BE LATE
Get the new date now. A date moved with notice is an arrangement kept as far as the firm is
concerned; a date missed in silence is a broken one.

CLOSE
Thank them. Balance {{balance}}. Reference {{reference}} on the payment. {{agent_phone}}.

NEVER
- Never discuss the account with anybody other than the debtor.
- Never use a courtesy call to renegotiate upward. It is the fastest way to lose a paying account.$b$,
 'arranged', 'en'),

('call-cannot-pay', 'call_script', 'Cannot pay', null,
$b$OPEN
Good day, may I speak to {{debtor_name}}?
{{agent_name}} from {{firm_name}}, about account {{reference}}.

CANNOT PAY IS NOT REFUSING TO PAY. One is a pensioner or somebody who has lost a job; the other is
a decision. Treating the first as the second costs the firm the account and the client the money.

FIND OUT WHICH IT IS
What has changed? Are you working at the moment? Is there any income at all?

IF THERE IS SOME INCOME
Ask for something small and regular rather than a lump sum. R200 a month that arrives is worth
more to the client than R2 000 that does not.

IF THERE IS GENUINELY NOTHING
Do not press. Record the circumstances on the account, agree a date to speak again, and put it in
the diary. Say clearly that the account does not go away, so they are not surprised later.

IF THEY MENTION DEBT REVIEW, ADMINISTRATION OR SEQUESTRATION
Stop collecting. Take the practitioner's name and reference and hand it to a team leader.

CLOSE
Balance {{balance}}. Call back on {{agent_phone}}.

NEVER
- Never suggest they borrow money to pay this account.
- Never discuss the account with anybody other than the debtor.
- Never continue if the account is flagged prescribed. Refer it to a team leader.$b$,
 'cannot_pay', 'en'),

('call-refusing', 'call_script', 'Refusing to pay', null,
$b$OPEN
Good day, may I speak to {{debtor_name}}?
{{agent_name}} from {{firm_name}}, about account {{reference}}.

A REFUSAL IS A POSITION, AND A POSITION HAS A REASON. Find the reason before answering it.

ASK
You have told us you will not pay this. Can you tell me why?

IF THE REASON IS A DISPUTE
It is not a refusal, it is a dispute. Raise it on the account, say the account goes on hold while
the client is asked, and move to the dispute script.

IF THE REASON IS THE AMOUNT
Say what the balance is made up of. Capital, interest and costs are separate figures, and a debtor
who believes the whole balance is fees usually stops refusing once they see the capital.

IF IT IS A DECISION
Say once, plainly, what happens next, and only what the firm will actually do. Then record it.
An honest "then the client will decide how to proceed" is stronger than a threat everybody knows
is empty.

CLOSE
Record the refusal and the reason in your own words. That note is what the client is shown, and
"refuses to pay" with no reason tells them nothing.

NEVER
- Never say legal action is coming unless the firm has instructions to take it.
- Never say an account is at legal stage because a section 129 notice has gone out. Section 129 is
  the statutory demand BEFORE court. It is not legal action, and saying so is a misrepresentation.
- Never raise your voice, and never make it personal.$b$,
 'refusing', 'en'),

('call-negotiating', 'call_script', 'Negotiating a settlement', null,
$b$OPEN
Good day, may I speak to {{debtor_name}}?
{{agent_name}} from {{firm_name}}, about account {{reference}}.

THE FIGURE IS THE CLIENT'S TO GIVE, NOT YOURS. A settlement offered without a mandate is one the
firm may have to honour. Take their proposal; do not make one.

ASK
What are you able to offer, and over what period?

WRITE IT DOWN EXACTLY
Amount, number of payments, first date. "A few thousand soon" is not an offer and cannot be put to
a client.

SAY WHAT HAPPENS NEXT
I will put this to {{client_name}} and come back to you. Nothing is agreed until we confirm it to
you in writing.

ASK FOR SOMETHING NOW
Whatever is agreed later, a payment now reduces the balance. Can you make one today?

CLOSE
Balance {{balance}}. Reference {{reference}}. {{agent_phone}}.

NEVER
- Never agree a settlement figure or a discount without the client's mandate.
- Never confirm a settlement verbally as final. It goes in writing or it did not happen.$b$,
 'negotiating', 'en'),

('call-disputed', 'call_script', 'Chasing a dispute', null,
$b$OPEN
Good day, may I speak to {{debtor_name}}?
{{agent_name}} from {{firm_name}}, about the query you raised on account {{reference}}.

DO NOT COLLECT ON THIS CALL. The account is disputed. Asking for money while a dispute is open is
what turns a dispute into a complaint.

THE PURPOSE IS TO MOVE THE DISPUTE
Either you need something from them, or they are waiting on the client. Say which.

IF YOU NEED SOMETHING FROM THEM
Name the one document or fact you need, and a date to have it by. Vague requests come back vague.

IF THE CLIENT IS SITTING ON IT
Say so honestly, say when you last chased, and give a date you will come back to them.

CLOSE
Confirm what each side is doing and by when. {{agent_phone}}.

NEVER
- Never press for payment while the dispute is open.
- Never tell a debtor their dispute is unfounded before the client has answered it.$b$,
 'disputed', 'en'),

-- THE HARDEST SCRIPT IN THE LIBRARY, AND THE SHORTEST. Every number on a trace is unverified, so
-- the person answering may be a neighbour, an employer or a stranger. Telling any of them that a
-- person owes money is a disclosure the firm cannot take back, so this script says nothing about
-- an account, a balance or a client. The firm's name is as far as it goes.
('call-tracing', 'call_script', 'Trace call to an unverified number', null,
$b$OPEN
Good day. I am trying to reach {{debtor_name}}. My name is {{agent_name}} from {{firm_name}}.

IF IT IS THE DEBTOR
Confirm the name and one other identifier, then move to the collection script for the account.

IF IT IS SOMEBODY ELSE
Please could you ask {{debtor_name}} to call {{agent_name}} on {{agent_phone}}.
Nothing further. Not the client, not the amount, not the word "account", not the word "debt".

IF THEY ASK WHAT IT IS ABOUT
It is a confidential matter and I can only discuss it with {{debtor_name}}.
Say it once, politely, and do not be drawn. "It is about money they owe" is the answer that costs
the firm a complaint.

IF THE NUMBER IS WRONG
Apologise, ask them to disregard the call, and mark the number wrong on the account so that nobody
rings it again.

CLOSE
Thank them for their time.

NEVER
- Never disclose that there is a debt, who the client is, or what is owed, to anybody who is not
  the debtor. This is the single rule this script exists for.
- Never leave the details on a voicemail you cannot confirm belongs to the debtor. Leave a name
  and a number only.
- Never tell a third party you are a debt collector if they have not asked who you are. Identify
  the firm, not the trade.$b$,
 'tracing', 'en')

on conflict (seed_key) do nothing;


-- ---------- Workflows, as data a person edits rather than code a developer deploys ----------
--
-- The firm's pre-legal workflow already exists on paper and keeps moving: the rotation rule
-- changed the week it was handed over, and the day-0 file review came out the week after. A
-- workflow written in code is a deployment every time a waiting period changes, and a waiting
-- period changes because an attorney read something.
--
-- FIVE TABLES AND NOT ONE. A single JSON blob would be quicker today and would make every later
-- question hard: which accounts are on which version, which node a file stopped at, whether this
-- notice has already gone out. Those are row questions.
create table if not exists public.workflows (
  id uuid primary key default gen_random_uuid(),
  -- Stable across every version, which is what an account in flight refers to.
  key text not null unique,
  name text not null,
  description text,
  domain text not null default 'collections' check (domain in ('collections', 'communications', 'sales')),
  -- Whose work it is. Reuses the existing teams table rather than inventing an owner.
  team_id uuid references public.teams (id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null
);

-- A PUBLISHED WORKFLOW IS NOT EDITED, IT IS SUPERSEDED.
--
-- This is not bookkeeping. A workflow sends statutory notices; "what did version 1 say when this
-- file went through it" is a question an attorney will ask about an account eighteen months from
-- now, and it cannot be answered by a record somebody has been editing in place.
create table if not exists public.workflow_versions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  version integer not null,
  -- draft     being written; the only state the builder may change
  -- active    published and running; frozen
  -- archived  superseded by a later version; frozen, and kept because accounts ran on it
  state text not null default 'draft' check (state in ('draft', 'active', 'archived')),
  notes text,
  published_at timestamptz,
  published_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  unique (workflow_id, version)
);

-- One active version per workflow, enforced rather than assumed: two actives is two answers to
-- "what happens to an account handed over today".
create unique index if not exists workflow_versions_one_active
  on public.workflow_versions (workflow_id) where state = 'active';

create table if not exists public.workflow_phases (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.workflow_versions (id) on delete cascade,
  ordinal smallint not null,
  name text not null,
  -- "Initial notices and engagement" -- the small line on the right of the dark bar.
  subtitle text,
  from_day integer not null,
  to_day integer not null,
  unique (version_id, ordinal)
);

create table if not exists public.workflow_nodes (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.workflow_versions (id) on delete cascade,
  phase_id uuid references public.workflow_phases (id) on delete set null,
  -- Stable within a version, so a connection or a note can name a step in words.
  key text not null,
  kind text not null check (kind in (
    'action', 'communication', 'document', 'task', 'assignment', 'wait'
  )),
  label text not null,
  description text,

  -- WHEN, AS AN ABSOLUTE DAY FROM THE HANDOVER, because that is what the firm's chart is labelled
  -- with and what they asked to edit: "the amount of days or on which day". A relative offset was
  -- tried and is better for re-ordering; it is worse for the thing this screen is for, which is
  -- reading a day number off a chart and typing it in.
  day integer not null,

  -- THE PERIOD THIS STEP GIVES THE DEBTOR, which is NOT the same as when the next step runs.
  --
  -- The firm's mockup had one control for both, labelled "wait period after completion". "Final
  -- notice -- seven days to settle" is two facts: the notice goes out on day 35 and the debtor has
  -- until day 42. Merged into one field nobody can say whose the seven days are, and they behave
  -- differently: a deadline does not move off a Saturday, because the debtor's clock does not stop
  -- when the office shuts.
  deadline_days integer,
  -- Calendar days are the debtor's clock; business days are the statutory one. "20" means two
  -- different dates and on a statutory period that is a notice to be served again.
  deadline_unit text check (deadline_unit is null or deadline_unit in ('calendar', 'business')),

  -- A communication node sends something. The template is the one the firm already writes in
  -- Settings; null while the wording has not been written, which is most of them.
  channel text check (channel is null or channel in (
    'email', 'sms', 'whatsapp', 'post', 'registered_post', 'call', 'hand'
  )),
  template_id uuid references public.message_templates (id) on delete set null,
  -- A notice the Act or the mandate requires rather than one the firm chooses to send. It is
  -- never re-issued when a file rejoins, and proof of dispatch is kept against it.
  statutory boolean not null default false,

  -- Who does it. Free text for now ('Current clerk', 'Team leader') rather than a profile, because
  -- a workflow is written once and run by whoever holds the file.
  assign_to text,

  -- VISUAL POSITION ONLY, and that is the whole point of it being separate from the connections.
  -- The firm asked that dragging a card must not silently re-order execution; it cannot, because
  -- nothing reads these to decide what runs next.
  x integer,
  y integer,
  ordinal smallint not null default 0,
  unique (version_id, key)
);

-- THE EDGES, AND THEY CAN LEAVE THE WORKFLOW.
--
-- to_workflow_id is here from the start although nothing uses it yet: the firm's next four
-- workflows -- payment arrangement, default, dispute, sequestration -- are entered FROM this one
-- and some of them come back. Adding the column later is easy; discovering that the design assumed
-- a connection always points at a node in the same version is not.
create table if not exists public.workflow_connections (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.workflow_versions (id) on delete cascade,
  from_node_id uuid not null references public.workflow_nodes (id) on delete cascade,
  to_node_id uuid references public.workflow_nodes (id) on delete cascade,
  -- Hands the account to another workflow. When it returns it returns to the day it left, which
  -- is the firm's own rule -- that is a fact about a RUN, not about a definition, and the run
  -- table is deliberately not built yet.
  to_workflow_id uuid references public.workflows (id) on delete set null,
  label text,
  check (num_nonnulls(to_node_id, to_workflow_id) = 1)
);

create index if not exists workflow_nodes_version_idx on public.workflow_nodes (version_id, day, ordinal);
create index if not exists workflow_connections_version_idx on public.workflow_connections (version_id, from_node_id);
create index if not exists workflow_phases_version_idx on public.workflow_phases (version_id, ordinal);

-- ---------- A published version is frozen, and the database is what says so ----------
--
-- In the form as well, but not ONLY in the form: a workflow will eventually be edited by a script,
-- a migration or an import, and every one of those goes round a React component. What must not
-- happen is an account's notices changing under it after the fact.
create or replace function public.workflow_version_is_draft(p_version uuid)
returns boolean
language sql
stable
security invoker
set search_path to 'public'
as $$
  select state = 'draft' from public.workflow_versions where id = p_version;
$$;

create or replace function public.refuse_frozen_workflow()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v uuid := coalesce(new.version_id, old.version_id);
begin
  if not public.workflow_version_is_draft(v) then
    raise exception 'This workflow version is published. Take a draft of it before changing anything.'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists workflow_nodes_frozen on public.workflow_nodes;
create trigger workflow_nodes_frozen before insert or update or delete on public.workflow_nodes
  for each row execute function public.refuse_frozen_workflow();

drop trigger if exists workflow_phases_frozen on public.workflow_phases;
create trigger workflow_phases_frozen before insert or update or delete on public.workflow_phases
  for each row execute function public.refuse_frozen_workflow();

drop trigger if exists workflow_connections_frozen on public.workflow_connections;
create trigger workflow_connections_frozen before insert or update or delete on public.workflow_connections
  for each row execute function public.refuse_frozen_workflow();

-- ---------- Row level security ----------
alter table public.workflows enable row level security;
alter table public.workflow_versions enable row level security;
alter table public.workflow_phases enable row level security;
alter table public.workflow_nodes enable row level security;
alter table public.workflow_connections enable row level security;

grant select, insert, update, delete on public.workflows to authenticated;
grant select, insert, update, delete on public.workflow_versions to authenticated;
grant select, insert, update, delete on public.workflow_phases to authenticated;
grant select, insert, update, delete on public.workflow_nodes to authenticated;
grant select, insert, update, delete on public.workflow_connections to authenticated;

-- EVERYONE READS. A collector has to be able to see what is going to happen to the file they are
-- holding, and a workflow nobody can read is a workflow nobody checks. WRITING IS NARROWER, which
-- is the point of a library: a workflow decides when a statutory notice goes out, and an agent who
-- could edit it in the moment would be rewriting the firm's process for every account at once.
do $$
declare t text;
begin
  foreach t in array array['workflows', 'workflow_versions', 'workflow_phases', 'workflow_nodes', 'workflow_connections']
  loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format(
      'create policy %1$s_select on public.%1$s for select to authenticated using (auth.uid() is not null)', t);
    execute format('drop policy if exists %1$s_write on public.%1$s', t);
    execute format(
      'create policy %1$s_write on public.%1$s for all to authenticated
         using (public.current_user_role() in (''Administrator'', ''Pre-legal Team Leader'', ''Liaison Manager''))
         with check (public.current_user_role() in (''Administrator'', ''Pre-legal Team Leader'', ''Liaison Manager''))', t);
  end loop;
end $$;

-- ---------- Taking a draft of a published version ----------
--
-- "Click Edit: create a Draft version." Copies the phases, the nodes and the edges, remapping the
-- edges onto the new node ids -- which is the whole reason this is a function and not four inserts
-- in the client: a connection copied with its old from_node_id points into the version it came
-- from, and the workflow silently runs half in each.
create or replace function public.workflow_take_draft(p_version uuid)
returns uuid
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_workflow uuid;
  v_next integer;
  v_draft uuid;
begin
  select workflow_id into v_workflow from public.workflow_versions where id = p_version;
  if v_workflow is null then raise exception 'No such workflow version.'; end if;

  -- One draft at a time. A second draft off the same workflow is two people editing two futures.
  select id into v_draft from public.workflow_versions
   where workflow_id = v_workflow and state = 'draft' limit 1;
  if v_draft is not null then return v_draft; end if;

  select coalesce(max(version), 0) + 1 into v_next
    from public.workflow_versions where workflow_id = v_workflow;

  insert into public.workflow_versions (workflow_id, version, state, created_by)
  values (v_workflow, v_next, 'draft', auth.uid())
  returning id into v_draft;

  create temp table _phase_map (old uuid, new uuid) on commit drop;
  create temp table _node_map (old uuid, new uuid) on commit drop;

  insert into public.workflow_phases (version_id, ordinal, name, subtitle, from_day, to_day)
  select v_draft, ordinal, name, subtitle, from_day, to_day
    from public.workflow_phases where version_id = p_version order by ordinal;
  insert into _phase_map
  select o.id, n.id from public.workflow_phases o
    join public.workflow_phases n on n.version_id = v_draft and n.ordinal = o.ordinal
   where o.version_id = p_version;

  insert into public.workflow_nodes (
    version_id, phase_id, key, kind, label, description, day, deadline_days, deadline_unit,
    channel, template_id, statutory, assign_to, x, y, ordinal)
  select v_draft, m.new, o.key, o.kind, o.label, o.description, o.day, o.deadline_days,
         o.deadline_unit, o.channel, o.template_id, o.statutory, o.assign_to, o.x, o.y, o.ordinal
    from public.workflow_nodes o
    left join _phase_map m on m.old = o.phase_id
   where o.version_id = p_version;
  insert into _node_map
  select o.id, n.id from public.workflow_nodes o
    join public.workflow_nodes n on n.version_id = v_draft and n.key = o.key
   where o.version_id = p_version;

  insert into public.workflow_connections (version_id, from_node_id, to_node_id, to_workflow_id, label)
  select v_draft, f.new, t.new, o.to_workflow_id, o.label
    from public.workflow_connections o
    join _node_map f on f.old = o.from_node_id
    left join _node_map t on t.old = o.to_node_id
   where o.version_id = p_version;

  return v_draft;
end;
$$;

grant execute on function public.workflow_take_draft(uuid) to authenticated;

-- Publishing swaps them over in one statement, so there is never a moment with no active version
-- and never a moment with two.
create or replace function public.workflow_publish(p_version uuid)
returns void
language plpgsql
security invoker
set search_path to 'public'
as $$
declare v_workflow uuid;
begin
  select workflow_id into v_workflow from public.workflow_versions where id = p_version;
  if v_workflow is null then raise exception 'No such workflow version.'; end if;
  update public.workflow_versions set state = 'archived'
   where workflow_id = v_workflow and state = 'active';
  update public.workflow_versions
     set state = 'active', published_at = now(), published_by = auth.uid()
   where id = p_version;
end;
$$;

grant execute on function public.workflow_publish(uuid) to authenticated;

-- ---------- Standard Collections, day 0 to day 80 ----------
--
-- The firm's own sequence, transcribed. The branch-heavy version that used to hang off it --
-- payment arrangement, default, dispute, sequestration, liquidation -- is deliberately NOT here:
-- each becomes a workflow of its own, entered from this one through a connection that carries a
-- to_workflow_id. This is the main line and nothing else.
--
-- SEEDED AS A DRAFT, not as active, and that is a deliberate disagreement with the mockup's
-- "Active" badge. A published version is frozen by a trigger, so a workflow labelled active that
-- anybody can still edit would be a label contradicting the rule underneath it. It publishes with
-- one press, and from then on editing takes a draft.
do $$
declare
  v_workflow uuid;
  v_version uuid;
  v_notice uuid;
  v_legal uuid;
  v_team uuid;
begin
  if exists (select 1 from public.workflows where key = 'standard-collections') then return; end if;

  select id into v_team from public.teams where name ilike '%pre-legal%' limit 1;

  insert into public.workflows (key, name, description, domain, team_id)
  values ('standard-collections', 'Standard Collections – Non-Paying Debtor',
          'Main collection workflow for non-paying debtors. Day 0 to Day 80.', 'collections', v_team)
  returning id into v_workflow;

  insert into public.workflow_versions (workflow_id, version, state)
  values (v_workflow, 1, 'draft') returning id into v_version;

  insert into public.workflow_phases (version_id, ordinal, name, subtitle, from_day, to_day)
  values (v_version, 1, 'Phase 1 · Notice', 'Initial notices and engagement', 0, 40)
  returning id into v_notice;
  insert into public.workflow_phases (version_id, ordinal, name, subtitle, from_day, to_day)
  values (v_version, 2, 'Phase 2 · Legal', 'Legal process and preparation', 40, 80)
  returning id into v_legal;

  insert into public.workflow_nodes
    (version_id, phase_id, key, kind, label, description, day, deadline_days, deadline_unit,
     channel, statutory, assign_to, x, y, ordinal)
  values
    (v_version, v_notice, 'handover-received', 'action', 'Handover Received',
     'The account arrives from the client and opens on the book.', 0, null, null,
     null, false, 'Current clerk', 0, 0, 1),

    (v_version, v_notice, 'demand-129', 'communication', 'Demand + Section 129',
     'Issue demand and section 129 notice via registered post. Section 129 is the statutory demand BEFORE court — the account is in progress, not legal.',
     1, null, null, 'registered_post', true, 'Current clerk', 1, 0, 2),

    (v_version, v_notice, 'intention-to-list', 'communication', 'Intention to List',
     'Notify the debtor of the intention to list with a credit bureau.',
     10, 20, 'business', 'registered_post', true, 'Current clerk', 2, 0, 3),

    (v_version, v_notice, 'follow-up-offer', 'communication', 'Follow-up + Offer',
     'Follow up and put terms the debtor can keep.', 21, null, null, 'email', false, 'Current clerk', 3, 0, 4),

    (v_version, v_notice, 'final-notice', 'communication', 'Final Notice',
     'Issue final notice with 7 days to settle.', 35, 7, 'calendar',
     'registered_post', true, 'Current clerk', 4, 0, 5),

    (v_version, v_notice, 'rotate-clerk-2', 'assignment', 'Rotate to Clerk 2',
     'The file moves to the second clerk.', 40, null, null, null, false, 'Clerk 2', 5, 0, 6),

    (v_version, v_legal, 'listing-confirmed', 'action', 'Listing Confirmed',
     'The bureau listing is confirmed on the file.', 42, null, null, null, false, 'Current clerk', 0, 1, 7),

    (v_version, v_legal, 'intended-legal-action', 'communication', 'Intended Legal Action',
     'Debtor placed in mora.', 50, null, null, 'registered_post', true, 'Current clerk', 1, 1, 8),

    (v_version, v_legal, 'court-process-explained', 'communication', 'Court Process Explained',
     'Explain what happens next and what it will cost.', 60, null, null, 'email', false, 'Current clerk', 2, 1, 9),

    (v_version, v_legal, 'final-settlement-window', 'communication', 'Final Settlement Window',
     'The last window to settle before the file goes to the attorney.', 70, null, null,
     'email', false, 'Current clerk', 3, 1, 10),

    (v_version, v_legal, 'draft-summons', 'document', 'Draft Summons',
     'Draft the summons and put it up for attorney sign-off.', 75, null, null,
     null, false, 'Team leader', 4, 1, 11),

    (v_version, v_legal, 'rotate-clerk-3', 'assignment', 'Rotate to Clerk 3',
     'The file moves to the third clerk.', 80, null, null, null, false, 'Clerk 3', 5, 1, 12);

  -- The line, in order. Eleven edges for twelve steps.
  insert into public.workflow_connections (version_id, from_node_id, to_node_id)
  select v_version, a.id, b.id
    from public.workflow_nodes a
    join public.workflow_nodes b
      on b.version_id = a.version_id and b.ordinal = a.ordinal + 1
   where a.version_id = v_version;
end $$;

-- ---------- Who this person has written to before ----------
--
-- The firm: "if I've sent an email to Reno, I can paste in R, E, N, and then it picks it up."
-- Nothing remembered anything: the compose box offered a datalist built only from whoever was
-- already attached to the client, lead or deal in front of you, so the address of somebody you
-- wrote to last week was a thing you had to go and find again.
--
-- DERIVED, NOT STORED. An address book is a second copy of the mailbox and it goes stale the day
-- somebody changes a domain -- and worse, it is a copy of personal information kept for no reason
-- beyond convenience, which is a POPIA answer nobody wants to give. This reads the sent mail that
-- already exists and is thrown away after every call.
--
-- PER USER, AND ONLY THEIR OWN SENT MAIL. Whose desk an address came off is the whole point: a
-- collector's suggestions must not be the floor's, both because it would be useless and because
-- one agent's correspondents are not another agent's business.
create table if not exists public.mail_recipient_hidden (
  -- "You should be able to press a little X button next to it if it's wrong or you didn't like
  -- it." A dismissal has to persist or the X is a joke: the address comes straight back off the
  -- next query, because the sent message it was derived from is still there.
  user_id uuid not null references public.profiles (id) on delete cascade,
  address text not null,
  hidden_at timestamptz not null default now(),
  primary key (user_id, address)
);

alter table public.mail_recipient_hidden enable row level security;
grant select, insert, delete on public.mail_recipient_hidden to authenticated;

-- YOUR OWN ONLY, READ AND WRITE. This is the one table in Raptor where read-open would be wrong:
-- the rest of the debtor side is open because a team leader has to see what an agent is sitting
-- on, and a list of the people somebody has chosen to stop being reminded of is not that.
drop policy if exists mail_recipient_hidden_own on public.mail_recipient_hidden;
create policy mail_recipient_hidden_own on public.mail_recipient_hidden
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.mail_recipient_history(p_limit integer default 200)
returns table (address text, name text, uses integer, last_used timestamptz)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with sent as (
    -- The mailbox: the To line, and everyone on the To and Cc lists of a message this person sent.
    -- to_recipients carries the full list where there was more than one, and to_address carries
    -- the first; taking only one of the two loses either the extra recipients or the older
    -- messages written before the list column existed.
    select lower(btrim(u.to_address)) as address, nullif(btrim(u.to_name), '') as name, u.occurred_at
      from public.user_emails u
     where u.user_id = auth.uid() and u.is_sent and u.to_address is not null
    union all
    select lower(btrim(r->>'address')), nullif(btrim(r->>'name'), ''), u.occurred_at
      from public.user_emails u
      cross join lateral jsonb_array_elements(coalesce(u.to_recipients, '[]'::jsonb) || coalesce(u.cc_recipients, '[]'::jsonb)) r
     where u.user_id = auth.uid() and u.is_sent and r->>'address' is not null
    union all
    -- Mail sent to a debtor from an account screen, which never passes through the mailbox table.
    select lower(btrim(a.debtor_address)), null, a.occurred_at
      from public.account_emails a
     where a.sent_by = auth.uid() and a.direction = 'out' and a.debtor_address is not null
  ),
  clean as (
    select s.address,
           -- The most recent name seen for the address wins. A person who marries, or a shared
           -- mailbox that is renamed, should not be suggested under the name they had in 2019.
           (array_agg(s.name order by s.occurred_at desc) filter (where s.name is not null))[1] as name,
           count(*)::integer as uses,
           max(s.occurred_at) as last_used
      from sent s
     where s.address <> ''
       -- An address has to look like one. A malformed To line in an old message would otherwise be
       -- offered for ever as something nobody can ever successfully send to.
       and s.address ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
       -- Never suggest the person back to themselves.
       and s.address is distinct from (select lower(p.email) from public.profiles p where p.id = auth.uid())
       and not exists (
         select 1 from public.mail_recipient_hidden h
          where h.user_id = auth.uid() and h.address = s.address
       )
     group by s.address
  )
  -- Most used first, then most recent. Frequency beats recency on purpose: the person you write
  -- to every week should be the first suggestion even on a day you happened to write to somebody
  -- else, and an address used once six months ago should not outrank them for having been typed
  -- more recently.
  select address, name, uses, last_used from clean
   order by uses desc, last_used desc
   limit greatest(1, least(p_limit, 500));
$$;

grant execute on function public.mail_recipient_history(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- WHO ELSE WAS ON THE MESSAGE, on a record's copy of it.
-- ---------------------------------------------------------------------------
-- user_emails has carried these since reply-all was built for the mailbox. The record's copies --
-- a debtor account's correspondence, and a lead/deal/client's email activity -- did not, so
-- answering from the account it belongs to could only ever reply to one person. A client who
-- copies two of their own people, or a debtor whose attorney is on the thread, arrived looking
-- like a private message.
--
-- Whole lists with names, as the message carried them: a reply-all has to reach exactly the
-- people the original did, and a name is what lets somebody check that before they send.
alter table public.account_emails add column if not exists to_recipients jsonb not null default '[]'::jsonb;
alter table public.account_emails add column if not exists cc_recipients jsonb not null default '[]'::jsonb;

comment on column public.account_emails.to_recipients is
  'Everyone on To, as [{name, address}] in the order the message carried them. Empty on rows '
  'filed before this column existed, which reads as "nobody else known" and hides reply-all.';
comment on column public.account_emails.cc_recipients is
  'Everyone on Cc. Bcc is deliberately absent: it is not in the message we received, and a list '
  'that looked complete while missing people would be worse than no list.';

alter table public.activities add column if not exists email_to_recipients jsonb not null default '[]'::jsonb;
alter table public.activities add column if not exists email_cc_recipients jsonb not null default '[]'::jsonb;

comment on column public.activities.email_to_recipients is
  'Everyone on To of a synced Email activity, as [{name, address}]. Prefixed email_ because '
  'activities covers calls, notes and meetings too, and only an Email row ever fills these.';
comment on column public.activities.email_cc_recipients is
  'Everyone on Cc of a synced Email activity. Bcc is absent for the same reason as above.';

-- ---------------------------------------------------------------------------
-- WHICH SIDE OF THE BUSINESS A TEMPLATE IS FOR.
-- ---------------------------------------------------------------------------
-- Not a folder. The scope decides three things at once, and getting it wrong is not untidy, it is
-- unsendable or it mischarges:
--   - which merge fields exist. {{balance}} and {{arrears_amount}} mean nothing on a lead;
--     {{service_interested}} means nothing on an account.
--   - whether sending raises a fee. Collections raises Annexure B item 1(a)/1(c); the sales side
--     raises nothing, and fees are charged on ACCOUNTS ONLY.
--   - which workflow clock applies -- days since handover on one side, days since last contact on
--     the other.
--
-- Two values, not four. A deal hangs off a lead OR a client, so it is a stage of one relationship
-- rather than a party of its own: the firm's own answer, and the reason there is no 'deals'.
-- Clients get a broadcast channel rather than a library; see the campaigns work.
alter table public.message_templates
  add column if not exists scope text not null default 'collections';

alter table public.message_templates drop constraint if exists message_templates_scope_check;
alter table public.message_templates add constraint message_templates_scope_check
  check (scope in ('collections', 'sales'));

comment on column public.message_templates.scope is
  'collections = written against a debtor account; sales = written against a lead, deal or '
  'prospect. Decides the merge fields offered, whether sending raises a fee, and which library '
  'the template appears in. Everything seeded before this column existed is collections.';

-- LETTERS ARE A KIND, and the constraint already allows them on this database -- widened by
-- another session on 20 September 2026 without reaching the checked-in schema. Restated here so
-- that replaying this file produces the database that actually exists.
alter table public.message_templates drop constraint if exists message_templates_kind_check;
alter table public.message_templates add constraint message_templates_kind_check
  check (kind in ('sms', 'email', 'call_script', 'letter'));

-- A POSITION IS A COLLECTIONS IDEA. The 13 rungs describe a debtor account; a sales template
-- carrying one would be filed against a state its side of the business does not have.
alter table public.message_templates drop constraint if exists message_templates_position_scope;
alter table public.message_templates add constraint message_templates_position_scope
  check (position is null or scope = 'collections');

-- The resolver reads live templates of one kind on one side. Replaces the kind-only index, which
-- would have every sales template scanned on the way to a collections one.
drop index if exists message_templates_kind_idx;
create index if not exists message_templates_scope_kind_idx
  on public.message_templates (scope, kind, position, language)
  where active;

-- ---------------------------------------------------------------------------
-- THE LIBRARY IS AN ADMINISTRATOR'S, AND ONLY AN ADMINISTRATOR'S.
-- ---------------------------------------------------------------------------
-- The firm, asked who maintains it: "collectors can't see the library because collectors don't
-- build it. That's only basically administrators. Team leaders neither. They can't build this."
--
-- The policies above were written before that answer and let a Pre-legal Team Leader and a
-- Liaison Manager write too. The page already refuses them, but a page is not a boundary -- the
-- same write goes through PostgREST with a token anybody signed in has. The rule belongs here,
-- and the screen only stops the app offering a button that would appear to work.
--
-- Reading stays open to everyone signed in. That is deliberate and it is not the same question:
-- an agent has to be able to see the script they are meant to read aloud, and a campaign runner
-- resolves these rows against the account in front of them.
drop policy if exists message_templates_insert on public.message_templates;
create policy message_templates_insert on public.message_templates
  for insert to authenticated with check (
    public.current_user_role() = 'Administrator'
  );

drop policy if exists message_templates_update on public.message_templates;
create policy message_templates_update on public.message_templates
  for update to authenticated
  using (public.current_user_role() = 'Administrator')
  with check (public.current_user_role() = 'Administrator');

-- ---------------------------------------------------------------------------
-- AN EMAIL THAT CARRIES A LETTER.
-- ---------------------------------------------------------------------------
-- The section 129 covering email says "attached is a notice issued in terms of section
-- 129(1)(a)" -- and until now nothing in Raptor connected those two rows. The wording claimed an
-- attachment the system had no idea about, which is the worst kind of gap: it reads as finished.
--
-- The firm: "it should be clear which email templates are accompanied by a letter... it should
-- show that there's an attachment, and if you click on it, it basically opens the letter that is
-- attached to it and then you can close it again. Just to ensure that these things are correct."
--
-- `on delete set null` rather than cascade or restrict: deleting the letter must not delete the
-- email that sent it. The silent half of that -- an email quietly left claiming an attachment it
-- no longer has -- is caught in the library before the delete, not here. See templateUsage.
alter table public.message_templates
  add column if not exists attachment_id uuid references public.message_templates (id) on delete set null;

comment on column public.message_templates.attachment_id is
  'The letter this email attaches, where it attaches one. Only an email may carry one and only a '
  'letter may be carried — enforced by the trigger below, because a check constraint cannot read '
  'the referenced row.';

-- ONLY AN EMAIL MAY CARRY ONE. This half a plain check can express: it reads one column of one
-- row. The other half cannot, which is what the trigger is for.
alter table public.message_templates drop constraint if exists message_templates_attachment_kind;
alter table public.message_templates add constraint message_templates_attachment_kind
  check (attachment_id is null or kind = 'email');

-- AND THE THING CARRIED MUST BE A LETTER, ON THE SAME SIDE.
--
-- A trigger rather than a constraint because it has to read the row being pointed AT: no check
-- constraint can. Enforced here and not only in the form, for the reason the library's own write
-- policy was narrowed this morning -- a form is not a boundary, and the same write goes through
-- PostgREST with a token anybody signed in has.
create or replace function public.check_template_attachment()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  attached record;
begin
  if new.attachment_id is null then
    return new;
  end if;
  if new.attachment_id = new.id then
    raise exception 'A template cannot attach itself.';
  end if;
  select kind, scope into attached from public.message_templates where id = new.attachment_id;
  if attached.kind is distinct from 'letter' then
    raise exception 'Only a letter can be attached to an email (tried to attach a %).', attached.kind;
  end if;
  if attached.scope is distinct from new.scope then
    raise exception 'A % email cannot attach a % letter.', new.scope, attached.scope;
  end if;
  return new;
end;
$$;

drop trigger if exists check_template_attachment on public.message_templates;
create trigger check_template_attachment
  before insert or update of attachment_id, kind, scope on public.message_templates
  for each row execute function public.check_template_attachment();

-- The one query the library makes of it: "which emails attach this letter?", asked before the
-- letter is deleted. Partial, because almost every row has no attachment.
create index if not exists message_templates_attachment_idx
  on public.message_templates (attachment_id) where attachment_id is not null;

-- The covering email carries the notice it says is attached. Idempotent on seed_key, like every
-- other seed here, so replaying this file does not undo a later change the firm made.
update public.message_templates e
set attachment_id = l.id
from public.message_templates l
where e.seed_key = 'email-s129-covering' and l.seed_key = 'letter-s129'
  and e.attachment_id is null;

-- ---------------------------------------------------------------------------
-- ONE RULE FOR THE WHOLE LIBRARY: everyone reads it, an administrator writes it.
--
-- At the firm's instruction, reversing an earlier one: "perhaps everyone can view everything in
-- the library. Only [an administrator] can edit." The earlier rule kept collectors out of the
-- library altogether; the newer one is better, because a collector reading a script on a live
-- call benefits from seeing the whole ladder it sits on, and the risk a library carries is in
-- WRITING it rather than in reading it.
--
-- message_templates already read this way. The workflow tables did not: writing was open to a
-- Pre-legal Team Leader and a Liaison Manager as well. Now that a workflow is built IN the
-- library, it has to follow the library's rule -- and a workflow is the firm's wording in another
-- form, because it decides WHEN a statutory notice goes out.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['workflows', 'workflow_versions', 'workflow_phases', 'workflow_nodes', 'workflow_connections']
  loop
    -- Reading stays open to every authenticated user, unchanged: a collector has to be able to
    -- see what is going to happen to the file they are holding, and a workflow nobody can read
    -- is a workflow nobody checks.
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format(
      'create policy %1$s_select on public.%1$s for select to authenticated using (auth.uid() is not null)', t);

    execute format('drop policy if exists %1$s_write on public.%1$s', t);
    execute format(
      'create policy %1$s_write on public.%1$s for all to authenticated
         using (public.current_user_role() = ''Administrator'')
         with check (public.current_user_role() = ''Administrator'')', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- THE STORED WORKFLOW WAS AN EARLIER TRANSCRIPTION OF THE SAME CHART.
--
-- workflows/standard-collections held a day 1 to 80 version of "BF · PRE-LEGAL COLLECTIONS --
-- 160 DAY WORKFLOW", taken from the mockup. src/lib/preLegalWorkflow.ts holds the reviewed one,
-- with the two corrections the firm asked for -- and the two disagreed in exactly those places,
-- which is the worst way for two copies of a process to differ:
--
--   1. ROTATION WAS STILL IN THE SPINE ("Rotate to Clerk 2" on day 40, "Clerk 3" on day 80).
--      The firm moved it out: rotation is a calendar rule -- the 5th, two months on, in
--      workflowSchedule.ts -- so that no allocation decision can move the date of a section 129.
--      A notice stays anchored to the FILE and goes out on its day whoever is holding it.
--   2. IT STOPPED AT DAY 80. The corrected spine runs to day 160 and ends in a recommendation
--      back to the client; open strategy, viability review, closure report and the
--      recommendation itself were all missing.
--
-- Also gone: "Handover received / validate file". The firm took it out -- "we don't upload files
-- that are not collectible" -- because a step every file passes is a step nobody reads. What that
-- moves upstream is prescription (NCA s126B), which is now a flag set at import and is NOT
-- re-checked anywhere in this workflow.
--
-- TWO PLACES THE BUILDER CANNOT YET SAY WHAT THE DEFINITION SAYS, recorded rather than papered
-- over:
--
--   - "Listing confirmed" is twenty BUSINESS days after the intention to list, not a fixed day.
--     workflow_nodes.day is an absolute calendar day, so 42 is stored -- that sum in an ordinary
--     month. The rule itself is not lost: it is the 20 business days on the intention step, which
--     is where the statutory period actually belongs.
--   - The chart ends in a DECISION diamond and workflow_nodes has no decision kind. It is stored
--     as the task of making the recommendation, and the description says so.
--
-- Written against the DRAFT version, which the freeze trigger allows. demand-129 keeps the
-- section 129 letter it is already wired to, because the upsert is keyed on (version_id, key)
-- and never touches template_id.
-- ---------------------------------------------------------------------------
do $$
declare
  v uuid;
  p_notice uuid; p_legal uuid; p_open uuid;
begin
  select id into v from workflow_versions
   where workflow_id = (select id from workflows where key = 'standard-collections')
     and state = 'draft';
  if v is null then
    raise notice 'No draft version of standard-collections here; nothing to bring up to date.';
    return;
  end if;

  -- A third phase, which the 80-day version had no need of.
  insert into workflow_phases (version_id, ordinal, name, subtitle, from_day, to_day)
  values (v, 1, 'Phase 1 · Notice', 'Demand, listing and the final notice', 0, 40),
         (v, 2, 'Phase 2 · Legal', 'Mora, the court process and the summons', 40, 80),
         (v, 3, 'Phase 3 · Open', 'Strategy, viability and the recommendation', 80, 160)
  on conflict (version_id, ordinal) do update
    set name = excluded.name, subtitle = excluded.subtitle,
        from_day = excluded.from_day, to_day = excluded.to_day;

  select id into p_notice from workflow_phases where version_id = v and ordinal = 1;
  select id into p_legal  from workflow_phases where version_id = v and ordinal = 2;
  select id into p_open   from workflow_phases where version_id = v and ordinal = 3;

  insert into workflow_nodes
    (version_id, phase_id, key, kind, label, description, day, deadline_days, deadline_unit,
     channel, statutory, assign_to, ordinal)
  values
    (v, p_notice, 'handover-notice', 'communication', 'Handover notice', 'Tells the debtor the account has been handed to us, and by whom.', 0, null, null, 'post', false, 'Current clerk', 1),
    (v, p_notice, 'demand-129', 'communication', 'Demand and section 129', 'Registered post. Section 129 is the statutory demand BEFORE court - this file is in progress, not legal.', 1, null, null, 'registered_post', true, 'Current clerk', 2),
    (v, p_notice, 'intention-to-list', 'communication', 'Intention to list', 'Gives the debtor 20 business days to respond before the listing is confirmed.', 10, 20, 'business', 'registered_post', true, 'Current clerk', 3),
    (v, p_notice, 'follow-up-offer', 'communication', 'Follow-up and offer', null, 21, null, null, 'email', false, 'Current clerk', 4),
    (v, p_notice, 'final-notice', 'communication', 'Final notice', 'Seven days to settle.', 35, 7, 'calendar', 'registered_post', true, 'Current clerk', 5),
    (v, p_legal, 'listing-confirmed', 'action', 'Listing confirmed', 'Twenty BUSINESS days after the intention to list. The 42 stored here is that sum in an ordinary month; the rule itself is the 20 business days on the intention step.', 42, null, null, null, false, 'Current clerk', 6),
    (v, p_legal, 'intended-legal-action', 'communication', 'Intended legal action', 'Debtor placed in mora.', 50, null, null, 'registered_post', true, 'Current clerk', 7),
    (v, p_legal, 'court-process-explained', 'communication', 'Court process explained', null, 60, null, null, 'email', false, 'Current clerk', 8),
    (v, p_legal, 'final-settlement-window', 'communication', 'Final settlement window', null, 70, null, null, 'email', false, 'Current clerk', 9),
    (v, p_legal, 'draft-summons', 'task', 'Draft summons', 'Draft the summons and put it up for attorney sign-off.', 75, null, null, null, false, 'Team leader', 10),
    (v, p_open, 'open-strategy', 'task', 'Open strategy', 'Set the open strategy for this file.', 80, null, null, null, false, 'Current clerk', 11),
    (v, p_open, 'viability-review', 'task', 'Viability review', 'Review whether this file is still worth working.', 110, null, null, null, false, 'Current clerk', 12),
    (v, p_open, 'closure-report', 'task', 'Closure report', 'Write the closure report for the client.', 155, null, null, null, false, 'Current clerk', 13),
    (v, p_open, 'recommendation', 'task', 'Recommendation', 'Returned to the client with a recommendation: litigate, trace and hold, or write off. The builder has no decision step yet, so the chart''s final diamond is stored as the job of making it.', 160, null, null, null, false, 'Team leader', 14)
  on conflict (version_id, key) do update
    set phase_id = excluded.phase_id, kind = excluded.kind, label = excluded.label,
        description = excluded.description, day = excluded.day,
        deadline_days = excluded.deadline_days, deadline_unit = excluded.deadline_unit,
        channel = excluded.channel, statutory = excluded.statutory,
        assign_to = excluded.assign_to, ordinal = excluded.ordinal;

  -- The rotations and the validate-file step. Deleted by ABSENCE from the list above rather than
  -- by name, so this stays true the next time a step leaves the chart.
  delete from workflow_nodes
   where version_id = v
     and key not in ('handover-notice','demand-129','intention-to-list','follow-up-offer',
                     'final-notice','listing-confirmed','intended-legal-action',
                     'court-process-explained','final-settlement-window','draft-summons',
                     'open-strategy','viability-review','closure-report','recommendation');

  -- Rebuilt rather than patched: an edge left pointing at a deleted step is the one failure that
  -- does not show on the canvas, because nothing is drawn where the other end used to be.
  delete from workflow_connections where version_id = v;
  insert into workflow_connections (version_id, from_node_id, to_node_id)
  select v, a.id, b.id
    from workflow_nodes a
    join workflow_nodes b on b.version_id = v and b.ordinal = a.ordinal + 1
   where a.version_id = v;
end $$;

-- The firm's own title for the chart, rather than the mockup's. The key does not change, so
-- nothing that links to this workflow breaks.
update public.workflows
   set name = 'Pre-legal collections',
       description = 'Handover to a recommendation, with five ways a file can leave the sequence and come back.'
 where key = 'standard-collections';

-- ---------------------------------------------------------------------------
-- THE FIRM'S LETTERHEAD, AND LETTERS THAT ARE MORE THAN A PARAGRAPH.
--
-- At the firm's instruction: "I think there needs to be a place where you upload your letterhead,
-- no?" Yes -- and it has to carry the PAGE SETUP with it, not just the picture. BF_Letterhead_Aug
-- _2026 is a full-page A4 image with no text of its own; everything it says is drawn, so the only
-- thing that keeps body text off the logo and out of the footer block is the margins. A letterhead
-- stored without them is a letterhead somebody has to re-measure every time.
-- ---------------------------------------------------------------------------
create table if not exists public.letterheads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- The image in the 'letterheads' bucket. A full-page background, which is what a designed
  -- letterhead is: the logo, the rule down the side and the footer block are all one picture.
  storage_path text not null,
  -- A4 in millimetres. Held per row rather than assumed, because a letterhead is sometimes drawn
  -- for Letter when a client is overseas, and a page that silently renders at the wrong size is
  -- a notice with its margins in the wrong place.
  width_mm numeric(6,2) not null default 210,
  height_mm numeric(6,2) not null default 297,
  -- MEASURED FROM THE FIRM'S OWN FILE, not guessed. Its Word page setup is 37.5mm top and 20mm on
  -- the other three. The bottom is the one number changed: the footer block -- phone, email,
  -- company and VAT numbers -- starts at 279.8mm, so a 20mm bottom margin lets body text run
  -- about three millimetres into it. Invisible until a paragraph reaches the foot of the page,
  -- which on a two-page notice is most of the time.
  margin_top_mm numeric(6,2) not null default 37.5,
  margin_right_mm numeric(6,2) not null default 20,
  margin_bottom_mm numeric(6,2) not null default 24,
  margin_left_mm numeric(6,2) not null default 20,
  -- The one a new letter opens on. Exactly one, enforced below.
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ONE DEFAULT, AND THE DATABASE IS WHAT SAYS SO. Two rows both claiming to be the default is a
-- letter that prints on whichever one the query happened to return first -- which is the kind of
-- fault that is correct in testing and wrong in production, because the ordering changes.
create unique index if not exists letterheads_one_default
  on public.letterheads ((true)) where is_default;

alter table public.letterheads enable row level security;
grant select, insert, update, delete on public.letterheads to authenticated;

-- The library's rule, because a letterhead is part of what the firm says: everyone reads it --
-- a collector previewing a notice has to see the page it prints on -- and an administrator
-- writes it.
drop policy if exists letterheads_select on public.letterheads;
create policy letterheads_select on public.letterheads
  for select to authenticated using (auth.uid() is not null);

drop policy if exists letterheads_write on public.letterheads;
create policy letterheads_write on public.letterheads
  for all to authenticated
  using (public.current_user_role() = 'Administrator')
  with check (public.current_user_role() = 'Administrator');

-- PUBLIC BUCKET, like email-signatures and for the same reason: the page is drawn with the
-- letterhead as a CSS background, and a signed URL that expires mid-preview is a letter that
-- loses its letterhead while somebody is reading it. This is not a secret -- it is printed on
-- every letter the firm posts.
insert into storage.buckets (id, name, public)
values ('letterheads', 'letterheads', true)
on conflict (id) do nothing;

drop policy if exists "letterheads_read" on storage.objects;
create policy "letterheads_read" on storage.objects
  for select using (bucket_id = 'letterheads');

drop policy if exists "letterheads_write" on storage.objects;
create policy "letterheads_write" on storage.objects
  for all to authenticated
  using (bucket_id = 'letterheads' and public.current_user_role() = 'Administrator')
  with check (bucket_id = 'letterheads' and public.current_user_role() = 'Administrator');

-- ---------------------------------------------------------------------------
-- A TEMPLATE'S BODY IS NOT ALWAYS A PARAGRAPH ANY MORE.
--
-- An SMS body is text and always will be. A letter body is a document -- headings, numbered
-- sections, three tables, bullets -- and it is stored as JSON in the same column, because a
-- second body column would mean every reader has to know which one to look in and one of them
-- would eventually be the wrong one.
--
-- The column says which it is. Defaulting to 'text' means every row that exists now is correct
-- without being touched.
-- ---------------------------------------------------------------------------
alter table public.message_templates
  add column if not exists format text not null default 'text';

alter table public.message_templates
  drop constraint if exists message_templates_format_check;
alter table public.message_templates
  add constraint message_templates_format_check check (format in ('text', 'document'));

-- Only a letter carries a document. An SMS holding a JSON blob would be charged by the segment
-- for its own punctuation, and nothing would have said so.
alter table public.message_templates
  drop constraint if exists message_templates_format_kind;
alter table public.message_templates
  add constraint message_templates_format_kind
  check (format = 'text' or kind = 'letter');

comment on column public.message_templates.format is
  'text = the body is what it looks like. document = the body is a letterDocument JSON, which '
  'only a letter may be.';
-- ---------------------------------------------------------------------------
-- THE SECTION 129, REVISED AFTER THE FIRM READ IT ON PAPER.
--
-- Their notes on the first PDF, each one a change here:
--
--   * The date strip was "scattered". It was two rows -- labels above values, spread across the
--     full width -- and their own v9 puts label beside value, three pairs on ONE line. Now it
--     does too, and it reads as a set rather than as six loose things.
--   * The numbering had no full stops. "1." rather than "1", which is what makes it read as
--     numbering rather than as a digit that wandered in beside a heading.
--   * The creditor's name is bold in the opening sentence: it is the one fact in it the debtor
--     has to register. "This is a formal legal notice." is bold and "Please read it." is not --
--     bolding both made the instruction shout and the statement whisper.
--   * "How to resolve this" sat alone at the foot of a page. Headings now keep with what follows
--     them, and "Yours faithfully" keeps with its signature, which had the same fault one block
--     later: a letter that appears to end without being signed.
--   * A RULED LINE TO SIGN ON, rather than nothing.
--   * "duly authorised LEGAL REPRESENTATIVE of", not "agent of". The firm is not the creditor's
--     agent.
--   * The delivery paragraph is gone. It described registered post, and this notice is emailed.
--   * The running line moved from the head of the page to the FOOT, clear of the letterhead.
--
--   * AND THE LEGAL PROCESS IS IN PLAIN WORDS. The firm: "maybe we could put this a little bit in
--     more layman's terms, so that the people understand -- it's not always smart people that
--     read this stuff." Every row now says what HAPPENS TO YOU rather than naming the instrument
--     that does it: "Your things can be sold" before "warrant of execution", "Money comes off
--     your salary" before "emoluments attachment order". The legal term is kept in brackets where
--     a debtor will meet it again on a court document, so they can match the two.
--
-- Every fact is still a merge field. This repository is public.
-- ---------------------------------------------------------------------------
update public.message_templates
   set format = 'document',
       body = '{"defaults":{"font":"Georgia, \"Times New Roman\", serif","size":10.5,"colour":"#1f2937","lineHeight":1.45},"runningFoot":"Section 129 notice · Ref {{reference}} · Page {{page}} of {{pages}}","blocks":[{"kind":"table","borders":"none","widths":[9,24,12,22,11,22],"spacing":{"after":7},"rows":[[{"spans":[{"text":"DATE","size":8,"colour":"#6b7280"}]},{"spans":[{"text":"{{today}}"}]},{"spans":[{"text":"OUR REF","size":8,"colour":"#6b7280"}]},{"spans":[{"text":"{{reference}}"}]},{"spans":[{"text":"ACCOUNT","size":8,"colour":"#6b7280"}]},{"spans":[{"text":"{{account_number}}"}]}]]},{"kind":"paragraph","spans":[{"text":"{{debtor_name}}\nIdentity number: {{debtor_id_masked}}\n{{debtor_address}}"}],"spacing":{"after":6}},{"kind":"paragraph","spans":[{"text":"Dear {{debtor_name}}"}]},{"kind":"heading","level":1,"spans":[{"text":"NOTICE IN TERMS OF SECTION 129(1)(a) READ WITH SECTION 130 OF THE NATIONAL CREDIT ACT 34 OF 2005"}]},{"kind":"paragraph","spans":[{"text":"We act on behalf of "},{"text":"{{client_name}}","bold":true},{"text":", the creditor, and are duly authorised to issue this notice. "},{"text":"This is a formal legal notice.","bold":true},{"text":" Please read it."}]},{"kind":"heading","level":2,"spans":[{"text":"YOUR DEFAULT"}],"numbered":true},{"kind":"paragraph","spans":[{"text":"You are in default. In terms of your agreement with the creditor the full outstanding balance has become due and payable."}]},{"kind":"table","borders":"rows","widths":[42,58],"spacing":{"after":2},"rows":[[{"spans":[{"text":"Creditor"}]},{"spans":[{"text":"{{client_name}}","bold":true}]}],[{"spans":[{"text":"Account number"}]},{"spans":[{"text":"{{account_number}}"}]}],[{"spans":[{"text":"Our case reference"}]},{"spans":[{"text":"{{reference}}"}]}],[{"spans":[{"text":"Position as at"}]},{"spans":[{"text":"{{position_as_at}}"}]}],[{"spans":[{"text":"Total outstanding balance","bold":true}]},{"spans":[{"text":"{{balance}}","bold":true}]}]]},{"kind":"paragraph","spans":[{"text":"Interest and permitted charges continue to accrue. A settlement figure calculated to your intended date of payment is available on request.","size":9,"colour":"#6b7280"}]},{"kind":"heading","level":2,"spans":[{"text":"YOUR RIGHTS UNDER SECTION 129(1)(a)"}],"numbered":true},{"kind":"paragraph","spans":[{"text":"You have the right to refer this agreement to a debt counsellor, an alternative dispute resolution agent, an ombud with jurisdiction or a consumer court, so that the parties may resolve any dispute or agree a plan to bring the payments up to date. You may also raise a dispute with us directly, in writing. It costs you nothing to do either."}]},{"kind":"paragraph","spans":[{"text":"You must do so within 10 (ten) business days of the date this notice is delivered to you.","bold":true}]},{"kind":"paragraph","spans":[{"text":"To find a registered debt counsellor, contact the National Credit Regulator on 0860 627 627 or at www.ncr.org.za."}]},{"kind":"heading","level":2,"spans":[{"text":"HOW TO RESOLVE THIS WITH US"}],"numbered":true},{"kind":"list","ordered":false,"spacing":{"after":3},"items":[[{"text":"Pay in full. ","bold":true},{"text":"Payment of {{balance}} settles the account. Our banking details are below."}],[{"text":"Propose an arrangement. ","bold":true},{"text":"Tell us in writing what you can afford and when. We will consider any reasonable proposal. Please include proof of income for the last three months and a breakdown of your monthly expenses."}],[{"text":"Dispute it. ","bold":true},{"text":"If the amount is wrong, or you are not liable, tell us in writing with your reasons and any supporting documents. We will investigate and give you a written finding."}]]},{"kind":"heading","level":2,"spans":[{"text":"WHAT HAPPENS NEXT IF YOU DO NOT"}]},{"kind":"paragraph","spans":[{"text":"If we have not heard from you by {{respond_by}}, this is what can follow."}]},{"kind":"table","borders":"all","widths":[30,70],"spacing":{"after":3},"rows":[[{"spans":[{"text":"You are listed","bold":true}]},{"spans":[{"text":"Your name goes onto the credit bureaux. Every bank, shop and lender who checks you will see that you did not pay, and it stays there for years. Getting credit, and sometimes a job or a flat, becomes much harder."}]}],[{"spans":[{"text":"You are taken to court","bold":true}]},{"spans":[{"text":"Papers are delivered to you at home or at work (a summons). You have a short time to answer them."}]}],[{"spans":[{"text":"The court orders you to pay","bold":true}]},{"spans":[{"text":"If you do not answer, or you lose, the court orders you to pay the full {{balance}} plus interest (a judgment). It is recorded against your name."}]}],[{"spans":[{"text":"Your things can be sold","bold":true}]},{"spans":[{"text":"The sheriff of the court may come to your home, take your furniture, car or other belongings, and sell them to pay the debt."}]}],[{"spans":[{"text":"Money comes off your salary","bold":true}]},{"spans":[{"text":"The court can order your employer to take money off your pay before you get it, every month, until the debt is paid."}]}],[{"spans":[{"text":"You pay our legal costs too","bold":true}]},{"spans":[{"text":"Everything the case costs is added to what you already owe, so the amount grows."}]}]]},{"kind":"paragraph","spans":[{"text":"You can still avoid all of this. Phone us on {{agent_phone}} before {{respond_by}} and quote {{reference}}. We would much rather agree something you can afford than take you to court.","bold":false}]},{"kind":"heading","level":2,"spans":[{"text":"HOW TO PAY"}],"numbered":true},{"kind":"table","borders":"rows","widths":[34,66],"spacing":{"after":4},"rows":[[{"spans":[{"text":"Account name"}]},{"spans":[{"text":"{{firm_name}}"}]}],[{"spans":[{"text":"Bank / branch code"}]},{"spans":[{"text":"{{firm_bank}}"}]}],[{"spans":[{"text":"Account number"}]},{"spans":[{"text":"{{firm_bank_account}}"}]}],[{"spans":[{"text":"Payment reference"}]},{"spans":[{"text":"{{reference}}"},{"text":" — payments without this reference cannot be allocated","size":9,"colour":"#6b7280"}]}]]},{"kind":"paragraph","spans":[{"text":"Yours faithfully"}],"spacing":{"before":6},"keepWithNext":true},{"kind":"signature","widthMm":70,"spacing":{"before":2,"after":0},"spans":[{"text":"{{signatory_name}}","bold":true},{"text":"\n{{signatory_title}}\nfor and on behalf of {{firm_name}}\nduly authorised legal representative of {{client_name}}"}]}]}',
       updated_at = now()
 where seed_key = 'letter-s129';


-- ---------------------------------------------------------------------------
-- THE FIRM'S OWN DETAILS -- the other half of every letter.
--
-- At the firm's question: "where are we going to store all the data, for example, the firm's
-- data, like bank account details, and that stuff."
--
-- WHY IT IS A TABLE AND NOT A CONSTANT. Nine merge fields were written, checked and exported
-- with nothing on earth able to fill them, and mergeValuesFor has been passing null for the
-- firm's trust account since it was written. Null is the honest answer -- renderTemplate leaves
-- {{firm_bank}} STANDING on the page rather than printing a blank line that reads as finished --
-- but it means a section 129 cannot actually be posted, because the debtor is told to pay and
-- not told where.
--
-- ONE ROW, AND THE DATABASE IS WHAT SAYS SO. `id` is a boolean that must be true, so a second
-- row is refused by the primary key rather than by a convention somebody has to remember. Two
-- rows of firm settings is a letter carrying whichever trust account the query happened to
-- return first -- correct in testing and wrong in production, because the ordering changes.
--
-- THIS IS THE TRUST ACCOUNT, WHICH IS WHERE A DEBTOR PAYS IN. It is deliberately NOT
-- companies.banking_details: that is where REMITTANCE GOES OUT, to the client whose book it is.
-- Opposite directions. Paying one into the other is a debtor's money sitting in a client's
-- account, and the firm finding out at month end.
--
-- NOTHING REAL IS SEEDED HERE. This repo is public. The row is created empty and the figures are
-- typed in through Library -> The firm, so no account number is ever committed.
-- ---------------------------------------------------------------------------
create table if not exists public.firm_settings (
  -- The one-row guard: boolean, must be true, so `id` has exactly one legal value.
  id boolean primary key default true,
  constraint firm_settings_one_row check (id),

  -- What the firm calls itself on a letter. Was a string literal in AccountDetail.tsx.
  firm_name text not null default 'Bredell Ferreira',

  -- The trust account, as a debtor reads it off a notice. Bank and branch code together in one
  -- field on purpose: that is how it is written on a page ("Standard Bank - 051001"), and split
  -- into two the letter would need to know how to join them again.
  trust_bank text,
  trust_account_number text,

  -- Who signs a statutory demand, and in what capacity. The firm's own correction, in their
  -- words: not "authorised agent" -- "a legal representative", "duly authorised".
  signatory_name text,
  signatory_title text,

  -- ------------------------------------------------------------------ the email font
  --
  -- AT THE FIRM'S QUESTION: "which font is it put into the emails?" The answer today is NONE.
  -- composeBody concatenates the body and the signature and sends raw HTML with no wrapper, so
  -- every recipient's mail client picks its own default -- Gmail draws it in Arial, Outlook in
  -- Calibri, Apple Mail in Helvetica. The firm's letters are Georgia and its emails are whatever
  -- the reader happens to run.
  --
  -- A STACK, NOT A FONT, and web-safe only. A mail client cannot fetch a webfont, so a face the
  -- reader does not already have silently becomes Times New Roman. Stored as the full CSS stack
  -- so the fallback travels with the choice.
  email_font text not null default 'Georgia, "Times New Roman", Times, serif',
  -- Points, like the letter. Mail clients respect pt in inline styles; px is rewritten by some.
  email_size_pt numeric(4,1) not null default 10.5,

  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.firm_settings enable row level security;
grant select, insert, update on public.firm_settings to authenticated;
-- No delete, and that is the point: the row is not somebody's to remove. A firm with no settings
-- row is a firm whose letters silently lose their trust account.
revoke delete on public.firm_settings from authenticated;

-- The library's rule, because this is the same kind of thing as the letterhead: everyone reads it
-- -- a collector previewing a notice has to see what the debtor will be told to pay into -- and
-- an administrator writes it.
drop policy if exists firm_settings_select on public.firm_settings;
create policy firm_settings_select on public.firm_settings
  for select to authenticated using (auth.uid() is not null);

drop policy if exists firm_settings_write on public.firm_settings;
create policy firm_settings_write on public.firm_settings
  for all to authenticated
  using (public.current_user_role() = 'Administrator')
  with check (public.current_user_role() = 'Administrator');

-- The row itself, empty but for the name. Everything a debtor would be asked to pay into is left
-- null so that a notice built before somebody fills this in shows {{firm_bank}} standing on the
-- page -- which gets caught -- rather than a blank line, which gets posted.
insert into public.firm_settings (id) values (true) on conflict (id) do nothing;
