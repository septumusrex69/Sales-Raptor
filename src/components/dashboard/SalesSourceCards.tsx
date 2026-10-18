import { Link } from 'react-router-dom'
import { Card, CardHeader } from '../ui/Card'
import type { SourceRow } from '../../lib/clientBook'

/**
 * DAYS FROM MANDATE TO FIRST HANDOVER, per closer (the firm, 18 Oct: "days from the mandate to first
 * handover is kind of a cool thing"). Whether a closer signs clients who actually send work: the
 * average gap, how many have handed over, and how many signed and are still waiting. Fastest first;
 * a closer whose clients have all yet to hand over goes last, not first, because no average there is
 * not a fast one.
 */
export function MandateToHandoverCard({ rows, spanLabel }: {
  rows: { ownerId: string; name: string; avgDays: number | null; handedOver: number; waiting: number }[]
  spanLabel: string
}) {
  const sorted = [...rows].sort((a, b) => (a.avgDays ?? Infinity) - (b.avgDays ?? Infinity) || b.handedOver - a.handedOver)
  return (
    <Card className="h-full" padded={false}>
      <div data-testid="mandate-to-handover">
        <div className="p-5 pb-3">
          <CardHeader title="Mandate to first handover" subtitle={`Days from a signed mandate to the client's first account, per closer · mandates signed ${spanLabel}`} />
        </div>
        {sorted.length === 0 ? <p className="px-5 pb-5 text-sm text-slate-400">No mandates signed in this span.</p> : (
          <div className="overflow-x-auto px-5 pb-4">
            <table className="list-table w-full">
              <thead>
                <tr className="text-left text-[11px] text-slate-400">
                  <th className="py-1.5 pr-2 font-medium">Closer</th>
                  <th className="py-1.5 px-2 text-right font-medium">Average</th>
                  <th className="py-1.5 px-2 text-right font-medium">Handed over</th>
                  <th className="py-1.5 pl-2 text-right font-medium">Still waiting</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {sorted.map((r) => (
                  <tr key={r.ownerId} className="whitespace-nowrap">
                    <td className="max-w-[14rem] truncate py-1.5 pr-2"><Link to={`/reps/${r.ownerId}`} className="font-medium text-slate-800 hover:underline">{r.name}</Link></td>
                    <td className="py-1.5 px-2 text-right tabular-nums font-semibold text-slate-800">{r.avgDays === null ? '—' : `${r.avgDays} ${r.avgDays === 1 ? 'day' : 'days'}`}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-slate-600">{r.handedOver}</td>
                    <td className={`py-1.5 pl-2 text-right tabular-nums ${r.waiting ? 'font-semibold text-gold-800' : 'text-slate-400'}`}>{r.waiting}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  )
}

/**
 * WHICH LEAD SOURCES TURN INTO MANDATES (the firm, 18 Oct). Leads and mandates per source over the
 * same months as the chart above, with the share signed and a bar of the mandates so the source that
 * actually brings clients stands out from the one that only brings volume.
 */
export function LeadSourcesCard({ rows, spanLabel }: { rows: SourceRow[]; spanLabel: string }) {
  const top = Math.max(1, ...rows.map((r) => r.mandates))
  return (
    <Card className="h-full" padded={false}>
      <div data-testid="lead-sources">
        <div className="p-5 pb-3">
          <CardHeader title="Where mandates come from" subtitle={`Leads and mandates signed by lead source · ${spanLabel}`} />
        </div>
        {rows.length === 0 ? <p className="px-5 pb-5 text-sm text-slate-400">No leads or mandates in this span.</p> : (
          <div className="overflow-x-auto px-5 pb-4">
            <table className="list-table w-full">
              <thead>
                <tr className="text-left text-[11px] text-slate-400">
                  <th className="py-1.5 pr-2 font-medium">Source</th>
                  <th className="py-1.5 px-2 text-right font-medium">Leads</th>
                  <th className="py-1.5 px-2 font-medium">Mandates</th>
                  <th className="py-1.5 pl-2 text-right font-medium">Signed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map((r) => (
                  <tr key={r.source} className="whitespace-nowrap">
                    <td className="py-1.5 pr-2 font-medium text-slate-800">{r.source}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-slate-600">{r.leads}</td>
                    <td className="py-1.5 px-2">
                      <span className="flex items-center gap-2">
                        <span className="h-2 rounded-full bg-navy-700" style={{ width: `${Math.max(r.mandates ? 4 : 0, (r.mandates / top) * 72)}px` }} />
                        <span className="tabular-nums font-semibold text-slate-800">{r.mandates}</span>
                      </span>
                    </td>
                    <td className="py-1.5 pl-2 text-right tabular-nums text-slate-600">{r.rate === null ? '—' : `${r.rate}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  )
}
