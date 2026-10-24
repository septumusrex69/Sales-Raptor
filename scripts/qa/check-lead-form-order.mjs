/**
 * ADD LEAD IN THE FIRM'S ORDER, AND CONVERT ON THE QUOTED RATE (23 Oct).
 *
 * Stephan: "the first thing it should ask is it a company or an individual? And then what is the
 * client name and who is the contact persons?" And of Convert to Client: the handover amount and
 * number of accounts are "actual data ... seen when we hand over in the first 3 months", and the
 * commission "should go as default in about what it was sent out originally ... We should basically
 * just confirm it."
 *
 * Held here: the order of the form (asserted present BEFORE asserted in order -- an indexOf of -1
 * passes an order check vacuously), the two meanings of "client name", further contact persons
 * written after the lead, the quoted rate read off the mandate that stood, the handover figures no
 * longer asked for, and the first-three-months window held to the database's.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-lead-form-order.mjs
 */
import fs from 'node:fs'
import { clientNameFor, furtherContacts, emptyContactPerson } from '../../src/lib/leadParty.ts'
import { quotedCommissionDefault, standingMandate } from '../../src/lib/quotedCommission.ts'
import { firstThreeMonths } from '../../src/lib/clientBook.ts'

let pass = 0
const failures = []
const ok = (label, cond) => { if (cond) pass += 1; else failures.push(label) }
const eq = (label, a, b) => ok(`${label} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b))
const read = (p) => fs.readFileSync(p, 'utf8')
/* Comments out first: a rule written in a comment is not a rule the code keeps. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

/* ---------- A. the form's order ---------- */
const quick = strip(read('src/components/layout/QuickAdd.tsx'))
const formStart = quick.indexOf('export function LeadForm(')
const formEnd = quick.indexOf('export function ContactForm(')
ok('LeadForm is found', formStart >= 0 && formEnd > formStart)
const form = quick.slice(formStart, formEnd)

const at = (needle) => form.indexOf(needle)
const party = at('data-testid="lead-party"')
const clientName = at('label="Client name"')
const contact = at('data-testid="lead-contact-heading"')
const individualName = at('data-testid="lead-individual-name"')
const source = at('label="Lead Source"')
ok('the company-or-individual question is on the form', party >= 0)
ok('...the client name is asked', clientName >= 0)
ok('...the contact person is asked', contact >= 0)
ok('...an individual’s name is asked as the client name', individualName >= 0)
ok('the question comes FIRST: before the client name', party >= 0 && clientName > party)
ok('...the client name before the contact person', clientName >= 0 && contact > clientName)
ok('...and before the individual’s name', individualName > party)
ok('...and lead source after all of them', source > contact && source > individualName)
ok('the first-name box is not the first thing on the form any more', at('label="First Name"') > party)

ok('the choice is not guessed: nothing chosen unless a prefill names a company',
  /useState<'company' \| 'individual' \| null>\(initial\?\.companyName \? 'company' : null\)/.test(form))
ok('nothing else is drawn until it is answered',
  /\{party === 'company' && \(/.test(form) && /\{party === 'individual' && \(/.test(form) && /\{party !== null && \(/.test(form))
ok('...and a submit without it is refused', /if \(!party \|\|/.test(form))
/* S11 changed this: a company may have many further contact persons, an individual ONE (below). */
ok('only a company is offered MANY further contact persons',
  /\{party === 'company' && \([\s\S]*?Add another contact person/.test(form)
  && !/\{party === 'individual' && \([\s\S]*?Add another contact person[\s\S]*?\{party !== null/.test(form))
ok('the client name is whichever the party says it is', /companyName: clientName,/.test(form) && /clientNameFor\(party, form\)/.test(form))
ok('...the stored shape unchanged: the first contact person is the lead’s own name',
  /firstName: form\.firstName\.trim\(\),/.test(form) && /party,/.test(form))
ok('...further contact persons handed to addLead', /\}, further\.save\)/.test(form))
ok('the firm’s words: "Client name" and "Contact person"', /'Contact persons' : 'Contact person'/.test(form))

eq('a company’s client name is the company', clientNameFor('company', { companyName: ' Acme (Pty) Ltd ', firstName: 'Thandi', lastName: 'Mokoena' }), 'Acme (Pty) Ltd')
eq('an individual’s client name is their full name', clientNameFor('individual', { companyName: 'left over', firstName: ' Johanna ', lastName: 'van Wyk ' }), 'Johanna van Wyk')
eq('...with no surname, the first name alone', clientNameFor('individual', { companyName: '', firstName: 'Johanna', lastName: '' }), 'Johanna')

eq('an untouched "add another" row is dropped, not saved', furtherContacts([emptyContactPerson()]), { save: [], problem: null })
const named = furtherContacts([{ ...emptyContactPerson(), firstName: ' Pieter ', lastName: 'Botha', email: 'p@x.example' }])
eq('a named contact person is saved, trimmed', named.save, [{ firstName: 'Pieter', lastName: 'Botha', email: 'p@x.example' }])
ok('...without a problem', named.problem === null)
const unnamed = furtherContacts([{ ...emptyContactPerson(), phone: '011 555 0101' }])
ok('a row with a number and no name is a problem, said, not silently dropped', unnamed.problem !== null && unnamed.save.length === 0)

const store = strip(read('src/store/AppStore.tsx'))
const leadInsert = store.indexOf("supabase.from('leads').insert(row)")
const contactInsert = store.indexOf("insertRow('contacts', contact, 'addLead:contact'")
ok('the store writes further contact persons', contactInsert >= 0)
ok('...and the lead insert is found', leadInsert >= 0)
ok('...AFTER the lead, which contacts.lead_id points at', leadInsert >= 0 && contactInsert > leadInsert)
ok('...each carrying the lead’s id', /leadId: id,\s+ownerId: lead\.ownerId,/.test(store))
ok('...and taken back off the screen if the lead fails', /setContacts\(\(prev\) => prev\.filter\(\(c\) => c\.leadId !== id\)\)/.test(store))

/* ---------- B. convert on the quoted rate ---------- */
eq('a flat quote opens the box on it, as a percentage', quotedCommissionDefault({ commission: { kind: 'rate', rate: 0.275 } }), { kind: 'fixed', rate: '27.5', said: '27.5%' })
eq('...30% is "30", not 30.000000000000004', quotedCommissionDefault({ commission: { kind: 'rate', rate: 0.3 } })?.rate, '30')
const scale = quotedCommissionDefault({ commission: { kind: 'scale', bands: [{ upTo: 100000, rate: 0.25 }, { upTo: null, rate: 0.1 }] } })
eq('a sliding scale opens the scale editor on its bands', scale, { kind: 'scale', tiers: [{ upTo: '100000', rate: '25' }, { upTo: '', rate: '10' }], said: 'Sliding scale 25% to 10%' })
ok('nothing quoted: no default, and the box stays empty and required', quotedCommissionDefault(null) === null && quotedCommissionDefault({}) === null)
ok('...nor a nonsense rate', quotedCommissionDefault({ commission: { kind: 'rate', rate: 0 } }) === null && quotedCommissionDefault({ commission: { kind: 'rate', rate: 'x' } }) === null)

const rows = [
  { created_at: '2026-10-01T09:00:00Z', state: 'sent', mandate: { commission: { kind: 'rate', rate: 0.3 } } },
  { created_at: '2026-10-12T09:00:00Z', state: 'cancelled', mandate: { commission: { kind: 'rate', rate: 0.2 } } },
  { created_at: '2026-10-10T09:00:00Z', state: 'signed', mandate: { commission: { kind: 'rate', rate: 0.275 } } },
  { created_at: '2026-10-15T09:00:00Z', state: 'sent', mandate: null },
]
eq('the offer that stood is the newest with terms that was not withdrawn', standingMandate(rows)?.created_at, '2026-10-10T09:00:00Z')
ok('...none at all is none', standingMandate([]) === null)

const conv = strip(read('src/components/leads/ConvertLeadModal.tsx'))
ok('the conversion reads the mandate sent from THIS lead',
  /from\('signing_requests'\)\.select\('created_at, state, mandate'\)\.eq\('lead_id', lead\.id\)/.test(conv))
ok('...through the same two functions held above', /quotedCommissionDefault\(standingMandate\(/.test(conv))
ok('...and puts it in the box', /if \(q\.kind === 'fixed'\) \{ setKind\('fixed'\); setRate\(q\.rate\) \}/.test(conv))
ok('...but never over what somebody already typed', /if \(touched\.current\) return/.test(conv) && /onChange=\{\(e\) => \{ touch\(\); setRate\(e\.target\.value\) \}\}/.test(conv))
ok('...saying what was quoted', /`Commission \(as quoted: \$\{quoted\.said\}\)`/.test(conv))
ok('...and still refusing an empty or impossible rate', /Give the commission rate/.test(conv) && /asFraction\(rate\) > 1/.test(conv))
ok('the handover amount is no longer asked at conversion', !/Handover Amount/.test(conv))
ok('...nor the number of accounts', !/Number of Accounts/.test(conv))
ok('...the lead’s estimate shown as the estimate it is', /Expected \(the lead&rsquo;s estimate\)/.test(conv))
ok('...and carried to the store unchanged, for the pipeline and reports that read it',
  /value: isDebtCollection \? deal\.handoverAmount \?\? 0 : deal\.value,/.test(conv) && /handoverAmount: d\.handoverAmount,/.test(conv))
ok('a liaison is still required', /const noLiaison = !liaisonId/.test(conv) && /noLiaison \|\|/.test(conv))

/* ---------- the first three months, held to the database's window ---------- */
const sql = read('supabase/schema.sql')
const intakeAt = sql.lastIndexOf('create or replace function public.company_intake_by_day(')
ok('company_intake_by_day is found', intakeAt >= 0)
const intake = sql.slice(intakeAt, sql.indexOf('$$;', intakeAt))
ok('...and still cuts NEW at the first account plus three months, end exclusive',
  /a\.handover_date < \(f\.first_day \+ interval '3 months'\)::date/.test(intake))

const ftm = firstThreeMonths([
  { day: '2026-03-02', accounts: 4, capital: 1000 },
  { day: '2026-01-31', accounts: 10, capital: 50000 },
  { day: '2026-04-29', accounts: 2, capital: 300 },
  { day: '2026-04-30', accounts: 7, capital: 9999 },
  { day: '2026-01-15', accounts: 0, capital: 0 },
])
eq('the window opens on the first account', ftm?.from, '2026-01-31')
eq('...and closes three months on, clamped as Postgres clamps it (31 Jan -> 30 Apr)', ftm?.until, '2026-04-30')
eq('...counting what came in before it closes', [ftm?.accounts, ftm?.capital], [16, 51300])
ok('...still counting on the last day inside it', ftm?.complete('2026-04-29') === false && ftm?.complete('2026-04-30') === true)
ok('nothing handed over: no window', firstThreeMonths([]) === null && firstThreeMonths([{ day: '2026-01-01', accounts: 0 }]) === null)

const page = strip(read('src/pages/companies/CompanyDetail.tsx'))
ok('the client record shows it', /\{showFirstThree && <FirstThreeMonths clientId=\{company\.id\} \/>\}/.test(page))
ok('...for a top-level client only (client_intake_by_day counts sub-accounts with their parent)',
  /const showFirstThree = !!company && !company\.parentCompanyId &&/.test(page))
ok('...read through the existing per-client function, no new endpoint',
  /fetchClientIntakeByDay\(clientId,/.test(strip(read('src/components/companies/FirstThreeMonths.tsx'))))

/* S11: AN INDIVIDUAL MAY HAVE ONE SECOND CONTACT ("always good to have a second contact person, but
   they always don't have one"): optional, one, saved through the same furtherContacts. */
const second = at('data-testid="lead-second-contact"')
ok('an individual is offered a second contact person', second > individualName && /Add a second contact person \(optional\)/.test(form))
ok('...one at most, drawn and saved', /others\.slice\(0, 1\)\.map\(/.test(form)
  && /furtherContacts\(party === 'individual' \? others\.slice\(0, 1\) : others\)/.test(form))

if (failures.length) {
  console.error(`check-lead-form-order: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`)
  process.exit(1)
}
console.log(`check-lead-form-order: ${pass} passed, 0 failed`)
