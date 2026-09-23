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

Run `node scripts/letters/build.mjs` to regenerate. `check-letters.mjs` holds the output against
what the library actually contains, so a letter edited in the database without being edited here
is a failure rather than a drift nobody sees.
