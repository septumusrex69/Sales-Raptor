import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff, Lock, Mail } from 'lucide-react'
import { useAuth } from '../../store/AuthContext'
import { supabase } from '../../lib/supabase'
import { AuthShell, authFieldClass } from './AuthShell'

/**
 * WHY AN EMAILED LINK FAILED, SAID ON THE PAGE IT LANDS ON (23 Oct).
 *
 * Nicole pressed "Forgot password?" three times in three minutes and every link she opened was
 * refused ("One-time token not found" in the auth log, while the newest token sat unused). Each
 * press CANCELS the link before it, and the mail takes a minute to arrive, so she was always opening
 * the one before last. Supabase sends a refused link back here with the reason in the hash; the
 * page said nothing and showed an empty sign-in form, which reads as "reset doesn't work".
 * Read once at module load, before the client library strips the hash.
 */
const linkError = (() => {
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  if (!h.get('error') && !h.get('error_code')) return null
  return h.get('error_code') === 'otp_expired' || /expired|invalid/i.test(h.get('error_description') ?? '')
    ? 'That link has expired or was replaced by a newer one. Ask for a new link below, then open only the newest email.'
    : `That link didn’t work (${h.get('error_description') ?? h.get('error')}). Ask for a new link below.`
})()

/** How long "Forgot password?" waits before it may be pressed again: a second press cancels the first link. */
const RESEND_WAIT_SECONDS = 60

export function LoginPage() {
  const { session, loading, signIn } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(linkError)
  const [submitting, setSubmitting] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [wait, setWait] = useState(0)
  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  if (!loading && session) {
    const from = (location.state as { from?: Location })?.from
    return <Navigate to={from?.pathname ?? '/'} replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error: signInError } = await signIn(email, password)
    setSubmitting(false)
    if (signInError) setError(signInError)
  }

  async function handleForgotPassword() {
    if (!email) {
      setError('Enter your email above first, then click "Forgot password?".')
      return
    }
    setError(null)
    setResetting(true)
    const { error: sendError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/login` })
    setResetting(false)
    if (sendError) setError(sendError.message)
    else { setResetSent(true); setWait(RESEND_WAIT_SECONDS) }
  }

  return (
    <AuthShell
      title="Sign in to Raptor"
      subtitle="Turn the tide. Take flight."
      footer={
        <>
          <div className="mt-7 flex items-center gap-4">
            <span className="h-px flex-1 bg-slate-200" />
            <p className="text-[13px] font-medium text-slate-600 whitespace-nowrap login-on-photo-strong">Don't have an account?</p>
            <span className="h-px flex-1 bg-slate-200" />
          </div>
          <p className="mt-2 text-center text-[13px] text-slate-400 login-on-photo">Ask your administrator to invite you.</p>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        <label className="block text-[13px] font-medium text-slate-600 mb-1.5" htmlFor="login-email">
          Email <span className="text-[var(--c-rust)]">*</span>
        </label>
        <div className="relative mb-4">
          <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            className={authFieldClass}
            placeholder="Enter your email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </div>

        <label className="block text-[13px] font-medium text-slate-600 mb-1.5" htmlFor="login-password">
          Password <span className="text-[var(--c-rust)]">*</span>
        </label>
        <div className="relative mb-5">
          <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            id="login-password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            className={`${authFieldClass} pr-11`}
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        {error && <p className="text-sm text-[var(--c-rust-deep)] mb-3.5">{error}</p>}
        {resetSent && <p className="text-sm text-[var(--c-green)] mb-3.5" data-testid="reset-sent">
          If that email has an account, a reset link is on its way &mdash; it can take a minute or two. Open only the
          newest one: asking again cancels the link before it.
        </p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full inline-flex items-center justify-center gap-2 text-sm font-semibold px-4 py-3 rounded-xl bg-[#142433] text-white hover:bg-[#1c3149] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? 'Signing in…' : 'Sign In'}
          {!submitting && <ArrowRight size={15} />}
        </button>

        <button
          type="button"
          onClick={handleForgotPassword}
          disabled={resetting || wait > 0}
          className="w-full text-[13px] text-slate-500 underline underline-offset-4 hover:text-[#12233a] mt-4 disabled:opacity-50"
        >
          {resetting ? 'Sending…' : wait > 0 ? `Send another link in ${wait}s` : 'Forgot password?'}
        </button>
      </form>
    </AuthShell>
  )
}
