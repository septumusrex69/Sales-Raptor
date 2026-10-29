import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Mail, PenLine, Plus, Send, X } from 'lucide-react'
import { useAuth } from '../../store/AuthContext'
import { Button } from '../../components/ui/Button'
import {
  FIRM_REPORTS_ADDRESS, FIRM_SENDER_ENV, domainReady, domainSetupSteps, isFirmMainDomain, mailDomainOf, normaliseEmail, senderAddressProblem,
  splitFrom, type SendFrom,
} from '../../lib/marketing.ts'
import { addSender, listSenders, markDomainReady, setSenderActive, type ExtraSender, type SenderConfig } from '../../lib/marketingApi'
import { SignatureModal } from './SignatureModal'
import { INPUT, errorText } from './shared'

/**
 * EMAIL ADDRESSES, AT THE TOP OF THE CAMPAIGNS (Ryno, 29 Oct): "a place for the email addresses. Once I click on
 * that ... a drop down with all the email addresses that we have saved ... a plus icon somewhere so that we can
 * add additional email addresses ... If the domain does not match up ... make a reminder that we should link it
 * and add a ... step by step guide on how to do it."
 *
 * Picking one shows what went from it (the list below filters) and starts a new email from it. Each address says
 * whether it can send today, and if not, exactly why -- the domain is not set up, or a key is missing -- because
 * an address that looks ready and is refused by Resend on the morning of a newsletter is the failure to avoid.
 */
export type FromFilter = 'all' | 'news' | 'liaison' | 'reports' | `address:${string}` | 'prospect'

type Status = { ready: true } | { ready: false; why: string; setup?: string }

export function statusOf(kind: SendFrom, s: ExtraSender | null, config: SenderConfig | null): Status {
  if (!config) return { ready: false, why: 'Checking…' }
  if (kind === 'news') return config.ready ? { ready: true } : { ready: false, why: 'Sending is not set up yet' }
  if (kind === 'liaison' || kind === 'reports') return config.firm?.ready ? { ready: true } : { ready: false, why: `Waiting for ${FIRM_SENDER_ENV} in Vercel` }
  if (!s) return { ready: false, why: 'Missing' }
  if (!s.active) return { ready: false, why: 'Switched off' }
  if (!domainReady(s.address, config.readyDomains ?? [])) return { ready: false, why: 'Domain needs setting up', setup: mailDomainOf(s.address) }
  if (isFirmMainDomain(s.address) && !config.firm?.ready) return { ready: false, why: `Waiting for ${FIRM_SENDER_ENV} in Vercel` }
  return { ready: true }
}

function StatusChip({ status }: { status: Status }) {
  return status.ready
    ? <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5"><Check size={11} /> Ready</span>
    : <span className="text-[11px] text-gold-800 bg-gold-100 rounded-full px-2 py-0.5" data-testid="news-address-status">{status.why}</span>
}

export function EmailAddresses({ value, onChange, onNewFrom, config }: {
  value: FromFilter
  onChange: (v: FromFilter) => void
  /** Start a new email from this sender. */
  onNewFrom: (sendFrom: SendFrom, senderAddressId: string | null) => void
  config: SenderConfig | null
}) {
  const { currentUser } = useAuth()
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [senders, setSenders] = useState<ExtraSender[]>([])
  const [address, setAddress] = useState('')
  const [display, setDisplay] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [signing, setSigning] = useState<{ address: string; name: string; html: string } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const reload = () => listSenders().then(setSenders).catch(() => setSenders([]))
  useEffect(() => { void reload() }, [])
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const news = splitFrom(config?.from)
  /* news@ and reports@ are always there; a row for either (made when it was given a signature) is not listed twice. */
  const extras = senders.filter((s) => s.address !== FIRM_REPORTS_ADDRESS && s.address !== news.address)
  const builtIn = (addr: string) => senders.find((s) => s.address === addr) ?? null
  const entries: { value: FromFilter; title: string; sub: string; status: Status; kind: SendFrom; sender: ExtraSender | null; signatureOf?: string }[] = [
    { value: 'news', title: 'BF News', sub: news.address || 'news@bfnews.co.za', status: statusOf('news', null, config), kind: 'news', sender: null, signatureOf: news.address || undefined },
    { value: 'liaison', title: 'Each client’s liaison', sub: 'Nicole’s clients from Nicole, and so on; reports@ for the rest', status: statusOf('liaison', null, config), kind: 'liaison', sender: null },
    { value: 'reports', title: 'Reports', sub: FIRM_REPORTS_ADDRESS, status: statusOf('reports', null, config), kind: 'reports', sender: null, signatureOf: FIRM_REPORTS_ADDRESS },
    ...extras.map((s) => ({ value: `address:${s.id}` as FromFilter, title: s.display_name, sub: s.address, status: statusOf('address', s, config), kind: 'address' as SendFrom, sender: s, signatureOf: s.address })),
  ]
  const chosen = entries.find((e) => e.value === value) ?? null

  const typed = normaliseEmail(address)
  const problem = address.trim() ? senderAddressProblem(address) : null
  const taken = senders.some((s) => s.address === typed) || typed === news.address || typed === FIRM_REPORTS_ADDRESS
  const typedReady = !!typed && !problem && domainReady(typed, config?.readyDomains ?? [])

  async function add() {
    setError(null)
    try {
      const s = await addSender(typed, display || typed.split('@')[0])
      await reload()
      setAddress(''); setDisplay(''); setAdding(false)
      onChange(`address:${s.id}`)
    } catch (e) { setError(errorText(e)) }
  }

  return (
    <div className="space-y-3">
      <div className="relative inline-block" ref={ref}>
        <button type="button" onClick={() => setOpen((o) => !o)} data-testid="news-addresses"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm shadow-sm hover:bg-slate-50">
          <Mail size={15} className="text-brand-500" />
          <span className="font-medium text-slate-800">Email addresses</span>
          <span className="text-slate-400">·</span>
          <span className="text-slate-600 max-w-[16rem] truncate">{chosen ? chosen.title : 'All of them'}</span>
          <ChevronDown size={15} className="text-slate-400" />
        </button>
        {open && (
          <div className="absolute z-30 mt-1.5 w-[min(30rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white shadow-xl" data-testid="news-addresses-menu">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
              <span className="text-xs font-medium text-slate-500">Send from</span>
              <button type="button" onClick={() => { setAdding((a) => !a); setError(null) }} title="Add an address" aria-label="Add an address" data-testid="news-address-plus"
                className="h-7 w-7 grid place-items-center rounded-full bg-brand-600 text-white hover:bg-brand-700">{adding ? <X size={14} /> : <Plus size={14} />}</button>
            </div>
            {adding && (
              <div className="p-3 border-b border-slate-100 bg-slate-50/60 space-y-2" data-testid="news-address-add">
                <input className={INPUT} placeholder="marketing@bredellferreira.co.za" value={address} onChange={(e) => setAddress(e.target.value)} data-testid="news-address-input" autoFocus />
                <input className={INPUT} placeholder="The name it signs with, e.g. Bredell Ferreira Marketing" value={display} onChange={(e) => setDisplay(e.target.value)} data-testid="news-address-name" />
                {problem && <p className="text-xs text-red-600" data-testid="news-address-problem">{problem}</p>}
                {taken && <p className="text-xs text-red-600">That address is already on the list.</p>}
                {typed && !problem && !typedReady && (
                  <p className="text-xs text-gold-800" data-testid="news-address-needs-setup">
                    {mailDomainOf(typed)} is not set up for sending yet. It will be saved, marked “Domain needs setting up”, with the steps to set it up.
                  </p>
                )}
                {error && <p className="text-xs text-red-600">{error}</p>}
                <Button size="sm" variant="primary" disabled={!typed || !!problem || taken} onClick={() => void add()} data-testid="news-address-save">Add the address</Button>
              </div>
            )}
            <ul className="max-h-[22rem] overflow-y-auto py-1">
              <li>
                <button type="button" onClick={() => { onChange('all'); setOpen(false) }} className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${value === 'all' ? 'bg-brand-50/60' : ''}`}>
                  All of them
                </button>
              </li>
              {entries.map((e) => (
                <li key={e.value}>
                  <button type="button" onClick={() => { onChange(e.value); setOpen(false) }} data-testid="news-address-option"
                    className={`w-full text-left px-3 py-2 hover:bg-slate-50 flex items-start gap-2 ${value === e.value ? 'bg-brand-50/60' : ''}`}>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-slate-800 truncate">{e.title}</span>
                      <span className="block text-xs text-slate-500 truncate">{e.sub}</span>
                    </span>
                    <StatusChip status={e.status} />
                  </button>
                </li>
              ))}
            </ul>
            {config && !config.schemaReady && (
              <p className="px-3 py-2 border-t border-slate-100 text-[11px] text-slate-400">
                Addresses on other domains, signatures and sending a campaign from an extra address need one database change (campaign_compose).
              </p>
            )}
          </div>
        )}
      </div>

      {chosen && (
        <div className="rounded-xl border border-slate-200 bg-white p-4" data-testid="news-address-panel">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-800">{chosen.title}</div>
              <div className="text-xs text-slate-500">{chosen.sub}</div>
            </div>
            <StatusChip status={chosen.status} />
            <Button size="sm" variant="primary" icon={<Send size={13} />} data-testid="news-address-new"
              disabled={chosen.kind === 'address' && !config?.schemaReady}
              title={chosen.kind === 'address' && !config?.schemaReady ? 'Needs the database change campaign_compose' : undefined}
              onClick={() => onNewFrom(chosen.kind, chosen.sender?.id ?? null)}>New email from this address</Button>
            {chosen.signatureOf && config?.schemaReady && (
              <Button size="sm" icon={<PenLine size={13} />} data-testid="news-address-signature"
                onClick={() => setSigning({ address: chosen.signatureOf!, name: chosen.sender?.display_name ?? chosen.title, html: builtIn(chosen.signatureOf!)?.signature_html ?? chosen.sender?.signature_html ?? '' })}>
                Signature
              </Button>
            )}
            {chosen.sender && (
              <Button size="sm" onClick={() => void setSenderActive(chosen.sender!.id, !chosen.sender!.active).then(reload).catch((e: unknown) => setError(errorText(e)))}>
                {chosen.sender.active ? 'Switch off' : 'Switch on'}
              </Button>
            )}
          </div>
          {chosen.kind === 'liaison' && <p className="text-xs text-slate-500 mt-2">Each liaison signs with the signature on her own profile, the one her everyday mail carries.</p>}
          {!chosen.status.ready && chosen.status.setup && (
            <div className="mt-3 rounded-lg bg-gold-50 border border-gold-200 p-3" data-testid="news-domain-guide">
              <p className="text-sm font-medium text-slate-800 mb-1">How to set up {chosen.status.setup} for sending</p>
              <ol className="list-decimal pl-5 space-y-1 text-sm text-slate-700">
                {domainSetupSteps(chosen.status.setup).map((step) => <li key={step}>{step}</li>)}
              </ol>
              <Button size="sm" variant="primary" className="mt-3" data-testid="news-domain-verified" disabled={!config?.schemaReady}
                onClick={() => void markDomainReady(chosen.status.ready ? '' : (chosen.status as { setup: string }).setup, currentUser?.id ?? null)
                  .then(() => window.location.reload()).catch((e: unknown) => setError(errorText(e)))}>
                The domain is verified in Resend
              </Button>
            </div>
          )}
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        </div>
      )}

      {signing && (
        <SignatureModal address={signing.address} displayName={signing.name} initial={signing.html} onClose={() => setSigning(null)}
          onSaved={() => { setSigning(null); void reload() }} />
      )}
    </div>
  )
}
