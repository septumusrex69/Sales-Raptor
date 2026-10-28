import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardHeader } from '../ui/Card'
import { RingDonut } from '../ui/RingDonut'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/AppStore'
import { outcomeRing, positionRing, type OutcomeRow } from '../../lib/clientOutcomes'
import { CLIENT_POSITION_COLOUR } from '../../lib/clientPosition'

/* One colour a rung -- shared with the client portal's dashboard (clientPosition.ts). */
const POSITION_COLOUR = CLIENT_POSITION_COLOUR
const rand = (v: number) => `R ${Math.round(v).toLocaleString('en-ZA')}`
const OUTCOME_COLOUR = { recovered: '#047857', active: '#c9a24a', closed: '#94a3b8' } as const

/**
 * THE CLIENT'S BOOK, TWO RINGS (S8, 18 Oct). See clientOutcomes.ts for what each counts. Left: what
 * became of the accounts and the recovery rate, withdrawn left out. Right: where the ACTIVE accounts
 * stand, rung by rung. Each line opens those accounts.
 */
export function ClientBookRings({ clientId }: { clientId: string }) {
  const { companies } = useAppStore()
  const ids = useMemo(() => [clientId, ...companies.filter((c) => c.parentCompanyId === clientId).map((c) => c.id)], [companies, clientId])
  const [outcomes, setOutcomes] = useState<OutcomeRow[] | null>(null)
  const [active, setActive] = useState<{ status: string | null; subStatus: string | null; bucket: string | null }[] | null>(null)

  useEffect(() => {
    let live = true
    supabase.rpc('client_account_outcomes', { p_client: clientId }).then(({ data }) => {
      if (live) setOutcomes(((data ?? []) as Record<string, unknown>[]).map((r) => ({ outcome: String(r.outcome), accounts: Number(r.accounts), capital: Number(r.capital), collected: Number(r.collected) })))
    })
    ;(async () => {
      /* The live book's three fields, a thousand at a time: a big client's book is past PostgREST's page. */
      const out: { status: string | null; subStatus: string | null; bucket: string | null }[] = []
      for (let from = 0; from < 50000; from += 1000) {
        const { data, error } = await supabase.from('debtor_accounts').select('status, sub_status, bucket')
          .in('company_id', ids).in('book', ['active', 'on_hold']).order('id').range(from, from + 999)
        if (error || !data) break
        out.push(...data.map((r) => ({ status: r.status as string | null, subStatus: r.sub_status as string | null, bucket: r.bucket as string | null })))
        if (data.length < 1000) break
      }
      if (live) setActive(out)
    })()
    return () => { live = false }
  }, [clientId, ids])

  const ring = outcomes ? outcomeRing(outcomes) : null
  const positions = active ? positionRing(active) : null
  if (ring && ring.total === 0) return null

  return (
    <Card>
      <div data-testid="client-rings">
        <CardHeader title="The book at a glance" subtitle="What became of their accounts, and where the active ones stand. Withdrawn accounts are left out." />
        <div className="grid gap-6 md:grid-cols-2">
          <div className="flex items-start gap-4" data-testid="client-ring-outcomes">
            <div className="w-[150px] shrink-0">
              <RingDonut data={(ring?.slices ?? []).filter((s) => s.accounts > 0).map((s) => ({ name: s.label, value: s.accounts, color: OUTCOME_COLOUR[s.key] }))}
                centerValue={ring ? ring.total.toLocaleString('en-ZA') : '…'} centerLabel="ACCOUNTS"
                caption="What became of them" legend={false} />
            </div>
            <ul className="min-w-0 flex-1 space-y-1.5 pt-2 text-sm">
              {(ring?.slices ?? []).map((s) => (
                <li key={s.key} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: OUTCOME_COLOUR[s.key] }} />
                  <Link to={`/accounts?client=${clientId}&book=${s.key === 'active' ? 'active' : s.key === 'closed' ? 'closed' : 'whole'}`} className="flex-1 text-slate-700 hover:underline">{s.label}</Link>
                  <span className="tabular-nums text-slate-500">{s.accounts}</span>
                  <span className="w-10 text-right tabular-nums font-semibold text-slate-800">{s.pct}%</span>
                </li>
              ))}
              {/*
                THE RECOVERY RATE, OUT OF THE RING'S CENTRE (19 Oct). The ring counts accounts and the
                rate is rands; "27%" in the middle of a ring that was all Active read as a broken
                chart. Here it is a bar of its own that fills to exactly the figure it states.
              */}
              {ring && ring.recoveryRate !== null && (
                <li className="pt-2" data-testid="client-recovery-rate">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-slate-700">Recovered</span>
                    <span className="font-semibold tabular-nums text-slate-800">{ring.recoveryRate}%</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, ring.recoveryRate)}%`, background: OUTCOME_COLOUR.recovered }} />
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    {rand(ring.collected)} collected of {rand(ring.capital)} handed over on these accounts.
                  </p>
                </li>
              )}
            </ul>
          </div>
          <div className="flex items-start gap-4" data-testid="client-ring-positions">
            <div className="w-[150px] shrink-0">
              <RingDonut data={(positions ?? []).map((p) => ({ name: p.label, value: p.accounts, color: POSITION_COLOUR[p.position] }))}
                centerValue={positions ? String(active?.length ?? 0) : '…'} centerLabel="ACTIVE" caption="Where they stand" legend={false} />
            </div>
            <ul className="min-w-0 flex-1 space-y-1.5 pt-2 text-sm">
              {(positions ?? []).map((p) => (
                <li key={p.position} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: POSITION_COLOUR[p.position] }} />
                  <span className="flex-1 truncate text-slate-700">{p.label}</span>
                  <span className="tabular-nums text-slate-500">{p.accounts}</span>
                  <span className="w-10 text-right tabular-nums font-semibold text-slate-800">{p.pct}%</span>
                </li>
              ))}
              {positions && positions.length === 0 && <li className="text-slate-400">No active accounts.</li>}
            </ul>
          </div>
        </div>
      </div>
    </Card>
  )
}
