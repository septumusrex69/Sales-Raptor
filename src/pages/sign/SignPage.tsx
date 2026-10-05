import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Check, Loader2, ShieldCheck } from 'lucide-react'
import { SignaturePad } from '../../components/ui/SignaturePad'
import {
  isOpen, openSigningRequest, signDocument, SIGNING_CLOSED, type SigningRequest,
} from '../../lib/signing.ts'
import {
  A4_LETTERHEAD, blankLetter, letterCss, letterToHtml,
} from '../../lib/letterDocument.ts'
import { amountOf, missingBlanks, withFilled } from '../../lib/signingBlanks.ts'
import type { SignedMark } from '../../lib/signedMark.ts'
import { formatMoney } from '../../data/mockData'

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
  /**
   * WHAT THE SIGNER TYPES INTO THE DOCUMENT'S OWN BLANKS.
   *
   * THE FIRM: "there's a scenario where no PTP exists... you put a small line where the person can
   * fill in whatever it is that they need to fill in, based on an arrangement that they would like
   * to make."
   */
  const [filled, setFilled] = useState<Record<string, string>>({})
  const set = (key: string, value: string) => setFilled((f) => ({ ...f, [key]: value }))
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

  /*
   * THE FIRM'S PAPER, ONCE, AT THE TOP OF THE SHEET.
   *
   * THREE ROUNDS OF THE FIRM LOOKING AT THIS, and it has landed back in the middle. First: "it's
   * not on a letterhead, the letters are all over the place, it's just not nice" -- the page drew
   * the blocks with no sheet at all, so a document written for 210mm ran the full width of a
   * browser. Then, with the letterhead on: "I'm not sure if it's necessary to show the entire
   * letterhead and the division of the pages to the person when they are signing online." So it
   * came off entirely. Now: "maybe it doesn't have to be on the letterhead when you don't have to
   * see the letterhead everywhere. It can just be on the top of that little thing that you've
   * created."
   *
   * WHICH IS WHAT letterCss ALREADY DRAWS. Its `.ltr-page` background is `no-repeat`, positioned
   * top left -- so on this page, which is ONE continuous unpaginated sheet, the letterhead prints
   * once at the head of the document and the rest is plain. The thing the firm objected to the
   * second time was the letterhead REPEATING across the middle of item 3, and that was the
   * editor's own repeating sheet, not this one.
   *
   * THE PAGE DIVISIONS STILL DO NOT SHOW. planPageBreaks is measured against the editor's sheet
   * and never ran here; this stays one scroll to read and sign. Where the pagination is real is
   * the PDF, which is on the full letterhead, every page -- see signedCopy.ts.
   */
  const page = request?.pageSetup ?? A4_LETTERHEAD

  /*
   * Drawn once per document rather than on every stroke of the signature pad -- the sheet is the
   * expensive part of this page and nothing about signing changes it.
   *
   * THE SIGNER'S OWN ANSWERS ARE MERGED IN AS THEY TYPE, so what they are about to sign is what
   * they are reading. `filled` is a dependency for that reason: the document is the preview.
   */
  /*
   * THE MARK, ONCE THERE IS ONE, so the document draws itself signed.
   *
   * THE FIRM, looking at the first one somebody signed: "the signature just like randomly hangs
   * down there. It's not put in the right place. It should be put in the block." This page used to
   * draw the agreement with empty rules and then put the PNG in a card underneath it -- a document
   * and a photograph of a squiggle, which is not a signed document. See signedMark.ts.
   */
  const mark: SignedMark | null = request?.signaturePng && request.signedName && request.signedAt
    ? {
      signaturePng: request.signaturePng,
      name: request.signedName,
      signedAt: request.signedAt,
      /* Drawn on the PDF's every page, not here: this sheet is one continuous document with no
         page boundaries to put them at. See LetterPlan.signedInitials. */
      initialsPng: request.initialsPng,
    }
    : null

  const html = useMemo(() => {
    if (!request) return ''
    const doc = { ...blankLetter(), blocks: request.body }
    return letterToHtml(doc, {
      filled: true,
      values: withFilled({}, request.blanks, filled),
      signed: mark,
    })
  }, [request, filled, mark])

  async function submit() {
    setProblem(null)
    /*
     * THE BLANKS FIRST, because they are the document and the signature is the assent to it. Named
     * rather than counted: "fill in 2 more" is a sentence somebody reads twice and still has to
     * hunt for. The database checks these again -- this page is reachable by anybody holding the
     * link -- but being told here is how a person fixes it.
     */
    const short = request ? missingBlanks(request.blanks, filled) : []
    if (short.length > 0) {
      setProblem(`Fill in: ${short.map((b) => b.label.toLowerCase()).join(', ')}.`)
      return
    }
    if (!signature) { setProblem('Sign in the box before submitting.'); return }
    if (!name.trim()) { setProblem('Type your full name before submitting.'); return }
    if (!agreed) { setProblem('Tick the box to confirm you intend to sign.'); return }
    setBusy(true)
    try {
      const done = await signDocument({
        token, signaturePng: signature, initialsPng: initials, name, filled,
      })
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

      {/*
        ON THE FIRM'S PAPER, AT 1:1. The same `.ltr-page` wrapper and the same letterCss the editor
        and the library preview use -- one renderer, so a debtor reading a notice and a collector
        writing one are looking at the same document.

        THE LETTERHEAD PRINTS ONCE, AT THE HEAD OF IT, which is the firm's third and current
        instruction and is what letterCss's own `no-repeat` already does on one continuous sheet.
        See the note on `page` above for how it got here and back.

        Scrolls in its own box so the signing controls below are reachable without reading to the
        end first: a signer who has to scroll four pages to find the button concludes there is not
        one. The grey behind it is a desk, so the paper reads as paper.
      */}
      <div className="rounded-xl bg-slate-200/70 overflow-auto max-h-[65vh] p-4 mb-5">
        <div className="mx-auto shadow-lg relative" style={{ width: `${page.widthMm}mm` }}>
          <style>{letterCss({ ...blankLetter(), blocks: request.body }, page)}</style>
          {/*
            ONE CONTINUOUS SHEET. `minHeight: 0` undoes letterCss's own page height, which would
            otherwise pad a short document out to a full A4 and leave the signing controls below
            the fold on a one-paragraph mandate.
          */}
          <div className="ltr-page" style={{ minHeight: 0 }}>
            <div className="ltr-body" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </div>
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
          {/* THE MARK IS NOT REPEATED HERE. It is on the rules it was made on, in the document
              above -- see the note on `mark`. A second copy of it in a card would be the firm's
              "it just randomly hangs down there" put back under a different heading. */}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
          {/*
            WHAT RAPTOR COULD NOT ANSWER, ASKED OF THE PERSON WHO CAN.
            
            THE FIRM: "if there's any missing documentation, make provisions for that being filled
            in by the individual completing the document." Their own acknowledgement of debt went
            out reading "Registration number: . Domicilium: {{debtor_address}}" -- a field with
            nothing behind it, on a document somebody was being asked to sign.
            
            ABOVE THE SIGNATURE, DELIBERATELY. These change the document; the signature is assent
            to what the document then says. Typing into one of these redraws the sheet above, so
            what is being signed is what is being read.
          */}
          {request.blanks.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-slate-800">Please fill these in</p>
              {request.blanks.map((b) => (
                <label key={b.key} className="block">
                  <span className="block text-xs text-slate-500 mb-1">
                    {b.label}
                    {!b.required && <span className="text-slate-400"> — optional</span>}
                  </span>
                  {b.kind === 'lines' ? (
                    <textarea rows={3} value={filled[b.key] ?? ''}
                      onChange={(e) => set(b.key, e.target.value)}
                      className="w-full text-sm rounded-lg border border-slate-200 px-2 py-1.5" />
                  ) : b.kind === 'choice' ? (
                    /*
                      A CHOICE RATHER THAN A SENTENCE. THE FIRM: "rather give the option, for
                      example, monthly, weekly, or bi-weekly, or other, and then you can type in
                      other." A typed frequency is forty spellings of four things, and the one that
                      reaches an arrangement decides when the firm expects to be paid.
                    */
                    <div className="flex flex-wrap gap-1.5">
                      {(b.options ?? []).map((option) => {
                        const chosen = (filled[b.key] ?? '').trim() === option
                          || (option === 'Other' && !!(filled[b.key] ?? '').trim()
                              && !(b.options ?? []).includes((filled[b.key] ?? '').trim()))
                        return (
                          <button key={option} type="button"
                            onClick={() => set(b.key, option === 'Other' ? '' : option)}
                            className={`px-3 py-1.5 rounded-lg border text-sm ${chosen
                              ? 'border-[#c9a052] bg-gold-50 text-slate-900'
                              : 'border-slate-200 text-slate-600'}`}>
                            {option}
                          </button>
                        )
                      })}
                      {/* "OTHER" IS A BOX, not a dead end: picking it has to leave somewhere to say
                          what it is, or the choice is three options and a refusal. */}
                      {!(b.options ?? []).includes((filled[b.key] ?? '').trim()) && (
                        <input value={filled[b.key] ?? ''} aria-label={`${b.label} — other`}
                          placeholder="Say how often"
                          onChange={(e) => set(b.key, e.target.value)}
                          className="flex-1 min-w-[10rem] text-sm rounded-lg border border-slate-200 px-2 py-1.5" />
                      )}
                    </div>
                  ) : b.kind === 'amount' ? (
                    /*
                      THE R IS DRAWN, NOT TYPED. THE FIRM: "there is an R -- some people can put R
                      for rand and others could not. That might influence the way that the payment
                      is captured." So the box takes digits and the rand sign is part of the form;
                      amountOf still reads a pasted "R 1 500,00" because somebody will paste one.
                    */
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-500">R</span>
                      <input type="text" inputMode="decimal" value={filled[b.key] ?? ''}
                        placeholder="0,00"
                        onChange={(e) => set(b.key, e.target.value)}
                        className="flex-1 text-sm rounded-lg border border-slate-200 px-2 py-1.5" />
                      {/* SAID BACK AS A FIGURE, so a debtor sees what the firm will read. A typo is
                          obvious here and invisible in the raw string. */}
                      {amountOf(filled[b.key] ?? '') !== null && (
                        <span className="text-xs text-slate-500 tabular-nums">
                          = {formatMoney(amountOf(filled[b.key] ?? '') ?? 0)}
                        </span>
                      )}
                    </div>
                  ) : (
                    /*
                      A DATE PICKER FOR A DATE, on an iPad and on a telephone alike -- the first
                      payment date is the field a debtor is most likely to write as "next Friday",
                      which is not something the firm can diarise.
                    */
                    <input type={b.kind === 'date' ? 'date' : 'text'} value={filled[b.key] ?? ''}
                      onChange={(e) => set(b.key, e.target.value)}
                      className="w-full text-sm rounded-lg border border-slate-200 px-2 py-1.5" />
                  )}
                </label>
              ))}
            </div>
          )}
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
