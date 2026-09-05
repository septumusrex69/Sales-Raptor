-- Sales Raptor — Phase 1 schema
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
    check (role in ('Administrator', 'Sales Manager', 'Sales Representative', 'Liaison Manager', 'Liaison', 'Read Only')),
  team_id uuid references public.teams (id) on delete set null,
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  phone text,
  avatar_color text not null default '#355069',
  created_at timestamptz not null default now(),
  -- Appended under the body of any email sent from Sales Raptor via this person's connected inbox.
  email_signature text,
  -- Optional signature image (e.g. a scanned handwritten signature or logo), stored in the
  -- 'email-signatures' Storage bucket, laid out under the text signature at send time.
  email_signature_image_url text,
  email_signature_image_width integer,
  email_signature_image_align text not null default 'left' check (email_signature_image_align in ('left', 'center', 'right'))
);

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
  classification text check (classification in ('A', 'B', 'C', 'D'))
);

-- ---------- Contacts ----------
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  job_title text,
  company_id uuid references public.companies (id) on delete set null,
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
  status text not null default 'New',
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
  converted_deal_id uuid
);

-- Covers re-running this script against a database where `leads` already
-- existed before service_values was added (create table if not exists
-- above is a no-op in that case, so this catches it separately).
alter table public.leads add column if not exists service_values jsonb;

-- ---------- Deals ----------
create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company_id uuid not null references public.companies (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  owner_id uuid not null references public.profiles (id),
  stage text not null default 'New Lead',
  value numeric not null default 0,
  probability integer not null default 10,
  expected_close_date timestamptz not null,
  service text,
  source text not null,
  competitor text,
  notes text,
  loss_reason text,
  created_at timestamptz not null default now(),
  won_at timestamptz,
  lost_at timestamptz,
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
  created_at timestamptz not null default now()
);

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
-- One row per person who has connected their own mailbox so Sales Raptor
-- can send email as them and log incoming mail against matching CRM
-- records. encrypted_password is AES-256-GCM ciphertext (see
-- api/_lib/crypto.ts) -- never plaintext -- and like the mailbox
-- credentials themselves, is only ever read or written by the service_role
-- API routes under /api/email/*, never the browser. RLS is enabled with no
-- policies for authenticated/anon, so even a compromised anon/authenticated
-- key can't read a row. last_seen_uid is the IMAP UID watermark so each
-- sync only processes messages that arrived since the last one.
create table if not exists public.email_connections (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  email text not null,
  smtp_host text not null,
  smtp_port integer not null default 587,
  imap_host text not null,
  imap_port integer not null default 993,
  encrypted_password text not null,
  last_seen_uid integer,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.email_connections enable row level security;

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
