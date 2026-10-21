import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Building2, CheckSquare, X } from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { newClientPopup } from '../../lib/newWork.ts'

/**
 * "New client: Abc Cricket. Call to introduce yourself." (S8, 18 Oct)
 *
 * The liaison's pop-up when Sales gives her a client. A card in the corner like the hand-out card
 * beside it, for the same reason: news, not an interruption. Every way out marks it read; the client
 * is on her list as a task and in the bell either way.
 */
export function NewClientPopup() {
  const { notifications, markNotificationRead } = useAppStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [closed, setClosed] = useState(false)
  const notices = newClientPopup(notifications, location.pathname)
  if (closed || notices.length === 0) return null

  function clear() { setClosed(true); for (const n of notices) markNotificationRead(n.id) }
  function go(to: string) { clear(); navigate(to) }

  return (
    <div className="fixed bottom-4 left-4 z-50 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-gold-300 bg-white shadow-xl md:left-auto md:right-4 md:bottom-40"
      data-testid="new-client-popup">
      <div className="flex items-start gap-2.5 px-4 pt-3.5">
        <span className="mt-0.5 shrink-0 rounded-lg bg-gold-100 p-1.5 text-gold-800"><Building2 size={16} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800">{notices.length === 1 ? 'A new client is yours' : `${notices.length} new clients are yours`}</p>
          {notices.map((n) => <p key={n.id} className="mt-0.5 text-[13px] leading-snug text-slate-600">{n.message}</p>)}
        </div>
        <button type="button" onClick={clear} aria-label="Close" className="shrink-0 rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600"><X size={14} /></button>
      </div>
      <div className="flex gap-2 px-4 pb-3.5 pt-3">
        <button type="button" onClick={() => go(notices[0].link ?? '/companies')}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-[13px] font-medium text-white hover:bg-brand-700">
          <Building2 size={14} /> {notices.length === 1 ? 'Open the client' : 'Open the first'}
        </button>
        <button type="button" onClick={() => go('/tasks')}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-50">
          <CheckSquare size={14} /> My tasks
        </button>
      </div>
    </div>
  )
}
