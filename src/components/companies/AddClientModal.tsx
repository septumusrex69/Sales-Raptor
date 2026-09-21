import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Modal, FormField, inputClass } from '../ui/Modal'
import { codeProblem, proposeClientCode } from '../../lib/clientCode.ts'
import { scheduleProblems, tierStart } from '../../lib/commission.ts'
import type { Company, ID, ProductService, User } from '../../types'

const SERVICES: ProductService[] = [
  'Debt Collection', 'Litigation', 'Executive Listing', 'iCollect', 'Contract Drafting',
  'In-Person Debt Collection', 'Credit Check', 'Tracing', 'NovaCall', 'Labour Law', 'Other',
]

interface Tier { upTo: string; rate: string }

const money = (n: number) => n.toLocaleString('en-ZA', {
  style: 'currency', currency: 'ZAR', minimumFractionDigits: 2,
})

/** The label under a tier's row: where it starts, worked out by tierStart. */
function startOf(tiers: Tier[], i: number): string {
  const previous = i === 0 ? null : Number((tiers[i - 1]?.upTo ?? '').replace(/[\s,]/g, ''))
  const from = tierStart(i === 0 ? null : previous)
  return from === null ? 'From \u2014' : `From ${money(from)}`
}

/**
 * A client loaded straight in, rather than converted from a lead.
 *
 * THE FIRM: "this isn't the traditional way of converting a lead to a client. This is just
 * loading a client directly ... it didn't ask me for the type of questions that was asked for the
 * lead — contact details, contact persons, if they've signed a mandate, what services are they
 * using."
 *
 * "+ Add → Company" is not this and never was: it is somewhere to hang a contact behind a lead.
 * Everything the firm listed is learned on the lead → deal → Won path, and a client with no lead
 * behind it has nowhere to have learned it. So it is asked for here, once, while somebody has the
 * mandate in front of them.
 *
 * THE CODE IS PROPOSED AND NOT IMPOSED. Three of the firm's own eight codes cannot be derived
 * from the client's name by any rule — a person chose DAK, AID1 and GPS1 — so what the generator
 * offers sits in a box that can be overwritten. A generator that was always obeyed would have
 * renamed three of this firm's clients.
 */
export function AddClientModal({ takenCodes, liaisons, busy, error, onClose, onSave }: {
  /** Every code already in use, so one is not proposed twice. */
  takenCodes: string[]
  liaisons: User[]
  busy: boolean
  error: string | null
  onClose: () => void
  onSave: (input: Partial<Company> & { name: string }) => void
}) {
  const [name, setName] = useState('')
  /* Null until somebody types: while it is null the proposal follows the name as it is typed,
     and the moment they touch the box it is theirs and stops moving under them. */
  const [typedCode, setTypedCode] = useState<string | null>(null)
  const [form, setForm] = useState({
    registrationNumber: '', vatNumber: '', industry: '',
    phone: '', email: '', website: '',
    address: '', city: '', province: '',
    contactPerson: '', bankingDetails: '',
    mandateSignedAt: '', accountOwnerId: liaisons[0]?.id ?? '',
  })
  const [services, setServices] = useState<ProductService[]>(['Debt Collection'])
  const [kind, setKind] = useState<'fixed' | 'scale'>('fixed')
  const [rate, setRate] = useState('')
  const [tiers, setTiers] = useState<Tier[]>([
    { upTo: '100000', rate: '' }, { upTo: '', rate: '' },
  ])
  const [source, setSource] = useState('')
  const [shown, setShown] = useState<string[]>([])
  /*
   * THE LAST THING BEFORE IT IS SIGNED, at the firm's instruction: "when you click accept, then
   * there should be a confirmation button -- you're about to sign this client on this sliding
   * scale or on this collection commission, confirm."
   *
   * NOT A "ARE YOU SURE?", WHICH TEACHES PEOPLE TO CLICK THROUGH. It reads back the terms in
   * words, because the thing worth a second look is the commission: every account this client
   * ever hands over inherits it, and an account opened at the wrong rate is invoiced wrong for
   * the rest of its life. A rate typed as 3 instead of 30 is invisible in a box and obvious in a
   * sentence.
   */
  const [confirming, setConfirming] = useState(false)

  const proposed = useMemo(() => proposeClientCode(name, takenCodes), [name, takenCodes])
  const code = typedCode ?? proposed
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  /* A fraction, not a percentage: the firm types 30 and means 0.3. Converted at the boundary
     rather than stored either way, because CompanyDetail already carries the comment about an
     account that read as 2300%. */
  const asFraction = (v: string) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n / 100 : NaN
  }
  const bands = useMemo(() => tiers.map((t) => ({
    upTo: t.upTo.trim() === '' ? null : Number(t.upTo.replace(/[\s,]/g, '')),
    rate: asFraction(t.rate),
  })), [tiers])

  function problems(): string[] {
    const out: string[] = []
    if (!name.trim()) out.push('A client needs a name.')
    const bad = codeProblem(code, takenCodes)
    if (bad) out.push(bad)
    if (!form.accountOwnerId) out.push('Somebody has to look after this client.')
    if (services.length === 0) out.push('Choose at least one service they have signed for.')
    if (kind === 'fixed') {
      const n = asFraction(rate)
      if (!Number.isFinite(n)) out.push('A commission rate is needed — every account inherits it.')
      else if (n > 1) out.push('A commission rate above 100% would bill more than the debt.')
    } else {
      out.push(...scheduleProblems(bands))
    }
    return out
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const found = problems()
    setShown(found)
    if (found.length > 0) return
    /* Everything is sound; the terms are read back before anything is written. */
    setConfirming(true)
  }

  function save() {
    onSave({
      name: name.trim(),
      code: code.trim().toUpperCase(),
      accountOwnerId: form.accountOwnerId as ID,
      industry: form.industry.trim() || undefined,
      registrationNumber: form.registrationNumber.trim() || undefined,
      vatNumber: form.vatNumber.trim() || undefined,
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      website: form.website.trim() || undefined,
      address: form.address.trim() || undefined,
      city: form.city.trim() || undefined,
      province: form.province.trim() || undefined,
      contactPerson: form.contactPerson.trim() || undefined,
      bankingDetails: form.bankingDetails.trim() || undefined,
      mandateSignedAt: form.mandateSignedAt ? new Date(form.mandateSignedAt).toISOString() : undefined,
      services,
      ...(kind === 'fixed'
        ? { commissionRate: asFraction(rate) }
        : { commissionBands: bands, commissionBandsSource: source.trim() || 'Signed mandate' }),
    })
  }

  /** The commission in words, which is the half of this worth reading twice. */
  const terms = kind === 'fixed'
    ? [`${rate}% of everything collected, on every account.`]
    : tiers.map((t, i) => {
      const from = startOf(tiers, i).replace('From ', '')
      const to = t.upTo.trim() === '' ? 'and above' : `up to ${money(Number(t.upTo.replace(/[\s,]/g, '')))}`
      return `${from} ${to} — ${t.rate}%`
    })

  if (confirming) {
    return (
      <Modal title="Sign this client?" onClose={onClose} width={560}>
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            You are about to sign <strong className="text-navy-950">{name.trim()}</strong>
            {' '}as <span className="font-mono text-navy-950">{code.trim().toUpperCase()}</span>
            {kind === 'fixed' ? ' on a single commission rate.' : ' on a sliding scale.'}
          </p>

          <div className="rounded-lg border border-gold-500 bg-gold-50 p-3.5">
            <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">
              {kind === 'fixed' ? 'Collection commission' : 'The sliding scale'}
            </p>
            <ul className="space-y-1 text-sm text-navy-950 tabular-nums">
              {terms.map((t) => <li key={t}>{t}</li>)}
            </ul>
          </div>

          {/*
            SAID PLAINLY, because it is the reason this screen exists: every account this client
            ever hands over inherits the rate, and existing accounts keep the rate they were
            billed at. Getting it wrong is not a typo to fix later.
          */}
          <p className="text-xs text-slate-500">
            Every account this client hands over will be billed on this. Accounts already opened
            keep the rate they were opened at, so this is not something to correct afterwards.
          </p>

          {form.mandateSignedAt
            ? (
              <p className="text-xs text-slate-500">
                Mandate signed {new Date(form.mandateSignedAt).toLocaleDateString('en-ZA')}.
              </p>
            )
            : (
              <p className="text-xs text-negative-700">
                No mandate date yet — the client will be added, but no handover can be imported
                for them until it is filled in.
              </p>
            )}

          {error && <p className="text-sm text-negative-700">{error}</p>}

          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={save} disabled={busy}
              className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg
                bg-gold-400 text-navy-950 border border-gold-500 disabled:opacity-40">
              {busy ? 'Signing\u2026' : 'Confirm and sign'}
            </button>
            {/* Back to the form, not out of it: somebody who spots a wrong rate here should not
                have to retype the address. */}
            <button type="button" onClick={() => setConfirming(false)} disabled={busy}
              className="text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-600">
              Go back and change it
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Add a client" onClose={onClose} width={640}>
      <form onSubmit={submit} className="space-y-5">
        <Section title="Who they are">
          <FormField label="Client name">
            <input className={inputClass} value={name} autoFocus
              onChange={(e) => setName(e.target.value)} placeholder="Adowa Property Managers (Pty) Ltd" />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            {/*
              PROPOSED, NOT IMPOSED. It follows the name until somebody types over it, and then it
              is theirs. What the account references on this client's paperwork will be built on.
            */}
            <FormField label="Code">
              <input className={`${inputClass} font-mono uppercase`} value={code}
                onChange={(e) => setTypedCode(e.target.value.toUpperCase())}
                placeholder="APM" />
              <span className="block text-[11px] text-slate-400 mt-1">
                Their account references are built on this.
              </span>
            </FormField>
            <FormField label="Industry">
              <input className={inputClass} value={form.industry} onChange={set('industry')}
                placeholder="Property management" />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Registration number">
              <input className={inputClass} value={form.registrationNumber}
                onChange={set('registrationNumber')} placeholder="2019/940923/07" />
            </FormField>
            <FormField label="VAT number">
              <input className={inputClass} value={form.vatNumber} onChange={set('vatNumber')}
                placeholder="4350289080" />
            </FormField>
          </div>
        </Section>

        <Section title="How to reach them">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Contact person">
              <input className={inputClass} value={form.contactPerson} onChange={set('contactPerson')}
                placeholder="Who to ask for" />
            </FormField>
            <FormField label="Telephone">
              <input className={inputClass} value={form.phone} onChange={set('phone')}
                placeholder="012 348 2156" />
            </FormField>
            <FormField label="Email">
              <input className={inputClass} value={form.email} onChange={set('email')}
                placeholder="accounts@client.co.za" />
            </FormField>
            <FormField label="Website">
              <input className={inputClass} value={form.website} onChange={set('website')}
                placeholder="www.client.co.za" />
            </FormField>
          </div>
          <FormField label="Address">
            <input className={inputClass} value={form.address} onChange={set('address')} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Town or city">
              <input className={inputClass} value={form.city} onChange={set('city')} />
            </FormField>
            <FormField label="Province">
              <input className={inputClass} value={form.province} onChange={set('province')} />
            </FormField>
          </div>
        </Section>

        <Section title="The mandate">
          {/*
            A HANDOVER CANNOT BE IMPORTED WITHOUT A SIGNED MANDATE, at the firm's instruction. Not
            refused here, though: a client is often loaded while the mandate is in the post, and a
            form that will not save without it is a form people fill in with a made-up date.
            The refusal is at the import, where the consequence actually is.
          */}
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Mandate signed on">
              <input type="date" className={inputClass} value={form.mandateSignedAt}
                onChange={set('mandateSignedAt')} />
              <span className="block text-[11px] text-slate-400 mt-1">
                A handover cannot be imported until this is filled in.
              </span>
            </FormField>
            <FormField label="Client liaison">
              <select className={inputClass} value={form.accountOwnerId} onChange={set('accountOwnerId')}>
                {liaisons.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </FormField>
          </div>
          <FormField label="What they have signed for">
            <div className="flex flex-wrap gap-1.5">
              {SERVICES.map((s) => (
                <button key={s} type="button"
                  onClick={() => setServices((prev) =>
                    prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s])}
                  className={`text-xs px-2.5 py-1 rounded-full border ${services.includes(s)
                    ? 'border-gold-500 bg-gold-100 text-navy-950 font-medium'
                    : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                  {s}
                </button>
              ))}
            </div>
          </FormField>
          <FormField label="Remittance details">
            <input className={inputClass} value={form.bankingDetails} onChange={set('bankingDetails')}
              placeholder="Where money collected is paid over to them" />
          </FormField>
        </Section>

        <Section title="Commission">
          {/*
            EITHER A RATE OR A SCALE, at the firm's instruction: "accounts between zero rand and a
            hundred thousand rand is on a specific commission, then the next tier, then the next
            tier, and then above the last tier would be another one."

            TYPED AS A PERCENTAGE AND STORED AS A FRACTION. Everything in Raptor holds commission
            as 0.3 for thirty percent, and a person types 30 -- converted at this boundary rather
            than left to whoever reads it next, which is what once made an account read as 2300%.
          */}
          <div className="flex gap-2 mb-3">
            {(['fixed', 'scale'] as const).map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)}
                className={`text-xs px-3 py-1.5 rounded-lg border ${kind === k
                  ? 'border-gold-500 bg-gold-100 text-navy-950 font-medium'
                  : 'border-slate-200 text-slate-500'}`}>
                {k === 'fixed' ? 'One rate' : 'A sliding scale'}
              </button>
            ))}
          </div>

          {kind === 'fixed' ? (
            <FormField label="Commission">
              <div className="flex items-center gap-2">
                <input className={`${inputClass} max-w-[7rem]`} value={rate}
                  onChange={(e) => setRate(e.target.value)} placeholder="30" />
                <span className="text-sm text-slate-500">% of what is collected</span>
              </div>
            </FormField>
          ) : (
            <div className="space-y-2">
              {tiers.map((t, i) => (
                <div key={i} className="flex items-center gap-2">
                  {/*
                    WHERE EACH TIER STARTS IS SHOWN, NOT TYPED, at the firm's instruction: "if it's
                    up to 100,000 for one tier, the next tier should start from 100,001
                    automatically." Two numbers to keep in step is two numbers that drift, and the
                    one nobody re-reads is the start.

                    IT IS A CENT ABOVE, NOT A RAND. rateForCapital is `capital <= upTo`, so the
                    boundary rand belongs to the LOWER band -- commission.ts says so in its own
                    words, "an account handed over at exactly R25,000.00 is 25%, not 22.5%". An
                    account at R100 000.50 is real and has to belong somewhere, and a label saying
                    "From R100 001" would put it in neither tier.
                  */}
                  <span className="text-xs text-slate-400 w-28 shrink-0 tabular-nums">
                    {startOf(tiers, i)}
                  </span>
                  <input className={`${inputClass} max-w-[9rem]`} value={t.upTo}
                    placeholder={i === tiers.length - 1 ? 'and above' : '100000'}
                    onChange={(e) => setTiers((prev) =>
                      prev.map((x, j) => (j === i ? { ...x, upTo: e.target.value } : x)))} />
                  <input className={`${inputClass} max-w-[5rem]`} value={t.rate} placeholder="30"
                    onChange={(e) => setTiers((prev) =>
                      prev.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} />
                  <span className="text-sm text-slate-500">%</span>
                  {tiers.length > 2 && (
                    <button type="button" className="text-slate-300 hover:text-negative-600"
                      onClick={() => setTiers((prev) => prev.filter((_, j) => j !== i))}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
              {/* The new tier goes in ABOVE the last one, because the last is "and above" and has
                  to stay there -- see scheduleProblems. */}
              <button type="button"
                onClick={() => setTiers((prev) =>
                  [...prev.slice(0, -1), { upTo: '', rate: '' }, prev[prev.length - 1]])}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-600">
                <Plus size={12} /> Another tier
              </button>
              <FormField label="Where the scale comes from">
                <input className={inputClass} value={source} onChange={(e) => setSource(e.target.value)}
                  placeholder="Signed mandate, 30 April 2024" />
              </FormField>
            </div>
          )}
        </Section>

        {/* Problems appear on submit, once. Marking a field wrong while somebody is still typing
            in it is shouting at them for not having finished. */}
        {shown.length > 0 && (
          <ul className="text-sm text-negative-700 space-y-1">
            {shown.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
        {error && <p className="text-sm text-negative-700">{error}</p>}

        <div className="flex items-center gap-2 pt-1">
          <button type="submit" disabled={busy}
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg
              bg-gold-400 text-navy-950 border border-gold-500 disabled:opacity-40">
            {busy ? 'Adding…' : 'Review and sign'}
          </button>
          <button type="button" onClick={onClose}
            className="text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-600">
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">{title}</h4>
      <div className="space-y-3">{children}</div>
    </div>
  )
}
