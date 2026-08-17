import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Card } from '../../components/ui/Card'
import { FormField, inputClass } from '../../components/ui/Modal'
import { useAuth } from '../../store/AuthContext'

export function LoginPage() {
  const { session, loading, signIn } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

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

  return (
    <div className="flex h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <div className="w-11 h-11 rounded-full border border-gold-500 flex items-center justify-center bg-navy-950 mb-3">
            <span className="text-white font-semibold text-sm tracking-tighter">BF</span>
          </div>
          <h1 className="font-semibold text-lg text-navy-950">Bredell Ferreira</h1>
          <p className="text-sm text-slate-400 mt-0.5">Sign in to Sales Raptor</p>
        </div>

        <Card>
          <form onSubmit={handleSubmit}>
            <FormField label="Email" required>
              <input
                type="email"
                autoComplete="email"
                className={inputClass}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </FormField>
            <FormField label="Password" required>
              <input
                type="password"
                autoComplete="current-password"
                className={inputClass}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </FormField>
            {error && <p className="text-sm text-[#794234] mb-3.5">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full text-sm font-medium px-3.5 py-2.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </Card>

        <p className="text-center text-xs text-slate-400 mt-5">Don't have an account? Ask your administrator to invite you.</p>
      </div>
    </div>
  )
}
