import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2, Phone } from 'lucide-react'
import { Modal, FormField, inputClass } from '../../components/ui/Modal'
import {
  CALL_KIND_LABEL, DEFAULT_SPREAD_RANK, NOW_RANK, SPREAD_RANKS, callConfirmation, sharedAmongChosen,
  type CallKind, type CallMode,
} from '../../lib/callCampaign.ts'
import { mayGiveCampaignTo, writeOffReasonKey } from '../../lib/campaigns.ts'
import { WRITE_OFF_REASONS } from '../../lib/accountEnding'
import {
  createCallCampaign, fetchRecoveryReasons, previewCallCampaign, type CallPreview, type ReasonCount,
} from '../../lib/campaignApi'
import { formatDate } from '../../data/mockData'
import { rand } from '../../lib/money'
import { useAuth } from '../../store/AuthContext'
import { useAppStore } from '../../store/AppStore'
import type { Selection } from '../../lib/accountAllocation'

/**
 * A CALL CAMPAIGN: the selected accounts onto the diaries (S10, 21 Oct; three kinds since 22 Oct).
 *
 * WHAT IT ASKS FOR comes first, because it decides every question under it:
 *   Calls      the live book, each call to whoever holds the account. Nobody is reassigned.
 *   Recovery   the written-off book, chosen BY WRITE-OFF REASON, shared among collectors the person
 *              picks -- "if a guy makes a PTP, he can keep the account. Otherwise, the account just
 *              stays where it was." Withdrawn, paid-up and settled accounts are never in it.
 *   Trace      refer accounts to trace, live or written off by reason, shared among the people
 *              picked to trace. Its results page follows each one to new details, contact, PTP, money.
 *
 * THE TWO WAYS, side by side, because choosing between them is the decision: NOW puts every call
 * on today above everything else on the diary; SPREAD runs to an end date at a place on the day the
 * person chooses, filling each collector's free room. callCampaign.ts says why.
 *
 * NOTHING HERE DECIDES, as with the SMS and email box: the preview -- who gets how many, who goes
 * over their day, what does not fit -- is the server's, and the server asks again on create.
 */
export function CallCampaignModal({ selection, selectedCount, ids, onClose, onBack, onStarted }: {
  selection: Selection
  selectedCount: number
  /** The accounts, already resolved by the campaign box. */
  ids: string[] | null
  onClose: () => void
  onBack: () => void
  onStarted: (campaignId: string, name: string) => void
}) {
  const { currentUser } = useAuth()
  const { users } = useAppStore()
  const [step, setStep] = useState<'compose' | 'preview'>('compose')
  const [kind, setKind] = useState<CallKind>('work')
  const [mode, setMode] = useState<CallMode>('spread')
  const [rank, setRank] = useState(DEFAULT_SPREAD_RANK)
  const [endsOn, setEndsOn] = useState('')
  const [script, setScript] = useState('')
  const [name, setName] = useState('')
  const [collectorIds, setCollectorIds] = useState<string[]>([])
  const [traceTarget, setTraceTarget] = useState<'live' | 'closed'>('live')
  const [reasons, setReasons] = useState<string[]>([])
  const [reasonCounts, setReasonCounts] = useState<ReasonCount[] | null>(null)
  const [preview, setPreview] = useState<CallPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const closedBook = kind === 'recovery' || (kind === 'trace' && traceTarget === 'closed')
  const pooled = sharedAmongChosen(kind)

  /* THE WRITE-OFF REASONS IN THIS SELECTION, counted by the database, once the box needs them. */
  useEffect(() => {
    if (!closedBook || !ids || reasonCounts) return
    let live = true
    fetchRecoveryReasons(ids)
      .then((r) => { if (live) setReasonCounts(r) })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [closedBook, ids, reasonCounts])

  /*
   * THE REASONS AS THE BOX OFFERS THEM. Raptor's closed list BY NAME, each with its count (nought
   * included -- the list is the firm's and its shape should not change with the selection); then
   * anything else Raptor wrote; then the imported free text exactly as stored, most common first;
   * then "No reason recorded".
   */
  const offered = useMemo(() => {
    const counts = new Map((reasonCounts ?? []).map((r) => [r.key, r]))
    const closedList = WRITE_OFF_REASONS.map((label) => {
      const key = writeOffReasonKey({ endedAs: 'written_off', endedReason: label, writeOffReason: null })
      return { key, label, accounts: counts.get(key)?.accounts ?? 0, group: 'Written off in Raptor' }
    })
    const listed = new Set(closedList.map((r) => r.key))
    const rest = (reasonCounts ?? []).filter((r) => !listed.has(r.key))
    return [
      ...closedList,
      ...rest.filter((r) => r.source === 'raptor').map((r) => ({ ...r, group: 'Written off in Raptor' })),
      ...rest.filter((r) => r.source === 'imported').map((r) => ({ ...r, group: 'Imported from Swordfish' })),
      ...rest.filter((r) => r.source === 'none').map((r) => ({ ...r, group: 'No reason' })),
    ]
  }, [reasonCounts])

  /* WHO MAY BE GIVEN THE WORK: active people on the floor this person may hand work to. */
  const caller = currentUser ? {
    id: currentUser.id, role: currentUser.role, teamId: currentUser.teamId ?? null,
    grants: currentUser.grants, revokes: currentUser.revokes,
  } : null
  const collectors = useMemo(() => (caller ? users.filter((u) => mayGiveCampaignTo(caller, {
    id: u.id, role: u.role, teamId: u.teamId ?? null, active: u.status === 'Active',
  })) : []).sort((a, b) => a.name.localeCompare(b.name)),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- caller is rebuilt each render from currentUser
  [users, currentUser])

  const draft = () => ({
    kind, mode, rank: mode === 'now' ? NOW_RANK : rank, endsOn: mode === 'now' ? null : endsOn || null, script,
    collectorIds: pooled ? collectorIds : [], reasons: closedBook ? reasons : [], traceTarget,
  })
  const subtitle = `${selectedCount.toLocaleString('en-ZA')} ${selectedCount === 1 ? 'account' : 'accounts'} selected`
  const ready = !!ids && !!script.trim() && !!name.trim() && (mode === 'now' || !!endsOn)
    && (!pooled || collectorIds.length > 0) && (!closedBook || reasons.length > 0)
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  async function runPreview() {
    if (!ids) return
    setBusy(true); setError(null)
    try { setPreview(await previewCallCampaign(draft(), ids)); setStep('preview') }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  async function start() {
    if (!ids) return
    setBusy(true); setError(null)
    try {
      const made = await createCallCampaign(draft(), ids, name, selection)
      onStarted(made.campaignId, name.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  if (step === 'preview' && preview) {
    const blocker = preview.dateProblem
      ?? (preview.outOfScope > 0
        ? `${preview.outOfScope.toLocaleString('en-ZA')} of these accounts ${preview.outOfScope === 1 ? 'is' : 'are'} outside what you may campaign on — your team’s desks, or your own clients. Narrow the selection.`
        : null)
      ?? (preview.badCollectors > 0 ? 'One of the people chosen is not somebody you can give this work to.' : null)
      ?? (preview.placing === 0 ? 'No call can be placed: every account is skipped, or no diary has room before the end date.' : null)
    const skipped = preview.skipped + (preview.selected - preview.found)
    return (
      <Modal title={`${CALL_KIND_LABEL[kind]}: what would happen`} subtitle={subtitle} onClose={onClose} width={620}>
        <div className="space-y-4" data-testid="call-campaign-preview">
          <div className="grid grid-cols-3 gap-3">
            <Figure label={kind === 'trace' ? 'Sent to trace' : 'Calls placed'} value={preview.placing} testid="call-placing" />
            <Figure label="Skipped" value={skipped} />
            <Figure label="No room before the end" value={preview.unplaced} testid="call-unplaced" />
          </div>
          {preview.skips.length > 0 && (
            <ul className="text-[13px] text-slate-600 space-y-0.5" data-testid="call-skips">
              {preview.skips.map((s) => (
                <li key={s.words}><span className="tabular-nums font-medium">{s.count.toLocaleString('en-ZA')}</span> · {s.words}</li>
              ))}
            </ul>
          )}
          {preview.collectors.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1.5">On whose diary</p>
              <ul className="text-[13px] text-slate-700 divide-y divide-slate-100 rounded-lg border border-slate-200" data-testid="call-collectors">
                {preview.collectors.map((c) => (
                  <li key={c.name} className="flex items-center justify-between px-3 py-1.5">
                    <span>{c.name}</span>
                    <span className="tabular-nums text-slate-600">
                      {c.calls.toLocaleString('en-ZA')} {c.calls === 1 ? 'call' : 'calls'}
                      {c.over > 0 && <span className="text-negative-700"> · {c.over} over their day</span>}
                      {c.unplaced > 0 && <span className="text-negative-700"> · {c.unplaced} do not fit</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="rounded-lg border border-gold-500 bg-gold-50 p-3.5 text-sm text-navy-950" data-testid="call-confirm-words">
            {callConfirmation({
              name: name.trim(), mode, rank, endsOn: preview.endsOn, placing: preview.placing,
              collectors: preview.collectors.filter((c) => c.calls > 0).length, skipped,
              unplaced: preview.unplaced, overCollectors: preview.overCollectors, endWords: formatDate(preview.endsOn),
              kind,
            })}
          </div>
          {preview.traceEstimate ? (
            /* WHAT A TRACE COSTS THE DEBTOR, said before anybody is referred, as the SMS box says its fee. */
            <p className="text-xs text-slate-600" data-testid="trace-estimate">
              Being on the campaign costs nothing. Each credit bureau search a tracer then runs is charged to that debtor
              under Annexure B item 4(c) as it is recorded, as on any other trace: about {rand(preview.traceEstimate.total)} excluding
              VAT if every account is searched once ({rand(preview.traceEstimate.perSearch)} each, {preview.traceEstimate.citation}).
            </p>
          ) : (
            <p className="text-xs text-slate-500">
              No fee is raised for being on a campaign. A consultation the call leads to is charged as on any other call.
            </p>
          )}
          {blocker && (
            <p className="flex items-start gap-2 text-sm text-negative-700" data-testid="call-blocker">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" /> {blocker}
            </p>
          )}
          {error && <p className="text-sm text-negative-700">{error}</p>}
          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={start} disabled={busy || !!blocker} data-testid="call-start"
              className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-gold-400 text-navy-950 border border-gold-500 disabled:opacity-40">
              {busy ? 'Starting…' : `Put ${preview.placing.toLocaleString('en-ZA')} on the diaries`}
            </button>
            <button type="button" onClick={() => setStep('compose')} disabled={busy}
              className="text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-600">
              Go back
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Run a call campaign" subtitle={subtitle} onClose={onClose} width={600}>
      <div data-testid="call-campaign-compose">
        <FormField label="What is it for?" required>
          <div className="grid grid-cols-3 gap-2">
            {([
              ['work', 'Calls', 'The live book. Each account on the diary of whoever holds it.'],
              ['recovery', 'Recovery', 'Written-off accounts, to win them back. A promise re-opens one for its collector.'],
              ['trace', 'Trace', 'Refer accounts to trace, and follow what the trace leads to.'],
            ] as const).map(([k, title, words]) => (
              <button key={k} type="button" onClick={() => { setKind(k); setPreview(null) }} data-testid={`call-kind-${k}`}
                className={`text-left rounded-lg border p-3 ${kind === k ? 'border-navy-950 bg-navy-950 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>
                <span className="block text-sm font-medium">{title}</span>
                <span className={`block text-xs mt-0.5 ${kind === k ? 'text-white/80' : 'text-slate-500'}`}>{words}</span>
              </button>
            ))}
          </div>
        </FormField>

        {kind === 'work' && (
          <p className="text-[13px] text-slate-600 mb-3">
            Each account goes on the diary of the collector who holds it. Nobody is reassigned.
          </p>
        )}
        {kind === 'recovery' && (
          <p className="text-[13px] text-slate-600 mb-3" data-testid="recovery-words">
            Closed accounts that were written off. Withdrawn, paid-up and settled accounts are never included. Putting
            an account on the campaign does not re-open it or move it; if the debtor agrees to pay, the collector re-opens
            it and keeps it.
          </p>
        )}
        {kind === 'trace' && (
          <FormField label="Which accounts?" required>
            <div className="grid grid-cols-2 gap-2">
              {([['live', 'Live accounts', 'As selected on the list.'], ['closed', 'Written off', 'Chosen by write-off reason.']] as const).map(([t, title, words]) => (
                <button key={t} type="button" onClick={() => setTraceTarget(t)} data-testid={`trace-target-${t}`}
                  className={`text-left rounded-lg border p-2.5 ${traceTarget === t ? 'border-navy-950 bg-navy-50' : 'border-slate-200 bg-white'}`}>
                  <span className="block text-sm font-medium text-slate-800">{title}</span>
                  <span className="block text-xs text-slate-500">{words}</span>
                </button>
              ))}
            </div>
          </FormField>
        )}

        {closedBook && (
          <FormField label="Which write-off reasons?" required>
            {!reasonCounts ? (
              <p className="text-xs text-slate-500 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Counting the reasons…</p>
            ) : (
              <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100" data-testid="recovery-reasons">
                {offered.map((r, i) => (
                  <div key={r.key}>
                    {(i === 0 || offered[i - 1].group !== r.group) && (
                      <p className="px-3 pt-2 pb-1 text-[10.5px] uppercase tracking-wide text-slate-400">{r.group}</p>
                    )}
                    <label className={`flex items-center gap-2 px-3 py-1.5 text-sm ${r.accounts === 0 ? 'text-slate-400' : 'text-slate-700'}`}>
                      <input type="checkbox" checked={reasons.includes(r.key)} disabled={r.accounts === 0}
                        onChange={() => setReasons((x) => toggle(x, r.key))} data-testid="recovery-reason" data-key={r.key} />
                      <span className="flex-1 truncate">{r.label}</span>
                      <span className="tabular-nums text-xs">{r.accounts.toLocaleString('en-ZA')}</span>
                    </label>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-slate-400 mt-1">Counted over the selection: written off, not prescribed.</p>
          </FormField>
        )}

        {pooled && (
          <FormField label={kind === 'trace' ? 'Who traces?' : 'Which collectors work it?'} required>
            {collectors.length === 0 ? (
              <p className="text-xs text-negative-700">There is nobody on the floor you can give this work to.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5" data-testid="campaign-collectors">
                {collectors.map((u) => (
                  <button key={u.id} type="button" onClick={() => setCollectorIds((x) => toggle(x, u.id))}
                    data-testid="campaign-collector" aria-pressed={collectorIds.includes(u.id)}
                    className={`text-xs px-2.5 py-1 rounded-full border ${collectorIds.includes(u.id) ? 'border-navy-950 bg-navy-950 text-white' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
                    {u.name}
                  </button>
                ))}
              </div>
            )}
            <p className="text-[11px] text-slate-400 mt-1">Shared among them as evenly as their free room allows.</p>
          </FormField>
        )}

        <FormField label="How should it be worked?" required>
          <div className="grid grid-cols-2 gap-2">
            {([
              ['now', 'Now', 'Today, above everything on the diary — broken PTPs included.'],
              ['spread', 'Spread until an end date', 'Over the coming days, in the room each collector keeps free.'],
            ] as const).map(([m, title, words]) => (
              <button key={m} type="button" onClick={() => setMode(m)} data-testid={`call-mode-${m}`}
                className={`text-left rounded-lg border p-3 ${mode === m ? 'border-navy-950 bg-navy-950 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>
                <span className="block text-sm font-medium">{title}</span>
                <span className={`block text-xs mt-0.5 ${mode === m ? 'text-white/80' : 'text-slate-500'}`}>{words}</span>
              </button>
            ))}
          </div>
        </FormField>

        {mode === 'spread' && (
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Last day" required>
              <input type="date" className={inputClass} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} data-testid="call-ends-on" />
            </FormField>
            <FormField label="Where on the day" required>
              <select className={inputClass} value={rank} onChange={(e) => setRank(Number(e.target.value))} data-testid="call-rank">
                {SPREAD_RANKS.map((r) => <option key={r.rank} value={r.rank}>{r.label}</option>)}
              </select>
            </FormField>
          </div>
        )}

        <FormField label={kind === 'trace' ? 'What the tracer looks for' : 'What the collector says or asks for'} required>
          <textarea className={`${inputClass} min-h-[110px]`} value={script} onChange={(e) => setScript(e.target.value)} maxLength={2000}
            data-testid="call-script" placeholder={kind === 'trace'
              ? 'A working cell number and an email address. Try the employer on file.'
              : 'Offer a settlement of 70% if paid before month end. Confirm the email address.'} />
        </FormField>

        <FormField label="Campaign name" required>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={120}
            placeholder="So it can be found and stopped" data-testid="call-name" />
        </FormField>

        {error && <p className="text-sm text-negative-700 mb-2">{error}</p>}
        <div className="flex items-center gap-2">
          <button type="button" onClick={runPreview} disabled={busy || !ready} data-testid="call-preview-go"
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-navy-950 text-white disabled:opacity-40">
            {busy || !ids ? <Loader2 size={14} className="animate-spin" /> : <Phone size={14} />}
            {!ids ? 'Finding the accounts…' : 'See what would happen'}
          </button>
          <button type="button" onClick={onBack} className="text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-600">
            SMS or email instead
          </button>
        </div>
      </div>
    </Modal>
  )
}

function Figure({ label, value, testid }: { label: string; value: number; testid?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-xl font-semibold text-navy-950 tabular-nums" data-testid={testid}>{value.toLocaleString('en-ZA')}</p>
    </div>
  )
}
