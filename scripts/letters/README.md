# The firm's eight notices

The letters the collections workflow attaches: a section 129 and a letter of demand on day 1, a
final notice on day 12, a listing notice on day 39 and an intended-summons notice on day 49, each
written twice — for a person and for a company.

**The firm's PDFs are the artwork, not the content.** Each specimen they sent is already typeset
with one debtor's details in it — "Mr T Mokoena", "GPS3/10103", "R 48 215.60" — so turning them
into templates meant putting a merge field back wherever a value had been typeset in. Every
substitution is declared once here, so the same sample value cannot become two different fields
in two letters.

**The shared blocks are shared.** The date/reference strip, the banking details, the signature and
the delivery note are identical across all eight; written once in `blocks.mjs`, a change to the
firm's trust account is one edit rather than eight.

**They carry the decisions made after the specimens were drawn.** The specimens show
`OUR REFERENCE GPS3/10103` — the client's reference — and `850312 XXXX 08 X`. Both changed: the
notices now lead with Raptor's own case number, because the client's is used on more than one
account 5,013 times over, and the masked identity number lost its spaces because they cost an SMS
three characters it does not have.

**And `attachments.json` says which email posts which notice.** Ten of the firm's fourteen
collections emails carry a PDF; the other four — the two handover messages and the two that warn a
listing is being prepared — say what they have to say in their own words. The pairing itself lives
on `message_templates.attachment_id`, where the composer reads it, but a column of UUIDs in one
database is not a record anybody can review and a second environment starts with none of it. This
file is the record, and it is what the wiring was applied from.

Run `node scripts/letters/build.mjs` to regenerate. `check-letters.mjs` reads `letters.json` and
`attachments.json` and asks of each notice what the composer will ask before it attaches one: that
every merge field exists and is on the collections side, that it names the trust account and not
the business one, that Charter can draw every character in it, that it paginates — and that the
email posting it was written for the same debtor. It does **not** read the database. Loading a
letter is a separate step, and each one was verified there by comparing `md5(body)` against the
build; a letter edited in the database alone is a drift this cannot see.

## The acknowledgements of debt

Two more, and they are not notices. Everything above demands payment; these are an **agreement
somebody signs**, nine pages each, with a consent to judgment annexed — so they share almost no
block with the eight and live in `aod.mjs`.

**Each produces two rows**, a letter and its covering email, which is the shape the section 129
already has. The firm asked for them "as an email template"; the email is the covering note, and
the agreement is the attachment.

**The specimen's Annexure B is Annexure A here.** Annexure B means one thing in this firm — the
Debt Collectors Act tariff — and the same document names it twice, in item 7 and again in Part B.
Two Annexure Bs in one agreement is a drafting error waiting to be read out in court.

**Item 6 shows its working, off the ledger.** The clause above it has the debtor confirm they have
*checked* the capital amount and agree it is correct, so every line of the sum is printed — handed
over, plus interest, plus fees and VAT, less payments. The figures come from the statement rather
than from `debtor_accounts`, whose own columns disagree with the ledger beneath them on thousands
of accounts; a document somebody signs is the last place to take the worse of two numbers.

### Getting them into a database

Everything above is the repository's half. **Raptor reads its templates from `message_templates`,**
so a letter that is perfect in `letters.json` and absent from the table is a letter nobody can send.
Two routes, and they write the same four rows:

```
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/letters/seed-aod.mjs
```

or paste `seed-aod.sql` into Supabase's SQL editor. That file is **generated** —
`node scripts/letters/seed-aod.mjs --sql > scripts/letters/seed-aod.sql` — because a hand-kept copy
would eventually load a document nobody has reviewed; `check-aod` holds it against what `aod.mjs`
builds, character for character.

**Both are safe to run twice.** They delete by seed key and by name before inserting, which is not
a nicety: the session that wrote these documents could read the database and every write timed out,
and a chunked insert left one row holding the first 5 604 characters of a nine-page agreement. A
missing template cannot be chosen from a picker and a truncated one can, so each row is read back
and compared by md5.

**`format` is `document` on a letter, and the twelve notices already seeded have it wrong.** A
letter's body is `letterDocument` JSON and that column is how the browser knows — `AttachLetter`
lists only letters whose format says `document`, so on a database seeded from `schema.sql` the
Attach control in a compose box lists **nothing**. The workflow runner parses the body whatever the
column says (`step.ts`, `lettersFor`), which is why it went unnoticed: the automatic path does not
read the value and the path a person uses does. `seed-aod.sql` corrects those twelve on the way
past, narrowed to a letter whose body really does begin as a document.
