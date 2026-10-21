import { useState } from 'react'
import { MessageCircle } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { RecordAction, ACTION_BASE, ACTION_ENABLED } from './RecordShell'
import { whatsAppLink, whatsAppNote, whatsAppNumber, whatsAppOpening } from '../../lib/whatsapp'
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
 * browser can call it a pop-up.
 *
 * AND ON THE WAY BACK, HOW MANY WERE SENT (the firm, 19 Oct: "when you go back to Raptor, it should
 * ask you how many messages were sent. And that should also be ... correspondence"). Raptor cannot
 * see WhatsApp, so the person says. The question is put up the moment WhatsApp opens, so it is
 * waiting whichever way they come back -- the iPad's app switcher, another browser tab, the desktop
 * app -- with nothing to detect. `onSent` is what the page records for that count.
 */
export function WhatsAppButton({ numbers, message, onSent, chargeNote, className }: {
  /** Every number that could reach them, primary first. */
  numbers: { label: string; value: string }[]
  /** The opening line, typed into WhatsApp for the person to edit. */
  message?: string | null
  /** How many messages went to this number, as the person says on the way back. 0 is recorded too. */
  onSent?: (number: string, count: number) => void
  /** Said in the question where each message is charged -- a debtor's account. */
  chargeNote?: string
  className?: string
}) {
  const [choosing, setChoosing] = useState(false)
  /* The number WhatsApp was just opened on, waiting for the count. */
  const [asking, setAsking] = useState<string | null>(null)
  const ask = asking && onSent ? (
    <WhatsAppSentModal number={asking} charged={chargeNote}
      onDone={(count) => { onSent(asking, count); setAsking(null) }}
      onClose={() => setAsking(null)} />
  ) : null
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
      onClick={() => { setChoosing(false); setAsking(n.value) }}>
      {children}
    </a>
  )

  if (reachable.length === 1) {
    return (
      <>
        {link(reachable[0], className ?? `${ACTION_BASE} ${ACTION_ENABLED}`, <><MessageCircle size={14} /> WhatsApp</>)}
        {ask}
      </>
    )
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
      {ask}
    </>
  )
}

/**
 * HOW MANY WHATSAPP MESSAGES WENT, asked on the way back from WhatsApp. One by default -- the usual
 * answer -- and nought is an answer too ("opened it, sent nothing"), recorded as such rather than
 * left as a press nobody can explain. Closing the box records nothing.
 */
export function WhatsAppSentModal({ number, onDone, onClose, charged }: {
  number: string
  onDone: (count: number) => void
  onClose: () => void
  /** Said under the count where each message is charged (a debtor's account). */
  charged?: string
}) {
  const [count, setCount] = useState(1)
  return (
    <Modal title="How many WhatsApp messages did you send?" onClose={onClose} width={400}>
      <div data-testid="whatsapp-sent">
        <p className="text-sm text-slate-600">To {number}.</p>
        <div className="mt-3 flex items-center gap-2">
          <button type="button" onClick={() => setCount((c) => Math.max(0, c - 1))} aria-label="One fewer"
            className="h-9 w-9 rounded-lg border border-slate-200 text-lg text-slate-600 hover:bg-slate-50">−</button>
          <input type="number" min={0} max={50} value={count} aria-label="Messages sent"
            onChange={(e) => setCount(Math.max(0, Math.min(50, Math.floor(Number(e.target.value) || 0))))}
            className="h-9 w-16 rounded-lg border border-slate-200 text-center text-lg font-semibold tabular-nums" />
          <button type="button" onClick={() => setCount((c) => Math.min(50, c + 1))} aria-label="One more"
            className="h-9 w-9 rounded-lg border border-slate-200 text-lg text-slate-600 hover:bg-slate-50">+</button>
        </div>
        {charged && count > 0 && <p className="mt-2 text-xs text-slate-500">{charged}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => onDone(0)} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100">None sent</button>
          <button type="button" onClick={() => onDone(count)} data-testid="whatsapp-sent-save"
            className="rounded-lg bg-navy-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-navy-950">Record {count === 1 ? '1 message' : `${count} messages`}</button>
        </div>
      </div>
    </Modal>
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
      onSent={(number, count) => { void addActivity({ type: 'WhatsApp', subject: `WhatsApp — ${subject}`, notes: whatsAppNote(number, count), ...to }) }} />
  )
}
