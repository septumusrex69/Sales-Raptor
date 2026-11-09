-- ============================================================================================
-- RAPTOR H19 / S20 -- THE WORKED EXAMPLE OF "PAYMENTS FOUND LATE", POSTED FOR REAL AND ROLLED BACK.
--
-- Run the whole file against STAGING (the Supabase MCP execute_sql, or the SQL editor). It builds the account in
-- the Claude Doc "Payments found late" (R10 000 handed over 1 Jan 2026, 2% a month, commission 20% + VAT; an email
-- on 10 Jan and a consultation on 15 Feb; R1 000 on 1 Apr approved and split; R1 000 on 1 Mar found later),
-- proposes the correction, APPROVES it as an Administrator with payment.approve, and reads back what was posted.
-- Then it RAISES, so everything it wrote is rolled back, pass or fail. The result is the error text:
--   RESTATEMENT {"failures": [...], ...}
-- An empty failures list is the pass. Every figure is the doc's, to the cent. Last run: 8 Nov 2026 (S20), failures [].
--
-- The Administrator is the first active Administrator with finance on the database (the staging profile
-- "Screenshot Bot (staging)" is left out on purpose).
-- ============================================================================================
begin;
do $$
declare
  v_admin uuid; v_co uuid; v_acc uuid; v_apr uuid; v_mar uuid; v_rid uuid;
  f jsonb; m record; c record; acc_fix record; cap numeric; ent record; ln record;
  fails text[] := array[]::text[];
  out jsonb := '{}'::jsonb;
begin
  select p.id into v_admin from public.profiles p
   where p.role = 'Administrator' and p.status = 'Active' and p.id <> '4b199924-8d91-49a6-96ee-3799b5c70573'
     and 'finance.view' = any(public.finance_held(p.role, p.grants, p.revokes, p.department_id))
     and 'payment.approve' = any(public.finance_held(p.role, p.grants, p.revokes, p.department_id))
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

  /* MARCH, approved by the correction with its date-order split: an ordinary payment. */
  select a.* into m from public.payment_allocations a where a.payment_id = v_mar;
  out := out || jsonb_build_object('march', jsonb_build_object('i', m.to_interest, 'c', m.to_costs, 'k', m.to_capital, 'm', m.commission + m.commission_vat, 't', m.to_client));
  if m.to_interest <> 412.46 then fails := fails || ('March interest ' || m.to_interest || ' <> 412.46'); end if;
  if m.to_costs <> 87.54 then fails := fails || ('March fees ' || m.to_costs || ' <> 87.54'); end if;
  if m.to_capital <> 500 then fails := fails || ('March capital ' || m.to_capital || ' <> 500.00'); end if;
  if m.commission + m.commission_vat <> 115 then fails := fails || ('March commission ' || (m.commission + m.commission_vat) || ' <> 115.00'); end if;
  if m.to_client <> 385 then fails := fails || ('March to client ' || m.to_client || ' <> 385.00'); end if;

  /* APRIL'S CORRECTION: a R0.00 receipt carrying only the difference. April's own split is untouched. */
  select a.*, p.amount as pay_amount into c from public.payment_allocations a
    join public.account_payments p on p.id = a.payment_id
   where p.corrects_payment_id = v_apr and p.source = 'correction';
  out := out || jsonb_build_object('april_correction', jsonb_build_object('i', c.to_interest, 'c', c.to_costs, 'k', c.to_capital, 'm', c.commission + c.commission_vat, 't', c.to_client));
  if c.pay_amount is distinct from 0 then fails := fails || 'the correction receipt is not R0.00'::text; end if;
  if c.to_interest <> -307.16 then fails := fails || ('interest ' || c.to_interest || ' <> -307.16'); end if;
  if c.to_costs <> 240.21 then fails := fails || ('fees ' || c.to_costs || ' <> +240.21'); end if;
  if c.to_capital <> 66.95 then fails := fails || ('capital ' || c.to_capital || ' <> +66.95'); end if;
  if c.commission + c.commission_vat <> 15.40 then fails := fails || ('commission ' || (c.commission + c.commission_vat) || ' <> +15.40'); end if;
  if c.to_client <> 51.55 then fails := fails || ('to client ' || c.to_client || ' <> +51.55'); end if;
  if (select to_interest from public.payment_allocations where payment_id = v_apr) <> 500 then
    fails := fails || 'April''s own allocation was changed'::text;
  end if;

  /* THE DEBTOR: one interest row of -17.59, and the balance the doc ends on. */
  select coalesce(sum(amount_accrued), 0) as total, count(*) filter (where source = 'restatement') as rows
    into acc_fix from public.account_interest_accruals where account_id = v_acc;
  if acc_fix.total <> 605.30 then fails := fails || ('interest charged ' || acc_fix.total || ' <> 605.30'); end if;
  if acc_fix.rows <> 1 then fails := fails || 'not exactly one interest correction row'::text; end if;
  select capital_outstanding into cap from public.debtor_accounts where id = v_acc;
  if cap <> 8933.05 then fails := fails || ('capital outstanding ' || cap || ' <> 8933.05'); end if;

  /* THE TRUST LEDGER: the client gains R51.55, the firm gives it back. */
  select coalesce(sum(e.amount) filter (where e.party = 'client'), 0) as client,
         coalesce(sum(e.amount) filter (where e.party = 'firm'), 0) as firm
    into ent from public.trust_creditor_entries e
    join public.payment_allocations a on a.id = e.allocation_id
    join public.account_payments p on p.id = a.payment_id
   where p.corrects_payment_id = v_apr;
  if ent.client <> 51.55 or ent.firm <> -51.55 then
    fails := fails || ('trust ledger client ' || ent.client || ' firm ' || ent.firm);
  end if;

  /* THE NEXT OPEN RUN carries the correction as its own line, and nothing is edited on April's. */
  select l.line_kind, l.late, l.to_capital, l.commission + l.commission_vat as comm, r.status
    into ln from public.payover_run_lines l
    join public.payover_runs r on r.id = l.run_id
   where l.allocation_id = c.id;
  out := out || jsonb_build_object('correction_line', to_jsonb(ln));
  if ln.to_capital is distinct from 66.95 then fails := fails || 'the correction is not on a payover run'::text; end if;
  if ln.status not in ('ready', 'needs_review', 'draft') then fails := fails || ('the correction sits on a run that is ' || coalesce(ln.status, 'none')); end if;

  /* THE AUDIT TRAIL. */
  if (select count(*) from public.payment_restatement_events where restatement_id = v_rid) <> 2 then
    fails := fails || 'the audit trail does not say proposed and posted'::text;
  end if;

  raise exception 'RESTATEMENT %', jsonb_build_object('failures', to_jsonb(fails), 'detail', out);
end $$;
