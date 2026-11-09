# Raptor · finance test book — what every figure should be

Every number here was read out of the engine on staging on **9 November 2026** (the staging clock's date) by
running the real steps — import, place, approve, reject, reverse — inside a transaction that was then rolled back,
and each split was re-worked by hand against the rule below. **All of them agreed to the cent.**

If the screen shows something else, that is a finding: write down the case number, what you expected, and what
you saw.

> **Leave the staging clock on 9 Nov 2026 until you get to the payover runs.** Two accounts carry interest
> (TFA0003, TFA0005), and interest runs to the day the payment is approved. If the clock moves, those two
> rows move a few cents. Nothing else changes.

---

## The book

Two clients, both with a signed mandate and a flat commission. Handed over on **1 Sep 2026**. No debtor has a
phone number or an email address, so nothing on this book can send anything to anyone.

| Client | Code | Commission | Pays out to |
|---|---|---:|---|
| Test Finance Alpha (Pty) Ltd | TFA | 10% | FNB 62000000001 (made up) |
| Test Finance Bravo CC | TFB | 20% | Capitec 1000000002 (made up) |

| Account | Debtor | Capital | Interest | Fees on it (incl. VAT) | What it is for |
|---|---|---:|---:|---|---|
| TFA0001 | Thabo Testman | 1 000.00 | none | 57.50 — 2 emails | **The roll to capital**: fees are less than half the payment |
| TFA0002 | Lindiwe Testsample | 2 000.00 | none | 253.00 — 4 emails, 2 consultations | **50/50 in full**: fees take the whole half |
| TFA0003 | Pieter Proefpersoon | 300.00 | 21% | 304.75 — 4 consultations, 1 email | **In duplum**: interest + fees may not pass the R300 capital |
| TFA0004 | Sipho Oorbetaal | 400.00 | none | 28.75 — 1 email | **Overpayment**: pays R1 000 on R428.75 |
| TFA0005 | Anna Rentevoet | 5 000.00 | 10.5% | 86.25 — 2 emails, 1 call | **Interest first** |
| TFB0001 | Johan Toetsmaker | 3 000.00 | none | 28.75 | **A different commission rate** (20%) |
| TFB0002 | Mpho Kliëntbetaal | 1 200.00 | none | 57.50 | **PTC**: paid the client directly |
| TFB0003 | Karen Terugdraai | 800.00 | none | 28.75 | **Reversal** |
| TFB0004 | Bongani Plekmaker | 1 500.00 | none | 28.75 | **An unmatched receipt**, placed by hand |
| TFB0005 | Elsa Afwys | 1 300.00 | none | 28.75 | **Reject** |

An email or call is R25.00 + R3.75 VAT = **R28.75**; a consultation is R60.00 + R9.00 VAT = **R69.00**
(Annexure B 2026, items 1(a), 2 and 7).

---

## The rule, so you can check a row by hand

1. **Receipt fee first** (Annexure B item 9): 10% of the money the account actually takes, + 15% VAT. It joins
   the fees.
2. **Cut the payment in half.**
3. **Half A pays interest, then fees — oldest fee first.** The receipt fee is the newest fee, so on a small
   payment the older fees can use up half A before the receipt fee gets anything. Whatever half A cannot spend
   **rolls to capital**.
4. **Half B, plus the roll, pays capital.** Anything left after capital is a **credit** (an overpayment).
5. **Commission** = rate × capital paid. **VAT on commission** = 15% of that.
   **To client** = capital − commission − VAT on commission.

Worked example, **TFA0001, R200.00**: receipt fee R20.00 + R3.00 = R23.00, so the fees are R57.50 + R23.00 = R80.50.
Half A is R100.00, which pays the R80.50 and rolls R19.50. Capital = R100.00 + R19.50 = **R119.50**.
Commission 10% = R11.95, VAT R1.79, to client R119.50 − R11.95 − R1.79 = **R105.76**.

---

## Every payment, as the approval queue should show it

| Account | Payment | Receipt fee | → interest | → fees | → capital | Credit | Commission | VAT | **To client** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| TFA0001 | 200.00 | 23.00 | — | 80.50 | 119.50 | — | 11.95 | 1.79 | **105.76** |
| TFA0002 | 100.00 | 11.50 ¹ | — | 50.00 | 50.00 | — | 5.00 | 0.75 | **44.25** |
| TFA0003 | 150.00 | 17.25 ¹ | 20.86 | 54.14 | 75.00 | — | 7.50 | 1.13 | **66.37** |
| TFA0004 | 1 000.00 | 49.31 ² | — | 78.06 | 400.00 | **521.94** | 40.00 | 6.00 | **354.00** |
| TFA0005 | 1 500.00 | 172.50 | 102.37 | 258.75 | 1 138.88 | — | 113.89 | 17.08 | **1 007.91** |
| TFB0001 | 2 000.00 | 230.00 | — | 258.75 | 1 741.25 | — | 348.25 | 52.24 | **1 340.76** |
| TFB0002 (PTC) | 600.00 | 69.00 | — | 126.50 | 473.50 | — | 94.70 | 14.21 | **0.00** — the client has it ³ |
| TFB0003 | 400.00 | 46.00 | — | 74.75 | 325.25 | — | 65.05 | 9.76 | **250.44** |
| TFB0004 | 250.00 | 28.75 | — | 57.50 | 192.50 | — | 38.50 | 5.78 | **148.22** |
| TFB0005 | 300.00 | 34.50 | — | 63.25 | 236.75 | — | 47.35 | 7.10 | **182.30** (if it were approved — it is rejected) |

¹ **TFA0002 and TFA0003 pay nothing towards their own receipt fee.** The older fees take all of half A first.
That is correct, and the queue shows it as a dash in the receipt-fee column. The fee is still owed afterwards.

**TFA0003 is at its in duplum ceiling.** Interest R20.86 + fees R304.75 would pass the R300.00 capital, so only
**R279.14** of the fees can ever be recovered. The queue shows the other **R25.61** in the "fees ceiling refuses"
column.

² **On an overpayment the receipt fee is 10% of what the account needed, not of the whole payment.** TFA0004 owed
R428.75, so the fee is R42.88 + R6.43 = R49.31 — not R100 + R15 on the R1 000. The R521.94 left over is a credit
for you to decide on Exceptions.

³ **Look closely at TFB0002's "Due to BF".** The money is right: the trust ledger shows Test Finance Bravo
**owing R235.41** (fees R126.50 + commission R94.70 + VAT R14.21). But the allocation stores its "due to BF"
figure as **R221.20**, which leaves the VAT out. If the queue shows R221.20, note it. `docs/FINANCE-TESTING.md` B4
says Due to BF should *include* the VAT.

---

## The Trust overview after each step

Trust opening balance **R0.00 at 31 Oct 2026**, so the bank figure is the statement alone: R5 900.00 in, R1.00
bank charge out = **R5 899.00**.

| After… | In the trust account | Accounted for | Not accounted for, and why |
|---|---:|---:|---|
| **Importing the statement** | 5 899.00 | 0.00 | R5 650.00 **waiting for approval** (8 payments) + R250.00 **unallocated** (no reference) − R1.00 bank charge |
| **Placing the R250, recording the PTC, approving all but TFB0005** | 5 899.00 | **5 600.00** | **R299.00** = R300.00 waiting (TFB0005) − R1.00 bank charge |
| **Rejecting TFB0005** | 5 899.00 | 5 600.00 | R300.00 back to **unallocated** (Needs an account) − R1.00 bank charge |
| **Reversing TFB0003, back to the queue** | 5 899.00 | **5 200.00** | R400.00 waiting again + R300.00 unallocated − R1.00 |

The R1.00 bank charge is the trust's own cost. Nobody owns it, so it shows as a R1.00 bank / ledger difference
every time. That is expected.

### The trust ledger, by party

| Party | After approving | After reversing TFB0003 |
|---|---:|---:|
| Bredell Ferreira (fees, interest, commission, VAT) | 1 760.35 | 1 610.79 |
| Test Finance Alpha (Pty) Ltd | 1 578.29 | 1 578.29 |
| Test Finance Bravo CC | **1 504.01** = 1 739.42 owed − 235.41 PTC set-off | 1 253.57 |
| Sipho Oorbetaal (the overpayment) | 521.94 | 521.94 |
| **Total** | **5 364.59** + the PTC R235.41 = 5 600.00 | 4 964.59 + 235.41 = 5 200.00 |

The "owed to the firm" on the overview is the firm's line **plus** the PTC Bravo owes it: R1 760.35 + R235.41 =
**R1 995.76** after approving.

Reversing TFB0003 takes exactly that payment's shares back off: Bravo −R250.44, the firm −R149.56
(R74.75 fees + R65.05 commission + R9.76 VAT). Approve it again and both go back.

### Payover runs (cycle 11 Oct – 10 Nov, paid out 11 Dec)

Each client's run should equal that client's line on the trust ledger:
**Alpha R1 578.29.** **Bravo R1 504.01** with TFB0003 approved (R1 253.57 while it is reversed), with the PTC set
off inside it.
