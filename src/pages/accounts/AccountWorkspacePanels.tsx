import { useEffect, useRef, useState } from 'react'
import {
  Building2, Check, Clock, Download, FileText, Globe, IdCard, Loader2, Mail, MapPin, MessageCircle,
  Phone, Plus, ShieldCheck, Smartphone, Trash2, Upload, User, X, Home
} from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { PhoneLink } from '../../components/PhoneLink'
import { formatDate, formatMoney } from '../../data/mockData'
import type { DebtorAccount } from '../../lib/accountBook'
import { fullDebtorName } from '../../lib/debtorName.ts'
import { identityProblem, kindFromIdentity } from '../../lib/debtorIdentity.ts'
import {
  addContact, deleteDocument, openDocument, retireContact, saveDebtorIdentity, saveDebtorPreferences,
  updateContact, uploadDocument, verifyContact, CONTACT_KINDS, DOCUMENT_KINDS, TRACE_KIND,
  dialableNumber,
  type AccountContact, type AccountDocument, type ContactKind, type Workspace,
} from '../../lib/accountWorkspace'
import { chargeMessage, PERUSAL_ITEM_ID } from '../../lib/accountCharges.ts'
import { DictateButton } from '../../components/ui/Dictate'
import { contactWhat, contactsByPerson, otherPeople } from '../../lib/contactPeople.ts'
import { debtorSlots, ringsOnCall } from '../../lib/debtorSlots.ts'
import {
  describeWindows, insideWindow, parseWindows, windowProblem, withWindow, withoutWindow,
  type ContactWindow,
} from '../../lib/contactWindows.ts'
import { firmClock } from '../../lib/dateLabels.ts'
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
  name: User, id: IdCard, mobile: Smartphone, alt: Smartphone, work: Phone, email: Mail,
  address: MapPin, employer: Building2, language: Globe, preference: MessageCircle,
  /* A SECOND CELLPHONE IS A CELLPHONE AND A WORK LINE IS NOT. The alternative slot used to wear
     the handset the landline wears, which drew a second mobile as though it were a switchboard. */
  hours: Clock, consent: ShieldCheck,
} as const

export function DebtorDetailsPanel({ account, name, workspace, properties, onChange, userId, onEmail, onEmailChanged, onOpenTrace }: {
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
  /**
   * THE EMAIL ADDRESS WAS CORRECTED, AND SOMETHING MAY HAVE BEEN SERVED ON THE OLD ONE.
   *
   * THE FIRM: "when you've changed the primary email address, it should ask you, do you want to
   * restart the Section 129 process?" The page decides whether to ask -- it is the one holding the
   * account's runs -- and this is the panel saying what changed. See reissueNotice.ts.
   *
   * ONLY THE EMAIL SLOT, and not because the other rows matter less. A section 129 is served by
   * EMAIL; the SMS behind it tells the debtor to go and read it, so a wrong mobile costs the
   * nudge and not the service. Offering to re-serve a statutory demand because somebody fixed a
   * telephone number would be the warning that fires when nothing is wrong.
   */
  onEmailChanged?: (before: string, after: string) => void
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
  /*
   * THE SLOTS ARE BY KIND, AND THE RULE IS ITS OWN MODULE.
   *
   * THE FIRM: "it's important to show that a debtor has a mobile primary number. He could have a
   * secondary number, mobile. Then a work number... I'd say a work number, because nobody has a
   * home number anymore. So an email address, there should be a second, an alternative email
   * address."
   *
   * WHAT IT REPLACES WAS "THE NEXT NUMBER, WHATEVER IT IS" -- one slot labelled "Alternative
   * number" holding the first phone that was not the primary, so which of a second cellphone and
   * a work line appeared was decided by the order the rows came back in. See debtorSlots.ts; the
   * reasoning, and the reason a home number keeps its chip rather than a slot, lives there.
   *
   * 105 ACCOUNTS ON THE BOOK CARRY MORE THAN ONE EMAIL ADDRESS -- the firm: "if a debtor has more
   * than one email address, it should be shown. It's important. If they have, for example, a work
   * and a personal one" -- so the second has a slot of its own now rather than a list underneath.
   */
  const slots = debtorSlots(live)
  // Shared with the action bar's Call button, so both ring the same number.
  const primaryPhone = dialableNumber(live)
  const windows = parseWindows(account.contactWindows)

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

      {/*
        WHICH ONE THIS DEBTOR IS, and until now nothing could say.

        The column has existed since the book was imported and there was no way to write to it, so
        three accounts said "company" and the rest defaulted to "individual" — including sixteen
        holding a registration number in the ID field and named "(Pty) Ltd". The whole panel turns
        on this: what it is called, what the identity field is called, whether contacts are the
        debtor's own numbers or the people who answer for a company, and what a trace is searched
        on. It is one click because the consequence of getting it wrong is visible immediately.
      */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-[11px] text-slate-400">This debtor is</span>
        <div className="flex rounded-lg border border-slate-200 p-0.5">
          {([['individual', 'A person'], ['company', 'A company']] as const).map(([kind, label]) => (
            <button key={kind} type="button" disabled={busy}
              onClick={() => { if (account.debtorKind !== kind) run(() => saveDebtorIdentity(account.id, { debtorKind: kind })) }}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${
                account.debtorKind === kind ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-700'
              }`}>
              {label}
            </button>
          ))}
        </div>
        {/*
          SUGGESTED, NEVER SWITCHED. A registration number in the identity field is proof of a
          company, but flipping the account under somebody mid-call would relabel the panel and
          refuse their trace search without anybody asking for it. The screen points; a person
          decides.
        */}
        {!isCompany && kindFromIdentity(account.debtorIdNumber) === 'company' && (
          <span className="text-[11px] text-gold-700">
            That identity number is a company registration number.
          </span>
        )}
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
        <NameSlot account={account} name={name} isCompany={isCompany} busy={busy}
          onSave={(p) => run(() => saveDebtorIdentity(account.id, p))} />
        {/*
          INITIALS, BESIDE THE NAME AND NOT INSIDE IT. The firm asked for one "Full name" line
          rather than five parts — and this is the one part that keeps its own field, because it
          is the one an import gets wrong: the client sheet we were sent carried every one of its
          45 SURNAMES in "Debtor Initials", and Raptor addresses a debtor by surname. Read next to
          the name it came from, a surname sitting here is obvious.

          A COMPANY HAS NONE. It has a name, not a person's shape — the same rule that keeps
          "Residential Address" off a company below.
        */}
        {!isCompany && (
          <TextSlot icon="name" label="Initials" value={account.debtorInitials} busy={busy}
            placeholder="R"
            onSave={(v) => run(() => saveDebtorIdentity(account.id, { initials: v }))} />
        )}
        <TextSlot icon="id" label={isCompany ? 'Registration number' : 'ID number'}
          value={account.debtorIdNumber} busy={busy}
          placeholder={isCompany ? 'nnnn/nnnnnn/07' : '13 digits'}
          /*
            Said, not enforced. Some records are foreign passports, some clients send a VAT number
            by mistake, and refusing to store what a collector was actually given loses the only
            thing anybody has to work from. identityProblem names what it looks like instead — a
            registration number in a person's field, a telephone number in either — because "not
            valid" sends somebody hunting for a typo while the name says which field it belongs in.
          */
          warn={(v) => identityProblem(account.debtorKind, v)}
          onSave={(v) => run(() => saveDebtorIdentity(account.id, { idNumber: v }))} />

        {/*
          FIXED SLOTS ARE A PERSON'S SHAPE, AND A COMPANY DOES NOT HAVE IT.
          "Mobile (Primary)", "Alternative number", "Residential address", "Employer" — every one
          of those is a fact about a human being. On a company they led the panel with a number
          nobody could attribute: a collector saw 083 000 0148 and had no way to know whether to
          ask for the accounts manager or a director. Everything a company is reached on belongs to
          somebody, so on a company it all lives under them in "Who to ask for" below.
        */}
        {!isCompany && (
          <>
            <ContactSlot icon="mobile" label="Mobile (Primary)" contact={slots.primaryMobile}
              onAdd={() => setAddKind('mobile')} userId={userId} busy={busy} run={run} />
            <ContactSlot icon="alt" label="Mobile (Second)" contact={slots.secondMobile}
              onAdd={() => setAddKind('mobile')} userId={userId} busy={busy} run={run} />
            {/*
              THE SWITCHBOARD, AND WHETHER IT IS THE ONE CALL RINGS.

              `dialableNumber` picks across all three kinds, so on an account whose only number is
              a work line the Call button rings it while "Mobile (Primary)" sits empty above --
              correct, and unreadable unless this slot says so. The badge appears only in that
              case; where the primary mobile is the one dialled, its own label already says it.
            */}
            <ContactSlot icon="work" label="Work number" contact={slots.workNumber}
              badge={ringsOnCall(slots.workNumber, primaryPhone) ? 'Call rings this' : undefined}
              onAdd={() => setAddKind('work')} userId={userId} busy={busy} run={run} />
            <ContactSlot icon="email" label="Email address" contact={slots.email}
              onAdd={() => setAddKind('email')} userId={userId} busy={busy} run={run}
              onOpen={slots.email ? () => onEmail(slots.email!.value) : undefined}
              /*
                ONLY THE FIRST ADDRESS OFFERS TO RE-SERVE. A section 129 goes out on the address in
                THIS slot, so correcting it is what may have left a statutory demand sitting in a
                mailbox nobody reads. Correcting the alternative below changes nothing that was
                served. See reissueNotice.ts.
              */
              onValueChanged={onEmailChanged} />
            <ContactSlot icon="email" label="Alternative email" contact={slots.altEmail}
              onAdd={() => setAddKind('email')} userId={userId} busy={busy} run={run}
              onOpen={slots.altEmail ? () => onEmail(slots.altEmail!.value) : undefined} />
            <ContactSlot icon="address" label="Residential address" contact={slots.address}
              onAdd={() => setAddKind('address')} userId={userId} busy={busy} run={run} />
            <ContactSlot icon="employer" label="Employer" contact={slots.employer}
              onAdd={() => setAddKind('employer')} userId={userId} busy={busy} run={run} />
          </>
        )}

        <EditableSlot icon="language" label="Preferred language" value={account.preferredLanguage}
          options={['English', 'Afrikaans', 'isiZulu', 'isiXhosa', 'Sesotho', 'Setswana', 'Sepedi', 'Xitsonga', 'siSwati', 'Tshivenda', 'isiNdebele']}
          onSave={(v) => run(() => saveDebtorPreferences(account.id, { preferredLanguage: v }))} busy={busy} />
        <EditableSlot icon="preference" label="Contact preference" value={account.contactPreference}
          options={['Phone', 'Phone, WhatsApp', 'WhatsApp', 'SMS', 'Email', 'Post', 'Do not contact']}
          onSave={(v) => run(() => saveDebtorPreferences(account.id, { contactPreference: v }))} busy={busy} />
        {/*
          AND WHEN, WHICH IS A DIFFERENT QUESTION FROM HOW.

          THE FIRM: "maybe we can add something like there, contact time, between certain hours,
          and then you can choose the two hours and then add a different schedule -- for example
          the debtor likes to be contacted between 8 and 9, and 7 and 5." Two windows rather than
          one range, because somebody reachable before work and again after it is not reachable
          all day.
        */}
        <WindowsSlot windows={windows} busy={busy}
          onSave={(next) => run(() => saveDebtorPreferences(account.id, { contactWindows: next }))} />
        <EditableSlot icon="consent" label="Consent status" value={account.consentStatus}
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
      {/*
        ONE LINE PER HOUSE. It was a boxed block with its own heading, its own detail line and its
        own link, and the firm's verdict was "very bulky and big" -- which it was: three rows of
        chrome around one fact. A flag has to be noticeable and small at the same time, so what is
        left is the word, the address and the price on one line, in gold because that is what makes
        it catch the eye at a glance.

        The whole row opens the trace it came from, which is what the separate link was for.
      */}
      {properties.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100 space-y-1">
          {properties.map((prop) => (
            <button key={prop.id} type="button" onClick={onOpenTrace ?? undefined}
              disabled={onOpenTrace === null}
              className={`w-full text-left flex items-baseline gap-1.5 text-[11px] rounded-md px-1.5 py-1 -mx-1.5 ${
                onOpenTrace ? 'hover:bg-gold-50' : ''}`}>
              <Home size={11} className="shrink-0 translate-y-0.5 text-[var(--c-gold-deep)]" />
              <span className="font-medium text-[var(--c-gold-deep)] shrink-0">Owns</span>
              <span className="text-slate-800 min-w-0 truncate">{prop.value}</span>
              {prop.amount !== null && (
                <span className="text-slate-400 shrink-0 ml-auto tabular-nums">{formatMoney(prop.amount)}</span>
              )}
            </button>
          ))}
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
        <div className="mt-3 pt-3 border-t border-slate-100 space-y-2 text-sm">
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
        <div className="mt-3 pt-3 border-t border-slate-100 space-y-3 text-sm">
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
        ADDRESSES BEYOND THE ONE SLOT ABOVE, the same way the numbers are handled below it — a
        work one and a personal one are both the debtor's, and which of them the slot happened to
        show was a coin toss until the ordering was fixed.

        Not on a company: a company's addresses belong to named people and are listed above, under
        whoever they belong to.
      */}
      {/*
        ANYTHING BEYOND THE SLOTS, under one heading rather than two.

        THE FIRM, of the block that used to sit here: "the other email addresses -- there's other
        email addresses here at the bottom now, so it's kind of any additional info can come under
        there." Which is what it is: a third address, a home line a trace turned up, a second
        switchboard. Each row says what it is -- contactWhat draws the chip -- so one heading over
        a mixed list reads better than two headings over one row each.

        THE SECOND EMAIL IS NOT HERE ANY MORE. It has a slot of its own above, which is the half of
        this the firm asked for first.
      */}
      {!isCompany && (slots.otherEmails.length > 0 || slots.otherNumbers.length > 0) && (
        <div className="mt-3 pt-3 border-t border-slate-100 space-y-2 text-sm">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Anything else on file</p>
          {slots.otherNumbers.map((c) => (
            <ContactValue key={c.id} contact={c} userId={userId} busy={busy} run={run} />
          ))}
          {slots.otherEmails.map((c) => (
            <ContactValue key={c.id} contact={c} userId={userId} busy={busy} run={run}
              onOpen={() => onEmail(c.value)} />
          ))}
        </div>
      )}

      {retired.length > 0 && (
        <details className="mt-3 pt-3 border-t border-slate-100">
          <summary className="text-[11px] text-slate-400 cursor-pointer hover:text-slate-600">
            {retired.length} no longer used
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

function SlotShell({ icon, label, children, hint, badge }: {
  icon: keyof typeof SLOT_ICON; label: string; children: React.ReactNode; hint?: string
  badge?: string
}) {
  const Icon = SLOT_ICON[icon]
  return (
    <div className="flex gap-2.5">
      <Icon size={14} className="text-slate-300 mt-1 shrink-0" />
      <div className="min-w-0 flex-1">
        <dt className="text-[11px] text-slate-400 flex items-center gap-1.5" title={hint}>
          {label}
          {badge && (
            <span className="text-[10px] px-1.5 rounded bg-gold-50 text-[var(--c-gold-deep)]">
              {badge}
            </span>
          )}
        </dt>
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

/**
 * THE NAME IS FIVE COLUMNS ON THE SHEET AND IT IS SHOWN AS ONE — until you press it.
 *
 * THE FIRM ASKED FOR THE PARTS AND THEN ASKED FOR THEM BACK TOGETHER. First: "I imported some of
 * this data, but it shows, for example, the full name Zanele Sithole. It doesn't show the surname
 * and the name, stuff like that." So the panel drew all five, which is how an import is checked —
 * the client sheet we were sent carried every one of its 45 surnames in "Debtor Initials", and
 * Raptor addresses a debtor by surname. Then, looking at it in use: "I know previously I told you
 * to separate the surname and the things, but rather do it like this. It looks better."
 *
 * NOTHING WAS LOST, IT MOVED ONE CLICK. Pressing the name opens the same four boxes it always
 * had, one per column, so which field holds what is still a thing anybody can see — and INITIALS
 * now has a slot of its own beside the name, because that is the column an import gets wrong.
 *
 * A BLANK IS STILL SHOWN AS A BLANK, which is this panel's rule everywhere else — a title nobody
 * recorded is why the firm found a section 129 of their own opening "Dear buitendag", and
 * fullDebtorName leaves it out rather than printing a gap.
 */
function NameSlot({ account, name, isCompany, onSave, busy }: {
  account: DebtorAccount
  name: string
  /** A company has a name, not a first name and a surname. It gets the one field it has. */
  isCompany: boolean
  onSave: (p: {
    firstName?: string; surname?: string; title?: string; initials?: string; secondName?: string
  }) => void
  busy: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [first, setFirst] = useState(account.debtorFirstName ?? '')
  const [last, setLast] = useState(account.debtorSurname ?? '')
  const [title, setTitle] = useState(account.debtorTitle ?? '')
  const [second, setSecond] = useState(account.debtorSecondName ?? '')

  useEffect(() => {
    setFirst(account.debtorFirstName ?? ''); setLast(account.debtorSurname ?? '')
    setTitle(account.debtorTitle ?? ''); setSecond(account.debtorSecondName ?? '')
  }, [account.debtorFirstName, account.debtorSurname, account.debtorTitle,
    account.debtorSecondName])

  if (!editing) {
    /* Title included: "Mr Ryno Buitendag" is the name, and a missing title is a fact about the
       account worth seeing at rest rather than only in the editor. */
    const full = isCompany ? name : fullDebtorName(account)
    return (
      <SlotShell icon="name" label={isCompany ? 'Business name' : 'Full name'}>
        <button onClick={() => setEditing(true)}
          className="block w-full truncate text-left text-[13px] rounded hover:bg-slate-50 hover:underline">
          <span className={full ? 'text-slate-700' : 'text-slate-300'}>{full || 'Not recorded'}</span>
        </button>
      </SlotShell>
    )
  }
  return (
    <SlotShell icon="name" label={isCompany ? 'Business name' : 'Full name'}>
      {/*
        THE PARTS, ONE BOX EACH, WHICH IS WHERE CHECKING AN IMPORT NOW HAPPENS. Initials is not
        here: it has a slot of its own beside this one, and the same column written from two
        places is the thing CLAUDE.md is a list of.
      */}
      <span className="grid grid-cols-2 gap-1.5 mt-0.5">
        {/*
          SUGGESTED, NOT LOCKED. A letter that opens "Dear buitendag" is what a blank title looks
          like on paper, and the firm found exactly that on their own section 129 -- addressAs
          falls back to the surname alone when there is none. A datalist offers the ones anybody
          types without refusing Adv, Rev or a title nobody thought of.
        */}
        <datalist id="debtor-titles">
          {['Mr', 'Mrs', 'Ms', 'Miss', 'Dr', 'Prof', 'Adv', 'Rev'].map((x) => <option key={x} value={x} />)}
        </datalist>
        <input list="debtor-titles" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" aria-label="Title"
          className="text-sm rounded-lg border border-slate-200 px-2 py-1" />
        <input value={first} onChange={(e) => setFirst(e.target.value)} autoFocus placeholder="First name" aria-label="First name"
          className="text-sm rounded-lg border border-slate-200 px-2 py-1" />
        {/* The second given name. It has been imported and stored since the sheet had the column
            and there was nowhere to type it, which is how a field stops being true quietly. */}
        <input value={second} onChange={(e) => setSecond(e.target.value)} placeholder="Second name" aria-label="Second name"
          className="text-sm rounded-lg border border-slate-200 px-2 py-1" />
        <input value={last} onChange={(e) => setLast(e.target.value)} placeholder="Surname" aria-label="Surname"
          className="text-sm rounded-lg border border-slate-200 px-2 py-1" />
      </span>
      <span className="flex items-center gap-2 mt-1.5">
        <button disabled={busy}
          onClick={() => {
            onSave({ firstName: first, surname: last, title, secondName: second })
            setEditing(false)
          }}
          className="text-[11px] font-medium px-2 py-1 rounded bg-brand-600 text-white disabled:opacity-50">Save</button>
        <button onClick={() => setEditing(false)} className="text-[11px] text-slate-500 hover:text-slate-700">Cancel</button>
      </span>
    </SlotShell>
  )
}

function ContactSlot({ icon, label, contact, badge, onAdd, userId, busy, run, onOpen, onValueChanged }: {
  icon: keyof typeof SLOT_ICON
  label: string
  contact?: AccountContact | null
  /** Said beside the label where the slot holds something the label does not cover. */
  badge?: string
  onAdd: () => void
  userId: string | null
  busy: boolean
  run: (fn: () => Promise<unknown>) => Promise<boolean>
  onOpen?: () => void
  /** Told after a save that actually changed the value. See DebtorDetailsPanel.onEmailChanged. */
  onValueChanged?: (before: string, after: string) => void
}) {
  return (
    <SlotShell icon={icon} label={label} badge={contact ? badge : undefined}>
      {contact
        ? <ContactValue contact={contact} userId={userId} busy={busy} run={run} onOpen={onOpen}
            onValueChanged={onValueChanged} />
        : <Blank onAdd={onAdd} />}
    </SlotShell>
  )
}

function ContactValue({ contact, userId, busy, run, onOpen, onValueChanged }: {
  contact: AccountContact
  userId: string | null
  busy: boolean
  run: (fn: () => Promise<unknown>) => Promise<boolean>
  onOpen?: () => void
  /** Told after a save that actually changed the value. See DebtorDetailsPanel.onEmailChanged. */
  onValueChanged?: (before: string, after: string) => void
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
              /* READ BEFORE THE SAVE, because `contact` is re-rendered from the reloaded workspace
                 the moment `run` resolves -- taken afterwards this is the NEW value twice and
                 nothing ever looks changed. */
              const before = contact.value
              const ok = await run(() => updateContact(contact.id, { value: draft, label }))
              if (!ok) return
              setEditing(false)
              /* AND ONLY WHERE THE VALUE REALLY MOVED. Saving a label, or re-saving the same
                 address, is not a finding that anything failed to arrive. */
              if (before.trim() !== draft.trim()) onValueChanged?.(before, draft)
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
    /*
      THE SAME SIZE WHEREVER IT IS DRAWN. THE FIRM, looking at the addresses under the slots: "the
      script is really big -- it should be the same as the other one." It was: inside a slot this
      sits in a `dd` that sets the size, and in the lists below there was nothing setting it, so
      the same component drew an email address two points larger at the bottom of the panel than
      the one three rows above it. Set here rather than on each list, so the next list to be added
      cannot get it wrong.
    */
    <div className="text-sm">
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
        {/*
          WHAT IT IS, BEFORE WHOSE IT IS.
          
          THE FIRM, READING THREE IDENTICAL ROWS UNDER "OTHER NUMBERS": "is it a work number? Is
          it the additional number? Is it a house number? ... I mean these other numbers, it could
          just be an alternative number, you know." Two of those three were WORK lines and one was
          a HOME line -- recorded correctly when each was saved off the trace, and never drawn.
          
          A CHIP RATHER THAN MORE GREY TEXT, because the label beside it is free text and the kind
          is not: one is "Mother", the other is one of seven words, and a reader has to be able to
          tell which is which at a glance. See contactWhat.
        */}
        {contactWhat(contact) && (
          <span className="text-[10px] px-1.5 rounded bg-slate-100 text-slate-500 shrink-0">
            {contactWhat(contact)}
          </span>
        )}
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
        {/*
          "STOP USING" RATHER THAN "RETIRE", because retire says one of the two things this does.
          THE FIRM, having just used it: "I retired an email, and I said I'm retiring it because
          it's a wrong email. Maybe we should say unlink rather than retire."

          BOTH READINGS ARE REAL AND THE REASON IS WHERE THEY SEPARATE. A number the debtor had
          and no longer uses is retired; a number that was never theirs was wrongly linked. The
          row is kept either way — the whole point is that the next collector does not trace the
          same dead line again — so the ACT is the same and only the reason differs. "Stop using"
          is true of both, which "retire" and "unlink" each are not, and the prompt asks for the
          reason first so the difference is recorded rather than guessed from the word.
        */}
        <button disabled={busy}
          onClick={() => {
            const reason = window.prompt(
              'Why are we no longer using this? (wrong number, not this debtor\'s, disconnected, ...)')
            if (reason !== null) run(() => retireContact(contact.id, reason))
          }}
          className="text-[10px] text-slate-400 hover:text-negative disabled:opacity-50">
          stop using
        </button>
      </div>
    </div>
  )
}

/**
 * WHEN THIS DEBTOR ASKED TO BE TELEPHONED, as a list you can add to.
 *
 * THE FIRM: "you can choose the two hours and then add a different schedule -- for example the
 * debtor likes to be contacted between 8 and 9, and 7 and 5."
 *
 * EACH CHANGE IS A SAVE, which is not how the slots beside it work and is right here. The others
 * are one value being corrected, so a draft and a Save button is the shape; this is a list being
 * built, and a Save that has to be remembered after adding a window is a window lost every time
 * somebody adds one and closes the panel.
 *
 * `<input type="time">` RATHER THAN A BOX TO TYPE INTO, because the firm works on an iPad: it
 * gives them the wheel they already know and it is the one control that cannot produce "half past
 * eight" where the column holds "HH:MM".
 */
function WindowsSlot({ windows, busy, onSave }: {
  windows: ContactWindow[]
  busy: boolean
  onSave: (next: ContactWindow[]) => void
}) {
  const [editing, setEditing] = useState(false)
  const [from, setFrom] = useState('08:00')
  const [to, setTo] = useState('09:00')
  const problem = windowProblem({ from, to })

  if (!editing) {
    return (
      <SlotShell icon="hours" label="Best time to call"
        hint="The hours this debtor asked to be telephoned in.">
        <button onClick={() => setEditing(true)}
          className={`text-left hover:underline ${windows.length ? '' : 'text-slate-300 hover:text-brand-600'}`}>
          {windows.length ? describeWindows(windows) : 'Not recorded'}
        </button>
        {/*
          AND WHETHER NOW IS ONE OF THEM.

          ONLY WHERE SOMEBODY HAS ACTUALLY BEEN TOLD AN HOUR. insideWindow answers true for an
          account with no windows on it, which is nearly the whole book -- a caution on every one
          of those would be a caution nobody reads, and this screen's rule is that a warning which
          fires when nothing is wrong is worse than no warning.
        */}
        {windows.length > 0 && !insideWindow(windows, firmClock()) && (
          <span className="block text-[11px] text-gold-600">Not one of those hours now.</span>
        )}
      </SlotShell>
    )
  }

  return (
    <SlotShell icon="hours" label="Best time to call">
      <div className="space-y-1.5 mt-0.5">
        {windows.map((w, i) => (
          <div key={`${w.from}-${w.to}`} className="flex items-center gap-1.5">
            <span className="tabular-nums">{describeWindows([w])}</span>
            <button disabled={busy} onClick={() => onSave(withoutWindow(windows, i))}
              aria-label={`Remove ${w.from} to ${w.to}`}
              className="text-slate-300 hover:text-negative disabled:opacity-50">
              <X size={12} />
            </button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-1.5">
          <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From"
            className="text-sm rounded-lg border border-slate-200 px-1.5 py-1" />
          <span className="text-[11px] text-slate-400">to</span>
          <input type="time" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To"
            className="text-sm rounded-lg border border-slate-200 px-1.5 py-1" />
          <button disabled={busy || problem !== null} onClick={() => onSave(withWindow(windows, { from, to }))}
            className="text-[11px] font-medium px-2 py-1 rounded bg-brand-600 text-white disabled:opacity-50">
            Add
          </button>
        </div>
        {/* SAID, AND THE BUTTON REFUSES. A window ending before it starts is a typo every time and
            there is nothing in it worth keeping -- stored, it would read as a ban on the middle of
            the day. See windowProblem, which is the one place that judgement is made. */}
        {problem && <span className="block text-[11px] text-gold-600">{problem}</span>}
        <button onClick={() => setEditing(false)} className="text-[11px] text-slate-500 hover:text-slate-700">
          Done
        </button>
      </div>
    </SlotShell>
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
    /*
     * WHOSE IT IS GOES IN ITS OWN COLUMNS ON A PERSON TOO.
     *
     * THE FIRM: "on the data details, if you say add a number, how do you add an additional
     * number?" -- and then, approving the fix, "you can open the other things, adding the next of
     * kin by hand or adding additional debtor details."
     *
     * IT HALF EXISTED. A number could be added; the name and role fields were rendered only when
     * `forCompany`, so on a person the form offered kind, value and a free-text "whose is it?".
     * That meant A NEXT OF KIN COULD NOT BE ADDED BY HAND AT ALL -- the only way one ever reached
     * an account was by promoting a linked person off a trace, and a trace is not always there.
     *
     * person_name AND person_role RATHER THAN THE LABEL, which is the whole point: the account
     * screen groups the people it shows on person_name, so a sister typed into a caption is a
     * caption. It is the same shape promoteTraceItem writes, so a next of kin added by hand and
     * one saved off a trace are one kind of row.
     */
    const ok = await run(() => addContact({
      accountId, kind, value,
      /* The label keeps its old job on a person: "the one he actually answers". On a company it
         belongs to nobody, which is what the name and role are for. */
      label: forCompany ? null : label,
      personName: person.trim() || null,
      personRole: role.trim() || null,
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
      {!forCompany && (
        <input value={label} onChange={(e) => setLabel(e.target.value)}
          placeholder="What is it? (optional — the one he answers)"
          className="w-full text-sm rounded-lg border border-slate-200 px-2 py-1.5" />
      )}
      {/*
        WHOSE IT IS, ON BOTH KINDS OF ACCOUNT, WORDED FOR THE ONE IT IS ON.
        
        On a company the question is who to ask for at a switchboard; on a person it is who else
        this reaches and what they are to the debtor -- a sister, a neighbour, the employer's
        payroll clerk. Same two columns, because they ARE the same two facts, and the account
        screen groups the people it shows on person_name either way.
        
        BLANK IS THE DEBTOR THEMSELVES, which is the ordinary case and must stay the quickest: a
        collector adding a second mobile for the debtor types a number and presses Save.
      */}
      <input value={person} onChange={(e) => setPerson(e.target.value)}
        placeholder={forCompany
          ? 'Who do you ask for? (blank = the company)'
          : 'Whose is it? (blank = the debtor)'}
        className="w-full text-sm rounded-lg border border-slate-200 px-2 py-1.5" />
      {/* ONLY ONCE THERE IS SOMEBODY TO DESCRIBE. A role with no name is a caption attached to
          nobody, and the field would sit there asking a question that cannot be answered. */}
      {person.trim() && (
        <input value={role} onChange={(e) => setRole(e.target.value)}
          placeholder={forCompany
            ? 'What do they do there? (optional)'
            : 'What are they to the debtor? (sister, neighbour, employer)'}
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
  /* WHAT THE LAST PERUSAL EARNED, or null. Shown only where something was actually charged: "no
     charge, it has already been charged once today" is the ordinary case and a line saying so on
     every document anybody opens is a line people stop reading. */
  const [charged, setCharged] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<AccountDocument | null>(null)

  async function onPick(files: FileList | null) {
    if (!files?.length) return
    setUploading(true); setErr(null)
    try {
      // One at a time, in order, so a failure names the file that failed.
      for (const file of Array.from(files)) {
        const { charge } = await uploadDocument({
          accountId, file, kind, uploadedBy: userId, uploadedByName: userName,
        })
        /* THE LAST ONE WINS, which on a multi-file pick is the honest answer: the perusal is once
           a day, so the first file earns it and the rest are recorded free. */
        setCharged(charge && charge.reason === 'charged' ? chargeMessage(charge, PERUSAL_ITEM_ID) : null)
      }
      await onChange()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  /*
   * OPENING A DOCUMENT IS A PERUSAL OF DOCUMENTS, once a day -- the firm's rule, and the same fee
   * saving one raises. openDocument signs the address and charges it; the cap is in the engine, so
   * this press is refused most days and says so rather than going quiet.
   */
  async function open(doc: AccountDocument) {
    setOpening(doc.id); setErr(null)
    try {
      const { url, charge } = await openDocument(doc, userId)
      window.open(url, '_blank', 'noopener')
      setCharged(charge && charge.reason === 'charged' ? chargeMessage(charge, PERUSAL_ITEM_ID) : null)
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
      {/*
        WHAT THE PERUSAL EARNED, where it earned anything. The firm's rule is one a day, so most
        presses are refused and say nothing -- a line reading "no charge, already charged today" on
        every document anybody opens is a line people stop reading, and the transaction list is
        where the whole day's fees are answerable anyway.
      */}
      {charged && <p className="text-xs text-[var(--c-green)] mb-3">{charged}</p>}

      {documents.length === 0 ? (
        <p className="text-sm text-slate-400 py-8 text-center">
          Mandates, acknowledgements of debt, letters, proof of payment, traces &mdash; anything
          that belongs on the file. PDFs and images.
        </p>
      ) : (
        <div className="divide-y divide-slate-50">
          {documents.map((d) => (
            /* ONE LINE A DOCUMENT (the firm: "thin, sleek, easy to read"): the name, then what
               it is, its size, when and who after a dot, truncated with the whole on the title. */
            <div key={d.id} className="flex items-center gap-2 py-1.5 text-[12.5px] whitespace-nowrap group hover:bg-slate-50">
              <FileText size={14} className="text-slate-300 shrink-0" />
              <div className="min-w-0 flex-1 truncate"
                title={[d.name, d.kind, fileSize(d.sizeBytes), formatDate(d.createdAt), d.uploadedByName].filter(Boolean).join(' · ')}>
                <button onClick={() => open(d)} className="text-slate-800 hover:text-brand-600 hover:underline text-left">
                  {d.name}
                </button>
                <span className="text-[11px] text-slate-400">
                  {' · '}{[d.kind, fileSize(d.sizeBytes), formatDate(d.createdAt), d.uploadedByName].filter(Boolean).join(' · ')}
                </span>
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
