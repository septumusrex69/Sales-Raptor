import { useEffect, useState } from 'react'
import { Loader2, Mail, MessageSquare, Phone, Search, Trophy } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { formatDate } from '../../data/mockData'
import { rand } from '../../lib/money'
import {
  fetchCampaignResults, fetchResultsByCollector, fetchTraceFunnel,
  type CampaignResult, type CollectorResult, type TraceFunnelRow,
} from '../../lib/campaignApi'
import { resultKind, traceFunnel } from '../../lib/campaignResults.ts'

/**
 * CAMPAIGN RESULTS: how every campaign went, for everybody (S10, 22 Oct).
 *
 * THE FIRM: "Collector sees the campaign results, also the administrators ... anybody can see the
 * campaign results ... we can just have a place about like campaign results. PTPs made."
 *
 * READ, NOT RUN. Starting and stopping a campaign is still campaign.run's, on the Campaigns page;
 * this page has no button that changes anything. Its figures come already summed from the database
 * (campaign_results, security definer), so a collector sees every campaign's outcome without being
 * able to read another team's campaign rows.
 *
 * NO FEES. A page everybody sees carries no figure the firm earns (CLAUDE.md); the rand amounts are
 * what debtors promised and paid. The fees an SMS or email campaign raised are on the Campaigns page,
 * for the people who run them.
 *
 * WHAT "PTPs MADE" MEANS is in campaignResults.ts and HANDOFF: a promise recorded on the account by
 * the collector whose diary the call was on, between the call landing there and the end of the day
 * they worked it.
 */
export function CampaignResultsPage() {
  const [rows, setRows] = useState<CampaignResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetchCampaignResults()
      .then((r) => { if (live) setRows(r) })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'The results could not be read.') })
    return () => { live = false }
  }, [])

  const calls = (rows ?? []).filter((r) => r.channel === 'call')
  const ptps = calls.reduce((n, r) => n + r.ptps, 0)
  const promised = calls.reduce((n, r) => n + r.ptpAmount, 0)
  const reopened = calls.reduce((n, r) => n + r.reopened, 0)

  return (
    <div className="space-y-4" data-testid="campaign-results">
      <div>
        <h1 className="text-lg font-semibold text-slate-800 flex items-center gap-2"><Trophy size={18} /> Campaign results</h1>
        <p className="text-[13px] text-slate-500">
          Every campaign the firm has run, and what came of it: the calls worked, the promises to pay made on them, the
          accounts won back, and what each trace led to.
        </p>
      </div>
      {rows && calls.length > 0 && (
        <div className="grid grid-cols-3 gap-3" data-testid="results-totals">
          <Figure label="PTPs made on campaign calls" value={ptps.toLocaleString('en-ZA')} />
          <Figure label="Promised" value={rand(promised)} />
          <Figure label="Accounts won back" value={reopened.toLocaleString('en-ZA')} />
        </div>
      )}
      <Card padded={false}>
        {error && <p className="px-4 py-3 text-[13px] text-negative-700">{error}</p>}
        {!rows ? (
          <div className="py-8 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-slate-400" /></div>
        ) : rows.length === 0 ? (
          <p className="px-5 py-4 text-[14px] text-slate-600">No campaigns have been run yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => <ResultRow key={r.id} r={r} />)}
          </ul>
        )}
      </Card>
    </div>
  )
}

function ResultRow({ r }: { r: CampaignResult }) {
  const [people, setPeople] = useState<CollectorResult[] | null>(null)
  const [open, setOpen] = useState(false)
  const [funnel, setFunnel] = useState<TraceFunnelRow[] | null>(null)
  const trace = r.channel === 'call' && r.callKind === 'trace'

  /* A TRACE CAMPAIGN'S FUNNEL is the result, so it is read with the row rather than on request. */
  useEffect(() => {
    if (!trace) return
    let live = true
    fetchTraceFunnel(r.id).then((f) => { if (live) setFunnel(f) }).catch(() => { if (live) setFunnel([]) })
    return () => { live = false }
  }, [trace, r.id])

  const toggle = async () => {
    setOpen((o) => !o)
    if (!people && r.channel === 'call') {
      try { setPeople(await fetchResultsByCollector(r.id)) } catch { setPeople([]) }
    }
  }
  const icon = r.channel === 'sms' ? <MessageSquare size={14} className="text-slate-400" />
    : r.channel === 'email' ? <Mail size={14} className="text-slate-400" />
      : trace ? <Search size={14} className="text-slate-400" /> : <Phone size={14} className="text-slate-400" />
  const n = (x: number) => x.toLocaleString('en-ZA')
  const f = funnel ? traceFunnel(funnel) : null

  return (
    <li className="px-4 py-3" data-testid="result-row">
      <div className="flex flex-wrap items-center gap-2">
        {icon}
        <span className="font-medium text-slate-800">{r.name}</span>
        <span className="text-[11px] rounded px-1.5 py-0.5 bg-slate-100 text-slate-600" data-testid="result-kind">{resultKind(r)}</span>
        <span className="text-xs text-slate-500">
          {r.createdByName ?? 'Somebody'} · {formatDate(r.startsOn ?? r.createdAt)}
          {r.endsOn && r.endsOn !== r.startsOn ? ` to ${formatDate(r.endsOn)}` : ''}
          {' · '}{r.status === 'sending' ? (r.channel === 'call' ? 'Running' : 'Sending') : r.status === 'stopped' ? 'Stopped' : r.channel === 'call' ? 'Ended' : 'Finished'}
        </span>
      </div>
      {r.channel !== 'call' ? (
        <p className="mt-1.5 text-[12.5px] text-slate-600 tabular-nums" data-testid="result-counts">
          {n(r.sent)} sent · {n(r.skipped)} skipped · {n(r.failed)} failed
        </p>
      ) : (
        <p className="mt-1.5 text-[12.5px] text-slate-600 tabular-nums" data-testid="result-counts">
          {n(r.worked)} worked · {n(r.waiting)} waiting · {n(r.missed)} missed
          {!trace && <> · <span className="text-slate-800 font-medium">{n(r.ptps)} {r.ptps === 1 ? 'PTP' : 'PTPs'} made ({rand(r.ptpAmount)})</span></>}
          {r.callKind === 'recovery' && <> · {n(r.reopened)} won back</>}
          {' · '}
          <button type="button" onClick={toggle} className="underline underline-offset-2 text-slate-500 hover:text-slate-700">
            {open ? 'Hide collectors' : 'By collector'}
          </button>
        </p>
      )}
      {trace && (
        !f ? <Loader2 className="mt-2 h-3.5 w-3.5 animate-spin text-slate-400" /> : (
          <ol className="mt-2 grid grid-cols-3 sm:grid-cols-6 gap-1.5 text-center" data-testid="trace-funnel">
            {([
              ['Sent to trace', n(f.referred)],
              ['Searched', n(f.searched)],
              ['New details', n(f.details)],
              ['Contact made', n(f.contact)],
              ['PTP made', `${n(f.promised)} · ${rand(f.promisedAmount)}`],
              ['Paid', `${n(f.paid)} · ${rand(f.paidAmount)}`],
            ] as const).map(([label, value]) => (
              <li key={label} className="rounded-lg border border-slate-200 px-2 py-1.5">
                <p className="text-[10.5px] uppercase tracking-wide text-slate-500">{label}</p>
                <p className="text-[13px] font-semibold text-navy-950 tabular-nums">{value}</p>
              </li>
            ))}
          </ol>
        )
      )}
      {open && (
        !people ? <Loader2 className="mt-2 h-3.5 w-3.5 animate-spin text-slate-400" /> : (
          <ul className="mt-2 text-[12.5px] text-slate-600 space-y-0.5" data-testid="result-by-collector">
            {people.map((p) => (
              <li key={p.ownerId ?? 'none'} className="tabular-nums">
                <span className="text-slate-800">{p.ownerName}</span> — {p.worked} worked · {p.waiting} waiting · {p.missed} missed
                {!trace && <> · {p.ptps} {p.ptps === 1 ? 'PTP' : 'PTPs'} ({rand(p.ptpAmount)})</>}
                {r.callKind === 'recovery' && <> · {p.reopened} won back</>}
              </li>
            ))}
          </ul>
        )
      )}
      {open && trace && funnel && funnel.length > 0 && (
        <table className="mt-2 w-full text-[12px] text-slate-600" data-testid="trace-accounts">
          <thead><tr className="text-left text-slate-400">
            <th className="font-normal">Account</th><th className="font-normal">Searched</th><th className="font-normal">New details</th>
            <th className="font-normal">Contact</th><th className="font-normal">PTP</th><th className="font-normal text-right">Paid</th>
          </tr></thead>
          <tbody>
            {funnel.map((a) => (
              <tr key={a.accountId}>
                <td className="py-0.5">{a.caseNumber ?? '—'} {a.debtor ? `· ${a.debtor}` : ''}</td>
                <td>{a.searchedAt ? formatDate(a.searchedAt) : '—'}</td>
                <td>{a.detailsAt ? formatDate(a.detailsAt) : '—'}</td>
                <td>{a.contactAt ? formatDate(a.contactAt) : '—'}</td>
                <td>{a.promisedAt ? rand(a.promised) : '—'}</td>
                <td className="text-right tabular-nums">{a.paid > 0 ? rand(a.paid) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </li>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-xl font-semibold text-navy-950 tabular-nums">{value}</p>
    </div>
  )
}
