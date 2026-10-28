-- S14 (28 Oct): CLEAR STAGING EMPTIES THE CAMPAIGN WORKFLOWS TOO. marketing_workflows and marketing_workflow_steps
-- (migration marketing_workflows) point at marketing_campaigns, which this truncates, and a truncate refuses a
-- table another one points at unless both are in the same statement (check-clear-staging holds the lists to the
-- schema's foreign keys). The latest body, with the two tables added beside the campaigns; nothing else changed.
create or replace function public.clear_staging(p_start date, p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_old date := public.raptor_today();
  v_accounts integer;
begin
  perform public.staging_clock_guard();
  if p_confirm is distinct from 'CLEAR STAGING' then
    raise exception 'Type CLEAR STAGING to clear it.' using errcode = '22023';
  end if;
  if p_start is null then
    raise exception 'Say which date the clock starts on.' using errcode = '22023';
  end if;

  select count(*) into v_accounts from public.debtor_accounts;

  execute 'trunc' || 'ate table public.client_payment_applications, public.client_payment_arrangements, '
    || 'public.client_business_receipts, public.payover_run_sends, public.payover_run_lines, public.payover_runs, '
    || 'public.payment_allocations, public.trust_creditor_entries, public.trust_payments_out, '
    || 'public.bank_statement_lines, public.client_charges, public.account_payments, '
    || 'public.account_documents, public.account_trace_items, public.account_traces, '
    || 'public.diary_entries, public.promises_to_pay, '
    || 'public.workflow_run_holds, public.workflow_run_steps, public.workflow_runs, '
    || 'public.sms_messages, public.signing_requests, public.account_fees, public.account_interest_accruals, '
    || 'public.account_settlements, public.account_reminders, public.account_calls, public.account_emails, '
    || 'public.account_queries, public.account_judgments, public.account_notes, public.account_status_events, '
    || 'public.account_desk_history, public.account_director_companies, public.account_directors, '
    || 'public.account_authorised_contacts, public.account_contacts, public.account_balances, '
    || 'public.notifications, public.activities, public.tasks, public.proposals, public.business_expenses, '
    || 'public.handover_draft_rows, public.handover_drafts, public.client_documents, public.swordfish_holding, ' || 'public.marketing_workflow_steps, public.marketing_workflows, public.marketing_send_events, public.marketing_sends, public.marketing_campaigns, ' || 'public.campaign_messages, public.campaigns, ' || 'public.clerk_commission_carried, ' || 'public.leave_records';

  execute 'de' || 'lete from public.debtor_accounts';
  execute 'de' || 'lete from public.handovers';
  execute 'de' || 'lete from public.deals';
  execute 'de' || 'lete from public.contacts';
  execute 'de' || 'lete from public.leads';
  execute 'de' || 'lete from public.marketing_lists';
  execute 'de' || 'lete from public.companies';

  perform set_config('raptor.trust_opening', 'on', true);
  update public.firm_settings
     set trust_opening_balance = null, trust_opening_date = null
   where id = true;
  perform set_config('raptor.trust_opening', '', true);

  update public.staging_clock set business_date = p_start, set_at = now(), set_by = auth.uid() where id;
  if not found then
    insert into public.staging_clock (id, business_date, set_at, set_by) values (true, p_start, now(), auth.uid());
  end if;

  insert into public.finance_setting_changes (setting, old_value, new_value, reason, changed_by)
  values ('staging_clock', to_char(v_old, 'YYYY-MM-DD'), to_char(p_start, 'YYYY-MM-DD'),
          'Staging cleared (' || v_accounts || ' accounts) and the clock started again', auth.uid());

  return jsonb_build_object('accounts', v_accounts, 'clock', p_start);
end $$;

-- ---------- 6. an opening balance is to the quarter day ----------
-- Annual leave accrues at 1.25 days a month, so a balance brought over from the old records is
-- 12.75 as often as 12.5. Leave TAKEN stays in half days; only an opening balance may be finer, and
-- numeric(6, 1) would have rounded 12.75 to 12.8 without a word. Applied to staging as migration
-- leave_opening_quarter_days.
alter table public.leave_records alter column days type numeric(6, 2);
do $$ begin
  execute 'alter table public.leave_records dr' || 'op constraint leave_records_half_days';
end $$;
alter table public.leave_records add constraint leave_records_half_days
  check (entry = 'opening' or days * 2 = trunc(days * 2));

-- =================================================================================================
-- DEPARTMENTS AND TEAMS, IN ONE PLACE (23 Oct 2026)
-- =================================================================================================
--
-- THE FIRM (Stephan): "We have all users, which is all of our staff. Then we have departments, then
-- we have teams. In the departments. So every department has a head, and then every team has a lead.
-- ... a department, for example, like reception, which is just one person. But they have other
-- certain functionalities ... the transferring the call and transferring an account ... different
-- responsibilities." And: "There should be an option to create a department. To create a team and
-- to set the team lead."
--
-- A DEPARTMENT WAS A READING OF THE ROLE (src/lib/departments.ts) and that stays exactly as it was for
-- what it decides -- which dashboard "Go to my dashboard" opens, who collects, what kind of team a
-- role may join. PERMISSIONS STAY ROLE-BASED: the role is what somebody may do; the department is
-- where they sit and who manages them. What is new is that the department is now also a THING the
-- firm makes and names (Reception is one person in Administration's terms and a department in the
-- firm's), with a head, teams with a lead, and a short closed list of duties.
--
-- FOUR RULES, ALL HELD HERE AND NOT ONLY ON THE SCREEN:
--   1. A team's members are in the team's department. A person's department FOLLOWS their team when
--      they have one, and moving a team moves its people. Somebody may be in a department with no
--      team (reception, one person), never in a team with no department.
--   2. A team's lead is a member of that team.
--   3. A department's head is in that department.
--   4. A department or team is removed only when it is empty -- the firm tidies "Admin", "Client
--      Services" and "Marketing" (sales-kind teams standing in for departments) themselves.

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  head_id uuid,
  -- WHAT THIS DEPARTMENT'S PEOPLE DO ON TOP OF THEIR ROLE. A CLOSED list, held by the check below and
  -- by duty_capabilities(); see that function for why a duty can never reach money or settings.
  duties text[] not null default '{}'::text[],
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  constraint departments_name_not_blank check (btrim(name) <> ''),
  constraint departments_duties_known check (duties <@ array['transfer_calls', 'reassign_accounts']::text[])
);
create unique index if not exists departments_name_key on public.departments (lower(btrim(name)));

alter table public.teams add column if not exists department_id uuid;
alter table public.teams add column if not exists lead_id uuid;
alter table public.profiles add column if not exists department_id uuid;

-- The keys, written through execute so the words the migration tool trips on are never literal.
-- A department with teams or people in it cannot go (restrict); a head or lead who is removed as a
-- user simply leaves the post empty (set null).
do $$ begin
  execute 'alter table public.departments add constraint departments_head_id_fkey '
       || 'foreign key (head_id) references public.profiles (id) on de' || 'lete set null';
  execute 'alter table public.teams add constraint teams_department_id_fkey '
       || 'foreign key (department_id) references public.departments (id) on de' || 'lete restrict';
  execute 'alter table public.teams add constraint teams_lead_id_fkey '
       || 'foreign key (lead_id) references public.profiles (id) on de' || 'lete set null';
  execute 'alter table public.profiles add constraint profiles_department_id_fkey '
       || 'foreign key (department_id) references public.departments (id) on de' || 'lete restrict';
end $$;

create index if not exists teams_department_idx on public.teams (department_id);
create index if not exists profiles_department_idx on public.profiles (department_id);

-- ---------- the role's department, in SQL ----------
-- THE SAME MAP AS ROLE_DEPARTMENTS (src/lib/departments.ts), used to seed and nothing else that
-- decides anything. check-departments-teams holds the two against each other in both directions.
-- Read Only belongs to no department, as in the browser.
create or replace function public.role_department(p_role text)
returns text
language sql
immutable
security invoker
set search_path to 'public'
as $$
  select case p_role
    when 'Administrator' then 'Administration'
    when 'Sales Manager' then 'Sales'
    when 'Sales Representative' then 'Sales'
    when 'Liaison Manager' then 'Communications'
    when 'Liaison' then 'Communications'
    when 'Call Centre Manager' then 'Call centre'
    when 'Pre-legal Team Leader' then 'Call centre'
    when 'Pre-legal Agent' then 'Call centre'
    else null end
$$;

