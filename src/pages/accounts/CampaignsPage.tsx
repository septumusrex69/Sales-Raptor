import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Loader2, Mail, MessageSquare, Phone, Square } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { formatDate } from '../../data/mockData'
import { rand } from '../../lib/money'
import {
  fetchCallProgress, fetchCampaigns, sendCampaignPass, stopCampaign, type CampaignRow,
} from '../../lib/campaignApi'
import { rankWords } from '../../lib/callCampaign.ts'
import { mayManageCampaign } from '../../lib/campaigns.ts'
import { canRunCampaigns } from '../../lib/permissions'
import { useAuth } from '../../store/AuthContext'

/**
 * CAMPAIGNS: what went, what is still going, and a Stop button (S10).
 *
 * WHILE THIS PAGE IS OPEN IT SENDS. Every campaign still sending that this person may run is pushed
 * on a pass at a time -- the server sends what it can in forty seconds and says what is left -- so a
 * campaign started from the list goes out while somebody watches. Close the page and the five-minute
 * mail cron carries on with it; nothing here is the only way a campaign finishes.
 *
 * OUTSIDE THE CALLING HOURS IT WAITS, and says so: the server claims nothing then, and this asks
 * again a minute later rather than hammering a route that will answer the same thing.
 */
export function CampaignsPage() {
  const { currentUser } = useAuth()
  const [params] = useSearchParams()
  const fresh = params.get('c')
  const [rows, setRows] = useState<CampaignRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [waiting, setWaiting] = useState<string | null>(null)
  const [stopping, setStopping] = useState<string | null>(null)
  const pushing = useRef(false)

  const load = useCallback(async () => {
    try { setRows(await fetchCampaigns()); setError(null) }
    catch (e) { setError(e instanceof Error ? e.message : 'The campaigns could not be read.') }
  }, [])
  useEffect(() => { void load() }, [load])

  const caller = currentUser ? {
    id: currentUser.id, role: currentUser.role, teamId: currentUser.teamId ?? null,
    grants: currentUser.grants, revokes: currentUser.revokes,
  } : null
  /* Call campaigns are not sent: their work is on the diaries, and the cron ends them. */
  const mine = (rows ?? []).filter((r) => r.status === 'sending' && r.channel !== 'call'
    && caller && mayManageCampaign(caller, { createdBy: r.createdBy, teamId: r.teamId }))
  const nextId = mine[0]?.id ?? null

  /* ONE PASS AT A TIME, never two in flight: the server's claim would keep them apart anyway, but two
     passes from one screen are two SMTP connections to one mailbox for no gain. */
  /* The page's own life, not the effect's: a pass that finishes after the list was re-read must
     still schedule the next read, or the loop stalls with a campaign half sent. */
  const mounted = useRef(true)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => { mounted.current = false; window.clearTimeout(timer.current) }, [])
  useEffect(() => {
    if (!nextId || pushing.current) return
    pushing.current = true
    void (async () => {
      let delay = 1_500
      try {
        const pass = await sendCampaignPass(nextId)
        if (!mounted.current) return
        if (pass.outsideHours) { setWaiting(pass.outsideHours); delay = 60_000 } else setWaiting(null)
      } catch (e) {
        if (mounted.current) setError(e instanceof Error ? e.message : String(e))
        delay = 30_000
      } finally {
        pushing.current = false
      }
      if (mounted.current) timer.current = window.setTimeout(() => { void load() }, delay)
    })()
  }, [nextId, rows, load])

  async function stop(id: string) {
    setStopping(id)
    try { await stopCampaign(id); await load() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setStopping(null) }
  }

  if (!canRunCampaigns(currentUser)) {
    return <p className="text-sm text-slate-500">Campaigns are run by an Administrator, a team leader or a liaison.</p>
  }

  return (
    <div className="space-y-4" data-testid="campaigns">
      <Link to="/accounts" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={14} /> All accounts
      </Link>
      <div>
        <h1 className="text-lg font-semibold text-slate-800">Campaigns</h1>
        <p className="text-[13px] text-slate-500">
          One SMS or email to a selection of debtors, or a call campaign onto the collectors’ diaries, started from
          the Accounts list. Each message is on the account it went to and charged there under Annexure B; they go
          out only in the firm’s calling hours, and keep going when this page is closed. A call is not charged.
        </p>
      </div>
      {waiting && (
        <p className="rounded-lg border border-gold-300 bg-gold-50 px-4 py-2.5 text-[13px] text-slate-700" data-testid="campaigns-waiting">
          {waiting}
        </p>
      )}
      <Card padded={false}>
        {error && <p className="px-4 py-3 text-[13px] text-negative-700">{error}</p>}
        {!rows ? (
          <div className="py-8 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-slate-400" /></div>
        ) : rows.length === 0 ? (
          <p className="px-5 py-4 text-[14px] text-slate-600">No campaigns yet. Tick accounts on the list and choose Campaign.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => {
              if (r.channel === 'call') {
                const may = !!caller && mayManageCampaign(caller, { createdBy: r.createdBy, teamId: r.teamId })
                return <CallRow key={r.id} r={r} fresh={fresh === r.id} may={may} stopping={stopping === r.id} onStop={() => stop(r.id)} />
              }
              const c = r.counts
              const total = c.pending + c.sending + c.sent + c.skipped + c.failed + c.cancelled
              const done = c.sent + c.skipped + c.failed + c.cancelled
              const may = caller && mayManageCampaign(caller, { createdBy: r.createdBy, teamId: r.teamId })
              return (
                <li key={r.id} className={`px-4 py-3 ${fresh === r.id ? 'bg-gold-50/60' : ''}`} data-testid="campaign-row">
                  <div className="flex flex-wrap items-center gap-2">
                    {r.channel === 'sms' ? <MessageSquare size={14} className="text-slate-400" /> : <Mail size={14} className="text-slate-400" />}
                    <span className="font-medium text-slate-800">{r.name}</span>
                    <span className={`text-[11px] rounded px-1.5 py-0.5 ${
                      r.status === 'sending' ? 'bg-brand-50 text-brand-700' : r.status === 'stopped' ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700'}`}>
                      {r.status === 'sending' ? 'Sending' : r.status === 'stopped' ? 'Stopped' : 'Finished'}
                    </span>
                    <span className="text-xs text-slate-500">
                      {r.createdByName ?? 'Somebody'} · {formatDate(r.createdAt)}
                    </span>
                    {r.status === 'sending' && may && (
                      <button type="button" onClick={() => stop(r.id)} disabled={stopping === r.id}
                        data-testid="campaign-stop"
                        className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                        <Square size={12} /> {stopping === r.id ? 'Stopping…' : 'Stop'}
                      </button>
                    )}
                  </div>
                  <div className="mt-1.5 h-1.5 rounded bg-slate-100 overflow-hidden">
                    <div className="h-full bg-navy-950" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
                  </div>
                  <p className="mt-1.5 text-[12.5px] text-slate-600 tabular-nums" data-testid="campaign-counts">
                    {c.sent.toLocaleString('en-ZA')} sent · {c.skipped.toLocaleString('en-ZA')} skipped
                    {' · '}{c.failed.toLocaleString('en-ZA')} failed · {(c.pending + c.sending).toLocaleString('en-ZA')} still to go
                    {c.cancelled > 0 && ` · ${c.cancelled.toLocaleString('en-ZA')} stopped`}
                    {' · '}fees raised {rand(c.fees)} excl. VAT
                  </p>
                  {r.note && <p className="mt-1 text-xs text-negative-700">{r.note}</p>}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}

/**
 * A CALL CAMPAIGN'S ROW: how far the floor has got with it. Worked is a call closed on the diary;
 * waiting is still open; missed is what its end date (or Stop) took off unworked -- the day it was
 * due kept, so this is a fact rather than an estimate. By collector on request, because a leader's
 * question is "who has not got to theirs".
 */
function CallRow({ r, fresh, may, stopping, onStop }: {
  r: CampaignRow; fresh: boolean; may: boolean; stopping: boolean; onStop: () => void
}) {
  const [people, setPeople] = useState<Awaited<ReturnType<typeof fetchCallProgress>> | null>(null)
  const [open, setOpen] = useState(false)
  const c = r.counts
  const worked = c.sent
  const waiting = c.pending
  const missed = c.cancelled
  const total = worked + waiting + missed
  const toggle = async () => {
    setOpen((o) => !o)
    if (!people) { try { setPeople(await fetchCallProgress(r.id)) } catch { setPeople([]) } }
  }
  return (
    <li className={`px-4 py-3 ${fresh ? 'bg-gold-50/60' : ''}`} data-testid="campaign-row">
      <div className="flex flex-wrap items-center gap-2">
        <Phone size={14} className="text-slate-400" />
        <span className="font-medium text-slate-800">{r.name}</span>
        <span className={`text-[11px] rounded px-1.5 py-0.5 ${
          r.status === 'sending' ? 'bg-brand-50 text-brand-700' : r.status === 'stopped' ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700'}`}>
          {r.status === 'sending' ? 'Running' : r.status === 'stopped' ? 'Stopped' : 'Ended'}
        </span>
        <span className="text-xs text-slate-500">
          {r.callMode ? rankWords(r.callMode, r.callRank ?? 0) : ''}
          {r.callMode === 'spread' && r.endsOn ? ` · until ${formatDate(r.endsOn)}` : ''}
          {' · '}{r.createdByName ?? 'Somebody'} · {formatDate(r.createdAt)}
        </span>
        {r.status === 'sending' && may && (
          <button type="button" onClick={onStop} disabled={stopping} data-testid="campaign-stop"
            className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40">
            <Square size={12} /> {stopping ? 'Stopping…' : 'Stop'}
          </button>
        )}
      </div>
      <div className="mt-1.5 h-1.5 rounded bg-slate-100 overflow-hidden">
        <div className="h-full bg-navy-950" style={{ width: `${total ? Math.round((worked / total) * 100) : 0}%` }} />
      </div>
      <p className="mt-1.5 text-[12.5px] text-slate-600 tabular-nums" data-testid="call-counts">
        {worked.toLocaleString('en-ZA')} worked · {waiting.toLocaleString('en-ZA')} waiting · {missed.toLocaleString('en-ZA')} missed
        {r.unplaced > 0 && ` · ${r.unplaced.toLocaleString('en-ZA')} did not fit`}
        {c.skipped > 0 && ` · ${c.skipped.toLocaleString('en-ZA')} skipped`}
        {' · '}
        <button type="button" onClick={toggle} className="underline underline-offset-2 text-slate-500 hover:text-slate-700">
          {open ? 'Hide collectors' : 'By collector'}
        </button>
      </p>
      {open && (
        !people ? <Loader2 className="mt-2 h-3.5 w-3.5 animate-spin text-slate-400" /> : (
          <ul className="mt-2 text-[12.5px] text-slate-600 space-y-0.5" data-testid="call-by-collector">
            {people.map((p) => (
              <li key={p.ownerId ?? 'none'} className="tabular-nums">
                <span className="text-slate-800">{p.ownerName}</span> — {p.worked} worked · {p.waiting} waiting · {p.missed} missed
              </li>
            ))}
          </ul>
        )
      )}
    </li>
  )
}
