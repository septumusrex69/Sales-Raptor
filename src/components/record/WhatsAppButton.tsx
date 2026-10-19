import { useState } from 'react'
import { MessageCircle } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { RecordAction, ACTION_BASE, ACTION_ENABLED } from './RecordShell'
import { whatsAppLink, whatsAppNumber, whatsAppOpening } from '../../lib/whatsapp'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'

/**
 * WHATSAPP, FROM THE ACTION ROW (S9, 19 Oct): opens WhatsApp itself on the number, the opening line
 * typed in for the person to edit and send. See lib/whatsapp.ts for why it is a link and not an
 * integration, and what that means Raptor cannot see.
 *
 * SHAPED LIKE THE CALL BUTTON: one cellphone number and it opens straight away; more than one and
 * it asks which (the firm: "it asks me which number to WhatsApp, it already opens it"). Only numbers
 * WhatsApp can reach are offered -- a landline is left out rather than opened into a chat that can
 * never be delivered.
 *
 * A REAL LINK, NOT A SCRIPT: the press itself opens WhatsApp, so nothing is waited for first and no
 * browser can call it a pop-up. What the page records about it (`onOpened`) runs beside it.
 */
export function WhatsAppButton({ numbers, message, onOpened, className }: {
  /** Every number that could reach them, primary first. */
  numbers: { label: string; value: string }[]
  /** The opening line, typed into WhatsApp for the person to edit. */
  message?: string | null
  /** After WhatsApp was opened on this number -- what the page records about the press. */
  onOpened?: (number: string) => void
  className?: string
}) {
  const [choosing, setChoosing] = useState(false)
  const reachable = numbers
    .map((n) => ({ ...n, wa: whatsAppNumber(n.value) }))
    .filter((n): n is typeof n & { wa: string } => !!n.wa)
    /* The same cellphone written two ways is one number. */
    .filter((n, i, all) => all.findIndex((m) => m.wa === n.wa) === i)

  if (reachable.length === 0) {
    return <RecordAction icon={MessageCircle} label="WhatsApp"
      title={numbers.length ? 'None of the numbers on file is a cellphone WhatsApp can reach' : 'No cellphone number on file yet'} />
  }

  const link = (n: (typeof reachable)[number], cls: string, children: React.ReactNode) => (
    <a href={whatsAppLink(n.wa, message)} target="_blank" rel="noopener noreferrer" className={cls}
      data-testid="whatsapp-link" data-number={n.wa}
      onClick={() => { setChoosing(false); onOpened?.(n.value) }}>
      {children}
    </a>
  )

  if (reachable.length === 1) {
    return link(reachable[0], className ?? `${ACTION_BASE} ${ACTION_ENABLED}`,
      <><MessageCircle size={14} /> WhatsApp</>)
  }

  return (
    <>
      <RecordAction icon={MessageCircle} label="WhatsApp" onClick={() => setChoosing(true)}
        title={`${reachable.length} cellphone numbers on file`} />
      {choosing && (
        <Modal title="WhatsApp which number?" onClose={() => setChoosing(false)} width={380}>
          <div className="space-y-1.5">
            {reachable.map((n) => (
              <div key={n.wa}>
                {link(n, 'flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-slate-700 hover:bg-slate-50', (
                  <>
                    <MessageCircle size={14} className="shrink-0 text-emerald-600" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{n.value}</span>
                      <span className="block truncate text-xs text-slate-400">{n.label}</span>
                    </span>
                  </>
                ))}
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-slate-400">
            WhatsApp opens with the message typed in; change it before you send. The conversation stays
            in WhatsApp -- Raptor records that you opened it.
          </p>
        </Modal>
      )}
    </>
  )
}

/**
 * THE SAME BUTTON ON A LEAD, A CLIENT, A CONTACT OR A DEAL. Nothing is charged -- the sales side
 * raises no fees, as CrmCallButton says -- and the press goes on the record's timeline as a
 * WhatsApp activity, so the next person can see who was written to and when.
 */
export function CrmWhatsAppButton({ numbers, to, subject, firstName }: {
  numbers: { label: string; value: string }[]
  to: { leadId?: string; contactId?: string; companyId?: string; dealId?: string }
  /** How it reads on the timeline: "WhatsApp — Piet Pompies". */
  subject: string
  /** For the opening line. */
  firstName?: string | null
}) {
  const { addActivity } = useAppStore()
  const { currentUser } = useAuth()
  return (
    <WhatsAppButton numbers={numbers}
      message={whatsAppOpening({ firstName, senderName: currentUser?.name })}
      onOpened={(number) => { void addActivity({ type: 'WhatsApp', subject: `WhatsApp — ${subject}`, notes: `WhatsApp to ${number}`, ...to }) }} />
  )
}
