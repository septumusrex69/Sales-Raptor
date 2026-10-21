# The acknowledgement of debt, in words

Everything the firm sends with an acknowledgement of debt, written out so it can be read, copied
and rewritten without opening the editor. **This file is a copy for editing. It is not what the
app sends** — the app sends what is in the library (`message_templates`), and the originals are
built by `scripts/letters/aod.mjs`. Mark this up, hand it back, and both are changed together.

`{{like_this}}` is a merge field: Raptor fills it in from the account when the document goes out.
Two of them are **optional** — `{{debtor_id_masked}}` and `{{debtor_reg_no}}` — and where the book
has no answer the whole line leaves with them, because 97% of the book has no identity number.

There are two of everything: one written for a **person** and one for a **company**. They are the
same words apart from four lines, listed at the foot.

---

## 1. The covering email

This is what the debtor reads in their inbox. The acknowledgement itself is attached as a PDF and
the button that opens it for signature is added underneath by Raptor.

```
Dear {{debtor_name}}

Further to our discussion, attached is an acknowledgement of debt for account {{account_number}}.

It records the amount owing as {{balance}} and the arrangement you have asked for: {{ptp_amount}} {{ptp_frequency}}, beginning on {{ptp_date}}.

What it does:
While the instalments are paid on time and in full, no further collection step is taken and no legal proceedings are instituted.
If an instalment is missed, the full balance falls due at once and the consent to judgment in Annexure A may be lodged.
It does not reduce the amount owing or stop interest running.

Please read all of it, including Part B and Annexure A, before you sign. You are entitled to obtain independent legal advice first.

Open it with the button below, read it and sign it there. If anything in it does not match what we discussed, tell us before you sign and we will correct it.

Kind regards
{{agent_name}}
{{firm_name}}
{{agent_phone}}
```

---

## 2. The acknowledgement of debt

The debtor reads this one on the signing page and signs at the two signature rules.

| DATE | {{today}} |
| --- | --- |
| OUR REFERENCE | {{case_number}} |
| ACCOUNT | {{account_number}} |
| DELIVERY | By email, with notification by SMS |

### ACKNOWLEDGEMENT OF DEBT

Repayment agreement with consent to judgment

between {{client_name}}, the creditor identified in item 1 of Part A (the “Creditor”), represented by {{firm_name}}, its duly authorised agent, and the debtor identified in item 3 of Part A (the “Debtor”).

| STEP 1 | STEP 2 | STEP 3 | STEP 4 |
| --- | --- | --- | --- |
| The debtor acknowledges the debt and waives all defences | The debtor pays the agreed instalments | On default the full balance becomes due at once | The creditor may lodge the signed consent to judgment |

How this agreement works. It consists of Part A (particulars), Part B (terms and conditions) and Annexure A (consent to judgment). Every field in Part A must be completed before signature.

#### WHY YOU ARE BEING ASKED TO SIGN THIS

This agreement records what is owed and how it will be paid, and it holds legal action for as long as the instalments are met.

| If you sign, and pay | No further collection step is taken and no legal proceedings are instituted while the instalments are paid on time and in full. |
| --- | --- |
| If you sign, and miss a payment | The full balance falls due at once, the default is reported to the credit bureaus, and the creditor may lodge the signed consent to judgment in Annexure A. |
| If you do not sign | Nothing is held. The account continues on its normal course: the notices already sent stand, the default is reported to the credit bureaus, and the file goes to our attorneys. |
| What signing does not do | It does not reduce the amount owing, stop interest running, or stop the fees and expenses prescribed in Annexure B to the Debt Collectors Act from being charged. |

---

#### PART A — AGREEMENT PARTICULARS

| ITEM | DESCRIPTION | PARTICULARS |
| --- | --- | --- |
| 1 | Creditor | {{client_name}}, represented by {{firm_name}} ({{firm_council_number}}) as its duly authorised agent for the collection of this debt. |
| 2 | Creditor domicilium and notices | Care of {{firm_name}}, {{firm_address}}. Email: {{firm_email}} |
| 3 | Debtor | {{debtor_name}}. Identity number: {{debtor_id_masked}}. Domicilium: {{debtor_address}} |
| 4 | Sureties | Not applicable unless named here. The Debtor is liable for the Debt. |
| 5 | Cause of the debt | Moneys lent and advanced, or goods or services supplied, under the agreement between the Creditor and the Debtor, as reflected on the Creditor’s statement of account. |
| 6 | Calculation of the capital amount | Balance handed over on {{handover_date}}: {{balance_handover}}. Plus interest to {{today}}: {{interest_accrued}}. Plus fees and expenses, including VAT of {{fees_vat}}: {{fees_total}}. Less payments received: {{paid_to_date}}. Capital amount: {{balance}} |
| 7 | Amounts excluded | Fees and expenses prescribed in Annexure B to the Debt Collectors Act 114 of 1998, and VAT on them, incurred after the signature date. These are charged on the account as they arise. |
| 8 | Repayment | {{ptp_amount}} {{ptp_frequency}}, beginning on {{ptp_date}}, until the capital amount, interest and costs have been paid in full. |
| 9 | Interest | {{interest_rate}} on the outstanding balance from {{interest_from}}, calculated daily and compounded monthly, subject to the in duplum rule. |
| 10 | Default period | 7 (seven) days from the due date of any instalment. |
| 11 | Payment | Into the trust account of {{firm_name}}: {{firm_bank}}. Account name: {{firm_bank_holder}}. Account number: {{firm_bank_account}}. Reference: {{case_number}} |

#### HOW WE WILL REACH YOU

These are the details we will use. Correct any that are wrong before you sign, and leave blank anything you do not have.

Cellphone number: {{debtor_mobile}}

Work number: {{debtor_work_phone}}

Home number: {{debtor_home_phone}}

Email address: {{debtor_email}}

Employer: {{debtor_employer}}

---

#### PART B — TERMS AND CONDITIONS

Background. The Creditor supplied the goods, services or credit described in item 5 of Part A to the Debtor, and the Debtor has not paid for all of it. The account has been handed to the Creditor’s agent for collection. The Debtor has asked for time to pay, and the Creditor is prepared to accept payment in instalments on these terms and against the security recorded here.

#### INTERPRETATION

In this agreement, Business Day means any day other than a Saturday, Sunday or official public holiday in the Republic of South Africa; Capital Amount means the amount in item 6 of Part A; Debt means the Capital Amount together with all interest, fees, costs and other amounts payable under this agreement; Instalment means a payment set out in item 8 of Part A; and Signature Date means the date on which the party signing last signs.

Clause headings are for convenience only. The singular includes the plural, and “including” is not a word of limitation. If Part A and Part B conflict, Part A prevails.

The rule that a contract is interpreted against the party who drafted it does not apply.

Where the National Credit Act 34 of 2005 applies to the underlying agreement, nothing in this agreement waives, limits or substitutes any right the Debtor has under that Act, and this agreement is read subject to it.

#### ACKNOWLEDGEMENT OF DEBT

The Debtor acknowledges that it is truly and lawfully indebted to the Creditor in the Capital Amount, made up as set out in item 6 of Part A, arising from the cause described in item 5 of Part A.

The Debtor confirms that it has received what the Debt relates to; that it has checked the statement of account and agrees the Capital Amount is correct; that the Debt is due, owing and payable and is not subject to any dispute, query, counterclaim or set-off; and that it has no defence of whatever nature to a claim for the Debt.

The Debtor waives any defence based on non causa debiti, errore calculi, revision of accounts, non numeratae pecuniae and no value received, and confirms that it understands the meaning and effect of that waiver.

The amounts described in item 7 of Part A are not included in the Capital Amount, and this agreement does not affect the Creditor’s right to recover them.

#### REPAYMENT AND INTEREST

The Debtor undertakes to pay the Debt in the Instalments set out in item 8 of Part A, into the account in item 11 of Part A, quoting the reference given there.

Interest runs on the outstanding balance at the rate and from the date in item 9 of Part A. Nothing in this agreement permits interest, fees and costs together to exceed the capital outstanding at the time of default, as required by section 103(5) of the National Credit Act.

Payment is made free of deduction or set-off. A payment is only made when it reflects in the account in item 11 of Part A.

#### DEFAULT

The Debtor is in default if an Instalment is not paid in full within the default period in item 10 of Part A, or if the Debtor breaches any other term of this agreement.

On default, the full outstanding balance of the Debt becomes due and payable immediately, without further notice, and the Creditor may lodge the consent to judgment in Annexure A.

The Creditor’s failure to enforce any right under this agreement, or any indulgence given, is not a waiver of that right and does not prevent the Creditor enforcing it later.

#### CREDIT BUREAUS

The Debtor acknowledges that the default has been or may be reported to the registered credit bureaus, and that signing this agreement does not by itself remove that report. Where the Debt is paid in full the Creditor will report that fact to the bureaus it reported the default to.

#### DOMICILIUM AND NOTICES

The parties choose the addresses in items 2 and 3 of Part A as their domicilium citandi et executandi for all notices and legal process under this agreement. A notice sent by email is deemed received on the Business Day it is sent, unless the sender receives a delivery failure.

A party may change its domicilium by written notice to the other, taking effect ten Business Days after the notice is received.

#### COSTS

The Debtor is liable for the fees and expenses prescribed in Annexure B to the Debt Collectors Act 114 of 1998 and VAT on them, and, where legal proceedings are instituted, for legal costs on the attorney and own client scale, including collection commission and tracing costs.

#### WHOLE AGREEMENT

This agreement is the whole agreement between the parties on what it deals with. No variation, cancellation or waiver has any effect unless it is in writing and signed by both parties. No representation not recorded here has been relied on.

____________________________
The Debtor — {{debtor_name}}

---

#### ANNEXURE A — CONSENT TO JUDGMENT

In the Magistrate’s Court for the district in which the Debtor resides, carries on business or is employed.

| Plaintiff | {{client_name}} |
| --- | --- |
| Defendant | {{debtor_name}}, identity number: {{debtor_id_masked}} |
| Reference | {{case_number}} |

The Defendant, having acknowledged the debt described in Part A of the agreement to which this annexure is attached, hereby consents in terms of section 58 of the Magistrates’ Courts Act 32 of 1944 to judgment being entered against the Defendant for:

1. payment of the Capital Amount recorded in item 6 of Part A, less any payments made after the Signature Date;
2. interest on that amount at the rate recorded in item 9 of Part A;
3. costs of suit on the attorney and own client scale; and
4. collection commission and the fees and expenses prescribed in Annexure B to the Debt Collectors Act 114 of 1998.

The Defendant confirms that this consent is given freely, that the Defendant has read and understood it, and that the Defendant has been advised of the right to obtain independent legal advice before signing.

____________________________
The Defendant — {{debtor_name}}
---

## Where the company version differs

Four lines, and nothing else:

| | Person | Company |
|---|---|---|
| Part A, item 3 | `Identity number: {{debtor_id_masked}}` | `Registration number: {{debtor_reg_no}}` |
| Part B signature | `The Debtor — {{debtor_name}}` | `for the Debtor — {{debtor_name}} ({{debtor_reg_no}}), duly authorised` |
| Annexure A, Defendant | `{{debtor_name}}, identity number: {{debtor_id_masked}}` | `{{debtor_name}}, registration number: {{debtor_reg_no}}` |
| Annexure A signature | `The Defendant — {{debtor_name}}` | `for the Defendant — {{debtor_name}}, duly authorised` |

The covering email differs in one sentence: the company version adds *"for signature by a duly
authorised representative of {{debtor_name}}"*.

---

## What changed since you last read this

- **"Signed at \_\_\_\_ on \_\_\_\_" is gone**, on your instruction. It was a wet-signature line
  with two blanks a pen fills in; nobody asks an online signer what town they are in, so it printed
  empty above a signature with the date already written under it by the system's own stamp.
- **The creditor's signature rule is gone** too: "I don't think we have to sign that." The
  agreement is the debtor's admission, and an unsigned rule on every copy read as half-finished.
- **"How we will reach you" is new** — cellphone, work, home, email and employer, prefilled with
  whatever the book holds so the debtor is *confirming* rather than remembering. Every one of those
  lines leaves the page entirely when there is nothing to put on it.
- **"Return the signed document to {{agent_email}}" is gone** from the covering email. It told the
  debtor to print, sign and post something they sign by pressing a button in the same message.
- **The email carries the address in its words**, not only as a button, so the copy filed against
  the account shows the link and a forward keeps it.
