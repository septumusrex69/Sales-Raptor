import { useEffect, useRef, useState } from 'react'
import {
  Building2, Check, Download, FileText, Globe, IdCard, Loader2, Mail, MapPin, MessageCircle,
  Phone, Plus, ShieldCheck, Smartphone, Trash2, Upload, User, X, Home
} from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { PhoneLink } from '../../components/PhoneLink'
import { formatDate, formatMoney } from '../../data/mockData'
import type { DebtorAccount } from '../../lib/accountBook'
import {
  addContact, deleteDocument, documentUrl, retireContact, saveDebtorIdentity, saveDebtorPreferences,
  updateContact, uploadDocument, verifyContact, CONTACT_KINDS, DOCUMENT_KINDS, TRACE_KIND,
  dialableNumber,
  type AccountContact, type AccountDocument, type ContactKind, type Workspace,
} from '../../lib/accountWorkspace'
import { DictateButton } from '../../components/ui/Dictate'
import { contactsByPerson, otherPeople } from '../../lib/contactPeople.ts'
import type { TraceItem } from '../../lib/traceStore.ts'

/** Surfaces a failed write instead of leaving a button that silently did nothing. */
export function useWriter(onChange: () => Promise<void>) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null)
    try {
      await fn()
      await onChange()
      return true
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, err, run }
}

/* ================= Debtor details ================= */

/**
 * The debtor's details as a fixed set of labelled slots.
 *
 * Fixed on purpose. A list that only shows what happens to be filled in tells you nothing about
 * what is missing, and on this book almost everything is missing: none of the five Swordfish
 * exports carried a phone number, an email or an address. A collector needs to see the empty
 * row for "Mobile" and know that finding one is the job.
 *
 * The multi-valued fields come from account_contacts, so an account can hold four numbers and
 * the history of two dead ones. The three single-valued ones — language, contact preference,
 * consent — are columns, because they describe the person rather than any one number.
 */
const SLOT_ICON = {
  name: User, id: IdCard, mobile: Smartphone, alt: Phone, email: Mail,
  address: MapPin, employer: Building2, language: Globe, preference: MessageCircle,
  consent: ShieldCheck,
} as const

export function DebtorDetailsPanel({ account, name, workspace, properties, onChange, userId, onEmail, onOpenTrace }: {
  account: DebtorAccount
  name: string
  workspace: Workspace | null
  /**
   * What the deeds office has them on and they still own, off every trace on the account.
   *
   * HERE rather than only inside the trace, at the firm's instruction: "one thing which I would
   * like to see more prominent on the accounts is if there is a property." A house they still own
   * is the difference between an account worth attaching and one worth closing, and it was two
   * clicks inside a modal.
   */
  properties: TraceItem[]
  onChange: () => Promise<void>
  userId: string | null
  onEmail: (address: string) => void
  /** Where the property and the next of kin came from, so the evidence is one click away. */
  onOpenTrace: (() => void) | null
}) {
  const [addKind, setAddKind] = useState<ContactKind | null>(null)
  const { busy, err, run } = useWriter(onChange)

  const live = (workspace?.contacts ?? []).filter((c) => !c.retiredAt)
  const retired = (workspace?.contacts ?? []).filter((c) => c.retiredAt)

  const isCompany = account.debtorKind === 'company'
  const people = isCompany ? contactsByPerson(live) : []
  /*
   * ANYBODY WITH A NAME AGAINST THEM IS NOT THE DEBTOR.
   *
   * On a company the whole contact list is people and it shows under "Who to ask for". On an
   * individual the list is shown flat, on the reasoning that every number is the debtor's -- and
   * a next of kin promoted off a trace was therefore invisible, which is the firm's report:
   * "I'm not seeing a next of kin". They are not all the debtor's, and the one with somebody
   * else's name on it is precisely the row nobody must dial thinking it is the debtor.
   */
  const kin = isCompany ? [] : otherPeople(live)
  const phones = live.filter((c) => c.kind === 'mobile' || c.kind === 'phone' || c.kind === 'work')
  // Shared with the action bar's Call button, so both ring the same number.
  const primaryPhone = dialableNumber(live)
  const altPhone = phones.find((c) => c.id !== primaryPhone?.id)
  const email = live.find((c) => c.kind === 'email')
  const address = live.find((c) => c.kind === 'address')
  const employer = live.find((c) => c.kind === 'employer')

  return (
    // A container, so the fields below can reflow on the PANEL's width rather than the screen's.
    // The two are not the same thing here: in the three-column layout this card is 19rem wide on
    // a 27" monitor, and a screen-width breakpoint would happily lay three columns out inside it.
    <Card className="@container/details">
      <div className="flex items-center justify-between gap-2 mb-3">
        {/*
          A COMPANY'S DETAILS ARE NOT A DEBTOR'S DETAILS. The panel said "Debtor details" over
          "Full Name", "ID Number" and "Residential Address" on a company account, which is three
          fields lying about what they hold. The account already knows which it is.
        */}
        <h3 className="text-[11px] uppercase tracking-wide text-slate-400">
          {isCompany ? 'Company details' : 'Debtor details'}
        </h3>
        <button onClick={() => setAddKind(addKind ? null : 'mobile')}
          className="text-xs text-brand-600 hover:underline inline-flex items-center gap-1">
          {addKind ? <><X size={12} /> Cancel</> : <><Plus size={12} /> Add</>}
        </button>
      </div>

      {addKind && (
        <ContactForm accountId={account.id} initialKind={addKind} busy={busy}
          forCompany={isCompany} onDone={() => setAddKind(null)} run={run} />
      )}
      {err && <p className="text-xs text-negative-700 mb-2">{err}</p>}

      {/*
        One column when the panel is narrow, more when it is not.

        Every value here is short — a number, a language, a preference — so a full-width card
        spent most of its width on nothing, which is what the firm pointed at. The columns appear
        only once there is room for them: unchanged at the 19rem of the three-column layout, two
        across from 32rem, three from 56rem.
      */}
      <dl className="grid gap-3 @lg/details:grid-cols-2 @4xl/details:grid-cols-3">
        <NameSlot account={account} name={name} busy={busy}
          onSave={(p) => run(() => saveDebtorIdentity(account.id, p))} />
        <TextSlot icon="id" label={isCompany ? 'Registration Number' : 'ID Number'}
          value={account.debtorIdNumber} busy={busy}
          placeholder={isCompany ? 'nnnn/nnnnnn/07' : '13 digits'}
          // Said, not enforced. Some debtors are companies, some records are foreign passports,
          // and refusing to store what a collector was actually given helps nobody.
          /* A registration number is not thirteen digits, so the warning is for people only. */
          warn={(v) => (!isCompany && v && !/^\d{13}$/.test(v.replace(/\s/g, '')) ? 'That is not 13 digits — check it against the ID.' : null)}
          onSave={(v) => run(() => saveDebtorIdentity(account.id, { idNumber: v }))} />

        {/*
          FIXED SLOTS ARE A PERSON'S SHAPE, AND A COMPANY DOES NOT HAVE IT.
          "Mobile (Primary)", "Alternative Number", "Residential Address", "Employer" — every one
          of those is a fact about a human being. On a company they led the panel with a number
          nobody could attribute: a collector saw 083 000 0148 and had no way to know whether to
          ask for the accounts manager or a director. Everything a company is reached on belongs to
          somebody, so on a company it all lives under them in "Who to ask for" below.
        */}
        {!isCompany && (
          <>
            <ContactSlot icon="mobile" label="Mobile (Primary)" contact={primaryPhone}
              onAdd={() => setAddKind('mobile')} userId={userId} busy={busy} run={run} />
            <ContactSlot icon="alt" label="Alternative Number" contact={altPhone}
              onAdd={() => setAddKind('phone')} userId={userId} busy={busy} run={run} />
            <ContactSlot icon="email" label="Email Address" contact={email}
              onAdd={() => setAddKind('email')} userId={userId} busy={busy} run={run}
              onOpen={email ? () => onEmail(email.value) : undefined} />
            <ContactSlot icon="address" label="Residential Address" contact={address}
              onAdd={() => setAddKind('address')} userId={userId} busy={busy} run={run} />
            <ContactSlot icon="employer" label="Employer" contact={employer}
              onAdd={() => setAddKind('employer')} userId={userId} busy={busy} run={run} />
          </>
        )}

        <EditableSlot icon="language" label="Preferred Language" value={account.preferredLanguage}
          options={['English', 'Afrikaans', 'isiZulu', 'isiXhosa', 'Sesotho', 'Setswana', 'Sepedi', 'Xitsonga', 'siSwati', 'Tshivenda', 'isiNdebele']}
          onSave={(v) => run(() => saveDebtorPreferences(account.id, { preferredLanguage: v }))} busy={busy} />
        <EditableSlot icon="preference" label="Contact Preference" value={account.contactPreference}
          options={['Phone', 'Phone, WhatsApp', 'WhatsApp', 'SMS', 'Email', 'Post', 'Do not contact']}
          onSave={(v) => run(() => saveDebtorPreferences(account.id, { contactPreference: v }))} busy={busy} />
        <EditableSlot icon="consent" label="Consent Status" value={account.consentStatus}
          options={['Consented', 'Not obtained', 'Withdrawn']}
          onSave={(v) => run(() => saveDebtorPreferences(account.id, { consentStatus: v }))} busy={busy}
          hint="POPIA: whether they have agreed to electronic contact." />
      </dl>

      {/*
        PROPERTY, HERE RATHER THAN TWO CLICKS INSIDE THE TRACE.

        The firm's instruction: "one thing which I would like to see more prominent on the accounts
        is if there is a property... it can be almost flagged like this debtor has a property."

        ONLY WHAT THEY STILL OWN. The deeds block lists every transaction, including houses sold
        fifteen years ago, and a sold property flagged on the account screen reads as an asset to
        anybody skimming — which would turn a warning into a lie. heldProperty does that filtering;
        what arrives here is already the live ones.
      */}
      {properties.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="rounded-xl border border-gold-300 bg-gold-50 px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wide text-[var(--c-gold-deep)] font-medium inline-flex items-center gap-1.5">
              <Home size={12} />
              {properties.length === 1 ? 'Owns property' : `Owns ${properties.length} properties`}
            </p>
            {properties.map((prop) => (
              <div key={prop.id} className="mt-1.5">
                <p className="text-sm text-navy-900 break-words">{prop.value}</p>
                <p className="text-[11px] text-slate-500">
                  {[
                    prop.label,
                    prop.amount !== null ? `bought for ${formatMoney(prop.amount)}` : null,
                    prop.seenOn ? `registered ${formatDate(prop.seenOn)}` : null,
                  ].filter(Boolean).join(' \u00b7 ')}
                </p>
              </div>
            ))}
            {onOpenTrace && (
              <button type="button" onClick={onOpenTrace}
                className="mt-1.5 text-[11px] font-medium text-[var(--c-steel)] hover:underline">
                Where this came from
              </button>
            )}
          </div>
        </div>
      )}

      {/*
        NEXT OF KIN AND ANYBODY ELSE WITH A NAME, on an individual.

        The firm's report was "I'm not seeing a next of kin... under the debtor's details there
        should be something that says additional contact people or next of kin". They were being
        stored correctly and shown nowhere: the block below this runs for companies only, and an
        individual's numbers are listed flat because they are all the debtor's.

        They are not all the debtor's. A relative promoted off a trace carries their own name, and
        that row is the one nobody must dial thinking they have the debtor on the line.
      */}
      {kin.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Other people on this account</p>
          {kin.map((group) => (
            <div key={group.person ?? ''}>
              <p className="text-sm font-medium text-slate-800">
                {group.person}
                {group.role && <span className="ml-1.5 text-[11px] font-normal text-slate-500">{group.role}</span>}
              </p>
              <div className="space-y-1 mt-0.5">
                {group.contacts.map((c) => (
                  /*
                    A PERSON WE HAVE A NAME FOR AND NO NUMBER FOR. Promoting a relative off a trace
                    stores their NAME as the contact — that is all the bureau gave — so the row
                    would read "Caleb Maistry / Caleb Maistry". Saying it once and saying what is
                    missing is the useful version.
                  */
                  <div key={c.id}>
                    {c.value === group.person ? (
                      <p className="text-[11px] text-slate-400">
                        No number yet{c.label ? ` \u00b7 ${c.label}` : ''}
                      </p>
                    ) : (
                      <ContactValue contact={c} userId={userId} busy={busy} run={run}
                        onOpen={c.kind === 'email' ? () => onEmail(c.value) : undefined} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/*
        WHO TO ASK FOR — a company only, and the reason is the whole difference between the two
        kinds of account.

        On an individual every number is the debtor's and saying so is noise. On a company it is
        the question a collector has to answer before they dial: four numbers in a flat list is
        four numbers and a guess, and the call opens with the wrong name.

        Grouped by the person the number belongs to, with the company's own switchboard and
        registered details first because they belong to nobody in particular.
      */}
      {isCompany && people.length === 0 && (
        <p className="mt-3 pt-3 border-t border-slate-100 text-sm text-slate-400">
          Nobody to ask for yet. A company is reached through a person &mdash; add one, or upload a
          director&rsquo;s trace and promote a number off it.
        </p>
      )}

      {isCompany && people.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Who to ask for</p>
          {people.map((group) => (
            <div key={group.person ?? 'the company'}>
              <p className="text-sm font-medium text-slate-800">
                {group.person ?? 'The company'}
                {group.role && <span className="ml-1.5 text-[11px] font-normal text-slate-500">{group.role}</span>}
              </p>
              <div className="space-y-1 mt-0.5">
                {group.contacts.map((c) => (
                  <div key={c.id} className="flex items-start gap-1.5">
                    <div className="min-w-0 flex-1">
                      {/*
                        A PERSON WE HAVE A NAME FOR AND NO NUMBER FOR.
                        Promoting a relative off a trace stores their NAME as the contact — that is
                        all the bureau gave — so the row read "Nomsa Radebe / Nomsa Radebe". Saying
                        it once and saying what is missing is the useful version: finding the
                        number is the next piece of work, and this is where somebody would look.
                      */}
                      {c.value === group.person ? (
                        <p className="text-[11px] text-slate-400">
                          No number yet{c.label ? ` · ${c.label}` : ''}
                        </p>
                      ) : (
                        <ContactValue contact={c} userId={userId} busy={busy} run={run}
                          onOpen={c.kind === 'email' ? () => onEmail(c.value) : undefined} />
                      )}
                    </div>
                    {/*
                      The one the Call button dials, marked where the numbers are. It is the only
                      thing on this list that decides what happens when somebody presses Call.
                    */}
                    {c.isPrimary && (
                      <span className="text-[10px] px-1.5 rounded bg-gold-50 text-[var(--c-gold-deep)] shrink-0 mt-0.5">
                        Primary
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/*
        Numbers beyond the two slots above. An account can carry several.
        Not on a company: they are already listed above, under whoever they belong to.
      */}
      {!isCompany && phones.length > 2 && (
        <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Other numbers</p>
          {phones.slice(2).map((c) => (
            <ContactValue key={c.id} contact={c} userId={userId} busy={busy} run={run} />
          ))}
        </div>
      )}

      {retired.length > 0 && (
        <details className="mt-3 pt-3 border-t border-slate-100">
          <summary className="text-[11px] text-slate-400 cursor-pointer hover:text-slate-600">
            {retired.length} retired
          </summary>
          <div className="space-y-1.5 mt-2">
            {retired.map((c) => (
              <p key={c.id} className="text-xs text-slate-400 line-through decoration-slate-300">
                {c.value}
                {c.retiredReason && <span className="no-underline ml-1.5">&mdash; {c.retiredReason}</span>}
              </p>
            ))}
          </div>
        </details>
      )}
    </Card>
  )
}

function SlotShell({ icon, label, children, hint }: {
  icon: keyof typeof SLOT_ICON; label: string; children: React.ReactNode; hint?: string
}) {
  const Icon = SLOT_ICON[icon]
  return (
    <div className="flex gap-2.5">
      <Icon size={14} className="text-slate-300 mt-1 shrink-0" />
      <div className="min-w-0 flex-1">
        <dt className="text-[11px] text-slate-400" title={hint}>{label}</dt>
        <dd className="text-sm text-slate-800 break-words">{children}</dd>
      </div>
    </div>
  )
}

/** A blank we cannot fill: said plainly, so it reads as missing rather than as broken. */
const Blank = ({ onAdd }: { onAdd?: () => void }) =>
  onAdd
    ? <button onClick={onAdd} className="text-slate-300 hover:text-brand-600 hover:underline">Not recorded</button>
    : <span className="text-slate-300">Not recorded</span>

/**
 * A field you can correct in place.
 *
 * Everything on this panel arrived from an export or from a phone call, and both are wrong
 * sometimes — 89 of the 735 imported "ID numbers" were not ID numbers. A detail panel you can
 * only read is a panel that stays wrong.
 */
function TextSlot({ icon, label, value, onSave, busy, placeholder, warn, hint }: {
  icon: keyof typeof SLOT_ICON
  label: string
  value?: string | null
  onSave: (v: string) => void
  busy: boolean
  placeholder?: string
  /** Returns a caution to show while editing, or null. Never blocks the save. */
  warn?: (v: string) => string | null
  hint?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => setDraft(value ?? ''), [value])

  if (!editing) {
    return (
      <SlotShell icon={icon} label={label} hint={hint}>
        <button onClick={() => setEditing(true)}
          className={`text-left hover:underline ${value ? '' : 'text-slate-300 hover:text-brand-600'}`}>
          {value || 'Not recorded'}
        </button>
      </SlotShell>
    )
  }
  const caution = warn?.(draft) ?? null
  return (
    <SlotShell icon={icon} label={label} hint={hint}>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoFocus
        placeholder={placeholder}
        aria-label={label}
        className="w-full text-sm rounded-lg border border-slate-200 px-2 py-1 mt-0.5"
      />
      {caution && <span className="block text-[11px] text-gold-600 mt-0.5">{caution}</span>}
      <span className="flex items-center gap-2 mt-1.5">
        <button disabled={busy} onClick={() => { onSave(draft); setEditing(false) }}
          className="text-[11px] font-medium px-2 py-1 rounded bg-brand-600 text-white disabled:opacity-50">
          Save
        </button>
        <button onClick={() => { setDraft(value ?? ''); setEditing(false) }}
          className="text-[11px] text-slate-500 hover:text-slate-700">Cancel</button>
      </span>
    </SlotShell>
  )
}

/** The name, plus the title and initials a letter of demand needs to address someone properly. */
function NameSlot({ account, name, onSave, busy }: {
  account: DebtorAccount
  name: string
  onSave: (p: { firstName?: string; surname?: string; title?: string; initials?: string }) => void
  busy: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [first, setFirst] = useState(account.debtorFirstName ?? '')
  const [last, setLast] = useState(account.debtorSurname ?? '')
  const [title, setTitle] = useState(account.debtorTitle ?? '')
  const [initials, setInitials] = useState(account.debtorInitials ?? '')

  useEffect(() => {
    setFirst(account.debtorFirstName ?? ''); setLast(account.debtorSurname ?? '')
    setTitle(account.debtorTitle ?? ''); setInitials(account.debtorInitials ?? '')
  }, [account.debtorFirstName, account.debtorSurname, account.debtorTitle, account.debtorInitials])

  const formal = [account.debtorTitle, account.debtorInitials, account.debtorSurname].filter(Boolean).join(' ')

  if (!editing) {
    return (
      <SlotShell icon="name" label="Full Name">
        <button onClick={() => setEditing(true)} className="text-left hover:underline">
          {name}
        </button>
        {formal && formal !== name && <span className="block text-[11px] text-slate-400">{formal}</span>}
      </SlotShell>
    )
  }
  return (
    <SlotShell icon="name" label="Full Name">
      <span className="grid grid-cols-2 gap-1.5 mt-0.5">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" aria-label="Title"
          className="text-sm rounded-lg border border-slate-200 px-2 py-1" />
        <input value={initials} onChange={(e) => setInitials(e.target.value)} placeholder="Initials" aria-label="Initials"
          className="text-sm rounded-lg border border-slate-200 px-2 py-1" />
        <input value={first} onChange={(e) => setFirst(e.target.value)} autoFocus placeholder="First name" aria-label="First name"
          className="text-sm rounded-lg border border-slate-200 px-2 py-1" />
        <input value={last} onChange={(e) => setLast(e.target.value)} placeholder="Surname" aria-label="Surname"
          className="text-sm rounded-lg border border-slate-200 px-2 py-1" />
      </span>
      <span className="flex items-center gap-2 mt-1.5">
        <button disabled={busy}
          onClick={() => { onSave({ firstName: first, surname: last, title, initials }); setEditing(false) }}
          className="text-[11px] font-medium px-2 py-1 rounded bg-brand-600 text-white disabled:opacity-50">Save</button>
        <button onClick={() => setEditing(false)} className="text-[11px] text-slate-500 hover:text-slate-700">Cancel</button>
      </span>
    </SlotShell>
  )
}

function ContactSlot({ icon, label, contact, onAdd, userId, busy, run, onOpen }: {
  icon: keyof typeof SLOT_ICON
  label: string
  contact?: AccountContact
  onAdd: () => void
  userId: string | null
  busy: boolean
  run: (fn: () => Promise<unknown>) => Promise<boolean>
  onOpen?: () => void
}) {
  return (
    <SlotShell icon={icon} label={label}>
      {contact
        ? <ContactValue contact={contact} userId={userId} busy={busy} run={run} onOpen={onOpen} />
        : <Blank onAdd={onAdd} />}
    </SlotShell>
  )
}

function ContactValue({ contact, userId, busy, run, onOpen }: {
  contact: AccountContact
  userId: string | null
  busy: boolean
  run: (fn: () => Promise<unknown>) => Promise<boolean>
  onOpen?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(contact.value)
  const [label, setLabel] = useState(contact.label ?? '')
  useEffect(() => { setDraft(contact.value); setLabel(contact.label ?? '') }, [contact.value, contact.label])

  if (editing) {
    return (
      <div>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus aria-label="Value"
          className="w-full text-sm rounded-lg border border-slate-200 px-2 py-1" />
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Whose is it? (optional)" aria-label="Label"
          className="w-full text-sm rounded-lg border border-slate-200 px-2 py-1 mt-1.5" />
        <div className="flex items-center gap-2 mt-1.5">
          <button disabled={busy || !draft.trim()}
            onClick={async () => {
              const ok = await run(() => updateContact(contact.id, { value: draft, label }))
              if (ok) setEditing(false)
            }}
            className="text-[11px] font-medium px-2 py-1 rounded bg-brand-600 text-white disabled:opacity-50">Save</button>
          <button onClick={() => { setDraft(contact.value); setLabel(contact.label ?? ''); setEditing(false) }}
            className="text-[11px] text-slate-500 hover:text-slate-700">Cancel</button>
        </div>
      </div>
    )
  }

  const dialable = contact.kind === 'mobile' || contact.kind === 'phone' || contact.kind === 'work'
  return (
    <div>
      <div className="flex items-start gap-2">
        {dialable
          // A phone hands off to the device's dialler, which is what a tablet is good at —
          // unless BuzzBox is connected, in which case the PABX rings the agent's desk phone instead.
          ? <PhoneLink number={contact.value} className="text-brand-700 hover:underline break-words">{contact.value}</PhoneLink>
          : onOpen
            ? <button onClick={onOpen} className="text-brand-700 hover:underline break-words text-left">{contact.value}</button>
            : <span className="break-words">{contact.value}</span>}
        {contact.verifiedAt && (
          <span className="text-[10px] px-1.5 rounded bg-positive-50 text-positive-700 inline-flex items-center gap-0.5 shrink-0 mt-0.5">
            <ShieldCheck size={9} /> Verified
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {contact.label && <span className="text-[11px] text-slate-400">{contact.label}</span>}
        {/*
          None of these are hover-only. The tablets this is worked on have no hover, so a control
          revealed by it is a control that does not exist for the people who need it.
        */}
        <button onClick={() => setEditing(true)} className="text-[10px] text-slate-400 hover:text-brand-600">edit</button>
        {!contact.verifiedAt && (
          <button disabled={busy} onClick={() => run(() => verifyContact(contact.id, userId))}
            className="text-[10px] text-slate-400 hover:text-positive-700 disabled:opacity-50">
            mark verified
          </button>
        )}
        <button disabled={busy}
          onClick={() => {
            const reason = window.prompt('Why is this being retired? (wrong number, disconnected, ...)')
            if (reason !== null) run(() => retireContact(contact.id, reason))
          }}
          className="text-[10px] text-slate-400 hover:text-negative disabled:opacity-50">
          retire
        </button>
      </div>
    </div>
  )
}

/** A single-valued field on the account itself: pick from the usual answers, or type one. */
function EditableSlot({ icon, label, value, options, onSave, busy, hint }: {
  icon: keyof typeof SLOT_ICON
  label: string
  value: string | null
  options: string[]
  onSave: (v: string) => void
  busy: boolean
  hint?: string
}) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <SlotShell icon={icon} label={label} hint={hint}>
        <select autoFocus defaultValue={value ?? ''} disabled={busy}
          onChange={(e) => { onSave(e.target.value); setEditing(false) }}
          onBlur={() => setEditing(false)}
          className="w-full text-sm rounded-lg border border-slate-200 px-2 py-1 bg-white mt-0.5">
          <option value="">Not recorded</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </SlotShell>
    )
  }
  return (
    <SlotShell icon={icon} label={label} hint={hint}>
      <button onClick={() => setEditing(true)}
        className={value ? 'hover:underline text-left' : 'text-slate-300 hover:text-brand-600 hover:underline'}>
        {value || 'Not recorded'}
      </button>
    </SlotShell>
  )
}

export function ContactForm({ accountId, initialKind, busy, onDone, run, forCompany }: {
  accountId: string
  initialKind: ContactKind
  busy: boolean
  onDone: () => void
  run: (fn: () => Promise<unknown>) => Promise<boolean>
  /**
   * Whether this account is a company, which changes what the third field is asking.
   *
   * It used to be one free-text box captioned "Whose is it?", and on a company that is the most
   * important thing on the form — the person to ask for — typed into a caption nothing can group
   * by. Here it is a name and a job title, in the columns the panel reads.
   */
  forCompany?: boolean
}) {
  const [kind, setKind] = useState<ContactKind>(initialKind)
  const [value, setValue] = useState('')
  const [label, setLabel] = useState('')
  const [person, setPerson] = useState('')
  const [role, setRole] = useState('')
  useEffect(() => setKind(initialKind), [initialKind])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!value.trim()) return
    const ok = await run(() => addContact({
      accountId, kind, value,
      label: forCompany ? null : label,
      personName: forCompany ? person : null,
      personRole: forCompany ? role : null,
    }))
    if (ok) { setValue(''); setLabel(''); setPerson(''); setRole(''); onDone() }
  }

  return (
    <form onSubmit={submit} className="mb-3 space-y-2 p-3 rounded-lg bg-slate-50 border border-slate-100">
      <select value={kind} onChange={(e) => setKind(e.target.value as ContactKind)}
        className="w-full text-sm rounded-lg border border-slate-200 px-2 py-1.5 bg-white">
        {CONTACT_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
      </select>
      <input value={value} onChange={(e) => setValue(e.target.value)} autoFocus
        placeholder={kind === 'email' ? 'name@example.co.za' : kind === 'address' ? 'Street, suburb, city' : '+27 ...'}
        className="w-full text-sm rounded-lg border border-slate-200 px-2 py-1.5" />
      {forCompany ? (
        <>
          {/* Left blank, it belongs to the company itself — a switchboard, the general mailbox. */}
          <input value={person} onChange={(e) => setPerson(e.target.value)}
            placeholder="Who do you ask for? (blank = the company)"
            className="w-full text-sm rounded-lg border border-slate-200 px-2 py-1.5" />
          <input value={role} onChange={(e) => setRole(e.target.value)}
            placeholder="What do they do there? (optional)"
            className="w-full text-sm rounded-lg border border-slate-200 px-2 py-1.5" />
        </>
      ) : (
        <input value={label} onChange={(e) => setLabel(e.target.value)}
          placeholder="Whose is it? (optional)"
          className="w-full text-sm rounded-lg border border-slate-200 px-2 py-1.5" />
      )}
      <button type="submit" disabled={busy || !value.trim()}
        className="w-full text-sm font-medium py-1.5 rounded-lg bg-brand-600 text-white disabled:opacity-50">
        {busy ? 'Saving...' : 'Save'}
      </button>
    </form>
  )
}

/* ================= Documents ================= */

const KB = 1024
const fileSize = (n: number | null) =>
  n === null ? '' : n < KB ? `${n} B` : n < KB * KB ? `${Math.round(n / KB)} KB` : `${(n / KB / KB).toFixed(1)} MB`

/**
 * The paperwork.
 *
 * Files sit in a private bucket and open through a signed URL that lasts a minute. A debtor's ID
 * copy behind a permanent public address is a POPIA breach waiting to be found, so there is no
 * permanent address to copy.
 */
export function DocumentsPanel({ accountId, documents, onChange, userId, userName, canDelete, onUploadTrace }: {
  accountId: string
  documents: AccountDocument[]
  onChange: () => Promise<void>
  userId: string | null
  userName: string | null
  canDelete: boolean
  /**
   * Opens the trace reader instead of picking a file.
   *
   * A trace is the one kind that should never be filed unread: the firm paid for the search, and
   * the point is the facts inside it. Optional, so a screen that has no reader to open simply
   * offers the kind and files the PDF.
   */
  onUploadTrace?: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [kind, setKind] = useState<string>(DOCUMENT_KINDS[0])
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<AccountDocument | null>(null)

  async function onPick(files: FileList | null) {
    if (!files?.length) return
    setUploading(true); setErr(null)
    try {
      // One at a time, in order, so a failure names the file that failed.
      for (const file of Array.from(files)) {
        await uploadDocument({ accountId, file, kind, uploadedBy: userId, uploadedByName: userName })
      }
      await onChange()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function open(doc: AccountDocument) {
    setOpening(doc.id); setErr(null)
    try {
      window.open(await documentUrl(doc.storagePath), '_blank', 'noopener')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setOpening(null)
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="font-semibold text-[15px] text-slate-800">Documents</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {documents.length === 0 ? 'Nothing filed on this account yet.'
              : `${documents.length} file${documents.length === 1 ? '' : 's'} on this account.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={kind} onChange={(e) => setKind(e.target.value)}
            className="text-sm rounded-lg border border-slate-200 px-2 py-1.5 bg-white">
            {DOCUMENT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input ref={fileRef} type="file" multiple className="hidden"
            onChange={(e) => onPick(e.target.files)} />
          <button
            onClick={() => (kind === TRACE_KIND && onUploadTrace ? onUploadTrace() : fileRef.current?.click())}
            disabled={uploading}
            className="text-sm font-medium px-3 py-1.5 rounded-lg bg-brand-600 text-white disabled:opacity-50 inline-flex items-center gap-1.5">
            {uploading ? <><Loader2 size={13} className="animate-spin" /> Uploading...</>
              : <><Upload size={13} /> {kind === TRACE_KIND && onUploadTrace ? 'Read the trace' : 'Upload'}</>}
          </button>
        </div>
      </div>

      {err && <p className="text-sm text-negative-700 mb-3">{err}</p>}

      {documents.length === 0 ? (
        <p className="text-sm text-slate-400 py-8 text-center">
          Mandates, acknowledgements of debt, letters, proof of payment, traces &mdash; anything
          that belongs on the file. PDFs and images.
        </p>
      ) : (
        <div className="divide-y divide-slate-50">
          {documents.map((d) => (
            <div key={d.id} className="flex items-center gap-3 py-2.5 group">
              <FileText size={16} className="text-slate-300 shrink-0" />
              <div className="min-w-0 flex-1">
                <button onClick={() => open(d)} className="text-sm text-slate-800 hover:text-brand-600 hover:underline text-left break-words">
                  {d.name}
                </button>
                <p className="text-[11px] text-slate-400">
                  {[d.kind, fileSize(d.sizeBytes), formatDate(d.createdAt), d.uploadedByName].filter(Boolean).join(' · ')}
                </p>
              </div>
              <button onClick={() => open(d)} disabled={opening === d.id}
                className="text-slate-400 hover:text-brand-600 shrink-0 disabled:opacity-50" title="Open">
                {opening === d.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              </button>
              {canDelete && (
                // Always visible. This was hidden until hover, which on a tablet means hidden
                // for ever — there is no hover on a touch screen, so the control did not exist
                // for the people who actually use this page.
                <button onClick={() => setDeleting(d)}
                  className="text-slate-300 hover:text-negative shrink-0 p-1" title={`Delete ${d.name}`}
                  aria-label={`Delete ${d.name}`}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {deleting && (
        <ConfirmDelete
          doc={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            try { await deleteDocument(deleting); setDeleting(null); await onChange() }
            catch (e) { setErr(e instanceof Error ? e.message : String(e)); setDeleting(null) }
          }}
        />
      )}
    </Card>
  )
}

/**
 * Deleting a document, deliberately made harder than pressing a button.
 *
 * The file is gone from storage as well as from the list, and a letter of demand nobody can
 * produce is a letter that was never sent as far as a court is concerned. So this asks for the
 * word to be typed: a misplaced tap cannot spell it, and a person who types DELETE has read the
 * name of the file they are about to destroy.
 */
function ConfirmDelete({ doc, onCancel, onConfirm }: {
  doc: AccountDocument
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const ok = typed.trim().toUpperCase() === 'DELETE'
  return (
    <div className="mt-4 p-4 rounded-lg border border-negative-100 bg-negative-50">
      <p className="text-sm font-medium text-negative-700">Delete this document?</p>
      <p className="text-sm text-slate-700 mt-1 break-words">{doc.name}</p>
      <p className="text-xs text-slate-500 mt-2">
        The file is removed from storage as well as from this list, and it cannot be brought back.
        Type <span className="font-mono font-semibold">DELETE</span> to confirm.
      </p>
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoFocus
          placeholder="DELETE"
          aria-label="Type DELETE to confirm"
          className="text-sm rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono w-32 bg-white"
        />
        <button
          disabled={!ok || busy}
          onClick={async () => { setBusy(true); await onConfirm() }}
          className="text-sm font-medium px-3 py-1.5 rounded-lg bg-negative text-white disabled:opacity-40"
        >
          {busy ? 'Deleting...' : 'Delete for good'}
        </button>
        <button onClick={onCancel} className="text-sm text-slate-600 hover:text-slate-800 px-2">Cancel</button>
      </div>
    </div>
  )
}

/* ================= Main comment ================= */

/**
 * The standing summary of what is going on with this account.
 *
 * Rewritten rather than appended to, which is what separates it from a note: a note is dated
 * evidence of what was said on a day and is never edited; this is the current state of play, and
 * the current state of play is meant to be replaced. Whoever picks the account up reads this
 * first and the timeline second.
 */
export function MainComment({ account, onSave, busy }: {
  account: DebtorAccount
  onSave: (text: string) => Promise<unknown>
  busy: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(account.mainComment ?? '')

  useEffect(() => setDraft(account.mainComment ?? ''), [account.mainComment])

  if (editing) {
    return (
      <Card className="border-gold-100 bg-gold-50">
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus rows={3}
          placeholder="What is going on with this account? Two lines is plenty."
          className="w-full text-sm rounded-lg border border-gold-100 px-3 py-2 resize-none bg-white focus:outline-none focus:ring-2 focus:ring-gold-100" />
        {/* Talk it instead of typing it. Free, built into the browser — see Dictate.tsx. */}
        <div className="mt-2">
          <DictateButton size="small" value={draft} onChange={setDraft} />
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button disabled={busy}
            onClick={async () => { await onSave(draft); setEditing(false) }}
            className="text-sm font-medium px-3 py-1.5 rounded-lg bg-brand-600 text-white disabled:opacity-50 inline-flex items-center gap-1.5">
            <Check size={13} /> {busy ? 'Saving...' : 'Save'}
          </button>
          <button onClick={() => { setDraft(account.mainComment ?? ''); setEditing(false) }}
            className="text-sm text-slate-500 hover:text-slate-700">Cancel</button>
        </div>
      </Card>
    )
  }

  return (
    <Card className={account.mainComment ? 'border-gold-100 bg-gold-50' : 'border-dashed'}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-gold-600 font-semibold">Main comment</p>
          {account.mainComment
            ? <p className="text-sm text-navy-900 mt-1 whitespace-pre-wrap">{account.mainComment}</p>
            : <p className="text-sm text-slate-400 mt-1">
                No summary yet. Write the two lines the next person needs before they read anything else.
              </p>}
          {account.mainCommentAt && (
            <p className="text-[11px] text-slate-400 mt-1.5">Updated {formatDate(account.mainCommentAt)}</p>
          )}
        </div>
        <button onClick={() => setEditing(true)} className="text-xs text-brand-600 hover:underline shrink-0">
          {account.mainComment ? 'Edit' : 'Write one'}
        </button>
      </div>
    </Card>
  )
}
