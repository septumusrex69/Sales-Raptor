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

### Interest is worth more than fees

**Interest carries no VAT. Fees do.** Every rand of fee recovered has VAT inside it that must be
paid over; a rand of interest recovered is kept whole.

So where the in duplum cap limits what can be recovered, it is materially better for BF that
the recovered amount is made up of interest rather than fees. The allocation order in §7 already
clears interest before fees, which turns out to be both the agreed rule and the commercially
better one — worth stating explicitly so nobody "simplifies" that order later without realising
it costs money.

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

**Swordfish stays readable after cutover.** Statements covering periods it calculated will still
be needed, and the Council can ask.

**POPIA.** Importing the book moves a large volume of debtor personal information into a new
system, with the access control, retention and security obligations that follow. Worth settling
before the data lands rather than after.

---

## 10. Open items, collected

| # | Question | Blocks |
|---|---|---|
| 1 | The daily interest rate — 2% ÷ days in month, or 24% ÷ 365? | Interest |
| 2 | Item 1(b), registered letter under s57 — the Magistrates' Courts figure. **Awaiting; BF to supply.** Rarely used, so it does not block the build. | Tariff |
