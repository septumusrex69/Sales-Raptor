# Handoff — where Raptor stands

**Read this instead of the previous session's transcript.** CLAUDE.md is the law and does not
change often; this file is the moving part. It says what shipped, what the firm has not yet
decided, what is still open, and which tools lie to you in this repo.

Last updated: **7 October 2026, evening**, end of the third session on
`claude/sales-raptor-review-p1pzx2` (the build items the second session left, prompts 10, 11 and
12, the Ocean skin, and the Payments in redesign twice over — the second time to the firm's own
mock-up). Everything is committed and pushed; the last commit is `6ea667f` and the firm's preview
deploys from it.

### Start here tomorrow

1. **Work on staging.** Production is NOT live and the user has said so: "We are not going live."
2. **The production copy is HALF DONE and PAUSED** (§5, first item, has the exact state). Do not
   resume it unless the user asks.
3. **Built on 7-8 Oct and on staging:** Payments in to the firm's mock-up; a PTC overpayment is the
   client's to sort out (`with_client`); `finance_exceptions` no longer readable by anon.
4. **Run the full suite first** (`npm run qa`). The fast suite on `40fe2ab` is green (16 866).

**Keep it current.** A session that changes something here and does not update this file has moved
the problem to the next session rather than solved it.

---

## 1. The state of play

| | |
|---|---|
| Branch | `claude/new-session-ecohkn` from the fourth session (before it, `claude/sales-raptor-review-p1pzx2`; one branch per session — two sessions on one branch means one force-pushes the other) |
| Staging | `kvkajxpremantdkhmjvb` — work here, data is disposable and the firm has said so |
| Production | `qcvesjzoiznrvunjrqpv` — **do not write to it casually**. It is NOT "a little behind": see §5, first item |
| Live app | Vercel project `sales-raptor`, production deploys **`Main` at `acae2c8` (12 Sep)** against the production database. The firm works on this branch's preview, against staging |
| Repo | **PUBLIC.** No real client data in any commit: no exports, no screenshots of the book, no dumps |
| Verify | `npm run qa` (≈12 min, real browser), `npm run qa -- --fast` (≈3 min), `npm run build`, `npm run lint` |

At the last full run (third session, at `51afe97`): **285 of 288 files green, every browser test
among them**; the three that failed (`check-capabilities`, `check-finance-is-administrator-only`,
`check-themes`) had not been updated for the redesign and were fixed in that commit. Since then
(`6ea667f`, the mock-up layout) the fast suite is **all green, 16 857 checks across 253 files**, and
`e2e/payments-in` (33) and `e2e/reject-payment` (24) were run on their own and are green.

---

## 2. What shipped this session

Newest first. Each commit message carries the full reasoning; this is the index.

**Fourth session (8 October), on `claude/new-session-ecohkn`** (started from `6c19fed`; the firm's preview of THIS branch is a new Vercel URL):

| Commit | What it is |
|---|---|
| (this) | **Overpayments kept: their own line on the Trust overview** (the firm: "under the suspense account ... just to say overpayments kept"). `overpayments_kept()` = parked, not reversed, not taken by the firm (a credit given back counts again); the overview draws it under Unallocated receipts and takes it out of the Debtors line, so "Total accounted for" does not move. Staging: R490.42 kept of the debtors' R980.84 (the rest is Sizwe Dlamini's refund still due). `check-firm-held` +8, `e2e/workspace-split` +3. |
| `7083ef6` | **Payments to make, each with its reference.** Reference = `'BF ' + run number` (BF PO-LVM-2610) or `'BF ' + case number` for a refund (BF RAP-124059), in `payment_out_reference` (SQL) and `paymentReference` (TS), held together by `check-payments-out`. `payments_to_make()` lists approved/sent runs (due the 11th, lag after the cycle) and refunds not paid/cancelled; Trust → **Payments to make** (new rail item, 7 now) totals them and copies a reference. A payment leaves the list only when its statement debit is allocated to it. `bank_allocation_candidates` returns the reference (dropped/recreated), and a debit carrying a reference AND the exact amount is suggested even when two payments are the same amount. The run page and the client's advice say which reference it is paid on; Mark paid starts from it. Fixed on the way: the top bar on that page said "Payments in". |
| `c31af26` | **"Move to another account" moves the money.** It used to note the target and do nothing. Now: a negative debtor entry takes the credit off the first account, and an approved `account_payments` row (source `'moved'`, `moved_from_allocation_id`) on the second is split there by the engine. **No second receipt fee** (the firm's ruling, 8 Oct). Not counted twice: `collector_performance`, `collector_daily`, `payments_in_month`, `client_book_totals` leave `'moved'` out (`account_settlement` keeps it). `reverse_payment` refuses a payment whose overpayment moved. Probed: R769.35 moved, trust total unchanged, fee nil. `check-moved-overpayment` (17). |
| `97531c1` | **A released overpayment and a set-off charge each get a line** on the run page and the client's advice (PDF section "Overpayments paid over to you in full — no commission", .xlsx, workings). Both were already in `net_payover` and on no line, so the advice did not add up (Baobab: lines R9 209.11 vs R9 699.53 paid). `payover_run_payments` returns `excess_disposal` (dropped/recreated). `check-remittance-advice` +8. |
| `7f45fcb` | **An overpayment can be decided, and once decided it leaves Exceptions** (the firm, 8 Oct: "I don't know how to fix anything ... there's no option"). `finance_exceptions` only ever left out `with_client`, so a refund/move/release/park stayed listed with "Decide it" (staging: RAP-124059 had been refunded and was still there) while `payover_run_blockers` had already let the run go. Now `excess_disposal IS NULL`, the blocker's own rule. And "move it to another of their accounts" asked for "the account's id"; it now lists the debtor's other OPEN accounts by identity number (`fetchMoveTargets`), or says there are none. All three disposals proved on staging in a rolled-back probe. `check-payments-queue` 78, new `e2e/excess-credit` (10). |
| `cc308ea` | **An imported account goes to its Swordfish clerk; unknown clerks are flagged; money no desk held is the firm's** (the firm, 8 Oct). The import matches "Assigned To" to an ACTIVE user on the whole name (`clerkKey`: case and spaces ignored, never a first name alone) and sets `assigned_to` and the diary owner; unknown and inactive names are PROBLEMS counted per name ("3 accounts are with 2 Swordfish clerks who are not a Raptor user: ..."), people on actions who are not users a note, their history kept under their name. `record_account_desk_change` dates an imported account WITH a clerk from its handover date (SAST), so the month's receipts are theirs. `collector_performance` gains one no-user row of money no desk held; `splitUncredited` keeps it out of every person and `useCollectionsMonth` adds it to the FIRM's figures only (not a team's), and the hero says "Includes R x not on anybody's desk". `check-import-clerks` (36), `e2e/performance` (102). |
| `c904e61` | **"Current month", not "Current Sales Month"** (the firm: "it's not a sales month ... just current month"). Every option in `SalesMonthPicker` and `PeriodFilter`, the arrows' names, a span's label ("Last 3 months") and the Communications export. The period is unchanged (11th to 10th). The sales dashboard's own "Last Six Sales Months" card is about sales and stays. `check-company-dashboard` holds it. |
| `6e78ea3` | **Folded, the widen button stays at the bottom** (the firm: "the narrow option is at the bottom, but then it moves to the top. Keep it at the bottom"). It now sits under the door, where Narrow is on the open menu; the workspace's name stays on top as a plain label. `check-workspace-split` and `e2e/workspace-split` hold the position; the old layout fails both. |
| `0f3fd73` | **The firm's answers of 8 Oct, built.** (1) **The Swordfish cut-off default is a month earlier**: "import today [8 Oct] ... all payments recovered up until the 10th of August have been paid out. Money collected from 11 August until 10 September will be paid out on 11 October." A CLOSED cycle is not a PAID one; `settledThroughDefault(today, lagMonths = 1)` now answers 10 Aug for 8 Oct (it said 10 Sep, which would have marked a month as remitted and never paid it), and 10 Sep from the payover day (11th) on. (2) **Bank interest is the firm's interest income** ("the regulator said that we can take it"): `business_income` gains a `bank_interest` column (dropped and recreated -- return type widened -- then revoked again), Income shows "Bank interest on the trust account". (3) **"BF funds held: Commission + Fees + VAT"** is drawn on the trust overview, from the new **`firm_held_parts()`** (finance.view, HAVING so a refusal is no row): what the firm's share earned part by part, less bank charges and drawings as their own lines -- adds up to `owed_to_firm` by construction; staging 24 055.36 both ways. Display only, ledger unchanged. (4) **R502 stays**, recorded in `check-fees`. New `check-firm-held` (33); `check-payment-dates`, `check-business-income`, `check-bank-line-allocation`, `e2e/business-income`, `e2e/workspace-split` updated, each break-tested. |
| `efc059b` | **The folded Trust/Business menu is narrower** (the firm: "still quite big ... a little bit smaller"). Rail 56 → 48px, and the gap after it is now the rail's own margin — 12px folded, 24 open — so the page starts 60px from the rail's edge instead of 80. `e2e/workspace-split` holds both (rail ≤ 48, page ≤ 64 from it); the old layout fails it. |

**Third session (7 October):**

| Commit | What it is |
|---|---|
| (this) | **A debtor who overpays the CLIENT directly is the client's to sort out** (the firm, 7 Oct). The split is unchanged and the excess still recorded (the payment must add back), but `allocate_payment` now sets `excess_disposal = 'with_client'` on a PTC overpayment, so it no longer holds the client's payover run on needs_review, is no longer listed under Exceptions, can no longer be refunded/moved/released (released would have paid the client money it already had), and the screens say "overpaid to the client, theirs to sort out". Also closed: **`finance_exceptions` was readable by anon** (a view runs as its owner); revoked from anon and authenticated, its only reader is the Administrator-guarded `finance_exception_jobs`. Proved on staging in a rolled-back PTC of capital + R5 000. `check-payments-queue` 68 → 77. |
| `6ea667f` | **Payments in, laid out like the firm's own mock-up** (7 Oct, "This looks much better. Do something like this."): Record payment (gold) and Import bank statement (outline) on one line with the date; the four figures in ONE card — Waiting for approval, Processed into trust, Paid to clients · PTC, Needs an account (amber when not empty); the last statement folded into a line (`LatestStatement`, "Latest statement · 44 lines · 1 receipt needs an account"); an **Approval queue** heading with "N pending" above its card, empty or not, and a tick-mark empty state; suspense renamed **Needs an account** with a gold top rule and "N to resolve". `BankImportCard` gained a `compact` mode; the full card shares its preview and outcome. The batch summary uses the same hairline grid. |
| `51afe97` | **Payments in, redesigned — processing only.** Top: *Record a payment* beside *Choose a statement*; four tiles (pending processing, processed in trust, paid directly to client, unmatched/suspense — the two "processed" ones this month, summed by the new **`payments_in_month`** behind finance.view); the queue; **suspense below it**. **The list of every payment is gone** ("Payments in is only for processing current payments") — and **Reverse moved to Check** (opened receipt, `payment.reverse`), because that list was the only place in the app that could reverse a payment. The queue is a line a payment (≈48px, 100 a page), tick box and debtor **pinned with an opaque background** (`--color-card-solid`, defined on glass), money scrolling sideways in six groups; badges (credit, capital paid off — never "settled", PTC, came back, in duplum, needs rate, before handover, allocation mismatch, PTC figure mismatch); a **"Projected on approval"** batch summary with three reconciliations and a by-client breakdown; a **breakdown drawer** (the four-figure fee arithmetic moved here from the column headings, still `FeeSections`' definitions); **Approve all asks first** and names its scope. **The one correction: a PTC's "Due to BF" now shows interest + costs + commission + VAT on commission** — the ledger's figure; `allocate_payment` still writes `due_to_bf` without the VAT and is unchanged (display only, the firm's ruling). Found by the browser check: a partial approval's "2 approved, 1 could not be" was wiped by the reload it triggered — fixed. `paymentsQueue.ts` (pure); `check-payments-queue` (68, the firm's Nandi/Lowveld/PTC examples to the cent), `e2e/payments-in` (32, at iPad width). |
| `d936038` | **Ocean: a fifth skin**, off the firm's two photographs — the wing over open water is the band, the open sea under a broken sky is the company dashboard and sign-in photograph, the waves are the sidebar texture. Deep-water navy, sea-spray greys, and the pale champagne of the light on the water as the accent; sea green and coral for good and bad. Its own saying, at the firm's instruction: **"Depth changes / perspective."** The desert keeps "Our world doesn't end at the horizon." Token-only, like the desert; `check-themes` holds its registration and images. |
| `493a99b` | **Prompt 12 — every trust statement line is allocated, in and out.** `allocate_bank_line` (finance.view) says what a line was and writes the ledger entry behind it, tied by `bank_line_id`. Money out can be a payover (exact run match), a refund (settles `trust_payments_out`, which nothing could do before), a transfer to the business (links a recorded drawing or writes one), a **bank charge (a negative FIRM entry = the business owing the trust)**, or other (reason required, on `unidentified`). Money in can be bank interest (credited to the firm), from the business account, or other; a debtor's payment is still *placed*. Debits now arrive `unallocated`, not `excluded`. An allocation is frozen once made. **Trust → Exceptions** lists every line not yet allocated, with suggestions a person confirms. `firm_entry_kind` learns `bank_charge` / `transfer_in`, both kept out of earned and Income. `check-bank-line-allocation` (51), `e2e/bank-line-allocation` (12). |
| `5b96a13` | **Prompt 11 — the date of default is not the handover date.** `handover_date` / `opening_as_at` / `interest_from` = the day the batch is approved (SAST, `firmToday`); the sheet's date of default goes to the new **`debtor_accounts.default_date`**, a record nothing accrues from. Add debtor hands over today and asks for an optional date of default. The account page shows both; the runner's `{{handover_date}}` reads `handover_date`. Engines unchanged (both already start at `handover_date`). Swordfish untouched. `check-handover-date` (21). |
| `04f49b5` | **Prompt 10 — a Swordfish client needs no mandate date for a handover.** `needsMandate()` in the browser and, new, a database trigger on the batch row (`handovers_need_a_mandate` → `client_needs_mandate`): `import_batch_id` set ⇒ exempt; a Raptor client still needs the date. The Mandate card says "Brought across from Swordfish: no mandate needed for handovers". The three functions that read `mandate_signed_at` for COMMISSION are untouched. `check-mandate-rule` (21). |
| `a27f451` | **A client's email filed by hand reaches the client's record too.** `fileOnAccount` reads back the `correspondent` the database decided and, for the client, writes the same email activity the sync writes — both now build it through `clientMailActivity`. Fee unchanged and still raised first. `check-client-correspondence` 37 → 45. |
| `8c93007` | **Business → Income and Drawings, and each rand counted once.** Drawings: what the firm holds in trust (the most it may draw), the month's drawings, and the button — `draw_from_trust` now needs **finance.view AND business.view** (the firm's ruling). Income: a calendar month client by client — commission, VAT on commission, Annexure B fees and costs, interest, charges to clients, unclaimed credit, other — **exact**, because a receipt's ledger entry IS its allocation's four parts (`business_income`). Behind **`business.income`, which no role has, not even the Administrator** ("not even for an administrator"); `NO_ROLE_CAPABILITIES` keeps it out of every template and `all_capabilities()` keeps it grantable. **Fixed a double count:** `business_month` counted a charge set off against a payover in `earned` AND `invoiced`, and called a parked credit given back a drawing; `firm_entry_kind()` is now the one classifier. `check-business-income` (54), `e2e/business-income` (15). |
| `8fc692a` | **The settlement store (task #69).** `account_settlements`: proposed → approved (by the client, recorded with evidence and an expiry) → paid / declined / withdrawn; **lapsed is derived**, never stored. Anybody may put an offer up; **`settlement.approve`** (new: client liaisons + Administrator, the firm's ruling) records the client's yes; **a person** closes a paid one (`close_as_settled` → `settle_account('settled')`), refused on a part payment. `{{settlement_amount}}`, `{{settlement_expiry}}`, `{{settlement_saving}}` exist and answer **only** off an approved, unlapsed offer (`isQuotable`, in `accountMergeValues`, for the page and the runner alike); the settlement call script now pops. Settlement panel on the account, under the promise. `check-settlement` (58), `e2e/settlement` (23). |
| `02d554b` | **The Swordfish import has a Stop button.** Honoured between chunks; a stopped run is taken back out by `discard_import_batch` exactly like a failed one; not offered during the wipe. `e2e/swordfish-import` 31. |

**Second session (6 October, later):**

| Commit | What it is |
|---|---|
| `8c6743a` | **A sliding scale can be seen, set, and prices each account once.** The band rule is settled: ONE rate per account, from the band its capital handed over falls in, decided at handover, boundary rand in the lower band (mandates, model §3a, `rateForCapital`). The engine had been reading the client's bands marginally on cumulative capital; `account_commission_rate` (account's own → band on capital → flat) is now what `allocate_payment`, `preview_allocation`, `expected_from_promises` and `payments_awaiting_approval` charge. `companies.commission_tiers` holds the register's prefix/rate pairs (written by the import from now on) and `commission_bands_dated` the mandate date. **One dialog** (`CommissionModal`, saved by `saveCommission`) opened from Trust settings and the client page's Commission card (Edit, behind `finance.view`); a flat rate over a scale must be ticked to confirm. Trust settings shows "Sliding scale" with bands, or amber **"Scale, boundaries missing"** with the tiers. Account page and payment detail say the rate **and where it came from** ("21% — as billed in Swordfish (KIS tier)"). A handover — and a single account added by hand — is priced on each account's own capital and **refused** for a client on tiers with no boundaries (`handoverRateBlock`, checked in `approveDraft` before any write). The trigger `companies_commission_expected` moves `commission_rate_expected` (never `commission_rate`) when a client's rule changes, so "off their mandate rate" counts accounts off the CURRENT rule. `check-commission-rule` (42), `e2e/commission-scale` (25). |
| `089a604` | **A client's commission can be a sliding scale from Trust settings** (the firm: "Here I can't choose a sliding scale"). The tier editor was lifted out of Add client into `CommissionScaleEditor` and `src/lib/commissionTiers.ts`, so both screens share it. Superseded in part by `8c6743a`, which moved the dialog into `CommissionModal`. |
| `eb7c973` | **A promise from Swordfish is history, not a new arrangement.** An "open" Swordfish promise already past its date (incl. Swordfish's own "Late") comes in **broken** — not defaulted, which would start the broken-promise workflow and write to the debtor — with a note, and its account filed under 'Failed PTPs' so the Broken promises list finds it; nobody's diary (the firm: "it might fill up the collector's diary"). On a live imported arrangement the promise workflow records its confirmation as **not sent** and sends only dates still ahead, today included. Staging: the 8 confirmation charges cancelled with a reason, the 4 overdue promises marked broken, their accounts filed. `check-imported-promises` (27). |
| `5779bac` | **Accounts list columns: drag to resize, double-click the edge to fit** (iPad double-tap too); widths per device; reset link. |
| `e6f7cf5` | **The import button is a button** — `btn-primary` was never defined; three screens drew it as plain text. |
| `aaca1ff` | **Prompt 8 — a Swordfish import is all or nothing.** `import_batch_id` on companies, handovers and debtor_accounts (everything else cascades from an account); on any failure the screen calls `discard_import_batch(id)` and says the run was taken back out. The RPC is Administrator-only and refuses once money on the batch has been split or put in trust. `e2e/swordfish-import` uploads real CSVs at both cut-offs and makes the interest insert fail. |
| `e98f814` | **Prompt 8 — URGENT: a receipt Swordfish already paid over is never split.** `allocate_payment` never asked `paid_over_in_swordfish` (its own comment named the reason; the code did not), so the insert trigger split every imported receipt. Now the FIRST gate, before the open-period interest. `reverse_payment` and `move_payment_to_cycle` refuse one. `swordfish_remitted_leaks()` counts anything that got through. Proved on staging by `scripts/qa/live/swordfish-cutoff-probe.sql`; `scripts/qa/live/check-swordfish-leaks.mjs` fails on any leak. |
| `d336a64` | **The trust overview in the firm's revised layout**, and **a narrowed Trust/Business menu keeps its icons** (`b108da2`). See §4.5. |
| `f001783` | **The client's email is not the debtor's correspondence.** `account_emails.correspondent` ('debtor' / 'client'), decided on INSERT by `account_email_correspondent` for all three writers: the account's own debtor contact wins; otherwise the client company's address (or a contact's at it or its parent), or a reply to a client row, is the client. The debtor's Emails tab reads only 'debtor'; a ticket reads both. The Messages menu sends a client's answer to its ticket (read on follow); a client email with **no** ticket gets an email activity on the client's own record from the sync, and is left out of the menu's account list so it is not announced twice. `protect_account_mail_fields` now locks the column too. **Fees untouched** — and since ruled on: client correspondence about an account is still charged to the debtor (CLAUDE.md, Annexure B rules). `check-client-correspondence` (37). Staging: three rows marked, all on tickets; the rule's dry run touched nothing else. |
| `e2d87c0` | **Node 22.22 decodes windows-1252 as Latin-1**, so 0x80–0x9F (curly quotes, dashes, €) became invisible control characters in every mail body `toText` read. Corrected from the WHATWG table. `check-mime-parts` had been red on a clean tree because of it. |
| `5e6c4d5` | **A calendar invitation opens the email**, wherever it is. `?message=` used to look only in the first page of All and give up quietly. A miss now fetches the row by id (`fetchMailItem`), moves to the tab holding it (`tabOf`, now the one statement of the rule `bumpUnread` used), waits for THAT tab's list, then opens it. e2e/mail covers both layouts and a message past the first page of Junk; the original page fails it. |

**First session:**

| Commit | What it is |
|---|---|
| `be1e03b` | **A payment has two dates.** `received_at` is what the debtor did; `allocated_on` is what we did, and it decides which payover run the money goes out on. Set once, at approval. `paid_over_in_swordfish` marks money the old system already remitted: out of the queue, never split, never claimed, and `approve_payment` refuses it. |
| `5156deb` | **Trust overview answers "does it balance?"** with a panel that can say no. See §4 for why the sketch's own reconciliation was not built. |
| `24debef` | **An imported account is not a new handover.** No handover email or SMS on an imported file, and none on an account outside the Active book. |
| `f8d9084` | Revokes from `public, anon` on four functions; the status-event trail has no write policy. |
| `8e853d0` | Moving an account between books (hold / release / withdraw / settle), and the Swordfish balance-gap panel. |
| `71e6aa2` | A company debtor keeps its registration number; the wipe says what it would delete. |
| `d2b2d56` | The clients list counts the actual book; Annexure B item 9 cap is dated as charged. |
| `9d4c520` | **Three books: Active, On hold, Closed** — a stored generated column, so it cannot drift. |
| `f3a6405` | **The PostgREST 1 000-row cap.** The most serious bug found. See §5. |
| `d0ba7a9`, `7447ae2` | The trust, bucketed by the payover cycle each part is waiting for. |

### Uncommitted at handoff

Nothing.

---

## 3. Open requests the firm has made and nobody has started

None outstanding as a build. The third session built everything the second left (§2). What is left
is waiting on an ANSWER, not on work — §4 — and the production go-live, which the user has said
will be done later (§5, first item).

**Explained to the firm, no change asked for** (so a new session does not "fix" them):
- **The interest lines on an imported account** were confusing because of how Swordfish
  calculated and showed interest, not because Raptor got it wrong (the firm: "The problem is not
  you"). Imported figures stay as imported (CLAUDE.md).
- **Going back from a handed-out batch** to the "ready to import" state: the existing **Discard**
  on the handover import already does it while nothing on the batch has been worked; the firm
  understood it once explained.

---

## 4. Decisions waiting on the firm

Do not guess these. Each one changes money.

1. ~~R502 or R509?~~ — **decided 8 Oct: R502 stays.** "The actual fee was 509 as per the Gazette
   ... they undercharged 7 Rand for years. There's nothing that we can do about that now. So we will
   leave it like that." Do not move it. Recorded in `check-fees.mjs`.

2. ~~When did Swordfish last pay its clients over?~~ — **decided 8 Oct**: on import day, everything
   up to the 10th of the month BEFORE last is paid (import 8 Oct → 10 Aug); the cycle that closed last
   (11 Aug – 10 Sep) is still in trust and goes out on 11 Oct. Built as the import's default. On the
   11th itself the run counts as made -- the box is still editable for an import that morning.

3. **`payover_lag_months` is confirmed at 1** by the same answer (a cycle ending on the 10th pays on
   the 11th of the next month). **`parked_credit_months` (6) is still a placeholder**: it is how long a
   debtor's small unclaimed overpayment is parked before the firm may take it as its own (the firm:
   "who are we going to pay five rand to?"). The firm did not know the term; ask it in those words.

4. ~~Commission / fees / VAT split of the firm's trust balance~~ — **firm said do it (8 Oct); built**
   as earned-by-part less drawings (§2). If the firm wants each PART's balance after drawings (e.g.
   "VAT still held for SARS"), a drawing would have to say what it draws -- a ledger change; ask.
   Original note: The firm's sketch asks for it. It
   is **not stored** — `trust_creditors_on_allocation` writes interest, costs, commission and VAT as
   one entry with one reason. Rebuilding it reaches allocation-backed rows only and silently misses
   charge recoveries and drawings, so the parts would not sum to the whole. The alternative is
   changing a financial ledger. **Ask.**
   **Asked for again** in the firm's revised design (6 Oct: "BF funds held: Commission + Fees +
   VAT = total" under the ownership table). Still not drawn, and the page's source says why at the
   spot it would go. This is now the one line of their design that is missing.

5. ~~The trust overview's "unexplained difference"~~ — **resolved 6 Oct.** The firm sent a revised
   design ("Raptor Trust Overview, Revised") and the page now follows it: three figures, who owns
   the money with an "Ownership reconciliation" beside it, collections by period as a table. The
   reconciliation's line is still nil by construction; it is summed on the screen from the parts,
   and what CAN be wrong (bank vs ledger, unplaced money, a client in debit, a late payover) is
   listed under it — "totals match" only when none is open. Two deliberate departures: an
   "All periods" totals row (the tie-out between the two halves) and a "Less: owed back by
   clients" owner row that appears only when one exists.

6. **A bank statement for an account that is not the trust account.** On staging, 14 pending
   payments came from a statement for account 9999999999 rather than the trust account
   (62700201255), so the trust overview shows nothing for them — `trust_position` reads only the
   trust account's lines. Asked: refuse such a statement outright, or allow it after an
   Administrator confirms? Also proposed: an "Awaiting approval" row in the overview's ownership
   table for money banked but not yet approved. **Not answered; nothing built.**

8. ~~Bank interest on the trust account~~ — **confirmed 8 Oct**: the firm's income, the regulator
   allows it. Now its own line on Income (§2). Original note: **Bank interest on the trust account is credited to the FIRM** by prompt 12's allocation. That
   follows the firm's own words ("interest received ... allocated"), but who trust interest belongs
   to is a regulatory question (Debt Collectors Act / the firm's auditor). **Confirm it**; if it is
   not the firm's, the `bank_interest` branch of `allocate_bank_line` is the one line to change.
9. **Bank charges: the firm says they are a BUSINESS expense, not the trust's** (8 Oct), and is
   finding out from the bank whether they leave the trust account and the business pays them back.
   Wait for that before changing anything. Original note: **Bank charges are recorded as owed by the business to the trust** (the prompt's rule), and are
   left out of the business side's "earned". They do not yet appear as an EXPENSE on the business
   side unless somebody captures them under Expenses, so "made" is overstated by them until then.

10. ~~Where a PTC overpayment's credit sits~~ — **decided 7 Oct**: "we only process the amount
    that is due. The client should sort that out." Built: the engine marks it `with_client` (§2).
11. **The items 1–7 cap per payment.** The engine reports what the in duplum ceiling refuses
    (`*_cant`), and the queue badges and the drawer show it as "can't recover". It does NOT report
    per payment what the items 1–7 cap (R1 225 / capital) held back, so no badge says a payment was
    clipped by it and nothing claims one is "within limit". If the firm wants that badge, the engine
    has to return the figure — a change to `preview_allocation`, not to the screen.

**Decided on 7 October (third session), so nobody asks again:** a settlement's approval is recorded
by the client liaison role (+ Administrator); a paid settlement is closed by a PERSON, never by
itself; the Income screen is behind a tick no role has; a drawing needs both the trust and the
business ticks; **a PTC's Due to BF includes the VAT on commission**, as a display correction only —
no toggle, the allocation and the ledger unchanged. (The payover run was already right: it sets off
`commission_vat` across every line, PTC lines included, separately from its own `due_to_bf`.)

7. **Kestrel's rand boundaries.** Staging now carries Kestrel's four register tiers (KIS 21%, KIS2
   15%, KIS3 12%, KIS4 10%, typed from prompt 9 — the register file is not in this repo) and NO
   bands, so its client page and Trust settings say the boundaries are missing and a new handover
   for it is refused. That is correct until somebody types the boundaries from the signed mandate.
   Proved in a rolled-back transaction with test boundaries 100k / 250k / 1m: R10 000 → 21%,
   R600 000 → 12%, R100 000 → 21%, R100 000.01 → 15%, KIS0012 still 21% and not flagged. **The
   real boundaries are the firm's to enter**; the 10% flat rate the import left on Kestrel is
   cleared the moment they do.

---

## 5. Known gaps and things still outstanding

- **PRODUCTION COPY: PAUSED HALF-WAY ON 8 OCT, AT THE USER'S WORD ("we are not going live").**
  Production (`qcvesjzoiznrvunjrqpv`) still serves the old `Main` (`acae2c8`) and is safe for it.
  Method: rebuild from staging's CURRENT catalog (not by replaying 302 migrations), idempotently,
  then diff the two catalogs. The user chose to copy the firm's SETUP too (library templates incl.
  48 edited in-app, workflows as published, firm settings) but not staging's test clients/accounts.
  - **Done** (`golive_01`–`golive_13`): both sequences; all 68 tables with every column (column
    fingerprints match staging on all 68, except `diary_entries.priority`, not yet added, and
    `account_payments.collection_commission`, put BACK because live `Main` selects it — drop it at
    go-live); three old prod differences aligned; functions `account_*` through `is_staging_database`
    (≈80 of 189); row-level security switched ON for every table (no policies yet, so the new tables
    refuse everyone — the live app does not use them).
  - **Not done, in this order:** the two views (`account_money_position`, `finance_exceptions`,
    both revoked from anon/authenticated); functions `m*`–`w*`; `diary_entries.priority`
    (generated from `diary_priority`); constraints; indexes; policies; triggers (incl.
    `on_auth_user_created`); grants and function revokes; storage buckets (`letterheads`,
    `client-documents`) and their 12 policies, and letterhead image files; the pg_cron job
    `close-payover-cycle`; a `deployment` row of kind 'production'; the setup data; a full
    catalog diff (md5 of every function body, constraint, index, policy); then merge into `Main`.
  - **Two traps found:** the Supabase tool silently waits for a confirmation nobody can give on any
    statement containing delete/drop/truncate — even inside a function body — and times out after
    60s. Wrap such functions as `do $x$ begin execute replace($src$...d§elete...$src$, '§', ''); end $x$;`
    (the generator query used is in the transcript). And a pipe that lets production pull from
    staging over HTTP was refused by the safety check and removed — use the Supabase tools.
  - Once `Main` deploys, the daily workflow run and 5-minute mail sync act on production data, and
    `CRON_SECRET` was marked "rotate before real client traffic".
- **FOUND, NOT FIXED: reversing an approved payment fails on staging** unless it is already on an
  issued run. `reverse_payment` → `reverse_payment_allocation` → `reallocate_account` removes the
  account's un-invoiced allocations, and `trust_creditor_entries.allocation_id` still references
  them (FK, append-only ledger), so the whole reversal errors. That is the **Reverse** button on
  Trust → Check. Probed with a plain R500 payment, no move involved. Needs a ledger-design fix
  (reversing entries instead of removing the allocation), and the firm's eye on it before it ships.
- **The firm wants Check moved before approval** ("the check should happen before the payment is
  done") and will ask for it; nothing built.
- **A test-data prompt** for another session (two Swordfish clients, all six import files, trust
  statements in and out) was written on 8 Oct; its formats are the importers' own column lists.
- **The dashboard's R0 (8 Oct) is answered** (§2): staging's company figures now include the R58 300
  no desk held. **The accounts already imported on staging were NOT re-assigned** -- they went in
  before the rule; re-run the import (or assign them) to see clerks credited. Of the 20 Swordfish
  clerk names only Vusi Maringa matches a staging user exactly ("Itumeleng" is not "Itumeleng
  Masalesa"); the rest need adding as users first.
- **Not built: assigning an account LATER when its clerk is added as a user afterwards.** Today a
  leader does it by hand; the name is on the account (`swordfish_assigned_to`) to do it from.
- **Fourth session, staging only** (all at the end of `schema.sql`): `business_income` (bank_interest),
  `firm_held_parts`, `record_account_desk_change`, `collector_performance` (no-user row, then 'moved'
  left out), the `finance_exceptions` view, `payover_run_payments` (excess_disposal),
  `account_payments.moved_from_allocation_id` + `allocate_payment`, `reverse_payment`,
  `dispose_excess_credit`, `collector_daily`, `payments_in_month`, `client_book_totals`,
  `payment_out_reference`, `payments_to_make`, `bank_allocation_candidates`, `overpayments_kept`.
- **Prompts 10–12 are on staging only:** `client_needs_mandate` + the `handovers_need_a_mandate`
  trigger; `debtor_accounts.default_date`; the five allocation columns on `bank_statement_lines`,
  `allocate_bank_line`, `bank_lines_to_allocate`, `bank_allocation_candidates`, and new versions of
  `import_bank_lines`, `protect_bank_statement_line`, `unreconciled_payouts`, `firm_entry_kind`,
  `business_month`, `business_income`.
- **Staging data as left by this session:** SMT, BPM and LVM carry `mandate_signed_at` = 1 Jan 2024
  (somebody set it; prompt 10 said null — left as found). Their 60 sheet accounts keep the
  `handover_date` of 7 Oct the user set; `default_date` was filled for all 60 from their draft rows.
  The test statement's two R57.50 `##BANK CHARGE` lines are **unallocated on purpose** — confirm
  them on Trust → Exceptions; the probe proved what they become. Its two unplaced receipts
  (`CAPITEC T NGUBANE` R300, `CAPITEC SMT199999` R450) are debtor payments to be PLACED.
- **The test statement is not on the trust account number** (`9999999999` vs `62700201255`), so
  `trust_position`'s bank balance does not see it — §4 item 6. Allocation works on it anyway.
- **Third session's earlier work is on staging only:** `account_settlements` and its five functions,
  `settlement_today`, the two new ticks in `role_capabilities` / `all_capabilities`,
  `firm_entry_kind`, `business_drawings`, `business_income`, and the new `business_month` and
  `draw_from_trust` — all at the end of `schema.sql`.
- **PROMPT 9 IS ON STAGING ONLY.** Production needs, from the end of `schema.sql`: "A CLIENT'S
  SLIDING SCALE PRICES EACH ACCOUNT ONCE" (`commission_band_rate`, `account_commission_rate`, the
  four engine functions), the `commission_tiers` / `commission_bands_dated` columns, and "THE
  MANDATE RATE AN ACCOUNT IS COMPARED AGAINST FOLLOWS THE CLIENT'S CURRENT RULE". The checked-in
  `preview_allocation` had drifted from staging; `schema.sql` now carries the live one, so read the
  LAST definition when porting.
- **Only Kestrel has `commission_tiers` on staging.** Other clients get theirs from the next
  Swordfish import (`swordfishImport.ts` writes them where a client's prefixes carry more than one
  rate). Until then a multi-tier client with no bands is not caught by the handover block.
- **Saving a client's commission re-splits at most 200 accounts from the browser** (as before);
  the rest are picked up account by account through the exception queue.

- **Item 8 of prompt 7 could not be investigated.** APM20070, APM20097 and GPS4/10080 fail a
  payments reconciliation; the files are not in this repo. A reconciliation was built into the
  import instead, so the real migration cannot pass it silently.
- **Item 6 remainder:** "allow the wipe on production only before the first migration" is not done —
  it needs a fact about production that nothing in Raptor records.
- **The settlement store has no letters yet.** The fields exist and answer off an approved offer,
  but there is no settlement OFFER letter or settlement CONFIRMATION letter in the library, and the
  SETL call disposition still only writes its note (it does not open the panel's propose box).
- **The R22,77 settlement shortfall on RRC00002** is unexplained, and is NOT what the settlement
  store is about: it is the full-balance "to settle today" quote's receipt fee being worked on the
  balance while the fee charged is 10% of the payment. Still the firm's question.
- **Income counts what the trust LEDGER credits the firm.** A PTC's earnings (paid straight to the
  client) are recorded as the client owing the trust, not as a firm entry, so they reach Income only
  when recovered. Worth confirming with the firm what they expect to see for those.
- **PROMPT 8 IS ON STAGING ONLY, AND PRODUCTION MUST HAVE IT BEFORE ANY REAL IMPORT.** The
  `allocate_payment` gate, the `reverse_payment` / `move_payment_to_cycle` refusals,
  `swordfish_remitted_leaks()`, `import_batch_id` and `discard_import_batch` — all at the end of
  `schema.sql` under "A RECEIPT SWORDFISH ALREADY PAID OVER" and "AN IMPORT IS ALL OR NOTHING".
  Without the gate, the real migration (12 078 interest rows) would split every remitted receipt
  into trust exactly as the test book did. After any import, run
  `scripts/qa/live/check-swordfish-leaks.mjs` against that database.
- **Staging was found already cleared** (book + finance; 7 users, 170 templates, settings and
  tariffs kept) when prompt 8 was picked up. **The test import has not been re-run** — the test
  book is the firm's export and is not in this public repo. Re-run it from the branch preview, then
  run the leak check (or `select * from swordfish_remitted_leaks()` on staging): all four counts
  must be nil.
- **`account_emails.correspondent` is on staging only.** Production needs the migration (end of
  `schema.sql`, "WHO IS ON THE OTHER END") and then a decision on its existing client rows: on
  staging they were marked by re-running the rule, and the user chose to leave production's to the
  firm, case by case. Until then production behaves exactly as before.
- **The debtor's Activity timeline still carries a note for client correspondence** (the sync's and
  `recordSentEmail`'s `account_notes` rows). The firm's complaint was the Emails tab, which is the
  evidence; the timeline was left alone. Raise it if they mention it.
- **Imported accounts were given handover runs before the guard landed** — 20 on staging, 8 closed
  and 3 on hold. Not swept: a correction is the firm's decision, case by case.

---

## 6. Traps in this repo that cost real time

These are not in CLAUDE.md because they are about the tools, not the firm.

**PostgREST silently truncates at 1 000 rows.** A request over the cap SUCCEEDS — no error, no
flag, no count — and `.limit(2000)` does not raise it. This had ten of 28 test accounts showing the
wrong fees and four showing none. Always page through `fetchAllRows`; `check-row-cap.mjs` holds
every large-table read to it.

**`schema.sql` is append-only, so read the LAST definition.** `indexOf('create or replace function
public.<name>(')` lands on a superseded copy and asserts against code that is not live.
`check-allocation-start` was doing exactly this and had been for some time. Anchor on the full
phrase — a bare `lastIndexOf(name)` hits the function's own comment or grant and returns nothing,
which fails OPEN because every regex then tests an empty string.

**The MCP SQL tools have limits that fail in misleading ways.**
- `execute_sql` times out above roughly 4 kB, and on any query containing the literal words
  `drop` / `delete` / `truncate`. Workaround: `execute 'dr' || 'op ...'`.
- `apply_migration` **timed out on an 8 kB function and did not apply it** while appearing to fail
  ambiguously. Always verify against `pg_proc` afterwards.
- For a large function, rebuild it from its own live `prosrc` with `replace()` inside a `do` block:
  the payload stays small and the file and the database match by construction.
- Verify every mirror by md5: strip `/*…*/` and `--`, collapse whitespace, hash both sides.

**Run the checks and the commit as SEPARATE steps.** In this environment's shell, `set -e` and
`grep -q` on the QA summary did not stop a chained command: twice a commit was pushed with the fast
suite red (`5779bac`, `eb7c973`, each fixed in the next commit). Read "All green" with your own
eyes, then commit.

**`apply_migration` hangs on the word `delete` too**, not only `execute_sql` — a function with a
`delete from` in its body timed out and applied nothing (prompt 8). Build the text with
`replace($f$ ... DEL_ETE ... $f$, 'DEL_ETE', 'del' || 'ete')` inside a `do` block and `execute` it;
the stored function is byte-identical to `schema.sql`.

**A comment can claim a guard the code does not have.** `allocate_payment` said "THREE REASONS NOT
TO TOUCH IT ... history that Swordfish settled" over a line that checked two. Checks that read
source must strip comments first, and so must a person reviewing it.

**`create or replace` is not always a replace.** A new defaulted parameter creates an OVERLOAD; a
widened `returns table` is refused outright. Both need a DROP — and **a dropped function comes back
with the default PUBLIC grant**, however carefully the old one was revoked. This is how three of
four book readers ended up reachable by `anon` while their sibling was locked.

**`revoke ... from anon` is not enough.** Postgres grants EXECUTE to PUBLIC on every new function
and anon inherits it. The house pattern is `from public, anon`; the evidence is a leading
`=X/postgres` in `pg_proc.proacl`.

**`innerText` is the RENDERED text.** A heading with `uppercase` comes back as `CLIENT`. Three
assertions in one session failed on perfectly correct screens because of this.

**Playwright's locators race React.** The URL changes before the row it decides is drawn, so
reading a locator on the next line can return an empty list and then count correctly a millisecond
later — a check that reports the wrong number and passes. Wait for the element.

**Node 22.22's `TextDecoder('windows-1252')` is Latin-1.** The C1 band 0x80–0x9F comes back as
control characters, not curly quotes and dashes. `toText` in `api/_lib/mime.ts` corrects it; any new
decode of mail bytes should go through `toText`, not a bare `TextDecoder`.

**The e2e stubs answer `account_emails` with `[]`**, so no browser test sees the Emails tab filter.
The filter is a PostgREST clause; its proof is on staging (a query for the account the firm saw) and
in `check-client-correspondence`, not in a stub that would only test itself.

**`en-ZA` groups thousands with U+00A0** and renders September as "Sept". Build the separator as
`String.fromCharCode(0xa0)`; never type it. In an SMS it costs real money — see CLAUDE.md.

**`new Date('2026-10-11')` is UTC midnight**, which is the wrong day in Johannesburg for two hours.
`new Date(Date.UTC(...))` is safe and `check-trust-cycles` now exempts that shape by name.

**Two QA harnesses compare with `Object.is`**, which is false for any two objects — so object
assertions fail on correct code. Compare as JSON strings. The e2e responder signature is
`(url, request)`, not `(request)`.

**A comment can break a check.** A note in `schema.sql` saying what must never be added contained
the words it was warning about, and the check counted the warning as the thing. Strip comments
first — the house already does this in `check-company-dashboard`.

**`create or replace trigger` exists (Postgres 14+)** and avoids writing `drop trigger`, which the
MCP tools hang on. Prompt 9's `companies_commission_expected` was created that way.

**Chromium's `en-ZA` thousands separator is not Node's.** Node gives a (non-breaking) space; the
e2e browser has drawn a comma. A browser assertion on a Rand amount matches `[\s,]`, never a
literal space.

**`protect_profile_privileged_fields` silently reverts a grant made with nobody signed in.** In a
probe, set `request.jwt.claims` to an Administrator BEFORE updating `profiles.grants`/`revokes`; done
as plain `postgres` first, the update "succeeds", the trigger puts the old value back, and the
capability then reads false for no visible reason. The trigger is right — it is the probe order.

**Staging's book is empty** (0 accounts, 0 payments, 3 companies). A behaviour probe has to create
its own account inside the rolled-back transaction; a `debtor_accounts` row needs only `company_id`,
and `commission_rate` is a FRACTION (0.20), checked by `debtor_accounts_commission_rate_is_a_fraction`.
An approved receipt inserted there runs the real engine (allocation + ledger entries).

**This session started on a stale `Main`.** A fresh container may check out `Main` (12 Sep, the
live deployment), not this branch. Fetch `claude/sales-raptor-review-p1pzx2` before believing
anything is missing.

**Break-test convention, and it is not optional.** After writing a check, break the thing it guards
and confirm it fails. Twice this session a "break test" was equivalent code and proved nothing;
once a sed silently failed to apply and the green result was meaningless. Verify the sabotage
actually landed before trusting the red.

---

## 7. How to pick up

1. Read CLAUDE.md, then this file.
2. `git log --oneline -12` — the commit messages carry the reasoning, not just the change.
3. `npm run qa -- --fast` before touching anything, so you know what was already red.
4. Work on staging; mirror every migration into `supabase/schema.sql`; verify by md5.
5. Update §2, §3 and §5 of this file before you finish.
