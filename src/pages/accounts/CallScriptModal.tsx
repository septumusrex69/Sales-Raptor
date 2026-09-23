import { useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { UseTemplate } from '../../components/library/UseTemplate'
import { missingFieldsNote } from '../../lib/messageTemplates'

/**
 * THE FIRM'S CALL SCRIPT, WITH THIS DEBTOR'S FIGURES IN IT.
 *
 * The fourth kind in the library, and the only one that is READ rather than SENT — which is
 * exactly why it was the one with no way into an account. An SMS template at least had a box to
 * be typed into; a call script lived on a screen a collector would have to leave the call to go
 * and look at.
 *
 * MERGED, AND THAT IS THE WHOLE POINT. A script that says "your balance of {{balance}}" is a
 * script the collector has to translate while somebody is talking to them. With the number
 * already in it, it can be read.
 *
 * NOTHING IS CHARGED BY OPENING THIS, and that is worth saying because every other button in the
 * action row does charge. Annexure B prices actions — an email, an SMS, a consultation — and
 * reading is not one of them. The fee for the call itself is raised by the call, where it
 * already was.
 */
export function CallScriptModal({ debtorKind, values, onClose }: {
  /** Which half of the library to offer. Every call script the firm has written suits either,
      so this filters nothing today -- and it will the day one of them does not. */
  debtorKind: 'individual' | 'company'
  /** Resolved by the account page, like every other merge in here. */
  values: Record<string, string>
  onClose: () => void
}) {
  const [picked, setPicked] = useState<{ name: string; body: string; missing: string[] } | null>(null)

  return (
    <Modal title="Call script" onClose={onClose} width={620}>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <UseTemplate scope="collections" kind="call_script" audience={debtorKind} values={values}
            label={picked ? 'Choose another' : 'Choose a script'}
            onPick={(p) => setPicked({ name: p.template.name, body: p.body, missing: p.missing })} />
          <span className="text-[11px] text-slate-400">Reading this charges nothing.</span>
        </div>

        {picked === null ? (
          <p className="text-sm text-slate-500">
            The firm&rsquo;s scripts, with this debtor&rsquo;s name and balance already in them.
          </p>
        ) : (
          <>
            <h4 className="text-sm font-semibold text-navy-950">{picked.name}</h4>
            {/*
              SET TO BE READ ALOUD, not to be skimmed: larger than the rest of the app and loose
              in the leading, because somebody is looking at this with a debtor already on the
              line. `whitespace-pre-wrap` keeps the paragraphing the writer put in.
            */}
            <div className="rounded-lg border border-slate-200 bg-white p-4 max-h-[55vh] overflow-auto">
              <p className="text-[15px] leading-7 text-slate-800 whitespace-pre-wrap">{picked.body}</p>
            </div>
            {/* Only when there IS something this account could not answer. */}
            {missingFieldsNote(picked.missing) && (
              <p className="text-[11px] text-[var(--c-rust-deep)]">
                {missingFieldsNote(picked.missing)}
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
