# Bonnitta payment file — what it should do

`bonnitta-payments-2026-11-10.csv` is an FNB trust statement for the **Bonnitta Pharmacy** test book
(BNP0001–BNP0016). Import it from Trust → Payments in → Import bank statement.

**First:** Clear staging also cleared the trust opening balance. Capture **R0.00 as at 31 Oct 2026** in Trust settings
first, or the overview band stays amber.

**After import:** 8 in the Approval queue, 2 under Needs an account, the bank charge on Exceptions, the interest
notice ignored. Trust account R2 498.50.

- **CAPITEC N SITHOLE, R150** has no reference. Place it on **BNP0012** (Nomsa Sithole).
- **BNP0099, R200** matches no account. Reject it, or place it wherever you like.
- **BNP0013, R1 000** pays the account off and leaves **R65.44** credit on Exceptions.

## The split the engine gives, if approved on 10 Nov 2026

Read out of the engine on staging with the import run and rolled back. Interest runs daily at 24%, so approve on
**10 Nov** (the staging clock's date) for these exact figures. Commission is 25%.

| Account | Status | Payment | → interest | Receipt fee | → fees | → capital | Credit | Commission | VAT | **To client** |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BNP0001 | Broken arrangement | 100.00 | 50.00 | 11.50 ¹ | — | 50.00 | — | 12.50 | 1.88 | **35.62** |
| BNP0002 | Promise To Pay | 190.00 | 73.83 | 21.85 ¹ | 21.17 | 95.00 | — | 23.75 | 3.56 | **67.69** |
| BNP0006 | Promise To Pay | 190.00 | 73.31 | 21.85 ¹ | 21.69 | 95.00 | — | 23.75 | 3.56 | **67.69** |
| BNP0009 | Negotiating | 250.00 | 73.82 | 28.75 ¹ | 51.18 | 125.00 | — | 31.25 | 4.69 | **89.06** |
| BNP0010 | Promise To Pay | 100.00 | 50.00 | 11.50 ¹ | — | 50.00 | — | 12.50 | 1.88 | **35.62** |
| BNP0013 | Broken arrangement | 1 000.00 | 108.86 | 96.39 | 288.45 ² | 537.25 | **65.44** | 134.31 | 20.15 | **382.79** |
| BNP0014 | Promise To Pay | 270.00 | 97.31 | 31.05 ¹ | 37.69 | 135.00 | — | 33.75 | 5.06 | **96.19** |
| BNP0016 | Cannot pay | 50.00 | 25.00 | 5.75 ¹ | — | 25.00 | — | 6.25 | 0.94 | **17.81** |

¹ Raised on the account but not paid by this payment: interest and older fees take all of the fee half first.
² Includes this payment's own R96.39 receipt fee. BNP0013 clears everything (capital, interest and fees).

On BNP0001, BNP0010 and BNP0016 **interest takes the whole fee half**. Seven months at 24% has run to more than half
these small payments.
