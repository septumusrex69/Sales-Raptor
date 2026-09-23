import { CHARTER_TTF, type CharterBytes } from '../../../src/lib/charter.js'

/**
 * CHARTER'S FOUR FACES, FETCHED FROM THE DEPLOYMENT'S OWN ORIGIN.
 *
 * `fetchCharter` in charter.ts asks for `/fonts/charter/...`, which is right in a browser and
 * resolves to nothing in Node -- a serverless function has no page it is relative to. The files
 * are static assets of this same deployment, so the origin is the deployment's own.
 *
 * CACHED FOR THE LIFE OF THE FUNCTION INSTANCE. The morning run draws up to two hundred notices
 * and the four files together are about 140 kB; fetched per notice that is 28 MB of pointless
 * traffic and four round trips added to every send.
 *
 * A FAILURE RETURNS NULL AND THE NOTICE PRINTS IN TIMES, which is the fallback Charter's own font
 * stack names anyway. CLAUDE.md's rule, and the reason for it: a notice in the wrong serif went
 * out; a notice that would not attach did not.
 */
let cached: CharterBytes | null | undefined

export async function charterFor(): Promise<CharterBytes | null> {
  if (cached !== undefined) return cached
  cached = await load()
  return cached
}

function originOf(): string | null {
  /* VERCEL_PROJECT_PRODUCTION_URL is the stable one -- VERCEL_URL is the per-deployment host,
     which is behind deployment protection on a preview and answers 401 to its own function. */
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL
  return host ? `https://${host}` : null
}

async function load(): Promise<CharterBytes | null> {
  const origin = originOf()
  if (!origin) return null
  try {
    const [regular, bold, italic, boldItalic] = await Promise.all(
      [CHARTER_TTF.regular, CHARTER_TTF.bold, CHARTER_TTF.italic, CHARTER_TTF.boldItalic]
        .map(async (path) => {
          const res = await fetch(`${origin}${path}`)
          if (!res.ok) throw new Error(`${path}: ${res.status}`)
          return new Uint8Array(await res.arrayBuffer())
        }),
    )
    return { regular, bold, italic, boldItalic }
  } catch {
    return null
  }
}
