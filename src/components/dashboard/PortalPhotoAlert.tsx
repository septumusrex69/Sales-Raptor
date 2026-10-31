import { useEffect, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, ImageOff } from 'lucide-react'
import { useAuth } from '../../store/AuthContext'
import { supabase } from '../../lib/supabase'
import { clockNow } from '../../lib/clock'
import { johannesburgToday, portalPhotoProbe } from '../../lib/portalPhotos'
import { currentDayLook, subscribeDayLook } from '../../lib/dayLookState'

/**
 * THE CLIENT PORTAL'S PHOTOGRAPH, ON AN ADMINISTRATOR'S DASHBOARD (S16, 31 Oct). Two things an Administrator must hear,
 * and nothing at all when both are fine -- a warning that is always there is a warning nobody reads.
 *
 *  1. UNSPLASH IS OFF (Stephan: "ping me and tell me when Unsplash is off ... any administrator's dashboard"). Today's
 *     approved photograph is asked for at a tiny size; if it does not come within ten seconds, say so. The portal is
 *     already showing Llandudno meanwhile; the bell's notification comes from the server's own check, once a day.
 *  2. DAYS NOBODY APPROVED, in the coming week (Stephan: "pre-choose everything and approve it ... for the month"; "any
 *     administrator can approve it"). An unapproved day shows clients Llandudno -- safe, but not what the firm chose --
 *     so the dashboard says how many are coming and links to /portal-looks.
 */
const AHEAD = 7

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export function PortalPhotoAlert() {
  const { currentUser } = useAuth()
  const isAdmin = currentUser?.role === 'Administrator'
  const look = useSyncExternalStore(subscribeDayLook, currentDayLook, currentDayLook)
  const [down, setDown] = useState(false)
  const [unapproved, setUnapproved] = useState(0)

  useEffect(() => {
    if (!isAdmin || typeof Image === 'undefined' || look.photo.local) { setDown(false); return }
    let live = true
    const img = new Image()
    const timer = setTimeout(() => { if (live) setDown(true) }, 10_000)
    img.onload = () => { clearTimeout(timer); if (live) setDown(false) }
    img.onerror = () => { clearTimeout(timer); if (live) setDown(true) }
    img.src = portalPhotoProbe(look.photo)
    return () => { live = false; clearTimeout(timer) }
  }, [isAdmin, look])

  useEffect(() => {
    if (!isAdmin) return
    let live = true
    const today = johannesburgToday(clockNow())
    supabase.from('portal_day_looks').select('day').gte('day', today).lte('day', addDays(today, AHEAD - 1)).not('approved_at', 'is', null)
      .then(({ data, error }) => { if (live && !error) setUnapproved(AHEAD - (data ?? []).length) })
    return () => { live = false }
  }, [isAdmin])

  if (!isAdmin || (!down && unapproved === 0)) return null
  return (
    <div className="space-y-2">
      {down && (
        <div role="status" data-testid="portal-photo-alert"
          className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <ImageOff size={18} className="mt-0.5 shrink-0" />
          <p>
            <b>Unsplash is not serving the client portal's photo of the day</b> ("{look.photo.title}"). Clients are seeing
            Llandudno instead, so nothing looks broken to them. It comes back by itself when Unsplash does.
          </p>
        </div>
      )}
      {unapproved > 0 && (
        <div role="status" data-testid="portal-looks-alert"
          className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
          <CalendarClock size={18} className="mt-0.5 shrink-0 text-slate-500" />
          <p className="flex-1">
            <b>{unapproved === 1 ? '1 day' : `${unapproved} days`} in the next week</b> {unapproved === 1 ? 'has' : 'have'} no approved photograph
            for the client portal, so clients will see Llandudno on {unapproved === 1 ? 'it' : 'them'}.
          </p>
          <Link to="/portal-looks" className="shrink-0 font-medium text-brand-600 hover:underline" data-testid="portal-looks-alert-link">Approve the month</Link>
        </div>
      )}
    </div>
  )
}
