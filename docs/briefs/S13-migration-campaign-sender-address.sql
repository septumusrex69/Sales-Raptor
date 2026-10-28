-- S13 · Campaigns: migration `campaign_sender_address` -- NOT YET APPLIED ANYWHERE.
--
-- WHY. Ryno: "the ability to add other email addresses" to Send from. The addresses themselves live in
-- marketing_senders (built 28 Oct); what is missing is a campaign saying WHICH of them it goes from.
-- marketing_campaigns.send_from is held to ('news', 'liaison', 'reports') by its check, so this adds
-- 'address' and the column that names the address.
--
-- WHO APPLIES IT. The S13 session that wrote the screens had no database tool, so it is written here for
-- Ryno's next session (which may apply migrations to STAGING under CLAUDE.md) or the administrator.
-- Apply to staging with the Supabase tool, then append this same SQL to the END of supabase/schema.sql
-- (append-only) and check the md5, as CLAUDE.md "Migrations" says. Never production until the firm says.
--
-- UNTIL IT IS APPLIED nothing breaks: the screens read campaigns with select('*'), see no
-- sender_address_id, and do not offer "Another address" (they say this change is needed instead).
-- Everything else -- BF News, each liaison, reports@ -- works without it.

alter table public.marketing_campaigns
  add column if not exists sender_address_id uuid references public.marketing_senders(id) on delete restrict;

alter table public.marketing_campaigns drop constraint if exists marketing_campaigns_send_from_known;
alter table public.marketing_campaigns add constraint marketing_campaigns_send_from_known
  check (send_from in ('news', 'liaison', 'reports', 'address'));

-- An address is carried only by a campaign going from one. Not the other way round: a draft may say
-- "another address" before one is picked (the screen saves as it goes); the queue refuses it until one is.
alter table public.marketing_campaigns drop constraint if exists marketing_campaigns_sender_address_matches;
alter table public.marketing_campaigns add constraint marketing_campaigns_sender_address_matches
  check (send_from = 'address' or sender_address_id is null);

-- Clear staging empties marketing_campaigns; it points AT marketing_senders, which is not emptied, so the
-- truncate is unaffected (a truncate is refused only by tables pointing INTO it).
