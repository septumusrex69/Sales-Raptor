/**
 * CHANGING A CLIENT'S COMMISSION, from wherever it is changed -- Trust settings or the client page.
 *
 * One function, because the two screens doing it differently is the drift prompt 9 is about: one
 * place recording a reason and re-splitting the accounts, the other writing the column and nothing
 * else, and a month later nobody can say why Kestrel is on 10%.
 *
 * ONE RULE OR THE OTHER, NEVER BOTH. account_commission_rate prices from the bands whenever there
 * are any, so a flat rate saved over a scale has to clear the scale, and a scale has to clear the
 * flat rate -- otherwise the screen says 30% while the bands do the pricing. The register's tiers
 * are left alone either way: they are what Swordfish filed, a fact about history, not a rule.
 */
import { supabase } from './supabase'
import { logSettingChange, reallocateAccount } from './payover'
import { bandWords, pct } from './commissionRule'
import type { CommissionBand } from './commission'

export type CommissionChange =
  | { kind: 'rate'; rate: number }
  | { kind: 'scale'; bands: CommissionBand[]; source: string; dated: string | null }

export interface CommissionClient {
  id: string
  name: string
  rate: number | null
  bands: CommissionBand[] | null
}

/** The rule in one line, for the audit trail: "30%", or "R0–R25 000 · 25% / R25 000+ · 22.5%". */
export function ruleLine(rule: { rate: number | null; bands: CommissionBand[] | null }): string {
  if (rule.bands && rule.bands.length > 0) return rule.bands.map((_, i) => bandWords(rule.bands!, i)).join(' / ')
  return rule.rate === null ? 'none' : pct(rule.rate)
}

/** What was written, as the Company type spells it -- so a screen can show it without a re-fetch. */
export interface SavedCommission {
  commissionRate: number | undefined
  commissionBands: CommissionBand[] | undefined
  commissionBandsSource: string | undefined
  commissionBandsDated: string | undefined
}

export async function saveCommission(client: CommissionClient, next: CommissionChange, reason: string): Promise<SavedCommission> {
  const patch = next.kind === 'rate'
    ? { commission_rate: next.rate, commission_bands: null, commission_bands_source: null, commission_bands_dated: null }
    : {
      commission_rate: null, commission_bands: next.bands,
      commission_bands_source: next.source, commission_bands_dated: next.dated,
    }
  const { error } = await supabase.from('companies').update(patch).eq('id', client.id)
  if (error) throw new Error(error.message)

  await logSettingChange({
    setting: next.kind === 'rate' ? 'commission_rate' : 'commission_bands',
    companyId: client.id, scope: client.name,
    oldValue: ruleLine(client),
    newValue: next.kind === 'rate' ? pct(next.rate) : ruleLine({ rate: null, bands: next.bands }),
    reason,
  })

  /*
   * AND THE ACCOUNTS ARE REPLAYED. Setting the rule alone changes nothing already split: the
   * allocations were written with the old rate and it is the allocations a run is built from. An
   * account with its OWN rate -- one imported at what Swordfish billed -- is replayed at that rate
   * still; only accounts priced from the client's rule move. Capped, because a client with nine
   * thousand accounts is not a thing to do from a browser -- the rest are picked up by the
   * exception queue account by account, which is where somebody is looking anyway.
   */
  const { data: accts } = await supabase.from('debtor_accounts')
    .select('id').eq('company_id', client.id).limit(200)
  for (const a of ((accts ?? []) as { id: string }[])) {
    await reallocateAccount(a.id)
  }
  return next.kind === 'rate'
    ? { commissionRate: next.rate, commissionBands: undefined, commissionBandsSource: undefined, commissionBandsDated: undefined }
    : { commissionRate: undefined, commissionBands: next.bands, commissionBandsSource: next.source, commissionBandsDated: next.dated ?? undefined }
}
