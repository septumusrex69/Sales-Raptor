/**
 * A book, invented but shaped like the real one.
 *
 * NO DATABASE AND NO CREDENTIALS. The tests that use these drive the real app in a real browser
 * and answer every request it makes from here, which buys three things: they run on any machine
 * and in any session without a network policy that reaches Supabase; they cannot be broken by
 * somebody editing staging; and the numbers are known, so a check can assert "Broken promises 40"
 * rather than "some number appeared".
 *
 * The shapes must match PostgREST exactly — including the content-range header the account list
 * reads its total from — because a fixture that is subtly the wrong shape tests the fixture.
 */

export const USER_ID = '11111111-1111-4111-8111-111111111111'
export const COMPANY_ID = '22222222-2222-4222-8222-222222222222'
export const TEAM_ID = '33333333-3333-4333-8333-333333333333'

export const PROFILE = {
  id: USER_ID,
  name: 'Test Leader',
  email: 'leader@raptor.test',
  role: 'Pre-legal Team Leader',
  team_id: TEAM_ID,
  status: 'Active',
  phone: null,
  avatar_color: '#355069',
  created_at: '2026-01-01T00:00:00Z',
  email_signature: null,
  email_signature_image_url: null,
  email_signature_image_width: null,
  email_signature_image_align: 'left',
  buzzbox_extension: null,
  diary_capacity: 40,
  diary_order: null,
  collector_grade: 'Senior',
  book_ceiling: 500,
  diary_reserve: 10,
}

/** A real pre-legal clerk with no grade — the case that used to vanish from the hand-out list. */
export const UNGRADED = {
  ...PROFILE,
  id: '55555555-5555-4555-8555-555555555555',
  name: 'Itumeleng Agent',
  email: 'itumeleng@raptor.test',
  role: 'Pre-legal Agent',
  collector_grade: null,
  book_ceiling: null,
  diary_capacity: null,
  diary_reserve: null,
}

export const COLLEAGUE = {
  ...PROFILE,
  id: '44444444-4444-4444-8444-444444444444',
  name: 'Thandi Junior',
  email: 'thandi@raptor.test',
  role: 'Pre-legal Agent',
  collector_grade: 'Junior',
  book_ceiling: 150,
}

/**
 * A full collections floor. Eight people fitted in cards; thirty-five is the case the search box
 * and the scroll cap exist for, so the fixture carries thirty-five.
 */
const BENCH_NAMES = [
  'Annelize Venter', 'Thabo Mokoena', 'Rehana Patel', 'Gerhard Kruger', 'Nomsa Dube',
  'Sipho Khumalo', 'Marlize du Toit', 'Kagiso Molefe', 'Priya Naidoo', 'Johan Steyn',
  'Lerato Mahlangu', 'Bongani Zulu', 'Chantelle Botha', 'Tshepo Radebe', 'Aisha Cassim',
  'Riaan Pretorius', 'Zanele Ngcobo', 'Werner Nel', 'Palesa Sithole', 'Devan Pillay',
  'Elmarie Swanepoel', 'Musa Ndlovu', 'Carla Meyer', 'Katlego Maseko', 'Shireen Abrahams',
  'Pieter Coetzee', 'Nandi Mthembu', 'Ryno Fourie', 'Ayanda Buthelezi', 'Michelle Jacobs',
  'Sabelo Mahlaba', 'Yusuf Ismail', 'Hanlie Grobler', 'Refilwe Tau', 'Dylan Adams',
]
const GRADES = ['Junior', 'Skilled', 'Senior', 'Elite']

export const BENCH = BENCH_NAMES.map((name, i) => ({
  ...PROFILE,
  id: `bench-${String(i).padStart(4, '0')}-4000-8000-000000000000`,
  name,
  email: `${name.toLowerCase().replace(/[^a-z]/g, '.')}@raptor.test`,
  role: i < 5 ? 'Pre-legal Team Leader' : 'Pre-legal Agent',
  // The last six ungraded, mirroring the real floor and the case that once vanished.
  collector_grade: i >= BENCH_NAMES.length - 6 ? null : GRADES[i % 4],
  book_ceiling: i === 5 ? 700 : null,
  diary_capacity: i === 11 ? 35 : null,
  team_id: TEAM_ID,
}))

export const COMPANY = {
  id: COMPANY_ID,
  name: 'Northbank Properties',
  status: 'Won',
  owner_id: USER_ID,
  created_at: '2026-01-01T00:00:00Z',
}

export const TEAM = { id: TEAM_ID, name: 'Pre-legal', kind: 'Sales' }

/** The counts the views row must show. Chosen to be unmistakable in an assertion. */
export const VIEW_COUNTS = {
  whole_book: 736,
  my_desk: 12,
  unallocated: 730,
  adrift: 2,
  broken_promises: 40,
  promises_due: 58,
  gone_quiet: 557,
}

export const BOOK_SUMMARY = {
  accounts: 736,
  capital: 14490249.16,
  clients: 7,
  commission_drift: 60,
}

export const FACETS = [
  { kind: 'sub_status', value: 'Delinquent Payer', accounts: 90 },
  { kind: 'sub_status', value: 'Promise To Pay', accounts: 58 },
  { kind: 'bucket', value: 'Diary', accounts: 649 },
  { kind: 'bucket', value: 'Failed PTPs', accounts: 40 },
]

const SURNAMES = ['Mhlongo', 'Nkosi', 'Van Wyk', 'Botha', 'Dlamini', 'Pretorius', 'Khumalo', 'Naidoo']

/** One page of accounts. `n` rows, deterministic, spread across the three bands. */
export function accountsPage(n, offset = 0) {
  return Array.from({ length: n }, (_, i) => {
    const k = offset + i
    // Every eighth is major, every fourth high value, the rest generic — so a single page shows
    // all three bands and the Position column has something to say.
    const outstanding = k % 8 === 0 ? 180000 : k % 4 === 0 ? 31000 : 4200 + (k % 50) * 90
    return {
      id: `acc-${String(k).padStart(4, '0')}`,
      company_id: COMPANY_ID,
      handover_id: null,
      account_number: `NB${String(10000 + k)}`,
      swordfish_reference: null,
      client_reference: `REF/${k}`,
      debtor_first_name: 'A',
      debtor_surname: SURNAMES[k % SURNAMES.length],
      debtor_id_number: null,
      capital_handed_over: outstanding,
      capital_outstanding: outstanding,
      in_duplum: k % 25 === 0,
      in_duplum_ceiling: outstanding,
      commission_rate: 0.25,
      commission_rate_expected: k % 12 === 0 ? 0.3 : 0.25,
      commission_rate_source: 'mandate',
      commission_drift: k % 12 === 0,
      interest_rate_annual: 0.115,
      prescribed: false,
      prescription_date: null,
      status: k % 9 === 0 ? 'Written-off' : 'Active: Activated',
      sub_status: k % 5 === 0 ? 'Promise To Pay' : k % 7 === 0 ? 'Delinquent Payer' : null,
      frozen_by: null,
      frozen_reason: null,
      frozen_at: null,
      client_action_ask: k % 15 === 0 ? 'Please send the signed agreement.' : null,
      client_action_due: null,
      bucket: k % 11 === 0 ? 'Failed PTPs' : 'Diary',
      write_off_reason: null,
      handover_date: '2026-03-01',
      payments_to_date: k % 3 === 0 ? 1500 : null,
      swordfish_balance_at_import: null,
      swordfish_fees_at_import: null,
      swordfish_assigned_to: null,
      assigned_to: k % 6 === 0 ? USER_ID : null,
      diary_date: null,
      last_action_at: k % 4 === 0 ? '2026-08-01T09:00:00Z' : null,
      last_payment_at: null,
      main_comment: null,
      main_comment_at: null,
      preferred_language: null,
      contact_preference: null,
      consent_status: null,
      debtor_title: null,
      debtor_initials: null,
      debtor_second_name: null,
      account_flags: null,
      account_rating: null,
      last_contact_method: null,
      ptp_success_ratio: null,
    }
  })
}

/* ---------- the mailbox ---------- */

/**
 * A morning's mail, as PostgREST would hand it back.
 *
 * Five messages chosen so that each thing the screen has to say about a message is said by at
 * least one row and NOT by its neighbour -- an unmatched enquiry from a stranger, a matched one on
 * a debtor account, one that has been read, one with an attachment, one with three people on it.
 * A fixture where every row looks the same cannot tell a working list from a broken one.
 */
const MAIL_AT = (minutes) => new Date(Date.now() - minutes * 60000).toISOString()

export const MAIL = [
  {
    id: 'aaaaaaa1-0000-4000-8000-000000000001',
    folder: 'INBOX', is_sent: false, uid: 101,
    message_id: '<enquiry-1@example.co.za>',
    from_address: 'ernest@example.co.za', from_name: 'Ernest Mohlalisi',
    subject: 'Debt collection enquiry',
    snippet: 'I would like assistance recovering money owed to me. Please let me know what '
      + 'information you need to assess the matter.',
    /* Three people on it, so Reply all has something to do and the To/Cc lines have something
       to say. Everything else in this fixture has one recipient, so the two cases are visibly
       different rather than accidentally identical. */
    to_address: 'stephan@bredellferreira.co.za', to_name: 'Stephan',
    to_recipients: [{ name: 'Stephan', address: 'stephan@bredellferreira.co.za' }],
    cc_recipients: [{ name: 'Camille', address: 'camille@bredellferreira.co.za' }],
    attachment_names: [], is_junk: false, occurred_at: MAIL_AT(12),
    read_at: null, is_filed: false, is_settled: false, no_record_at: null,
    linked_account_id: null, linked_lead_id: null, linked_deal_id: null,
    linked_company_id: null, linked_contact_id: null,
    debtor_accounts: null, leads: null, deals: null, companies: null, contacts: null,
  },
  {
    id: 'aaaaaaa1-0000-4000-8000-000000000002',
    folder: 'INBOX', is_sent: false, uid: 102,
    message_id: '<mandate-2@example.co.za>',
    from_address: 'danielle@louwrens-attorneys.co.za', from_name: 'Danielle Louwrens',
    subject: 'Agreement and next steps',
    snippet: 'Please find the signed mandate and supporting documents attached.',
    to_address: 'stephan@bredellferreira.co.za', to_name: 'Stephan',
    to_recipients: [{ name: 'Stephan', address: 'stephan@bredellferreira.co.za' }],
    cc_recipients: [],
    attachment_names: ['mandate.pdf'], is_junk: false, occurred_at: MAIL_AT(150),
    read_at: MAIL_AT(140), is_filed: true, is_settled: true, no_record_at: null,
    linked_account_id: '44444444-4444-4444-8444-444444444444',
    linked_lead_id: null, linked_deal_id: null, linked_company_id: null, linked_contact_id: null,
    debtor_accounts: {
      account_number: 'BF10231', debtor_first_name: 'Willem', debtor_surname: 'Bezuidenhout',
    },
    leads: null, deals: null, companies: null, contacts: null,
  },
  {
    id: 'aaaaaaa1-0000-4000-8000-000000000003',
    folder: 'INBOX', is_sent: false, uid: 103,
    message_id: '<followup-3@example.co.za>',
    from_address: 'felicia@example.co.za', from_name: null,
    subject: 'Follow up on outstanding account',
    snippet: 'Just checking if there are any updates regarding the account we discussed.',
    to_address: 'stephan@bredellferreira.co.za', to_name: 'Stephan',
    to_recipients: [], cc_recipients: [],
    attachment_names: [], is_junk: false, occurred_at: MAIL_AT(320),
    /*
     * Settled as Open mail -- so the "Not matched yet" bar must stay off it -- and UNREAD, which
     * is the only reason the Open mail tab has a number to show. Settled and unread is an ordinary
     * combination: somebody clears a morning of supplier mail in bulk without opening any of it.
     */
    read_at: null, is_filed: false, is_settled: true, no_record_at: MAIL_AT(295),
    linked_account_id: null, linked_lead_id: null, linked_deal_id: null,
    linked_company_id: null, linked_contact_id: null,
    debtor_accounts: null, leads: null, deals: null, companies: null, contacts: null,
  },
  {
    id: 'aaaaaaa1-0000-4000-8000-000000000004',
    folder: 'INBOX', is_sent: false, uid: 104,
    message_id: '<documents-4@example.co.za>',
    from_address: 'nadia.pretorius@example.co.za', from_name: 'Nadia Pretorius',
    subject: 'Request for information',
    snippet: 'I would like to know what documents you need from me to proceed.',
    to_address: 'stephan@bredellferreira.co.za', to_name: 'Stephan',
    to_recipients: [{ name: 'Stephan', address: 'stephan@bredellferreira.co.za' }],
    cc_recipients: [],
    attachment_names: [], is_junk: false, occurred_at: MAIL_AT(480),
    read_at: null, is_filed: false, is_settled: false, no_record_at: null,
    linked_account_id: null, linked_lead_id: null, linked_deal_id: null,
    linked_company_id: null, linked_contact_id: null,
    debtor_accounts: null, leads: null, deals: null, companies: null, contacts: null,
  },
  {
    /*
     * AN ENQUIRY OFF THE WEBSITE'S CONTACT FORM, which is a different kind of message: the From
     * header is the FIRM'S OWN address, so everything about the person is in the body. A lead made
     * off the header here would carry form@bredellferreira.co.za -- and saved there it would match
     * every later enquiry to that same lead.
     *
     * The display name is the person's, which is what the form puts there and is exactly what
     * makes this trap easy to walk into.
     */
    id: 'aaaaaaa1-0000-4000-8000-000000000006',
    folder: 'INBOX', is_sent: false, uid: 106,
    message_id: '<website-6@bredellferreira.co.za>',
    from_address: 'form@bredellferreira.co.za', from_name: 'Ernest Mohlalisi',
    subject: 'New Message From Bredell Ferreira',
    snippet: 'Good Day We are looking for a service provider to collect money from customers',
    to_address: 'stephan@bredellferreira.co.za', to_name: 'Stephan',
    to_recipients: [{ name: 'Stephan', address: 'stephan@bredellferreira.co.za' }],
    cc_recipients: [],
    attachment_names: [], is_junk: false, occurred_at: MAIL_AT(40),
    read_at: null, is_filed: false, is_settled: false, no_record_at: null,
    linked_account_id: null, linked_lead_id: null, linked_deal_id: null,
    linked_company_id: null, linked_contact_id: null,
    debtor_accounts: null, leads: null, deals: null, companies: null, contacts: null,
  },
  /*
   * TWO IN JUNK, BOTH UNREAD, and they are here for one reason: with an empty Junk tab a per-tab
   * unread badge and a badge that counts the whole mailbox are indistinguishable -- both show
   * nothing. Two is also not one, so a count that came from the wrong tab cannot pass by luck.
   *
   * It is the tab that matters most, too: a client's reply a spam filter misfiled sat here with
   * nothing anywhere saying it had arrived.
   */
  {
    id: 'aaaaaaa1-0000-4000-8000-000000000007',
    folder: 'INBOX.spambucket', is_sent: false, uid: 107,
    message_id: '<junk-7@example.com>',
    from_address: 'marketing@seo-boost.example', from_name: 'SEO Boost',
    subject: 'Your website is not ranking',
    snippet: 'We noticed your site is missing out on traffic.',
    to_address: 'stephan@bredellferreira.co.za', to_name: 'Stephan',
    to_recipients: [], cc_recipients: [],
    attachment_names: [], is_junk: true, occurred_at: MAIL_AT(200),
    read_at: null, is_filed: false, is_settled: false, no_record_at: null,
    linked_account_id: null, linked_lead_id: null, linked_deal_id: null,
    linked_company_id: null, linked_contact_id: null,
    debtor_accounts: null, leads: null, deals: null, companies: null, contacts: null,
  },
  {
    id: 'aaaaaaa1-0000-4000-8000-000000000008',
    folder: 'INBOX.spambucket', is_sent: false, uid: 108,
    message_id: '<junk-8@example.com>',
    from_address: 'no-reply@crypto-wins.example', from_name: 'Crypto Wins',
    subject: 'Congratulations, you have won',
    snippet: 'Claim your prize before it expires.',
    to_address: 'stephan@bredellferreira.co.za', to_name: 'Stephan',
    to_recipients: [], cc_recipients: [],
    attachment_names: [], is_junk: true, occurred_at: MAIL_AT(260),
    read_at: null, is_filed: false, is_settled: false, no_record_at: null,
    linked_account_id: null, linked_lead_id: null, linked_deal_id: null,
    linked_company_id: null, linked_contact_id: null,
    debtor_accounts: null, leads: null, deals: null, companies: null, contacts: null,
  },
  {
    id: 'aaaaaaa1-0000-4000-8000-000000000005',
    folder: 'INBOX', is_sent: false, uid: 105,
    message_id: '<console-5@example.co.za>',
    from_address: 'noreply@search-console.example.com', from_name: 'Search Console',
    subject: 'New reasons prevent pages from being indexed',
    snippet: 'A new issue was detected on your site.',
    to_address: 'stephan@bredellferreira.co.za', to_name: 'Stephan',
    to_recipients: [], cc_recipients: [],
    attachment_names: [], is_junk: false, occurred_at: MAIL_AT(1500),
    read_at: MAIL_AT(1400), is_filed: false, is_settled: false, no_record_at: null,
    linked_account_id: null, linked_lead_id: null, linked_deal_id: null,
    linked_company_id: null, linked_contact_id: null,
    debtor_accounts: null, leads: null, deals: null, companies: null, contacts: null,
  },
]

/**
 * What the contact form posts, as the message body.
 *
 * Carries the firm's own footer under the enquiry on purpose: these emails do, and taking the LAST
 * phone number rather than the first would put the firm's own switchboard on the lead -- a number
 * a salesperson then phones.
 */
export const FORM_BODY = [
  'Good Day',
  '',
  /*
   * THE FIRM'S OWN FORM, in its own words and in its own order -- taken from a real enquiry and
   * then rewritten with invented details, because this repo is public.
   *
   * Three things about it are why this fixture exists and not a tidier one:
   *  - "Contact Number" and "Company or Business Name" are the labels the site actually posts,
   *    and neither is a spelling anybody would have guessed.
   *  - There is NO name field and NO email field. The person's name is in the From display name,
   *    which is why the parser is asked first and the header is the fallback.
   *  - "Subject" here is the SERVICE they want, not the email's subject line, which on every one
   *    of these reads "New Message From Bredell Ferreira" and tells nobody anything.
   */
  'We are looking for a service provider to collect money from customers dating back a few years.',
  'Contact Number: 021-555 0130',
  'Company or Business Name: Vaal Fire Services',
  'Subject: Debt Collecting',
  '',
  '--',
  'Bredell Ferreira',
  /* The firm's OWN switchboard, labelled, under the enquiry -- which is what these mails carry and
     what makes first-match-wins load-bearing rather than decorative. */
  'Tel: 011 555 0100',
  'Email: info@bredellferreira.co.za',
].join('\n')
