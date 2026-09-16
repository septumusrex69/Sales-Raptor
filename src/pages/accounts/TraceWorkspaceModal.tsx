import { useMemo, useState } from 'react'
import { Check, Loader2, Phone, Plus, RotateCcw } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { PhoneLink } from '../../components/PhoneLink'
import {
  canPromote, outcomeLabel, TRACE_OUTCOMES,
  type FiledTrace, type TraceItem, type TraceItemKind, type TraceOutcome,
} from '../../lib/traceStore.ts'
import { promoteTraceItem, recordTraceOutcome } from '../../lib/traceStoreData.ts'
import { formatDate, formatMoney } from '../../data/mockData'

/**
 * Working inside a trace.
 *
 * The firm's own description of what this is for: "You can work inside the tracing information.
 * You're calling a number that was on the trace. That number was verified. You can verify it, or
 * you called the person on the trace, you couldn't make contact, but it was ringing or the phone
 * was off. You can unverify it or say that it's not the debtor's telephone number. Then there
 * should be an option to add it to the principal contact details."
 *
 * So: ring it here, say what happened, and promote the ones that turn out to be real. Nothing
 * arrives on the account's contact list because a bureau printed it — only because somebody tried
 * it and said so.
 *
 * WHAT THE BUREAU SAID IS NEVER EDITED. A finding keeps the value and the date it was printed
 * with, for as long as the trace is on the account. What changes is our column beside it.
 */
const GROUPS: { kinds: TraceItemKind[]; title: string; note?: string }[] = [
  { kinds: ['mobile', 'phone', 'work'], title: 'Numbers', note: 'Ring one and say what happened. The ones that work can go on the account.' },
  { kinds: ['email'], title: 'Email' },
  { kinds: ['address'], title: 'Addresses' },
  { kinds: ['employer'], title: 'Employment', note: 'Where they work is the route to a garnishee.' },
  { kinds: ['link'], title: 'People linked to them', note: 'A shared surname is a possible relative, not a confirmed one.' },
  { kinds: ['directorship'], title: 'Companies they direct' },
  { kinds: ['property'], title: 'Property' },
]

export function TraceWorkspaceModal({ trace, actor, onClose, onChanged }: {
  trace: FiledTrace
  actor: { id: string | null; name: string | null }
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /* Applied over the fetched rows so a click shows immediately without refetching the account. */
  const [local, setLocal] = useState<Record<string, Partial<TraceItem>>>({})

  const items = useMemo(
    () => trace.items.map((i) => ({ ...i, ...(local[i.id] ?? {}) })),
    [trace.items, local],
  )

  async function setOutcome(item: TraceItem, outcome: TraceOutcome | null) {
    setBusy(item.id); setError(null)
    try {
      await recordTraceOutcome({ itemId: item.id, outcome, actor })
      setLocal((s) => ({ ...s, [item.id]: { ...s[item.id], outcome, outcomeAt: outcome ? new Date().toISOString() : null } }))
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(null) }
  }

  async function promote(item: TraceItem, asNextOfKin: boolean) {
    setBusy(item.id); setError(null)
    try {
      await promoteTraceItem({
        item, accountId: trace.accountId,
        /* Whose profile it came off. On a director's trace the contact is that director's. */
        subjectName: trace.subjectKind === 'director' ? trace.subjectName : null,
        asNextOfKin,
      })
      setLocal((s) => ({ ...s, [item.id]: { ...s[item.id], promotedContactId: 'done' } }))
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(null) }
  }

  const title = trace.subjectName
    ? `Trace — ${trace.subjectName}`
    : 'Trace'

  return (
    <Modal title={title} onClose={onClose} width={720}>
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 mb-4">
        <p className="text-[11px] text-slate-500">
          {[
            trace.subjectKind === 'director' ? 'A director of the debtor' : 'The debtor',
            trace.registrationNumber, trace.idNumber,
            trace.companyStatus,
            trace.contactScore ? `Contact score ${trace.contactScore}` : null,
            trace.riskScore,
            trace.enquiredOn ? `pulled ${formatDate(trace.enquiredOn)}` : null,
          ].filter(Boolean).join(' · ')}
        </p>
      </div>

      {error && <p className="text-sm text-negative-700 mb-3">{error}</p>}

      <div className="space-y-4">
        {GROUPS.map((group) => {
          const rows = items.filter((i) => group.kinds.includes(i.kind))
          if (rows.length === 0) return null
          return (
            <div key={group.title}>
              <p className="text-[11px] uppercase tracking-wide text-slate-400">{group.title} <span className="text-slate-300">({rows.length})</span></p>
              {group.note && <p className="text-[11px] text-slate-400 mb-1.5">{group.note}</p>}
              <div className="divide-y divide-slate-50">
                {rows.map((item) => (
                  <Row key={item.id} item={item} busy={busy === item.id}
                    onOutcome={(o) => void setOutcome(item, o)}
                    onPromote={(kin) => void promote(item, kin)} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

const DIALABLE: TraceItemKind[] = ['mobile', 'phone', 'work']

function Row({ item, busy, onOutcome, onPromote }: {
  item: TraceItem
  busy: boolean
  onOutcome: (outcome: TraceOutcome | null) => void
  onPromote: (asNextOfKin: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const dialable = DIALABLE.includes(item.kind)
  const done = item.promotedContactId !== null
  const ruledOut = item.outcome === 'not_theirs' || item.outcome === 'unreachable'

  return (
    <div className="py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className={`text-sm min-w-0 break-words ${ruledOut ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
          {/* Dialled from here, through the same button as everywhere else in the app. */}
          {dialable && !ruledOut
            ? <PhoneLink number={item.value} />
            : item.value}
        </span>
        <span className="text-[11px] text-slate-500 shrink-0">
          {item.kind === 'property' && item.amount !== null ? formatMoney(item.amount) : item.label}
        </span>
      </div>

      <p className="text-[11px] text-slate-400">
        {[
          item.kind === 'mobile' ? 'Mobile' : item.kind === 'work' ? 'Work' : item.kind === 'phone' ? 'Home' : null,
          item.seenOn ? `last seen ${formatDate(item.seenOn)}` : null,
          /* A number the bureau holds against ten people is a switchboard, not this debtor's. */
          item.peopleLinked !== null && item.peopleLinked > 1 ? `linked to ${item.peopleLinked} people` : null,
          item.kind === 'property' ? (/owner/i.test(item.status ?? '') ? 'still owns it' : 'no longer theirs') : null,
          item.kind === 'link' && item.status === 'relative' ? 'possible relative — same surname' : null,
          item.kind === 'directorship' ? item.status : null,
        ].filter(Boolean).join(' · ')}
      </p>

      <div className="flex flex-wrap items-center gap-1.5 mt-1">
        {busy && <Loader2 size={13} className="animate-spin text-slate-400" />}

        {item.outcome !== null ? (
          <>
            <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${
              item.outcome === 'verified' ? 'bg-positive-50 text-positive-700'
                : item.outcome === 'no_answer' ? 'bg-gold-50 text-[var(--c-gold-deep)]'
                  : 'bg-slate-100 text-slate-500'
            }`}>
              {outcomeLabel(item.outcome)}
            </span>
            {/*
              UNDOING IT IS A BUTTON, at the firm's instruction — "you can unverify it". A wrong
              outcome left standing is worse than none: the next collector rings a number this one
              already proved dead, or trusts a "reached them" that was somebody else.
            */}
            <button type="button" onClick={() => onOutcome(null)} disabled={busy}
              className="text-[11px] text-slate-400 hover:text-slate-600 inline-flex items-center gap-1">
              <RotateCcw size={11} /> Undo
            </button>
          </>
        ) : (dialable || item.kind === 'email' || item.kind === 'address') && (
          <>
            {!open && (
              <button type="button" onClick={() => setOpen(true)} disabled={busy}
                className="text-[11px] font-medium text-[var(--c-steel)] hover:underline inline-flex items-center gap-1">
                <Phone size={11} /> What happened?
              </button>
            )}
            {open && TRACE_OUTCOMES.map((o) => (
              <button key={o.outcome} type="button" title={o.meaning}
                onClick={() => { setOpen(false); onOutcome(o.outcome) }} disabled={busy}
                className="text-[11px] px-2 py-0.5 rounded-full border border-slate-200 text-slate-600 hover:border-gold-400 hover:bg-gold-50">
                {o.label}
              </button>
            ))}
          </>
        )}

        {done && (
          <span className="text-[11px] text-positive-700 inline-flex items-center gap-1">
            <Check size={11} /> On the account
          </span>
        )}
        {!done && canPromote(item) && (
          <button type="button" onClick={() => onPromote(false)} disabled={busy}
            className="text-[11px] font-medium text-[var(--c-steel)] hover:underline inline-flex items-center gap-1">
            <Plus size={11} /> Add to contact details
          </button>
        )}
        {/*
          A RELATIVE GOES ON AS A NEXT OF KIN, labelled. The firm asked for it in those words, and
          the label is what stops a collector opening a call to somebody's sister as though she
          were the debtor.
        */}
        {!done && item.kind === 'link' && (
          <button type="button" onClick={() => onPromote(true)} disabled={busy}
            className="text-[11px] font-medium text-[var(--c-steel)] hover:underline inline-flex items-center gap-1">
            <Plus size={11} /> Add as next of kin
          </button>
        )}
      </div>
    </div>
  )
}
