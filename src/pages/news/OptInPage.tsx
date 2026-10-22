import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { optInStep, type OptInState } from '../../lib/marketingApi'

/**
 * THE PAGE "YES, KEEP ME INFORMED" OPENS -- outside the firm, like /unsubscribe/:token (S10, 22 Oct).
 *
 * The firm: "everyone gets one introduction email to opt in, 'Yes, keep me informed' button", and
 * after it a small page: thank you, you'll hear from us. The person has no Raptor login and never
 * will; the signed token in the path names the one send that asked, and opening the page records the
 * yes against that lead. The button in the email was the question, so the page does not ask it twice.
 *
 * "That wasn't me" undoes it and unsubscribes the address -- recorded as an objection, because a yes
 * somebody did not give must leave the address further from our news, not back where it was.
 *
 * /opt-in/preview is the editor's and the test email's sample: drawn, never acted on.
 */
export default function OptInPage() {
  const { token = '' } = useParams()
  const [state, setState] = useState<OptInState | null>(null)
  const [withdrawn, setWithdrawn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current || token === 'preview') return
    ran.current = true
    optInStep(token, 'yes').then(setState).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [token])

  async function withdraw() {
    setBusy(true)
    try { setState(await optInStep(token, 'withdraw')); setWithdrawn(true) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center" data-testid="opt-in-page"
        style={{ fontFamily: 'Charter, "Bitstream Charter", Georgia, "Times New Roman", serif' }}>
        <img src="/favicon.svg" alt="" className="w-10 h-10 mx-auto mb-4" />
        <p className="text-xs uppercase tracking-wider text-slate-400 mb-4">Bredell Ferreira</p>
        {token === 'preview' ? (
          <>
            <h1 className="text-xl text-slate-900 mb-2">Thank you — you’ll hear from us</h1>
            <p className="text-sm text-slate-600">This is the page the “Yes, keep me informed” button opens. Nothing has been recorded.</p>
          </>
        ) : error ? (
          <p className="text-red-700" data-testid="opt-in-error">{error}</p>
        ) : !state ? (
          <p className="text-slate-500">One moment…</p>
        ) : withdrawn ? (
          <>
            <h1 className="text-xl text-slate-900 mb-2" data-testid="opt-in-heading">You will not hear from us</h1>
            <p className="text-sm text-slate-600">{state.email} has been taken off our news, and we will not write to it again.</p>
          </>
        ) : (
          <>
            <h1 className="text-xl text-slate-900 mb-2" data-testid="opt-in-heading">Thank you — you’ll hear from us</h1>
            <p className="text-sm text-slate-600 mb-1">We will send our news to {state.email}.</p>
            <p className="text-sm text-slate-500 mb-6">Every email has a link to stop it whenever you like.</p>
            <button type="button" onClick={() => void withdraw()} disabled={busy} data-testid="opt-in-withdraw"
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              {busy ? 'One moment…' : 'That wasn’t me — don’t send me anything'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
