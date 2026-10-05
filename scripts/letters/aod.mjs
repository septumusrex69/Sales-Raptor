/**
 * THE TWO ACKNOWLEDGEMENTS OF DEBT, built from the firm's own PDFs.
 *
 * THE FIRM supplied BF-Acknowledgement-of-Debt-Individuals and -Companies and asked for them "as
 * an email template". They are not emails: each is a NINE-PAGE AGREEMENT, and the email is only
 * the covering note that attaches it. So each produces two rows -- a letter and its covering email
 * -- which is the same shape the section 129 already has.
 *
 * THE SPECIMENS ARE THE ARTWORK, NOT THE CONTENT, exactly as the README beside this file says of
 * the other eight: the firm's PDFs are typeset with one debtor's details in them ("Mr T Mokoena",
 * "GPS3/10103", "R 48 215,60"), so turning them into templates meant putting a merge field back
 * wherever a value had been typeset in.
 *
 * WHAT CHANGED FROM THE SPECIMENS, and both are decisions already made elsewhere in Raptor:
 *   - The specimen's "ANNEXURE B (consent to judgment)" is ANNEXURE A here. Annexure B means one
 *     thing in this firm -- the Debt Collectors Act tariff -- and the same document names it twice
 *     in item 7 and in Part B. Two Annexure Bs in one agreement is a drafting error waiting to be
 *     read out in court.
 *   - The capital calculation's lines come off the LEDGER through new merge fields rather than
 *     being typeset, because the clause above them has the debtor confirm they have CHECKED the
 *     figure -- and the account row's own columns disagree with the ledger on thousands of
 *     accounts.
 *
 * ONE DIFFERENCE RUNS THROUGH BOTH VERSIONS: a company has a registration number and signs through
 * somebody authorised; a person has an identity number and signs for themselves. Both identifiers
 * are OPTIONAL merge fields, so on the 97% of the book with no identity number the line leaves
 * rather than holding the document -- see MergeField.optional.
 *
 * Emits JSON in the letter format. Nothing here touches a database.
 */
const T = (text, bold) => (bold ? { text, bold } : { text })
const P = (text, extra = {}) => ({ kind: 'paragraph', spans: [T(text)], ...extra })
const H = (level, text, numbered) => ({ kind: 'heading', level, spans: [T(text)], ...(numbered ? { numbered: true } : {}) })
const row = (a, b) => [{ spans: [T(a, true)] }, { spans: [T(b)] }]
const item = (n, desc, particulars) => [
  { spans: [T(String(n))] }, { spans: [T(desc)] }, { spans: [T(particulars)] },
]
const DEFAULTS = {
  font: '"Charter", "Bitstream Charter", Georgia, serif',
  size: 10.5, colour: '#1f2937', lineHeight: 1.45,
}

export function aod(kind) {
  const isCo = kind === 'company'
  const idLine = isCo ? 'Registration number: {{debtor_reg_no}}' : 'Identity number: {{debtor_id_masked}}'

  return { defaults: DEFAULTS, blocks: [
    { kind: 'table', borders: 'none', widths: [28, 72], rows: [
      row('DATE', '{{today}}'), row('OUR REFERENCE', '{{case_number}}'),
      row('ACCOUNT', '{{account_number}}'), row('DELIVERY', 'By email, with notification by SMS'),
    ] },

    H(1, 'ACKNOWLEDGEMENT OF DEBT'),
    P('Repayment agreement with consent to judgment'),
    P(`between {{client_name}}, the creditor identified in item 1 of Part A (the “Creditor”), represented by {{firm_name}}, its duly authorised agent, and the debtor identified in item 3 of Part A (the “Debtor”).`),

    { kind: 'table', borders: 'all', headerRow: true, widths: [25, 25, 25, 25], keepTogether: true, rows: [
      [{ spans: [T('STEP 1', true)] }, { spans: [T('STEP 2', true)] }, { spans: [T('STEP 3', true)] }, { spans: [T('STEP 4', true)] }],
      [
        { spans: [T('The debtor acknowledges the debt and waives all defences')] },
        { spans: [T('The debtor pays the agreed instalments')] },
        { spans: [T('On default the full balance becomes due at once')] },
        { spans: [T('The creditor may lodge the signed consent to judgment')] },
      ],
    ] },
    P('How this agreement works. It consists of Part A (particulars), Part B (terms and conditions) and Annexure A (consent to judgment). Every field in Part A must be completed before signature.'),

    H(2, 'WHY YOU ARE BEING ASKED TO SIGN THIS'),
    P('This agreement records what is owed and how it will be paid, and it holds legal action for as long as the instalments are met.'),
    { kind: 'table', borders: 'rows', widths: [32, 68], keepTogether: true, rows: [
      row('If you sign, and pay', 'No further collection step is taken and no legal proceedings are instituted while the instalments are paid on time and in full.'),
      row('If you sign, and miss a payment', 'The full balance falls due at once, the default is reported to the credit bureaus, and the creditor may lodge the signed consent to judgment in Annexure A.'),
      row('If you do not sign', 'Nothing is held. The account continues on its normal course: the notices already sent stand, the default is reported to the credit bureaus, and the file goes to our attorneys.'),
      row('What signing does not do', 'It does not reduce the amount owing, stop interest running, or stop the fees and expenses prescribed in Annexure B to the Debt Collectors Act from being charged.'),
    ] },

    { kind: 'pagebreak' },
    H(2, 'PART A — AGREEMENT PARTICULARS'),
    { kind: 'table', borders: 'all', headerRow: true, widths: [6, 26, 68], rows: [
      [{ spans: [T('ITEM', true)] }, { spans: [T('DESCRIPTION', true)] }, { spans: [T('PARTICULARS', true)] }],
      item(1, 'Creditor', '{{client_name}}, represented by {{firm_name}} ({{firm_council_number}}) as its duly authorised agent for the collection of this debt.'),
      item(2, 'Creditor domicilium and notices', 'Care of {{firm_name}}, {{firm_address}}. Email: {{firm_email}}'),
      item(3, 'Debtor', `{{debtor_name}}. ${idLine}. Domicilium: {{debtor_address}}`),
      item(4, 'Sureties', 'Not applicable unless named here. The Debtor is liable for the Debt.'),
      item(5, 'Cause of the debt', 'Moneys lent and advanced, or goods or services supplied, under the agreement between the Creditor and the Debtor, as reflected on the Creditor’s statement of account.'),
      item(6, 'Calculation of the capital amount', 'Balance handed over on {{handover_date}}: {{balance_handover}}. Plus interest to {{today}}: {{interest_accrued}}. Plus fees and expenses, including VAT of {{fees_vat}}: {{fees_total}}. Less payments received: {{paid_to_date}}. Capital amount: {{balance}}'),
      item(7, 'Amounts excluded', 'Fees and expenses prescribed in Annexure B to the Debt Collectors Act 114 of 1998, and VAT on them, incurred after the signature date. These are charged on the account as they arise.'),
      item(8, 'Repayment', '{{ptp_amount}} {{ptp_frequency}}, beginning on {{ptp_date}}, until the capital amount, interest and costs have been paid in full.'),
      item(9, 'Interest', '{{interest_rate}} on the outstanding balance from {{interest_from}}, calculated daily and compounded monthly, subject to the in duplum rule.'),
      item(10, 'Default period', '7 (seven) days from the due date of any instalment.'),
      item(11, 'Payment', 'Into the trust account of {{firm_name}}: {{firm_bank}}. Account name: {{firm_bank_holder}}. Account number: {{firm_bank_account}}. Reference: {{case_number}}'),
    ] },

    /*
     * HOW TO REACH YOU, CONFIRMED BY THE PERSON SIGNING.
     *
     * THE FIRM: "when you fill it in, like address, maybe there should be like information like
     * your work number, home, your cell phone number, work number, and email address, just kind of
     * to confirm that stuff. Your employer... put it there as optional, that's fine."
     *
     * ONE PARAGRAPH PER LINE AND NOT A TABLE, which is the only shape that can lose a line
     * cleanly. Nobody has all five -- no landline, no job, no email address is the ordinary case
     * on this book -- and a table row with an empty cell stays on the page as an empty row with a
     * label beside it. A label paragraph whose field cannot be answered leaves whole; see
     * MergeField.optional and documentWithoutOptional.
     *
     * AND IT IS PART OF WHAT THEY SIGN, rather than a form beside it. These are the addresses the
     * firm will use -- item 3's domicilium is the one that carries legal process -- so they belong
     * inside the agreement where the signature covers them.
     */
    H(2, 'HOW WE WILL REACH YOU'),
    P('These are the details we will use. Correct any that are wrong before you sign, and leave blank anything you do not have.'),
    P('Cellphone number: {{debtor_mobile}}'),
    P('Work number: {{debtor_work_phone}}'),
    P('Home number: {{debtor_home_phone}}'),
    P('Email address: {{debtor_email}}'),
    ...(isCo ? [] : [P('Employer: {{debtor_employer}}')]),

    { kind: 'pagebreak' },
    H(2, 'PART B — TERMS AND CONDITIONS'),
    P('Background. The Creditor supplied the goods, services or credit described in item 5 of Part A to the Debtor, and the Debtor has not paid for all of it. The account has been handed to the Creditor’s agent for collection. The Debtor has asked for time to pay, and the Creditor is prepared to accept payment in instalments on these terms and against the security recorded here.'),

    H(2, 'INTERPRETATION', true),
    P('In this agreement, Business Day means any day other than a Saturday, Sunday or official public holiday in the Republic of South Africa; Capital Amount means the amount in item 6 of Part A; Debt means the Capital Amount together with all interest, fees, costs and other amounts payable under this agreement; Instalment means a payment set out in item 8 of Part A; and Signature Date means the date on which the party signing last signs.'),
    P('Clause headings are for convenience only. The singular includes the plural, and “including” is not a word of limitation. If Part A and Part B conflict, Part A prevails.'),
    P('The rule that a contract is interpreted against the party who drafted it does not apply.'),
    P('Where the National Credit Act 34 of 2005 applies to the underlying agreement, nothing in this agreement waives, limits or substitutes any right the Debtor has under that Act, and this agreement is read subject to it.'),

    H(2, 'ACKNOWLEDGEMENT OF DEBT', true),
    P('The Debtor acknowledges that it is truly and lawfully indebted to the Creditor in the Capital Amount, made up as set out in item 6 of Part A, arising from the cause described in item 5 of Part A.'),
    P('The Debtor confirms that it has received what the Debt relates to; that it has checked the statement of account and agrees the Capital Amount is correct; that the Debt is due, owing and payable and is not subject to any dispute, query, counterclaim or set-off; and that it has no defence of whatever nature to a claim for the Debt.'),
    P('The Debtor waives any defence based on non causa debiti, errore calculi, revision of accounts, non numeratae pecuniae and no value received, and confirms that it understands the meaning and effect of that waiver.'),
    P('The amounts described in item 7 of Part A are not included in the Capital Amount, and this agreement does not affect the Creditor’s right to recover them.'),

    H(2, 'REPAYMENT AND INTEREST', true),
    P('The Debtor undertakes to pay the Debt in the Instalments set out in item 8 of Part A, into the account in item 11 of Part A, quoting the reference given there.'),
    P('Interest runs on the outstanding balance at the rate and from the date in item 9 of Part A. Nothing in this agreement permits interest, fees and costs together to exceed the capital outstanding at the time of default, as required by section 103(5) of the National Credit Act.'),
    P('Payment is made free of deduction or set-off. A payment is only made when it reflects in the account in item 11 of Part A.'),

    H(2, 'DEFAULT', true),
    P('The Debtor is in default if an Instalment is not paid in full within the default period in item 10 of Part A, or if the Debtor breaches any other term of this agreement.'),
    P('On default, the full outstanding balance of the Debt becomes due and payable immediately, without further notice, and the Creditor may lodge the consent to judgment in Annexure A.'),
    P('The Creditor’s failure to enforce any right under this agreement, or any indulgence given, is not a waiver of that right and does not prevent the Creditor enforcing it later.'),

    H(2, 'CREDIT BUREAUS', true),
    P('The Debtor acknowledges that the default has been or may be reported to the registered credit bureaus, and that signing this agreement does not by itself remove that report. Where the Debt is paid in full the Creditor will report that fact to the bureaus it reported the default to.'),

    H(2, 'DOMICILIUM AND NOTICES', true),
    P('The parties choose the addresses in items 2 and 3 of Part A as their domicilium citandi et executandi for all notices and legal process under this agreement. A notice sent by email is deemed received on the Business Day it is sent, unless the sender receives a delivery failure.'),
    P('A party may change its domicilium by written notice to the other, taking effect ten Business Days after the notice is received.'),

    H(2, 'COSTS', true),
    P('The Debtor is liable for the fees and expenses prescribed in Annexure B to the Debt Collectors Act 114 of 1998 and VAT on them, and, where legal proceedings are instituted, for legal costs on the attorney and own client scale, including collection commission and tracing costs.'),

    H(2, 'WHOLE AGREEMENT', true),
    P('This agreement is the whole agreement between the parties on what it deals with. No variation, cancellation or waiver has any effect unless it is in writing and signed by both parties. No representation not recorded here has been relied on.'),

    { kind: 'spacer', mm: 6 },
    /*
     * ONE RULE, AND NO "SIGNED AT ____ ON ____" ABOVE IT.
     *
     * BOTH WENT AT THE FIRM'S INSTRUCTION, having read a signed copy. Of the line: "it still says
     * signed at, which is not fine." It is a wet-signature line -- two blanks somebody fills in
     * with a pen -- and nobody asks an online signer what town they are sitting in, so it printed
     * empty directly above a signature, with the date it was asking for already written underneath
     * by the stamp. One date said twice, once blank.
     *
     * And of the creditor's rule: "for the creditor, I don't think we have to sign that. I think
     * that's not really necessary." They are right about what the document is. An acknowledgement
     * of debt is the DEBTOR's admission; the firm's counter-signature adds nothing to it, and an
     * unsigned rule on every copy that comes back reads as a document only half completed.
     *
     * SO ONE RULE IS LEFT AND IT IS THE DEBTOR'S. `signer` still says so rather than leaving it to
     * be read off the words -- the role is what decides where a mark lands, and the day somebody
     * adds a witness line is the day a document with no roles on it stamps the wrong one. See
     * signedMark.ts.
     */
    { kind: 'signature', widthMm: 70, signer: 'debtor', spans: [T(isCo
      ? 'for the Debtor — {{debtor_name}} ({{debtor_reg_no}}), duly authorised'
      : 'The Debtor — {{debtor_name}}')] },

    { kind: 'pagebreak' },
    H(2, 'ANNEXURE A — CONSENT TO JUDGMENT'),
    P('In the Magistrate’s Court for the district in which the Debtor resides, carries on business or is employed.'),
    { kind: 'table', borders: 'rows', widths: [32, 68], rows: [
      row('Plaintiff', '{{client_name}}'),
      row('Defendant', `{{debtor_name}}, ${idLine.toLowerCase()}`),
      row('Reference', '{{case_number}}'),
    ] },
    P('The Defendant, having acknowledged the debt described in Part A of the agreement to which this annexure is attached, hereby consents in terms of section 58 of the Magistrates’ Courts Act 32 of 1944 to judgment being entered against the Defendant for:'),
    { kind: 'list', ordered: true, items: [
      [T('payment of the Capital Amount recorded in item 6 of Part A, less any payments made after the Signature Date;')],
      [T('interest on that amount at the rate recorded in item 9 of Part A;')],
      [T('costs of suit on the attorney and own client scale; and')],
      [T('collection commission and the fees and expenses prescribed in Annexure B to the Debt Collectors Act 114 of 1998.')],
    ] },
    P('The Defendant confirms that this consent is given freely, that the Defendant has read and understood it, and that the Defendant has been advised of the right to obtain independent legal advice before signing.'),
    { kind: 'spacer', mm: 6 },
    /* The consent to judgment loses its "Signed at ____ on ____" for the same reason as Part B. */
    { kind: 'signature', widthMm: 70, signer: 'debtor', spans: [T(isCo
      ? 'for the Defendant — {{debtor_name}}, duly authorised'
      : 'The Defendant — {{debtor_name}}')] },
  ] }
}

export function covering(kind) {
  const isCo = kind === 'company'
  return [
    'Dear {{debtor_name}}',
    '',
    isCo
      ? 'Further to our discussion, attached is an acknowledgement of debt for account {{account_number}}, for signature by a duly authorised representative of {{debtor_name}}.'
      : 'Further to our discussion, attached is an acknowledgement of debt for account {{account_number}}.',
    '',
    'It records the amount owing as {{balance}} and the arrangement you have asked for: {{ptp_amount}} {{ptp_frequency}}, beginning on {{ptp_date}}.',
    '',
    'What it does:',
    'While the instalments are paid on time and in full, no further collection step is taken and no legal proceedings are instituted.',
    'If an instalment is missed, the full balance falls due at once and the consent to judgment in Annexure A may be lodged.',
    'It does not reduce the amount owing or stop interest running.',
    '',
    'Please read all of it, including Part B and Annexure A, before you sign. You are entitled to obtain independent legal advice first.',
    '',
    /*
     * THE BUTTON, NOT A RETURN ADDRESS.
     *
     * THE FIRM, having sent one: "there's no link to open it in the email that goes out. The link
     * is copied in another place and then you have to email it." This line used to read "Return
     * the signed document to {{agent_email}}" -- which is a printing-and-posting instruction on a
     * document that is now signed online by pressing a button in the same message. A debtor
     * reading both does the slower one.
     *
     * THE BUTTON ITSELF IS NOT IN THE TEMPLATE and must not be: the link is a 43-character token
     * made at the moment of sending, so it cannot be a merge field somebody could leave in a
     * template that was saved before the request existed. SigningPanel appends it -- see
     * signingButtonHtml -- and the covering email is no longer sendable without it.
     */
    'Open it with the button below, read it and sign it there. If anything in it does not match what we discussed, tell us before you sign and we will correct it.',
    '',
    'Kind regards',
    '{{agent_name}}',
    '{{firm_name}}',
    '{{agent_phone}}',
  ].join('\n')
}
