# WhatsApp on the Cloud API — specification

Status: **specification only.** Nothing here is built. It is written so that the moment one
utility template is approved, the work is a known quantity rather than a discovery exercise.

## 1. Why the Cloud API and not the free app

A `wa.me` deep link — which Raptor already uses — opens WhatsApp on the agent's phone with the
number filled in. It is one-way. Meta provides no way to read messages back out of the WhatsApp
or WhatsApp Business app: no webhook, no export, no API. A debtor's reply lives on that agent's
handset and nowhere else, which means it never reaches the account, never counts toward the
Annexure B cap, and cannot support a fee.

Unofficial libraries that drive WhatsApp Web can read messages. They are not an option here.
They breach WhatsApp's terms, Meta detects and bans the numbers, and they would route debtor
personal data — including ID numbers — through an unsanctioned channel for a firm registered
with the Council for Debt Collectors. The exposure is the registration, not the integration.

## 2. What it costs, and the shape that matters

Meta charges **no platform fee** for the Cloud API. No monthly minimum, no per-seat cost. The
billing is per message, and asymmetric in a way that suits this business:

| | |
|---|---|
| Debtor messages us | **free** |
| We reply within 24 hours of their message | **free** (a "service" message) |
| We message first, or the window has closed | **paid** (an approved template) |

So capturing replies costs nothing. Every rand is spent on messages we initiate.

At current volumes — about 0.5 outbound messages per account per month, measured from the SMS
history — a 100,000-account book would send roughly 50,000 templates a month. Each US cent of
per-message rate is about R9,000 a month at that volume. **Verify the current South African
utility rate against Meta's rate card before budgeting; it has changed twice in two years.**

Against that, an outbound WhatsApp is billable at the Annexure B correspondence rate. The
economics are not the constraint. Section 8 covers what is.

## 3. The 24-hour window is the product

This is the one mechanic that will decide whether agents use the feature properly or waste
money on it, so it belongs on the surface rather than buried in the backend.

Every conversation with a debtor is either **open** — they have messaged us within 24 hours, so
we can send anything, free — or **closed**, where only an approved template will be delivered
and it costs. The composer must say which, before the agent types, and never silently switch.

Concretely: an open window shows a free-text box and the time remaining. A closed window shows
the approved templates only, with the cost of sending stated. An agent should never be able to
write a paragraph and discover on send that it had to be a template.

## 4. Data model

Follows the email integration deliberately, so this is not a parallel universe with its own
conventions.

**A WhatsApp message is an `Activity` of type `WhatsApp`.** That is the whole point: it inherits
the threading onto deal/client/lead, the timelines, the unread count in the topbar, and the
Annexure B fee counting, without any of it being rebuilt.

```sql
-- One row. The business number, not a number per user: replies must reach whoever is on the
-- account, not whoever happened to send.
create table public.whatsapp_connection (
  id boolean primary key default true check (id),   -- enforces a single row
  display_number text not null,                     -- E.164, e.g. +27101234567
  phone_number_id text not null,                    -- Meta's id for the number
  waba_id text not null,                            -- WhatsApp Business Account id
  encrypted_access_token text not null,             -- AES-256-GCM, as api/_lib/crypto.ts does
  webhook_verify_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Approved templates, mirrored locally so the composer can show only what will actually send.
create table public.whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  language text not null default 'en',
  category text not null check (category in ('UTILITY','SERVICE','AUTHENTICATION')),
  status text not null check (status in ('APPROVED','PENDING','REJECTED','PAUSED')),
  body text not null,
  variables text[] not null default '{}',
  approved_at timestamptz,
  updated_at timestamptz not null default now()
);

-- On activities:
alter table public.activities
  add column wa_message_id text,                 -- Meta's id, for threading and status updates
  add column wa_replied_to text,                 -- context.id: the message this answers
  add column wa_status text,                     -- sent | delivered | read | failed
  add column wa_template_name text,              -- null for a free-form service message
  add column wa_billable boolean not null default false;
create unique index on public.activities (wa_message_id) where wa_message_id is not null;

-- Opt-outs are a legal obligation, not a preference, so they live apart from contact records
-- and survive a contact being edited or re-imported.
create table public.whatsapp_optouts (
  msisdn text primary key,                       -- E.164
  opted_out_at timestamptz not null default now(),
  source text not null,                          -- 'debtor_request' | 'agent' | 'meta_block'
  note text
);
```

Marketing is deliberately not in the category list. This business has no legitimate marketing
use for a debtor's WhatsApp number, and the category carries the harshest policy enforcement.

## 5. Endpoints

**`api/whatsapp/webhook.ts`** — public, so it is the most exposed surface in the app.

- `GET` answers Meta's verification challenge against `webhook_verify_token`.
- `POST` receives messages and status updates.
- **Every request's `X-Hub-Signature-256` is verified against the app secret before the body is
  read as anything but bytes.** Without this, anyone who learns the URL can write activities
  into the CRM. This is not optional and not a later hardening pass.
- Responds `200` immediately and processes after, because Meta retries on slow responses and a
  retry storm would duplicate messages.
- Idempotent on `wa_message_id` — the unique index above is what actually enforces it.

**`api/whatsapp/send.ts`** — authenticated, mirrors `api/email/send.ts`.

- Decides template vs free-form from the window state; never lets the caller assert it.
- Refuses if the number is opted out, or if sending would breach the Annexure B cap (§7).
- Records the returned `wa_message_id` so the reply can be threaded back.

**`api/whatsapp/sync-templates.ts`** — pulls template status from Meta on a schedule, so a
template rejected or paused by Meta stops being offered before an agent tries it.

## 6. Matching an inbound message to a record

The same problem the email sync solves by address, solved by number — with one wrinkle that will
otherwise bite immediately.

**South African numbers are stored inconsistently.** The Swordfish data has `0785944770`;
WhatsApp will deliver `27785944770`. Neither matches the other as text. Every number is
normalised to E.164 on the way in and on the way out:

- strip spaces, dashes, brackets
- `0XXXXXXXXX` → `+27XXXXXXXXX`
- `27XXXXXXXXX` → `+27XXXXXXXXX`
- keep an existing `+` prefix

A generated column or a normalised index on `contacts.mobile` and `leads.mobile` makes the
lookup exact rather than a `like` scan across a hundred thousand rows.

Resolution order, most specific first, matching what the email threading already does:

1. `context.id` on the inbound message identifies the message being replied to — inherit that
   activity's `deal_id`, `company_id`, `lead_id`. This is the only path that lands a reply on
   the right **deal**.
2. Otherwise match the sender's number against contacts, then leads.
3. Otherwise file against no record and surface it for triage rather than dropping it.

## 7. Annexure B — the part that must not be an afterthought

Two obligations, and the second is the one that costs money if missed.

**Every outbound WhatsApp is a billable action** at the correspondence rate, raised through
`actionTariff.ts` like any other. The tariff is the source, not a number typed per send.

**The monthly electronic-communication cap counts WhatsApp too.** The Act limits electronic
communications per account per month; SMS and email already breach it on 287 account-months in
the historical data. Adding a third channel without counting it makes that worse.

So the cap check is **cross-channel by construction**: SMS + outgoing email + WhatsApp, counted
together, per account, per month. `api/whatsapp/send.ts` refuses a send that would exceed it and
says which channel consumed the allowance. The same check belongs on email and SMS, and building
it here is the reason to build it everywhere.

> **Open:** whether the cap counts per account or per debtor, and precisely which message types
> fall inside it. A debtor with four accounts is either entitled to 10 or to 40. Needs the Act
> read properly before the check is enforced rather than warned on.

## 8. Risks, in the order that can stop this

**Template approval.** Debt collection is sensitive under WhatsApp's Business Messaging Policy.
Each template is approved individually, and a template that reads as chasing a debt may be
rejected. **Get one approved before any of this is built.** If that fails, nothing below matters.

**The number can be banned.** Meta weights user reports heavily, and every recipient here is by
definition unhappy to hear from us. Enough blocks and the number is restricted or gone —
along with the channel built on it. Use a dedicated number, never the main line, and treat the
block rate as the pilot's primary metric rather than a footnote.

**Opt-outs are legal, not optional.** A debtor asking to stop must stop, permanently, across
every channel that number appears on. `whatsapp_optouts` outlives the contact record for exactly
this reason.

**POPIA.** WhatsApp message bodies will contain debtor personal data and will sit in
`activities` alongside everything else — so the same encryption, retention and access rules
apply, and the webhook must not log message bodies to a console anyone can read.

## 9. Rollout

1. **Approve one utility template.** Free, and it answers the only unanswerable question.
2. Dedicated number, Meta Business verification, number registered to the WABA.
3. Build the webhook and inbound capture only — **receiving is free**, so this can run against
   real replies at no cost while outbound is still done by hand through the deep link.
4. Add outbound with the window logic and the cap check.
5. Pilot on one client, a few hundred accounts. Measure delivery, reply rate, and block rate.
6. Decide on the book from real numbers.

Steps 1–3 cost nothing. The first rand is spent at step 4.

## 10. What is deliberately not in scope

- Marketing templates of any kind.
- Bulk broadcast. Every message is raised against an account by someone accountable for it.
- A WhatsApp number per agent. Replies must reach the account, not an individual's handset —
  which is the failure of the deep link this is replacing.
