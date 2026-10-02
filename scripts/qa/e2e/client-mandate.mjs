/**
 * THE MANDATE CAN BE RECORDED FROM THE CLIENT PAGE, AND THE DAY IT SAVES IS THE DAY THAT WAS
 * TYPED.
 *
 * THE FIRM, stopped importing a handover: "now it tells me I can't upload this handover sheet
 * because there's no contract signed. However, there was no option where I can upload a
 * contract... there should be a function inside the client section where it says upload a
 * mandate."
 *
 * TWO THINGS HERE NEED A REAL BROWSER AND THE RULE CHECKS CANNOT REACH EITHER.
 *
 * ONE: THE PANEL IS ACTUALLY ON THE PAGE. `<MandateCard .../>` appearing in CompanyDetail.tsx
 * proves it was written, not that it draws — it sits inside a `side` array on a layout that
 * chooses what to render, which is exactly the shape of the bug this whole folder exists for: a
 * panel provably in the deployed bundle and invisible.
 *
 * TWO: THE DATE. The control is `<input type="date">`, which hands back `2026-09-30`, and
 * `new Date('2026-09-30')` is MIDNIGHT UTC. Read back by anything west of Greenwich that is the
 * 29th — a mandate dated a day before the client signed it, on the one field a handover import
 * refuses over. The source says `T12:00:00`; what this asserts is the string that actually
 * reaches the database, which is the only place that cannot be misread.
 *
 * Run: node scripts/qa/e2e/client-mandate.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE, COMPANY_ID } from './fixtures.mjs'

const t = makeRunner('client-mandate')

const ADMIN = { ...PROFILE, role: 'Administrator', name: 'Stephan' }

/** The firm's own client, as it stood when the import refused: no mandate date at all. */
const COMPANY = {
  id: COMPANY_ID, name: 'Rinda Roo Company', account_owner_id: ADMIN.id,
  created_at: '2026-10-01T07:27:05Z', commission_rate: 0.3, industry: 'Kangaroo',
}

/**
 * `documents` is what client_documents answers with. Everything else unstubbed answers `[]`, so
 * the default case here is the real one: a client with nothing filed.
 */
async function openDetail(browser, company, { saves = [], documents = [], timezone = null } = {}) {
  const { context, page } = await signedInPage(browser, ADMIN, [
    [(u) => /\/rest\/v1\/profiles.*id=eq\./.test(u), () => ({ body: [ADMIN] })],
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
    [(u) => /\/rest\/v1\/client_documents/.test(u), () => ({ body: documents })],
    /* THE BODY OF THE SAVE, which is the assertion this file exists for. */
    [(u, req) => /\/rest\/v1\/companies/.test(u) && req.method() === 'PATCH', (u, req) => {
      try { saves.push(JSON.parse(req.postData() ?? '{}')) } catch { saves.push({ unparsed: true }) }
      return { body: [] }
    }],
    [(u) => /\/rest\/v1\/companies/.test(u), () => ({ body: [company] })],
  ], [], { timezone })
  await page.setViewportSize({ width: 1180, height: 1200 })
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/companies/${COMPANY_ID}`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  await page.waitForTimeout(2500)
  return { context, page }
}

/** The mandate card's rendered text, or a sentinel that fails loudly rather than throwing. */
const cardText = (page) => page.evaluate(() => {
  const h = Array.from(document.querySelectorAll('h3')).find((n) => n.textContent.trim() === 'The mandate')
  return h ? h.closest('.card').innerText : '(no mandate card on the page)'
})

const server = await startServer()
const browser = await chromium.launch()
try {
  /* ---------- a client with no mandate: the state the firm was stuck in ---------- */
  {
    const { context, page } = await openDetail(browser, COMPANY)
    const text = await cardText(page)

    /* IT DRAWS AT ALL. Everything below is meaningless without this, so it is asserted first
       rather than inferred from one of the strings happening to match. */
    t.ok('the mandate card is on the client page', !/no mandate card/.test(text))

    /* AND IT SAYS WHAT IS WRONG, where before there was nothing at all: the old line rendered
       only `&&` the date was already set, so the screen was blank exactly when it mattered. */
    /* THE REFUSAL ITSELF, not the card's standing subtitle -- which also contains the phrase
       "no handover can be imported" and would make the two assertions below pass on a card that
       never says anything is wrong. */
    t.ok('...and says the mandate is not on record', /No mandate on record/.test(text))

    /* AND OFFERS THE THING THAT WAS MISSING. Both halves of what the firm asked for. */
    t.ok('...and offers to add the date', /Add the date/.test(text))
    t.ok('...and offers to upload the mandate', /Upload a mandate/.test(text))

    /* THE UPLOAD OPENS ON 'Mandate'. The box files under whatever the picker holds, so a picker
       that opens on "Other" is a mandate the card will not find afterwards. */
    const kind = await page.evaluate(() => {
      const h = Array.from(document.querySelectorAll('h3')).find((n) => n.textContent.trim() === 'The mandate')
      const s = h?.closest('.card')?.querySelector('select')
      return s ? s.options[s.selectedIndex].text : null
    })
    t.check('the upload picker opens on the mandate', kind, 'Mandate')

    await context.close()
  }

  /* ---------- typing a date, and what reaches the database ---------- */
  {
    const saves = []
    /*
     * RUN IN THE FIRM'S OWN TIMEZONE, which is the one that actually breaks this.
     *
     * The container runs in UTC, where every stamp of the same day is the same day and this
     * assertion would pass on broken code -- the vacuous check CLAUDE.md warns about. The card
     * parses 'YYYY-MM-DDTHH:MM:SS' as LOCAL time and sends it as UTC, so the offset that loses a
     * day is a POSITIVE one: in Johannesburg (UTC+2) a midnight stamp is 22:00 the previous day
     * in UTC, and the mandate is stored dated the day before the client signed it. Broken-tested
     * exactly that way.
     */
    const { context, page } = await openDetail(browser, COMPANY, { saves, timezone: 'Africa/Johannesburg' })

    /*
     * ASKED FOR BEFORE IT IS CLICKED, rather than clicked and left to time out. CLAUDE.md's trap,
     * met here while break-testing this very file: take the card off the page and the block above
     * reports it correctly -- and then this line throws thirty seconds later and takes the whole
     * run down before a single failure is printed. The cause was found two screens from the
     * message.
     */
    const addDate = page.getByRole('button', { name: /Add the date/ })
    const canAdd = await addDate.count() > 0
    t.ok('the date can be opened for editing', canAdd)
    if (canAdd) {
      await addDate.click()
      await page.waitForTimeout(300)
      /*
       * AND THE RATE THE MANDATE ALLOWS IS IN THE SAME EDITOR.
       *
       * THE FIRM, reading a simulation on an account handed over that morning: "it says that
       * interest is not running. Why is interest not running? It should be running." No account
       * had a rate, because the handover sheet stopped asking for one -- "the rate is in the
       * agreement the firm already holds" -- and nothing in Raptor held that agreement. A column
       * nobody can fill is the same as no column, so the field is asserted in a real browser.
       *
       * ASKED FOR BEFORE IT IS FILLED, which is this file's own rule two screens up: a `fill` on a
       * locator that is not there times out thirty seconds later and takes the run down before a
       * single failure prints.
       */
      const hasRate = await page.locator('#mandate-interest').count() > 0
      t.ok('the mandate asks what interest it allows', hasRate)
      await page.locator('#mandate-signed-on').fill('2026-09-30')
      if (hasRate) await page.locator('#mandate-interest').fill('24')
      await page.getByRole('button', { name: 'Save' }).first().click()
      await page.waitForTimeout(700)
      /*
       * ONE PRESS, ONE PATCH, CARRYING BOTH. The rate began as its own callback beside the date's,
       * and the write count above caught it: two PATCHes at one row from one Save is two audit
       * rows for one edit and a window where the second fails after the first has landed.
       */
      if (saves.length === 1) {
        const body = saves[0]
        t.ok('...and that one write carries the rate',
          JSON.stringify(body).includes('24'))
        t.ok('...and the date with it',
          JSON.stringify(body).includes('2026-09-30'))
      }
    }

    t.check('saving the date and the rate sends exactly one write', saves.length, 1)
    /* THE COLUMN, not a camel-cased key that PostgREST would reject. */
    t.ok('...naming the mandate column', 'mandate_signed_at' in (saves[0] ?? {}))

    /*
     * THE DAY SURVIVES THE TIMEZONE. The assertion is on the DATE PART of what was sent, which
     * is what gets read back and printed on the card, quoted to a client and gated on by the
     * import. In the Johannesburg browser above, a midnight stamp sends '2026-09-29'.
     */
    const sent = saves[0]?.mandate_signed_at ?? ''
    t.check('...and the day typed is the day stored', String(sent).slice(0, 10), '2026-09-30')
    /*
     * AND IT READS BACK AS THAT DAY IN UTC TOO, which is what the database stores and what
     * formatDate prints. NOT an assertion that the string contains "T12:00": the instant is sent
     * as UTC, so the midday the card stamps in a Johannesburg browser arrives as 10:00Z -- the
     * hour moves with the reader, the DAY is the thing that must not. Midday is what buys that
     * for every offset from -11 to +12, which is every timezone this firm will ever be read in.
     */
    /* Parsed defensively for the same reason as the guard above: with nothing saved, `sent` is
       '' and toISOString throws RangeError two lines below the check that should report it. */
    const utcDay = Number.isNaN(new Date(String(sent)).getTime())
      ? '(nothing was sent)'
      : new Date(String(sent)).toISOString().slice(0, 10)
    t.check('...and reads back as that day in UTC as well', utcDay, '2026-09-30')
    await context.close()
  }

  /* ---------- a date on record, and no mandate filed behind it ---------- */
  {
    const { context, page } = await openDetail(
      browser, { ...COMPANY, mandate_signed_at: '2026-09-30T12:00:00Z' },
    )
    const text = await cardText(page)
    t.ok('a signed client reads as signed', /Signed/.test(text))
    /* NO ALARM WHERE NOTHING IS WRONG: the refusal is gone the moment the date is there. */
    t.ok('...with the refusal gone', !/No mandate on record/.test(text))
    /*
     * BUT THE PAPER IS STILL MISSING AND IT IS SAID. A real gap -- the firm cannot produce the
     * authority if a debtor's attorney asks -- and deliberately NOT a reason to stop an import,
     * which is why it lives here and not on the import screen.
     */
    t.ok('...and the missing document is still mentioned',
      /signed mandate is not filed/i.test(text))
    await context.close()
  }

  /* ---------- and with the mandate actually filed, nothing is flagged ---------- */
  {
    const { context, page } = await openDetail(
      browser,
      { ...COMPANY, mandate_signed_at: '2026-09-30T12:00:00Z' },
      {
        documents: [{
          id: 'doc-1', company_id: COMPANY_ID, name: 'Rinda Roo mandate.pdf',
          storage_path: `${COMPANY_ID}/x-mandate.pdf`, mime_type: 'application/pdf',
          size_bytes: 148_221, kind: 'Mandate', uploaded_by_name: 'Stephan',
          created_at: '2026-09-30T08:00:00Z',
        }],
      },
    )
    const text = await cardText(page)
    t.ok('the filed mandate is listed', /Rinda Roo mandate\.pdf/.test(text))
    /* A WARNING THAT FIRES WHEN NOTHING IS WRONG IS WORSE THAN NO WARNING. */
    t.ok('...and nothing is flagged', !/not filed/i.test(text))
    t.ok('...and no refusal either', !/No mandate on record/.test(text))
    await context.close()
  }
} finally {
  await browser.close()
  await stopServer(server)
}

const good = t.finish(
  'A client’s mandate can now be recorded after the client exists — the date and the signed\n'
  + 'mandate itself, on a card that draws whether or not there is anything on record. The day\n'
  + 'typed is the day stored, in every timezone the firm will ever be read in.',
)
process.exit(good ? 0 : 1)
