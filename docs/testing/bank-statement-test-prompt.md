# Raptor · Handover 17 — testing payments from a bank statement

**For the people testing Raptor on staging.** Copy everything inside the box below into your own
Claude, then attach two files:

1. **The FNB statement** — the trust account's *Account Transaction History* exported from FNB
   as a CSV (the file that starts with `ACCOUNT TRANSACTION HISTORY`).
2. **The accounts to pay** — in Raptor (staging) go to **Accounts**, choose the client you are
   testing, press **Export**, and export the accounts *with* the money columns. This gives Claude
   real staging case numbers, account numbers and balances to pay against.

Claude gives you back a new statement file to upload in Raptor under **Trust → Payments in →
Import statement**, and a list saying what each line is testing and what should happen.

> Staging only. Never upload a generated statement to the live Raptor.

---

```text
You are helping me test the payment import of Raptor, a debt-collection system, on its STAGING
(test) site. I have attached:

  (A) A real FNB trust-account statement export (CSV, "ACCOUNT TRANSACTION HISTORY").
  (B) A CSV export of test accounts from Raptor, with columns including Case number,
      Account number, Client reference, Debtor, Client, Handed over, Capital handed over,
      Balance, To settle, Book and Status.

Your job: produce a NEW statement file, in exactly FNB's format, whose credit lines pay the test
accounts in (B) in the ways listed under SCENARIOS — plus a key that says what each line tests
and what Raptor should do with it.

FORMAT — copy file (A)'s layout exactly; Raptor's reader is strict:
  - Keep (A)'s header block VERBATIM: the "ACCOUNT TRANSACTION HISTORY" line, the blank line,
    and the "Name:", "Account:" and "Balance:" lines (the account number must stay the same, or
    Raptor will treat it as a different bank account). Then a blank line, then the column line
    exactly as (A) has it: Date, Amount, Balance, Description
  - One line per transaction: Date, Amount, Balance, Description
  - Date as YYYY/MM/DD. Use dates from the last 30 days up to TODAY — never in the future —
    unless a scenario says otherwise.
  - Amount with a dot and two decimals, no thousands separators, no "R": 1500.00 / -2300.00.
    Money in is positive, money out is negative.
  - Balance: any number with two decimals (0.00 is fine; Raptor does not rely on it).
  - No quotation marks anywhere. No commas inside a description.
  - Description styles FNB really uses (two spaces before the reference where shown):
      FNB APP PAYMENT FROM  <REF>
      CAPITEC  <REF>
      ABSA BANK  <REF>
      INT-BANKING PMT FRM <REF>
      ADT CASH DEPO JHB   <REF>
      <REF>                         (reference alone, no channel words)
      CAPITEC J SMITH               (a name, no reference)
  - <REF> is normally the debtor's ACCOUNT NUMBER from (B), unless the scenario says to use the
    case number, a wrong number, lower case, or nothing.
  - Do NOT copy any real debtor's name or reference from (A). Use only the test accounts in (B)
    and made-up names. Take only the layout from (A).

SCENARIOS — make at least one line for each (use different accounts where you can):
  1.  Clean match: reference = account number exactly, part payment (about 10–30% of Balance).
  2.  Case number as the reference (e.g. RAP-125318) instead of the account number.
  3.  Account number typed in lower case.
  4.  Same account number behind each channel style above (FNB APP, CAPITEC, ABSA, INT-BANKING,
      ADT CASH DEPO, reference alone).
  5.  No reference — a depositor name only (e.g. "CAPITEC T MOLEFE").
  6.  A reference that matches no account (e.g. "XYZ99999").
  7.  An account number that appears on TWO accounts in (B), if there is one (ambiguous).
  8.  Two IDENTICAL lines: same day, same amount, same description (a debtor paying twice).
  9.  Exactly the "To settle" amount for one account (settles it in full).
  10. A big overpayment: about 5–10 times what one account owes.
  11. A small overshoot: "To settle" plus R50.
  12. Three payments on ONE account in this statement, on different days, oldest the smallest,
      together more than it owes.
  13. A payment dated one or two days BEFORE that account's "Handed over" date.
  14. A payment on an account whose Book is Closed (if (B) has one).
  15. A payment dated about two months ago (older than the rest).
  16. A large payment over R6 100 on an account that owes much more (receipt fee cap).
  17. An odd-cents amount, e.g. 123.45 or 1001.01.
  18. Money OUT: two negative lines, e.g. "-12500.00, ..., PAYOVER ALIANNA PHARMACY" and a bank
      charge "-35.00, ..., #MONTHLY ACCOUNT FEE".
  19. A zero-amount interest notice exactly like FNB writes it, e.g.
      "2026/11/01, 0.00, 0.00, CR.INT.RATE   4,25000" (this one comma is FNB's own).

OUTPUT:
  1. The new statement as a downloadable CSV file named statement-test-<today>.csv.
  2. A key, as a table: line number, date, amount, description, scenario number, which account
     it is aimed at (case number + account number), and what Raptor SHOULD do (use the list
     below).
  3. A second, smaller file statement-test-<today>-overlap.csv: the last 5 lines of the first
     file plus 3 new credit lines dated today — for the re-upload test.

WHAT RAPTOR SHOULD DO (use these words in the key's "expected" column):
  1, 3, 4   Placed on the account automatically; waits in Trust → Payments in for approval.
  2         Raptor's notices tell debtors to pay with the CASE number. Record what happens:
            placed automatically, or left in "Needs an account"?
  5, 6      Not placed. Appears under Trust → To sort → "Needs an account" (suspense). Findable
            with the suspense search by amount or name.
  7         Not placed; flagged as matching more than one account.
  8         BOTH lines imported — two real payments, not a duplicate.
  9         Account clears to nil after approval; receipt fee = 10% (+VAT) of what was owed.
  10, 11    Receipt fee charged only on what the account owed, not on the whole payment; the rest
            becomes the debtor's credit and appears under Trust → To sort → Overpayments.
  12        In the approval queue each later payment is worked out AFTER the earlier ones: once the
            account is cleared the rest show as overpayment. The checks at the top of the queue
            stay green (totals add up). "Approve all" posts them oldest first.
  13        Badge "Before handover"; NOT included in "Approve all"; badge asks to check the
            handover date / handover amount / withdraw — never a refund.
  14        Badge "Account closed"; held whole as the debtor's credit, nothing paid to the client.
  15        Interest on the account is recalculated from that older date (balance lower than if
            it had been paid today).
  16        Receipt fee capped at R610 + VAT.
  17        Split adds back to the exact amount, to the cent.
  18        Not receipts. The payover line may match a payover run by its reference.
  19        Ignored as a note — not a payment.
  Overlap file: re-uploading the first file adds NOTHING; the overlap file adds only its 3 new
  lines.
```

---

## What to test in Raptor with the generated file

Upload the file in **Trust → Payments in → Import statement**, then work through the key. Things
worth trying that the file alone does not cover:

- **Suspense search** (Trust → To sort): find the scenario 5 and 6 lines by typing the amount
  (`1500`, `1 500,00`, `R1,500.00`), a name, or the reference; try the date boxes.
- **Place a suspense line by hand** on the right account, then approve it. Its commission should
  count in the pay period it was *allocated*, not the period the debtor paid.
- **Park a line into suspense with a note**, release it, and place it later.
- **Overpayments** (Trust → To sort → Overpayments): refund one, move one to another of the
  debtor's accounts, release one to the client. Then open each account's **statement**: a refund
  shows as "Refund to you — instructed" (or "Refund paid to you" once paid), a move as
  "Overpayment moved to RAP-…", a release as "Overpayment released to the client (PO-…)", and
  the balance comes back to nil instead of staying in credit.
- **Approval queue**: check the coloured checks at the top are green, open a row's breakdown, and
  compare it with the account page's own figures.
- **Accounts → Export**: export a client's book after approving and check the Paid, Balance and To
  settle columns match the account pages.

## When something is wrong

Use the **light bulb** in Raptor (Requests) and include:

- the scenario number and the line from the generated file;
- the account's **case number**;
- what you expected (from the key) and what Raptor did;
- a screenshot.

Never paste a real debtor's details from the live system into a request or into Claude.
