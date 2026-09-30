/**
 * RECORDING A PAYMENT BY HAND, AND THE PROOF A PTC CANNOT ARRIVE WITHOUT.
 *
 * THE FIRM asked for three things in one breath: "we should be able to load a manual payment...
 * we need to account for the PTCs that we usually type in manually... let's do it in the finance
 * section and you will be able to do it on the account as well... whenever a PTC is uploaded, it
 * should ask you for a confirmation and you should upload the confirmation."
 *
 * WHY THE PROOF RULE IS THE ONE WITH TEETH. A trust receipt is WITNESSED -- the money is in the
 * firm's own bank and the statement says so. A PTC is CLAIMED: somebody reports that a debtor
 * paid the client direct, the firm never sees the money, and on the strength of that claim it
 * reduces a debtor's balance AND raises an invoice to the client for commission on money it never
 * handled. The confirmation is what that invoice rests on.
 *
 * AND WHY CAPTURE IS NOT IN payover.ts. Everything there is Administrator-only and
 * check-finance-is-administrator-only asserts exactly that of every RPC it calls. Capture is not
 * Administrator-only -- the firm wants it on the account, where collectors and liaisons work --
 * so leaving it there would have meant weakening a security check to fit a feature. Two different
 * questions: who may see the payment SPLIT, and who may record that money arrived.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-record-payment.mjs
 */
import { readFileSync } from 'node:fs'
import { canRecordPayment } from '../../src/lib/permissions.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

const sql = read('supabase/schema.sql')
const lib = read('src/lib/recordPayment.ts')
const payover = read('src/lib/payover.ts')
const modal = read('src/pages/finance/RecordPaymentModal.tsx')
const detail = read('src/pages/accounts/AccountDetail.tsx')
const workspace = read('src/lib/accountWorkspace.ts')

function liveFn(name) {
  const at = Math.max(
    sql.lastIndexOf(`create or replace function public.${name}(`),
    sql.lastIndexOf(`create function public.${name}(`),
  )
  if (at < 0) return null
  const end = sql.indexOf('$$;', at)
  return end < 0 ? null : sql.slice(at, end + 3)
}

/* ---------------- a PTC cannot be recorded without its confirmation ---------------- */

const fn = liveFn('record_manual_payment')
ok('a payment can be recorded by hand', fn !== null)
ok('a PTC without a confirmation is refused',
  /if coalesce\(p_paid_to_client, false\) then[\s\S]{0,200}?if p_proof_document is null then[\s\S]{0,200}?raise exception/.test(fn ?? ''))
/* RAISED AS 23514 so the screen can ask for the file rather than showing a failure. */
ok('...raised so the screen can ask for it', /using errcode = '23514'/.test(fn ?? ''))
ok('...and the browser tells it apart from a real failure', /error\.code === '23514'/.test(lib))

/*
 * CHECKED BEFORE ANYTHING IS WRITTEN. A PTC recorded and THEN failing to attach its confirmation
 * is precisely the state the rule exists to prevent, and account_payments cannot be deleted.
 */
const proofAt = (fn ?? '').indexOf('p_proof_document is null')
const insertAt = (fn ?? '').indexOf('insert into public.account_payments')
ok('the proof is demanded before the payment is written', proofAt > 0 && insertAt > proofAt)

/* A CONFIRMATION FROM ANOTHER DEBTOR'S FILE would attach one client's proof to another's invoice. */
ok('...and it must belong to this account', /v_doc_account <> p_account/.test(fn ?? ''))
/* ONE CONFIRMATION PROVES ONE PAYMENT. Re-used, a single letter from a client would justify a
   second reduction of the debt. */
ok('...and cannot be the proof of two payments', /v_doc_payment is not null/.test(fn ?? ''))
ok('...and it is tied to the payment once made',
  /update public\.account_documents set payment_id = v_payment/.test(fn ?? ''))
ok('the document can carry a payment',
  /add column if not exists payment_id uuid references public\.account_payments\(id\)/.test(sql))

/* A TRUST RECEIPT NEEDS NO PAPER, and the asymmetry is deliberate: it is witnessed by the firm's
   own bank statement. Requiring proof there would stop the bank import dead. */
ok('a trust receipt is not asked for proof',
  /if coalesce\(p_paid_to_client, false\) then/.test(fn ?? ''))

/* ---------------- and the two directions stay opposite ---------------- */

/*
 * THE PTC FLAG IS CARRIED THROUGH RATHER THAN ASSUMED. Hard-coded false, the form's only
 * consequential question would do nothing -- and the failure is invisible until a remittance is
 * drawn, because every figure would still be arithmetically right.
 */
ok('the PTC flag reaches the payment', /coalesce\(p_paid_to_client, false\)/.test(fn ?? ''))
const engine = liveFn('allocate_payment')
/* Measured on one account, same amount, same day: trust -> to_client 370.62, due_to_bf 0;
   PTC -> to_client 0, due_to_bf 612.50. */
ok('trust money leaves the firm owing the client',
  /v_to_client := s\.to_capital - v_commission - v_commission_vat;/.test(engine ?? ''))
ok('...and a PTC leaves the client owing the firm',
  /v_due_to_bf := s\.to_interest \+ s\.to_costs \+ v_commission;/.test(engine ?? ''))
ok('...which are genuinely different branches',
  /if v_pay\.paid_to_client then[\s\S]{0,200}?v_to_client := 0;/.test(engine ?? ''))

/* THE DUPLICATE IS A QUESTION, NOT A REFUSAL -- a debtor genuinely can pay the same amount twice
   in a day -- but it IS asked, because account_payments has no delete. */
ok('a same-day, same-amount payment is queried', /if not p_confirm_duplicate then/.test(fn ?? ''))
ok('...never counting a reversed one', /and reversed_at is null/.test(fn ?? ''))
ok('...raised so the screen can ask', /using errcode = '23505'/.test(fn ?? ''))
ok('...which the browser tells apart', /error\.code === '23505'/.test(lib))
ok('...and never defaults the confirmation to true', /input\.confirmDuplicate \?\? false/.test(lib))

/* received_at IS THE DAY THE MONEY CAME IN: the payover cycle cuts on it, so a PTC reported three
   weeks late belongs in the month the debtor actually paid. */
ok('dated when the money came in, not when it was typed',
  /\(p_received_on::timestamp at time zone 'Africa\/Johannesburg'\)/.test(fn ?? ''))
/* A DATE IN THE FUTURE lands in a cycle that has not been cut. */
ok('...and never in the future',
  /p_received_on > \(now\(\) at time zone 'Africa\/Johannesburg'\)::date/.test(fn ?? ''))

/* ---------------- who may record one ---------------- */

/*
 * THE BOUNDARY IS IN THE DATABASE and the browser only mirrors it, so a screen that forgets the
 * test cannot create a payment anyway.
 */
const may = liveFn('may_record_payment')
ok('the database decides who may record a payment', may !== null)
ok('...the function checks it', /if not public\.may_record_payment\(\) then/.test(fn ?? ''))

/*
 * AN ALLOW LIST, so a role added to the firm later is refused until somebody decides.
 *
 * THE DATABASE'S HALF MOVED AND IS STILL HELD. `may_record_payment` used to spell the five roles
 * out; the firm asked for Swordfish's model -- "you can add them more functionality" -- and a
 * hand-written role name is the one thing a grant cannot reach, so it asks for a capability now.
 * The list itself lives in `role_capabilities`, and it is checked there rather than not at all:
 * greppping the guard for a role name would pass vacuously against a one-line function.
 */
const templates = liveFn('role_capabilities')
ok('the database has the role templates', templates !== null)
ok('...and the guard asks for a capability', /has_capability\('payment\.record'\)/.test(may ?? ''))
for (const role of ['Administrator', 'Call Centre Manager', 'Pre-legal Team Leader',
  'Liaison Manager', 'Liaison']) {
  ok(`${role} may record a payment`, canRecordPayment({ role: role }))
  ok(`...and the database agrees`,
    new RegExp(`when '${role}' then array\\[[^\\]]*'payment\\.record'`).test(templates ?? ''))
}
/*
 * THE SALES SIDE MAY NOT. CLAUDE.md: fees are charged on ACCOUNTS ONLY and the sales side raises
 * nothing -- a representative has no business writing a ledger entry.
 *
 * AND NEITHER MAY A PRE-LEGAL AGENT, which used to be allowed. The firm, seeing the button on a
 * collector's screen: "she's a normal pre-legal agent, she can't be allocating payments."
 *
 * THE PRINCIPLE IS WHO THE MONEY IS LEARNED FROM. A trust receipt comes in on the firm's own bank
 * statement and is imported; the only thing typed in by hand is a PTC, and a PTC is what the
 * CLIENT tells you. An agent deals with the DEBTOR, so they are never the one told "he paid us
 * direct" -- and what they ARE told, that the debtor says they paid, is a claim to be checked
 * against the statement rather than a receipt to record.
 */
for (const role of ['Pre-legal Agent', 'Sales Representative', 'Sales Manager', 'Read Only']) {
  check(`${role} may not`, canRecordPayment({ role: role }), false)
  ok(`...and the database does not list them`, !new RegExp(`'${role}'`).test(may ?? ''))
}
check('nor may somebody with no role at all', canRecordPayment(undefined), false)

/* ---------------- and capture is not the Finance section ---------------- */

/*
 * THE MODULE SPLIT IS THE RULE, NOT TIDINESS. check-finance-is-administrator-only asserts every
 * RPC payover.ts calls is Administrator-only. Capture is not, so it lives elsewhere -- and if it
 * moved back, that check would have to be weakened to keep passing, which is the wrong direction.
 */
ok('capture is not among the Finance RPCs', !/record_manual_payment/.test(payover))
ok('...it has its own module', /export async function recordManualPayment/.test(lib))
ok('...and its own test of who may', /canRecordPayment/.test(read('src/lib/permissions.ts')))

/* ---------------- both screens, one rule ---------------- */

ok('the Finance screen can record one', /RecordPaymentModal/.test(read('src/pages/finance/FinancePayments.tsx')))
ok('...and so can the account', /RecordPaymentModal/.test(detail))
/* GATED ON CAPTURE, NOT ON canViewFinance -- a collector may record a receipt and still never
   see the split. */
ok('...gated on who may record, not on who may see the split',
  /canRecordPayment\(currentUser\)/.test(detail))
/* ON THE ACCOUNT THERE IS NOTHING TO SEARCH FOR: offering a search invites recording a payment
   against the account somebody meant to look at rather than the one they are on. */
ok('...with the account fixed where it was opened on one', /fixedAccount/.test(modal))

/* ---------------- and the debtor does not pay for the firm's evidence ---------------- */

/*
 * ITEM 3 RECOVERS TIME THE DEBTOR CAUSED. A PTC confirmation is the CLIENT's letter, uploaded so
 * the firm can invoice the CLIENT. Charging the debtor a perusal for it would not survive being
 * asked about -- and the default stays true, so every other upload is unchanged.
 */
ok('an upload can opt out of the perusal fee', /chargePerusalFee\?: boolean/.test(workspace))
ok('...and the default is still to charge', /input\.chargePerusalFee === false/.test(workspace))
ok('...and the PTC confirmation opts out', /chargePerusalFee: false/.test(modal))

/* ---------------- and the debtor pays for the verification ---------------- */

/*
 * THE FIRM, CORRECTING A JUDGEMENT OF MINE: "You can charge a perusal fee for a PTC because the
 * debtor has paid into the client's account and it cost us administration to verify this...
 * handle it as other necessary expenses and call it a PTC confirmation."
 *
 * I HAD MADE IT FREE ON THE WRONG REASONING -- that the confirmation is the FIRM's evidence for
 * invoicing the client. The work exists because the DEBTOR chose to pay somebody else, and
 * somebody has to obtain the letter, read it and satisfy themselves the money is real before a
 * balance moves. Item 3 is "other necessary expenses not specifically provided for".
 */
const charges = read('src/lib/accountCharges.ts')
ok('a PTC confirmation is chargeable', /export async function chargePtcConfirmation/.test(charges))
ok('...as item 3, other necessary expenses', /itemId: OTHER_EXPENSES_ITEM_ID/.test(charges))
ok('...named the way the firm names it', /PTC_CONFIRMATION_DESCRIPTION = 'PTC confirmation'/.test(charges))

/*
 * ITS OWN ACTION CODE, NOT `perusal`, AND THAT IS THE LOAD-BEARING PART. A perusal is capped per
 * period however many documents are read; a PTC confirmation is one verification of one payment.
 * Sharing the code would make the second PTC of a period free.
 */
ok('...under an action code of its own', /'ptc_confirmation'/.test(read('src/lib/actionTariff.ts')))
ok('...which the charge uses', /actionCode: 'ptc_confirmation'/.test(charges))
const limits = read('src/lib/actionTariff.ts')
const limitBlock = limits.slice(limits.indexOf('DAILY_LIMIT'), limits.indexOf('TARIFF_HISTORY'))
ok('...and is not capped alongside perusals', !/ptc_confirmation/.test(limitBlock))

/* ONLY ON A PTC. A trust receipt is witnessed by the firm's own bank statement and costs nobody
   any verifying. */
ok('only a PTC raises it', /if \(paidToClient && paymentId\)/.test(modal))
/*
 * AFTER THE PAYMENT, NEVER BEFORE. A PTC that would not save has not been confirmed, and charging
 * first is how a debtor pays for work nobody did -- the same ordering chargePerusal uses.
 */
const payAt = modal.indexOf('await recordManualPayment')
const feeAt = modal.indexOf('chargePtcConfirmation(')
ok('...raised after the payment lands', payAt > 0 && feeAt > payAt)
/* AND NOT TWICE. The upload no longer charges a perusal, so one verification is one fee. */
ok('...and the upload does not charge as well', /chargePerusalFee: false/.test(modal))

/* ---------------- one receipt, several debtors ---------------- */

/*
 * THE FIRM: "in case we have, for example, debt counsellors that pay one payment for five
 * different debtors."
 */
const split = liveFn('split_bank_line')
ok('a receipt can be split between accounts', split !== null)
ok('...by whoever may record a payment', /if not public\.may_record_payment\(\) then/.test(split ?? ''))

/*
 * THE PARTS MUST ADD UP EXACTLY, AND THIS IS THE ASSERTION THE WHOLE FEATURE RESTS ON. Short, and
 * money the bank received belongs to nobody. Over, and the firm has credited debtors with more
 * than arrived and will remit clients for it. Neither is recoverable once a remittance has gone
 * out, because account_payments has no delete.
 */
ok('...and the parts must come to the whole payment', /v_total <> v_line\.amount/.test(split ?? ''))
/* A TOLERANCE HERE WOULD BE MONEY INVENTED OR LOST, so the comparison is exact. */
ok('...with no tolerance on it', !/abs\(v_total - v_line\.amount\)/.test(split ?? ''))
/*
 * CHECKED BEFORE THE FIRST INSERT, so a split that does not balance creates NO payments rather
 * than three of five -- which would be the worst outcome of all, since the three cannot be
 * deleted.
 */
const totalAt = (split ?? '').indexOf('v_total <> v_line.amount')
const firstInsert = (split ?? '').indexOf('insert into public.account_payments')
ok('...before any payment is written', totalAt > 0 && firstInsert > totalAt)
/* AND EVERY ACCOUNT VERIFIED IN THE SAME PASS, for the same reason. */
const acctAt = (split ?? '').indexOf('One of those accounts no longer exists')
ok('...as are the accounts', acctAt > 0 && firstInsert > acctAt)

/* A SPLIT OF ONE IS NOT A SPLIT -- it is Place it, and saying so is kinder than a silent success
   that produces a differently-shaped record for the same act. */
ok('...and one account is refused', /jsonb_array_length\(p_parts\) < 2/.test(split ?? ''))
/* ALREADY PLACED CANNOT BE SPLIT AGAIN. */
ok('...and a receipt already placed cannot be split',
  /v_line\.payment_id is not null or v_line\.status = 'allocated'/.test(split ?? ''))

/*
 * THE LINK TURNS ROUND. One line, many payments -- so the payment knows its line, not the other
 * way about. Without this the second part of a split would overwrite the first on the line.
 */
ok('a payment knows which bank line it came from',
  /add column if not exists bank_line_id uuid references public\.bank_statement_lines\(id\)/.test(sql))
ok('...and every part of a split carries it', /created_by, bank_line_id/.test(split ?? ''))
/* THE LINE IS TAKEN OFF SUSPENSE, or it would be offered for splitting a second time. */
ok('...and the line leaves suspense', /set status = 'allocated', placed_at = now\(\)/.test(split ?? ''))

/* THE SCREEN WILL NOT OFFER AN UNBALANCED SPLIT EITHER, so nobody types five rows and then meets
   the database's refusal. Compared in CENTS -- two floats compared for equality is how a split
   that looks balanced is refused for a hundredth of a cent nobody can see. */
const splitUi = read('src/pages/finance/SplitReceiptModal.tsx')
ok('the screen requires it to balance too', /const balanced = leftCents === 0 && parts\.length >= 2/.test(splitUi))
ok('...counting in cents, not rands', /Math\.round\(receipt\.amount \* 100\)/.test(splitUi))

/* ---------------- and nothing is captured without a reference ---------------- */

/*
 * THE FIRM, LOOKING AT THE BOX: "this reference here should be compulsory."
 *
 * IT IS THE ONLY THING TYING A CAPTURED PAYMENT TO ANYTHING OUTSIDE RAPTOR. Money that arrives on
 * a statement carries the debtor's own reference and is matched on it; a payment typed in by hand
 * carries whatever somebody writes here, or nothing at all. The firm said why when the import was
 * built: "all the reference numbers used on the bank should be saved as well per payment, so that
 * if we, for example, in the future have to reverse a payment" -- a reversal three months later
 * has to be findable in the bank's own records, and "R 5 000, 29 September" is not a way to find
 * it. On a PTC it is the CLIENT's reference, which is what their query about the commission gets
 * checked against.
 */
ok('a payment cannot be captured without a reference',
  /if v_reference is null then[\s\S]{0,200}?raise exception 'Put the reference on it/.test(fn ?? ''))
/* WHITESPACE IS NOT A REFERENCE. A space bar satisfies a `not null` and satisfies nobody looking
   for the payment afterwards, which is the entire purpose of the field. */
ok('...and a space bar is not one',
  /v_reference text := nullif\(btrim\(coalesce\(p_reference, ''\)\), ''\)/.test(fn ?? ''))
/* STORED AS THE TRIMMED VALUE, computed once -- two spellings of the same trim is how the guard
   and the insert come to disagree about what was checked. */
ok('...and what was checked is what is stored', /\n    v_reference,\n/.test(fn ?? ''))
/*
 * REFUSED BEFORE ANYTHING IS WRITTEN, like the proof, and for the same reason: account_payments
 * has no delete, so a payment recorded without one could only ever be reversed.
 */
const refAt = (fn ?? '').indexOf('if v_reference is null then')
ok('the reference is demanded before the payment is written', refAt > 0 && insertAt > refAt)
/* RAISED AS ITS OWN CODE so the screen says what is missing rather than "could not be recorded",
   which reads as something going wrong rather than something left out. */
ok('...raised so the screen can name it', /using errcode = '23502'/.test(fn ?? ''))
ok('...and the browser tells it apart from a real failure', /error\.code === '23502'/.test(lib))
ok('...under a name of its own', /export class ReferenceRequired extends Error/.test(lib))
ok('...which the screen catches', /e instanceof ReferenceRequired/.test(modal))

/* AND THE BUTTON DOES NOT OFFER WHAT THE DATABASE WILL REFUSE -- the same courtesy the PTC proof
   gets, so nobody fills in a form and meets a refusal at the end of it. */
ok('the screen will not offer to record one without it', /&& !!reference\.trim\(\)/.test(modal))
ok('...and says the field is required', /Reference<span className="text-negative-600 ml-0\.5">\*/.test(modal))
/*
 * INCLUDING THE DUPLICATE OVERRIDE. It is a second way to press Record, shown only after the
 * database has asked whether this is a second payment -- and the reference can be cleared between
 * the two presses.
 */
ok('...including the "this is a second payment" way in',
  /onClick=\{\(\) => void save\(true\)\} disabled=\{busy \|\| !ready\}/.test(modal))

console.log(`\ncheck-record-payment: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
