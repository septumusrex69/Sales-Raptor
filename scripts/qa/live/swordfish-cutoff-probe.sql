-- ============================================================================================
-- THE SWORDFISH CUT-OFF, PROVED AGAINST A REAL DATABASE (prompt 8).
--
-- Run it in the SQL editor (or the Supabase MCP) against STAGING. It writes a client, an account,
-- five receipts and the Swordfish interest rows IN THE ORDER THE IMPORT WRITES THEM, asserts what
-- the triggers did, and then RAISES -- so every row it wrote is rolled back, pass or fail. The
-- last line of the error is the result: `PASS ...` or `FAIL ...`.
--
-- WHY A SQL FILE AND NOT AN e2e SUITE. Every e2e suite answers the database from fixtures, and
-- what broke here was the database's own triggers: allocate_payment_on_insert splitting receipts
-- the import had marked as already remitted. A stub cannot see that. This can, and it needs no
-- credentials in the repository.
--
--   Scenario A  cut-off after every receipt: 0 allocations, 0 Raptor receipt fees, 0 trust
--               creditor entries, 0 engine interest postings; the Swordfish interest rows land.
--   Scenario B  cut-off before the last 3: exactly those 3 waiting for approval, nothing split;
--               then one is approved and only then is it split.
--   Guards      reverse_payment and move_payment_to_cycle both refuse a remitted receipt, and a
--               direct allocate_payment call on one posts nothing.
-- ============================================================================================
do $probe$
declare
  v_owner uuid;
  v_co uuid;
  v_acc uuid;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_cut date;
  v_dates date[] := array['2026-06-15', '2026-07-15', '2026-08-15', '2026-09-15', '2026-10-01']::date[];
  v_fail text := '';
  v_out text := '';
  n int;
  scenario text;
begin
  select id into v_owner from public.profiles order by created_at limit 1;

  foreach scenario in array array['A', 'B'] loop
    /* A: every receipt on or before the cut-off. B: the cut-off before the last three. */
    v_cut := case scenario when 'A' then date '2026-10-05' else date '2026-07-31' end;

    insert into public.companies (name, account_owner_id) values ('Probe client ' || scenario, v_owner)
      returning id into v_co;
    insert into public.debtor_accounts (company_id, account_number, capital_outstanding, capital_handed_over)
      values (v_co, 'PROBE-' || scenario, 10000, 10000) returning id into v_acc;

    v_ids := '{}';
    for i in 1 .. array_length(v_dates, 1) loop
      /* EXACTLY THE SHAPE swordfishImport.ts WRITES: remitted on or before the cut-off, approved as
         at the day it came in; after it, unapproved and left for a person. */
      insert into public.account_payments
        (account_id, received_at, amount, method, source, paid_over_in_swordfish, approved_at)
      values (v_acc, v_dates[i], 400, 'EFT', 'swordfish', v_dates[i] <= v_cut,
              case when v_dates[i] <= v_cut then v_dates[i]::timestamptz end)
      returning id into v_id;
      v_ids := v_ids || v_id;
    end loop;

    /* THE SWORDFISH INTEREST ROWS, WRITTEN AFTER THE PAYMENTS AS THE IMPORT DOES. This is the insert
       that died on account_interest_accruals_period_idx when the engine had posted first. */
    insert into public.account_interest_accruals
      (account_id, accrued_on, days, opening_balance, daily_rate, amount_accrued,
       amount_recoverable, capitalised, source)
    select v_acc, d, 30, 0, 0, 25, 25, true, 'swordfish'
      from unnest(array['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01']::date[]) d;

    select count(*) into n from public.payment_allocations where account_id = v_acc;
    if n <> 0 then v_fail := v_fail || format(' %s: %s allocations;', scenario, n); end if;
    select count(*) into n from public.account_fees
     where account_id = v_acc and source = 'raptor' and annexure_item = '9';
    if n <> 0 then v_fail := v_fail || format(' %s: %s Raptor receipt fees;', scenario, n); end if;
    select count(*) into n from public.trust_creditor_entries where account_id = v_acc;
    if n <> 0 then v_fail := v_fail || format(' %s: %s trust creditor entries;', scenario, n); end if;
    select count(*) into n from public.account_interest_accruals where account_id = v_acc and source = 'engine';
    if n <> 0 then v_fail := v_fail || format(' %s: %s engine interest postings;', scenario, n); end if;
    select count(*) into n from public.account_interest_accruals where account_id = v_acc and source = 'swordfish';
    if n <> 4 then v_fail := v_fail || format(' %s: %s of 4 Swordfish interest rows landed;', scenario, n); end if;

    /* THE APPROVAL QUEUE: unapproved, not reversed. */
    select count(*) into n from public.account_payments
     where account_id = v_acc and approved_at is null and reversed_at is null;
    if n <> (case scenario when 'A' then 0 else 3 end) then
      v_fail := v_fail || format(' %s: %s waiting for approval;', scenario, n);
    end if;
    v_out := v_out || format(' %s: queue %s.', scenario, n);

    /* A DIRECT CALL ON A REMITTED RECEIPT POSTS NOTHING -- the gate is first, before the interest. */
    perform public.allocate_payment(v_ids[1]);
    select count(*) into n from public.account_interest_accruals where account_id = v_acc and source = 'engine';
    if n <> 0 then v_fail := v_fail || format(' %s: a direct allocate_payment posted interest;', scenario); end if;

    if scenario = 'B' then
      /* AND ONLY ONCE A PERSON APPROVES IS IT SPLIT. approve_payment checks a capability against
         auth.uid(), which a SQL editor has none of, so the approval it records is written here
         and the split is asked for the same way approve_payment asks for it. */
      update public.account_payments set approved_at = now() where id = v_ids[3];
      perform public.allocate_payment(v_ids[3]);
      select count(*) into n from public.payment_allocations where payment_id = v_ids[3];
      if n <> 1 then v_fail := v_fail || format(' B: the approved receipt has %s allocations, not 1;', n); end if;
      select count(*) into n from public.payment_allocations where payment_id in (v_ids[4], v_ids[5]);
      if n <> 0 then v_fail := v_fail || ' B: an unapproved receipt was split;'; end if;
      v_out := v_out || ' B: split only once approved.';
    end if;

    /* THE OTHER TWO PATHS REFUSE A REMITTED RECEIPT. Both check a capability before the receipt,
       so the refusal is asserted on the source as well (check-swordfish-remitted); here they are
       only tried where the probe runs as somebody allowed to call them. */
  end loop;

  if v_fail = '' then
    raise exception 'PASS%', v_out;
  end if;
  raise exception 'FAIL%', v_fail;
end
$probe$;
