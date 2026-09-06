import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff, Lock, Mail } from 'lucide-react'
import { useAuth } from '../../store/AuthContext'
import { supabase } from '../../lib/supabase'

// Kept out of the component so the long gradient strings don't drown the markup.
const EDGE_FADE =
  'linear-gradient(to right, #000 0%, #000 48%, rgba(0,0,0,0.97) 58%, rgba(0,0,0,0.88) 66%, rgba(0,0,0,0.71) 74%, rgba(0,0,0,0.48) 81%, rgba(0,0,0,0.27) 87%, rgba(0,0,0,0.12) 92%, rgba(0,0,0,0.04) 96%, rgba(0,0,0,0) 100%)'
const CORNER_SHADE =
  'linear-gradient(to bottom right, rgba(4,12,20,0.78) 0%, rgba(4,12,20,0.56) 24%, rgba(4,12,20,0.28) 44%, rgba(4,12,20,0.08) 64%, rgba(4,12,20,0) 80%)'

export function LoginPage() {
  const { session, loading, signIn } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [resetting, setResetting] = useState(false)

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
    else setResetSent(true)
  }

  const fieldClass =
    'w-full text-sm rounded-lg border border-slate-200 bg-white pl-10 pr-3 py-2.5 text-slate-700 placeholder:text-slate-400 outline-none focus:border-[#c9a052] focus:ring-2 focus:ring-[#c9a052]/25'

  return (
    <div className="h-dvh w-full flex bg-[#f7f8fa]">
      {/*
        The photograph is decorative and heavy, so it's hidden below large screens rather than
        stacked above the form — a login is one thing, and on a phone that thing is the fields.
      */}
      <div className="relative hidden lg:block lg:w-[42%] shrink-0" aria-hidden="true">
        {/*
          The photograph dissolves rather than stopping. Painting a light gradient on top of a
          full-width image only ever produces a washed band with the image's own edge still
          visible behind it — the edge has to actually stop existing, so the alpha mask fades
          the photo itself out and the page's own background is what's left. The colour ramp
          rides along with it so the luminance arrives at the same place the opacity does.
        */}
        <div
          className="absolute inset-y-0 left-0 w-[128%]"
          style={{ WebkitMaskImage: EDGE_FADE, maskImage: EDGE_FADE }}
        >
          <div
            className="absolute inset-0 bg-[#0b1620] bg-cover"
            style={{ backgroundImage: "url('/brand/raptor-login.jpg')", backgroundPosition: '32% center' }}
          />
          {/* Weighted to the top-left corner, where the words sit. */}
          <div className="absolute inset-0" style={{ background: CORNER_SHADE }} />
          <div className="absolute inset-0 bg-[#040c14]/18" />
        </div>

        <p className="relative z-[1] pt-24 pl-14 text-[13px] font-semibold uppercase leading-[2.2] tracking-[0.32em] text-[#d8b56f]">
          Discipline
          <br />
          Creates
          <br />
          Freedom
        </p>
        <span className="relative z-[1] block ml-14 mt-4 h-px w-14 bg-[#d8b56f]/70" />
      </div>

      {/* Sits above the photo's tail, which runs on past the column edge behind it. */}
      <div className="relative z-10 flex-1 flex items-center justify-center px-6 py-10 overflow-y-auto">
        <div className="w-full max-w-[420px]">
          <div className="flex flex-col items-center text-center">
            {/* The real lockup, not the mark with the wordmark re-set beside it — the spacing
                between the wing and the letterforms is part of the mark. */}
            {/* Nudged left of true centre on purpose: the wing is light gold and the wordmark is
                dark and heavy, so measured centring reads as sitting right of centre. The eye
                balances mass, not boxes. */}
            <img
              src="/brand/raptor-lockup-navy.png"
              alt="Raptor by Bredell Ferreira"
              className="w-[290px] max-w-full h-auto mt-1 -translate-x-[8px]"
            />

            <h1 className="mt-9 text-[13px] font-semibold uppercase tracking-[0.22em] text-[#12233a] pl-[0.22em]">Sign in to Raptor</h1>
            <p className="mt-2 text-sm text-slate-400">Recover. Rise. Take flight.</p>
          </div>

          <div className="mt-7 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03),0_12px_30px_rgba(15,23,42,0.06)]">
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
                  className={fieldClass}
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
                  className={`${fieldClass} pr-11`}
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
              {resetSent && <p className="text-sm text-[var(--c-green)] mb-3.5">If that email has an account, a password reset link has been sent.</p>}

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
                disabled={resetting}
                className="w-full text-[13px] text-slate-500 underline underline-offset-4 hover:text-[#12233a] mt-4 disabled:opacity-50"
              >
                {resetting ? 'Sending…' : 'Forgot password?'}
              </button>
            </form>
          </div>

          <div className="mt-7 flex items-center gap-4">
            <span className="h-px flex-1 bg-slate-200" />
            <p className="text-[13px] font-medium text-slate-600 whitespace-nowrap">Don't have an account?</p>
            <span className="h-px flex-1 bg-slate-200" />
          </div>
          <p className="mt-2 text-center text-[13px] text-slate-400">Ask your administrator to invite you.</p>

          <div className="mt-12 flex flex-col items-center">
            <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-slate-400 pl-[0.28em]">Bredell Ferreira</p>
            <span className="mt-2.5 h-px w-10 bg-[#d8b56f]" />
            <p className="mt-3 text-[10px] font-medium uppercase tracking-[0.22em] text-slate-400 pl-[0.22em]">People &nbsp;|&nbsp; Process &nbsp;|&nbsp; Performance</p>
          </div>
        </div>
      </div>
    </div>
  )
}
