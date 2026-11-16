# Test payment file 2 — what it should do

`test-payments-2-2026-11-10.csv` is the second FNB trust statement for the test phase. It carries on from the first
(opening R2 498.50, closing R13 998.52). All lines are dated **10 Nov 2026**, because the staging clock is on 10 Nov
and the importer refuses a statement with any line dated after "today".

Tried on staging with the import rolled back: **18 lines in, 13 matched, 3 under Needs an account, 2 debits**. None
of them clashes with the first file.

## The lines

| Line | Amount | What it tests |
|---|---:|---|
| RVC0001 | 620.25 | Half the account |
| RVC0002 ×2 | 200.00 + 200.00 | **The same payment twice** (a bank duplicate). Both import; the R200 reversal debit below is the bank taking one back. Approve one and reject the other. |
| RVC0003 Mokoena Farming | 2 500.00 | A business debtor, part payment |
| RVC0005 | 1 000.00 | Part payment |
| RVC0007 | 1 520.00 | Exactly the capital — fees and interest still take their half, so capital is NOT cleared |
| RVC0009 | 500.00 | **More than the account owes** → a credit on Exceptions |
| RVC0010 Greenacres Kennels | 1 575.00 | A business debtor, 50% |
| RVC0011 | 917.81 | **Exactly the open promise** (due 15 Nov) — should mark it kept |
| STEYN J RVC-10284 | 938.00 | **Quotes the client's reference, not ours** → Needs an account. Place it on **RVC0012** (Johan Steyn). |
| RVC0016 | 1 099.99 | Odd cents |
| MAGTAPE CREDIT P VAN WYK | 300.00 | **A name, no reference** → Needs an account. Place it on **RVC0001** (Pieter van Wyk). |
| BNP0010 | 70.00 | Finishes the R170 promise (R100 came in the first file) |
| BNP0003 | 200.00 | The debtor who "refused to pay" pays something |
| BNP0013 | 50.00 | **An account already paid off** → all of it a credit |
| CREDIT INTEREST | 12.37 | Bank interest on the trust account. The importer does **not** recognise it: it waits under Needs an account like an unidentified receipt. |
| FNB REVERSAL RVC0002 DUPLICATE | −200.00 | A debit → Exceptions |
| ##BANK CHARGE | −3.40 | A debit → Exceptions |

## The two PTCs (recorded by hand, not on the statement)

A PTC never enters the trust, so it is not a statement line. On the account: **Record payment → paid to client**,
dated 10 Nov 2026, and attach the confirmation.

| Account | Amount | Attach | Fees side | Capital | Commission | VAT | Client owes the firm |
|---|---:|---|---:|---:|---:|---:|---:|
| RVC0006 Ayesha Patel | 675.40 | `ptc-confirmation-RVC0006.pdf` | 78.12 | 597.28 | 149.32 | 22.40 | **249.84** |
| RVC0013 Grace Mahlangu | 300.00 | `ptc-confirmation-RVC0013.pdf` | 67.68 | 232.32 | 58.08 | 8.71 | **134.47** |

Fees side = interest + fees (including the receipt fee). Read from the engine on 10 Nov. As on the Bonnitta test, the
queue's own "Due to BF" figure leaves out the VAT on commission (R227.44 and R125.76), while the trust ledger charges
it. Watch which one the screen shows.
