/**
 * A SETTLEMENT OFFER TELLS THE LIAISON, AND THE CLIENT IS SHOWN WHAT IT PAYS (S22 · Raptor H20, 18 Nov).
 *
 * Stephan: "It should definitely create a ticket for the client liaison and notify the liaison ... This is a high
 * priority" -- and "an automatic calculation ... and a letter that is sent, like a settlement proposal letter for the
 * client ... how much capital will be settled minus commission and how much the client will get out."
 *
 * THREE HALVES. The letter as a pure function (its figures are exactly the engine's, in the firm's order, and an
 * offer the account cannot take is refused); the ticket kind (never charged, never offered on the Escalate menu);
 * and the database read back from schema.sql, LAST definitions, comments stripped -- the trigger raises the ticket on
 * the offer and closes it on the answer, and the breakdown reads preview_allocation rather than working it out again.
 * What the database DOES was proved on staging in a rolled-back transaction (T-1094, withdrawn, closed with it).
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-settlement-ticket.mjs
 */
import { readFileSync } from 'node:fs'
import { toBreakdown, owedToday, writtenOff } from '../../src/lib/settlement.ts'
import { settlementProposalLetter, settlementProposalRefusal } from '../../src/lib/settlementProposalLetter.ts'
import { isPrintable } from '../../src/lib/winAnsi.ts'
import { ESCALATION_KINDS, ESCALATION_KIND_ORDER, escalationChargeable, clientSection } from '../../src/lib/disputeCategories.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')
const lastFn = (sql, name) => {
  const i = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (i < 0) return ''
  const a = sql.indexOf('as $$', i)
  return strip(sql.slice(i, sql.indexOf('$$;', a + 5)))
}

/* ---------------- the figures: BNP0015's R500 offer, as settlement_breakdown returned it on 18 Nov ---------------- */

const b = toBreakdown({
  amount: '500.00', capital: 525.82, interest: 110.13, fees: 250.71, receipt_fee: 57.5,
  to_fees: 139.87, to_interest: 110.13, to_capital: 250, commission: 62.5, commission_vat: 9.38,
  commission_rate: 0.25, to_client: 178.12, bf_takes: 312.5, excess: 0,
  capital_after: 275.82, interest_after: 0, fees_after: 168.34, as_at: '2026-11-18',
})
check('the amount arrives as a number', b.amount, 500)
check('owed today is the three parts the engine reported', owedToday(b), 886.66)
check('written off: the client gives up the capital left, the firm its fees and interest',
  writtenOff(b), { byClient: 275.82, byFirm: 168.34, total: 444.16 })
check('a null rate stays null (no percentage printed, rather than 0%)',
  toBreakdown({ commission_rate: null }).commissionRate, null)
check('an ordinary offer may go to the client', settlementProposalRefusal(b), null)
ok('an offer above what the account can take is refused, and says how much',
  /R455\.58/.test(settlementProposalRefusal({ ...b, excess: 455.58 }) ?? ''))

const money = (n) => `R ${n.toFixed(2)}`
const doc = settlementProposalLetter({ breakdown: b, money, reason: 'Lost his job in October' })
const text = JSON.stringify(doc.blocks)
const rows = doc.blocks.filter((x) => x.kind === 'table').slice(1)
const cellText = (row) => row.map((c) => c.spans.map((s) => s.text).join('')).join(' | ')
check('three tables after the reference strip: outstanding, the split, written off', rows.length, 3)
check('what is outstanding, capital first and the fees named as Annexure B',
  rows[0]?.rows.map(cellText),
  ['Capital | R 525.82', 'Interest | R 110.13', 'Our fees (Annexure B to the Debt Collectors Act) | R 250.71',
    'Total outstanding | R 886.66'])
check('the split ends on what the client receives, commission and its VAT taken off',
  rows[1]?.rows.map(cellText),
  ['The debtor pays, once, in full | R 500.00',
    'To our fees (including the R 57.50 receipt fee on this payment) | R 139.87',
    'To interest | R 110.13', 'To capital | R 250.00',
    'Less our commission on the capital collected (25%), with VAT of R 9.38 | –R 71.88', 'You receive | R 178.12'])
check('the written-off table splits it between the client and the firm',
  rows[2]?.rows.map(cellText),
  ['Capital you write off | R 275.82', 'Fees and interest we write off | R 168.34', 'Total written off | R 444.16'])
ok('it asks for the answer in writing', /reply to this email in writing/.test(text))
ok('it says the figures are today’s', /as at 18 November 2026/.test(text))
ok('the collector’s note travels with it', /Lost his job in October/.test(text))
ok('addressed to the client, signed by the signatory', /\{\{client_name\}\}/.test(text) && /\{\{signatory_name\}\}/.test(text))
/* EVERY CHARACTER PRINTABLE: the letter is drawn in Windows-1252 and a single U+2212 refused the first draw. */
const allText = doc.blocks.flatMap((x) => [...(x.spans ?? []), ...(x.rows ?? []).flat().flatMap((c) => c.spans)]).map((s) => s.text).join('')
check('every character in it can be printed', [...allText].filter((c) => c !== '\n' && !isPrintable(c.codePointAt(0))), [])
ok('nothing in it is addressed to the debtor', !/Dear \{\{debtor_name\}\}/.test(text))

/* ---------------- the ticket kind ---------------- */

ok('a settlement ticket is a kind', !!ESCALATION_KINDS.settlement)
check('...never charged to the debtor', escalationChargeable('settlement'), false)
check('...goes to the liaison', ESCALATION_KINDS.settlement?.goesTo, 'liaison')
ok('...and is not on the Escalate menu: Raptor raises it', !ESCALATION_KIND_ORDER.includes('settlement'))
check('...and is on no client portal list', clientSection('settlement'), null)

/* ---------------- the database ---------------- */

const sql = read('supabase/schema.sql')
const raise = lastFn(sql, 'raise_settlement_ticket')
const trig = lastFn(sql, 'settlement_ticket')
const bd = lastFn(sql, 'settlement_breakdown')
const preview = lastFn(sql, 'preview_allocation')
const kinds = sql.slice(sql.lastIndexOf('account_queries_kind_check'))
ok('the kind check allows a settlement ticket', /'settlement'\]\)\)/.test(kinds.slice(0, 400)))
ok('raise_settlement_ticket exists', raise.length > 0)
ok('...only for an offer still waiting', /v_s\.status <> 'proposed' then return null/.test(raise))
ok('...one ticket per offer', /where settlement_id = p_settlement/.test(raise))
ok('...owned by the client’s liaison, at the liaison stage, due today',
  /c\.account_owner_id as liaison/.test(raise) && /'settlement', 'liaison', 'open', v_a\.liaison/.test(raise)
  && /public\.settlement_today\(\)/.test(raise))
ok('...and the liaison is told, high priority, straight to the ticket',
  /'settlement\.proposed'/.test(raise) && /'High priority: a settlement needs/.test(raise) && /'\/queries\/' \|\| v_q/.test(raise))
ok('the trigger raises it on the offer', /tg_op = 'INSERT'[\s\S]*raise_settlement_ticket\(new\.id\)/.test(trig))
ok('...and closes it when the offer is answered or paid', /set status = 'closed'[\s\S]*where settlement_id = new\.id/.test(trig))
ok('...and tells whoever put it up when the client answers',
  /new\.status in \('approved', 'declined'\)/.test(trig) && /new\.proposed_by is distinct from auth\.uid\(\)/.test(trig))
ok('the trigger is on account_settlements, insert and status',
  /create trigger account_settlements_ticket\s+after insert or update of status on public\.account_settlements/.test(sql))
ok('the breakdown READS preview_allocation, never a second sum',
  /from public\.preview_allocation\(v_s\.account_id, v_s\.amount\)/.test(bd) && !/\*\s*0\.\d+/.test(bd))
ok('...and asks the liaison’s tick or finance’s',
  /has_capability\('settlement\.approve'\) or public\.has_capability\('finance\.view'\)/.test(bd))
ok('preview_allocation answers the liaison too',
  /has_capability\('finance\.view'\) or public\.has_capability\('settlement\.approve'\)/.test(preview))

/* ---------------- S22, round two: frozen, pro rata, discount, the debtor told ---------------- */

const split = lastFn(sql, 'payment_split')
const forPay = lastFn(sql, 'settlement_for_payment')
const ssplit = lastFn(sql, 'settlement_split')
const freeze = lastFn(sql, 'settlement_freeze')
const alloc = lastFn(sql, 'allocate_payment')
const disc = lastFn(sql, 'propose_settlement_discount')
const trig2 = lastFn(sql, 'settlement_ticket')
const bd2 = lastFn(sql, 'settlement_breakdown')
ok('the engine posts through payment_split, not finance_split directly',
  /public\.payment_split\(v_acct\.id, v_day, p_payment_id,/.test(alloc) && !/public\.finance_split\(/.test(alloc))
ok('...and so does the preview the approval queue shows',
  /public\.payment_split\(p_account, v_day, p_exclude_payment,/.test(preview) && !/public\.finance_split\(/.test(preview))
ok('...and a settlement allocation is stamped as one', /when s\.settlement is not null then 'v2-settlement' else 'v2-5050-split'/.test(alloc))
ok('payment_split chooses the pro-rata split only for a settlement it pays',
  /settlement_for_payment\(p_account, p_payment, p_day, p_exclude_payment\)/.test(split)
  && /if v_s\.id is not null then[\s\S]*settlement_split\([\s\S]*else[\s\S]*finance_split\(/.test(split))
ok('...never on a moved overpayment (no receipt fee there)', /if coalesce\(p_fee_rate, 0\) > 0 then/.test(split))
ok('a settlement is paid only by an approved, frozen offer, before its expiry',
  /s\.status = 'approved'/.test(forPay) && /s\.snap_capital is not null/.test(forPay) && /and s\.expires_on/.test(forPay))
ok('...in ONE payment of the whole figure, nothing else received towards it',
  /round\(coalesce\(p_amount, 0\), 2\) >= s\.amount/.test(forPay) && /not exists \([\s\S]*account_payments/.test(forPay))
ok('the split is pro rata over the snapshot, the receipt fee inside the figure',
  /v_pool := p_snap_interest \+ p_snap_costs \+ fee_excl \+ fee_vat \+ p_snap_capital/.test(ssplit)
  && /v_share := case when v_pool > 0 then p_amount \/ v_pool/.test(ssplit)
  && /fee_excl := round\(least\(p_amount \* p_fee_rate, p_fee_cap_excl\), 2\)/.test(ssplit))
ok('...capital takes the odd cent, so the parts add to the amount', /to_capital := least\(greatest\(v_amt - to_interest - to_costs, 0\)/.test(ssplit))
ok('the offer is frozen on the way in, and keeps what the debtor offered',
  /tg_op = 'INSERT'[\s\S]*new\.offered_amount := coalesce\(new\.offered_amount, new\.amount\)[\s\S]*settlement_snapshot\(new\.account_id\)/.test(freeze))
ok('...and an offer (or counter) at or above what can be collected is refused',
  /new\.amount >= new\.snap_capital \+ new\.snap_interest \+ new\.snap_costs then\s*raise exception/.test(freeze))
ok('the freeze runs before insert and on a changed amount',
  /create trigger account_settlements_freeze\s+before insert or update of amount on public\.account_settlements/.test(sql))
ok('a discount is worked out on the snapshot, by the database',
  /settlement_snapshot\(p_account\)/.test(disc) && /round\(v_total \* \(1 - p_pct \/ 100\), 2\)/.test(disc))
ok('the breakdown reads the same pro-rata split on the snapshot', /settlement_split\(v_s\.amount, v_s\.amount, v_s\.snap_interest/.test(bd2))
ok('...with the client’s commission on the capital it pays', /finance_commission\(r\.to_capital, public\.account_commission_rate\(v_s\.account_id\)/.test(bd2))
ok('the answer starts the debtor’s letter: declined, countered (a different figure) or accepted',
  /new\.status = 'declined' then 'settlement_declined'/.test(trig2)
  && /new\.amount <> coalesce\(new\.offered_amount, new\.amount\) then 'settlement_countered'/.test(trig2)
  && /else 'settlement_accepted'/.test(trig2) && /insert into public\.workflow_runs/.test(trig2))
const kindsCheck = sql.slice(sql.lastIndexOf('add constraint workflow_versions_trigger_kind_check'))
ok('the three trigger kinds are allowed', ['settlement_accepted', 'settlement_countered', 'settlement_declined'].every((k) => kindsCheck.slice(0, 600).includes(`'${k}'`)))
ok('each has a one-step workflow pointing at its emails', /'email-settlement-' \|\| a\.answer \|\| '-individual'/.test(sql) && /'email-settlement-' \|\| a\.answer \|\| '-company'/.test(sql))
const step = read('api/_lib/workflow/step.ts')
ok('the debtor’s letters are never charged', /FREE_TRIGGERS = new Set\(\['settlement_accepted', 'settlement_countered', 'settlement_declined'\]\)/.test(step)
  && /paidUp: account\.ended_as === 'paid_up' \|\| account\.ended_as === 'settled'\s*(\/\*[\s\S]*?\*\/\s*)?\|\| FREE_TRIGGERS\.has\(String\(\(versionRes\.data/.test(step))
const att = JSON.parse(read('scripts/letters/attachments.json'))
check('every answer email attaches its own letter',
  ['accepted', 'countered', 'declined'].flatMap((a) => ['individual', 'company'].map((w) => att[`email-settlement-${a}-${w}`] === `letter-settlement-${a}-${w}`)),
  [true, true, true, true, true, true])
const frozenDoc = JSON.stringify(settlementProposalLetter({ breakdown: { ...b, frozen: true, discountPct: 10 }, money }).blocks)
ok('a frozen proposal promises the exact figure and drops the interest caveat',
  /you receive exactly R 178\.12/.test(frozenDoc) && !/Interest runs until/.test(frozenDoc) && /figures fixed on/.test(frozenDoc))
ok('...and names the discount', /\(a 10% discount\)/.test(frozenDoc))
ok('...and asks for a counter offer as one of the answers', /would accept a different amount, or decline/.test(frozenDoc))

/* ---------------- the screen ---------------- */

const panel = read('src/components/accounts/SettlementPanel.tsx')
const page = read('src/pages/accounts/AccountDetail.tsx')
ok('recording the answer sends the debtor’s letter now', /onDone=\{answered\}/.test(panel) && /nudgeWorkflowsForAccount\(accountId\)/.test(panel))
ok('a discount can be proposed', /proposeSettlementDiscount\(accountId, p, note\)/.test(panel))
ok('the card shows the figures to whoever records the answer', /s\.state === 'proposed' && canApprove && \(\s*<ProposalFigures/.test(panel))
ok('...and refuses to send an offer the account cannot take', /onSend && !refusal/.test(panel))
ok('the page attaches the letter and addresses the client', /settlementProposalLetter\(/.test(page) && /setComposeTo\(client\?\.email/.test(page))

if (failures.length > 0) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-settlement-ticket: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length > 0 ? 1 : 0)
