import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { CalendarClock, Inbox, ListChecks, X } from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { newWorkPopup } from '../../lib/newWork.ts'

/**
 * "You've been given seven accounts."
 *
 * THE FIRM: "there should be some sort of notification that's being shown to the clerk that, oh,
 * you've received seven new handovers and referrals ... perhaps a pop-up ... and then it should
 * give you an option to go to your diary to look at them, or just to see them, the list of them.
 * Or you should be able to close it."
 *
 * A CARD IN THE CORNER, NOT A MODAL OVER THE MIDDLE. Work arriving on a desk is news; it is not
 * an interruption in the way a promise-to-pay falling due is, and a clerk who is mid-call when a
 * team leader presses Hand Out should not have the account they are reading covered over. The
 * ReminderWatcher is the modal, and it is the modal because it is about a time a debtor was given.
 *
 * ALL THREE WAYS OUT MARK IT READ, closing included — unlike the reminder, which cannot be
 * dismissed into nothing. The difference is that the work itself does not disappear with the box:
 * it is in the diary and on the book either way, and the bell keeps the line. A card that came
 * back on every page change would be the fastest way to teach somebody to close it unread.
 */
export function NewWorkPopup() {
  const { notifications, markNotificationRead } = useAppStore()
  const navigate = useNavigate()
  const location = useLocation()
  /* Closed in this session even though the rows only become read a moment later — a state that
     waits for a round trip is a card that stays on screen after it was dismissed. */
  const [closed, setClosed] = useState(false)

  const work = newWorkPopup(notifications, location.pathname + location.search)
  if (!work || closed) return null

  function clear() {
    setClosed(true)
    for (const n of work!.notices) markNotificationRead(n.id)
  }

  function go(to: string) {
    clear()
    navigate(to)
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white shadow-xl">
      <div className="flex items-start gap-2.5 px-4 pt-3.5">
        <span className="mt-0.5 shrink-0 rounded-lg bg-brand-50 p-1.5 text-brand-600">
          <Inbox size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800">New work on your desk</p>
          {work.lines.map((line, i) => (
            <p key={i} className="mt-0.5 text-[13px] leading-snug text-slate-600">{line}</p>
          ))}
        </div>
        <button type="button" onClick={clear} aria-label="Close"
          className="shrink-0 rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600">
          <X size={14} />
        </button>
      </div>
      <div className="flex gap-2 px-4 pb-3.5 pt-3">
        {/* The diary first: it is the one that says what to do today, where the list only says
            what you now have. */}
        <button type="button" onClick={() => go('/diary')}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-[13px] font-medium text-white hover:bg-brand-700">
          <CalendarClock size={14} /> My diary
        </button>
        <button type="button" onClick={() => go(work.seeLink)}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-50">
          <ListChecks size={14} /> See them
        </button>
      </div>
    </div>
  )
}
