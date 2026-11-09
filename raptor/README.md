# Raptor · finance & trust tests

A small, made-up book on **staging** for testing the money side by hand: two clients, ten debtors, one bank
statement. Each debtor is built to hit one rule — the 50/50 split, in duplum, an overpayment, interest, a PTC, a
reversal, a rejection, an unmatched receipt — and every figure it should produce is written down in advance.

| File | What it is |
|---|---|
| `finances/EXPECTED.md` | **Every figure the screens should show**, step by step. Keep it open beside the app. |
| `finances/seed-test-book.sql` | Loads the book onto an empty staging. Already loaded on 9 Nov 2026. |
| `trust/statement-2026-11-09.csv` | The FNB trust statement to import: 9 receipts, an interest-rate notice, a bank charge. |
| `trust/ptc-confirmation-TFB0002.pdf` | A made-up client confirmation to attach to the PTC in step 4. |

Everything here is invented. Staging only — **never production**. The wider test plan, with the tests this one
doesn't cover, is `docs/FINANCE-TESTING.md`.

---

## Before you start

- **Staging clock: 9 Nov 2026.** It is set. Leave it alone until step 9 (see `EXPECTED.md` for why).
- Sign in as yourself (an Administrator with the trust account).

## The steps

**1. Opening balance** (FINANCE-TESTING A1). Trust → Settings → Trust account opening balance → Capture:
**R0.00**, as at **31 Oct 2026**, reason *"Finance test book: the trust starts empty"*.
→ The overview band reads "Opening R 0.00 at 31 Oct 2026, plus statements since".

**2. Import the statement** (B1). Trust → Payments in → Import bank statement → `trust/statement-2026-11-09.csv`.
→ Preview first, nothing written. After import: **8** in the Approval queue, **1** under Needs an account
(R250.00 *CAPITEC B PLEKMAKER*), the bank charge on Exceptions, the interest notice ignored.
→ Trust overview: first row of the overview table in `EXPECTED.md`.

**3. Place the unmatched R250** (B7). Needs an account → put it on **TFB0004 Bongani Plekmaker**.
→ It joins the Approval queue.

**4. Record the PTC** (B4). Open **TFB0002 Mpho Kliëntbetaal** → Record payment → R600.00, 9 Nov 2026, **paid to
client**, attach `trust/ptc-confirmation-TFB0002.pdf`.
→ Without the attachment it is refused (that is correct).

**5. Check the queue** (B2). Open the breakdown on each row and compare it with the payments table in
`EXPECTED.md`. Look hardest at TFA0001 (the roll), TFA0002 (50/50), TFA0003 (in duplum), TFA0004 (overpayment) and
TFB0002's Due to BF (note ³).

**6. Approve everything except TFB0005.**
→ Overview: second row. Trust ledger: the "After approving" column. TFA0004's **R521.94** credit appears on
Exceptions (B5). Leave it there for now.

**7. Reject TFB0005** (B6), reason of your choice.
→ Its line goes back to Needs an account. Overview: third row. Try "Put it back" and reject it again if you like.

**8. Reverse TFB0003** (E) from Payment history → back to the approval queue.
→ Overview: fourth row. Ledger: "After reversing". Then **approve it again**: it should split exactly as before
(R250.44 to Bravo), and the ledger goes back to the "After approving" column.

**9. The overpayment** (B5). Exceptions → TFA0004's R521.94 → refund, park, or move. Each choice should take it
off Exceptions.

**10. Payover runs** (C, D). Trust → Payover runs → Running: one run per client for 11 Oct – 10 Nov, paid out
11 Dec. **Alpha R1 578.29, Bravo R1 504.01** (the PTC set off inside it). Then move the staging clock to
**11 Nov 2026** and they should move to *Closed · to pay*. Carry on with sections C, D and F of
`docs/FINANCE-TESTING.md`.

## Starting again

Settings → **Clear staging** (start date **9 Nov 2026**), then run `finances/seed-test-book.sql` in the Supabase SQL
editor (or ask Claude to). It refuses to run on a staging that isn't empty, or anywhere that isn't staging.
