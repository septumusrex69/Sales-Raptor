import type { SupabaseClient } from '@supabase/supabase-js'
import { accountMergeValues } from '../../../src/lib/accountMergeValues.js'
import { computeBalance } from '../../../src/lib/accountBalance.js'
import { balanceInputFor } from '../../../src/lib/balanceInput.js'
import { balanceAccountFromRow, fetchLedgerRows } from '../../../src/lib/storedBalance.js'
import { toSettings as toFirmSettings } from '../../../src/lib/firmSettingsRow.js'
import { nextUnpaidFromRow } from '../../../src/lib/ptpSchedule.js'
import type { Arrangement } from '../../../src/lib/arrangements.js'
import { toSettlement } from '../../../src/lib/settlement.js'
import { fetchAllRows } from '../../../src/lib/fetchAll.js'
import type { CampaignCaller, CampaignFacts, DeskHolder } from '../../../src/lib/campaigns.js'
import type { UserRole } from '../../../src/types.js'
import { moneyZa, todayInJohannesburg } from '../workflow/locale.js'

/**
 * WHAT THE CAMPAIGN SENDER NEEDS TO KNOW ABOUT ACCOUNTS, read with the service client.
 *
 * Two shapes. `factsFor` is the skip rule's input for thousands of accounts at once -- a handful of
 * columns, read in chunks -- because the preview counts the whole selection. `valuesFor` is ONE
 * account's merge values, read at the moment its message goes, because that is when the balance
 * and the names have to be right.
 */

/** Ids per `.in()` -- PostgREST puts filters in the query string. The hand-out's figure. */
const CHUNK = 100

const chunks = <T>(list: T[], n = CHUNK): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n))
  return out
}

interface ContactRow { account_id?: string; kind: string; value: string | null; is_primary: boolean | null; retired_at: string | null }

/** The primary live contact of a kind, never a retired one -- step.ts's rule, word for word. */
export function pickContact(contacts: ContactRow[], kind: string): string | null {
  const live = contacts.filter((c) => c.kind === kind && !c.retired_at)
  const pick = live.find((c) => c.is_primary) ?? live[0]
  return (pick?.value ?? '').trim() || null
}

export interface AccountFacts extends CampaignFacts {
  id: string
  assignedTo: string | null
  /** The client's liaison (companies.account_owner_id) -- a liaison may campaign on their own clients. */
  liaisonId: string | null
}

/**
 * The skip rule's facts for every account named, keyed by id. An id that is not an account is
 * simply absent -- the caller counts it as gone.
 */
export async function factsFor(
  admin: SupabaseClient, ids: string[], today: string,
): Promise<Map<string, AccountFacts>> {
  const out = new Map<string, AccountFacts>()
  for (const part of chunks([...new Set(ids)])) {
    const [accounts, contacts, disputes, steps] = await Promise.all([
      admin.from('debtor_accounts')
        .select('id, book, hold_reason, prescribed, debtor_kind, assigned_to, companies(account_owner_id)')
        .in('id', part),
      fetchAllRows<ContactRow>(() => admin.from('account_contacts')
        .select('account_id, kind, value, is_primary, retired_at')
        .in('account_id', part).in('kind', ['mobile', 'phone', 'email']).order('id'), { table: 'contacts' }),
      /* kind = 'dispute' and nothing else: 'help' is a collector asking a leader, 'litigation' is
         the firm's own. Neither is something a debtor alleged. */
      fetchAllRows<{ account_id: string }>(() => admin.from('account_queries')
        .select('account_id').in('account_id', part).eq('kind', 'dispute').neq('status', 'closed')
        .order('id'), { table: 'disputes' }),
      /* A WORKFLOW NOTICE TODAY: sent today, or pending and due by today (the morning run sends it).
         A held step is waiting on a person or a fact and is not going today. */
      fetchAllRows<{ state: string; sent_at: string | null; due_on: string; workflow_runs: { account_id: string } | { account_id: string }[] }>(
        () => admin.from('workflow_run_steps')
          .select('state, sent_at, due_on, workflow_runs!inner(account_id, state)')
          /* Plain filters, the day decided below: a step sent today was due by today, so
             `due_on <= today` over pending and sent is a superset of both halves. */
          .in('workflow_runs.account_id', part).eq('workflow_runs.state', 'running')
          .in('state', ['pending', 'sent']).lte('due_on', today)
          .order('id'), { table: 'steps' }),
    ])
    if (accounts.error) throw new Error(accounts.error.message)
    const byAccount = new Map<string, ContactRow[]>()
    for (const c of contacts) {
      const list = byAccount.get(c.account_id as string) ?? []
      list.push(c)
      byAccount.set(c.account_id as string, list)
    }
    const disputed = new Set(disputes.map((d) => d.account_id))
    const worked = new Set(steps.filter((s) => s.state === 'pending'
      || (s.state === 'sent' && !!s.sent_at && todayInJohannesburg(new Date(s.sent_at)) === today)).map((s) => {
      const run = Array.isArray(s.workflow_runs) ? s.workflow_runs[0] : s.workflow_runs
      return run?.account_id
    }))
    for (const a of (accounts.data ?? []) as Record<string, unknown>[]) {
      const list = byAccount.get(a.id as string) ?? []
      out.set(a.id as string, {
        id: a.id as string,
        assignedTo: (a.assigned_to as string) ?? null,
        liaisonId: ((Array.isArray(a.companies) ? a.companies[0] : a.companies) as { account_owner_id?: string } | null)?.account_owner_id ?? null,
        book: (a.book as string) ?? null,
        holdReason: (a.hold_reason as string) ?? null,
        prescribed: Boolean(a.prescribed),
        debtorKind: a.debtor_kind === 'company' ? 'company' : 'individual',
        /* A landline stands in for a mobile exactly as it does in step.ts, and looksLikeMobile is
           what refuses one an SMS cannot reach. */
        mobile: pickContact(list, 'mobile') ?? pickContact(list, 'phone'),
        email: pickContact(list, 'email'),
        openDispute: disputed.has(a.id as string),
        workflowToday: worked.has(a.id as string),
      })
    }
  }
  return out
}

/** Who is asking, as campaigns.ts's rule wants them. Null where there is no such profile. */
export async function callerFor(admin: SupabaseClient, userId: string): Promise<(CampaignCaller & { name: string; email: string | null }) | null> {
  const { data } = await admin.from('profiles')
    .select('id, name, email, role, team_id, grants, revokes').eq('id', userId).maybeSingle()
  if (!data) return null
  return {
    id: data.id as string, name: (data.name as string) ?? '', email: (data.email as string) ?? null,
    role: data.role as UserRole, teamId: (data.team_id as string) ?? null,
    grants: (data.grants as string[] | null) ?? undefined, revokes: (data.revokes as string[] | null) ?? undefined,
  }
}

/** Every desk holder named, for mayCampaignOn. */
export async function holdersFor(admin: SupabaseClient, userIds: (string | null)[]): Promise<Map<string, DeskHolder>> {
  const ids = [...new Set(userIds.filter((u): u is string => !!u))]
  const out = new Map<string, DeskHolder>()
  for (const part of chunks(ids)) {
    const { data, error } = await admin.from('profiles').select('id, role, team_id').in('id', part)
    if (error) throw new Error(error.message)
    for (const p of data ?? []) {
      out.set(p.id as string, { id: p.id as string, role: p.role as UserRole, teamId: (p.team_id as string) ?? null })
    }
  }
  return out
}

/**
 * ONE ACCOUNT'S MERGE VALUES, the moment its message goes.
 *
 * THE SAME ASSEMBLY AS THE WORKFLOW RUNNER'S (api/_lib/workflow/step.ts), through the same
 * functions: storedBalance's ledger reader, balanceInputFor's position, computeBalance's figure,
 * accountMergeValues' answers, the firm's settings mapped and never cast. check-campaigns holds the
 * account fields passed here against step.ts's, so a field added there and forgotten here fails a
 * check rather than holding a debtor's message for a placeholder.
 *
 * TWO THINGS DIFFER, AND ON PURPOSE.
 *   THE AGENT IS THE PERSON WHO RAN THE CAMPAIGN. The email leaves from their mailbox and a reply
 *     comes back to them, so {{agent_name}} must be them. The collector is still the account's.
 *   NO DISPUTE FIELDS. An account with an open dispute is skipped before it gets here, so the four
 *     {{dispute_*}} fields have nothing honest to say and a message quoting them skips as unfilled.
 */
export async function valuesFor(
  admin: SupabaseClient, accountId: string, agentId: string, today: string,
): Promise<{ values: Record<string, string>; account: Record<string, unknown> } | null> {
  const [accountRes, firmRes] = await Promise.all([
    admin.from('debtor_accounts').select('*, companies(name, account_owner_id)').eq('id', accountId).maybeSingle(),
    admin.from('firm_settings').select('*').maybeSingle(),
  ])
  const account = accountRes.data as Record<string, any> | null
  if (!account || !firmRes.data) return null

  const person = (id: string | null) => (id
    ? admin.from('profiles').select('id, name, phone, email, whatsapp').eq('id', id).maybeSingle()
    : Promise.resolve({ data: null }))
  const [contactsRes, collectorRes, liaisonRes, agentRes, ledgers, promiseRes, settlementRes] = await Promise.all([
    admin.from('account_contacts').select('kind, value, is_primary, retired_at').eq('account_id', accountId),
    person(account.assigned_to ?? null),
    person(account.companies?.account_owner_id ?? null),
    person(agentId),
    fetchLedgerRows(admin, [accountId]),
    admin.from('promises_to_pay')
      .select('id, amount, due_on, arrangement, day_of_month, on_last_day, day_of_week, instalments_kept, total_promised')
      .eq('account_id', accountId).in('status', ['open', 'defaulted'])
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    admin.rpc('account_settlement', { p_account: accountId }),
  ])

  const ledgerRows = ledgers.get(accountId) ?? { payments: [], fees: [], accruals: [] }
  const balanceInput = balanceInputFor({ account: balanceAccountFromRow(account), ledgers: ledgerRows, today })
  const balance = computeBalance(balanceInput)
  const collector = collectorRes.data

  const values = accountMergeValues({
    account: {
      caseNumber: account.case_number ?? null,
      handoverDate: account.handover_date ?? account.opening_as_at ?? null,
      capitalHandedOver: Number(account.capital_handed_over ?? 0),
      paymentsToDate: balance.payments,
      listingDate: account.listing_date ?? null,
      listingReference: account.listing_reference ?? null,
      bureausListed: account.bureaus_listed ?? null,
      debtorKind: account.debtor_kind === 'company' ? 'company' : 'individual',
      debtorTitle: account.debtor_title ?? null,
      debtorFirstName: account.debtor_first_name ?? null,
      debtorSurname: account.debtor_surname ?? null,
      accountNumber: account.account_number ?? null,
      clientReference: account.client_reference ?? null,
      capitalOutstanding: Number(account.capital_outstanding ?? 0),
      preferredLanguage: account.preferred_language ?? null,
    },
    balance: balance.balance,
    clientName: account.companies?.name ?? null,
    agent: agentRes.data ?? collector,
    collector,
    liaison: liaisonRes.data,
    debtorIdNumber: account.debtor_id_number ?? null,
    contacts: ((contactsRes.data ?? []) as ContactRow[]).map((c) => ({
      kind: c.kind, value: c.value, isPrimary: c.is_primary, retiredAt: c.retired_at,
    })),
    firm: toFirmSettings(firmRes.data as never),
    today,
    money: moneyZa,
    nextInstalment: nextUnpaidFromRow(promiseRes.data),
    settlement: (() => {
      const row = (settlementRes.data as Record<string, unknown>[] | null)?.[0]
      return row ? toSettlement(row) : null
    })(),
    arrangement: nextUnpaidFromRow(promiseRes.data)
      ? ((promiseRes.data?.arrangement as Arrangement | null) ?? null) : null,
    paymentReceived: [...balanceInput.ledgers.payments].sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.amount ?? null,
    dispute: null,
  })
  return { values: values as Record<string, string>, account }
}
