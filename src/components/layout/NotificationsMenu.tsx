import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { timeAgo } from '../../data/mockData'
import { useAppStore } from '../../store/AppStore'
import type { AppNotification } from '../../types'

export function NotificationsMenu() {
  const { notifications, markNotificationRead, markAllNotificationsRead } = useAppStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const unread = notifications.filter((n) => !n.read).length

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function handleSelect(n: AppNotification) {
    if (!n.read) markNotificationRead(n.id)
    setOpen(false)
    if (n.link) navigate(n.link)
  }

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative p-2 rounded-lg hover:bg-slate-100 text-slate-500">
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-semibold">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl shadow-lg border border-slate-100 py-2 z-50 max-h-96 overflow-y-auto">
          <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Notifications</h3>
            {unread > 0 && (
              <button onClick={markAllNotificationsRead} className="text-xs font-medium text-brand-600 hover:underline">
                Mark all read
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-400 text-center">No notifications yet.</p>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => handleSelect(n)}
                className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex gap-2 items-start"
              >
                <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${n.read ? 'bg-transparent' : 'bg-brand-500'}`} />
                <div className="min-w-0">
                  <p className={`text-[13px] leading-snug ${n.read ? 'text-slate-600' : 'text-slate-800 font-medium'}`}>{n.message}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{timeAgo(n.createdAt)}</p>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
