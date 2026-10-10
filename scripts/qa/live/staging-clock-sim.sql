-- ============================================================================================
-- THREE PAYOVER CYCLES IN ONE AFTERNOON: the staging clock's own acceptance test (prompt 10).
--
-- Run the LAST statement of this file in the SQL editor (or the Supabase MCP) against STAGING. The
-- functions above it live in the `qa_sim` schema on staging (a test fixture: not exposed to the API,
-- revoked from every role) and are re-created by running the whole file. The run CLEARS STAGING,
-- walks three cycles and then RAISES -- so everything it wrote, the clear included, is rolled back,
-- pass or fail. The result is the error text: `SIMULATION {"failures": [], ...}`.
--
-- WHY SQL AND NOT AN e2e SUITE. The e2e suites answer the database from fixtures; what this proves
-- is the database's own engine running on the staging clock -- allocation, the cycle close on the
-- 11th, the runs, carry-forward, set-off, reversal, the trust ledger. A stub cannot see any of it.
--
--   Setup    clear staging, clock on 10 Jun 2026, trust opening balance R0.00 at 10 Jun; two clients
--            (Sim Alpha, Sim Bravo), four accounts.
--   Cycle 1  (11 Jun - 10 Jul) statement 1, approve, jump to 11 Jul: every run Ready WITHOUT
--            "approve early"; approve, advice sent, EFTs paid and matched on the statement by their
--            BF PO- reference, BF's fees transferred. Trust: R0.00, nothing unaccounted for.
--   Cycle 2  receipts and a PTC; a withdrawal raises a set-off charge dated in cycle 2; a cycle-1
--            payment is reversed (wrong reference) and placed on another account -- a negative line
--            in run 2; the PTC-heavy client ends negative ("Client owes us"). Jump to 11 Aug, pay.
--   Cycle 3  the negative run carries in; a settlement and a write-off close accounts; a payment
--            arrives on a closed account (the approval queue flags it "Account closed"). Jump to
--            11 Sep, pay. Nothing in trust is unaccounted for.
--
-- KNOWN GAP IT RECORDS RATHER THAN HIDES (10 Oct): the R2 176.18 the firm recovered from Sim Bravo
-- by setting its PTC debt off against cycle 3's trust money stays in the trust account. The Trust
-- overview counts it as the firm's ("accounted for"), but the trust ledger has no firm entry for a
-- PTC's share, so draw_from_trust refuses to transfer it. The last assertion holds that what is left
-- is EXACTLY that amount; see HANDOFF.md, "decisions waiting on the firm".
-- ============================================================================================

create schema if not exists qa_sim;
revoke all on schema qa_sim from public, anon, authenticated;

create or replace function qa_sim.as_admin() returns uuid language plpgsql as $$
declare v uuid;
begin
  select id into v from public.profiles where role = 'Administrator' order by created_at limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  return v;
end $$;

create or replace function qa_sim.account(p_company uuid, p_number text, p_capital numeric) returns uuid
language sql as $$
  insert into public.debtor_accounts (company_id, account_number, debtor_first_name, debtor_surname,
    capital_handed_over, capital_outstanding, commission_rate, handover_date, opening_as_at, interest_from)
  values (p_company, p_number, 'Sim', p_number, p_capital, p_capital, 0.20,
    date '2026-06-10', date '2026-06-10', date '2026-06-10')
  returning id
$$;

create or replace function qa_sim.setup() returns jsonb language plpgsql as $$
declare v_admin uuid := qa_sim.as_admin(); a uuid; b uuid; ids jsonb;
begin
  perform public.clear_staging(date '2026-06-10', 'CLEAR STAGING');
  perform public.set_trust_opening_balance(0, date '2026-06-10', 'Simulation: the trust account opened empty');
  insert into public.companies (name, code, account_owner_id, commission_rate)
    values ('Sim Alpha', 'SMA', v_admin, 0.20) returning id into a;
  insert into public.companies (name, code, account_owner_id, commission_rate)
    values ('Sim Bravo', 'SMB', v_admin, 0.20) returning id into b;
  ids := jsonb_build_object('alpha', a, 'bravo', b,
    'a1', qa_sim.account(a, 'SMA001', 10000), 'a2', qa_sim.account(a, 'SMA002', 8000),
    'a3', qa_sim.account(a, 'SMA003', 5000), 'b1', qa_sim.account(b, 'SMB001', 20000));
  return ids;
end $$;

create or replace function qa_sim.statement(p_lines jsonb) returns jsonb language sql as $$
  select to_jsonb(r) from public.import_bank_lines('62700201255', 'Simulation trust',
    (select jsonb_agg(jsonb_build_object('key', 'sim-' || (l->>'date') || '-' || (l->>'ref') || '-' || (l->>'amount'),
       'date', l->>'date', 'amount', l->>'amount', 'balance', '', 'description', coalesce(l->>'desc', 'SIM ' || (l->>'ref')),
       'direction', case when (l->>'amount')::numeric < 0 then 'debit' else 'credit' end, 'reference', l->>'ref'))
       from jsonb_array_elements(p_lines) l)) r
$$;

create or replace function qa_sim.jump(p_to date) returns integer language plpgsql as $$
declare d date := public.raptor_today(); n integer := 0;
begin
  perform public.begin_staging_clock_jump(p_to, 'Simulation');
  while d < p_to loop d := d + 1; perform public.step_staging_clock(d); n := n + 1; end loop;
  return n;
end $$;

/* The Trust overview's own reconciliation: in the trust account, less what has an owner. */
create or replace function qa_sim.recon() returns jsonb language sql as $$
  with p as (select * from public.trust_position()),
  c as (select coalesce(sum(for_clients + for_firm + firm_other + for_debtors), 0) as accounted from public.trust_cash_by_cycle())
  select jsonb_build_object('in_trust', round(p.trust_cash, 2), 'accounted', round(c.accounted, 2),
    'unplaced', round(p.unidentified, 2), 'not_accounted', round(p.trust_cash - c.accounted, 2),
    'owed_by_clients', round(p.owed_by_clients, 2), 'ledger_vs_bank', round(p.difference, 2))
    from p, c
$$;

/* Approve every run of a cycle, send its advice, pay it (matched on the statement by its BF PO-
   reference), then transfer the firm's share to the business account. */
create or replace function qa_sim.pay_cycle(p_start date) returns jsonb language plpgsql as $$
declare r record; v_line uuid; v_fee numeric; out jsonb := '[]'; v_today date := public.raptor_today();
begin
  for r in select * from public.payover_runs where period_start = p_start and public.payover_run_is_open(status) loop
    perform public.approve_payover_run(r.id);
  end loop;
  for r in select * from public.payover_runs where period_start = p_start and status in ('approved', 'sent') order by invoice_number loop
    perform public.mark_payover_run_sent(r.id);
    if r.net_payover > 0 then
      perform public.mark_payover_run_paid(r.id, 'BF ' || r.invoice_number);
      perform qa_sim.statement(jsonb_build_array(jsonb_build_object('date', v_today, 'ref', 'BF ' || r.invoice_number,
        'amount', to_char(-r.net_payover, 'FM999999990.00'), 'desc', 'PAYOVER BF ' || r.invoice_number)));
      select id into v_line from public.bank_statement_lines where reference = upper('BF ' || r.invoice_number) and direction = 'debit';
      perform public.allocate_bank_line(v_line, 'payover', null, r.id);
    end if;
    out := out || jsonb_build_object('run', r.invoice_number, 'net', r.net_payover);
  end loop;
  select round(owed_to_firm, 2) into v_fee from public.trust_position();
  if v_fee > 0 then
    perform qa_sim.statement(jsonb_build_array(jsonb_build_object('date', v_today, 'ref', 'BF FEES-' || to_char(v_today, 'YYMM'),
      'amount', to_char(-v_fee, 'FM999999990.00'), 'desc', 'TRANSFER TO BUSINESS')));
    select id into v_line from public.bank_statement_lines where reference = 'BF FEES-' || to_char(v_today, 'YYMM') and direction = 'debit';
    perform public.allocate_bank_line(v_line, 'business_transfer');
  end if;
  return jsonb_build_object('runs', out, 'fees', v_fee, 'recon', qa_sim.recon());
end $$;

create or replace function qa_sim.approve_all() returns jsonb language sql as $$
  select to_jsonb(x) from public.approve_payments(
    (select coalesce(array_agg(id), '{}') from public.account_payments where approved_at is null and rejected_at is null and reversed_at is null)) x
$$;

create or replace function qa_sim.ptc(p_account uuid, p_amount numeric, p_on date) returns uuid language plpgsql as $$
declare d uuid;
begin
  insert into public.account_documents (account_id, name, storage_path, kind)
    values (p_account, 'Client confirmation', 'sim/' || gen_random_uuid(), 'ptc_proof') returning id into d;
  return public.record_manual_payment(p_account, p_amount, p_on, true, 'EFT', 'CLIENT ' || p_on, null, false, d);
end $$;

create or replace function qa_sim.acct(p_number text) returns uuid language sql as $$
  select id from public.debtor_accounts where account_number = p_number
$$;

create or replace function qa_sim.cycle1() returns jsonb language plpgsql as $$
declare o jsonb := '{}';
begin
  perform qa_sim.jump(date '2026-06-20');
  perform qa_sim.statement('[{"date":"2026-06-15","ref":"SMA001","amount":"1000.00"},{"date":"2026-06-18","ref":"SMA002","amount":"2000.00"},{"date":"2026-06-19","ref":"SMB001","amount":"3000.00"}]');
  o := o || jsonb_build_object('approved', qa_sim.approve_all());
  perform qa_sim.jump(date '2026-07-11');
  o := o || jsonb_build_object('runs', (select jsonb_agg(jsonb_build_object('n', invoice_number, 's', status, 'net', net_payover)) from public.payover_runs where period_start = date '2026-06-11'));
  o := o || jsonb_build_object('pay', qa_sim.pay_cycle(date '2026-06-11'));
  return o;
end $$;

create or replace function qa_sim.cycle2() returns jsonb language plpgsql as $$
declare o jsonb := '{}'; v_pay uuid; v_line uuid;
begin
  perform qa_sim.jump(date '2026-07-20');
  perform qa_sim.statement('[{"date":"2026-07-15","ref":"SMA001","amount":"1500.00"},{"date":"2026-07-18","ref":"SMA003","amount":"800.00"}]');
  perform qa_sim.ptc(qa_sim.acct('SMB001'), 6000, date '2026-07-19');
  o := o || jsonb_build_object('approved', qa_sim.approve_all());
  perform qa_sim.jump(date '2026-07-25');
  o := o || jsonb_build_object('withdrawal', public.withdraw_account(qa_sim.acct('SMA002'), 'Simulation: the client withdrew it', p_amount => 500));
  select id into v_pay from public.account_payments where account_id = qa_sim.acct('SMA001') and amount = 1000;
  perform public.reverse_payment_to_unplaced(v_pay, 'Simulation: wrong reference, it was SMA003');
  select id into v_line from public.bank_statement_lines where payment_id = v_pay or (reference = 'SMA001' and amount = 1000);
  perform public.place_bank_line(v_line, qa_sim.acct('SMA003'));
  o := o || jsonb_build_object('replaced', qa_sim.approve_all());
  o := o || jsonb_build_object('charges', (select jsonb_agg(jsonb_build_object('raised_on', raised_on, 'amount', amount, 'settlement', settlement)) from public.client_charges));
  perform qa_sim.jump(date '2026-08-11');
  o := o || jsonb_build_object('runs', (select jsonb_agg(jsonb_build_object('n', invoice_number, 's', status, 'net', net_payover)) from public.payover_runs where period_start = date '2026-07-11'));
  o := o || jsonb_build_object('pay', qa_sim.pay_cycle(date '2026-07-11'));
  return o;
end $$;

create or replace function qa_sim.cycle3() returns jsonb language plpgsql as $$
declare o jsonb := '{}';
begin
  perform qa_sim.jump(date '2026-08-20');
  perform qa_sim.statement('[{"date":"2026-08-15","ref":"SMB001","amount":"4000.00"},{"date":"2026-08-18","ref":"SMA001","amount":"2000.00"}]');
  o := o || jsonb_build_object('approved', qa_sim.approve_all());
  o := o || jsonb_build_object('settled', public.settle_account(qa_sim.acct('SMA001'), 'settled', 'Simulation: settled at a discount'));
  o := o || jsonb_build_object('written_off', public.settle_account(qa_sim.acct('SMA003'), 'written_off', 'Simulation: debtor sequestrated'));
  perform qa_sim.jump(date '2026-08-28');
  perform qa_sim.statement('[{"date":"2026-08-27","ref":"SMA003","amount":"300.00"}]');
  o := o || jsonb_build_object('closed_payment', (select jsonb_agg(jsonb_build_object('status', l.status, 'payment', l.payment_id is not null)) from public.bank_statement_lines l where l.reference = 'SMA003' and l.txn_date = date '2026-08-27'));
  o := o || jsonb_build_object('approve_closed', qa_sim.approve_all());
  perform qa_sim.jump(date '2026-09-11');
  o := o || jsonb_build_object('runs', (select jsonb_agg(jsonb_build_object('n', invoice_number, 's', status, 'net', net_payover)) from public.payover_runs where period_start = date '2026-08-11'));
  o := o || jsonb_build_object('pay', qa_sim.pay_cycle(date '2026-08-11'));
  return o;
end $$;

create or replace function qa_sim.expect(p_ok boolean, p_what text, p_fails text[]) returns text[] language sql as $$
  select case when coalesce(p_ok, false) then p_fails else p_fails || p_what end
$$;

create or replace function qa_sim.run_all() returns jsonb language plpgsql as $$
declare c1 jsonb; c2 jsonb; c3 jsonb; f text[] := '{}'; v numeric;
begin
  perform qa_sim.setup();
  c1 := qa_sim.cycle1();
  f := qa_sim.expect(not exists (select 1 from jsonb_array_elements(c1->'runs') r where r->>'s' <> 'ready'), 'cycle 1: every run Ready on 11 Jul', f);
  f := qa_sim.expect(not exists (select 1 from public.payover_runs where period_start = date '2026-06-11' and early_reason is not null), 'cycle 1: none approved early', f);
  f := qa_sim.expect((select bool_and((approved_at at time zone 'Africa/Johannesburg')::date = date '2026-07-11') from public.payover_runs where period_start = date '2026-06-11'), 'cycle 1: approved on the business day 11 Jul', f);
  f := qa_sim.expect((c1->'pay'->'recon'->>'not_accounted')::numeric = 0 and (c1->'pay'->'recon'->>'in_trust')::numeric = 0, 'cycle 1: trust reconciles to zero', f);
  c2 := qa_sim.cycle2();
  f := qa_sim.expect((select bool_and(raised_on between date '2026-07-11' and date '2026-08-10') from public.client_charges where kind = 'withdrawal'), 'cycle 2: the withdrawal charge is dated in cycle 2', f);
  f := qa_sim.expect(exists (select 1 from public.payover_run_lines l join public.payover_runs r on r.id = l.run_id where r.invoice_number = 'PO-SMA-2608' and l.line_kind = 'reversal' and l.payment_amount < 0), 'cycle 2: the reversed cycle-1 payment is a negative line in run 2', f);
  f := qa_sim.expect((select net_payover from public.payover_runs where invoice_number = 'PO-SMB-2608') < 0, 'cycle 2: the PTC-heavy client ends negative', f);
  f := qa_sim.expect((c2->'pay'->'recon'->>'not_accounted')::numeric = 0 and (c2->'pay'->'recon'->>'in_trust')::numeric = 0, 'cycle 2: trust reconciles to zero', f);
  c3 := qa_sim.cycle3();
  f := qa_sim.expect((select carried_in from public.payover_runs where invoice_number = 'PO-SMB-2609') < 0, 'cycle 3: the negative run carries in', f);
  f := qa_sim.expect((select count(*) from public.debtor_accounts where ended_as in ('settled', 'written_off')) = 2, 'cycle 3: a settlement and a write-off close accounts', f);
  f := qa_sim.expect(exists (select 1 from public.account_payments p join public.debtor_accounts d on d.id = p.account_id where d.ended_as is not null and (p.received_at at time zone 'Africa/Johannesburg')::date > d.ended_on), 'cycle 3: a payment arrives on a closed account', f);
  f := qa_sim.expect((c3->'pay'->'recon'->>'not_accounted')::numeric = 0, 'cycle 3: nothing in trust is unaccounted for', f);
  select coalesce(sum(firm_set_off), 0) into v from public.trust_cash_by_cycle();
  f := qa_sim.expect((c3->'pay'->'recon'->>'in_trust')::numeric = v, 'cycle 3: what is left in trust is exactly the firm''s PTC share recovered by set-off', f);
  return jsonb_build_object('failures', f, 'left_in_trust', c3->'pay'->'recon'->'in_trust', 'ptc_set_off_undrawable', v,
    'cycle1', c1->'pay', 'cycle2', c2->'pay', 'cycle3', c3->'pay');
end $$;

/* THE SAME BOOK, BUT SIM BRAVO PAYS ITS CYCLE-2 SHORTFALL INTO THE BUSINESS ACCOUNT (the firm, 10 Oct:
   "we would have to match it"): recorded against PO-SMB-2608, it is not owed by age, not carried into
   cycle 3, and the trust then reconciles to exactly R0.00 -- no PTC share left stranded. */
create or replace function qa_sim.run_direct() returns jsonb language plpgsql as $$
declare f text[] := '{}'; v_run uuid; v_net numeric; c3 jsonb;
begin
  perform qa_sim.setup(); perform qa_sim.cycle1(); perform qa_sim.cycle2();
  select id, net_payover into v_run, v_net from public.payover_runs where invoice_number = 'PO-SMB-2608';
  perform public.record_client_business_receipt(v_run, -v_net, date '2026-08-11', 'SIM BRAVO EFT');
  f := qa_sim.expect(not exists (select 1 from public.ptc_ageing()), 'paid direct: no longer owed by age', f);
  f := qa_sim.expect((qa_sim.recon()->>'ledger_vs_bank')::numeric = 0, 'paid direct: the ledger agrees with the bank', f);
  c3 := qa_sim.cycle3();
  f := qa_sim.expect((select carried_in from public.payover_runs where invoice_number = 'PO-SMB-2609') = 0, 'paid direct: not carried into the next payover', f);
  f := qa_sim.expect((c3->'pay'->'recon'->>'in_trust')::numeric = 0 and (c3->'pay'->'recon'->>'not_accounted')::numeric = 0, 'paid direct: trust reconciles to zero after cycle 3', f);
  return jsonb_build_object('failures', f, 'cycle3', c3->'pay');
end $$;

-- ---------------------------------------------------------------- run it (rolls everything back)
-- Both scenarios; each starts by clearing staging inside the same rolled-back transaction.
do $p$ begin perform qa_sim.as_admin();
  raise exception 'SIMULATION % || DIRECT %', (qa_sim.run_all())->'failures', (select qa_sim.run_direct())->'failures';
end $p$;
