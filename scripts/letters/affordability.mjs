/**
 * THE TWO AFFORDABILITY ASSESSMENTS, built from the firm's own financial-information requests.
 *
 * THE FIRM, sending BF-Financial-Information-Individuals and -Companies: "I think this is the
 * financial information request. We will call them the affordability assessment letters and build
 * them in exactly like the acknowledgement of debt so that they can sign it online."
 *
 * ------------------------------------------------------------------------------------------------
 * A FORM, NOT A LETTER, AND THAT IS THE WHOLE DIFFICULTY
 * ------------------------------------------------------------------------------------------------
 *
 * Every other document in this library is something the firm SAYS. This one is something the firm
 * ASKS, and on the firm's own PDFs the answers are blank boxes drawn on paper: twelve of them for
 * a person, four for a company. Printed and posted that works. Sent as a signing link it does not,
 * unless the boxes are real -- so every line of the two tables is a MERGE FIELD backed by a
 * `signingBlanks` entry, and the debtor fills the form on the page they sign.
 *
 * THE TWO TOTALS ARE NOT ASKED FOR. "Total income" and "Total expenses" are sums of the lines above
 * them, and a debtor who types a total that does not equal their own lines gives the firm a figure
 * it cannot use. They are computed -- see `totalOf` -- and so is one line the firm's own form does
 * not have: what is LEFT each month, which is the single number an affordability assessment exists
 * to produce and which their paper form leaves somebody to work out afterwards.
 *
 * ------------------------------------------------------------------------------------------------
 * WHAT CHANGED FROM THE SPECIMENS, AND WHY
 * ------------------------------------------------------------------------------------------------
 *
 *   - THE RAND SIGNS CAME OFF TWO LINES. The firm's own form prints "Day of the month you will pay
 *     it  R ___" and "Number of instalments proposed  R ___". Neither is an amount of money, and a
 *     form that draws an R in front of a count is a form somebody answers in rands. The day of the
 *     month is now a real DATE -- `ptp_date`, the same field the acknowledgement of debt asks --
 *     because "the 25th" is not a thing the diary can book and a date is.
 *
 *   - THE TICK-BOXES BECAME A LIST OF WHAT TO SEND. The paper form says "TICK EACH ITEM AS YOU
 *     ATTACH IT, AND SEND THIS PAGE BACK WITH THE DOCUMENTS", which is an instruction to somebody
 *     holding a pen and an envelope. The signing page cannot take an upload -- the signer is
 *     anonymous and the anon role has no rights on the storage bucket, deliberately, for the
 *     reason signingRules.ts gives -- so the documents still come back by email, and a tick-box
 *     saying "attached" on a page with nothing attached to it would be a lie the debtor signed.
 *     SAY IF THE FIRM WANTS UPLOADS: it is a real piece of work and a real security surface, not a
 *     checkbox.
 *
 *   - THE PARTICULARS ARE MERGED. The specimens are typeset with one debtor's details in them
 *     ("Mr T Mokoena", "GPS3/10103", "R 48 215,60"), exactly as the eight notices were, so turning
 *     them into templates meant putting a merge field back wherever a value had been typeset in.
 *
 *   - THE BALANCE IS PRINTED AND THE IDENTITY NUMBER IS OPTIONAL, which is the rule everywhere
 *     else: 97% of the book has no identity number, so the line leaves rather than holding the
 *     document. See MergeField.optional.
 *
 * Emits JSON in the letter format. Nothing here touches a database.
 */
const T = (text, bold) => (bold ? { text, bold } : { text })
const P = (text, extra = {}) => ({ kind: 'paragraph', spans: [T(text)], ...extra })
const H = (level, text, numbered) => ({ kind: 'heading', level, spans: [T(text)], ...(numbered ? { numbered: true } : {}) })
const row = (a, b) => [{ spans: [T(a, true)] }, { spans: [T(b)] }]

/** One line of a money table: a label and the field the signer fills. */
const line = (label, field) => [{ spans: [T(label)] }, { spans: [T(`R {{${field}}}`)] }]
/** A line the form works out for itself, drawn in bold so it reads as an answer. */
const sum = (label, field) => [{ spans: [T(label, true)] }, { spans: [T(`R {{${field}}}`, true)] }]

const DEFAULTS = {
  font: '"Charter", "Bitstream Charter", Georgia, serif',
  size: 10.5, colour: '#1f2937', lineHeight: 1.45,
}

export function affordability(kind) {
  const isCo = kind === 'company'
  const idLine = isCo ? 'Registration number: {{debtor_reg_no}}' : 'Identity number: {{debtor_id_masked}}'

  return { defaults: DEFAULTS, blocks: [
    { kind: 'table', borders: 'none', widths: [28, 72], rows: [
      row('DATE', '{{today}}'), row('OUR REFERENCE', '{{case_number}}'),
      row('ACCOUNT', '{{account_number}}'), row('DELIVERY', 'By email, with notification by SMS'),
    ] },

    P('{{debtor_name}}'),
    /* ON A LINE OF ITS OWN, so documentWithoutOptional can take the whole paragraph out on the 97%
       of accounts with no identity number rather than leave the braces standing. */
    P(idLine),

    H(1, 'AFFORDABILITY ASSESSMENT'),
    P('Financial information required before a payment arrangement can be put to the creditor'),

    P(isCo
      ? 'Dear Sirs / Madams — we act on behalf of {{client_name}}, the creditor. The company has '
        + 'asked to pay the balance of {{balance}} over time. Before a proposal can be put to the '
        + 'creditor, we need the information set out below.'
      : 'Dear {{debtor_name}} — we act on behalf of {{client_name}}, the creditor. You have asked '
        + 'to pay the balance of {{balance}} over time. Before a proposal can be put to the '
        + 'creditor, we need the information set out below.'),

    H(2, 'WHAT TO SEND US', true),
    /*
     * "SEND", NOT "TICK". The paper form's checklist is for somebody with a pen and an envelope;
     * this one is signed online and the documents follow by email. See the header.
     */
    P(isCo
      ? 'Send these to us by email. Fill in the proposal below, sign at the foot of this document, '
        + 'and attach the documents to your reply.'
      : 'Send these to us by email. Fill in the summary below, sign at the foot of this document, '
        + 'and attach the documents to your reply.'),
    { kind: 'list', ordered: true, keepTogether: true, items: isCo ? [
      [T('The company’s latest management accounts, or its most recent annual financial statements if management accounts are not available.')],
      [T('Bank statements for the company’s main account for the last three months.')],
      [T('A debtors and creditors age analysis as at the date of this proposal.')],
      [T('The name and capacity of the person signing on behalf of the company.')],
    ] : [
      [T('Proof of income for the last three months: payslips if you are employed, or bank statements if you are not.')],
      [T('Bank statements for your main account for the last three months.')],
      [T('A copy of your identity document.')],
    ] },

    ...(isCo ? [] : [
      H(2, 'YOUR INCOME', true),
      { kind: 'table', borders: 'rows', headerRow: true, widths: [62, 38], keepTogether: true, rows: [
        [{ spans: [T('INCOME', true)] }, { spans: [T('AMOUNT PER MONTH', true)] }],
        line('Salary or wages, after deductions', 'income_salary'),
        line('Income from any other source', 'income_other'),
        line('Income of a spouse or partner who contributes', 'income_partner'),
        sum('Total income', 'income_total'),
      ] },

      H(2, 'YOUR EXPENSES', true),
      { kind: 'table', borders: 'rows', headerRow: true, widths: [62, 38], keepTogether: true, rows: [
        [{ spans: [T('EXPENSES', true)] }, { spans: [T('AMOUNT PER MONTH', true)] }],
        line('Rent or bond', 'expense_housing'),
        line('Rates, water and electricity', 'expense_utilities'),
        line('Food and household', 'expense_food'),
        line('Transport, fuel or taxi fares', 'expense_transport'),
        line('School fees and childcare', 'expense_school'),
        line('Insurance and medical aid', 'expense_medical'),
        line('Other credit repayments', 'expense_credit'),
        line('Everything else', 'expense_other'),
        sum('Total expenses', 'expense_total'),
      ] },

      /*
       * THE LINE THE FIRM'S OWN FORM DOES NOT HAVE, and the reason the form is filled in at all.
       * Their paper version leaves somebody to subtract one total from the other afterwards; drawn
       * here it is done in front of the debtor, before they say what they will pay.
       */
      { kind: 'table', borders: 'all', widths: [62, 38], keepTogether: true, rows: [
        sum('What is left each month', 'affordability_left'),
      ] },
    ]),

    H(2, isCo ? 'THE PROPOSAL' : 'WHAT YOU CAN PAY', true),
    { kind: 'table', borders: 'rows', headerRow: true, widths: [62, 38], keepTogether: true, rows: [
      [{ spans: [T('YOUR PROPOSAL', true)] }, { spans: [T('AMOUNT', true)] }],
      [{ spans: [T(isCo ? 'Amount the company proposes to pay each time' : 'Amount you propose to pay each time')] },
        { spans: [T('R {{ptp_amount}}')] }],
      [{ spans: [T('How often it will be paid')] }, { spans: [T('{{ptp_frequency}}')] }],
      /* A DATE, NOT A DAY OF THE MONTH. "The 25th" is not something the diary can book. */
      [{ spans: [T('The date of the first payment')] }, { spans: [T('{{ptp_date}}')] }],
      ...(isCo ? [[{ spans: [T('Number of instalments proposed')] }, { spans: [T('{{offer_instalments}}')] }]] : []),
      line(isCo ? 'Any lump sum the company can pay now' : 'Any lump sum you can pay now', 'offer_lump_sum'),
    ] },

    H(2, 'WHAT HAPPENS NEXT', true),
    P('We use this information only to assess the proposal and to put it to the creditor, and we '
      + 'process it in accordance with the Protection of Personal Information Act 4 of 2013. A '
      + 'proposal cannot be considered until the information above has reached us, and '
      + 'the account continues on its normal course in the meantime.'),
    P('Send the documents to {{agent_email}}, quoting reference {{case_number}}. We will revert as '
      + 'soon as the creditor has considered the proposal.'),
    /* THE ONE THING THIS DOCUMENT IS NOT, said plainly. A debtor who signs a form headed
       "affordability assessment" and hears nothing for a week will believe the account is on hold,
       and it is not -- the paragraph above says so, and this says what the signature is for. */
    P(isCo
      ? 'By signing below the company confirms that the information given above is true and '
        + 'complete. This document is not an agreement to accept the proposal and it does not '
        + 'suspend the account.'
      : 'By signing below you confirm that the information given above is true and complete. This '
        + 'document is not an agreement to accept your proposal and it does not suspend the '
        + 'account.'),

    { kind: 'spacer', mm: 6 },
    /*
     * ONE RULE, AND IT IS THE DEBTOR'S -- the same decision the firm made on the acknowledgement of
     * debt: "for the creditor, I don't think we have to sign that." The firm is asking for
     * information, not agreeing to anything, so a counter-signature would say something the
     * document does not mean.
     */
    { kind: 'signature', widthMm: 70, signer: 'debtor', spans: [T(isCo
      ? 'for {{debtor_name}} ({{debtor_reg_no}}), duly authorised'
      : '{{debtor_name}}')] },

    P('{{firm_name}}, duly authorised agent of {{client_name}}'),
  ] }
}

/** The covering email, which carries the button. */
export function covering(kind) {
  const isCo = kind === 'company'
  return [
    'Dear {{debtor_name}}',
    '',
    isCo
      ? 'Further to our discussion, attached is an affordability assessment for account '
        + '{{account_number}}, for completion and signature by a duly authorised representative of '
        + '{{debtor_name}}.'
      : 'Further to our discussion, attached is an affordability assessment for account '
        + '{{account_number}}.',
    '',
    'The balance is {{balance}}. Before a proposal can be put to the creditor we need to know what '
    + (isCo ? 'the company' : 'you') + ' can afford, which is what this form asks.',
    '',
    'What to do:',
    'Open it with the button below and fill in the figures. The totals work themselves out.',
    'Say what ' + (isCo ? 'the company' : 'you') + ' can pay and from when, then sign at the foot.',
    'Reply to this email with the supporting documents listed in the form.',
    '',
    /* WHAT IT IS NOT, in the email as well as on the form. A debtor who fills in an affordability
       assessment and hears nothing will believe the account is on hold. */
    'Filling this in does not suspend the account and it is not an agreement to accept the '
    + 'proposal. We will revert as soon as the creditor has considered it.',
    '',
    'Kind regards',
    '{{agent_name}}',
    '{{firm_name}}',
    '{{agent_phone}}',
  ].join('\n')
}
