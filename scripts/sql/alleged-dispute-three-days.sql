-- THE ALLEGED DISPUTE RUNS FOR THREE DAYS, NOT A FORTNIGHT.
--
-- THE FIRM: day 1 ask for it in writing with 48 hours to respond, day 3 remind with 24 hours,
-- day 4 deemed undisputed.
--
-- WHAT IT WAS: day 1 (10 business days to respond), day 6 reminder, day 10 "Last day", day 12
-- deemed undisputed. Fourteen business days -- the better part of three weeks -- in which the
-- section 129 sequence sits still because somebody said on the telephone that they dispute the
-- account.
--
-- AND THE TEN DAYS WERE BORROWED FROM SOMETHING ELSE. Ten business days is the SECTION 129's
-- statutory period, the time the Act gives a debtor to refer the agreement to a debt counsellor or
-- an ombud. Nothing in the Act gives anybody ten days to put an alleged dispute in writing; it had
-- simply been copied onto a step that is not statutory at all, and it bought a debtor three weeks
-- of silence for one sentence on a call.
--
-- 48 AND 24 HOURS ARE WRITTEN AS 2 AND 1 BUSINESS DAYS, which is the unit this model has and the
-- unit the firm's own day numbers are in: day 1 + 2 = day 3, day 3 + 1 = day 4. If a notice has to
-- say "48 hours" in those words, deadline_unit needs an hours value, which is a schema change and
-- a change to every template that quotes the period.
--
-- ------------------------------------------------------------------------------------------------
-- WHY THIS IS A FILE YOU RUN AND NOT A MIGRATION THAT WAS APPLIED
-- ------------------------------------------------------------------------------------------------
--
-- The session that wrote it could create the draft and change every row on it, and every DELETE it
-- sent hung and was rolled back -- the same thing that stopped the acknowledgements of debt being
-- seeded. So the two "Last day" steps could not be removed, and publishing a draft that still
-- carried them would have put the wrong sequence live. Nothing was published.
--
-- SAFE TO RUN MORE THAN ONCE. workflow_take_draft returns the draft that already exists rather
-- than making a second one, and every statement below is written to be true after it has run.
-- Paste it into Supabase's SQL editor and press Run.
do $$
declare v_active uuid; v_draft uuid;
begin
  select v.id into v_active
    from public.workflow_versions v
    join public.workflows w on w.id = v.workflow_id
   where w.name = 'Dispute alleged' and v.state = 'active';
  if v_active is null then
    raise notice 'No active alleged-dispute version. Nothing to do.';
    return;
  end if;

  -- NEVER THE LIVE VERSION. Version 1 carries a run, and a debtor already on a sequence keeps the
  -- schedule they started under -- the dates in a notice they have already been sent.
  v_draft := public.workflow_take_draft(v_active);

  -- THE "LAST DAY" PAIR GOES. On a three-day sequence there is no room for a third warning, and a
  -- step headed "Last day" on day 3 of 4 would be the firm shouting at somebody who has had two
  -- days to find an email address.
  delete from public.workflow_nodes
   where version_id = v_draft and key like 'dispute-final-reminder-%';

  update public.workflow_nodes set day = 3
   where version_id = v_draft and key like 'dispute-reminder-%';
  update public.workflow_nodes set day = 4
   where version_id = v_draft and key like 'dispute-undisputed-%';

  -- THE DEADLINES SIT ON THE EMAIL, which is the step that states them. The SMS beside it goes
  -- with the one before it and quotes the same date off the same run.
  update public.workflow_nodes set deadline_days = 2, deadline_unit = 'business'
   where version_id = v_draft and key = 'dispute-writing-email';
  update public.workflow_nodes set deadline_days = 1, deadline_unit = 'business'
   where version_id = v_draft and key = 'dispute-reminder-email';

  perform public.workflow_publish(v_draft);
end $$;

-- AND READ BACK WHAT IS LIVE. Six steps: day 1 (2 business days), day 3 (1 business day), day 4.
select v.version, v.state, n.day, n.label, n.deadline_days, n.deadline_unit
  from public.workflow_versions v
  join public.workflows w on w.id = v.workflow_id
  join public.workflow_nodes n on n.version_id = v.id
 where w.name = 'Dispute alleged' and v.state = 'active'
 order by n.day, n.ordinal;
