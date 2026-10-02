import { useState } from 'react'
import { CalendarClock, X } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { CLIENT_POSITIONS, type ClientPosition } from '../../lib/clientPosition.ts'

/**
 * ONE BOX ON THE WAY OUT: WHERE IT GOT TO, AND WHEN IT COMES BACK.
 *
 * THE FIRM, having complained that the call box asked after every single call: "I'm confirming
 * that with you when you rediarise. Or if you go out of the account. To confirm the status of the
 * account. And also if you want to rediarise."
 *
 * THE QUESTION MOVED RATHER THAN MULTIPLIED. Asked after every call it is noise: a collector who
 * rings four numbers on a traced account answers "where does this stand" four times and the answer
 * never changes once. Asked as they close the account it is the question they are actually
 * answering.
 *
 * IT SAYS WHERE THE ACCOUNT STANDS AND OFFERS TO LEAVE IT THERE, which is the same fix as the call
 * box's -- see OutcomePicker.current. A box that demanded a fresh answer every time would be the
 * thing the firm complained about, moved rather than cured.
 *
 * AND IT CHANGES NO STATUS BY ITSELF. The rule the firm confirmed when asked directly and
 * callOutcome records: a status is a consequence of something recorded, never a keystroke. So the
 * only two buttons here are "leave it where it is" and "it moved -- let me record what happened",
 * and the second sends them to the control that writes the record. What this box writes is the
 * DIARY ENTRY, which is a note about a day and charges nothing.
 *
 * DISMISSABLE WITHOUT ANSWERING. A prompt that cannot be escaped is one people learn to click
 * through, and an account left with no diary date is already visible as exactly that -- "No diary
 * date" is a list a team leader works. Nagging adds nothing the list does not already say.
 */
export function LeavingModal({ standing, accountLabel, onDiarise, onRecord, onClose }: {
  /** Where the account stands now. Null where it is a desk-only rung like "new". */
  standing: ClientPosition | null
  accountLabel: string
  /** Open the diary box. This one does not write the entry itself -- see the header. */
  onDiarise: () => void
  /** Open the place where a status is actually changed, which is where a record gets written. */
  onRecord: () => void
  onClose: () => void
}) {
  const [leaving, setLeaving] = useState(false)
  const meta = standing ? CLIENT_POSITIONS[standing] : null

  return (
    <Modal title="Before you go" onClose={onClose} width={460}>
      <p className="text-sm text-slate-500">
        {accountLabel} has no date to come back on.
      </p>

      {meta && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
          <p className="text-xs text-slate-500">It is reported to the client as</p>
          <p className="text-sm font-semibold text-slate-800 mt-0.5">{meta.label}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">{meta.meaning}</p>
        </div>
      )}

      {/*
        TWO ANSWERS AND THEY ARE NOT SYMMETRICAL. Leaving it is the common one and costs nothing;
        changing it is a record somebody has to write, which is why the second button leaves this
        box rather than offering a list of rungs. A picker here would be a status set by keystroke.
      */}
      <div className="mt-4 space-y-2">
        <button type="button" onClick={() => { setLeaving(true); onDiarise() }}
          disabled={leaving}
          className="w-full text-left px-3.5 py-3 rounded-lg border border-slate-200
            hover:border-[#c9a052] hover:bg-gold-50 disabled:opacity-50">
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <CalendarClock size={14} /> That is still right &mdash; give it a date
          </span>
          <span className="block text-xs text-slate-500 mt-0.5">
            Opens the diary. Nothing is charged for it.
          </span>
        </button>

        <button type="button" onClick={() => { setLeaving(true); onRecord() }}
          disabled={leaving}
          className="w-full text-left px-3.5 py-3 rounded-lg border border-slate-200
            hover:border-[#c9a052] hover:bg-gold-50 disabled:opacity-50">
          <span className="block text-sm font-semibold text-slate-800">
            It has moved on
          </span>
          <span className="block text-xs text-slate-500 mt-0.5">
            Record what happened and the rung follows it.
          </span>
        </button>
      </div>

      <div className="flex items-center justify-end mt-4">
        {/* NOT "Cancel". Nothing is being undone -- the work is already saved -- and "Cancel"
            beside a saved call reads as though it takes it back. */}
        <button type="button" onClick={onClose}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg
            text-slate-500 hover:bg-slate-100">
          <X size={13} /> Leave it for now
        </button>
      </div>
    </Modal>
  )
}
