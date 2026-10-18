import { useEffect, useState, type ReactNode } from 'react'
import { Loader2, ShieldCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../store/AuthContext'
import { needsTwoStep, type TwoStepState } from '../../lib/twoStep'

/**
 * TWO-STEP SIGN-IN FOR ADMINISTRATORS (S8, 18 Oct; security audit B-02).
 *
 * The firm, of the audit's "enable MFA for Administrator accounts": "Can you turn on the two-step
 * factor login?" An Administrator can invite and remove people and reach every rand in the trust
 * account, so one guessed password should not be enough. Supabase's authenticator-app factor (TOTP)
 * is on for every project; what was missing is Raptor ASKING for it.
 *
 * THREE STATES, decided by needsTwoStep from the session's assurance level:
 *   - not an Administrator, or already at aal2: the app, unchanged;
 *   - an Administrator with an authenticator set up: the six-digit code, every sign-in;
 *   - an Administrator without one: set it up now -- scan the code, type the six digits -- before
 *     anything else. Not skippable: a gate a person may wave through is not a gate.
 * The server holds the same line (callerIsAdmin refuses an Administrator's session below aal2), so
 * this screen is the way through, not the protection.
 *
 * LOST PHONE: another Administrator cannot remove a factor from inside Raptor yet; it is removed in
 * the Supabase dashboard (Authentication -> Users -> the person -> MFA), after which they set it up
 * again here. Said on the screen, because the moment it is needed is the moment nobody remembers.
 */
export function AdminTwoStep({ children }: { children: ReactNode }) {
  const { currentUser, session, signOut } = useAuth()
  const [state, setState] = useState<TwoStepState | 'checking'>('checking')

  useEffect(() => {
    let live = true
    if (!currentUser) return
    supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      .then(({ data }) => {
        if (!live) return
        setState(needsTwoStep(currentUser.role, data?.currentLevel ?? null, data?.nextLevel ?? null))
      })
      /* Unreadable is not "fine": an Administrator is asked for the code rather than waved through. */
      .catch(() => { if (live) setState(currentUser.role === 'Administrator' ? 'code' : 'none') })
    return () => { live = false }
  }, [currentUser, session?.access_token])

  if (!currentUser || state === 'none') return <>{children}</>
  if (state === 'checking') {
    return <div className="flex h-dvh items-center justify-center text-sm text-slate-400">Loading…</div>
  }
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-testid="two-step">
        <div className="mb-4 flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-gold-50 text-gold-700"><ShieldCheck size={18} /></span>
          <div>
            <h1 className="text-base font-bold text-navy-950">Two-step sign-in</h1>
            <p className="text-xs text-slate-500">Administrators confirm it&rsquo;s them with an authenticator app.</p>
          </div>
        </div>
        {state === 'enrol'
          ? <Enrol onDone={() => setState('none')} />
          : <Code onDone={() => setState('none')} />}
        <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-400">
          <span>Lost your phone? Another administrator resets it in Supabase.</span>
          <button className="font-medium text-slate-500 hover:text-slate-700" onClick={() => void signOut()}>Sign out</button>
        </div>
      </div>
    </div>
  )
}

/** Six digits, nothing else -- an authenticator app sometimes copies with a space in the middle. */
const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6)

function CodeBox({ value, onChange, onSubmit, busy, error, label }: {
  value: string; onChange: (v: string) => void; onSubmit: () => void; busy: boolean; error: string | null; label: string
}) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (value.length === 6 && !busy) onSubmit() }}>
      <label className="block text-xs font-medium text-slate-500 mb-1" htmlFor="two-step-code">{label}</label>
      <input id="two-step-code" autoFocus inputMode="numeric" autoComplete="one-time-code" value={value}
        onChange={(e) => onChange(digits(e.target.value))}
        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-center text-xl font-semibold tracking-[0.5em] tabular-nums focus:border-navy-700 focus:outline-none"
        placeholder="••••••" />
      {error && <p className="mt-2 text-xs text-rose-600" role="alert">{error}</p>}
      <button type="submit" disabled={value.length !== 6 || busy}
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
        {busy && <Loader2 size={15} className="animate-spin" />} Confirm
      </button>
    </form>
  )
}

function Code({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function verify() {
    setBusy(true); setError(null)
    try {
      const { data, error: listError } = await supabase.auth.mfa.listFactors()
      if (listError) throw listError
      const factor = data?.totp?.find((f) => f.status === 'verified')
      if (!factor) throw new Error('No authenticator is set up on this account. Sign out and in again to set one up.')
      const { error: e } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code })
      if (e) throw e
      onDone()
    } catch (e) {
      setError(friendly(e)); setCode('')
    } finally { setBusy(false) }
  }
  return <CodeBox value={code} onChange={setCode} onSubmit={() => void verify()} busy={busy} error={error}
    label="The six-digit code from your authenticator app" />
}

function Enrol({ onDone }: { onDone: () => void }) {
  const [factor, setFactor] = useState<{ id: string; qr: string; secret: string } | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        /* A set-up abandoned half-way leaves an unverified factor, and a second one with the same
           name is refused -- so those are cleared first. Verified ones are never touched here. */
        const { data } = await supabase.auth.mfa.listFactors()
        for (const f of data?.all ?? []) {
          if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id })
        }
        const { data: made, error: e } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Raptor' })
        if (e) throw e
        if (live && made) setFactor({ id: made.id, qr: made.totp.qr_code, secret: made.totp.secret })
      } catch (e) { if (live) setError(friendly(e)) }
    })()
    return () => { live = false }
  }, [])

  async function verify() {
    if (!factor) return
    setBusy(true); setError(null)
    try {
      const { error: e } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code })
      if (e) throw e
      onDone()
    } catch (e) { setError(friendly(e)); setCode('') } finally { setBusy(false) }
  }

  return (
    <div>
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-slate-600">
        <li>Open an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password&hellip;).</li>
        <li>Add an account and scan this code.</li>
        <li>Type the six digits it shows.</li>
      </ol>
      <div className="mb-3 grid place-items-center rounded-xl border border-slate-200 bg-white p-3" data-testid="two-step-qr">
        {factor ? <img src={factor.qr} alt="QR code for your authenticator app" className="h-44 w-44" />
          : !error && <Loader2 size={20} className="animate-spin text-slate-400" />}
      </div>
      {factor && (
        <p className="mb-3 text-center text-[11px] text-slate-400">
          Can&rsquo;t scan? Type this key instead: <span className="select-all font-mono text-slate-600">{factor.secret}</span>
        </p>
      )}
      <CodeBox value={code} onChange={setCode} onSubmit={() => void verify()} busy={busy || !factor} error={error}
        label="The six-digit code" />
    </div>
  )
}

function friendly(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (/invalid.*code|totp code|verification/i.test(m)) return 'That code did not match. Codes change every 30 seconds; try the current one.'
  return m
}
