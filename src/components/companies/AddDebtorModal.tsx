import { useMemo, useState, type FormEvent } from 'react'
import { Modal, FormField, inputClass } from '../ui/Modal'
import { DictateButton } from '../ui/Dictate'
import { suggestReference, validateNewDebtor, type NewDebtorInput, type Problem } from '../../lib/newDebtor'

/**
 * One debtor, taken by hand.
 *
 * The bulk import is how a book arrives; this is how a single account does — phoned in, or sent
 * on its own by email. It asks for the least that opens a correct ledger and nothing more:
 * everything else about a debtor can be added on the account page afterwards, but capital, the
 * handover date and the rate cannot be got wrong and fixed later without the whole history moving.
 */
export function AddDebtorModal({ companyName, existingReferences, clientCode, busy, error, onClose, onSave }: {
  companyName: string
  /** This client's account numbers, so the next in their series can be proposed. */
  existingReferences: string[]
  /** Their code, so a client with NOTHING on the book still gets a reference proposed. */
  clientCode?: string | null
  busy: boolean
  error: string | null
  onClose: () => void
  /** The note is separate: it is not part of the account, it goes onto its timeline. */
  onSave: (input: NewDebtorInput, note: string | null) => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const suggested = useMemo(
    () => suggestReference(existingReferences, clientCode),
    [existingReferences, clientCode],
  )

  const [form, setForm] = useState<NewDebtorInput>({
    accountNumber: suggested ?? '',
    clientReference: '',
    firstName: '',
    surname: '',
    debtorKind: 'individual',
    idNumber: '',
    capital: '',
    handoverDate: today,
    // Standard, and stated rather than assumed — a rate left to a hidden default is a rate
    // nobody checked.
    interestRateAnnual: '24',
    mobile: '', workPhone: '', altNumber: '', email: '', address: '', employer: '',
    kin1Name: '', kin1Phone: '', kin2Name: '', kin2Phone: '',
  })
  /*
   * A NOTE, AT THE FIRM'S ASKING: "at the add a debtor, there should be a note as well, option
   * for make a note." Kept out of NewDebtorInput because it is not part of the account -- it goes
   * onto the account's own timeline afterwards, the same place the import writes its notes.
   */
  const [note, setNote] = useState('')
  // Problems appear once, on submit. Marking a field wrong while somebody is still typing in it
  // is just shouting at them for not having finished.
  const [shown, setShown] = useState<Problem[]>([])

  const set = (k: keyof NewDebtorInput) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))
  const problemFor = (k: keyof NewDebtorInput) => shown.find((p) => p.field === k)?.message
  const isCompany = form.debtorKind === 'company'

  function submit(e: FormEvent) {
    e.preventDefault()
    const problems = validateNewDebtor(form, today)
    setShown(problems)
    if (problems.length === 0) onSave(form, note.trim() || null)
  }

  return (
    <Modal title="Add a debtor" onClose={onClose} width={560}>
      {/*
        noValidate, and deliberately.

        A date input with a max runs the browser's own constraint check before onSubmit, which
        blocks the handler and shows a native bubble — "Value must be less than or equal to
        2026-09-10". Close the modal while that bubble is up and Safari leaves it floating over
        whatever page comes next: it was still sitting on the Calendar and the Accounts list,
        long after the form was gone.

        The rule it was enforcing is enforced below anyway, in a sentence a person can act on,
        and every other rule on this form already lives there. max stays on the input because it
        still shapes the date picker; it just no longer gets to interrupt.
      */}
      <form onSubmit={submit} noValidate>
        <p className="text-sm text-slate-500 mb-4">
          One account for {companyName}, opened by hand. Capital only &mdash; fees and interest are
          added as the account is worked, not here.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Our reference" problem={problemFor('accountNumber')}
            hint={suggested ? `next in this client’s series` : undefined}>
            <input className={inputClass} value={form.accountNumber} onChange={set('accountNumber')} placeholder={suggested ?? 'ABC0001'} />
          </Field>
          {/* The same field the account header names, and it has to be called the same thing
              there and here — see AccountDetail. */}
          <Field label="Client reference" problem={problemFor('clientReference')}>
            <input className={inputClass} value={form.clientReference} onChange={set('clientReference')} />
          </Field>

          {/*
            PERSON OR BUSINESS, ASKED FIRST, at the firm's instruction: "when you add a debtor,
            remember we have to account for a company as well -- person or a company or a
            business. And then you would say, add a debtor: okay, this debtor is an individual or
            a person."
            
            IT CHANGES THE FIELDS UNDER IT AND THAT IS WHY IT IS FIRST. A company has no first
            name and no ID number; it has a registration number, and asking a company for a
            thirteen-digit ID is how a registration number ends up in the ID column -- which is
            what the old sheet did on its own, in all 45 rows.

            THE DATABASE'S WORDS ARE 'individual' AND 'company'; the screen says Person and
            Business, which is what the handover sheet asks a client. Two vocabularies for one
            distinction, and the screen speaks the firm's.
          */}
          <div className="col-span-2">
            <Field label="Person or business" required problem={problemFor('debtorKind')}>
              <div className="flex gap-2">
                {([['individual', 'Person'], ['company', 'Business']] as const).map(([value, label]) => (
                  <button key={value} type="button"
                    onClick={() => setForm((f) => ({ ...f, debtorKind: value }))}
                    className={`flex-1 text-sm font-medium rounded-lg border px-3 py-2 ${
                      form.debtorKind === value
                        ? 'border-gold-500 bg-gold-50 text-navy-950'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          {!isCompany && (
            <Field label="First name" problem={problemFor('firstName')}>
              <input className={inputClass} value={form.firstName} onChange={set('firstName')} />
            </Field>
          )}
          <div className={isCompany ? 'col-span-2' : undefined}>
            <Field label={isCompany ? 'Registered name' : 'Surname'} required
              problem={problemFor('surname')}>
              <input className={inputClass} value={form.surname} onChange={set('surname')} />
            </Field>
          </div>

          <div className="col-span-2">
            {/*
              ONE COLUMN, TWO MEANINGS, decided by the kind -- which is how debtor_id_number
              already works on the account (see accountBook.ts). Labelled for what is being asked
              for, because "ID number" over a box somebody is typing a CK number into is the
              label doing the opposite of its job.
            */}
            <Field label={isCompany ? 'Registration number' : 'ID number'}
              problem={problemFor('idNumber')}
              hint={isCompany ? 'e.g. 2016/210735/07' : 'checked against the ID check digit'}>
              <input className={inputClass} value={form.idNumber} onChange={set('idNumber')}
                inputMode={isCompany ? 'text' : 'numeric'}
                maxLength={isCompany ? 30 : 13} />
            </Field>
          </div>

          <Field label="Capital handed over (R)" required problem={problemFor('capital')}>
            <input className={inputClass} value={form.capital} onChange={set('capital')} inputMode="decimal" />
          </Field>
          <Field label="Handover date" required problem={problemFor('handoverDate')} hint="interest runs from here">
            <input type="date" className={inputClass} value={form.handoverDate} onChange={set('handoverDate')} max={today} />
          </Field>

          <div className="col-span-2">
            <Field label="Interest (% a year)" required problem={problemFor('interestRateAnnual')}
              hint="commission comes from the client's own rate, not from here">
              <input className={inputClass} value={form.interestRateAnnual} onChange={set('interestRateAnnual')} inputMode="decimal" />
            </Field>
          </div>
        </div>

        {/*
          Asked here because this is the one moment somebody has the client on the phone with the
          file in front of them. All optional — an account often arrives as a name and a number —
          but a number captured now is a trace not paid for later.
        */}
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mt-5 mb-2">How to reach them</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mobile" problem={problemFor('mobile')}>
            <input className={inputClass} value={form.mobile} onChange={set('mobile')} inputMode="tel" />
          </Field>
          <Field label="Work number" problem={problemFor('workPhone')}>
            <input className={inputClass} value={form.workPhone} onChange={set('workPhone')} inputMode="tel" />
          </Field>
          <Field label="Alternative number" problem={problemFor('altNumber')}>
            <input className={inputClass} value={form.altNumber} onChange={set('altNumber')} inputMode="tel" />
          </Field>
          <Field label="Email" problem={problemFor('email')}>
            <input className={inputClass} value={form.email} onChange={set('email')} inputMode="email" />
          </Field>
          <div className="col-span-2">
            <Field label="Address" problem={problemFor('address')}>
              <input className={inputClass} value={form.address} onChange={set('address')} />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="Employer" problem={problemFor('employer')}>
              <input className={inputClass} value={form.employer} onChange={set('employer')} />
            </Field>
          </div>
        </div>

        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mt-5 mb-2">Next of kin</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" problem={problemFor('kin1Name')}>
            <input className={inputClass} value={form.kin1Name} onChange={set('kin1Name')} />
          </Field>
          <Field label="Number" problem={problemFor('kin1Phone')}>
            <input className={inputClass} value={form.kin1Phone} onChange={set('kin1Phone')} inputMode="tel" />
          </Field>
          <Field label="Name" problem={problemFor('kin2Name')}>
            <input className={inputClass} value={form.kin2Name} onChange={set('kin2Name')} />
          </Field>
          <Field label="Number" problem={problemFor('kin2Phone')}>
            <input className={inputClass} value={form.kin2Phone} onChange={set('kin2Phone')} inputMode="tel" />
          </Field>
        </div>

        {/*
          A NOTE, at the firm's asking: "at the add a debtor, there should be a note as well,
          option for make a note."

          LAST, BECAUSE IT IS ABOUT EVERYTHING ABOVE IT. An account taken over the phone arrives
          with things that fit in no box -- what the client said about the debtor, why the ID is
          missing, what was promised -- and until now the only way to record them was to open the
          account afterwards and remember to. It goes onto the account's own timeline, which is
          where the import already writes its notes, so the collector who gets it reads one thing.

          DICTATED OR TYPED. A spoken note is two or three sentences where a typed one is four
          words, and this is the moment somebody has the client on the telephone.
        */}
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mt-5 mb-2">A note</p>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
          placeholder="Anything the collector should know before the first call — optional"
          className={`${inputClass} resize-none`} />
        <div className="mt-1.5">
          <DictateButton size="small" value={note} onChange={setNote} />
        </div>

        {error && (
          <p className="mt-4 text-sm text-negative-700 bg-negative-50 border border-negative-100 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button type="submit" disabled={busy}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-gold-400 text-navy-950 border border-gold-500 disabled:opacity-40">
            {busy ? 'Adding…' : 'Add debtor'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function Field({ label, required, hint, problem, children }: {
  label: string; required?: boolean; hint?: string; problem?: string; children: React.ReactNode
}) {
  return (
    <FormField label={label} required={required}>
      {children}
      {problem
        ? <p className="text-[11px] text-negative-700 mt-1">{problem}</p>
        : hint ? <p className="text-[11px] text-slate-400 mt-1">{hint}</p> : null}
    </FormField>
  )
}
