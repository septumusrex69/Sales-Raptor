import { useEffect, useMemo, useState } from 'react'
import { FileText, Loader2, MessageCircle } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { FileActions } from '../../components/ui/FileActions'
import { downloadBlob } from '../../lib/fileSave'
import { RecordAction } from '../../components/record/RecordShell'
import { WhatsAppSentModal } from '../../components/record/WhatsAppButton'
import { fetchLibrary, type LibraryTemplate } from '../../lib/templateLibrary.ts'
import { parseLetter } from '../../lib/letterDocument.ts'
import { letterPdfBytes } from '../../lib/letterAttachment.ts'
import { letterFilename } from '../../lib/letterPdf.ts'
import { renderTemplate } from '../../lib/messageTemplates'
import { whatsAppLink, whatsAppNumber } from '../../lib/whatsapp'
import { letterNameForDebtor, whatsAppLetterTemplate } from '../../lib/whatsappLetters'

/**
 * WHATSAPP FROM A DEBTOR'S ACCOUNT: A MESSAGE, OR A LETTER (S9, 19 Oct). The firm: "it would say,
 * okay, I wanna send a section 129 via WhatsApp. It copies that text that needs to be there, and then
 * it downloads the attachment ... so that you can upload it on WhatsApp."
 *
 * One box: the number (asked only where there is more than one cellphone), then what to send -- a
 * message, or any letter in the library written for this debtor. A letter is drawn as the same PDF
 * the email would attach the moment the letter is chosen, and then ONE PRESS does the rest: the PDF
 * downloads, the letter's short covering line (whatsappLetters.ts) is copied, and WhatsApp opens on
 * the debtor's number with that line typed in. The firm, after a first version that asked for two
 * presses and so sent a final notice with nothing attached: "automatically, you should copy the
 * message and then open the person on WhatsApp ... and it should download the PDF so you can just
 * attach it."
 *
 * ONE PRESS IS POSSIBLE ONLY BECAUSE THE PDF IS ALREADY DRAWN. Safari starts neither a download nor
 * another app from the end of an `await`, so all three happen synchronously inside the tap, on a
 * blob made before it. The download is a plain `download` link in THIS tab -- not the share sheet,
 * which is a modal the WhatsApp link would close, and not a new tab, which Safari would count as a
 * second popup and block -- and the WhatsApp link is the real `<a>` the tap landed on, so the one
 * navigation Safari allows a tap is WhatsApp's. The Save button stays underneath for the device
 * that still does not keep the file.
 *
 * And on the way back, how many messages went -- the same question as a plain WhatsApp, charged the
 * same way by the page (recordWhatsApp), with the letter named on the timeline.
 */
export function AccountWhatsApp({ numbers, opening, values, audience, reference, onSent, className }: {
  numbers: { label: string; value: string }[]
  /** The opening line for a plain message. */
  opening: string
  /** The account's merge values, which fill both the letter and its covering line. */
  values: Record<string, string>
  audience: 'individual' | 'company'
  /** For the PDF's filename. */
  reference: string | null
  /** How many went, said on the way back, and which letter if one did. */
  onSent: (number: string, count: number, about: string | null) => void
  className: string
}) {
  const reachable = useMemo(() => numbers
    .map((n) => ({ ...n, wa: whatsAppNumber(n.value) }))
    .filter((n): n is typeof n & { wa: string } => !!n.wa)
    .filter((n, i, all) => all.findIndex((m) => m.wa === n.wa) === i), [numbers])
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState(0)
  const [letters, setLetters] = useState<LibraryTemplate[] | null>(null)
  /* The letter chosen and, once drawn, the PDF and its covering line. */
  const [chosen, setChosen] = useState<LibraryTemplate | null>(null)
  const [ready, setReady] = useState<{ blob: Blob; filename: string; text: string } | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [asking, setAsking] = useState<{ number: string; about: string | null } | null>(null)

  useEffect(() => {
    if (!open || letters) return
    fetchLibrary('collections')
      .then((rows) => setLetters(rows.filter((r) => r.kind === 'letter' && r.format === 'document' && r.active
        && (r.audience === null || r.audience === audience))))
      .catch(() => setLetters([]))
  }, [open, letters, audience])

  if (reachable.length === 0) {
    return <RecordAction icon={MessageCircle} label="WhatsApp"
      title={numbers.length ? 'None of the numbers on file is a cellphone WhatsApp can reach' : 'No cellphone number on file yet'} />
  }
  const number = reachable[Math.min(to, reachable.length - 1)]

  async function draw(t: LibraryTemplate) {
    setChosen(t); setReady(null); setError(null); setDrawing(true)
    try {
      const doc = parseLetter(t.body)
      if (!doc) throw new Error(`${t.name} could not be read back.`)
      /* THE SAME PDF THE EMAIL WOULD ATTACH, refused the same way where a field cannot be filled. */
      const bytes = await letterPdfBytes({ doc, scope: 'collections', values, filled: true, name: t.name })
      const name = letterNameForDebtor(t.name)
      const line = renderTemplate(whatsAppLetterTemplate(t.seedKey), { ...values, letter_name: name }).text
      setReady({ blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }), filename: letterFilename(t.name, reference), text: line })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDrawing(false)
    }
  }

  const close = () => { setOpen(false); setChosen(null); setReady(null); setError(null) }
  /* `before` runs inside the tap, ahead of the link's own navigation: whatever it starts is still a
     tap's doing. */
  const openWhatsApp = (text: string, about: string | null, label: string, before?: () => void) => (
    <a href={whatsAppLink(number.wa, text)} target="_blank" rel="noopener noreferrer" data-testid="whatsapp-link" data-number={number.wa}
      onClick={() => { before?.(); close(); setAsking({ number: number.value, about }) }}
      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-emerald-700">
      <MessageCircle size={14} /> {label}
    </a>
  )

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className} data-testid="account-whatsapp">
        <MessageCircle size={14} /> WhatsApp
      </button>
      {open && (
        <Modal title="WhatsApp the debtor" onClose={close} width={460}>
          <div className="space-y-4" data-testid="account-whatsapp-box">
            {reachable.length > 1 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-500">Which number?</p>
                <div className="flex flex-wrap gap-1.5">
                  {reachable.map((n, i) => (
                    <button key={n.wa} type="button" onClick={() => setTo(i)} aria-pressed={i === to}
                      className={`rounded-lg border px-2.5 py-1.5 text-left text-sm ${i === to ? 'border-emerald-600 bg-emerald-50 text-slate-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                      <span className="block font-medium">{n.value}</span>
                      <span className="block text-[11px] text-slate-400">{n.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!chosen ? (
              <>
                <div>
                  <p className="mb-1.5 text-xs font-medium text-slate-500">A message</p>
                  {openWhatsApp(opening, null, 'Open WhatsApp')}
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-medium text-slate-500">Or send a letter</p>
                  {letters === null ? <Loader2 size={16} className="animate-spin text-slate-400" /> : letters.length === 0 ? (
                    <p className="text-sm text-slate-400">No letters in the library for this debtor.</p>
                  ) : (
                    <div className="max-h-64 space-y-1 overflow-y-auto" data-testid="whatsapp-letters">
                      {letters.map((t) => (
                        <button key={t.id} type="button" onClick={() => void draw(t)}
                          className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                          <FileText size={14} className="shrink-0 text-slate-400" /> {t.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="space-y-3" data-testid="whatsapp-letter-ready">
                <p className="text-sm font-medium text-slate-800">{chosen.name}</p>
                {drawing && <p className="inline-flex items-center gap-2 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> Drawing the PDF…</p>}
                {error && <p className="text-sm text-negative-700">{error}</p>}
                {ready && (
                  <>
                    <div>
                      <p className="mb-2 rounded-lg bg-slate-50 p-2.5 text-[13px] text-slate-700" data-testid="whatsapp-letter-text">{ready.text}</p>
                      {openWhatsApp(ready.text, chosen.name, 'Send on WhatsApp', () => {
                        /* IN THIS ORDER, all before the link navigates: the file, then the line. */
                        downloadBlob(ready.blob, ready.filename, { sameTab: true })
                        void navigator.clipboard?.writeText(ready.text).catch(() => {})
                      })}
                      <p className="mt-2 text-xs text-slate-500">
                        Downloads the PDF, copies this message and opens WhatsApp on {number.value}. In the chat, attach the
                        PDF with + then Document (on an iPad it is in Files, under Downloads).
                      </p>
                    </div>
                    <div>
                      <p className="mb-1.5 text-xs font-medium text-slate-500">The PDF did not download? Save it here</p>
                      <FileActions name={ready.filename} fetchFile={async () => ready.blob} testId="whatsapp-letter-pdf" />
                    </div>
                  </>
                )}
                <button type="button" onClick={() => { setChosen(null); setReady(null); setError(null) }}
                  className="text-xs text-slate-500 hover:text-slate-700">Choose something else</button>
              </div>
            )}
          </div>
        </Modal>
      )}
      {asking && (
        <WhatsAppSentModal number={asking.number}
          charged={asking.about
            ? `Each message is charged R3.50 under Annexure B item 1(c), and the ${asking.about} R25 under item 1(a), as a letter.`
            : 'Each message is charged R3.50 under Annexure B item 1(c), like an SMS.'}
          onDone={(count) => { onSent(asking.number, count, asking.about); setAsking(null) }}
          onClose={() => setAsking(null)} />
      )}
    </>
  )
}
