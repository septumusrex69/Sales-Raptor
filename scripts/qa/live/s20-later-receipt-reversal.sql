-- ============================================================================================
-- RAPTOR H19 / S20 REVIEW -- A LATER RECEIPT ON A CORRECTED ACCOUNT STILL REVERSES, TO THE CENT. Rolled back.
--
-- Run the whole file against STAGING. It builds the worked example of s20-restatement-worked-example.sql (March found
-- late, April corrected, the correction APPROVED and posted), then a third receipt: R1 000 on 1 May, approved and split
-- in the ordinary way. It takes a snapshot of the account (capital outstanding, the trust ledger by party, and what the
-- open payover runs hold for it), reverses May with reverse_payment as an Administrator with payment.reverse, and
-- reads it all back. Then it RAISES, so nothing stays. The result is the error text:
--   LATER REVERSAL {"failures": [...], ...}
-- An empty failures list is the pass. What it holds:
--   * May reverses (before the S20 review it was refused: the account carried a correction);
--   * by an opposite entry -- May's split is marked reversed and every trust entry it wrote is answered, so capital,
--     the client's and the firm's trust balances and the open runs are back where they were before May, to the cent;
--   * without a re-split -- March's and the April correction's allocations are untouched;
--   * the payment found late (March), placed by the posted correction, is still refused: finance reverses it by hand.
-- Last run: 8 Nov 2026 (S20 review), failures [].
-- ============================================================================================
begin;
do $$
declare
  v_admin uuid; v_co uuid; v_acc uuid; v_apr uuid; v_mar uuid; v_rid uuid; v_may uuid; v_copy uuid;
  b record; a record; may record; run_before numeric; run_mid numeric; run_after numeric; msg text; v_ps date;
  f jsonb; m record; c record; acc_fix record; cap numeric; ent record; ln record;
  fails text[] := array[]::text[];
  out jsonb := '{}'::jsonb;
begin
  select p.id into v_admin from public.profiles p
   where p.role = 'Administrator' and p.status = 'Active' and p.id <> '4b199924-8d91-49a6-96ee-3799b5c70573'
     and 'finance.view' = any(public.finance_held(p.role, p.grants, p.revokes, p.department_id))
     and 'payment.approve' = any(public.finance_held(p.role, p.grants, p.revokes, p.department_id))
     and 'payment.reverse' = any(public.finance_held(p.role, p.grants, p.revokes, p.department_id))
   order by p.created_at limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  insert into public.companies (name, account_owner_id, commission_rate, code, mandate_signed_at)
  values ('S20 worked example', v_admin, 0.2, 'SWX', '2025-12-01') returning id into v_co;
  insert into public.debtor_accounts (company_id, capital_handed_over, capital_outstanding, handover_date,
    interest_rate_annual, status, debtor_first_name, debtor_surname, account_number)
  values (v_co, 10000, 10000, date '2026-01-01', 24, 'Active: Activated', 'Worked', 'Example', 'SWX/1')
  returning id into v_acc;
  insert into public.account_fees (account_id, annexure_item, description, amount_excl_vat, vat_rate, vat_amount,
    counts_toward_fee_cap, incurred_at, source, billed, action_code)
  values (v_acc, '1(a)', 'Email to the debtor', 25, 15, 3.75, true, '2026-01-09 22:00+00', 'raptor', true, 'email'),
         (v_acc, '7', 'Consultation', 60, 15, 9, true, '2026-02-14 22:00+00', 'raptor', true, 'consultation');

  /* 1 April: paid, approved, split -- before anybody knew about March. */
  insert into public.account_payments (account_id, received_at, amount, method, reference, source, paid_to_client)
  values (v_acc, '2026-03-31 22:00+00', 1000, 'EFT', 'SWX1', 'manual', false) returning id into v_apr;
  perform public.approve_payment(v_apr);
  /* 1 March: found later (out of suspense), waiting for approval. */
  insert into public.account_payments (account_id, received_at, amount, method, reference, source, paid_to_client)
  values (v_acc, '2026-02-28 22:00+00', 1000, 'EFT', 'SWX1', 'manual', false) returning id into v_mar;

  /* THE PROPOSAL, before anything is posted: the doc's correction table. */
  v_rid := public.propose_restatement(v_mar, 'worked example');
  select figures into f from public.payment_restatements where id = v_rid;
  out := out || jsonb_build_object('proposal', f - 'lines'::text);
  if f ->> 'blocked' is not null then fails := fails || ('blocked: ' || (f ->> 'blocked')); end if;
  if (f ->> 'interest_correction')::numeric <> -17.59 then fails := fails || ('interest correction ' || (f ->> 'interest_correction') || ' <> -17.59'); end if;
  if (f ->> 'client_correction')::numeric <> 51.55 then fails := fails || ('client correction ' || (f ->> 'client_correction') || ' <> 51.55'); end if;
  if (f ->> 'firm_correction')::numeric <> -51.55 then fails := fails || ('firm correction ' || (f ->> 'firm_correction') || ' <> -51.55'); end if;

  perform public.approve_restatement(v_rid);

  /* THE SNAPSHOT, before May. */
  select d.capital_outstanding as cap,
         (select coalesce(sum(e.amount), 0) from public.trust_creditor_entries e where e.account_id = v_acc and e.party = 'client') as client,
         (select coalesce(sum(e.amount), 0) from public.trust_creditor_entries e where e.account_id = v_acc and e.party = 'firm') as firm
    into b from public.debtor_accounts d where d.id = v_acc;
  /* What the client's open runs will pay over: the runs' own net figure, as recomputed. */
  select coalesce(sum(r.net_payover), 0) into run_before
    from public.payover_runs r where r.company_id = v_co and r.status in ('draft', 'ready', 'needs_review');

  /* 1 MAY: an ordinary receipt, approved and split after the correction was posted. */
  insert into public.account_payments (account_id, received_at, amount, method, reference, source, paid_to_client)
  values (v_acc, '2026-04-30 22:00+00', 1000, 'EFT', 'SWX1', 'manual', false) returning id into v_may;
  perform public.approve_payment(v_may);
  select x.* into may from public.payment_allocations x where x.payment_id = v_may;
  out := out || jsonb_build_object('may', jsonb_build_object('i', may.to_interest, 'c', may.to_costs, 'k', may.to_capital, 't', may.to_client));
  if may.id is null or may.to_client <= 0 then fails := fails || 'May was not split'::text; end if;
  /* The client's open run is rebuilt, as the nightly close or the run screen would. */
  select r.period_start into v_ps from public.payover_runs r
   where r.company_id = v_co and r.status in ('draft', 'ready', 'needs_review') order by r.period_start desc limit 1;
  perform public.build_payover_run(v_co, v_ps);
  select coalesce(sum(r.net_payover), 0) into run_mid
    from public.payover_runs r where r.company_id = v_co and r.status in ('draft', 'ready', 'needs_review');
  if run_mid - run_before <> may.to_client then
    fails := fails || ('May put ' || (run_mid - run_before) || ' on the open run, not its ' || may.to_client);
  end if;

  /* THE PAYMENT FOUND LATE stays with finance. */
  begin
    perform public.reverse_payment(v_mar, 'probe');
    fails := fails || 'reversing the payment found late was allowed'::text;
  exception when others then
    msg := sqlerrm;
    if msg not like '%Finance reverses it by hand%' then fails := fails || ('March refused with the wrong words: ' || msg); end if;
  end;

  /* MAY REVERSES. */
  begin
    v_copy := public.reverse_payment(v_may, 'S20 review probe');
  exception when others then
    fails := fails || ('reversing May was refused: ' || sqlerrm);
  end;

  perform public.build_payover_run(v_co, v_ps);

  select d.capital_outstanding as cap,
         (select coalesce(sum(e.amount), 0) from public.trust_creditor_entries e where e.account_id = v_acc and e.party = 'client') as client,
         (select coalesce(sum(e.amount), 0) from public.trust_creditor_entries e where e.account_id = v_acc and e.party = 'firm') as firm
    into a from public.debtor_accounts d where d.id = v_acc;
  /* What the client's open runs will pay over: the runs' own net figure, as recomputed. */
  select coalesce(sum(r.net_payover), 0) into run_after
    from public.payover_runs r where r.company_id = v_co and r.status in ('draft', 'ready', 'needs_review');
  out := out || jsonb_build_object('before', to_jsonb(b), 'after', to_jsonb(a), 'run_period', v_ps, 'run_before', run_before, 'run_mid', run_mid, 'run_after', run_after);
  if a.cap <> b.cap then fails := fails || ('capital ' || a.cap || ' <> ' || b.cap || ' before May'); end if;
  if a.client <> b.client then fails := fails || ('client in trust ' || a.client || ' <> ' || b.client); end if;
  if a.firm <> b.firm then fails := fails || ('firm in trust ' || a.firm || ' <> ' || b.firm); end if;
  if run_after <> run_before then fails := fails || ('the open run holds ' || run_after || ' for the account, not ' || run_before); end if;
  if (select status from public.payment_allocations where id = may.id) is distinct from 'reversed' then
    fails := fails || 'May''s split is not marked reversed'::text;
  end if;
  if (select count(*) from public.payment_allocations x join public.account_payments p on p.id = x.payment_id
       where p.account_id = v_acc and x.status = 'reversed' and x.payment_id <> v_may) > 0 then
    fails := fails || 'something other than May was reversed (a re-split)'::text;
  end if;
  if (select to_client from public.payment_allocations where payment_id = v_mar) <> 385
     or (select x.to_client from public.payment_allocations x join public.account_payments p on p.id = x.payment_id
          where p.corrects_payment_id = v_apr) <> 51.55 then
    fails := fails || 'March or the April correction changed'::text;
  end if;
  if (select count(*) from public.payment_allocations x where x.payment_id = v_may) <> 1 then
    fails := fails || 'May has more than one split (a replay)'::text;
  end if;

  raise exception 'LATER REVERSAL %', jsonb_build_object('failures', to_jsonb(fails), 'detail', out);
end $$;
