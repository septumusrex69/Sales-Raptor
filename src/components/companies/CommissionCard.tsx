import { useState } from 'react'
import { Card, CardHeader } from '../ui/Card'
import { tierStart } from '../../lib/commission.ts'
import { ruleKind, tierWords } from '../../lib/commissionRule'
import type { SavedCommission } from '../../lib/commissionChange'
import { canViewFinance } from '../../lib/permissions'
import { useAuth } from '../../store/AuthContext'
import { CommissionModal } from './CommissionModal'
import type { Company } from '../../types'

const money = (n: number) => n.toLocaleString('en-ZA', {
  style: 'currency', currency: 'ZAR', minimumFractionDigits: 2,
})
const percent = (fraction: number) => `${(fraction * 100).toFixed(2).replace(/\.00$/, '')}%`

/**
 * What this client is billed on.
 *
 * THE FIRM: "I don't see anywhere where their collection commission is displayed. They're signing
 * what they're signed on."
 *
 * It was stored and never shown — `commission_rate` and `commission_bands` have been on
 * `companies` since the Swordfish import wrote them, and no screen read them back. The one number
 * every account on this client's book inherits, and the only way to see it was to open an account
 * and read the rate stamped on it.
 *
 * SHOWN AS A FRACTION TURNED BACK INTO A PERCENTAGE, because that is how it is spoken about. The
 * database holds 0.3 and a person says thirty percent; a card showing 0.3 would be read as a
 * third of a percent by somebody in a hurry.
 *
 * AND THE SOURCE IS SHOWN WITH IT, where there is one. A rate with no mandate behind it is a rate
 * somebody typed, and the difference matters the day a client queries an invoice.
 */
export function CommissionCard({ company: stored }: { company: Company }) {
  const { currentUser } = useAuth()
  /*
   * WHAT WAS JUST SAVED, laid over the store's copy. The store loaded companies once and the save
   * went straight to the database (saveCommission, shared with Trust settings), so without this the
   * card would go on showing the old rule until a reload -- the one moment somebody is looking.
   */
  const [saved, setSaved] = useState<SavedCommission | null>(null)
  const [editing, setEditing] = useState(false)
  const company: Company = saved ? { ...stored, ...saved } : stored
  const bands = company.commissionBands ?? []
  const tiers = company.commissionTiers ?? []
  const kind = ruleKind(company)
  const hasScale = kind === 'scale'
  const hasRate = typeof company.commissionRate === 'number' && company.commissionRate > 0
  /* THE SAME TICK AS TRUST SETTINGS, where the other door to this dialog is. Who may change what a
     client is billed is a finance question, not a question of who may edit the client's address. */
  const mayEdit = canViewFinance(currentUser)

  return (
    <Card>
      <CardHeader
        title="Collection commission"
        subtitle={hasScale ? 'A sliding scale on the capital handed over' : undefined}
        action={mayEdit ? (
          <button type="button" onClick={() => setEditing(true)}
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-[12.5px] font-medium text-slate-700 hover:bg-slate-100">
            Edit
          </button>
        ) : undefined} />

      {kind === 'scale_without_bands' && (
        /*
          THE REGISTER'S TIERS, WHERE THERE ARE NO BANDS. Swordfish filed this client's accounts
          under prefixes, one rate each (KIS 21%, KIS2 15%...), and that is all it ever recorded: the
          rand amounts where one tier stops and the next starts are in the signed mandate. Shown
          because they are true and are what history was billed on -- and the missing half said,
          because until it is typed no new handover for this client can be priced.
        */
        <div className="space-y-1.5">
          <p className="text-sm text-slate-700">
            On a {tiers.length}-tier scale: <span className="font-medium tabular-nums">{tierWords(tiers)}</span>
          </p>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
            Boundaries not yet captured. A new handover for this client cannot be priced until the rand
            amount where each tier ends is entered from the mandate.
          </p>
        </div>
      )}

      {kind === 'none' && (
        /*
          A WARNING THAT ONLY FIRES WHEN SOMETHING IS WRONG. An account opened for a client with no
          rate inherits nothing, and it is invoiced at whatever somebody types on the day.
        */
        <p className="text-sm text-negative-700">
          Nothing signed. An account opened for this client inherits no rate, so it would be
          invoiced at whatever is typed on the day.
        </p>
      )}

      {hasScale ? (
        <ul className="space-y-1.5">
          {bands.map((b, i) => {
            const from = tierStart(i === 0 ? null : bands[i - 1].upTo)
            return (
              <li key={i} className="flex items-baseline justify-between gap-3 text-sm tabular-nums">
                <span className="text-slate-600">
                  {from === null ? '—' : money(from)}
                  {b.upTo === null ? ' and above' : ` up to ${money(b.upTo)}`}
                </span>
                <span className="font-semibold text-navy-950">{percent(b.rate)}</span>
              </li>
            )
          })}
        </ul>
      ) : hasRate ? (
        <p className="text-2xl font-semibold text-navy-950 tabular-nums">
          {percent(company.commissionRate as number)}
          <span className="ml-2 text-sm font-normal text-slate-500">of everything collected</span>
        </p>
      ) : null}

      {/* GUARDED, or the rule and its padding draw under every rate with nothing beneath them --
          which is what moving the mandate line out of here would otherwise have left behind. */}
      {hasScale && company.commissionBandsSource && (
      <div className="mt-3 pt-3 border-t border-slate-100 space-y-1 text-[11px] text-slate-400">
        <p>{company.commissionBandsSource}{company.commissionBandsDated ? `, dated ${company.commissionBandsDated}` : ''}</p>
        {/*
          THE MANDATE DATE USED TO BE HERE, because it is the same question asked twice: on whose
          authority, and on what terms. It is MandateCard now, directly below this one -- which
          also sets the date and takes the signed mandate itself, neither of which this card could
          do. Two cards an inch apart both saying "no mandate on record" is a warning people stop
          reading, so this one says nothing and the one that can fix it says it.
        */}
      </div>
      )}

      {editing && (
        <CommissionModal
          client={{
            id: company.id, name: company.name,
            rate: company.commissionRate ?? null,
            bands: bands.length > 0 ? bands : null,
            bandsSource: company.commissionBandsSource ?? null,
            bandsDated: company.commissionBandsDated ?? null,
            tiers: tiers.length > 0 ? tiers : null,
          }}
          onClose={() => setEditing(false)}
          onSaved={(next) => { setSaved(next); setEditing(false) }}
        />
      )}
    </Card>
  )
}
