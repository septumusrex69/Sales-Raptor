/**
 * THE CLIENT REPORT, FETCHED AND DRAWN (S9, 19 Oct). The four reads the client page already makes --
 * the same RPCs, the same accounts -- handed to buildClientReport and then to the PDF. Nothing is
 * stored: the report is drawn the moment somebody presses for it, so it says what is true today.
 */
import { supabase } from './supabase'
import { clockNow, clockToday } from './clock'
import { fetchFirmSettings } from './firmSettings'
import { fetchClientIntakeByDay, isoDay } from './companySnapshotData'
import { intakeMonthBars } from './companySnapshot'
import { getCurrentSalesMonth, getPreviousSalesMonth } from './salesMonth'
import { buildClientReport, clientReportFilename, type ActiveAccount } from './clientReport'
import { clientReportPdf } from './clientReportPdf'
import type { OutcomeRow } from './clientOutcomes'
import type { MoneyDay } from './clientCollections'

const MONTHS = 12

export async function clientReportFile(client: { id: string; name: string; code: string | null; accountIds: string[] }): Promise<{ blob: Blob; filename: string }> {
  const today = clockToday()
  const now = getCurrentSalesMonth(clockNow())
  let first = now
  for (let i = 1; i < MONTHS; i++) first = getPreviousSalesMonth(first)

  const [outcomesRes, moneyRes, intake, firm, active] = await Promise.all([
    supabase.rpc('client_account_outcomes', { p_client: client.id }),
    supabase.rpc('client_money_by_day', { p_client: client.id }),
    fetchClientIntakeByDay(client.id, { start: first.start, end: now.end }),
    fetchFirmSettings(),
    activeAccounts(client.accountIds),
  ])
  if (outcomesRes.error) throw new Error(outcomesRes.error.message)
  if (moneyRes.error) throw new Error(moneyRes.error.message)

  const outcomes: OutcomeRow[] = ((outcomesRes.data ?? []) as Record<string, unknown>[])
    .map((r) => ({ outcome: String(r.outcome), accounts: Number(r.accounts), capital: Number(r.capital), collected: Number(r.collected) }))
  const money: MoneyDay[] = ((moneyRes.data ?? []) as Record<string, unknown>[])
    .map((r) => ({ day: String(r.day).slice(0, 10), capital: Number(r.capital ?? 0), collected: Number(r.collected ?? 0) }))

  const report = buildClientReport({
    client: { name: client.name, code: client.code },
    today,
    outcomes,
    active,
    money,
    handovers: intakeMonthBars(isoDay(first.start), isoDay(now.end), intake, today),
    months: MONTHS,
  })
  const { bytes, problem } = await clientReportPdf(report, { name: firm.firmName, phone: firm.phone, address: null })
  /* A name the standard faces cannot draw is refused, not substituted (winAnsi). */
  if (problem) throw new Error(problem)
  return { blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }), filename: clientReportFilename(client.name, today) }
}

/** The live book's position fields and capital, a thousand at a time -- a big client's book is past PostgREST's page. */
async function activeAccounts(ids: string[]): Promise<ActiveAccount[]> {
  const out: ActiveAccount[] = []
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await supabase.from('debtor_accounts').select('status, sub_status, bucket, capital_handed_over')
      .in('company_id', ids).in('book', ['active', 'on_hold']).order('id').range(from, from + 999)
    if (error) throw new Error(error.message)
    if (!data) break
    out.push(...data.map((r) => ({
      status: r.status as string | null, subStatus: r.sub_status as string | null, bucket: r.bucket as string | null,
      capital: Number(r.capital_handed_over ?? 0),
    })))
    if (data.length < 1000) break
  }
  return out
}
