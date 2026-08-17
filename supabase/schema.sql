-- Sales Raptor — Phase 1 schema
-- Run this once in Supabase: Dashboard → SQL Editor → paste → Run.
-- Safe to re-run (uses IF NOT EXISTS / OR REPLACE / drop-if-exists guards).

create extension if not exists pgcrypto;

-- ---------- Teams ----------
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- ---------- Profiles (mirrors types.ts `User`) ----------
-- One row per authenticated person, keyed to auth.users so it disappears
-- automatically if the auth account is ever deleted.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  email text not null,
  role text not null default 'Sales Representative'
    check (role in ('Administrator', 'Sales Manager', 'Sales Representative', 'Read Only')),
  team_id uuid references public.teams (id) on delete set null,
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  phone text,
  avatar_color text not null default '#355069',
  created_at timestamptz not null default now()
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
  created_at timestamptz not null default now()
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
  notes text,
  last_contact_at timestamptz,
  next_follow_up_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  converted_deal_id uuid
);

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
  lead_id uuid references public.leads (id) on delete set null
);

-- ---------- Tasks ----------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type text not null default 'Follow-up',
  status text not null default 'Not Started' check (status in ('Not Started', 'In Progress', 'Completed', 'Cancelled')),
  priority text not null default 'Medium' check (priority in ('Low', 'Medium', 'High', 'Urgent')),
  owner_id uuid not null references public.profiles (id),
  due_date timestamptz not null,
  lead_id uuid references public.leads (id) on delete set null,
  deal_id uuid references public.deals (id) on delete set null,
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
  lead_id uuid references public.leads (id) on delete set null,
  contact_id uuid references public.contacts (id) on delete set null,
  company_id uuid references public.companies (id) on delete set null,
  deal_id uuid references public.deals (id) on delete set null,
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

-- ---------- Row Level Security ----------
-- Phase 1 policy: any authenticated team member can read/write everything,
-- matching the app's current behavior exactly (there is no per-rep
-- restriction anywhere in the UI today). Tightening this by role is a
-- deliberate later step, not done here.
alter table public.teams enable row level security;
alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.contacts enable row level security;
alter table public.leads enable row level security;
alter table public.deals enable row level security;
alter table public.tasks enable row level security;
alter table public.activities enable row level security;
alter table public.proposals enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['teams', 'profiles', 'companies', 'contacts', 'leads', 'deals', 'tasks', 'activities', 'proposals']
  loop
    execute format('drop policy if exists "authenticated_all" on public.%I;', t);
    execute format(
      'create policy "authenticated_all" on public.%I for all using (auth.uid() is not null) with check (auth.uid() is not null);',
      t
    );
  end loop;
end $$;
