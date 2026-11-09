-- ============================================================================================
-- Raptor · Handover 19 -- THE FINANCE & TRUST TEST BOOK (staging only)
--
-- Two made-up clients, ten made-up debtors, each built to land on one rule of the money side.
-- What each one is for, and what it should do, is in raptor/finances/EXPECTED.md; the steps are in
-- raptor/README.md. Load it on an EMPTY staging (Settings -> Clear staging first), then import
-- raptor/trust/statement-2026-11-09.csv.
--
-- STAGING ONLY. It refuses to run anywhere deployment.kind is not 'staging'. Run it as one block
-- (Supabase SQL editor, or the MCP tool) -- it signs in as Stephan inside the block so the triggers
-- that stamp "who" see a person.
--
-- WHY IT WRITES THE TABLES DIRECTLY. Accounts are written with exactly the columns the handover
-- import writes (newDebtor.toAccountRow), and fees with exactly what chargeEngine writes for those
-- actions on the 2026 schedule (item 1(a) R25, item 2 R25, item 7 R60, all + 15% VAT) -- every fee
-- here is under the items 1-7 ceiling, so the engine would have charged it in full. The triggers
-- (case numbers TFA0001..., balances) run as they do on a real import.
--
-- NO TELEPHONE NUMBERS, NO EMAIL ADDRESSES. Nothing on this book can send an SMS or an email to a
-- real person by accident. The repo is public: every name and number here is invented.
-- ============================================================================================
do $seed$
declare
  v_me uuid := (select id from public.profiles where email = 'stephan@bredellferreira.co.za');
  v_alpha uuid;
  v_bravo uuid;
  v_h_alpha uuid;
  v_h_bravo uuid;
  v_acct uuid;
  r record;
  f record;
begin
  if not exists (select 1 from public.deployment where kind = 'staging') then
    raise exception 'This is the staging test book. It does not run here.';
  end if;
  if exists (select 1 from public.debtor_accounts) then
    raise exception 'Staging is not empty -- press Clear staging first, so the figures in EXPECTED.md hold.';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_me, 'role', 'authenticated')::text, true);

  insert into public.companies (name, account_owner_id, code, commission_rate, mandate_signed_at,
      registration_number, bank_account_holder, bank_name, bank_branch_code, bank_account_number,
      default_interest_rate_annual, industry, main_comment)
  values ('Test Finance Alpha (Pty) Ltd', v_me, 'TFA', 0.10, '2026-08-15', '2026/000001/07',
      'Test Finance Alpha (Pty) Ltd', 'FNB', '250655', '62000000001', 0, 'Test',
      'STAGING TEST CLIENT -- made up for the finance and trust tests (raptor/README.md). 10% commission.')
  returning id into v_alpha;
  insert into public.companies (name, account_owner_id, code, commission_rate, mandate_signed_at,
      registration_number, bank_account_holder, bank_name, bank_branch_code, bank_account_number,
      default_interest_rate_annual, industry, main_comment)
  values ('Test Finance Bravo CC', v_me, 'TFB', 0.20, '2026-08-15', '2026/000002/23',
      'Test Finance Bravo CC', 'Capitec', '470010', '1000000002', 0, 'Test',
      'STAGING TEST CLIENT -- made up for the finance and trust tests (raptor/README.md). 20% commission.')
  returning id into v_bravo;

  insert into public.handovers (company_id, received_at, capital_amount, accounts_count, reference, notes, logged_by)
  values (v_alpha, '2026-09-01 08:00+02', 8700, 5, 'test-book-alpha', 'Finance test book (raptor/finances/seed-test-book.sql).', v_me)
  returning id into v_h_alpha;
  insert into public.handovers (company_id, received_at, capital_amount, accounts_count, reference, notes, logged_by)
  values (v_bravo, '2026-09-01 08:00+02', 7800, 5, 'test-book-bravo', 'Finance test book (raptor/finances/seed-test-book.sql).', v_me)
  returning id into v_h_bravo;

  -- One row per debtor, in the order the case numbers are handed out (TFA0001.. / TFB0001..).
  -- fees: action:item:amount excl VAT:date, comma separated.
  for r in
    select * from (values
      (1,  'A', 'Thabo',    'Testman',      1000.00, 0.0,  'email_out:1a:25:2026-09-10,email_out:1a:25:2026-10-01'),
      (2,  'A', 'Lindiwe',  'Testsample',   2000.00, 0.0,  'email_out:1a:25:2026-09-10,email_out:1a:25:2026-09-20,email_out:1a:25:2026-10-01,email_out:1a:25:2026-10-15,consultation:7:60:2026-09-25,consultation:7:60:2026-10-20'),
      (3,  'A', 'Pieter',   'Proefpersoon',  300.00, 21.0, 'consultation:7:60:2026-09-05,consultation:7:60:2026-09-15,consultation:7:60:2026-09-25,consultation:7:60:2026-10-05,email_out:1a:25:2026-10-10'),
      (4,  'A', 'Sipho',    'Oorbetaal',     400.00, 0.0,  'email_out:1a:25:2026-09-10'),
      (5,  'A', 'Anna',     'Rentevoet',    5000.00, 10.5, 'email_out:1a:25:2026-09-10,email_out:1a:25:2026-10-01,phone_call:2:25:2026-10-05'),
      (6,  'B', 'Johan',    'Toetsmaker',   3000.00, 0.0,  'email_out:1a:25:2026-09-10'),
      (7,  'B', 'Mpho',     'Kliëntbetaal', 1200.00, 0.0,  'email_out:1a:25:2026-09-10,email_out:1a:25:2026-10-01'),
      (8,  'B', 'Karen',    'Terugdraai',    800.00, 0.0,  'email_out:1a:25:2026-09-10'),
      (9,  'B', 'Bongani',  'Plekmaker',    1500.00, 0.0,  'email_out:1a:25:2026-09-10'),
      (10, 'B', 'Elsa',     'Afwys',        1300.00, 0.0,  'email_out:1a:25:2026-09-10')
    ) as t(n, client, first_name, surname, capital, rate, fees)
    order by n
  loop
    insert into public.debtor_accounts (
      company_id, handover_id, client_reference, debtor_first_name, debtor_surname, debtor_kind,
      capital_handed_over, capital_outstanding, in_duplum_ceiling, handover_date, handover_balance,
      opening_capital, opening_interest, opening_fees, opening_as_at, interest_rate_annual, interest_from,
      commission_rate, commission_rate_expected, commission_rate_source, status, source)
    values (
      case r.client when 'A' then v_alpha else v_bravo end,
      case r.client when 'A' then v_h_alpha else v_h_bravo end,
      'TEST-' || lpad(r.n::text, 2, '0'), r.first_name, r.surname, 'individual',
      r.capital, r.capital, r.capital, '2026-09-01', r.capital,
      r.capital, 0, 0, '2026-09-01', r.rate, '2026-09-01',  -- interest_rate_annual is a PERCENT (21 = 21%)
      case r.client when 'A' then 0.10 else 0.20 end, case r.client when 'A' then 0.10 else 0.20 end,
      'Client flat rate', 'Active: Activated', 'manual')
    returning id into v_acct;

    for f in
      select split_part(x, ':', 1) action, split_part(x, ':', 2) item, split_part(x, ':', 3)::numeric amt,
             split_part(x, ':', 4)::date d
        from unnest(string_to_array(r.fees, ',')) x
    loop
      insert into public.account_fees (account_id, annexure_item, tariff_effective_from, action_code, description,
          amount_excl_vat, vat_rate, vat_amount, segments, counts_toward_fee_cap, billed, incurred_at, source, created_by)
      values (v_acct, f.item, '2026-03-06', f.action,
          case f.action when 'email_out' then 'Email (Outgoing)' when 'consultation' then 'Consultation'
                        when 'phone_call' then 'Phone Call' end,
          f.amt, 15, round(f.amt * 0.15, 2), 1, true, true, (f.d::text || ' 10:00+02')::timestamptz, 'raptor', v_me);
    end loop;
  end loop;
end $seed$;
