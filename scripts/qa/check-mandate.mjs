/**
 * THE DEBT COLLECTION AGREEMENT SENT FOR ONLINE SIGNING (S8, 18 Oct), and what signing it does.
 *
 * The wording is the firm's own mandate with the changes they agreed, and no more:
 *   - payout "on or before the 15th" (the firm: "Let's make it before the 15th");
 *   - commission on the capital COLLECTED;
 *   - "hereafter referred to as";
 *   - the debtor-pays-the-client-directly clause, kept;
 *   - NO settlements clause, NO termination clause ("it's an ongoing agreement"), NO POPIA clause
 *     ("forget about papaya and all of that stuff"), and never arbitration (the firm's standing rule
 *     for every agreement drafted for them).
 * The scale is the firm's standard 25 / 20 / 15 / 10, every band editable, the boundary in the lower
 * band. And a merge key may not carry a digit -- renderTemplate does not substitute one, which is how
 * mandate_contact1 printed its own braces.
 *
 * Signing is mandate_on_signed in the database: it makes the client, wins the deal, converts the
 * lead and tells the closer. Read back from the LAST definition in schema.sql.
 *
 * Run: node scripts/qa/check-mandate.mjs
 */
import { readFileSync } from 'node:fs'
import {
  STANDARD_RATE, STANDARD_SCALE, bandLabels, commissionLine, commissionProblems, mandateBlanks, mandateDocument,
} from '../../src/lib/mandate.ts'

let pass = 0
const failures = []
const ok = (name, cond) => { if (cond) pass += 1; else failures.push(name) }
const check = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want))

/* Every word the agreement prints, whatever block it sits in. */
const words = (doc) => {
  const out = []
  const walk = (v) => {
    if (typeof v === 'string') out.push(v)
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k === 'text' || typeof x === 'object') walk(x)
  }
  walk(doc.blocks)
  return out.join(' ').replace(/ /g, ' ')
}

/* ---------- the scale ---------- */
check('the standard scale is 25 / 20 / 15 / 10', STANDARD_SCALE.map((b) => b.rate), [0.25, 0.2, 0.15, 0.1])
check('...on R100 000, R500 000, R1 000 000 and above', STANDARD_SCALE.map((b) => b.upTo), [100000, 500000, 1000000, null])
check('the flat standard is 25%', STANDARD_RATE, 0.25)
check('each band says where it starts, the boundary in the lower band', bandLabels(STANDARD_SCALE).map((x) => x.replace(/ /g, ' ')),
  ['Up to and including R100 000', 'R100 000.01 to R500 000', 'R500 000.01 to R1 000 000', 'Above R1 000 000'])
ok('the standard scale can go out', commissionProblems({ kind: 'scale', bands: STANDARD_SCALE }).length === 0)
ok('...a scale that does not rise cannot', commissionProblems({ kind: 'scale', bands: [{ upTo: 500000, rate: 0.2 }, { upTo: 100000, rate: 0.15 }, { upTo: null, rate: 0.1 }] }).length > 0)
ok('...nor one without an "and above"', commissionProblems({ kind: 'scale', bands: [{ upTo: 100000, rate: 0.25 }, { upTo: 500000, rate: 0.2 }] }).length > 0)
ok('...nor a rate of nought or over 100%', commissionProblems({ kind: 'rate', rate: 0 }).length > 0 && commissionProblems({ kind: 'rate', rate: 1.5 }).length > 0)
check('the email says the commission in one line', [commissionLine({ kind: 'rate', rate: 0.3 }), commissionLine({ kind: 'scale', bands: STANDARD_SCALE })], ['30%', 'Sliding scale 25% to 10%'])

/* ---------- the wording ---------- */
const flat = words(mandateDocument({ party: 'company', clientName: 'Vaal Fire Services', commission: { kind: 'rate', rate: 0.3 } }))
const scale = words(mandateDocument({ party: 'individual', clientName: 'J Smit', commission: { kind: 'scale', bands: STANDARD_SCALE } }))
ok('payout on or before the 15th', /on or before the 15th/i.test(flat))
ok('commission on the capital collected', /capital collected/i.test(flat))
ok('"hereafter referred to as"', /hereafter referred to as/i.test(flat))
ok('the debtor paying the client directly is covered, within 7 days, commission still ours', /pay you directly/i.test(flat) && /7 \(seven\) days/.test(flat) && /commission on that payment remains due/i.test(flat))
ok('the flat rate is printed', /30%/.test(flat))
ok('the scale prints every band', ['25%', '20%', '15%', '10%'].every((p) => scale.includes(p)) && /Above R1 000 000/.test(scale))
ok('the client\'s name is a field on it, filled in for them', /\{\{mandate_client_name\}\}/.test(flat))
for (const [name, re] of [['no arbitration', /arbitrat/i], ['no POPIA clause', /POPIA|Protection of Personal Information/i],
  ['no termination clause', /terminat/i], ['no settlements clause', /settlement/i]]) {
  ok(name, !re.test(flat) && !re.test(scale))
}

/* ---------- what the client fills in ---------- */
const co = mandateBlanks('company').map((b) => b.key)
const ind = mandateBlanks('individual').map((b) => b.key)
ok('a company is asked its registration number, not an ID', co.includes('mandate_reg_no') && !co.includes('mandate_id_no'))
ok('...an individual their ID number, not a registration', ind.includes('mandate_id_no') && !ind.includes('mandate_reg_no'))
ok('both are asked their banking', ['mandate_bank_name', 'mandate_bank_holder', 'mandate_bank_account', 'mandate_bank_branch'].every((k) => co.includes(k) && ind.includes(k)))
check('no merge key carries a digit (renderTemplate would print its braces)', [...co, ...ind].filter((k) => /\d/.test(k)), [])

/* ---------- what signing does ---------- */
const sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
const fn = sql.slice(sql.lastIndexOf('create or replace function public.mandate_on_signed('))
const body = fn.slice(0, fn.indexOf('$$;') + 3)
ok('the trigger function is in schema.sql, whole', body.length > 200 && body.trimEnd().endsWith('$$;') && /revoke all on function public\.mandate_on_signed\(\) from public, anon;/.test(fn))
ok('...it makes the client when there is none', /insert into public\.companies/.test(body))
ok('...saves the commission the client signed for', /commission_rate = v_rate/.test(body) && /commission_bands = v_bands/.test(body))
ok('...stamps the mandate on the firm\'s clock', /mandate_signed_at = v_signed/.test(body) && /v_signed timestamptz := public\.raptor_now\(\)/.test(body))
ok('...wins the deal, or makes a won mandate deal', /stage = 'Won'/.test(body) && /'Handover'/.test(body))
ok('...converts the lead', /status = 'Converted'/.test(body))
ok('...and tells the closer to assign a liaison', /'mandate_signed'/.test(body) && /Assign them a liaison/.test(body))
ok('...only on the move INTO signed, never twice', /coalesce\(old\.state, ''\) = 'signed' then return new/.test(body))
ok('...writes the signature into the client\'s notes, by name', /'Mandate signed online by '/.test(body) && /mandate_signatory_name/.test(body))
ok('...and brings the lead\'s history (the email that sent it) across to the client', /update public\.activities set company_id = v_company where lead_id = v_lead\.id and company_id is null/.test(body))
const sign = readFileSync(new URL('../../src/pages/sign/SignPage.tsx', import.meta.url), 'utf8')
ok('the signing page asks the signer\'s name once: the mandate\'s signatory IS the signer', /const signer = asksSignatory \? \(filled\[SIGNATORY\] \?\? ''\) : name/.test(sign) && /\{!asksSignatory && \(/.test(sign) && /name: signer/.test(sign))
const modal = readFileSync(new URL('../../src/components/leads/SendMandateModal.tsx', import.meta.url), 'utf8')
ok('the letterhead and fonts are fetched when the window opens, not when Prepare is pressed', /assets\.current = \(async/.test(modal) && !/await fetchLetterheads\(\)\)\?\.page/.test(modal.slice(modal.indexOf('async function prepare'))))
ok('sending writes a "Mandate sent for signing" line for the notes', /Mandate sent for signing online/.test(modal))
ok('the trigger runs before the update, so the request carries the client', /before update on public\.signing_requests/.test(sql.slice(sql.lastIndexOf('create or replace trigger mandate_on_signed'))))

if (failures.length) { console.error(`check-mandate: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`); process.exit(1) }
console.log(`check-mandate: ${pass} passed, 0 failed`)
