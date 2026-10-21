import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, KeyRound } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { deviceId } from '../../lib/deviceId'
import { needsDeviceCode, normaliseCode } from '../../lib/loginCode'
import { AuthShell, authFieldClass } from '../../pages/auth/AuthShell'

/**
 * THE CODE SCREEN: an Administrator on a device Raptor has not seen for them (S10, 21 Oct).
 *
 * Sits inside RequireAuth, after the profile has loaded, so the role is known and nothing of the
 * app has drawn yet. Everybody who is not an Administrator walks straight through.
 *
 * ASK THE DATABASE FIRST (trusted_device_seen), which is one quick call and answers for every
 * sign-in after the first; only an unknown device sends a code. FAILS CLOSED: if the question
 * cannot be asked, the answer is the code screen, not the app.
 *
 * A gate in the app, held up by the server that makes and checks the code -- not a guard in the
 * database. src/lib/loginCode.ts says exactly what that does and does not stop.
 */

/* Answered once per page load per person, so moving between screens does not ask again. */
const cleared = new Set<string>()

const SIGNED_OUT = 'You were signed out, so this code can no longer be checked. Sign out below, sign in again, and use the new code we send.'

type Reply = { trusted?: boolean; required?: boolean; sent?: boolean; to?: string; error?: string }

async function call(step: 'send' | 'check', extra: Record<string, unknown> = {}): Promise<{ ok: boolean; body: Reply }> {
  const { data } = await supabase.auth.getSession()
  const res = await fetch('/api/email/login-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
    body: JSON.stringify({ step, deviceId: deviceId(), ...extra }),
  })
  const body = await res.json().catch(() => ({})) as Reply
  /* A 401 is the SIGN-IN gone, not the code: said as "Invalid or expired session", it read as the
     code having expired while the email said ten minutes (21 Oct). Say what happened instead. */
  if (res.status === 401) return { ok: false, body: { error: SIGNED_OUT } }
  return { ok: res.ok, body }
}

export function AdminDeviceCode({ userId, role, onSignOut, children }: {
  userId: string
  role: string
  onSignOut: () => void
  children: ReactNode
}) {
  const asked = needsDeviceCode(role)
  const [state, setState] = useState<'checking' | 'code' | 'clear'>(() => (!asked || cleared.has(userId) ? 'clear' : 'checking'))
  const [code, setCode] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const sentOnce = useRef(false)

  function letIn() {
    cleared.add(userId)
    setState('clear')
  }

  useEffect(() => {
    if (state !== 'checking') return
    let gone = false
    void supabase.rpc('trusted_device_seen', { p_device_id: deviceId() }).then(({ data, error: rpcError }) => {
      if (gone) return
      if (!rpcError && data === true) letIn()
      else setState('code')
    })
    return () => { gone = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  async function sendCode() {
    setBusy(true); setError(null); setNotice(null)
    try {
      const { ok, body } = await call('send')
      if (body.trusted || body.required === false) { letIn(); return }
      if (!ok) throw new Error(body.error ?? 'The code could not be sent.')
      setNotice(`We emailed a code to ${body.to ?? 'your address'}. It lasts 10 minutes.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  /* The first code goes by itself; pressing a button to be sent the thing you came for is a step
     nobody needs. Once, however often React runs the effect. */
  useEffect(() => {
    if (state === 'code' && !sentOnce.current) {
      sentOnce.current = true
      void sendCode()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const typed = normaliseCode(code)
    if (!typed) { setError('The code is six digits.'); return }
    setBusy(true); setError(null)
    try {
      const { ok, body } = await call('check', { code: typed })
      if (body.trusted || body.required === false) { letIn(); return }
      if (!ok) throw new Error(body.error ?? 'That code did not work.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  /* NO PROFILE YET, NO ROLE YET. AuthContext clears `loading` before the profile arrives, and
     waving the app through until it does would show an Administrator's screens on a new device
     for as long as one request takes. So hold until we know who this is. */
  if (!userId) {
    return <div className="flex h-dvh items-center justify-center text-sm text-slate-400">Loading…</div>
  }
  if (state === 'clear') return <>{children}</>
  if (state === 'checking') {
    return <div className="flex h-dvh items-center justify-center text-sm text-slate-400">Loading…</div>
  }

  return (
    <AuthShell title="Check your email" subtitle="This device is new for your account. Type the code we emailed you.">
      <form onSubmit={handleSubmit} data-testid="device-code">
        <label className="block text-[13px] font-medium text-slate-600 mb-1.5" htmlFor="device-code">
          Six-digit code
        </label>
        <div className="relative mb-4">
          <KeyRound size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            id="device-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={9}
            className={`${authFieldClass} tracking-[0.3em]`}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
          />
        </div>

        {notice && <p className="text-sm text-[var(--c-green)] mb-3.5">{notice}</p>}
        {error && <p className="text-sm text-[var(--c-rust-deep)] mb-3.5" role="alert">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full inline-flex items-center justify-center gap-2 text-sm font-semibold px-4 py-3 rounded-xl bg-[#142433] text-white hover:bg-[#1c3149] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? 'Please wait…' : 'Continue'}
          {!busy && <ArrowRight size={15} />}
        </button>

        <div className="mt-4 flex items-center justify-between text-[13px]">
          <button type="button" onClick={() => void sendCode()} disabled={busy}
            className="text-slate-500 underline underline-offset-4 hover:text-[#12233a] disabled:opacity-50">
            Send a new code
          </button>
          <button type="button" onClick={onSignOut} className="text-slate-500 underline underline-offset-4 hover:text-[#12233a]">
            Sign out
          </button>
        </div>

        {/* THE WAY OUT, said on the screen where it is needed. A Settings -> Users button the
            person cannot reach is no help unless somebody tells them to ask for it. */}
        <p className="mt-5 text-[12px] leading-relaxed text-slate-400">
          No email after a few minutes? Check your junk folder. If it still has not come, ask another
          Administrator to let you in from Settings → Users, then press “Send a new code”.
        </p>
      </form>
    </AuthShell>
  )
}
