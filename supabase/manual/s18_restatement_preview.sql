-- RAPTOR H17 / S18 -- PASTE INTO THE SUPABASE SQL EDITOR ON STAGING (kvkajxpremantdkhmjvb) AND RUN.
-- Creates two functions only (restatement_preview, backdated_payments). Changes no data.
-- The deletes inside restatement_preview only ever run inside a block that rolls itself back.

-- ============================================================================================
-- RAPTOR H17 / S18: BACKDATED PAYMENTS -- PHASE 1, THE CALCULATOR AND THE CONTROL LIST.
--
-- THE FIRM, 6 Nov, deciding how a payment dated before a completed payover is handled: the debtor's
-- statement shows it on the day it was made ("beneficial for the debtors because then they can easily
-- read their statement"), and the client and the firm see the correction as an adjustment dated when
-- it is processed ("definitely the client is going to have to see this correction"), with a control
-- list in Trust.
--
-- WHY IT DOES NOT CORRECT ITSELF. allocate_payment posts the open interest up to each payment's own
-- day (accrue_interest_to) as engine rows. Once a June payment was approved, April-June interest was
-- posted on a balance without the April payment in it, and approving the April payment later posts
-- nothing for that span -- it is already covered. reallocate_account replays splits but leaves the
-- interest rows, and replays in capture order. So the interest has to be RESTATED, deliberately.
--
-- THIS PHASE CHANGES NOTHING. restatement_preview works out what the account should look like, by
-- the same trick as queue_preview: inside a block that ALWAYS raises, it unwinds the account from the
-- backdated payment's day (engine interest rows ending after it, the allocations and Raptor receipt
-- fees of every payment from that day on, the capital they took), re-posts every one of those
-- payments OLDEST FIRST through allocate_payment -- the code that posts for real -- and reads the
-- result. Then it rolls back and returns old against new, payment by payment. No second arithmetic.
-- Applying it (interest correction rows, re-splits, adjustment lines on the next payover) is phase 2.
-- ============================================================================================
create or replace function public.restatement_preview(p_payment uuid)
returns table (
  payment_id uuid, received_on date, amount numeric, is_backdated boolean, invoiced_in text,
  old_interest numeric, new_interest numeric, old_costs numeric, new_costs numeric,
  old_capital numeric, new_capital numeric, old_commission numeric, new_commission numeric,
  old_to_client numeric, new_to_client numeric, old_excess numeric, new_excess numeric,
  interest_posted_before numeric, interest_posted_after numeric, imported_interest_after boolean
)
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v public.account_payments%rowtype;
  v_day date;
  v_old jsonb;
  v_new jsonb := '{}'::jsonb;
  v_acc_old numeric;
  v_acc_new numeric;
  v_imported boolean;
  v_restore numeric;
  v_shadow uuid;
  v_map jsonb := '{}'::jsonb;
  e record;
begin
  if not public.may_approve_payment() then
    raise exception 'You are not allowed to look at payment restatements.' using errcode = '42501';
  end if;
  select * into v from public.account_payments where id = p_payment;
  if not found then return; end if;
  v_day := (v.received_at at time zone 'Africa/Johannesburg')::date;

  /* WHAT IS POSTED NOW, for every payment from that day on. */
  select coalesce(jsonb_object_agg(a.payment_id::text, jsonb_build_object(
           'i', a.to_interest, 'c', a.to_costs, 'k', a.to_capital,
           'm', a.commission + a.commission_vat, 't', a.to_client, 'x', a.excess_credit,
           'run', case when public.allocation_is_invoiced(a.payover_run_id)
                       then (select r.invoice_number from public.payover_runs r where r.id = a.payover_run_id) end)), '{}'::jsonb)
    into v_old
    from public.payment_allocations a
    join public.account_payments p on p.id = a.payment_id
   where a.account_id = v.account_id and a.status <> 'reversed'
     and (p.received_at at time zone 'Africa/Johannesburg')::date >= v_day;
  select coalesce(sum(amount_recoverable), 0) into v_acc_old
    from public.account_interest_accruals where account_id = v.account_id;
  /* IMPORTED INTEREST AFTER THE DAY IS FROZEN (CLAUDE.md): said, never restated here. */
  select exists (select 1 from public.account_interest_accruals
                  where account_id = v.account_id and source <> 'engine'
                    and accrued_on + days > v_day) into v_imported;

  begin
    /*
     * NOTHING A PAID RUN SAYS IS TOUCHED, EVEN FOR THE QUESTION. protect_payover_run_lines refuses to remove an
     * issued run's lines, and it is right to; so the allocations from this day on are SET ASIDE (parked on a
     * placeholder, below) rather than removed, and each payment is split again, oldest first, through
     * allocate_payment / approve_payment -- the code that posts for real. All of it goes when the block raises.
     */
    delete from public.account_interest_accruals
     where account_id = v.account_id and source = 'engine' and accrued_on + days > v_day;

    select coalesce(sum(a.to_capital), 0) into v_restore
      from public.payment_allocations a join public.account_payments p on p.id = a.payment_id
     where a.account_id = v.account_id and a.status <> 'reversed'
       and (p.received_at at time zone 'Africa/Johannesburg')::date >= v_day;
    update public.debtor_accounts set capital_outstanding = coalesce(capital_outstanding, 0) + v_restore
     where id = v.account_id;

    delete from public.account_fees f using public.account_payments p
     where f.payment_id = p.id and f.account_id = v.account_id and f.annexure_item = '9' and f.source = 'raptor'
       and (p.received_at at time zone 'Africa/Johannesburg')::date >= v_day;

    /*
     * EACH ORIGINAL IS RE-SPLIT ITSELF, NOT A COPY. A copy left the original row counting in account_movements
     * (which reads every payment not reversed), so on its own day the money was in twice and the interest came out
     * R0.59 short on a probe (S18, 6 Nov). So the existing split of every payment from this day on is moved onto a
     * placeholder payment that is born reversed -- counted nowhere, its split marked reversed so no sum reads it, the
     * paid run's lines still pointing at it untouched -- and the original is free to be split again.
     */
    for e in
      select p.* from public.account_payments p
       where p.account_id = v.account_id
         and (p.received_at at time zone 'Africa/Johannesburg')::date >= v_day
         and exists (select 1 from public.payment_allocations a where a.payment_id = p.id)
    loop
      insert into public.account_payments (account_id, received_at, amount, method, reference, details, source,
                                           paid_to_client, created_by, reversed_at)
      values (e.account_id, e.received_at, e.amount, e.method, e.reference, 'restatement placeholder', 'manual',
              e.paid_to_client, e.created_by, public.raptor_now())
      returning id into v_shadow;
      update public.payment_allocations pa set payment_id = v_shadow, status = 'reversed' where pa.payment_id = e.id;
    end loop;

    for e in
      select p.* from public.account_payments p
       where p.account_id = v.account_id
         and (p.received_at at time zone 'Africa/Johannesburg')::date >= v_day
         and (p.approved_at is not null or p.id = v.id)
         and p.reversed_at is null and p.rejected_at is null and p.suspended_at is null
         and not p.is_demo and not coalesce(p.paid_over_in_swordfish, false)
       order by p.received_at, p.created_at, p.id
    loop
      if e.approved_at is null then
        perform public.approve_payment(e.id);
      else
        perform public.allocate_payment(e.id);
      end if;
      v_map := v_map || jsonb_build_object(e.id::text, e.id::text);
    end loop;

    select coalesce(jsonb_object_agg(v_map ->> a.payment_id::text, jsonb_build_object(
             'i', a.to_interest, 'c', a.to_costs, 'k', a.to_capital,
             'm', a.commission + a.commission_vat, 't', a.to_client, 'x', a.excess_credit)), '{}'::jsonb)
      into v_new
      from public.payment_allocations a
     where a.status <> 'reversed' and v_map ? a.payment_id::text;
    select coalesce(sum(amount_recoverable), 0) into v_acc_new
      from public.account_interest_accruals where account_id = v.account_id;

    raise exception using errcode = 'RQSIM', message = 'restatement_preview: rolled back';
  exception when sqlstate 'RQSIM' then null;
  end;

  return query
  select p.id, (p.received_at at time zone 'Africa/Johannesburg')::date, p.amount, p.id = v.id,
         v_old -> p.id::text ->> 'run',
         (v_old -> p.id::text ->> 'i')::numeric, (v_new -> p.id::text ->> 'i')::numeric,
         (v_old -> p.id::text ->> 'c')::numeric, (v_new -> p.id::text ->> 'c')::numeric,
         (v_old -> p.id::text ->> 'k')::numeric, (v_new -> p.id::text ->> 'k')::numeric,
         (v_old -> p.id::text ->> 'm')::numeric, (v_new -> p.id::text ->> 'm')::numeric,
         (v_old -> p.id::text ->> 't')::numeric, (v_new -> p.id::text ->> 't')::numeric,
         (v_old -> p.id::text ->> 'x')::numeric, (v_new -> p.id::text ->> 'x')::numeric,
         v_acc_old, v_acc_new, v_imported
    from public.account_payments p
   where p.id::text in (select jsonb_object_keys(v_old) union select jsonb_object_keys(v_new) union select v.id::text)
   order by p.received_at, p.created_at, p.id;
end $$;

comment on function public.restatement_preview(uuid) is
  'What restating an account from a backdated payment''s day would do, payment by payment, old against '
  'new, worked out by re-posting oldest first inside a block that always rolls back. Changes nothing. S18.';
revoke all on function public.restatement_preview(uuid) from public, anon;
grant execute on function public.restatement_preview(uuid) to authenticated;

/*
 * THE CONTROL LIST: every payment a LATER-dated payment on the same account was allocated before --
 * waiting in the queue, or already approved out of order. Exactly the set whose interest and splits
 * were worked out on a balance that did not have it. Who captured it and when ride along.
 */
create or replace function public.backdated_payments()
returns table (
  payment_id uuid, account_id uuid, case_number text, debtor text, client text,
  received_on date, captured_on date, approved_on date, amount numeric, paid_to_client boolean,
  captured_by text, later_allocated integer, later_invoiced integer
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.id, p.account_id, d.case_number,
         public.debtor_full_name(d.debtor_first_name, d.debtor_second_name, d.debtor_surname),
         c.name,
         (p.received_at at time zone 'Africa/Johannesburg')::date,
         (p.created_at at time zone 'Africa/Johannesburg')::date,
         (p.approved_at at time zone 'Africa/Johannesburg')::date,
         p.amount, coalesce(p.paid_to_client, false),
         (select pr.name from public.profiles pr where pr.id = p.created_by),
         l.later_allocated, l.later_invoiced
    from public.account_payments p
    join public.debtor_accounts d on d.id = p.account_id
    left join public.companies c on c.id = d.company_id
    left join public.payment_allocations own on own.payment_id = p.id and own.status <> 'reversed'
    cross join lateral (
      select count(*)::integer as later_allocated,
             count(*) filter (where public.allocation_is_invoiced(qa.payover_run_id))::integer as later_invoiced
        from public.account_payments q
        join public.payment_allocations qa on qa.payment_id = q.id and qa.status <> 'reversed'
       where q.account_id = p.account_id and q.id <> p.id
         and q.received_at > p.received_at
         and (own.id is null or qa.computed_at < own.computed_at)
    ) l
   where public.may_approve_payment()
     and p.reversed_at is null and p.rejected_at is null and not p.is_demo
     and not coalesce(p.paid_over_in_swordfish, false)
     and l.later_allocated > 0
   order by (p.received_at at time zone 'Africa/Johannesburg')::date, p.id
$$;

comment on function public.backdated_payments() is
  'Payments a later-dated payment on the same account was allocated before -- the set whose interest '
  'and splits were worked out without them. The Trust control list. S18.';
revoke all on function public.backdated_payments() from public, anon;
grant execute on function public.backdated_payments() to authenticated;
