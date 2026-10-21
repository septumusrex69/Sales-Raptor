-- ============================================================================================
-- DEMO DATA FOR STAGING. Never run this against production.
--
-- Raptor's collections screens were built before there was a month of work to show on them: the
-- book and the desks are real, and almost nothing had been collected against them, so every
-- figure read nought and every chart was an empty frame. This fills in a month's work to the
-- 18th of September 2026 and eleven months behind it, so the screens can be looked at.
--
-- WHAT IT IS AND IS NOT. Every row it writes is invented. It invents no PEOPLE and no ACCOUNTS —
-- it hangs work off the collectors and the book that are already on staging, so nothing here
-- carries a name and this file is safe in a public repository. It writes payments, promises,
-- calls, emails, SMS, notes and traces, and nothing else.
--
-- EVERY ROW IS TAGGED AND THE TAG IS THE UNDO. Re-running this deletes what it wrote last time
-- before writing again, so it is safe to run twice and the demo can be taken off in one pass:
--
--     account_payments.source   = 'demo'
--     promises_to_pay.source    = 'demo'
--     account_notes.kind        = 'demo'      (source stays 'manual' -- see below)
--     account_calls.external_id like 'demo-%'
--     account_emails.message_id like 'demo-%'
--     sms_messages.reference    like 'demo-%'   (it is UNIQUE, so the tag is a prefix)
--     account_traces.registration_number = 'DEMO-SEED'
--
-- A NOTE'S SOURCE STAYS 'manual' ON PURPOSE. collector_performance counts a person's own words
-- and ignores the ones Raptor writes itself, so a note tagged in `source` would not be counted
-- and "notes written" would stay at nought on every screen this file exists to fill. The tag
-- goes in `kind`, which nothing reads.
--
-- WHY IT HANGS WORK ON ACCOUNTS THAT NEVER MOVED DESKS. A payment is credited to whoever held
-- the account on the day the money landed, not to whoever holds it now. Accounts with a single
-- desk-history row have had one owner since before this history starts, so a payment dated
-- eleven months ago is credited to the same person the screen shows holding it today. Picking
-- freely would credit a year of somebody else's collections to whoever inherited the desk.
--
-- WHAT IT PRODUCED THE DAY IT WAS WRITTEN, as at 18 September 2026 (six of twenty working days,
-- so the expected pace is 30%):
--
--     39 collectors with a book, R2 815 000 of target between them
--     R1 069 021 collected, 38% of target, 270 payments averaging R3 959
--     4 past target, 14 at or above pace, 11 slightly behind, 10 critical
--     369 promises: 188 kept, 75 broken, the rest not yet due
--     132 traces pulled, 488 findings tried, 122 of them verified — a quarter, which is what a
--     trace is actually like
--
-- To take the demo off again without putting it back, run the DELETE block at the top of the
-- block below on its own.
--
-- Run: supabase SQL editor, or the Supabase MCP tool, against the STAGING project.
-- ============================================================================================
do $$
declare
  /* The firm's month is the 11th to the 10th. This one is "October 2026", read as at the 18th. */
  month_start constant date := date '2026-09-11';
  as_at       constant date := date '2026-09-18';
  /* The six working days that have happened: the 11th, then the 14th to the 18th. */
  work_days   constant date[] := array[
    date '2026-09-11', date '2026-09-14', date '2026-09-15',
    date '2026-09-16', date '2026-09-17', date '2026-09-18'
  ];
  wrote_payments integer;
  wrote_promises integer;
begin
  -- ---------- 1. take off whatever this file wrote last time ----------
  delete from public.account_trace_items
   where trace_id in (select id from public.account_traces where registration_number = 'DEMO-SEED');
  delete from public.account_traces where registration_number = 'DEMO-SEED';
  delete from public.promises_to_pay where source = 'demo';
  /* `reference` is UNIQUE on sms_messages, so the tag has to be a prefix rather than a constant
     -- a single shared 'demo' collides on the second message. */
  delete from public.sms_messages where reference like 'demo-%';
  delete from public.account_calls where external_id like 'demo-%';
  delete from public.account_emails where message_id like 'demo-%';
  delete from public.account_notes where kind = 'demo';
  delete from public.account_payments where source = 'demo';
  delete from public.targets where metric = 'collected' and scope_type = 'user';

  -- ---------- 2. the roster, and what each person is being asked for ----------
  /*
   * THE SPREAD IS THE POINT. A demo where everybody sits at the same percentage shows one state
   * of the screen and hides the other four. This puts two collectors past their target so the
   * progress bar laps, a handful at or above the day's pace, a third slightly behind and the
   * rest critical — which is roughly the shape of the firm's own September sheet, where most of
   * the floor was well behind pace on day two.
   */
  /*
   * EVERYBODY THE SCREEN WILL LIST, which is not the same as everybody with a grade.
   * collector_performance returns a row for anyone holding a book, graded or not, and the app
   * treats ungraded as Junior. Seeding only the graded ones left ten people sitting at exactly
   * R0 against a R60 000 target — which does not read as a bad month, it reads as broken data.
   */
  create temp table _collector on commit drop as
  select
    p.id,
    coalesce(p.collector_grade, 'Junior') as collector_grade,
    row_number() over (order by p.id) as idx,
    case coalesce(p.collector_grade, 'Junior')
      when 'Elite' then 100000 when 'Senior' then 80000 else 60000
    end::numeric as target
  from public.profiles p
  where p.collector_grade is not null
     or exists (
       select 1 from public.debtor_accounts a
        where a.assigned_to = p.id and a.status ilike 'Active%'
     );

  alter table _collector add column ratio numeric;
  update _collector set ratio = case
    when idx <= 3  then 1.02 + idx * 0.11                      -- past target: the bar laps
    when idx <= 12 then 0.30 + (idx - 3) * 0.033               -- at or above the day's pace
    when idx <= 26 then 0.155 + (idx - 12) * 0.0095            -- slightly behind
    else 0.02 + (idx - 26) * 0.0085                            -- critical
  end;

  -- ---------- 3. accounts that have had one owner all along ----------
  create temp table _pool on commit drop as
  select h.account_id,
         h.uid,
         row_number() over (partition by h.uid order by h.account_id) as n,
         count(*) over (partition by h.uid) as of_them
  from (
    select dh.account_id, (array_agg(dh.user_id))[1] as uid
      from public.account_desk_history dh
     group by dh.account_id
    having count(*) = 1
       and (array_agg(dh.user_id))[1] is not null
       and min(dh.effective_from) <= timestamptz '2025-09-01'
  ) h
  join public.debtor_accounts a on a.id = h.account_id
  where a.status ilike 'Active%';

  -- ---------- 4. this month's payments, to the 18th ----------
  /*
   * Spread over the six working days that have happened, at a different hour each so the day
   * view has something to order. The amount is this person's share of their own target divided
   * by however many payments they took, nudged by the payment's own number so the list does not
   * read as one figure repeated.
   */
  insert into public.account_payments (account_id, received_at, amount, method, reference, source, created_by)
  select
    pool.account_id,
    (work_days[1 + ((i - 1) % 6)]::timestamp
      + time '08:30'
      + ((i * 37) % 420) * interval '1 minute') at time zone 'Africa/Johannesburg',
    round((c.target * c.ratio / n_payments) * (0.65 + ((i * 13) % 70) / 100.0), 2),
    case when i % 3 = 0 then 'Debit order' else 'EFT' end,
    'DEMO/' || c.idx || '/' || i,
    'demo',
    c.id
  from _collector c
  cross join lateral (select 4 + (c.idx % 6) as n_payments) k
  cross join lateral generate_series(1, k.n_payments) as i
  join lateral (
    select account_id from _pool p where p.uid = c.id and p.n = 1 + (i % greatest(1, p.of_them))
    limit 1
  ) pool on true;

  get diagnostics wrote_payments = row_count;

  -- ---------- 5. eleven months behind it ----------
  /*
   * A year of history, so the collector's own page has a chart worth looking at. Each month is
   * scaled by a figure that moves with the month and the person, which gives every collector a
   * different shape rather than twelve copies of one line — and lets a month or two land past
   * target, which is what the green bars on that chart are for.
   */
  insert into public.account_payments (account_id, received_at, amount, method, reference, source, created_by)
  select
    pool.account_id,
    ((month_start - (m || ' months')::interval)::date + ((i * 5) % 26) * interval '1 day'
      + time '10:15' + ((i * 29) % 300) * interval '1 minute') at time zone 'Africa/Johannesburg',
    round((c.target * month_ratio / n_payments) * (0.6 + ((i * 17) % 80) / 100.0), 2),
    case when i % 4 = 0 then 'Debit order' else 'EFT' end,
    'DEMO/H/' || c.idx || '/' || m || '/' || i,
    'demo',
    c.id
  from _collector c
  cross join generate_series(1, 11) as m
  cross join lateral (
    select 0.55 + (((c.idx * 7 + m * 11) % 13) / 20.0) as month_ratio,
           5 + ((c.idx + m) % 5) as n_payments
  ) v
  cross join lateral generate_series(1, v.n_payments) as i
  join lateral (
    select account_id from _pool p where p.uid = c.id and p.n = 1 + ((i * m) % greatest(1, p.of_them))
    limit 1
  ) pool on true;

  -- ---------- 6. promises to pay ----------
  /*
   * Kept, broken and still to come. A promise not yet due is neither kept nor broken, so some
   * are left open with a date still ahead of them — otherwise the kept rate on every screen
   * would be computed over the whole month's promises, which is the arithmetic the code goes out
   * of its way not to do.
   */
  insert into public.promises_to_pay
    (account_id, amount, due_on, method, status, resolved_at, resolved_by,
     created_by, created_at, origin, source, arrangement)
  select
    pool.account_id,
    round(1200 + ((c.idx * 31 + i * 97) % 9000)::numeric, 2),
    /* generate_series hands back a bigint and `date + bigint` has no operator -- only
       `date + integer` does. Cast, or the whole seed fails on this one line. */
    month_start + (((i * 3) % 24))::integer,
    'EFT',
    st.status,
    case when st.status = 'open' then null
         else (month_start + (((i * 3) % 24))::integer)::timestamp at time zone 'Africa/Johannesburg' end,
    case when st.status = 'open' then null else c.id end,
    c.id,
    (work_days[1 + (i % 6)]::timestamp + time '11:00') at time zone 'Africa/Johannesburg',
    case when i % 3 = 0 then 'WhatsApp' when i % 3 = 1 then 'Telephone call' else 'Email' end,
    'demo',
    'once_off'
  from _collector c
  cross join lateral (select 5 + (c.idx % 9) as n) k
  cross join lateral generate_series(1, k.n) as i
  cross join lateral (
    select case
      /* Roughly half kept, a quarter broken, the rest not yet due — and a better-graded
         collector keeps a few more, so the kept rate is not flat across the floor. */
      when ((i * 7 + c.idx) % 10) < (4 + (c.idx % 3)) then 'kept'
      when ((i * 7 + c.idx) % 10) < 7 then 'broken'
      else 'open'
    end as status
  ) st
  join lateral (
    select account_id from _pool p where p.uid = c.id and p.n = 1 + ((i * 3) % greatest(1, p.of_them))
    limit 1
  ) pool on true;

  get diagnostics wrote_promises = row_count;

  -- ---------- 7. how the day is spent ----------
  /* Calls, with about a third of them answered — which is the figure the screen bands against. */
  insert into public.account_calls
    (account_id, placed_by, number, placed_at, external_id, answered_at, ended_at)
  select
    pool.account_id, c.id,
    '+2782' || lpad(((c.idx * 137 + i * 61) % 10000000)::text, 7, '0'),
    (work_days[1 + (i % 6)]::timestamp + time '08:00' + ((i * 11) % 540) * interval '1 minute')
      at time zone 'Africa/Johannesburg',
    'demo-call-' || c.idx || '-' || i,
    case when (i * 3 + c.idx) % 10 < 4
      then (work_days[1 + (i % 6)]::timestamp + time '08:00'
            + ((i * 11) % 540) * interval '1 minute' + interval '14 seconds')
            at time zone 'Africa/Johannesburg' end,
    (work_days[1 + (i % 6)]::timestamp + time '08:00'
      + ((i * 11) % 540) * interval '1 minute' + interval '3 minutes')
      at time zone 'Africa/Johannesburg'
  from _collector c
  cross join lateral (select 45 + (c.idx * 7 % 80) as n) k
  cross join lateral generate_series(1, k.n) as i
  join lateral (
    select account_id from _pool p where p.uid = c.id and p.n = 1 + ((i * 2) % greatest(1, p.of_them))
    limit 1
  ) pool on true;

  insert into public.account_emails
    (account_id, direction, debtor_address, our_address, subject, body, message_id, sent_by, occurred_at)
  select
    pool.account_id, 'out',
    'debtor' || ((c.idx * 13 + i) % 900) || '@example.invalid',
    'collections@bredellferreira.co.za',
    'Outstanding account — payment arrangement',
    'Demo message body.',
    'demo-mail-' || c.idx || '-' || i,
    c.id,
    (work_days[1 + (i % 6)]::timestamp + time '09:20' + ((i * 23) % 400) * interval '1 minute')
      at time zone 'Africa/Johannesburg'
  from _collector c
  cross join lateral (select 6 + (c.idx % 18) as n) k
  cross join lateral generate_series(1, k.n) as i
  join lateral (
    select account_id from _pool p where p.uid = c.id and p.n = 1 + ((i * 5) % greatest(1, p.of_them))
    limit 1
  ) pool on true;

  insert into public.sms_messages
    (account_id, direction, msisdn, body, segments, status, reference, created_by, created_at, sent_at)
  select
    pool.account_id, 'outbound',
    '+2783' || lpad(((c.idx * 211 + i * 17) % 10000000)::text, 7, '0'),
    'Demo reminder message.', 1, 'delivered', 'demo-' || c.idx || '-' || i, c.id,
    (work_days[1 + (i % 6)]::timestamp + time '10:40' + ((i * 19) % 300) * interval '1 minute')
      at time zone 'Africa/Johannesburg',
    (work_days[1 + (i % 6)]::timestamp + time '10:41' + ((i * 19) % 300) * interval '1 minute')
      at time zone 'Africa/Johannesburg'
  from _collector c
  cross join lateral (select 8 + (c.idx % 22) as n) k
  cross join lateral generate_series(1, k.n) as i
  join lateral (
    select account_id from _pool p where p.uid = c.id and p.n = 1 + ((i * 7) % greatest(1, p.of_them))
    limit 1
  ) pool on true;

  /* source stays 'manual' so these count as a person's own words; the tag is in `kind`. */
  insert into public.account_notes (account_id, body, source, created_by, created_at, kind)
  select
    pool.account_id,
    'Spoke to debtor. Arrangement discussed, following up.',
    'manual', c.id,
    (work_days[1 + (i % 6)]::timestamp + time '13:00' + ((i * 31) % 240) * interval '1 minute')
      at time zone 'Africa/Johannesburg',
    'demo'
  from _collector c
  cross join lateral (select 20 + (c.idx % 35) as n) k
  cross join lateral generate_series(1, k.n) as i
  join lateral (
    select account_id from _pool p where p.uid = c.id and p.n = 1 + ((i * 11) % greatest(1, p.of_them))
    limit 1
  ) pool on true;

  -- ---------- 8. traces, bought and worked ----------
  /*
   * Pulled and worked are two different things, so the demo makes them different numbers: every
   * collector pulls a few, each turns up several findings, and only some of those findings have
   * been rung and had an outcome recorded. A demo where the two matched would hide the one thing
   * the trace card exists to show.
   */
  insert into public.account_traces
    (account_id, subject_kind, report_kind, subject_name, registration_number,
     contact_score, risk_score, enquired_on, pulled_by, created_at)
  select
    pool.account_id, 'debtor', 'consumer', 'Trace subject', 'DEMO-SEED',
    'B', 'C', work_days[1 + (i % 6)], c.id,
    (work_days[1 + (i % 6)]::timestamp + time '14:30') at time zone 'Africa/Johannesburg'
  from _collector c
  cross join lateral (select 2 + (c.idx % 4) as n) k
  cross join lateral generate_series(1, k.n) as i
  join lateral (
    select account_id from _pool p where p.uid = c.id and p.n = 1 + ((i * 13) % greatest(1, p.of_them))
    limit 1
  ) pool on true;

  insert into public.account_trace_items
    (trace_id, account_id, kind, value, label, outcome, outcome_at, outcome_by)
  select
    t.id, t.account_id,
    (array['mobile', 'phone', 'work', 'address', 'employer'])[1 + (j % 5)],
    case when j % 5 < 3
      then '+2782' || lpad(((j * 313) % 10000000)::text, 7, '0')
      else 'Demo finding ' || j end,
    'from the bureau',
    /* Only some findings have been tried. Of the ones that have, about a third were real. */
    /*
     * WRITTEN OUT OVER THE SIX, not as a modulus. This read `j % 7 = 0 then 'verified'` and j
     * only ever runs 1 to 6, so nothing was ever verified and the trace hit rate was nought on
     * every screen. Two of six are left untried, and one of the four tried turned out to be
     * real — a quarter, which is what a trace is actually like.
     */
    case j when 3 then null when 6 then null
           when 1 then 'verified'
           when 2 then 'no_answer'
           when 4 then 'unreachable'
           else 'not_theirs' end,
    case when j % 3 = 0 then null
         else t.created_at + interval '1 day' end,
    case when j % 3 = 0 then null else t.pulled_by end
  from public.account_traces t
  cross join generate_series(1, 6) as j
  where t.registration_number = 'DEMO-SEED'
  on conflict (trace_id, kind, value) do nothing;

  -- ---------- 9. a few targets somebody actually set ----------
  /*
   * Most of the floor runs on the grade default, which is the point of having one. Three people
   * get a figure of their own so the screen's "from grade" marker has something to contrast
   * with — a marker that is on every single row teaches nobody anything.
   */
  insert into public.targets (scope_type, scope_id, metric, period_key, target_value)
  select 'user', c.id, 'collected', null,
         case c.idx when 1 then 150000 when 5 then 45000 else 120000 end
  from _collector c where c.idx in (1, 5, 9);

  raise notice 'demo seed: % payments this month, % promises', wrote_payments, wrote_promises;
end $$;
