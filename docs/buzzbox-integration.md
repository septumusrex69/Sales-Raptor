# BuzzBox Cloud (PABX) — click-to-dial integration

Status: **built, not yet exercised against a live BuzzBox account.** Everything below was
written from BuzzBox's own API spec and verified as far as the login route; the one thing
only a real account can confirm is the exact number format its dial plan wants (see §6).

## 1. What BuzzBox exposes

BuzzBox publishes its API as Swagger UI at
<https://buzzboxcloud.co.za/buzzbox-conductor/docs/>. That page is an empty shell until
JavaScript runs — the actual spec is the 530 KB YAML at <https://buzzboxcloud.co.za/openapi>
("Jini.Guru Technologies : BuzzBox ReST API", version 3.1.10, 251 routes).

Every `/rest/v1/...` path in the spec is served under the **`/buzzbox-conductor`** prefix in
production. Probed on 2026-09-09:

| Request | Result |
|---|---|
| `POST https://buzzboxcloud.co.za/buzzbox-conductor/rest/v1/login` | `401` with a structured BuzzBox error (`SEC001 Invalid identity/password`) — the API |
| `POST https://buzzboxcloud.co.za/rest/v1/login` | WordPress 404 page — not the API |

The routes we use:

| Purpose | Route | Body / response |
|---|---|---|
| Log in | `POST /rest/v1/login` | `{ identity, password }` → `{ headerName, headerValue, expiresEpochSecs, ... }` |
| Find the organisation | `GET /rest/v1/pabx-organisations` | `[{ organisationId, name, sipDomain }]` |
| List extensions | `GET /rest/v1/pabx-organisations/{id}/pabx-contacts` | `[{ extension, name, email, ... }]` |
| **Click to dial** | `POST /rest/v1/pabx-organisations/{id}/calls` | `{ from, to, reference?, webhookUrl? }` |

Auth is a JWT: the login response tells you the header *name* to send it in as well as the
value, and when it expires. The spec's advice is to renew before expiry rather than react to
a 401, which is what `api/_lib/buzzbox.ts` does (cached per identity, renewed a minute early).

Errors come back as an array of `ExceptionData` (`{ code, description, severity, type, traceId }`);
the client surfaces `description`.

## 2. How it works in Raptor

Two halves, deliberately mirroring the email integration:

1. **An Administrator connects the firm's BuzzBox login once** (Settings → Integrations →
   BuzzBox). The password is AES-256-GCM encrypted with `EMAIL_CREDENTIALS_KEY` into
   `buzzbox_settings` — a single-row table with RLS on and no policies, readable only by
   server-side code holding the service key. Reps never see it.
2. **Each person picks their extension** from the organisation's list (stored as
   `profiles.buzzbox_extension`). Admins can set everyone's from the same card.

Once both are in place, every phone number rendered through `<PhoneLink>` stops being a
`tel:` link and becomes a button: BuzzBox rings the rep's extension first, and when they pick
up it dials the number and bridges the two. A successful dial writes a `Call` Activity on the
record it was clicked from (lead, contact, client) with the number and extension in the notes —
the same Activity a manually logged call creates, so it threads, reports and counts identically.

Anyone without an extension, or a firm without BuzzBox connected, gets the `tel:` link as before.

### Where click-to-dial appears

- Lead detail: office and mobile numbers, and each linked contact's numbers (also stamps the
  lead's last-contact time).
- Leads list: the row **Call** quick action.
- Client (company) detail: the client's number and each contact's numbers.
- Contact detail.
- Debtor account workspace: contact numbers dial but are **not** logged — the account timeline
  is its own table (`account_notes`), not `activities`. Logging there is a follow-up.

## 3. Server routes

All under `api/buzzbox/`, all require a Supabase session bearer token, same as `api/email/*`.

| Route | Who | Does |
|---|---|---|
| `POST /api/buzzbox/connect` | Administrator | Verifies the login, resolves the organisation (auto when the login sees exactly one; `409` with a list to pick from otherwise), stores credentials. |
| `GET /api/buzzbox/status` | anyone signed in | `{ connected, identity, organisationId, organisationName, extension }` — never the password. |
| `GET /api/buzzbox/extensions` | anyone signed in | The organisation's extensions for the picker. |
| `POST /api/buzzbox/call` | anyone signed in | `{ to, reference? }` → rings the caller's extension, then `to`. `400` if they have no extension. |
| `POST /api/buzzbox/disconnect` | Administrator | Removes the credentials. Extensions on profiles are kept. |

## 4. Database

Apply the two additions in `supabase/schema.sql` (both are `if not exists`, safe to re-run):

```sql
alter table public.profiles add column if not exists buzzbox_extension text;

create table if not exists public.buzzbox_settings (
  id smallint primary key default 1 check (id = 1),
  identity text not null,
  encrypted_password text not null,
  organisation_id bigint not null,
  organisation_name text,
  connected_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.buzzbox_settings enable row level security;
```

The security advisor will flag `buzzbox_settings` as "RLS enabled, no policy". That is the
intended lock, exactly as for `email_connections`. Do not add a policy.

## 5. Environment

| Variable | Required | Notes |
|---|---|---|
| `EMAIL_CREDENTIALS_KEY` | yes | Already required by the email integration; reused to encrypt the BuzzBox password. |
| `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL` | yes | Already required. |
| `BUZZBOX_BASE_URL` | no | Defaults to `https://buzzboxcloud.co.za/buzzbox-conductor`. Only for a staging host. |
| `BUZZBOX_DIAL_FORMAT` | no | `e164` (default) or `local` — see §6. |

## 6. The one thing to verify on first use

The spec does not say what format `CallSetup.to` expects. The API addresses PSTN numbers by
`{e164}` elsewhere, so the default sends **E.164 digits without the plus** (`0821234567` →
`27821234567`). If the first test call fails or dials wrong, set `BUZZBOX_DIAL_FORMAT=local` to
send the national form (`0821234567`) instead — no code change needed. Short numbers (six
digits or fewer) are passed through untouched as internal extensions.

## 7. Follow-ups worth doing

- **Call outcome and duration.** `CallSetup.webhookUrl` lets BuzzBox call us back about the
  call; its payload is undocumented, so it is not wired. Capturing a sample payload from a real
  call is the first step; the Activity can then be updated with answered/duration.
- **Call recordings.** `GET /rest/v1/pabx-organisations/{id}/call-recordings/{uuid}` exists;
  linking a recording to the Activity needs the webhook above to learn the recording id.
- **Inbound screen-pop.** `GET .../calls` lists active calls (with `cidNumber`), and there is a
  Pusher channel auth route, so "who is calling" against leads/contacts is feasible.
- **Debtor accounts.** Log dialled calls on the account timeline once the fee/tariff decision
  in `docs/debt-collection-model.md` is made.
