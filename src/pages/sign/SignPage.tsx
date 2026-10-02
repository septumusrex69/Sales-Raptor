import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Check, Loader2, ShieldCheck } from 'lucide-react'
import { SignaturePad } from '../../components/ui/SignaturePad'
import {
  isOpen, openSigningRequest, signDocument, SIGNING_CLOSED, type SigningRequest,
} from '../../lib/signing.ts'
import { blankLetter, letterToHtml } from '../../lib/letterDocument.ts'

/**
 * THE PAGE A DEBTOR OPENS FROM A LINK, SIGNS, AND NEVER SEES AGAIN.
 *
 * THE FIRM: "forget about the OTP for now. Just anyone with a link can open it, for testing."
 *
 * OUTSIDE EVERY SHELL THE REST OF RAPTOR LIVES IN -- no sidebar, no auth guard, no title slot, no
 * AppStore. It is mounted above RequireAuth in App.tsx for that reason and it is the only route
 * that is. A debtor has no login, and a page that flashed the firm's navigation at them before
 * redirecting would be showing an outsider the shape of the firm's system.
 *
 * IT DRAWS THE DOCUMENT WITH THE SAME RENDERER AS EVERYTHING ELSE. letterToHtml, filled, on the
 * same A4 sheet -- because what somebody signs has to be what the firm sent, and a second renderer
 * written "just for the signing page" is a second thing that can disagree with the notice. The
 * blocks came out of the database already frozen at send time, so nothing is merged here: the
 * values were resolved when the link was made.
 */
export default function SignPage() {
  const { token = '' } = useParams()
  const [request, setRequest] = useState<SigningRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [signature, setSignature] = useState<string | null>(null)
  const [initials, setInitials] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await openSigningRequest(token)
      setRequest(r)
      setMissing(r === null)
      if (r?.signerName && !name) setName(r.signerName)
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
    // `name` is deliberately not a dependency: re-running on every keystroke would reload the
    // document under somebody who is halfway through typing their own name into it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => { void load() }, [load])

  /* Drawn once per document rather than on every stroke of the signature pad -- the sheet is the
     expensive part of this page and nothing about signing changes it. */
  const html = useMemo(() => {
    if (!request) return ''
    return letterToHtml({ ...blankLetter(), blocks: request.body }, { filled: true, values: {} })
  }, [request])

  async function submit() {
    setProblem(null)
    if (!signature) { setProblem('Sign in the box before submitting.'); return }
    if (!name.trim()) { setProblem('Type your full name before submitting.'); return }
    if (!agreed) { setProblem('Tick the box to confirm you intend to sign.'); return }
    setBusy(true)
    try {
      const done = await signDocument({ token, signaturePng: signature, initialsPng: initials, name })
      /*
       * FALSE IS NOT AN ERROR. The link was already used -- a second tab, a double tap, a colleague
       * who signed first. Reloading shows the signed copy, which is the honest answer and the one
       * that stops somebody telephoning the firm about it.
       */
      if (!done) setProblem('This link has already been used. Reloading what was signed…')
      await load()
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <Shell>
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={15} className="animate-spin" /> Opening the document…
        </p>
      </Shell>
    )
  }

  /*
   * A LINK THAT FINDS NOTHING SAYS SO WITHOUT SAYING WHY.
   *
   * "No document here" and not "no such token": this page is reachable by anybody, so the one
   * thing it must never do is confirm which tokens exist. That is the same reason a login says
   * "wrong email or password" rather than which of the two.
   */
  if (missing || !request) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-slate-800">No document here</h1>
        <p className="text-sm text-slate-500 mt-2">
          This link is not one we can open. Check that it was copied whole &mdash; they are long,
          and mail programs sometimes cut them &mdash; or ask Bredell Ferreira to send it again.
        </p>
      </Shell>
    )
  }

  const closed = !isOpen(request.state)

  return (
    <Shell wide>
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-slate-800">{request.title}</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Bredell Ferreira{request.signerName ? ` · for ${request.signerName}` : ''}
        </p>
      </div>

      {/* THE DOCUMENT, on the firm's own sheet. Scrolls in its own box so the signing controls
          below it are reachable without reading to the end first -- a signer who has to scroll
          four pages to find the button concludes there is not one. */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-auto max-h-[65vh] p-4 mb-5">
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>

      {closed ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="flex items-start gap-2 text-sm text-slate-700">
            <Check size={16} className="mt-0.5 shrink-0 text-[var(--c-green)]" />
            <span>
              {SIGNING_CLOSED[request.state as Exclude<typeof request.state, 'sent'>]}
              {request.signedName && request.signedAt && (
                <span className="block text-xs text-slate-500 mt-1">
                  Signed by {request.signedName} on{' '}
                  {new Date(request.signedAt).toLocaleDateString('en-ZA')}.
                </span>
              )}
            </span>
          </p>
          {request.signaturePng && (
            <img src={request.signaturePng} alt="The signature" className="mt-3 h-20" />
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
          <SignaturePad label="Your signature" onChange={setSignature} />
          {/*
            INITIALS ARE THEIR OWN MARK, at the firm's request: "make space for where there can be
            signatures like at the bottom of the pages for initials and stuff". A page initial is
            not a small signature -- it is what somebody puts on every page to say they read that
            page -- so it is captured separately and drawn on each page rather than scaled down.
          */}
          <SignaturePad label="Your initials — these go at the foot of every page" height={110}
            onChange={setInitials} />

          <label className="block">
            <span className="text-xs font-medium text-slate-600">Your full name</span>
            <input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="As it appears on your ID"
              className="mt-1 w-full text-sm rounded-lg border border-slate-200 px-3 py-2" />
            {/*
              THE DRAWING IS THE MARK AND THE NAME IS THE IDENTIFICATION. ECTA s13 wants a method
              that identifies the person AND indicates their approval; a squiggle alone identifies
              nobody, which is why both are asked for and both are required.
            */}
            <span className="block text-[11px] text-slate-400 mt-1">
              Typed, so the document says who signed it as well as carrying the mark.
            </span>
          </label>

          <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer select-none">
            <input type="checkbox" className="mt-1 shrink-0" checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)} />
            <span>
              I have read this document and I intend my signature above to be my signature on it.
            </span>
          </label>

          {problem && <p className="text-sm text-negative-700">{problem}</p>}

          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void submit()} disabled={busy}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg
                bg-navy-900 text-white disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
              {busy ? 'Submitting…' : 'Sign this document'}
            </button>
            <span className="text-[11px] text-slate-400">It can only be signed once.</span>
          </div>
        </div>
      )}
    </Shell>
  )
}

/** The page's own frame. Nothing from the app's shell: a signer is not a user. See the header. */
function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className={`mx-auto ${wide ? 'max-w-3xl' : 'max-w-lg'}`}>{children}</div>
    </div>
  )
}
