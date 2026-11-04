# Testing & bug alerts

Three layers. Each one catches a kind of bug the others can't.

| Layer | Command | What it catches | Needs |
|---|---|---|---|
| **Checks** | `npm test` (or `npm run test:quick` to skip the build) | Wrong money, dates, fees, interest, SMS counts, call rules; broken API imports; lint; type errors; a build that won't deploy | Nothing. ~20s |
| **Smoke tour** | `npm run test:smoke` (`-- --tablet` for tablet width) | A page that crashes, goes blank, logs a JS error, or gets a 5xx from the API/Supabase. Visits every page, every tab, and one real record of each kind | A login in `.env.local`, pointed at **staging** |
| **Live alerts** | runs by itself in production | Anything that breaks for a real user, on a real record we never thought to test | Three env vars (below) |

GitHub runs `npm test` on every push (`.github/workflows/checks.yml`) and emails you if it fails.
The smoke tour runs there too once the `QA_*` / `RAPTOR_QA_*` secrets are added.

## Why Playwright, not Puppeteer

Same idea (a robot drives a real browser), but Playwright waits for elements to be ready before
clicking, which removes most of the "the test failed but the app was fine" flakiness people
complain about with Puppeteer. It is already what `scripts/qa/screenshot.mjs` uses.

A robot can only tell you something *broke*. It can't tell you a number is *wrong*. That's what
the `check-*` scripts are for -- every fee, balance and due date in them was worked out by hand.

## Turning on bug alerts

When any page crashes, the user sees a "Something went wrong — it's been reported" box instead of
a white screen, and the error is sent to `/api/report-error`. That stores it in the
`error_reports` table and emails you -- once per distinct bug per 6 hours, with a count of repeats.

1. ~~Create the `error_reports` table~~ — done on "Sales Raptor Staging" (the live project) on 4 Nov 2026. For a new project, run the block at the bottom of `supabase/schema.sql`.
2. Create a free key at resend.com.
3. In Vercel → Project → Settings → Environment Variables add:
   - `ERROR_ALERT_RESEND_KEY` = the key (NOT `RESEND_API_KEY`, which is News's key for bfnews.co.za)
   - `ERROR_ALERT_EMAIL` = who gets told (comma-separate several)
   - `ERROR_ALERT_FROM` = optional; needs a domain verified in Resend, otherwise the
     `onboarding@resend.dev` default only delivers to the Resend account owner's address.

Until step 1 is done errors are still emailed; until step 3 they are still logged in Vercel.

To report a server-side error from any API route:

```ts
import { recordError } from '../_lib/errorAlert.js'
// ...
} catch (e) {
  await recordError(adminClient(), { message: String(e), stack: (e as Error).stack, source: 'server', url: req.url })
  throw e
}
```

## Adding a test

- A rule about money/dates/status → a new `scripts/qa/check-<thing>.mjs`. `npm test` picks it up
  automatically. Copy the shape of `check-account-status.mjs`.
- A page or tab → add a line to `SCENARIOS` in `scripts/qa/smoke.mjs`.
- Every bug you fix → add the case that would have caught it, so it can't come back.
