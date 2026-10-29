-- Raptor · Handoff 14 -- S13 · Campaigns: migration `campaign_compose` -- NOT YET APPLIED ANYWHERE.
--
-- WHAT RYNO ASKED FOR (29 Oct), and what each part below stores:
--   * "add any email address that I want" to send from          -> marketing_senders: any domain, a domain
--     marked ready once it is verified in Resend, and its own signature;
--   * a campaign that goes from one of those addresses           -> marketing_campaigns.sender_address_id;
--   * "how many emails at a time, the frequency"                  -> marketing_campaigns.batch_size / batch_every_minutes;
--   * templates: "the context and everything ... saved", and
--     "only Nicole sends this type of newsletter"                 -> marketing_templates, with its sender.
--
-- WHO APPLIES IT. The S13 session that wrote the screens had no database tool. A session working for Ryno may
-- apply it to STAGING (CLAUDE.md, 28 Oct): run it with the Supabase tool, append this same SQL to the END of
-- supabase/schema.sql, check the md5. Never production until the firm says. Idempotent: safe to run twice.
--
-- UNTIL IT IS APPLIED nothing breaks. The server's config reports `schemaReady: false`, and the screens offer
-- BF News, each liaison and reports@ as today, and say this change is needed beside the parts that wait for it.

-- ------------------------------------------------------------------------------------------------
-- 1. ANY ADDRESS, NOT ONLY THE TWO DOMAINS
-- ------------------------------------------------------------------------------------------------
-- The 28 Oct check held marketing_senders to bfnews.co.za and bredellferreira.co.za. Ryno wants any address; a
-- domain Resend has not verified would be refused on the morning it mattered, so instead of refusing the address
-- the row says whether its domain is READY. The two domains above are always ready (they are verified); any
-- other is ready once somebody who followed the set-up guide marks it so.
alter table public.marketing_senders drop constraint if exists marketing_senders_address_check;
do $$
declare c record;
begin
  -- The 28 Oct check was declared inline, so its name is Postgres's; drop whichever check names the domains.
  for c in select conname from pg_constraint
            where conrelid = 'public.marketing_senders'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%bfnews%'
  loop
    execute format('alter table public.marketing_senders drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.marketing_senders add constraint marketing_senders_address_is_an_address
  check (address = lower(btrim(address)) and address ~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$');
alter table public.marketing_senders add column if not exists domain_ready_at timestamptz;
alter table public.marketing_senders add column if not exists domain_ready_by uuid references public.profiles(id) on delete set null;
-- THE ADDRESS'S OWN SIGNATURE, as sanitised email HTML (src/lib/emailHtml.ts). {{signature}} in a campaign is
-- filled with the signature of whichever address that email goes from.
alter table public.marketing_senders add column if not exists signature_html text;

-- ------------------------------------------------------------------------------------------------
-- 2. A CAMPAIGN FROM ONE OF THOSE ADDRESSES, AND HOW FAST IT GOES
-- ------------------------------------------------------------------------------------------------
alter table public.marketing_campaigns
  add column if not exists sender_address_id uuid references public.marketing_senders(id) on delete restrict;
alter table public.marketing_campaigns drop constraint if exists marketing_campaigns_send_from_known;
alter table public.marketing_campaigns add constraint marketing_campaigns_send_from_known
  check (send_from in ('news', 'liaison', 'reports', 'address'));
-- An address is carried only by a campaign going from one. Not the other way round: a draft may say "another
-- address" before one is picked (the screen saves as it goes); the queue refuses it until one is. The
-- introduction and prospect kinds may name one too (their marketer's domain otherwise), so the kind is not tested.
alter table public.marketing_campaigns drop constraint if exists marketing_campaigns_sender_address_matches;
alter table public.marketing_campaigns add constraint marketing_campaigns_sender_address_matches
  check (send_from = 'address' or sender_address_id is null or kind in ('introduction', 'prospect'));

-- BATCHES: "how many emails at a time, the frequency". Null batch_size is all at once, as before. The drain sends
-- up to batch_size, then waits until next_batch_at; the five-minute sweep is the clock, so the shortest gap is 15.
alter table public.marketing_campaigns add column if not exists batch_size integer
  check (batch_size is null or batch_size between 10 and 5000);
alter table public.marketing_campaigns add column if not exists batch_every_minutes integer
  check (batch_every_minutes is null or batch_every_minutes between 15 and 10080);
alter table public.marketing_campaigns add column if not exists next_batch_at timestamptz;
alter table public.marketing_campaigns add column if not exists template_id uuid;

-- ------------------------------------------------------------------------------------------------
-- 3. TEMPLATES
-- ------------------------------------------------------------------------------------------------
create table if not exists public.marketing_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  kind text not null default 'news' check (kind in ('news', 'introduction', 'prospect')),
  subject text not null default '',
  preheader text not null default '',
  body text not null default '',
  image_url text,
  -- The sender it is meant to go from ("only Nicole sends this type of newsletter"); a campaign started from it
  -- takes this, and may change it.
  send_from text not null default 'news' check (send_from in ('news', 'liaison', 'reports', 'address')),
  sender_address_id uuid references public.marketing_senders(id) on delete set null,
  archived_at timestamptz,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default public.raptor_now(),
  updated_at timestamptz not null default public.raptor_now()
);
alter table public.marketing_campaigns drop constraint if exists marketing_campaigns_template_id_fkey;
alter table public.marketing_campaigns add constraint marketing_campaigns_template_id_fkey
  foreign key (template_id) references public.marketing_templates(id) on delete set null;

alter table public.marketing_templates enable row level security;
drop policy if exists marketing_templates_select on public.marketing_templates;
drop policy if exists marketing_templates_insert on public.marketing_templates;
drop policy if exists marketing_templates_update on public.marketing_templates;
create policy marketing_templates_select on public.marketing_templates for select to authenticated using (public.has_capability('marketing.send'));
create policy marketing_templates_insert on public.marketing_templates for insert to authenticated with check (public.has_capability('marketing.send'));
create policy marketing_templates_update on public.marketing_templates for update to authenticated
  using (public.has_capability('marketing.send')) with check (public.has_capability('marketing.send'));
-- No delete policy: a template is archived (archived_at), so a campaign started from it can still say which.

-- CLEAR STAGING: marketing_campaigns now points at marketing_templates, which is NOT emptied, so the truncate is
-- unaffected (a truncate is refused only by tables pointing INTO the truncated set). Templates survive a Clear
-- staging, as the extra senders do: they are the firm's tools, not test data.
