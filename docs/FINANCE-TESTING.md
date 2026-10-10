# Raptor finance: how it works, and what to test

A brief for a session that is testing the money side of Raptor. Read it top to bottom once. Part 1
is how the money moves, Part 2 is the screens, Part 3 is the tests with what each should show, and
Part 4 is how to report.

Written 10 October 2026, against branch `claude/new-session-ecohkn` (last commit `09da362`).

---

## 0. Ground rules

- **Staging only.** Supabase project `kvkajxpremantdkhmjvb`. The data there is disposable and the
  firm has said so. **Never write to production** (`qcvesjzoiznrvunjrqpv`).
- **Use the preview of this branch.** It is almost certainly
  `https://sales-raptor-git-claude-new-session-ecohkn-team-raptor.vercel.app`. The older address
  ending `…review-p1pzx2…` is a previous branch and **does not have** the October 10 work. If a
  screen does not match this document, check which address you are on first.
- **The repo is public.** No real client data, exports or screenshots of the book go into a commit.
- **A test finds things; it does not fix money.** If a figure is wrong, write down the case
  (account, payment, amounts, what you expected, what you saw) and report it. Do not "correct"
  balances or ledger rows by hand. The ledgers are append-only on purpose.
- **Read `CLAUDE.md` and `HANDOFF.md`** in the repo root for the rules and the current state. This
  file is the finance-only summary.

---

## Part 1. How the money moves

### 1.1 Two books, never mixed

| | Trust account | Business account |
|---|---|---|
| Whose money | Other people's: clients and debtors, plus what the firm has earned but not yet drawn | Bredell Ferreira's own |
| Where in Raptor | **Trust** in the sidebar (`/trust/*`) | **Business** in the sidebar (`/business/*`) |
| Who sees it | The trust tick (`finance.view`) | The business tick (`business.view`), Administrator only |

The firm may only take out of the trust what it has **earned**. A charge a client owes the firm can
be set off against **that client's own** trust money, never anybody else's.

### 1.2 A payment's life

1. **Money arrives.** Two ways:
   - A **bank statement is imported** (Trust → Payments in → Import bank statement). Each credit
     line is matched to a debtor where the reference allows. One that cannot be matched waits under
     **Needs an account**, to be placed by hand.
   - A payment is **recorded by hand** (Record payment). A debtor who paid the **client directly**
     is recorded this way as a **PTC** ("paid to client").
2. **It waits in the Approval queue.** Nothing has moved yet. The queue shows what the payment
   *would* do. The **check happens here**: a row that breaks one of the allocation formulas is
   held out of *Approve all* and *Approve selected*. It can only be approved on its own, after
   ticking "I have checked these figures".
3. **Approval splits it.** The allocation engine splits the payment in the database:
   - **Fees side, at most half the payment, in this order:** interest, then the receipt fee
     (Annexure B item 9: 10% + VAT), then other Annexure B fees (items 1–7, capped at R1 225 or the
     capital, whichever is lower).
   - **Capital side:** the other half, plus whatever the fees side could not use.
   - **Commission** is the client's rate × the capital paid. **VAT** of 15% is charged on the
     commission.
   - **To the client** = capital − commission − VAT on commission.
   - **In duplum:** interest + fees + costs may never exceed the capital outstanding. A payment that
     would go over it shows "can't recover".
   - **Overpayment:** money beyond what the debtor owes is a credit. It can be refunded, moved to
     another of the debtor's accounts, released to the client, or parked. On a PTC the client
     already holds it, so it is the client's to sort out (`with_client`).
4. **The trust ledger records who now owns it.** The client's share, the firm's share (fees,
   interest, commission and VAT) and any debtor credit are each written as an entry. This ledger
   is append-only: a correction is always a new opposite entry.
5. **The payment lands in its client's payover run** for its **cycle**. See 1.3.
6. **It is paid over** on the payover day. The run goes needs review → ready → approved → (advice
   sent) → paid. The bank statement then confirms the payment out.

A PTC never enters the trust. The client already has the money, so the client **owes the firm**
its fees on it. That is set off against the client's next payover.

### 1.3 Cycles: when money is paid out

- A **cycle** runs from the **11th to the 10th**. The **approval date** decides the cycle, not the
  date the debtor paid.
- A cycle **closes at midnight on the 10th**. It is paid out on the **11th a month later**. The lag
  is a Trust setting, one month by default. Example: 11 Sep – 10 Oct closes on 10 Oct and is paid
  on 11 Nov.
- **Payover runs build themselves.** Opening the queue brings every run up to date. There is no
  "Build a run" button, except "Build for another cycle", which only exists on staging.
- **Three tabs:** **Running** (still collecting), **Closed · to pay** (closed and waiting for its
  day; an overdue one sits on top in red), **Paid**.
- **Approving before the cut-off** is "Approve early…" and needs a reason. Money approved after an
  early approval goes on the next cycle's run.

### 1.4 Corrections

- **Reject** (in the Approval queue, before approval): the receipt is not processed. A statement
  line goes back to Needs an account.
- **Reverse** (after approval, from Trust → **Payment history**, by opening the payment). The box
  asks **where the money goes**:
  - **Back to the approval queue.** Use this when the figures were wrong, or the payment belongs on
    another of the debtor's files. A copy waits on Payments in, and the Trust overview shows it as
    **Waiting for approval**.
  - **Back to Needs an account.** Use this for the wrong reference, when the money is somebody
    else's. The statement line goes back to be placed on the right debtor. This only works for
    statement receipts.
  - **If it was already paid over,** the client owes back what it was paid from that receipt. The
    trust ledger shows the client in debit, the firm's fees on it are taken back, and the client's
    **next** run carries a negative "reversed after the last run" line.
- **Client charges** (withdrawal fees, listing fees, other) are raised against a client. Each is
  either set off against their next payover or invoiced.

### 1.5 The Trust overview: does it balance?

- **In the trust account** = the trust account's opening balance (Trust settings) plus every trust
  statement line dated **after** that balance's day. With no opening balance captured, it is the
  imported lines alone, and the band says so in amber.
- **Accounted for** = money with an owner: due to clients, due to Bredell Ferreira, due to debtors
  (overpayments and refunds), less what clients owe back.
- **Not accounted for** = In the trust account − Accounted for. It is broken down as:
  - **Unallocated receipts:** on the statement, but nobody has placed them.
  - **Waiting for approval:** placed on a debtor, but not yet approved.
  - **Bank / ledger difference:** anything else. This is usually a missing opening balance or a
    statement not yet imported; if the bank holds less than the books owe, it is a real shortfall.
  - **Unexplained:** shown only if the parts disagree with each other. It should never appear.
- **Collections by period:** the same money read by cycle.
- **Trust ledger** (the rail): every party's balance. Click the chevron to see its entries.
- **Exceptions:** every statement line not yet explained (payovers, refunds, bank charges,
  transfers to the business, interest), with suggestions a person confirms.

### 1.6 The business side

- **Business overview:**
  - **Earned, still in trust:** the firm's balance on the trust ledger, which is the most it may
    draw.
  - **This month:** earned, invoiced, spent, the trust account's bank charges, and **Made**, which
    is earned + invoiced − spent − bank charges.
  - **Trust account: interest and charges.** Interest on the trust is the firm's income. Bank
    charges are the firm's cost. If the firm's share in trust goes below nothing, the card says the
    firm **owes the trust** and must repay it from the business account.
- **Drawings:** moving earned money from trust to the business. It needs both ticks and is refused
  above what the firm has earned.
- **Income:** client by client. It sits behind a tick **no role has**, not even the Administrator,
  and must be granted to a person.
- **Back office:** what is still left to take from debtors (interest, costs, receipt fees,
  potential commission). There is no client-by-client table any more; pick one client at the top.

---

## Part 2. Where everything is

| Screen | Address | What it is for |
|---|---|---|
| Trust → Overview | `/trust` | The balance and who owns it |
| Trust → Payments in | `/trust/payments` | Record or import; the Approval queue; Needs an account |
| Trust → Payment history | `/trust/check` | Every processed payment; open one to see its split or **Reverse** it |
| Trust → Payover runs | `/trust/payover` | Running / Closed · to pay / Paid; open a run for its lines and advice |
| Trust → Payments to make | `/trust/payments-out` | What must go out, with references; Mark paid; the Paid list |
| Trust → Trust ledger | `/trust/ledger` | Balances by party, with their entries |
| Trust → Exceptions | `/trust/exceptions` | Unexplained statement lines and overpayments to decide |
| Trust → Trust settings | `/trust/settings` | VAT, payover lag, opening balance, statement-only switch, commission per client |
| Client record → Payovers tab | `/companies/:id` | Every run for that client, with each advice sent (PDF and schedule) |
| Business → Overview / Expenses / Drawings / Back office | `/business/*` | The firm's own money |

If an address does not match, use the sidebar: Trust and Business each have their own menu.

---

## Part 3. What to test

Each test lists the steps and **what you should see**. Record pass or fail and the figures. Where
it says "check in the database", the snippets in Part 5 show how.

### A. Setting up

**A1. Opening balance.** In Trust settings → Trust account opening balance → Capture, enter an
amount, a past date and a reason of at least 10 characters.
- Expect: the card shows the amount. The Trust overview band reads "Opening R x at <date>, plus
  statements since". Statement lines dated on or before that day are **not** added again.
- Also try: a future date (refused), a reason under 10 characters (refused), and a user who is not
  an Administrator (refused).
- Then save the Firm details screen, which writes the whole settings row back. The opening balance
  must **not** change.

**A2. Statement-only switch.** Trust settings → "How a payment out is settled". With it on,
**Mark paid** disappears from the run page and from Payments to make. It stays **off** on staging;
turn it back off when done.

### B. Payments in and approval

**B1. Import a statement.** Use `docs/test-data/payments-2026-10-05.csv`, or build a small CSV in
the importer's format. A preview appears before anything is written. Then:
- Credits matched to a debtor land in the Approval queue.
- Unmatched credits land in **Needs an account**.
- Debits and bank charges land on **Exceptions**.

**B2. The split.** For three or four payments, open the breakdown drawer in the queue and check by
hand:
- the fees side is at most half the payment, in the order interest → receipt fee → Annexure B fees;
- the receipt fee is 10% + 15% VAT;
- commission = rate × capital paid; VAT on commission = 15% of it;
- to client = capital − commission − VAT;
- the three reconciliation ticks above the queue are green.

**B3. Check before approval.** Find or make a row that breaks a formula. It must be held out of
Approve all, with the button counts saying so. It can only be approved on its own after ticking "I
have checked these figures".

**B4. PTC.** Record a payment as paid to the client. Expect:
- "Due to BF" includes commission + VAT on it + interest + costs;
- on approval the client shows as **owing** the firm (Trust ledger, "Less: owed back by clients");
- the client's next run shows the set-off.

**B5. Overpayment.** Pay more than the balance.
- It appears on Exceptions to decide: refund, move to another of the debtor's accounts, release to
  the client, or park.
- Each choice removes it from Exceptions.
- **Move** does not charge a second receipt fee.
- On a PTC overpayment it is the client's to sort out and does **not** appear on Exceptions.

**B6. Reject.** Reject a queued statement receipt.
- Its line goes back to **Needs an account**.
- "Put it back" undoes it.

**B7. Place an unmatched receipt.** From Needs an account, put it on a debtor. It then appears in
the Approval queue.

### C. Cycles and payover runs

**C1. Tabs.**
- **Running** holds the open cycle, with its band reading "Still collecting · closes at midnight on
  the 10th · paid out 11 <next month>".
- **Closed · to pay** holds closed cycles, overdue ones on top in red.
- Totals per band equal the sum of their rows.

**C2. Approve.**
- A run in the open cycle offers no Approve; it says "Open until <date>".
- "Approve early…" asks for a reason, and the reason shows on the run.
- Bulk Approve only counts runs whose cycle has closed.

**C3. The run page.**
- The lines (thin rows) add up: capital collected − commission − VAT − PTC set-offs − charges =
  Amount to pay.
- Open a line to see its detail.
- **Preview statement** shows the advice.
- Sending the advice keeps a copy. Sending again keeps both copies.

**C4. Next cycle.** Approve a payment after a run was approved early. It must land on the
**next** cycle's run, not the approved one.

**C5. Client record → Payovers tab.**
- Every run for the client is listed, one line each.
- It shows where each run is, the reference it was paid with, and each advice sent with its PDF and
  schedule.
- Paid out and still to pay add up.

### D. Paying out

**D1. Payments to make.**
- Approved runs and due refunds are listed, each with its reference (`BF PO-XXX-yymm`, or
  `BF RAP-xxxxxx` for a refund) and the client's bank details on one line.
- The copy button copies the reference.
- The firm's own card offers "Record a transfer".

**D2. Mark paid.**
- The run moves to Paid as "Waiting for the statement".
- After a statement with the matching debit is imported and allocated on Exceptions, it reads "On
  the statement <date>".

**D3. Drawings.**
- A drawing up to "Earned, still in trust" works.
- Above it is refused, both on screen and in the database.

### E. Corrections (the newest, test hardest)

**E1. Reverse to the queue.** Approve a payment, then in Payment history open it → Reverse →
"Back to the approval queue", giving a reason.
- The receipt fee is cancelled.
- The capital goes back on the account.
- A copy waits in the Approval queue.
- **Trust overview: "Waiting for approval" shows the amount**, and the bank / ledger difference
  does not grow.
- Approve the copy: everything returns to as it was.

**E2. Reverse to Needs an account** (statement receipts only). As E1, but choose "Back to Needs an
account".
- The line is back in Needs an account and **can be placed on a different debtor**.
- The Trust overview shows it under Unallocated receipts.
- A payment recorded by hand cannot take this route; the option is greyed and the database refuses
  it.

**E3. Reverse a payment that was already paid over.** Approve a run (early, with a reason), Mark
paid, then reverse one of its payments to the queue. Expect:
- Trust ledger: the client in **debit** by exactly what it was paid from that receipt; the firm's
  balance down by its fees on it.
- Approve the copy again: both come back.
- The client's **next** run nets the negative "reversed after the last run" line against the new
  split, so the client is paid **once**.

**E4. A receipt Swordfish already paid over** (imported history) **cannot** be reversed. It says so.

### F. Trust overview and ledger

**F1. It adds up.**
- In the trust account = Total accounted for + Total not accounted for.
- The Bredell Ferreira line equals the "Bredell Ferreira funds held" card total.
- The client column in Collections by period equals the Clients line.

**F2. Every balance opens.** On Trust ledger, the chevron on each party shows entries whose running
balance ends at the row's balance.

**F3. Exceptions.**
- A bank charge debit is offered "Book as a bank charge".
- A payout debit with the exact amount and reference is offered its run.
- Once allocated, the line leaves Exceptions.

### G. Business side

**G1. This month.**
- Made = Earned + Invoiced − Spent − Trust account bank charges.
- Bank charges show both as their own line and on the "Trust account: interest and charges" card.

**G2. The firm owes the trust.** Draw everything the firm has earned, then book a bank charge on
Exceptions. Expect:
- the card turns red: "Bredell Ferreira owes the trust R x … pay it back from the business account";
- allocating a statement credit as "from the business account" clears it.

**G3. Income is hidden.** An Administrator without the `business.income` grant does not see Income
and is sent back from its address.

### I. Withdrawing an account (the client takes it back)

**I1.** Open the account. On the account's status card, under **Ending**, press **Close it** and choose
**Withdrawn**. Pick why (they made an arrangement with the debtor = fees, interest and commission;
it should never have been handed over = fees only; charge them nothing), or tick what to charge,
or type an agreed amount. Give a reason.
- Expect: the account moves to the **Closed** book. The charge goes to the **client**, never
  onto the debtor's account, with VAT on fees and commission (not on interest). It shows on
  Business overview -> Clients who owe the firm, and comes off the client's next payover run as a
  withdrawal fee line.
- Only somebody with the trust tick can withdraw; anyone else does not get the option.

### H. Who may do what

- Someone without the trust tick (for example a Liaison) is turned away from every `/trust` page
  and every `/business` page.
- A non-Administrator cannot reverse, capture the opening balance or draw.

---

## Part 4. How to report

For each failure, write one block:

```
TEST: E3
WHERE: Trust -> Payment history -> RAP-124126 (R5 550.00, 18 Sep)
DID: approved PO-KFH-2610 early, marked paid, reversed the R5 550 to the queue
EXPECTED: client KFH -2 416.29 on Trust ledger
SAW: client KFH R0.00
SCREENSHOT: (if any; no real client data)
```

Also note anything that **reads** wrong, even when the figure is right: a word the firm would not
use, a total that does not say what it adds up, or a warning that fires when nothing is wrong. The
firm cares about those.

---

## Part 5. For a session that can query the database

Run read-only queries against staging. To call a guarded function as an Administrator, set the
claims first, inside one statement:

```sql
do $p$
declare out jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', (select id from profiles where role = 'Administrator' limit 1),
    'role', 'authenticated')::text, true);
  select to_jsonb(t) into out from public.trust_position() t;
  raise exception 'R %', out;   -- prints the result AND rolls everything back
end $p$;
```

**Anything that writes must be inside such a block, ending in `raise exception`, so it rolls back.**
That is how every change on this branch was proved.

Useful functions:

| Function | What it tells you |
|---|---|
| `trust_position()` | Bank, ledger, difference and the owners |
| `trust_awaiting_approval()` | Money in the bank waiting for approval |
| `trust_balances()` / `trust_entries(party, who)` | The ledger by party, and its entries |
| `firm_held_parts()` | The firm's share by commission, fees and VAT |
| `business_month(from, to)` / `trust_bank_costs(from, to)` | The business month; the trust's interest and charges |
| `payover_work_queue(null)` / `payover_run_payments(run)` | The runs, and one run's lines |
| `payments_to_make()` / `payments_out_paid()` | Payments out |

To make a statement line inside a probe:

```sql
perform import_bank_lines(
  (select trust_account_number from firm_settings), 'Probe',
  jsonb_build_array(jsonb_build_object(
    'key', 'probe-1', 'date', '2026-10-09', 'amount', 1000,
    'direction', 'credit', 'description', 'PROBE', 'reference', 'PROBE1')));
-- then: place_bank_line(line_id, account_id); approve_payment(payment_id);
--       reverse_payment(payment_id, reason); reverse_payment_to_unplaced(payment_id, reason)
```

Traps:
- The Supabase SQL tool hangs on any query containing the words *delete*, *drop* or *truncate*.
- PostgREST silently returns at most 1 000 rows.
- `en-ZA` writes thousands with a non-breaking space.

---

## Part 6. Not built yet (do not report these as bugs)

- **The go-live pieces,** for a clean break on **10 December 2026**:
  - the import option "every receipt up to the cut-over is Swordfish's";
  - the "Held for Swordfish payovers" bucket and its "Swordfish payover" choice on Exceptions;
  - importing the client balances brought forward from Camille's Excel.
- **Parallel run.** The 11 Oct – 10 Nov cycle runs in Swordfish and on staging side by side, and
  Raptor's 11 Dec payover is compared client by client. It needs the Swordfish export, that
  cycle's trust statement and the Excel.
- **A statement for a non-trust account.** Its lines are not counted in the trust balance. Whether
  to refuse such a file outright is the firm's open question.
- **Kestrel's commission bands.** The rand boundaries are missing, so a new handover for Kestrel is
  refused. That is correct until the firm enters them.
- **The items 1–7 cap per payment.** It is not shown as a badge.
- **A reversed overpayment the firm had taken,** on a payment that is re-split, returns to the
  debtor. This is a known edge.
- **Bank charges.** The firm believes the bank recovers them from the business account. If so, they
  never reach the trust statement and the trust card shows none.
