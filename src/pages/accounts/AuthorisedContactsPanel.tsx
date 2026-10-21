import { useState } from 'react'
import { AlertTriangle, Check, Plus, ShieldCheck } from 'lucide-react'
import { Card, CardHeader } from '../../components/ui/Card'
import { FormField, Modal } from '../../components/ui/Modal'
import { CAPACITIES, mayBeTold } from '../../lib/callScripts.ts'
import {
  addAuthorisedContact, capacityLabel, expired, isLive, needsProof, recordProof,
  type AuthorisedContact,
} from '../../lib/authorisedContacts.ts'
import { shortDate } from '../../lib/dateLabels.ts'
import { todayIso } from '../../lib/reminderTime.ts'

const inputClass = 'w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] '
  + 'text-slate-800 focus:border-[#c9a052] focus:outline-none'

/**
 * WHO MAY BE TOLD ANYTHING ABOUT THIS ACCOUNT.
 *
 * THE FIRM: "this is the part that cannot live in a collector's head. Every account needs an
 * authorised contacts table, and the opening script's verification tick must read from it."
 *
 * IT IS NOT A CONTACT LIST. account_contacts already holds numbers and addresses -- things to
 * DIAL. This holds PERMISSION, which is a different fact about a different person: the debtor's
 * attorney has no number on the account and may be told everything; the debtor's wife is in the
 * contacts with a mobile number and may be told nothing at all.
 *
 * WHAT THE ROW SAYS IS WHAT MAY BE SAID. Every row carries the capacity's own entry from the
 * matrix -- everything, their own liability only, or nothing -- so a collector reads the answer
 * rather than deriving it, and the panel says it in the same words the call panel does.
 *
 * AND THE PROOF IS THE GATE, NOT THE ROW. The firm: "a row with no proof on file is not an
 * authorised contact, however long it has been there." So a row without it is drawn as a row that
 * authorises nothing, with the thing that is missing named -- not quietly ranked lower.
 */
export function AuthorisedContactsPanel({ accountId, contacts, actorId, onChange }: {
  accountId: string
  contacts: AuthorisedContact[]
  actorId: string | null
  onChange: () => Promise<void> | void
}) {
  const [adding, setAdding] = useState(false)
  const [proving, setProving] = useState<AuthorisedContact | null>(null)
  const [error, setError] = useState<string | null>(null)
  const today = todayIso()
  const missing = needsProof(contacts)
  const stale = expired(contacts, today)

  return (
    <Card>
      <CardHeader title="Who may be told anything"
        subtitle="Permission, not contact details. A row with no proof on file authorises nothing." />

      <button type="button" onClick={() => { setAdding(true); setError(null) }}
        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg
          border border-slate-200 text-slate-700 hover:bg-slate-50">
        <Plus size={12} /> Add somebody
      </button>

      {error && <p className="mt-2 text-xs text-negative-700">{error}</p>}

      {contacts.length === 0 && (
        <p className="mt-3 text-xs text-slate-500">
          Nobody but the debtor. Everybody else &mdash; a spouse, a parent, an employer, an
          attorney who has not sent a letter &mdash; is told nothing, including whether this
          account exists.
        </p>
      )}

      {contacts.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-50">
          {contacts.map((c) => {
            const live = isLive(c, today)
            const tell = mayBeTold(c.capacity, c.proofOnFile)
            return (
              /*
                TWO SHORT LINES, NOT FIVE (the firm: "thin, sleek, easy to read"). Who they are on
                the first, with the authority hard right; what may be said and the proof behind it
                on the second. The second line is NOT folded into a tooltip: what this person may
                be told is the one thing a collector must read before they speak, so it stays on
                the screen -- it truncates only where the panel runs out, with the whole on the
                title.
              */
              <li key={c.id} className="py-1 text-[12px] hover:bg-slate-50">
                <div className="flex items-center gap-2 whitespace-nowrap min-w-0">
                  <span className="min-w-0 truncate" title={[c.name, capacityLabel(c.capacity), c.contact].filter(Boolean).join(' · ')}>
                    <span className="font-medium text-slate-800">{c.name}</span>
                    <span className="text-slate-400"> &middot; {capacityLabel(c.capacity)}
                      {c.contact ? <> &middot; {c.contact}</> : null}
                    </span>
                  </span>
                  <span className={`ml-auto shrink-0 text-[11px] ${live ? 'text-[var(--c-green)]' : 'text-slate-400'}`}>
                    {live ? <><ShieldCheck size={11} className="inline" /> Authorised</> : 'Authorises nothing'}
                  </span>
                </div>
                {/* WHAT MAY BE SAID, in the matrix's own words -- so the collector reads the
                    answer instead of working it out from the capacity. */}
                <p className="text-[11px] text-slate-600 truncate"
                  title={tell === 'everything' ? 'May be told everything on the account.'
                    : tell === 'own_liability'
                      ? 'The principal debt and their own liability only. Nothing else about the debtor.'
                      : 'Nothing. Not the balance, not the creditor, not whether the account exists.'}>
                  {tell === 'everything' ? 'May be told everything on the account.'
                    : tell === 'own_liability'
                      ? 'The principal debt and their own liability only. Nothing else about the debtor.'
                      : 'Nothing. Not the balance, not the creditor, not whether the account exists.'}
                  {c.proofOnFile ? (
                    <span className="text-slate-400">
                      {' '}&middot; {c.proof ?? 'Proof on file'}
                      {c.verifiedAt ? <> &middot; verified {shortDate(c.verifiedAt.slice(0, 10))}</> : null}
                      {c.expiresOn ? <> &middot; expires {shortDate(c.expiresOn)}</> : null}
                    </span>
                  ) : null}
                </p>
                {!c.proofOnFile && (
                  /* NAMED, NOT RANKED. The thing that is missing is the one sentence that gets the
                     row working, and it is the capacity's own requirement rather than a guess. */
                  <p className="text-[11px] text-[var(--c-rust-deep)]">
                    Still needed: {CAPACITIES.find((x) => x.id === c.capacity)?.proof || 'nothing will authorise this capacity'}
                    {CAPACITIES.find((x) => x.id === c.capacity)?.proof && (
                      <button type="button" onClick={() => { setProving(c); setError(null) }}
                        className="ml-2 underline underline-offset-2">It has arrived</button>
                    )}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/*
        THE WEEKLY EXCEPTION REPORT, ON THE SCREEN WHERE IT MATTERS.

        THE FIRM: "audit the authorised contacts list. Any row with no proof on file... should
        surface on a weekly exception report." It also belongs here, because the person who can fix
        it is the one looking at the account -- a report read on a Friday is a week of calls late.
      */}
      {(missing.length > 0 || stale.length > 0) && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-[#c9a052] bg-gold-50
          px-2.5 py-2 text-[11px] text-slate-700">
          <AlertTriangle size={12} className="mt-0.5 shrink-0 text-[var(--c-gold-deep)]" />
          <span>
            {missing.length > 0 && <>{missing.length === 1 ? 'One row has' : `${missing.length} rows have`} no
              proof on file and authorise nothing. </>}
            {stale.length > 0 && <>{stale.length === 1 ? 'One has' : `${stale.length} have`} expired. </>}
            Chase the document or take the row off &mdash; a row that looks authorised and is not
            is worse than no row.
          </span>
        </p>
      )}

      {adding && (
        <AddContact accountId={accountId} actorId={actorId}
          onClose={() => setAdding(false)}
          onSaved={async () => { setAdding(false); await onChange() }}
          onError={setError} />
      )}

      {proving && (
        <Modal title={`Proof for ${proving.name}`} onClose={() => setProving(null)} width={460}>
          <ProofForm contact={proving} actorId={actorId}
            onSaved={async () => { setProving(null); await onChange() }}
            onError={setError} />
        </Modal>
      )}
    </Card>
  )
}

/**
 * ADDING SOMEBODY, AND THE PROOF IS ASKED FOR IN THE SAME BREATH.
 *
 * THE CAPACITY DECIDES THE QUESTION. Choosing "an attorney" names the letter that is needed;
 * choosing "anyone else, including a spouse" says plainly that nothing will authorise it, which is
 * the firm's first enforced rule and the one collectors most often get wrong.
 *
 * AND THE TICK IS SEPARATE FROM THE TEXT. "What is held" and "it is held" are two facts: a
 * collector who has asked for a letter writes down what they asked for, and nobody has verified
 * anything yet. Only the tick authorises -- see addAuthorisedContact, which stamps who verified it
 * and when, and only where the tick is set.
 */
function AddContact({ accountId, actorId, onClose, onSaved, onError }: {
  accountId: string
  actorId: string | null
  onClose: () => void
  onSaved: () => Promise<void>
  onError: (m: string) => void
}) {
  const [name, setName] = useState('')
  const [capacity, setCapacity] = useState('mandated')
  const [contact, setContact] = useState('')
  const [proof, setProof] = useState('')
  const [onFile, setOnFile] = useState(false)
  const [expiresOn, setExpiresOn] = useState('')
  const [busy, setBusy] = useState(false)
  const chosen = CAPACITIES.find((c) => c.id === capacity)
  const authorises = chosen ? chosen.tell !== 'nothing' : false

  async function save() {
    if (!name.trim()) { onError('A name, or there is nothing to recognise them by.'); return }
    setBusy(true)
    try {
      await addAuthorisedContact({
        accountId, name, capacity, contact, proof, proofOnFile: onFile && authorises,
        expiresOn: expiresOn || null, actorId,
      })
      await onSaved()
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Add somebody who may be told" onClose={onClose} width={520}>
      <div className="space-y-3">
        <FormField label="Their name" required>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </FormField>
        <FormField label="In what capacity" required>
          <select className={inputClass} value={capacity} onChange={(e) => setCapacity(e.target.value)}>
            {CAPACITIES.filter((c) => c.id !== 'debtor').map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </FormField>
        {/*
          WHAT THAT CAPACITY MAY BE TOLD, AND WHAT IT TAKES -- said before anything is saved,
          because this is the moment somebody is deciding.
        */}
        <p className="rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] leading-snug text-slate-600">
          {chosen?.tell === 'everything' && <>May be told everything, once the proof is on file. </>}
          {chosen?.tell === 'own_liability' && <>May be told the principal debt and their own
            liability, and nothing else about the debtor. </>}
          {chosen?.tell === 'nothing' && <><strong className="font-semibold">Nothing may be said
            to them at all</strong> &mdash; not the balance, not the creditor, not whether this
            account exists. A spouse is not authorised by marriage: they become authorised as a
            party to the account, a surety, or a mandate holder, like anybody else. </>}
          {chosen?.stopsCollection && <>And collection STOPS: a debt counsellor means the account
            goes to the manager. </>}
          {chosen?.proof && <>Proof required: {chosen.proof}.</>}
        </p>
        <FormField label="A number or an email, if you have one">
          <input className={inputClass} value={contact} onChange={(e) => setContact(e.target.value)} />
        </FormField>
        {authorises && (
          <>
            <FormField label="What is held, or what has been asked for">
              <input className={inputClass} value={proof} onChange={(e) => setProof(e.target.value)}
                placeholder={chosen?.proof} />
            </FormField>
            <label className="flex items-start gap-2 text-[12px] text-slate-700">
              <input type="checkbox" checked={onFile} onChange={(e) => setOnFile(e.target.checked)}
                className="mt-0.5" />
              <span>
                I have that document on file and I have checked it.
                <span className="block text-[11px] text-slate-500">
                  Until this is ticked the row authorises nothing, which is the firm&rsquo;s own
                  rule. Ticking it records that it was you, today.
                </span>
              </span>
            </label>
            {/* ONLY WHERE ONE APPLIES. A mandate the debtor may revoke and a power of attorney
                with an end date; most rows have none and the field says so rather than asking. */}
            <FormField label="Expires on, where it does">
              <input type="date" className={inputClass} value={expiresOn}
                onChange={(e) => setExpiresOn(e.target.value)} />
            </FormField>
          </>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600">Cancel</button>
          <button type="button" onClick={() => void save()} disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-navy-950 px-3 py-1.5
              text-xs font-medium text-white disabled:opacity-40">
            <Check size={12} /> Add them
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** The proof has arrived. The one transition a row has — see recordProof. */
function ProofForm({ contact, actorId, onSaved, onError }: {
  contact: AuthorisedContact
  actorId: string | null
  onSaved: () => Promise<void>
  onError: (m: string) => void
}) {
  const [proof, setProof] = useState(contact.proof ?? '')
  const [busy, setBusy] = useState(false)
  const needed = CAPACITIES.find((c) => c.id === contact.capacity)?.proof
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-slate-600">
        {needed ? <>What is required: {needed}.</> : null} Say what you actually have, because this
        is what a reviewer reads back.
      </p>
      <FormField label="What is on file" required>
        <input className={inputClass} value={proof} onChange={(e) => setProof(e.target.value)} autoFocus />
      </FormField>
      <div className="flex justify-end">
        <button type="button" disabled={busy}
          onClick={() => {
            if (!proof.trim()) { onError('Say what is on file.'); return }
            setBusy(true)
            void recordProof({ id: contact.id, proof, actorId })
              .then(onSaved)
              .catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)))
              .finally(() => setBusy(false))
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-navy-950 px-3 py-1.5
            text-xs font-medium text-white disabled:opacity-40">
          <ShieldCheck size={12} /> It is on file, and I have checked it
        </button>
      </div>
    </div>
  )
}
