import { useEffect, useState, type ReactNode } from 'react'
import { Card, CardHeader } from '../../components/ui/Card'
import { isProspectKind, PROSPECT_SETUP_STEPS, SENDER_SETUP_STEPS, type CampaignKind } from '../../lib/marketing.ts'
import { senderConfig, type CampaignRow, type SenderConfig } from '../../lib/marketingApi'

/**
 * The small pieces every News & campaigns screen shares (S13): the inputs, the status words, and the
 * sender's set-up -- which used to live at the top of the one 780-line page.
 */

export const INPUT = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 disabled:bg-slate-50'

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-400 mt-1">{hint}</span>}
    </label>
  )
}

/** "12 (40%)": a count with its rate, or the count alone while there is nothing to divide by. */
export function withRate(n: number, rate: number | null): string {
  return rate === null ? String(n) : `${n} (${rate}%)`
}

export const STATUS_WORDS: Record<CampaignRow['status'], string> = {
  draft: 'Draft', sending: 'Sending', sent: 'Sent', cancelled: 'Cancelled',
}

const STATUS_TONE: Record<CampaignRow['status'], string> = {
  draft: 'bg-slate-100 text-slate-600',
  sending: 'bg-gold-100 text-gold-800',
  sent: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-400',
}

export function StatusPill({ status }: { status: CampaignRow['status'] }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[status]}`} data-testid="news-status">
      {status === 'sending' && <span className="h-1.5 w-1.5 rounded-full bg-gold-500 animate-pulse" />}
      {STATUS_WORDS[status]}
    </span>
  )
}

/** A row of choices, one of which is on -- the house pattern for Kind, List and the like. */
export function Choices<T extends string>({ value, options, onChange, label, testid, disabled }: {
  value: T; options: { value: T; label: string; disabled?: boolean; title?: string }[]; onChange: (v: T) => void
  label: string; testid?: string; disabled?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} disabled={disabled || o.disabled} title={o.title}
          data-testid={testid ? `${testid}-${o.value}` : undefined} onClick={() => onChange(o.value)}
          className={`text-xs font-medium px-3 py-1.5 rounded-lg border disabled:opacity-50 disabled:cursor-not-allowed ${value === o.value
            ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** One figure in a summary: the number, what it is, and what it is out of. */
export function Figure({ label, value, sub, testid, tone = 'default' }: {
  label: string; value: ReactNode; sub?: ReactNode; testid?: string; tone?: 'default' | 'good' | 'bad'
}) {
  const colour = tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-700' : 'text-slate-800'
  return (
    <div className="rounded-xl border border-slate-100 bg-white px-3 py-2.5" data-testid={testid}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${colour}`}>{value}</div>
      <div className="text-xs text-slate-400 min-h-[1rem]">{sub ?? ' '}</div>
    </div>
  )
}

/* ------------------------------------------------------------------------------------------------
 * The sender, and what the firm must do when it is not set up
 * ---------------------------------------------------------------------------------------------- */

export function useSenderConfig() {
  const [config, setConfig] = useState<SenderConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    senderConfig().then((c) => { if (live) setConfig(c) }).catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [])
  return { config, error }
}

/** Whether a campaign of this kind can be sent with the sender as it is set up. */
export function kindReady(config: SenderConfig | null, kind: CampaignKind): boolean {
  if (!config) return false
  return isProspectKind(kind) ? !!config.prospect?.ready && !config.missing.includes('RESEND_API_KEY') : config.ready
}

/**
 * WHAT THE FIRM MUST DO BEFORE THIS KIND CAN GO -- news and the prospect kinds have different
 * senders (marketing.ts: three domains), so each names its own missing setting. Drawn only when
 * something IS missing: a warning that fires when nothing is wrong teaches people to skip it.
 */
export function SenderSetup({ config, error, kind = 'news' }: { config: SenderConfig | null; error: string | null; kind?: CampaignKind }) {
  if (error) return <Card className="border-red-200 bg-red-50"><p className="text-sm text-red-700">The sender could not be checked: {error}</p></Card>
  if (!config || kindReady(config, kind)) return null
  const prospect = isProspectKind(kind)
  const missing = prospect
    ? [...(config.missing.includes('RESEND_API_KEY') ? ['RESEND_API_KEY'] : []), ...(config.prospect?.missing ?? []).filter((m) => m !== 'RESEND_API_KEY')]
    : config.missing
  const problem = prospect ? config.prospect?.problem : config.problem
  return (
    <Card className="border-gold-300 bg-gold-50/60">
      <div data-testid={prospect ? 'prospect-setup' : 'sender-setup'}>
        <CardHeader title={prospect ? 'Prospect sending is not set up yet' : 'Sending is not set up yet'}
          subtitle={missing.length
            ? `Nothing will be sent until ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} set. You can write and save campaigns in the meantime.`
            : problem ?? ''} />
        {missing.length > 0 && problem && <p className="text-sm text-red-700 mb-2">{problem}</p>}
        <ol className="list-decimal pl-5 space-y-1.5 text-sm text-slate-700">
          {(prospect ? PROSPECT_SETUP_STEPS : SENDER_SETUP_STEPS).map((s) => <li key={s}>{s}</li>)}
        </ol>
      </div>
    </Card>
  )
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
