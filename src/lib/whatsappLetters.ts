/**
 * THE SHORT WHATSAPP VERSION OF EVERY LETTER (S9, 19 Oct). The firm: "we should be able to WhatsApp
 * all the PDFs, letters ... to the debtors. So perhaps we should build very short versions of every
 * letter ... the section 129, the PDF stays the same, but the message that goes to the debtor on
 * WhatsApp is much shorter."
 *
 * THE PDF IS THE NOTICE; THIS IS THE COVERING LINE. Each says what is attached, the one thing to do,
 * and how to reach us -- never the notice's terms, which live in the PDF and must not be restated
 * in a second, shorter, different form. "Attached", where the SMS versions say "emailed", because
 * the PDF goes in the same chat.
 *
 * ONLY FIELDS EVERY ACCOUNT CAN ANSWER: the debtor, our case number, the client, the balance, the
 * firm's number. A respond-by date or a settlement figure is in the PDF; a covering line that held
 * on an unfilled date would stop a letter going for want of a sentence.
 *
 * DRAFT WORDING, written for the firm to read and change -- see HANDOFF. Keyed on the letter's seed
 * key with the audience taken off ("letter-s129-individual" -> "s129"), so the individual and the
 * company version share a line; a letter the firm writes themselves gets the general one.
 */
export const WHATSAPP_LETTER_TEXT: Record<string, string> = {
  s129: '{{debtor_name}}, this is {{firm_name}} about matter {{case_number}} for {{client_name}}. Attached is a Section 129 notice: {{balance}} is outstanding. Please read it and reply or call us. {{firm_phone}}',
  'final-notice': '{{debtor_name}}, this is {{firm_name}} about matter {{case_number}}. Attached is a final notice: {{balance}} is outstanding. Please pay or call us to avoid legal action. {{firm_phone}}',
  demand: '{{debtor_name}}, this is {{firm_name}} about matter {{case_number}} for {{client_name}}. Attached is a letter of demand: {{balance}} is outstanding. Please read it and reply or call us. {{firm_phone}}',
  listing: '{{debtor_name}}, this is {{firm_name}} about matter {{case_number}}. Attached is a notice about a credit bureau listing. Please read it and call us. {{firm_phone}}',
  summons: '{{debtor_name}}, this is {{firm_name}} about matter {{case_number}}. Attached is a notice of intended legal proceedings. Please call us today. {{firm_phone}}',
  'ptp-default': '{{debtor_name}}, this is {{firm_name}} about matter {{case_number}}. Attached is a notice that your payment arrangement has lapsed. Please pay or call us within 48 hours. {{firm_phone}}',
  'dispute-undisputed': '{{debtor_name}}, this is {{firm_name}} about matter {{case_number}}. Attached is a notice that the account is deemed undisputed. Please read it and call us. {{firm_phone}}',
  aod: '{{debtor_name}}, this is {{firm_name}} about matter {{case_number}}. Attached is the acknowledgement of debt for you to read and sign. {{firm_phone}}',
  affordability: '{{debtor_name}}, this is {{firm_name}} about matter {{case_number}}. Attached is the list of what we need for a payment arrangement. Please send it to us. {{firm_phone}}',
}

/** For a letter with no line of its own: says which letter, and nothing it does not know. */
export const WHATSAPP_LETTER_GENERAL = '{{debtor_name}}, this is {{firm_name}} about matter {{case_number}}. Please see the attached {{letter_name}}. {{firm_phone}}'

/** "letter-s129-individual" -> "s129"; null where it is not a seeded letter. */
export function letterKindOf(seedKey: string | null | undefined): string | null {
  if (!seedKey?.startsWith('letter-')) return null
  return seedKey.slice('letter-'.length).replace(/-(individual|company)$/, '')
}

/** The covering line's template for a letter, before its fields are filled. */
export function whatsAppLetterTemplate(seedKey: string | null | undefined): string {
  return WHATSAPP_LETTER_TEXT[letterKindOf(seedKey) ?? ''] ?? WHATSAPP_LETTER_GENERAL
}

/** The letter's name as a debtor reads it: "Section 129 notice", without "(individual)". */
export function letterNameForDebtor(name: string): string {
  const plain = name.replace(/\s*\((individual|company)\)\s*$/i, '').trim()
  return plain.charAt(0).toLowerCase() + plain.slice(1)
}
