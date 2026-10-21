import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { unsubscribeStep, type UnsubscribeState } from '../../lib/marketingApi'

/**
 * THE PAGE AN UNSUBSCRIBE LINK OPENS -- outside the firm, like /sign/:token (S10).
 *
 * The person who clicked has no Raptor login and never will. Opening the page IS the unsubscribe:
 * POPIA s69 wants stopping to be as easy as the email was to receive, and a page that asks "are you
 * sure?" before it does anything is a second hurdle. The token in the path is the whole of the
 * authority and it names one address. A mistaken click is put right with one press -- the
 * re-subscribe button -- which is recorded as theirs.
 *
 * /unsubscribe/preview is the editor's sample link: drawn, never acted on.
 */
export default function UnsubscribePage() {
  const { token = '' } = useParams()
  const [state, setState] = useState<UnsubscribeState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current || token === 'preview') return
    ran.current = true
    unsubscribeStep(token, 'unsubscribe').then(setState).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [token])

  async function resubscribe() {
    setBusy(true)
    try { setState(await unsubscribeStep(token, 'resubscribe')) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const subscribed = state?.status === 'subscribed'
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center" data-testid="unsubscribe-page"
        style={{ fontFamily: 'Charter, "Bitstream Charter", Georgia, "Times New Roman", serif' }}>
        <img src="/favicon.svg" alt="" className="w-10 h-10 mx-auto mb-4" />
        <p className="text-xs uppercase tracking-wider text-slate-400 mb-4">Bredell Ferreira</p>
        {token === 'preview' ? (
          <p className="text-slate-700">This is where the unsubscribe link in the newsletter leads.</p>
        ) : error ? (
          <p className="text-red-700" data-testid="unsubscribe-error">{error}</p>
        ) : !state ? (
          <p className="text-slate-500">One moment…</p>
        ) : subscribed ? (
          <>
            <h1 className="text-xl text-slate-900 mb-2" data-testid="unsubscribe-heading">You will receive our news again</h1>
            <p className="text-sm text-slate-600">{state.email} is back on our news list. Every email has a link to stop it again.</p>
          </>
        ) : (
          <>
            <h1 className="text-xl text-slate-900 mb-2" data-testid="unsubscribe-heading">You will not receive our news any more</h1>
            <p className="text-sm text-slate-600 mb-1">{state.email} has been taken off our news list.</p>
            <p className="text-sm text-slate-500 mb-6">Statements and reports about your own matters are not affected.</p>
            <button type="button" onClick={() => void resubscribe()} disabled={busy} data-testid="unsubscribe-resubscribe"
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              {busy ? 'One moment…' : 'That was a mistake — keep sending me news'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
