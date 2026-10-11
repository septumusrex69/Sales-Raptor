-- NOT YET APPLIED TO STAGING (11 Oct 2026). The database tool asks a person to confirm any
-- statement containing a DELETE, and the confirmation did not reach the firm's iPad: three tries,
-- each "cancelled". Apply it from the Supabase SQL editor on STAGING (kvkajxpremantdkhmjvb), then
-- append it to schema.sql and delete this file.
--
-- What it changes in build_payover_run, and only that: a set-off charge (a withdrawal) is claimed
-- by the run whose PAYOUT DAY it was raised before, not the run whose cycle it fell in -- and is
-- taken back from a later run that is still open if that one got to it first. With approval on the
-- payout day, that is what makes "the withdrawal will be taken off that month's payment" true.

create or replace function public.build_payover_run(p_company uuid, p_period_start date)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_end date := public.payover_cycle_end(p_period_start);
  v_run uuid;
  v_status text;
  v_prev record;
  v_later uuid[];
  v_from uuid[];
begin
  if public.current_user_role() is distinct from 'Administrator' then
    raise exception 'The Finance section is Administrator only.' using errcode = '42501';
  end if;
  select id, status into v_run, v_status
    from public.payover_runs where company_id = p_company and period_start = p_period_start;

  -- A VOIDED RUN IS NOT AN ISSUED ONE, SO IT DOES NOT HOLD THE CYCLE.
  -- Voiding threw the working document away: it released every allocation, dropped every line and
  -- went out to nobody. But UNIQUE (company_id, period_start) means the row still occupies the
  -- slot, and this used to refuse it alongside approved and sent -- so a client whose run was
  -- voided could never be paid over for that cycle again, and protect_payover_run refuses to
  -- remove the row as well. Pressing Void was irreversible and nobody was warned.
  -- The number goes with it, or payover_invoice_number hands out the next one and leaves a gap
  -- in a sequence the client reads.
  if v_run is not null and v_status = 'void' then
    delete from public.payover_runs where id = v_run;
    v_run := null;
  end if;

  if v_run is not null and not public.payover_run_is_open(v_status) then
    raise exception 'The % run for this client is already %; a correction belongs in the next run.',
      to_char(p_period_start, 'DD Mon YYYY'), v_status;
  end if;

  if v_run is null then
    insert into public.payover_runs (company_id, period_start, period_end, invoice_number)
    values (p_company, p_period_start, v_end, public.payover_invoice_number(p_company, v_end))
    returning id into v_run;
  else
    /* Let go of everything it was holding before it claims again, so a rebuild is not an append. */
    update public.payment_allocations set payover_run_id = null where payover_run_id = v_run;
    update public.payment_allocations set reversal_carried_run_id = null where reversal_carried_run_id = v_run;
    update public.payover_runs set carried_out_run_id = null where carried_out_run_id = v_run;
    /* AND THE CLIENT CHARGES IT WAS CARRYING, or a rebuild leaves them pointing at a run whose
       lines have gone and they are never set off against anything. */
    update public.client_charges set payover_run_id = null where payover_run_id = v_run;
    delete from public.payover_run_lines where run_id = v_run;
  end if;

  /* A PTC A LATER, STILL-OPEN RUN TOOK BEFORE THIS ONE EXISTED -- built first, or rebuilt alone --
     is let go here so this run can claim it; the later run's line goes with it and its figures are
     redone, so the PTC is on exactly one run. */
  with freed as (
    update public.payment_allocations a
       set payover_run_id = null
      from public.account_payments p, public.payover_runs l
     where p.id = a.payment_id
       and l.id = a.payover_run_id
       and l.company_id = p_company
       and l.period_start > p_period_start
       and public.payover_run_is_open(l.status)
       and a.paid_to_client
       and p.allocated_on >= p_period_start
       and p.allocated_on <= public.payover_ptc_until(v_end)
    returning a.id, l.id as run_id
  ), gone as (
    delete from public.payover_run_lines x using freed f
     where x.allocation_id = f.id and x.run_id = f.run_id
    returning x.run_id
  )
  select array_agg(distinct run_id) into v_later from gone;

  /* 1. THIS CYCLE'S OWN ALLOCATIONS. Claimed and drawn in one statement so an allocation cannot be
        claimed by a run that then fails to list it. Demo money is excluded here as well as in the
        engine -- R23,6m nobody paid, sitting in the same table as money somebody did. */
  with claimed as (
    update public.payment_allocations a
       set payover_run_id = v_run
      from public.account_payments p, public.debtor_accounts d
     where p.id = a.payment_id
       and d.id = a.account_id
       and d.company_id = p_company
       and a.payover_run_id is null
       and a.status <> 'reversed'
       and not p.is_demo
       /* MONEY SWORDFISH ALREADY PAID OVER IS NEVER CLAIMED. It has no allocation, so the
          join already excludes it -- this is the rule said out loud beside the dates, because
          the day somebody allocates an imported receipt by hand is the day the client is
          paid twice for money they were remitted years ago. */
       and not p.paid_over_in_swordfish
       /* CLAIMED ON THE ALLOCATION DATE, NOT ON created_at.
          THE FIRM: "it's important to capture the payment date and basically the allocation
          date of a payment. For example, if a payment was made a PTC, let's say on the 5th of
          September and only processed today, it will only be processed with this import
          date... or if a payment was in suspense... it missed the first payment run in which
          it was supposed to be. So it should be running in the payment run."
          created_at was standing in for this and is not it: it is when the ROW was written,
          which for an imported book is the day of the import for every receipt in it, and
          which nothing may move because it is the audit trail. allocated_on is set at
          approval -- the moment a payment is processed -- so a receipt released from suspense
          in October goes out in October's run however long it sat, and the day the debtor
          paid stays on received_at where it belongs.
          A DATE against the cycle's own dates, so no timezone can push a receipt into the
          neighbouring cycle at midnight. */
       /* A PTC GOES ON THE NEXT PAYOVER, NOT ITS OWN CYCLE'S (the firm, 10 Oct: "if an invoice is
          captured on the 15th of October ... the client will be invoiced on the 11th of
          November"). A payment into trust waits for its cycle to close and then the payover
          delay; a PTC has nothing to wait for -- the debtor paid the client, our share is owed
          now -- so it rides the run paid on the next 11th: anything captured up to the day
          before that run's payover date. With no delay this is the cycle's own window, as before. */
       and p.allocated_on <= case when a.paid_to_client
                                  then public.payover_ptc_until(v_end) else v_end end
       and (p.allocated_on >= p_period_start
            /* LATE FOR A RUN APPROVED EARLY: processed in a cycle whose run for this client
               had already gone, so it rides the next run rather than none (8 Oct). */
            or exists (select 1 from public.payover_runs e
                        where e.company_id = p_company
                          and e.status in ('approved', 'sent', 'paid')
                          and p.allocated_on between e.period_start
                            and case when a.paid_to_client
                                     then public.payover_ptc_until(e.period_end) else e.period_end end))
       /* AND NOT ONE AN EARLIER RUN STILL OPEN IS DUE TO CARRY. The October run's window reaches into
          November's cycle for PTCs, so November's run must leave those to it. */
       and not (a.paid_to_client and exists (
             select 1 from public.payover_runs e
              where e.company_id = p_company
                and e.period_start < p_period_start
                and public.payover_run_is_open(e.status)
                and p.allocated_on <= public.payover_ptc_until(e.period_end)))
    returning a.*
  )
  insert into public.payover_run_lines (
    run_id, allocation_id, account_id, line_kind, paid_to_client,
    payment_amount, to_interest, to_costs, to_capital, commission, commission_vat,
    excess_credit, needs_rate
  )
  select v_run, c.id, c.account_id,
         case when c.paid_to_client then 'ptc' else 'trust' end,
         c.paid_to_client,
         coalesce(c.payment_amount, 0), c.to_interest, coalesce(c.to_costs, 0), c.to_capital,
         c.commission, c.commission_vat, c.excess_credit, c.status = 'needs_rate'
    from claimed c;

  /* 2. REVERSALS OF PAYMENTS ALREADY INVOICED. The firm's decision 6: never edited in the run that
        went out -- it becomes a negative line in the next one. */
  with carried as (
    update public.payment_allocations a
       set reversal_carried_run_id = v_run
      from public.payover_runs r, public.debtor_accounts d
     where r.id = a.payover_run_id
       and d.id = a.account_id
       and d.company_id = p_company
       and a.status = 'reversed'
       and r.status in ('approved', 'sent', 'paid')
       and a.reversal_carried_run_id is null
    returning a.*
  )
  insert into public.payover_run_lines (
    run_id, allocation_id, account_id, line_kind, paid_to_client,
    payment_amount, to_interest, to_costs, to_capital, commission, commission_vat, excess_credit
  )
  select v_run, c.id, c.account_id, 'reversal', c.paid_to_client,
         -coalesce(c.payment_amount, 0), -c.to_interest, -coalesce(c.to_costs, 0), -c.to_capital,
         -c.commission, -c.commission_vat, -c.excess_credit
    from carried c;

  /* 3. LAST RUN'S SHORTFALL, from the most recent INVOICED run rather than merely last month. */
  select r.id, r.net_payover, r.invoice_number into v_prev
    from public.payover_runs r
   where r.company_id = p_company
     and r.period_start < p_period_start
     and r.status in ('approved', 'sent', 'paid')
     and r.net_payover < 0
     and r.carried_out_run_id is null
     and r.settled_direct_receipt_id is null
   order by r.period_start desc limit 1;

  if v_prev.id is not null then
    insert into public.payover_run_lines (run_id, line_kind, carried_amount)
    values (v_run, 'carried', v_prev.net_payover);
    update public.payover_runs set carried_out_run_id = v_run where id = v_prev.id;
  end if;

  /* 4. WHAT THE CLIENT OWES THE FIRM, taken off this payover. The firm, on withdrawing an
        account: "withdrawal fee subtracted from payover". `settlement = 'invoice'` is the other
        half of the firm's example and is deliberately NOT claimed: that one the client pays.

        UP TO THE PAYOUT DAY, NOT THE CYCLE'S END (the firm, 11 Oct): "the withdrawal will be taken
        off that month's payment, he doesn't wait until the next month". A run is now approved on
        its payout day (approve_payover_run), so until then it is still Ready and still being built
        -- a charge raised before payover_pays_on comes off THIS payout. Raised on 10 Jul, the
        SBB/2006 withdrawal comes off the payout of 11 Jul, not the one of 11 Aug.

        AND IT IS TAKEN BACK FROM A LATER RUN THAT GOT TO IT FIRST. Runs are built in more than one
        order (a payment approved rebuilds its own run), so the open run of a later cycle may have
        claimed a charge that belongs to this earlier payout; it is only ever moved EARLIER, and
        only out of a run that is still open, whose figures are recomputed. */
  with stolen as (
    update public.client_charges c
       set payover_run_id = null
      from public.payover_runs l
     where l.id = c.payover_run_id
       and c.company_id = p_company
       and c.settlement = 'set_off'
       and c.cancelled_at is null
       and c.paid_at is null
       and c.raised_on < public.payover_pays_on(v_end)
       and l.period_start > p_period_start
       and public.payover_run_is_open(l.status)
    returning c.id, l.id as from_run
  ), dropped as (
    delete from public.payover_run_lines pl
     using stolen s
     where pl.client_charge_id = s.id and pl.run_id = s.from_run
    returning pl.run_id
  )
  select array_agg(distinct run_id) into v_from from dropped;

  with taken as (
    update public.client_charges c
       set payover_run_id = v_run
     where c.company_id = p_company
       and c.settlement = 'set_off'
       and c.payover_run_id is null
       and c.cancelled_at is null
       and c.paid_at is null
       and c.raised_on < public.payover_pays_on(v_end)
    returning c.*
  )
  insert into public.payover_run_lines (
    run_id, account_id, line_kind, client_charge_id, charge_amount)
  select v_run, t.account_id, 'charge', t.id, t.amount + t.vat from taken t;

  if v_from is not null then
    perform public.recompute_payover_run(x) from unnest(v_from) as x;
  end if;
  perform public.recompute_payover_run(v_run);
  if v_later is not null then
    perform public.recompute_payover_run(x) from unnest(v_later) as x;
  end if;
  return v_run;
end $$;
