import { useState, type FormEvent } from 'react'
import { Card } from '../../components/ui/Card'
import { FormField, inputClass } from '../../components/ui/Modal'
import { useAuth } from '../../store/AuthContext'

/**
 * Shown instead of the app whenever the current session came from an
 * invite or password-reset email link (see AuthContext.passwordSetupRequired)
 * — those links sign the person in directly, but they still need to pick a
 * real password before signInWithPassword will ever work for them again.
 */
export function SetPasswordPage() {
  const { completePasswordSetup } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
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
    <div className="flex h-dvh items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <img src="/brand/wordmark-dark.svg" alt="Bredell Ferreira" className="h-6 w-auto mb-3" />
          <h1 className="font-semibold text-lg text-navy-950">Set your password</h1>
          <p className="text-sm text-slate-400 mt-0.5 text-center">Choose a password to finish setting up your Romulus login.</p>
        </div>

        <Card>
          <form onSubmit={handleSubmit}>
            <FormField label="New Password" required>
              <input
                type="password"
                autoComplete="new-password"
                className={inputClass}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
              />
            </FormField>
            <FormField label="Confirm Password" required>
              <input
                type="password"
                autoComplete="new-password"
                className={inputClass}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </FormField>
            {error && <p className="text-sm text-[#794234] mb-3.5">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full text-sm font-medium px-3.5 py-2.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Saving…' : 'Set Password & Continue'}
            </button>
          </form>
        </Card>
      </div>
    </div>
  )
}
