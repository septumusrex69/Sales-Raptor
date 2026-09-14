import { useState } from 'react'
import { Phone } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { PhoneLink, type CallLogTarget } from '../PhoneLink'
import { RecordAction } from './RecordShell'

/**
 * Ring a lead, a client or a contact, from the action row.
 *
 * The debtor page has had this for a while and the sales side did not: a Lead's "Log Call" only
 * ever recorded a call you had already made somewhere else, so the CRM was a filing cabinet you
 * updated after the fact rather than a place you worked from. The firm asked for the phone on
 * every page, and they were right.
 *
 * NOTHING IS CHARGED, and that is the whole difference from the debtor's Call button. Every
 * comparable action on an account raises an Annexure B fee — item 2 on the dial, item 7 if they
 * answer — because a debtor pays for the work of collecting from them. A lead does not owe us
 * anything, and a client is the person paying US. So this deliberately goes nowhere near
 * accountCalls or the charge engine: it is PhoneLink, which dials through BuzzBox and writes a
 * Call on the record's timeline, and that is all.
 *
 * With no BuzzBox extension it falls back to a tel: link, which on the tablets the firm actually
 * uses is the device dialler. The call is still logged either way.
 */
export function CrmCallButton({ numbers, to, subject, className }: {
  /** Every number that could reach them, primary first. More than one and it asks which. */
  numbers: { label: string; value: string }[]
  /** Which record the call goes onto. */
  to: { leadId?: string; contactId?: string; companyId?: string; dealId?: string }
  /** How the call should read on the timeline: "Call — Piet Pompies". */
  subject: string
  className: string
}) {
  const [choosing, setChoosing] = useState(false)
  const log: CallLogTarget = { label: subject, ...to }

  if (numbers.length === 0) {
    return <RecordAction icon={Phone} label="Call" title="No phone number on this record yet" />
  }

  // One number: no question to ask, so do not ask one.
  if (numbers.length === 1) {
    return (
      <PhoneLink number={numbers[0].value} className={className} log={log}>
        <Phone size={14} /> Call
      </PhoneLink>
    )
  }

  return (
    <>
      <RecordAction icon={Phone} label="Call" onClick={() => setChoosing(true)}
        title={`${numbers.length} numbers on this record`} />
      {choosing && (
        <Modal title="Which number?" onClose={() => setChoosing(false)} width={380}>
          <div className="space-y-1.5">
            {numbers.map((n) => (
              <PhoneLink
                key={`${n.label}-${n.value}`}
                number={n.value}
                log={log}
                block
                onDialled={() => setChoosing(false)}
                className="w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <Phone size={14} className="shrink-0 text-slate-400" />
                  <span className="min-w-0">
                    <span className="block font-medium truncate">{n.value}</span>
                    <span className="block text-xs text-slate-400 truncate">{n.label}</span>
                  </span>
                </span>
              </PhoneLink>
            ))}
          </div>
          <p className="text-xs text-slate-400 mt-4">
            The call goes on this record&rsquo;s timeline. Nothing is charged &mdash; that only
            happens on a debtor&rsquo;s account.
          </p>
        </Modal>
      )}
    </>
  )
}
