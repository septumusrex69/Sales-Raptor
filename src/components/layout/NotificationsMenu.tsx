import { useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { timeAgo } from '../../data/mockData'
import type { AppNotification } from '../../types'

const MOCK_NOTIFICATIONS: AppNotification[] = [
  { id: 'n1', type: 'New lead assigned', message: 'New lead assigned: John Smith (ABC (Pty) Ltd)', createdAt: '2026-08-16T08:15:00', read: false },
  { id: 'n2', type: 'Task overdue', message: 'Task overdue: Call back John Smith', createdAt: '2026-08-16T07:00:00', read: false },
  { id: 'n3', type: 'Proposal viewed', message: 'Proposal viewed by Greenleaf (Pty) Ltd', createdAt: '2026-08-15T16:40:00', read: false },
  { id: 'n4', type: 'Deal won', message: 'Deal Won: Metro School Account (R120,000)', createdAt: '2026-08-15T11:20:00', read: true },
  { id: 'n5', type: 'Meeting starting', message: 'Meeting with Metro School starts in 30 minutes', createdAt: '2026-08-14T10:30:00', read: true },
]

export function NotificationsMenu() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState(MOCK_NOTIFICATIONS)
  const ref = useRef<HTMLDivElement>(null)
  const unread = items.filter((n) => !n.read).length

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => {
          setOpen((o) => !o)
          if (!open) setItems((prev) => prev.map((n) => ({ ...n, read: true })))
        }}
        className="relative p-2 rounded-lg hover:bg-slate-100 text-slate-500"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-semibold">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl shadow-lg border border-slate-100 py-2 z-50 max-h-96 overflow-y-auto">
          <div className="px-4 py-2 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-700">Notifications</h3>
          </div>
          {items.map((n) => (
            <div key={n.id} className="px-4 py-2.5 hover:bg-slate-50 flex gap-2 items-start">
              <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${n.read ? 'bg-transparent' : 'bg-brand-500'}`} />
              <div>
                <p className="text-[13px] text-slate-700 leading-snug">{n.message}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{timeAgo(n.createdAt)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
