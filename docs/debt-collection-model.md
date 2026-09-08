# Debt collection: money model and migration

Working specification. Written from decisions taken with Bredell Ferreira; the parts still
being confirmed are marked **OPEN** and must be settled before the calculation engine is built.

Nothing in this document is legal advice. The statutory points — particularly *in duplum* and
the VAT treatment of the Annexure B tariff — need confirming with whoever handles compliance.

---

## 1. What the system has to model

A client hands over a book of bad debt. Bredell Ferreira collects on it and earns from three
separate sources, which behave differently and must never be summed into one figure:

| | What it is | Whose money |
|---|---|---|
| **Capital** | The principal debt handed over | The client's, less commission |
| **Annexure B fees** | Statutory charges for work done on the account | BF's |
| **Interest** | 2% per month on the account | BF's |

**Commission** is charged on capital collected. Fees and interest are recovered on top of it.

The risk sits with BF: where nothing is collected, the fees and interest laid out on that
account are a loss. That unrecovered cost is a real number the system must be able to report,
per account, per client and per batch — a client who never pays is not neutral, they are a
loss, and its size should never be a mystery.

---

## 2. Statutory fees — Annexure B

Encoded in `src/lib/annexureB.ts` from GN R.7207, Government Gazette 54273, 6 March 2026.
Versioned by effective date: a future gazette adds a schedule, it never edits the existing
numbers, so an account worked under an old tariff keeps calculating on that tariff and a
reissued statement still matches the one the debtor was originally sent.

Three properties of the tariff that shape the build:

**The ceiling on items 1–7.** *"The total amount to be recovered from the debtor in respect of
items 1 to 7 shall not exceed the capital amount of the debt or R1225,00, whichever is the
lesser."* It binds **recovery**, so it has to be enforced as fees accrue rather than checked at
settlement — by then the work is done and was never recoverable. On a large book it bites
hard: a R100,000 debt still caps action fees at R1,225, so recovery there comes from
commission, interest and the item 9 receipt fee, not from the work.

Items **8 and 9 fall outside** that ceiling.

**Monthly limits, per account.** Ten electronic communications (item 1(c)), four credit bureau
searches (item 4(c)). The eleventh SMS in a month is not billable, so the agent interface must
show the remaining allowance *before* the action, not after.

**Item 9, the receipt fee.** 10% of the instalment received, maximum **R610 per payment** (not
per account — confirmed). It applies to *"instalments made directly to the client"* too, so
client-reported payments must be capturable or the fee is lost silently. And *"no additional
fee shall be charged for any attendance in connection with the receipt or payment of any
instalment"* — an agent may not bill a call for chasing or receipting a payment, which the
interface has to prevent rather than merely discourage.

**Item 4(a), acknowledgement of debt**, is banded by debt size: **R161 up to R49,999 and R209
from R50,000 up**, both excluding VAT.

---

## 2a. FCC — Final Collection Commission

Resolved. FCC is **Final Collection Commission**: what the item 9 commission *would* be if the
debtor settled the whole remaining balance in one payment. It appears on every statement so the
settlement figure is one honest number instead of something the debtor has to work out.

```
FCC = min( 10% x balance-before-FCC , R610 ) x 1.15
```

where balance-before-FCC is capital + interest + fees already raised + commission already
earned on payments received.

Confirmed against both worked statements the business supplied, and against 214 live accounts —
exact to the cent on **193 of them (90%)**, with 88 sitting precisely on the R610 ceiling. The
21 that do not fit are almost entirely in duplum accounts, where the ceiling interacts with this
in a way not yet established.

### Three rules that fall out of it, and all three matter

**FCC is never revenue.** It is a quotation, not an earned fee. Across the September 2026 export
it was **47% of everything reported as fees** — R168,563 of R360,811. Any figure that treats
`All Fees (inc VAT + FCC)` as income overstates the book by nearly half. Earned fees are the
other 53%.

**FCC is recomputed, never accumulated.** Each statement replaces the previous figure. It is a
derived display line, not a posted transaction — visible in the worked statements, where the
first statement's R238.63 does not appear anywhere in the second. Store it as a fee row and it
compounds against itself every time a statement is produced.

**FCC is computed last**, after the commission actually earned on payments received, because
those reduce what is left to settle.

### What *is* earned: the receipt fee

Distinct from FCC and often confused with it. When a payment arrives, 10% of that payment
(excl VAT, capped at R610 per payment — Annexure B item 9) is charged as **Collection
Commission**. That one is real revenue, posted as a transaction, and it stays on the account.

The order on receiving a payment is therefore:

1. credit the payment against the balance
2. debit the receipt fee — 10% of the payment, plus VAT
3. recompute FCC on the new balance

Worked through on the business's own second statement: a R100 payment reduces R2,075 to R1,975;
the R11.50 receipt fee takes it to R1,986.50; FCC recomputes to R228.45; the statement closes at
R2,214.95.

### Rounding

R2,075 x 10% x 1.15 is exactly R238.625 and the statement shows R238.63. As a double it is
238.62499999999997, so `toFixed(2)` returns 238.62 — a cent light on every statement, on every
account. `roundToCents` in `annexureB.ts` rounds half up through the representation gap, and
every rand figure the module returns goes through it.

## 3. Commission

Per client, negotiated — 10%, 25%, 30% have all been used.

A single client may have **several rates banded by debt size**: for example accounts under
R100,000 at 25%, accounts over R100,000 at 20%. So commission is a **banded schedule attached
to the client**, never a single number on a settings page.

VAT applies to commission.

**The band is fixed at handover.** Whichever bracket the account falls into when it is handed
over is the bracket it stays in — a R120,000 account paid down to R80,000 keeps the rate it
started on. Like the in duplum ceiling, it is decided once and never recalculated.

Practically, that means the rate is stamped on the account at handover rather than looked up
per payment: two accounts from the same client, handed over at different sizes, carry different
rates for life, and re-reading the client's schedule later would silently change historical
allocations.

---

## 3a. Sliding-scale commission

Some clients — Growthpoint among them — are not on a flat commission rate. The rate moves in
bands with the amount, so the same client earns us a different percentage at different points.

Swordfish does not model this at all, which is one of the reasons it has to be replaced rather
than lived with. Commission there is a single figure per client, so a sliding scale has to be
worked out by hand every month and cannot be reconciled against anything.

The model is therefore: commission is a **set of bands per client, effective-dated**, not a
rate. A flat-rate client is the one-band case, which keeps the common path simple without
making the sliding-scale client a special case bolted on afterwards.

> **Open:** what the bands are measured against — the size of the individual payment, the
> cumulative amount collected on that client to date, or the cumulative amount within a period.
> The three give materially different answers on the same money and the difference compounds
> over a year. Needs the actual agreement before anything is built.

## 4. Interest

- **2% per month, accrued daily**
- On the **total outstanding balance** — capital + fees + interest already capitalised
- A fee starts earning interest **immediately**, from the day it is raised
- Subject to in duplum (§5)

**Daily accrual, monthly capitalisation.** Interest is not a monthly step. Every day adds a
day's interest, so the balance on the 7th reflects seven days and the balance on the 6th
reflects six. At month-end the accrued interest is fixed and written into the balance, and from
then on it earns interest itself — which is what makes it compound.

This has a consequence worth stating plainly: **a balance is only meaningful with a date
attached.** Every quote, statement and settlement figure must record the date it was calculated
for, because the same account gives a different answer tomorrow. A settlement figure sent to a
debtor without a date on it is wrong the moment it is opened.

**OPEN — the daily rate.** "2% per month, calculated daily" can mean either 2% divided by the
number of days in that month (so exactly 2% accrues each month, and a day in February is worth
more than a day in March), or an annual 24% divided by 365 (so every day is worth the same and
a 31-day month accrues slightly more than 2%). The month-end fixing described above points at
the first, which is the reading assumed here — but it needs a yes, because the two diverge on
every account.

## 4a. Interest rates are negotiated, and dated

The standard rate is 24% per annum. It is not universal: in the export, two accounts of 214 run
at 12%, and the rate can be lowered by negotiation with a client.

Two rules follow, and both matter more than they look:

- **A change carries the date it takes effect.** Interest already accrued at the old rate stays
  accrued at the old rate. A rate that is edited in place silently rewrites every statement ever
  issued on that account.
- **A rate can be set on a client or on a single account.** Client is the normal case — a
  negotiated concession applies to everything they hand over. Account is the exception, and the
  more specific setting wins.

So the resolution order for the rate applying to an account on a given day is: account rate
effective on that day, else client rate effective on that day, else the 24% standard.

## 5. In duplum

**An account cannot more than double.** Interest and fees *together* may not exceed the
capital: a R1,000 account can never carry more than R1,000 of interest and fees, so the most it
can ever reach is R2,000.

**The ceiling never falls, but it does rise.** It is set from the capital handed over and does
not track the outstanding balance: capital paid down to R750, or R700, leaves the ceiling at
R1,000. But if further debt for the same debtor is later handed over and added to the account,
the ceiling rises with it.

So the ceiling is **the total capital ever handed over on that account** — increased by each new
handover, never reduced by payment. One figure held on the account, recalculated only when
capital is added, which also removes any question of what happens to charges already raised when
a ceiling drops: it cannot drop.

**Charges keep accruing past the ceiling; only the ceiling is recoverable.** Interest and fees
continue to be raised against the account after the cap is reached, and the excess is simply
not collectable from the debtor. This is deliberate: it keeps the true cost of the account
visible, so the system can report what an account actually cost against what could be recovered
from it. Freezing the charges at the cap would hide that, and the unrecovered cost is exactly
the number BF carries the risk on.

It also tells you when to stop working an account: once recovery is capped and the cost keeps
climbing, further work is money spent that can never come back.

**Confirmed against live data.** In the sample export, every account flagged `In Duplum = Yes`
has interest plus fees equal to capital to the cent — a ratio of exactly 1.000 across all six.
So the rule as described is the rule as operated.

The sample also shows what Swordfish does *not* do. On those capped accounts the interest
figure derives negative (−R356.65 on a R812 capital with R1,168.65 of fees), because Swordfish
presents the capped total rather than the true accrual: once fees alone exceed the ceiling, the
interest it reports is whatever makes the arithmetic land on the cap. The real cost of that
account is gone.

That is precisely the visibility BF asked for and cannot currently get. Raptor should hold both
figures — what actually accrued, and what is recoverable — so the difference between them is
reportable as the loss it is.

### Interest is worth more than fees

**Interest carries no VAT. Fees do.** Every rand of fee recovered has VAT inside it that must be
paid over; a rand of interest recovered is kept whole.

So where the in duplum cap limits what can be recovered, it is materially better for BF that
the recovered amount is made up of interest rather than fees. The allocation order in §7 already
clears interest before fees, which turns out to be both the agreed rule and the commercially
better one — worth stating explicitly so nobody "simplifies" that order later without realising
it costs money.

## 5a. Prescription

**Not previously in this document, and it has to be.** Swordfish tracks `Is Prescribed`,
`Days To Prescription`, and an `Interruptor Before Handover` date on every account. A prescribed
debt is unenforceable, so this is not a reporting nicety — it decides whether an account may
lawfully be worked at all.

What the sample shows: every account carries a live countdown (1,055 and 1,092 days in the two
rows examined), and a handover date that acts as the interrupter. So the model needs, per
account: the date prescription currently runs from, the resulting prescription date, and a
record of each act that interrupts and restarts it — acknowledgement of debt, part payment,
summons.

This connects directly to the clerk portal. An acknowledgement of debt is both a chargeable item
4(a) *and* a prescription interrupter; a part payment is both an allocation *and* an interrupter.
The same action has to do both jobs, and an account approaching prescription is the most urgent
thing on a clerk's queue by a distance.

**OPEN:** the prescription period per debt type (three years for most, thirty for judgment
debts and mortgage bonds), and exactly which acts BF counts as interrupting.

## 6. VAT

- On **commission**: yes
- On **Annexure B fees**: yes
- On **interest**: no — interest is recovered whole (see §5, which is why interest is cleared
  first)
- **Every amount in the tariff is VAT-exclusive** — the gazetted figures, the AOD bands, all of
  them. VAT is added when the fee is raised. Recorded on the schedule itself in
  `src/lib/annexureB.ts`, because the gazette doesn't state it and reading those figures as
  inclusive would understate every fee on every account.

The items 1–7 ceiling is taken on the same VAT-exclusive basis — the consistent reading of a
single tariff, though the gazette doesn't spell it out. Flagged rather than confirmed.

The rate itself must be configurable with effective dates — VAT rates change, and a historical
statement has to reproduce the rate that applied then.

---

## 7. Allocation of a payment

The split is **50/50 and non-negotiable**.

On a payment `P` received on date `D`:

1. **Accrue interest** to `D` — compound, on the full running balance.
2. **Apply the in duplum cap** to accrued interest.
3. **Raise the receipt fee**: `min(10% × P, R610)`, per item 9.
4. **Split `P` in half.**
5. **Cost half** clears, in order:
   1. accrued interest
   2. fees — receipt fee and action fees; their relative order is immaterial and is BF's
      choice, since both are BF's money
6. **Capital half** reduces capital by that full amount. Out of it:
   - commission at the client's banded rate
   - VAT on that commission
   - the remainder is the client's
7. **Surplus goes to capital.** Where the cost half exceeds what interest and fees actually
   require, the remainder is applied to capital. So once fees are worked off, the client
   receives *more* than half of each payment — which is the intended behaviour, and the reason
   later payments are worth more to the client than early ones.

   Example: cost half R250, interest and fees together only R80. Interest is cleared, then
   fees, and the remaining R170 goes to capital on top of the R250 capital half.

**The 50/50 split is absolute.** It applies to every payment without exception, including one
smaller than the interest owed. A R100 payment against R300 of accrued interest still splits
R50 / R50 — it does not all go to interest merely because interest is cleared first. The
ordering governs what the cost half pays for, never how much the cost half is.

### Worked example

Capital R1,000 · action fees R500 · interest accrued R100 · commission 30% · VAT 15%.
Debtor pays **R500**.

| Cost half — R250 | | Capital half — R250 | |
|---|---|---|---|
| Interest | −100.00 | Capital 1,000 → **750.00** | |
| Receipt fee, 10% of R500 | −50.00 | Commission @30% | −75.00 |
| Action fees, 500 → 400 | −100.00 | VAT @15% on commission | −11.25 |
| | | **To the client** | **163.75** |

Closing balance: **R750 capital + R400 fees**, plus interest running from `D`.

This example is stated VAT-exclusive on the fees, pending §6.

---

## 7a. Paid To Client (PTC)

A debtor sometimes pays the client directly instead of paying us. Swordfish calls this a
"Client Direct" payment; the house term is **PTC — paid to client**. It was 25 of 1,070 payments
in the export, so roughly 2%, but the amounts are not small and the accounting is not the same.

**The allocation is identical to any other payment.** Fees, interest, commission and the receipt
fee are all earned exactly as they would have been. Nothing about the debtor's account changes:
the balance comes down, the split is the split.

**What differs is only where the cash sits.** The money is in the client's bank account, so
instead of us owing the client their share, the client owes us ours.

That produces a running two-sided position per client, and a month-end net:

| | |
|---|---|
| Money we collected | we owe the client their share |
| Money paid to the client (PTC) | the client owes us our share — fees, interest, commission, receipt fee |

At month end the two are netted per client. Usually we owe them and remit the difference.
Sometimes their PTC share exceeds what we hold, and then **the client owes us and we invoice
them**. Both directions have to be first-class: a remittance system that can only pay out will
quietly under-bill every client whose debtors pay them directly.

This is also why PTC cannot be modelled as "a payment we did not receive". It is a full payment
for every purpose except custody of the cash, and treating it as anything less loses real
revenue.

## 8. Records

Two rules, both about being able to answer a question years later.

**Every payment stores its own allocation, permanently.** Not recomputed on demand. When a
debtor or the Council queries a statement from three years ago, it must reproduce exactly what
was charged then — after commission rates changed, after the tariff was regazetted, after the
VAT rate moved. Recalculating from current rules silently rewrites history, and in a regulated
collections environment that is a legal problem rather than a bug.

**Every fee stores the tariff item and schedule it came from.** "R25" is not enough; "item 1(a),
schedule of 6 March 2026" is what makes a bill defensible on taxation.

---

## 9. Migration from Swordfish

Raptor replaces Swordfish as the system of record. Swordfish can export the full composition of
every account — capital, fees, interest, and every payment — which makes a clean migration
possible.

That fidelity matters more than it might appear. A migrated account is **mid-life**: its balance
is some capital, some fees, some interest, in a proportion Swordfish arrived at over months
under its own rules. Import only a total and that composition is gone irrecoverably — there
would be no way to know how much of the next payment goes to capital rather than fees, so every
allocation after cutover would be wrong and no statement would reconcile against the one the
debtor was sent the month before.

So each account arrives as an **opening position at a stated cutover date**: capital
outstanding, fees accrued, interest accrued, as three separate figures — plus payment history
for statement continuity.

**Sequence:**

1. Settle the OPEN items in this document
2. Sample export from Swordfish, to shape the account model against real columns
3. Build the account and payment model, with allocations stored immutably
4. Import, and **reconcile totals against Swordfish before trusting anything**
5. Agent interface on top of a book already known to be correct
6. Parallel run, then cutover

The interface is step 5 deliberately. An interface over a wrongly migrated book is worse than
no interface: it looks authoritative while being wrong.

**Every migrated client arrives with a mandate**, so the import does not have to handle
clients without one. But that is a record to create, not a check to skip: a handover cannot be
loaded against a client with no signed mandate on file, so if the import brings in accounts and
books without also recording the mandate, the rule fires on the first new batch after go-live —
for every migrated client at once, and for a reason that is true in Raptor and false in life.

So each migrated client needs a Handover deal marked Won, standing for the mandate they already
hold, dated from Swordfish where it records one and from the earliest handover otherwise.

**Swordfish stays readable after cutover.** Statements covering periods it calculated will still
be needed, and the Council can ask.

**POPIA.** Importing the book moves a large volume of debtor personal information into a new
system, with the access control, retention and security obligations that follow. Worth settling
before the data lands rather than after.

---


### What the 7 Sep 2026 exports proved

Three reports were analysed: Client Account Summary (214 accounts), All Payments per Client
(1,070 payments across 167 accounts) and Actions performed per Client (59,158 actions across
735 accounts).

**Reconciles cleanly.** Payments matched `Payments To Date` to the cent on all 65 accounts
present in both reports. `Current Balance = capital + interest + All Fees` held on all 214,
worst error one cent. `Fees & Expenses` is exactly the action costs excluding VAT. In duplum
behaves as described: of 14 flagged accounts the highest (balance − capital) ÷ capital is
exactly 1.000, and one sits below zero — paid under capital but still flagged, which is the
ceiling being fixed at handover and not falling.

**The three exports are three different populations.** 214 / 167 / 735 accounts, with only 65
in common between the first two. Migrating from exports pulled this way would lose most of the
payment and fee history. Every extract for the real migration must be taken over one identical
account list.

**"Client" in Swordfish means handover tranche.** Growthpoint appears as four clients
(2024-1, 2024-2, 2025-1, 2025-2) and Adowa as two; ten Swordfish clients are about six real
ones. The importer has to collapse these into one client with dated handover batches.

**The tariff is effective-dated, and this is provable.** Every billed action type steps on
1 April 2026 — phone call, email and letter R21 → R25, consultation R52 → R60, promise to pay
R41 → R50, SMS R3 → R3.50 per part, and acknowledgement of debt R210 → R161. See
`src/lib/actionTariff.ts`.

**Two earlier conclusions of mine were wrong, and are corrected here.**

- I reported SMS as under-charged by R5,441 because charges appeared at R3 against a R6 rate.
  They are billed per message part: every one of 5,779 pre-April SMS charges is an exact
  multiple of R3, splitting 1,472 / 3,251 / 1,037 across one, two and three parts. There was no
  under-charging. The R6 I took for the unit rate is simply the commonest case, a two-part
  message.
- I reported R12,022 of over-charging as a compliance risk. Measured against the rate in force
  on the day rather than against today's rate, over-charging is R274 across ten actions.
  The real figure is 91.6% of billed non-SMS actions at exactly the right rate, and the
  remainder almost entirely under-charged — R10,098 excl VAT foregone. It is a revenue leak,
  not a compliance exposure.

**One account is already prescribed** — "Prescribed 191 days ago" — and still Active with
collection activity running against it.

**287 account-months exceed ten electronic communications**, the highest being 46 in one month.
Flagged for checking rather than as a finding: whether the Annexure B cap counts per account or
per debtor, and exactly which action types fall inside it, is not yet confirmed.



### The four reports, and what the 8 Sep 2026 set proved

| Report | Loads into |
|---|---|
| Client Account Summary | clients + `debtor_accounts` |
| Actions performed per Client | `account_fees` + activity history |
| Interest per Period | `account_interest_accruals` |
| All Payments per Client | `account_payments` + `payment_allocations` |

Pulled over one account list — 735 accounts in all four — the dry-run has **no blocking
failures**. Balances hold to a cent on all 735, payments reconcile exactly on all 167 accounts
that have them, every in duplum account respects its ceiling, and every charged action maps to
the catalogue.

**Interest is held as concurrent accrual streams, not one monthly series.** Swordfish runs
interest on the balance alongside interest on fees — which start earning as they are raised —
and breaks a period at each payment date. So one account legitimately shows 20–30 July and
1–31 July at the same time. A first version of the check read those as overlapping periods and
failed good data; what is worth testing is that no exact period is recorded twice.

Where the balance is still capital plus interest, the report reconstructs it exactly on all 136
such accounts. The rest are excluded for reasons that are correct rather than suspicious: 20 in
duplum (capped), 299 written off and 113 frozen (interest stopped), and any account with
payments (the balance has moved). Tolerance scales with the number of periods, because each
monthly accrual is rounded to a cent before storage and a long history accumulates that.

**Cancelled actions are still billed, and that is correct.** 846 actions carry a cancellation,
190 of them with a charge — R7,699 excl VAT, 137 cancelled as "Replaced by New PTP". Excluding
them makes the fee reconciliation *worse* (92% to 76%), so it is Swordfish's real behaviour, and
the business confirms it is deliberate: the fee attaches to the action being **issued**, not to
its outcome. A debtor who arranges to pay, defaults, and then makes a fresh arrangement has had
two arrangements set up, and is charged for both. The cancellation records that the first one
failed; it does not undo the work.

So an importer must carry cancelled actions across **with their fees intact**. Treating a
cancellation as a reversal would quietly write off R7,699 on this sample alone, and rather more
across a hundred thousand accounts.

### The dry-run harness

`scripts/swordfish/reconcile.mjs` checks whether our model reproduces Swordfish's numbers,
and is meant to be run before any import writes a row:

```
node --experimental-strip-types scripts/swordfish/reconcile.mjs \
  --summary accounts.csv --payments payments.csv --actions actions.csv
```

It imports the app's own tariff rather than restating the rates, so it cannot pass against
numbers the app does not actually use. It exits non-zero on a failure, so it can gate an import.

Against the 7 Sep 2026 exports it passes on balances, payments, in duplum and action
identification. The one remaining failure is the population mismatch, which is a matter of how
the exports are pulled rather than anything wrong with the data.

Two ideas earn their place here. **Evidenced overrides** resolve a vague legacy name against
what the record shows was actually done — "Correspondence" is an outgoing email because all 25
charged instances are commented "Emailed debtor" at the R21 email rate — and the evidence is
written down beside the mapping so it can be argued with later. **Quarantine** handles the
opposite case: "Necessary Costs" and "Team Leader Assistance" import as history but their
R193 is held out of the balances, because a fee filed under a guessed Annexure B item is a wrong
statement waiting to be reissued, and dropping it silently is no better.

## 10. Open items, collected

- **How the R610 FCC ceiling behaves on an in duplum account.** The 21 accounts that do not
  fit the confirmed formula are almost all in duplum, so the two ceilings appear to interact.
- **What the sliding-scale commission bands are measured against** (see 3a).
- **Whether the electronic-communication cap is per account or per debtor**, and which action
  types count toward it.
- **Item 1(b)**, the registered-letter fee, still to be confirmed.

| # | Question | Blocks |
|---|---|---|
| 1 | The daily interest rate — 2% ÷ days in month, or 24% ÷ 365? | Interest |
| 2 | Item 1(b), registered letter under s57 — the Magistrates' Courts figure. **Awaiting; BF to supply.** Rarely used, so it does not block the build. | Tariff |

---

## 11. Scale

The book is **over 100,000 accounts** with around **50 people working it concurrently**.

Postgres is untroubled by that. A hundred thousand rows is a small table, and fifty concurrent
users is a light load. The database is not the constraint.

**The constraint is how this application currently loads data.** `AppStore.fetchTable` issues
`select('*')` against every table on startup and filters in memory. That is the right shape for
the CRM — a few hundred leads and deals — and the wrong shape for collections by three orders
of magnitude. At roughly eleven actions per account the sample implies **over a million action
rows today**, before fifty clerks add to it daily.

It would also break before it got slow: PostgREST caps rows per request (Supabase's default is
1,000), so a naive `select('*')` against the account table silently returns the first thousand
and the rest simply aren't there. **Verify that cap on the project before the import.**

So the collections module is built to a different pattern from the CRM, and the CRM is left
alone:

- **Nothing loads the book into memory.** A clerk works a queue: the server returns a page.
  Search, filter and sort happen in the database, against indexes on the columns people actually
  use — assigned clerk, bucket, diary date, prescription date, client, debtor reference.
- **Interest is not computed in the browser.** Daily accrual across 100,000 accounts is a
  server-side job that writes each day's position, so a list is a read rather than a hundred
  thousand calculations. Only the account actually open computes live, to the minute.
- **The financial engine runs server-side.** It is the authority on what an account owes; a
  client that can calculate its own balances is a client that can disagree with the ledger.
- **Concurrency is real at fifty users.** Two clerks can open the same account, and a payment
  can land while one of them is working it. The optimistic-write pattern used in the CRM is
  fine for a record you own; an account being worked needs freshness, and a payment allocation
  needs to be the database's decision rather than the browser's.

Sized this way, 100,000 accounts and 10,000,000 perform the same: the page size governs, not
the table.
