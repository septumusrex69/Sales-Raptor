import { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { useAuth } from '../../store/AuthContext'
import { johannesburgToday, photoOfTheDay, portalPhotoProbe } from '../../lib/portalPhotos'
import { clockNow } from '../../lib/clock'

/**
 * "UNSPLASH IS OFF", ON AN ADMINISTRATOR'S DASHBOARD (S16, 31 Oct). Stephan: "ping me and tell me when Unsplash is off
 * ... a notification ... And it appears on my dashboard. Any administrator's dashboard."
 *
 * The client portal's photograph changes every day and loads from Unsplash (portalPhotos.ts). When it cannot, the portal
 * quietly shows Llandudno -- so this is the part that makes it NOT quiet for the people who can do something. This
 * browser asks for a tiny copy of today's photograph; if it does not arrive within ten seconds, the banner says so. The
 * bell's notification comes from the server's own check (api/_lib/portal.ts photoAlarm), once a day.
 *
 * Administrators only, and NOTHING when all is well: a warning that is always there is a warning nobody reads.
 */
export function PortalPhotoAlert() {
  const { currentUser } = useAuth()
  const isAdmin = currentUser?.role === 'Administrator'
  const [down, setDown] = useState(false)
  const photo = photoOfTheDay(johannesburgToday(clockNow()))

  useEffect(() => {
    if (!isAdmin || typeof Image === 'undefined') return
    let live = true
    const img = new Image()
    const timer = setTimeout(() => { if (live) setDown(true) }, 10_000)
    img.onload = () => { clearTimeout(timer); if (live) setDown(false) }
    img.onerror = () => { clearTimeout(timer); if (live) setDown(true) }
    img.src = portalPhotoProbe(photo)
    return () => { live = false; clearTimeout(timer) }
  }, [isAdmin, photo])

  if (!isAdmin || !down) return null
  return (
    <div role="status" data-testid="portal-photo-alert"
      className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <ImageOff size={18} className="mt-0.5 shrink-0" />
      <p>
        <b>Unsplash is not serving the client portal's photo of the day</b> ("{photo.title}"). Clients are seeing
        Llandudno instead, so nothing looks broken to them. It comes back by itself when Unsplash does.
      </p>
    </div>
  )
}
