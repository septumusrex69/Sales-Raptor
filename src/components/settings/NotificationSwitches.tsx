import { useEffect, useState } from 'react'
import { Card, CardHeader } from '../ui/Card'
import { supabase } from '../../lib/supabase'
import { clockNow } from '../../lib/clock'
import { useAuth } from '../../store/AuthContext'
import { NOTIFICATION_KINDS } from '../../lib/notificationKinds'

/**
 * YOUR NOTIFICATIONS, SWITCHED ON OR OFF (Raptor H19; Stephan, 9 Nov: "the real ones", each person their own).
 * Saved in notification_preferences; the database drops a notification of a kind you switched off before it is
 * written, so it never reaches your bell. Everything is on until you switch it off.
 */
export function NotificationSwitches() {
  const { currentUser } = useAuth()
  const [muted, setMuted] = useState<Record<string, boolean>>({})
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!currentUser) return
    let alive = true
    void supabase.from('notification_preferences').select('kind, muted').eq('user_id', currentUser.id).then(({ data, error: e }) => {
      if (!alive) return
      if (e) setError(`Your switches could not be read: ${e.message}`)
      setMuted(Object.fromEntries(((data ?? []) as { kind: string; muted: boolean }[]).map((r) => [r.kind, r.muted])))
      setLoaded(true)
    })
    return () => { alive = false }
  }, [currentUser])

  const flip = async (kind: string, on: boolean) => {
    if (!currentUser) return
    const before = muted[kind] ?? false
    setMuted((m) => ({ ...m, [kind]: !on }))
    setError(null)
    const { error: e } = await supabase.from('notification_preferences')
      .upsert({ user_id: currentUser.id, kind, muted: !on, updated_at: clockNow().toISOString() }, { onConflict: 'user_id,kind' })
    if (e) {
      setMuted((m) => ({ ...m, [kind]: before }))
      setError(`Not saved: ${e.message}`)
    }
  }

  return (
    <Card>
      <CardHeader title="Notifications" subtitle="What reaches your bell. Switched off, it is never sent to you; nobody else's bell changes." />
      <div className="divide-y divide-slate-50" data-testid="notification-switches">
        {NOTIFICATION_KINDS.map((k) => {
          const on = !(muted[k.kind] ?? false)
          return (
            <div key={k.kind} className="flex items-center justify-between gap-4 py-1.5" data-testid="notification-switch" data-kind={k.kind}>
              <span className="min-w-0">
                <span className="block text-[12.5px] text-slate-700">{k.label}</span>
                <span className="block text-[11.5px] text-slate-400">{k.blurb}</span>
              </span>
              <button type="button" role="switch" aria-checked={on} aria-label={k.label} disabled={!loaded}
                onClick={() => void flip(k.kind, !on)}
                className={`w-10 rounded-full transition-colors relative shrink-0 disabled:opacity-50 ${on ? 'bg-brand-600' : 'bg-slate-200'}`}
                style={{ height: 22 }}>
                <span className={`absolute top-0.5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[19px]' : 'translate-x-0.5'}`} style={{ width: 18, height: 18, left: 0 }} />
              </button>
            </div>
          )
        })}
      </div>
      {error && <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}
    </Card>
  )
}
