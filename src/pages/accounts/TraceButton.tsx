import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, Search } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { recordTrace, XDS_PORTAL_URL } from '../../lib/accountTrace'
import { searchKeyProblem, traceSearchKey } from '../../lib/traceStore.ts'
import { isValidSaId } from '../../lib/newDebtor'
import { scheduleFor } from '../../lib/annexureB'
import type { ChargeResult } from '../../lib/accountCharges'

/** Enough for a company and everyone who signed surety for it. */
const COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

/**
 * Trace a debtor: XDS opens on the click, and Raptor asks afterwards how many searches were run.
 *
 * Afterwards is the only moment the answer exists. An account can carry a company and three
 * sureties, and nobody knows before opening the portal how many of them they will end up looking
 * for — asking first would be asking someone to predict their own next ten minutes.
 *
 * So the click does the fast thing (open XDS) and nothing else; the charge waits for the count.
 * Closing without answering charges nothing, which is the right outcome for a portal opened by
 * mistake and for a search that turned out not to be needed.
 */
export function TraceButton({ accountId, actor, debtorKind, idNumber, label, className, onDone, onUpload }: {
  accountId: string
  actor: { id: string | null; name: string | null }
  /** Which number is expected: an ID for a person, a registration number for a company. */
  debtorKind: 'individual' | 'company'
  /**
   * What XDS is searched ON: a person's ID number, or a company's registration number.
   *
   * Copied to the clipboard on the click, at the firm's instruction -- "it would automatically
   * copy the ID number to paste into the tracing system". It is thirteen digits that have to
   * arrive somewhere else exactly right, and retyping them is how a search comes back about
   * somebody else entirely.
   */
  idNumber: string | null
  /** What to call the button. The panel's empty box wants a fuller phrase than the action row. */
  label?: string
  /** The action row's styling, so this matches the buttons beside it. */
  className: string
  onDone: () => Promise<void>
  /**
   * Reading the PDFs the search just produced.
   *
   * Offered HERE rather than as a tenth button in the action row, and the reason is timing: the
   * only moment a collector certainly has the files on their machine is the minute after they ran
   * the search. Asked an hour later, on a panel, it is a task to come back to — which is how the
   * firm ended up paying for traces whose answers were never typed in.
   */
  onUpload: () => void
}) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ charge: ChargeResult; count: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  /* 'asking' until the clipboard answers, because a write can be refused after it is accepted. */
  const [copied, setCopied] = useState<'asking' | 'yes' | 'no' | 'nothing'>('nothing')
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current)
  }, [])

  const rate = scheduleFor(new Date()).items.find((i) => i.id === '4c')?.amount ?? 0
  /*
   * CHECKED BEFORE IT IS COPIED. It used to copy whatever was in the ID field, and on one account
   * that was a telephone number -- Swordfish's export carried one in the ID column and the ID was
   * never captured. Pasting it into XDS is a search the firm pays for, run against something that
   * is not a person. So an unusable number is not copied at all, and is named so it gets fixed.
   */
  const key = traceSearchKey(debtorKind, idNumber, isValidSaId)
  const problem = searchKeyProblem(key, debtorKind)

  function open() {
    /*
     * BOTH OF THESE HAVE TO START INSIDE THE TAP.
     *
     * Safari allows a new tab, and a clipboard write, only while it can still see the tap that
     * asked for one. Either one moved after an await is silently refused, which looks exactly
     * like a broken button. The clipboard call is started here and answered later -- writeText
     * resolves asynchronously, so what is shown in the modal waits for the real answer rather
     * than claiming success the moment it was asked for.
     */
    setCopied(key.ok ? 'asking' : 'nothing')
    if (key.ok) {
      try {
        const write = navigator.clipboard?.writeText(key.value)
        if (write) write.then(() => setCopied('yes')).catch(() => setCopied('no'))
        else setCopied('no')
      } catch {
        /* A browser with no clipboard permission at all. The number is shown instead. */
        setCopied('no')
      }
    }
    window.open(XDS_PORTAL_URL, '_blank', 'noopener,noreferrer')
    setResult(null)
    setError(null)
    setAsking(true)
  }

  async function charge(count: number) {
    setBusy(true)
    setError(null)
    try {
      const c = await recordTrace({ accountId, actor, count })
      setResult({ charge: c, count })
      setAsking(false)
      await onDone()
      if (resetTimer.current) clearTimeout(resetTimer.current)
      resetTimer.current = setTimeout(() => setResult(null), 10000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-start">
      <button type="button" onClick={open} title="Open XDS and record a credit bureau search — Annexure B item 4(c)" className={className}>
        <Search size={14} /> {label ?? 'Trace'}
      </button>

      {/*
        Straight after the charge, while the downloads are still in the corner of the screen. The
        line stays for ten seconds and then clears itself, same as the charge it sits beside.
      */}
      {result && (
        <button type="button" onClick={onUpload}
          className="text-[11px] font-medium text-[var(--c-steel)] hover:underline text-left">
          Upload what it found
        </button>
      )}

      {result && (
        <span className={`text-[11px] ${result.charge.reason === 'charged' ? 'text-[var(--c-green)]' : 'text-slate-500'}`}>
          {result.charge.reason === 'charged'
            ? `XDS opened · ${result.count > 1 ? `${result.count} searches · ` : ''}charged R${result.charge.exclVat.toFixed(2)} + VAT`
            : result.charge.reason === 'written-off'
              ? 'Recorded · no charge (account written off)'
              : 'Recorded · no charge (fee ceiling)'}
        </span>
      )}

      {asking && (
        <Modal title="How many traces did you do?" onClose={() => setAsking(false)} width={460}>
          <p className="text-sm text-slate-500">
            XDS is open in a new tab. One account can carry a company and its sureties, so tell us how many
            searches you ran and they go on the statement as a single line.
          </p>

          {/*
            THE NUMBER, EITHER WAY. On the clipboard where the browser allowed it, and on the
            screen where it did not -- a collector told nothing would retype thirteen digits from
            the account behind this modal, and a digit wrong there is a search about somebody
            else that the firm still pays for.
          */}
          {key.ok && copied === 'yes' && (
            <p className="text-xs text-[var(--c-green)] mt-3 inline-flex items-center gap-1.5">
              <Check size={13} /> The {key.what} {key.value} is on your clipboard — paste it into the search.
            </p>
          )}
          {key.ok && (copied === 'no' || copied === 'asking') && (
            <p className="text-xs text-slate-500 mt-3">
              Search on <span className="font-medium text-slate-700 select-all">{key.value}</span>
              {copied === 'no' && ' — this browser would not let us copy it for you.'}
            </p>
          )}
          {/*
            A MISSING NUMBER AND A WRONG ONE ARE DIFFERENT PROBLEMS. One needs capturing and the
            other needs correcting, and a collector told only "no ID" would go and type the
            telephone number sitting in that field straight into the portal.
          */}
          {problem !== null && (
            <p className="text-xs text-negative-700 mt-3 rounded-lg bg-negative-50 border border-negative-100 px-3 py-2">
              {problem}
            </p>
          )}
          <div className="flex flex-wrap gap-2 mt-4">
            {COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => void charge(n)}
                disabled={busy}
                className="w-11 h-11 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 bg-white hover:border-[#c9a052] hover:bg-gold-50 disabled:opacity-50"
              >
                {n}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-400 mt-3">
            {rate > 0 && <>R{rate.toFixed(2)} plus VAT each, under Annexure B item 4(c). </>}
            Nothing is charged until you choose.
          </p>
          {error && <p className="text-sm text-negative-700 mt-3">{error}</p>}
          <div className="flex items-center justify-end gap-2 mt-5">
            {busy && <Loader2 size={15} className="animate-spin text-slate-400" />}
            <button onClick={() => setAsking(false)} disabled={busy} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50">
              Didn&apos;t trace
            </button>
          </div>
        </Modal>
      )}
    </span>
  )
}
