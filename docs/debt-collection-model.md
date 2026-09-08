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

## 2a. The settlement receipt fee (Swordfish: FCC)

Resolved. Swordfish calls it **Final Collection Commission**; it is the **item 9 receipt fee**
applied to a hypothetical final instalment — what the debtor would pay to settle the whole
remaining balance in one payment. It appears on every statement so the settlement figure is one
honest number instead of something the debtor has to work out.

**On the name.** Three words are in circulation for one fee: Annexure B names it nothing,
Swordfish says "collection commission", the export column says "FCC". We say **receipt fee**,
because *commission* is the percentage charged to the **client** and using one word for both makes
every conversation about money ambiguous. The receipt fee comes off the debtor's payment;
commission comes off what is remitted to the client. Different payer, different base, different
rate. In code it is `settlementReceiptFee()`, one line on top of `receiptFee()`.

```
settlement receipt fee = min( 10% x balance-before-fee , R610 ) x 1.15
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

## 2b. The fee ceiling — items 1 to 7

**Correcting myself.** I wrote that a ceiling existed but that "the rule is not derivable from
the exports". It is not derivable from the exports, but it did not need to be: it is printed at
the top of Annexure B itself, and I had not read the gazette.

> **Note:** The total amount to be recovered from the debtor in respect of **items 1 to 7** of
> the Annexure shall not exceed **the capital amount of the debt or R1023,00, whichever is the
> lesser.**
>
> — GN R.580, GG 43343, 22 May 2020. The 2026 substitution raises the figure to **R1225,00**.

That is the whole rule. It is a ceiling on the *total recovered*, not on any one fee — so the fee
that would cross the line is trimmed to land exactly on it, and every action after that is free.
It excludes VAT, and it excludes items 8 (attending taxation) and 9 (the receipt fee).

### It is enforced to the cent, and the data proves it twice over

| Total fees on an account | Accounts |
|---|---|
| exactly R1,023.00 | **161** |
| exactly R1,225.00 | **52** |

Those two figures are the 2020 and 2026 ceilings, and the accounts date themselves by which one
they stopped at: the last charge on an R1,023 account falls no later than **27 January 2026**, and
the first on an R1,225 account no earlier than **16 April 2026**. The trimming is visible in the
unit prices too — a phone call appears charged at R2.50 or R6.00, which looks like corrupt data
until you see it is the last few rand of headroom before the cap.

This is what the 18,187 charge-free billable actions are. Not lost revenue: the cap, operating.

### The half that is not being enforced

"or the capital amount of the debt, **whichever is the lesser**". Swordfish applies the flat
figure and ignores the capital test, so small debts are over-recovered:

| | Accounts | Over the ceiling |
|---|---|---|
| Capital was the binding limit | 8 | **R1,647.01** |
| A few rand over the flat ceiling (keying) | 31 | R598.50 |
| | **39 of 735** | **R2,245.51 excl VAT** |

APM20096 was charged R1,023.00 in fees on a debt of R580.00. ACF10046: R444.00 of fees on R230.00
of capital. These are not rounding — the fees are nearly twice the debt, and the Act caps them at
the debt.

This is over-recovery from **debtors**, which is a different and more serious category than the
Growthpoint commission drift (3a): that was billing a client the wrong agreed rate, this is
exceeding a statutory limit. The amounts are small and the fix is forward-looking, but the two
should not be discussed as if they were the same kind of error.

`recoverableFee()` in `annexureB.ts` implements both halves, against the schedule in force on the
action's own date. `reconcile.mjs` checks every account on every run.

### What else the gazette settled

- **Item 9 has three names and they are all one thing.** Annexure B does not name it; Swordfish
  calls it "collection commission"; the export column calls the settlement quotation of it "FCC".
  We call it the **receipt fee** — because "commission" is the percentage charged to the *client*,
  and one word for both makes every conversation about money ambiguous. Different payer, different
  base, different rate. FCC is now literally `receiptFee(balance)` with VAT (2a).
- **The receipt-fee maximum is per instalment, not in aggregate.** Confirmed by the business. The
  wording carries both readings — "on receipt of an instalment (one or more) in redemption of the
  debt" — and this was the last number in the money model resting on inference. Settled.
- **Every amount excludes VAT.** Also confirmed by the business. The gazettes do not say.
- **The receipt fee applies to PTC.** "inclusive of instalments made directly to the client" — a
  payment the client banks itself attracts the fee exactly like one reaching our trust account.
  Gazetted, not a house reading (7a).
- **No double-charging on a receipt.** "No additional fee shall be charged for any attendance in
  connection with the receipt or payment of any instalment." A call chasing the instalment that
  arrives is covered by the receipt fee.
- **Per-month sub-limits**, which the engine must enforce and nothing currently checks: item 1(c)
  electronic communications, maximum **ten per month**; item 4(c) credit bureau searches, maximum
  **four per month**.
- **Both quarantined fee names are released.** "Necessary Costs" — eight charges of exactly R21 on
  2024-05-07 — is item 3, "other necessary expenses not specifically provided for", priced at
  exactly R21 in the schedule then in force. "Team Leader Assistance" — one R25 charge commented
  "WhatsApp Call - No Contact" — is item 2 at the 2026 rate; the name describes who helped, the
  comment and the price describe what was done. R193 released.

### All four schedules

Every gazette we hold, oldest to newest. All amounts **exclude VAT** — the gazette does not say so
itself, so this was an inference until the business confirmed it directly.

| Item | | 2015 | 2017 | 2020 | 2026 |
|---|---|---|---|---|---|
| 1(a) | Letter, fax or e-mail | R18 | R20 | R21 | R25 |
| 1(c) | Other electronic communication (max 10/month) | R2.50 | R2.80 | R3 | R3.50 |
| 2 | Phone call, not a consultation | R18 | R20 | R21 | R25 |
| 3 | Other necessary expenses (a total) | R18 | R20 | R21 | R25 |
| 4(b) | Documents signed at the debtor's residence | R178 | R198 | R210 | R250 |
| 4(c) | Credit bureau search (max 4/month) | R12 | R13 | R14 | R16 |
| 5 | Settlement account at the debtor's request | R35 | R39 | R41 | R50 |
| 6 | Correspondence received and attended to | R9 | R10 | R11 | R13 |
| 7 | Consultation with debtor | R44 | R49 | R52 | R60 |
| 8 | Attending taxation *(outside the cap)* | R70 | R78 | R82 | R98 |
| 9 | Receipt fee, 10% of the instalment *(outside the cap)* | max R435 | max R480 | max R509 | max R610 |
| | **Items 1–7 ceiling** | **R870** | **R965** | **R1,023** | **R1,225** |

- GN R.1272, GG 39552, 23 December 2015
- GN R.1141, GG 41205, 27 October 2017
- GN R.580, GG 43343, 22 May 2020
- GN R.7207, GG 54273, 6 March 2026

The ceiling is always **min(capital, that figure)**. Items 1(b) and 4(a) point at the Magistrates'
Courts Rules rather than naming an amount, and move independently of these schedules.

Note item 6 is **inbound** correspondence. The legacy name "Correspondence" in the export is *not*
item 6 — all 25 charged instances are commented "Emailed debtor" and priced at R21, the outbound
1(a) rate. The price is what distinguishes them.

### The three-and-a-half-week gap, and why dating the tariff from behaviour hid it

The action rates in `actionTariff.ts` were originally built from the export: each figure was the
median charge actually raised, and the schedules were dated from where those medians changed. That
gave **1 April 2026**. The gazette took effect on **6 March 2026**. Swordfish was simply not
reconfigured for three and a half weeks.

Dating the table from behaviour made that gap impossible to see — the tariff would always agree
with itself by construction. Dated from the gazettes, 156 charged actions between 6 and 31 March
2026 are visibly at the superseded rate:

| | Actions | Under-charged |
|---|---|---|
| Phone Call | 71 | R284.00 |
| Email (Outgoing) | 16 | R64.00 |
| Letter | 12 | R48.00 |
| SMS | 44 | R40.00 |
| Consultation, Promise to Pay, Perusal, Trace | 8 | R39.00 |
| | **153** | **R475.00 excl VAT** |

Nothing needs fixing. **Under-charging is lawful; over-charging is not**, and that asymmetry is
why this is a note rather than an incident. What it earns is the principle: the tariff table is
transcribed from gazettes, and any disagreement with what was charged is a finding.

### Acknowledgement of debt: two items, and the business changed which one it charges

The one line still evidenced rather than transcribed, because Annexure B has two items an AoD can
fall under and the export does not say which occurred:

- **4(a)** the acknowledgement itself, including the necessary consultation — banded by debt size,
  prescribed by the Magistrates' Courts Rules rather than by this Annexure. R161 under R50,000,
  R209 above.
- **4(b)** the original documents signed at the debtor's residence or place of work — a flat
  gazetted figure, R250 in 2026.

The business charged **R210 (4(b)) before 2026 and R161 (4(a)) after**. Both are lawful; the line
goes *down* because the item changed, not the rate.

`actionTariff.ts` records the charge as actually raised, because that is what a reissued statement
must reproduce. Writing the gazetted 4(b) figure into the 2026 row instead — which I tried — makes
every real acknowledgement look R89 under-charged and invents **R12,000 of shortfall that does not
exist**. A tariff check that measures against the wrong item is worse than no check.

Note item 6 is **inbound** correspondence at R11. The legacy name "Correspondence" in the export
is *not* item 6 — all 25 charged instances are commented "Emailed debtor" and priced at R21, the
outbound rate. The price is what distinguishes them.

---

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

## 3a. Sliding-scale commission — how Swordfish fakes it

Resolved by the January 2026 client list, which carries a `PERCENTAGE` per client and a `Prefix`
that joins exactly to the account data.

**The rate falls as the account gets bigger, and Swordfish implements the scale by splitting one
client into several client records — one per tier.** The "-1", "-2" suffixes are not only
handover batches; they are commission bands.

| Client | Swordfish record | Accounts | Mean capital | Rate |
|---|---|---|---|---|
| ABSTO | AIS | 18 | R29,824 | 21% |
| ABSTO | AIS2 | 1 | R370,232 | **15%** |
| Agri Saad | AID1 | 1 | R19,422 | 25% |
| Agri Saad | AID2 | 3 | R234,181 | **20%** |
| Growthpoint | GPS3/1 | 108 | R15,120 | 25% |
| Growthpoint | GPS3/2 | 71 | R21,515 | **22.5%** |
| Growthpoint | GPS4/1 | 81 | R13,393 | 25% |
| Growthpoint | GPS4/2 | 25 | R33,473 | **22.5%** |
| Adowa Ellis Park | APM | 194 | R28,236 | 30% |
| Adowa Frederick St | APM2 | 103 | R19,906 | 30% |
| Accelerate Fitness | ACF1 | 130 | R1,899 | 30% |

Across the whole book the rates are: 30% (1,088 clients), 25% (859), 20% (180), 15% (141),
27.5% (111), 10% (80), 22.5% (25), and a long tail. Most clients are flat — one record, one
rate. The tiered ones are the exception.

### The bands are in the mandate

**Correcting an earlier conclusion of mine.** I said the boundaries could not be derived and had
been assigned by a person at handover, because the capital ranges overlapped. The signed
Growthpoint mandate of 30 April 2024 says otherwise:

| No | Capital Handover Amount | Commission |
|---|---|---|
| 1 | R0 < R25,000 | 25% |
| 2 | R25,001 + | 22.5% |

A clean threshold on the individual account's capital at handover. The overlap I found was not
evidence of judgement — it was evidence of the rule not being applied.

**So a rate is computed, not chosen.** Where a client's mandate defines bands, the band decides
the rate and the system should say so when someone sets a different one.

### What that turned up

Against their own mandate, **60 of 285 Growthpoint accounts (21%) are on the wrong rate.**

| | Accounts | Capital |
|---|---|---|
| Under-charged (22.5% applied, mandate says 25%) | 50 | R864,420 |
| Over-charged (25% applied, mandate says 22.5%) | 10 | R279,086 |

On payments actually received so far that is R4,698.72 of commission foregone against R75
over-charged. Small today because most of the under-charged accounts have collected little yet;
it grows with every rand they pay.

It is not uniform incompetence — it is inconsistency. The 2025/10/08 handover of 98 accounts is
**perfect**, split exactly at R25,000. The batches either side are 37%, 50% and in two cases 100%
wrong. Somebody knows the rule; it is being applied by hand and by memory.

That is the argument for computing it: the mandate's bands belong on the client record, the rate
follows from the account's capital, and a handover that departs from it has to be deliberate and
visible rather than an accident nobody notices for two years.

### The other two mandates are clean

Two more signed mandates, checked the same way against the same account data:

**ABSTO Industrial Supplies** — signed 12 September 2025.

| No | Capital Handover Amount | Commission |
|---|---|---|
| 1 | R0 < R250,000 | 21% |
| 2 | R250,001 < R500,000 | 15% |
| 3 | R500,001 < R1,000,000 | 12% |
| 4 | R1,000,000 + | 10% |

19 accounts, **0 on the wrong rate.** AIS20001 at R370,232 is correctly in the 15% band; every
other account is under R250,000 and correctly on 21%.

**Agri Saad** — signed 2 September 2024, client Etienne Olivier.

| No | Capital Handover Amount | Commission |
|---|---|---|
| 1 | R0 < R100,000 | 25% |
| 2 | R100,001 < R500,000 | 20% |
| 3 | R500,001 + | 15% |

4 accounts, **0 on the wrong rate.** AID20001 (R423,823), AID20003 (R140,835) and AID20002
(R137,884) are all correctly on 20%; AID10001 (R19,422) correctly on 25%.

**0 of 23 wrong here against 60 of 285 at Growthpoint.** That is a scale effect, not a different
standard: the same manual process holds up over twenty accounts and drifts over two hundred and
eighty-five. It is the strongest argument yet for computing the rate — the failure appears
exactly where a person cannot check every line, which is also exactly where the money is.

Note the shape all three share: bands are **half-open on the capital handed over**, the first
band starts at R0, and the boundary rand (R25,000 / R250,000 / R100,000) belongs to the *lower*
band — "R0 < R25,000" then "R25,001 +". An account at exactly R25,000 is 25%, not 22.5%. The
importer implements that literally rather than rounding to the nearest band.

### Two other things the mandate confirms

**The 50/50 split.** Clause 3: payments received are allocated equally to "(a) capital handed
over" and "(b) legal expenses and interest". Exactly as described, now evidenced.

**The sales month.** Clause 4: money is transferred for debts "collected for the previous month,
up until the 10th of every month ... on the 15th of the next month". The 11th-to-10th period is
contractual, not a house convention — and remittance is due on the 15th, which is a date the
system should be driving rather than a diary entry.

### Why this has to be modelled properly

Swordfish's workaround is why the client list shows Growthpoint four times and why a
parent-level view of the relationship does not exist there. In Raptor the client is one record
and the rate lives on the account, so the sliding scale stops being a filing convention and
starts being a rule the system can apply and audit.

## 3b. Historical billing errors — what to do about them

Two distinct errors are now on the record, and they are not the same kind of thing.

| | Who was wrong-charged | Amount | Nature |
|---|---|---|---|
| Commission drift (3a) | **Clients** — Growthpoint | R4,698.72 foregone, R75 over-charged | A contract term applied inconsistently by hand |
| Fee ceiling (2b) | **Debtors** — 39 accounts | R2,245.51 excl VAT over the ceiling | A statutory limit half-implemented |

**The decision taken: do not restate history.** Take the position as it stands, and be correct
from here. That is the right call and it is worth writing down why, because "we knew and did
nothing" is a bad sentence to have to say later without a reason attached.

The case for it:

- The amounts are small against the cost of reopening. R4,698.72 of commission over two years on a
  285-account book; R2,245.51 of fees across 735 accounts.
- Payover reports have already been run and money has already moved on these figures. Restating
  means reissuing statements, re-cutting remittances, and explaining to clients why a number they
  reconciled two years ago has changed.
- Many of the affected accounts are settled. Reopening a paid-up account to recover R70 is worse
  for the relationship than the R70 is worth.
- Both errors are already stopped by construction, not by discipline: bands are computed from the
  mandate, and the ceiling is enforced as fees accrue.

Where that reasoning does **not** hold, and where something should still be done:

1. **The four over-charged Growthpoint accounts that have never paid.** All from the 2026/06/26
   handover, zero payments received. Nothing has been invoiced or remitted, so correcting the rate
   costs nothing and avoids over-charging a client going forward. Fix these.
2. **Live accounts still accruing on a wrong rate.** 13 accounts, R286,876 outstanding, roughly
   R7,172 of commission at stake on money not yet collected. Correct the rate forward — this is
   not restating history, it is stopping the error continuing.
3. **Any debtor still being charged past the ceiling.** Over-recovery from a debtor is a statutory
   breach rather than a commercial one; the account should stop charging immediately even if
   nothing is refunded.

So: no restatement, no refunds, no reissued statements — but the rate and the ceiling are
corrected on every account still running, and the four unbilled ones are simply fixed. The
distinction that matters is between *money already settled* and *money still to be charged*.

**What the system must do so this cannot recur.** Both errors survived for two years because
nothing looked. `debtor_accounts.commission_rate_expected` sits beside `commission_rate` and
disagreeing is visible; `recoverableFee()` applies the ceiling as fees accrue rather than
discovering it at settlement; and `reconcile.mjs` reports both on every run. A number that
disagrees with the contract or the Act should be a thing somebody sees that week, not something a
migration turns up two years later.

---

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

### The importer

`scripts/swordfish/import.mjs`. Reads the four exports and produces the collections book:
clients, handover batches, debtor accounts, payments, fees, interest accruals.

```
node --experimental-strip-types scripts/swordfish/import.mjs \
  --summary <accounts.csv> --payments <payments.csv> \
  --actions <actions.csv> --interest <interest.csv> \
  --owner <profile uuid> --out ./out
```

It is a dry run unless given `--apply`, and deletes nothing without `--wipe`. `--only <client>`
runs a real slice of real data, small enough to check by eye and to undo — and refuses to
combine with `--wipe`, which would clear the whole book to insert a fragment of it.

Three rules it exists to enforce:

1. **It will not run if `reconcile.mjs` fails.** A migration our own model disagrees with is
   not a migration; it is six weeks of wrong statements nobody has noticed yet.
2. **It never invents money.** Where Swordfish's figure and ours differ, Swordfish's is written
   and the difference is reported — above all for commission, where 60 Growthpoint accounts
   arrived on a rate their signed mandate does not allow. Correcting those silently would
   rewrite what a client has already been invoiced.
3. **`--owner` has no default.** Every client lands on somebody's desk, and a wrong default is
   invisible: the import succeeds and 735 accounts quietly belong to the wrong person.

**The opening position is the handover, not today.** The exports carry complete history from the
day each account arrived, so the ledgers replay it and today's balance is derived rather than
asserted. Opening at today's figures would be the one number nothing could ever check — and it
would double-count: an account paid in full would open owing its whole capital again. Swordfish's
closing balance is kept in `swordfish_balance_at_import` purely so the replay can be checked
against it.

### What the run produces

| | |
|---|---|
| clients | 7 (2 as children of Adowa) |
| handover batches | 34 |
| debtor accounts | 735 — R14,486,249.16 capital |
| payments | 1,070 — R1,826,939.00, of which 25 paid to client |
| fees | 59,158 — R693,093.86 incl VAT |
| interest accruals | 12,078 — R5,850,284.39 |

Reconciles: the actions export sums to R602,695 excl VAT against the summary's `Fees & Expenses`
of R605,011 — a 0.38% gap. The larger gap to `All Fees (inc VAT + FCC)` of R1,232,240 is FCC,
which is a settlement quotation and not a fee (2a).

### What building it found

Four defects, each caught before a row was written, and each of a kind that only shows up when
real data meets a real schema:

- **`account_interest_accruals` could not hold the data.** Its key was `unique (account_id,
  accrued_on)` — one accrual stream per account per day. 804 accounts have two periods starting
  on the same date. No two periods are identical, so the key is now the period.
- **`capital_outstanding` is `not null`**, and the importer was writing null into it. Caught by
  a live trial of one account, not by checking column names — which is why there is now a
  not-null guard that runs in the dry run.
- **`commission_rate` was `not null default 0`**, making "no rate resolved" and "we charge
  nothing" the same value. Now nullable.
- **571 accounts carry a Sub-status of the literal string `"N/A"`.** Text columns need the same
  no-value vocabulary the numeric ones already had.

### Client data quality, as found

- 89 of 735 ID numbers are not 13-digit SA IDs — phone numbers, company registrations, and in
  one case a client prefix. Imported as found; it is Swordfish's data, not a mapping fault.
- `Capital Portion`, `Interest Portion`, `Legal Fee Portion`, `Date Opened`, `Current Legal
  Stage` and `Old Client Reference` are empty for every account. The handover split has to come
  from the mandate's 50/50 rule, not from these columns.
- `Capital Paid` is present on all 1,070 payments and zero on all of them, so Swordfish's own
  allocation cannot be imported. The allocation engine has to derive it.

## 10. Open items, collected

- **How the R610 FCC ceiling behaves on an in duplum account.** The 21 accounts that do not
  fit the confirmed formula are almost all in duplum, so the two ceilings appear to interact.
- ~~**What the sliding-scale commission bands are measured against**~~ — resolved (3a): capital
  at handover, per account, on bands the signed mandate sets out.
- ~~**Whether the electronic-communication cap is per account or per debtor**~~ — resolved (2b):
  item 1(c) is capped at ten electronic communications per month, item 4(c) at four credit bureau
  searches per month, and separately items 1–7 in total may not exceed min(capital, R1,225).
  All per account.
- **Item 1(b)**, the registered-letter fee, still to be confirmed.

| # | Question | Blocks |
|---|---|---|
| 1 | The daily interest rate — 2% ÷ days in month, or 24% ÷ 365? | Interest |
| 2 | Item 1(b), registered letter under s57 — the Magistrates' Courts figure. **Awaiting; BF to supply.** Rarely used, so it does not block the build. | Tariff |
| 3 | ~~The fee ceiling rule~~ — **resolved** (2b). It is the Note at the head of Annexure B: items 1–7 may not exceed min(capital, R1,225), R1,023 before March 2026. Implemented in `recoverableFee()`. | — |
| 4 | ~~Whether the item 9 receipt-fee maximum is per instalment or in aggregate~~ — **resolved**: per instalment, confirmed by the business. So is the VAT-exclusive basis of every gazetted amount. | — |

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
