/**
 * A CLIENT IS SAVED WITH ITS TERMS (S10, prompt 13 items 1, 2 and 5).
 *
 *   1. Add client asks for everything a client needs BY SERVICE: for debt collection the commission,
 *      the mandate, and the signed contract -- or, with no contract, a required reason, kept on the
 *      client. The contract is filed as the Mandate once the client row exists.
 *   2. Converting a lead asks for the commission too, where debt collection was signed.
 *   5. Neither saves without a liaison, chosen rather than defaulted; at conversion she is assigned
 *      through the welcome route, as "Assign and welcome" does.
 *
 * Source read back: the forms are React and the rules live in what they refuse to submit.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-client-terms.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const ok = (name, v) => { if (v === true) pass += 1; else failures.push(name) }
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

/* ---------- 1. Add client ---------- */
const add = strip(read('src/components/companies/AddClientModal.tsx'))
ok('the form knows which client is a collecting one', /const collecting = services\.includes\('Debt Collection'\)/.test(add))
ok('...and asks commission only of that one', /if \(collecting\) \{\s+if \(kind === 'fixed'\)/.test(add))
ok('...the mandate section only for it', /\{collecting && \(\s+<Section title="The mandate">/.test(add))
ok('...and the commission section only for it', /\{collecting && \(\s+<Section title="Commission">/.test(add))
ok('the contract is a file input', /<input type="file"[^>]*data-testid="add-client-contract"/.test(add))
ok('...and without one a reason is REQUIRED', /if \(!contract && !contractReason\.trim\(\)\) \{\s+out\.push\('Upload the signed contract, or say why there is none yet\.'\)/.test(add))
ok('...asked only while there is no file', /\{!contract && \(\s+<FormField label="No contract yet\? Say why">/.test(add))
ok('the reason is saved on the client', /\.\.\.\(collecting && !contract \? \{ contractMissingReason: contractReason\.trim\(\) \} : \{\}\)/.test(add))
ok('...and the file handed back to be filed', /\}, collecting \? contract : null\)/.test(add))
ok('the confirmation reads back the contract or the reason', /data-testid="confirm-contract"/.test(add))
ok('the liaison is chosen, not defaulted to the first name', /accountOwnerId: ''/.test(add) && /<option value="">Choose a liaison…<\/option>/.test(add))
ok('...and the form refuses without one', /if \(!form\.accountOwnerId\) \{/.test(add))

const list = strip(read('src/pages/companies/CompaniesList.tsx'))
ok('the contract is uploaded once the client is saved, as the Mandate',
  /onSaved: contract \? \(c\) => \{\s+uploadClientDocument\(\{\s+companyId: c\.id, file: contract, kind: MANDATE_KIND/.test(list))
const store = strip(read('src/store/AppStore.tsx'))
ok('...which the store calls only after the insert succeeded', /\.then\(\(failed\) => \{ if \(!failed\) onSaved\?\.\(company\) \}\)/.test(store))
const sql = read('supabase/schema.sql')
ok('the reason has a column', /alter table public\.companies add column if not exists contract_missing_reason text;/.test(sql))
ok('...and a field', /contractMissingReason\?: string/.test(read('src/types.ts')))
ok('the mandate card shows it while no contract is filed',
  /\{docs !== null && !hasMandateDoc && company\.contractMissingReason && \(/.test(strip(read('src/components/companies/MandateCard.tsx'))))

/* ---------- 2 and 5. Conversion ---------- */
const conv = strip(read('src/components/leads/ConvertLeadModal.tsx'))
ok('conversion asks for a liaison', /data-testid="convert-liaison"/.test(conv))
ok('...and will not convert without one', /const noLiaison = !liaisonId/.test(conv) && /const blocked = signed\.length === 0 \|\| missingReason \|\| noLiaison \|\| !!commissionProblem/.test(conv))
ok('...saying so', /a client cannot be saved without a liaison/.test(conv))
ok('conversion asks for the commission where debt collection was signed',
  /const collecting = signed\.some\(\(r\) => r\.isDebtCollection\)/.test(conv) && /\{collecting && \(\s+<div[^>]*data-testid="convert-commission"/.test(conv))
ok('...a rate or a scale, through the shared scale editor', /<CommissionScaleEditor tiers=\{tiers\} onTiers=\{setTiers\}/.test(conv))
ok('...checked the way Add client checks it', /scheduleProblems\(bands\)/.test(conv) && /asFraction\(rate\) > 1/.test(conv))
ok('...and handed over with the liaison', /liaisonId: liaisonId as ID,/.test(conv) && /commission: kind === 'fixed'/.test(conv))
ok('the submit itself refuses while blocked', /if \(blocked\) return\s+onConfirm\(/.test(conv))
ok('both lead screens offer only liaisons',
  ['src/pages/leads/LeadDetail.tsx', 'src/pages/leads/LeadsList.tsx'].every((p) =>
    /liaisons=\{(store\.)?users\.filter\(\(u\) => u\.status === 'Active' && canBeClientLiaison\(u\)\)\}/.test(read(p))))
ok('the store writes the terms onto the client',
  /const terms: Partial<Company> = \{ \.\.\.\(confirm\.commission \?\? \{\}\), accountOwnerId: confirm\.liaisonId, liaisonNeeded: false \}/.test(store))
ok('...on a new client before it is inserted, an existing one by update',
  /if \(newCompany\) Object\.assign\(newCompany, terms\)\s+else updateRow\('companies', companyId, terms/.test(store))
ok('...and welcomes through the same route as Assign and welcome',
  /void welcomeOnConversion\(companyId, confirm\.liaisonId\)/.test(store) && /fetch\('\/api\/email\/welcome'/.test(store))
const welcomeAt = store.indexOf('void welcomeOnConversion(')
ok('...after the client and its contact are in the database',
  welcomeAt > store.indexOf("insertRow('contacts', newContact, 'convertLeadToClient:contact')") && welcomeAt > store.indexOf("insertRow('companies', newCompany, 'addCompany')"))

if (failures.length) {
  console.error(`check-client-terms: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`)
  process.exit(1)
}
console.log(`check-client-terms: ${pass} passed, 0 failed`)
