-- ============================================================================================
-- RAPTOR H19 -- THE SETTINGS LISTS THAT SAVE, AND THE NOTIFICATION SWITCHES. Rolled back.
--
-- Run the whole file against STAGING (never production). It acts as a Sales Representative, the Sales Manager and an
-- Administrator in turn (request.jwt.claims), then RAISES, so nothing stays. The result is the error text:
--   SETTINGS LISTS {"failures": [...]}
-- An empty failures list is the pass. What it holds (Stephan, 9 Nov):
--   * a Sales Representative cannot change a list; the Sales Manager and an Administrator can;
--   * nobody signed in writes sales_list_items directly (only the functions);
--   * a built-in value (Won, Website, Other) is neither renamed nor removed;
--   * a rename renames it on every lead and deal that used it;
--   * removing a value rows still use is refused without somewhere to move them, and moves them with it;
--   * a deal is never moved into Won or Rejected by a removal;
--   * a removed value comes back when added again;
--   * a person who switched a kind of notification off is not sent it; everybody else still is.
-- Last run: 9 Nov 2026 (Raptor H19), failures [].
-- ============================================================================================
begin;
do $$
declare
  v_rep uuid; v_mgr uuid; v_admin uuid; v_lead uuid; v_deal uuid; v_other uuid;
  fails text[] := array[]::text[];
  n integer; msg text;
begin
  select id into v_rep from public.profiles where role = 'Sales Representative' limit 1;
  select id into v_mgr from public.profiles where role = 'Sales Manager' limit 1;
  select id into v_admin from public.profiles where role = 'Administrator' limit 1;
  select id into v_other from public.profiles where role = 'Administrator' and id <> v_admin limit 1;
  select id into v_lead from public.leads limit 1;
  select id into v_deal from public.deals limit 1;

  -- A Sales Representative: refused.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  begin
    perform public.sales_list_add('lead_source', 'Trade fair H19');
    fails := fails || 'a Sales Representative added a lead source'::text;
  exception when insufficient_privilege then null;
  end;

  -- Nobody signed in writes the table itself.
  execute 'set local role authenticated';
  begin
    insert into public.sales_list_items (list, value) values ('lead_source', 'Direct write H19');
    fails := fails || 'a signed-in user wrote sales_list_items directly'::text;
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';

  -- The Sales Manager: adds a source and a stage.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  perform public.sales_list_add('lead_source', 'Trade fair H19');
  perform public.sales_list_add('deal_stage', 'Site visit H19', 35);
  if (select probability from public.sales_list_items where list = 'deal_stage' and value = 'Site visit H19') <> 35
     or (select position from public.sales_list_items where list = 'deal_stage' and value = 'Site visit H19') >= 1000 then
    fails := fails || 'an added stage is not an open stage with its chance of closing'::text;
  end if;
  begin
    perform public.sales_list_add('lead_source', 'trade FAIR h19');
    fails := fails || 'the same source was added twice (case aside)'::text;
  exception when others then null;
  end;

  -- An Administrator: built-ins stay.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  begin
    perform public.sales_list_rename('deal_stage', 'Won', 'Signed');
    fails := fails || 'Won was renamed'::text;
  exception when others then null;
  end;
  begin
    perform public.sales_list_remove('lead_source', 'Website', 'Referral');
    fails := fails || 'Website was removed'::text;
  exception when others then null;
  end;
  begin
    perform public.sales_list_remove('rejection_reason', 'Other');
    fails := fails || 'the reason Other was removed'::text;
  exception when others then null;
  end;

  -- A rename follows the rows.
  update public.leads set source = 'Trade fair H19' where id = v_lead;
  update public.deals set stage = 'Site visit H19', source = 'Trade fair H19' where id = v_deal;
  n := public.sales_list_rename('lead_source', 'Trade fair H19', 'Expo H19');
  if n <> 2 or (select source from public.leads where id = v_lead) <> 'Expo H19'
     or (select source from public.deals where id = v_deal) <> 'Expo H19' then
    fails := fails || ('a rename did not follow the lead and the deal (' || n || ' moved)')::text;
  end if;

  -- Removing one in use: refused without a destination, moved with one.
  begin
    perform public.sales_list_remove('lead_source', 'Expo H19');
    fails := fails || 'a source in use was removed with nowhere to move its rows'::text;
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like '2 still use "Expo H19"%' then fails := fails || ('the refusal did not say how many: ' || msg)::text; end if;
  end;
  if exists (select 1 from public.sales_list_items where list = 'lead_source' and value = 'Expo H19' and removed_at is not null) then
    fails := fails || 'the refused removal still marked it removed'::text;
  end if;
  begin
    perform public.sales_list_remove('deal_stage', 'Site visit H19', 'Won');
    fails := fails || 'a removal moved a deal into Won'::text;
  exception when others then null;
  end;
  n := public.sales_list_remove('lead_source', 'Expo H19', 'Referral');
  if n <> 2 or (select source from public.leads where id = v_lead) <> 'Referral'
     or (select source from public.deals where id = v_deal) <> 'Referral'
     or not exists (select 1 from public.sales_list_items where list = 'lead_source' and value = 'Expo H19' and removed_at is not null) then
    fails := fails || 'removing with a destination did not move both rows and remove it'::text;
  end if;
  n := public.sales_list_remove('deal_stage', 'Site visit H19', 'New Deal');
  if (select stage from public.deals where id = v_deal) <> 'New Deal' then
    fails := fails || 'removing a stage did not move its deal'::text;
  end if;

  -- Back again when added again.
  perform public.sales_list_add('lead_source', 'Expo H19');
  if not exists (select 1 from public.sales_list_items where list = 'lead_source' and value = 'Expo H19' and removed_at is null) then
    fails := fails || 'a removed source did not come back when added'::text;
  end if;

  -- Notifications: v_admin switched change requests off; v_other did not.
  insert into public.notification_preferences (user_id, kind, muted) values (v_admin, 'change_request', true);
  insert into public.notifications (user_id, type, message) values (v_admin, 'change_request.new', 'H19 probe muted');
  insert into public.notifications (user_id, type, message) values (v_admin, 'query.assigned', 'H19 probe other kind');
  insert into public.notifications (user_id, type, message) values (v_other, 'change_request.new', 'H19 probe not muted');
  if exists (select 1 from public.notifications where message = 'H19 probe muted') then
    fails := fails || 'a switched-off kind still reached the bell'::text;
  end if;
  if not exists (select 1 from public.notifications where message = 'H19 probe other kind')
     or not exists (select 1 from public.notifications where message = 'H19 probe not muted') then
    fails := fails || 'switching one kind off stopped another kind, or another person'::text;
  end if;
  update public.notification_preferences set muted = false where user_id = v_admin and kind = 'change_request';
  insert into public.notifications (user_id, type, message) values (v_admin, 'change_request.new', 'H19 probe back on');
  if not exists (select 1 from public.notifications where message = 'H19 probe back on') then
    fails := fails || 'switching a kind back on did not bring it back'::text;
  end if;

  raise exception 'SETTINGS LISTS %', jsonb_build_object('failures', to_jsonb(fails));
end $$;
rollback;
