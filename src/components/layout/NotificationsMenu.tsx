import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { groupNotifications, linkIsOpen, notificationWhen, type NotificationGroup } from '../../lib/notificationGroups'

export function NotificationsMenu() {
  const { notifications, markNotificationRead, markAllNotificationsRead } = useAppStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const groups = useMemo(() => groupNotifications(notifications), [notifications])
  /* The badge counts THINGS waiting, as the list shows them: two replies on R-6 are one. */
  const unread = groups.filter((g) => g.unread > 0).length

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  /* Opening the thing reads its notifications -- see linkIsOpen. The bell is in the top bar of
     every page, so this one watcher covers every link without any page knowing about it. */
  const marked = useRef(new Set<string>())
  useEffect(() => {
    for (const n of notifications) {
      /* Once per id: the effect runs again before the store has the change, and one write is enough. */
      if (!n.read && !marked.current.has(n.id) && linkIsOpen(n.link, location.pathname, location.search)) {
        marked.current.add(n.id)
        markNotificationRead(n.id)
      }
    }
  }, [location.pathname, location.search, notifications, markNotificationRead])

  function handleSelect(g: NotificationGroup) {
    for (const id of g.ids) if (notifications.find((n) => n.id === id && !n.read)) markNotificationRead(id)
    setOpen(false)
    if (g.latest.link) navigate(g.latest.link)
  }

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative p-2 rounded-lg hover:bg-slate-100 text-slate-500" data-testid="notifications-bell">
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-semibold" data-testid="notifications-count">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl shadow-lg border border-slate-100 py-2 z-50 max-h-96 overflow-y-auto" data-testid="notifications-menu">
          <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Notifications</h3>
            {unread > 0 && (
              <button onClick={markAllNotificationsRead} className="text-xs font-medium text-brand-600 hover:underline">
                Mark all read
              </button>
            )}
          </div>
          {groups.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-400 text-center">No notifications yet.</p>
          ) : (
            groups.map((g) => (
              <button
                key={g.key}
                onClick={() => handleSelect(g)}
                className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex gap-2 items-start"
                data-testid="notification" data-unread={g.unread > 0 ? 'true' : 'false'}
              >
                <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${g.unread > 0 ? 'bg-brand-500' : 'bg-transparent'}`} />
                <div className="min-w-0">
                  <p className={`text-[13px] leading-snug ${g.unread > 0 ? 'text-slate-800 font-medium' : 'text-slate-600'}`}>{g.latest.message}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5" data-testid="notification-when">
                    {/* The real clock, not staging's: see notificationWhen. */}
                    {notificationWhen(g.latest.createdAt, Date.now())}
                    {g.more > 0 && ` · and ${g.more} more`}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
