import { useState, type FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff, Lock } from 'lucide-react'
import { useAuth } from '../../store/AuthContext'
import { AuthShell, authFieldClass } from './AuthShell'

/**
 * Shown instead of the app whenever the current session came from an invite or password-reset
 * email link (see AuthContext.passwordSetupRequired) — those links sign the person in directly,
 * but they still need to pick a real password before signInWithPassword will ever work for them
 * again.
 *
 * For most people this is the FIRST screen of Raptor they ever see: an invited colleague meets it
 * before the sign-in page. It shares its frame with sign-in for that reason.
 */
export function SetPasswordPage() {
  const { completePasswordSetup } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setSubmitting(true)
    const { error: submitError } = await completePasswordSetup(password)
    setSubmitting(false)
    if (submitError) setError(submitError)
  }

  return (
    <AuthShell title="Set your password" subtitle="Choose a password to finish setting up your Raptor login.">
      <form onSubmit={handleSubmit}>
        <label className="block text-[13px] font-medium text-slate-600 mb-1.5" htmlFor="new-password">
          New Password <span className="text-[var(--c-rust)]">*</span>
        </label>
        <div className="relative mb-4">
          <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            id="new-password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            className={`${authFieldClass} pr-11`}
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
          />
          {/*
            One toggle for both fields, not two. They are meant to hold the same thing, so
            revealing one and not the other only makes them harder to compare — which is the
            single job the second field has.
          */}
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        <label className="block text-[13px] font-medium text-slate-600 mb-1.5" htmlFor="confirm-password">
          Confirm Password <span className="text-[var(--c-rust)]">*</span>
        </label>
        <div className="relative mb-5">
          <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            id="confirm-password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            className={authFieldClass}
            placeholder="Type it again"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>

        {error && <p className="text-sm text-[var(--c-rust-deep)] mb-3.5">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full inline-flex items-center justify-center gap-2 text-sm font-semibold px-4 py-3 rounded-xl bg-[#142433] text-white hover:bg-[#1c3149] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? 'Saving…' : 'Set Password & Continue'}
          {!submitting && <ArrowRight size={15} />}
        </button>
      </form>
    </AuthShell>
  )
}
