import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Phone, PhoneCall } from 'lucide-react'
import { useBuzzBox } from '../store/BuzzBoxContext'
import { useAppStore } from '../store/AppStore'
import type { ID } from '../types'

/** What to write on the timeline once a call is placed — which record it belongs to, and how to name it. */
export interface CallLogTarget {
  /** Who was called, as it should read in the Activity subject: "Call — Jane Smith". */
  label: string
  leadId?: ID
  contactId?: ID
  companyId?: ID
  dealId?: ID
}

interface PhoneLinkProps {
  number: string
  className?: string
  iconSize?: number
  /** Replaces the default "<icon> number" content. */
  children?: ReactNode
  /** When set, a successful BuzzBox dial logs a Call Activity against this record. Omit to dial without logging. */
  log?: CallLogTarget
  /** Runs after a successful BuzzBox dial — e.g. to stamp a lead's last-contact time. */
  onDialled?: () => void
}

/**
 * A phone number you can click.
 *
 * Without BuzzBox it is the tel: link it always was — the device's own dialler, which is what
 * a phone or tablet is good at. With BuzzBox connected and an extension picked, the same
 * click asks the PABX to ring that extension and bridge the call, and logs it as a Call on
 * the record it was placed from, so a rep's dialled calls stop depending on them remembering
 * to log them afterwards.
 */
export function PhoneLink({ number, className = '', iconSize = 13, children, log, onDialled }: PhoneLinkProps) {
  const { canDial, status, dial } = useBuzzBox()
  const { addActivity } = useAppStore()
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'dialling' } | { kind: 'ringing' } | { kind: 'error'; message: string }>({ kind: 'idle' })
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current)
  }, [])

  const content = children ?? (
    <>
      <Phone size={iconSize} /> {number}
    </>
  )
  // While a call is being placed the default rendering swaps its icon and keeps showing the
  // number. A caller that supplied its own content (the account page's "Call" button) keeps it:
  // a button whose label turns into a phone number mid-click reads as a different button, and
  // the row it sits in changes width. That one pulses instead, and the line underneath says
  // what is happening.
  const dialling = state.kind === 'dialling' || state.kind === 'ringing'
  const busyContent = children ?? (
    <>
      <PhoneCall size={iconSize} className="animate-pulse" /> {number}
    </>
  )

  if (!canDial) {
    return (
      <a href={`tel:${number.replace(/\s/g, '')}`} className={className}>
        {content}
      </a>
    )
  }

  async function handleClick() {
    if (state.kind === 'dialling') return
    setState({ kind: 'dialling' })
    const reference = log ? `${log.label} (${log.leadId ? 'lead' : log.dealId ? 'deal' : log.contactId ? 'contact' : log.companyId ? 'client' : 'crm'})` : undefined
    const result = await dial(number, reference)
    if (!result.ok) {
      setState({ kind: 'error', message: result.error })
    } else {
      setState({ kind: 'ringing' })
      if (log) {
        addActivity({
          type: 'Call',
          subject: `Call — ${log.label}`,
          notes: `Dialled ${number} via BuzzBox from extension ${result.from}.`,
          leadId: log.leadId,
          contactId: log.contactId,
          companyId: log.companyId,
          dealId: log.dealId,
        })
      }
      onDialled?.()
    }
    if (resetTimer.current) clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => setState({ kind: 'idle' }), result.ok ? 5000 : 8000)
  }

  const title = `Call via BuzzBox — rings your extension ${status?.extension} first, then dials ${number}`
  return (
    <span className="inline-flex flex-col items-start min-w-0">
      <button
        type="button"
        onClick={handleClick}
        disabled={state.kind === 'dialling'}
        title={title}
        className={`${className} disabled:opacity-60 text-left ${dialling && children ? 'animate-pulse' : ''}`}
      >
        {dialling ? busyContent : content}
      </button>
      {state.kind === 'dialling' && <span className="text-[11px] text-slate-400">Asking BuzzBox…</span>}
      {state.kind === 'ringing' && <span className="text-[11px] text-[var(--c-green)]">Ringing extension {status?.extension} — pick up to connect</span>}
      {state.kind === 'error' && <span className="text-[11px] text-red-600">{state.message}</span>}
    </span>
  )
}
