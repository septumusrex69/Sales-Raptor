import { useState } from 'react'
import { AlertTriangle, Check, ClipboardPaste, Loader2 } from 'lucide-react'
import { Card, CardHeader } from '../ui/Card'
import { parseCorrectionReply, type ReplyAnswer } from '../../lib/correctionReply.ts'
import { applyReplyAnswer } from '../../lib/applyReply.ts'
import { fetchWorkspace } from '../../lib/accountWorkspace.ts'
import { ANSWER_COLUMN } from '../../lib/importCorrections.ts'
import { HANDOVER_COLUMNS } from '../../lib/handoverSheet.ts'

const label = (key: string | null, fallback: string) =>
  HANDOVER_COLUMNS.find((c) => c.key === key)?.label ?? fallback

interface Applied { outcome: 'done' | 'refused'; text: string }

/**
 * What the client wrote in the last column, against the accounts it is about.
 *
 * THE FIRM asked for a column the client fills in, and for what they write to come back into the
 * fields. This is where it lands: the reply is pasted, the table inside it is read, and each
 * answer is shown beside the account it belongs to with the same rule the import used already
 * applied to it.
 *
 * PASTED, NOT FETCHED, and that is the honest limit of it today. Nothing links a query to the
 * mail thread it caused, so there is no way to go and find the reply -- matching on a subject
 * line would be a guess, and a guess here writes to the wrong account. A paste is one gesture
 * from the mail screen and cannot be wrong about which reply it read.
 *
 * NOTHING IS WRITTEN UNTIL SOMEBODY PRESSES A BUTTON, one answer at a time. The firm's standing
 * instruction is that corrections are "made case by case, never a migration that sweeps" -- and
 * an "apply all" over a client's typing is exactly the sweep.
 */
export function ReplyAnswers({ accountFor }: {
  /** The account a client reference belongs to, or null where that row opened none. */
  accountFor: (reference: string | null) => string | null
}) {
  const [answers, setAnswers] = useState<ReplyAnswer[] | null>(null)
  const [applied, setApplied] = useState<Record<number, Applied>>({})
  const [busy, setBusy] = useState<number | null>(null)

  /*
   * THE MARKUP OFF THE CLIPBOARD, not the plain text. A table pasted as text loses which cell was
   * which, and the whole answer is in the last column -- so the rich flavour is the one carrying
   * the information. `clipboardData` rather than the async Clipboard API: this fires on a real
   * paste the person made, which needs no permission and works on an iPad.
   */
  function onPaste(e: React.ClipboardEvent) {
    const html = e.clipboardData.getData('text/html')
    if (!html) return
    e.preventDefault()
    setAnswers(parseCorrectionReply(html))
    setApplied({})
  }

  async function apply(i: number, a: ReplyAnswer) {
    const accountId = accountFor(a.reference)
    if (!accountId || !a.key) return
    setBusy(i)
    try {
      const workspace = await fetchWorkspace(accountId)
      const out = await applyReplyAnswer({
        accountId, key: a.key, value: a.answer, contacts: workspace.contacts,
      })
      setApplied((m) => ({
        ...m,
        [i]: out.done ? { outcome: 'done', text: out.what } : { outcome: 'refused', text: out.why },
      }))
    } catch (err) {
      setApplied((m) => ({
        ...m,
        [i]: { outcome: 'refused', text: err instanceof Error ? err.message : String(err) },
      }))
    } finally { setBusy(null) }
  }

  return (
    <Card padded={false}>
      <div className="p-5 pb-3">
        <CardHeader
          title="The client&rsquo;s answers"
          subtitle={'Copy their reply and paste it here. The last column is read back against the '
            + `accounts it is about; nothing is written until you say so. (${ANSWER_COLUMN})`} />
      </div>

      <div className="px-5 pb-4">
        <div
          contentEditable
          suppressContentEditableWarning
          onPaste={onPaste}
          role="textbox"
          aria-label="Paste the client&rsquo;s reply"
          data-testid="paste-reply"
          className="min-h-[72px] rounded-lg border border-dashed border-slate-300 px-3 py-2.5
            text-sm text-slate-400 focus:border-brand-500 focus:outline-none">
          <span className="inline-flex items-center gap-1.5">
            <ClipboardPaste size={14} /> Paste the client&rsquo;s reply here
          </span>
        </div>
      </div>

      {answers !== null && answers.length === 0 && (
        /* NAMED, NOT EMPTY. A panel that says nothing after a paste reads as a broken parser, and
           the commonest real reason is a client who answered in prose instead. */
        <p className="px-5 pb-5 text-sm text-slate-500">
          Nothing filled in was found in that. If they answered in words rather than in the table,
          the answers have to go on by hand.
        </p>
      )}

      {answers !== null && answers.length > 0 && (
        <div className="divide-y divide-slate-100">
          {answers.map((a, i) => {
            const accountId = accountFor(a.reference)
            const done = applied[i]
            /* Two reasons an answer cannot be written, each said in its own words rather than
               greying the button out and leaving somebody to guess which it was. */
            const blocked = !a.key
              ? `We do not have a column called “${a.fieldLabel}”.`
              : !accountId
                ? 'No account was opened for this one, so there is nothing to write it onto yet.'
                : null
            return (
              <div key={i} className="px-5 py-3 flex flex-wrap items-start gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-800">
                    <span className="font-medium">{a.reference ?? 'No reference'}</span>
                    {' · '}{label(a.key, a.fieldLabel)}
                  </p>
                  <p className="text-[13px] text-slate-600 mt-0.5 wrap-anywhere">
                    {/* What it replaces, beside what replaces it: a client who answers the wrong
                        row is the failure this is here to make visible. */}
                    {a.given && <span className="text-slate-400 line-through mr-2">{a.given}</span>}
                    {a.answer}
                  </p>
                  {a.problem && (
                    <p className="text-[12px] text-negative-700 mt-0.5">
                      <AlertTriangle size={11} className="inline mr-1 -mt-0.5" />{a.problem}
                    </p>
                  )}
                  {blocked && <p className="text-[12px] text-slate-500 mt-0.5">{blocked}</p>}
                  {done?.outcome === 'refused' && (
                    <p className="text-[12px] text-negative-700 mt-0.5">{done.text}</p>
                  )}
                </div>
                <div className="shrink-0">
                  {done?.outcome === 'done' ? (
                    <span className="inline-flex items-center gap-1 text-xs text-positive-700">
                      <Check size={13} /> Written
                    </span>
                  ) : (
                    <button type="button" disabled={!!blocked || busy !== null}
                      onClick={() => void apply(i, a)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5
                        rounded-lg border border-slate-200 text-slate-700 hover:border-brand-300
                        disabled:opacity-40">
                      {busy === i ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                      {/* An answer that is still wrong may still be written: it is the client's
                          record of what they say is true, and refusing it would leave somebody
                          retyping it anyway. The warning is above it; the decision is theirs. */}
                      Put it on the account
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
